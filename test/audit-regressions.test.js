// 集中覆盖审计发现的跨模块边界；涉及底层队列的行为需保留真实依赖验证，不能只靠简化 stub。
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
    const timeout = (callback, delay) => {
        callback.delay = delay;
        timers.push(callback);
        return callback;
    };
    timeout.cancel = handle => { handle.cancelled = true; };
    const runNextTimer = () => {
        timers.sort((a, b) => (a.delay || 0) - (b.delay || 0));
        let timer;
        do { timer = timers.shift(); } while (timer && timer.cancelled);
        assert(timer, 'expected a pending timer');
        timer();
    };
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
        ariaNgConstants: {webSocketRequestTimeout: 20000}, ariaNgLogService: log,
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
    runNextTimer(); // App rejects pending requests and initiates reconnect.
    assert.strictEqual(failures, 1);
    runNextTimer(); // Dependency creates the replacement socket.
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

function loadBatchRpc(allOptions) {
    const requests = [];
    const transport = {on: noop, request: (context) => { requests.push(context); return Promise.resolve(); }};
    const service = loadFactory('src/scripts/services/aria2RpcService.js', {
        '$location': {path: () => '/new'}, '$q': {all: Promise.all.bind(Promise)},
        aria2RpcConstants: {rpcSystemServiceName: 'system', rpcServiceName: 'aria2', rpcServiceVersion: '2.0', rpcTokenPrefix: 'token:'},
        aria2RpcErrors: {}, aria2AllOptions: allOptions || {}, ariaNgLogService: log,
        ariaNgCommonService: {generateUniqueId: () => 'batch', showError: noop},
        ariaNgSettingService: {isCurrentRpcUseWebSocket: () => false, getCurrentRpcSecret: () => 'test-secret', getCurrentRpcDisplayName: () => 'test'},
        aria2HttpRpcService: transport
    });
    return {service, requests};
}

test('multicall preserves per-task context and success for BT filtering after partial failure', function () {
    const {service, requests} = loadBatchRpc();
    const tasks = [{options: {}, urls: ['magnet:?xt=test'], btFileFilterCandidate: true, pauseOnAdded: false},
        {options: {}, urls: ['https://example.invalid/file'], pauseOnAdded: true}];
    let summary;
    service.addUriMulti({tasks, callback: (response) => { summary = response; }});
    assert.strictEqual(requests.length, 1);
    const body = requests[0].requestBody;
    assert.strictEqual(body.method, 'system.multicall');
    assert.strictEqual(body.params.length, 1);
    assert.strictEqual(body.params[0][0].params[0], 'token:test-secret');
    assert.strictEqual(body.params[0][0].params[2].pause, undefined);
    assert.strictEqual(body.params[0][1].params[2].pause, 'true');
    requests[0].successCallback('batch', [['magnet-gid'], {code: 1, message: 'failed'}]);
    assert.strictEqual(summary.hasSuccess, true);
    assert.strictEqual(summary.hasError, true);
    assert.strictEqual(summary.results.length, 2);
    assert.strictEqual(summary.results[0].success, true);
    assert.strictEqual(summary.results[0].data, 'magnet-gid');
    assert.strictEqual(summary.results[0].context.task, tasks[0]);
    assert.strictEqual(summary.results[1].success, false);
    assert.strictEqual(summary.results[1].context.task, tasks[1]);
});

test('multicall reports all-fault and transport failures without claiming success', function () {
    for (const transportFailure of [false, true]) {
        const {service, requests} = loadBatchRpc();
        let summary;
        service.unpauseMulti({gids: ['one', 'two'], silent: true, callback: (response) => { summary = response; }});
        const fault = {code: 1, message: 'failed'};
        if (transportFailure) {
            requests[0].errorCallback('batch', fault);
        } else {
            requests[0].successCallback('batch', [fault, fault]);
        }
        assert.strictEqual(summary.hasSuccess, false);
        assert.strictEqual(summary.hasError, true);
        assert.strictEqual(summary.results.length, 2);
        assert.strictEqual(summary.results[1].context.gid, 'two');
    }
});

test('empty multicall settles without sending an RPC request', async function () {
    const {service, requests} = loadBatchRpc();
    let summary;
    await service.unpauseMulti({gids: [], callback: (response) => { summary = response; }});
    assert.strictEqual(requests.length, 0);
    assert.strictEqual(summary.hasSuccess, false);
    assert.strictEqual(summary.hasError, false);
    assert.strictEqual(summary.results.length, 0);
});

// 所有新建入口（含 /new 命令）都经过 RPC 层；清空的必填项不能作为 '' 发给 aria2，否则 dir 会落到 aria2 工作目录。
test('blank required options are dropped for every add request while optional blanks are kept', function () {
    const {service, requests} = loadBatchRpc({dir: {required: true}, 'max-download-limit': {required: true}, out: {}});
    service.addUri({task: {urls: ['https://example.invalid/file'],
        options: {dir: '  ', 'max-download-limit': '', out: '', split: '4'}}});
    assert.deepStrictEqual(requests[0].requestBody.params[2], {out: '', split: '4'});
    service.addUri({task: {urls: ['https://example.invalid/file'], options: {dir: '/data'}}});
    assert.deepStrictEqual(requests[1].requestBody.params[2], {dir: '/data'});
});

function loadHistoryService() {
    const storage = {};
    return {storage, service: loadFactory('src/scripts/services/aria2SettingService.js', {
        ariaNgConstants: {settingHistoryKeyPrefix: 'History', historyMaxStoreCount: 10},
        aria2AllOptions: {dir: {}}, aria2GlobalAvailableOptions: {}, aria2QuickSettingsAvailableOptions: {},
        aria2TaskAvailableOptions: {}, aria2RpcService: {}, ariaNgLogService: log,
        ariaNgStorageService: {get: (key) => storage[key], set: (key, value) => { storage[key] = value; return true; },
            keys: () => Object.keys(storage), remove: (key) => { delete storage[key]; }}
    })};
}

test('scoped path history never recommends another server path and only reads legacy history', function () {
    const {storage, service} = loadHistoryService();
    storage['History.dir'] = ['/legacy'];
    service.addSettingHistory('dir', '/mnt/a', 'rpc-a');
    // VM 上下文中的数组原型不同，比较前转为本地数组。
    assert.deepStrictEqual(Array.from(service.getScopedSettingHistory('dir', 'rpc-a')), ['/mnt/a']);
    assert.deepStrictEqual(Array.from(service.getScopedSettingHistory('dir', 'rpc-b')), ['/legacy']);
    assert.deepStrictEqual(Array.from(storage['History.dir']), ['/legacy']);
});

function loadHttpRpc(respond) {
    const setting = loadSettingService({language: 'en', protocol: 'http', rpcHost: 'a.invalid',
        rpcPort: '6800', rpcInterface: 'jsonrpc', httpMethod: 'POST'}).service;
    return loadFactory('src/scripts/services/aria2HttpRpcService.js', {
        '$http': respond, ariaNgConstants: {}, ariaNgCommonService: {}, ariaNgLogService: log,
        ariaNgSettingService: setting
    });
}

const httpContext = function (events, successCallback) {
    return {requestBody: {id: 'id', method: 'aria2.tellStatus'},
        successCallback: successCallback || function () { events.push('success'); },
        errorCallback: function (id, error) { events.push('error:' + error.message); },
        connectionSuccessCallback: function () { events.push('connected'); },
        connectionFailedCallback: function () { events.push('disconnected'); }};
};

// 业务回调的异常是程序错误，不能被当作连接失败，也不能让同一请求再以失败回调一次。
test('an exception thrown by an HTTP success callback is not reported as a connection failure', async function () {
    const events = [];
    const service = loadHttpRpc(() => Promise.resolve({data: {id: 'id', jsonrpc: '2.0', result: 'OK'}}));
    const result = service.request(httpContext(events, function () {
        events.push('success');
        throw new Error('callback bug');
    }));
    await result.then(noop, noop);
    assert.deepStrictEqual(events, ['connected', 'success']);
});

// 代理返回空响应体时调用方仍需收到结果，否则依赖回调恢复刷新的流程会永久停住。
test('an HTTP response without a JSON-RPC result or error still settles the request', async function () {
    const events = [];
    const service = loadHttpRpc(() => Promise.resolve({data: ''}));
    await service.request(httpContext(events)).then(noop, noop);
    assert.strictEqual(events.length, 1);
    assert.ok(/^error:/.test(events[0]), events.join(','));
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
