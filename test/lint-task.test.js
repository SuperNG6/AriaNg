'use strict';

// 运行真实 Gulp lint 管道，检查错误传播以及有效源文件不被回写，避免只验证任务源码形状。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ariang-lint-'));

try {
    fs.mkdirSync(path.join(fixture, 'src', 'scripts'), {recursive: true});
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
    fs.copyFileSync(path.join(root, '.eslintrc.json'), path.join(fixture, '.eslintrc.json'));
    const source = path.join(fixture, 'src', 'scripts', 'probe.js');
    const run = (code, active) => {
        fs.writeFileSync(source, code);
        const before = fs.statSync(source).mtimeMs;
        const result = spawnSync(process.execPath, ['-e', `
            const root = ${JSON.stringify(root)};
            const gulp = require(root + '/node_modules/gulp');
            const browserSyncPath = require.resolve(root + '/node_modules/browser-sync');
            const browserSync = Object.create(require(browserSyncPath));
            require.cache[browserSyncPath].exports = browserSync;
            Object.defineProperty(browserSync, 'active', {get: () => ${active}});
            require(root + '/gulpfile.js');
            gulp.series('lint')((error) => { process.exitCode = error ? 1 : 0; });
        `], {cwd: fixture, encoding: 'utf8', timeout: 30000});
        assert.ifError(result.error);
        assert.strictEqual(fs.readFileSync(source, 'utf8'), code, 'lint changed source content');
        assert.strictEqual(fs.statSync(source).mtimeMs, before, 'lint rewrote the source file');
        return result;
    };

    for (const active of [false, true]) {
        const invalid = run('missingGlobal();\n', active);
        assert.notStrictEqual(invalid.status, 0, 'lint accepted an undefined variable');
        assert.match(invalid.stdout + invalid.stderr, /no-undef/, 'failure did not come from ESLint');
        const valid = run("'use strict';\nwindow.alert('lint probe');\n", active);
        assert.strictEqual(valid.status, 0, valid.stdout + valid.stderr);
    }
    console.log('PASS real Gulp lint rejects errors, accepts valid code, and never rewrites source');
} finally {
    fs.rmSync(fixture, {recursive: true, force: true});
}
