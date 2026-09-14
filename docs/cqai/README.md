# CQAI 易宝工坊 扩展

这个目录保存 CQAI 的架构说明；Profile 模板位于 `dsh-desktop/profiles`，可构建的 DSH 插件源码统一位于
`E:/workspace/project/dsh-desktop/cqai-dsh-plugins`。每一个可独立安装、构建和发布的功能都应该是一个
`cqai-dsh-plugin-*` 包，而不是把所有业务代码继续放进同一个插件。

当前已经实现的扩展包括 `@cqaiclub/dsn-account`、`cqai-dsh-plugin-quicknav`、`cqai-dsh-plugin-imagegen` 和
`cqai-dsh-plugin-market`。
账号插件提供：

- CQAI Club OAuth/PKCE 浏览器登录和本地凭证管理；
- 账号、额度和可用模型目录；
- Desktop 设置页中的 CQAI Club 账号标签；
- `cqaiclub` LLM Provider，以及供后续业务插件复用的 Host 服务。

账号插件、`cqai-dsh-plugin-imagegen` 和 `cqai-dsh-plugin-market` 都作为 Desktop 的默认产品 bundle 自动进入保留的
`desktop` Profile，固定装配顺序为“账号 → e图宝 → 市场”。e图宝插件直接复用账号插件的登录态、额度和模型目录，默认使用
CQAI 图像 Provider，并提供：

- 文生图、图生图、多模型对比和电商模式；
- 共用的 Host 任务队列、持久历史、图库和模板；
- 无限画布、画布技能、技能库和默认关闭的 S3 同步；
- DSH 0.1.5 主区/侧边栏入口、会话附件和 Agent 工具集成。

快速入口插件提供：

- 左侧栏的固定「CQAI 工具」入口；
- 基于 `dsh-better-sidebar` 注册的 CQAI 工具页；
- 一个可以继续添加文件、终端、Git、子代理和自定义工具入口的工作台首页。

后者提供：

- CQAI 精选分类和品牌策略；
- 由 `dsh-community-market` 提供的完整市场入口和商店式界面；
- 对 `dsh-community-market` 来源、查询、详情和安装能力的复用。

Desktop 默认启用 Community Market。来源配置从未初始化且为空时，会校验并添加 `https://cqaiclub.asia/catalog-source.json` 作为当前来源；已有来源或用户后续的禁用、删除选择不会被覆盖。

插件业务逻辑放在 `dsh-desktop/cqai-dsh-plugins/cqai-dsh-plugin-*` 包中；产品品牌和 Electron 原生层直接维护在 `dsh-desktop/dsh-plugin-desktop` 中。`deepseek-harness` 上游源码保持独立，只有确实需要上游能力变更时才考虑修改。

## 目录规划

```text
docs/cqai/
├─ README.md                  # CQAI 架构和开发说明
└─ architecture.md            # 插件边界和组合规则
dsh-desktop/
├─ cqai-dsh-plugins/
│  ├─ cqai-dsh-plugin-quicknav/   # 左侧快速入口和 CQAI 工作台
│  ├─ cqai-dsh-plugin-imagegen/   # e图宝工作台、队列、历史、画布和 Agent 工具
│  ├─ cqai-dsh-plugin-market/     # CQAI 精选市场策略和来源配置
│  ├─ cqai-dsh-plugin-account/    # CQAI Club 共享账号、额度和模型目录
│  ├─ cqai-dsh-plugin-workbench/  # 后续独立工作台能力
│  └─ cqai-dsh-plugin-*/          # 继续按能力拆分
├─ profiles/
│  ├─ cqai-dsh-plugin-desktop/    # 本地开发 Profile 模板
│  └─ README.md                   # Profile 组合说明
└─ scripts/                       # 构建、安装和验证脚本
```

`account` 负责跨 CQAI 业务插件共享的身份、额度和模型能力；`imagegen` 消费该 Host 服务，但独立负责图像 Provider、任务、
历史和工作台；`market` 是独立边界，负责 CQAI 品牌、精选策略和受信任的产品默认来源声明。来源的校验、保存和用户选择仍由
`dsh-community-market` 负责。品牌不单独做插件，而是直接维护 `dsh-plugin-desktop` 的产品层。

其中 `cqai-dsh-plugin-market` 不直接复制 `dsh-community-market`。它复用现有市场的完整 UI、安装、安全校验和来源管理能力，并通过公开策略能力声明 `https://cqaiclub.asia/catalog-source.json`。只有从未应用产品默认值的空配置会自动采用该来源。

## 本地开发

```bash
cd /e/workspace/project/dsh-desktop
corepack yarn install
corepack yarn build:cqai-plugins
corepack yarn typecheck:cqai-plugins
```

只构建市场插件：

```bash
cd /e/workspace/project/dsh-desktop
corepack yarn workspace cqai-dsh-plugin-market build
corepack yarn workspace cqai-dsh-plugin-market typecheck
```

只构建并验证生图插件：

```bash
cd /e/workspace/project/dsh-desktop
corepack yarn workspace cqai-dsh-plugin-imagegen build
corepack yarn workspace cqai-dsh-plugin-imagegen typecheck
corepack yarn workspace cqai-dsh-plugin-imagegen test
```

只构建某一个插件：

```bash
cd /e/workspace/project/dsh-desktop
corepack yarn workspace cqai-dsh-plugin-quicknav build
corepack yarn workspace cqai-dsh-plugin-quicknav typecheck
corepack yarn workspace cqai-dsh-plugin-market build
corepack yarn workspace cqai-dsh-plugin-market typecheck
```

将需要手动调试的本地业务包链接到自定义 DSH Profile。默认的 `@cqaiclub/dsn-account`、
`cqai-dsh-plugin-imagegen` 和 `cqai-dsh-plugin-market` 已由 Desktop 安装包和保留的 `desktop` Profile 管理，不需要重复添加。
请先在 Desktop 的设置或托盘 Profile 菜单中创建一个自定义 Profile，例如 `cqai-dev`：

```bash
cd <你的-dsh-profile目录>
pnpm add "link:E:/workspace/project/dsh-desktop/cqai-dsh-plugins/cqai-dsh-plugin-quicknav"
pnpm add "link:E:/workspace/project/dsh-desktop/cqai-dsh-plugins/cqai-dsh-plugin-market"
```

然后使用 DSH 的插件命令把它加入目标 Profile：

```bash
dsh plugin --profile cqai-dev add "E:/workspace/project/dsh-desktop/cqai-dsh-plugins/cqai-dsh-plugin-quicknav"
dsh plugin --profile cqai-dev add "E:/workspace/project/dsh-desktop/cqai-dsh-plugins/cqai-dsh-plugin-market"
dsh plugin --profile cqai-dev add dsh-better-sidebar@0.19.0
```

安装完成后，在 Desktop 的 Profile 菜单中选择 `cqai-dev`，应用会通过 Electron 自己完成切换和重启。

如果目标 Profile 已经安装 `dsh-better-sidebar`，快捷入口会打开 CQAI 自己注册的工作台页面。`dsh-better-sidebar` 和 CQAI 插件不要重复写入两条相同的 Loader 挂载。

## 设计边界

- `dsh-desktop`：Electron 壳、窗口、Profile、打包和原生生命周期。
- `@cqaiclub/dsn-account`：CQAI Club 登录、共享账号/额度、模型目录和 `cqaiclub` LLM Provider。
- `cqai-dsh-plugin-imagegen`：默认使用 CQAI 的 e图宝工作台、队列、历史、画布和 Agent 图像工具；不保存 CQAI Token。
- `dsh-better-sidebar`：右侧工作台、Tab 和文件预览器注册服务。
- `cqai-dsh-plugin-quicknav`：CQAI 的左侧入口、工作台页面和导航扩展。
- `cqai-dsh-plugin-market`：CQAI 市场品牌、精选策略和默认来源声明；完整市场、来源校验与安装由 `dsh-community-market` 提供。

后续需要增加功能时，在 `dsh-desktop/cqai-dsh-plugins` 下继续创建 `cqai-dsh-plugin-xxx` 包，避免把应用业务代码写进桌面壳源码。

## 当前 Profile 模板

`dsh-desktop/profiles/cqai-dsh-plugin-desktop` 用于本地组合 `dsh-plugin-desktop`、默认账号插件、e图宝插件、
`dsh-better-sidebar` 和其他 CQAI 插件。它是开发模板，不会复制或修改 `dsh-desktop` 源码。
