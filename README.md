# e宝工坊运行 DeepSeek Harness 官方桌面端

[English](README.en.md) · [文档索引](docs/README.md) · [参与贡献](CONTRIBUTING.md)

本仓库从固定的官方源码构建运行 DeepSeek Harness 桌面端。欢迎页保留官方运行时和认证 IPC，由 e宝工坊适配层提供 e宝品牌与 CQAI 账号登录。DeepSeek API Key 仍作为独立的可选入口。当前源码版本、提交及 pnpm 版本见 [upstream.json](upstream.json)。

CQAI 账号 provider 和 e宝欢迎页适配参与源码启动。其他旧版业务插件仍保留供后续单独接入。e宝工坊独立维护本仓库。官方运行时和插件使用方式以 [DeepSeek Harness 桌面端文档](deepseek-harness/apps/desktop/README.zh.md)为准。

## 从源码运行

需要 Node.js `>=24.9.0`、Git 和 Corepack。外层命令使用 Yarn `4.18.0`，官方子模块使用其固定的 pnpm 版本。

```bash
corepack yarn upstream:init
corepack yarn install --immutable
corepack yarn upstream:install
corepack yarn upstream:prepare-electron
corepack yarn dev
```

`dev` 会构建官方产物、准备 CQAI Profile 和 e宝欢迎页后启动图形应用。使用已有产物时，先运行 `corepack yarn build`，再运行 `corepack yarn start`。首次准备依赖、Electron 和官方内置运行时需要联网。Windows Git Bash 可将 `corepack` 替换为 `corepack.cmd`。

官方开发实例的状态位于 `.official-desktop/official/home`，Electron 数据位于 `.official-desktop/official/electron-user-data`。原有本地 Profile、账号、会话、作品和已安装应用的数据保留在原位置。需要指定目录时，见[开发说明](docs/development-release.md)。

## 验证和打包

| 根目录命令 | 用途 |
| --- | --- |
| `corepack yarn build` | 运行官方 `build:artifacts` 并生成 e宝欢迎页与账号层 |
| `corepack yarn typecheck` | 检查官方 Desktop 类型 |
| `corepack yarn test` | 运行启动器、CQAI 账号适配和官方 Desktop 测试 |
| `corepack yarn check` | 组合布局、组件版本、启动器、构建、类型及无界面测试 |
| `corepack yarn package:dir` | 生成未签名的官方应用目录 |
| `corepack yarn dist:mac:arm64`、`dist:mac:x64`、`dist:win` | 生成对应目标的官方未签名安装产物 |

历史安装包、截图和使用指南记录的是此前的 e宝产品。 [历史 e宝 Releases](https://github.com/cqai-club/ebao-studio/releases)

本仓库采用 [MIT License](LICENSE)。问题反馈见 [e宝工坊 Issues](https://github.com/cqai-club/ebao-studio/issues)。
