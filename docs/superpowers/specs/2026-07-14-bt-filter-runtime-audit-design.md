# BT Filter Runtime Audit Design

Date: 2026-07-14

## Runtime template contract

- Opening Files on `/downloading` must render the bulk rail and action button without any Angular `$parse`, `$injector`, `TypeError`, `ReferenceError`, or syntax error.
- Angular interpolation ends at the first `}}`; an inline object literal must never place its closing `}` directly next to that delimiter.
- The regression scans `src/index.html` and every view both as source and after `html-minifier({collapseWhitespace: true})`, matching the production transform.
- `gulp serve` builds the template cache before startup and rebuilds it before reloading after every nested view change.

## Executor contract

- A restored `applying` checkpoint first reconciles whether the target already landed. If it did not and the task is no longer an active BT payload, the executor never sends another filtering mutation.
- An ineligible task still at the exact original selection is skipped. A task whose uncertain mutation changed state enters restoration only.
- Restoration attempts are counted in the durable current-task checkpoint. Each tick reconciles before another write; at most three restoration writes are sent across reloads.
- If exact restoration remains impossible after the bounded attempts, the item is counted as failed and the sequential run advances. It must not issue unbounded 250 ms writes or starve later GIDs.
- A Downloading controller created while bulk status is already complete attaches the same lost-response watchdog as a running-to-complete transition.

## Verification evidence

- Playwright against the generated bundle proves the rail and button exist with the supplied RPC configuration and the browser console is clean.
- VM behavior tests cover five ineligible recovery states, changed-state restoration, bounded rollback across two tasks and reload persistence.
- Full repository tests, lint, both Gulp builds, generated-template inspection, and `git diff --check` must pass.
