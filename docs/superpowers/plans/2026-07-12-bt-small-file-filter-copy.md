# BT Small File Filter Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ambiguous BT file-filter wording with copy that clearly says small files are excluded and every reported number counts BT tasks.

**Architecture:** Keep the existing filter state machine unchanged. Update the toolbar template to form a complete localized sentence around the threshold input, split compact status text by state, and keep English, Simplified Chinese, and Traditional Chinese translations aligned. Lock the semantics with source-level regression assertions.

**Tech Stack:** AngularJS 1.6 templates, angular-translate language resources, Node `assert` regression tests, Gulp.

## Global Constraints

- Use “exclude small files” for the action and “keep all files” for the no-op or fallback outcome.
- Every status count is a BT task count, never a file count.
- The control appears only on `/new` and applies only to magnet links and torrent tasks.
- If every file is below the threshold, keep all files.
- A fallback may remain paused for “Download Later”; never claim that it has already downloaded.
- Do not change filtering, queue recovery, retry, cleanup, or start/pause behavior.
- Keep the existing light, dark, tablet, and narrow layout rules.

---

### Task 1: Clarify the toolbar control and status copy

**Files:**
- Modify: `test/new-task-small-file-filter.test.js:2221-2252`
- Modify: `src/index.html:172-201`
- Modify: `src/scripts/config/defaultLanguage.js:43-51`
- Modify: `src/langs/zh_Hans.txt:39-47`
- Modify: `src/langs/zh_Hant.txt:39-47`

**Interfaces:**
- Consumes: existing `btFileFilterContext`, `btFileFilterStatus.type`, `filtered`, `full`, `fallback`, and `total` fields.
- Produces: translation keys `Exclude BT task files smaller than`, `BT file filter suffix`, `BT file filter threshold`, and `format.bt-file-filter.compact.<state>` for `resuming`, `waiting`, `processing`, `complete`, and `warning`.

- [ ] **Step 1: Replace the broad source assertions with failing semantic copy assertions**

Update the toolbar test so it verifies the complete control structure and exact Simplified Chinese meanings:

```js
const simplifiedChinese = read('src/langs/zh_Hans.txt');
const traditionalChinese = read('src/langs/zh_Hant.txt');

assert(index.includes('<span class="bt-file-filter-label" translate>Exclude BT task files smaller than</span>'));
assert(index.includes('<span class="bt-file-filter-suffix" translate>BT file filter suffix</span>'));
assert(index.includes("aria-label=\"{{'BT file filter threshold' | translate}}\""));
assert(simplifiedChinese.includes('Exclude BT task files smaller than=排除 BT 任务中小于'));
assert(simplifiedChinese.includes('BT file filter suffix=的文件'));
assert(simplifiedChinese.includes('format.bt-file-filter.complete=BT 小文件处理完成：{{filtered}} 个任务已排除小文件，{{full}} 个任务保留全部文件'));
assert(simplifiedChinese.includes('format.bt-file-filter.fallback={{count}} 个 BT 任务无法排除小文件，已回退为保留全部文件'));
assert(traditionalChinese.includes('Exclude BT task files smaller than=排除 BT 工作中小於'));
```

Replace the compact-status test with state-specific key assertions:

```js
assert(index.includes("'format.bt-file-filter.compact.' + btFileFilterStatus.type"));
assert(simplifiedChinese.includes('format.bt-file-filter.compact.resuming=恢复 {{count}}'));
assert(simplifiedChinese.includes('format.bt-file-filter.compact.waiting=等待 {{count}}'));
assert(simplifiedChinese.includes('format.bt-file-filter.compact.processing=处理中 {{count}}'));
assert(simplifiedChinese.includes('format.bt-file-filter.compact.complete=已处理 {{count}}'));
assert(simplifiedChinese.includes('format.bt-file-filter.compact.warning=已回退 {{count}}'));
```

- [ ] **Step 2: Run the focused test and confirm it fails for the old keys**

Run: `node test/new-task-small-file-filter.test.js`

Expected: FAIL in `renders the remembered filter and global toolbar status` because `Exclude BT task files smaller than` and the state-specific compact keys do not exist yet.

- [ ] **Step 3: Form a complete toolbar sentence and use state-specific compact text**

In `src/index.html`, replace the label, accessible name, suffix, and compact key expression while preserving the current model and count expression:

```html
<label class="bt-file-filter-toggle" title="{{'BT file filter cleanup warning' | translate}}">
    <input type="checkbox" ng-model="btFileFilterContext.enabled"
           ng-change="saveBtFileFilterSetting()"/>
    <span class="bt-file-filter-label" translate>Exclude BT task files smaller than</span>
</label>
<input class="form-control bt-file-filter-size" type="number" min="1" max="102400" step="1"
       ng-model="btFileFilterContext.minSizeMb" ng-disabled="!btFileFilterContext.enabled"
       ng-change="saveBtFileFilterSetting()"
       ng-class="{'has-error': btFileFilterContext.enabled && !isBtFileFilterValid()}"
       aria-label="{{'BT file filter threshold' | translate}}"
       aria-invalid="{{btFileFilterContext.enabled && !isBtFileFilterValid()}}"/>
<span class="bt-file-filter-unit">MB</span>
<span class="bt-file-filter-suffix" translate>BT file filter suffix</span>
```

Use a compact key determined by the status type:

```html
<span class="bt-file-filter-status-compact"
      ng-bind="('format.bt-file-filter.compact.' + btFileFilterStatus.type) | translate: {count: btFileFilterStatus.type === 'warning' ? btFileFilterStatus.fallback : (btFileFilterStatus.type === 'complete' ? (btFileFilterStatus.filtered + btFileFilterStatus.full) : ({processing: btFileFilterStatus.total, waiting: btFileFilterStatus.textParams.count, resuming: btFileFilterStatus.textParams.count})[btFileFilterStatus.type])}"></span>
```

`processing` 显示整批任务数；`waiting` 和 `resuming` 必须使用协调器提供的当前待处理数量，不能回退到整批 `total`。

- [ ] **Step 4: Replace English, Simplified Chinese, and Traditional Chinese copy**

Use these exact English values in `src/scripts/config/defaultLanguage.js`:

```js
'Exclude BT task files smaller than': 'Exclude BT task files smaller than',
'BT file filter suffix': '',
'BT file filter threshold': 'BT file exclusion threshold in MB',
'format.bt-file-filter.resuming': 'Resuming small-file processing for {{count}} unfinished BT tasks',
'format.bt-file-filter.processing': 'Excluding small files from BT tasks: {{processed}}/{{total}} tasks processed',
'format.bt-file-filter.waiting': 'Waiting for file lists from {{count}} BT tasks',
'format.bt-file-filter.complete': 'BT small-file processing complete: {{filtered}} tasks excluded small files, {{full}} tasks kept all files',
'format.bt-file-filter.fallback': '{{count}} BT tasks could not exclude small files and fell back to keeping all files',
'format.bt-file-filter.compact.resuming': 'Resume {{count}}',
'format.bt-file-filter.compact.waiting': 'Wait {{count}}',
'format.bt-file-filter.compact.processing': 'Processing {{count}}',
'format.bt-file-filter.compact.complete': 'Processed {{count}}',
'format.bt-file-filter.compact.warning': 'Fallback {{count}}',
'BT file filter cleanup warning': 'Only applies to new magnet and torrent tasks. For tasks containing both small and large files, files below the threshold are excluded; if every file is below the threshold, all files are kept. After completion, aria2 may delete excluded files and same-named files already present in the download directory.',
```

Use these exact Simplified Chinese values in `src/langs/zh_Hans.txt`:

```text
Exclude BT task files smaller than=排除 BT 任务中小于
BT file filter suffix=的文件
BT file filter threshold=BT 任务文件排除阈值（MB）
format.bt-file-filter.resuming=正在恢复 {{count}} 个尚未完成小文件处理的 BT 任务
format.bt-file-filter.processing=正在排除 BT 任务中的小文件：已处理 {{processed}}/{{total}} 个任务
format.bt-file-filter.waiting=正在等待 {{count}} 个 BT 任务的文件列表
format.bt-file-filter.complete=BT 小文件处理完成：{{filtered}} 个任务已排除小文件，{{full}} 个任务保留全部文件
format.bt-file-filter.fallback={{count}} 个 BT 任务无法排除小文件，已回退为保留全部文件
format.bt-file-filter.compact.resuming=恢复 {{count}}
format.bt-file-filter.compact.waiting=等待 {{count}}
format.bt-file-filter.compact.processing=处理中 {{count}}
format.bt-file-filter.compact.complete=已处理 {{count}}
format.bt-file-filter.compact.warning=已回退 {{count}}
BT file filter cleanup warning=仅适用于新建的磁力链接和种子任务。任务同时包含大、小文件时，将排除小于设定值的文件；若全部文件都小于设定值，则保留全部文件。任务完成后，aria2 可能删除被排除的文件及下载目录中的同名文件。
```

Use equivalent Traditional Chinese in `src/langs/zh_Hant.txt`, preserving the repository’s existing `工作` terminology:

```text
Exclude BT task files smaller than=排除 BT 工作中小於
BT file filter suffix=的檔案
BT file filter threshold=BT 工作檔案排除門檻（MB）
format.bt-file-filter.resuming=正在恢復 {{count}} 個尚未完成小檔案處理的 BT 工作
format.bt-file-filter.processing=正在排除 BT 工作中的小檔案：已處理 {{processed}}/{{total}} 個工作
format.bt-file-filter.waiting=正在等待 {{count}} 個 BT 工作的檔案清單
format.bt-file-filter.complete=BT 小檔案處理完成：{{filtered}} 個工作已排除小檔案，{{full}} 個工作保留全部檔案
format.bt-file-filter.fallback={{count}} 個 BT 工作無法排除小檔案，已回退為保留全部檔案
format.bt-file-filter.compact.resuming=恢復 {{count}}
format.bt-file-filter.compact.waiting=等待 {{count}}
format.bt-file-filter.compact.processing=處理中 {{count}}
format.bt-file-filter.compact.complete=已處理 {{count}}
format.bt-file-filter.compact.warning=已回退 {{count}}
BT file filter cleanup warning=僅適用於新建的磁力連結和種子工作。工作同時包含大、小檔案時，將排除小於設定值的檔案；若全部檔案都小於設定值，則保留全部檔案。工作完成後，aria2 可能刪除被排除的檔案及下載目錄中的同名檔案。
```

Remove the superseded `Filter files smaller than` and `format.bt-file-filter.compact` entries from all three resources. Keep the currently unused `BT file filter warning` key unchanged to avoid unrelated cleanup.

- [ ] **Step 5: Run the focused test and confirm it passes**

Run: `node test/new-task-small-file-filter.test.js`

Expected: all BT small-file filter checks pass.

- [ ] **Step 6: Run the complete regression suite**

Run:

```bash
npm test
git diff --check
```

Expected: all tests pass and `git diff --check` prints nothing.

- [ ] **Step 7: Commit the copy implementation**

```bash
git add test/new-task-small-file-filter.test.js src/index.html src/scripts/config/defaultLanguage.js src/langs/zh_Hans.txt src/langs/zh_Hant.txt
git commit -m "fix: clarify BT small file filter copy"
```

### Task 2: Apply the approved lightweight grouped styling

**Files:**
- Modify: `test/new-task-small-file-filter.test.js:2287-2311`
- Modify: `src/index.html:172-186`
- Modify: `src/styles/core/core.css:95-131,192-234`
- Modify: `src/styles/theme/default.css:50-74`
- Modify: `src/styles/theme/default-dark.css:207-232`
- Modify: `src/scripts/config/defaultLanguage.js:43-56`
- Modify: `src/langs/zh_Hans.txt:39-54`
- Modify: `src/langs/zh_Hant.txt:39-54`

**Interfaces:**
- Consumes: `btFileFilterContext.enabled`, `isBtFileFilterValid()`, and the toolbar controls completed in Task 1.
- Produces: `.bt-file-filter-rule.is-enabled`, `.bt-file-filter-rule.has-error`, `.bt-file-filter-error`, and the `BT file filter size error` translation key.

- [ ] **Step 1: Write failing source-contract tests for visual and accessible states**

Replace `keeps the filter label compact and invalid borders themed` with assertions for the approved grouped component:

```js
test('styles the BT filter as an accessible grouped rule in every state', function () {
    const index = read('src/index.html');
    const core = read('src/styles/core/core.css');
    const light = read('src/styles/theme/default.css');
    const dark = read('src/styles/theme/default-dark.css');

    assert(index.includes('class="bt-file-filter-rule"'));
    assert(index.includes("'is-enabled': btFileFilterContext.enabled"));
    assert(index.includes("'has-error': btFileFilterContext.enabled && !isBtFileFilterValid()"));
    assert(index.includes('class="bt-file-filter-error"'));
    assert(index.includes('ng-if="btFileFilterContext.enabled && !isBtFileFilterValid()"'));
    assert(index.includes('role="alert"'));
    assert(core.includes('.main-header .bt-file-filter-rule'));
    assert(core.includes('.main-header .bt-file-filter-error'));
    assert(core.includes('@media (max-width: 767px)'));
    assert(core.includes('flex-basis: 100%'));
    assert(light.includes('.skin-aria-ng .main-header .bt-file-filter-rule.is-enabled'));
    assert(light.includes('.skin-aria-ng .main-header .bt-file-filter-rule.has-error'));
    assert(dark.includes('.theme-dark.skin-aria-ng .main-header .bt-file-filter-rule.is-enabled'));
    assert(dark.includes('.theme-dark.skin-aria-ng .main-header .bt-file-filter-rule.has-error'));
});
```

- [ ] **Step 2: Run the focused test and confirm the grouped component is missing**

Run: `node test/new-task-small-file-filter.test.js`

Expected: FAIL because `.bt-file-filter-rule` and its state classes do not exist.

- [ ] **Step 3: Wrap the existing controls in one stateful rule surface**

Keep the outer list item and wrap the Task 1 controls as follows:

```html
<li class="bt-file-filter-toolbar" ng-if="isNewTaskPage()">
    <div class="bt-file-filter-rule"
         ng-class="{'is-enabled': btFileFilterContext.enabled, 'has-error': btFileFilterContext.enabled && !isBtFileFilterValid()}">
        <label class="bt-file-filter-toggle" title="{{'BT file filter cleanup warning' | translate}}">
            <input type="checkbox" ng-model="btFileFilterContext.enabled"
                   ng-change="saveBtFileFilterSetting()"/>
            <span class="bt-file-filter-label" translate>Exclude BT task files smaller than</span>
        </label>
        <input class="form-control bt-file-filter-size" type="number" min="1" max="102400" step="1"
               ng-model="btFileFilterContext.minSizeMb" ng-disabled="!btFileFilterContext.enabled"
               ng-change="saveBtFileFilterSetting()"
               ng-class="{'has-error': btFileFilterContext.enabled && !isBtFileFilterValid()}"
               aria-label="{{'BT file filter threshold' | translate}}"
               aria-invalid="{{btFileFilterContext.enabled && !isBtFileFilterValid()}}"/>
        <span class="bt-file-filter-unit">MB</span>
        <span class="bt-file-filter-suffix" translate>BT file filter suffix</span>
        <span class="bt-file-filter-error" role="alert"
              ng-if="btFileFilterContext.enabled && !isBtFileFilterValid()"
              translate>BT file filter size error</span>
    </div>
</li>
```

Add translations:

```text
English: BT file filter size error=Enter 1–102400
Simplified Chinese: BT file filter size error=请输入 1–102400
Traditional Chinese: BT file filter size error=請輸入 1–102400
```

- [ ] **Step 4: Implement layout, spacing, focus, and narrow-screen behavior**

In `src/styles/core/core.css`, keep structural rules theme-neutral:

```css
.main-header .navbar .nav > li.bt-file-filter-toolbar {
    display: inline-flex;
    align-items: center;
    height: 50px;
    padding: 0 8px;
    white-space: nowrap;
}

.main-header .bt-file-filter-rule {
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    padding: 4px 10px;
    border-left: 3px solid transparent;
    border-radius: 4px;
    transition: color .15s ease, background-color .15s ease, border-color .15s ease, box-shadow .15s ease;
}

.main-header .bt-file-filter-suffix {
    margin-left: 5px;
}

.main-header .bt-file-filter-error {
    margin-left: 8px;
    font-size: 11px;
}

@media (max-width: 767px) {
    .main-header .navbar .navbar-toolbar > .navbar-nav {
        display: flex;
        flex-wrap: wrap;
    }

    .main-header .navbar .nav > li.bt-file-filter-toolbar {
        flex-basis: 100%;
        height: auto;
        padding: 4px 6px 7px 37px;
    }

    .main-header .bt-file-filter-rule {
        min-height: 38px;
    }
}
```

Remove the `@media (max-width: 1199px)` rule that visually hides `.bt-file-filter-label`; the approved design keeps the complete sentence visible. Preserve scoped search hiding and all status compaction rules.

- [ ] **Step 5: Implement light, disabled, error, and dark surfaces**

In `src/styles/theme/default.css`, style the disabled state as the base and enabled/error states as modifiers:

```css
.skin-aria-ng .main-header .bt-file-filter-rule {
    color: #9aa1a7;
    background-color: #f3f4f5;
    box-shadow: none;
}

.skin-aria-ng .main-header .bt-file-filter-rule.is-enabled {
    color: #606060;
    background-color: #fff;
    border-left-color: #2196f3;
    box-shadow: 0 1px 4px rgba(0, 0, 0, .1);
}

.skin-aria-ng .main-header .bt-file-filter-rule.has-error {
    border-left-color: #dd4b39;
}

.skin-aria-ng .main-header .bt-file-filter-error {
    color: #c34737;
}
```

In `src/styles/theme/default-dark.css`, use a raised dark surface and equivalent error contrast:

```css
.theme-dark.skin-aria-ng .main-header .bt-file-filter-rule {
    color: #929292;
    background-color: #252a2e;
    box-shadow: none;
}

.theme-dark.skin-aria-ng .main-header .bt-file-filter-rule.is-enabled {
    color: #ddd;
    background-color: #30383e;
    border-left-color: #42a5f5;
    box-shadow: 0 2px 7px rgba(0, 0, 0, .28);
}

.theme-dark.skin-aria-ng .main-header .bt-file-filter-rule.has-error {
    border-left-color: #dd4b39;
}

.theme-dark.skin-aria-ng .main-header .bt-file-filter-error {
    color: #ef8a7d;
}
```

- [ ] **Step 6: Run focused and complete automated verification**

Run:

```bash
node test/new-task-small-file-filter.test.js
npm test
npx gulp lint
npm run build
npx gulp clean build-bundle
git diff --check
```

Expected: all tests pass, lint reports no errors, both builds finish successfully, and `git diff --check` prints nothing.

- [ ] **Step 7: Perform real-browser visual and interaction verification**

Run `npx gulp serve` and inspect `/#!/new` in a real Chromium browser at desktop width and 375×812. Verify light and dark themes, enabled and disabled states, values `100`, `1`, `102400`, invalid values `0` and `102401`, keyboard focus, no horizontal scrolling, natural second-row wrapping, and unchanged task submission behavior. Also inspect a task-list route to confirm the filter container is absent there and the Files button/status layout remains intact.

- [ ] **Step 8: Commit the visual implementation**

```bash
git add test/new-task-small-file-filter.test.js src/index.html src/styles/core/core.css src/styles/theme/default.css src/styles/theme/default-dark.css src/scripts/config/defaultLanguage.js src/langs/zh_Hans.txt src/langs/zh_Hant.txt
git commit -m "style: polish BT small file filter toolbar"
```
