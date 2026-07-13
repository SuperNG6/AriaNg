# Active BT Bulk Small-File Filter Design

Date: 2026-07-13

## Problem

The automatic BT filter protects tasks created through AriaNg, but it cannot repair or filter BT payload tasks that are already downloading. Users need one explicit operation on the Downloading page that excludes currently selected files smaller than a chosen threshold without touching magnet metadata tasks or changing their existing manual selections.

## Product contract

- The action rail appears only on `/downloading` while the task-list Files mode is open.
- It operates only on active BT payload tasks with metadata and a real file list.
- It excludes seeders, hash-checking tasks, magnet metadata roots, waiting tasks, paused tasks, and non-BT downloads.
- The preview is computed from the latest full task-list response and cached by the controller; Angular templates never scan task/file collections.
- One confirmation starts one durable run. The run processes exactly one task at a time.
- Closing Files hides the rail but does not cancel a run.
- While the rail is hidden, running/completed bulk state remains visible in the global toolbar.
- New-task automatic filter jobs have priority between bulk tasks.

## Eligibility and file selection

An eligible task must have:

- `status === 'active'`;
- a valid BT `infoHash` and `bittorrent.info` object;
- at least one real, 1-based indexed file;
- no `seeder`, `verifiedLength`, or `verifyIntegrityPending` state.

The classifier uses aria2's documented `bittorrent.info` boundary, not task names, metadata placeholder paths, or parent/child relationship fields. Payload children may outlive their metadata roots.

For an existing task, the target selection is:

`currently selected indexes ∩ indexes whose length is at least the threshold`.

This preserves every existing manual exclusion. If the intersection is empty, the task is left unchanged. A task is a preview candidate only when the target is non-empty and differs from the current selection.

`bt-remove-unselected-file` is preserved when the task was already partially selected. It is enabled only when all real files were selected before this operation, or when the option was already enabled. This follows aria2's documented behavior that unselected files are removed at BT completion and avoids deleting files outside this feature's scope.

## Durable sequential state

Bulk runs are persisted separately from the existing new-task jobs. An immutable definition stores the GID snapshot once, while a small progress checkpoint is updated during execution:

```text
definition { rpcIdentity, thresholdBytes, gids }
progress { rpcIdentity, cursor, processed, filtered, skipped, failed, filteredFiles,
           current { gid, stage, originalSelectedIndexes, targetSelectedIndexes,
                     originalRemoveUnselectedFile, targetRemoveUnselectedFile } }
```

Only one run per RPC identity is accepted. The current item is the only task with rollback details; completed task details are discarded as the cursor advances. This keeps storage proportional to the GID list rather than the total number of torrent files.

Stages are persisted before each remote mutation:

```text
inspect -> applying -> settle
              |
              +-> restoring -> settle failed
```

- `inspect`: `tellStatus` revalidates active BT payload eligibility and recomputes the plan from current files.
- `applying`: the exact original selection and cleanup value are persisted before `changeOption`.
- `restoring`: a failed apply restores the exact original selection and cleanup value.

aria2 documents that changing most options on an active download causes aria2 to manage its own restart. The bulk path therefore applies `select-file` and cleanup atomically without force-pausing or unpausing the task. This avoids changing queue position and leaves no paused task behind after a browser interruption. If a task becomes non-active before inspection, it is skipped. Deleted tasks are skipped. Transient RPC failures leave the persisted stage in place for reconciliation. The existing 250 ms service tick remains the sole scheduler and permits one RPC chain in flight.

## Scheduling and status

Once a bulk item has begun it remains pinned until it settles. Between bulk items, the scheduler gives one turn to pending automatic new-task jobs and then starts the next bulk item. This preserves automatic-job priority without allowing an indefinitely waiting metadata job to starve the bulk run.

The rail shows cached analyzing, empty, ready, running, and completed states. Completion is aggregate: filtered, skipped, failed, and filtered-file counts. Individual failures do not create notification storms. A completed run blocks its stale cached preview until fresh full task details arrive. The global completion notice auto-hides after five seconds.

Threshold typing is debounced for 200 ms, and preview planning makes one linear file pass. The service lifecycle uses generation-bound operation contexts so callbacks delivered after `stop()`, restart, RPC switching, or unauthorized teardown cannot continue an obsolete RPC chain.

## Visual design

The rail is a compact precision utility strip aligned with the task table: a subtle surface, 3 px blue leading rule, concise scope text, inline MB input, and the existing small primary button style. At 375 px it wraps into description and controls rows. Light and dark themes use their existing task-table palettes. Status text has a polite live region and running progress has progressbar semantics.

## Verification

- Service regression tests cover eligibility, selection intersection, cleanup preservation, one-at-a-time scheduling, priority, rollback, persistence, deletion, and execution-time revalidation.
- Controller tests cover route/Files visibility, cached preview calculation, confirmation, validation, and no digest-time collection scans.
- All 10 language overrides and the English source contain identical keys and placeholders.
- Required gates: `npm test`, `npx gulp lint`, standard build, bundle build, and 375 px light/dark visual checks.
