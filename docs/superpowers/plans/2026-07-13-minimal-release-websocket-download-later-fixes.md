# 最小范围发布、WebSocket 与“稍后下载”修复计划

**Goal:** 修复 Release 输入注入、WebSocket 断线丢回调、“稍后下载”恢复暂停，以及两个低风险 BT 过滤对账/启动问题。

**Architecture:** 保持现有 AngularJS 服务边界和 BT 过滤状态机。Release 工作流只改变输入进入 shell 的边界；WebSocket 服务只在已关闭且未自动重连的路径完成失败回调；BT 服务只在“稍后下载”的非暂停 child 上先调用既有 `pauseTasks`。

**Tech Stack:** GitHub Actions YAML/Bash、AngularJS 1.6、aria2 JSON-RPC、Node `assert`/VM 测试、Gulp 4。

**Status:** 已实施。`stop()` 后迟到回调的生命周期代次重构仍明确暂缓。

## 范围约束

- 只修改本计划列出的文件和必要的 SDD 记录。
- 保持现有 `pause-metadata`、立即下载 active-child 策略和过滤算法；只在第三次不确定回包前增加一次已有状态对账。
- 不做依赖、页面工作流、UI、i18n、生成目录或上游同步改动。
- 不增加 WebSocket generation、请求超时、watchdog 或 BT 服务生命周期重构；`stop()` 后迟到回调单独暂缓。

## Task 1：消除 Release 工作流的 Bash 输入插值

**Files:** `.github/workflows/release.yml`、`test/release-workflow.test.js`

- [ ] 先在 `test/release-workflow.test.js` 定位 `Validate version and release state` 步骤并加入契约：步骤 env 提供输入版本；run 块使用 GitHub 默认环境变量；run 块不含任何 Actions 表达式。
- [ ] 运行 `node test/release-workflow.test.js`，确认新增断言在当前实现失败。
- [ ] 在该步骤添加 `RELEASE_INPUT_VERSION` 环境变量；Bash 读取该变量、`GITHUB_EVENT_NAME` 与 `GITHUB_REF_NAME`。不改 workflow-level concurrency，也不改其余发布行为。
- [ ] 运行 `node test/release-workflow.test.js` 和 `actionlint .github/workflows/release.yml`。

## Task 2：让禁用自动重连时的 WebSocket 请求确定失败

**Files:** `src/scripts/services/aria2WebSocketRpcService.js`、新增 `test/aria2-websocket-rpc.test.js`、`package.json`

- [ ] 用 fake `$websocket`、`$q`、`$timeout` 和 setting service 建立最小 VM 回归测试，并加入 `npm test`。
- [ ] 测试自动重连间隔为 0 时：正在发送的请求遇到 `onClose`，其 error callback 和 deferred reject 各发生一次；同一 close 不重复回调；close 后的新请求不调用旧 socket 的 `send`，而立即走已有失败回调。
- [ ] 运行 `node test/aria2-websocket-rpc.test.js`，确认当前实现失败。
- [ ] 将现有 reconnect 的 pending 清理提取为内部 helper。仅在 `onClose` 且自动重连关闭时调用它；自动重连开启时保持现有 `planToReconnect`/`reconnect` 行为。
- [ ] 在 request 发送前识别“已关闭且自动重连关闭”的 socket：直接 reject 并回调错误，不调用旧 socket 的 `send`，也不主动新建或重连 socket。
- [ ] 运行新测试和 `npm test`。

## Task 3：修正“稍后下载”恢复到未暂停 child 的语义

**Files:** `src/scripts/services/ariaNgBtFileFilterService.js`、`test/new-task-small-file-filter.test.js`

- [ ] 在现有 VM harness 中复现：root 不可查询、waiting 列表找不到 child、active 列表按 `following` 找到 child；child 有完整 BT files，且 `startAfterFilter=false`。
- [ ] 断言 child 为 `active` 或 `waiting` 时先调用 `pauseTasks`；下一次状态确认 `paused` 前不调用 `changeTaskOptions`；筛选结束后不调用 `startTasks`；`startAfterFilter=true` 的 active-child 路径不调用 `pauseTasks`。
- [ ] 运行 `node test/new-task-small-file-filter.test.js`，确认当前实现失败。
- [ ] 仅在已确认 BT child、`startAfterFilter === false` 且状态为 `active` 或 `waiting` 时调用 `aria2TaskService.pauseTasks([gid], callback, true)`。
- [ ] 暂停成功后保持既有 `waiting-files` 并结束本 tick；下一 tick 重新查询，只有状态为 `paused` 才进入现有筛选流程。GID 不存在时静默移除；其他失败保留队列并由下一轮重试。
- [ ] 不新增 stage，不改 `startOrComplete`，不改 `startAfterFilter=true` 分支。
- [ ] 运行 `node test/new-task-small-file-filter.test.js` 和 `node test/bt-filter-pending-badge.test.js`。

## Task 4：修正低风险的过滤对账与无效 unpause

**Files:** `src/scripts/services/ariaNgBtFileFilterService.js`、`test/new-task-small-file-filter.test.js`

- [ ] 新增回归：前两次 `changeOption` 明确失败、第三次回包失败但 aria2 实际应用过滤选择时，下一轮对账必须完成 filtered，且不得发送全选恢复 RPC。
- [ ] 保留现有“三次明确未生效后恢复全选”用例，确认回退仍生效。
- [ ] 在第三次失败时保留 `applying-filter`；下一轮复用已有 task/options 对账。只有观察到选择或清理选项不匹配时，才进入现有 `restoring-full`。
- [ ] 新增真实 active-child 的“立即下载”回归：筛选成功后不调用 `startTasks`；已有 paused 的“立即下载”回归仍应调用它。
- [ ] 让 `startOrComplete` 根据已观察的 task 状态只对 paused child 调用 `startTasks`；active/waiting child 直接完成协调。
- [ ] 运行 `node test/new-task-small-file-filter.test.js`。

## Task 5：记录和完整验证

**Files:** 本计划、对应设计文档、`.superpowers/sdd/progress.md`

- [ ] 追加 SDD 进度记录，不改写既有条目。
- [ ] 运行 `npm test`、`npx gulp lint`、`npx gulp clean build`、`npx gulp clean build-bundle`、`actionlint .github/workflows/release.yml` 与 `git diff --check`。
- [ ] 用 `git status --short` 审查范围：只能包含计划列出的源代码、测试、文档和用户原有未提交修改；不包含依赖、页面工作流或 UI/i18n 改动。
