'use strict';

/* Services */


// Demonstrate how to register services
// In this case it is a simple value service.
angular.module('Linker.services', []).
  provider('storage', function () {
    this.namespace = 'settings';
    var _method, self = this, listeners = [];
    _method = {
      set: function (path, value) {
        var _path = path, oldValue;
        var obj = getStorageObject();
        path = path.split('.');
        var tempObj = obj,
            i = 0, len = path.length;
        while (i < len - 1) {
          if (!(path[i] in tempObj)) {
            tempObj[path[i]] = {};
          }
          tempObj = tempObj[path[i]];
          i++;
        }
        oldValue = tempObj[path[i]];
        tempObj[path[i]] = value;
        saveStorageObject(obj);
        
        oldValue !== value && listeners.forEach(function (val) {
          if (_path === val.path) {
            val.listener(oldValue, value);
          }
        });
      },
      get: function (path, _default) {
        path = path.split('.');
        var i = 0, len = path.length,
            obj = getStorageObject();
        while (i < len - 1) {
          try {
            obj = obj[path[i]];
          } catch (e) {
            return _default;
          }
          i++;
        }
        return path[i] in obj ? obj[path[i]] : _default;
      },
      watch: function (path, listener) {
        listeners.push({
          path: path,
          listener: listener
        });
      }
    };
    function getStorageObject() {
      var index = self.namespace + 'Storage';
      if (!(index in localStorage)) localStorage[index] = '{}';
      return JSON.parse(localStorage[self.namespace + 'Storage']);
    }
    function saveStorageObject(obj) {
      localStorage[self.namespace + 'Storage'] = JSON.stringify(obj);
    }
    this.$get = function () {
      return _method;
    };
  }).
  provider('windowManager', [function () {
    
    var win = require('nw.gui').Window.get();

    var _methods = {};

    // show & hide
    _methods.show = function () {
      win.show();
    };
    _methods.hide = function () {
      win.hide();
    };

    // set title
    _methods.setTitle = function (title) {
      win.title = title;
    };

    // start browser
    _methods.startBrowser = function (url) {
      if (url.toLowerCase().indexOf('http') !== 0) url += 'http://';
      this.openLocation(url);
    }

    // open location
    _methods.openLocation = function (url) {
      // for windows
      exec('start ' + url);
    };

    // event register
    var listeners = {};
    _methods.on = function (type, callback) {
      listeners[type].constructor === Array && listeners[type].push(callback);
    };

    // close window
    listeners['closing'] = [];
    _methods.close = function (force, doNotTrigger) {
      if (force && doNotTrigger) return win.close(true);

      for(var i = 0, length = listeners['closing'].length; i < length; i++) {
        var evt = {
          _preventDefault: false,
          preventDefault: function () {
            this._preventDefault = true;
          },
          type: 'closing'
        };
        var result = listeners['closing'][i](evt);
        if ((result === false || evt._preventDefault) && !force) {
          return;
        }
      }

      win.close(true);
    };
    win.on('close', function () {
      if (dispatchEvent('closing', {}) !== false) {
        win.close(true);
      }
    });
    /**
     * 如果任何一个监听器调用了preventDefault或者返回了false, 此函数返回false
     */
    function dispatchEvent(type, evt) {
      var result;
      var ev = {};
      for (var i = 0, length = listeners[type].length; i < length; i++) {
        ev = Object.create(evt);
        ev._preventDefault = false;
        ev.preventDefault = function () {
          this._preventDefault = true;
        };
        ev.type = type;
        listeners[type][i](ev) === false?(result = false):(1);
      }
      if (ev._preventDefault === true) {
        result = false;
      }
      return result;
    }

    // blur & focus
    listeners['blur'] = [];
    listeners['focus'] = [];
    window.onblur = function (e) {
      dispatchEvent('blur', {});
    };
    window.onfocus = function (e) {
      dispatchEvent('focus', {});
    };

    // always front
    var orderedFront = false;
    _methods.orderFront = function (front) {
      win.setAlwaysOnTop(front);
      orderedFront = front;
    };
    _methods.toggleFront = function () {
      orderedFront = !orderedFront;
      win.setAlwaysOnTop(orderedFront);
      return orderedFront;
    };
    _methods.isOnTop = function () {
      return orderedFront;
    };

    // window control
    var windowState = 'normal',
        windowStateBeforeMinimize = '';
    _methods.minimize = function () {
      win.minimize();
    };
    _methods.maximize = function () {
      win.maximize();
    };
    _methods.unmaximize = function () {
      win.unmaximize();
    };
    _methods.restore = function () {
      win.restore();
    };
    Object.defineProperty(_methods, 'state', {
      configurable: false,
      get: function () {
        return windowState;
      }
    });
    // watch window state change
    var lastCapturedSize = {
      queue: [],
      index: 0,
      getSize: function () {
        return this.queue[this.index === 0 ? 1 : 0];
      },
      setSize: function () {
        this.queue[this.index] = {
          width: win.width,
          height: win.height
        };
        this.index = this.index === 0 ? 1 : 0;
      }
    };
    var ignoreUnmaximize = false,
        lastSize = {
          width: null,
          height: null
        };
    listeners['windowStateChange'] = [];
    win.on('minimize', function () {
      windowStateBeforeMinimize = windowState;
      windowState = 'minimize';
      dispatchEvent('windowStateChange', {oldState: windowStateBeforeMinimize, newState: 'minimize'});
    });
    win.on('restore', function () {
      var oldState = windowState;
      windowState = windowStateBeforeMinimize;
      dispatchEvent('windowStateChange', {oldState: oldState, newState: windowState});
    });
    win.on('maximize', function () {
      var oldState = windowState;
      windowState = 'maximize';
      // fix bug: maximize
      // ignoreUnmaximize = true;
      // win.unmaximize();
      // lastSize.width = win.width;
      // lastSize.height = win.height;
      // win.resizeTo(window.screen.availWidth, window.screen.availHeight);
      // win.moveTo(window.screen.availLeft, window.screen.availTop);
      dispatchEvent('windowStateChange', {oldState: oldState, newState: windowState});
    });
    win.on('unmaximize', function () { 
      // if (ignoreUnmaximize) {
      //   ignoreUnmaximize = false;
      //   return;
      // }
      // if (lastSize.width !== null) {
      //   win.resizeTo(lastSize.width, lastSize.height);
      //   lastSize.width = null;
      // }
      windowState = 'normal';
      dispatchEvent('windowStateChange', {oldState: 'maximize', newState: 'normal'});
    });
    
    var ignoreResize = false;
    window.addEventListener('resize', function () {
      if (ignoreResize) {
        ignoreResize = false;
        return;
      } else {
        ignoreResize = true;
      }
      lastCapturedSize.setSize();
      if (win.height >= window.screen.availHeight &&
        win.width >= window.screen.availWidth && 
        windowState !== 'maximize') {
        // fix bug: 最大化
        var oldState = windowState;
        windowState = 'maximize';
        dispatchEvent('windowStateChange', {oldState: oldState, newState: windowState});
      } else if (window.innerHeight < window.screen.availHeight &&
        window.innerWidth < window.screen.availWidth &&
        windowState === 'maximize') {
        // fix bug: 取消最大化
        if (lastSize.width !== null) {
          win.resizeTo(lastSize.width, lastSize.height);
          lastSize.width = null;
        }
        windowState = 'normal';
        dispatchEvent('windowStateChange', {oldState: 'maximize', newState: 'normal'});
      } else {
      }
    });

    // window bounds
    Object.defineProperty(_methods, 'bounds', {
      get: function () {
        return {
          x: win.x,
          y: win.y,
          width: win.width,
          height: win.height
        };
      },
      set: function (obj) {
        win.resizeTo(obj.width, obj.height);
        win.moveTo(obj.x, obj.y);
      }
    });

    // window lastSize
    Object.defineProperty(_methods, 'lastSize', {
      get: function () {
        return lastCapturedSize.getSize();
      }
    });

    // notify
    _methods.notify = function (attention) {
      win.requestAttention(attention === undefined?true:attention);
    };

    var gui = require('nw.gui');
    // tray
    var hasTray = false;
    _methods.getTray = function (opt) {
      if (!hasTray) {
        hasTray = new gui.Tray(opt);
        return hasTray;
      }
      return hasTray;
    };

    // menu
    _methods.createMenu = function (opt) {
      return new gui.Menu(opt);
    };
    _methods.createMenuItem = function (opt) {
      return new gui.MenuItem(opt);
    };

    this.$get = [function () {

      // open window
      _methods.open = function (url, options) {
        options = options || {};      
        var _win = (require('nw.gui').Window.open(url, {
          "title": options.title || '',
          "icon": options.icon || undefined,
          "toolbar": false,
          "frame": false,
          "min_width": 400,
          "min_height": 300,
          "height": options.windowHeight || 260,
          "width": options.windowWidth || 400,
          "show": false
        }));

        _win.on('loaded', function () {
          _win.window.opener = window;
        });
      };

      return _methods;
    }];
  }]);
