# Active BT Bulk Filter Hardening Design

Date: 2026-07-14

## Purpose

Close correctness and integration gaps found after the first bulk-filter implementation without adding a second scheduler, configurable concurrency, or a new persistence subsystem.

## Required invariants

- A stopped or restarted service rejects every callback from the previous lifecycle. A late `tellStatus`, `getOption`, or `changeOption` response cannot continue an RPC chain or release the new lifecycle's in-flight lock.
- At a bulk-item boundary, one automatic-filter job receives the first turn, then the bulk run advances even when that automatic job remains in `waiting-metadata`. A started bulk item remains pinned.
- Active BT children still owned by a non-terminal automatic-filter job are excluded through either their direct `childGid` or their `following` root link. Ownership is checked during preview and again against the latest task snapshot fetched after option inspection, immediately before the first mutation. This closes confirmation and RPC-window races without interrupting a bulk item that has already entered `applying` or `restoring`.
- Initial execution reads task options first, then obtains the latest active task/file snapshot and immediately plans the first mutation in the same callback turn. This preserves a file the user manually excluded while option inspection was in flight and skips a task paused during that window, without adding another per-task RPC.
- A bulk result is not advanced or reported complete until its progress checkpoint is durable. A definition without progress is an uncommitted orphan and is discarded on startup.
- InfoHash recovery of a pre-existing BT task intersects the threshold with its current selection. It never reselects a manually or previously excluded file and never pauses an existing active task for a later duplicate submission.
- The Downloading rail and New Task toolbar share one valid threshold model. Threshold edits debounce expensive preview work, while persistence remains immediate for valid values.
- Completed bulk state cannot resubmit a cached preview. Fresh full task details acknowledge completion; hidden-rail progress remains visible in the global toolbar and its completion notice auto-hides.
- Every completion has a monotonic `completionId`. A full task-list response can acknowledge only the same completion that was current when its request began. Responses requested while the run was active or for an older completed run cannot clear a newer completion or re-enable their stale candidate snapshot. Threshold debounce only recomputes cached data and never acknowledges completion.
- Completion actively requests one fresh full response from the Downloading controller, independent of the user's periodic refresh interval. It invalidates an older run's pending full request, attaches a 30-second watchdog to the current completion request, and retries ordinary transient failures every five seconds while that completion remains current. Unauthorized, leaving `complete`, a newer completion, and controller destruction cancel the old retry. Correcting an invalid threshold also re-arms the refresh.
- Failed durable enqueue is visible to the user.
- The compact global status retains a visually hidden, fully translated live-region string at tablet and mobile breakpoints.
- Tasks whose selected files are all below the threshold remain unchanged because an empty aria2 `select-file` does not express “select none”; the empty-state copy states this boundary.

## Performance boundary

Preview classification performs one linear pass over each task's files. It is cached on the five-second full task response and debounced by 200 ms for threshold typing. Execution remains one task at a time under the existing 250 ms coordinator, so only one RPC chain is in flight.

## Verification

- Deferred-callback tests cover stop/restart at status, options, and mutation stages.
- Persistence-failure tests cover orphan definitions and a failed terminal checkpoint.
- Fairness tests cover indefinitely waiting metadata plus a bulk run.
- Ownership tests cover relationship children, InfoHash-recovered children without a `following` link, stale confirmation snapshots, and ownership acquired while `getOption` is in flight.
- Independent server-snapshot tests cover a manual file exclusion and a pause occurring while options are in flight.
- List-controller tests cover a full response requested before completion but delivered afterward.
- List-controller tests cover cached threshold recomputation, disabled periodic refresh, invalid-threshold recovery, a permanently lost full response, a transient completion-refresh failure, Unauthorized cancellation, and a new completion superseding an old retry.
- Interaction tests cover InfoHash selection preservation, Download Later state preservation, shared threshold, stale completion, enqueue failure, and global status.
- A 1,000-task/100,000-file test enforces exactly one `index`/`length`/`selected` read per file.
- Read-only live aria2 inspection validates the classifier against the user's active workload without changing task state.
- A controlled source-less two-file torrent validates active-task `changeOption`, 1-based selection, and cleanup against the real aria2 endpoint, followed by an active/waiting/stopped residual scan.
