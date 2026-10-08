# @cqaiclub/dsn-account

本目录固定了 [cqai-club/cqaiclub-dsh-plugin](https://github.com/cqai-club/cqaiclub-dsh-plugin)
的 3bad8bed59be26573e3b2881bd9f105576e53532 提交，并作为 e宝工坊 的默认 CQAI
账号插件使用。

为适配本仓库锁定的 DSH 0.1.7-rc.2，本目录调整了插件元数据和依赖版本，并补充了
桌面原生登录适配。OAuth 使用每次登录独立的随机端口回环监听器，不经过 Desktop Web
载体；Desktop 会直接打开系统浏览器，回调后自动关闭监听器并重新置前桌面窗口。回调页还提供
不携带授权码的 `dsh-desktop://oauth/complete` 按钮，用于通过系统协议重新唤醒应用。上游提交遗漏了 src/client，
本目录同时补充了桌面风格的 CQAI Club 账号、充值页面和模型服务页签，恢复按用途分类的模型目录与五类默认模型选择。Stable/Beta 从账号菜单打开 CQAI Club 页面；实验性 Next 暂时沿用设置入口。
充值订单由 Host 创建，支付页面在系统浏览器打开；需要表单 POST 的渠道通过一次性随机本机
页面转交支付字段，不把字段放入 URL。支付完成或取消后，固定的
`dsh-desktop://payment/result` 回跳会重新唤醒应用并刷新账户额度。

在空白会话的首次启动流程中，本插件会在欢迎页之后、官方 DeepSeek 配置之前优先展示
CQAI Club 登录。用户可以选择稍后登录并继续使用其他模型；从该引导完成登录时，插件只会在
当前选择仍是出厂 DeepSeek 默认值的情况下，按固定优先级选择 CQAI Club 对话模型，不覆盖
已经设置过的其他提供商、模型或推理强度。CQAI 模型路由仅在账号已登录且目录中存在可用
对话模型时注册，因而“稍后登录”仍能正常进入官方 DeepSeek 配置。

首次登录需要在系统浏览器完成授权。Native App Client 需要允许
`http://127.0.0.1/cqaiclub-dsn-account/oauth/callback` 的动态端口回调。插件不把 Access
Token 暴露给 Renderer，默认配置仍由 cordis.patch.yml 管理。

同一次 Native App 授权会申请账号服务和俱乐部门户两个资源。Host 在首次访问门户时取得
门户 Access Token，避免门户资源临时故障阻断基础账号登录；随后单独缓存两个受众的
Access Token，并在同一凭据记录内顺序轮换 Refresh Token；活动扩展插件只能通过固定
`/api/v1` 路径白名单调用门户，不会取得令牌。旧版账号授权继续用于积分和模型，但首次
使用活动报名或插件投稿前需通过基础插件重新登录一次。开发环境如将活动扩展插件的
`portalUrl` 指向本机，也需将本插件的 `clubPortalUrl` 指向同一门户服务；
`clubPortalResource` 始终保持 Logto 中登记的门户 API 标识符。

模型目录兼容 Relay 新增的 OpenRouter 风格字段。业务判断优先使用 `architecture` 的输入、输出
模态和端点类型，只有结构化字段缺失时才回退旧 `categories`；未知的模态和参数字符串会原样
保留，便于后续版本识别，而不会让旧分类覆盖新的目录事实。

## CQAI Club 扩展接口

内置账号插件提供登录、积分和会员；可选的 `@cqaiclub/dsh-plugin-extension` 在一个插件中提供
「俱乐部活动」和「MCP 服务」。它不加入桌面默认安装包。账号客户端通过 `cqaiclub.club.extension`
列表槽接收扩展入口，Host 以 `extensionApiVersion: 1` 标识支持扩展；停用扩展后，两个页面入口与
远程 MCP 工具一起注销，当前选中的扩展页面回到积分信息。旧活动扩展槽仍保留兼容。

账号 Host 的 `useResource(owner, { resource, enabled })` 提供限定官网资源的授权与请求能力，
令牌只保留在 Host。扩展负责 MCP SDK、工具注册与设置页面；账号插件不再启动 MCP SDK。
既有 v3 凭据和旧 `clubMcpEnabled` 配置保留用于迁移，已完成的官网授权无需重做。

## 扩展授权

安装扩展后，CQAI Club 页面提供官网 MCP 开关、连接状态、工具数量、重连和补充授权。服务固定为
`https://cqaiclub.asia/mcp`，不提供地址编辑或令牌输入；用户复用插件里的账号登录，不运行
独立桥接程序。开关默认关闭，避免后台 MCP 资源尚未登记时阻断现有账号、模型和门户功能。
启用开关保存在当前 Profile，已授权用户重新启动后自动连接。

开启后，新登录会申请 Account、Portal 和 MCP 三个资源。旧授权在插件内补一次 consent；
Host 分别缓存不同 audience 的 Access Token，并通过同一凭据记录锁顺序更新轮转 Refresh
Token。MCP 的动态鉴权只在 Host 执行，不把凭据送到 Renderer、RPC、静态 headers 或 Skill。
401 会刷新一次并重试原请求；网络错误或未知结果不会自动重发业务写入。

扩展使用固定的 MCP SDK Client 2.0.0 连接官网，并通过 Host tools registry 注册完整的远程
工具。普通用户可以查询、报名和投稿；活动管理要求 `activity:publish`。关闭连接、退出账号
或销毁插件会注销这些工具。它不改动 pinned `deepseek-harness` 或通用 MCP 面板的上游实现。

生产部署管理员需要：

1. 在 Logto 的 API 资源中创建 identifier 为 `https://cqaiclub.asia/mcp` 的独立资源。
2. 在该资源下创建 `activity:publish` 和 `plugin:admin`；分别按既有运营/管理员职责授权。
3. 继续使用现有插件 Native 应用及动态端口回调
   `http://127.0.0.1/cqaiclub-dsn-account/oauth/callback`，支持 PKCE 与 Refresh Token。
4. 后台配置完成后，在插件里开启 MCP 并补充授权。无需另建 CLI 桥接应用或注册它的固定端口回调。

本地测试使用模拟的 Logto 和官网协议响应验证登录、续期及工具调用；生产 OAuth、角色权限、
真实业务记录和打包客户端仍须在各自环境验收。源码功能不代表已安装的旧版本已包含此入口。
