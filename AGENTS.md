# Repository Guidelines

## Project Structure & Module Organization

AriaNg is an AngularJS 1.6 frontend built with Gulp. Application code lives in `src/`: controllers and services are under `src/scripts/`, page templates under `src/views/`, shared and theme CSS under `src/styles/`, and translations under `src/langs/`. `src/index.html` is the application shell. Node-based regression tests live in `test/`. Build and release automation is defined in `gulpfile.js`, `.circleci/`, and `.github/workflows/`. Treat `dist/` and `.tmp/` as generated output; edit sources instead.

## Build, Test, and Development Commands

- `npm ci` installs locked dependencies; use it for initial setup or when the lockfile changes. GitHub Actions uses Node 24 and `npm ci`; the legacy CircleCI configuration uses Node 14 and `npm install` (its live status is not established by this repository).
- `npm test` runs all Node assertion-based regression tests.
- `npx gulp lint` checks JavaScript with ESLint.
- `npm run build` cleans and creates the standard build in `dist/`.
- `npx gulp clean build-bundle` creates the All-In-One `dist/index.html` build.
- `npx gulp serve` starts the source development server with live reload.
- `npx gulp serve:dist` previews the latest generated build.

## Coding Style & Naming Conventions

Follow `.editorconfig`: use spaces, LF line endings, a final newline, and no trailing whitespace (Markdown retains the `.editorconfig` exception for intentional trailing spaces). JavaScript, HTML, and CSS use four-space indentation; `package.json` uses two spaces. ESLint requires single-quoted JavaScript strings and semicolons. Follow existing AngularJS names such as `MainController`, `ariaNgSettingService`, and camelCase scope methods. Reuse existing translation keys where possible.

## Verification by Change Risk

Tests use Node's `assert` module and lightweight VM stubs. Add meaningful behavior regression tests to `test/<feature>.test.js` and register new suites in `npm test`; reproduce a bug before fixing it where feasible. Do not add implementation-mirroring tests for documentation, formatting, or other low-impact edits.

| Change | Completion checks |
| --- | --- |
| Rules, documentation, comments only | Review content, references, and `git diff --check`; no application tests or builds. |
| BT copy or translations | `node test/i18n-contract.test.js`; inspect affected UI when text length or meaning changes its presentation. |
| Local JavaScript behavior | Focused regression tests while developing; `npm test` and lint at handoff. Build when packaging, injection, or minification may be affected. |
| CSS, templates, UI interaction | Check affected states and representative shared layouts; standard build and relevant tests. Include 375px light/dark checks when mobile layout or themes are affected; check bundle output when asset loading or embedding is affected. |
| BT state machine, RPC, recovery, persistence | Relevant failure-path regressions, `npm test`, both builds, and integration scenarios selected for the changed behavior. |
| Build chain, dependencies, release | `npm test`, both builds, and affected artifact checks; releases also require `npm run test:i18n-release` and the release contract below. |

Both `npx gulp clean build` and `npx gulp clean build-bundle` include lint, so a separate final lint run is unnecessary when building. Use `npx gulp lint` for early feedback or when no build is needed. Run the two clean/build variants sequentially because they share output directories. Expand verification for concrete dependency impact, failures, or unresolved risk, not simply because a file changed.

Results remain valid for the tested source/configuration state. Documentation-only evidence updates and commits do not require repeating successful checks; recheck affected outputs if Git metadata changes embedded build information. Missing environments must be reported as unverified, not passed; complete independent work and try suitable local/mock verification before declaring a required check blocked.

## Commit & Pull Request Guidelines

Use focused Conventional Commit-style subjects seen in history: `feat:`, `fix:`, `style:`, `test:`, `docs:`, `ci:`, or `chore:`. Keep the subject imperative and scoped to one change. Pull requests should explain purpose and behavior, link relevant issues, list verification commands, and include screenshots for visible UI changes—preferably light, dark, and narrow layouts when affected.

## Security & Release Notes

Never commit aria2 RPC secrets, personal endpoints, tokens, `node_modules/`, or generated `dist/` files. When preparing a release, synchronize `package.json`, both the top-level and root-package versions in `package-lock.json`, the current literals in `test/release-workflow.test.js`, and the `workflow_dispatch` default in `.github/workflows/release.yml`; create `docs/releases/$VERSION.md`. Keep release version, translation, archive integrity, and existing-tag protection checks.

## BT Small-File Filter Feature

For BT state-machine, RPC, badge, or copy changes, use the task index in [.claude/skills/bt-filter-dev/SKILL.md](.claude/skills/bt-filter-dev/SKILL.md) and read the relevant sections before editing. Reuse already-read, unchanged material. Service changes require understanding the affected lifecycle and recovery invariants; copy-only edits do not require reading state-machine history.

Preserve 1-based file indexes, completion-time deletion semantics, recovery across waiting and active children, pause ownership, and stop/restart behavior. The Skill maintains the detailed contracts and pitfall ledger in one place.

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
