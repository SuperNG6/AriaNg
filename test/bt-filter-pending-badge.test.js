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

// Loads ariaNgBtFileFilterService with a seeded job queue and configurable RPC identity.
// jobsSeed: array of raw job objects (will be sanitized by the service).
// rpcIdentity: the identity getCurrentRpcIdentity() returns.
const loadBtFileFilterService = function (jobsSeed, rpcIdentity) {
    let savedQueue = Array.isArray(jobsSeed) ? jobsSeed : [];
    let currentRpcIdentity = rpcIdentity || 'http|localhost|6800|jsonrpc';
    let factoryDefinition;
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

    const intervalsCreated = [];
    const intervalsCancelled = [];
    const timeoutsCreated = [];

    const intervalFn = function (callback, delay) {
        const handle = {callback: callback, delay: delay};
        intervalsCreated.push(handle);
        return handle;
    };
    intervalFn.cancel = function (handle) {
        intervalsCancelled.push(handle);
        return true;
    };

    const dependencies = {
        '$interval': intervalFn,
        '$timeout': function (callback, delay) {
            const handle = {callback: callback, delay: delay};
            timeoutsCreated.push(handle);
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
            getCurrentRpcIdentity: function () { return currentRpcIdentity; },
            setCurrentRpcIdentity: function (identity) { currentRpcIdentity = identity; }
        },
        'ariaNgNotificationService': {
            notifyInPage: function () {}
        },
        'ariaNgLogService': {info: function () {}, warn: function () {}},
        'aria2TaskService': {
            getTaskStatus: function () {},
            getTaskOptions: function () {},
            changeTaskOptions: function () {},
            startTasks: function () {},
            getTaskList: function () {}
        }
    };

    const names = factoryDefinition.slice(0, -1);
    const factory = factoryDefinition[factoryDefinition.length - 1];
    const service = factory.apply(null, names.map(function (name) {
        return dependencies[name];
    }));

    return {
        service: service,
        setRpcIdentity: function (identity) { currentRpcIdentity = identity; },
        getIntervalsCreated: function () { return intervalsCreated; },
        getIntervalsCancelled: function () { return intervalsCancelled; }
    };
};

const makeJob = function (overrides) {
    return Object.assign({
        rpcIdentity: 'http|localhost|6800|jsonrpc',
        rootGid: 'root-1',
        childGid: '',
        thresholdBytes: 1048576,
        startAfterFilter: false,
        sourceType: 'magnet',
        stage: 'waiting-metadata',
        retryCount: 0,
        originalRemoveUnselectedFile: null,
        createdAt: 1000,
        updatedAt: 1000,
        missingRootScanCount: 0,
        terminalChildScanCount: 0
    }, overrides || {});
};

test('getPendingGidStageMap excludes terminal jobs', function () {
    const context = loadBtFileFilterService([
        makeJob({rootGid: 'root-done-1', stage: 'completed-filtered'}),
        makeJob({rootGid: 'root-done-2', stage: 'completed-full'}),
        makeJob({rootGid: 'root-done-3', stage: 'completed-fallback', childGid: 'child-done-3'}),
        makeJob({rootGid: 'root-waiting', stage: 'waiting-files', childGid: 'child-waiting'})
    ]);

    const map = context.service.getPendingGidStageMap();

    assert.strictEqual(map['root-waiting'], 'waiting-files');
    assert.strictEqual(map['child-waiting'], 'waiting-files');
    assert.ok(!map.hasOwnProperty('root-done-1'));
    assert.ok(!map.hasOwnProperty('root-done-2'));
    assert.ok(!map.hasOwnProperty('root-done-3'));
    assert.ok(!map.hasOwnProperty('child-done-3'));
    assert.strictEqual(Object.keys(map).length, 2);
});

test('getPendingGidStageMap scopes to the current RPC', function () {
    const rpcA = 'http|a|6800|jsonrpc';
    const rpcB = 'http|b|6800|jsonrpc';
    const context = loadBtFileFilterService([
        makeJob({rpcIdentity: rpcA, rootGid: 'root-a', stage: 'waiting-files'}),
        makeJob({rpcIdentity: rpcB, rootGid: 'root-b', stage: 'applying-filter'})
    ], rpcA);

    const map = context.service.getPendingGidStageMap();

    assert.strictEqual(map['root-a'], 'waiting-files');
    assert.ok(!map.hasOwnProperty('root-b'));

    context.setRpcIdentity(rpcB);
    const mapB = context.service.getPendingGidStageMap();
    assert.strictEqual(mapB['root-b'], 'applying-filter');
    assert.ok(!mapB.hasOwnProperty('root-a'));
});

test('getPendingGidStageMap maps both childGid and rootGid when childGid is set', function () {
    const context = loadBtFileFilterService([
        makeJob({rootGid: 'r1', childGid: 'c1', stage: 'applying-filter'})
    ]);

    const map = context.service.getPendingGidStageMap();

    assert.strictEqual(map['r1'], 'applying-filter');
    assert.strictEqual(map['c1'], 'applying-filter');
});

test('getPendingGidStageMap maps only rootGid when childGid is empty', function () {
    const context = loadBtFileFilterService([
        makeJob({rootGid: 'r2', childGid: '', stage: 'waiting-metadata'})
    ]);

    const map = context.service.getPendingGidStageMap();

    assert.strictEqual(map['r2'], 'waiting-metadata');
    assert.ok(!map.hasOwnProperty(''));
    assert.strictEqual(Object.keys(map).length, 1);
});

test('getPendingGidStageMap returns an empty object when there are no pending jobs', function () {
    const context = loadBtFileFilterService([
        makeJob({rootGid: 'root-x', stage: 'completed-filtered'}),
        makeJob({rootGid: 'root-y', stage: 'completed-fallback'})
    ]);

    const map = context.service.getPendingGidStageMap();

    assert.strictEqual(Object.keys(map).length, 0);
});

test('getPendingGidStageMap returns a fresh object on each call', function () {
    const context = loadBtFileFilterService([
        makeJob({rootGid: 'r3', childGid: 'c3', stage: 'waiting-files'})
    ]);

    const first = context.service.getPendingGidStageMap();
    first['r3'] = 'mutated';
    first['injected'] = 'evil';

    const second = context.service.getPendingGidStageMap();

    assert.strictEqual(second['r3'], 'waiting-files');
    assert.strictEqual(second['c3'], 'waiting-files');
    assert.ok(!second.hasOwnProperty('injected'));
    assert.strictEqual(Object.keys(second).length, 2);
});

test('sanitizeJob rejects malformed jobs so getPendingGidStageMap never sees them', function () {
    const context = loadBtFileFilterService([
        makeJob({rootGid: 'good', stage: 'applying-filter'}),
        {stage: 'waiting-metadata'}, // missing rpcIdentity / rootGid -> rejected
        null,
        {rpcIdentity: 'http|localhost|6800|jsonrpc', rootGid: 'bad', stage: 'evil-stage'} // evil stage -> rejected
    ]);

    const map = context.service.getPendingGidStageMap();

    assert.strictEqual(map['good'], 'applying-filter');
    assert.strictEqual(Object.keys(map).length, 1);
});

test('start registers a polling interval that stop cancels and resets status to idle', function () {
    const context = loadBtFileFilterService([
        makeJob({rootGid: 'r-waiting', stage: 'waiting-files', childGid: 'c-waiting'})
    ]);

    context.service.start();
    const created = context.getIntervalsCreated();
    assert.strictEqual(created.length, 1);
    assert.strictEqual(context.getIntervalsCancelled().length, 0);
    // a pending job makes the active status visible
    assert.strictEqual(context.service.getStatus().visible, true);

    context.service.stop();

    assert.strictEqual(context.getIntervalsCancelled().length, 1);
    assert.strictEqual(context.getIntervalsCancelled()[0], created[0]);
    assert.strictEqual(context.service.getStatus().visible, false);
    assert.strictEqual(context.service.getStatus().type, 'idle');
});

test('stop allows start to be re-invoked after an RPC disconnect', function () {
    const context = loadBtFileFilterService([
        makeJob({rootGid: 'r-resume', stage: 'waiting-files', childGid: 'c-resume'})
    ]);

    context.service.start();
    const firstInterval = context.getIntervalsCreated()[0];
    context.service.stop();
    assert.strictEqual(context.getIntervalsCancelled()[0], firstInterval);

    // After stop, start() must create a fresh interval again (not short-circuit).
    context.service.start();
    const secondInterval = context.getIntervalsCreated()[1];
    assert.ok(secondInterval && secondInterval !== firstInterval);
    assert.strictEqual(context.getIntervalsCancelled().length, 1);
    assert.strictEqual(context.service.getStatus().visible, true);

    context.service.stop();
});

test('start is idempotent and stop is a no-op when never started', function () {
    const context = loadBtFileFilterService([
        makeJob({rootGid: 'r-idem', stage: 'waiting-files', childGid: 'c-idem'})
    ]);

    context.service.start();
    context.service.start();
    assert.strictEqual(context.getIntervalsCreated().length, 1);

    context.service.stop();
    context.service.stop();
    assert.strictEqual(context.getIntervalsCancelled().length, 1);
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