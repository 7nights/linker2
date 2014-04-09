'use strict';
var co = require('co'),
    fs = require('co-fs'),
    path = require('path');

/**
 * 获取目标文件夹的修改时间列表
 * @param {String} path 目标文件夹
 * @returns {Array} 修改时间列表, 类似于: [mtime, {该文件夹的修改时间列表}], 对于
 * 单个文件来说, 其属性值直接为mtime
 * 举例来说, 列表看起来像这样:
 * [1393136960262, {
 *   'exampleDir': [1393136960160, {}],
 *   'exampleFile': 1393136953189
 * }]
 */
function *getModified(path, obj, inoList) {
  var topest = false;
  if (!obj) {
    obj = [0, {}];
    topest = true;
  }
  !inoList && (inoList = {});
  var arr;
  if (obj[0] === 0) {
    arr = yield [fs.stat(path), fs.readdir(path)];
  } else {
    arr = [{mtime: obj[0]}, yield fs.readdir(path)];
  }
  var currentMtime = + arr[0].mtime,
      list         = arr[1];
  var stats = yield list.map(function (_path) {
    try {return fs.stat(path + '/' + _path);}
    catch(e) {return null; console.log(e);}
  });

  for (var i = 0, length = list.length; i < length; i++) {
    if (list[i][0] === '.' || stats[i] === null) continue;
    // records ino
    inoList[stats[i].ino] = [path + '/' + list[i], + stats[i].mtime];

    if (+ stats[i].mtime > currentMtime) currentMtime = + stats[i].mtime;
    if (stats[i].isDirectory()) {
      var _obj = [+ stats[i].mtime, {}];
      obj[1][list[i]] = yield getModified(path + '/' + list[i], _obj, inoList);
    } else {
      obj[1][list[i]] = + stats[i].mtime;
    }
  }

  obj[0] = currentMtime;
  if (topest) yield recordRename(path, inoList);

  return obj;
}

/**
 * each line of a renameList file looks like this:
 * mtime oldPath newPath
 * e.g.
 * 1393920458974 exampleFile1.txt exampleFile2.txt
 * the inoList file is JSON formatted and looks like this:
 * {ino: [filename, mtime], ino: [filename, mtime], ...}
 */
function *recordRename(path, inoList) {
  var renameList = [];
  try {
    var records = JSON.parse(yield fs.readFile(path + '/.linker/inoList', {encoding: 'utf-8'}));
  } catch (e) {
    if (e.code === 'ENOENT') {
      //TODO
      console.log('renameList not found');
    }
    throw e;
  }

  for(var key in records) {
    if (key in inoList && inoList[key][0] !== records[key][0]) {
      renameList.push({mtime: inoList[key][1], oldPath: records[key][0], newPath: inoList[key][0]});
    }
  }

  if (renameList.length > 0) {
    renameList.sort(function (a, b) {
      if (a.mtime > b.mtime) {
        return 1;
      } else if (a.mtime === b.mtime) {
        return 0;
      }
      return -1;
    });
  }

  var str = '';
  for (var key in renameList) {
    str += renameList[key].mtime + ' ' + renameList[key].oldPath + ' ' + renameList[key].newPath + '\n';
  }

  yield [fs.writeFile(path + '/.linker/inoList', JSON.stringify(inoList)), fs.appendFile(path + '/.linker/renameList', str)];
}

function *getList(path, name) {
  var p = require('path').join(path, '.linker', name);
  var data = yield fs.readFile(p, {encoding: 'utf-8'});
  data = data.split('\n');
  return data;
}

function *listHelper(path) {
  this.path = path;
  this.removeList = yield getList(path, 'removeList');
  this.renameList = yield getList(path, 'renameList');
  return this;
}
listHelper.prototype = {
  /**
   * @param {String} items[n][0] file path of the new file
   * @param {Number} items[n][1] mtime of the new file
   */
  handle: function (items) {

    var findStart = function (mtime, list) {
      var left = 0, right = list.length, mid, it, index;
      while (left !== right) {
        mid = parseInt((left + right) / 2);
        it = list[mid];
        index = it.indexOf(' ');
        num = +it.substr(0, index);
        if (mid === left || mid === right) {
          if (num < mtime) return mid + 1;
          return mid;
        }
        if (num < mtime) {
          left = mid;
        } else if (num > mtime) {
          right = mid;
        } else {
          return mid;
        }
      }
    };

    // sort input
    items.sort(function (a, b) {
      if (a[1] > b[1]) return 1;
      else if (a[1] < b[1]) return -1;
      return 0;
    });

    var listMap    = new Map,
        update     = [],
        toDownload = [];

    // step 1: handle rename
    var start = findStart(items[0][1], this.renameList),
        index1, index2, it, name;
    for (var i = start, len = this.renameList.length; i < len; i++) {
      it = this.renameList[i];
      index1 = it.indexOf(' ');
      index2 = it.indexOf(' ', index1 + 1);
      name = it.substr(index1 + 1, index2);
      listMap.set(name, {mtime: +it.substr(0, index1), newName: it.substr(index2 + 1)});
    }
    // step 2: handle delete
    start = findStart(items[0][1], this.removeList);
    for (var i = start, len = this.removeList.length; i < len; i++) {
      it = this.removeList[i];
      index1 = it.indexOf(' ');
      name = it.substr(index1 + 1);
      listMap.set(name, {mtime: +it.substr(0, index1)});
    }
    // step 3: look up items in listMap
    for (var i = 0, len = items.length; i < len; i++) {
      name = items[i][0];
      it = listMap.get(name);
      if (it === undefined) {
        toDownload.push(name);
        continue;
      }

      if (items[i][1] < it.mtime) {
        if ('newName' in it) {
          // renamed
          update.push({type: 'rename', mtime: it.mtime, newName: it.newName, oldName: name});
        } else {
          // removed
          update.push({type: 'delete', mtime: it.mtime, name: name});
        }
      }
    }

    return {
      toDownload: toDownload,
      update: update
    };
  }
};

/**
 * 比较list1以及list2, 返回的结果是一个数组
 * 数组中第一个元素以list1为基准给出list2的改动(对比最后修改时间)
 * 结果类似 [{'fileName': '+timeStamp', 'fileName2': '-timeStamp', 'fileName3': '~timeStamp'}, {}]
 * 意思是list2中新增了fileName, 删除了fileName2, 以及修改了fileName3
 * @param {Array} list1
 * @param {Array} list2
 * @param {Boolean} [recordRemove] when this param set to true, list1 must be an older list than list2
 * and do this only when you compare 2 local list
 * each line of removeList looks like this:
 * timeStamp fileName
 * @param {String} [path] path of the master directory
 * @returns [Array]
 */
function *compare(list1, list2, recordRemove, path) {
  var list1Map = {},
      list2Map = {},
      rlt1     = [],
      rlt2     = [],
      str      = '';

  var walk = function (list, map, currentPath) {
    if (list.constructor === Array) {
      map[currentPath] = list[0];
      for (var key in list[1]) {
        walk(list[1][key], map, require('path').join(currentPath, key));
      }
    } else if (typeof list === 'number') {
      map[currentPath] = list;
    }

    return map;
  };

  walk(list1, list1Map, path);
  walk(list2, list2Map, path);

  if (recordRemove) {

    for (var key in list1Map) {
      if (!(key in list2Map)) {
        str += list1Map[key] + ' ' + key + '\n';
      }
    }

    if (str.length > 0) yield fs.appendFile(path + '/.linker/removeList', str);
  }

  var getObj = function (key, value) {
    var obj = {};
    obj[key] = value;
    return obj;
  };
  for (var key in list1Map) {
    if (require('path').relative(key, path) === '') {
      delete list2Map[key];
      continue;
    }
    else console.log(key, '$');
    if (!(key in list2Map)) {
      rlt1.push(getObj(key, '-' + list1Map[key])); // clients ignore '-'
      rlt2.push(getObj(key, '+' + list1Map[key]));
    } else if (list1Map[key] > list2Map[key]) {
      delete list2Map[key];
      rlt2.push(getObj(key, '~' + list1Map[key]));
    } else if (list1Map[key] < list2Map[key]) {
      rlt1.push(getObj(key, '~' + list2Map[key]));
      delete list2Map[key];
    } else {
      delete list2Map[key];
    }
  }
  for (key in list2Map) {
    rlt1.push(getObj(key, '+' + list2Map[key]));
    rlt2.push(getObj(key, '-' + list2Map[key]));
  }

  return [rlt1, rlt2];
}

/**
 * initialize specific dir, create linker files etc.
 */
function *initialize(path) {
  var linkerPath = require('path').join(path, '.linker');

  function *createJSONFile(path, array) {
    var exists = yield fs.exists(path);
    if (!exists) fs.writeFile(path, array ? '[]' : '{}');
  }
  function *initFileList(path) {
    var _p = require('path').join(path, '.linker', 'fileList');
    var exists = yield fs.exists(_p);
    if (!exists) {
      var list = yield getModified(path);
      yield fs.writeFile(_p, JSON.stringify(list));
    }
  }

  yield _mkdirp(linkerPath);
  yield [initFileList(path), fs.appendFile(linkerPath + '/removeList', ''), fs.appendFile(linkerPath + '/renameList', ''), createJSONFile(linkerPath + '/inoList', '')];

  if (require('path').sep === '\\') require('child_process').spawn('attrib', ['+H', linkerPath]);
}

var watchers = {};
function watch(path, onChangeCallback, onInitialized) {
  var p = require('fs').realpathSync(path);
  if (p in watchers) throw new Error('This path is already being watched.');
  co(function *() {
    yield initialize(path);
    typeof onInitialized === 'function' && onInitialized();
    watchers[p] = setInterval(function () {
      co(function *() {
        var ret = yield [getFileList(path), getModified(path)],
              oldList = ret[0],
              newList = ret[1];
          ret = null;

        var diff = yield compare(oldList, newList, true, path);
        console.log(diff, newList);

        yield fs.writeFile(require('path').join(path, '.linker', 'fileList'), JSON.stringify(newList));
        if (Object.keys(diff[0]).length > 0 || Object.keys(diff[1]).length > 0) typeof onChangeCallback === 'function' && onChangeCallback(diff);
      })();
    }, 10000);
  })();
}

function unwatch(path) {
  var t = watchers[path];
  clearInterval(t);
  delete watchers[path];
  t = null;
}
function unwatchAll() {
  for (var key in watchers) {
    clearInterval(watchers[t]);
  }
  watchers = {};
}
function isWatching(path) {
  return path in watchers;
}

function *getFileList(path) {
  var linkerPath = require('path').join(path, '.linker');
  var data = yield fs.readFile(linkerPath + '/fileList', {encoding: 'utf-8'});
  return JSON.parse(data);
}

/**
 * @private
 */
function __mkdir(dir, mode, callback) {
  if(!callback) callback = function () {};
  require('fs').exists(dir, function (exists) {
    if (exists) {
      return callback();
    }
    require('fs').mkdir(dir, mode, callback);
  });
}

function _mkdirp(dir, mode) {
  return function (callback) {
    if (!mode) {
      mode = 511 & (~process.umask());
    }
    var parent = require('path').dirname(dir);
    require('fs').exists(parent, function (exists) {
      if (exists) {
        return __mkdir(dir, mode, callback);
      }
      _mkdirp(parent, mode, function (err) {
        if (err) {
          return callback(err);
        }
        __mkdir(dir, mode, callback);
      });
    });
  };
}

exports.watch = watch;
exports.unwatch = unwatch;
exports.unwatchAll = unwatchAll;
exports.isWatching = isWatching;
exports.compare = compare;
exports.getModified = getModified;
exports.getList = getList;