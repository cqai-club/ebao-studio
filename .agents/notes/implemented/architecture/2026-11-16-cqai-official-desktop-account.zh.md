# Agent Note：官方 Desktop 的 CQAI 账号接入

Status: implemented

[English](2026-11-16-cqai-official-desktop-account.md) | 中文

## 决策

通过官方外部 `desktop` Profile 接入 CQAI 登录，保留未修改的官方 Desktop 界面、名称、Host 与包管理边界。本次是在[纯官方基线](../process/2026-11-16-official-desktop-baseline.zh.md)之上的首个账号扩展；此前说明作为前置历史保留，不限制本次明确的接入。官方源码 pin 不变。

当前只启用服务端 `@cqaiclub/dsn-account` 与自有 `@cqaiclub/desktop-account` provider。CQAI 前端、社区桌面壳、Publisher Worker、AA、市场、主题与其他业务插件保持不启用。

## 组合与归属

准备器使用官方工具链，将带指纹的自有包构建到 `.official-desktop/extensions`，再通过标准文件依赖和 provider bundle 接入隔离的外部 Profile。保留用户 patch、设置、其他依赖与 bundle 顺序。准备时持有官方 Profile 锁，其他进程占用时拒绝并发修改。

Bundle 插入 `cqaiclub-dsn-account` 与 `cqai-desktop-account`，同时禁用原有 `deepseek-account` 和 `llm-deepseek-account` 条目。官方 Include 语法中，patch 的 `name` 用于校验现有插件身份，不能将该插件改名。因此替换 provider 必须**禁用原条目，再以独立 ID 插入自有 provider**，不能只改原条目的 name。

Provider 继承真实官方 `DeepSeekAccount` Service SDK，将既有 CQAI 生命周期转换为官方账号 RPC 与状态流。官方 SDK 导入继续作为共享运行时 peer。实现不伪造服务或 API Key，不拦截原生窗口，不修改官方 tracked 源码，也不恢复社区桥。

## 凭据与行为

复用账号服务已有的 Authorization Code + PKCE、state 校验、loopback 回调、Host 凭据存储、刷新、取消及先清本地再远端撤销的退出流程。等待取消完成后可立即重试，新尝试不会复用旧任务。活动 scopes 覆盖身份、刷新和 AI 访问，不包含活动发布权限。

CQAI 凭据不进入 renderer 账号状态、不通过官方 DeepSeek 推理 token resolver 返回，也不注入官方嵌入 Platform session。官方 API Key 入口仍是独立的官方提供商方式。官方金额余额尚未适配 CQAI，返回不可用，不把原始配额标为货币。默认模型 adoption 仅替换未修改的出厂默认值，保留用户明确选择的提供商、模型及推理设置。

默认数据仍位于 `.official-desktop/home` 与 `.official-desktop/electron-user-data`。保留既有 e宝 Home、凭据、会话、附件、作品和浏览器数据，不隐式迁移。

## 验证与发行边界

无界面检查覆盖 provider 状态映射、真实 Service SDK 接入、授权地址范围、凭据隔离、取消重试、账号与模型行为、Profile 组合以及构建/类型契约。真实 Host smoke 需确认由自有 provider 提供账号 RPC 和状态流，原生登录打开 CQAI issuer。模拟授权测试或未登录 RPC 响应不代表真实用户授权已完成，也不代表真实模型调用成功，这些验收分别记录。

本次只接入源码 `dev/start`。根未签名打包命令仍构建不含该 provider 的纯官方应用。产品打包、e宝品牌、更新及发布需独立变更，本决策不创建公开发行版。
