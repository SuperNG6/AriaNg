# BT Bulk Filter Pause and Reconcile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bulk BT file filtering pause active tasks, verify aria2's real file selection before reporting success, restore failed mutations, and resume the original downloads.

**Architecture:** Keep the existing single-item persisted bulk checkpoint and add only the `pausing` and `resuming` lifecycle states around the existing `applying`/`restoring` states. Every RPC callback merely releases the coordinator tick; later `tellStatus`/`getOption` reads decide whether state converged. Automatic new-task filtering remains unchanged.

**Tech Stack:** AngularJS 1.6 service/controller code, aria2 JSON-RPC through `aria2TaskService`, Node `assert` VM regression tests, Gulp, Playwright with a real aria2 instance.

---

## File map

- Modify `src/scripts/services/ariaNgBtFileFilterService.js`: bulk pause/apply/reconcile/restore/resume state machine and checkpoint sanitizer.
- Modify `test/new-task-small-file-filter.test.js`: realistic aria2 mock behavior and all bulk state-machine regressions.
- Modify `.claude/skills/bt-filter-dev/SKILL.md`: document that automatic filtering receives a paused child while bulk filtering must pause active payload tasks itself.
- Modify `docs/prd/bt-filter-improvement.md`: correct the bulk execution contract and acceptance criteria.
- Modify `.superpowers/sdd/progress.md`: record real-environment discovery and fresh gates.
- Create `.superpowers/sdd/2026-07-14-files-filter-review.md`: scoped post-fix code-review report for fork-added Files/filter functionality.

### Task 1: Make the regression harness model real aria2 convergence

**Files:**
- Modify: `test/new-task-small-file-filter.test.js:245-470`

- [ ] **Step 1: Add a controllable clock and mutation controls to the service harness**

Add these harness variables before evaluating the service:

```js
let now = typeof options.now === 'number' ? options.now : 1000;
const pendingPauseCallbacks = [];
```

Expose the clock to the VM:

```js
vm.runInNewContext(read('src/scripts/services/ariaNgBtFileFilterService.js'), {
    angular: {
        module: function () { return module; }
    },
    Date: {now: function () { return now; }}
});
```

Change successful option mutation so a test can return `OK` without changing server state:

```js
const applySuccessfulChange = response.success && options.applySuccessfulChanges !== false;
if ((applySuccessfulChange || applyFailedChange) && tasks[gid] && rpcOptions['select-file']) {
    // Existing task file and option mutation body.
}
```

Allow delayed pause callbacks while preserving existing defaults:

```js
if (options.deferPause) {
    pendingPauseCallbacks.push({callback: callback, response: response});
} else {
    callback(response);
}
```

Return these controls from `loadFilterService`:

```js
setNow: function (value) { now = value; },
advanceNow: function (milliseconds) { now += milliseconds; },
resolvePause: function (response) {
    const pending = pendingPauseCallbacks.shift();
    pending.callback(response || pending.response);
}
```

- [ ] **Step 2: Run the existing service suite to prove the harness is behavior-neutral**

Run: `node test/new-task-small-file-filter.test.js`

Expected: all existing tests pass because the new controls default to the previous immediate behavior.

- [ ] **Step 3: Commit the harness change**

```bash
git add test/new-task-small-file-filter.test.js
git commit -m "test: model delayed aria2 bulk mutations"
```

### Task 2: Require pause before the first bulk mutation

**Files:**
- Modify: `test/new-task-small-file-filter.test.js:2900-3060`
- Modify: `src/scripts/services/ariaNgBtFileFilterService.js:19,170-220,1460-1730`

- [ ] **Step 1: Replace the obsolete no-pause expectation with a failing lifecycle test**

Replace `processes a bulk run one task at a time without pausing active downloads` with a test named `pauses each active bulk task before changing its file selection`:

```js
test('pauses each active bulk task before changing its file selection', function () {
    const task = createActiveBtPayload('one', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const context = loadFilterService({
        tasks: {one: task},
        taskOptions: {one: {'bt-remove-unselected-file': 'false'}},
        deferPause: true
    });

    context.service.enqueueBulk(['one'], 100);
    context.service.start();
    context.tick();

    assert.deepStrictEqual(context.pausedGids, ['one']);
    assert.deepStrictEqual(context.changedOptions, []);
    assert.strictEqual(context.getSavedBulkProgresses()[0].current.stage, 'pausing');

    context.resolvePause();
    context.tick();
    assert.deepStrictEqual(context.changedOptions, [{gid: 'one', options: {
        'select-file': '2', 'bt-remove-unselected-file': 'true'
    }}]);
});
```

- [ ] **Step 2: Run the focused test file and verify RED**

Run: `node test/new-task-small-file-filter.test.js`

Expected: FAIL because the current service calls `changeTaskOptions` immediately, never calls `pauseTasks`, and stores `stage=applying`.

- [ ] **Step 3: Extend checkpoint sanitization for pause/resume state**

Use these allowed stages:

```js
var allowedBulkStages = ['inspecting', 'pausing', 'applying', 'restoring', 'resuming'];
```

Add normalized checkpoint fields:

```js
pauseRetryCount: normalizeInteger(current.pauseRetryCount, 0),
pauseRequestedAt: normalizeInteger(current.pauseRequestedAt, 0),
resumeRetryCount: normalizeInteger(current.resumeRetryCount, 0),
resumeOutcome: current.resumeOutcome === 'filtered' ? 'filtered' : 'failed'
```

Do not require `resumeOutcome` outside `resuming`. Continue requiring original/target selection and cleanup fields for every stage except `inspecting`.

- [ ] **Step 4: Add one persisted pause request helper**

Add constants and a helper near the bulk functions:

```js
var bulkPauseRetryDelay = 30000;
var bulkMutationRetryLimit = 3;

var requestBulkPause = function (definition, progress, rpcIdentity) {
    var current = progress.current;
    if (current.pauseRetryCount >= bulkMutationRetryLimit) {
        settleBulkCurrent(definition, progress, 'failed', rpcIdentity);
        return;
    }
    current.pauseRetryCount++;
    current.pauseRequestedAt = Date.now();
    if (!saveBulkProgresses()) {
        finishBulkTick(rpcIdentity);
        return;
    }
    updateBulkRunningStatus();
    aria2TaskService.pauseTasks([current.gid], function () {
        if (!isBulkRunOnCurrentRpc(definition, progress, rpcIdentity)) {
            finishBulkTick(rpcIdentity);
            return;
        }
        finishBulkTick(rpcIdentity);
    }, true);
};
```

The helper deliberately does not treat the callback as proof of paused state.

- [ ] **Step 5: Transition inspection into pausing**

In `applyBulkInspection`, persist the immutable plan, initialize the new counters, set `current.stage='pausing'`, save, then call `requestBulkPause`. Remove the direct `applyBulkOptions` call.

In the pausing branch, only change to `applying` when a later `tellStatus` returns `paused`. If the task remains active/waiting and fewer than 30 seconds elapsed, call `finishBulkTick`; after the delay, call `requestBulkPause` again.

- [ ] **Step 6: Map pausing to the existing badge copy**

Extend `bulkStageMap` without adding an i18n key:

```js
pausing: 'applying-filter',
applying: 'applying-filter'
```

- [ ] **Step 7: Run the focused suite and verify GREEN**

Run: `node test/new-task-small-file-filter.test.js`

Expected: the new pause-before-mutation test passes; adjust existing bulk tests only where they asserted the obsolete absence of pause calls.

- [ ] **Step 8: Commit the pause lifecycle**

```bash
git add src/scripts/services/ariaNgBtFileFilterService.js test/new-task-small-file-filter.test.js
git commit -m "fix: pause active tasks before bulk filtering"
```

### Task 3: Reconcile real selection before reporting filtered

**Files:**
- Modify: `test/new-task-small-file-filter.test.js:2900-3375`
- Modify: `src/scripts/services/ariaNgBtFileFilterService.js:1500-1715`

- [ ] **Step 1: Add the real `OK`-without-effect regression**

```js
test('does not report filtered when aria2 returns OK without applying select-file', function () {
    const task = createActiveBtPayload('bulk', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const context = loadFilterService({
        tasks: {bulk: task},
        taskOptions: {bulk: {'bt-remove-unselected-file': 'false'}},
        applySuccessfulChanges: false
    });

    context.service.enqueueBulk(['bulk'], 100);
    context.service.start();
    context.tickMany(12);

    assert.strictEqual(context.service.getBulkStatus().filtered, 0);
    assert.notStrictEqual(context.service.getBulkStatus().type, 'complete');
    assert(context.changedOptions.length >= 1);
});
```

- [ ] **Step 2: Run the focused suite and verify RED**

Run: `node test/new-task-small-file-filter.test.js`

Expected: FAIL because `applyBulkOptions` currently calls `settleBulkCurrent(..., 'filtered')` immediately on `OK`.

- [ ] **Step 3: Make apply callbacks release the tick only**

Change the successful callback in `applyBulkOptions` to:

```js
if (isSuccessfulResponse(response)) {
    finishBulkTick(rpcIdentity);
} else if (isNotFoundResponse(response)) {
    settleBulkCurrent(definition, progress, 'skipped', rpcIdentity);
} else {
    finishBulkTick(rpcIdentity);
}
```

The next coordinator tick must call `tellStatus` and `getOption`. Keep the existing target comparison but replace immediate filtered settlement with `beginBulkResume(..., 'filtered')`.

- [ ] **Step 4: Add a persisted resume transition**

```js
var beginBulkResume = function (definition, progress, outcome, rpcIdentity) {
    var current = progress.current;
    current.stage = 'resuming';
    current.resumeOutcome = outcome;
    current.resumeRetryCount = 0;
    if (!saveBulkProgresses()) {
        finishBulkTick(rpcIdentity);
        return;
    }
    updateBulkRunningStatus();
    requestBulkResume(definition, progress, rpcIdentity);
};
```

`requestBulkResume` increments `resumeRetryCount`, persists, and calls `startTasks`. Its callback releases the tick only. A later `tellStatus` settles `resumeOutcome` only after status is no longer `paused`; after three unsuccessful unpause requests, settle failed.

- [ ] **Step 5: Add a complete happy-path reconciliation test**

The test must assert this order for one task:

```text
pauseTasks → tellStatus(paused) → changeTaskOptions → tellStatus/getOption(target)
→ startTasks → tellStatus(active) → filtered=1
```

Assert `filteredFiles` matches the real number of newly unselected files and the task finishes active.

- [ ] **Step 6: Run the focused suite and verify GREEN**

Run: `node test/new-task-small-file-filter.test.js`

Expected: the fake-OK test remains running/retrying instead of reporting filtered; the happy path reports one filtered task only after selection and resume reconciliation.

- [ ] **Step 7: Commit reconciliation**

```bash
git add src/scripts/services/ariaNgBtFileFilterService.js test/new-task-small-file-filter.test.js
git commit -m "fix: reconcile bulk file selection before success"
```

### Task 4: Restore failures and resume downloads

**Files:**
- Modify: `test/new-task-small-file-filter.test.js:3200-3390`
- Modify: `src/scripts/services/ariaNgBtFileFilterService.js:1540-1715`

- [ ] **Step 1: Add a failing restore-and-resume regression**

Create a paused server task whose target mutation stays partially applied for three attempts. Assert that the fourth mutation restores exact original indexes and original cleanup, then `startTasks` is called, final status is active, and the item is counted failed rather than filtered.

Use explicit assertions:

```js
assert.deepStrictEqual(context.changedOptions.slice(-1)[0], {
    gid: 'partial',
    options: {'select-file': '1,2', 'bt-remove-unselected-file': 'false'}
});
assert.deepStrictEqual(context.startedGids, ['partial']);
assert.strictEqual(context.service.getBulkStatus().failed, 1);
assert.strictEqual(context.service.getBulkStatus().filtered, 0);
assert.strictEqual(task.status, 'active');
```

- [ ] **Step 2: Run the focused suite and verify RED**

Run: `node test/new-task-small-file-filter.test.js`

Expected: FAIL because restoration currently settles failed directly on RPC `OK` and never resumes the newly paused bulk task.

- [ ] **Step 3: Reconcile restoration before resume**

Change `restoreBulkOptions` success handling to `finishBulkTick`. In the restoring inspection branch:

```js
if (sameIndexes(task.files, current.originalSelectedIndexes) &&
    getOptionValue(options, 'bt-remove-unselected-file', 'false') ===
        current.originalRemoveUnselectedFile) {
    beginBulkResume(definition, progress, 'failed', rpcIdentity);
} else if (current.restoreRetryCount >= bulkMutationRetryLimit) {
    beginBulkResume(definition, progress, 'failed', rpcIdentity);
} else {
    restoreBulkOptions(definition, progress, task, options, rpcIdentity);
}
```

If applying/restoring observes the task outside paused before convergence, request pause and retain the same stage; never write selection while active.

- [ ] **Step 4: Cover unpause failure**

Add a test with three unsuccessful `startTasks` responses. It must finish the item as failed, continue the next queued item, and never count the first item filtered even if its target selection was applied.

- [ ] **Step 5: Run the focused suite and verify GREEN**

Run: `node test/new-task-small-file-filter.test.js`

Expected: restoration and unpause failure tests pass; existing automatic filter tests remain unchanged.

- [ ] **Step 6: Commit failure recovery**

```bash
git add src/scripts/services/ariaNgBtFileFilterService.js test/new-task-small-file-filter.test.js
git commit -m "fix: restore and resume failed bulk tasks"
```

### Task 5: Prove persisted recovery and RPC isolation

**Files:**
- Modify: `test/new-task-small-file-filter.test.js:3000-3500`
- Modify: `src/scripts/services/ariaNgBtFileFilterService.js:170-220,1600-1805`

- [ ] **Step 1: Add checkpoint reload tests**

Create one saved checkpoint for each `pausing`, `applying`, `restoring`, and `resuming` stage. Verify:

- pausing + active waits until the persisted 30-second retry deadline, then sends one pause request;
- applying + paused + target state begins resume without another mutation;
- applying + active requests pause rather than mutating;
- restoring + original state begins failed resume without another restore mutation;
- resuming + active settles its stored outcome without another `startTasks` call.

- [ ] **Step 2: Verify RED**

Run: `node test/new-task-small-file-filter.test.js`

Expected: unknown stages are discarded or current code performs immediate mutation/settlement.

- [ ] **Step 3: Complete sanitizer compatibility**

Ensure missing counters normalize to zero. For legacy `stage='applying'` checkpoints, retain the saved target/original fields; the first status read decides whether to pause, resume, retry, or restore. Do not add a storage schema version.

- [ ] **Step 4: Extend RPC-switch callback tests**

For deferred pause, change, restore, and start callbacks:

1. start operation on RPC A;
2. switch the harness identity to RPC B;
3. resolve A's callback;
4. assert no additional mutation/start RPC is issued against B and B storage is untouched.

- [ ] **Step 5: Run focused suite and verify GREEN**

Run: `node test/new-task-small-file-filter.test.js`

Expected: all checkpoint and endpoint-isolation tests pass.

- [ ] **Step 6: Commit recovery coverage**

```bash
git add src/scripts/services/ariaNgBtFileFilterService.js test/new-task-small-file-filter.test.js
git commit -m "test: cover bulk pause recovery and RPC isolation"
```

### Task 6: Update maintenance documentation and SDD evidence

**Files:**
- Modify: `.claude/skills/bt-filter-dev/SKILL.md`
- Modify: `docs/prd/bt-filter-improvement.md`
- Modify: `.superpowers/sdd/progress.md`

- [ ] **Step 1: Correct the aria2 maintenance contract**

Document these separate cases:

```text
Automatic filtering: pause-metadata keeps the payload child paused before select-file.
Bulk filtering: candidates are active payload tasks, so the service must forcePause,
observe paused, apply and reconcile select-file, then unpause the original download.
RPC OK is request acceptance, not proof that files.selected converged.
```

- [ ] **Step 2: Update PRD behavior and acceptance**

Replace statements that bulk filtering does not pause active downloads. Add the real acceptance requirement that completion counts equal post-RPC `tellStatus` changes and no processed task remains paused.

- [ ] **Step 3: Update the progress gate log**

Record the real 5-task/32-file false-success reproduction, the corrected state machine, the test commands, and the real-browser outcome. Do not mark real acceptance passed until Task 7 succeeds.

- [ ] **Step 4: Run documentation checks**

Run: `git diff --check`

Expected: exit 0.

- [ ] **Step 5: Commit docs**

```bash
git add .claude/skills/bt-filter-dev/SKILL.md docs/prd/bt-filter-improvement.md .superpowers/sdd/progress.md
git commit -m "docs: record reconciled bulk filtering contract"
```

### Task 7: Run automated and real-environment acceptance

**Files:**
- No production edits unless a failing regression first demonstrates a scoped defect.
- Modify `.superpowers/sdd/progress.md` only after evidence is collected.

- [ ] **Step 1: Run all automated gates**

Run each command separately:

```bash
npm test
npx gulp lint
npx gulp clean build
npx gulp clean build-bundle
git diff --check
```

Expected: all exit 0. Upstream Browserslist and Node deprecation warnings are permitted; test failures are not.

- [ ] **Step 2: Run Playwright RPC-mock acceptance**

Verify ready, three-line confirmation, automatic/bulk concurrency, current-row badge, pause/apply/resume progress, Files open/closed, route switching, five-second completion, and 375 px light/dark layouts. Assert no console or request errors.

- [ ] **Step 3: Prepare a safe real aria2 candidate**

Query the real 100 MB preview. If no candidate exists, stop and request explicit permission before reselecting files on one still-active previously filtered task, or use a dedicated disposable test torrent. Record original status, indexes, and cleanup before mutation.

- [ ] **Step 4: Execute real bulk filtering**

Use Playwright through the configured Chrome session. Capture RPC/UI checkpoints and assert:

```text
candidate active → pause requested → paused observed → target selection observed
→ unpause requested → active/waiting observed → filtered completion
```

Compare UI `filtered`/`filteredFiles` with `tellStatus` changes. Confirm original manual exclusions and large selections are unchanged, cleanup is correct, and no task remains paused.

- [ ] **Step 5: Update progress with fresh evidence and commit**

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs: record real bulk filter acceptance"
```

### Task 8: Review all fork-added Files and filtering functionality

**Files:**
- Create: `.superpowers/sdd/2026-07-14-files-filter-review.md`
- Inspect: `src/scripts/controllers/list.js`
- Inspect: `src/scripts/controllers/main.js`
- Inspect: `src/scripts/controllers/new.js`
- Inspect: `src/scripts/services/ariaNgBtFileFilterService.js`
- Inspect: `src/scripts/services/aria2TaskService.js`
- Inspect: `src/views/list.html`
- Inspect: `src/index.html`
- Inspect: `src/styles/controls/task-table.css`
- Inspect: `src/styles/core/core.css`
- Inspect: `src/styles/theme/default.css`
- Inspect: `src/styles/theme/default-dark.css`
- Inspect: `test/task-list-file-list.test.js`
- Inspect: `test/new-task-small-file-filter.test.js`
- Inspect: `test/bt-filter-pending-badge.test.js`
- Inspect: `test/i18n-contract.test.js`

- [ ] **Step 1: Review Files refresh correctness**

Trace basic/full refresh ordering, stale response protection, 30-second watchdog, route changes, Files toggle, virtual-node rebuilding, selection preservation, and preview freshness. Record only fork-added defects.

- [ ] **Step 2: Review automatic filter invariants**

Trace magnet root/child recovery across waiting and active, local/remote torrent pause intent, 1-based indexes, option restoration, RPC switching, persistence, teardown, and notification aggregation.

- [ ] **Step 3: Review bulk filter invariants**

Trace every persisted stage through success, failure, reload, stop, Unauthorized, RPC switch, disappearing task, and automatic-job adoption. Confirm no path counts filtered before real reconciliation or deliberately leaves an original active task paused.

- [ ] **Step 4: Review UI and i18n conflicts**

Check toolbar priority, rail/global duplication, task badges, threshold snapshot, completion lifetime, confirmation text, light/dark/mobile layout, English/Simplified Chinese development keys, and release-only all-language blocking.

- [ ] **Step 5: Review test quality against real behavior**

Identify tests that only assert an RPC callback and replace any false-success assumption with state reconciliation assertions. Do not add tests for upstream behavior or low-probability defensive branches without evidence.

- [ ] **Step 6: Write the report**

For each finding include severity, file/line, evidence, user impact, and disposition. If a Blocker or Important finding is discovered, reproduce it with a failing regression before modifying production code, then rerun Task 7 gates. Minor findings may remain documented when fixing them would increase maintenance cost.

- [ ] **Step 7: Commit the review report**

```bash
git add .superpowers/sdd/2026-07-14-files-filter-review.md
git commit -m "docs: review Files and BT filter additions"
```

### Task 9: Final verification and branch handoff

**Files:**
- Verify all files changed by Tasks 1-8.

- [ ] **Step 1: Run fresh final gates**

```bash
npm test
npx gulp lint
npx gulp clean build
npx gulp clean build-bundle
git diff --check
```

Expected: all exit 0.

- [ ] **Step 2: Confirm the intentional release-only blocker**

Run: `npm run test:i18n-release`

Expected during development: non-zero because the nine non-Chinese locale files are intentionally deferred until release. Confirm the first failure is a BT-filter key/copy mismatch, not a script crash.

- [ ] **Step 3: Inspect branch state**

Run:

```bash
git status --short
git log --oneline --decorate -10
```

Expected: no uncommitted source changes; commits are focused and conventional.

- [ ] **Step 4: Hand off evidence**

Summarize the real bug, state-machine fix, test counts, builds, Playwright mock/real results, review findings, intentional translation blocker, and any documented Minor issue. Do not claim real acceptance unless the recorded `tellStatus`/`getOption` evidence is fresh.
