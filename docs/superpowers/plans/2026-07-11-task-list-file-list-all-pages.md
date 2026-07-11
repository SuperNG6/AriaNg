# Task List File Lists on All Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing read-only nested file list from `/downloading` to `/waiting` and `/stopped`, controlled by one migrated persistent preference and refreshed according to task status.

**Architecture:** Rename the downloading-specific UI contract to a generic task-list contract while preserving the existing nested panel. Keep one list controller and one polling timer; request full file data continuously only for active downloads, and cache/rebuild real file data around basic refreshes for waiting and stopped tasks.

**Tech Stack:** AngularJS 1.6, aria2 JSON-RPC, Bootstrap 3, Gulp 4, ESLint, Node.js test runner.

## Global Constraints

- The button is visible only on `/downloading`, `/waiting`, and `/stopped`.
- One persisted boolean controls all three pages and migrates `showFileListInDownloadingPage` to `showFileListInTaskListPage`.
- File and directory checkboxes are disabled on all task-list pages; file selection remains a detail-page operation.
- `/downloading` requests full file data every refresh while enabled; `/waiting` and `/stopped` request it only initially, after toggling on, or after structural invalidation.
- Keep one polling timer and one task-list RPC per refresh; do not add per-task `tellStatus` calls.
- Preserve stale-response protection, task operations, waiting-page drag ordering, search, detail links, directory folding, themes, and responsive layout.
- Add no runtime dependency and no new translation key.

---

### Task 1: Add executable regression contracts

**Files:**
- Create: `test/task-list-file-list.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm test`, which executes Node assertions covering shared route/UI names, migration behavior, disabled inputs, and refresh-policy source contracts.

- [ ] **Step 1: Create a failing test runner**

Use `node:assert`, `fs`, and `vm` to load `constants.js` and `ariaNgSettingService.js` with a stub Angular module. Assert that a stored old value `true` is returned and persisted as `showFileListInTaskListPage: true`, a new value takes precedence, and a fresh options object returns `false`. Add source assertions for the three routes, `task-list-file-list-mode.changed`, generic template/CSS classes, disabled file inputs, and the downloading-only continuous-full expression.

- [ ] **Step 2: Wire the test command and prove red**

Change `package.json` to:

```json
"test": "node test/task-list-file-list.test.js"
```

Run `npm test`. Expected: failure because the generic setting and view contract do not exist.

- [ ] **Step 3: Commit the red test**

```bash
git add test/task-list-file-list.test.js package.json
git commit -m "test: cover task list file list expansion"
```

### Task 2: Migrate the persistent setting and toolbar API

**Files:**
- Modify: `src/scripts/config/constants.js`
- Modify: `src/scripts/services/ariaNgSettingService.js`
- Modify: `src/scripts/controllers/main.js`
- Modify: `src/index.html`

**Interfaces:**
- Produces: `getShowFileListInTaskListPage(): boolean`.
- Produces: `setShowFileListInTaskListPage(value: boolean): void`.
- Produces: `isTaskListPage()`, `isTaskListFileListEnabled()`, and `toggleTaskListFileList()`.
- Emits: `task-list-file-list-mode.changed`.

- [ ] **Step 1: Replace the default key**

Replace `showFileListInDownloadingPage: false` with `showFileListInTaskListPage: false`.

- [ ] **Step 2: Implement migration before default backfill**

Implement the getter by reading `getOptions()` directly. If `options.showFileListInTaskListPage` is undefined, copy the defined old boolean or use the new default, then call `setOptions(options)`. The setter writes only the new key.

- [ ] **Step 3: Generalize MainController and toolbar bindings**

Use the existing private `getTaskListPageType()` as the route source. Return `getTaskListPageType() !== ''` from `isTaskListPage()`, bind the active state to the new getter, toggle with the new setter, and broadcast the generic event. Update `src/index.html` to use these three generic methods.

- [ ] **Step 4: Run focused tests and lint**

Run `npm test && npx gulp lint`. Expected: setting/toolbar assertions pass; remaining view assertions still identify the unconverted list contract until Task 3.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/config/constants.js src/scripts/services/ariaNgSettingService.js src/scripts/controllers/main.js src/index.html
git commit -m "feat: share file list preference across task pages"
```

### Task 3: Generalize list rendering and status-aware refresh

**Files:**
- Modify: `src/scripts/controllers/list.js`
- Modify: `src/views/list.html`

**Interfaces:**
- Consumes: generic setting and event from Task 2.
- Produces: `showTaskListFileList()` and generic file sort/fold helpers.
- Refresh invariant: `requestWholeInfo = needRequestWholeInfo || (showFileList && location === 'downloading')`.

- [ ] **Step 1: Rename public list helpers and event**

Replace every `DownloadingFileList`/`DownloadingFileDir` scope method with the `TaskListFileList`/`TaskListFileDir` names from the design. Accept the generic event on all three list routes, increment the generation, force one whole request when enabled, and refresh immediately.

- [ ] **Step 2: Implement status-aware whole requests**

Compute continuous full requests only for `location === 'downloading'`. If an enabled mode receives a basic response before any full structure is available, set `needRequestWholeInfo`, advance the generation, and immediately request whole info. Waiting/stopped basic responses otherwise merge into cached task objects.

- [ ] **Step 3: Normalize virtual nodes before every processing pass**

Call `removeVirtualFileNodes($rootScope.taskContext.list)` before `processDownloadTasks(...)` regardless of mode. This preserves real cached files while removing generated directories and derived path fields, then rebuilds them exactly once when enabled.

- [ ] **Step 4: Convert the template contract**

Rename the task-row class, panel classes, sort methods, fold methods, and element IDs to generic `task-list` names. Keep both directory and file `<input>` elements explicitly `disabled` and retain `$event.stopPropagation()`.

- [ ] **Step 5: Run tests and lint**

Run `npm test && npx gulp lint`. Expected: all assertions pass and ESLint reports no errors.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/controllers/list.js src/views/list.html test/task-list-file-list.test.js
git commit -m "feat: show file lists on all task pages"
```

### Task 4: Generalize polished styles and verify builds

**Files:**
- Modify: `src/styles/controls/task-table.css`
- Modify: `src/styles/theme/default.css`
- Modify: `src/styles/theme/default-dark.css`

**Interfaces:**
- Consumes: `has-task-list-file-list`, `task-list-file-list`, and `task-list-file-panel` from Task 3.

- [ ] **Step 1: Rename all scoped selectors**

Mechanically replace the three downloading-specific class names with their generic task-list equivalents in all three CSS files. Do not change colors, spacing, borders, hover rules, or mobile behavior.

- [ ] **Step 2: Prove no old runtime contract remains**

Run:

```bash
rg "showFileListInDownloadingPage|DownloadingFileList|DownloadingFileDir|download-file-list-mode|downloading-file-(list|panel)|has-downloading-file-list" src
```

Expected: no matches.

- [ ] **Step 3: Run the complete local verification**

Run:

```bash
npm test
npx gulp lint
npx gulp clean build
npx gulp clean build-bundle
```

Expected: all commands exit zero; standard and bundle builds complete without ESLint errors.

- [ ] **Step 4: Commit**

```bash
git add src/styles/controls/task-table.css src/styles/theme/default.css src/styles/theme/default-dark.css
git commit -m "style: share nested file panels across task pages"
```
