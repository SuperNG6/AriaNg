# GitHub Actions 1.3.15 构建发版设计

## 1. 文档信息

- 产品：AriaNg
- 功能：GitHub Actions 自动构建与 GitHub Release 发布
- 目标版本：`1.3.15`
- 文档日期：2026-07-11
- 状态：已确认，待实施

## 2. 背景

项目当前使用 CircleCI 构建并维护 Daily Build，但仓库没有用于正式 GitHub Release 的 Actions 工作流。历史正式版本使用无 `v` 前缀的标签，例如 `1.3.14`，并发布两个 ZIP：标准多文件版和 All-In-One 单页版。

本次在文件列表扩展完成并验证后，把项目版本提升到 `1.3.15`，增加一个既支持标签推送、也支持从 GitHub Actions 页面手动运行的正式发布工作流。手动运行时，工作流在用户所选分支的当前提交上创建缺失标签并发布。

## 3. 目标

- 版本号统一提升为 `1.3.15`。
- 标签 `1.3.15` 推送后自动构建并发布。
- 支持 `workflow_dispatch`；手动输入版本并选择分支后，在该提交创建标签和 Release。
- 同时生成与历史发布结构兼容的标准版和 All-In-One ZIP。
- 使用 GitHub 自动生成的 Release Notes。
- 发布前验证版本、构建结果和压缩包内容；已有标签或 Release 不被覆盖。
- 只依赖 GitHub 官方 Actions 和 GitHub CLI，不引入第三方 Release Action。

## 4. 非目标

- 不删除或改写现有 CircleCI Daily Build。
- 不自动修改源码版本或自动提交版本变更；`1.3.15` 版本号由本次代码变更显式提交。
- 不发布 npm 包、Docker 镜像、签名文件或校验和资产。
- 不创建草稿版或预发布版。
- 不在本地实现阶段直接创建远程标签或 Release；正式发布由工作流触发。
- 不支持覆盖、替换或删除已存在的同名标签和 Release。

## 5. 工作流文件与触发方式

新增 `.github/workflows/release.yml`，工作流名称为 `Build and Release`。

### 5.1 标签触发

```yaml
on:
  push:
    tags:
      - '*.*.*'
```

GitHub glob 只负责缩小触发范围，作业内仍严格验证标签符合 `^[0-9]+\.[0-9]+\.[0-9]+$`。标签名直接作为版本号，不接受 `v1.3.15`。

### 5.2 手动触发

`workflow_dispatch` 提供一个必填字符串输入 `version`，默认值为 `1.3.15`。用户在 GitHub Actions 页面原生的分支选择器中选择目标分支；工作流以该次运行的 `GITHUB_SHA` 为标签和 Release 目标，不再增加重复的 `ref` 输入。

### 5.3 并发控制

并发组使用 `release-${{ github.event_name == 'workflow_dispatch' && inputs.version || github.ref_name }}`，例如 `release-1.3.15`，并设置 `cancel-in-progress: false`。同一版本的两个发布运行不得互相取消或并行写入 Release。

## 6. 版本规则

作业开始时解析 `VERSION`：

- 标签触发：使用 `GITHUB_REF_NAME`。
- 手动触发：使用 `inputs.version`。

随后依次验证：

1. `VERSION` 严格符合三段无前缀 SemVer。
2. `package.json` 顶层 `version` 与 `VERSION` 完全一致。
3. `package-lock.json` 顶层 `version` 与 `VERSION` 完全一致。
4. 标签触发时，远程标签已存在，且当前检出提交就是该标签指向的提交。
5. 手动触发时，远程同名标签和 GitHub Release 均不存在。
6. 两种触发方式下，同名 GitHub Release 均不得已经存在。

任何验证失败都立即终止，不构建、不覆盖已有发布。

本次实现把 `package.json` 和 `package-lock.json` 的顶层版本从 `1.3.14` 改为 `1.3.15`。标签必须在包含此版本变更和三类任务页文件列表功能的提交上创建。

## 7. 作业环境与权限

- 运行器：`ubuntu-latest`。
- 检出：`actions/checkout@v6`，`fetch-depth: 0`，`persist-credentials: false`。
- Node：`actions/setup-node@v6`，项目运行时固定为 Node.js 20，并启用 npm 缓存。
- 依赖安装：`npm ci`，确保使用已提交的 lockfile。
- Actions 产物上传：`actions/upload-artifact@v6`。
- 作业权限仅设置 `contents: write`，用于创建标签和 Release。
- GitHub CLI 使用 `GH_TOKEN: ${{ github.token }}`，不需要用户新增 Secret。

选择 Node.js 20 是为了兼顾旧版 Gulp 依赖与当前 GitHub 托管环境；Action 自身的运行时版本与项目构建用 Node 版本相互独立。

## 8. 构建与打包

### 8.1 标准版

1. 执行 `npx gulp clean build`。
2. 从 `dist` 目录内部打包，确保 ZIP 根目录直接包含 `index.html`、`css/`、`js/`、`fonts/`、`langs/`、`LICENSE` 等文件，而不是额外套一层目录。
3. 输出 `release/AriaNg-${VERSION}.zip`。

### 8.2 All-In-One 版

1. 标准版 ZIP 完成后执行 `npx gulp clean build-bundle`。
2. 从新的 `dist` 目录内部打包。
3. 输出 `release/AriaNg-${VERSION}-AllInOne.zip`。
4. ZIP 根目录只包含构建生成的 `index.html` 和 `LICENSE`。

两个文件名和根目录结构与历史 Release 保持兼容：

- `AriaNg-1.3.15.zip`
- `AriaNg-1.3.15-AllInOne.zip`

## 9. 产物验证

发布前必须完成：

- `unzip -t` 验证两个 ZIP 无损坏。
- 标准版验证根目录存在 `index.html`、`LICENSE`、`css/`、`js/`、`fonts/` 和 `langs/`。
- All-In-One 验证根目录恰好包含 `index.html` 和 `LICENSE`，并且没有标准版资源目录。
- 两个 ZIP 文件均非空。

验证通过后，用 `actions/upload-artifact@v6` 把两个 ZIP 作为一次工作流产物保存，`if-no-files-found` 设为 `error`。该 Actions 产物用于排查构建，不改变 GitHub Release 中只上传两个 ZIP 的约定。

## 10. 创建标签与 Release

### 10.1 标签触发

标签已经存在，因此使用 GitHub CLI 创建 Release 时带 `--verify-tag`，确保不会隐式创建或指向错误标签：

```sh
gh release create "$VERSION" \
  release/AriaNg-${VERSION}.zip \
  release/AriaNg-${VERSION}-AllInOne.zip \
  --verify-tag \
  --title "AriaNg ${VERSION}" \
  --generate-notes
```

### 10.2 手动触发

手动运行已经确认同名标签不存在。使用 `--target "$GITHUB_SHA"` 创建 Release；GitHub 同时在该提交创建同名标签：

```sh
gh release create "$VERSION" \
  release/AriaNg-${VERSION}.zip \
  release/AriaNg-${VERSION}-AllInOne.zip \
  --target "$GITHUB_SHA" \
  --title "AriaNg ${VERSION}" \
  --generate-notes
```

Release 为正式发布，不设置 `--draft` 或 `--prerelease`。命令失败时工作流失败，不执行清理或覆盖远程对象。

## 11. 错误处理与安全

- 版本格式、源码版本、标签状态、构建或产物结构任一不符即失败。
- 不使用强制推送、标签移动、Release 删除或资产覆盖。
- `persist-credentials: false` 避免把检出凭据留在 Git 配置中；发布只通过受限的 `GITHUB_TOKEN` 完成。
- 手动触发必须从仓库 Actions 权限允许的用户发起，工作流本身不接收任意访问令牌。
- 自动生成 Release Notes 的比较范围由 GitHub 根据当前和前一个 Release 决定，不在工作流内拼接未经验证的提交文本。

## 12. 预计修改模块

- `.github/workflows/release.yml`：新增构建、校验、上传和发布工作流。
- `package.json`：版本改为 `1.3.15`。
- `package-lock.json`：顶层项目版本改为 `1.3.15`，依赖版本保持不变。
- `README.md`：仅在现有文档有明确版本或发布入口需要同步时更新；不为工作流额外增加无关说明。

## 13. 验收标准

1. 工作流可由无前缀三段版本标签和手动入口触发。
2. 手动选择分支并输入 `1.3.15` 时，以该分支当前提交作为新标签目标。
3. 源码版本与触发版本不一致时，工作流在构建前失败。
4. 已存在同名标签或 Release 时，手动工作流失败且不覆盖。
5. 标签触发只发布已存在且指向当前提交的标签。
6. 标准版和 All-In-One 均成功构建，文件名及 ZIP 根目录结构与历史版本一致。
7. GitHub Release 标题为 `AriaNg 1.3.15`，标签为 `1.3.15`，包含自动生成的 Release Notes 和两个 ZIP。
8. Release 不是草稿或预发布。
9. 工作流只授予 `contents: write`，不依赖自定义 Secret 或第三方 Release Action。
10. 现有 CircleCI Daily Build 保持不变。

## 14. 本地与工作流验证

实现阶段至少执行：

1. 校验 workflow YAML 可解析，并用可用的 `actionlint` 检查表达式和 shell。
2. 在 Node.js 20 环境执行 `npm ci`。
3. 执行项目 lint、`npx gulp clean build` 和 `npx gulp clean build-bundle`。
4. 按工作流命令本地生成两个 `1.3.15` ZIP，并检查文件清单和 `unzip -t`。
5. 静态验证标签与手动两个条件分支的版本解析、存在性检查和 `gh release create` 参数。
6. 在未得到用户明确发布指令前，不推送标签、不手动运行工作流、不创建 GitHub Release。

## 15. 官方参考

- [GitHub checkout Action](https://github.com/actions/checkout)
- [GitHub setup-node Action](https://github.com/actions/setup-node)
- [GitHub upload-artifact Action](https://github.com/actions/upload-artifact)
- [GitHub Actions 中的 GITHUB_TOKEN](https://docs.github.com/actions/security-for-github-actions/security-guides/automatic-token-authentication)
- [GitHub CLI `gh release create`](https://cli.github.com/manual/gh_release_create)
