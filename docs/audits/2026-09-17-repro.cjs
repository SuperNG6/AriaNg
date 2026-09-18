'use strict';

// Original A1–A6 reproductions are now maintained as passing behavior regressions.
const path = require('path');
const {spawnSync} = require('child_process');
const root = path.resolve(__dirname, '../..');
for (const suite of ['test/audit-regressions.test.js', 'test/aria2-websocket-rpc.test.js',
    'test/new-task-small-file-filter.test.js']) {
    const result = spawnSync(process.execPath, [suite], {cwd: root, stdio: 'inherit'});
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}
