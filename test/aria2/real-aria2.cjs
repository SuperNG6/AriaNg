'use strict';
// 真实 aria2 验收：用 Chromium 驱动构建后的 AriaNg，连接两个一次性 aria2c 容器，
// 回读 aria2 任务状态和磁盘上实际写入的文件。由 test/aria2/run.sh 启动，不要直接连接个人 RPC。
// 场景名标注修复版本；用旧版本运行可作为对照，证明场景能发现对应 bug。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {chromium} = require(process.env.ARIANG_PLAYWRIGHT_MODULE);

const [label, distDir, reportFile] = process.argv.slice(2);
const prefix = process.env.QA_PREFIX || 'ariang-aria2-qa';
const SECRET = 'qa-secret';
const WEB = 'http://' + prefix + '-web:8080';   // aria2 从这里下载测试文件
const PAGE = 'http://127.0.0.1:8080';           // 浏览器打开的 AriaNg
const A = {name: 'A', host: prefix + '-a', dir: '/data/a/downloads', cwd: '/data/a/cwd'};
const B = {name: 'B', host: prefix + '-b', dir: '/data/b/downloads', cwd: '/data/b/cwd'};
const identity = (protocol, target) => [protocol, target.host, '6800', 'jsonrpc'].join('|');
const results = [];

const payloads = {};
const fileUrl = (name) => {
    payloads[name] = payloads[name] || crypto.randomBytes(256 * 1024);
    return WEB + '/files/' + name;
};
const server = http.createServer((req, res) => {
    const url = new URL(req.url, PAGE);
    if (url.pathname === '/qa-blank') {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end('<!doctype html><title>qa</title>');
        return;
    }
    if (url.pathname.startsWith('/files/')) {
        const body = payloads[url.pathname.slice('/files/'.length)];
        res.writeHead(body ? 200 : 404, {'Content-Type': 'application/octet-stream'});
        res.end(body);
        return;
    }
    const target = path.join(distDir, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!target.startsWith(distDir) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404); res.end(); return;
    }
    const mime = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.txt': 'text/plain'};
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

async function allTasks(target) {
    const keys = ['gid', 'status', 'dir', 'files', 'errorMessage'];
    const lists = await Promise.all([rpc(target, 'aria2.tellActive', [keys]),
        rpc(target, 'aria2.tellWaiting', [0, 1000, keys]), rpc(target, 'aria2.tellStopped', [0, 1000, keys])]);
    return [].concat(...lists);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, timeout, what) {
    const deadline = Date.now() + (timeout || 15000);
    let last;
    while (Date.now() < deadline) {
        last = await fn();
        if (last) {
            return last;
        }
        await sleep(200);
    }
    throw new Error('timed out waiting for ' + what);
}

const taskFor = (target, name) => waitFor(async () => (await allTasks(target)).find((task) =>
    task.files[0] && task.files[0].uris[0] && task.files[0].uris[0].uri.endsWith('/files/' + name) &&
    ['complete', 'error'].includes(task.status)), 15000, name + ' on ' + target.name);

const where = (target, name, dir) => ({
    inExpectedDir: fs.existsSync(path.join(dir, name)),
    inAria2Cwd: fs.readdirSync(target.cwd).length > 0 ? fs.readdirSync(target.cwd) : []
});

function options(target, extra) {
    return Object.assign({language: 'en', theme: 'light', rpcHost: target.host, rpcPort: '6800', protocol: 'http',
        httpMethod: 'POST', rpcInterface: 'jsonrpc', secret: Buffer.from(SECRET).toString('base64'),
        afterCreatingNewTask: 'task-list', dragAndDropTasks: true, showFileListInTaskListPage: false}, extra);
}

async function setStorage(page, values, clear) {
    await page.goto(PAGE + '/qa-blank');
    await page.evaluate(({values, clear}) => {
        if (clear) {
            localStorage.clear();
        }
        for (const key of Object.keys(values)) {
            localStorage.setItem(key, JSON.stringify(values[key]));
        }
    }, {values, clear});
}

async function open(page, route) {
    await page.goto(PAGE + '/#!' + route);
    await page.waitForFunction(() => window.angular && angular.element(document.body).injector() &&
        angular.element(document.body).injector().get('$rootScope').taskContext.rpcStatus === 'Connected');
}

async function submitLinks(page, urls, dir) {
    await page.waitForSelector('#new-task-download-path');
    if (typeof dir === 'string') {
        await page.fill('#new-task-download-path', dir);
    }
    await page.fill('textarea[name="urls"]', urls.join('\n'));
    await page.click('form[name="newTaskForm"] button[type="submit"]');
}

async function scenario(name, fn) {
    try {
        const detail = await fn();
        results.push({name, ok: true, detail});
    } catch (error) {
        results.push({name, ok: false, detail: error.message.split('\n').slice(0, 6).join(' | ')});
    }
}

let browser;
(async () => {
    await new Promise((resolve) => server.listen(8080, '0.0.0.0', resolve));
    browser = await chromium.launch({headless: true});
    const page = await (await browser.newContext({viewport: {width: 1280, height: 900}})).newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await setStorage(page, {
        'AriaNg.Options': options(A),
        ['AriaNg.History.dir.' + identity('http', A)]: ['/data/a/remembered'],
        'AriaNg.History.dir': ['/data/legacy']
    }, true);

    await scenario('cleared download path uses the aria2 global dir (fixed in 2.2.5)', async () => {
        await open(page, '/new');
        const prefill = await page.inputValue('#new-task-download-path');
        assert.strictEqual(prefill, '/data/a/remembered', 'prefill from this RPC history');
        await submitLinks(page, [fileUrl('s1.bin')], '');
        const task = await taskFor(A, 's1.bin');
        const location = where(A, 's1.bin', A.dir);
        assert.strictEqual(task.dir, A.dir, 'aria2 task dir');
        assert.strictEqual(location.inExpectedDir, true, 'file written to global dir');
        assert.deepStrictEqual(location.inAria2Cwd, [], 'nothing written to aria2 cwd');
        return {status: task.status, dir: task.dir, path: task.files[0].path};
    });

    await scenario('#!/new/<url>?dir= command uses the aria2 global dir (fixed in 2.2.6)', async () => {
        await open(page, '/new/' + Buffer.from(fileUrl('s2.bin')).toString('base64url') + '?dir=');
        const task = await taskFor(A, 's2.bin');
        const location = where(A, 's2.bin', A.dir);
        assert.strictEqual(task.dir, A.dir, 'aria2 task dir');
        assert.strictEqual(location.inExpectedDir, true, 'file written to global dir');
        return {status: task.status, dir: task.dir, path: task.files[0].path};
    });

    await scenario('another RPC is not prefilled with this RPC path (fixed in 2.2.6)', async () => {
        // 先在 A 上用一个明确路径提交，旧版本会把它同时写进全局历史；再切到没有自己历史的 B。
        await open(page, '/new');
        await submitLinks(page, [fileUrl('a-movie.bin')], '/data/a/downloads/movies');
        const taskOnA = await taskFor(A, 'a-movie.bin');
        assert.strictEqual(taskOnA.dir, '/data/a/downloads/movies', 'RPC A task dir');
        const legacy = await page.evaluate(() => JSON.parse(localStorage.getItem('AriaNg.History.dir')));
        await setStorage(page, {'AriaNg.Options': options(B)}, false);
        await open(page, '/new');
        const prefill = await page.inputValue('#new-task-download-path');
        assert(!/\/data\/a\//.test(prefill), 'RPC B prefilled with an RPC A path: ' + JSON.stringify(prefill));
        assert.strictEqual(prefill, '/data/legacy', 'falls back to pre-upgrade legacy history');
        await submitLinks(page, [fileUrl('s4.bin')], '');
        const task = await taskFor(B, 's4.bin');
        assert.strictEqual(task.dir, B.dir, 'RPC B task uses its own global dir');
        assert.strictEqual(fs.existsSync(path.join(B.dir, 's4.bin')), true, 'file on RPC B global dir');
        return {legacyGlobalHistoryAfterA: legacy, prefillOnB: prefill, dirOnB: task.dir};
    });

    await scenario('task-detail redirect skips a rejected first link (fixed in 2.2.6)', async () => {
        await setStorage(page, {'AriaNg.Options': options(A, {afterCreatingNewTask: 'task-detail'})}, false);
        await open(page, '/new');
        await submitLinks(page, ['magnet:?xt=urn:btih:zzzz', fileUrl('s5.bin')], '');
        await page.waitForFunction(() => location.hash.indexOf('/task/detail/') >= 0, null, {timeout: 15000});
        const task = await taskFor(A, 's5.bin');
        const hash = decodeURIComponent(await page.evaluate(() => location.hash));
        assert.strictEqual(hash, '#!/task/detail/' + task.gid, 'redirect target');
        await page.waitForFunction((gid) => document.body.innerText.indexOf('s5.bin') >= 0, task.gid, {timeout: 10000});
        return {hash, gid: task.gid};
    });

    await scenario('WebSocket drag to top keeps the waiting list refreshing (fixed in 2.2.5)', async () => {
        const gids = [];
        for (const name of ['w1.bin', 'w2.bin', 'w3.bin']) {
            gids.push(await rpc(A, 'aria2.addUri', [[fileUrl(name)], {pause: 'true'}]));
        }
        await setStorage(page, {'AriaNg.Options': options(A, {protocol: 'ws'})}, false);
        await open(page, '/waiting');
        const rows = '#task-table > .task-table-body > div.row[data-gid]';
        await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 3, rows);
        const usesWebSocket = await page.evaluate(() => angular.element(document.body).injector().get('ariaNgSettingService').isCurrentRpcUseWebSocket());
        assert.strictEqual(usesWebSocket, true, 'page talks to aria2 over WebSocket');
        // Emulate dragula: move the last row to the top, then emit the drop event the controller listens to.
        const moved = await page.evaluate((selector) => {
            const all = document.querySelectorAll(selector), last = all[all.length - 1];
            last.parentNode.insertBefore(last, all[0]);
            const scope = angular.element(last.parentNode).scope();
            scope.$apply(() => scope.$emit('task-list.drop-model', last));
            return last.getAttribute('data-gid');
        }, rows);
        await waitFor(async () => (await rpc(A, 'aria2.tellWaiting', [0, 10, ['gid']]))[0].gid === moved, 5000, 'aria2 position 0');
        const added = await rpc(A, 'aria2.addUri', [[fileUrl('w4.bin')], {pause: 'true'}]);
        await page.waitForSelector('div.row[data-gid="' + added + '"]', {timeout: 10000})
            .catch(() => { throw new Error('list stopped refreshing: task added after the drag never appeared'); });
        return {movedToTop: moved, aria2Order: (await rpc(A, 'aria2.tellWaiting', [0, 10, ['gid']])).map((t) => t.gid), appearedAfterDrag: added};
    });

    await browser.close();
    server.close();
    const report = {label, results, pageErrors: [...new Set(pageErrors)]};
    if (reportFile) {
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    }
    for (const result of results) {
        console.log((result.ok ? 'PASS ' : 'FAIL ') + result.name + (result.ok ? '' : '\n     ' + result.detail));
    }
    report.pageErrors.forEach((message) => console.log('PAGE ERROR ' + message));
    const failed = results.filter((result) => !result.ok).length + report.pageErrors.length;
    console.log(results.length + ' scenario(s), ' + failed + ' problem(s)');
    process.exitCode = failed ? 1 : 0;
})().catch(async (error) => {
    console.error(error.stack);
    process.exitCode = 1;
    if (browser) {
        await browser.close();
    }
    server.close();
});
