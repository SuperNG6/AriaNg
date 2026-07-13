---
name: bt-filter-dev
description: Maintain or modify the AriaNg BT small-file filter (ariaNgBtFileFilterService). Use when changing the filter state machine, its aria2 RPC calls, its i18n keys, or the task-list badge — and when diagnosing a stuck "过滤中"/"正在等待 BT 任务文件列表" badge. Bundles the aria2 official-doc contract, the stage state machine, the regression-test gate, and the pitfall ledger.
---

# BT Small-File Filter — Maintenance Guide

This skill governs changes to the BT small-file filter feature in AriaNg. The feature lives in `src/scripts/services/ariaNgBtFileFilterService.js` and surfaces in `src/scripts/controllers/{new,main,list}.js`, `src/views/list.html`, `src/index.html`, theme CSS, and the 10 language files + `src/scripts/config/defaultLanguage.js`.

**Before writing any code** for the filter, read this whole file. Then read the `.superpowers/sdd/progress.md` gate log and the relevant `task-*-report.md`.

## 1. aria2 contract (authoritative)

Source: https://aria2.github.io/manual/en/html/aria2c.html (Options + RPC Methods). Verify against this if behavior is uncertain.

- **`select-file=<INDEX>`** — 1-based file indexes, comma list (`3,6`) or ranges (`1-5`). Implementation emits comma lists only (valid). `normalizeIndexes` rejects `index <= 0` — **correct, do not change to 0-based**.
- **`bt-remove-unselected-file [true|false]`** — default `false`. "Removes the unselected files **when download is completed** in BitTorrent." Deletion happens at completion, NOT when the option is set. The filter sets both via one `aria2.changeOption`.
- **`aria2.changeOption`** — `select-file` and `bt-remove-unselected-file` are settable (only `pause`, `piece-length`, etc. are excluded). `select-file` change on an **active** download restarts it; the filter avoids this by working on the **paused** child (`pause-metadata=true`).
- **Magnet dual-gid model**: a magnet submissions creates a metadata **root** task whose `followedBy` lists spawned children; a child's `following` points back to the root, and the child's `belongsTo` is the root gid (parent link). The session model says "magnet URI, and followed by torrent download: GID of the BT metadata download is saved."
- **`tellStatus` `status`** ∈ {active, waiting, paused, complete, error, removed}. `followedBy`/`following` are only present when non-empty (guard for `undefined`).
- **`aria2.tellWaiting`** returns waiting **and paused** downloads. A magnet child that aria2 already started downloading lives in **active**, not waiting — recovery must check both.
- **`aria2.unpause`** (there is no `aria2.start`/`forceStart`) moves a `paused` task to `waiting`. `aria2TaskService.startTasks` maps to `unpauseMulti` → `aria2.unpause`. Only call it when the task is still `paused`.

## 2. Stage state machine

`allowedStages` (service L8-12): `waiting-metadata, waiting-files, applying-filter, restoring-full, starting-filtered, starting-full, starting-fallback, completed-filtered, completed-full, completed-fallback`.

Transitions (`processTaskResponse`, L758+):

```
waiting-metadata  --root.followedBy len 1-->  waiting-files   (childGid adopted)
waiting-metadata  --root complete/error-->    recoverMetadataChild/recoverActiveChild
waiting-files      --child has bittorrent+files--> processBtTask
processBtTask:
  filter mode (mix large/small) --> applying-filter (set select-file + bt-remove-unselected-file=true) -> starting-* -> completed-filtered
  all-small (no file >= threshold) --> restoring-full -> completed-full
  all-large --> startOrComplete -> completed-full
  changeTaskOptions failed 3x --> restoring-full (fallback) -> completed-fallback
restoring-full --> reselect ALL files + restore original bt-remove-unselected-file -> startOrComplete
completed-* = terminal (excluded from getCurrentJobs, from getPendingGidStageMap)
```

Terminal predicate: `stage.indexOf('completed-') === 0`. Polling tick (L817) skips when no non-terminal job on the current RPC. Polling is 250 ms, one `getTaskStatus` per tick, round-robin.

## 3. Public API (service return, ~L990)

- `isBtMetadataUrl(url)` — matches `magnet:?` and `https?://.../*.torrent` only. Plain HTTP/FTP never enters the filter.
- `planFiles(files, thresholdBytes)` — splits files into selected/all index arrays + mode (`filter`/`all-small`/`all-large`).
- `enqueue(rootGid, intent)` — add a job (`intent`: `{thresholdBytes, startAfterFilter, sourceType}`).
- `getJobs()` — sanitized copy of persisted jobs (do NOT mutate jobs indirectly).
- `getPendingGidStageMap()` — `{gid: stage}` for non-terminal current-RPC jobs, mapping **both** `rootGid` and `childGid` (so the metadata-root row and the child row both show the badge). Consumed by `DownloadListController.decorateBtFilterStage` on every list refresh.
- `getStatus()` — toolbar status object (mutated in place; bound by reference in MainController).
- `start()` — idempotent (no-op if polling already running). `stop()` — cancels polling, resets `tickInProgress`/`pollCursor`, sets idle status.

## 4. Required regression-test gate

After ANY change to the service, controllers, badge, or i18n, run and keep green:

- `npm test` (must include `test/bt-filter-pending-badge.test.js` and `test/new-task-small-file-filter.test.js`)
- `npx gulp lint`
- `npx gulp clean build` and `npx gulp clean build-bundle`
- For UI changes: 375 px light **and** dark visual check of the task list with a filtering BT job visible.

When adding/changing a translate key: it MUST land in `defaultLanguage.js` AND all 10 `src/langs/*.txt`, preserving `{{count}}/{{processed}}/{{total}}/{{filtered}}/{{full}}`. Verify counts match (currently 25 each): `grep -cE "format\.bt-file-filter|BT file filter|Exclude BT task|BT task pending file filter"` every source.

When bumping the release version: update `package.json`, `package-lock.json`, the literal in `test/release-workflow.test.js`, the `workflow_dispatch` default in `.github/workflows/release.yml`, and create `docs/releases/$VERSION.md`.

## 5. Pitfall ledger (do not reintroduce)

- **Recovery must consider active children.** `recoverMetadataChild` historically scanned only `tellWaiting`. A magnet child that aria2 moved to `active` was never found → job stuck in `waiting-files` forever, badge + "等待 BT 任务文件列表" never cleared. `recoverActiveChild` now falls back to `tellActive` (`getTaskList('downloading')`). Any future recovery branch MUST consider both queues.
- **`stop()` requires the `btFileFilterStarted` flag reset.** `MainController` sets `btFileFilterStarted=true` only once on first successful stat. After `stop()` (Unauthorized or `$destroy`), the flag MUST be reset to `false` so `start()` re-arms on the next successful `getGlobalStat`. Forgetting this leaves the filter permanently stopped after a transient RPC disconnect.
- **`bt-remove-unselected-file` deletion is at completion.** Do not assume setting it `true` deletes instantly; the restore path re-selects ALL files and restores the ORIGINAL option value — that is the correct "undo". A filtered job the user wants to restore MUST be restored before the BT download completes; once it completes with `bt-remove-unselected-file=true` the small files are gone from disk.
- **`getPendingGidStageMap` maps both root and child gid by design.** Both rows of an in-flight magnet/BT (root metadata + child download) may briefly show the badge — this is correct (same in-flight download).
- **Controller dependency stubs.** Adding a dependency to a controller requires adding a stub in every `test/*.test.js` that loads that controller (e.g. `ariaNgBtFileFilterService.getPendingGidStageMap` returns `{}` in `task-list-file-list.test.js`).
- **No 0-based index "fix".** aria2 file indexes are 1-based; `normalizeIndexes` rejecting `<= 0` is correct.
- **`pendingWholeInfoRequestId` must not block refreshing forever.** `DownloadListController` skips a refresh tick while a whole-info request is in flight so a basic refresh cannot overtake a pending file-detail request. But if that RPC response is never delivered (e.g. a WebSocket closed with auto-reconnect disabled, whose pending callback never fires), the guard would freeze every later refresh. The guard therefore expires a pending request older than `pendingWholeInfoTimeout` (30s) and also recovers on a backward wall-clock jump (`pendingElapsed >= 0`). Regression: `test/task-list-file-list.test.js` → "recovers refreshing when a pending file detail response is never delivered".

## 6. Diagnosis recipe for a stuck badge

1. Reproduce: a BT/magnet task finished filtering and is downloading, but the row still shows 「过滤中」 and the toolbar still shows "正在等待 N 个 BT 任务的文件列表".
2. Connect to aria2 RPC (`aria2.getGlobalStat` then `aria2.tellActive`/`tellWaiting` with `--compressed`). Confirm a task whose `following` points to a `complete` metadata root. The job's `rootGid` matches that root; the child is in active.
3. The job is stuck because the recovery branch did not find the child in the queue it scanned. Confirm the new `recoverActiveChild` active-fallback exists and fires.
4. Add/adjust a test in `test/new-task-small-file-filter.test.js` reproducing "root complete + child in active + waiting empty" before changing code.