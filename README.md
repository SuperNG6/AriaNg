# AriaNg

[![License](https://img.shields.io/github/license/SuperNG6/AriaNg.svg?style=flat)](https://github.com/SuperNG6/AriaNg/blob/master/LICENSE)
[![Latest Release](https://img.shields.io/github/release/SuperNG6/AriaNg.svg?style=flat)](https://github.com/SuperNG6/AriaNg/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/SuperNG6/AriaNg/release.yml?branch=master&style=flat)](https://github.com/SuperNG6/AriaNg/actions)

> 基于 [AriaNg](https://github.com/mayswind/AriaNg) 的增强版本——给 aria2 加上了**自动过滤 BT 小文件**等实用能力。

A modern web frontend for [aria2](https://github.com/aria2/aria2) — written in pure HTML & JavaScript, no compilers or runtime required. Just drop it on a web server and open it in any browser. Responsive layout works on desktop and mobile.

## ✨ 相对原版 AriaNg 的亮点

### 🎯 BT 小文件自动过滤(核心新功能)
下磁力链接或种子时,**自动排除小于设定阈值的文件**——比如一份 200GB 的资源包里塞着几十 KB 的说明、截图、广告小文件,开启后只挑你要的大文件下,省磁盘、省带宽、省时间。

- 一处全局开关 + 一个大小阈值(1 MB ~ 102400 MB),对**之后所有新建磁力链接和种子任务**生效。
- 过滤流程**可恢复**:`aria2` 重连、页面刷新、RPC 切换之后,未处理完的过滤任务会自动续上,不会半途丢失或重复处理。
- **失败自动回退**:某任务无法过滤时安全回退为保留全部文件,绝不会把你卡在中间状态。
- 元数据子任务自动发现,重试保护,处理结果有清晰摘要。

### 🏷 任务行「过滤中」徽章
不用再去顶部状态栏猜哪个任务在被处理——**任务列表里正在过滤的任务,任务名右侧直接亮一个「过滤中」标记**,鼠标悬停看具体阶段(等待元数据 / 等待文件列表 / 应用过滤 / 恢复 / 启动),**处理完成徽章自动消失**。一眼分辨"正在过滤中"和"普通排队等待"。

### 📂 主页文件列表(无需进详情)
开启后,**下载页的每个任务都能就地展开文件清单**,文件名、大小、进度一目了然——多目录任务还有**层次清晰的树状视图**。不用再逐个点进任务详情才能看文件,批量管理更高效。基础进度每秒刷新,完整文件详情按需精刷新、不被基础刷新抢占。

### 🌐 全 10 种语言完整翻译
BT 过滤相关界面文案在 Czech、Deutsch、Español、Français、Italiano、日本語、Polski、Русский、简体中文、繁體中文**全部到位**,不再有英文占位回退。

### 🛠 继承自原版的全部能力
- 纯 HTML & JavaScript,零运行时依赖,丢服务器即用
- 响应式设计,桌面 / 移动通吃
- 任务按名称/大小/进度/剩余时间/速度等排序,文件、BT 节点可排序
- 任务搜索、重试、拖拽调序
- 按文件类型(视频/音频/图片/文档/应用/压缩包等)或后缀过滤
- 多目录任务的树状视图
- 全量 aria2 设置支持
- 下载/上传速度图表(全局与单任务)
- 深色主题、URL 命令行 API、下载完成通知
- 多 aria2 RPC 主机、设置导入导出
- 增量数据请求,低带宽占用

## 📸 截图

#### Desktop
![AriaNg](https://raw.githubusercontent.com/mayswind/AriaNg-WebSite/master/screenshots/desktop.png)
#### Mobile Device
![AriaNg](https://raw.githubusercontent.com/mayswind/AriaNg-WebSite/master/screenshots/mobile.png)

## 📦 安装

提供三种形态:**标准版**(部署到 web 服务器,按需加载)、**All-In-One 版**(本地用,单个 html 文件开箱即用)、[AriaNg Native](https://github.com/mayswind/AriaNg-Native)(免浏览器的本地客户端)。

#### 预构建版本
- 最新 Release:[https://github.com/SuperNG6/AriaNg/releases](https://github.com/SuperNG6/AriaNg/releases)
- 原版每日构建(标准版):[https://github.com/mayswind/AriaNg-DailyBuild/archive/master.zip](https://github.com/mayswind/AriaNg-DailyBuild/archive/master.zip)

#### 从源码构建
前置:[Node.js](https://nodejs.org/)、[NPM](https://www.npmjs.com/)、[Gulp](https://gulpjs.com/)。

##### 标准版
```bash
npm install
gulp clean build
```

##### All-In-One 版
```bash
npm install
gulp clean build-bundle
```

构建产物输出到 `dist/` 目录。

#### 使用提示
标准版按需异步加载语言资源,**不能直接用 `file://` 打开 `index.html`**。本地使用建议选 All-In-One 版,或部署到 web 容器,或用 [AriaNg Native](https://github.com/mayswind/AriaNg-Native)。

## 🚀 新功能上手指引(2.1.0)
1. 打开 AriaNg → 新建任务页
2. 勾选「排除 BT 任务文件小于」,填入阈值(比如 `100` MB)
3. 粘贴磁力链接或种子,提交
4. 任务列表里被过滤的任务会带「过滤中」徽章;完成后徽章消失,只保留你要的大文件

## 🌍 翻译
欢迎贡献翻译。所有翻译文件位于 `/src/langs/`,直接修改并提 PR 即可。新增语言:在 `/src/scripts/config/languages.js` 注册,复制 `/i18n/en.sample.txt` 到 `/src/langs/` 改名为语言代码即可开始。

当前已支持语言:

| Tag | Language | Tag | Language |
| --- | --- | --- | --- |
| cz-CZ | Čeština | ja-JP | 日本語 |
| de-DE | Deutsch | pl-PL | Polski |
| en | English | ru-RU | Русский |
| es | Español | zh-Hans | 简体中文 |
| fr-FR | Français | zh-Hant | 繁體中文 |
| it-IT | Italiano | | |

没看到你的语言?欢迎帮我们补上。

## 📚 文档
- [English](http://ariang.mayswind.net)
- [简体中文](http://ariang.mayswind.net/zh_Hans)

## 🎬 Demo
[http://ariang.mayswind.net/latest](http://ariang.mayswind.net/latest)

## 🔌 第三方扩展
基于 AriaNg 的第三方应用可让你在更多场景/设备上使用,详见 [Third Party Extensions](http://ariang.mayswind.net/3rd-extensions.html)。

## 📄 License
[MIT](https://github.com/SuperNG6/AriaNg/blob/master/LICENSE) · Forked from [mayswind/AriaNg](https://github.com/mayswind/AriaNg)