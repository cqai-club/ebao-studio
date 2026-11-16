# e宝工坊：官方 Desktop 基线

[English](README.en.md) · [文档索引](docs/README.md) · [参与贡献](CONTRIBUTING.md)

当前仓库直接运行 [DeepSeek Harness 官方桌面端](deepseek-harness/apps/desktop/README.zh.md)。桌面应用使用官方界面、名称、登录与插件管理；原先基于 `anywhere-labs/dsh-desktop` 的 Stable、Beta、Next 桌面壳已退出当前构建。

本次先建立纯官方 Desktop 基线。CQAI 账号、e图宝、e剪宝、发布器、e研宝、AA 远控、自定义市场和主题等产品能力尚未接回；保留的业务插件源码不代表这些能力已启用。

官方源码以未修改的 Git 子模块固定到 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`（`0.2.2-rc.1`）。本仓库由 e宝工坊维护，和 DeepSeek 官方项目保持独立；技术来源见 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

## 从源码运行

使用 Node.js `>=24.9.0`、Git 和 Corepack。外层命令入口使用 Yarn `4.18.0`；官方子模块继续使用其固定的 pnpm 版本。

```bash
corepack yarn upstream:init
corepack yarn install --immutable
corepack yarn upstream:install
corepack yarn upstream:prepare-electron
corepack yarn build
corepack yarn dev
```

Windows Git Bash 可将 `corepack` 替换为 `corepack.cmd`。首次安装、下载 Electron 或准备官方内置运行时需要联网；pnpm 安装依赖不会自动下载 Electron，启动与无界面 Desktop 测试前需完成 `upstream:prepare-electron`。`dev` 会打开图形应用。

根启动器默认使用独立的 `.official-desktop/home` 和 `.official-desktop/electron-user-data`，用于官方 Harness 状态及 Electron 浏览器数据。现有 e宝账号、会话、作品和已安装应用的数据保留在原位置，本次不做自动迁移。

## 常用命令

| 根目录命令 | 用途 |
| --- | --- |
| `corepack yarn dev` | 构建并启动官方 Desktop |
| `corepack yarn start` | 使用已有构建启动官方 Desktop |
| `corepack yarn build` | 运行官方 `build:artifacts` |
| `corepack yarn typecheck` | 检查官方 Desktop TypeScript 项目 |
| `corepack yarn test` | 执行外层启动器测试与官方 Desktop 测试 |
| `corepack yarn check` | 检查仓库布局、启动器、官方构建、Desktop 类型与测试 |

这些命令通过根脚本调用官方 pnpm 工作区，默认不安装或构建外层业务插件。准确的检查范围以根脚本为准；图形运行与平台安装包验收分别记录。

## 目录与后续接入

| 目录 | 当前用途 |
| --- | --- |
| `deepseek-harness/` | 未修改的官方源码与 Desktop 实现，当前唯一应用来源 |
| `scripts/` | 外层命令委托、数据隔离及仓库校验 |
| `.official-desktop/` | 本机官方开发运行数据，忽略提交 |
| `cqai-dsh-plugins/` | 保留的 CQAI 业务插件源码，等待后续适配 |
| `dsh-community-market/`、`dsh-community-fabric/` | 保留的市场源码与互操作文档，当前不参与构建 |
| `matrixmedia-publisher/` | 保留的发布器子模块，当前不参与官方 Desktop 启动 |

后续产品能力需通过单独变更接入官方扩展接口，并验证账号、数据和原生功能。不要把旧 Profile、锁文件或 `node_modules` 直接复用为官方 Desktop 的可执行依赖。

## 文档与发行状态

当前流程用于从源码运行官方 Desktop，尚不代表已发布新的 e宝安装包。根 `package:dir`、`dist:mac:arm64`、`dist:mac:x64` 和 `dist:win` 仅委托官方未签名打包，不上传或发布。官方桌面行为、开发和打包说明以[固定上游文档](deepseek-harness/apps/desktop/README.zh.md)为准；外层入口和验证方式见[开发说明](docs/development-release.md)。

[历史 e宝 Releases](https://github.com/cqai-club/ebao-studio/releases) 和本仓库保留的旧用户指南、截图、架构文档用于追溯旧产品，不说明当前官方基线的功能或安装方式。

本仓库采用 [MIT License](LICENSE)。反馈请提交至 [e宝工坊 Issues](https://github.com/cqai-club/ebao-studio/issues)。
