# 代码清理与检查流程修正 Spec

> 状态：已实施并通过本 spec 验收（2026-09-18）
> 日期：2026-09-18
> 基线：`862a3e2` / AriaNg 2.2.2
> 来源：[代码清理审查](../audits/2026-09-18-cleanup-review.md)
> 约束：[AGENTS.md](../../AGENTS.md)、[BT 维护指南](../../.claude/skills/bt-filter-dev/SKILL.md)

## 1. 目标与完成定义

修复当前不实际执行 ESLint 的检查任务，删除已经确认无效的分支、重复状态、闲置抽象和依赖。除检查流程开始正确报告错误外，下载、过滤、恢复、语言加载和页面交互均保持现有行为。

本 spec 覆盖审查项 C0—C8，分四批实施。每批可以独立交付；全部完成必须覆盖所有条目并通过对应验收。仅删除部分代码或仅补上 ESLint 调用，不代表整项修正完成。

不以删除行数或拆分文件数量作为验收指标。每次删除必须能说明原代码为何没有额外作用；每次保留必须能对应输入边界、异步边界或已有业务约束。

## 2. 范围

| 批次 | 审查项 | 目标文件或范围 | 交付结果 |
| --- | --- | --- | --- |
| A：恢复检查 | C0 | `gulpfile.js`、`.eslintrc.json`、必要的源码修正、lint 回归测试及 npm test 注册 | lint 真正执行、错误会失败、源码不会被检查任务改写 |
| B：删除确定冗余 | C1、C2、C5、C6 | BT 服务、`controllers/new.js`、`controllers/list.js`、相关行为测试 | 删除死分支、无效判断、固定标签的动态管理逻辑 |
| C：收窄内部状态 | C3、C4 | BT 服务及生命周期回归 | 统一操作上下文类型、只维护一份执行锁 |
| D：收缩外围实现 | C7、C8 | 语言缓存、`package.json`、`package-lock.json`、必要测试 | 保留语言接口并简化存储，移除未使用的 gulp-sourcemaps 直接依赖 |

源码修正范围以清单为准。批次 A 因真实 lint 首次运行而需要触及其他源码时，只做规则适配和行为等价修正；独立业务问题单独记录，不能借清理顺手改变行为。

本次不做以下工作：

- 更换 AngularJS、Gulp、ESLint 或升级其他依赖。
- 引入通用状态机框架、任务基类、通用事务或新的队列协议。
- 合并自动过滤与批量过滤状态机，或重新设计 RPC 返回结构。
- 删除现有恢复、持久化、设置迁移、WebSocket 重连和列表超时机制。
- 改 UI 样式、翻译文案、发布版本、标签或线上部署。
- 清理历史审计文档、用户文件、其他分支、worktree 或已有预览。

## 3. 必须保持的行为

### 3.1 BT 过滤与恢复

1. 文件索引保持从 1 开始；文件选择计划保留当前过滤阈值和部分选择语义。
2. `bt-remove-unselected-file` 的完成时删除语义不变；恢复使用原始选项和原始选择快照。
3. `changeOption` 返回 OK 不等于完成，仍需后续状态和选项读回满足现有稳定窗口。
4. 只恢复协调器拥有的暂停；用户暂停保持暂停。新建任务“立即下载／稍后下载”意图不变。
5. 元数据子任务恢复继续覆盖 waiting/paused 和 active，保留 InfoHash 恢复约束。
6. 同一时刻最多有一条自动或批量 RPC 操作链；两者同时存在时保持当前交替调度。
7. stop 之后的旧回调不能推进状态、继续业务 RPC，或清除 restart 后新操作的锁。
8. 持久化格式、字段含义、storage key 和恢复白名单不变；不新增迁移协议。
9. 批量定义与进度继续分开保存，保持写入失败处理、原始选择快照和恢复重试限制。

### 3.2 对外接口和 UI

- BT 服务公开方法的参数、返回结构和状态对象引用语义不变。
- `planExistingTaskFiles()` 的 `realFileCount` 字段仍返回原有值；只删除内部重复计数器。
- 自动过滤 root/child 和当前批量任务的徽标映射不变。stop 后映射为空时，列表仍清除已有徽标。
- 文件列表的请求序号、模式代次、完成后刷新和超时机制保持原样。
- 新建任务左右滑动顺序仍为 links、options；切换到 options 仍调用现有配置加载逻辑。
- 批量预览保持单次文件扫描，不为复用 payload 判定而新增第二次扫描。
- 语言缓存的 provider/service 接口、缺失返回值和普通版／All-In-One 加载方式不变。

## 4. 详细修正要求

### A1. 让 lint 真正执行（C0）

在当前 Gulp lint 流中，依次执行检查器、输出结果和失败判定：

```text
读取 src/scripts/**/*.js → eslint() → eslint.format() → failAfterError()
```

- 删除 lint 任务中的 `gulp.dest('src/scripts')`；lint 是只读检查，不承担自动修复。
- lint 不需要触发 BrowserSync reload；源文件 watch 继续负责开发预览更新。
- 显式调用 `gulp lint` 时，错误始终导致非零退出，包括 BrowserSync 已活动的情况。
- 保留标准构建和 bundle 构建对 lint 的依赖。Pages 和 release 继续通过构建进入同一检查流程，不另建一套配置。
- 不把失败吞掉，不使用全局忽略源码、空 glob、只格式化结果等方式恢复“绿色”。

### A2. 建立符合现有项目的 lint 规则基线

审查时真实检查得到 416 errors / 10 warnings。该数字仅为历史证据，不写成测试断言，也不作为允许错误的预算。

采用以下处理规则：

| 诊断类型 | 处理要求 |
| --- | --- |
| 推动架构或写法迁移的 Angular 规则 | 保留现有 `$scope`、数组注入、既有 DOM/JSON/类型判断写法；对冲突规则逐项显式配置，附简短依据，不为 lint 改造应用架构 |
| 浏览器预加载的真实全局变量 | 根据 `src/index.html` 及依赖加载确认后，声明只读全局；当前候选为 `$`、`angularDragula`、`echarts` |
| 未使用的私有函数、变量 | 确认全仓引用后删除；动态标签 setter 属于本 spec 已确认项 |
| 必须占位的事件／回调参数 | 保持调用约定；无必要参数可删，必须占位者使用明确、窄范围的规则处理 |
| 缺分号、引号、缩进、重复声明、无用转义 | 做局部且行为等价的修正；避免改动无关文件的格式 |
| 常量条件和其他可能涉及行为的诊断 | 单独检查控制流，优先等价修正；有实际理由的局部例外需说明，不能全局关闭核心规则掩盖问题 |

`eslint:recommended` 和仓库明确规定的四空格、LF、单引号、分号规则继续生效。不能全局关闭 no-undef、no-unused-vars、no-unreachable 等核心规则来绕过问题，也不新增自定义 lint 债务基线引擎。

批次 A 完成时，选定配置下源码必须零 error。既有 warning 逐项说明；不得把未处理 error 批量降级为 warning。PR 或实施记录需列出调整的规则及原因。

### B1. 删除批量过滤的死分支（C1）

先按实现时的代码核实下列调用关系，行号不作为删除依据：

```text
processBulkTick
  inspecting → getTaskOptions → inspectBulkTaskAfterOptions → applyBulkInspection
  其他阶段   → getTaskStatus → processBulkTaskResponse → 对应阶段处理
```

- `processBulkTaskResponse()` 不再保留 inspecting 入口判断；移除相应恒真的 `stage !== 'inspecting'` 条件。
- 在 `isBtPayloadTask()` 已通过后，删除对 bittorrent/info/有效文件非空的重复校验。
- resuming、pausing、applying、restoring 均已有返回路径，删除合法阶段之外的尾部重复调用。
- `inspectBulkOptions()` 的调用者仅来自非 inspecting 阶段时，删除其回退到 `applyBulkInspection()` 的旧入口和仅用于该入口的包装判断。
- 不删阶段白名单和存储边界清洗；不增加“未知阶段也尝试执行”的新容错。
- 若实施时发现基线外的新调用者能到达这些分支，应保留有真实入口的分支并更新说明，不能机械照行号删除。

### B2. 简化结果相同的回调（C2）

`requestBulkPause()`、`requestBulkResume()` 的 RPC 回调各只保留 `finishBulkTick(operation)`。

删除的仅是这两个“条件两边完全相同”的判断。其他会修改任务、保存数据或继续发起 RPC 的回调仍保留生命周期校验。`finishBulkTick()` 内的对象身份检查不能删除。

### B3. 固定标签与局部冗余（C5、C6）

- 新建任务页使用固定标签顺序数组 `['links', 'options']`；删除 `setTabItemShow()`、show 标志和动态可见列表生成器。
- 左右滑动继续通过现有 `changeTab()` 执行，边界返回值保持不变。
- `decorateBtFilterStage()` 去掉 hasAny 预扫描，逐任务做自有键判断；映射为空仍执行旧徽标清理。
- `planExistingTaskFiles()` 删除 realFileCount 局部变量，以 allIndexes.length 填充同名返回字段；预览只需判断 mode 是否为 filter。
- `buildPendingGidStageMap()` 保留开头的停止判断，随后直接查询批量进度，删除重复的 pollingPromise 三元判断。

### C1. 统一操作上下文（C3）

- tick 继续创建 `{rpcIdentity, generation}` 对象，沿异步链传递同一对象。
- 实际接收该对象的内部参数统一命名为 operation；仍接收身份字符串的查询和持久化函数继续叫 rpcIdentity。
- 删除 `getOperationRpcIdentity()` 的双类型适配，内部在有效上下文处直接使用 operation.rpcIdentity。
- 保留 operation generation、当前连接身份和记录成员关系检查。
- 不为此改公开 API，也不新增 Operation 类、builder 或多种兼容入参。

### C2. 单一执行锁（C4）

- 以 activeOperation 为唯一忙碌状态：null 为空闲，对象为正在执行。
- 删除 tickInProgress 的声明、读写及成对维护代码。
- tick 在 activeOperation 非空时直接返回；发起异步链之前先设置对象。
- finishTick/finishBulkTick 只有收到的 operation 与 activeOperation 为同一对象时才能清空。
- completeBulkRun 的直接收尾及 stop 都必须纳入修改；不能遗漏非通用 finish 函数中的释放路径。
- lifecycleGeneration 继续在现有生命周期边界变化；不能以 rpcIdentity 字符串相等替代操作对象身份。
- 不借本项合并自动与批量的状态更新函数，也不新增超时锁机制。

### D1. 简化语言缓存（C7）

- 用按 languageName 索引的字典代替点分路径树；优先使用无原型字典，避免继承键参与查询。
- 删除 getAsset/setAsset 和 languages 路径前缀的通用解析逻辑。
- 保留 provider 的 getLanguageAsset/setLanguageAsset，以及运行期 service 的 getLanguageAsset。
- 保持缺失语言返回 null、读取已写入内容原样返回、同语言再次写入覆盖旧值的行为。
- 不改语言名、生成的 bundle 注入接口、网络加载路径或语言资源文本。

### D2. 移除未用构建依赖（C8）

- 再次确认无实际 sourcemaps 插件调用后，移除 gulp-sourcemaps 直接 devDependency，并同步 lockfile。
- 保留源码映射注释移除逻辑，它不依赖此插件。
- 保留测试直接使用的 html-minifier；不顺带执行 npm update 或升级传递依赖。
- 若其他依赖仍需 sourcemaps 相关传递包，可以继续出现在 lockfile；验收不要求整个依赖树完全没有同名相关包。

## 5. 测试与验收

### 5.1 行为场景

优先复用现有回归；缺失场景才增加测试。不以匹配函数名称、固定源码行数或断言“没有某段文本”替代行为验证。

| 范围 | 必须验证的结果 | 现有测试入口／补充方向 |
| --- | --- | --- |
| lint 门禁 | 有效代码通过；无效代码非零退出；检查前后文件内容一致 | 增加隔离临时工作目录中的 Gulp lint 集成探针，并注册进 npm test；必须走真实任务，不能复制一个正确管道自证 |
| inspecting 分流 | 选项读取期间任务变为暂停或被自动队列接管后，不错误提交过滤 | `test/new-task-small-file-filter.test.js` |
| 状态收敛 | OK 但选择未变不能记为完成；恢复仍等待读回 | 同上，自动与批量两条路径 |
| 旧回调 | stop → restart → 新链开始 → 旧暂停/恢复回调返回，新锁仍在且旧业务不继续 | 同上，必要时补暂停和恢复回调的行为场景 |
| 公平调度 | 自动与批量都待处理时，各自继续推进且不重叠发链 | 同上 |
| 用户暂停和 reload | 用户暂停不被擅自恢复；自有暂停按现有流程恢复；快照不丢失 | 同上 |
| 持久化失败 | 未落盘不能错误宣布完成或失去恢复进度 | 同上，沿用现有失败路径回归 |
| 大文件预览 | 十万文件预览保持现有单次文件扫描约束 | 同上，已有访问次数回归 |
| 徽标 | stop 后已有徽标清除；root/child 与批量当前 GID 映射正确 | `test/bt-filter-pending-badge.test.js`、`test/task-list-file-list.test.js` |
| 标签滑动 | links/options 正反向切换、边界返回值及 options 加载行为正确 | 新建任务现有 harness；只补缺少的交互验证 |
| 语言缓存 | 缺失、读写和覆盖行为正确；provider 注入可由运行期 service 读取 | 聚焦缓存契约的轻量测试及两种构建验证 |

### 5.2 每批检查

| 批次 | 完成检查 |
| --- | --- |
| A | lint 正反探针、真实 lint、npm test、标准构建和 bundle 构建 |
| B | 相关聚焦回归、npm test、两种构建；实际预览验证标签滑动、过滤徽标及 stop 后清除 |
| C | 生命周期、迟到回调、公平调度及恢复回归；npm test、两种构建、选定的 RPC 模拟集成场景 |
| D | lockfile 更新后 npm ci、npm test、两种构建；普通版与 All-In-One 的语言加载和切换 |

最终构建顺序：

```sh
npm test
npx gulp clean build
npx gulp clean build-bundle
git diff --check
```

两种构建共享输出目录，必须串行执行。标准版验证或取证完成后再清理并构建 bundle。构建已经包含修正后的 lint，无需对同一源码状态重复执行最终 lint。

### 5.3 浏览器和产物验证

- 新建任务页验证左右滑动和 options 加载。因触及触摸交互，至少覆盖 375px 的 light/dark 视图；不改布局也应确认无交互回归。
- 下载列表显示一次实际的自动／批量处理中徽标，并在 stop 后确认清除。可使用隔离 RPC mock，无需操作个人下载。
- 普通版验证英文、简体中文及一种其他语言的加载和切换。
- All-In-One 验证注入语言内容生效，并在离线条件下确认选取的语言切换不依赖外部语言文件请求。
- 不改变 RPC 方法或时序协议；本次可使用隔离 mock 验证重构等价性。若实施扩展为协议／时序改变，追加相应真实 aria2 验证，并明确未覆盖环境。
- 标准版和 bundle 均不得缺资源或引入新的外部字体引用。未修改发布版本和文案，不触发本次之外的发布流程。

已有通过结果对相同源码／配置状态继续有效。文档和证据补充不触发重复构建；后续修改影响哪些输出，就补哪些验证。不能把审查基线的通过结果当成删除后的验收结果。

## 6. 实施顺序与回退

1. **先完成 A。** 保证后续清理接受真正的检查；不能提交一个补了 eslint() 但所有构建都失败的“完成版本”。
2. **实施 B。** 先做可证明等价的删除，保留业务边界，并核对调用链没有变化。
3. **实施 C。** 操作上下文命名收窄和单一锁可分两个小改动；每一步验证相关生命周期场景。
4. **实施 D。** 缓存与依赖分别检查，最后执行覆盖最终源码状态的剩余验收。

建议按批次形成可独立审查的改动；是否 commit/push 由实际实施任务授权决定，本 spec 不自动要求发布或提交。

出现行为回归时，回退对应批次的代码并保留能复现问题的测试。持久化格式不变，因此不需要回滚数据迁移。不以清理工作区为由删除用户改动、分支或已有预览。

## 7. 交付清单

- [x] C0 的 lint 检查实际生效，规则调整有依据，源码零 error。
- [x] C1—C6 已完成，内部精简没有改变公开接口、持久化格式或业务行为。
- [x] C7 的语言缓存简化完成，两种产物加载验证通过。
- [x] C8 的直接依赖和 lockfile 同步，npm ci 可复现安装。
- [x] 相关失败路径、npm test、两种构建及选定 UI／集成场景完成。
- [x] 每个审查项有实施结果映射，记录实际命令、结果和未验证环境。
- [x] 未实施或被环境阻塞的部分明确列出，不笼统标记“全部通过”。

实施结果与验证边界见[执行记录](../audits/2026-09-18-cleanup-implementation.md)。本轮完成本地实现和验收，未提交、推送或发布。
