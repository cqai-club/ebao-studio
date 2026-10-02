<p align="center">
  <img src="assets/desktop-hero-zh.png" alt="e宝工坊桌面应用" width="100%">
</p>

# e宝工坊

[English](README.en.md) · [下载](https://github.com/cqai-club/ebao-studio/releases) · [用户指南](docs/user-guide.md)

e宝工坊是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的开源桌面应用，面向 Windows 和 macOS。它把上游的本地 Web 客户端、Host 服务和插件系统带进原生窗口，并提供系统托盘、Profile 管理、终端、恢复和插件管理。安装版自带所需运行环境。

本仓库固定一个**不修改源码**的上游版本，桌面能力由仓库自己的插件和 Electron 启动器组合。项目由社区独立维护，与深度求索及上游官方团队没有隶属或背书关系。

<p align="center">
  <img src="assets/desktop-chat-zh.png" alt="e宝工坊对话界面截图" width="100%">
</p>

## 使用

从 [Releases](https://github.com/cqai-club/ebao-studio/releases) 选择适合系统的安装包；具体支持平台和安装提示以对应 Release 为准。首次使用及 Profile、插件、更新说明见[用户指南](docs/user-guide.md)和[常见问题](docs/faq.md)。

- **桌面体验：** 本地启动和管理 DSH，提供窗口、托盘、浏览器访问与原生终端。
- **工作配置：** 用 Profile 组合插件和设置，并通过启动恢复功能处理配置问题。
- **插件扩展：** 通过 [DSH Community Market](dsh-community-market/README.zh.md) 和仓库内的插件包扩展能力；插件开发见[开发指南](docs/plugin-development.md)。

## 从源码开发

需要 Node.js `^22.19.0` 或 `>=24.0.0`、Git 和 Corepack；仓库使用 Yarn `4.18.0`。在**仓库根目录**初始化固定的上游子模块并安装依赖：

```bash
git submodule update --init --recursive
corepack.cmd yarn install --immutable
```

上面的 `corepack.cmd` 用于 Windows Git Bash；PowerShell、macOS 或 Linux 使用 `corepack yarn`。

### 启动 Stable

```bash
corepack.cmd yarn dev
```

### 启动 Beta（Windows Git Bash）

与本地安装的稳定版分开使用 Profile 时，沿用独立的 `~/.dsh-beta`：

```bash
export DSH_HOME="$(cygpath -w "$HOME/.dsh-beta")"
corepack.cmd yarn dev:beta
```

`DSH_HOME` 指定 Profile、会话等 DSH 数据目录；安装版稳定版默认使用 `~/.dsh`。如果 Beta 曾在自己的应用数据中保存过“数据目录”选择，该选择会优先于环境变量。要把**开发版的 DSH Home 和 Electron 用户数据**也与已安装的 Beta 分开，改用两个独立目录：

```bash
mkdir -p "$HOME/.dsh-beta-dev" "$HOME/.ebao-beta-dev-user-data"
export DSH_HOME="$(cygpath -w "$HOME/.dsh-beta-dev")"
export DSH_DESKTOP_DEV_USER_DATA="$(cygpath -w "$HOME/.ebao-beta-dev-user-data")"
corepack.cmd yarn dev:beta
```

PowerShell 启动 Beta 时，可用 `$env:DSH_HOME = Join-Path $HOME '.dsh-beta'`，再运行 `corepack yarn dev:beta`。macOS 或 Linux 可用 `DSH_HOME="$HOME/.dsh-beta" corepack yarn dev:beta`。

`dev` 和 `dev:beta` 会准备 Market、Agents Anywhere 和相关插件依赖，可能访问网络并更新仓库中的生成产物或锁文件。提交前检查工作区改动。

### 检查与目录

```bash
corepack.cmd yarn check
corepack.cmd yarn check:desktop-variants
```

`check` 是完整的无界面检查；修改 Stable 与 Beta 的共享桌面代码后，还要用 `check:desktop-variants` 核对两版。实验性 Next 可通过 `corepack.cmd yarn dev:next` 单独启动。

| 目录 | 用途 |
| --- | --- |
| `dsh-plugin-desktop-beta/`、`dsh-plugin-desktop/` | Beta 与 Stable 桌面实现 |
| `dsh-desktop-next/` | 独立的实验性 Next 桌面壳 |
| `dsh-community-market/`、`cqai-dsh-plugins/` | 市场与产品插件 |
| `deepseek-harness/` | 固定版本的上游子模块；桌面功能开发不修改其源码 |

更多资料见[文档索引](docs/README.md)、[架构说明](docs/architecture.md)和[参与贡献](CONTRIBUTING.md)。上游子模块使用自己的 pnpm workspace，相关操作通过仓库根目录的 `upstream:*` 脚本执行。

## 社区与许可

交流与反馈可通过 [GitHub Issues](https://github.com/cqai-club/ebao-studio/issues) 提交。

本项目采用 [MIT License](LICENSE)。“DeepSeek Harness”名称仅用于说明技术来源和兼容关系。
