'use strict';
var fs = require('fs');
var config = {
    method: 'localStorage',
    namespace: 'settings'
};

var modified = {};
var cache;
var localStorage = window.localStorage;
exports.get = function (key, _default) {
    if (config.method === 'localStorage') {
        try {
            window.localStorage;
        } catch (e) {
            return _default !== undefined ? _default : null;
        }
        return JSON.parse(localStorage[config.namespace])[key];
    } else if (config.method === 'file') {
        if (!cache || key in modified) {
            cache = JSON.parse(fs.readFileSync(config.storagePath, {encoding: 'utf8'}));
            modified = {};
        }
        return cache[key] || _default;
    }
};
exports.set = function (key, value) {
    if (config.method === 'localStorage') {
        var obj = JSON.parse(localStorage[config.namespace]);
        obj[key] = value;
        localStorage[config.namespace] = JSON.stringify(obj);
    } else if (config.method === 'file') {
        cache[key] = value;
        fs.writeFile(config.storagePath, JSON.stringify(cache), function (err) {});
    }
}
exports.config = config;