'use strict';

const assert = require('assert');
const fs = require('fs');

const workflowPath = '.github/workflows/release.yml';

assert(fs.existsSync(workflowPath), 'release workflow must exist');

const workflow = fs.readFileSync(workflowPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));

assert.strictEqual(packageJson.version, '2.0.0');
assert.strictEqual(packageLock.version, '2.0.0');

[
    'workflow_dispatch:',
    "- '*.*.*'",
    'contents: write',
    'actions/checkout@v6',
    'actions/setup-node@v6',
    "node-version: '24'",
    'actions/upload-artifact@v6',
    'npm ci',
    '- name: Run tests',
    'run: npm test',
    'npx gulp clean build',
    'npx gulp clean build-bundle',
    'AriaNg-${VERSION}.zip',
    'AriaNg-${VERSION}-AllInOne.zip',
    '--verify-tag',
    '--target "$GITHUB_SHA"',
    '--generate-notes',
    'GH_TOKEN: ${{ github.token }}',
    'persist-credentials: false',
    'fetch-depth: 0',
    'if-no-files-found: error'
].forEach(function (contract) {
    assert(workflow.includes(contract), 'workflow is missing: ' + contract);
});

const installIndex = workflow.indexOf('- name: Install dependencies');
const testIndex = workflow.indexOf('- name: Run tests');
const validateIndex = workflow.indexOf('- name: Validate version and release state');
const buildIndex = workflow.indexOf('- name: Build standard archive');
const publishIndex = workflow.indexOf('- name: Publish existing tag');

assert(installIndex >= 0 && testIndex > installIndex, 'tests must run after npm ci');
assert(testIndex < validateIndex, 'tests must run before version and release validation');
assert(testIndex < buildIndex, 'tests must run before builds');
assert(testIndex < publishIndex, 'tests must run before publish');

assert(/\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/.test(workflow), 'workflow must strictly validate unprefixed versions');
assert(workflow.includes('github.event_name == \'workflow_dispatch\''), 'manual and tag release paths must be distinct');
assert(!workflow.includes('--clobber'), 'release assets must never be overwritten');
assert(!workflow.includes('--draft'), 'release must not be a draft');
assert(!workflow.includes('--prerelease'), 'release must not be a prerelease');
assert(!workflow.includes('git ls-remote --exit-code'), 'a network error must not be mistaken for a missing tag');

console.log('PASS release workflow contract');
