# CQAI DSH 插件工作区架构

## 目标

CQAI Desktop 现在以 `dsh-desktop` 为主工作区，使用 Yarn 管理多个相互独立的 DSH 插件。插件可以单独构建、单独安装，也可以通过 Profile 组合成一个产品。

## 包边界

| 包 | 责任 | 不负责 |
| --- | --- | --- |
| `@cqaiclub/dsn-account` | CQAI Club OAuth/PKCE、共享账号与额度、模型目录、设置页账号标签、`cqaiclub` Provider | 业务插件自己的工作台和 Token 管理 |
| `cqai-dsh-plugin-quicknav` | 左侧固定入口、CQAI 工作台导航 | 品牌资源、市场安装流程 |
| `cqai-dsh-plugin-market` | CQAI 市场品牌、精选分类和推荐策略 | 复制整个 `dsh-community-market`、管理目录和安装 |
| `cqai-dsh-plugin-workbench` | 后续独立的业务工作台能力 | 通用导航入口 |

## 依赖规则

推荐依赖方向：

```text
cqai-dsh-plugin-quicknav  ──> dsh-better-sidebar
@cqaiclub/dsn-account    ──> dsh-better-sidebar（可选；用于独立账号工作台）
cqai-dsh-plugin-market    ──> dsh-community-market 的公开扩展能力
业务插件                 ──> @cqaiclub/dsn-account 的 Host 服务
```

CQAI 插件之间默认不要互相 import。需要共享类型或 UI 原语时，后续单独创建 `@cqai/dsh-plugin-shared`，不要让某个业务插件变成公共基础包。

## Profile 组合

Profile 只负责选择插件，不承载插件源码：

```text
dsh-desktop/
├─ cqai-dsh-plugins/
│  ├─ cqai-dsh-plugin-quicknav/
│  ├─ cqai-dsh-plugin-market/
│  ├─ cqai-dsh-plugin-account/
│  └─ cqai-dsh-plugin-workbench/
└─ ...

dsh-desktop/profiles/cqai-dsh-plugin-desktop/
└─ package.json
   ├─ dsh-plugin-desktop
   ├─ dsh-better-sidebar
   ├─ @cqaiclub/dsn-account
   ├─ cqai-dsh-plugin-quicknav
   └─ cqai-dsh-plugin-market
```

开发期间使用 `link:` 指向本地插件；发布时改成固定版本或内部 registry 版本。

`@cqaiclub/dsn-account` 是 Desktop 默认产品 bundle，由保留的 `desktop` Profile 自动加入且不可被普通插件管理操作关闭。
它只向 Client 暴露安全账号快照和 RPC，Access/Refresh Token 留在 Host 侧。

## 市场策略

当前 `cqai-dsh-plugin-market` 注册 CQAI 精选分类和品牌信息；完整的发现、搜索、详情、来源管理、安全校验和安装引擎由 `dsh-community-market` 唯一负责。它不会复制第二套市场 UI，也不会硬编码或自动切换远程来源，因此首次启动需要用户在 Desktop 中选择 `community-market` 并选择一个来源。

后续接入真实 CQAI catalog 时，应通过明确的内置 provider 或受信任的 source 配置完成默认来源选择；已经存在用户选择时，不应强制切回 CQAI。

## 产品品牌层

CQAI 的品牌直接维护在 `dsh-desktop/dsh-plugin-desktop` 产品层，不创建单独的品牌插件。需要修改的内容包括：

- Web 页面品牌 Logo 和品牌名称；
- Desktop 顶部标题栏；
- Electron 窗口标题；
- Windows、macOS、Linux 应用图标；
- 系统托盘图标；
- 安装包和卸载器图标。

这些资源和身份配置应该作为 Desktop 产品的一部分统一构建，避免品牌插件和原生窗口品牌不一致。
