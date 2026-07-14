# SDD Progress

## 2026-07-14 — Files/filter scoped review fixes

Status: implementation complete; fresh browser and real-aria2 verification pending.

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
- The earlier real convergence result proves the callback/readback fix, but it predates the latest fairness, pause-ownership, and rendering commits. A fresh Playwright and real-aria2 pass is still required.
- Per maintainer direction, new regression-test code and the full `npm test`/lint/build gates are deferred to release preparation; no current release-gate claim is made.

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
