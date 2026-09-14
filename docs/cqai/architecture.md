# CQAI DSH 插件工作区架构

## 目标

CQAI Desktop 现在以 `dsh-desktop` 为主工作区，使用 Yarn 管理多个相互独立的 DSH 插件。插件可以单独构建、单独安装，也可以通过 Profile 组合成一个产品。

## 包边界

| 包 | 责任 | 不负责 |
| --- | --- | --- |
| `@cqaiclub/dsn-account` | CQAI Club OAuth/PKCE、共享账号与额度、模型目录、设置页账号标签、`cqaiclub` Provider | 业务插件自己的工作台和 Token 管理 |
| `cqai-dsh-plugin-quicknav` | 左侧固定入口、CQAI 工作台导航 | 品牌资源、市场安装流程 |
| `cqai-dsh-plugin-imagegen` | CQAI 默认图像 Provider、文生图/图生图、队列、历史、画布和 Agent 工具 | CQAI 登录与 Token 存储、聊天模型默认选择 |
| `cqai-dsh-plugin-market` | CQAI 市场品牌、精选分类、推荐策略和产品默认来源声明 | 复制整个 `dsh-community-market`、管理目录和安装 |
| `cqai-dsh-plugin-workbench` | 后续独立的业务工作台能力 | 通用导航入口 |

## 依赖规则

推荐依赖方向：

```text
cqai-dsh-plugin-quicknav  ──> dsh-better-sidebar
@cqaiclub/dsn-account    ──> dsh-better-sidebar（可选；用于独立账号工作台）
cqai-dsh-plugin-imagegen ──> @cqaiclub/dsn-account 的 Host 服务
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
│  ├─ cqai-dsh-plugin-imagegen/
│  ├─ cqai-dsh-plugin-market/
│  ├─ cqai-dsh-plugin-account/
│  └─ cqai-dsh-plugin-workbench/
└─ ...

dsh-desktop/profiles/cqai-dsh-plugin-desktop/
└─ package.json
   ├─ dsh-plugin-desktop
   ├─ dsh-better-sidebar
   ├─ @cqaiclub/dsn-account
   ├─ cqai-dsh-plugin-imagegen
   ├─ cqai-dsh-plugin-quicknav
   └─ cqai-dsh-plugin-market
```

开发期间使用 `link:` 指向本地插件；发布时改成固定版本或内部 registry 版本。

`@cqaiclub/dsn-account`、`cqai-dsh-plugin-imagegen` 与 `cqai-dsh-plugin-market` 是 Desktop 默认产品 bundle，由保留的
`desktop` Profile 按“账号 → e图宝 → 市场”的顺序自动加入，且不可被普通插件管理操作关闭。账号插件只向 Client 暴露安全
账号快照和 RPC，Access/Refresh Token 留在 Host 侧；e图宝插件通过 Host 服务调用 CQAI，不把 Token 交给浏览器、画布技能
或第三方脚本。

## 生图 Provider 边界

`cqai-dsh-plugin-imagegen` 的默认 Provider 标识为 `cqai`。任务未指定 Provider 时使用 CQAI 账号模型目录中的默认图像模型；
自定义渠道统一使用 `custom:<channelId>`，且只能由用户或 Agent 参数显式选择。CQAI 请求失败时不会自动切换到第三方渠道。
插件可以临时切换当前任务的图像模型，但不会覆盖用户现有的聊天模型选择。

## 市场策略

`cqai-dsh-plugin-market` 注册 CQAI 精选分类、品牌信息和 `https://cqaiclub.asia/catalog-source.json` 产品默认来源；完整的发现、搜索、详情、来源管理、安全校验和安装引擎仍由 `dsh-community-market` 唯一负责。Desktop 在没有显式市场选择时启用 `community-market`，Market 仅对从未初始化的空来源配置校验并采用该默认来源。

产品默认来源通过本地策略声明，远端 Manifest 仍必须经过标准来源契约与网络安全校验。已有来源、已有选择或用户后续删除来源时，不会强制切回 CQAI，也不会把默认来源自动加回。

## 产品品牌层

CQAI 的品牌直接维护在 `dsh-desktop/dsh-plugin-desktop` 产品层，不创建单独的品牌插件。需要修改的内容包括：

- Web 页面品牌 Logo 和品牌名称；
- Desktop 顶部标题栏；
- Electron 窗口标题；
- Windows、macOS、Linux 应用图标；
- 系统托盘图标；
- 安装包和卸载器图标。

这些资源和身份配置应该作为 Desktop 产品的一部分统一构建，避免品牌插件和原生窗口品牌不一致。
