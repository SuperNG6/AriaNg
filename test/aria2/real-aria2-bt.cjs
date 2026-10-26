'use strict';
// BT 小文件过滤的真实 aria2 端到端验收。由 test/aria2/run.sh 启动：
// 验收容器内置最小 tracker 并生成种子，做种容器 S 提供数据，AriaNg 通过 Chromium 操作下载容器 A。
// 每个场景回读 aria2 的文件选择与清理选项、任务最终状态，以及磁盘上每个文件是否存在且内容正确。
// 全部容器关闭 DHT 与本地发现，只在验收网络内通信。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {chromium} = require(process.env.ARIANG_PLAYWRIGHT_MODULE);

const [label, distDir, reportFile] = process.argv.slice(2);
const prefix = process.env.QA_PREFIX || 'ariang-aria2-qa';
const SECRET = 'qa-secret';
const WEB = 'http://' + prefix + '-web:8080';
const PAGE = 'http://127.0.0.1:8080';
const ANNOUNCE = WEB + '/announce';
const A = {name: 'A', host: prefix + '-a', dir: '/data/a/downloads'};
const S = {name: 'S', host: prefix + '-s', dir: '/data/s'};
const TORRENTS = '/data/torrents';
const KiB = 1024;
const MiB = 1024 * 1024;
const results = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha1 = (buffer) => crypto.createHash('sha1').update(buffer).digest();

function bencode(value) {
    if (Buffer.isBuffer(value)) {
        return Buffer.concat([Buffer.from(value.length + ':'), value]);
    }
    if (typeof value === 'string') {
        return bencode(Buffer.from(value));
    }
    if (typeof value === 'number') {
        return Buffer.from('i' + value + 'e');
    }
    if (Array.isArray(value)) {
        return Buffer.concat([Buffer.from('l')].concat(value.map(bencode), [Buffer.from('e')]));
    }
    const parts = [Buffer.from('d')];
    for (const key of Object.keys(value).sort()) {
        parts.push(bencode(key), bencode(value[key]));
    }
    parts.push(Buffer.from('e'));
    return Buffer.concat(parts);
}

// 生成多文件种子并把完整数据写到做种目录；文件顺序即 aria2 的 1-based 索引。
function makeTorrent(name, files) {
    const pieceLength = 64 * KiB;
    const buffers = files.map((file) => {
        const buffer = crypto.randomBytes(file.size);
        const target = path.join(S.dir, name, file.path);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.writeFileSync(target, buffer);
        file.sha1 = sha1(buffer).toString('hex');
        return buffer;
    });
    const data = Buffer.concat(buffers);
    const pieces = [];
    for (let offset = 0; offset < data.length; offset += pieceLength) {
        pieces.push(sha1(data.subarray(offset, offset + pieceLength)));
    }
    const info = {
        name, 'piece length': pieceLength, pieces: Buffer.concat(pieces),
        files: files.map((file) => ({length: file.size, path: file.path.split('/')}))
    };
    const torrent = bencode({announce: ANNOUNCE, info});
    const infoHash = sha1(bencode(info)).toString('hex');
    fs.mkdirSync(TORRENTS, {recursive: true});
    fs.writeFileSync(path.join(TORRENTS, name + '.torrent'), torrent);
    return {
        name, files, infoHash, torrent,
        file: path.join(TORRENTS, name + '.torrent'),
        url: WEB + '/torrents/' + name + '.torrent',
        magnet: 'magnet:?xt=urn:btih:' + infoHash + '&dn=' + name + '&tr=' + encodeURIComponent(ANNOUNCE),
        largeIndexes: files.map((file, index) => file.size >= MiB ? index + 1 : 0).filter(Boolean),
        allIndexes: files.map((file, index) => index + 1)
    };
}

// 最小 HTTP tracker：按 info_hash 记录 announce 来源，返回其他 peer 的 compact 列表。
const swarms = {};
function percentDecode(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '%') {
            bytes.push(parseInt(text.substr(i + 1, 2), 16));
            i += 2;
        } else {
            bytes.push(text.charCodeAt(i));
        }
    }
    return Buffer.from(bytes);
}
function announce(req, res) {
    const query = {};
    for (const pair of (req.url.split('?')[1] || '').split('&')) {
        const [key, value] = pair.split('=');
        query[key] = value || '';
    }
    const hash = percentDecode(query.info_hash).toString('hex');
    const ip = req.socket.remoteAddress.replace(/^::ffff:/, '');
    const port = Number(query.port);
    const swarm = swarms[hash] = swarms[hash] || {};
    const self = ip + ':' + port;
    if (query.event === 'stopped') {
        delete swarm[self];
    } else {
        swarm[self] = {ip, port};
    }
    const peers = Object.keys(swarm).filter((key) => key !== self).map((key) => {
        const peer = Buffer.alloc(6);
        swarm[key].ip.split('.').forEach((part, index) => { peer[index] = Number(part); });
        peer.writeUInt16BE(swarm[key].port, 4);
        return peer;
    });
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end(bencode({interval: 5, 'min interval': 2, peers: Buffer.concat(peers)}));
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, PAGE);
    if (url.pathname === '/announce') {
        announce(req, res);
        return;
    }
    if (url.pathname === '/qa-blank') {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end('<!doctype html><title>qa</title>');
        return;
    }
    const base = url.pathname.startsWith('/torrents/') ? TORRENTS : distDir;
    const relative = url.pathname.startsWith('/torrents/') ? url.pathname.slice('/torrents'.length) :
        (url.pathname === '/' ? '/index.html' : url.pathname);
    const target = path.join(base, decodeURIComponent(relative));
    if (!target.startsWith(base) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404); res.end(); return;
    }
    const mime = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.txt': 'text/plain',
        '.torrent': 'application/x-bittorrent'};
    res.writeHead(200, {'Content-Type': mime[path.extname(target)] || 'application/octet-stream'});
    fs.createReadStream(target).pipe(res);
});

async function rpc(target, method, params = []) {
    const response = await fetch('http://' + target.host + ':6800/jsonrpc', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: 'qa', method, params: ['token:' + SECRET].concat(params)})
    });
    const body = await response.json();
    if (body.error) {
        throw new Error(method + ': ' + body.error.message);
    }
    return body.result;
}

async function waitFor(fn, timeout, what) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = await fn();
        if (value) {
            return value;
        }
        await sleep(250);
    }
    throw new Error('timed out after ' + timeout + 'ms waiting for ' + what);
}

const statusKeys = ['gid', 'status', 'infoHash', 'files', 'bittorrent', 'following', 'followedBy',
    'completedLength', 'totalLength', 'errorCode', 'errorMessage', 'seeder'];
async function allTasks(target) {
    const lists = await Promise.all([rpc(target, 'aria2.tellActive', [statusKeys]),
        rpc(target, 'aria2.tellWaiting', [0, 1000, statusKeys]),
        rpc(target, 'aria2.tellStopped', [0, 1000, statusKeys])]);
    return [].concat(...lists);
}
const isPayload = (task, torrent) => task.infoHash === torrent.infoHash && task.files.length > 0 &&
    !task.files[0].path.startsWith('[METADATA]');
const payloadTask = (torrent, timeout) => waitFor(async () =>
    (await allTasks(A)).find((task) => isPayload(task, torrent)), timeout || 20000, torrent.name + ' payload');

async function selection(gid) {
    const [task, options] = await Promise.all([rpc(A, 'aria2.tellStatus', [gid, statusKeys]), rpc(A, 'aria2.getOption', [gid])]);
    return {
        status: task.status,
        selected: task.files.filter((file) => file.selected === 'true').map((file) => Number(file.index)),
        selectFile: options['select-file'] || '(all)',
        removeUnselected: options['bt-remove-unselected-file']
    };
}

const waitComplete = (gid, timeout) => waitFor(async () => {
    const task = await rpc(A, 'aria2.tellStatus', [gid, ['status', 'errorMessage']]);
    if (task.status === 'error' || task.status === 'removed') {
        throw new Error('task ' + gid + ' ended as ' + task.status + ': ' + task.errorMessage);
    }
    return task.status === 'complete';
}, timeout || 60000, gid + ' complete');

// 返回每个文件在下载目录中的状态：ok（内容一致）、absent、partial/mismatch。
function disk(torrent) {
    const state = {};
    for (const file of torrent.files) {
        const target = path.join(A.dir, torrent.name, file.path);
        if (!fs.existsSync(target)) {
            state[file.path] = 'absent';
        } else {
            state[file.path] = sha1(fs.readFileSync(target)).toString('hex') === file.sha1 ? 'ok' : 'mismatch';
        }
    }
    return state;
}
function expectDisk(torrent, expected) {
    const actual = disk(torrent);
    for (const file of torrent.files) {
        const want = expected(file);
        assert.strictEqual(actual[file.path], want, file.path + ' on disk: ' + actual[file.path] + ', expected ' + want);
    }
    return actual;
}

async function seed(torrent, uploadLimit) {
    const gid = await rpc(S, 'aria2.addTorrent', [torrent.torrent.toString('base64'), [],
        {dir: S.dir, 'check-integrity': 'true', 'seed-ratio': '0.0', 'max-upload-limit': uploadLimit || '0'}]);
    await waitFor(async () => {
        const task = await rpc(S, 'aria2.tellStatus', [gid, ['status', 'seeder']]);
        return task.status === 'active' && task.seeder === 'true';
    }, 30000, torrent.name + ' seeding');
    return gid;
}

function options(extra) {
    return Object.assign({language: 'en', theme: 'light', rpcHost: A.host, rpcPort: '6800', protocol: 'http',
        httpMethod: 'POST', rpcInterface: 'jsonrpc', secret: Buffer.from(SECRET).toString('base64'),
        afterCreatingNewTask: 'task-list', showFileListInTaskListPage: false,
        downloadTaskRefreshInterval: 1000}, extra);
}

// 合并到已保存的设置，保留在界面中开启的过滤开关和阈值。
async function setOptions(page, extra) {
    await page.goto(PAGE + '/qa-blank');
    await page.evaluate(({base, extra}) => {
        const saved = JSON.parse(localStorage.getItem('AriaNg.Options') || 'null');
        localStorage.setItem('AriaNg.Options', JSON.stringify(Object.assign(saved || base, extra)));
    }, {base: options({}), extra: extra || {}});
}

async function open(page, route) {
    await page.goto(PAGE + '/#!' + route);
    await page.waitForFunction(() => window.angular && angular.element(document.body).injector() &&
        angular.element(document.body).injector().get('$rootScope').taskContext.rpcStatus === 'Connected');
}

// 在页面里持续记录过滤协调器暴露的阶段，作为“确实经过过滤流程”的证据。
async function watchStages(page) {
    await page.evaluate(() => {
        window.__qaStages = [];
        clearInterval(window.__qaStageTimer);
        window.__qaStageTimer = setInterval(() => {
            const injector = angular.element(document.body).injector();
            if (!injector) {
                return;
            }
            const map = injector.get('ariaNgBtFileFilterService').getPendingGidStageMap();
            for (const gid of Object.keys(map)) {
                const entry = gid.slice(0, 6) + ':' + map[gid];
                if (window.__qaStages[window.__qaStages.length - 1] !== entry && window.__qaStages.indexOf(entry) < 0) {
                    window.__qaStages.push(entry);
                }
            }
        }, 100);
    });
}
const stagesSeen = (page) => page.evaluate(() => (window.__qaStages || []).map((entry) => entry.split(':')[1]))
    .then((stages) => stages.filter((stage, index) => stages.indexOf(stage) === index));

const waitFilterIdle = (page, timeout) => page.waitForFunction(() => {
    const service = angular.element(document.body).injector().get('ariaNgBtFileFilterService');
    return Object.keys(service.getPendingGidStageMap()).length === 0 &&
        service.getJobs().every((job) => job.stage.indexOf('completed-') === 0);
}, null, {timeout: timeout || 30000});

async function enableFilterInUi(page, megabytes) {
    const toggle = page.locator('.bt-file-filter-toggle input[type="checkbox"]');
    if (!(await toggle.isChecked())) {
        await toggle.check();
    }
    await page.fill('.bt-file-filter-size', String(megabytes));
}

async function submit(page, later) {
    if (later) {
        await page.click('form[name="newTaskForm"] .nav-toolbar .btn-group:nth-of-type(2) .dropdown-toggle');
        await page.click('form[name="newTaskForm"] a:has-text("Download Later")');
    } else {
        await page.click('form[name="newTaskForm"] button[type="submit"]');
    }
}

async function submitLinks(page, url, later) {
    await open(page, '/new');
    await watchStages(page);
    await page.fill('textarea[name="urls"]', url);
    await submit(page, later);
}

async function scenario(name, fn) {
    const started = Date.now();
    try {
        const detail = await fn();
        results.push({name, ok: true, seconds: Math.round((Date.now() - started) / 1000), detail});
    } catch (error) {
        results.push({name, ok: false, seconds: Math.round((Date.now() - started) / 1000),
            detail: error.message.split('\n').slice(0, 8).join(' | ')});
    }
}

let browser;
(async () => {
    await new Promise((resolve) => server.listen(8080, '0.0.0.0', resolve));
    const mixed = (name) => makeTorrent(name, [
        {path: 'Feature.mkv', size: 3 * MiB},
        {path: 'readme.txt', size: 20 * KiB},
        {path: 'Extras/Bonus.mkv', size: 2 * MiB},
        {path: 'Extras/cover.jpg', size: 100 * KiB},
        {path: 'sample.nfo', size: 1 * KiB}
    ]);
    const t1 = mixed('qa-local'), t2 = mixed('qa-magnet'), t3 = mixed('qa-remote');
    const t4 = makeTorrent('qa-all-small', [{path: 'a.txt', size: 300 * KiB}, {path: 'b.jpg', size: 200 * KiB},
        {path: 'c.nfo', size: 2 * KiB}]);
    const t5 = makeTorrent('qa-bulk', [{path: 'Movie.mkv', size: 6 * MiB}, {path: 'Movie.srt', size: 40 * KiB},
        {path: 'poster.jpg', size: 150 * KiB}]);
    const t6 = mixed('qa-recover'), t8 = mixed('qa-seeding'), t9 = mixed('qa-seeding-removed');
    const t7 = makeTorrent('qa-reuse', [{path: 'Part1.mkv', size: 2 * MiB}, {path: 'Part2.mkv', size: 2 * MiB},
        {path: 'info.txt', size: 50 * KiB}, {path: 'thumb.jpg', size: 30 * KiB}]);
    for (const torrent of [t1, t2, t3, t4, t8, t9]) {
        await seed(torrent);
    }
    // 限速做种让任务在过滤期间保持下载中：批量过滤只处理 active 任务；aria2 只为已启动任务登记 InfoHash。
    await seed(t5, '120K');
    await seed(t7, '100K');

    browser = await chromium.launch({headless: true});
    const page = await (await browser.newContext({viewport: {width: 1280, height: 900}})).newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await setOptions(page, {});
    const filtered = (torrent) => (file) => file.size >= MiB ? 'ok' : 'absent';

    await scenario('local .torrent + Download Now: only large files are downloaded, small files absent', async () => {
        await open(page, '/new');
        await enableFilterInUi(page, 1);
        await watchStages(page);
        await page.click('form[name="newTaskForm"] .nav-toolbar .btn-group:first-child .dropdown-toggle');
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'),
            page.click('form[name="newTaskForm"] a:has-text("Open Torrent File")')]);
        await chooser.setFiles(t1.file);
        await page.waitForFunction(() => angular.element(document.querySelector('form[name="newTaskForm"]')).scope().context.taskType === 'torrent');
        await submit(page, false);
        const task = await payloadTask(t1);
        await waitFilterIdle(page);
        const readback = await selection(task.gid);
        assert.deepStrictEqual(readback.selected, t1.largeIndexes, 'selected file indexes');
        assert.strictEqual(readback.removeUnselected, 'true', 'bt-remove-unselected-file');
        await waitComplete(task.gid);
        return {stages: await stagesSeen(page), readback, disk: expectDisk(t1, filtered(t1))};
    });

    await scenario('magnet + Download Now: metadata child is filtered before it starts', async () => {
        await submitLinks(page, t2.magnet, false);
        const task = await payloadTask(t2);
        await waitFilterIdle(page);
        const readback = await selection(task.gid);
        assert.deepStrictEqual(readback.selected, t2.largeIndexes, 'selected file indexes');
        assert.strictEqual(readback.removeUnselected, 'true', 'bt-remove-unselected-file');
        await waitComplete(task.gid);
        return {stages: await stagesSeen(page), readback, disk: expectDisk(t2, filtered(t2))};
    });

    await scenario('remote .torrent + Download Later: filtered and still paused, then completes when started', async () => {
        await submitLinks(page, t3.url, true);
        const task = await payloadTask(t3);
        await waitFilterIdle(page);
        await sleep(3000);
        const readback = await selection(task.gid);
        assert.strictEqual(readback.status, 'paused', 'Download Later keeps the task paused');
        assert.deepStrictEqual(readback.selected, t3.largeIndexes, 'selected file indexes');
        const progress = await rpc(A, 'aria2.tellStatus', [task.gid, ['completedLength']]);
        await rpc(A, 'aria2.unpause', [task.gid]);
        await waitComplete(task.gid);
        return {stages: await stagesSeen(page), readback, completedWhilePaused: progress.completedLength,
            disk: expectDisk(t3, filtered(t3))};
    });

    await scenario('all files below the threshold: task downloads in full', async () => {
        await submitLinks(page, t4.magnet, false);
        const task = await payloadTask(t4);
        await waitFilterIdle(page);
        const readback = await selection(task.gid);
        assert.deepStrictEqual(readback.selected, t4.allIndexes, 'all files stay selected');
        await waitComplete(task.gid);
        return {stages: await stagesSeen(page), readback, disk: expectDisk(t4, () => 'ok')};
    });

    await scenario('bulk filter on an active download narrows the selection and deletes small files at completion', async () => {
        const gid = await rpc(A, 'aria2.addTorrent', [t5.torrent.toString('base64'), [], {}]);
        await waitFor(async () => Number((await rpc(A, 'aria2.tellStatus', [gid, ['completedLength']])).completedLength) > 0,
            30000, 'bulk task to start downloading');
        await setOptions(page, {showFileListInTaskListPage: true});
        await open(page, '/downloading');
        await watchStages(page);
        await page.fill('#bulk-bt-filter-threshold', '1');
        await page.waitForFunction(() => {
            const button = document.querySelector('.bulk-bt-filter-controls button.btn-primary');
            return button && !button.disabled;
        }, null, {timeout: 20000});
        const preview = (await page.innerText('.bulk-bt-filter-state')).trim();
        await page.click('.bulk-bt-filter-controls button.btn-primary');
        await page.click('.sweet-alert.visible button.confirm');
        const status = await page.waitForFunction(() => {
            const bulk = angular.element(document.body).injector().get('ariaNgBtFileFilterService').getBulkStatus();
            return bulk.type === 'complete' ? {filtered: bulk.filtered, skipped: bulk.skipped, failed: bulk.failed, filteredFiles: bulk.filteredFiles} : null;
        }, null, {timeout: 40000}).then((handle) => handle.jsonValue());
        assert.deepStrictEqual(status, {filtered: 1, skipped: 0, failed: 0, filteredFiles: 2}, 'bulk outcome');
        const readback = await selection(gid);
        assert.deepStrictEqual(readback.selected, t5.largeIndexes, 'selected file indexes');
        assert.strictEqual(readback.removeUnselected, 'true', 'cleanup enabled because all files were selected');
        await waitComplete(gid, 150000);
        return {preview, stages: await stagesSeen(page), status, readback, disk: expectDisk(t5, filtered(t5))};
    });

    await scenario('page closed before metadata arrives: filtering resumes after reopening', async () => {
        await setOptions(page, {showFileListInTaskListPage: false});
        await submitLinks(page, t6.magnet, false);
        await page.waitForFunction(() => angular.element(document.body).injector().get('ariaNgBtFileFilterService').getJobs().length > 0);
        await page.goto(PAGE + '/qa-blank');
        await seed(t6);
        const child = await payloadTask(t6, 30000);
        await sleep(2000);
        const whileClosed = await selection(child.gid);
        assert.strictEqual(whileClosed.status, 'paused', 'pause-metadata keeps the child paused while AriaNg is closed');
        await open(page, '/downloading');
        await watchStages(page);
        await waitFilterIdle(page, 40000);
        const readback = await selection(child.gid);
        assert.deepStrictEqual(readback.selected, t6.largeIndexes, 'selected file indexes');
        await waitComplete(child.gid);
        return {whileClosed, stages: await stagesSeen(page), readback, disk: expectDisk(t6, filtered(t6))};
    });

    await scenario('magnet for an InfoHash already downloading keeps manual exclusions and the task state', async () => {
        const existing = await rpc(A, 'aria2.addTorrent', [t7.torrent.toString('base64'), [], {'select-file': '1,3,4'}]);
        await waitFor(async () => Number((await rpc(A, 'aria2.tellStatus', [existing, ['completedLength']])).completedLength) > 0,
            30000, 'existing task to start downloading');
        await submitLinks(page, t7.magnet, false);
        await page.waitForFunction(() => angular.element(document.body).injector().get('ariaNgBtFileFilterService').getJobs().length > 0);
        await waitFilterIdle(page, 40000);
        await sleep(2000);
        const readback = await selection(existing);
        assert.deepStrictEqual(readback.selected, [1], 'only the selected large file remains; manual exclusion kept');
        assert.strictEqual(readback.removeUnselected, 'false', 'cleanup unchanged because the user had excluded a file');
        assert.strictEqual(readback.status, 'active', 'existing task is neither paused nor restarted by the filter');
        const roots = (await allTasks(A)).filter((task) => task.infoHash === t7.infoHash && task.gid !== existing)
            .map((task) => ({status: task.status, errorCode: task.errorCode}));
        return {stages: await stagesSeen(page), readback, duplicateRoots: roots};
    });

    // 过滤后的任务带做种时间启动：A 全局 seed-time=0，这里按任务覆盖，观察做种期间与结束后的磁盘状态。
    const startFilteredWithSeeding = async (torrent, seedTime) => {
        await setOptions(page, {showFileListInTaskListPage: false});
        await submitLinks(page, torrent.url, true);
        const task = await payloadTask(torrent);
        await waitFilterIdle(page);
        assert.deepStrictEqual((await selection(task.gid)).selected, torrent.largeIndexes, 'selected file indexes');
        await rpc(A, 'aria2.changeOption', [task.gid, {'seed-time': seedTime}]);
        await rpc(A, 'aria2.unpause', [task.gid]);
        await waitFor(async () => {
            const status = await rpc(A, 'aria2.tellStatus', [task.gid, ['status', 'seeder']]);
            return status.status === 'active' && status.seeder === 'true';
        }, 60000, torrent.name + ' seeding');
        return task;
    };
    const smallFilesOnDisk = (torrent) => {
        const state = disk(torrent);
        return torrent.files.filter((file) => file.size < MiB).map((file) => file.path + ':' + state[file.path]);
    };

    await scenario('excluded small files stay on disk while seeding and are deleted when seeding ends', async () => {
        const task = await startFilteredWithSeeding(t8, '0.2');
        const whileSeeding = smallFilesOnDisk(t8);
        assert(whileSeeding.some((entry) => !entry.endsWith(':absent')),
            'a small file sharing a piece with a large file is written while seeding: ' + whileSeeding.join(', '));
        await waitComplete(task.gid, 60000);
        return {whileSeeding, afterSeeding: expectDisk(t8, filtered(t8))};
    });

    await scenario('removing a filtered task while it is seeding also deletes the excluded small files', async () => {
        const task = await startFilteredWithSeeding(t9, '10');
        const whileSeeding = smallFilesOnDisk(t9);
        await rpc(A, 'aria2.remove', [task.gid]);
        // 记录 aria2 对“做种中被删除”的结算状态，不预设为 removed。
        const endStatus = await waitFor(async () => {
            const status = (await rpc(A, 'aria2.tellStatus', [task.gid, ['status']])).status;
            return status !== 'active' && status;
        }, 20000, t9.name + ' to stop');
        await sleep(1000);
        return {whileSeeding, endStatus, afterRemove: expectDisk(t9, filtered(t9))};
    });

    await scenario('task list shows the real multi-folder file tree', async () => {
        await setOptions(page, {showFileListInTaskListPage: true});
        await open(page, '/stopped');
        const task = await payloadTask(t1);
        const panel = page.locator('div.row[data-gid="' + task.gid + '"] .task-list-file-list');
        await panel.waitFor({timeout: 15000});
        const text = await panel.innerText();
        for (const name of ['Extras', 'Feature.mkv', 'Bonus.mkv', 'readme.txt', 'cover.jpg']) {
            assert(text.indexOf(name) >= 0, 'file panel lists ' + name);
        }
        return {rows: await panel.locator('.task-table-body .row').count()};
    });

    await browser.close();
    server.close();
    const report = {label, results, pageErrors: [...new Set(pageErrors)]};
    if (reportFile) {
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    }
    for (const result of results) {
        console.log((result.ok ? 'PASS ' : 'FAIL ') + result.name + ' (' + result.seconds + 's)' +
            (result.ok ? '' : '\n     ' + result.detail));
    }
    report.pageErrors.forEach((message) => console.log('PAGE ERROR ' + message));
    const failed = results.filter((result) => !result.ok).length + report.pageErrors.length;
    console.log(results.length + ' BT scenario(s), ' + failed + ' problem(s)');
    process.exitCode = failed ? 1 : 0;
})().catch(async (error) => {
    console.error(error.stack);
    process.exitCode = 1;
    if (browser) {
        await browser.close();
    }
    server.close();
});
