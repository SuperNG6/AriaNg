# SDD Progress

## 2026-07-14 — Files/filter scoped review fixes

Status: implementation and planned browser/real-aria2 verification complete; release gates remain deferred.

Confirmed evidence:

- A real 100 MB bulk run previously reported five filtered tasks and 32 filtered files while `tellStatus` still exposed the original selections. Root cause: the executor treated `changeOption` callback success as mutation convergence.
- Real aria2 showed that an active selection may converge directly, or only after a `forcePause` restart boundary. `forcePause` may return success while the task remains visibly active.
- After adding stable `tellStatus` + `getOption` reconciliation, an approved real mutation changed one task from selected indexes `[1,2]` to `[1]`, kept the task active, and left no selected sub-100 MB file. A follow-up read found the five previously targeted tasks with zero selected sub-threshold files.
- Browser debugging initially loaded stale generated code because `.tmp/index.html` shadowed `src/index.html`. `npx gulp clean` followed by a fresh source server exposed the current implementation.
- The scoped review found automatic-filter starvation while a bulk GID was pinned, stopped-service automatic badges, incorrect restoration-resume copy, user-pause ownership loss, continuous 250ms Angular digests, and full-refresh DOM replacement.

Implemented:

- `6115733`: automatic and bulk RPC chains alternate while preserving one chain in flight; stopped coordinators expose no pending badge map; the 250ms interval uses `invokeApply=false`.
- `e396de3`: persisted `pauseOwned` distinguishes coordinator and user pauses; user-paused tasks remain paused; restoration resume uses the correct row stage.
- `c0e95ab`: task rows track by GID and file rows track by 1-based index or directory path so Angular can reuse DOM after full responses.

Current verification:

- JavaScript syntax checks and `git diff --check`: pass after each code change.
- A clean `npx gulp clean` + `npx gulp serve` preview loaded individual `scripts/...` resources from `master`; no stale `.tmp/js/aria-ng-*.min.js` bundle was present.
- Playwright RPC-mock acceptance passed for Files closed/open, ready/running/complete, concurrent automatic/bulk status priority, route changes, five-second completion expiry, threshold snapshot isolation, and 375 px light/dark layouts. Browser console errors were empty and both mobile screenshots had no overflow or duplicated status.
- Fresh real aria2 direct convergence at 100 MB changed one approved task from `[1,2]` back to `[1]`, kept `bt-remove-unselected-file=true`, remained `active`, and reported exactly `filtered=1`, `failed=0`, `filteredFiles=1`.
- A one-shot browser interception then reproduced `changeOption` returning `OK` without applying the first mutation while all later RPCs used real aria2. The observed chain was `applying -> pausing/paused -> resuming/active -> applying`; the row copy changed to “正在启动已过滤任务”, and stable readback finished at `[1]`, cleanup `true`, `active`, with the same one-task/one-file result.
- A second approved task reproduced an observed user pause with `pauseOwned=false`. The target mutation was intentionally left unconverged; the task stayed `paused`, the batch restored its starting selection `[1,2]`, and the result was `filtered=0`, `failed=1`, `filteredFiles=0`. The verification cleanup then restored the pre-test `[1]` selection and restarted the task.
- Final readback confirmed both real verification tasks were `active`, selected indexes were `[1]`, and cleanup remained `true`.
- The first version of the external verification script assumed string `files[].selected`; `aria2TaskService.getTaskStatus` supplies booleans after processing. The affected task was immediately restored to its recorded `[1]`/`active` baseline before rerunning, and later scripts normalize both representations.
- Per maintainer direction, new regression-test code and the full release gates remain deferred to release preparation. A diagnostic `npm test` run found six existing `bt-filter-pending-badge` harness expectations that call `getPendingGidStageMap()` without starting the coordinator; the new stopped-service contract correctly returns `{}`. This is a test-fixture update for the release-preparation task, not a failed browser or real-aria2 behavior check. No current release-gate claim is made.

## 2026-07-14 — BT filter consistency improvements

Status: prior baseline before the later real-aria2 convergence and scoped-review fixes.

- Kept the automatic and bulk executors independent; added only transient bulk presentation fields.
- Bulk status now has toolbar priority, while automatic and bulk task-row badges remain visible.
- The bulk rail uses concise pre-action copy; scope, exceptions, restoration behavior, and deletion risk are in the existing confirmation dialog.
- The running threshold is an immutable snapshot and its input is disabled until the run leaves `running`.
- The five-second completion notice is independent from preview freshness; stale responses and cached threshold rescans cannot unlock the next run.
- Stopping after Unauthorized immediately clears task-row filter badges instead of waiting for another successful list refresh.
- Development i18n checks English and Simplified Chinese. The release-only all-language gate is intentionally blocked until frozen copy is translated.

Verification:

- `npm test`: pass.
- `npx gulp lint`: pass.
- `npx gulp clean build`: pass (upstream Browserslist/deprecation warnings only).
- `npx gulp clean build-bundle`: pass (upstream Browserslist/deprecation warnings only).
- Playwright RPC-mock acceptance: pass for ready, three single-line confirmation reminders, concurrent automatic/bulk running, threshold snapshot isolation, Files open/closed, route changes, current-row badge, completion expiry, and 375px light/dark layouts; no browser console errors.
- Playwright real-Chrome acceptance against a connected aria2 instance: pass with 67 active rows, five eligible tasks, 32 small files, three single-line confirmation reminders, and no console, page, or request errors. The confirmation was cancelled; real tasks were not changed.
- Independent review at that checkpoint found no remaining blocker; the later real mutation and scoped review supersede that conclusion.
- `npm run test:i18n-release`: expected release blocker; non-Chinese locales do not yet contain `format.bt-file-filter.stage.bulk-inspecting` and frozen-copy placeholder updates.
