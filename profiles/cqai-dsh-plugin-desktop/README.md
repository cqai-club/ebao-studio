# cqai-dsh-plugin-desktop Profile

这是 CQAI 本地桌面组合的 Profile 模板。它把本地 `dsh-plugin-desktop`、默认的 `@cqaiclub/dsn-account`、`dsh-community-market`、`dsh-better-sidebar` 和 `dsh-desktop/cqai-dsh-plugins` 中的 CQAI 插件组合在一起。产品品牌、窗口标题、托盘和安装包图标直接维护在 `dsh-desktop/dsh-plugin-desktop`。

当前模板使用本地路径依赖，适合开发阶段。发布时应把 `dsh-plugin-desktop` 和 CQAI 插件固定到明确版本，或在产品仓库中统一构建并发布。

## 使用方式

第一次使用前，先在 `dsh-desktop` workspace 构建桌面壳：

```powershell
cd E:\workspace\project\dsh-desktop
corepack yarn workspace dsh-plugin-desktop build
```

这个目录是组合模板，不建议直接在这里执行安装。因为 `dsh-plugin-desktop` 依赖
`dsh-desktop` 根工作区中的本地 `dsh-community-market`，应从根工作区构建：

```bash
cd /e/workspace/project/dsh-desktop
corepack yarn install
corepack yarn build
```

实际运行时，默认的 `desktop` Profile 会由 Electron 自动加入账号插件。若要调试其他本地业务插件，请在 易宝工坊 的设置或托盘 Profile 菜单中创建一个自定义 Profile（例如 `cqai-dev`），再把 `dsh-better-sidebar` 和构建后的 CQAI 插件链接到这个 Profile，最后在 Electron 中选择它并重启。`cqai-dsh-plugin-quicknav` 依赖 `dsh-better-sidebar` 的 `betterSidebar` Client service，不能遗漏这个 bundle。

首次登录在 Desktop 设置页左侧的 `CQAI Club` 标签完成。账号凭证只由 Host 保存，业务插件通过 `@cqaiclub/dsn-account`
的 Host 服务获取安全快照。

如果使用 易宝工坊 Electron 启动器，则选择这个 Profile 作为当前 Web-capable Profile。
