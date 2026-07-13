# 最小范围发布、WebSocket 与“稍后下载”修复设计

## 文档信息

- 产品：AriaNg
- 日期：2026-07-13
- 状态：已实施，自动化门禁通过
- 对应计划：`docs/superpowers/plans/2026-07-13-minimal-release-websocket-download-later-fixes.md`

## 目标

只修复以下五个已确认且小范围的问题：

1. GitHub Release 工作流把手动版本输入直接插入 Bash，存在脚本注入面。
2. WebSocket 自动重连关闭时，断线中的 RPC 回调可能永远不返回，BT 过滤轮询锁会卡住。
3. “稍后下载”的过滤任务恢复时发现 child 已处于 `active` 或 `waiting`，没有重新暂停，违背其应保持暂停的语义。
4. 第三次 `changeOption` 回包不确定时可能直接恢复全选，即使 aria2 已应用过滤选择。
5. 已 active/waiting 的“立即下载” child 在筛选后仍会多发一次无效 `unpause` RPC。

## 已确认的产品边界

| 场景 | 目标行为 |
| --- | --- |
| 立即下载，恢复时 child 已 active | 保持现有行为：不暂停，直接按现有流程筛选。 |
| 稍后下载，恢复时 child 为 active 或 waiting | 先 `forcePause`，确认其为 `paused` 后才筛选，最终不 `unpause`。 |
| 正常磁力元数据流程 | 保持现有 `pause-metadata=true` 设计，不改默认行为。 |
| 本地种子、远程 `.torrent`、界面与翻译 | 不在本次修改范围内。 |

aria2 的 `forcePause` 可暂停 active/waiting 下载；`unpause` 只把 paused 下载变为 waiting。因此“稍后下载”的恢复分支必须以已观察到的 `paused` 状态作为筛选前置条件。

## 发布工作流安全边界

在 `Validate version and release state` 步骤中，`inputs.version` 只能由 GitHub Actions 写入步骤级环境变量，例如 `RELEASE_INPUT_VERSION`。Bash 使用 `$RELEASE_INPUT_VERSION`、`$GITHUB_EVENT_NAME` 和 `$GITHUB_REF_NAME`，不得在 `run:` 文本中使用 `${{ ... }}`。

版本正则、package/package-lock 版本比对、Release/tag 预检、构建和发布行为均保持不变。工作流级 `concurrency.group` 是 Actions 表达式，不经 Bash 执行，因此保持不变。

## WebSocket 断线边界

只修复自动重连关闭时的断线路径：

- socket 关闭时，所有属于该连接的未完成请求都必须恰好失败一次：移除状态、reject promise、调用已有错误回调。
- 自动重连关闭后，后续请求不得向已关闭的 `$websocket` 发送或进入其内部 send queue；应立即走已有失败回调。
- 自动重连开启时，保留当前的延时重连机制和行为。

错误回调会使现有 `aria2TaskService` 将失败响应交回过滤服务，从而释放 `tickInProgress`，保留已持久化任务并在连接恢复后按现有轮询重新对账。

## “稍后下载”状态转换

不新增持久化 stage，也不修改过滤算法。对已经解析为 BT child 的任务：

```text
waiting-files + startAfterFilter=false + child active/waiting
    -> aria2.forcePause
    -> 保持 waiting-files，结束当前 tick
    -> 下一 tick tellStatus 为 paused
    -> 现有 select-file / 恢复全选逻辑
    -> completed-*，不调用 unpause
```

`forcePause` 返回“任务不存在”时沿用现有静默移除；其他失败只结束本轮 tick、保留任务，交给下一次状态查询重试。筛选选项不得在该任务仍为 active/waiting 时写入。

## 选项回包对账与启动边界

第三次过滤选项请求失败时，不立即进入 `restoring-full`。保留现有 `applying-filter` 和重试计数，在下一轮使用已有 `tellStatus`/`getOption` 对账：若目标选择与 `bt-remove-unselected-file=true` 已生效，则完成为 filtered；只有明确观察到不匹配时才沿用既有全选回退。

`startTasks` 只适用于已观察为 `paused` 且原始操作为“立即下载”的 child。active 或 waiting child 直接完成过滤协调，不暂停、不额外 `unpause`，保留现有 aria2 调度状态。

## 非目标

- 不取消或改变 `pause-metadata` 的默认使用。
- 不改变立即下载的 active-child 行为。
- 不重做更广泛的 `changeOption` 回退策略；只在第三次不确定回包后复用已有状态对账。
- 不增加 socket generation、请求超时、watchdog 或 BT 服务生命周期重构；`stop()` 后迟到回调问题留作单独任务。
- 不升级依赖，不改 UI、CSS、i18n 或生成的 `dist/`。

## 验收标准

1. 手动 Release 输入不再被 Actions 插入 Bash `run` 文本；工作流契约测试能防止回归。
2. WebSocket 自动重连关闭时，断线中的过滤 RPC 得到失败回调，后续 tick 不会永久卡住；新请求不进入已关闭 socket 的队列。
3. 稍后下载恢复到 active/waiting child 时，先发 `forcePause`；观察到 `paused` 前不改 `select-file`；筛选结束后不 `unpause`。
4. 立即下载的 active-child 路径不发 `forcePause`。
5. 第三次失败但 aria2 已应用选择时，不发恢复全选 RPC；三次明确未生效时仍按原逻辑回退。
6. active/waiting 的立即下载 child 不发 `unpause`；paused 的立即下载 child 仍正常 `unpause`。
7. `npm test`、`npx gulp lint`、两种构建、`actionlint` 和 `git diff --check` 均通过。

## 官方参考

- [GitHub Actions：避免脚本注入](https://docs.github.com/en/actions/concepts/security/script-injections)
- [aria2 RPC：pause、forcePause 与 unpause](https://aria2.github.io/manual/en/html/aria2c.html)
