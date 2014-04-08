'use strict';

(function () {
  
  var Promise = require('./js/promise'),
      path    = require('path');
  angular.module('fileDialog', [])
    .provider('fileDialog', [function () {

        var selectFile = document.createElement('input'),
            selectFiles = document.createElement('input'),
            selectDir = document.createElement('input'),
            saveFile = document.createElement('input');
        selectFile.type = 'file';
        selectFiles.type = 'file';
        selectDir.type = 'file';
        saveFile.type = 'file';
        selectFiles.setAttribute('multiple', '');
        selectDir.setAttribute('nwdirectory', '');
        saveFile.setAttribute('nwsaveas', '');
        selectFiles.style.display = 'none';
        selectFile.style.display = 'none';
        selectDir.style.display = 'none';
        saveFile.style.display = 'none';

        var f = document.createDocumentFragment();
        f.appendChild(selectFiles);
        f.appendChild(selectFile);
        f.appendChild(selectDir);
        f.appendChild(saveFile);
        document.body.appendChild(f);

        var _methods = {};

        // select file
        var lastSelectedPath;
        function selectFileHandler() {
          var files = selectFile.files;
          selectFile.deferred.resolve(files[0]);
          lastSelectedPath = path.dirname(files[0].path);
          selectFile.files = [];
          selectFile.value = '';
        }
        _methods.selectFile = function (defaultPath) {
          selectFile.deferred = new Promise;
          if (defaultPath || lastSelectedPath) {
            selectFile.setAttribute('nwworkingdir', defaultPath || lastSelectedPath);
          }

          selectFile.addEventListener('change', selectFileHandler, false);
          selectFile.click();
          $(window).one('focus', function (evt) {
            if (selectFile.deferred.state === 'pending') {
              selectFile.deferred.reject();
            }
            selectFile.removeEventListener('change', selectFileHandler, false);
          });

          return selectFile.deferred.protect;
        };
        function selectDirHandler() {
          var files = selectDir.files;
          selectDir.deferred.resolve(files[0]);
          lastSelectedPath = path.dirname(files[0].path);
          selectDir.files = [];
          selectDir.value = '';
        }
        _methods.selectDir = function (defaultPath) {
          selectDir.deferred = new Promise;
          if (defaultPath || lastSelectedPath) {
            selectDir.setAttribute('nwworkingdir', defaultPath || lastSelectedPath);
          }

          selectDir.addEventListener('change', selectDirHandler, false);
          selectDir.click();
          $(window).one('focus', function (evt) {
            if (selectDir.deferred.state === 'pending') {
              selectDir.deferred.reject();
            }
            selectDir.removeEventListener('change', selectDirHandler, false);
          });

          return selectDir.deferred.protect;
        };
        function saveFileHandler() {
          var files = saveFile.files;
          saveFile.deferred.resolve(files[0]);
          lastSelectedPath = path.dirname(files[0].path);
          saveFile.files = [];
          saveFile.value = '';
        }
        _methods.saveFile = function (defaultName, defaultPath) {
          saveFile.deferred = new Promise;
          if (defaultName) {
            console.log(saveFile);
            saveFile.setAttribute('nwsaveas', defaultName);
          }
          if (defaultPath || lastSelectedPath) {
            saveFile.setAttribute('nwworkingdir', defaultPath || lastSelectedPath);
          }

          saveFile.addEventListener('change', saveFileHandler, false);
          saveFile.click();
          $(window).one('focus', function (evt) {
            if (saveFile.deferred.state === 'pending') {
              saveFile.deferred.reject('canceled');
            }
            saveFile.removeEventListener('change', selectDirHandler, false);
          });

          return saveFile.deferred.protect;
        };


        this.$get = function () {
          return _methods;
        };

      }]);
})();