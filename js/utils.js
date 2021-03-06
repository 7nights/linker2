var crypto = require('crypto'),
    fs     = require('fs');
/**
 * copy all the method from source to target
 * @param {Object} target
 * @param {Object} source
 * @param {Boolean} [options.onlyCopyFunctions] set this to true to only copy function properties
 * @param {Array} [options.whiteList] only copy properties in whiteList
 * @param {Array} [options.map] copy properties in options.map.from and map them to options.map.to
 * e.g.
 * extend({}, {dog: 3, cat: 4}, {map: {from: ['dog', 'cat'], to: ['doggy', 'catty']}});
 */
exports.extend = function (target, source, options) {
    options = options || {};
    if ( options.onlyCopyFunctions === true ) {
        for (var key in source) {
            if (source.hasOwnProperty(key)) {
                if (typeof source[key] === 'function') {
                    target[key] = source[key];
                }
            }
        }
    } else if ('whiteList' in options) {
        options.whiteList.forEach(function (val, i) {
            target[val] = source[val];
        });
    } else if ('map' in options) {
        if (options.map.from.length !== options.map.to.length) throw new Error('the array from should have the same length as the array to');

        options.map.from.forEach(function (val, i) {
            val in source && (target[options.map.to[i]] = source[val]);
        });
    } else {
        for (var key in source) {
            if (source.hasOwnProperty(key)) {
                target[key] = source[key];
            }
        }
    }

    return target;
};

exports.md5 = function (data, encoding) {
  var hash = crypto.createHash('md5');
  hash.update(data);
  return hash.digest(encoding);
};
exports.fileMd5 = function (p, callback, encoding, h) {
  var hash = h || crypto.createHash('md5');
  try {
    var fstream = fs.createReadStream(p);
  } catch (e) {
    return callback(e);
  }
  var readEnd = false, callbackCalled = false;

  fstream.on('end', function () {
    callback(null, hash.digest(encoding));
  });
  fstream.on('readable', function () {
    var d;
    while((d = fstream.read(1024)) !== null) {
      hash.update(d);
    }
  });

};
exports.getRandomBytes = function (size){
  var buf = new Buffer(size);
  while(size){
    size--;
    buf[size] =  parseInt(Math.random() * 255);
  }
  return buf;
};
exports.log = function (type, msg) {
    console.log('[' + type.toUpperCase() + '] ' + (msg.constructor === Array || msg.toString() === '[object Object]' ? JSON.stringify(msg) : msg));
};
exports.timeCompare = function (t1, t2, range) {
  range = range || config.mtime_range || 1000;
  if (t1 > t2 && Math.abs(t1 - t2) / range > 1) {
    return 1;
  } else if (t1 < t2 && Math.abs(t1 - t2) / range > 1) {
    return -1;
  }
  return 0;
};
exports.mkdirpSync = function (p) {
  var path = require('path');
  var root = arguments[1];
  if (!root) {
    root = '';
    try {
      if (fs.statSync(p).isDirectory()) return true;
    } catch (e) {}
  }

  p = path.normalize(p);
  var cur = p.substr(0, p.indexOf(path.sep));
  if (cur.length === 0) {
    root = path.join(root, p);
    p = '';
  } else {
    root = path.join(root, cur);
    p = p.substr(p.indexOf(path.sep) + path.sep.length);
  }

  if (!fs.existsSync(root)) {
    fs.mkdirSync(root);
  } else {
    var stat = fs.statSync(root);
    if (!stat.isDirectory()) {
      throw new Error('GivenPathIsNotADir');
    }
  }

  if (p.length > 0)
    exports.mkdirpSync(p, root);
};
exports.mkurl = function (p) {
  if (require('path').sep === '\\') return p.replace(/\\/g, '/');
  return p;
};