# 新建 BT 任务小文件过滤 PRD（维护版）

> 状态：当前实现说明。最后按代码、回归测试与 aria2 官方文档核对：2026-07-13。
>
> 本文是 BT 小文件过滤的产品与维护入口。当前代码与测试优先于历史计划；改动核心状态机前仍必须阅读 [维护指南](../../.claude/skills/bt-filter-dev/SKILL.md)。

## 0. 维护决策原则

以普通用户的主路径为先：在 payload 下载前完成筛选，且不为了极端边界破坏“立即下载”与“稍后下载”的既定语义。

- 修复高概率问题、会造成数据/任务错误的问题，以及局部、低风险且不改变产品设计的改动。
- 对只在请求回包恰好丢失、生命周期恰好交错或同一站点多标签页并发等条件下发生的低频边界，先准确记录并观察真实反馈；不要因此引入手工 GID、全局锁、常驻服务或复杂恢复协议。
- 只有真实用户报告、部署方式变化，或能用小而无副作用的改动解决时，才重新评估这些边界。

## 1. 产品目标

在新建支持的 BitTorrent 任务时，按用户设置的阈值排除较小文件，减少不需要文件的持续下载、磁盘占用和后续清理成本。

实现必须保持 AriaNg 的纯静态前端形态：不修改 aria2、不要求服务端常驻过滤程序。筛选由浏览器在连接 aria2 时协调，aria2 本身负责元数据和下载。

成功的混合大小任务会在 payload 下载前将 aria2 的文件选择改为“保留的大文件”；无法安全筛选时宁可恢复完整选择，也不能留下半配置任务。

## 2. 支持范围与非目标

| 输入 | 是否进入过滤 | 识别规则 |
| --- | --- | --- |
| 磁力链接 | 是 | `magnet:?` |
| 本地 `.torrent` | 是 | 用户上传的 torrent 文件 |
| 远程 torrent URL | 是 | HTTP/HTTPS URL 去掉 query/fragment 后，路径以 `.torrent` 结尾 |
| 普通 HTTP/FTP/SFTP 直链 | 否 | 沿用原有下载流程 |
| Metalink | 否 | 沿用原有下载流程 |

同一批 URL 可混合 BT 候选与普通直链。功能不根据响应头猜测 torrent，不支持跨浏览器、跨设备、清除站点数据后的恢复，也不提供服务端后台过滤器。

## 3. 用户设置、界面与结果语义

### 设置与状态展示

- 控件只在 `/new` 顶栏出现；默认关闭，默认阈值为 `100 MB`。
- 阈值只接受 `1–102400` 的整数；代码按 `MB × 1024 × 1024` 字节计算。输入无效时禁止提交。
- 提交时生成不可变意图快照；之后修改开关或阈值不会影响已入队任务。
- 顶栏状态可在任何页面显示：恢复、等待元数据、处理中、完成或回退。完成状态约 5 秒后隐藏；回退状态约 10 秒后隐藏，并只发一次批量非阻塞警告。
- 待处理 job 的 metadata root 与 payload child 都会在任务行显示“过滤中”徽章；完成后徽章消失。

### 文件选择规则

| 文件集合 | 行为 |
| --- | --- |
| 混合大小 | 严格小于阈值的文件被排除；一次 `changeOption` 同时设置 `select-file` 与 `bt-remove-unselected-file=true` |
| 全部小于阈值 | 视为资源本身由小文件组成；恢复/确认全选，完整下载，并恢复原有清理选项 |
| 全部大于或等于阈值 | 不改写用户已有的文件选择或清理选项 |
| 筛选多次失败 | 恢复全选和原始清理选项，再按原始“立即/稍后”意图处理，并标记为回退 |

边界是严格的：大小**等于**阈值必须保留。aria2 的 `select-file` 索引从 **1** 开始，不能改成 0 开始。

## 4. aria2 契约

实现依赖 [aria2 官方手册](https://aria2.github.io/manual/en/html/aria2c.html) 中的以下事实：

- `pause-metadata=true` 会暂停元数据下载产生的后续下载；它让磁力/远程 torrent 的 metadata root 继续工作，而 payload child 等待筛选。
- `select-file` 接受 1-based 的逗号索引列表；在 active 下载上修改该选项通常会使 aria2 重启该任务。
- `bt-remove-unselected-file=true` 在 BitTorrent **完成时**删除未选择文件，而不是设置时立即删除；恢复全选必须发生在完成前。
- `forcePause` 可迅速暂停 active/waiting 任务；`unpause` 只会把 `paused` 改为 `waiting`，不是通用的“开始”命令。
- 磁力与远程 torrent 存在双 GID：metadata root 的 `followedBy` 指向 payload child，child 的 `following` 指回 root。
- 部署侧若配置了“暂停即移动/删除任务文件”的 aria2 hook，则与“稍后下载”恢复时的 `forcePause` 不兼容；启用本功能时，暂停必须仍可恢复。

未选择文件仍可能因共享 piece 被创建或写入少量数据；正常完成后才由 aria2 清理。这是 aria2 限制，不应承诺“筛选期间磁盘绝不出现小文件”。

## 5. 提交与下载模式

| 场景 | 当前行为 |
| --- | --- |
| 磁力/远程 `.torrent`，启用过滤 | metadata root 立即运行并带 `pause-metadata=true`；随后生成的 payload child 暂停等待筛选 |
| 本地 `.torrent`，启用过滤 | 先以 paused 状态加入，再读取文件列表 |
| 普通直链、Metalink 或关闭过滤 | 完全沿用原有新建任务流程 |
| 原始操作为“立即下载” | child 仍 paused 时，筛选完成后才 `unpause`；恢复时若 child 已 active/waiting，直接筛选且不额外 `unpause` |
| 原始操作为“稍后下载” | 始终保持暂停；恢复时发现 child 已 active/waiting，必须先 `forcePause`，确认 paused 后才修改选择 |

因此，当前正常设计不是“关闭浏览器后 payload 自动继续下载”：页面关闭后 metadata 可继续完成，但由它产生的 payload child 会暂停；重新在**同一浏览器、同一 RPC endpoint**打开 AriaNg 后，协调器才继续筛选。立即下载恢复到已 active child 时允许直接改选项，可能已有少量非目标数据，这是已接受的恢复折中。

## 6. 状态机与恢复

每个 job 处于以下阶段之一：

```text
waiting-metadata
  -> waiting-files
  -> applying-filter -> starting-filtered -> completed-filtered
  -> restoring-full -> starting-full     -> completed-full
                      starting-fallback  -> completed-fallback
```

- `all-large` 直接进入完整下载结果；`all-small` 进入 `restoring-full`；混合任务进入 `applying-filter`。
- `completed-*` 是终态：不再轮询或写 aria2，但会暂时保留为本批汇总结果，直到最后一个当前批次 job 结算后再清理。
- 每 250ms 只轮询当前 RPC endpoint 的一个非终态 job；`tickInProgress` 防止正常情况下并发处理多个 job。
- 只有 `changeOption` 失败消耗筛选重试。状态读取或临时网络失败保留 job，不消耗重试；第三次失败后的下一轮先基于当前文件选择和选项对账，再决定恢复完整选择。
- 已删除任务静默移除，不启动、不改选择、不计为回退。

### metadata root 与 child 恢复

1. 正常情况下从 root 的 `followedBy` 取得唯一 child。
2. root 已完成、出错或不再可查询时，先扫描 `tellWaiting`（包含 paused），再扫描 `tellActive`，用 child 的 `following` 反向关联 root。
3. 多个候选 child 时绝不任选一个，继续等待；只接受唯一 child。
4. 连续三次成功扫描仍找不到唯一 child，才按当前恢复分支静默结算；RPC 失败不计入次数。

恢复扫描默认使用 aria2 的 1000 项列表窗口；超过该规模的同时等待任务没有额外分页保证。

## 7. 持久化、RPC 隔离与生命周期

- 队列键为 `BtFileFilterQueue`。job 保存 RPC identity、root/child GID、阈值快照、原始下载模式、来源类型、阶段、重试/恢复字段和时间戳。
- RPC identity 为 `protocol|host|port|interface`，刻意不包含 alias、secret 与自定义请求头。切换 endpoint 时，其他 endpoint 的 job 保留但不处理。
- `MainController` 在成功取得全局统计后启动协调器；Unauthorized 或控制器销毁时停止。重新可用时必须重新启动。
- 队列只在同一浏览器站点数据内恢复；没有跨标签页合并或锁，也没有跨设备同步。

## 8. 已知实现风险（不是既定产品承诺）

以下事项是当前代码的维护遗留，不是待办清单。按本 PRD 的维护决策原则，它们当前均不安排修复；只有出现真实用户反馈或低风险、小范围方案时才重新评估：

1. aria2 已接收 add 请求、但浏览器在收到 GID 回包前关闭或断线时，job 尚未持久化；payload child 可能保持 paused 且无法自动恢复。
2. 已 `complete`、`error` 或 seeding 的 child 目前没有统一的“禁止筛选写操作”守卫。
3. 第三次 `changeOption` 回包不确定时的对账是缓解，不是原子事务；极端乱序仍可能与恢复全选竞争。
4. 多标签页同时写队列没有合并或锁；当前实现仅保证单页面生命周期内的迟到回调不会继续旧操作。

其中，“添加请求已被 aria2 接收但浏览器未收到 GID 回包”可通过预分配手工 GID 降低风险，但会把 GID 全局唯一性、冲突处理与兼容性责任引入主流程；以当前发生概率和普通用户收益衡量，不采用该方案。

## 9. 维护入口与门禁

| 位置 | 职责 |
| --- | --- |
| [`ariaNgBtFileFilterService`](../../src/scripts/services/ariaNgBtFileFilterService.js) | 选择规划、持久化队列、状态机、恢复、状态汇总 |
| [`NewTaskController`](../../src/scripts/controllers/new.js) | 识别候选、快照意图、metadata/local-torrent 的暂停策略、拿到 GID 后入队 |
| [`MainController`](../../src/scripts/controllers/main.js) | 设置绑定、顶栏状态、协调器启动/停止 |
| [`DownloadListController`](../../src/scripts/controllers/list.js) 与 [`list.html`](../../src/views/list.html) | 待处理阶段映射与任务行徽章 |
| [`aria2TaskService`](../../src/scripts/services/aria2TaskService.js) | 原子任务选项、暂停与启动 RPC 封装 |
| [`ariaNgSettingService`](../../src/scripts/services/ariaNgSettingService.js) | 过滤设置与当前 RPC identity |
| [`test/new-task-small-file-filter.test.js`](../../test/new-task-small-file-filter.test.js) | 主状态机、恢复、回退与新建任务回归 |
| [`test/bt-filter-pending-badge.test.js`](../../test/bt-filter-pending-badge.test.js) | 徽章阶段映射和服务生命周期回归 |

修改筛选服务、控制器、徽章或相关 i18n 后，至少执行：

1. `npm test`
2. `npx gulp lint`
3. `npx gulp clean build`
4. `npx gulp clean build-bundle`
5. 若影响界面，375px 浅色与深色人工检查

功能开发阶段只同步 `src/scripts/config/defaultLanguage.js` 与 `src/langs/zh_Hans.txt`，`npm test` 检查两者的 BT 过滤键和全部命名占位符一致，不固定键数量。文案冻结、准备发版时再同步全部 `src/langs/*.txt`，并执行 `npm run test:i18n-release`；缺键或占位符漂移会阻止发版。

## 10. 历史资料

- [原始产品设计](../superpowers/specs/2026-07-11-new-task-small-file-filter-design.md)
- [最新最小修复设计](../superpowers/specs/2026-07-13-minimal-release-websocket-download-later-fixes-design.md)
- [实施计划](../superpowers/plans/2026-07-11-new-task-small-file-filter.md)
- [维护指南](../../.claude/skills/bt-filter-dev/SKILL.md)

历史计划、审计报告和 `progress.md` 用于追溯决策；它们不是当前产品行为的唯一来源。
