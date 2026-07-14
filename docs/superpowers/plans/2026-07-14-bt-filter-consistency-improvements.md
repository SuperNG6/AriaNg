# BT Filter Consistency Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed BT-filter status, copy, threshold, badge, completion, and development-i18n inconsistencies without merging the automatic and bulk executors.

**Architecture:** Keep both existing persisted state machines unchanged. Derive a small amount of transient presentation data from the existing bulk definition/progress, give visible bulk status priority over automatic toolbar status, and keep browser-visible behavior as the primary acceptance signal. Add only focused behavior tests for file/task mutations and lifecycle results.

**Tech Stack:** AngularJS 1.6, Node `assert` VM harnesses, Gulp, Playwright browser inspection, aria2 JSON-RPC.

**Execution status (2026-07-14):** Tasks 1–6 are complete for development. The release-only all-language check intentionally remains blocked until copy freeze, as specified in Task 5.

---

## File map

- `src/scripts/services/ariaNgBtFileFilterService.js`: derive current bulk GID/stage/threshold, merge bulk task badge mapping, and own the five-second completion lifecycle.
- `src/scripts/controllers/main.js`: expose the simple bulk-over-automatic toolbar visibility rule.
- `src/scripts/controllers/list.js`: keep the completion preview stale until a fresh full response, without clearing the completion notice.
- `src/index.html`: render only the status selected by the visibility rule and include the bulk threshold snapshot in global progress.
- `src/views/list.html`: simplify pre-action copy, disable the running threshold input, show the run snapshot, and move scope/risk details to confirmation.
- `src/scripts/config/defaultLanguage.js`, `src/langs/zh_Hans.txt`: update development-stage English and Simplified Chinese copy only.
- `test/new-task-small-file-filter.test.js`: focused service behavior regressions.
- `test/task-list-file-list.test.js`: focused controller behavior; remove touched string-presence assertions.
- `test/i18n-contract.test.js`: daily English/Simplified-Chinese structural contract and optional release-wide contract.
- `package.json`, `.github/workflows/release.yml`: add the release-only full-language command.
- `AGENTS.md`, `docs/prd/bt-small-file-filter.md`: align maintenance facts and staged translation policy.

### Task 1: Lock the confirmed service behavior with minimal regressions

**Files:**
- Modify: `test/new-task-small-file-filter.test.js`
- Modify: `test/task-list-file-list.test.js`

- [ ] **Step 1: Add one bulk-presentation behavior test**

Add a service test that starts a two-file active BT task with a deferred `changeOption`, then asserts the observable presentation result:

```js
test('exposes the current bulk task, stage, and immutable threshold while applying', function () {
    const task = createActiveBtPayload('bulk', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const context = loadFilterService({tasks: {bulk: task}, deferChange: true});

    context.service.enqueueBulk(['bulk'], 100);
    context.service.start();
    context.tick();

    assert.strictEqual(context.service.getBulkStatus().currentGid, 'bulk');
    assert.strictEqual(context.service.getBulkStatus().currentStage, 'applying');
    assert.strictEqual(context.service.getBulkStatus().thresholdBytes, 100);
    assert.strictEqual(context.service.getPendingGidStageMap().bulk, 'applying-filter');
});
```

- [ ] **Step 2: Update the existing completion test to require idle after five seconds**

Replace the old expectation that completion remains `type === 'complete'` after hiding:

```js
context.timeouts[context.timeouts.length - 1].callback();
assert.strictEqual(context.service.getBulkStatus().visible, false);
assert.strictEqual(context.service.getBulkStatus().type, 'idle');
```

- [ ] **Step 3: Add one controller regression for fresh-response behavior**

Adjust the completion-refresh test so a successful full response refreshes the preview but leaves `bulkStatus.type === 'complete'` until its service timer expires. Do not add template-string assertions.

- [ ] **Step 4: Run focused tests and confirm the new expectations fail**

Run:

```bash
node test/new-task-small-file-filter.test.js
node test/task-list-file-list.test.js
```

Expected: failures for missing bulk presentation fields/mapping and premature completion clearing.

- [ ] **Step 5: Commit the focused regressions**

```bash
git add test/new-task-small-file-filter.test.js test/task-list-file-list.test.js
git commit -m "test: cover BT filter status consistency"
```

### Task 2: Derive bulk presentation state without changing persistence

**Files:**
- Modify: `src/scripts/services/ariaNgBtFileFilterService.js`
- Test: `test/new-task-small-file-filter.test.js`

- [ ] **Step 1: Extend only the transient bulk status object**

Add non-persisted fields:

```js
currentGid: '',
currentStage: '',
thresholdBytes: 0
```

Reset them in `setBulkIdleStatus()`. In `updateBulkRunningStatus()`, derive them from `definition.thresholdBytes` and `progress.current`.

- [ ] **Step 2: Keep transient fields current at meaningful stage transitions**

Call `updateBulkRunningStatus()` after a current item is durably created as `inspecting`, after it enters `applying`, and after it enters `restoring`. Do not add new storage writes.

- [ ] **Step 3: Add the current bulk GID to the existing badge map**

Extend `buildPendingGidStageMap()` from the current RPC's bulk progress:

```js
var bulkProgress = findBulkProgress(getCurrentRpcIdentity());
if (bulkProgress && bulkProgress.current) {
    var bulkStageMap = {
        inspecting: 'bulk-inspecting',
        applying: 'applying-filter',
        restoring: 'restoring-full'
    };
    map[bulkProgress.current.gid] = bulkStageMap[bulkProgress.current.stage];
}
```

Automatic ownership already excludes the same GID from bulk execution; do not add another lock.

- [ ] **Step 4: Preserve the completed run threshold for the notice**

In `completeBulkRun()`, set `bulkStatus.thresholdBytes = definition.thresholdBytes`, clear `currentGid/currentStage`, and retain the existing aggregate counts.

- [ ] **Step 5: Run the focused service test**

Run: `node test/new-task-small-file-filter.test.js`  
Expected: PASS.

- [ ] **Step 6: Commit the service change**

```bash
git add src/scripts/services/ariaNgBtFileFilterService.js test/new-task-small-file-filter.test.js
git commit -m "fix: expose active BT filter presentation state"
```

### Task 3: Simplify toolbar priority, rail copy, and threshold behavior

**Files:**
- Modify: `src/scripts/controllers/main.js`
- Modify: `src/index.html`
- Modify: `src/views/list.html`
- Modify: `src/scripts/config/defaultLanguage.js`
- Modify: `src/langs/zh_Hans.txt`

- [ ] **Step 1: Add one simple automatic-status visibility helper**

In `MainController`:

```js
$scope.showAutomaticBtFileFilterStatus = function () {
    return $scope.btFileFilterStatus.visible && !$scope.bulkBtFileFilterStatus.visible;
};
```

Use this helper in the navbar active/group conditions and on the automatic status element. Keep `showBulkBtFileFilterGlobalStatus()` responsible only for hiding duplicate bulk progress when the Downloading rail is visible.

- [ ] **Step 2: Simplify the pre-action rail**

Keep the existing compact rail structure. Change its visible states to:

```text
BT small-file filter
Checking filterable tasks…
No filterable tasks
{{count}} tasks · {{files}} small files
Start filtering
```

During `running`, disable the threshold input, show the immutable threshold from `bulkBtFilterStatus.thresholdBytes`, and render the button as a disabled spinner with `format.bt-file-filter.badge` instead of the stale candidate count.

- [ ] **Step 3: Move scope and risk into the existing confirmation**

Keep one confirmation component and update `format.bt-file-filter.bulk.confirm-text` to three concise lines:

```text
Filter {{count}} tasks; exclude {{files}} selected files under {{threshold}} MB.
Skip magnet metadata, paused, and waiting tasks; preserve manual exclusions.
Attempt to restore selections on failure; aria2 may delete excluded files on completion.
```

Use the approved Simplified Chinese wording from `docs/prd/bt-filter-improvement.md`. Do not update the other nine language files during development.

- [ ] **Step 4: Use concise running and result copy**

Update the existing keys rather than creating a copy subsystem:

```text
format.bt-file-filter.bulk.running=Filtering: {{processed}}/{{total}} · {{threshold}} MB
format.bt-file-filter.bulk.complete=Finished: {{filtered}} filtered · {{skipped}} not processed · {{failed}} failed
```

Pass `threshold` from `bulkStatus.thresholdBytes / 1024 / 1024` through a small controller helper or a derived `thresholdMb` field; avoid arithmetic duplicated across templates.

- [ ] **Step 5: Add only the one new inspecting-stage key**

Add `format.bt-file-filter.stage.bulk-inspecting` to English and Simplified Chinese. Other languages fall back to English until release translation.

- [ ] **Step 6: Run lint and the focused controller test**

```bash
npx gulp lint
node test/task-list-file-list.test.js
```

Expected: PASS after removing or replacing touched source-string assertions with behavior assertions.

- [ ] **Step 7: Commit the UI and development-copy change**

```bash
git add src/scripts/controllers/main.js src/index.html src/views/list.html src/scripts/config/defaultLanguage.js src/langs/zh_Hans.txt test/task-list-file-list.test.js
git commit -m "fix: align BT filter status and action copy"
```

### Task 4: Make completion visibility independent of list refresh

**Files:**
- Modify: `src/scripts/services/ariaNgBtFileFilterService.js`
- Modify: `src/scripts/controllers/list.js`
- Modify: `test/new-task-small-file-filter.test.js`
- Modify: `test/task-list-file-list.test.js`

- [ ] **Step 1: Let the service timer own completion expiry**

Change the existing completion timeout to call `setBulkIdleStatus()` when `bulkStatusVersion` and `type` still match. This preserves the existing protection against an old timer clearing a newer run.

- [ ] **Step 2: Stop using a fresh list response to hide completion**

Remove `acknowledgeBulkCompletion()` and its call from `updateBulkBtFilterPreview()`. Keep `completionId` request matching so an older response cannot validate a newer completion.

- [ ] **Step 3: Block stale preview through the existing analyzing flag**

When the list controller observes `running -> complete`, immediately set:

```js
$scope.bulkBtFilterPreview.analyzing = true;
```

A matching fresh full response recomputes the preview and sets `analyzing = false`. If the response is lost, the existing retry/watchdog continues and the action remains disabled even after the five-second notice expires.

- [ ] **Step 4: Run both focused suites**

```bash
node test/new-task-small-file-filter.test.js
node test/task-list-file-list.test.js
```

Expected: PASS, including the five-second idle result and fresh-response completion visibility.

- [ ] **Step 5: Commit the lifecycle fix**

```bash
git add src/scripts/services/ariaNgBtFileFilterService.js src/scripts/controllers/list.js test/new-task-small-file-filter.test.js test/task-list-file-list.test.js
git commit -m "fix: preserve BT filter completion notice"
```

### Task 5: Split daily and release-only translation checks

**Files:**
- Create: `test/i18n-contract.test.js`
- Modify: `test/task-list-file-list.test.js`
- Modify: `package.json`
- Modify: `.github/workflows/release.yml`
- Modify: `AGENTS.md`
- Modify: `docs/prd/bt-small-file-filter.md`

- [ ] **Step 1: Move the translation contract out of the UI regression file**

Create `test/i18n-contract.test.js` with two modes:

```js
const releaseMode = process.argv.includes('--release');
const languageFiles = releaseMode
    ? fs.readdirSync('src/langs').filter(function (name) { return /\.txt$/.test(name); })
    : ['zh_Hans.txt'];
```

In both modes compare BT-filter keys and named placeholders against `defaultLanguage.js`. Do not assert a literal key count. Release mode checks all language files.

- [ ] **Step 2: Wire the commands**

Add the daily contract to `npm test` and add:

```json
"test:i18n-release": "node test/i18n-contract.test.js --release"
```

- [ ] **Step 3: Add the strict release step**

After `npm test` in `.github/workflows/release.yml`, add:

```yaml
- name: Validate release translations
  run: npm run test:i18n-release
```

- [ ] **Step 4: Update maintenance documentation**

State that development requires English plus Simplified Chinese, while release preparation requires all languages. Correct the current 25-key claim and the stale lifecycle-epoch risk. Do not delete historical superpowers documents.

- [ ] **Step 5: Verify daily succeeds and release mode intentionally reports untranslated new keys**

```bash
npm test
npm run test:i18n-release
```

Expected during development: `npm test` passes. `npm run test:i18n-release` reports the new inspecting key missing from non-Chinese locales until release translation is performed; record this as a release blocker, not a development failure.

- [ ] **Step 6: Commit the staged i18n workflow**

```bash
git add test/i18n-contract.test.js test/task-list-file-list.test.js package.json .github/workflows/release.yml AGENTS.md docs/prd/bt-small-file-filter.md
git commit -m "ci: defer full translations to release"
```

### Task 6: Browser-first acceptance and final gates

**Files:**
- Modify only if browser evidence finds a confirmed defect in files already in scope.

- [ ] **Step 1: Start the source server and connect the browser**

Run: `npx gulp serve`  
Open: `http://localhost:9000`.

- [ ] **Step 2: Exercise the approved browser matrix**

Verify automatic-only, bulk-only, and concurrent states; Files open/closed; route changes; confirmation copy; immutable threshold; current-row badge; fast completion; and 375px light/dark layouts. Prefer a controlled aria2 task; use the established JSON-RPC browser mock if a real endpoint is unavailable.

- [ ] **Step 3: Run functional and build gates**

```bash
npm test
npx gulp lint
npx gulp clean build
npx gulp clean build-bundle
git diff --check
```

Expected: all daily gates pass. Upstream dependency warnings are recorded but not fixed.

- [ ] **Step 4: Review the diff for scope**

Confirm that no non-BT upstream code, generated `dist/`, other-language translations, or unrelated test refactor entered the change.

- [ ] **Step 5: Commit any browser-confirmed correction**

```bash
git add src/scripts/services/ariaNgBtFileFilterService.js src/scripts/controllers/main.js src/scripts/controllers/list.js src/index.html src/views/list.html src/scripts/config/defaultLanguage.js src/langs/zh_Hans.txt test/new-task-small-file-filter.test.js test/task-list-file-list.test.js
git commit -m "fix: finish BT filter consistency improvements"
```
