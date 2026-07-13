# Active BT Bulk Small-File Filter Implementation Plan

Date: 2026-07-13

1. Lock the behavior against the aria2 RPC manual: active status, aria2-managed restart after dynamic `select-file`, and completion-time unselected-file removal.
2. Add regression tests for the positive BT payload classifier and selection planning before production changes.
3. Add a persisted bulk-run descriptor and current-item state to `ariaNgBtFileFilterService`; reuse its single 250 ms tick and prioritize existing automatic jobs.
4. Implement execution-time revalidation, exact selection preservation, safe cleanup-option handling, reconciliation, rollback, deletion skips, and aggregate outcomes without changing task pause state.
5. Add controller-cached preview state and a confirmation-backed command on the Downloading page.
6. Add the contextual action rail, restrained light/dark styling, 375 px layout, accessible status/progress semantics, and synchronized translations.
7. Run focused tests, all regression tests, lint, both builds, and light/dark narrow visual checks; record the result in `.superpowers/sdd/progress.md` and a task report.
