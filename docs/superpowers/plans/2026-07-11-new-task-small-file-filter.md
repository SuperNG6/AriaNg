# New Task Small-File Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a remembered new-task control that filters BT files smaller than a configured MB threshold before payload download, resumes pending work after reopening AriaNg, reports progress in the toolbar, and safely falls back to full download.

**Architecture:** Keep configuration and route-aware toolbar bindings in existing AriaNg settings/MainController patterns. Add a focused `ariaNgBtFileFilterService` that owns URL classification, selection planning, per-RPC persistent jobs, polling, reconciliation, retries, cleanup options, status summaries, and resume behavior; `NewTaskController` only prepares metadata-safe add options and registers returned GIDs.

**Tech Stack:** AngularJS 1.6, aria2 JSON-RPC (`pause-metadata`, `followedBy`, `changeOption`, `unpause`), browser local storage, Bootstrap 3/AdminLTE, Font Awesome 4, Node `assert`/`vm` regression tests, Gulp 4.

## Global Constraints

- Keep AriaNg deployable as a static frontend; add no server process or runtime dependency.
- Support magnet URIs, local `.torrent` uploads, and HTTP/HTTPS URLs whose path ends in `.torrent`; do not filter ordinary direct downloads or Metalink.
- First-use defaults are disabled and `100 MB`; persist both values. Accept only integer values from `1` through `102400` MB.
- Filter only files whose byte length is strictly less than `thresholdMb * 1024 * 1024`; equal-size files remain selected.
- If every file is below the threshold or every file meets it, perform a full download. Filter only mixed-size file lists.
- A successful mixed-size filter sets `select-file` and task-local `bt-remove-unselected-file=true`; never change the global aria2 option.
- After three failed filter attempts, reconcile and restore all file indexes plus the task's original cleanup option, then honor the original Download Now/Download Later state.
- Pending jobs are isolated by a stable RPC endpoint identity and resume only in the same browser against the same endpoint.
- Use four-space indentation, single-quoted JavaScript strings, semicolons, and Node 14-compatible syntax.
- Do not modify generated `dist/` files.

---

### Task 1: Persisted filter settings and validation contract

**Files:**
- Modify: `src/scripts/config/constants.js`
- Modify: `src/scripts/services/ariaNgSettingService.js`
- Create: `test/new-task-small-file-filter.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `ariaNgConstants.btFileFilterQueueStorageKey === 'BtFileFilterQueue'`.
- Produces: `ariaNgSettingService.getBtFileFilterEnabled(): boolean` and `setBtFileFilterEnabled(value): void`.
- Produces: `ariaNgSettingService.getBtFileFilterMinSizeMb(): number` and `setBtFileFilterMinSizeMb(value): void`.
- Produces: `ariaNgSettingService.getCurrentRpcIdentity(): string`, formatted as `protocol|host|port|interface` without alias or secret.

- [ ] **Step 1: Add a failing settings regression test and test runner entry**

Create `test/new-task-small-file-filter.test.js` with the same `fs`/`vm` Angular factory harness used by `test/task-list-file-list.test.js`. Load `constants.js` and `ariaNgSettingService.js`, then add these assertions:

```js
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
```

Append the test to the `package.json` script:

```json
"test": "node test/task-list-file-list.test.js && node test/release-workflow.test.js && node test/new-task-small-file-filter.test.js"
```

- [ ] **Step 2: Run the new test and verify the intended failure**

Run: `node test/new-task-small-file-filter.test.js`

Expected: FAIL because `btFileFilterQueueStorageKey` and filter setting methods are not defined.

- [ ] **Step 3: Add constants and strict persisted accessors**

Add to `ariaNgConstants`:

```js
btFileFilterQueueStorageKey: 'BtFileFilterQueue',
```

Add to `ariaNgDefaultOptions`:

```js
btFileFilterEnabled: false,
btFileFilterMinSizeMb: 100,
```

Add these methods near the task-list preferences in `ariaNgSettingService`:

```js
getBtFileFilterEnabled: function () {
    return !!getOption('btFileFilterEnabled');
},
setBtFileFilterEnabled: function (value) {
    setOption('btFileFilterEnabled', !!value);
},
getBtFileFilterMinSizeMb: function () {
    return parseInt(getOption('btFileFilterMinSizeMb'));
},
setBtFileFilterMinSizeMb: function (value) {
    var parsedValue = Number(value);

    if (parsedValue !== Math.floor(parsedValue) || parsedValue < 1 || parsedValue > 102400) {
        return;
    }

    setOption('btFileFilterMinSizeMb', parsedValue);
},
getCurrentRpcIdentity: function () {
    var options = this.getAllOptions();

    return [options.protocol, options.rpcHost, options.rpcPort, options.rpcInterface].join('|');
},
```

- [ ] **Step 4: Run settings tests and lint**

Run: `node test/new-task-small-file-filter.test.js && npx gulp lint`

Expected: all filter settings tests PASS and lint exits 0.

- [ ] **Step 5: Commit the settings contract**

```bash
git add package.json src/scripts/config/constants.js src/scripts/services/ariaNgSettingService.js test/new-task-small-file-filter.test.js
git commit -m "feat: add BT file filter settings"
```

---

### Task 2: aria2 primitives for atomic options and per-task pause behavior

**Files:**
- Modify: `src/scripts/services/aria2RpcService.js`
- Modify: `src/scripts/services/aria2TaskService.js`
- Modify: `test/new-task-small-file-filter.test.js`

**Interfaces:**
- Consumes: existing `aria2RpcService.changeOption`, `addUri`, and `addUriMulti` response contexts.
- Produces: `aria2TaskService.changeTaskOptions(gid, options, callback, silent): Promise`.
- Produces: `aria2RpcService.addUriMulti` honors `task.pauseOnAdded` when it is explicitly `true` or `false`, otherwise uses the batch default.

- [ ] **Step 1: Add failing source-contract and VM tests**

Extend `test/new-task-small-file-filter.test.js`:

```js
test('supports atomic task options and per-task pause overrides', function () {
    const rpcSource = read('src/scripts/services/aria2RpcService.js');
    const taskSource = read('src/scripts/services/aria2TaskService.js');

    assert(rpcSource.includes('angular.isDefined(task.pauseOnAdded)'));
    assert(taskSource.includes('changeTaskOptions: function (gid, options, callback, silent)'));
    assert(taskSource.includes('options: options'));
});
```

Add a VM harness for `aria2TaskService` with a stub `aria2RpcService.changeOption`; assert that:

```js
service.changeTaskOptions('gid-1', {
    'select-file': '2,4',
    'bt-remove-unselected-file': 'true'
}, callback, true);

assert.deepStrictEqual(lastChangeOption.options, {
    'select-file': '2,4',
    'bt-remove-unselected-file': 'true'
});
assert.strictEqual(lastChangeOption.gid, 'gid-1');
assert.strictEqual(lastChangeOption.silent, true);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node test/new-task-small-file-filter.test.js`

Expected: FAIL because per-task pause override and `changeTaskOptions` do not exist.

- [ ] **Step 3: Implement per-task pause and atomic option updates**

In `aria2RpcService.addUriMulti`, replace the fixed batch value with:

```js
pauseOnAdded: angular.isDefined(task.pauseOnAdded) ? task.pauseOnAdded : context.pauseOnAdded
```

Add to `aria2TaskService` beside `setTaskOption`:

```js
changeTaskOptions: function (gid, options, callback, silent) {
    return aria2RpcService.changeOption({
        gid: gid,
        options: options,
        silent: !!silent,
        callback: callback
    });
},
```

Keep `selectTaskFile` backward compatible, but make it call `changeTaskOptions` with the generated `select-file` string. The coordinator will call `changeTaskOptions` directly so `select-file` and `bt-remove-unselected-file` are sent together.

- [ ] **Step 4: Run focused and existing tests**

Run: `node test/new-task-small-file-filter.test.js && npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit the RPC primitives**

```bash
git add src/scripts/services/aria2RpcService.js src/scripts/services/aria2TaskService.js test/new-task-small-file-filter.test.js
git commit -m "feat: add BT filter RPC primitives"
```

---

### Task 3: Pure selection planner and persistent per-RPC job queue

**Files:**
- Create: `src/scripts/services/ariaNgBtFileFilterService.js`
- Modify: `src/index.html`
- Modify: `test/new-task-small-file-filter.test.js`

**Interfaces:**
- Consumes: `ariaNgConstants.btFileFilterQueueStorageKey`, `ariaNgStorageService`, and `ariaNgSettingService.getCurrentRpcIdentity()`.
- Produces: `isBtMetadataUrl(url): boolean` for magnet and HTTP(S) `.torrent` URLs.
- Produces: `planFiles(files, thresholdBytes): {mode, selectedIndexes, allIndexes}` where mode is `filter` or `full`.
- Produces: `enqueue(rootGid, intent): void`; intent is `{thresholdBytes, startAfterFilter, sourceType}`.
- Produces: `getJobs(): Array`, `getStatus(): object`, and `start(): void` for later lifecycle work.

- [ ] **Step 1: Add failing planner, classifier, and persistence tests**

Add a factory loader for `ariaNgBtFileFilterService.js` with fake storage and fake dependencies. Add:

```js
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

    context.service.enqueue('root-1', {
        thresholdBytes: 104857600,
        startAfterFilter: true,
        sourceType: 'magnet'
    });

    const saved = context.getSavedQueue();
    assert.strictEqual(saved[0].rpcIdentity, 'http|one|6800|jsonrpc');
    assert.strictEqual(saved[0].rootGid, 'root-1');
    assert.strictEqual(saved[0].thresholdBytes, 104857600);
    assert.strictEqual(saved[0].stage, 'waiting-metadata');
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node test/new-task-small-file-filter.test.js`

Expected: FAIL because `ariaNgBtFileFilterService.js` does not exist.

- [ ] **Step 3: Implement the service skeleton, pure planner, and queue persistence**

Create an Angular factory with dependencies `$interval`, `$timeout`, `ariaNgConstants`, `ariaNgStorageService`, `ariaNgSettingService`, `ariaNgNotificationService`, `ariaNgLogService`, and `aria2TaskService`. Implement these exact pure rules:

```js
var planFiles = function (files, thresholdBytes) {
    var selectedIndexes = [];
    var allIndexes = [];

    for (var i = 0; i < files.length; i++) {
        var index = parseInt(files[i].index);
        var length = parseInt(files[i].length);
        allIndexes.push(index);
        if (length >= thresholdBytes) {
            selectedIndexes.push(index);
        }
    }

    return {
        mode: selectedIndexes.length > 0 && selectedIndexes.length < allIndexes.length ? 'filter' : 'full',
        selectedIndexes: selectedIndexes,
        allIndexes: allIndexes
    };
};
```

Classifier:

```js
var isBtMetadataUrl = function (url) {
    var normalized = String(url || '').trim();
    if (/^magnet:\?/i.test(normalized)) {
        return true;
    }
    return /^https?:\/\//i.test(normalized) && /\.torrent(?:[?#]|$)/i.test(normalized);
};
```

Persist an array at `ariaNgConstants.btFileFilterQueueStorageKey`. `enqueue` must copy scalar intent fields, set `rpcIdentity`, `rootGid`, `childGid: ''`, `stage: 'waiting-metadata'`, `retryCount: 0`, `originalRemoveUnselectedFile: null`, and timestamps. Reject duplicate `(rpcIdentity, rootGid)` pairs.

Expose a stable mutable status object initialized as:

```js
var status = {
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
};
```

Add `<script src="scripts/services/ariaNgBtFileFilterService.js"></script>` immediately after `aria2TaskService.js` in `src/index.html`.

- [ ] **Step 4: Run planner/persistence tests and lint**

Run: `node test/new-task-small-file-filter.test.js && npx gulp lint`

Expected: all focused tests PASS and lint exits 0.

- [ ] **Step 5: Commit the planner and queue**

```bash
git add src/index.html src/scripts/services/ariaNgBtFileFilterService.js test/new-task-small-file-filter.test.js
git commit -m "feat: persist BT file filter jobs"
```

---

### Task 4: Recoverable filtering state machine, cleanup, and fallback

**Files:**
- Modify: `src/scripts/services/ariaNgBtFileFilterService.js`
- Modify: `test/new-task-small-file-filter.test.js`

**Interfaces:**
- Consumes: `aria2TaskService.getTaskStatus`, `getTaskOptions`, `changeTaskOptions`, and `startTasks`.
- Produces: `start()` polls only jobs matching the current RPC identity and is idempotent.
- Produces: status transitions `resuming`, `processing`, `waiting`, `complete`, and `warning` through the stable object returned by `getStatus()`.

- [ ] **Step 1: Add failing async state-machine tests with deterministic fakes**

Use a fake interval whose registered callback can be invoked synchronously and callback-based aria2 stubs. Cover these cases:

```js
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

    assert.deepStrictEqual(context.changedOptions, {
        gid: 'child',
        options: {'select-file': '2', 'bt-remove-unselected-file': 'true'}
    });
    assert.deepStrictEqual(context.startedGids, ['child']);
    assert.strictEqual(context.getSavedQueue().length, 0);
});
```

Add separate tests asserting:

- all-small and all-large plans do not call `changeTaskOptions` and Download Now unpauses;
- Download Later never calls `startTasks` after successful filtering;
- three failed filter calls enter fallback, restore `'select-file': '1,2'` and the captured original cleanup value, then unpause only Download Now;
- a network/tellStatus failure retains the queue without consuming filter retries;
- a `GID ... is not found` response removes the job silently;
- jobs for another RPC identity remain stored and unprocessed;
- calling `start()` twice creates one interval;
- a restored queue sets the `resuming` status before processing.

- [ ] **Step 2: Run state-machine tests and verify failure**

Run: `node test/new-task-small-file-filter.test.js`

Expected: FAIL because `start()` has no processing lifecycle.

- [ ] **Step 3: Implement reconciliation and target discovery**

On each non-overlapping tick, select jobs for `getCurrentRpcIdentity()`. Resolve `job.childGid || job.rootGid` with `getTaskStatus`:

```js
if (task.bittorrent && task.files && task.files.length > 0) {
    processBtTask(job, task);
} else if (task.followedBy && task.followedBy.length > 0) {
    job.childGid = task.followedBy[0];
    job.stage = 'waiting-files';
    saveJobs();
} else {
    job.stage = 'waiting-metadata';
    saveJobs();
}
```

Do not impose a metadata timeout. Treat connection failures as retry-on-next-tick. Treat an explicit not-found error message as user deletion and remove only that job.

- [ ] **Step 4: Implement filter application, reconciliation, and safe fallback**

Before the first mixed-size change, call `getTaskOptions` and store its exact `bt-remove-unselected-file` value (default to `'false'` only when absent). Submit:

```js
{
    'select-file': plan.selectedIndexes.join(','),
    'bt-remove-unselected-file': 'true'
}
```

On success, call `startTasks([gid])` only when `job.startAfterFilter` is true, then remove the job and update aggregate counters.

On filter failure, increment and persist `retryCount`. Before each retry, fetch task status and compare `file.selected` with the target indexes. If the target is already applied, treat it as success. After the third confirmed failure, set `stage: 'restoring-full'` and repeatedly reconcile until this restoration succeeds:

```js
{
    'select-file': plan.allIndexes.join(','),
    'bt-remove-unselected-file': job.originalRemoveUnselectedFile
}
```

Only after restoration succeeds may Download Now unpause and the job be removed as a warning/fallback outcome. This makes a lost RPC response safe across reloads.

- [ ] **Step 5: Implement toolbar aggregate status and auto-hide**

Mutate, never replace, the shared `status` object. Use these keys and params:

```js
status.textKey = 'format.bt-file-filter.resuming';   // {count}
status.textKey = 'format.bt-file-filter.processing'; // {processed}, {total}
status.textKey = 'format.bt-file-filter.waiting';    // {count}
status.textKey = 'format.bt-file-filter.complete';   // {filtered}, {full}
status.textKey = 'format.bt-file-filter.fallback';   // {count}
```

Keep active/waiting states visible. Auto-hide complete and warning summaries with `$timeout` after 5000 and 10000 milliseconds respectively. For fallback, also call `ariaNgNotificationService.notifyInPage` once with warning type; never emit one notification per retry.

- [ ] **Step 6: Run state-machine tests, full tests, and lint**

Run: `node test/new-task-small-file-filter.test.js && npm test && npx gulp lint`

Expected: all tests PASS and lint exits 0.

- [ ] **Step 7: Commit the coordinator lifecycle**

```bash
git add src/scripts/services/ariaNgBtFileFilterService.js test/new-task-small-file-filter.test.js
git commit -m "feat: coordinate recoverable BT file filtering"
```

---

### Task 5: Register metadata-safe jobs from the new-task flow

**Files:**
- Modify: `src/scripts/controllers/new.js`
- Modify: `src/scripts/controllers/main.js`
- Modify: `test/new-task-small-file-filter.test.js`

**Interfaces:**
- Consumes: inherited MainController method `getBtFileFilterIntent()`.
- Consumes: `ariaNgBtFileFilterService.isBtMetadataUrl`, `enqueue`, `start`, and `getStatus`.
- Produces: candidate URI task marker `btFileFilterCandidate: true` retained in `response.context.task`.
- Produces: intent `{thresholdBytes, startAfterFilter, sourceType}` registered against each successful candidate GID.

- [ ] **Step 1: Add failing controller integration tests**

Load `NewTaskController` with stub scopes/services and assert:

```js
test('adds magnets for metadata discovery while preserving Download Later for ordinary URLs', function () {
    const context = loadNewTaskController({
        urls: 'magnet:?xt=urn:btih:abc\nhttps://host/file.iso',
        filterIntent: {enabled: true, thresholdBytes: 104857600},
        pauseOnAdded: true
    });

    context.scope.startDownload(true);

    assert.strictEqual(context.uriTasks[0].options['pause-metadata'], 'true');
    assert.strictEqual(context.uriTasks[0].pauseOnAdded, false);
    assert.strictEqual(context.uriTasks[0].btFileFilterCandidate, true);
    assert.strictEqual(context.uriTasks[1].pauseOnAdded, true);
    assert.strictEqual(context.uriTasks[1].options['pause-metadata'], undefined);
});
```

Add tests that:

- a successful magnet/remote torrent response enqueues its GID with threshold and `startAfterFilter`;
- ordinary direct-link responses are not enqueued;
- local torrent always calls `newTorrentTask(..., true, ...)` while filtering, then enqueues the returned GID with `sourceType: 'torrent'`;
- filter disabled preserves existing calls and never enqueues;
- invalid header input makes `isNewTaskValid()` false;
- MainController starts the coordinator after the first successful global-stat RPC and exposes its stable status object.

- [ ] **Step 2: Run controller tests and verify failure**

Run: `node test/new-task-small-file-filter.test.js`

Expected: FAIL because controllers do not inject or use the filter service.

- [ ] **Step 3: Add MainController filter context and startup**

Inject `ariaNgBtFileFilterService`. Initialize:

```js
$scope.btFileFilterContext = {
    enabled: ariaNgSettingService.getBtFileFilterEnabled(),
    minSizeMb: ariaNgSettingService.getBtFileFilterMinSizeMb()
};
$scope.btFileFilterStatus = ariaNgBtFileFilterService.getStatus();
```

Expose:

```js
$scope.isNewTaskPage = function () {
    return $location.path() === '/new';
};
$scope.isBtFileFilterValid = function () {
    var value = Number($scope.btFileFilterContext.minSizeMb);
    return value === Math.floor(value) && value >= 1 && value <= 102400;
};
$scope.saveBtFileFilterSetting = function () {
    ariaNgSettingService.setBtFileFilterEnabled($scope.btFileFilterContext.enabled);
    if ($scope.isBtFileFilterValid()) {
        ariaNgSettingService.setBtFileFilterMinSizeMb($scope.btFileFilterContext.minSizeMb);
    }
};
$scope.getBtFileFilterIntent = function () {
    return {
        enabled: $scope.btFileFilterContext.enabled && $scope.isBtFileFilterValid(),
        thresholdBytes: Number($scope.btFileFilterContext.minSizeMb) * 1024 * 1024
    };
};
```

In the existing successful `refreshGlobalStat` callback, call `ariaNgBtFileFilterService.start()` before refreshing the title.

- [ ] **Step 4: Integrate URI and torrent submission**

Inject `ariaNgBtFileFilterService` into `NewTaskController`. For each parsed URL, when intent is enabled and `isBtMetadataUrl(url)` is true:

```js
task.options['pause-metadata'] = 'true';
task.options.pause = 'false';
task.pauseOnAdded = false;
task.btFileFilterCandidate = true;
task.btFileFilterSourceType = /^magnet:/i.test(url) ? 'magnet' : 'remote-torrent';
```

For non-candidates set `task.pauseOnAdded = !!pauseOnAdded`, allowing mixed Download Later batches to leave ordinary files paused.

Register successful URI responses by reading `result.context.task.btFileFilterCandidate` and `result.data` from each `response.results` item. Register local torrent `response.data` directly. Use:

```js
ariaNgBtFileFilterService.enqueue(gid, {
    thresholdBytes: filterIntent.thresholdBytes,
    startAfterFilter: !pauseOnAdded,
    sourceType: sourceType
});
```

When filtering a local torrent, force `pauseOnAdded=true` for `newTorrentTask` regardless of Download Now/Later; the coordinator restores the requested state. Do not alter Metalink submission.

- [ ] **Step 5: Preserve redirect behavior and validation**

Extend `isNewTaskValid()` so a checked filter with an invalid threshold returns false. Keep the existing response callback and route choices unchanged after successful enqueue: Download Now routes to `/downloading`, Download Later to `/waiting`.

- [ ] **Step 6: Run controller tests, full tests, and lint**

Run: `node test/new-task-small-file-filter.test.js && npm test && npx gulp lint`

Expected: all tests PASS and lint exits 0.

- [ ] **Step 7: Commit new-task integration**

```bash
git add src/scripts/controllers/main.js src/scripts/controllers/new.js test/new-task-small-file-filter.test.js
git commit -m "feat: filter files in new BT tasks"
```

---

### Task 6: Toolbar control, persistent status, themes, and translations

**Files:**
- Modify: `src/index.html`
- Modify: `src/styles/core/core.css`
- Modify: `src/styles/theme/default.css`
- Modify: `src/styles/theme/default-dark.css`
- Modify: `src/scripts/config/defaultLanguage.js`
- Modify: `src/langs/zh_Hans.txt`
- Modify: `src/langs/zh_Hant.txt`
- Modify: `test/new-task-small-file-filter.test.js`

**Interfaces:**
- Consumes: `isNewTaskPage()`, `btFileFilterContext`, `isBtFileFilterValid()`, `saveBtFileFilterSetting()`, and `btFileFilterStatus` from MainController.
- Produces: route-exclusive new-task control after Help and a status region after the contextual control/File List button.

- [ ] **Step 1: Add failing markup/style/translation assertions**

Extend the regression test:

```js
test('renders the remembered filter and global toolbar status', function () {
    const index = read('src/index.html');
    const styles = read('src/styles/core/core.css') + read('src/styles/theme/default.css') + read('src/styles/theme/default-dark.css');
    const language = read('src/scripts/config/defaultLanguage.js');

    assert(index.includes('ng-if="isNewTaskPage()"'));
    assert(index.includes('ng-model="btFileFilterContext.enabled"'));
    assert(index.includes('ng-model="btFileFilterContext.minSizeMb"'));
    assert(index.includes('bt-file-filter-status'));
    assert(index.includes('btFileFilterStatus.textKey | translate: btFileFilterStatus.textParams'));
    assert(styles.includes('.bt-file-filter-toolbar'));
    assert(styles.includes('.bt-file-filter-status'));
    assert(language.includes("'Filter files smaller than'"));
    assert(language.includes("'format.bt-file-filter.resuming'"));
});
```

- [ ] **Step 2: Run UI contract test and verify failure**

Run: `node test/new-task-small-file-filter.test.js`

Expected: FAIL because toolbar markup, CSS, and language keys do not exist.

- [ ] **Step 3: Add route-aware filter markup after Help**

In the main toolbar, keep the existing task-list Files button and add this separate `/new` item:

```html
<li class="bt-file-filter-toolbar" ng-if="isNewTaskPage()">
    <label class="bt-file-filter-toggle" title="{{'BT file filter cleanup warning' | translate}}">
        <input type="checkbox" ng-model="btFileFilterContext.enabled" ng-change="saveBtFileFilterSetting()"/>
        <span translate>Filter files smaller than</span>
    </label>
    <input class="form-control bt-file-filter-size" type="number" min="1" max="102400" step="1"
           ng-model="btFileFilterContext.minSizeMb" ng-disabled="!btFileFilterContext.enabled"
           ng-change="saveBtFileFilterSetting()" ng-class="{'has-error': btFileFilterContext.enabled && !isBtFileFilterValid()}"/>
    <span class="bt-file-filter-unit">MB</span>
</li>
```

Add a following status item that is not route-limited:

```html
<li class="bt-file-filter-status" ng-if="btFileFilterStatus.visible"
    ng-class="'status-' + btFileFilterStatus.type"
    title="{{btFileFilterStatus.textKey | translate: btFileFilterStatus.textParams}}">
    <i class="fa" ng-class="{'fa-spinner fa-spin': btFileFilterStatus.type === 'processing' || btFileFilterStatus.type === 'waiting' || btFileFilterStatus.type === 'resuming', 'fa-check-circle': btFileFilterStatus.type === 'complete', 'fa-exclamation-triangle': btFileFilterStatus.type === 'warning'}"></i>
    <span class="bt-file-filter-status-full" ng-bind="btFileFilterStatus.textKey | translate: btFileFilterStatus.textParams"></span>
    <span class="bt-file-filter-status-compact" ng-bind="('format.bt-file-filter.compact' | translate: {count: btFileFilterStatus.waiting || (btFileFilterStatus.total - btFileFilterStatus.processed)})"></span>
</li>
```

- [ ] **Step 4: Add responsive and themed styling**

In `core.css`, use inline flex alignment, a 64px numeric input, no link-like hover behavior, ellipsis for the full status, and these breakpoints:

```css
.main-header .navbar .nav > li.bt-file-filter-toolbar,
.main-header .navbar .nav > li.bt-file-filter-status {
    align-items: center;
    height: 50px;
    padding: 0 10px;
}

.main-header .navbar .nav > li.bt-file-filter-toolbar { display: inline-flex; }
.main-header .bt-file-filter-toggle { margin: 0 6px 0 0; font-weight: 400; }
.main-header .bt-file-filter-toggle > input { margin: 0 6px 0 0; vertical-align: middle; }
.main-header .bt-file-filter-size { display: inline-block; width: 64px; height: 30px; padding: 4px 6px; }
.main-header .bt-file-filter-unit { margin-left: 5px; }
.main-header .navbar .nav > li.bt-file-filter-status { display: inline-flex; max-width: 360px; gap: 6px; }
.main-header .bt-file-filter-status-full { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.main-header .bt-file-filter-status-compact { display: none; }

@media (max-width: 991px) {
    .main-header .bt-file-filter-status-full { display: none; }
    .main-header .bt-file-filter-status-compact { display: inline; }
}
```

At phone widths, hide only the label text while keeping checkbox, numeric value, and MB visible. Add light-theme neutral/primary/success/warning colors in `default.css` and dark equivalents in `default-dark.css`. Invalid input uses the existing Bootstrap danger border color.

- [ ] **Step 5: Add English, Simplified Chinese, and Traditional Chinese strings**

Add default English keys:

```js
'Filter files smaller than': 'Filter files smaller than',
'format.bt-file-filter.resuming': 'Found {{count}} pending filter tasks, resuming',
'format.bt-file-filter.processing': 'Filtering files: {{processed}}/{{total}}',
'format.bt-file-filter.waiting': 'Waiting for torrent metadata: {{count}}',
'format.bt-file-filter.complete': 'File filtering complete: {{filtered}} filtered, {{full}} full downloads',
'format.bt-file-filter.fallback': '{{count}} tasks could not be filtered and use full download',
'format.bt-file-filter.compact': 'Filter {{count}}',
'BT file filter warning': 'BT file filter warning',
'BT file filter cleanup warning': 'Filtered files and same-named existing files may be deleted by aria2 after completion.',
```

Add accurate `zh_Hans.txt` and `zh_Hant.txt` values using the same keys. Other languages fall back to the default English resource, matching the existing language-loader behavior.

- [ ] **Step 6: Run UI tests, lint, and both builds**

Run: `node test/new-task-small-file-filter.test.js && npm test && npx gulp lint && npm run build && npx gulp clean build-bundle`

Expected: all tests PASS, lint exits 0, and both standard and All-In-One builds complete.

- [ ] **Step 7: Commit the complete toolbar experience**

```bash
git add src/index.html src/styles/core/core.css src/styles/theme/default.css src/styles/theme/default-dark.css src/scripts/config/defaultLanguage.js src/langs/zh_Hans.txt src/langs/zh_Hant.txt test/new-task-small-file-filter.test.js
git commit -m "style: add BT filter toolbar status"
```

---

### Task 7: End-to-end regression and release-quality verification

**Files:**
- Verify: files changed in Tasks 1–6
- Test: `test/new-task-small-file-filter.test.js`

**Interfaces:**
- Consumes: the complete filter workflow.
- Produces: verified source and generated builds; no committed `dist/` output.

- [ ] **Step 1: Run the complete automated verification from a clean generated-output state**

Run:

```bash
npx gulp clean
npm test
npx gulp lint
npm run build
npx gulp clean build-bundle
git diff --check
```

Expected: every command exits 0; `dist/index.html` exists after the bundle build; `git diff --check` prints nothing.

- [ ] **Step 2: Exercise the source build against a test aria2 RPC instance**

Run `npx gulp serve`, open `http://localhost:9000`, and verify:

1. `/new` shows the disabled `100 MB` control after Help; task-list pages show Files instead.
2. Enable `100 MB`, reload, and confirm both values persist.
3. Submit a mixed magnet batch with Download Now; metadata children pause, mixed-size tasks filter, and ordinary links remain unaffected.
4. Submit with Download Later; metadata discovery runs, filtered BT children remain paused, and ordinary links remain paused.
5. Close the page while metadata is pending, reopen it, and confirm the toolbar reports resume and processing.
6. Confirm an all-small torrent downloads completely.
7. Confirm a mixed torrent excludes small files and removes their residual files after completion.
8. Disconnect RPC during filtering, reconnect, and confirm the queue resumes without duplicate starts.

Expected: behavior matches all eight checks and the toolbar text does not overlap search at desktop width.

- [ ] **Step 3: Visually verify responsive themes**

Check light and dark themes at widths 1440px, 1024px, and 375px. Expected: full status on desktop, compact status below 992px, checkbox/value/MB remain operable at phone width, focus rings and invalid borders are visible, and no horizontal header overflow is introduced.

- [ ] **Step 4: Confirm only intentional source changes remain**

Run: `git status --short && git diff --stat HEAD`

Expected: generated `dist/`/`.tmp/` are absent or ignored; no unrelated files such as `AGENTS.md` or `.superpowers/` are staged.

- [ ] **Step 5: Commit any verification-only corrections**

If Steps 1–4 required code corrections, rerun the complete command set and commit only those corrections:

```bash
git add src test package.json
git commit -m "fix: harden BT file filter workflow"
```

If no corrections were needed, do not create an empty commit.
