# 官方 Desktop 与 CQAI 账号开发

[English](development-release.en.md)

当前应用基于未修改的官方 DeepSeek Harness tracked 源码，外接 CQAI account provider 和本地 e宝欢迎页适配。原社区桌面壳与发行工作流已移除；账号是当前唯一接回的业务服务，其余业务插件保持不启用。主工作区、Dock/应用菜单仍使用官方身份，欢迎页使用 e宝工坊品牌。

## 初始化

```bash
corepack yarn upstream:init
corepack yarn install --immutable
corepack yarn upstream:install
corepack yarn upstream:prepare-electron
```

要求 Node.js `>=24.9.0`、Corepack 和根 Yarn `4.18.0`。`corepack yarn setup` 可组合执行上游初始化、依赖安装和 Electron 准备。pnpm 安装依赖不会下载 Electron；运行图形应用和无界面 Desktop 测试（包括 Windows）前需完成 `upstream:prepare-electron`。

已有 checkout 若出现陈旧 pnpm 链接，可运行 `corepack yarn upstream:repair-install`，清理失效工作区链接后按冻结锁文件安装。官方子模块使用自己的固定 pnpm，外层没有活动 Yarn 应用 workspace，也不把官方工作区并入 Yarn 依赖图。

官方源码固定为 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`（`0.2.2-rc.1`）。更新 pin 与元数据独立提交；本次账号扩展不修改官方 tracked 源码。

## 构建与检查

```bash
corepack yarn build
corepack yarn typecheck
corepack yarn cqai:typecheck
corepack yarn test
corepack yarn check
```

`build` 运行官方 `build:artifacts`、构建自有账号服务，并在最后生成欢迎页适配；`typecheck` 针对官方 Desktop，`cqai:typecheck` 针对账号和适配器。`test` 包含启动器、账号与官方 Desktop 测试；`check` 组合布局、构建、两类类型检查及无界面测试。真实登录、模型请求、图形操作和安装包验收需分别记录，不能由单元测试结果推定。

账号扩展可以单独准备：

```bash
# 只生成服务端账号包，不修改 Profile：
corepack yarn cqai:build
# 构建并安装到独立的 Desktop Profile：
corepack yarn cqai:prepare
corepack yarn cqai:test
```

生成包使用固定官方工具链，不包含 CQAI 前端或其他业务插件。准备 Profile 前应退出正在运行的 Desktop；准备器遇到官方 Profile 锁会拒绝并发修改。

## 启动与账号边界

```bash
corepack yarn dev
# 使用已有官方构建：
corepack yarn start
```

`dev` 先完成官方构建，再应用欢迎页适配，最后调用官方 `start`；不能在适配后调用会重新构建并覆盖它的官方 `dev`。根 `start` 不重建官方源码，只对现有产物应用欢迎页适配。两条入口均准备 CQAI 外部 Profile 后打开图形应用。

欢迎页的标志、标题、说明和登录按钮文案使用 e宝工坊品牌，登录仍由 CQAI provider 接管浏览器 OIDC 授权，复用原账号插件的 PKCE、loopback 回调、Host 凭据存储、刷新和取消机制。活动授权范围仅为身份、刷新及 AI 访问，不请求活动发布权限。

API Key 按钮明确标注 DeepSeek，仍配置官方提供商，是独立的可选方式。CQAI token 不通过官方 DeepSeek 推理 token 接口返回，也不注入官方嵌入 Platform 文档。当前官方金额余额界面没有 CQAI 币种/金额适配，返回不可用；不能将原始配额直接标成货币。

首次 CQAI 登录可采用推荐 CQAI 模型，但仅替换未修改的出厂默认值。用户已选择的提供商、模型和推理设置保留。真实用户仍需在 CQAI 浏览器页面完成授权；实现和自动测试不代表该授权已经完成。

数据默认位于 `.official-desktop/home` 和 `.official-desktop/electron-user-data`，账号构建产物位于 `.official-desktop/extensions`。现有 `~/.dsh`、`~/.dsh-beta`、账号、会话、作品及旧 Profile 保留，不自动迁移凭据、锁文件或依赖。更多边界见[账号适配说明](../integrations/cqai-desktop-account/README.md)。

## 欢迎页适配归属

`integrations/ebao-desktop-welcome/` 复用官方 Welcome 组件与 sandboxed preload，通过 messages 包装替换本地文案，并以 guarded build-time transform 仅替换唯一品牌节点。定位缺失或出现多处匹配时应拒绝构建，不能静默扩大修改范围。生成结果落在官方忽略的 `lib/welcome` 目录，官方 tracked 源码、认证 IPC、主工作区、Dock 和应用菜单不作改写。

本地欢迎页适配不是全应用重命名。品牌、登录行为、真实授权与界面操作验收分别记录，不能从构建或快照结果推定真实用户已完成登录。详见[欢迎页适配说明](../integrations/ebao-desktop-welcome/README.md)。

## 后续接入与发行

CQAI 前端、图片/视频工具、Publisher Worker、AA、市场、主题和 MatrixMedia 不参与本次账号接入。后续能力需单独说明官方扩展接口、Host/原生服务、依赖、数据及验证结果；不恢复社区壳私有桥。

**当前 CQAI provider 和欢迎页适配只接入源码启动。** `package:dir`、`dist:mac:arm64`、`dist:mac:x64`、`dist:win` 仍委托纯官方未签名打包，尚未携带账号 provider 或欢迎页适配。完整产品安装包、品牌、更新与发行需后续单独适配。没有活动的上传/发布工作流，本次没有发布新 e宝版本。

历史 e宝 Releases 与 `release/` 文件只记录此前产品。官方打包细节见[固定上游参考](../deepseek-harness/apps/desktop/README.zh.md)；[官方 Desktop 基线 Agent Note](../.agents/notes/implemented/process/2026-11-16-official-desktop-baseline.zh.md)记录此前纯官方切换背景，本次账号变更是在该基线上通过外部 provider 扩展。
