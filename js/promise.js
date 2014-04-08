'use strict';


var Promise = function () {
  var _state = 'pending',
    resolved = false,
    rejected = false,
    resolveValue,
    rejectValue,
    doneList = [],
    failList = [],
    thenList = [],
    _chains = [],
    chainsIndex = 0,
    slice = [].slice,
    promise = {
      get state() {
        return _state;
      },
      isPromise: true,
      resolve: function () {
        var args = slice.call(arguments);
        doneList.forEach(function (val) {
          val.apply(this, args);
        });
        resolveValue = args;
        resolved = true;
        _state = 'resolved';
        return this;
      },
      reject: function () {
        var args = slice.call(arguments);
        failList.forEach(function (val) {
          val.apply(this, args);
        });
        rejectValue = args;
        rejected = true;
        _state = 'rejected';
        return this;
      },
      done: function (callback) {
        if (resolved) {
          callback.apply(this.protect, resolveValue);
        } else {
          doneList.push(callback);
        }
        return promise;
      },
      fail: function (callback) {
        if (rejected) {
          callback.apply(this.protect, rejectValue);
        } else {
          failList.push(callback);
        }
        return promise;
      },
      /**
       * 队列模式的promise，此模式下所有的回调函数接收2个参数，第一个为一个新的promise，
       * 用于触发下一个then，第二个参数为调用此callback时传递来的参数
       * callback(promise, args)
       * example:
       * var deferred = new Promise();
       * deferred.protect
       *  .then(function (p, args) {
       *    setTimeout(function () { p.resolve('resolved!'); }, 1000);
       *  })
       *  .then(function (p, args) { console.log('it\'s my turn!')})
       *  .start();
       */
      then: function (successCallback, failCallback) {
        var newPromise = Promise();
        if (!this.ancient) {
          newPromise.ancient = this;
        } else {
          newPromise.ancient = this.ancient;
        }
        promise.done(function () {
          successCallback.apply(this, [newPromise].concat(slice.call(arguments)));
        });
        promise.fail(function () {
          failCallback && failCallback.apply(this, [newPromise].concat(slice.call(arguments)));
        });
        return newPromise;
      },
      /**
       * 开始一个由.then串起来的队列
       */
      start: function () {
        this.ancient.resolve(arguments);
      },
      get protect() {
        return protect;
      },
      /**
       * 管道模式的promise, 要求所有的回调函数都要返回一个promise实例
       * 例如我需要连续发起3个http请求, 每一个都必须在上一个请求之后
       * 函数 $http() 会返回一个promise
       * example:
       * $http(url1)
       *   .chains(function (arg1) {
       *     return $http(url2); // 把$http返回的promise返回到链中
       *   }, failCallbackHere)
       *   .chains(function (arg2) {
       *     return $http(url3);
       *   }, failCallbackHereAlsoShouldReturnAnInstanceOfPromise);
       * 
       */
      chains: function (successCallback, failCallback) {
        var self = this;
        _chains.push([successCallback, failCallback]);

        function handleNextDone() {
          if (chainsIndex < _chains.length) {
            var d = _chains[chainsIndex][0].apply(self, slice.call(arguments));
            chainsIndex++;
            d && d.constructor === Promise && d.done(handleNextDone);
            d && d.constructor === Promise && d.fail(handleNextFail);
          }
        }
        function handleNextFail() {
          if (chainsIndex < _chains.length) {
            var d = _chains[chainsIndex][1].apply(self, slice.call(arguments));
            chainsIndex++;
            d && d.constructor === Promise && d.done(handleNextDone);
            d && d.constructor === Promise && d.fail(handleNextFail);
          }
        }

        if (_chains.length === 1) {
          this.done(handleNextDone);
          this.fail(handleNextFail);
        }

        return this;
      }
    },
    protect = Object.create(promise);
  protect.resolve = protect.reject = undefined;
  promise.constructor = Promise;

  return promise;
};

module.exports = Promise;
