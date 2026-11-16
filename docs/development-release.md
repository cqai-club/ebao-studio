# 官方 Desktop 开发与发行边界

[English](development-release.en.md)

当前仓库直接使用固定的 DeepSeek Harness 官方 Desktop。原 Stable/Beta/Next 社区桌面包和 e宝发布工作流已停用；CQAI 业务插件源码保留，等待后续单独接入。本页取代此前的社区桌面开发与 e宝发行流程说明。

## 初始化

```bash
corepack yarn upstream:init
corepack yarn install --immutable
corepack yarn upstream:install
corepack yarn upstream:prepare-electron
```

`corepack yarn setup` 可组合执行上游初始化、依赖安装和 Electron 准备。pnpm 安装依赖不会自动下载 Electron；启动或运行无界面 Desktop 测试（含 Windows）前需完成 `upstream:prepare-electron`。已有 checkout 出现陈旧 pnpm 链接时，可运行 `corepack yarn upstream:repair-install`，清理失效的工作区依赖链接后，按锁文件重新安装。

要求 Node.js `>=24.9.0` 和 Corepack。外层使用 Yarn `4.18.0`；`deepseek-harness/` 使用其 package manifest 固定的 pnpm。外层没有活动的应用/插件 workspace，也不将官方子模块纳入 Yarn 的依赖图。

官方源码 pin 为 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`，对应版本 `0.2.2-rc.1`。更新 pin 和元数据应单独提交，不在业务功能变更中修改官方源码。

## 构建与检查

```bash
corepack yarn build
corepack yarn typecheck
corepack yarn test
corepack yarn check
```

`build` 调用官方 `build:artifacts`；`typecheck` 检查官方 `apps/desktop/tsconfig.json`；`test` 运行外层启动器 Node 测试和官方 Desktop 的 Vitest 测试。`check` 依次组合仓库布局、启动器测试、官方构建、Desktop 类型检查和 Desktop 测试。根脚本负责准确命令，上游负责实现范围。构建、类型检查和测试保持无界面可运行，不能用它们代替真实图形启动、账号登录或平台安装包验收。

## 启动与数据隔离

```bash
corepack yarn dev
# 使用已有构建：
corepack yarn start
```

两条命令会明确打开官方 Desktop，保留官方产品身份与默认功能。启动器默认将 Harness 数据放在 `.official-desktop/home`，将 Electron 用户数据放在 `.official-desktop/electron-user-data`；解析后的路径以启动日志为准。这些本机目录不提交到 Git。

现有 `~/.dsh`、`~/.dsh-beta` 和 e宝应用数据保留。旧 Profile 的可执行依赖、锁文件、已安装插件和浏览器分区不自动迁入官方 `desktop` Profile。后续数据迁移应独立设计、验证并记录。

首次运行可能需要下载官方固定的内置运行时。运行时准备失败时应处理具体错误，不以社区壳或旧产物替代官方实现。

## 业务源码与接入范围

保留的 `cqai-dsh-plugins/`、`dsh-community-market/`、`dsh-community-fabric/` 和 `matrixmedia-publisher/` 不参与当前默认安装、构建或启动。CQAI 账号、发布器、业务工具、AA、自定义市场和主题不属于本次官方基线验收范围。

重新接入能力时，应说明其官方扩展接口、所需 Host/原生服务、依赖安装、用户数据和验证结果。旧 `desktopRuntime`、旧渠道镜像或其他社区壳私有接口不能被视为官方 Desktop 已提供的服务。

## 发行状态

本次仅切换源码开发基线，没有创建新 e宝版本、tag、安装包或公开 Release。历史 e宝 Releases 与 `release/` 文件保留为历史记录，不作为当前官方 Desktop 的发行指令。

根 `package:dir` 委托官方未封装安装器的应用目录打包；`dist:mac:arm64`、`dist:mac:x64` 和 `dist:win` 分别委托官方对应目标的未签名打包。当前没有活动的上传或公开发布工作流。

官方平台打包、签名、更新和发布步骤见[固定的官方 Desktop 参考](../deepseek-harness/apps/desktop/README.zh.md)。运行本地构建或检查不代表这些发行步骤已完成；重新发布 e宝产品身份与业务能力需要单独的集成和发行变更。

当前边界由[官方 Desktop 基线 Agent Note](../.agents/notes/implemented/process/2026-11-16-official-desktop-baseline.zh.md)负责。
