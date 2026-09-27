# 易宝工坊 常见问题

[English](faq.en.md)

本页回答当前版本最常见的安装、平台、运行环境和插件问题。功能范围以[易宝工坊 GitHub Releases](https://github.com/cqai-club/ebao-studio/releases)和[用户指南](user-guide.md)为准。

## 易宝工坊 是什么？

易宝工坊 是面向 Windows 和 macOS 的开源 DeepSeek Harness 桌面客户端。它把官方 Harness 的本地 Web UI、Host 服务和插件系统装进原生桌面应用，并提供窗口、系统托盘、终端、更新和 profile 管理。

## 这是 DeepSeek 官方产品吗？

不是。易宝工坊 是社区维护的独立开源项目，不隶属于 DeepSeek，也未获得 DeepSeek 官方背书。项目名称仅用于说明它与官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的技术关系。

## 支持哪些操作系统？

当前预发布构件支持 Windows x64 和 universal macOS（Intel 与 Apple Silicon）。`v0.0.6` 是明确标注的**未签名 macOS 测试发布**，包含 CQAIclub 登录与多平台发布改进；测试者必须主动下载，并在 Gatekeeper 提示中手动授权后才能打开；它不是 macOS 生产自动升级包。此前的 `v0.0.4` 修复了 `v0.0.3` 的 Electron 启动导入错误。Windows 构件尚未进行 Authenticode 签名，可能显示 SmartScreen 提示。当前没有 Linux 安装包。

## 需要安装 Node.js、pnpm 或 DSH 吗？

不需要。安装包已经包含 Electron、Node.js、pnpm 和固定版本的 DSH 依赖。普通用户下载安装后即可启动，Desktop 也不会修改系统全局 PATH 或用户的 shell 配置。

## 首次启动需要下载运行环境吗？

不需要另行下载 Node.js 或 Harness 核心。安装包较大，是因为运行时和固定版本依赖已经包含在内，以换取更确定的首次启动和版本组合。使用云端模型、检查更新或下载新版本时仍然需要网络。

## 易宝工坊 会修改官方 Harness 吗？

不会。仓库固定一个未修改的官方 Harness 上游版本。兼容模式在独立 overlay frame 下运行上游默认 Web client；扩展窗口与增强模式分别通过插件/profile composition 边界安装各自的 Desktop root registration，并继续承载官方 slot occupant。所有模式都不会直接修改上游源码。

## 数据是否保存在本地？

Desktop Host、profile 和 DSH home 位于本机。是否向外部服务发送内容取决于用户配置的模型或工具提供商；使用云端模型时，相应请求仍会发送给该提供商。

## 可以安装 DSH 插件吗？

可以。易宝工坊 使用官方 Harness 插件体系。可以从托盘打开 DSH Terminal，然后运行 `dsh plugin add`、`dsh plugin remove` 和 `dsh plugin update`；命令默认作用于当前激活的 profile，插件变更后需要重启 Desktop。

## Desktop profile 和已有 web profile 会自动同步吗？

不会自动复制插件。每个 profile 都有自己的 bundle 和依赖组合；切换 profile 后，终端中的默认插件命令会作用于当前 profile，也可以使用 `--profile <name>` 显式指定目标。

## 应用如何更新？

打包后的稳定版会在后台检查版本，但不会静默安装。发现新版本后先征得用户确认；确认后 Electron Updater 会把已校验的 Windows NSIS 安装器或 macOS ZIP 暂存在应用私有缓存中，不显示保存位置、不打开 DMG，也不把安装器交给用户手动运行。暂存完成后，选择 **重启并更新** 才会应用更新并重新打开；选择稍后则继续运行当前版本。网络、元数据、下载、取消或安装失败都不会破坏当前安装，并且可以重试。macOS 自动升级要求官方构件已完成 Developer ID 签名和 Apple 公证。未签名的 `v0.0.6` macOS 测试发布不属于这项生产承诺：请测试者手动下载并打开 DMG，且仅在获授权测试时通过 Gatekeeper。

## 在哪里下载和报告问题？

从[易宝工坊 GitHub Releases](https://github.com/cqai-club/ebao-studio/releases)下载安装包。遇到问题时先查看[用户指南的排查部分](user-guide.md#排查)，仍无法解决再提交 [GitHub Issue](https://github.com/cqai-club/ebao-studio/issues/new/choose)，并附上操作系统、应用版本、复现步骤和错误信息。
