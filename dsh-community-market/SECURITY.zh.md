# 安全策略

[English](SECURITY.md)

## 信任模型

目录响应是不可信远程数据。被目录收录、provider 徽章、仓库链接或显示在**可安装**中，都不代表安全审核、维护者身份验证、推荐或兼容性保证。

插件及其依赖树安装后会以用户权限作为本地代码运行。Market 不声称能够检查其中是否存在恶意行为。

## Package 操作边界

- 安装、更新和卸载只有在用户明确确认后才开始。定时检查和更新提醒不会授权 package 修改。
- 确认框展示 Host 解析出的 npm package、精确目标版本和当前 Profile；更新确认还展示已经验证的安装版本及官方插件管理器选择的安装源。
- 不接受目录数据提供的命令、脚本、HTML、header、凭据或 package-manager argv。
- 自动安装要求唯一合法的 npm package 身份，并要求 npm 官方 `latest` manifest 声明合法的 `dsh.bundle.patch`。
- 来源提供的版本和验证结论不构成安装权限。
- Market package 修改使用官方插件管理器，同一时间只执行一个。
- Renderer 在安装时提交来源/条目身份，在更新和卸载时提交官方清单中的 package name。Host 重新验证可操作性并确定精确目标；执行接口只接受一次性的 preview 身份。
- 已安装清单来自官方插件管理器，因此其他市场或 DSH CLI 安装的社区 package 也会显示。启用、停用、更新和卸载由管理器的能力标记控制；官方及产品内置 bundle 留在官方插件页管理。
- 更新目标来自管理器的安装清单和版本列表。跳过产品自有核心 bundle、本地或 Git 依赖；目标必须声明 bundle、兼容当前 DSH，并且不是弃用或预发布版本。
- 更新 preview 用短时一次性 token 绑定当前 Profile、package 和精确的新旧版本。Host 在执行前重新检查这些事实，并保留 bundle 引用和配置。
- Market 不创建安装 receipt、安装专用快照、重试、清理或回滚。管理器在需要时恢复自身 Profile 快照，并在目标安装失败后尝试重新安装原版本。结果区分已恢复及安装损坏；Desktop checkpoint 恢复仍需明确操作。
- 全部更新逐项执行用户已确认的更新，不是原子事务。首次失败即停止，保留成功项，并列出失败项及未执行项；重试前需要重新查看确认。
- 支持时修改即时生效。管理器返回 `restart-required` 时展示重启说明，Market 不会重启 Desktop。
- **打开 DSH 终端**使用空 body，只负责打开 Desktop 终端，不会粘贴或执行界面中的命令。

这些规则限制操作权限和 package 身份，但不能让第三方插件变得安全。

## 目录来源

添加或选择来源是明确的本地操作。远程 manifest 不能自行启用、决定优先级、提供 adapter 代码或提供凭据。

生产环境来源请求仅允许 HTTPS 且不携带凭据，并限制重定向、超时、并发、解码后响应大小、条目数、嵌套和字符串长度。每次重定向和 DNS 目标都会检查 loopback、私有网络、link-local 和云 metadata 地址。JSON 必须先通过公开 Schema 再进入标准化。

同一时间只选择一个来源浏览。来源故障不会静默选择兜底、修改当前 Profile 或阻止 易宝工坊 启动。

## 报告安全问题

请通过 [t4wefan@qq.com](mailto:t4wefan@qq.com) 私下报告可能的安全问题，并提供受影响版本或 commit、操作系统、复现步骤、预期影响，以及可安全分享的最小 proof of concept。

不要发送 secret 或个人数据，也不要为未修复漏洞创建公开 issue。普通 bug、目录修正和功能建议可以使用公开 issue tracker。
