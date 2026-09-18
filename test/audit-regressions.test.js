'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
process.chdir(path.resolve(__dirname, '..'));
const read = (file) => fs.readFileSync(file, 'utf8');
const noop = () => {};
const log = {debug: noop, info: noop, warn: noop, error: noop};
const angular = {
    isArray: Array.isArray,
    isDefined: (value) => value !== undefined,
    isUndefined: (value) => value === undefined,
    isFunction: (value) => typeof value === 'function',
    isString: (value) => typeof value === 'string',
    isObject: (value) => value !== null && typeof value === 'object',
    fromJson: JSON.parse,
    toJson: JSON.stringify,
    copy: (value) => JSON.parse(JSON.stringify(value)),
    extend: Object.assign,
    bind: (owner, fn) => fn.bind(owner),
    forEach: (items, fn) => items.forEach(fn),
    noop: noop
};

function loadFactory(file, dependencies) {
    let definition;
    const module = {factory: (name, value) => { definition = value; return module; }};
    vm.runInNewContext(read(file), {angular: Object.assign({}, angular, {module: () => module})});
    return definition[definition.length - 1](...definition.slice(0, -1).map((name) => dependencies[name]));
}

const tests = [];
const test = (name, fn) => tests.push({name, fn});

function loadSettingService(stored) {
    let saved = stored;
    return {service: loadFactory('src/scripts/services/ariaNgSettingService.js', {
        '$window': {navigator: {language: 'en'}},
        '$location': {protocol: () => 'http', host: () => 'localhost'}, '$filter': noop,
        ariaNgConstants: {optionStorageKey: 'options'}, ariaNgDefaultOptions: {},
        ariaNgLanguages: {en: {aliases: ['en']}}, ariaNgLogService: log,
        ariaNgCommonService: {base64Decode: (value) => value, generateUniqueId: () => 'id'},
        ariaNgStorageService: {isLocalStorageSupported: () => true, isCookiesSupported: () => false,
            get: () => saved, set: (key, value) => { saved = value; return true; }}
    })};
}

function trackedQ() {
    const deferreds = [];
    return {
        deferreds,
        defer: () => {
            const promise = {then: () => promise};
            const deferred = {promise, resolved: false, rejected: false,
                resolve: () => { deferred.resolved = true; },
                reject: () => { deferred.rejected = true; }};
            deferreds.push(deferred);
            return deferred;
        }
    };
}

test('never replays a rejected queued write after reconnect using the real websocket dependency', function () {
    const definitions = {};
    const module = {
        factory: (name, definition) => { definitions[name] = definition; return module; },
        service: () => module
    };
    vm.runInNewContext(read('node_modules/angular-websocket/dist/angular-websocket.js'), {
        angular: Object.assign({}, angular, {module: () => module}),
        window: {WebSocket: function () {}}, console: {log: noop}
    });
    const sockets = [];
    const timers = [];
    const timeout = (callback) => { timers.push(callback); return callback; };
    const q = trackedQ();
    const backend = {create: () => {
        const socket = {readyState: 0, bufferedAmount: 0, sent: [],
            send: (message) => socket.sent.push(JSON.parse(message)),
            close: () => {
                if (socket.readyState !== 3) {
                    socket.readyState = 3;
                    socket.onclose({code: 1006});
                }
            }};
        sockets.push(socket);
        return socket;
    }};
    const definition = definitions.$websocket;
    const websocket = definition[definition.length - 1]({$digest: noop}, q, timeout, backend);
    const service = loadFactory('src/scripts/services/aria2WebSocketRpcService.js', {
        '$q': q, '$websocket': websocket, '$timeout': timeout,
        ariaNgConstants: {}, ariaNgLogService: log,
        ariaNgSettingService: {
            getCurrentRpcUrl: () => 'ws://audit.invalid/jsonrpc',
            getWebSocketReconnectInterval: () => 500
        }
    });
    let failures = 0;
    let successes = 0;
    service.request({uniqueId: 'audit-add', requestBody: {id: 'audit-add',
        method: 'aria2.addUri', params: [['magnet:?xt=urn:btih:' + 'a'.repeat(40)], {'pause-metadata': 'true'}]},
    errorCallback: () => failures++, successCallback: () => successes++});
    sockets[0].close();
    timers.shift()(); // App rejects pending requests and initiates reconnect.
    assert.strictEqual(failures, 1);
    timers.shift()(); // Dependency creates the replacement socket.
    sockets[1].readyState = 1;
    sockets[1].onopen({}); // The dependency must have no rejected write left to flush.
    assert.strictEqual(sockets[1].sent.length, 0);
    sockets[1].onmessage({data: JSON.stringify({id: 'audit-add', result: 'new-gid'})});
    assert.strictEqual(successes, 0);
    service.request({uniqueId: 'fresh', requestBody: {id: 'fresh', method: 'aria2.getVersion'},
        errorCallback: noop, successCallback: () => successes++});
    assert.strictEqual(sockets[1].sent.length, 1);
    sockets[1].onmessage({data: JSON.stringify({id: 'fresh', result: {version: 'test'}})});
    assert.strictEqual(successes, 1);
});

test('keeps queue identity and actual transport aligned until reload', function () {
    const setting = loadSettingService({language: 'en', protocol: 'http', rpcHost: 'a.invalid',
        rpcPort: '6800', rpcInterface: 'jsonrpc', httpMethod: 'POST'}).service;
    const requests = [];
    const service = loadFactory('src/scripts/services/aria2HttpRpcService.js', {
        '$http': (request) => { requests.push(request); return {then: () => ({catch: noop})}; },
        ariaNgConstants: {}, ariaNgCommonService: {}, ariaNgLogService: log,
        ariaNgSettingService: setting
    });
    setting.updateRpcSetting({isDefault: true, protocol: 'http', rpcHost: 'b.invalid',
        rpcPort: '6800', rpcInterface: 'jsonrpc'}, 'rpcHost');
    service.request({requestBody: {method: 'aria2.tellStatus', params: ['b-job']}});
    assert.strictEqual(setting.getCurrentRpcIdentity(), 'http|a.invalid|6800|jsonrpc');
    const reloaded = loadSettingService(setting.getAllOptions()).service;
    assert.strictEqual(reloaded.getCurrentRpcIdentity(), 'http|b.invalid|6800|jsonrpc');
    assert.strictEqual(requests[0].url, 'http://a.invalid:6800/jsonrpc');
});

function taskService(rpc, q) {
    return loadFactory('src/scripts/services/aria2TaskService.js', {
        '$q': q || trackedQ(), bittorrentPeeridService: {}, ariaNgConstants: {defaultPathSeparator: '/'},
        aria2Errors: {}, aria2RpcService: rpc || {}, ariaNgLogService: log,
        ariaNgCommonService: {countArray: (items, value) => items.filter((item) => item === value).length},
        ariaNgLocalizationService: {getLocalizedText: (text) => text}, ariaNgSettingService: {}
    });
}

test('renders reserved object-property names as ordinary torrent directories', function () {
    const service = taskService();
    for (const directory of ['constructor', '__proto__', 'toString']) {
        const task = {gid: 'tree', dir: '/downloads', status: 'active',
            bittorrent: {mode: 'multi', info: {name: 'bundle'}},
            files: [{index: '1', path: '/downloads/bundle/' + directory + '/data.bin',
                length: '10', completedLength: '0', selected: 'true'}]};
        service.processDownloadTasks([task], true);
        assert.strictEqual(task.files[0].nodeName, directory);
        assert.strictEqual(task.files[1].fileName, 'data.bin');
    }
});

test('settles a retry when multicall contains a missing-task fault', function () {
    let respond;
    const q = trackedQ();
    const service = taskService({tellStatus: () => ({}), getOption: () => ({}),
        multicall: (context) => { respond = context.callback; }}, q);
    let callbackCalled = false;
    service.retryTask('deleted', (response) => { callbackCalled = true; assert.strictEqual(response.success, false); });
    respond({success: true, data: [
        {code: 1, message: 'GID deleted is not found'},
        {code: 1, message: 'GID deleted is not found'}
    ]});
    assert.strictEqual(callbackCalled, true);
    assert.strictEqual(q.deferreds[0].resolved, false);
    assert.strictEqual(q.deferreds[0].rejected, true);
});

test('retries each batch item once and finishes only after all input items settle', async function () {
    const q = {defer: () => {
        const deferred = {};
        deferred.promise = new Promise((resolve, reject) => {
            deferred.resolve = resolve;
            deferred.reject = reject;
        });
        return deferred;
    }};
    const service = taskService({}, q);
    const calls = [];
    service.retryTask = (gid, callback) => {
        calls.push(gid);
        const success = gid !== 'second';
        callback({success});
        return success ? Promise.resolve() : Promise.reject(new Error('retry failed'));
    };
    let summary;
    let callsAtSummary;
    await service.retryTasks(['first', 'second', 'third'].map((gid) => ({gid})), (response) => {
        summary = response;
        callsAtSummary = calls.slice();
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(calls, ['first', 'second', 'third']);
    assert.deepStrictEqual(callsAtSummary, ['first', 'second', 'third']);
    assert.strictEqual(summary.successCount, 2);
    assert.strictEqual(summary.failedCount, 1);
});

(async function () {
    let failed = 0;
    for (const item of tests) {
        try {
            await item.fn();
            console.log('PASS ' + item.name);
        } catch (error) {
            failed++;
            console.error('FAIL ' + item.name);
            console.error(error.stack || error);
        }
    }
    process.exitCode = failed ? 1 : 0;
    console.log(tests.length + ' tests, ' + failed + ' failed');
})();
