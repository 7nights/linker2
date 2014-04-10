'use strict';


// Declare app level module which depends on filters, and services
angular.module('Linker', [
  'HashManager',
  'fileDialog',
  'Linker.services',
  'Linker.controllers',
  'Linker.filters'
]).
  run( ['HashManager', 'ModManager', function (hashManager, modManager) {
    modManager.initMod = 'createSecret';
    hashManager
      .addListener('step1', function () {
        modManager.enter('step1');
      })
      .addListener('step2', function () {
        modManager.enter('step2');
      })
      .addListener('createSecret', function () {
        modManager.enter('createSecret');
      })
      .addListener('ipaddress', function () {
        modManager.enter('ipaddress');
      });
  }]);

