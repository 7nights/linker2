'use strict';

(function () {

var dirWatcher = require('./js/dirwatcher');

angular.module('Linker.controllers', []).
  controller('GlobalCtrl', ['$scope', 'storage', 'fileDialog', 'ModManager', 'windowManager', function($scope, storage, fileDialog, modManager, windowManager) {
    require('nw.gui').Window.get().showDevTools();
    // vars
    $scope.syncFolder = '';

    // init application
    function getRandomStr(len) {
      var s = 'abcdefghijklmnopqrstuvwxyz!@#$%^&*()[]1234567890';
      var result = [];
      while (result.length < len) {
        result.push(s[Math.round(Math.random() * s.length)]);
      }
      return result.join('');
    }
    if (!storage.get('appInitialized', false)) {
      // read config
      var config = require('./js/config.json');
      // generate uid
      config.uid === '' && (config.uid = getRandomStr(16));
      require('fs').writeFileSync('./js/config.json', JSON.stringify(config));
      location.hash = 'step1';
    } else if (storage.get('syncFolder', false) === false){
      // the sync folder has not been set
      location.hash = 'step1';
    } else {
      location.hash = 'step2';
    }

    // events
    $scope.exit = function () {
      windowManager.close();
    };
    $scope.back = function () {
      history.back();
    };
  }])
  .controller('NavCtrl', ['$scope', function ($scope) {

  }])
  .controller('Step1Ctrl', ['$scope', 'fileDialog', 'ModManager', 'storage', function ($scope, fileDialog, modManager, storage) {

    // events
    $scope.selectFolder = function () {
      fileDialog.selectDir()
        .done(function (path) {
          location.hash = 'step2';
          storage.set('syncFolder', path.path);

          $scope.$parent.syncFolder = path.path;
          $scope.$parent.$digest();
        });
    };
  }])
  .controller('Step2Ctrl', ['$scope', '$rootScope', 'windowManager', 'ModManager', 'storage', function ($scope, $rootScope, windowManager, modManager, storage) {
    // initialize
    var 
      linker      = require('./js/core'),
      syncHandler = require('./js/synchandler'),
      utils       = require('./js/utils'),
      server      = linker.createServer(),
      clients     = {},
      hasSignedIn = false;

    (function() {
      // load device address records
      var addr = storage.get('devicesaddr', []);
      if (addr.length > 0) syncHandler.createClients(clients, addr);
    })();

    // events
    $scope.minimizeToTaskbar = function () {
      windowManager.hide();
      var tray = windowManager.getTray({
        title: 'Linker',
        icon: 'img/icon/logo.black.pixel.16.png',
        tooltip: 'Right click to open menu'
      });
      tray.tooltip = 'Right click to open menu';
      var menu = windowManager.createMenu();
      menu.append(windowManager.createMenuItem({label: '0 device(s) connected'}));
      menu.append(windowManager.createMenuItem({label: 'Add IP address', click: function () {
        windowManager.show();
        setTimeout(function () {
          window.location.hash = "ipaddress";
        }, 300);
      }}));
      menu.append(windowManager.createMenuItem({label: 'Exit', click: $scope.$parent.exit}));
      tray.menu = menu;
    };
    $rootScope.$on('Step2Ctrl.minimizeToTaskbar', $scope.minimizeToTaskbar);
    storage.watch('devicesaddr', function (oldValue, newValue) {
      syncHandler.createClients(clients, newValue);
    });

    modManager.addListener('load', function (mod) {
      if (mod !== 'step2') return;

      var syncFolder = storage.get('syncFolder');
      if (dirWatcher.isWatching(syncFolder)) return;

      /* syncFolder has not been being watched */
      dirWatcher.unwatchAll(); // only one folder is allowed to be watched at one time
      dirWatcher.watch(syncFolder, function (diff) {
        utils.log('LOG', diff);
        syncHandler.handleChange(server, diff);
        syncHandler.handleChange(clients, diff);
      });

      setInterval(function () {
        syncHandler.signIn(clients);
      }, 1000 * 60 * 10);
    });

    $scope.addIPAddress = function () {
      window.location.hash = "ipaddress";
    };
  }])
  .controller('IpaddressCtrl', ['$scope', 'storage', function ($scope, storage) {
    // initialize
    $scope.addresses = storage.get('devicesaddr', ['']);
    
    $scope.localAddr = [];
    var interfaces = require('os').networkInterfaces();
    for (var key in interfaces) {
      interfaces[key].forEach(function (val) {
        if (!val.internal && val.family === 'IPv4') $scope.localAddr.push(val.address);
      });
    }

    // functions
    function removeEmpty(arr) {
      var result = [];
      arr.forEach(function (val) {
        if (val !== '' && val !== undefined && val !== null) result.push(val);
      });
      return result;
    }

    // events
    $scope.addItem = function () {
      $scope.addresses.push('');
    };
    $scope.save = function () {
      storage.set('devicesaddr', removeEmpty($scope.addresses));
      $scope.$emit('Step2Ctrl.minimizeToTaskbar');
    };

  }]);
})();