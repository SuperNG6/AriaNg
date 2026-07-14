# Files and BT Filter Review Fixes Design

> Date: 2026-07-14
> Scope: fork-added task file list, automatic BT small-file filtering, and active-task bulk filtering

## Goal

Fix the concrete correctness, cross-feature scheduling, status-copy, and scaling problems found during the scoped review without merging the automatic and bulk state machines or adding new user settings.

## Constraints

- Preserve aria2's 1-based file indexes.
- Keep automatic filtering and bulk filtering as separate persisted workflows.
- Keep one aria2 RPC chain in flight per filter-service tick.
- Preserve a user's existing file exclusions and a user's explicit pause action.
- Do not add virtual scrolling, multi-tab locking, a cancellation workflow, or another persisted queue.
- Keep the existing five-second full file-list refresh cadence.
- Add no new translation keys; development copy remains English plus Simplified Chinese until release preparation.

## Functional Changes

### Stopped-service badges

`getPendingGidStageMap()` returns no automatic or bulk stages while the coordinator is stopped. The existing `bt-file-filter.stopped` broadcast therefore removes task-row badges immediately, while persisted jobs remain available for the next successful `start()`.

### Fair automatic and bulk scheduling

When both workflows have work, the scheduler alternates one automatic RPC chain with one bulk RPC chain. A bulk item remains the current persisted item, but it no longer monopolizes every 250 ms tick while waiting for mutation convergence or a restart boundary. The existing `tickInProgress`/operation-generation guard continues to allow only one chain at a time.

### Accurate bulk resume badges

The task-row stage for a bulk `resuming` checkpoint is derived from `resumeOutcome`:

- `filtered` -> `starting-filtered`
- `failed` -> `starting-full`

No new status object or translation key is introduced.

### Pause ownership

Each in-flight bulk item persists whether the filter coordinator issued the pause request. The flag is set before `pauseTasks()` and survives reloads.

- If a paused task is coordinator-owned, the coordinator resumes it after stable target or restoration readback.
- If a task becomes paused before the coordinator issued a pause request, the pause is treated as a user action.
- If the target selection already converged, the item may settle as filtered while remaining paused.
- If the target did not converge, the coordinator restores the original selection while paused, settles failed after stable restoration, and leaves the user-paused task paused.

If coordinator-owned `unpause` fails after the existing retry limit, the item is reported failed rather than successful. The task's visible paused state remains truthful; no additional recovery queue is added.

## Performance Changes

The 250 ms coordinator interval runs without forcing an Angular digest. RPC promise callbacks still enter Angular's normal async lifecycle and expose actual state changes. No-work ticks therefore stop repeatedly evaluating the full task/file-list template.

Task and file `ng-repeat` blocks use stable identities:

- task: `task.gid`
- real file: file index within its task
- virtual directory: directory node path within its task

This allows Angular to reuse task and file DOM when the five-second full response replaces aria2 response objects.

## Verification

Implementation verification prioritizes real behavior:

1. Playwright against the source server after `gulp clean`, checking Files open/closed, light/dark 375 px layouts, automatic/bulk concurrent badges, and no browser errors.
2. A real aria2 bulk mutation that reselects an approved small file, filters it again, and confirms actual `files[].selected`, cleanup option, and final task status.
3. Before release, focused regression coverage for stopped badges, scheduler alternation, pause ownership, resume-stage copy, and stable list identities, followed by the repository's full test/lint/build gates.

## Explicit Non-Goals

- No broad refactor of the 2,000-line filter service.
- No adaptive refresh setting or per-task file RPC architecture.
- No handling for simultaneous writers in multiple browser tabs.
- No upstream dependency, build-warning, or unrelated AriaNg fixes.
