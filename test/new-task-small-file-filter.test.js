'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const read = (path) => fs.readFileSync(path, 'utf8');

const tests = [];
const test = (name, fn) => tests.push({name, fn});

const loadConstants = function () {
    const constants = {};
    const module = {
        constant: function (name, value) {
            constants[name] = value;
            return module;
        }
    };

    vm.runInNewContext(read('src/scripts/config/constants.js'), {
        angular: {
            module: function () {
                return module;
            }
        }
    });

    return constants;
};

const loadSettingService = function (storedOptions) {
    let factoryDefinition;
    let savedOptions = storedOptions;
    const constants = loadConstants();
    const module = {
        factory: function (name, definition) {
            factoryDefinition = definition;
            return module;
        }
    };
    const angular = {
        module: function () {
            return module;
        },
        isArray: Array.isArray,
        isDefined: function (value) {
            return typeof value !== 'undefined';
        },
        isUndefined: function (value) {
            return typeof value === 'undefined';
        },
        isFunction: function (value) {
            return typeof value === 'function';
        },
        extend: function (target) {
            for (let i = 1; i < arguments.length; i++) {
                Object.assign(target, arguments[i]);
            }
            return target;
        }
    };

    vm.runInNewContext(read('src/scripts/services/ariaNgSettingService.js'), {
        angular: angular,
        console: console
    });

    const dependencies = {
        '$window': {navigator: {language: 'en'}},
        '$location': {
            protocol: function () { return 'http'; },
            host: function () { return 'localhost'; }
        },
        '$filter': function () {},
        'ariaNgConstants': constants.ariaNgConstants,
        'ariaNgDefaultOptions': constants.ariaNgDefaultOptions,
        'ariaNgLanguages': {en: {aliases: ['en']}},
        'ariaNgCommonService': {
            base64Decode: function (value) { return value; },
            generateUniqueId: function () { return 'test-id'; }
        },
        'ariaNgLogService': {info: function () {}, warn: function () {}},
        'ariaNgStorageService': {
            isLocalStorageSupported: function () { return true; },
            isCookiesSupported: function () { return false; },
            get: function () { return savedOptions; },
            set: function (key, value) {
                savedOptions = value;
                return true;
            },
            clearAll: function () {}
        }
    };
    const names = factoryDefinition.slice(0, -1);
    const factory = factoryDefinition[factoryDefinition.length - 1];
    const service = factory.apply(null, names.map(function (name) {
        return dependencies[name];
    }));

    return {
        service: service,
        getSavedOptions: function () { return savedOptions; }
    };
};

const loadTaskService = function (changeOption) {
    let factoryDefinition;
    const module = {
        factory: function (name, definition) {
            factoryDefinition = definition;
            return module;
        }
    };

    vm.runInNewContext(read('src/scripts/services/aria2TaskService.js'), {
        angular: {
            module: function () {
                return module;
            }
        },
        decodeURI: decodeURI
    });

    const dependencies = {
        '$q': {},
        'bittorrentPeeridService': {},
        'ariaNgConstants': {},
        'aria2Errors': {},
        'aria2RpcService': {changeOption: changeOption},
        'ariaNgCommonService': {},
        'ariaNgLocalizationService': {},
        'ariaNgLogService': {},
        'ariaNgSettingService': {}
    };
    const names = factoryDefinition.slice(0, -1);
    const factory = factoryDefinition[factoryDefinition.length - 1];

    return factory.apply(null, names.map(function (name) {
        return dependencies[name];
    }));
};

test('defines safe small-file filter defaults and queue storage key', function () {
    const constants = loadConstants();

    assert.strictEqual(constants.ariaNgConstants.btFileFilterQueueStorageKey, 'BtFileFilterQueue');
    assert.strictEqual(constants.ariaNgDefaultOptions.btFileFilterEnabled, false);
    assert.strictEqual(constants.ariaNgDefaultOptions.btFileFilterMinSizeMb, 100);
});

test('persists enabled state and a valid integer threshold', function () {
    const context = loadSettingService({language: 'en'});

    context.service.setBtFileFilterEnabled(true);
    context.service.setBtFileFilterMinSizeMb(256);

    assert.strictEqual(context.service.getBtFileFilterEnabled(), true);
    assert.strictEqual(context.service.getBtFileFilterMinSizeMb(), 256);
    assert.strictEqual(context.getSavedOptions().btFileFilterMinSizeMb, 256);
});

test('rejects invalid thresholds without replacing the saved value', function () {
    const context = loadSettingService({language: 'en', btFileFilterMinSizeMb: 100});

    [0, 1.5, 102401, 'abc'].forEach(function (value) {
        context.service.setBtFileFilterMinSizeMb(value);
        assert.strictEqual(context.service.getBtFileFilterMinSizeMb(), 100);
    });
});

test('builds an RPC identity without storing alias or secret', function () {
    const context = loadSettingService({
        language: 'en', protocol: 'https', rpcHost: 'aria2.local', rpcPort: '6800',
        rpcInterface: 'jsonrpc', rpcAlias: 'private', secret: 'encoded-secret'
    });

    assert.strictEqual(context.service.getCurrentRpcIdentity(), 'https|aria2.local|6800|jsonrpc');
});

test('supports atomic task options and per-task pause overrides', function () {
    const rpcSource = read('src/scripts/services/aria2RpcService.js');
    const taskSource = read('src/scripts/services/aria2TaskService.js');

    assert(rpcSource.includes('angular.isDefined(task.pauseOnAdded)'));
    assert(taskSource.includes('changeTaskOptions: function (gid, options, callback, silent)'));
    assert(taskSource.includes('options: options'));
});

test('sends multiple task options in one RPC call', function () {
    let lastChangeOption;
    const callback = function () {};
    const rpcResult = {};
    const service = loadTaskService(function (context) {
        lastChangeOption = {
            gid: context.gid,
            options: Object.assign({}, context.options),
            silent: context.silent,
            callback: context.callback
        };
        return rpcResult;
    });

    const result = service.changeTaskOptions('gid-1', {
        'select-file': '2,4',
        'bt-remove-unselected-file': 'true'
    }, callback, true);

    assert.deepStrictEqual(lastChangeOption.options, {
        'select-file': '2,4',
        'bt-remove-unselected-file': 'true'
    });
    assert.strictEqual(lastChangeOption.gid, 'gid-1');
    assert.strictEqual(lastChangeOption.silent, true);
    assert.strictEqual(lastChangeOption.callback, callback);
    assert.strictEqual(result, rpcResult);
});

let failed = 0;

tests.forEach(function (item) {
    try {
        item.fn();
        console.log('PASS ' + item.name);
    } catch (error) {
        failed++;
        console.error('FAIL ' + item.name);
        console.error(error.stack || error.message);
    }
});

if (failed > 0) {
    console.error(failed + ' test(s) failed');
    process.exit(1);
}

console.log(tests.length + ' test(s) passed');
