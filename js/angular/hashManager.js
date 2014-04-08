'use strict';


  /**
   * HashManager 提供对地址中的hash的控制
   */
  angular.module('HashManager', []).provider('HashManager', function(){
    var listeners = [];
    var other = null,
        currentArgs = {},
        disableHandler = false;

    this.addListener = function(url, fn, priority){
      if(priority === undefined){
        priority = 0;
      }
      var partReg = /:([^\/]*)/g,
      result = partReg.exec(url),
      args = [];
      while(result !== null){
        args.push(result[1]);
        result = partReg.exec(url);
      }
      var urlReg = url.replace(partReg, "([^\/]*)");
      var obj = {
        "urlReg" : "^" + urlReg + "$",
        "args" : args,
        "function" : fn,
        "priority" : priority
      };
      var flag = false;
      for(var i = 0, length = listeners.length; i < length; i++){
        if(listeners[i].priority < priority){
          listeners.splice(i, 0, obj);
          flag = true;
        }
      }
      if(!flag) listeners.push(obj);
      return this;
    };
    this.other = function(fn){
      other = fn;
    };
    this.slience = function() {
      disableHandler = true;
    };
    this.$get = function(){
      var self = this;
      return {
        /**
         * @param {String} url 关注的地址
         * @param {Function} fn 回调函数
         * @param {Number} priority 优先级
         */
        addListener: function(a, b, c){
          self.addListener(a, b, c);
          return this;
        },
        /**
         * 获取当前地址中的参数(地址必须先注册), 例如注册地址"article/:articleId", 在访问
         "#article/325" 时即可获得{articleId: "325"}
         * @return {Object} 地址中的参数
         */
        getArgs: function(){

          return currentArgs;
        },
        /**
         * 注册一个默认监听器, 当遇到一个没有被侦听的地址时, 将会调用这个监听器
         * @param {Function} fn 回调函数
         */
        other: self.other,
        slience: function(){
          disableHandler = true;
        }
      };
    };

    var loadTriggered = false;
    var handleHash = function(e){
      console.log('handleHash', disableHandler, location.href);
      if (!loadTriggered) loadTriggered = true;
      if(disableHandler) return disableHandler = false;
      for(var i = 0, length = listeners.length; i < length; i++){
        var reg = new RegExp(listeners[i]["urlReg"]),
        hash = window.location.hash;
        if(hash[0] === '#') hash = hash.substr(1);
        var result = hash.match(reg);
        if(result !== null){
          var args = {};
          for(var j = 1; j <= listeners[i]["args"].length; j++){
            args[listeners[i]["args"][j - 1]] = result[j];
          }
          currentArgs = args;
          listeners[i]["function"](args);
          return;
        }
      }
      if(other !== null){
        currentArgs = [];
        other();
      }
    };
    window.addEventListener("hashchange", handleHash);
    window.addEventListener("load", function (e) {
      if (!loadTriggered) handleHash(e);
    });
  })
  .provider('ModManager', ['HashManagerProvider', function ModManager(HashManager) {
        var currentMod = null,
        DEFAULT_ANIMATION = function (leaving, coming, unload, after) {

          if (leaving === coming) {
            unload();
            after();
            return;
          }

          var l_ele = document.getElementById("mod-" + leaving),
          c_ele = document.getElementById("mod-" + coming);
          $('#mod-' + leaving).css({'-webkit-transform': 'translateX(-50px)', 'opacity': 0});
          $('#mod-' + leaving)[0].addEventListener('transitionend', handleTransitionEnd, false);
          function handleTransitionEnd() {
            $('#mod-' + leaving)[0].removeEventListener('transitionend', handleTransitionEnd, false);
            $('#mod-' + coming)[0].style.WebkitTransition = 'none';
            $('#mod-' + coming).css({'opacity': 0, 'z-index': 2, '-webkit-transform': 'translateX(50px)'});
            setTimeout(function () {
               $('#mod-' + coming)[0].style.removeProperty('-webkit-transition');
              setTimeout(function () {
                $('#mod-' + leaving).css({'z-index': '1', '-webkit-transform': 'translateX(0px)', opacity: 0});
                $('#mod-' + coming).css({'-webkit-transform': 'translateX(0px)', opacity: 1, 'z-index': 2});
                document.getElementById('mod-' + coming).style.removeProperty('-webkit-transform');
                unload();
              }, 0);
            }, 0);
            
            setTimeout(function () {after();}, 500);
            
          };
        };

        var switching = false,
            pending = false;

        var before_listeners = [],
        after_listeners      = [],
        unload_listeners     = [],
        start_listeners      = [],
        leaving_listeners    = [],
        load_listeners       = [],
        getListeners = function(type){
          switch(type){
            case "before":
              return before_listeners;
            case "after":
              return after_listeners;
            case "unload":
              return unload_listeners;
            case 'start':
              return start_listeners;
            case 'leaving':
              return leaving_listeners;
            case 'load':
              return load_listeners;
          }
          return null;
        },
        doListeners = function(type, mod){
          var _listeners = getListeners(type);
          var stop = false;
          for(var i = _listeners.length; i--;){
            stop = _listeners[i](mod);

            if (type === 'start' && stop) {
              return stop;
            }
          }
        },
        enter = function(mod, animation){
          console.log('enter mode: %c' + mod, 'color:red');

          if (switching !== false) {
            pending = mod;
            return;
          }
          switching = true;
          /*
          if(mod === self.initMod){
            currentMod = mod;
            self.initMod = null;
            return;
          } */
          var back = doListeners('start', mod);
          if (back) {
            //HashManager.slience();
            location.hash = back;
            switching = false;
            if (pending) {
              enter(pending);
            }
            return;
          }
          if (1) {

            if (currentMod === null) currentMod = self.initMod;
            
            if (typeof animation !== 'function') {
              animation = DEFAULT_ANIMATION;
            }
            doListeners("before", mod);
            doListeners("leaving", currentMod);
            if (self.firstLoad) {
              self.firstLoad = false;

              currentMod = mod;
              switching = false;
              if (pending) {
                enter(pending);
                pending = false;
              }
              //document.getElementById("mod-" + self.initMod).style.display = "none";
              document.getElementById("mod-" + mod).style.display = "block";
              document.getElementById("mod-" + mod).style.opacity = "1";
              document.getElementById("mod-" + mod).style.zIndex = "2";
              doListeners("after", mod);
              return;
            }
            //document.body.style.overflow = "hidden";
            animation(currentMod, mod, function () {
              doListeners("unload", currentMod);
              doListeners("load", mod);
            }, function(){
              doListeners("after", mod);
              document.body.style.overflow = "auto";
              currentMod = mod;
              switching = false;
              if (pending) {
                enter(pending);
                pending = false;
              }
            });
          }
        };

        var self = this;
        this.initMod = null;
        this.firstLoad = true;
        this.enter = enter;
        this.data = null;
        this.$get = function(){
          return {
            /** 
             * 进入一个mod, 在HTML中一个mod需要以mod-[mod名字]作为id, 例: mod-signIn
             * @param {String} mod 要进入的mod名
             * @param {Function} animation 动画函数, 负责处理mod消失与出现。接受3个参数：当前mod名，切换到的mod名，动画执行完毕后需要调用的回调函数。
             */
            enter: enter,
            /**
             * 3个事件: before(正要向某个mod切换), after(已经切换到某个mod), unload(某个mod被卸载)
             */
            addListener: function(type, fn){
              var _listener = getListeners(type);
              _listener.push(fn);
            },
            removeListener: function(type, fn){
              var _listener = getListeners(type);
              for(var i = _listener.length; i--;){
                if(_listener[i] === fn){
                  _listener.splice(i, 1);
                  return true;
                }
              }
              return false;
            },
            get currentMod(){
              return currentMod;
            },
            set initMod(val){
              self.initMod = val;
            },
            setData: function (data){
              self.data = data;
            },
            getData: function (){
              return self.data;
            }
          };
        };
      }]);
