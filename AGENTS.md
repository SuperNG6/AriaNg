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
