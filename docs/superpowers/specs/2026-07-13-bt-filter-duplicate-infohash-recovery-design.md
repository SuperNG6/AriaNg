# BT 重复 InfoHash 过滤恢复设计

## 问题

磁盘空间不足后，aria2 可能保留或重新激活原有 BT 下载。用户删除失败记录并再次添加同一磁力时，新元数据任务会以错误码 12（同一 InfoHash 已在下载）结束。该失败根任务没有 `followedBy`，已存在的 BT 任务也可能没有 `following`，所以当前仅按父子 GID 关系恢复的过滤协调器无法找到实际下载任务。

结果是新任务短暂显示“过滤中”，但目标 BT 任务仍保持全文件选择。

## 设计

- 保持现有 `following` / `followedBy` 恢复为首选路径。
- 仅当磁力或远程种子根任务满足 `status=error`、`errorCode=12` 且具有非空 `infoHash` 时，持久化该 InfoHash 并启用补充恢复。
- waiting 和 active 扫描请求增加 `infoHash`，在没有唯一父子关系候选时按完整 InfoHash 查找。
- 只有当前队列中恰好有一个同 InfoHash 的候选任务时才采用其 GID；零候选沿用既有三次扫描后静默移除，多候选保持等待；两者都不修改任何 aria2 任务。
- 如果该唯一候选 GID 已由同一 RPC 下的另一个过滤记录持有，则把错误码 12 记录视为重复提交并静默合并，避免同一 BT 任务被过滤和计数两次。
- 采用候选后继续复用现有 `waiting-files`、暂停、文件规划、`changeOption`、启动及回退状态机。
- 不解析错误文本中的哈希，不修改普通错误、用户删除、RPC 切换和终端汇总语义。

## 验收

- 错误码 12 的元数据根能按唯一 InfoHash 找到无 `following` 的 active BT 任务并过滤。
- 同 InfoHash 多候选时不选择任意任务。
- 现有父子 GID 恢复、Download Now/Later、重试和 RPC 身份保护测试继续通过。

官方 aria2 1.37.0 手册定义：错误码 12 表示同一 InfoHash 的 torrent 正在下载；`tellStatus` 的 `infoHash` 字段只适用于 BitTorrent；`tellActive` 与 `tellWaiting` 可按请求字段返回任务信息。
