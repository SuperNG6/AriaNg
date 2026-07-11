# GitHub Actions 1.3.15 Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish AriaNg 1.3.15 as standard and All-In-One GitHub Release assets from either a version tag or a manual workflow run.

**Architecture:** A single least-privilege workflow validates the trigger version against source metadata, builds both historical package layouts, validates and uploads them, then uses GitHub CLI to create a non-overwriting final Release. Manual runs create the missing version tag at the selected branch commit; tag runs verify the existing tag.

**Tech Stack:** GitHub Actions, Node.js 20, npm, Gulp 4, Bash, zip/unzip, GitHub CLI.

## Global Constraints

- Version and tag are exactly `1.3.15`, without a `v` prefix.
- Support both `push.tags: '*.*.*'` and `workflow_dispatch` with required `version` input.
- Manual release targets the selected branch's `GITHUB_SHA` and creates the missing tag.
- Publish only `AriaNg-1.3.15.zip` and `AriaNg-1.3.15-AllInOne.zip` as custom Release assets.
- Use GitHub-generated notes, final release status, and title `AriaNg 1.3.15`.
- Never overwrite or move an existing tag, Release, or asset.
- Keep CircleCI unchanged; use only official Actions plus preinstalled `gh`.

---

### Task 1: Bump source version and add workflow contract tests

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `test/release-workflow.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: source version `1.3.15` in both package metadata files.
- Produces: tests for triggers, official action versions, permissions, validation, package names, build commands, and both `gh release create` branches.

- [ ] **Step 1: Add a failing workflow contract test**

Read `.github/workflows/release.yml` as text and assert the tag/manual triggers, `contents: write`, Node 20, checkout/setup-node/upload-artifact v6, both Gulp builds, both ZIP names, `--verify-tag`, `--target "$GITHUB_SHA"`, and `--generate-notes`. Assert both package versions are `1.3.15`.

- [ ] **Step 2: Extend `npm test`**

Set the command to `node test/task-list-file-list.test.js && node test/release-workflow.test.js`, then run it. Expected: failure because the workflow is absent and versions are still `1.3.14`.

- [ ] **Step 3: Bump both metadata versions**

Change only the top-level `version` value in `package.json` and package-lock v1 root from `1.3.14` to `1.3.15`.

- [ ] **Step 4: Commit the red workflow test and version bump**

```bash
git add package.json package-lock.json test/release-workflow.test.js
git commit -m "chore: bump version to 1.3.15"
```

### Task 2: Implement the release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Inputs: tag ref or `workflow_dispatch.inputs.version`.
- Outputs: two validated ZIPs, one Actions artifact, version tag when manual, and a final GitHub Release.

- [ ] **Step 1: Add triggers, concurrency, and least privilege**

Define tag and manual triggers, `permissions: contents: write`, `ubuntu-latest`, and version-keyed concurrency with cancellation disabled. Check out full history with credentials disabled, then set up Node 20 with npm cache.

- [ ] **Step 2: Validate version and remote state before build**

In Bash with `set -euo pipefail`, resolve `VERSION`, validate the no-prefix three-part pattern, compare both package versions, reject an existing Release, reject an existing tag for manual runs, and verify the tag commit for tag runs. Export `VERSION` through `$GITHUB_ENV`.

- [ ] **Step 3: Build and package both layouts**

Run `npm ci`, then `npx gulp clean build` and zip from inside `dist`. Run `npx gulp clean build-bundle` and zip its two root files. Store both in `release/`.

- [ ] **Step 4: Validate and upload**

Run `unzip -t`, assert required standard paths, and compare the sorted All-In-One root list to exactly `LICENSE` and `index.html`. Upload `release/*.zip` with `actions/upload-artifact@v6` and `if-no-files-found: error`.

- [ ] **Step 5: Publish through GitHub CLI**

With `GH_TOKEN: ${{ github.token }}`, use `--verify-tag` on tag runs and `--target "$GITHUB_SHA"` on manual runs. Pass both assets, title, and `--generate-notes`; do not pass draft, prerelease, or clobber options.

- [ ] **Step 6: Run contract tests and static validation**

Run `npm test`, parse the YAML with Ruby's `YAML.safe_load`, and run `actionlint` when installed. Expected: all contract assertions pass and YAML parses.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/release.yml test/release-workflow.test.js package.json
git commit -m "ci: add GitHub release workflow"
```

### Task 3: Reproduce release assets locally and audit

**Files:**
- Verify only; generated `dist/` and `release/` remain ignored or are removed.

**Interfaces:**
- Produces: local evidence that both build layouts and filenames are releasable.

- [ ] **Step 1: Install reproducibly and run all checks**

Run `npm ci`, `npm test`, and `npx gulp lint`. Expected: exit zero.

- [ ] **Step 2: Build and inspect the standard package**

Run the exact workflow build/zip commands, `unzip -t`, and `unzip -Z1`. Confirm required root resources and no wrapper directory.

- [ ] **Step 3: Build and inspect All-In-One**

Run the exact bundle/zip commands and assert its sorted root list is exactly `LICENSE` and `index.html`.

- [ ] **Step 4: Audit changes and commit any verification correction**

Run `git diff --check`, `git status --short`, and review every workflow line. If validation exposed a defect, fix it test-first and commit with `fix: correct release workflow validation`.

### Task 4: Push, release, and monitor 1.3.15

**Files:**
- External state: GitHub `master`, Actions run, tag `1.3.15`, Release `1.3.15`.

**Interfaces:**
- Consumes: verified commits from the feature and workflow plans.
- Produces: public GitHub Release 1.3.15 with two downloadable assets.

- [ ] **Step 1: Push the current master branch**

Verify `git status` is clean and local `master` is ahead only by intended commits, then run `git push origin master`.

- [ ] **Step 2: Trigger the manual release workflow**

Run `gh workflow run release.yml --ref master -f version=1.3.15`. This is the selected method because it atomically creates the missing tag at current `master` after validation.

- [ ] **Step 3: Monitor to terminal state**

Find the workflow run, watch it with `gh run watch --exit-status`, and inspect failed logs if necessary. Fix reproducible workflow defects, push, and rerun only while neither tag nor Release was created; never overwrite external release state.

- [ ] **Step 4: Audit the published release**

Use `gh release view 1.3.15 --json tagName,isDraft,isPrerelease,targetCommitish,assets,url` and remote Git refs. Confirm the tag resolves to the intended master commit, the Release is final, and the two custom ZIP assets have the exact names and nonzero sizes.
