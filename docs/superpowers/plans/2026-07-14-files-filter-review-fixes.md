# Files and BT Filter Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the remaining task-file-list and BT-filter conflicts while reducing idle Angular and DOM work without expanding the feature architecture.

**Architecture:** Keep the automatic and bulk persisted workflows separate, but make their existing single-flight scheduler alternate fairly. Add one persisted bulk pause-ownership boolean so user pauses are preserved, derive row copy from the existing outcome, and apply two AngularJS rendering optimizations without changing the five-second data refresh.

**Tech Stack:** AngularJS 1.6, aria2 JSON-RPC, Node assertion harnesses, Gulp, Playwright

---

### Task 1: Fix coordinator lifecycle, scheduling fairness, and idle digest work

**Files:**
- Modify: `src/scripts/services/ariaNgBtFileFilterService.js:1950-2147`

- [ ] **Step 1: Make the existing scheduler alternate work**

Remove the early `bulkProgress.current` branch from `tick()`. Keep the automatic branch first when `automaticJobTurn` is true, then use one bulk branch for both a new and an in-flight bulk item. Before dispatching a bulk tick, set the next turn back to automatic when automatic jobs exist:

```js
if (currentJobs.length > 0 && (!bulkDefinition || !bulkProgress || automaticJobTurn)) {
    tickInProgress = true;
    activeOperation = operation;
    if (bulkDefinition && bulkProgress) {
        automaticJobTurn = false;
    }
    // existing round-robin automatic getTaskStatus chain
    return;
}
if (bulkDefinition && bulkProgress) {
    automaticJobTurn = currentJobs.length > 0;
    tickInProgress = true;
    activeOperation = operation;
    processBulkTick(bulkDefinition, bulkProgress, operation);
}
```

This preserves a single RPC chain in flight and alternates automatic/bulk chains while both exist.

- [ ] **Step 2: Avoid idle Angular digests**

Create the coordinator interval with `invokeApply=false`:

```js
pollingPromise = $interval(tick, pollingInterval, 0, false);
```

RPC callbacks continue through the existing Angular promise/RPC services, so visible mutations still enter Angular's async lifecycle.

- [ ] **Step 3: Hide all stopped-service badges**

At the beginning of `buildPendingGidStageMap()`, return the fresh empty map when `pollingPromise` is absent. Do not delete persisted jobs:

```js
var map = {};
if (!pollingPromise) {
    return map;
}
```

- [ ] **Step 4: Run syntax and diff checks**

Run:

```bash
node --check src/scripts/services/ariaNgBtFileFilterService.js
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the coordinator changes**

```bash
git add src/scripts/services/ariaNgBtFileFilterService.js
git commit -m "fix: coordinate BT filter work fairly"
```

### Task 2: Preserve user pauses and report the right resume state

**Files:**
- Modify: `src/scripts/services/ariaNgBtFileFilterService.js:188-229`
- Modify: `src/scripts/services/ariaNgBtFileFilterService.js:1517-1897`
- Modify: `src/scripts/services/ariaNgBtFileFilterService.js:1905-1917`
- Modify: `src/scripts/services/ariaNgBtFileFilterService.js:2131-2143`

- [ ] **Step 1: Persist pause ownership**

Add `pauseOwned` to sanitized/current bulk checkpoints. Old `pausing` and `resuming` checkpoints are treated as coordinator-owned so an interrupted older run can still resume:

```js
pauseOwned: current.pauseOwned === true || current.stage === 'pausing' || current.stage === 'resuming'
```

New `inspecting` checkpoints initialize it to `false`, and initial inspection resets it to `false` before the first mutation.

- [ ] **Step 2: Claim ownership before force-pause**

In `requestBulkPause()`, set and persist `current.pauseOwned = true` before `pauseTasks()` is called. If persistence fails, restore the previous boolean along with the retry fields so the service never claims a pause it did not safely checkpoint.

- [ ] **Step 3: Preserve an observed user pause**

In `inspectBulkOptions()`:

- When the expected selection and cleanup value are stable, call `beginBulkResume()` only when `task.status === 'paused' && current.pauseOwned`; otherwise settle the actual outcome and leave a user-paused task paused.
- When an `applying` mutation has not converged and the task is paused without ownership, enter restoration while paused instead of calling unpause.
- When a `restoring` mutation has not converged and the task is paused without ownership, retry exact restoration while paused.
- Keep the existing restart/resume behavior for coordinator-owned pauses.

No cancellation queue or manual-pause event listener is added.

- [ ] **Step 4: Derive the resume badge from the outcome**

Change the bulk stage mapping so `resuming` is handled after the static map:

```js
var stage = bulkProgress.current.stage === 'resuming' ?
    (bulkProgress.current.resumeOutcome === 'filtered' ? 'starting-filtered' : 'starting-full') :
    bulkStageMap[bulkProgress.current.stage];
```

- [ ] **Step 5: Run syntax and diff checks**

Run:

```bash
node --check src/scripts/services/ariaNgBtFileFilterService.js
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit pause ownership and status changes**

```bash
git add src/scripts/services/ariaNgBtFileFilterService.js
git commit -m "fix: preserve pauses during bulk filtering"
```

### Task 3: Reuse task and file DOM across full refreshes

**Files:**
- Modify: `src/views/list.html:88`
- Modify: `src/views/list.html:157`

- [ ] **Step 1: Add a stable task identity**

Use the aria2 GID for the outer row:

```html
ng-repeat="task in taskContext.list | filter: filterTask | taskOrderBy: getOrderType() track by task.gid"
```

- [ ] **Step 2: Add stable file and directory identities**

Use the 1-based file index for real files and node path for virtual directories:

```html
ng-repeat="file in task.files | fileOrderBy: getTaskListFileListOrderType(task) track by (file.isDir ? ('dir:' + file.nodePath) : ('file:' + file.index))"
```

- [ ] **Step 3: Run template and diff checks**

Run:

```bash
rg -n "track by task.gid|track by \(file.isDir" src/views/list.html
git diff --check
```

Expected: two matching template lines and no whitespace errors.

- [ ] **Step 4: Commit the rendering optimization**

```bash
git add src/views/list.html
git commit -m "perf: reuse task file list rows"
```

### Task 4: Update maintenance facts and the SDD gate log

**Files:**
- Modify: `.claude/skills/bt-filter-dev/SKILL.md`
- Modify: `.superpowers/sdd/progress.md`
- Modify: `docs/prd/bt-filter-improvement.md`

- [ ] **Step 1: Reconcile the maintenance guide**

Keep the already drafted real-aria2 convergence and stale-`.tmp` facts. Add the scheduler alternation contract, stopped-map guard, pause-ownership behavior, and no-digest interval fact. Do not change the 1-based index or deletion-timing facts.

- [ ] **Step 2: Update the PRD**

Record that RPC `OK` is not convergence, list the `pausing`/`resuming` checkpoints, and state that user pauses win over automatic resume. Correct the earlier sentence claiming this round does not change execution behavior.

- [ ] **Step 3: Update progress evidence**

Record the real false-success reproduction, actual selection convergence, stale `.tmp` browser trap, review findings, and the implementation commits. Do not claim the release gates have run.

- [ ] **Step 4: Self-check documentation**

Run:

```bash
rg -n "RPC OK|pauseOwned|automatic|bulk|\.tmp|track by" .claude/skills/bt-filter-dev/SKILL.md .superpowers/sdd/progress.md docs/prd/bt-filter-improvement.md
git diff --check
```

Expected: the new contracts are findable and the diff has no whitespace errors.

- [ ] **Step 5: Commit documentation**

```bash
git add .claude/skills/bt-filter-dev/SKILL.md .superpowers/sdd/progress.md docs/prd/bt-filter-improvement.md
git commit -m "docs: record files and filter review fixes"
```

### Task 5: Verify current behavior in the browser and real aria2

**Files:**
- No tracked-file changes

- [ ] **Step 1: Start a clean source preview**

Stop the existing preview, then run:

```bash
npx gulp clean
npx gulp serve
```

Confirm the browser loads individual `scripts/...` resources rather than a stale `.tmp/js/aria-ng-*.min.js` bundle.

- [ ] **Step 2: Run Playwright UI acceptance**

Check Files closed/open, bulk ready/running/complete, concurrent automatic/bulk badges, correct restoration-resume copy, route changes, and 375 px light/dark layouts. Capture console, page, and failed-request errors; expected arrays are empty.

- [ ] **Step 3: Run the approved real mutation**

Using the connected aria2 instance and the previously approved re-selection procedure:

1. Select one known sub-100 MB file together with its retained large file.
2. Run bulk filtering at 100 MB.
3. Verify actual `files[].selected` changed back to the large-file-only set.
4. Verify `bt-remove-unselected-file` matches the intended cleanup behavior.
5. Verify a coordinator-paused task resumes, while a separately user-paused task remains paused.
6. Verify the final UI counts match the actual file delta.

- [ ] **Step 4: Record verification without adding broad tests**

Append the concrete Playwright and aria2 observations to `.superpowers/sdd/progress.md`. Defer new regression-test implementation and full `npm test`/lint/build gates to the release-preparation task as explicitly requested by the maintainer.

- [ ] **Step 5: Commit the verification log**

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs: record real files filter verification"
```
