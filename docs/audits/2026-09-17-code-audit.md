# 项目代码审计（2026-09-17）

本轮发现 **5 项已复现缺陷、1 项已在模拟 RPC 中验证的设计缺口**。P1 表示应优先修复，P2 表示需要修复的功能问题。以下各项保留修复前的审计证据和当时行号。后续已完成 A1—A6 修复，并转为自动化回归测试；个人下载任务未被修改。

审计重点为 RPC 传输、重连、BT 自动/批量过滤的生命周期及恢复、任务重试、文件树处理与配置切换。检查了相关控制器、设置、存储及现有测试；这不是全部功能和依赖安全性的穷尽证明。

## A1 — P1：重连会执行已经报错且失去回调的写请求

- 位置：`src/scripts/services/aria2WebSocketRpcService.js:224`、`:232`、`:286`。
- 触发：WebSocket 尚未打开或正在断线时提交请求；随后连接失败并自动重连。
- 根因：`rejectPendingRequests()` 只删除应用的 `sendIdStates` 并通知失败，未清除 `angular-websocket` 的 `sendQueue`。依赖在新连接打开时仍会发送这些排队请求，响应却找不到原回调。
- 复现：使用当前安装的真实 `angular-websocket` 实现和本地模拟 socket，排队一个 `addUri`，关闭连接，运行重连定时器，再打开替代连接。请求先收到一次失败通知，随后仍被发送；成功响应无法触发成功回调。
- 影响：界面提示失败，服务端却创建任务；用户重新提交可造成重复任务。启用过滤的磁力链接依靠成功回调登记过滤队列，丢失回调可能留下已创建但无人接管的暂停子任务。
- 建议：统一传输队列与应用请求状态的生命周期。已向调用方终止的未发送请求必须从传输队列移除；选择继续发送的请求必须保留回调，不能提前宣布失败。补充使用实际依赖的断线排队测试。

## A2 — P1：过滤队列身份与实际 RPC 连接不一致

- 位置：`src/scripts/services/ariaNgSettingService.js:733`；关联 `src/scripts/services/aria2HttpRpcService.js:5`、`src/scripts/services/aria2WebSocketRpcService.js:8`、`src/scripts/services/ariaNgBtFileFilterService.js:586`。
- 触发：在设置页修改当前默认 RPC 的 host、port、protocol 或 interface，尚未点击刷新页面。
- 根因：设置即时持久化，`getCurrentRpcIdentity()` 每次读取最新设置；HTTP/WebSocket 的地址及 RPC 的传输实现、secret 则在 service 初始化时捕获。配置页只提示刷新，后台过滤仍在运行。
- 复现：实例化真实设置服务和 HTTP 服务，地址为 A；使用真实 `updateRpcSetting()` 改为 B，之后身份返回 B，但新的 `tellStatus` 仍发送到 A。
- 影响：A 上创建的过滤任务可存进 B 的队列，刷新到 B 后无法恢复原任务。如果 B 已有持久化任务，后台可能向 A 查询这些 GID，并把 B 的任务误判为删除。后者是由已确认的身份错配和当前删除逻辑推导出的后果。
- 建议：为实际连接建立不可变的连接上下文，身份、地址、凭证及 generation 一起切换。刷新生效模式下，队列身份也必须保持旧连接身份；不能使用尚未生效的设置。

## A3 — P2，设计缺口：自动过滤没有等待文件选择状态收敛

- 位置：`src/scripts/services/ariaNgBtFileFilterService.js:1068`；关联 `:906` 和恢复分支 `:997`。
- 触发：自动恢复到已经 active 的 BT 子任务，`changeOption` 已返回成功，但文件选择尚未变为目标状态。
- 根因：成功回调直接进入 `startOrComplete()`。对于 active 任务，立即计为 filtered 并移除队列记录；没有批量过滤分支所具备的后续 `tellStatus/getOption` 读回和稳定窗口。
- 模拟复现：设置 `changeOption` 返回 OK，同时保持文件选择不变。两个轮询 tick 后，状态显示 filtered=1，队列已清空，小文件仍 selected=true。
- 证据边界：已确认前端存在提前完成、停止跟踪的行为；未验证真实 aria2 上的永久不收敛。官方文档说明 active 下载的某些选项变更会触发由 aria2 管理的重启，不能仅凭本模拟断言所有实际下载都会过滤失败。[aria2.changeOption 文档](https://aria2.github.io/manual/en/html/aria2c.html#aria2.changeOption)
- 建议：自动过滤与恢复分支复用批量过滤的读回完成条件；只有确认目标文件选择和清理选项后才清除持久化记录。对 active 恢复路径补充真实 aria2 集成验证。

## A4 — P2：合法目录名导致文件树崩溃

- 位置：`src/scripts/services/aria2TaskService.js:124`；关联 `:177`、`:330`。
- 触发：多文件种子中存在 `bundle/constructor/data.bin`、`bundle/__proto__/data.bin` 或 `bundle/toString/data.bin`，打开目录文件视图。
- 根因：`allDirectoryMap` 使用普通 `{}`；查找目录时不检查自有属性，继承的 `Object.prototype` 属性被当作已有目录节点返回。随后执行 `directoryNode.files.push()` 时抛异常。
- 复现：调用真实 `processDownloadTasks([task], true)`，以上三种目录名均抛出 `TypeError: Cannot read properties of undefined (reading 'push')`。
- 影响：任务列表的文件模式、任务详情目录视图无法正常处理包含该任务的响应。
- 建议：目录映射使用 `Object.create(null)` 或 `Map`；对来自文件名、路径的字典键始终采用自有键语义。测试真实目录树输出，而不是只检查模板文本。

## A5 — P2：重试已消失任务时抛异常，Promise 永不结束

- 位置：`src/scripts/services/aria2TaskService.js:678`、`:695`。
- 触发：用户点击重试时，任务结果已被另一客户端删除，或被 aria2 清理；`system.multicall` 的 `tellStatus` 子调用返回错误对象。
- 根因：外层 `response.success` 不代表所有子调用成功。代码将错误对象按 `[0]` 解包得到 undefined；虽然进入错误分支并记录 task 为空，仍继续读取 `task.files`，在 reject/callback 之前抛出异常。
- 复现：给真实 `retryTask()` 回调一个外层成功、内层错误的 multicall 响应；抛出读取 files 的 TypeError，任务 Promise 未 resolve/reject，用户回调未执行。
- 影响：当前重试状态悬挂；批量串行重试也可能停在该项，后续任务不再执行。
- 建议：分别校验每个子响应，错误路径提前返回，并保证每次调用恰好结算一次。[官方 multicall 文档明确允许子调用返回错误对象](https://aria2.github.io/manual/en/html/aria2c.html#system.multicall)。

## A6 — P2：批量重试会重复执行失败项，并提前汇报完成

- 位置：`src/scripts/services/aria2TaskService.js:806`。
- 触发：批量重试至少三项，第一项成功，第二项返回 rejected Promise。
- 根因：`lastPromise.then(runCurrent).catch(runCurrent)` 的 catch 同时捕获“前一项失败”和“当前项失败”。后一种情况下会再次执行当前项，第二次结果又被计入全局数量。
- 复现：真实 `retryTasks()` 使用原生 Promise、模拟单项 RPC 结果。调用顺序为 `first, second, second, third`；在第三项开始前就回调完成，摘要为成功 1 / 失败 2，而输入实际只有一个失败任务。
- 影响：用户看到不准确的完成数量和提前结束的状态，失败任务被隐式重试两次。若失败实际是服务端已执行但响应丢失，重复提交还可能造成额外下载任务；该后果未操作真实服务验证。
- 建议：只在前一项结算时选择是否执行当前项，例如使用 `then(runCurrent, runCurrent)`，随后由下一项处理当前项的失败；以输入项为单位结算一次，不以尝试次数累计完成数量。

## 设计层面的共同问题

1. 请求状态、传输排队状态和持久化状态分开维护，但缺少共同的连接上下文与结束条件，形成 A1、A2。
2. 自动过滤与批量过滤各自实现成功判定，后者已有读回验证，前者仍在收到 OK 时完成，形成 A3。
3. 失败路径的结算规则不统一：有的异常绕过 reject/callback，有的 catch 重复调用业务动作，形成 A5、A6。
4. 现有回归测试覆盖了大量业务情形，但 WebSocket stub 不模拟依赖的发送队列，未覆盖目录保留名和串行 Promise 错误传播；全部测试通过仍不足以排除这些边界。

## 修复前审计验证（历史记录）

- `npm test`：全部通过。
- `npx gulp lint`：通过。
- `node docs/audits/2026-09-17-repro.cjs`：A1—A6 均按上述条件复现。
- `git diff --check`：通过。
- 当前 PATH 没有 `aria2c`，未进行真实 aria2 集成或浏览器 UI 验证。A3 尤其需要真实 active 任务的状态收敛证据。
- 应用源码未改变，因此没有运行两种构建；保留了审计前已有的文档、规则及其他工作区改动。

原复现情形现已转为 `test/audit-regressions.test.js`、`test/aria2-websocket-rpc.test.js` 和 `test/new-task-small-file-filter.test.js` 中的正常行为回归测试，均纳入 `npm test`。同目录的 `2026-09-17-repro.cjs` 现在运行这三组回归，不再断言缺陷存在。修复后的完整测试、两种构建和隔离浏览器验证均通过；真实 aria2 写入及重启收敛仍未验证。
