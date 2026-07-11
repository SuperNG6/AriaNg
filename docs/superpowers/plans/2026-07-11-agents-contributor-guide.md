# Repository Contributor Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a concise root-level `AGENTS.md` that gives contributors accurate, actionable guidance for working in this AriaNg repository.

**Architecture:** The guide is a standalone Markdown document derived from current repository configuration and history. It documents structure, commands, style, tests, contribution workflow, and release safety without introducing new policies.

**Tech Stack:** Markdown, AngularJS 1.6, Node.js, npm, Gulp 4, ESLint, GitHub Actions.

## Global Constraints

- Title must be exactly `# Repository Guidelines`.
- Final body must be between 200 and 400 words.
- Use professional, direct English and repository-specific examples.
- Do not invent coverage thresholds, branch protection, or mandatory policies absent from the repository.
- Create only root-level `AGENTS.md`; do not change application code or build configuration.

---

### Task 1: Create and validate the contributor guide

**Files:**
- Create: `AGENTS.md`

**Interfaces:**
- Consumes: `.editorconfig`, `.eslintrc.json`, `package.json`, `gulpfile.js`, `.github/workflows/release.yml`, `test/`, and recent Git history.
- Produces: repository-wide contributor instructions in `AGENTS.md`.

- [ ] **Step 1: Confirm the guide is absent**

Run:

```bash
test ! -e AGENTS.md
```

Expected: exit code `0`, proving the new document does not already exist.

- [ ] **Step 2: Create `AGENTS.md` with the approved content**

```markdown
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
```

- [ ] **Step 3: Validate title, word count, and required sections**

Run:

```bash
test "$(head -1 AGENTS.md)" = "# Repository Guidelines"
WORDS="$(wc -w < AGENTS.md | tr -d ' ')"
test "$WORDS" -ge 200
test "$WORDS" -le 400
for heading in "Project Structure & Module Organization" "Build, Test, and Development Commands" "Coding Style & Naming Conventions" "Testing Guidelines" "Commit & Pull Request Guidelines" "Security & Release Notes"; do
  grep -qx "## $heading" AGENTS.md
done
git diff --check
```

Expected: every command exits `0`; the word count is within 200–400 and no whitespace errors are reported.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git diff -- AGENTS.md
git status --short
```

Expected: `AGENTS.md` is the only uncommitted file and contains no generic or unsupported repository policy.
