# 参与贡献

[English](CONTRIBUTING.en.md)

当前开发目标是直接运行固定版本的官方 DeepSeek Harness Desktop。先阅读[仓库入口](README.md)与[当前开发说明](docs/development-release.md)，再开始修改。

## 开发环境

使用 Node.js `>=24.9.0`、Corepack 和根 Yarn `4.18.0`：

```bash
corepack yarn upstream:init
corepack yarn install --immutable
corepack yarn upstream:install
corepack yarn upstream:prepare-electron
corepack yarn build
corepack yarn typecheck
corepack yarn test
corepack yarn check
```

`corepack yarn dev` 和 `corepack yarn start` 仅在需要打开图形应用时运行。默认开发状态位于 `.official-desktop/`，与原有 e宝用户数据隔离。

## 修改范围

- 官方应用实现位于只读的 `deepseek-harness/` 子模块。子模块 pin 和对应元数据更新使用独立提交；不要直接在产品分支修改官方源码。
- 外层 Yarn 仅维护命令委托与仓库边界；官方依赖继续通过固定的 pnpm workspace 安装。外层当前没有活动的应用或业务插件 workspace。
- `cqai-dsh-plugins/`、市场/Fabric 源码及 `matrixmedia-publisher/` 为后续集成保留。它们不在当前默认构建或功能验收范围内。接回业务能力时，单独说明扩展接口、依赖、用户数据与验证范围。
- 构建、类型检查和测试保持无界面可运行。实际启动、登录或原生安装包验收单独记录。
- 保留账号、会话、附件、作品及历史应用数据；迁移用户数据需要明确的实现和验证。

当前拓扑由[官方 Desktop 基线 Agent Note](.agents/notes/implemented/process/2026-11-16-official-desktop-baseline.zh.md)负责。旧版 Stable/Beta 同步、AA/Market 准备和 e宝发行步骤属于历史流程。

## 提交与反馈

使用 conventional commits，例如 `fix(launcher): ...` 或 `docs: ...`。PR 说明具体行为、原因、验证结果及尚未完成的验收；不要把本地构建描述成已发布版本。中英入口与受记录的双语文档应同步更新 Git blob hash。

本仓库问题请提交至 [e宝工坊 Issues](https://github.com/cqai-club/ebao-studio/issues)，并提供操作系统、固定上游版本及复现步骤。交流遵循[行为准则](CODE_OF_CONDUCT.md)。
