'use strict';

function BlockQueue(maxLength) {
    this._queue = [];
    this._length = maxLength || -1;
    this._unfullListeners = [];
    this._unEmptyListeners = [];
}
BlockQueue.prototype = {
    put: function *(value) {
        if (this._length !== -1 && this._queue.length >= this._length) {
            yield this._waitForUnfull();
        }
        this._queue.push(value);
        var fn = this._unEmptyListeners.shift();
        typeof fn === 'function' && fn(null);
    },
    _waitForUnfull: function () {
        var self = this;
        return function (fn) {
            self._unfullListeners.push(fn);
        };
    },
    get: function *() {
        if (this._queue.length === 0) {
            yield this._waitForUnempty();
        }
        var val = this._queue.shift();
        var fn = this._unfullListeners.shift();
        typeof fn === 'function' && fn(null);
        return val;
    },
    _waitForUnempty: function () {
        var self = this;
        return function (fn) {
            self._unEmptyListeners.push(fn);
        };
    }
};

module.exports = BlockQueue;