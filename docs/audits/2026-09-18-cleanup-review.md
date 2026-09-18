# 代码清理审查（2026-09-18）

审查基线：`862a3e2`。本轮只审查并记录，没有修改应用代码或依赖。

重点阅读了 BT 自动/批量过滤服务、下载列表、新建任务、RPC 传输、存储和构建链，并检索了源码及测试引用。这是有重点的清理审查，不是全仓库每一行的穷尽审计。下面的行号对应审查基线。

优先级表示清理顺序，不等于线上缺陷严重程度。先修复失效的检查流程，再删除确定冗余，最后考虑状态和抽象的收缩。

## C0：lint 流程没有真正检查代码——优先处理

- 位置：`gulpfile.js:15`。
- 现状：流水线只有 `eslint.format()` 和 `eslint.failAfterError()`，缺少前置 `eslint()`。安装的 gulp-eslint 实现只会格式化、统计已经附加到文件上的 `file.eslint`；这里没有任何步骤生成它。
- 验证：在内存 Vinyl 文件中放入未定义变量、未使用变量和缺分号的代码。同样的 format/failAfterError 流程正常结束；加上 eslint() 后以 3 个错误失败。探针没有写入源码。
- 影响：现有构建包含名为 lint 的任务，但不能据此证明 ESLint 检查通过。
- 建议：补全检查器调用；检查任务也无需把未修改文件重新写回 `src/scripts`。独立处理规则基线，避免把修复门禁变成全仓格式重写。
- 限制：直接用当前 ESLint 配置检查源码得到 **416 个错误、10 个警告**。其中包含大量 AngularJS 编码风格规则冲突，不代表 416 个业务缺陷；直接补调用会使构建暴露这些历史问题。

## C1：批量过滤中存在不可达分支——可删除，需跑 BT 回归

- 位置：`ariaNgBtFileFilterService.js:1961`、`:1968`、`:1989`；关联 `:1939`、`:2020`。
- `processBulkTick()` 对 inspecting 阶段单独执行 getOption → getTaskStatus → applyBulkInspection，并提前返回。只有非 inspecting 阶段走 `processBulkTaskResponse()`，因此后者的 inspecting 校验是遗留路径。
- `:1939` 已对非 inspecting 且不满足 `isBtPayloadTask()` 的情况处理并返回；该谓词包含 bittorrent、bittorrent.info 和有效文件非空条件。因此 `:1968` 再检查这三项不可能命中，还会对通过的任务重复扫描文件。
- 合法非 inspecting 阶段只有 resuming、pausing、applying、restoring，均在前面的分支返回；`:1989` 的最终调用没有正常入口。
- 建议：删除这些分支和已经恒真的 `stage !== 'inspecting'` 条件。同步梳理 `inspectBulkOptions()` 末尾回到 applyBulkInspection 的旧兜底入口。
- 保留：阶段白名单、加载时数据清洗及异步回调生命周期校验。不可达判断依赖这些现有约束，不能连同约束一起删掉。

## C2：两个回调的校验结果完全不影响行为——直接简化

- 位置：`ariaNgBtFileFilterService.js:1639`、`:1687`。
- 暂停和恢复 RPC 的回调均为：校验失败时 finishBulkTick 后 return，校验成功时也只执行同一个 finishBulkTick。
- 建议：两个回调都直接调用 `finishBulkTick(operation)`，去掉无效条件。
- 安全依据：finishBulkTick 自身先比较 activeOperation 的对象身份，旧回调不会释放新操作的锁。
- 不应扩展为删除所有回调校验：会更新任务、落盘或继续发 RPC 的回调仍必须检查生命周期。

## C3：操作上下文保留了没有调用者的双类型兼容——收窄参数

- 位置：`ariaNgBtFileFilterService.js:603`、`:610`、`:614`、`:756`、`:1477`。
- `getOperationRpcIdentity()` 同时接受对象和字符串，但内部异步调用链由 tick 创建 `{rpcIdentity, generation}` 对象后传入；这些函数没有对外导出。
- 即便传入字符串，后续 `isOperationCurrent()` 也会拒绝它，因此字符串兜底并没有形成可用的兼容路径。
- 建议：内部参数统一命名为 operation，直接访问 operation.rpcIdentity；删除双类型适配，保留 generation 和当前连接身份检查。
- 收益：避免大量名为 rpcIdentity 的参数实际传递上下文对象，降低阅读和维护成本。

## C4：单次执行锁维护了两份相同状态——适合小步重构

- 位置：`ariaNgBtFileFilterService.js:354`、`:831`、`:1484`、`:1532`、`:2044`、`:2191`。
- 全部赋值点都同时设置或清空 `tickInProgress` 与 `activeOperation`；前者仅用于判断是否已有操作，后者已能表达同一信息。
- 建议：以 `activeOperation !== null` 表示忙碌，删除额外布尔状态及成对赋值。
- 风险：这里是调度入口，必须保留 finishTick/finishBulkTick 对操作对象身份的比较，并跑 stop/restart、迟到回调和自动/批量公平调度回归。不能只留下布尔锁、删除上下文对象。

## C5：新建任务页的动态标签系统没有动态行为——明显过度设计

- 位置：`src/scripts/controllers/new.js:5`、`:18`、`:30`。
- 标签只有 links、options，show 始终为 true；唯一修改 show 的 `setTabItemShow()` 在全仓没有调用。
- 建议：删除 setter，将标签表示为固定字符串数组；左右滑动直接使用该数组，无需每次构造“可见标签”数组。
- 风险低；保留滑动切换到 options 时现有的配置加载行为。

## C6：几处条件和计数可以直接消去——低风险零碎清理

- `src/scripts/controllers/list.js:165`：先遍历 stageMap 得到 hasAny，随后仍逐任务调用 hasOwnProperty。直接进行后者即可；空映射仍需遍历任务以清掉旧徽标，不能加“空映射直接返回”。
- `ariaNgBtFileFilterService.js:440`、`:450`、`:474`：realFileCount 每次与 allIndexes.push 同步增加，等于 allIndexes.length；可以去掉独立计数器。`:514` 的 mode === 'filter' 又已保证存在有效文件，因此 realFileCount > 0 也是冗余条件。
- `ariaNgBtFileFilterService.js:2223`：函数开头已经在没有 pollingPromise 时返回，随后 `pollingPromise ? findBulkProgress(...) : null` 的三元判断多余。
- 建议：作为确定等价的局部清理处理，不为这些小片段引入新的通用工具层。

## C7：语言缓存为单一用途实现了通用路径树——可选简化

- 位置：`src/scripts/services/ariaNgAssetsCacheService.js:5`。
- getAsset/setAsset 支持点分路径、多层对象和逐级遍历；实际私有调用只有 `languages.<languageName>`。
- 建议：内部用按语言名索引的字典即可，保留 getLanguageAsset/setLanguageAsset 的 provider 和 service 接口。
- 优先级低：现状本身不是已确认的功能缺陷。实施时检查普通构建和 All-In-One 构建中的语言加载；不要误删整个 provider，bundle 在配置阶段注入语言资源仍需要它。

## C8：未使用的构建依赖——可删除候选

- 位置：`package.json:59` 的 gulp-sourcemaps。
- 全仓调用检索没有 sourcemaps.init/write 或该模块的直接调用；gulpfile 中处理 sourceMappingURL 的代码只是移除已有注释，并不使用此插件。
- 建议：移除直接依赖并同步 lockfile，按依赖变更运行测试和两种构建。
- 不要顺手删除 html-minifier：`test/task-list-file-list.test.js` 直接依赖它验证模板压缩。

## 看似繁琐但应保留的设计

1. **生命周期 generation、操作对象身份和异步边界检查。** 防止停止、重新启动或切换连接后旧回调继续修改状态；同步调用链内部的重复判断可逐处评估，但不能整片移除。
2. **pauseOwned、原始选择快照和读回稳定窗口。** 用于保持用户暂停意图、失败恢复和确认 RPC 修改实际生效。仅收到 OK 不能替代现有读回确认。
3. **批量任务定义与进度分开持久化，以及落盘失败处理。** 避免每个 tick 重写完整 GID 队列，也保证恢复时使用已提交进度。已有千任务队列与失败恢复测试。
4. **下载列表的请求序号、模式代次和超时恢复。** 分别应对响应乱序、视图模式切换及丢失响应，不是三份重复锁。
5. **批量预览与 payload 判断中部分重复的条件。** 预览刻意保持一次文件扫描；不能为了复用 isActiveBtPayloadTask 而引入第二次大文件列表扫描。已有十万文件的访问次数回归。
6. **存储边界清洗、RPC 返回值检查及设置迁移。** 输入来自持久化数据或服务端，不能按内部确定类型的局部变量处理。异常处理也不能只因少见就删除。

BT 服务 2,272 行，确实值得减负，但不建议为清理它再搭一套通用状态机框架。优先删掉已证明多余的路径和状态，再考虑拆出纯文件选择计算、持久化转换等边界清晰的部分；自动过滤与批量过滤的业务差异应继续明确表达。

## 本轮验证与边界

- `npm test`：全部通过，包括文件列表、发布约束、WebSocket、审计回归、BT 过滤、徽标和开发期翻译约束。
- ESLint：直接通过本地 CLIEngine 执行真实检查，416 errors / 10 warnings；没有将当前 gulp lint 的空检查记作通过。
- lint 流水线问题已用内存文件探针复现；其余清理点基于源码控制流、全仓引用和现有测试契约分析，尚未应用删除后验证。
- 未运行构建、浏览器或真实 aria2 集成：本轮没有应用代码变更，不声称重构已通过验收。
- 建议顺序：C0 单独修正检查流程与规则基线；C1/C2/C5/C6 清理确定冗余；C3/C4 小步收窄状态；C7/C8 视后续维护安排处理。
