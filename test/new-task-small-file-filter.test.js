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
    options = options || {};
    let factoryDefinition;
    let savedQueue = options.savedQueue;
    let rpcIdentity = options.rpcIdentity || 'http|localhost|6800|jsonrpc';
    const tasks = options.tasks || {};
    const taskOptions = options.taskOptions || {};
    const intervals = [];
    const timeouts = [];
    const changedOptions = [];
    const startedGids = [];
    const notifications = [];
    const statusGids = [];
    const pendingStatusCallbacks = [];
    const pendingOptionCallbacks = [];
    const pendingChangeCallbacks = [];
    const pendingStartCallbacks = [];
    const optionRpcIdentities = [];
    const changeRpcIdentities = [];
    const startRpcIdentities = [];
    const statusResponses = (options.statusResponses || []).slice();
    const optionResponses = (options.optionResponses || []).slice();
    const changeResponses = (options.changeResponses || []).slice();
    const startResponses = (options.startResponses || []).slice();
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
        '$interval': function (callback, delay) {
            const handle = {callback: callback, delay: delay};
            intervals.push(handle);
            return handle;
        },
        '$timeout': function (callback, delay) {
            const handle = {callback: callback, delay: delay};
            timeouts.push(handle);
            return handle;
        },
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
        'ariaNgNotificationService': {
            notifyInPage: function (title, content, notificationOptions) {
                notifications.push({title: title, content: content, options: notificationOptions});
            }
        },
        'ariaNgLogService': {warn: function () {}},
        'aria2TaskService': {
            getTaskStatus: function (gid, callback) {
                statusGids.push(gid);
                if (options.deferStatus) {
                    pendingStatusCallbacks.push({gid: gid, callback: callback});
                    return;
                }
                if (statusResponses.length > 0) {
                    callback(statusResponses.shift());
                } else if (tasks[gid]) {
                    callback({success: true, data: tasks[gid]});
                } else {
                    callback({success: false, data: {message: 'GID ' + gid + ' is not found'}});
                }
            },
            getTaskOptions: function (gid, callback) {
                optionRpcIdentities.push(rpcIdentity);
                const response = optionResponses.length > 0 ? optionResponses.shift() : {
                    success: true,
                    data: taskOptions[gid] || taskOptions
                };
                if (options.deferOptions) {
                    pendingOptionCallbacks.push({callback: callback, response: response});
                } else {
                    callback(response);
                }
            },
            changeTaskOptions: function (gid, rpcOptions, callback) {
                changeRpcIdentities.push(rpcIdentity);
                changedOptions.push({gid: gid, options: Object.assign({}, rpcOptions)});
                const response = changeResponses.length > 0 ? changeResponses.shift() : {success: true, data: 'OK'};
                const callNumber = changedOptions.length;
                const applyFailedChange = typeof options.applyFailedChanges === 'function' ?
                    options.applyFailedChanges(callNumber, rpcOptions) : options.applyFailedChanges;
                if ((response.success || applyFailedChange) && tasks[gid] && rpcOptions['select-file']) {
                    const selected = rpcOptions['select-file'].split(',');
                    tasks[gid].files.forEach(function (file) {
                        file.selected = selected.indexOf(String(file.index)) >= 0 ? 'true' : 'false';
                    });
                    const targetOptions = taskOptions[gid] || taskOptions;
                    Object.assign(targetOptions, rpcOptions);
                    if (options.normalizedSelectFile && rpcOptions['select-file']) {
                        targetOptions['select-file'] = options.normalizedSelectFile;
                    }
                }
                if (options.deferChange) {
                    pendingChangeCallbacks.push({callback: callback, response: response});
                } else {
                    callback(response);
                }
            },
            startTasks: function (gids, callback) {
                startRpcIdentities.push(rpcIdentity);
                startedGids.push.apply(startedGids, gids);
                const response = startResponses.length > 0 ? startResponses.shift() : {success: true, data: 'OK'};
                if (options.deferStart) {
                    pendingStartCallbacks.push({callback: callback, response: response});
                } else {
                    callback(response);
                }
            }
        }
    };
    const names = factoryDefinition.slice(0, -1);
    const factory = factoryDefinition[factoryDefinition.length - 1];
    const service = factory.apply(null, names.map(function (name) {
        return dependencies[name];
    }));

    return {
        service: service,
        changedOptions: changedOptions,
        startedGids: startedGids,
        notifications: notifications,
        statusGids: statusGids,
        optionRpcIdentities: optionRpcIdentities,
        changeRpcIdentities: changeRpcIdentities,
        startRpcIdentities: startRpcIdentities,
        intervals: intervals,
        timeouts: timeouts,
        setRpcIdentity: function (value) { rpcIdentity = value; },
        resolveStatus: function (response) {
            const pending = pendingStatusCallbacks.shift();
            pending.callback(response || {success: true, data: tasks[pending.gid]});
        },
        resolveOptions: function (response) {
            const pending = pendingOptionCallbacks.shift();
            pending.callback(response || pending.response);
        },
        resolveChange: function (response) {
            const pending = pendingChangeCallbacks.shift();
            pending.callback(response || pending.response);
        },
        resolveStart: function (response) {
            const pending = pendingStartCallbacks.shift();
            pending.callback(response || pending.response);
        },
        getSavedQueue: function () { return savedQueue || []; },
        tick: function () {
            intervals.forEach(function (interval) { interval.callback(); });
        },
        tickUntilIdle: function () {
            for (let i = 0; i < 30 && service.getJobs().some(function (job) {
                return job.rpcIdentity === rpcIdentity;
            }); i++) {
                intervals.forEach(function (interval) { interval.callback(); });
            }
        }
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

test('requires the HTTP URL path to end in torrent', function () {
    const service = loadFilterService().service;

    assert.strictEqual(service.isBtMetadataUrl('https://host/file.iso?next=.torrent?token=1'), false);
    assert.strictEqual(service.isBtMetadataUrl('https://host/file.iso#fake.torrent'), false);
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
    context.service.start();
    assert.strictEqual(context.intervals.length, 1);
});

test('follows metadata child, filters mixed files, enables cleanup, and starts Download Now', function () {
    const context = loadFilterService({
        tasks: {
            root: {gid: 'root', status: 'complete', followedBy: ['child']},
            child: {gid: 'child', status: 'paused', bittorrent: {mode: 'multi'}, files: [
                {index: '1', length: '1048576', selected: 'true'},
                {index: '2', length: '209715200', selected: 'true'}
            ]}
        },
        taskOptions: {'bt-remove-unselected-file': 'false'}
    });

    context.service.enqueue('root', {thresholdBytes: 104857600, startAfterFilter: true, sourceType: 'magnet'});
    context.service.start();
    context.tickUntilIdle();

    assert.deepStrictEqual(context.changedOptions, [{
        gid: 'child',
        options: {'select-file': '2', 'bt-remove-unselected-file': 'true'}
    }]);
    assert.deepStrictEqual(context.startedGids, ['child']);
    assert.strictEqual(context.getSavedQueue().length, 0);
});

test('all-small and all-large plans skip option changes and start Download Now', function () {
    const cases = [
        [{index: '1', length: '1', selected: 'true'}, {index: '2', length: '2', selected: 'true'}],
        [{index: '1', length: '209715200', selected: 'true'}, {index: '2', length: '314572800', selected: 'true'}]
    ];

    cases.forEach(function (files) {
        const context = loadFilterService({tasks: {
            task: {gid: 'task', status: 'paused', bittorrent: {mode: 'multi'}, files: files}
        }});
        context.service.enqueue('task', {thresholdBytes: 104857600, startAfterFilter: true, sourceType: 'torrent'});
        context.service.start();
        context.tickUntilIdle();

        assert.deepStrictEqual(context.changedOptions, []);
        assert.deepStrictEqual(context.startedGids, ['task']);
        assert.strictEqual(context.getSavedQueue().length, 0);
    });
});

test('Download Later never starts a successfully filtered task', function () {
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '209715200', selected: 'true'}
        ]}},
        taskOptions: {'bt-remove-unselected-file': 'false'}
    });
    context.service.enqueue('task', {thresholdBytes: 104857600, startAfterFilter: false, sourceType: 'torrent'});
    context.service.start();
    context.tickUntilIdle();

    assert.strictEqual(context.changedOptions.length, 1);
    assert.deepStrictEqual(context.startedGids, []);
    assert.strictEqual(context.getSavedQueue().length, 0);
});

test('three failed filter calls restore full selection and cleanup before fallback start', function () {
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '209715200', selected: 'true'}
        ]}},
        taskOptions: {'bt-remove-unselected-file': 'false'},
        changeResponses: [
            {success: false, data: {message: 'network'}},
            {success: false, data: {message: 'network'}},
            {success: false, data: {message: 'network'}},
            {success: true, data: 'OK'}
        ]
    });
    context.service.enqueue('task', {thresholdBytes: 104857600, startAfterFilter: true, sourceType: 'torrent'});
    context.service.start();
    context.tickUntilIdle();

    assert.strictEqual(context.changedOptions.length, 4);
    assert.deepStrictEqual(context.changedOptions[3], {
        gid: 'task',
        options: {'select-file': '1,2', 'bt-remove-unselected-file': 'false'}
    });
    assert.deepStrictEqual(context.startedGids, ['task']);
    assert.strictEqual(context.service.getStatus().type, 'warning');
    assert.strictEqual(context.notifications.length, 1);
    assert.strictEqual(context.notifications[0].options.type, 'warning');
    assert.strictEqual(context.timeouts[0].delay, 10000);
});

test('tellStatus network failure retains the job without consuming filter retries', function () {
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: []}},
        statusResponses: [{success: false, data: {message: 'Network Error'}}]
    });
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'});
    context.service.start();
    context.tick();

    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].retryCount, 0);
    assert.strictEqual(context.changedOptions.length, 0);
});

test('explicit not-found response removes a user-deleted job silently', function () {
    const context = loadFilterService({statusResponses: [{
        success: false, data: {message: 'GID deadbeef is not found'}
    }]});
    context.service.enqueue('deadbeef', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'});
    context.service.start();
    context.tick();

    assert.strictEqual(context.getSavedQueue().length, 0);
    assert.strictEqual(context.notifications.length, 0);
});

test('jobs for another RPC identity remain stored and unprocessed', function () {
    const foreignJob = {
        rpcIdentity: 'http|other|6800|jsonrpc', rootGid: 'foreign', childGid: '',
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet',
        stage: 'waiting-metadata', retryCount: 0, originalRemoveUnselectedFile: null
    };
    const context = loadFilterService({savedQueue: [foreignJob]});
    context.service.start();
    context.tick();

    assert.deepStrictEqual(context.statusGids, []);
    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].rootGid, 'foreign');
});

test('start is idempotent and restored queues expose resuming status before processing', function () {
    const restoredJob = {
        rpcIdentity: 'http|localhost|6800|jsonrpc', rootGid: 'root', childGid: '',
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet',
        stage: 'waiting-metadata', retryCount: 0, originalRemoveUnselectedFile: null
    };
    const context = loadFilterService({savedQueue: [restoredJob], tasks: {
        root: {gid: 'root', status: 'active', files: []}
    }});
    const statusObject = context.service.getStatus();

    context.service.start();
    context.service.start();

    assert.strictEqual(context.intervals.length, 1);
    assert.strictEqual(context.service.getStatus(), statusObject);
    assert.strictEqual(statusObject.type, 'resuming');
    assert.strictEqual(statusObject.textKey, 'format.bt-file-filter.resuming');
    assert.strictEqual(statusObject.textParams.count, 1);
});

test('polling never overlaps while a task status request is pending', function () {
    const context = loadFilterService({deferStatus: true, tasks: {
        root: {gid: 'root', status: 'active', files: []}
    }});
    context.service.enqueue('root', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'});
    context.service.start();

    context.tick();
    context.tick();
    assert.deepStrictEqual(context.statusGids, ['root']);

    context.resolveStatus();
    context.tick();
    assert.deepStrictEqual(context.statusGids, ['root', 'root']);
});

test('metadata waiting has no timeout and remains visible', function () {
    const context = loadFilterService({tasks: {
        root: {gid: 'root', status: 'active', files: []}
    }});
    context.service.enqueue('root', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'});
    context.service.start();

    for (let i = 0; i < 40; i++) {
        context.tick();
    }

    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].stage, 'waiting-metadata');
    assert.strictEqual(context.service.getStatus().type, 'waiting');
    assert.strictEqual(context.service.getStatus().textKey, 'format.bt-file-filter.waiting');
    assert.strictEqual(context.service.getStatus().textParams.count, 1);
});

test('successful filtering shows a stable complete summary and auto-hides after five seconds', function () {
    const context = loadFilterService({tasks: {task: {
        gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]
    }}, taskOptions: {'bt-remove-unselected-file': 'false'}});
    const statusObject = context.service.getStatus();
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.start();
    context.tickUntilIdle();

    assert.strictEqual(context.service.getStatus(), statusObject);
    assert.strictEqual(statusObject.type, 'complete');
    assert.strictEqual(statusObject.textKey, 'format.bt-file-filter.complete');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(statusObject.textParams)), {filtered: 1, full: 0});
    assert.strictEqual(context.timeouts[0].delay, 5000);
    context.timeouts[0].callback();
    assert.strictEqual(statusObject.visible, false);
});

test('reconciles a lost filter response without consuming another filter attempt', function () {
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}},
        taskOptions: {'bt-remove-unselected-file': 'false'},
        changeResponses: [{success: false, data: {message: 'connection closed'}}],
        applyFailedChanges: true
    });
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.start();
    context.tickUntilIdle();

    assert.strictEqual(context.changedOptions.length, 1);
    assert.strictEqual(context.service.getStatus().filtered, 1);
    assert.strictEqual(context.service.getStatus().fallback, 0);
    assert.strictEqual(context.getSavedQueue().length, 0);
});

test('reconciles a lost restoration response and keeps Download Later paused', function () {
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}},
        taskOptions: {'bt-remove-unselected-file': 'true'},
        changeResponses: [
            {success: false, data: {message: 'failure 1'}},
            {success: false, data: {message: 'failure 2'}},
            {success: false, data: {message: 'failure 3'}},
            {success: false, data: {message: 'lost restore response'}}
        ],
        applyFailedChanges: function (callNumber) { return callNumber === 4; },
        normalizedSelectFile: '1-2'
    });
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.start();
    context.tickUntilIdle();

    assert.strictEqual(context.changedOptions.length, 4);
    assert.deepStrictEqual(context.changedOptions[3].options, {
        'select-file': '1,2', 'bt-remove-unselected-file': 'true'
    });
    assert.deepStrictEqual(context.startedGids, []);
    assert.strictEqual(context.service.getStatus().fallback, 1);
    assert.strictEqual(context.getSavedQueue().length, 0);
});

test('switching RPC identity starts a separate aggregate batch', function () {
    const makeJob = function (rpcIdentity, gid) {
        return {
            rpcIdentity: rpcIdentity, rootGid: gid, childGid: '', thresholdBytes: 100,
            startAfterFilter: false, sourceType: 'torrent', stage: 'waiting-metadata',
            retryCount: 0, originalRemoveUnselectedFile: null
        };
    };
    const context = loadFilterService({
        rpcIdentity: 'rpc-a',
        savedQueue: [makeJob('rpc-a', 'a'), makeJob('rpc-b', 'b')],
        tasks: {
            a: {gid: 'a', status: 'paused', bittorrent: {}, files: [{index: '1', length: '200', selected: 'true'}]},
            b: {gid: 'b', status: 'paused', bittorrent: {}, files: [{index: '1', length: '200', selected: 'true'}]}
        }
    });
    context.service.start();
    context.tick();
    assert.strictEqual(context.service.getStatus().full, 1);

    context.setRpcIdentity('rpc-b');
    context.tick();

    assert.strictEqual(context.service.getStatus().total, 1);
    assert.strictEqual(context.service.getStatus().processed, 1);
    assert.strictEqual(context.service.getStatus().full, 1);
    assert.strictEqual(context.getSavedQueue().length, 0);
});

test('enqueue after an RPC switch counts stored and new jobs once', function () {
    const storedJob = {
        rpcIdentity: 'rpc-b', rootGid: 'stored', childGid: '', thresholdBytes: 100,
        startAfterFilter: false, sourceType: 'torrent', stage: 'waiting-metadata',
        retryCount: 0, originalRemoveUnselectedFile: null
    };
    const context = loadFilterService({rpcIdentity: 'rpc-a', savedQueue: [storedJob]});
    context.service.start();
    context.setRpcIdentity('rpc-b');

    context.service.enqueue('new', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});

    assert.strictEqual(context.service.getStatus().total, 2);
    assert.strictEqual(context.getSavedQueue().length, 2);
});

test('notifies once when fallback completes even while other metadata is waiting', function () {
    const context = loadFilterService({
        tasks: {
            failed: {gid: 'failed', status: 'paused', bittorrent: {}, files: [
                {index: '1', length: '1', selected: 'true'},
                {index: '2', length: '200', selected: 'true'}
            ]},
            waiting: {gid: 'waiting', status: 'active', files: []}
        },
        taskOptions: {'bt-remove-unselected-file': 'false'},
        changeResponses: [
            {success: false, data: {message: 'failure 1'}},
            {success: false, data: {message: 'failure 2'}},
            {success: false, data: {message: 'failure 3'}},
            {success: true, data: 'OK'}
        ]
    });
    context.service.enqueue('failed', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.enqueue('waiting', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'magnet'});
    context.service.start();

    for (let i = 0; i < 10; i++) {
        context.tick();
    }

    assert.strictEqual(context.notifications.length, 1);
    assert.strictEqual(context.notifications[0].options.type, 'warning');
    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].rootGid, 'waiting');
});

test('a metadata-waiting job does not block later ready jobs', function () {
    const context = loadFilterService({tasks: {
        waiting: {gid: 'waiting', status: 'active', files: []},
        ready: {gid: 'ready', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '200', selected: 'true'}
        ]}
    }});
    context.service.enqueue('waiting', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'magnet'});
    context.service.enqueue('ready', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.start();

    context.tick();
    context.tick();

    assert.deepStrictEqual(context.statusGids, ['waiting', 'ready']);
    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].rootGid, 'waiting');
});

test('RPC switch after tellStatus does not continue the A job against B', function () {
    const context = loadFilterService({rpcIdentity: 'rpc-a', deferStatus: true, tasks: {
        task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}
    }, taskOptions: {'bt-remove-unselected-file': 'false'}});
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'torrent'});
    context.service.start();
    context.tick();

    context.setRpcIdentity('rpc-b');
    context.resolveStatus();

    assert.deepStrictEqual(context.optionRpcIdentities, []);
    assert.deepStrictEqual(context.changeRpcIdentities, []);
    assert.deepStrictEqual(context.startRpcIdentities, []);
    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].stage, 'waiting-metadata');
});

test('RPC switch after getOption does not change the A job against B', function () {
    const context = loadFilterService({rpcIdentity: 'rpc-a', deferOptions: true, tasks: {
        task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}
    }, taskOptions: {'bt-remove-unselected-file': 'false'}});
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'torrent'});
    context.service.start();
    context.tick();

    context.setRpcIdentity('rpc-b');
    context.resolveOptions();

    assert.deepStrictEqual(context.optionRpcIdentities, ['rpc-a']);
    assert.deepStrictEqual(context.changeRpcIdentities, []);
    assert.deepStrictEqual(context.startRpcIdentities, []);
    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].stage, 'waiting-metadata');
});

test('RPC switch after changeOption does not start or remove the A job against B', function () {
    const context = loadFilterService({rpcIdentity: 'rpc-a', deferChange: true, tasks: {
        task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}
    }, taskOptions: {'bt-remove-unselected-file': 'false'}});
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'torrent'});
    context.service.start();
    context.tick();

    context.setRpcIdentity('rpc-b');
    context.resolveChange();

    assert.deepStrictEqual(context.changeRpcIdentities, ['rpc-a']);
    assert.deepStrictEqual(context.startRpcIdentities, []);
    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].stage, 'applying-filter');
});

test('RPC switch after unpause does not remove the A job from B callback context', function () {
    const context = loadFilterService({rpcIdentity: 'rpc-a', deferStart: true, tasks: {
        task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '200', selected: 'true'}
        ]}
    }});
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'torrent'});
    context.service.start();
    context.tick();

    context.setRpcIdentity('rpc-b');
    context.resolveStart();

    assert.deepStrictEqual(context.startRpcIdentities, ['rpc-a']);
    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].stage, 'starting-full');
});

test('restoration reconciliation preserves a present falsy cleanup value', function () {
    const job = {
        rpcIdentity: 'rpc-a', rootGid: 'task', childGid: '', thresholdBytes: 100,
        startAfterFilter: false, sourceType: 'torrent', stage: 'restoring-full',
        retryCount: 3, originalRemoveUnselectedFile: '', restoreAttempted: true,
        allIndexes: [1, 2], selectedIndexes: [2]
    };
    const context = loadFilterService({rpcIdentity: 'rpc-a', savedQueue: [job], tasks: {
        task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}
    }, taskOptions: {'select-file': '1,2', 'bt-remove-unselected-file': ''}});
    context.service.start();
    context.tick();

    assert.deepStrictEqual(context.changedOptions, []);
    assert.strictEqual(context.getSavedQueue().length, 0);
    assert.strictEqual(context.service.getStatus().fallback, 1);
});

test('switching to an RPC identity without jobs clears the previous toolbar status', function () {
    const context = loadFilterService({rpcIdentity: 'rpc-a'});
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'magnet'});
    context.service.start();
    assert.strictEqual(context.service.getStatus().visible, true);

    context.setRpcIdentity('rpc-b');
    context.tick();

    assert.strictEqual(context.service.getStatus().visible, false);
    assert.strictEqual(context.service.getStatus().type, 'idle');
    assert.strictEqual(context.service.getStatus().total, 0);
});

test('deleting the last queued job after prior completion settles the complete summary', function () {
    const context = loadFilterService({tasks: {
        completed: {gid: 'completed', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '200', selected: 'true'}
        ]}
    }});
    context.service.enqueue('completed', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.enqueue('deleted', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'magnet'});
    context.service.start();
    context.tick();
    context.tick();

    assert.strictEqual(context.getSavedQueue().length, 0);
    assert.strictEqual(context.service.getStatus().type, 'complete');
    assert.strictEqual(context.service.getStatus().textKey, 'format.bt-file-filter.complete');
    assert.strictEqual(context.service.getStatus().processed, 1);
    assert.strictEqual(context.service.getStatus().total, 1);
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
