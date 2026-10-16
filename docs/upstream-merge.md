# 上游合并与验收

## 当前基线

| 项目 | 当前值 |
| --- | --- |
| 上游 | `https://github.com/mayswind/AriaNg.git`，远端名 `upstream` |
| 已合并的上游版本 | `1.3.15` |
| 上游提交 | `56d44dc9e822a6f59aae13a542a0cab6cf292d30` |
| 本地上游标签 | `upstream-1.3.15` |
| 本地合并提交 | `143e252` |

每次合并后更新此表。合并提交一项记录最近一次上游合并，不随普通维护提交更新。

本仓库另有历史标签 `1.3.15`，指向本分支的旧提交；它不是上述上游基线。上游标签统一保存为 `upstream-<版本>`，不要强制覆盖已有标签。

## 冲突处理约定

| 范围 | 需要保留的行为 |
| --- | --- |
| `package.json`、`package-lock.json` | 保留本分支版本系列、测试命令和锁文件格式。正常合并不把分支版本降为上游版本；确有上游依赖变更时同步更新依赖及锁文件。 |
| `.github/workflows/release.yml` | 本分支发布入口，保留版本、翻译、归档和已有标签保护。上游 `build-release.yml` 仅在 `mayswind/AriaNg` 运行，避免两个工作流争用同一发布。 |
| `aria2RpcService`、`aria2TaskService`、`controllers/new.js` | 批量结果保留每项的 `success`、`data`、`context.task` 和输入顺序。部分失败只将成功的元数据任务加入过滤队列；全部失败不能跳转为提交成功。 |
| `ariaNgSettingService`、`aria2SettingService`、`directives/setting.js` | 保留连接配置快照、按 RPC 身份隔离路径历史、旧历史回退，以及异步提交绑定原连接的行为。1.3.15 合并沿用本分支的历史存储方案，而非再迁移一套存储。 |
| BT 过滤及任务文件列表 | 保留本分支功能；按 [BT 维护指南](../.claude/skills/bt-filter-dev/SKILL.md) 检查受影响契约。 |
| `README.md` | 保留本分支介绍、仓库及发布链接；同步适用的上游说明。 |

以上是行为约定，不是整文件保留本地的规则。逐段检查上游变化，不能用自动 `ours` 策略掩盖业务冲突。准备新发布时再按 [AGENTS.md](../AGENTS.md) 同步分支版本及发布资料。

## 合并步骤

先检查本地改动并保护用户已有工作。以下用未来版本 `1.3.16` 举例，执行时替换为目标版本：

```sh
git status --short
git fetch --no-tags upstream refs/tags/1.3.16:refs/tags/upstream-1.3.16
git show -s upstream-1.3.16
git log --oneline HEAD..upstream-1.3.16
git diff --stat HEAD...upstream-1.3.16
git merge --no-ff --no-commit upstream-1.3.16
```

解决文本冲突后，检查自动合并的业务交界处。尤其检查批量 RPC 的返回值与调用方、设置身份与持久化，以及新增工作流是否重复触发发布。

```sh
npm test
npm run test:browser
git diff --check
git diff --cached --check
git diff --name-only --diff-filter=U
```

最后一条应无输出。浏览器命令已按顺序执行两种 clean/build，包含 lint，无需再重复构建。按改动风险补充真实 aria2 集成；本地模拟验收不代表真实 aria2 或远端 GitHub Actions 已通过。记录结论、更新基线后完成合并提交，再用 `git merge-base --is-ancestor upstream-1.3.16 HEAD` 确认上游已纳入历史。

## 回归测试与浏览器工具

`npm test` 包含 [跨模块回归](../test/new-task-rpc-integration.test.js)。该套件使用真实新建任务控制器、任务服务、RPC 服务和过滤队列，只替换传输、存储、计时器及界面环境，覆盖混合任务部分失败、立即／稍后下载、延迟返回时的意图快照、关闭过滤、全部失败及传输错误。队列内容和持久化数据都要符合预期。

[浏览器脚本](../test/browser/upstream-merge.cjs) 使用 Playwright Chromium。浏览器工具独立安装，不改应用依赖和锁文件。例如：

```sh
npm install --prefix /tmp/ariang-browser-tools --no-package-lock playwright@1.62.1
/tmp/ariang-browser-tools/node_modules/.bin/playwright install chromium
export ARIANG_PLAYWRIGHT_MODULE=/tmp/ariang-browser-tools/node_modules/playwright
npm run test:browser
```

已有 Playwright 时将 `ARIANG_PLAYWRIGHT_MODULE` 指向它的模块目录；若项目自身可解析 `playwright`，可以省略该变量。已有 Chrome/Chromium 时也可用 `ARIANG_BROWSER_EXECUTABLE` 指定浏览器可执行文件，省去 Chromium 下载。浏览器工具需使用其支持的 Node.js 版本，推荐与 CI 一致的 Node.js 24。

`npm run test:browser` 顺序构建并检查标准版、All-In-One 版；运行后 `dist/` 是单文件版。两次构建会清理 `.tmp/` 和 `dist/`，运行前先确认没有需要保留的构建预览。单独检查已有构建可执行：

```sh
node test/browser/upstream-merge.cjs standard
# 或在已构建 All-In-One 后：
node test/browser/upstream-merge.cjs bundle
```

脚本检查构建结构，使用独立浏览器上下文、临时本地静态服务器和拦截的模拟 RPC，退出时关闭自身浏览器与服务器。它覆盖：

- 375px 明暗主题的新建任务与列表、横向溢出、触屏切换和选项只加载一次。
- 经真实浏览器传输的批量 RPC 结果，以及 MiB 容量单位。
- 当前 RPC 路径历史优先于其他连接和旧全局历史。
- 自动任务根／子 GID 与批量过滤徽章，以及停止后徽章清除。
- 中、法、英语言切换，单文件版离线切换且不请求语言文件。

截图与 JSON 报告写入 `test-results/upstream-merge/`，已由 Git 忽略，两种构建的报告互不覆盖。脚本断言或页面运行错误会令命令失败；截图仍需人工检查。脚本不连接个人 RPC，不操作真实下载。
