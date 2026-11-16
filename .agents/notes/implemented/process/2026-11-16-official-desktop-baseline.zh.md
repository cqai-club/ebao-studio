# Agent Note：以官方 Desktop 作为唯一活动基线

Status: implemented

[English](2026-11-16-official-desktop-baseline.md) | 中文

## 决策与范围

先直接运行未修改的 DeepSeek Harness 官方 Desktop，再重新接入 e宝账号和业务能力。官方 `deepseek-harness/apps/desktop` 是当前唯一活动的桌面应用实现。源码 pin 保持 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`（`0.2.2-rc.1`）。

本决策取代[固定上游与隔离 Yarn 注记](2026-08-15-pinned-upstream-and-isolated-yarn-workspace.zh.md)中关于活动社区渠道的拓扑说明，保留其只读上游与包管理边界：官方 checkout 是拥有独立 pnpm workspace 的固定 Git 子模块，根 Yarn 只是外层命令入口。原 Stable/Beta 镜像、Next 桌面壳、共享社区原生控件及其 Profile 组合不再定义当前应用。

## 归属

根 build、typecheck、test、check、dev 和 start 命令委托官方 pnpm 流程，并组合外层启动器与布局检查。构建目标为官方 artifacts，类型检查针对 Desktop 项目，测试覆盖启动器与官方 Desktop 测试。外层没有活动的应用或插件 workspace。构建与验证保持无界面可运行；dev/start 明确打开图形应用。

根启动器默认使用 `.official-desktop/home` 和 `.official-desktop/electron-user-data`。原有 e宝 home、账号、会话、附件、作品及浏览器数据保留。官方可执行依赖和 `desktop` Profile 不通过复用旧 e宝锁文件或依赖树来组合。

CQAI 插件源码、Community Market/Fabric 源码和 MatrixMedia Publisher 子模块作为未激活的后续集成素材保留。默认流程不安装、构建、加载或承诺其能力。特别是现有账号及 Publisher 代码依赖官方壳没有提供的私有 `desktopRuntime` 服务，重新接入需要单独的适配设计与验证。

应用保留官方身份与行为。本次不构成新的 e宝发行版、安装包或自动迁移。历史 e宝 Releases、截图、指南及早期 Agent Notes 继续记录旧产品；当前 README 和文档索引明确将其标为历史参考。

## 验证边界

验证外层委托、固定源码无修改、默认隔离数据目录、未激活源码边界和双语文档记录。通过根入口执行可用的官方构建、类型检查及测试，并在变更报告中记录实际完成的命令与结果。真实图形启动、账号登录、原生安装、签名与发布需各自提供证据，不能由无界面结果推定。

## 后续接入

产品能力接入保持独立可审查。可用时使用官方插件接口，必须提供原生/Host 适配时明确其代码归属。保持官方 checkout 不修改。恢复 e宝品牌、业务能力、发行或迁移用户数据，应通过后续明确变更完成，不隐式恢复社区桌面壳。
