# CQAI Desktop account provider

本扩展将现有 CQAI 账号服务适配为官方 `DeepSeekAccount` 接口。用户从欢迎页、工作区侧栏或设置登录 e宝工坊时，浏览器打开 CQAI OIDC 授权页。欢迎页通过[欢迎页适配](../ebao-desktop-welcome/README.md)沿用官方认证 IPC，工作区账号界面使用 e宝工坊文案。

## 兼容性检查

构建官方产物后，从仓库根目录运行兼容性测试。

```bash
corepack yarn build
corepack yarn test:integrations
```

该测试使用官方 RC5 的 `credentials`、`authorization` 和 `DeepSeekAccount` 服务组合，验证 CQAI 适配器的状态、取消、退出、模型选择和凭据边界。

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

`dev` 和 `start` 通过启动器准备的 `desktop` Profile 加载账号扩展。e宝工坊未签名安装包通过内置启动配置加载同一扩展，并使用独立的应用数据目录。上游 DeepSeek 账号及其账号推理入口在这两种启动方式中均被禁用。
