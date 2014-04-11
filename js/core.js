'use strict';
var
  co             = require('co'),
  crypto         = require('crypto'),
  PTYPES         = require('./ptypes'),
  lstate         = require('./lstate'),
  settings       = require('./settings'),
  config         = require('./config'),
  net            = require('net'),
  Package        = require('./linkerpackage').Package,
  PackageHead    = require('./linkerpackage').PackageHead,
  utils          = require('./utils'),
  stream         = require('stream'),
  BlockableQueue = require('./blockablequeue');

/**
 * a wrap for Buffer to give it more abilities
 */
function NiceBuffer(buf){
  this.buf = buf || new Buffer(0);
  this.length = this.buf.length;
}
NiceBuffer.prototype = {
  concat: function(buf){
    buf.constructor === NiceBuffer && (buf = buf.toBuffer());
    if (buf.length === 0) return this;
    this.buf = Buffer.concat([this.buf, buf]);
    this.length = this.buf.length;
    return this;
  },
  toBuffer: function(){
    return this.buf;
  },
  slice: function(start, end){
    return this.buf.slice(start, end);
  },
  writeUInt32: function(uint32){
    var buffer = new Buffer(4);
    buffer.writeUInt32LE(uint32, 0);
    this.concat(buffer);
  },
  writeUInt8: function(uint8){
    this.concat(new Buffer([uint8]));
  },
  shift: function(length){
    var temp = this.buf.slice(0, length);
    this.buf = this.buf.slice(length);
    this.length = this.buf.length;
    return temp;
  }
};

function md5(data, encoding) {
  var hash = crypto.createHash('md5');
  hash.update(data);
  return hash.digest(encoding);
}

function getRandomBytes(size){
  var buf = new Buffer(size);
  while(size){
    size--;
    buf[size] =  parseInt(Math.random() * 255);
  }
  return buf;
}

function initLinkerSocket(s, action) {
  var nil = undefined;
  /**
   * {Array} this.linker.iplist avaliable ip list of current server, length of this array expect to be 1
   * {BlockableQueue} this.linker.pqueue
   * {lstate} this.lstate current lstate of this socket
   * {String} this.linker.uid
   * {lServer} this.linker.server
   * {Buffer} this.linker.sessionBuf
   * {Number} this.linker.toId
   * {net.Socket} this.linker.socket === this
   * {Number} this.linker.fromId
   * {String} this.linker.toDownload this will be set once a ptypes.DOWNLOAD package is sent.
   * It indicates where the file should be downloaded to.
   */

  s.linker = {};

  s.linker.toDownload      = nil;
  s.linker.iplist          = nil;
  s.linker.avaliableIpList = nil;
  '' + action === '[object Object]' && (s.linker.action = action);

  // package queue
  s.linker.pqueue = new BlockableQueue;

  // writePackage
  s.linker.writePackage = writePackage;
  s.linker.socket = s;

  // init sid
  s.linker.fromId = 0;
  s.linker.toId = 0;

}
/**
 * write a package to a socket
 * @param {PackageHead || Buffer || Package}
 * @param {Buffer} [body]
 */
function writePackage(head, body) {
  var skt;
  if (arguments.length === 1 && head instanceof Package) {
    body = head.body;
    head = head.head;
  }
  if (arguments.length === 3) {
    skt = arguments[0];
    head = arguments[1];
    body = arguments[2];
  } else {
    skt = this.socket;
  }
  skt.fromId++;
  skt.lastWritePackage = new Package(head, body);
  if (head instanceof PackageHead) head = head.buffer;
  skt.write(head);
  
  if (body) {
    if (body.constructor === Array) {
      var i = 0;
      while (i < body.length) {
        writeBody(body[i]);
        i++;
      }
    } else {
      writeBody(body);
    }
  }
  function writeBody(body) {
    if (body instanceof stream.Readable) {
      return body.pipe(skt);
    } else {
      skt.write(body);
    }
  }
}

/**
 * these two functions are for receiving & handling the bytes data.
 * they generate a package and put it into socket.linker.pqueue when
 * there are enough bytes.
 */
function packageWaitForHeader(s) {
  // TODO: body length should have a limitation
  var p = this;
  if (p.length >= 29) {
    s.linker.currentHead = PackageHead.create(p.shift(29));
  } else {
    return;
  }

  if (s.linker.currentHead.type === PTYPES.DOWNLOAD) {
    // we need create a write stream for downloading a file
    p.writeablePath = require('path').join(require('os').tmpdir, 'linker' + utils.getRandomBytes(16).toString('hex'));
    p.writeable = require('fs').createWriteStream(p.writeablePath);
    p.writeable.on('finish', endWriteStream);
    p.written = 0;
  } else {
    p.writeable = null;
  }

  p.state = packageWaitForBody;
  p.state(s);

  function endWriteStream() {
    // verify body
    utils.fileMd5(p.writeablePath, function (err, md5) {
      if (err) throw err;
      if (!s.linker.currentHead.verify(md5)) {
        co(function *() {
          var head = s.linker.currentHead;
          yield waitForDeliverable(s.linker.currentHead.type, s);
          // in this case, package.body is the path of the file
          yield s.linker.pqueue.put(new Package(head, p.writeablePath));
          p.state = packageWaitForHeader;
          p.state(s);
        })();
      } else {
        console.log('Body File verification failed...');
        p.state = packageError;
        return p.state(s);
      }
    });
  }
}
function packageWaitForBody(s) {
  var p = this, dataLength = s.linker.currentHead.dataLength;
  if (p.writeable !== null) {
    if (p.written === s.linker.currentHead.dataLength) {
      // finished writing file
      return p.writeable.end();
    } else {
      if (p.length === 0) return;
      // write data to file
      var chunkLength = Math.min(p.length, dataLength - p.written);
      p.written += chunkLength;
      p.writeable.write(p.shift(chunkLength));
      return p.state(s);
    }
  }
  if (p.length >= dataLength) {
    var bodyBuf = p.shift(dataLength);
    // TODO verify body
    if (!s.linker.currentHead.verify(md5(bodyBuf))) {
      console.log('Body verification failed...');
      console.log('Data length: ' + s.linker.currentHead.dataLength, 'Body length: ' + bodyBuf.length);
      p.state = packageError;
      s.linker.lasterror = new Error('BodyInvalid');
      return p.state(s);
    }

    co(function *() {
      var head = s.linker.currentHead;
      yield waitForDeliverable(s.linker.currentHead.type, s);
      yield s.linker.pqueue.put(new Package(head, bodyBuf));
      p.state = packageWaitForHeader;
      p.state(s);
    })();
  }
  return;
}
function packageError(s) {
  console.log(s);
  // TODO
  s.end();
}

/*
 * block until type of the delivering package
 * is in socket.lstate.packageType
 * @param {Number} type
 * @param {net.Socket} s
 */
function waitForDeliverable(type, s) {
  if (!s.waitForDeliverableList) {
    s.waitForDeliverableList = [];
  }

  return function (fn) {
    if (!s.lstate.packageType) return fn(null);
    if (s.lstate.packageType.indexOf(type) !== -1) return fn(null);

    s.waitForDeliverableList.push({type: type, callback: fn});
    if (!s.afterLinkerStateChange) {
      s.afterLinkerStateChange = function (sold, snew) {
        if (!snew.packageType) return s.waitForDeliverableList.shift().callback(null);

        // search for a package can be delivered at this time
        for (var i = 0, len = s.waitForDeliverableList; i < len; i++) {
          if (snew.packageType.indexOf(s.waitForDeliverableList[i].type) !== -1) {
            return s.waitForDeliverableList[i].splice(i, 1).callback(null);
          }
        }
      };
    }
  };
}

/**
 * Linker server
 */
function lServer() {
  var connectListeners = [],
      server = net.createServer(function (c) {
    connectListeners.forEach(function (val) {
      val(c);
    });
    var packageBuffer = new NiceBuffer;
    packageBuffer.state = packageWaitForHeader;
    initLinkerSocket(c);
    // bind socket to server
    c.linker.server = server;

    c.on('data', function (data) {
      packageBuffer.concat(data);
      packageBuffer.state(c);
    });
    c.on('close', function (data) {
      c.ended = true;
    });
    c.on('error', function (data) {
      c.ended = true;
    });

    c.linker.handshakeSecret = getRandomBytes(16);
    c.linker.writePackage(PackageHead.create(PTYPES.HANDSHAKE_INIT_VARS, 0, 0, 16, md5(c.linker.handshakeSecret)), c.linker.handshakeSecret);

    handleState(c, lstate.waitForHandshake);
  });
  server.on('error', function (err) {
    console.error(err);
    server.ended = true;
  });
  server.on('close', function (err) {
    server.ended = true;
  });
  server.listen(config.port, function () {
    console.log('Linker server established.');
  });
  server.sessions = {};

  // server api
  utils.extend(server, {
    onConnect: function (fn) {
      connectListeners.push(fn);
    }
  });

  return server;
}

function handleState(socket, state) {
  var args = [].slice.call(arguments, 2); // init args
  co(function *(){
    socket.lstate = state; // init state
    try {
      while (1) {
        yield socket.lstate.apply(socket, args);
        args = [];
        if (socket.ended) return;
      }
    } catch (e) {
      // TODO
      console.trace(e, 20);
      console.error(e);
    }
  })();
}

/**
 * Linker client
 * launch a linker client
 * @param {String} host
 * @param {String || Number} port
 */
function lClient() {

  var createConnection = function (host, port, action, callback, errorHandler) {
    !port && (port = config.port);
    var s = net.createConnection(port, host, function () {
      console.log('lClient connected to ' + host + ':' + port);
      s.toId = 0;
      s.fromId = 0;
      s.lastError;
      var packageBuffer = new NiceBuffer;
      packageBuffer.state = packageWaitForHeader;
      initLinkerSocket(s, action);
      s.on('data', function (data) {
        packageBuffer.concat(data);
        packageBuffer.state(s);
      });
      s.on('close', function () {
        s.ended = true;
      });

      handleState(s, lstate.initConnection);
    });
    s.on('error', function (err) {
      console.error(err);
      console.trace(err);
      this.lastError = err;
    });

    // client methods
    utils.extend(s, {
      ping: function (timeout, ip, port) {
        var self = this;
        return function (fn) {
          fn.called = false;
          !port && (port = config.port);
          var clt = net.createConnection(port, ip, function () {
            console.log('connection created ', port, ip);
            var packageBuffer = new NiceBuffer;
            packageBuffer.state = packageWaitForHeader;
            initLinkerSocket(clt);
            clt.on('data', function (data) {
              packageBuffer.concat(data);
              packageBuffer.state(clt);
            });
            handleState(clt, lstate.prepareForPing, self.linker.sessionBuf, fn);
          });
          setTimeout(function () {
            if (!fn.called) {
              fn.called = true;
              fn(new Error('Timeout'));
            }
          }, timeout);
        };
      }
    });

    return s;
  };

  return createConnection.apply(this, [].slice.call(arguments));
}

exports.createServer = lServer;
exports.createClient = lClient;
exports.ClientAction = function (type, args) {
    return {type: type, args: args};
};