# cqai-dsh-plugin-quicknav

CQAI 的第一个 DSH Desktop 插件，负责把左侧快捷入口和 `dsh-better-sidebar` 工作台连接起来。

## 扩展方式

新增工具页面时，在 `src/client/index.tsx` 中调用 `ctx.betterSidebar.registerTab()`；需要增加左侧入口时，在 `sidebar.footer.action` 中注册一个新的 slot occupant。

页面 ID 必须使用 `cqai-dsh-plugin-quicknav:` 前缀，避免和其他生态插件冲突。

## 运行要求

- DSH `0.1.5-rc.1+`
- `dsh-better-sidebar` `0.19.x`
- DSH Desktop 的 Web Client Profile
