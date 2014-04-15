'use strict';
var 
    crypto      = require('crypto'),
    settings    = require('./settings'),
    config      = require('./config'),
    utils       = require('./utils'),
    net         = require('net'),
    networks    = require('os').networkInterfaces,
    PackageHead = require('./linkerpackage').PackageHead,
    syncHandler = require('./synchandler'),
    PTYPES      = require('./ptypes');

/**
 * the this variable in following functions is
 * the socket which this state was binded to
 */

function changeState(ctx, sold, snew) {
    var stop = false;
    if (typeof ctx.beforeLinkerStateChange === 'function') {
        stop = ctx.beforeLinkerStateChange(sold, snew);
    }
    if (stop === true) return;
    ctx.lstatePre = sold;
    ctx.lstate = snew;
    typeof ctx.afterLinkerStateChange === 'function' && ctx.afterLinkerStateChange(sold, snew);
    ctx.emit('lstatechange', sold, snew);
}
/**
 * after a random seconds(.2s ~ .7s), change state if socket.lstate is idle.
 * This is because sometimes clients and server may block at the same time, and are both waiting
 * each other for response. lstates which may block should set a timeout when wait for a package response.
 * In fact, just one side rolls back can solve the dead lock. So you can only do this on server side.
 */
var changeStateAfterTime = exports.changeStateAfterTime = function (ctx, target) {
    changeState(ctx, ctx.linker.lstate, exports.idle);
    setTimeout(function fn() {
        if (ctx.linker.lstate === exports.idle) {
            return changeState(ctx, exports.idle, target);
        }
        setTimeout(fn, Math.random() * 5000 + 2000);
    }, Math.random() * 5000 + 2000);
}

function getIPlist() {
    var ips = networks(), address = [];
    function filterAddress(val) {
        if (!val.internal && val.family === 'IPv4') {
            address.push({
                addr: val.address,
                mask: val.netmask
            });
        }
    }
    for (var key in ips) {
        var arr = ips[key];
        arr.forEach(filterAddress);
    }
    return address;
}

exports.prepareForPing = function *prepareForPing(sessionBuf, callback) {
    var pkg = yield this.linker.pqueue.get();
    if (pkg.head.type !== PTYPES.HANDSHAKE_INIT_VARS) {
        if (!callback.called) {
            callback.called = true;
            callback(new Error('UNKNOW ERROR: PTYPES NOT MATCH'));
        }
        return this.end();
    }

    // send ping
    this.linker.writePackage(
        PackageHead.create(PTYPES.PING, this.linker.fromId, pkg.head.fromId, sessionBuf.length, utils.md5(sessionBuf)),
        sessionBuf
    );
    pkg = yield this.linker.pqueue.get();
    if (pkg.head.type !== PTYPES.ECHO) {
        if (!callback.called) {
            callback.called = true;
            callback(new Error('BadResponse'));
        }
        return this.end();
    }
    if (!callback.called) {
        callback.called = true;
        callback(null);
    }
    return this.end();
};
exports.prepareForPing.packageType = [PTYPES.HANDSHAKE_INIT_VARS, PTYPES.ECHO];

exports.initConnection = function *initConnection() {
    var pkg = yield this.linker.pqueue.get();

    var hmac = crypto.createHmac('md5', settings.get('password', ''));
    hmac.update(pkg.body);

    var body = Buffer.concat([new Buffer(config.uid), hmac.digest()]);
    this.linker.writePackage(
        PackageHead.create(PTYPES.HANDSHAKE_REQUEST, this.linker.fromId, pkg.fromId, body.length, utils.md5(body)),
        body
    );

    changeState(this, this.lstate, exports.waitForHandshakeResponse);
}; 
exports.initConnection.packageType = [PTYPES.HANDSHAKE_INIT_VARS];

// wait for handshake or ping request
exports.waitForHandshake = function *waitForHandshake() {
    var pkg = yield this.linker.pqueue.get();

    if (pkg.head.type === PTYPES.PING) {
        if (pkg.body.toString('hex') in this.linker.server.sessions) {
            this.linker.writePackage(PackageHead.create(
                PTYPES.ECHO, this.linker.fromId, pkg.head.fromId, 0
            ));

        }
        // TODO: stop stream
        return this.end();
    }

    var hmac = crypto.createHmac('md5', settings.get('password', ''));
    hmac.update(this.linker.handshakeSecret);
    var hmacResult = hmac.digest('hex');
    if (hmacResult == pkg.body.slice(16).toString('hex')) {
        // handshake success
        var body = utils.getRandomBytes(16); // generate session token
        this.linker.uid = pkg.body.slice(0, 16);
        this.linker.server.sessions[body.toString('hex')] = this.linker.uid;
        this.linker.writePackage(
            PackageHead.create(PTYPES.HANDSHAKE_RESPONSE, this.linker.fromId, pkg.head.fromId, body.length, utils.md5(body)),
            body
        );
        console.log('handshake success');
        return changeState(this, this.lstate, exports.idle);
    } else {
        throw new Error('HandshakeFailed');
    }
};
exports.waitForHandshake.packageType = [PTYPES.HANDSHAKE_REQUEST, PTYPES.PING];

exports.waitForHandshakeResponse = function *waitForHandshakeResponse() {
    var pkg = yield this.linker.pqueue.get();
    console.log('get handleshake response');

    this.linker.sessionBuf = pkg.body;

    if (this.linker.action && this.linker.action.type === 'download') {
        changeState(this, this.lstate, exports.download);
    } else {
        changeState(this, this.lstate, exports.initSync);
    }
};
exports.waitForHandshakeResponse.packageType = [PTYPES.HANDSHAKE_RESPONSE];

exports.download = function *download() {
    var 
        args    = this.linker.action.args,
        to      = args[0],
        session = args[1],
        body    = PTYPES.BODY.DOWNLOAD(session.toString('hex'), to);

    this.linker.writePackage(
        PackageHead.create(PTYPES.DOWNLOAD, this.linker.fromId, 0, body.length, utils.md5(body)),
        body
    );
    this.linker.downloadTo = to;

    changeState(this, this.lstate, exports.handleDownloadResponse);
};

exports.initSync = function *initSync() {
    // check if ip list was cached
    if (!this.linker.iplist) {
        return changeState(this, this.lstate, exports.requestIPList);
    }

    return changeState(this, this.lstate, exports.pingIPList);
};

exports.requestIPList = function *requestIPList() {
    this.linker.writePackage(
        PackageHead.create(PTYPES.IPLIST_REQUEST, this.linker.fromId, 0, 0)
    );

    var pkg;
    if (this.linker.server) {
        pkg = yield this.linker.pqueue.get(4000);
    } else {
        pkg = yield this.linker.pqueue.get(10000);
    }
    
    if (pkg === null) {
        changeStateAfterTime(this, exports.requestIPList);
        throw new Error('Timeout');
    }

    var
        addr      = JSON.parse(pkg.body),
        localAddr = getIPlist(),
        rSegment  = getNetworkSegment(addr),
        lSegment  = getNetworkSegment(localAddr);

    var result = [];

    rSegment.forEach(function (val, i) {
        var count = 0, seg;
        val = val.split('.');
        seg = lSegment[i].split('.');
        for (var j = 0; j < 4; j++) {
            if (val[j] !== seg[j]) break;
            count++;
        }
        result.push({
            count: count,
            addr : addr[i].addr
        });
    });
    result.sort(function (a, b) {
        if (a.count > b.count) return -1;
        if (a.count < b.count) return 1;
        return 0;
    });

    this.linker.iplist = result.map(function (val) {
        return val.addr;
    });
    utils.log('LOG', result);
    changeState(this, this.lstate, exports.pingIPList);
};
function getNetworkSegment(addrs) {
    var segs = [];
    addrs.forEach(function (val) {
        var 
            addr   = val.addr.split('.'),
            mask   = val.mask.split('.'),
            result = [];
        for (var i = 0; i < 4; i++) {
            result.push(+addr[i] & +mask[i]);
        }
        segs.push(result.join('.'));
    });
    return segs;
}
exports.requestIPList.packageType = [PTYPES.IPLIST_RESPONSE];

exports.pingIPList = function *pingIPList() {
    this.linker.availableIpList = yield pingIpAddress(this.linker, this.linker.iplist);

    if (this.linker.lstateNextCross) {
        if ('packageType' in this.linker.lstateNextCross) {
            var target = this.linker.lstateNextCross;
            this.linker.lstateNextCross = null;
            return changeState(this, this.lstate, target);
        } else {
            return this.linker.lstateNextCross();
        }
    }
    return changeState(this, this.lstate, exports.waitForSync);
};
function *pingIpAddress(linker, list) {
    var badResponse = [];
    for (var i = 0, length = list.length; i < length; i++) {
        try {
            utils.log('LOG', 'about to ping: ' + list[i]);
            yield linker.socket.ping(3000, list[i]);
        } catch (e) {
            console.log('error: ', e);
            // no response
            continue;
        }
        utils.log('LOG', 'get ping response for: ' + list[i]);
        return [list[i]];
    }
    badResponse.length > 0 && utils.log('WARNING', 'No avaliable response but get bad response.');
}
exports.pingIPList.packageType = []; // block all comming packages

// package body is JSON formatted
// {renameList: [{oldName: ..., newName: ..., mtime: ...}, ...], list: ...}
exports.waitForSync = function *waitForSync() {
    // send sync request
    this.linker.writePackage(
        PackageHead.create(PTYPES.SYNC_REQUEST, this.linker.fromId, 0, 0)
    );

    // receive sync response
    var 
        pkg        = yield this.linker.pqueue.get(),
        res        = JSON.parse(pkg.body.toString('utf-8'));

    syncHandler.handleSyncResponse(this, res);
    return changeState(this, this.lstate, exports.idle);
};
exports.waitForSync.packageType = [PTYPES.SYNC_RESPONSE];

// package body is JSON formatted
exports.handleIPListRequest = function *handleIPListRequest() {
    var address = getIPlist();
    // send iplist response
    var body = new Buffer(JSON.stringify(address));
    this.linker.writePackage(
        PackageHead.create(PTYPES.IPLIST_RESPONSE, this.linker.fromId, this.linker.currentHead.fromId, body.length, utils.md5(body)),
        body
    );
    changeState(this, this.lstate, exports.idle);
};

exports.handleDownloadResponse = function *handleDownloadRequest() {
    var pkg = yield this.linker.pqueue.get();

    syncHandler.handleDownloadedFile(this, pkg.body);
    this.end();
};
exports.handleDownloadResponse.packageType = [PTYPES.DOWNLOAD_RESPONSE];

exports.idle = function *idle() {
    var pkg = yield this.linker.pqueue.get();

    switch(pkg.head.type) {
        case PTYPES.IPLIST_REQUEST:
            changeState(this, this.lstate, exports.handleIPListRequest);
            break;
        case PTYPES.SYNC_REQUEST:
            yield syncHandler.handleSyncRequest(this);
            break;
        case PTYPES.DOWNLOAD:
            syncHandler.handleDownloadRequest(this, pkg);
            break;
        case PTYPES.PULL_REQUEST:
            syncHandler.handlePullRequest(this, pkg);
            break;
    }
};
