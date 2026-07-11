# Downloading File List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AriaNg 的 `/downloading` 主任务页增加可持久化的“文件列表”模式，使每个活动任务下方实时显示与任务详情一致的目录、文件大小和单文件进度。

**Architecture:** 继续复用现有 `tellActive`/`getTaskList` 数据链路；关闭模式时保持基础字段增量刷新，开启模式时每个周期请求包含 `files` 的完整字段，并用现有 `processDownloadTasks(tasks, true)` 生成目录节点。顶部按钮由 `MainController` 管理持久化状态并广播切换事件，`DownloadListController` 负责刷新策略、文件排序和按 `gid` 隔离的目录折叠状态，视图在现有任务行内部嵌套只读文件表。

**Tech Stack:** AngularJS 1.6、Bootstrap 3、Font Awesome 4、aria2 JSON-RPC、Gulp 4、ESLint。

## Global Constraints

- 功能只在 `/downloading` 页面显示和生效；`/waiting`、`/stopped`、任务详情和设置页面行为不变。
- 首次使用默认关闭，开关通过现有 AriaNg Options 本地存储持久化。
- 开启后显示所有任务的文件列表，不增加单任务开关、分页、虚拟滚动、按需加载或文件数量上限。
- 开启期间每个刷新周期仍然只发起一次任务列表 RPC；不得为每个任务单独调用 `tellStatus`。
- 关闭后必须恢复现有基础字段增量刷新。
- 复用现有 `Files` 翻译键，不新增语言文案。
- 不增加 npm 依赖，不重构任务详情文件列表。
- 文件区域内点击不得切换所属任务的选中状态。
- 当前仓库没有自动化测试框架；机器验证使用 ESLint、标准构建和 All-in-One 构建，交互验证使用真实 aria2 RPC。

---

## File Responsibility Map

- `src/scripts/config/constants.js`：定义新设置的默认值，保证旧用户 Options 自动补齐为 `false`。
- `src/scripts/services/ariaNgSettingService.js`：提供 `getShowFileListInDownloadingPage()` 与 `setShowFileListInDownloadingPage(value)`。
- `src/scripts/controllers/main.js`：判断 `/downloading` 路由、切换设置、广播 `download-file-list-mode.changed`。
- `src/index.html`：在问号右侧渲染按钮，并绑定显示、激活和点击行为。
- `src/scripts/controllers/list.js`：切换完整/基础刷新，生成虚拟目录节点，维护每任务折叠状态与文件排序接口。
- `src/views/list.html`：在现有任务行内渲染文件标题、目录和文件进度。
- `src/styles/controls/task-table.css`：限定嵌套列表间距、分隔线、点击区域和窄屏布局。
- `src/styles/theme/default-dark.css`：补充深色主题下嵌套列表的边框色。

---

### Task 1: Persist the downloading file-list preference

**Files:**
- Modify: `src/scripts/config/constants.js:55-60`
- Modify: `src/scripts/services/ariaNgSettingService.js:686-712`

**Interfaces:**
- Produces: `ariaNgDefaultOptions.showFileListInDownloadingPage: boolean`，默认 `false`。
- Produces: `ariaNgSettingService.getShowFileListInDownloadingPage(): boolean`。
- Produces: `ariaNgSettingService.setShowFileListInDownloadingPage(value: boolean): void`。
- Storage key: `showFileListInDownloadingPage`，写入现有 `AriaNg.Options` 对象。

- [ ] **Step 1: Run a failing source-contract check**

Run:

```bash
node -e "const fs=require('fs');const c=fs.readFileSync('src/scripts/config/constants.js','utf8');const s=fs.readFileSync('src/scripts/services/ariaNgSettingService.js','utf8');if(!/showFileListInDownloadingPage:\s*false/.test(c)||!s.includes('getShowFileListInDownloadingPage')||!s.includes('setShowFileListInDownloadingPage'))process.exit(1)"
```

Expected: exit code `1`, because the setting contract does not exist yet.

- [ ] **Step 2: Add the default option**

In `ariaNgDefaultOptions`, add the boolean next to the list display settings:

```javascript
        taskListIndependentDisplayOrder: false,
        showFileListInDownloadingPage: false,
        displayOrder: 'default:asc',
```

This lets `getOption()` automatically backfill the value for users whose saved Options object predates the feature.

- [ ] **Step 3: Add the setting service accessors**

Immediately before `getFileListDisplayOrder`, add:

```javascript
            getShowFileListInDownloadingPage: function () {
                return !!getOption('showFileListInDownloadingPage');
            },
            setShowFileListInDownloadingPage: function (value) {
                setOption('showFileListInDownloadingPage', !!value);
            },
```

- [ ] **Step 4: Re-run the contract check and lint**

Run:

```bash
node -e "const fs=require('fs');const c=fs.readFileSync('src/scripts/config/constants.js','utf8');const s=fs.readFileSync('src/scripts/services/ariaNgSettingService.js','utf8');if(!/showFileListInDownloadingPage:\s*false/.test(c)||!s.includes('getShowFileListInDownloadingPage')||!s.includes('setShowFileListInDownloadingPage'))process.exit(1)"
npx gulp lint
```

Expected: both commands exit `0`; ESLint reports no errors.

- [ ] **Step 5: Commit the setting contract**

```bash
git add src/scripts/config/constants.js src/scripts/services/ariaNgSettingService.js
git commit -m "feat: persist downloading file list preference"
```

---

### Task 2: Add the route-scoped toolbar toggle

**Files:**
- Modify: `src/scripts/controllers/main.js:403-423`
- Modify: `src/index.html:165-171`

**Interfaces:**
- Consumes: `ariaNgSettingService.getShowFileListInDownloadingPage()` and `setShowFileListInDownloadingPage(value)` from Task 1.
- Produces: `$scope.isDownloadingPage(): boolean`.
- Produces: `$scope.isDownloadingFileListEnabled(): boolean`.
- Produces: `$scope.toggleDownloadingFileList(): void`.
- Emits: `$rootScope.$broadcast('download-file-list-mode.changed', enabled)` where `enabled` is boolean.

- [ ] **Step 1: Record the pre-change toolbar contract failure**

Run:

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('src/index.html','utf8');const j=fs.readFileSync('src/scripts/controllers/main.js','utf8');if(!h.includes('toggleDownloadingFileList()')||!j.includes('download-file-list-mode.changed'))process.exit(1)"
```

Expected: exit code `1`.

- [ ] **Step 2: Add route and toggle methods to MainController**

Insert after `$scope.isSetDisplayOrder`:

```javascript
        $scope.isDownloadingPage = function () {
            return $location.path() === '/downloading';
        };

        $scope.isDownloadingFileListEnabled = function () {
            return ariaNgSettingService.getShowFileListInDownloadingPage();
        };

        $scope.toggleDownloadingFileList = function () {
            var enabled = !ariaNgSettingService.getShowFileListInDownloadingPage();

            ariaNgSettingService.setShowFileListInDownloadingPage(enabled);
            $rootScope.$broadcast('download-file-list-mode.changed', enabled);
        };
```

Do not mutate the setting during route changes. Hiding the button outside `/downloading` must leave the saved value intact.

- [ ] **Step 3: Add the button immediately after Help**

In `src/index.html`, keep the existing Help `<li>` unchanged and insert this sibling directly after it:

```html
                    <li ng-if="isDownloadingPage()" ng-class="{'active': isDownloadingFileListEnabled()}">
                        <a class="toolbar" title="{{'Files' | translate}}" ng-click="toggleDownloadingFileList()">
                            <i class="fa fa-list-ul"></i>
                            <span translate>Files</span>
                        </a>
                    </li>
```

The existing light and dark theme selectors already color `.nav > .active > a` blue, so do not add a duplicate active-color rule.

- [ ] **Step 4: Verify source contract and lint**

Run:

```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("src/index.html","utf8");const j=fs.readFileSync("src/scripts/controllers/main.js","utf8");if(!h.includes("toggleDownloadingFileList()")||!h.includes("isDownloadingPage()")||!j.includes("$rootScope.$broadcast")||!j.includes("download-file-list-mode.changed"))process.exit(1)'
npx gulp lint
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit the toolbar toggle**

```bash
git add src/index.html src/scripts/controllers/main.js
git commit -m "feat: add downloading file list toggle"
```

---

### Task 3: Switch refresh modes and manage per-task directory state

**Files:**
- Modify: `src/scripts/controllers/list.js:5-148`

**Interfaces:**
- Consumes: `download-file-list-mode.changed` event from Task 2.
- Consumes: `aria2TaskService.getTaskList(type, full, callback, silent)`.
- Consumes: `aria2TaskService.processDownloadTasks(tasks, addVirtualFileNode)`.
- Produces: `$scope.showDownloadingFileList(): boolean`.
- Produces: `$scope.changeDownloadingFileListDisplayOrder(task, type, autoSetReverse): void`.
- Produces: `$scope.isSetDownloadingFileListDisplayOrder(type): boolean`.
- Produces: `$scope.getDownloadingFileListOrderType(task): string|null`.
- Produces: `$scope.isDownloadingFileDirCollapsed(task, nodePath): boolean`.
- Produces: `$scope.collapseDownloadingFileDir(task, dirNode, newValue?, forceRecurse?): void`.

- [ ] **Step 1: Capture the missing controller contract**

Run:

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('src/scripts/controllers/list.js','utf8');for(const name of ['showDownloadingFileList','changeDownloadingFileListDisplayOrder','collapseDownloadingFileDir','download-file-list-mode.changed'])if(!s.includes(name))process.exit(1)"
```

Expected: exit code `1`.

- [ ] **Step 2: Add task-scoped state helpers**

After `needRequestWholeInfo`, add:

```javascript
        var collapsedFileDirs = {};

        var getCollapsedFileDirs = function (task) {
            if (!task || !task.gid) {
                return {};
            }

            if (!collapsedFileDirs[task.gid]) {
                collapsedFileDirs[task.gid] = {};
            }

            return collapsedFileDirs[task.gid];
        };

        var cleanupCollapsedFileDirs = function (tasks) {
            var activeTaskIds = {};

            for (var i = 0; tasks && i < tasks.length; i++) {
                activeTaskIds[tasks[i].gid] = true;
            }

            for (var gid in collapsedFileDirs) {
                if (collapsedFileDirs.hasOwnProperty(gid) && !activeTaskIds[gid]) {
                    delete collapsedFileDirs[gid];
                }
            }
        };

        var removeVirtualFileNodes = function (tasks) {
            for (var i = 0; tasks && i < tasks.length; i++) {
                var task = tasks[i];

                if (!task.multiDir || !task.files) {
                    continue;
                }

                var files = [];

                for (var j = 0; j < task.files.length; j++) {
                    var file = task.files[j];

                    if (!file.isDir) {
                        delete file.relativePath;
                        delete file.level;
                        files.push(file);
                    }
                }

                task.files = files;
                delete task.multiDir;
            }
        };
```

- [ ] **Step 3: Make refresh mode depend on the saved toggle**

Replace `refreshDownloadTask` with this implementation:

```javascript
        var refreshDownloadTask = function (silent) {
            if (pauseDownloadTaskRefresh) {
                return;
            }

            var showFileList = $scope.showDownloadingFileList();
            var requestWholeInfo = needRequestWholeInfo || showFileList;

            return aria2TaskService.getTaskList(location, requestWholeInfo, function (response) {
                if (pauseDownloadTaskRefresh) {
                    return;
                }

                if (!response.success) {
                    if (response.data.message === aria2RpcErrors.Unauthorized.message) {
                        $interval.cancel(downloadTaskRefreshPromise);
                    }

                    return;
                }

                showFileList = $scope.showDownloadingFileList();

                if (showFileList && !response.context.requestWholeInfo) {
                    needRequestWholeInfo = true;
                    refreshDownloadTask(true);
                    return;
                }

                var isRequestWholeInfo = response.context.requestWholeInfo;
                var taskList = response.data;

                if (isRequestWholeInfo) {
                    $rootScope.taskContext.list = taskList;
                    needRequestWholeInfo = false;
                } else {
                    if ($rootScope.taskContext.list && $rootScope.taskContext.list.length > 0) {
                        for (var i = 0; i < $rootScope.taskContext.list.length; i++) {
                            var task = $rootScope.taskContext.list[i];
                            delete task.verifiedLength;
                            delete task.verifyIntegrityPending;
                        }
                    }

                    if (ariaNgCommonService.extendArray(taskList, $rootScope.taskContext.list, 'gid')) {
                        needRequestWholeInfo = false;
                    } else {
                        needRequestWholeInfo = true;
                    }
                }

                if ($rootScope.taskContext.list && $rootScope.taskContext.list.length > 0) {
                    if (!showFileList) {
                        removeVirtualFileNodes($rootScope.taskContext.list);
                    }

                    aria2TaskService.processDownloadTasks($rootScope.taskContext.list, showFileList);

                    if (!isRequestWholeInfo) {
                        var hasFullStruct = false;

                        for (var i = 0; i < $rootScope.taskContext.list.length; i++) {
                            var task = $rootScope.taskContext.list[i];

                            if (task.hasTaskName || task.files || task.bittorrent) {
                                hasFullStruct = true;
                                break;
                            }
                        }

                        if (!hasFullStruct) {
                            needRequestWholeInfo = true;
                            $rootScope.taskContext.list.length = 0;
                            return;
                        }
                    }
                }

                cleanupCollapsedFileDirs($rootScope.taskContext.list);
                $rootScope.taskContext.enableSelectAll = $rootScope.taskContext.list && $rootScope.taskContext.list.length > 0;
            }, silent);
        };
```

The stale-basic-response branch is required: if the user enables the mode while a basic request is in flight, discard that response and immediately request full data. `removeVirtualFileNodes` is equally important on disable: the prior expanded response contains synthetic directory nodes, which must be removed before the ordinary processor treats `task.files` as aria2 file records. A full response arriving after disable is safe because visibility derives from the saved setting and subsequent requests revert to basic mode.

- [ ] **Step 4: Add view-facing file-list helpers**

Insert after `$scope.getOrderType`:

```javascript
        $scope.showDownloadingFileList = function () {
            return location === 'downloading' && ariaNgSettingService.getShowFileListInDownloadingPage();
        };

        $scope.changeDownloadingFileListDisplayOrder = function (task, type, autoSetReverse) {
            if (task && task.multiDir) {
                return;
            }

            var oldType = ariaNgCommonService.parseOrderType(ariaNgSettingService.getFileListDisplayOrder());
            var newType = ariaNgCommonService.parseOrderType(type);

            if (autoSetReverse && newType.type === oldType.type) {
                newType.reverse = !oldType.reverse;
            }

            ariaNgSettingService.setFileListDisplayOrder(newType.getValue());
        };

        $scope.isSetDownloadingFileListDisplayOrder = function (type) {
            var orderType = ariaNgCommonService.parseOrderType(ariaNgSettingService.getFileListDisplayOrder());
            var targetType = ariaNgCommonService.parseOrderType(type);

            return orderType.equals(targetType);
        };

        $scope.getDownloadingFileListOrderType = function (task) {
            return task && task.multiDir ? null : ariaNgSettingService.getFileListDisplayOrder();
        };

        $scope.isDownloadingFileDirCollapsed = function (task, nodePath) {
            return !!getCollapsedFileDirs(task)[nodePath];
        };

        $scope.collapseDownloadingFileDir = function (task, dirNode, newValue, forceRecurse) {
            var taskCollapsedDirs = getCollapsedFileDirs(task);
            var nodePath = dirNode.nodePath;

            if (angular.isUndefined(newValue)) {
                newValue = !taskCollapsedDirs[nodePath];
            }

            if (newValue || forceRecurse) {
                for (var i = 0; i < dirNode.subDirs.length; i++) {
                    $scope.collapseDownloadingFileDir(task, dirNode.subDirs[i], newValue);
                }
            }

            if (nodePath) {
                taskCollapsedDirs[nodePath] = newValue;
            }
        };
```

- [ ] **Step 5: React to toolbar changes without creating another interval**

Insert before the existing `$destroy` listener:

```javascript
        $scope.$on('download-file-list-mode.changed', function (event, enabled) {
            needRequestWholeInfo = !!enabled;
            $rootScope.loadPromise = refreshDownloadTask(false);
        });
```

Do not create or cancel an additional interval. The existing interval must call the mode-aware `refreshDownloadTask(true)`.

- [ ] **Step 6: Run contract check and lint**

Run:

```bash
node -e 'const fs=require("fs");const s=fs.readFileSync("src/scripts/controllers/list.js","utf8");for(const name of ["showDownloadingFileList","changeDownloadingFileListDisplayOrder","collapseDownloadingFileDir","removeVirtualFileNodes","download-file-list-mode.changed","processDownloadTasks($rootScope.taskContext.list, showFileList)"])if(!s.includes(name))process.exit(1)'
npx gulp lint
```

Expected: both commands exit `0`.

- [ ] **Step 7: Commit refresh and directory behavior**

```bash
git add src/scripts/controllers/list.js
git commit -m "feat: refresh files on downloading list"
```

---

### Task 4: Render the nested file list and theme it

**Files:**
- Modify: `src/views/list.html:41-86`
- Modify: `src/styles/controls/task-table.css:40-58,139`
- Modify: `src/styles/theme/default-dark.css:373-397`

**Interfaces:**
- Consumes all `$scope` helpers produced by Task 3.
- Consumes existing `fileOrderBy`, `readableVolume`, `percent`, `ng-indeterminate` and Bootstrap progress styles.
- Produces DOM class `.downloading-file-list` scoped inside the existing repeated task row.

- [ ] **Step 1: Verify the nested list is absent**

Run:

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('src/views/list.html','utf8');const c=fs.readFileSync('src/styles/controls/task-table.css','utf8');if(!h.includes('downloading-file-list')||!c.includes('.downloading-file-list'))process.exit(1)"
```

Expected: exit code `1`.

- [ ] **Step 2: Add the file list inside the existing repeated task row**

Insert this block after the existing `.task-right-arrow` element and before the closing tag of the task row. Keeping it inside the current `ng-repeat` preserves task filtering, ordering and Dragula's one-row-per-task model.

```html
                <div class="col-xs-12 downloading-file-list" ng-if="showDownloadingFileList() && task.files"
                     ng-click="$event.stopPropagation()">
                    <div class="task-table">
                        <div class="task-table-title">
                            <div class="row">
                                <div class="col-sm-8">
                                    <a ng-click="changeDownloadingFileListDisplayOrder(task, 'name:asc', true)" ng-class="{true: 'default-cursor'}[task.multiDir]">
                                        <span translate>File Name</span><i ng-if="!task.multiDir" class="fa fa-display-order" ng-class="{'fa-sort-asc fa-order-asc': isSetDownloadingFileListDisplayOrder('name:asc'), 'fa-sort-desc fa-order-desc': isSetDownloadingFileListDisplayOrder('name:desc')}"></i>
                                    </a>
                                </div>
                                <div class="col-sm-2">
                                    <a ng-click="changeDownloadingFileListDisplayOrder(task, 'percent:desc', true)" ng-class="{true: 'default-cursor'}[task.multiDir]">
                                        <span translate>Progress</span><i ng-if="!task.multiDir" class="fa fa-display-order" ng-class="{'fa-sort-asc fa-order-asc': isSetDownloadingFileListDisplayOrder('percent:asc'), 'fa-sort-desc fa-order-desc': isSetDownloadingFileListDisplayOrder('percent:desc')}"></i>
                                    </a>
                                </div>
                                <div class="col-sm-2">
                                    <a ng-click="changeDownloadingFileListDisplayOrder(task, 'size:asc', true)" ng-class="{true: 'default-cursor'}[task.multiDir]">
                                        <span translate>File Size</span><i ng-if="!task.multiDir" class="fa fa-display-order" ng-class="{'fa-sort-asc fa-order-asc': isSetDownloadingFileListDisplayOrder('size:asc'), 'fa-sort-desc fa-order-desc': isSetDownloadingFileListDisplayOrder('size:desc')}"></i>
                                    </a>
                                </div>
                            </div>
                        </div>
                        <div class="task-table-body">
                            <div class="row" ng-repeat="file in task.files | fileOrderBy: getDownloadingFileListOrderType(task)"
                                 ng-if="!isDownloadingFileDirCollapsed(task, file.relativePath)">
                                <div class="col-sm-10" ng-if="file.isDir" style="{{(task.multiDir ? ('padding-left: ' + (file.level * 16) + 'px') : '')}}">
                                    <i class="icon-dir-expand pointer-cursor fa" ng-click="collapseDownloadingFileDir(task, file)"
                                       ng-class="{true: 'fa-plus', false: 'fa-minus'}[isDownloadingFileDirCollapsed(task, file.nodePath)]"
                                       title="{{(isDownloadingFileDirCollapsed(task, file.nodePath) ? 'Expand' : 'Collapse') | translate}}">
                                    </i><div class="checkbox checkbox-primary checkbox-inline">
                                        <input id="{{'download_node_' + task.gid + '_' + file.nodePath}}" type="checkbox" disabled
                                               ng-model="file.selected" ng-indeterminate="file.partialSelected"/>
                                        <label for="{{'download_node_' + task.gid + '_' + file.nodePath}}" class="allow-word-break" ng-bind="file.nodeName" title="{{file.nodeName}}"></label>
                                    </div>
                                </div>
                                <div class="col-sm-8" ng-if="!file.isDir" style="{{(task.multiDir ? ('padding-left: ' + (11 + 6 + file.level * 16) + 'px') : '')}}">
                                    <div class="checkbox checkbox-primary">
                                        <input id="{{'download_file_' + task.gid + '_' + file.index}}" type="checkbox" disabled ng-model="file.selected"/>
                                        <label for="{{'download_file_' + task.gid + '_' + file.index}}" class="allow-word-break" ng-bind="file.fileName" title="{{file.fileName}}"></label>
                                    </div>
                                </div>
                                <div class="col-sm-2" ng-if="!file.isDir">
                                    <div class="progress">
                                        <div class="progress-bar progress-bar-primary" role="progressbar"
                                             aria-valuenow="{{file.completePercent}}" aria-valuemin="1"
                                             aria-valuemax="100" ng-style="{ width: file.completePercent + '%' }">
                                            <span ng-class="{'progress-lower': file.completePercent < 50}"
                                                  ng-bind="(file.completePercent | percent: 2) + '%'"></span>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-sm-2">
                                    <span class="task-size" ng-bind="file.length | readableVolume"></span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
```

- [ ] **Step 3: Add scoped spacing and borders**

Append to `src/styles/controls/task-table.css`:

```css
.task-table .downloading-file-list {
    cursor: default;
    margin-top: 8px;
    padding-left: 30px;
    padding-right: 30px;
}

.task-table .downloading-file-list > .task-table {
    margin-left: 0;
    margin-right: 0;
    border-top: 1px solid #ddd;
}

.task-table .downloading-file-list .task-table-body > .row {
    padding-top: 6px;
    padding-bottom: 6px;
}

@media (max-width: 767px) {
    .task-table .downloading-file-list {
        padding-left: 15px;
        padding-right: 15px;
    }

    .task-table .downloading-file-list .task-size {
        text-align: right;
    }
}
```

- [ ] **Step 4: Add the dark-theme border override**

Append beside the existing dark task-table rules in `src/styles/theme/default-dark.css`:

```css
.theme-dark.skin-aria-ng .task-table .downloading-file-list > .task-table {
    border-color: #333;
}
```

- [ ] **Step 5: Verify the template/style contract and build templates**

Run:

```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("src/views/list.html","utf8");const c=fs.readFileSync("src/styles/controls/task-table.css","utf8");for(const value of ["ng-click=\"$event.stopPropagation()\"","fileOrderBy: getDownloadingFileListOrderType(task)","download_file_"])if(!h.includes(value))process.exit(1);if(!c.includes(".task-table .downloading-file-list"))process.exit(1)'
npx gulp prepare-views
npx gulp lint
```

Expected: all commands exit `0`; Angular template cache generation and ESLint succeed.

- [ ] **Step 6: Commit the nested list UI**

```bash
git add src/views/list.html src/styles/controls/task-table.css src/styles/theme/default-dark.css
git commit -m "feat: show files below downloading tasks"
```

---

### Task 5: Build and verify the complete feature

**Files:**
- Verify: all files modified in Tasks 1-4
- Reference: `docs/superpowers/specs/2026-07-11-downloading-file-list-design.md`

**Interfaces:**
- Verifies the complete setting → toolbar event → refresh strategy → processed file tree → nested view path.
- Produces no new runtime interface.

- [ ] **Step 1: Review the final diff for scope and whitespace**

Run:

```bash
git status --short
git diff --check HEAD~4..HEAD
git diff --stat HEAD~4..HEAD
```

Expected: only the eight files listed in the File Responsibility Map are changed by the feature commits; `git diff --check` prints nothing and exits `0`.

- [ ] **Step 2: Run the standard build**

Run:

```bash
npm run build
```

Expected: Gulp completes `lint`, asset processing and `build` with exit code `0`; `dist/` is generated.

- [ ] **Step 3: Run the All-in-One build**

Run:

```bash
npx gulp clean build-bundle
```

Expected: `build-bundle` exits `0` and produces the bundled `dist/index.html`.

- [ ] **Step 4: Start the development server for browser verification**

Run:

```bash
npx gulp serve
```

Expected: BrowserSync serves AriaNg at `http://localhost:9000` without console build errors. Keep this process running while completing Steps 5-8.

- [ ] **Step 5: Verify route visibility and persistence**

With AriaNg connected to a real aria2 RPC:

1. Open `#!/downloading`; confirm the question-mark Help button is followed by a list icon and localized `Files` label (`文件列表` in Simplified Chinese).
2. Open `#!/waiting`, `#!/stopped`, one real task-detail URL such as `#!/task/detail/2089b05ecca3d829`, and `#!/settings/ariang`; confirm the new button is absent on every page.
3. Return to `#!/downloading`; confirm first-use state is off.
4. Enable the mode; confirm the button becomes blue.
5. Reload the browser and leave/return to the route; confirm the mode remains enabled.
6. Disable it, reload again and confirm the compact list remains selected.

- [ ] **Step 6: Verify file rendering and interaction isolation**

Create or use one single-file download and one multi-file BT download with nested directories:

1. Enable the mode and confirm each task keeps its original summary row.
2. Confirm the single-file task shows exactly one file row.
3. Confirm the BT task shows directory nodes, file names, sizes, progress bars and percentages matching its task-detail Files tab.
4. Expand/collapse nested directories and confirm another task with the same directory name is unaffected.
5. Click directory icons, disabled checkboxes and file labels; confirm the parent task selection does not toggle.
6. Change name, progress and size order on a flat task; confirm ordering changes only inside each task.
7. Confirm sort links do not reorder a multi-directory tree.
8. Use task search and task display ordering; confirm each nested list hides or moves with its parent task.

- [ ] **Step 7: Verify refresh behavior and RPC volume**

Use browser developer tools Network/WS frames while a multi-file task downloads:

1. With the mode enabled, confirm every refresh is one `aria2.tellActive` call whose requested keys include `files`.
2. Confirm individual file percentages advance without entering task detail.
3. Add a task and confirm its files appear on the next full refresh.
4. Let a task complete or remove it; confirm the task and nested file DOM disappear together.
5. Disable the mode and confirm later `aria2.tellActive` requests use the basic key set without `files`.
6. Rapidly toggle the mode several times; confirm the last state wins, no duplicate intervals appear, and no JavaScript error is logged.
7. Temporarily disconnect and reconnect RPC; confirm the last successful UI remains and later refreshes recover.

- [ ] **Step 8: Verify themes and narrow layout**

1. Test both light and dark themes; confirm active blue state, borders, text and progress labels remain readable.
2. Test viewport widths above and below `767px`; confirm the toolbar does not overlay content, nested file rows remain within the page, long names do not cover progress/size, and horizontal behavior matches existing toolbar behavior.
3. Test an empty `/downloading` list; confirm the button still toggles and no empty nested block or console error appears.

- [ ] **Step 9: Stop the dev server and inspect repository state**

Stop BrowserSync with `Ctrl-C`, then run:

```bash
git status --short
```

Expected: no source changes are left uncommitted. Build output may appear only if already ignored by the repository; do not commit `dist/` unless it is already tracked and intentionally changed by project policy.

- [ ] **Step 10: Record verification in the final handoff**

Report:

- Standard build result.
- All-in-One build result.
- Browser scenarios completed, including RPC request-key evidence.
- Any environment-only scenario that could not be exercised; do not describe it as passing.

No extra commit is needed unless verification reveals and fixes a defect. Any defect fix must repeat the relevant machine and browser checks, then be committed with a focused `fix:` message.
