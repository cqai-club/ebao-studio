# 易宝工坊 用户指南

## 安装与首次启动

从产品下载入口获取 macOS 或 Windows 安装包。安装后的 易宝工坊 自带运行所需的 Electron、Node 和 DSH 依赖，普通用户不需要另行安装 Node.js 或 pnpm。

首次启动时，应用会准备默认 profile，并在本机启动官方 DSH Web surface。关闭窗口通常只会隐藏窗口；可以从托盘重新打开，选择 **退出** 才会结束应用和 Host 进程。

## Profile

Profile 是一组 DSH bundle、依赖和 patch 的组合。托盘中的 **Profile** 菜单会列出现有 profile，以及可按需创建的 `desktop` 和 `web` 默认 profile。

选择 profile 后应用会有序重启。新 profile 在 Host、窗口和浏览器客户端都成功启动后才会被记录为最近一次可用 profile；启动失败会回到上一次可用选择。官方 profile 默认使用同一个 DSH home，所以 sessions、settings 和 storage 通常不需要迁移。自定义配置（patch）如果主动改写持久化路径，则以该 profile 自己的设置为准。

切换 profile 不会把旧 profile 的插件偷偷复制到新 profile。要管理目标 profile，请在终端中显式写出 profile，或者在切换后使用终端里的默认命令。

## 窗口模式与材质

- **兼容模式**：保持 profile 的官方 layout/sidebar/conversation 组合完整，并把它放在独立的 36 像素 Desktop frame 下方。frame 可以拖动，图标操作仍可点击，官方 dialog 只会占用与 frame 无关的下方内容 viewport。
- **扩展窗口**：安装 Desktop 自有 layout 与 sidebar surface，并在其中承载官方 sidebar、conversation 和 details occupant。36 像素顶部 frame 与左侧 sidebar surface 组成一个带圆角内拐角的倒 L 材质区域。
- **增强模式**：保留独立 root registration 与紧凑内部 caption；macOS 使用 20 像素内容 inset 和 32 像素拖动区域，Windows 使用 32 像素 caption row，不复用扩展窗口的独立 frame。

macOS 自定义窗口模式可以打开或关闭透明材质。Windows 可关闭材质；仅 Windows 11 build 22621 及以上在支持时显示 Mica。旧版 Windows 亚克力偏好会安全地按关闭处理，并在设置文件可写时自动迁移。切换模式或材质都会重启应用，不会在正在运行的 renderer 中热替换 root slot 或窗口材质。Linux 只提供兼容模式。

## 本地 Web 端口

Desktop 默认让系统随机分配本地 Web 端口（`dsh-desktop.port: 0`），可避免与其他服务发生端口冲突。依赖浏览器 `localStorage` 的界面插件按 origin 隔离数据；如果这类插件需要在 Desktop 重启后继续读取设置，请在设置中指定一个固定端口：

```yaml
dsh-desktop:
  port: 43189
```

端口必须是 `0` 到 `65535` 之间的整数。修改后应用会有序重启。服务默认只监听 `127.0.0.1`；只有在“桌面设置”中确认危险提示并明确允许局域网访问后，才会改为监听所有网络接口。固定端口如果已被其他程序占用，Desktop 将无法启动；此时需要释放该端口，或把设置改回 `0` 或另一个空闲端口。

## 插件管理

插件是给 DSH 添加能力的扩展包，例如模型、工具、界面和工作流。易宝工坊 使用的就是官方 Harness 的插件体系，官方插件可以直接安装使用；多个插件遵循统一的约定，可以一起安装、一起工作。

普通 DSH 插件仍使用官方 CLI 语义：

```sh
dsh plugin --profile desktop add <plugin>
dsh plugin --profile desktop remove <plugin>
dsh plugin --profile desktop update
```

在 易宝工坊 托盘打开的终端中，裸 `dsh` 和不带 `--profile` 的 plugin 命令默认使用当前激活 profile：

```sh
dsh plugin add <plugin>
dsh plugin remove <plugin>
dsh plugin update
```

显式 `--profile <name>` 始终优先。插件变更后需要重启 易宝工坊，才能让新的 bundle 进入 Loader 组合。

## 打开终端

可以从托盘、Desktop 设置或 Desktop frame 选择 **Open DSH Terminal**；设置中的旁边提供重启下拉菜单，可以普通重启或 **重启到恢复模式**，两种操作都必须确认。macOS 会打开 Terminal，Windows 会优先使用 Windows Terminal，找不到时回退到 PowerShell 或命令提示符。

欢迎信息会显示：应用版本、当前 profile、profile 目录和 DSH home。Desktop 会在自己的 user-data 目录生成 `dsh`、`pnpm` 和 `node` 私有 shim，只对这个终端进程设置 PATH，不会修改系统 PATH 或用户 shell 配置。

## 更新

打包后的 macOS/Windows 应用会在后台检查仓库清单 `https://raw.githubusercontent.com/cqai-club/ebao-studio/master/release/desktop-version.json`。后台检查不阻塞启动；网络错误、非 200、超大响应、非法版本或服务端版本不新时保持静默。发现新版本时，应用会更新托盘，并且每个版本只发送一次非阻塞系统通知，不会自动下载；点击通知会聚焦 Desktop，并打开现有的升级确认流程。

托盘中的 **Check for Updates…** 是当前发行通道的手动检查：稳定版只接收稳定更新。即使已经是当前版本，也会显示结果；检查失败会提示稍后重试。当前只有稳定版具备应用内升级资产，Beta 仍可检查版本但不会下载或替换自身。用户取消确认不会开始下载。

确认下载后，稳定版会重新检查仓库清单，并使用 Electron Updater 从匹配的 GitHub Release 读取 `latest.yml`（Windows）或 `latest-mac.yml`（macOS）。下载目标必须与已确认的版本相同；更新元数据中的 SHA-512 必须匹配完整的 NSIS 安装器或 macOS ZIP。下载保存在应用自己的更新缓存中，不显示保存位置，也不会把 DMG 或 EXE 暴露给用户。校验、网络、取消或安装失败都不会破坏当前版本，并可从托盘重试。下载完成后会显示 **重启并更新**；只有选择它才会退出应用并由平台更新助手安装和重新打开新版本。macOS 自动升级仅适用于 Developer ID 签名并经 Apple 公证的官方构件；Windows 安装器尚未签名时仍可能显示 SmartScreen 提示。GitHub Release 同时提供 `SHA256SUMS`，供手动下载者独立核验。

## 排查

Desktop 的确认、警告与操作结果会打开独立、基于 shadcn 的桌面级模态窗口，而不是侵入官方页面的 overlay。恢复窗口会先展示进入原因，再提供 **插件管理**、**回滚**、**切换配置** 与 **诊断** 四个 Tab；它与新增 Profile 窗口顶部的 utility frame 都不会重复显示标题。

- **应用能够进入托盘**：右键托盘图标，选择 **导出诊断信息…**。确认隐私提示后，Desktop 会生成 `diagnostics-*.zip` 并在文件管理器中显示它。
- **应用持续闪退，无法进入托盘**：在 PowerShell 中直接运行安装后的程序并加上恢复参数。默认安装位置的命令如下；如果安装时修改过目录，请替换为实际的 EXE 路径。

  ```powershell
  & "$env:LOCALAPPDATA\Programs\易宝工坊\易宝工坊.exe" --export-diagnostics
  ```

  通过 npm 安装时，稳定版可运行 `dsh-desktop --export-diagnostics`，Beta 可运行 `dsh-desktop-beta --export-diagnostics`。这个命令不会启动 Host、profile、插件或窗口；完成后会在终端输出诊断 ZIP 的绝对路径。
- **诊断包内容**：包含最近的应用日志、本地 Crashpad `.dmp`、当前运行标记和 `system-info.txt`。系统信息会记录 Desktop、Electron、Node、平台和架构版本。日志会对可识别的认证凭据脱敏，但本地路径、工作区 ID、会话 ID 和崩溃时的内存片段仍可能存在。公开上传前必须检查；不适合公开的 dump 应通过可信渠道提供。
- **窗口消失了**：先检查系统托盘，关闭窗口不是退出。
- **插件没有出现**：确认命令作用于目标 profile，并重启应用。
- **终端命令找不到**：从托盘重新打开 Desktop 终端；系统 shell 的全局 PATH 不会被 Desktop 修改。
- **更新没有提示**：后台错误会静默；使用托盘手动检查查看结果。

更底层的生命周期、打包和平台限制属于开发者文档，见[文档索引](README.md)。
