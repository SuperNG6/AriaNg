# Repository Guidelines

## Project Context & Structure

This repository is the SuperNG6 fork of [mayswind/AriaNg](https://github.com/mayswind/AriaNg). Fork-owned features are the BT small-file filter (new tasks and bulk filtering of downloading tasks), the inline task-list file list, and the new-task download path with per-RPC path history; everything else is inherited upstream code. The maintenance focus is the BT filter and the task-list file list; spend review, testing, and improvement effort there. The download-path history and inherited code get real-bug fixes only, kept minimal and local so later upstream merges stay easy.

AriaNg is an AngularJS 1.6 frontend built with Gulp. Application code lives in `src/`: controllers and services are under `src/scripts/`, page templates under `src/views/`, shared and theme CSS under `src/styles/`, and translations under `src/langs/`. `src/index.html` is the application shell. Node-based regression tests live in `test/`. Build and release automation is defined in `gulpfile.js` and `.github/workflows/`. Treat `dist/` and `.tmp/` as generated output; edit sources instead.

## Product Specs & Docs

| Path | Role |
| --- | --- |
| `docs/prd/bt-small-file-filter.md`, `task-list-file-list.md`, `new-task-download-path.md` | Authoritative current-behavior specs for fork features |
| [.claude/skills/bt-filter-dev/SKILL.md](.claude/skills/bt-filter-dev/SKILL.md) | BT filter aria2 contract, state machine, and pitfall ledger |
| [docs/upstream-merge.md](docs/upstream-merge.md) | Upstream baseline, merge conventions, and browser acceptance tooling |
| `docs/releases/` | Per-version release notes |
| `docs/audits/`, `docs/prd/bt-filter-improvement.md`, `docs/prd/code-cleanup-spec.md` | Historical; decision background only, not current behavior |

When a change alters user-visible behavior or a documented contract, update the matching PRD in the same change. Code and tests take precedence over docs; when they disagree, correct the doc rather than reshaping code to match stale text. Fork docs and code comments are mostly Simplified Chinese; match the surrounding language, and write comments that explain constraints or reasons rather than restate the code. This file, the Skill, and commit subjects stay in English.

## Build, Test, and Development Commands

- `npm ci` installs locked dependencies; use it for initial setup or when the lockfile changes. The fork release and Pages workflows use Node 24 and `npm ci`; upstream development workflows use Node 24 and `npm install`. Without a local Node 24, run the same commands in a disposable `node:24` container.
- `npm test` runs all Node assertion-based regression tests.
- `npm run test:browser` sequentially builds and checks both distributions with mocked RPC in Chromium; see [upstream merge and QA setup](docs/upstream-merge.md).
- `test/aria2/run.sh [git-ref]` (or `npm run test:aria2`) needs only Docker: it drives a build against disposable real aria2c containers (two downloaders and a seeder behind a local tracker) and checks task dirs, queue order, file selections, and written files, including BT filter runs end to end. Pass an older ref as a before-fix control.
- `npx gulp lint` checks JavaScript with ESLint.
- `npm run build` cleans and creates the standard build in `dist/`.
- `npx gulp clean build-bundle` creates the All-In-One `dist/index.html` build.
- `npx gulp serve` starts the source development server with live reload.
- `npx gulp serve:dist` previews the latest generated build.

## Coding Style & Naming Conventions

Follow `.editorconfig`: use spaces, LF line endings, a final newline, and no trailing whitespace (Markdown retains the `.editorconfig` exception for intentional trailing spaces). JavaScript, HTML, and CSS use four-space indentation; `package.json` uses two spaces. ESLint requires single-quoted JavaScript strings and semicolons. Follow existing AngularJS names such as `MainController`, `ariaNgSettingService`, and camelCase scope methods. Reuse existing translation keys where possible.

## Verification by Change Risk

Tests use Node's `assert` module and lightweight VM stubs. Add meaningful behavior regression tests to `test/<feature>.test.js` and register new suites in `npm test`; reproduce a bug before fixing it where feasible. Do not add implementation-mirroring tests for documentation, formatting, or other low-impact edits.

Each suite loads source files into a VM context with hand-written stubs that cover only what the code calls today. When code starts calling another dependency method, update the stubs in every suite that loads that file; a `... is not a function` failure after a source change usually means a stale stub, not a product bug. The existing harnesses (`loadFilterService`, `createSubmission`, `loadWebSocketRpcService`) are the quickest way to reproduce a bug before fixing it. They do not model Angular template behavior: `ng-if` and `ng-repeat` create child scopes, so a primitive `ng-model` stops following the directive scope once the user types, and text inputs trim surrounding whitespace by default (`ngTrim`). Confirm template or binding bugs in a real browser (`npm run test:browser`, extending it if needed), and run the check against the old code to prove it catches the bug.

| Change | Completion checks |
| --- | --- |
| Rules, documentation, comments only | Review content, references, and `git diff --check`; no application tests or builds. |
| BT copy or translations | `node test/i18n-contract.test.js`; inspect affected UI when text length or meaning changes its presentation. |
| Local JavaScript behavior | Focused regression tests while developing; `npm test` and lint at handoff. Build when packaging, injection, or minification may be affected. |
| CSS, templates, UI interaction | Check affected states and representative shared layouts; standard build and relevant tests. Include 375px light/dark checks when mobile layout or themes are affected; check bundle output when asset loading or embedding is affected. |
| BT state machine, RPC, recovery, persistence | Relevant failure-path regressions, `npm test`, both builds, and integration scenarios selected for the changed behavior; `test/aria2/run.sh` for new-task options, paths, transports, task ordering, or filter RPC semantics. |
| Build chain, dependencies, release | `npm test`, both builds, and affected artifact checks; releases also require `npm run test:i18n-release` and the release contract below. |

Both `npx gulp clean build` and `npx gulp clean build-bundle` include lint, so a separate final lint run is unnecessary when building. Use `npx gulp lint` for early feedback or when no build is needed. Run the two clean/build variants sequentially because they share output directories. Expand verification for concrete dependency impact, failures, or unresolved risk, not simply because a file changed.

Results remain valid for the tested source/configuration state. Documentation-only evidence updates and commits do not require repeating successful checks; recheck affected outputs if Git metadata changes embedded build information. Missing environments must be reported as unverified, not passed; complete independent work and try suitable local/mock verification before declaring a required check blocked.

## Cross-Cutting Pitfalls

These patterns caused real bugs outside the BT filter; the Skill keeps the BT-specific ledger.

- **JSON-RPC success is the presence of `result`, not its truthiness.** `aria2.changePosition` returns `0` when a task moves to the top; a truthiness check silently drops the callback and froze list refreshing after drag-and-drop. Keep presence checks in every transport.
- **Blank required options are omitted, never sent as `''`.** Options marked `required` in `aria2Options.js` are deleted when cleared on the options tab. aria2 accepts an empty `dir` and downloads into its own working directory. `buildRequestOptions()` in `aria2RpcService` drops them for every add request, including the `#!/new` URL command; `getSubmissionOptions()` in `controllers/new.js` additionally drops a blank `dir` from the exported command, which bypasses the RPC layer.
- **A successful `system.multicall` does not mean every item succeeded.** Keep per-item `success`, `data`, `context.task`, and input order; see the conventions in [docs/upstream-merge.md](docs/upstream-merge.md).
- **Per-server state is keyed by `ariaNgSettingService.getCurrentRpcIdentity()`.** The identity is `protocol|host|port|interface` (no secret) taken from a page-load snapshot, so unsaved setting edits cannot redirect in-flight work.

## Upstream Merges

Use [docs/upstream-merge.md](docs/upstream-merge.md) for the last merged upstream baseline, namespaced tags, fork compatibility decisions, and reusable acceptance commands. Add the `upstream` remote first if the clone lacks it. Update the baseline after each upstream merge; inspect semantic compatibility even when Git reports no conflicts.

## Commit & Pull Request Guidelines

Use focused Conventional Commit-style subjects seen in history: `feat:`, `fix:`, `style:`, `test:`, `docs:`, `ci:`, or `chore:`. Keep the subject imperative and scoped to one change. Pull requests should explain purpose and behavior, link relevant issues, list verification commands, and include screenshots for visible UI changes—preferably light, dark, and narrow layouts when affected.

## Security & Release Notes

Never commit aria2 RPC secrets, personal endpoints, tokens, `node_modules/`, or generated `dist/` files. When preparing a release, synchronize `package.json`, both the top-level and root-package versions in `package-lock.json`, the current literals in `test/release-workflow.test.js`, and the `workflow_dispatch` default in `.github/workflows/release.yml`; create `docs/releases/$VERSION.md`. Keep release version, translation, archive integrity, and existing-tag protection checks.

## BT Small-File Filter Feature

For BT state-machine, RPC, badge, or copy changes, use the task index in [.claude/skills/bt-filter-dev/SKILL.md](.claude/skills/bt-filter-dev/SKILL.md) and read the relevant sections before editing. Reuse already-read, unchanged material. Service changes require understanding the affected lifecycle and recovery invariants; copy-only edits do not require reading state-machine history.

Preserve 1-based file indexes, completion-time deletion semantics, recovery across waiting and active children, pause ownership, and stop/restart behavior. The Skill maintains the detailed contracts and pitfall ledger in one place; user-facing behavior is specified in [docs/prd/bt-small-file-filter.md](docs/prd/bt-small-file-filter.md).

## Internationalization Contract

- English source strings live in `src/scripts/config/defaultLanguage.js` (a JS object). Per-language overrides live in `src/langs/*.txt` as `key=value` lines. There is **no** `en.txt`.
- During feature development, add or change BT-filter copy only in `defaultLanguage.js` and `src/langs/zh_Hans.txt`. Other locales may fall back to English until copy freezes.
- `npm test` checks that English and Simplified Chinese BT-filter keys and named placeholders match. Do not assert a literal key count.
- Before a release, translate the frozen copy in every `src/langs/*.txt` file and run `npm run test:i18n-release`; the release workflow blocks missing keys or placeholder drift.
- Preserve every named placeholder (for example `{{count}}`, `{{files}}`, `{{threshold}}`, `{{processed}}`, `{{total}}`, `{{filtered}}`, `{{skipped}}`, `{{failed}}`, and `{{full}}`) verbatim in each required translation.

## Completion and Cleanup

A task is complete when its agreed deliverable is implemented or reviewed, applicable checks are finished, and the handoff states the result and any remaining limitations. If a required check is blocked, distinguish completed implementation from incomplete acceptance and explain the concrete blocker. Continue authorized, independent work rather than stopping at a plan or partial result.

Carry forward current-session authorization. Ask only for information or authorization that is necessary and missing; do not repeatedly reconfirm routine reversible work. Commit, push, merge, and publish according to the current task's scope, not a historical checklist. A clean entire worktree or a new commit is not required for a local handoff; preserve unrelated user changes and isolate overlapping work where possible.

Clean only temporary files and processes created for this task when no longer needed; retain previews requested by the user. Do not delete user files, sessions, branches, or worktrees to satisfy a generic cleanup gate. Keep durable design/evidence files separate from runtime state. `gulp clean` deletes both `.tmp` and `dist`, so account for any preview using them before cleaning.
