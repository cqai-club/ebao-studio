# e宝工坊：官方 Desktop 与 CQAI 登录

[English](README.en.md) · [文档索引](docs/README.md) · [参与贡献](CONTRIBUTING.md)

当前仓库运行 [DeepSeek Harness 官方桌面端](deepseek-harness/apps/desktop/README.zh.md)，通过官方外部 Desktop Profile 接入 CQAI 账号。官方原生界面、名称和插件管理保持上游实现；原社区 Stable、Beta、Next 桌面壳已移除，官方 tracked 源码未打补丁。

默认“登录”进入 CQAI 浏览器授权，登录后由账号插件提供 CQAI 模型。只有仍使用出厂默认模型时才采用推荐 CQAI 模型；已选的其他模型和推理设置保留。“添加 API Key”仍是官方提供商的可选入口，不能把 CQAI 登录凭据当作 DeepSeek API Key。

本次只接回账号服务和账号 provider 适配器，不加载 CQAI 前端、e图宝、e剪宝、发布器、e研宝、AA、自定义市场或主题。官方金额余额界面尚未适配 CQAI，当前显示不可用，不能据此判断账号实际额度。

官方 Git 子模块固定到 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`（`0.2.2-rc.1`）。本仓库由 e宝工坊独立维护，与 DeepSeek 官方不存在隶属或背书关系。

## 从源码运行

使用 Node.js `>=24.9.0`、Git、Corepack 和根 Yarn `4.18.0`；官方子模块保留自己的 pnpm 版本。

```bash
corepack yarn upstream:init
corepack yarn install --immutable
corepack yarn upstream:install
corepack yarn upstream:prepare-electron
corepack yarn build
corepack yarn start
```

`dev` 会重新构建并打开图形应用，`start` 使用已有官方构建；两者都会先准备 CQAI 外部 Profile。首次安装、Electron 和内置运行时准备可能需要联网。Windows Git Bash 可将 `corepack` 替换为 `corepack.cmd`。

本机数据默认位于 `.official-desktop/home` 和 `.official-desktop/electron-user-data`。原有 `~/.dsh`、`~/.dsh-beta`、账号、会话、作品及浏览器数据保留，不自动迁移旧凭据或依赖。真实登录由用户在 CQAI 浏览器页面完成，单元测试通过不代表用户授权已完成。

## 常用命令

| 根目录命令 | 用途 |
| --- | --- |
| `corepack yarn dev` / `start` | 准备 CQAI Profile 后启动官方 Desktop |
| `corepack yarn build` | 官方 artifacts 与自有账号服务构建 |
| `corepack yarn typecheck` | 官方 Desktop 类型检查 |
| `corepack yarn cqai:build` | 仅构建账号服务与适配器，不修改 Profile |
| `corepack yarn cqai:prepare` | 构建并安装到独立的官方 Desktop Profile |
| `corepack yarn cqai:typecheck` / `cqai:test` | 检查账号与 provider 适配 |
| `corepack yarn test` | 启动器、账号与官方 Desktop 测试 |
| `corepack yarn check` | 布局、构建、类型及无界面测试组合检查 |

外层 Yarn 只维护命令入口，不把官方 pnpm 工作区纳入其依赖图。账号集成通过标准外部 Profile 安装，其余业务源码不参与默认构建。[账号适配说明](integrations/cqai-desktop-account/README.md)与[开发说明](docs/development-release.md)记录实现和验证边界。

## 目录与后续接入

| 目录 | 当前用途 |
| --- | --- |
| `deepseek-harness/` | 未修改的官方源码和唯一桌面应用实现 |
| `integrations/cqai-desktop-account/` | 官方账号接口与 CQAI 服务之间的适配 |
| `cqai-dsh-plugins/cqai-dsh-plugin-account/` | 已接入的 Host 账号、OIDC 和模型服务源码 |
| `.official-desktop/` | 独立本机状态与生成的账号包，忽略提交 |
| 其他 `cqai-dsh-plugins/`、Community Market/Fabric、MatrixMedia | 后续接入材料，当前不启用 |

## 发行状态

当前 CQAI 登录集成面向**源码启动**。根 `package:dir`、`dist:mac:arm64`、`dist:mac:x64` 和 `dist:win` 仍执行纯官方未签名打包，**尚未携带 CQAI provider**。产品打包、身份、更新与发行需要后续单独接入；本次没有上传或发布新 e宝安装包。

[历史 e宝 Releases](https://github.com/cqai-club/ebao-studio/releases)、旧截图与用户指南只用于追溯旧产品。官方行为和打包细节见[固定上游文档](deepseek-harness/apps/desktop/README.zh.md)。本仓库采用 [MIT License](LICENSE)，问题反馈见 [e宝工坊 Issues](https://github.com/cqai-club/ebao-studio/issues)。
