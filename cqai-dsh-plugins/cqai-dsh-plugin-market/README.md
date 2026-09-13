# cqai-dsh-plugin-market

CQAI 对 `dsh-community-market` 的品牌与策略插件：注册 CQAI 精选分类、产品默认来源，并让完整市场壳显示 CQAI 品牌。目录查询、安全校验、搜索、详情、来源管理和安装引擎仍由 `dsh-community-market` 负责。

Desktop 默认启用该插件与 `community-market`。当 Market 来源配置从未初始化且为空时，Host 会校验并添加 `https://cqaiclub.asia/catalog-source.json`，同时将它设为当前来源。已有来源、已有选择以及用户后续禁用或删除来源都不会被覆盖或强制恢复。该插件不重复实现市场 UI 或安装确认流程。

构建：

```powershell
cd E:\workspace\project\dsh-desktop
corepack yarn install --immutable
corepack yarn workspace cqai-dsh-plugin-market build
corepack yarn workspace cqai-dsh-plugin-market typecheck
```

运行时需要：

- `dsh-community-market` 已作为当前 Desktop provider 启用；
- 默认来源可以访问，或用户已经配置另一个 Community Market catalog source；
- 要执行安装、卸载和重启，还需要 Desktop 的 `desktopProfiles`、`desktopPnpm`、`desktopActions` 和 `desktopPlugins`。
