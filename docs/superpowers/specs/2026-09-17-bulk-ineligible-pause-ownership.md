# Preserve user pauses when bulk targets become ineligible

Scope: the bulk filter's ineligible-target exit branch only.

When a target becomes ineligible while paused, resume it only if the persisted
checkpoint says `pauseOwned`. Otherwise keep it paused and use the existing
bounded rollback to restore the original selection and cleanup option. Keep
active-target skipping and coordinator-owned resume behavior unchanged.

Do not change automatic filtering, directory history, deletion timing, or the
scheduler. Do not add new stages, retries, or dependencies.

Acceptance: reproduce the unwanted resume in the VM regression harness; verify
user-pause preservation, rollback, and owned-pause recovery after reload; run all
tests and both builds. Record real-backend checks separately from mock evidence.
