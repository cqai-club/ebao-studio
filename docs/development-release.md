# 官方 Desktop 与 CQAI 账号开发

[English](development-release.en.md)

当前应用由未修改的官方 DeepSeek Harness Desktop 和外部 CQAI account provider 组成。原社区桌面壳与发行工作流已移除；只有账号服务和 provider 适配器接回源码启动流程，其余业务插件保持不启用。

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

`build` 运行官方 `build:artifacts` 并构建自有账号服务；`typecheck` 针对官方 Desktop，`cqai:typecheck` 针对账号和适配器。`test` 包含启动器、账号与官方 Desktop 测试；`check` 组合布局、构建、两类类型检查及无界面测试。真实登录、模型请求、图形操作和安装包验收需分别记录，不能由单元测试结果推定。

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

两条入口先准备 CQAI 外部 Profile，再启动官方原生界面。默认“登录”由 CQAI provider 接管浏览器 OIDC 授权；它复用原账号插件的 PKCE、loopback 回调、Host 凭据存储、刷新和取消机制。活动授权范围仅为身份、刷新及 AI 访问，不请求活动发布权限。

“添加 API Key”仍配置官方提供商，是独立的可选方式。CQAI token 不通过官方 DeepSeek 推理 token 接口返回，也不注入官方嵌入 Platform 文档。当前官方金额余额界面没有 CQAI 币种/金额适配，返回不可用；不能将原始配额直接标成货币。

首次 CQAI 登录可采用推荐 CQAI 模型，但仅替换未修改的出厂默认值。用户已选择的提供商、模型和推理设置保留。真实用户仍需在 CQAI 浏览器页面完成授权；实现和自动测试不代表该授权已经完成。

数据默认位于 `.official-desktop/home` 和 `.official-desktop/electron-user-data`，账号构建产物位于 `.official-desktop/extensions`。现有 `~/.dsh`、`~/.dsh-beta`、账号、会话、作品及旧 Profile 保留，不自动迁移凭据、锁文件或依赖。更多边界见[账号适配说明](../integrations/cqai-desktop-account/README.md)。

## 后续接入与发行

CQAI 前端、图片/视频工具、Publisher Worker、AA、市场、主题和 MatrixMedia 不参与本次账号接入。后续能力需单独说明官方扩展接口、Host/原生服务、依赖、数据及验证结果；不恢复社区壳私有桥。

**当前 CQAI provider 只接入源码启动。** `package:dir`、`dist:mac:arm64`、`dist:mac:x64`、`dist:win` 仍委托纯官方未签名打包，尚未携带账号 provider。产品安装包、品牌、更新与发行需后续单独适配。没有活动的上传/发布工作流，本次没有发布新 e宝版本。

历史 e宝 Releases 与 `release/` 文件只记录此前产品。官方打包细节见[固定上游参考](../deepseek-harness/apps/desktop/README.zh.md)；[官方 Desktop 基线 Agent Note](../.agents/notes/implemented/process/2026-11-16-official-desktop-baseline.zh.md)记录此前纯官方切换背景，本次账号变更是在该基线上通过外部 provider 扩展。
