# Repository Guidelines

## Project Structure & Module Organization

AriaNg is an AngularJS 1.6 frontend built with Gulp. Application code lives in `src/`: controllers and services are under `src/scripts/`, page templates under `src/views/`, shared and theme CSS under `src/styles/`, and translations under `src/langs/`. `src/index.html` is the application shell. Node-based regression tests live in `test/`. Build and release automation is defined in `gulpfile.js`, `.circleci/`, and `.github/workflows/`. Treat `dist/` and `.tmp/` as generated output; edit sources instead.

## Build, Test, and Development Commands

- `npm ci` installs the exact locked dependencies used by CI.
- `npm test` runs all Node assertion-based regression tests.
- `npx gulp lint` checks JavaScript with ESLint.
- `npm run build` cleans and creates the standard build in `dist/`.
- `npx gulp clean build-bundle` creates the All-In-One `dist/index.html` build.
- `npx gulp serve` starts the source development server with live reload.
- `npx gulp serve:dist` previews the latest generated build.

## Coding Style & Naming Conventions

Follow `.editorconfig`: use spaces, LF line endings, a final newline, and no trailing whitespace. JavaScript, HTML, and CSS use four-space indentation; `package.json` uses two spaces. ESLint requires single-quoted JavaScript strings and semicolons. Follow existing AngularJS names such as `MainController`, `ariaNgSettingService`, and camelCase scope methods. Reuse existing translation keys where possible.

## Testing Guidelines

Tests use Node’s `assert` module and lightweight VM stubs; no coverage threshold is configured. Name new files `test/<feature>.test.js` and add them to the `npm test` script. For behavior changes, first reproduce the regression, then verify the passing implementation. Before submitting UI or build changes, run `npm test`, `npx gulp lint`, and both build variants.

## Commit & Pull Request Guidelines

Use focused Conventional Commit-style subjects seen in history: `feat:`, `fix:`, `style:`, `test:`, `docs:`, `ci:`, or `chore:`. Keep the subject imperative and scoped to one change. Pull requests should explain purpose and behavior, link relevant issues, list verification commands, and include screenshots for visible UI changes—preferably light, dark, and narrow layouts when affected.

## Security & Release Notes

Never commit aria2 RPC secrets, personal endpoints, tokens, `node_modules/`, or generated `dist/` files. When preparing a release, keep the top-level versions in `package.json` and `package-lock.json` identical; the release workflow validates them before publishing.

## BT Small-File Filter Feature

The BT small-file filter (`src/scripts/services/ariaNgBtFileFilterService.js`) is a persisted, retry-hardened state machine over aria2 tasks. Before changing it, read the dedicated maintenance skill: invoke `/bt-filter-dev` or read `.claude/skills/bt-filter-dev/SKILL.md`. It documents the stage state machine, the magnet dual-gid model against the official aria2 docs, and the regression-test gate list. Do not edit the service without first reading that guide.

Authoritative fera facts that Claude would otherwise get wrong:

- aria2 `select-file` indexes are **1-based**; `normalizeIndexes` correctly rejects `<= 0`. Do not "fix" this to 0-based.
- `bt-remove-unselected-file` deletes unselected files **at download completion**, not when the option is set. The filter relies on this timing: `pause-metadata=true` keeps the child paused while the filter restores its file selection, so deletion is never raced under normal flow.
- A magnet creates a metadata **root** task (`followedBy` lists children) plus a spawned BT **child** task (`following` points to the root, `belongsTo` is the parent link). The recovery path must scan **both** `tellWaiting` and `tellActive` for the child — a child may move straight to active. See the pitfall list below.
- Polling is one `getTaskStatus` per 250 ms tick, round-robined by `pollCursor` across non-terminal jobs on the current RPC only. Terminal stages are `completed-*`.

## Internationalization Contract

- English source strings live in `src/scripts/config/defaultLanguage.js` (a JS object). Per-language overrides live in `src/langs/*.txt` as `key=value` lines. There is **no** `en.txt`.
- The BT-filter feature defines **25 keys** (`Exclude BT task files smaller than`, `BT file filter suffix/threshold/size error/warning/cleanup warning`, `BT task pending file filter`, `format.bt-file-filter.*`). These must exist **identically** in `defaultLanguage.js` **and all 10** `src/langs/*.txt`. A missing key in any file silently falls back to English in production.
- Preserve placeholders `{{count}}`, `{{processed}}`, `{{total}}`, `{{filtered}}`, `{{full}}` **verbatim** in every translation — `$translate` injects them by name.
- Any new/changed i18n key must be added to every language file in the same change. `grep -cE "format\.bt-file-filter|BT file filter|Exclude BT task|BT task pending file filter"` each `src/langs/*.txt` and `defaultLanguage.js` — counts must match (currently 25 each).

## SDD Workflow

Non-trivial work follows the spec-driven-development trail under `docs/superpowers/plans/` (plans), `docs/superpowers/specs/` (design specs), and `.superpowers/sdd/` (per-task briefs/reports + `progress.md` gate log). When a change touches the BT filter or release flow, add a dated plan/spec entry and update `.superpowers/sdd/progress.md`. Gates before merge: `npm test`, `npx gulp lint`, `npx gulp clean build` + `npx gulp clean build-bundle`, and a 375px light/dark visual check for UI changes.

## Pitfall Ledger (do not reintroduce)

- **Recovery only scans waiting**: `recoverMetadataChild` historically consulted only `tellWaiting`; a magnet child that moved to active was never found and the job stuck in `waiting-files` forever (badge + "waiting for file list" never cleared). `recoverActiveChild` now falls back to `tellActive` (`getTaskList('downloading')`). Any new recovery branch must consider active children, not just waiting.
- **No service teardown**: `ariaNgBtFileFilterService` exposes `stop()` which cancels polling and resets status to idle; `MainController` calls it on RPC `Unauthorized` and `$destroy` **and** resets `btFileFilterStarted=false` so `start()` can re-arm after RPC recovery. Forgetting the flag reset leaves the filter permanently stopped after a transient disconnect.
- **Hardcoded version in release test**: `test/release-workflow.test.js` asserts `package.json`/`package-lock.json` version equality against a literal. When bumping the release version, update that literal, the `workflow_dispatch` default in `.github/workflows/release.yml`, and create `docs/releases/$VERSION.md` together — the release workflow validates the notes file exists.
- **Test dependency stubs must track new injections**: adding a dependency to a controller requires adding a stub for it in `test/*.test.js` harnesses (e.g. `ariaNgBtFileFilterService.getPendingGidStageMap` in `test/task-list-file-list.test.js`).
