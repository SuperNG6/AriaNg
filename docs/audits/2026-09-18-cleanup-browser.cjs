'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
// Manual browser audit: provide Playwright externally; it is not an application dependency.
const {chromium} = require(process.env.ARIANG_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const mode = process.argv[2] || 'standard';
const output = path.join(__dirname, '2026-09-18-cleanup-evidence');
fs.mkdirSync(output, {recursive: true});
const report = {mode, cases: [], errors: [], languages: [], rpcMethods: {}};
const baseTask = {status: 'active', totalLength: '200000000', completedLength: '0', uploadLength: '0', downloadSpeed: '0', uploadSpeed: '0', connections: '0', numSeeders: '0', dir: '/mock', numPieces: '100', pieceLength: '1048576', bitfield: '', seeder: false};
const rootGid = '0000000000000001', childGid = '0000000000000002', bulkGid = '0000000000000003';
const tasks = [
    {...baseTask, gid: rootGid, followedBy: [childGid], files: [{index:'1',path:'/mock/Metadata',length:'200000000',completedLength:'0',selected:'true',uris:[]}]},
    {...baseTask, gid: childGid, following: rootGid, files: []},
    {...baseTask, gid: bulkGid, infoHash:'0123456789abcdef0123456789abcdef01234567', bittorrent:{mode:'multi',info:{name:'QA bulk download'}},files:[
        {index:'1',path:'/mock/QA/small.txt',length:'20',completedLength:'0',selected:'true',uris:[]},
        {index:'2',path:'/mock/QA/large.bin',length:'200000000',completedLength:'0',selected:'true',uris:[]}
    ]}
];
function rpc(method, params = []) {
    report.rpcMethods[method] = (report.rpcMethods[method] || 0) + 1;
    if(method==='system.multicall') return params[0].map(call => [rpc(call.methodName, call.params)]);
    if(method==='aria2.getGlobalStat') return {downloadSpeed:'0',uploadSpeed:'0',numActive:'3',numWaiting:'0',numStopped:'0',numStoppedTotal:'0'};
    if(method==='aria2.getVersion') return {version:'1.37.0',enabledFeatures:['BitTorrent']};
    if(method==='aria2.getSessionInfo') return {sessionId:'mock-session'};
    if(method==='aria2.getGlobalOption') return {dir:'/mock','max-concurrent-downloads':'5'};
    if(method==='aria2.tellActive') return tasks;
    if(method==='aria2.tellWaiting'||method==='aria2.tellStopped'||method==='aria2.getPeers') return [];
    if(method==='aria2.tellStatus') return tasks.find(task => task.gid===params[0]);
    if(method==='aria2.getOption') return {'bt-remove-unselected-file':'false','select-file':'1,2'};
    if(['aria2.changeOption','aria2.forcePause','aria2.unpause'].includes(method)) return 'OK';
    throw new Error('Unexpected mock RPC: '+method);
}
const server = http.createServer((req, res) => {
    const file = path.join(root, 'dist', decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    const target = file.endsWith('/') ? file+'index.html' : file;
    const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.txt':'text/plain','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2','.ico':'image/x-icon'};
    if (!target.startsWith(path.join(root,'dist')+path.sep) || !fs.existsSync(target)) {res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream'});fs.createReadStream(target).pipe(res);
});
let browser;
async function swipe(page, left) {
    const cdp=await page.context().newCDPSession(page);
    const from=left?320:55,to=left?55:320;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from,y:430}]});
    for(let i=1;i<=6;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from+(to-from)*i/6,y:430}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await cdp.detach();
}
async function injector(page, fn, arg) {
    return page.evaluate(({fn,arg}) => {
        const inject=angular.element(document.body).injector();
        return new Function('inject','arg','return ('+fn+')(inject,arg);')(inject,arg);
    }, {fn:fn.toString(),arg});
}
(async()=>{
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const base='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({headless:true,executablePath:process.env.ARIANG_BROWSER_EXECUTABLE});
    for(const theme of ['light','dark']) {
        const context=await browser.newContext({viewport:{width:375,height:812},hasTouch:true,isMobile:true});
        const page=await context.newPage();
        page.on('pageerror',error=>report.errors.push(error.message));
        page.on('console',message=>{if(message.type()==='error' && !/Failed to load resource/.test(message.text()))report.errors.push(message.text());});
        const languageRequests=[];
        await context.route('**/*',async route=>{
            const request=route.request(), url=request.url();
            if(new URL(url).pathname==='/jsonrpc') {
                const body=request.postDataJSON();
                try {await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({jsonrpc:'2.0',id:body.id,result:rpc(body.method,body.params)})});}
                catch(e){report.errors.push(e.message);await route.abort();}
            } else if(url.startsWith(base+'/')) {
                if(url.includes('/langs/'))languageRequests.push(url);
                await route.continue();
            } else {report.errors.push('Blocked external request '+url);await route.abort();}
        });
        await context.addInitScript(({theme})=>localStorage.setItem('AriaNg.Options',JSON.stringify({language:'en',theme,rpcHost:'127.0.0.1',rpcPort:'16800',protocol:'http',httpMethod:'POST',rpcInterface:'jsonrpc',showFileListInTaskListPage:true,swipeGesture:true})),{theme});
        await page.goto(base+'/#!/new');
        await page.waitForSelector('form[name="newTaskForm"]');
        await page.waitForFunction(()=>angular.element(document.body).injector().get('$rootScope').taskContext.rpcStatus==='Connected');
        const tabs=page.locator('form[name="newTaskForm"] .nav-tabs > li.active');
        assert.strictEqual((await tabs.innerText()).trim(),'Links');
        const before=report.rpcMethods['aria2.getGlobalOption']||0;
        await swipe(page,true);
        await page.waitForFunction(()=>angular.element(document.querySelector('form[name="newTaskForm"]')).scope().context.currentTab==='options');
        await page.waitForFunction(()=>angular.element(document.querySelector('form[name="newTaskForm"]')).scope().context.globalOptions!==null);
        assert.strictEqual(report.rpcMethods['aria2.getGlobalOption'],before+1);
        if (mode === 'bundle') await page.screenshot({path:path.join(output,mode+'-'+theme+'-375-options.png'),fullPage:true});
        await swipe(page,false);
        await page.waitForFunction(()=>angular.element(document.querySelector('form[name="newTaskForm"]')).scope().context.currentTab==='links');
        await swipe(page,true);
        await page.waitForFunction(()=>angular.element(document.querySelector('form[name="newTaskForm"]')).scope().context.currentTab==='options');
        assert.strictEqual(report.rpcMethods['aria2.getGlobalOption'],before+1);
        report.cases.push(theme+': real touch swipe, options load once, 375px');
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
        assert.strictEqual(overflow,false,'horizontal overflow');
        // Real Angular scope lifetime: destroying the status controller scope removes its watcher.
        const lifecycle=await injector(page, inject=>{
            const root=inject.get('$rootScope'),scope=root.$new();
            const before=root.$$watchersCount;
            inject.get('$controller')('Aria2StatusController',{$scope:scope});
            root.$digest();
            const during=root.$$watchersCount;
            scope.$destroy();
            return {before,during,after:root.$$watchersCount};
        });
        assert.strictEqual(lifecycle.during,lifecycle.before+1);
        assert.strictEqual(lifecycle.after,lifecycle.before);
        report.cases.push(theme+': status watcher released on real Angular scope destruction');
        await injector(page,inject=>inject.get('$rootScope').$apply(()=>inject.get('$location').path('/downloading')));
        await page.waitForSelector('.task-name');
        await injector(page,(inject,ids)=>inject.get('$rootScope').$apply(()=>{
            const service=inject.get('ariaNgBtFileFilterService');
            service.enqueue(ids[0],{thresholdBytes:104857600,startAfterFilter:true,sourceType:'magnet'});
        }),[rootGid]);
        await page.waitForFunction(()=>document.querySelectorAll('.bt-filter-badge').length>=2);
        await injector(page,(inject,gid)=>inject.get('$rootScope').$apply(()=>inject.get('ariaNgBtFileFilterService').enqueueBulk([gid],104857600)),bulkGid);
        await page.waitForFunction(()=>document.querySelectorAll('.bt-filter-badge').length===3);
        if (mode === 'bundle') await page.screenshot({path:path.join(output,mode+'-'+theme+'-375-badges.png'),fullPage:true});
        await injector(page,inject=>inject.get('$rootScope').$apply(()=>{
            inject.get('ariaNgBtFileFilterService').stop();
            inject.get('$rootScope').$broadcast('bt-file-filter.stopped');
        }));
        await page.waitForFunction(()=>document.querySelectorAll('.bt-filter-badge').length===0);
        report.cases.push(theme+': automatic root/child and bulk badges render, stop clears all');
        await injector(page,inject=>inject.get('$rootScope').$apply(()=>inject.get('$location').path('/new')));
        await page.waitForSelector('form[name="newTaskForm"]');
        if(mode==='bundle') await context.setOffline(true);
        for(const language of ['zh_Hans','fr_FR','en']) {
            await injector(page,(inject,language)=>new Promise((resolve,reject)=>{
                inject.get('$rootScope').$apply(()=>inject.get('$translate').use(language).then(resolve,reject));
            }),language);
            const label=(await page.locator('form[name="newTaskForm"] .nav-tabs > li:nth-child(2) a').innerText()).trim();
            assert.strictEqual(label,language==='zh_Hans'?'选项':'Options');
            const translated=await injector(page,inject=>inject.get('$translate').instant('Download Now'));
            assert(translated && (language==='en'||translated!=='Download Now'));
            report.languages.push({theme,language,label,downloadNow:translated,offline:mode==='bundle'});
        }
        if(mode==='bundle') assert.strictEqual(languageRequests.length,0,'bundle fetched external language files');
        else {assert(languageRequests.some(url=>url.includes('zh_Hans.txt')));assert(languageRequests.some(url=>url.includes('fr_FR.txt')));}
        await context.close();
    }
    assert.deepStrictEqual(report.errors,[]);
    fs.writeFileSync(path.join(output,mode+'-report.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error.stack);console.error(JSON.stringify(report,null,2));process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
