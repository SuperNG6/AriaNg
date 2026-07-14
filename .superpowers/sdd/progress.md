# SDD Progress

## 2026-07-14 — BT filter consistency improvements

Status: implementation and development acceptance complete.

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
- Independent final code review: no remaining blocker or Important finding.
- `npm run test:i18n-release`: expected release blocker; non-Chinese locales do not yet contain `format.bt-file-filter.stage.bulk-inspecting` and frozen-copy placeholder updates.
