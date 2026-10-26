// Keep the real controller, task/RPC services and persisted filter queue in one chain.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const noop = () => {};
const plain = (value) => JSON.parse(JSON.stringify(value));

function createSubmission(options = {}) {
    const definitions = {};
    const values = {};
    const requests = [];
    const storage = {};
    const paths = [];
    const module = {
        constant(name, value) { values[name] = value; return module; },
        factory(name, value) { definitions[name] = value; return module; },
        controller(name, value) { definitions[name] = value; return module; }
    };
    const context = vm.createContext({angular: {
        module: () => module, copy: plain, extend: Object.assign,
        isDefined: (value) => value !== undefined, isUndefined: (value) => value === undefined, isArray: Array.isArray,
        isString: (value) => typeof value === 'string'
    }});
    for (const file of ['config/constants.js', 'config/aria2RpcConstants.js',
        'services/aria2RpcService.js', 'services/aria2TaskService.js',
        'services/ariaNgBtFileFilterService.js', 'controllers/new.js']) {
        vm.runInContext(fs.readFileSync(path.join(root, 'src/scripts', file), 'utf8'), context, {filename: file});
    }
    let intent = {enabled: options.enabled !== false, thresholdBytes: 104857600};
    const scope = {getBtFileFilterIntent: () => intent};
    const transport = {on: noop, request: (request) => { requests.push(request); return Promise.resolve(); }};
    Object.assign(values, {
        '$scope': scope, '$rootScope': {swipeActions: {}},
        '$location': {search: () => ({}), path: (value) => { if (value) { paths.push(value); } return '/new'; }},
        '$q': {all: (items) => Promise.all(items)}, '$timeout': noop, '$interval': noop,
        bittorrentPeeridService: {}, aria2AllOptions: {}, aria2Errors: {},
        ariaNgLogService: {info: noop, error: noop, warn: noop, debug: noop},
        ariaNgCommonService: {generateUniqueId: () => 'batch', showError: noop,
            parseUrlsFromOriginInput: (value) => value.split('\n')},
        ariaNgSettingService: {
            getCurrentRpcIdentity: () => 'http|test.invalid|6800|jsonrpc',
            isCurrentRpcUseWebSocket: () => false, getCurrentRpcSecret: () => 'test-secret',
            getCurrentRpcDisplayName: () => 'test',
            getAfterCreatingNewTask: () => options.afterCreating || 'task-list'
        },
        aria2SettingService: {getNewTaskOptionKeys: () => [], getSpecifiedOptions: () => ({}),
            getScopedSettingHistory: () => [],
            addSettingHistory: noop},
        ariaNgStorageService: {get: (key) => storage[key], set: (key, value) => { storage[key] = plain(value); return true; }},
        ariaNgKeyboardService: {}, ariaNgFileService: {}, ariaNgNotificationService: {},
        ariaNgLocalizationService: {}, aria2WebSocketRpcService: {}, aria2HttpRpcService: transport
    });
    function get(name) {
        if (Object.prototype.hasOwnProperty.call(values, name)) { return values[name]; }
        assert(definitions[name], 'missing integration dependency: ' + name);
        const definition = definitions[name];
        values[name] = definition[definition.length - 1](...definition.slice(0, -1).map(get));
        return values[name];
    }
    get('NewTaskController');
    scope.context.urls = options.urls || [
        'magnet:?xt=urn:btih:' + 'a'.repeat(40),
        'https://example.invalid/file.iso',
        'magnet:?xt=urn:btih:' + 'b'.repeat(40),
        'https://example.invalid/data.torrent'
    ].join('\n');
    return {scope, requests, paths, storage,
        filter: get('ariaNgBtFileFilterService'),
        replaceIntent: (value) => { intent = value; },
        persistedJobs: () => storage[values.ariaNgConstants.btFileFilterQueueStorageKey]
    };
}

const tests = [];
const test = (name, run) => tests.push({name, run});

test('mixed multicall submission persists only successful metadata tasks with the original intent', () => {
    for (const downloadLater of [false, true]) {
        const submission = createSubmission();
        submission.scope.startDownload(downloadLater);
        assert.strictEqual(submission.requests.length, 1);
        const request = submission.requests[0];
        assert.strictEqual(request.requestBody.method, 'system.multicall');
        const calls = request.requestBody.params[0];
        assert.strictEqual(calls.length, 4);
        assert.strictEqual(calls[0].params[0], 'token:test-secret');
        assert.strictEqual(calls[0].params[2]['pause-metadata'], 'true');
        assert.strictEqual(calls[0].params[2].pause, 'false');
        assert.strictEqual(calls[1].params[2].pause, downloadLater ? 'true' : undefined);
        // Form edits before the HTTP reply must not alter the submitted filtering intent.
        submission.replaceIntent({enabled: false, thresholdBytes: 1});
        request.successCallback('batch', [{code: 1, message: 'failed'}, ['ordinary-gid'], ['magnet-gid'], ['torrent-gid']]);
        const jobs = plain(submission.filter.getJobs());
        assert.deepStrictEqual(jobs.map((job) => ({gid: job.rootGid, source: job.sourceType,
            threshold: job.thresholdBytes, start: job.startAfterFilter})), [
            {gid: 'magnet-gid', source: 'magnet', threshold: 104857600, start: !downloadLater},
            {gid: 'torrent-gid', source: 'remote-torrent', threshold: 104857600, start: !downloadLater}
        ]);
        assert.deepStrictEqual(submission.persistedJobs(), jobs);
        assert.strictEqual(jobs[0].rpcIdentity, 'http|test.invalid|6800|jsonrpc');
        assert.strictEqual(jobs[0].stage, 'waiting-metadata');
        assert.deepStrictEqual(submission.paths, [downloadLater ? '/waiting' : '/downloading']);
    }
});

test('successful batch with filtering disabled creates no filter jobs', () => {
    const submission = createSubmission({enabled: false});
    submission.scope.startDownload(false);
    submission.requests[0].successCallback('batch', [['one'], ['two'], ['three'], ['four']]);
    assert.deepStrictEqual(plain(submission.filter.getJobs()), []);
    assert.deepStrictEqual(submission.persistedJobs(), []);
    assert.deepStrictEqual(submission.paths, ['/downloading']);
});

test('all-fault and transport failures create no jobs and leave the form open', () => {
    for (const transportFailure of [false, true]) {
        const submission = createSubmission();
        submission.scope.startDownload(false);
        const fault = {code: 1, message: 'failed'};
        if (transportFailure) {
            submission.requests[0].errorCallback('batch', fault);
        } else {
            submission.requests[0].successCallback('batch', [fault, fault, fault, fault]);
        }
        assert.deepStrictEqual(plain(submission.filter.getJobs()), []);
        assert.deepStrictEqual(submission.persistedJobs(), []);
        assert.deepStrictEqual(submission.paths, []);
    }
});

// 清空链接页的下载路径表示使用 aria2 全局目录；空 dir 会被 aria2 接受并下载到其工作目录。
test('a blank download path is omitted from every submission and the exported command', () => {
    for (const blank of ['', '   ']) {
        const links = createSubmission({enabled: false, urls: 'https://example.invalid/file.iso'});
        links.scope.context.options.dir = blank;
        links.scope.startDownload(false);
        const linkCall = links.requests[0].requestBody.params[0][0];
        assert.strictEqual(linkCall.methodName, 'aria2.addUri');
        assert.strictEqual('dir' in linkCall.params[2], false);

        const torrent = createSubmission();
        torrent.scope.context.options.dir = blank;
        torrent.scope.context.taskType = 'torrent';
        torrent.scope.context.uploadFile = {base64Content: 'dA=='};
        torrent.scope.startDownload(false);
        assert.strictEqual(torrent.requests[0].requestBody.method, 'aria2.addTorrent');
        assert.strictEqual(JSON.stringify(torrent.requests[0].requestBody.params).indexOf('"dir"'), -1);

        const exported = createSubmission({enabled: false, urls: 'https://example.invalid/file.iso'});
        exported.scope.context.options.dir = blank;
        exported.scope.showExportCommandAPIModal();
        assert.strictEqual('dir' in exported.scope.context.exportCommandApiOptions.data[0].options, false);
        // 只清理提交副本，输入框仍保留用户当前内容。
        assert.strictEqual(exported.scope.context.options.dir, blank);
    }

    const kept = createSubmission({enabled: false, urls: 'https://example.invalid/file.iso'});
    kept.scope.context.options.dir = '/data/downloads';
    kept.scope.startDownload(false);
    assert.strictEqual(kept.requests[0].requestBody.params[0][0].params[2].dir, '/data/downloads');
});

// 批量结果包含失败项；“创建后打开详情”必须跳到第一个成功创建的任务。
test('task-detail redirect uses the first successful task of a partially failed batch', () => {
    const submission = createSubmission({enabled: false, afterCreating: 'task-detail',
        urls: 'https://example.invalid/bad.iso\nhttps://example.invalid/good.iso'});
    submission.scope.startDownload(false);
    submission.requests[0].successCallback('batch', [{code: 1, message: 'failed'}, ['good-gid']]);
    assert.deepStrictEqual(submission.paths, ['/task/detail/good-gid']);
});

let failed = 0;
for (const {name, run} of tests) {
    try { run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name); console.error(error.stack); }
}
process.exitCode = failed ? 1 : 0;
console.log(tests.length + ' integration tests, ' + failed + ' failed');
