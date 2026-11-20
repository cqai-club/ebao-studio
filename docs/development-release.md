# 官方 Desktop 开发与打包

[English](development-release.en.md)

根 Yarn 负责命令入口。官方 Git 子模块 `deepseek-harness/` 负责桌面端、登录、运行时和插件。官方版本、提交和 pnpm 版本记录在 [upstream.json](../upstream.json)。更新官方 pin 时独立提交子模块指针和元数据。

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

`dev` 调用官方 `dev:desktop`，构建并打开图形应用。`start` 调用官方 `start:desktop`，使用已有产物。切换版本后，先重新构建再使用 `start`。首次启动可能需要联网准备官方内置运行时。

Harness 和 Electron 默认分别使用 `.official-desktop/official/home` 和 `.official-desktop/official/electron-user-data`。可通过 `EBAO_OFFICIAL_DSH_HOME` 与 `EBAO_OFFICIAL_USER_DATA_DIR` 分别指定绝对路径。官方 Desktop 按选定的数据目录初始化或读取 `desktop` Profile，由官方插件管理器处理用户安装的插件。检查官方默认插件时使用全新目录。

原源码启动目录 `.official-desktop/home` 和 `.official-desktop/electron-user-data`、`~/.dsh`、`~/.dsh-beta` 与已安装应用的数据保留在原位置。旧 Profile 的插件清单、依赖和浏览器数据也留在原位置，迁移需要单独处理。

## 构建与验证

```bash
corepack yarn check
```

`check` 依次检查仓库布局、相关组件的 DSH 版本和启动器，运行官方 `build:artifacts`、Desktop 类型检查、停用 CQAI 适配器兼容性测试和无界面 Desktop 测试。图形启动、真实账号授权、模型调用和原生安装包需要分别验证。

## 打包与历史集成

`package:dir`、`dist:mac:arm64`、`dist:mac:x64`、`dist:win` 调用官方未签名打包流程，产物供本地验证。签名、更新和发布步骤见[官方桌面开发与打包说明](../deepseek-harness/apps/desktop/README.zh.md)。

CQAI 账号 provider、本地 e宝欢迎页、其他业务插件、市场和 MatrixMedia 源码均为停用状态。[账号及欢迎页 Agent Note](../.agents/notes/implemented/architecture/2026-11-16-cqai-official-desktop-account.zh.md)记录此前的接入方式。旧产品安装包和发布记录见[历史 e宝 Releases](https://github.com/cqai-club/ebao-studio/releases)。
