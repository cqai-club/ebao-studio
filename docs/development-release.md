# 官方 Desktop 开发与打包

[English](development-release.en.md)

根 Yarn 负责命令入口。官方 Git 子模块 `deepseek-harness/` 提供桌面壳、认证接口、运行时和插件管理。e宝工坊通过 CQAI 账号服务完成登录。官方版本、提交和 pnpm 版本记录在 [upstream.json](../upstream.json)。更新官方 pin 时独立提交子模块指针和元数据。

## 初始化

```bash
corepack yarn upstream:init
corepack yarn install --immutable
corepack yarn upstream:install
corepack yarn upstream:prepare-electron
```

需要 Node.js `>=24.9.0`、Corepack 和根 Yarn `4.18.0`。`corepack yarn setup` 可组合执行官方子模块初始化、官方依赖安装和 Electron 准备。pnpm 安装依赖时跳过 Electron 二进制下载，启动桌面端或运行 Desktop 测试前需执行 `upstream:prepare-electron`。

`upstream:install` 按锁文件安装成功后，会清理 pnpm 提升目录中过时的工作区链接，以及指向本地虚拟存储中不存在目标的链接。若这些残留链接导致安装失败，运行 `corepack yarn upstream:repair-install`，先清理再按锁文件重试。

## 启动与插件

```bash
corepack yarn dev

# 使用已构建产物
corepack yarn build
corepack yarn start
```

`dev` 先调用官方 `build:artifacts` 和 `build:desktop`，再准备 CQAI Profile、e宝欢迎页、工作台账号展示和产品插件，最后调用官方 `start:desktop` 打开图形应用。`start` 在已有产物上准备相同的产品功能。切换版本后，先重新构建再使用 `start`。首次启动可能需要联网准备运行时和插件依赖。

默认产品插件包括 e图宝、多平台发布、IM、插件市场、Skills／MCP、PPT Composer、e宝首页和 CQAI Club 主题。插件依赖锁定于 `integrations/ebao-product-plugins/pnpm-lock.yaml`，安装在生成的运行时中。产品默认配置在官方默认配置之后、用户配置之前加载，插件管理仍由官方 Desktop 提供。

Harness 和 Electron 默认分别使用 `.official-desktop/official/home` 和 `.official-desktop/official/electron-user-data`。可通过 `EBAO_OFFICIAL_DSH_HOME` 与 `EBAO_OFFICIAL_USER_DATA_DIR` 分别指定绝对路径。官方 Desktop 按选定的数据目录初始化或读取 `desktop` Profile，由官方插件管理器处理用户安装的插件。检查官方默认插件时使用全新目录。

原源码启动目录 `.official-desktop/home` 和 `.official-desktop/electron-user-data`、`~/.dsh`、`~/.dsh-beta` 与已安装应用的数据保留在原位置。旧 Profile 的插件清单、依赖和浏览器数据也留在原位置，迁移需要单独处理。

## 构建与验证

```bash
corepack yarn check
```

`check` 依次检查仓库布局、相关组件的 DSH 版本和启动器，运行官方 `build:artifacts`、Desktop 类型检查、CQAI 适配器兼容性测试和无界面 Desktop 测试。图形启动、真实账号授权、模型调用和原生安装包需要分别验证。

## 打包与发布

`package:dir`、`dist:mac:arm64`、`dist:mac:x64`、`dist:win` 调用官方未签名打包流程，将 e宝欢迎页、工作台账号展示、CQAI provider 和默认产品插件带入产物。安装版使用独立应用标识和数据目录。应用版本由根 `package.json` 声明，底层 Harness 版本仍由 `upstream.json` 固定。

多平台发布使用固定版本的 MatrixMedia Publisher Worker，构建命令和产物路径记录在 [publisher-worker.json](../vendor/matrixmedia/publisher-worker.json)。Desktop packages 工作流在各目标上先构建 Worker，再执行安装包构建。本地打包前，按同一工作流初始化 `matrixmedia-publisher` 并在 Node.js `20.19.5` 环境构建 Worker，随后切回根项目的 Node.js 版本运行打包命令。Mac 使用通用 Worker，Windows 使用 x64 Worker。

安装包由 GitHub Actions 的 Desktop packages 工作流按目标构建。测试预发布提供 macOS Apple 芯片版、macOS Intel 版、Windows x64 版和 `SHA256SUMS`，通过 GitHub Releases 和 GitCode 分发，采用手动下载安装。

下载见 [e宝工坊 Releases](https://github.com/cqai-club/ebao-studio/releases)。
