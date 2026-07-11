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

const loadFilterService = function (options) {
    let factoryDefinition;
    let savedQueue = options && options.savedQueue;
    const rpcIdentity = options && options.rpcIdentity || 'http|localhost|6800|jsonrpc';
    const constants = loadConstants();
    const module = {
        factory: function (name, definition) {
            factoryDefinition = definition;
            return module;
        }
    };

    vm.runInNewContext(read('src/scripts/services/ariaNgBtFileFilterService.js'), {
        angular: {
            module: function () {
                return module;
            }
        }
    });

    const dependencies = {
        '$interval': function () {},
        '$timeout': function () {},
        'ariaNgConstants': constants.ariaNgConstants,
        'ariaNgStorageService': {
            get: function () { return savedQueue; },
            set: function (key, value) {
                assert.strictEqual(key, constants.ariaNgConstants.btFileFilterQueueStorageKey);
                savedQueue = value;
                return true;
            }
        },
        'ariaNgSettingService': {
            getCurrentRpcIdentity: function () { return rpcIdentity; }
        },
        'ariaNgNotificationService': {},
        'ariaNgLogService': {},
        'aria2TaskService': {}
    };
    const names = factoryDefinition.slice(0, -1);
    const factory = factoryDefinition[factoryDefinition.length - 1];
    const service = factory.apply(null, names.map(function (name) {
        return dependencies[name];
    }));

    return {
        service: service,
        getSavedQueue: function () { return savedQueue; }
    };
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

test('recognizes supported BT metadata inputs only', function () {
    const service = loadFilterService().service;

    assert.strictEqual(service.isBtMetadataUrl('magnet:?xt=urn:btih:abc'), true);
    assert.strictEqual(service.isBtMetadataUrl('https://host/file.torrent?token=1'), true);
    assert.strictEqual(service.isBtMetadataUrl('https://host/file.iso'), false);
    assert.strictEqual(service.isBtMetadataUrl('ftp://host/file.torrent'), false);
});

test('filters only mixed-size file lists with strict threshold semantics', function () {
    const service = loadFilterService().service;
    const mb = 1024 * 1024;

    assert.deepStrictEqual(JSON.parse(JSON.stringify(service.planFiles([
        {index: '1', length: String(99 * mb)},
        {index: '2', length: String(100 * mb)},
        {index: '3', length: String(101 * mb)}
    ], 100 * mb))), {
        mode: 'filter', selectedIndexes: [2, 3], allIndexes: [1, 2, 3]
    });
    assert.strictEqual(service.planFiles([{index: '1', length: '1'}], 100 * mb).mode, 'full');
    assert.strictEqual(service.planFiles([{index: '1', length: String(101 * mb)}], 100 * mb).mode, 'full');
});

test('persists immutable jobs under the current RPC identity', function () {
    const context = loadFilterService({rpcIdentity: 'http|one|6800|jsonrpc'});
    const intent = {
        thresholdBytes: 104857600,
        startAfterFilter: true,
        sourceType: 'magnet'
    };

    context.service.enqueue('root-1', intent);
    intent.thresholdBytes = 1;

    const saved = context.getSavedQueue();
    assert.strictEqual(saved[0].rpcIdentity, 'http|one|6800|jsonrpc');
    assert.strictEqual(saved[0].rootGid, 'root-1');
    assert.strictEqual(saved[0].thresholdBytes, 104857600);
    assert.strictEqual(saved[0].stage, 'waiting-metadata');
});

test('rejects duplicate jobs and exposes a stable idle status object', function () {
    const context = loadFilterService();

    context.service.enqueue('root-1', {
        thresholdBytes: 104857600,
        startAfterFilter: false,
        sourceType: 'torrent'
    });
    context.service.enqueue('root-1', {
        thresholdBytes: 1,
        startAfterFilter: true,
        sourceType: 'magnet'
    });

    assert.strictEqual(context.service.getJobs().length, 1);
    assert.strictEqual(context.service.getStatus(), context.service.getStatus());
    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.service.getStatus())), {
        visible: false,
        type: 'idle',
        total: 0,
        processed: 0,
        waiting: 0,
        filtered: 0,
        full: 0,
        fallback: 0,
        textKey: '',
        textParams: {}
    });
    assert.strictEqual(context.service.start(), undefined);
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
