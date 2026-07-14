# BT 批量过滤暂停与真实核对设计

## 背景与真实环境证据

批量过滤原实现直接对 active BT 任务调用一次 `aria2.changeOption`，同时设置 `select-file` 和 `bt-remove-unselected-file`，收到 `OK` 后立即把任务计为 filtered。

2026-07-14 在真实 aria2 1.37.0 实例中执行 100 MB 批量过滤时，5 个任务、32 个小文件暴露出假成功：

- `changeOption` 对 5 个任务均返回 `OK`；
- `bt-remove-unselected-file=true` 已保存；
- `tellStatus.files[*].selected` 仍全部为 `true`；
- 服务错误显示“5 个任务已过滤”；
- 对 active 任务单独设置 `select-file=1` 后连续 30 秒仍未生效；
- 触发暂停/任务重启后，目标选择才真实生效。

官方 aria2 文档允许通过 `changeOption` 修改 `select-file`，并说明 active 任务修改多数选项会自行重启。但本项目不能把 RPC 的 `OK` 当作状态已收敛；真实文件选择必须由后续 `tellStatus` 核对。

## 目标

批量过滤逐个、安全地处理 active BT 内容任务：短暂暂停任务，修改选择，读取 aria2 的真实状态核对，再恢复调度。任何失败均不得显示为成功，也不得因过滤失败故意把原 active 任务留在 paused。

## 非目标

- 不改变自动新建任务过滤状态机；其 payload child 已在 paused 状态下筛选。
- 不并行处理多个批量任务。
- 不解决上游依赖漏洞、aria2 自身缺陷或 AriaNg 历史问题。
- 不增加新的界面组件、翻译键、后台执行器或通用工作流框架。
- 开发阶段仍只维护英文和简体中文；其他语言在发版前统一更新。

## 方案选择

采用逐任务“暂停—应用—核对—恢复”方案，不采用乐观修改后超时降级，也不整批暂停。

逐任务方案对其他下载影响最小，恢复边界清楚，并与当前单任务 checkpoint 持久化模型一致。每次只有一个 GID 处于变更流程，现有自动任务轮转策略保持不变。

## 批量状态机

内部阶段调整为：

```text
inspecting
  → pausing
  → applying
  → resuming(filtered)
  → completed item

应用失败或核对失败：
applying
  → restoring
  → resuming(failed)
  → completed item
```

### inspecting

重新读取任务和选项，确认它仍是 active BT payload、未被自动过滤任务接管，并且当前文件选择仍可缩小。

保存以下不可变 checkpoint：

- `originalSelectedIndexes`
- `targetSelectedIndexes`
- `originalRemoveUnselectedFile`
- `targetRemoveUnselectedFile`
- `filteredFileCount`
- `resumeAfterMutation=true`

随后持久化 `stage=pausing`，再调用 `forcePause`。

### pausing

RPC 回调成功只表示请求被接受，不推进为成功。后续 tick 必须读取 `tellStatus`：

- `paused`：进入 applying；
- `active` 或 `waiting`：在重试间隔到期后再次请求暂停；
- 任务消失：记为 skipped；
- 三次暂停请求仍未观察到 paused：若任务没有发生选择变化，记为 failed；若状态不确定，进入 restoring。

暂停请求使用持久化时间戳控制重试，避免 250 ms 轮询每次重复发送。单次请求后至少等待 30 秒，最多三次。

### applying

仅在任务为 paused 时提交目标 `select-file` 和清理选项。收到 `OK` 后不结算，下一 tick 同时读取 `tellStatus` 和 `getOption`：

- 真实选择等于 `targetSelectedIndexes`，且清理选项等于目标值：进入 resuming(filtered)；
- 仍为原选择：最多重试三次应用；
- 处于部分变化或三次后仍不一致：进入 restoring；
- 任务意外离开 paused：先重新进入 pausing，不在 active 状态继续改选。

### restoring

仅在 paused 状态下尝试恢复 `originalSelectedIndexes` 和原清理选项。RPC `OK` 后仍需用 `tellStatus` 和 `getOption` 核对。

- 核对一致：进入 resuming(failed)；
- 最多三次仍不一致：停止继续写选项，进入 resuming(failed)，由完成统计明确报告失败。

### resuming

原任务在 inspection 时为 active，因此批量流程应尽力恢复调度：

- 当前为 paused：调用 `unpause`；
- 当前为 active、waiting 或 complete：说明已离开 paused，可按 checkpoint 中的目标 outcome 结算；
- unpause 最多重试三次；仍为 paused 时记为 failed，但继续处理下一任务。

filtered 只允许在目标选择和目标清理选项已经真实核对成功后结算。恢复流程和 unpause 失败永远不能升级为 filtered。

## 持久化与恢复

`bulkProgress.current` 增加最小字段：

- `stage`: `inspecting|pausing|applying|restoring|resuming`
- `pauseRetryCount`
- `pauseRequestedAt`
- `retryCount`
- `restoreRetryCount`
- `resumeRetryCount`
- `resumeOutcome`: `filtered|failed`

已有选择、清理选项和文件计数字段继续复用。sanitize 必须拒绝未知阶段和非法计数，但不增加版本迁移；缺失的新计数字段按 0 处理，旧的 applying checkpoint 在首次 tick 时先检查任务状态，active 时回到 pausing，paused 时继续核对。

RPC identity 切换、`stop()` 或页面关闭时不继续当前回调链。恢复后依赖持久化阶段重新读取 aria2 状态，不重复假定上次 RPC 已生效。

## 展示与文案

不新增翻译键：

- inspecting 映射现有 `bulk-inspecting`；
- pausing、applying 映射现有 `applying-filter`；
- restoring 映射现有 `restoring-full`；
- resuming(filtered) 映射现有 `starting-filtered`；
- resuming(failed) 映射现有 `starting-fallback`。

批量完成统计保持 filtered、skipped、failed 三类。只有真实核对通过的任务进入 filtered。

## 测试设计

### 必须先失败的回归

1. active 任务 `changeOption` 返回 `OK`，但下一次 `tellStatus` 仍为全选：不得计 filtered。
2. active 候选必须先调用 `pauseTasks`，观察 paused 后才能调用 `changeTaskOptions`。
3. 目标选择核对成功后才调用 `startTasks`，观察任务离开 paused 后才计 filtered。
4. 应用三次仍不一致时恢复原选择和原清理选项，随后恢复任务调度并计 failed。
5. 页面重载恢复 pausing、applying、restoring、resuming checkpoint 时不重复错误操作。
6. RPC identity 在暂停、应用、恢复或恢复调度回调中切换时，不对新 endpoint 继续旧链。

### 真实环境验收

使用 Playwright 连接真实 aria2，选择明确可回退的 active 多文件 BT 任务：

1. 记录原任务状态、选择索引和清理选项；
2. 执行 100 MB 批量过滤；
3. 观察任务短暂离开 active；
4. 等待完成统计；
5. 用 `tellStatus` 确认小于 100 MB 的原已选文件变为未选，大文件和手动排除不变；
6. 用 `getOption` 确认清理选项；
7. 确认原 active 任务最终为 active 或 waiting，不遗留 paused；
8. 确认界面统计与真实变化数量一致，无控制台或 RPC 错误。

若真实任务已经按 100 MB 过滤而没有新候选，使用一个专用测试 torrent 或先由用户明确允许恢复某个任务的原选择；不得为了测试擅自重新选择已排除文件。

## 后续专项 Review 范围

修复通过后，对 fork 新增功能做一次独立审查，只覆盖：

- 通用 Files 任务列表及刷新/缓存策略；
- 自动 BT 小文件过滤；
- 批量 BT 小文件过滤；
- 状态栏、任务徽标、确认弹窗及响应式布局；
- RPC 切换、Unauthorized、stop/restart 和持久化恢复；
- 英文/简体中文开发门禁与发版全语言门禁；
- 新增测试是否验证真实状态，而不是只验证 mock 回调。

审查不处理上游原有依赖漏洞、历史 UI 缺陷或与新增功能无关的问题。发现问题按 Blocker、Important、Minor 分类；只修复新增功能内有证据的问题，避免无关重构和低概率防御。
