# AGENTS.md Contributor Guide Design

## Purpose

Create a root-level `AGENTS.md` titled “Repository Guidelines” that gives human and agent contributors a concise, repository-specific operating guide. The final document will be written in English, use direct instructional language, and stay between 200 and 400 words.

## Content Structure

The guide will contain six short sections:

1. **Project Structure & Module Organization** — identify AngularJS code under `src/scripts/`, templates under `src/views/`, CSS under `src/styles/`, translations under `src/langs/`, Node regression tests under `test/`, automation under `.github/workflows/`, and generated output under `dist/`.
2. **Build, Test, and Development Commands** — document `npm ci`, `npm test`, `npm run build`, `npx gulp clean build-bundle`, `npx gulp serve`, and `npx gulp serve:dist` with one-line purposes.
3. **Coding Style & Naming Conventions** — reflect `.editorconfig` and `.eslintrc.json`: four-space indentation except two spaces in `package.json`, LF endings, single-quoted JavaScript strings, semicolons, and existing AngularJS naming patterns.
4. **Testing Guidelines** — describe the dependency-free Node assertion tests, `*.test.js` naming, regression-test expectations, and the required local verification commands.
5. **Commit & Pull Request Guidelines** — summarize the observed Conventional Commit-style prefixes and require focused descriptions, linked issues when applicable, verification notes, and screenshots for visible UI changes.
6. **Security & Release Notes** — prohibit secrets and generated artifacts, and note that release version changes must keep `package.json` and `package-lock.json` synchronized.

## Scope Boundaries

- Do not invent coverage thresholds, branch policies, or review requirements that are not present in the repository.
- Do not duplicate the README’s product introduction or provide a full architecture tutorial.
- Do not include release-triggering instructions beyond contributor-safe version consistency guidance.
- Keep examples specific to this repository and avoid generic boilerplate.

## Validation

- Confirm the title is exactly `# Repository Guidelines`.
- Confirm the body is 200–400 words.
- Check Markdown headings, command spelling, paths, and alignment with current package scripts, Gulp tasks, EditorConfig, ESLint, tests, and Git history.
- Run `git diff --check` and ensure only the intended documentation files change.
