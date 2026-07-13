# BT 重复 InfoHash 过滤恢复计划

**Goal:** 修复磁盘满后删除失败记录并重新添加同一磁力时，错误码 12 根任务无法关联现有 BT 下载、导致徽标存在但漏过滤的问题。

**Architecture:** 在既有父子 GID 恢复之外，为错误码 12 增加严格的唯一 InfoHash 对账；成功关联后完全复用原状态机。

## Task 1：回归测试

- [x] 复现失败根任务没有 `followedBy`、活动 BT 任务没有 `following`，但二者 `infoHash` 相同。
- [x] 断言修复前不发生 `changeTaskOptions`。
- [x] 加入同 InfoHash 多候选不应变更任何任务的安全回归。

## Task 2：最小实现

- [x] 持久化并清洗合法的 `infoHash`。
- [x] waiting/active 恢复请求加入 `infoHash`。
- [x] 仅对错误码 12 启用唯一 InfoHash 候选恢复。
- [x] 保留 RPC identity、轮询互斥、父子关系优先和既有重试语义。

## Task 3：记录与门禁

- [x] 更新 `.superpowers/sdd/progress.md`。
- [x] 运行 `npm test`、`npx gulp lint`、`npx gulp clean build`、`npx gulp clean build-bundle` 和 `git diff --check`。
