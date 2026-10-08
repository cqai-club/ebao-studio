# CQAI Club 扩展：活动与 MCP

`@cqaiclub/dsh-plugin-extension` 是 e宝工坊 CQAI Club 的一个独立扩展包，同时提供「俱乐部活动」和「MCP 服务」两个页面入口。门户 `cqai-club-portal` 是活动和插件投稿数据的来源。活动功能包括浏览、报名、管理、npm 插件资料投稿与运行时 Skill；MCP 功能连接官网的真实 MCP 工具。

## 安装与启用

本扩展不属于桌面默认插件。使用支持 DSH `0.2.0-rc.2` 和 CQAI Club 扩展 API v1 的新版 e宝工坊，在「插件管理 → 添加插件」中输入 npm 包名、构建后的插件目录绝对路径或 `.tgz` 的绝对路径。

安装并启用这一个包后，CQAI Club 页面会出现「俱乐部活动」和「MCP 服务」导航；禁用或卸载扩展时，两个入口、页面贡献及扩展工具一起移除。桌面插件管理若提示需要重启，重启后应用新状态。基础账号插件 `@cqaiclub/dsn-account` 须保持可用。

基础账号插件随桌面应用交付。其包版本 `0.1.1` 本身不能证明具备新版扩展 API：需要 `extensionApiVersion: 1` 和 `@cqaiclub/dsn-account/club-ui` 契约。Host 能力缺失时会明确提示更新 e宝工坊；旧桌面未声明新导航槽时不会显示此扩展入口，应更新应用。

## 共享登录与权限

- 扩展使用基础账号插件的同一个 CQAI Club 登录。Logto 登录、门户资源授权和令牌刷新均由基础插件处理；扩展没有独立凭据存储。旧授权缺少门户资源时，页面按钮会通过基础插件补充授权。
- 公开活动列表和详情无需登录。已登录用户可报名、查看自己的报名和提交 npm 插件资料；活动管理需要门户授予 `activity:publish`。服务器最终校验每次请求的身份与权限。
- 带身份的请求经基础账号 Host 的 `fetchClubPortal` 发出，Client 和 Agent 工具不接触访问令牌或刷新令牌。
- 插件投稿只提交资料，先进入待审核状态；审核通过后仍需管理员发布到市场。该扩展不会上传安装包或执行 npm 发布。

## Agent 工具与 Skill

启用时注册运行时 `cqai-club` Skill 和 `cqai_club_list_activities`、`cqai_club_get_activity`、`cqai_club_register_activity`、`cqai_club_submit_plugin` 四个工具。报名先核对活动详情，投稿先展示资料。Agent 提交插件还需通过 DSH 的工具执行批准通道；工具仅创建待审核记录。

## 官网 MCP 服务

在扩展的「MCP 服务」页面开启连接。地址固定为 `https://cqaiclub.asia/mcp`，不需终端命令、环境变量或静态认证请求头。扩展通过基础账号 Host 取得当前账号获准使用的 MCP 资源，MCP 客户端不接触 Token；成功连接并发现工具后，才会把真实 MCP 工具注册到 DSH Agent。

基础账号登录可以同时供活动和 MCP 使用。现有授权若缺少 MCP 资源，页面显示补充授权按钮，由用户在浏览器中完成一次授权后连接；启用连接不会自动打开授权浏览器。MCP 开关保存在当前 Profile 的扩展配置，关闭后注销远程工具；插件整体禁用会同时释放活动和 MCP 两个功能。

部署前置条件：官网需要提供 MCP 服务，Logto Native 应用需获准请求该 MCP 资源和相关权限。源码构建与 mock 测试不代表这些生产配置已完成；服务未部署或权限未配置时，页面会显示实际连接或授权错误。

## 开发与本地打包

本包位于 e宝工坊 Yarn workspace。使用 Node.js `^22.19.0` 或 `>=24.0.0`，在仓库根目录执行：

```bash
corepack yarn install --immutable
corepack yarn workspace @cqaiclub/dsn-account build
corepack yarn workspace @cqaiclub/dsh-plugin-extension check
corepack yarn workspace @cqaiclub/dsh-plugin-extension pack --out /private/tmp/cqaiclub-dsh-plugin-extension-0.3.0.tgz
```

`prepack` 会重建 Host 和 Client。发布包包含 `lib`、语言元数据、插件 manifest 和 bundle patch；基础账号类型仅用于开发，发布客户端不导入或下载私有基础账号包。

本地验收可创建隔离 Desktop Profile，再通过原生 `pluginManager.inspect` 和 `installBundle` 安装绝对路径包。检查入口和活动内容、共享账号请求、禁用/重新启用，以及重启同一 Profile 后的状态；测试使用 mock 数据，不需生产活动写入或读取现有 Profile 凭据。

## 本地门户预览

默认公开查询请求 `https://cqaiclub.asia/api/v1/activities`。开发时可把扩展的 `portalUrl` 与基础账号的 `clubPortalUrl` 同时设为本地门户，例如 `http://127.0.0.1:3001`。`clubPortalResource` 保持所用 Logto 应用已登记的门户资源。公开查询使用扩展地址，报名、管理和投稿使用基础账号地址。预览结束后移除本地覆盖，并按照插件管理提示重启。
