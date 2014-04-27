var
    co          = require('co'),
    fs          = require('co-fs'),
    path        = require('path'),
    int64       = require('node-int64'),
    settings    = require('./settings'),
    PackageHead = require('./linkerpackage').PackageHead,
    dirWatcher  = require('./dirwatcher'),
    crypto      = require('crypto'),
    PTYPES      = require('./ptypes'),
    utils       = require('./utils'),
    config      = require('./config'),
    lstate      = require('./lstate'),
    linker      = require('./core');


function *renameFile(oldName, newName, mtime) {
    var syncFolder = settings.get('syncFolder');
    if (!syncFolder) return;

    oldName = path.join(syncFolder, oldName);
    newName = path.join(syncFolder, newName);
    var stat;
    try {
        stat = fs.stat(oldName);
    } catch(e) {
        return;
    }
    if (stat.mtime <= mtime) {
        yield fs.rename(oldName, newName);
    }
}
function is(a, b) {
    return b.indexOf(a) !== -1;
}
function *deleteFile(name, mtime) {
    var syncFolder = settings.get('syncFolder');
    if (!syncFolder) return;
    name = path.join(syncFolder, name);
    var stat;
    try {
        stat = fs.stat(name);
    } catch (e) {return;}
    if (stat.mtime <= mtime) {
        yield fs.unlink(name);
    }
}

/**
 * this function can handle the response from a server
 * to a sync request. 
 */
exports.handleSyncResponse = function (socket, res) {
    /**
     * {Object} res
     * {Array} res.renameList
     * {String} res.renameList[n].oldName
     * {String} res.renameList[n].newName
     * {Number} res.renameList[n].mtime
     * {Object} res.list return of dirwatcher.getModifedList()
     */


    /**
     * return.toDownload is a array of file names to download
     * return.update[n] is like {type: 'download', mtime: 1999999, name: 'filename'//, newName: 'filename', oldName: 'filename2' }
     */

    var syncFolder = settings.get('syncFolder');
    if (!syncFolder) return;

    var ipaddr = socket.linker.iplist[0];
    co(function *() {
        var rename = [];

        res.renameList.forEach(function (val) {
            if (val === '') return;
            rename.push(renameFile(val.oldName, val.newName, val.mtime));
        });
        yield rename;

        var localList  = yield dirWatcher.getModified(syncFolder),
            diffs      = yield dirWatcher.compare(localList, res.list, false, syncFolder),
            result,
            it,
            arr        = [],
            arr2       = [],
            listHelper = yield new dirWatcher.ListHelper(syncFolder),
            request    = [];

        for (var key in diffs[0]) {
            it = diffs[0][key];
            if (is(it[0], '+')) arr.push([key, +it.substr(1)]);
            else if(is(it[0], '~')) arr2.push(key);
        }

        result = listHelper.handle(arr);
        result.toDownload = result.toDownload.concat(arr2); // files to download + the expired
        // request update
        for (key in diffs[1]) {
            it = diffs[1][key];
            if (is(it[0], '+')) result.update.push({type: '+', mtime: +it.substr(1), name: key});
            else if (is(it[0], '~'))result.update.push({type: '~', mtime: +it.substr(1), name: key});
        }
        var body = new Buffer(JSON.stringify(result.update));

        console.log('write update request');
        // send update request
        socket.linker.writePackage(
            PackageHead.create(
                PTYPES.PULL_REQUEST,
                socket.fromId,
                0,
                body.length,
                utils.md5(body)
            ),
            body
        );

        // start download
        return startDownload(result.toDownload, socket.linker.availableIpList[0], config.port, socket.linker.sessionBuf);
    })();
};
function startDownload(list, ip, port, session) {

    var limit = config.connection_limit || 4, connections = 0, i = 0;
    list.length !== 0 && newDownload();

    function newDownload() {
        console.log('create download client', list[i], i, list.length, list);

        var c = linker.createClient(ip, port, linker.ClientAction('download', [list[i], session]));
        c.test = list[i];
        i++;
        connections++;
        c.once('finishwriting', function () {
            console.log('finishwriting', c.test);
            connections--;
            if (connections < limit && i < list.length) newDownload();
        });

        if (connections < limit && i < list.length) newDownload();
    }
}
/**
 * indicate whether a path is safe or not
 * @param {String} p
 * @param {Boolean} [isDir] if the given path must be a directory.
 * @returns {Error||null} returns an Error if the check doesn't pass.
 */
var checkPath = exports.checkPath = function (p, isDir) {
    try {
        var relative = path.relative(settings.get('syncFolder'), p);
        if (relative.indexOf(settings.get('syncFolder')) === 0 || relative[0] === '.' || relative === path.normalize(p)) {
            return new Error('SecurityError');
        }

        var _isDir = require('fs').statSync(p).isDirectory();
        if (isDir === true && _isDir === false) return ('EISFILE');
        else if (isDir === false && _isDir === true) return ('EISDIR');

        return null;
    } catch (e) {
        return e;
    }
};
exports.handleDownloadRequest = function (s, pkg) {
    var syncFolder = settings.get('syncFolder');
    var args = JSON.parse(pkg.body.toString('utf-8'));
    console.log('handle download request', args.path);

    if (args.session in s.linker.server.sessions || 
        // from server which does not have the session property so it
        // sends target's uid
        args.session === (new Buffer(config.uid)).toString('hex')) {
        // calculate file md5
        var hash = crypto.createHash('md5'),
            p    = path.join(syncFolder, args.path),
            stat = require('fs').statSync(p),
            mtimeBuf = (new int64(+stat.mtime)).buffer;

        var err;
        if (err = checkPath(p, false)) {
            console.log('Error occured: ', err, p);
            utils.log('ERROR', err);
            this.end('');
            return;
        }
        hash.update(mtimeBuf);
        utils.fileMd5(p, function (err, md5) {
            s.linker.writePackage(
                PackageHead.create(PTYPES.DOWNLOAD_RESPONSE, s.linker.fromId, s.linker.currentHead.fromId, mtimeBuf.length + stat.size, md5),
                [mtimeBuf, require('fs').createReadStream(p)]
            );
            console.log('download response sent...', args.path);
        }, undefined, hash);

    } else {
        console.log(args.session, s.linker.server.sessions);
        utils.log('ERROR', 'Bad download destination');
        s.end();
    }
};

exports.handleDownloadedFile = function (s, fileName) {
    // TODO: resolve file conflict
    try {
        var fs = require('fs');
        var rs = fs.createReadStream(fileName), mtime;

        rs.on('readable', function fn() {
            /* the first 64 bits is the mtime of the file
             */
            mtime = rs.read(8);
            if (mtime === null) return;
            rs.removeListener('readable', fn);
            // compare mtime
            mtime = +(new int64(mtime));

            var oriMtime = 0, p = path.join(settings.get('syncFolder'), s.linker.downloadTo),
                notExists = false;
            try {
                oriMtime = fs.statSync(p);
            } catch (e) {
                notExists = true;
            }
            if (oriMtime < mtime) {
                var atime;
                if (notExists) {
                    atime = new Date();
                } else {
                    atime = fs.statSync(p).atime;
                }
                utils.mkdirpSync(path.dirname(p));
                /* simply rewrite the file if downloaded file is newer than the local one.
                 * TODO: file backup should be done here
                 */
                var ws = fs.createWriteStream(p);
                ws.on('finish', function () {
                    var d = new Date(mtime);
                    while (!timeEqual(+fs.statSync(p).mtime, mtime)) {
                        fs.utimesSync(p, atime, d);
                    }
                    fs.unlink(fileName);
                    s.emit('finishwriting');
                });
                rs.pipe(ws);
            } else {
                // clean up
                fs.unlink(fileName);
                s.emit('finishwriting');
            }
        });
    } catch(e) { utils.log('ERROR', e); }
    function timeEqual(t1, t2, range) {
        range = range || 1000;
        if (Math.abs(t1 - t2) / 1000 < 1) {
            return true;
        }
        return false;
    }
};

exports.handleSyncRequest = function *(socket) {
    console.log('handleSyncRequest is not implemented yet');
    var
        syncFolder = settings.get('syncFolder'),
        renameList = yield dirWatcher.getList(syncFolder, 'renameList'),
        list       = yield dirWatcher.getModified(syncFolder),
        body;

    if (renameList[0] === '') {
        renameList = [];
    } else {
        renameList = renameList.map(function (val) {
            if (val === '') return '';
            val = val.split(' ');
            return {
                mtime: +val[0],
                oldName: val[1],
                newName: val[2]
            };
        });
    }

    body = PTYPES.BODY.SYNC_RESPONSE(renameList, list);

    socket.linker.writePackage(
        PackageHead.create(PTYPES.SYNC_RESPONSE, socket.linker.fromId, socket.linker.currentHead.fromId, body.length, utils.md5(body)),
        body
    );
};

exports.signIn = function (pClients) {

};

exports.broadcastChange = function () {

};
exports.handlePullRequest = function (socket, pkg) {
    var data = JSON.parse(pkg.body.toString('utf-8'));
    var task = [], toDownload = [];
    data.forEach(function (val) {
        switch (val.type) {
            case 'rename': task.push(renameFile(val.oldName, val.newName, val.mtime)); break;
            case 'delete': task.push(deleteFile(val.name, val.mtime)); break;
            case '+':
            case '-':
                toDownload.push(val.name); break;
        }
    });
    co(function *() {
        yield task;
    })();
    
    if (doDownload() !== false) return;

    // when lstate achieves a cross, we tell it where to go
    socket.linker.lstateNextCross = doDownload;
    console.log('about to change stat');
    lstate.changeStateAfterTime(socket, lstate.requestIPList);

    function doDownload() {
        if (socket.linker.availableIpList && socket.linker.availableIpList[0]) {
            startDownload(toDownload, socket.linker.availableIpList[0], config.port, socket.linker.uid);
            return true;
        }
        return false;
    }
};

exports.createClients = function (clients, addr, force) {

    var keys = Object.keys(addr);
    for (var i = 0, len = keys.length; i < len; i++) {
        var val = addr[keys[i]];
        if (typeof val === 'string') {
            if (val.trim() === '127.0.0.1') continue;
            // device address
            if ('device:/' + val in clients) {
                if (force) clients['device:/' + val].end();
                else continue;
            }
            var c = linker.createClient(val);
            clients['device:/' + val] = c;
        } else {
            // addr(client) from server
            if (val.uid in clients) {
                if (force) clients[val.uid].end();
                else continue;
            }
            if (Date.now() - val.last > 60 * 10 * 1000) continue; // expired
            var c = linker.createClient(val.ip);
            clients[val.uid] = c;
        }
    }
};
