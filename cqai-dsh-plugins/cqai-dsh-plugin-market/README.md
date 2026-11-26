# cqai-dsh-plugin-market

在 e宝工坊左侧打开「插件」，可进入官方的已安装插件列表以及「CQAI 插件市场」「技能」和「MCP」标签。`dsh-skill-mcp-panel` 提供技能和 MCP 编辑界面。`dsh-community-market` 提供 CQAI 市场页面，负责目录查询、安全校验、搜索、详情和来源管理，并通过官方插件管理器执行安装操作。也可以从首页的「添加数字员工」打开市场。

当市场来源配置从未初始化且为空时，Host 会校验 `https://cqaiclub.asia/catalog-source.json` 并设为默认来源。来源的选择、禁用和删除由当前 Profile 管理。

构建：

```sh
corepack yarn build
```
