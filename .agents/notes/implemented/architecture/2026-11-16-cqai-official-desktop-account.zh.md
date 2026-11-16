# Agent Note：CQAI 账号与本地 e宝欢迎页

Status: implemented

[English](2026-11-16-cqai-official-desktop-account.md) | 中文

## 决策

通过官方外部 `desktop` Profile 接入 CQAI 登录，并应用自有 e宝欢迎页呈现。保留官方 tracked 源码、主工作区、Dock/应用菜单身份、Host 与包管理边界。本次是在[纯官方基线](../process/2026-11-16-official-desktop-baseline.zh.md)之上的首个账号扩展；此前说明作为前置历史保留，不限制本次明确的接入。官方源码 pin 不变。

当前启用服务端 `@cqaiclub/dsn-account`、自有 `@cqaiclub/desktop-account` provider 和本地欢迎页适配。CQAI 账号前端、社区桌面壳、Publisher Worker、AA、市场、主题与其他业务插件保持不启用。

## 组合与归属

准备器使用官方工具链，将带指纹的自有包构建到 `.official-desktop/extensions`，再通过标准文件依赖和 provider bundle 接入隔离的外部 Profile。保留用户 patch、设置、其他依赖与 bundle 顺序。准备时持有官方 Profile 锁，其他进程占用时拒绝并发修改。

Bundle 插入 `cqaiclub-dsn-account` 与 `cqai-desktop-account`，同时禁用原有 `deepseek-account` 和 `llm-deepseek-account` 条目。官方 Include 语法中，patch 的 `name` 用于校验现有插件身份，不能将该插件改名。因此替换 provider 必须**禁用原条目，再以独立 ID 插入自有 provider**，不能只改原条目的 name。

Provider 继承真实官方 `DeepSeekAccount` Service SDK，将既有 CQAI 生命周期转换为官方账号 RPC 与状态流。官方 SDK 导入继续作为共享运行时 peer。实现不伪造服务或 API Key，不拦截原生窗口，不修改官方 tracked 源码，也不恢复社区桥。

## 欢迎页呈现

`integrations/ebao-desktop-welcome/` 复用官方 `WelcomePage.tsx`、renderer 入口与 sandboxed welcome preload。自有 messages 包装提供 e宝标题、说明和登录按钮文案，保留所有 preload 操作。受限构建转换仅替换唯一品牌图片节点，并包装唯一 Welcome mount；标记缺失或多处匹配时，在写入产物前拒绝构建。旧 e宝机器人资源仅作为静态文件复用，不加载旧 presentation 插件。

只生成忽略提交的 `deepseek-harness/apps/desktop/lib/welcome` 产物，不改写官方 tracked 文件、账号 IPC、主工作区、Dock 或应用菜单。根 build 在官方构建后应用适配；根 dev 必须先构建官方产物，再适配并调用官方 start；根 start 只对已有产物适配。后续官方重建会覆盖这些产物，因此不能将适配放在官方构建之前。

欢迎页采用 e宝品牌，真实登录目的地仍是 CQAI，API Key 选项明确标识 DeepSeek。本次属于本地欢迎页呈现，不是整个应用身份迁移。

## 凭据与行为

复用账号服务已有的 Authorization Code + PKCE、state 校验、loopback 回调、Host 凭据存储、刷新、取消及先清本地再远端撤销的退出流程。等待取消完成后可立即重试，新尝试不会复用旧任务。活动 scopes 覆盖身份、刷新和 AI 访问，不包含活动发布权限。

CQAI 凭据不进入 renderer 账号状态、不通过官方 DeepSeek 推理 token resolver 返回，也不注入官方嵌入 Platform session。官方 API Key 入口仍是独立的官方提供商方式。官方金额余额尚未适配 CQAI，返回不可用，不把原始配额标为货币。默认模型 adoption 仅替换未修改的出厂默认值，保留用户明确选择的提供商、模型及推理设置。

默认数据仍位于 `.official-desktop/home` 与 `.official-desktop/electron-user-data`。保留既有 e宝 Home、凭据、会话、附件、作品和浏览器数据，不隐式迁移。

## 验证与发行边界

无界面检查覆盖 provider 状态映射、真实 Service SDK 接入、授权地址范围、凭据隔离、取消重试、账号与模型行为、Profile 组合以及构建/类型契约。真实 Host smoke 需确认由自有 provider 提供账号 RPC 和状态流，原生登录打开 CQAI issuer。模拟授权测试或未登录 RPC 响应不代表真实用户授权已完成，也不代表真实模型调用成功，这些验收分别记录。

本次只接入源码 `dev/start`。根未签名打包命令仍构建不含 provider 和欢迎页适配的纯官方应用。完整产品打包/身份、更新及发布需独立变更。欢迎页品牌与真实用户授权需分别提供图形验证，不能从无界面产物推定。本决策不创建公开发行版。
