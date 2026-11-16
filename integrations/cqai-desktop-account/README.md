# CQAI Desktop account provider

本扩展通过官方外部 `desktop` Profile，将现有 CQAI 账号服务适配为官方 `DeepSeekAccount` 接口。默认登录打开 CQAI OIDC 授权页；官方 Welcome 组件及认证 IPC 继续使用上游实现，本地欢迎页品牌由独立的[欢迎页适配](../ebao-desktop-welcome/README.md)提供。主工作区、Dock/应用菜单与插件管理仍使用官方身份。这里不包含另一套桌面壳或 CQAI 账号前端。

## 准备与检查

从仓库根目录运行：

```bash
corepack yarn cqai:build
corepack yarn cqai:typecheck
corepack yarn cqai:test
# 安装 Profile 前退出正在运行的 Desktop：
corepack yarn cqai:prepare
corepack yarn start
```

`cqai:build` 只生成服务端账号包和 provider 包；`cqai:prepare` 还将其作为标准文件依赖安装到 `.official-desktop/home/profiles/desktop`。默认 `dev/start` 会自动完成准备。生成产物在 `.official-desktop/extensions`，不修改官方 tracked 文件，不接入旧 Profile、凭据或社区桥。

## 账号与模型边界

- 账号服务复用 PKCE、随机 state、独立 loopback 回调、Host 凭据存储、刷新、取消及退出流程。
- 活动 scopes 仅覆盖身份、刷新与 AI 访问，不包含活动发布权限；历史共享插件配置不等于本次集成的授权范围。
- provider 只将安全账号状态和授权链接投影到官方 UI，不向 renderer 返回 token、PKCE verifier 或原始服务错误。
- CQAI token 不通过官方 DeepSeek inference resolver 返回；官方 embedded Platform session 不承载 CQAI token。
- 登录后的默认模型 adoption 保留用户已有的提供商、模型和推理设置，只替换未修改的出厂默认模型。
- 官方金额余额未适配 CQAI，返回不可用；不能把原始配额标成官方货币余额。保留的 CQAI 前端、支付和业务插件尚未接回。
- API Key 选项明确标注 DeepSeek，仍属于官方提供商，不是 CQAI 登录凭据输入框。

自动测试覆盖状态映射、取消与重试、凭据边界和模型 adoption 等行为。真实用户授权和真实模型请求需另行验证，不能仅由这些测试断言已完成。

## 打包边界

当前扩展仅接入源码 `dev/start`。根目录的 unsigned 官方打包命令尚不携带本 provider；产品安装包与分发适配是后续独立工作。
