'use strict';

/* Filters */

angular.module('Linker.filters', []).
  filter('interpolate', ['version', function(version) {
    return function(text) {
      return String(text).replace(/\%VERSION\%/mg, version);
    }
  }])
  .filter('join', [function () {
    return function (arr, sep) {
      return arr.join(sep);
    }
  }]);
