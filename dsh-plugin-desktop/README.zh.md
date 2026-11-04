# e宝工坊

[English](README.md) | 中文

e宝工坊 已迁移到 `anywhere-labs/dsh-desktop` 提交 `117e489913` 的新版桌面架构，围绕未经修改的官方 DeepSeek Harness checkout 组合产品能力。Stable 与 Beta 共享该架构，使用根目录 `upstream.json` 记录的精确源码构建的 `0.2.2-alpha.3` 运行时。产品身份、版本、更新源与账号数据继续由 e宝工坊管理。

Electron 主进程负责窗口、原生权限、下载、恢复和 Publisher Worker 生命周期。独立的 Electron Node 模式 Host 运行官方 Web 前端与 Profile 插件。旧版可复用工具和原生界面源码保存在私有的 `dsh-desktop-shared` workspace。兼容呈现跟随官方前端，不复制聊天实现。

## 启动与验证

使用 Node.js `^22.19.0` 或 `>=24.0.0`，以及根目录 Corepack Yarn `4.18.0`。从仓库根目录运行：

```sh
corepack yarn install --immutable
corepack yarn dev
corepack yarn workspace dsh-plugin-desktop check
corepack yarn check:desktop-variants
```

`dev` 会明确打开图形应用。构建、类型检查、测试和无界面 Host 检查均不打开窗口。根目录开发命令在启动前刷新 dshmarket 和官方 Agents Anywhere 构建；首次准备需要联网。锁定的主运行时包含 Python、Node、pnpm 和 Office 技能。本地预览可通过 `DSH_MAC_SMOKE_ARCH` 选择一个经过验证的 macOS 架构；正式打包默认包含两个架构。

## 产品能力

普通 Profile 保留 CQAI Club 账号与模型、ImageGen、发布器、IM、CQAI 市场、Skills/MCP 管理器、PPT 编辑器、产品展示与 CQAI Club 主题。应用自有 bundle 层会在包操作和 HMR 时重新组合，用户的 manifest 与 patch 继续生效。安全模式不加载这些产品插件，以保持恢复能力可用。

私有的 `desktopRuntime` 桥接支持 CQAI 账号浏览器登录与发布操作。原生文件选择仅返回不透明标识符，本地视频路径保留在 Electron 主进程。Worker 方法有明确白名单，请求具有大小限制和取消机制；上传过程中退出会先询问是否中断。中断的发布任务不会自动重试。

## 数据与更新

Harness 默认目录为 `~/.dsh`。应用内保存的目录优先于 `DSH_DESKTOP_HOME`；未作选择时才使用环境变量。一个 Harness home 内的 Profile 共享设置与凭据，因此不隔离账号。恢复功能会在修复前备份已有 Profile 文件。

更新与发行说明使用 e宝工坊仓库及对应通道，桌面壳不会把 e宝工坊安装重定向到上游 DSH Desktop 安装包。

新版桌面壳的窄服务边界见[插件服务](docs/plugin-services.zh.md)。平台安装包和真实账号验收与无界面验证分别进行。
