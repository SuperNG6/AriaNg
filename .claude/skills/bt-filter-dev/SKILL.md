---
name: bt-filter-dev
description: Maintain or modify the AriaNg BT small-file filter (ariaNgBtFileFilterService). Use when changing the filter state machine, its aria2 RPC calls, its i18n keys, or the task-list badge — and when diagnosing a stuck "过滤中"/"正在等待 BT 任务文件列表" badge. Bundles the aria2 official-doc contract, the stage state machine, the regression-test gate, and the pitfall ledger.
---

# BT Small-File Filter — Maintenance Guide

This skill governs changes to the BT small-file filter feature in AriaNg. The feature lives in `src/scripts/services/ariaNgBtFileFilterService.js` and surfaces in `src/scripts/controllers/{new,main,list}.js`, `src/views/list.html`, `src/index.html`, theme CSS, and the locale files + `src/scripts/config/defaultLanguage.js`.

## Read by task

- State-machine, RPC, persistence, or scheduler changes: read sections 1–2 and the relevant section 5 pitfalls; section 3 covers callers.
- Badge or controller lifecycle changes: read section 3 and the stop/restart, dual-GID, and controller-stub pitfalls in section 5.
- Copy or translation changes: read section 4 and the Internationalization Contract in [AGENTS.md](../../../AGENTS.md).
- Stuck-badge diagnosis: start with section 6, then follow the evidence to the relevant contract.

Read only relevant sections; reuse material already read in this session if unchanged. Historical reports are optional sources for a specific decision or regression, not prerequisite reading. Missing historical reports do not block development. Repository verification and completion rules live in [AGENTS.md](../../../AGENTS.md).

## 1. aria2 contract (authoritative)

Source: https://aria2.github.io/manual/en/html/aria2c.html (Options + RPC Methods). Verify against this if behavior is uncertain.

- **`select-file=<INDEX>`** — 1-based file indexes, comma list (`3,6`) or ranges (`1-5`). Implementation emits comma lists only (valid). `normalizeIndexes` rejects `index <= 0` — **correct, do not change to 0-based**.
- **`bt-remove-unselected-file [true|false]`** — default `false`. "Removes the unselected files **when download is completed** in BitTorrent." Deletion happens at completion, NOT when the option is set. The filter sets both via one `aria2.changeOption`.
- **`aria2.changeOption`** — `select-file` and `bt-remove-unselected-file` are settable (only `pause`, `piece-length`, etc. are excluded). Automatic filtering works on the paused payload child (`pause-metadata=true`). Bulk filtering starts from an active payload task: submit the options, observe later `tellStatus`/`getOption` convergence, and use `forcePause`/`unpause` only when aria2 needs a restart boundary. An `OK` callback is request acceptance, not proof that `files[].selected` converged.
- **Magnet dual-gid model**: a magnet submissions creates a metadata **root** task whose `followedBy` lists spawned children; a child's `following` points back to the root, and the child's `belongsTo` is the root gid (parent link). The session model says "magnet URI, and followed by torrent download: GID of the BT metadata download is saved."
- **`tellStatus` `status`** ∈ {active, waiting, paused, complete, error, removed}. `followedBy`/`following` are only present when non-empty (guard for `undefined`).
- **`aria2.tellWaiting`** returns waiting **and paused** downloads. A magnet child that aria2 already started downloading lives in **active**, not waiting — recovery must check both.
- **`aria2.unpause`** (there is no `aria2.start`/`forceStart`) moves a `paused` task to `waiting`. `aria2TaskService.startTasks` maps to `unpauseMulti` → `aria2.unpause`. Only call it when the task is still `paused`.

## 2. Stage state machine

`allowedStages`: `waiting-metadata, waiting-files, applying-filter, restoring-full, starting-filtered, starting-full, starting-fallback, completed-filtered, completed-full, completed-fallback`.

Transitions (`processTaskResponse`):

```
waiting-metadata  --root.followedBy len 1-->  waiting-files   (childGid adopted)
waiting-metadata  --root complete/error-->    recoverMetadataChild/recoverActiveChild
waiting-files      --child has bittorrent+files--> processBtTask
processBtTask:
  filter mode (mix large/small) --> applying-filter (set select-file + bt-remove-unselected-file=true) -> starting-* -> completed-filtered
  all-small (no file >= threshold) --> restoring-full -> completed-full
  all-large --> startOrComplete -> completed-full
  changeTaskOptions unconfirmed after 3 attempts --> restoring-full (fallback) -> completed-fallback
restoring-full --> reselect ALL files + restore original bt-remove-unselected-file -> startOrComplete
completed-* = terminal (excluded from getCurrentJobs, from getPendingGidStageMap)
```

Terminal predicate: `stage.indexOf('completed-') === 0`. The automatic polling tick skips when no non-terminal job on the current RPC. Polling is 250 ms, one `getTaskStatus` per tick, round-robin.

Automatic `applying-filter` and `restoring-full` also require a one-second stable status/options readback; an OK callback only releases the tick. Keep original and target indexes immutable after the first mutation, including InfoHash reuse. Persist mutation timing and restart/pause ownership across reloads, but establish a fresh stability window after reload. An unconverged active payload may need an owned pause/resume boundary. Preserve an observed user pause on reused tasks; new-task Download Now/Download Later intent still applies.

Bulk filtering uses a separate persisted checkpoint:

```text
inspecting -> applying -> (direct stable convergence) -> filtered
                     \-> pausing -> resuming -> stable active readback -> filtered
failed target convergence -> restoring -> pausing/resuming when needed -> failed
```

`applying`/`restoring` callbacks only release the coordinator tick. A later `tellStatus` plus `getOption` must match the target or original selection for a one-second stability window. If `forcePause` reports success while the task remains `active`, keep reading state: real aria2 may use the call as a restart trigger without exposing a durable `paused` status. Never count the item filtered until the final stable readback. `pauseOwned` records whether the coordinator requested the pause: resume coordinator-owned pauses, but preserve an explicit user pause even when filtering succeeds.

When automatic and bulk work coexist, the single-flight scheduler alternates one automatic RPC chain with one bulk RPC chain. A current bulk item stays persisted and pinned, but it must not monopolize every tick while waiting for convergence. The 250 ms `$interval` uses `invokeApply=false`; RPC callbacks provide the Angular async boundary for real UI changes, while an empty queue does not force four full-page digests per second.

## 3. Public API (service return)

- `isBtMetadataUrl(url)` — matches `magnet:?` and `https?://.../*.torrent` only. Plain HTTP/FTP never enters the filter.
- `planFiles(files, thresholdBytes)` — splits files into selected/all index arrays + mode (`filter`/`all-small`/`all-large`).
- `enqueue(rootGid, intent)` — add a job (`intent`: `{thresholdBytes, startAfterFilter, sourceType}`).
- `getJobs()` — sanitized copy of persisted jobs (do NOT mutate jobs indirectly).
- `getPendingGidStageMap()` — `{gid: stage}` for non-terminal current-RPC jobs while the coordinator is running, mapping **both** `rootGid` and `childGid` (so the metadata-root row and the child row both show the badge). It returns `{}` after `stop()` so the stop broadcast clears rendered badges immediately. Consumed by `DownloadListController.decorateBtFilterStage` on every list refresh.
- `getStatus()` — toolbar status object (mutated in place; bound by reference in MainController).
- `start()` — idempotent (no-op if polling already running). `stop()` — cancels polling, resets `tickInProgress`/`pollCursor`, sets idle status.

## 4. Select regression coverage

Use the verification matrix in [AGENTS.md](../../../AGENTS.md); this Skill adds scenario selection, not a second set of universal gates.

- Automatic filtering, recovery, selection, and bulk reconciliation: `test/new-task-small-file-filter.test.js`.
- Pending badges and stopped-service visibility: `test/bt-filter-pending-badge.test.js`.
- Controller integration and file-list refresh: `test/task-list-file-list.test.js`; update dependency stubs only in harnesses that load the changed controller.
- BT copy: `node test/i18n-contract.test.js` checks English and Simplified Chinese during development. At release, translate frozen copy into every locale and run `npm run test:i18n-release`. Preserve all named placeholders; compare key sets, never a fixed key count.

For visible filter changes, show the affected state (for example, an in-flight filtering job for badge changes). Include narrow light/dark layouts when layout or theme behavior is affected. RPC mocks or disposable test tasks can supply the state; personal live downloads are not a universal prerequisite. For RPC semantic changes, use an appropriate aria2 integration environment when available and report any remaining integration gap. Mutating real tasks must stay within current authorization, with original state recorded for restoration where applicable.

## 5. Pitfall ledger (do not reintroduce)

- **Recovery must consider active children.** `recoverMetadataChild` historically scanned only `tellWaiting`. A magnet child that aria2 moved to `active` was never found → job stuck in `waiting-files` forever, badge + "等待 BT 任务文件列表" never cleared. `recoverActiveChild` now falls back to `tellActive` (`getTaskList('downloading')`). Any future recovery branch MUST consider both queues.
- **`stop()` requires the `btFileFilterStarted` flag reset.** `MainController` sets `btFileFilterStarted=true` only once on first successful stat. After `stop()` (Unauthorized or `$destroy`), the flag MUST be reset to `false` so `start()` re-arms on the next successful `getGlobalStat`. Forgetting this leaves the filter permanently stopped after a transient RPC disconnect.
- **A stopped coordinator exposes no pending badges.** Persisted jobs intentionally survive `stop()`, but `getPendingGidStageMap()` MUST return `{}` when `pollingPromise` is absent. Otherwise the stop broadcast reads the same persisted automatic jobs and the task rows keep stale “过滤中” badges.
- **Bulk work must not starve automatic work.** When both queues have work, alternate one automatic RPC chain with one bulk RPC chain while retaining the one-chain-in-flight guard. Pinning a bulk GID must not prevent new-task filtering for the full pause-retry window.
- **Only resume pauses owned by the filter.** Set and persist `pauseOwned` before calling `forcePause`; a task observed paused before ownership is claimed is user-paused. Stable target selection may still count as filtered, but the task stays paused. Restoration also leaves a user-paused task paused.
- **`bt-remove-unselected-file` deletion is at completion.** Do not assume setting it `true` deletes instantly; the restore path re-selects ALL files and restores the ORIGINAL option value — that is the correct "undo". A filtered job the user wants to restore MUST be restored before the BT download completes; once it completes with `bt-remove-unselected-file=true` the small files are gone from disk.
- **`getPendingGidStageMap` maps both root and child gid by design.** Both rows of an in-flight magnet/BT (root metadata + child download) may briefly show the badge — this is correct (same in-flight download).
- **Controller dependency stubs.** Adding a dependency to a controller requires adding a stub in every `test/*.test.js` that loads that controller (e.g. `ariaNgBtFileFilterService.getPendingGidStageMap` returns `{}` in `task-list-file-list.test.js`).
- **No 0-based index "fix".** aria2 file indexes are 1-based; `normalizeIndexes` rejecting `<= 0` is correct.
- **`pendingWholeInfoRequestId` must not block refreshing forever.** `DownloadListController` skips a refresh tick while a whole-info request is in flight so a basic refresh cannot overtake a pending file-detail request. But if that RPC response is never delivered (e.g. a WebSocket closed with auto-reconnect disabled, whose pending callback never fires), the guard would freeze every later refresh. The guard therefore expires a pending request older than `pendingWholeInfoTimeout` (30s) and also recovers on a backward wall-clock jump (`pendingElapsed >= 0`). Regression: `test/task-list-file-list.test.js` → "recovers refreshing when a pending file detail response is never delivered".
- **Check resource provenance when switching from a build to source preview.** `gulp serve` serves `.tmp` before `src`. A stale `.tmp/index.html` created by a previous build references an old minified bundle and silently shadows current source scripts. When switching back to source preview after a build, check that the page loads individual `scripts/...` resources rather than `js/aria-ng-*.min.js`. If stale output shadows source, stop the affected task-owned preview, run `npx gulp clean` (which also deletes `dist`), and restart `npx gulp serve`. Do not routinely restart unrelated user previews.

## 6. Diagnosis recipe for a stuck badge

1. Capture the actual symptom, current RPC connection, coordinator running/stopped state, persisted stage, and exposed pending map. Distinguish a stuck job from a stale rendered badge.
2. If the stage concerns metadata recovery, inspect root/child links and both `tellWaiting` and `tellActive`. A completed root with an active child and an empty waiting queue is one known failure case, not the assumed cause of every stuck badge.
3. Follow the evidence: inspect stop/restart flag reset for a stopped coordinator, callback/timeout recovery for stale lists, or scheduler/convergence state for a running bulk job. Verify source-preview resource provenance if observed behavior differs from the current source.
4. Reproduce the identified failure in the relevant suite before fixing it where feasible. For the active-child recovery case, use `test/new-task-small-file-filter.test.js` with root complete + child active + waiting empty. Verify the affected UI state after the fix when presentation is involved.
