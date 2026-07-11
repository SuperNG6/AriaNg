# Downloading File List Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/downloading` 页的任务内文件列表精修为边缘完整、归属清楚、浅深主题层级明确的紧凑内嵌面板。

**Architecture:** 不改控制器、RPC 或文件数据结构，只在现有任务行与嵌套 `.task-table` 上增加语义 class。通用结构样式放在 `task-table.css`，浅色 hover/斑马纹覆盖放在 `default.css`，深色面板和行状态放在 `default-dark.css`，所有选择器限定于 `.downloading-file-list` 或 `.downloading-file-panel`。

**Tech Stack:** AngularJS 1.6 模板、Bootstrap 3 网格、AriaNg CSS 主题、Gulp 4、ESLint。

## Global Constraints

- 只修改 `/downloading` 内嵌文件列表视觉，不修改顶部按钮、任务详情、`/waiting` 或 `/stopped`。
- 不修改 RPC、刷新、目录折叠、文件排序、任务选择、搜索、拖动或右键菜单逻辑。
- 不增加字体、图标、图片、动画、依赖或横向滚动。
- 面板使用 `1px #d6dfe6` 完整边框、`3px #208fe5` 左强调线、`3px` 圆角和极浅阴影。
- 浅色表头为 `#eef4f8`，文件行为白色，行分隔为 `#e6ebef`，hover 为 `#f6fafc`。
- 深色面板为 `#1d2226`，边框为 `#3b4650`，表头为 `#242d34`，行分隔为 `#303840`，hover 为 `#26313a`。
- 展开任务底部内边距为 `12px`；桌面面板左右内缩 `15px`，`max-width: 767px` 时为 `5px`。
- 只读 checkbox 区域透明度为 `0.72`，目录展开图标保持正常强度。

---

### Task 1: Build the inset file panel hierarchy

**Files:**
- Modify: `src/views/list.html:41-88`
- Modify: `src/styles/controls/task-table.css:141-168`
- Modify: `src/styles/theme/default.css:490-499`
- Modify: `src/styles/theme/default-dark.css:373-399`

**Interfaces:**
- Consumes: `showDownloadingFileList()` and `task.files.length` already used by the view.
- Produces: outer-row class `has-downloading-file-list` only when the panel is visible.
- Produces: inner-panel class `downloading-file-panel` scoped to the main downloading list.
- Changes no JavaScript interface.

- [ ] **Step 1: Run a failing visual-contract check**

Run:

```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("src/views/list.html","utf8");const c=fs.readFileSync("src/styles/controls/task-table.css","utf8");const l=fs.readFileSync("src/styles/theme/default.css","utf8");const d=fs.readFileSync("src/styles/theme/default-dark.css","utf8");for(const value of ["has-downloading-file-list","downloading-file-panel"])if(!h.includes(value))process.exit(1);for(const value of ["border-left: 3px solid #208fe5","border-radius: 3px","opacity: 0.72"])if(!c.includes(value))process.exit(1);if(!l.includes("#f6fafc")||!d.includes("#26313a"))process.exit(1)'
```

Expected: exit code `1`, because the semantic classes and full theme contract are absent.

- [ ] **Step 2: Add semantic state and panel classes**

Change the repeated task row opening tag to include this `ng-class` without changing its existing attributes or click handler:

```html
            <div class="row pointer-cursor" ng-repeat="task in taskContext.list | filter: filterTask | taskOrderBy: getOrderType()"
                 ng-class="{'has-downloading-file-list': showDownloadingFileList() && task.files && task.files.length > 0}"
                 data-gid="{{task.gid}}" data-selected="{{!!taskContext.selected[task.gid]}}" data-toggle="context" data-target="#task-table-contextmenu"
                 ng-click="taskContext.selected[task.gid] = !taskContext.selected[task.gid]">
```

Change only the nested table class:

```html
                    <div class="task-table downloading-file-panel">
```

- [ ] **Step 3: Replace the current nested-list CSS with the complete panel structure**

Replace the `.downloading-file-list` block at the end of `src/styles/controls/task-table.css` with:

```css
.task-table > .task-table-body > div.row.has-downloading-file-list {
    padding-bottom: 12px;
}

.task-table .downloading-file-list {
    cursor: default;
    margin-top: 8px;
    padding-left: 15px;
    padding-right: 15px;
}

.task-table .downloading-file-panel {
    box-sizing: border-box;
    margin-left: 0;
    margin-right: 0;
    overflow: hidden;
    border: 1px solid #d6dfe6;
    border-left: 3px solid #208fe5;
    border-radius: 3px;
    background-color: #fff;
    box-shadow: 0 1px 2px rgba(32, 52, 68, 0.05);
}

.task-table .downloading-file-panel > .task-table-title {
    padding: 6px 15px;
    border-bottom: 1px solid #dce4ea;
    background-color: #eef4f8;
}

.task-table .downloading-file-panel > .task-table-body {
    padding-left: 15px;
    padding-right: 15px;
}

.task-table .downloading-file-panel > .task-table-body > .row {
    padding-top: 6px;
    padding-bottom: 6px;
    border-color: #e6ebef;
}

.task-table .downloading-file-panel > .task-table-body > .row:first-child {
    border-top: 0;
}

.task-table .downloading-file-panel .checkbox {
    opacity: 0.72;
}

.task-table .downloading-file-panel .checkbox label {
    cursor: default;
}

@media (max-width: 767px) {
    .task-table .downloading-file-list {
        padding-left: 5px;
        padding-right: 5px;
    }

    .task-table .downloading-file-list .task-size {
        text-align: right;
    }
}
```

- [ ] **Step 4: Add explicit light-theme row and hover layers**

Append beside the existing light task-table rules in `src/styles/theme/default.css`:

```css
.skin-aria-ng .task-table > .task-table-body > div.row.has-downloading-file-list:hover {
    background-color: #fff;
}

.skin-aria-ng .task-table > .task-table-body > div.row.has-downloading-file-list:nth-of-type(odd):hover {
    background-color: #f9f9f9;
}

.skin-aria-ng .task-table .downloading-file-panel > .task-table-body > div.row,
.skin-aria-ng .task-table .downloading-file-panel > .task-table-body > div.row:nth-of-type(odd) {
    background-color: #fff;
}

.skin-aria-ng .task-table .downloading-file-panel > .task-table-body > div.row:hover,
.skin-aria-ng .task-table .downloading-file-panel > .task-table-body > div.row:nth-of-type(odd):hover {
    background-color: #f6fafc;
}
```

This deliberately suppresses the outer task-row hover while its file panel is open so hovering a file changes only that file row.

- [ ] **Step 5: Replace the old dark border override with complete dark layers**

Replace the current `.downloading-file-list > .task-table` dark rule with:

```css
.theme-dark.skin-aria-ng .task-table > .task-table-body > div.row.has-downloading-file-list:hover {
    background-color: #1a1a1a;
}

.theme-dark.skin-aria-ng .task-table > .task-table-body > div.row.has-downloading-file-list:nth-of-type(odd):hover {
    background-color: #262626;
}

.theme-dark.skin-aria-ng .task-table .downloading-file-panel {
    border-color: #3b4650;
    border-left-color: #208fe5;
    background-color: #1d2226;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
}

.theme-dark.skin-aria-ng .task-table .downloading-file-panel > .task-table-title {
    border-color: #3b4650;
    background-color: #242d34;
}

.theme-dark.skin-aria-ng .task-table .downloading-file-panel > .task-table-body > div.row,
.theme-dark.skin-aria-ng .task-table .downloading-file-panel > .task-table-body > div.row:nth-of-type(odd) {
    border-color: #303840;
    background-color: #1d2226;
}

.theme-dark.skin-aria-ng .task-table .downloading-file-panel > .task-table-body > div.row:hover,
.theme-dark.skin-aria-ng .task-table .downloading-file-panel > .task-table-body > div.row:nth-of-type(odd):hover {
    background-color: #26313a;
}
```

- [ ] **Step 6: Re-run the contract, template generation and lint**

Run:

```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("src/views/list.html","utf8");const c=fs.readFileSync("src/styles/controls/task-table.css","utf8");const l=fs.readFileSync("src/styles/theme/default.css","utf8");const d=fs.readFileSync("src/styles/theme/default-dark.css","utf8");for(const value of ["has-downloading-file-list","downloading-file-panel"])if(!h.includes(value))process.exit(1);for(const value of ["border-left: 3px solid #208fe5","border-radius: 3px","opacity: 0.72"])if(!c.includes(value))process.exit(1);if(!l.includes("#f6fafc")||!d.includes("#26313a"))process.exit(1)'
npx gulp prepare-views
npx gulp lint
```

Expected: all commands exit `0`; template cache generation and ESLint complete without errors.

- [ ] **Step 7: Run both production builds**

Run:

```bash
npm run build
npx gulp clean build-bundle
```

Expected: both builds exit `0`; only existing dependency/deprecation warnings are allowed.

- [ ] **Step 8: Review the scoped diff and commit**

Run:

```bash
git diff --check
git diff --stat
git status --short
```

Expected: runtime changes are limited to `src/views/list.html`, `src/styles/controls/task-table.css`, `src/styles/theme/default.css`, and `src/styles/theme/default-dark.css`.

Commit:

```bash
git add src/views/list.html src/styles/controls/task-table.css src/styles/theme/default.css src/styles/theme/default-dark.css
git commit -m "style: refine downloading file list hierarchy"
```

- [ ] **Step 9: Perform visual acceptance when a browser is available**

Verify with at least two adjacent tasks in light/dark themes and desktop/`767px`-or-narrow viewports:

1. Full panel border and blue ownership line are visible.
2. Header, rows, and outer task summary have distinct backgrounds.
3. Hovering a file changes only that file row.
4. Disabled checkbox content is subdued while directory expand icons remain full strength.
5. Closing file-list mode restores the original compact task spacing.
6. `/waiting`, `/stopped`, and task detail remain visually unchanged.

If no browser backend or real aria2 data is available, report these items as unverified instead of passing.
