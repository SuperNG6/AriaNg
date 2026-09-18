# 清理 Spec 执行记录

日期：2026-09-18。依据：[修正 Spec](../prd/code-cleanup-spec.md)。审查基线：`862a3e2`。

本地实施和本 spec 要求的验收已完成。没有 commit、push、发布、修改个人 aria2 任务或升级其他依赖。

## 审查项落实

| 项目 | 实施结果 | 验证依据 |
| --- | --- | --- |
| C0 | Gulp 执行真实 ESLint，始终按 error 失败；删除 reload 和源码回写 | lint 隔离测试覆盖有效／无效源码、BrowserSync active/inactive、文件内容和修改时间不变；两种构建均真实 lint 通过 |
| C1 | 删除批量 inspecting 旧入口、重复 payload 校验和不可达尾部分支 | BT 全套回归；异步检查期间被暂停或被自动任务接管的场景保持通过 |
| C2 | 暂停／恢复回调仅调用 finishBulkTick，保留其操作身份校验 | 新增两个迟到回调场景：旧回调不能解锁 restart 后的新链 |
| C3 | 操作链参数统一为 operation，移除字符串／对象兼容函数 | 保留 generation、RPC 身份与记录成员关系校验；停止、切换和恢复回归通过 |
| C4 | activeOperation 成为唯一执行锁，删除 tickInProgress | 单链调度、公平调度、stop/restart 和迟到回调回归通过 |
| C5 | 固定 links/options 标签数组，删除动态 show 系统 | 新增边界和只加载一次选项的回归；375px 明暗主题实际触摸滑动通过 |
| C6 | 删除徽标 hasAny 预扫描、独立文件计数器和重复 pollingPromise 判断 | 保留 realFileCount 返回字段；空映射仍清除徽标；十万文件单次扫描测试通过 |
| C7 | 语言缓存改为无原型字典，保留 provider/service 接口 | 缓存读写契约测试；标准版加载和 bundle 离线切换通过 |
| C8 | 删除 gulp-sourcemaps 直接依赖及无用锁文件条目 | npm ci 成功；lockfile 比较仅删除 23 个包条目，其余包记录未变；两种构建通过 |

BT 服务从 2,272 行变为 2,231 行，语言缓存从 56 行变为 26 行，新建任务控制器从 347 行变为 315 行。行数仅记录改动规模，不作为性能结论。

效率方面，删除了批量任务检查中的一次重复文件列表遍历／数组构造、新建任务每次滑动的标签数组构造和徽标映射的预扫描；没有引入额外的抽象层或持久化协议。未做端到端性能基准，不宣称固定比例的速度提升。

## ESLint 规则处理

保留 `eslint:recommended`、四空格、LF、单引号、分号及核心错误检查。最终源码 **0 error / 0 warning**。控制台仍有旧 Angular ESLint 插件的 service-name 规则弃用提示，它不属于源码诊断。

| 调整 | 原因 |
| --- | --- |
| angular/di 改为 array | 项目本来使用数组注入；继续验证注入名称与函数参数匹配，保留压缩安全性 |
| 关闭 controller-as、controller-as-route | 项目使用 `$scope`，本次不迁移控制器架构 |
| 关闭 angularelement、document-service、window-service | 保留现有 jQuery/DOM 和浏览器 API 访问方式，避免只为风格规则重写调用链 |
| 关闭 definedundefined、json-functions、typecheck-array/number/object/string | 保留原生类型判断与 JSON 语义，不强制替换成 Angular 包装方法 |
| indent 增加 SwitchCase: 1 | 保持现有 switch 分支缩进，减少无关格式变动 |
| angular、$、angularDragula、echarts 声明为只读全局 | 与实际预加载脚本一致；没有关闭 no-undef |
| 仅 core/root.js 关闭 on-watch | 这里的监听属于应用级生命周期；其他文件继续检查 |
| aria2TaskService 单行 no-constant-condition 例外 | 原有 piece 统计循环内部有退出条件；保留原算法，避免将 lint 修复扩展成统计逻辑重写 |

其他修正仅涉及未使用参数／局部变量、重复 var 声明、无用转义、分号和少量格式。没有把旧错误批量降级为 warning，也没有引入错误数量预算。

### 基于实际代码增加的生命周期修正

真实 lint 暴露状态页在 `$rootScope` 注册了没有释放的 `$watch`。这一项没有直接禁用规则，而是将观察者改为页面 `$scope.$watch`；被观察的 taskContext 仍从根作用域继承，但页面销毁会自动释放监听。

浏览器使用真实 AngularJS 实例创建状态页控制器、触发 digest 后销毁页面 scope，确认 watcher 数量先增加 1、再恢复原值，且连接状态读取正常。这是 C0 过程中发现并处理的小范围生命周期问题，不涉及 RPC 协议改动。

## 验证结果

环境：macOS，Node v22.21.1、npm 10.9.4，隔离 headless Chrome。未验证 Node 24 CI 环境；本地 Node 满足 package.json 的版本范围。

| 检查 | 结果／证据 |
| --- | --- |
| npm ci --no-audit --no-fund | 成功安装 1,159 个包；[安装输出](2026-09-18-cleanup-evidence/install.txt) |
| npm test | 全部通过；BT 主套件 137 项，包括新增标签和两个迟到回调场景；[测试输出](2026-09-18-cleanup-evidence/tests.txt) |
| npx gulp clean build | 通过，包含真实 lint；[标准构建输出](2026-09-18-cleanup-evidence/standard-build.txt) |
| 标准产物引用检查 | 10 个脚本／样式引用、12 个字体引用均有对应本地文件 |
| npx gulp clean build-bundle | 通过，包含真实 lint；[bundle 输出](2026-09-18-cleanup-evidence/bundle-build.txt) |
| bundle 嵌入检查 | 无外部脚本、样式或相对字体引用，包含全部 10 个语言资源 |
| 标准版浏览器 | 两个主题的标签滑动、选项缓存、scope 释放、root/child/批量徽标与 stop 清除、3 种语言切换通过；[结构化结果](2026-09-18-cleanup-evidence/standard-report.json) |
| bundle 浏览器 | 同样的交互通过；断网后 en/zh_Hans/fr_FR 切换正常，未请求语言文件；[结构化结果](2026-09-18-cleanup-evidence/bundle-report.json) |
| 错误与布局 | 两种产物均未发现浏览器脚本／Angular 错误；375px 标签页面无横向溢出；截图人工检查未见新遮挡或裁切 |
| git diff --check | 通过；新增文档和测试也单独检查空白格式 |

安装首次在受限缓存写入环境下失败，随后使用批准的缓存／网络访问完成 npm ci。没有执行 npm 建议的 sudo chown，也没有改变用户缓存所有权。安装产生旧依赖的弃用及 engine 提示，本次保持原有依赖版本，不将其表述为依赖安全审计通过。

两种构建串行执行；完成标准产物验收后才 clean/build-bundle。目前 dist 保留 bundle 产物，属于生成内容，不纳入提交。实现中先跑聚焦回归，再在最终源码状态跑全套及两种构建；之后只更新文档／证据，没有无意义重复构建。

## 浏览器证据与重跑

- [375px 浅色选项页](2026-09-18-cleanup-evidence/bundle-light-375-options.png)
- [375px 深色选项页](2026-09-18-cleanup-evidence/bundle-dark-375-options.png)
- [375px 浅色过滤徽标](2026-09-18-cleanup-evidence/bundle-light-375-badges.png)
- [375px 深色过滤徽标](2026-09-18-cleanup-evidence/bundle-dark-375-badges.png)

保留[手动浏览器验收脚本](2026-09-18-cleanup-browser.cjs)。它读取当前 dist，使用新的浏览器上下文、模拟下载数据和本机随机端口；全部 RPC 被拦截为 mock，其他外部请求被拒绝。参数为 standard 或 bundle，需与当前构建匹配。

脚本使用环境已提供的 Playwright，不增加应用依赖。通过 `ARIANG_PLAYWRIGHT_MODULE` 指定可解析的模块名或绝对模块路径；必要时以 `ARIANG_BROWSER_EXECUTABLE` 指定浏览器可执行文件，再执行：

```sh
node docs/audits/2026-09-18-cleanup-browser.cjs standard
# 在完成标准版验收并构建 bundle 后：
node docs/audits/2026-09-18-cleanup-browser.cjs bundle
```

早期标准版截图使用很小的合成阈值；最终保留的 bundle 截图使用正常的 100 MB 阈值。浏览器脚本首次使用未注册的 fr 标识而失败后，已按项目配置改成 fr_FR 并重新通过，两种语言验收结果均以成功重跑为准。

## 验证边界

本轮验证的是重构前后行为保持一致，采用已有失败路径回归和隔离 RPC 模拟。没有操作真实 aria2，不能据此宣称真实服务的暂停／重启收敛或网络条件已重新验证。RPC 协议和持久化格式未改变，因此这符合本 spec 的验收范围。

没有改翻译或准备发布，因此未重复执行发布期全语种门禁或发布任务。个人任务、外部服务和用户原有预览未受影响。
