# cqai-dsh-plugin-market

CQAI 对 `dsh-community-market` 的品牌与策略插件：注册 CQAI 精选分类，并让完整市场壳显示 CQAI 品牌。目录查询、安全校验、搜索、详情、来源管理和安装引擎仍由 `dsh-community-market` 负责。

当前版本不自动添加或切换远程 catalog source，也不重复实现市场 UI 或安装确认流程。用户需要先在 Desktop 中启用 `community-market` 并选择一个来源。启用 CQAI 插件后，完整市场会以“CQAI 插件市场”品牌展示。

构建：

```powershell
cd E:\workspace\project\dsh-desktop
corepack yarn install --immutable
corepack yarn workspace cqai-dsh-plugin-market build
corepack yarn workspace cqai-dsh-plugin-market typecheck
```

运行时需要：

- `dsh-community-market` 已作为当前 Desktop provider 启用；
- 一个已启用的 Community Market catalog source；
- 要执行安装、卸载和重启，还需要 Desktop 的 `desktopProfiles`、`desktopPnpm`、`desktopActions` 和 `desktopPlugins`。
