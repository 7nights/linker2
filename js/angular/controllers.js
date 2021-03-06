'use strict';

(function () {

var dirWatcher = require('./js/dirwatcher');

angular.module('Linker.controllers', []).
  controller('GlobalCtrl', ['$scope', 'storage', 'fileDialog', 'ModManager', 'windowManager', function($scope, storage, fileDialog, modManager, windowManager) {
    require('nw.gui').Window.get().showDevTools();
    // vars
    $scope.syncFolder = storage.get('syncFolder', '');

    // init application
    function getRandomStr(len) {
      var s = 'abcdefghijklmnopqrstuvwxyz!@#$%^&*()[]1234567890';
      var result = [];
      while (result.length < len) {
        result.push(s[Math.round(Math.random() * s.length)]);
      }
      return result.join('');
    }

    setTimeout(function () {

      if (!storage.get('appInitialized', false)) {
        // read config
        var config = require('./js/config.json');
        // generate uid
        config.uid === '' && (config.uid = getRandomStr(16));
        require('fs').writeFileSync('./js/config.json', JSON.stringify(config));
        location.hash = 'step1';
        storage.set('appInitialized', true);
      } else if (storage.get('password', '') === '') {
        location.hash = 'createSecret';
      } else if ($scope.syncFolder === '') {
        // the sync folder has not been set
        location.hash = 'step1';
      } else {
        location.hash = 'step2';
      }
    }, 2000);

    // events
    $scope.exit = function () {
      windowManager.close();
    };
    $scope.back = function () {
      history.back();
    };
    $scope.jump = function (hash) {
      location.hash = hash;
    };
  }])
  .controller('NavCtrl', ['$scope', function ($scope) {

  }])
  .controller('CreateSecretCtrl', ['$scope', 'storage', function ($scope, storage) {

    // events
    $scope.createSecret = function () {
      storage.set('password', require('./js/utils').md5($scope.password, 'hex'));
      if (storage.get('syncFolder', '') === '') return location.hash = 'step1';
      else return location.hash = 'step2';
    };
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
  .controller('Step2Ctrl', ['$scope', '$rootScope', 'windowManager', 'ModManager', 'storage', 'sharedObject', function ($scope, $rootScope, windowManager, modManager, storage, sharedObject) {
    // initialize
    var 
      linker      = require('./js/core'),
      syncHandler = require('./js/synchandler'),
      utils       = require('./js/utils'),
      server      = linker.createServer(),
      clients     = sharedObject.get('clients'),
      hasSignedIn = false;

    // functions
    function loadClientsFromLocalList() {
      // load device address records
      var addr = storage.get('devicesaddr', []);
      if (addr.length > 0) syncHandler.createClients(clients, addr);
    }

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
        syncHandler.broadcastChange(server, diff);
        syncHandler.broadcastChange(clients, diff);
      });

      loadClientsFromLocalList();

      setInterval(function () {
        syncHandler.signIn(clients);
      }, 1000 * 60 * 10);
    });

    $scope.addIPAddress = function () {
      window.location.hash = "ipaddress";
    };
  }])
  .controller('IpaddressCtrl', ['$scope', 'storage', 'sharedObject', function ($scope, storage, sharedObject) {
    var syncHandler = require('./js/synchandler'),
        clients     = sharedObject.get('clients');

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
    $scope.ifSuccess = function (addr) {
      addr = 'device:/' + addr;
      return clients[addr] && clients[addr].linker && clients[addr].linker.handshaked;
    };

    $scope.reconnect = function (addr) {
      syncHandler.createClients(clients, [addr], true);
      clients['device:/' + addr].once('lstatechange', function (sold) {
        if (sold === 'waitForHandshakeResponse') $scope.$digest();
      });
    };
    $scope.getStatus = function (addr) {
      addr = 'device:/' + addr;
      if (clients[addr] && clients[addr].lstate) {

        return clients[addr].lstate.name;
      }
      return '';
    };


  }]);
})();