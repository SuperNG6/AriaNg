'use strict';

const assert = require('assert');
const fs = require('fs');

const workflowPath = '.github/workflows/release.yml';

assert(fs.existsSync(workflowPath), 'release workflow must exist');

const workflow = fs.readFileSync(workflowPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));

assert.strictEqual(packageJson.version, '1.3.15');
assert.strictEqual(packageLock.version, '1.3.15');

[
    'workflow_dispatch:',
    "- '*.*.*'",
    'contents: write',
    'actions/checkout@v6',
    'actions/setup-node@v6',
    "node-version: '20'",
    'actions/upload-artifact@v6',
    'npm ci',
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

assert(/\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/.test(workflow), 'workflow must strictly validate unprefixed versions');
assert(workflow.includes('github.event_name == \'workflow_dispatch\''), 'manual and tag release paths must be distinct');
assert(!workflow.includes('--clobber'), 'release assets must never be overwritten');
assert(!workflow.includes('--draft'), 'release must not be a draft');
assert(!workflow.includes('--prerelease'), 'release must not be a prerelease');

console.log('PASS release workflow contract');
