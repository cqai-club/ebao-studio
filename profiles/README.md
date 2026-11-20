# Official Desktop Profile

当前只启动官方 DeepSeek Harness Desktop。官方启动器管理自己的 `desktop`
Profile，默认位于外层仓库的 `.official-desktop/official/home/profiles/desktop/`。

旧的 CQAI 桌面组合模板已移除。`cqai-dsh-plugins/` 和市场插件源码保留为后续
适配材料，不会自动安装或加载到官方 Profile。原有 `~/.dsh`、`~/.dsh-beta`
及账号、会话、作品数据保持独立。

外层 Yarn 只管理启动命令；官方运行时与外部 Profile 的依赖由官方 pnpm 流程管理。
