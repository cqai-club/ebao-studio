# cqai-dsh-plugin-market

CQAI Desktop 的「插件管理」入口与外层导航。左侧切换「已安装插件」「插件市场」「技能」和「MCP」；右侧「已安装插件」直接承载上游 Plugin Manager 的页面、控制器、安装、详情和卸载流程。「技能」和「MCP」页面由随包的 `dsh-skill-mcp-panel` 提供。Desktop 随包功能通过原生「已安装」列表的扩展槽加入，只使用 Desktop 的重启后启停接口。俱乐部活动作为独立插件由用户手动安装后在普通插件列表中显示。市场页嵌入 `dsh-community-market` 现有界面；目录查询、安全校验、搜索、详情、来源管理和安装引擎仍由后者负责。

Desktop 默认启用该插件与 `community-market`。当 Market 来源配置从未初始化且为空时，Host 会校验并添加 `https://cqaiclub.asia/catalog-source.json`，同时将它设为当前来源。已有来源、已有选择以及用户后续禁用或删除来源都不会被覆盖或强制恢复。切换到没有嵌入接口的 Market provider 时，已安装页仍可用。

构建：

```sh
corepack yarn install --immutable
corepack yarn workspace cqai-dsh-plugin-market build
corepack yarn workspace cqai-dsh-plugin-market typecheck
corepack yarn workspace cqai-dsh-plugin-market test
```

运行时需要：

- 已安装页需要 Desktop Host 的 `desktopPlugins` 服务及上游 Plugin Manager Remote；随包功能由前者保存下次启动的启停选择。
- `patches/dsh-client-ui-plugin-manager@0.1.7-rc.2.patch` 提供原生页面的外层承载槽和随包卡片扩展槽，并在 CQAI Desktop 中收起原侧栏入口；升级上游运行时版本时需重新核对该版本补丁。
- 市场页需要 `dsh-community-market` 作为当前 Desktop provider，以及可访问的 catalog source。
- 重启优先调用 Electron preload 的 Desktop action；普通浏览器使用同源 Host 路由。
