# Bulk ineligible-target pause fix

1. Add a failing regression for a user-paused target entering pending verification.
2. Gate resume on `pauseOwned`; retain rollback while a user pause is held.
3. Preserve coverage for coordinator-owned pauses restored from checkpoints.
4. Run `npm test`, standard and All-In-One builds, and `git diff --check`.
5. Restore the source preview and distinguish browser checks from RPC-mock checks.

Evidence so far: the new user-pause regression failed before the fix because
`startTasks` was called. The first one-line fix broke existing rollback coverage;
the final branch retains rollback without resuming the user-paused task.

Validation (2026-09-17):

- `npm test`: pass, including both new pause-ownership regressions.
- `npx gulp clean build` and `npx gulp clean build-bundle`: pass, including lint.
- `git diff --check`: pass.
- Source preview restored after builds; real backend connected with 18 active,
  38 waiting and 5 stopped tasks. Preview remained 3 targets / 14 files at 100 MB.
- The ineligible/user-paused transition was reproduced with RPC mocks, not on
  the real backend. No real task was filtered, resumed, or deleted in this fix.
