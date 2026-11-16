# e宝工坊文档

[English](README.en.md) · [仓库入口](../README.md)

当前应用是固定版本的官方 DeepSeek Harness Desktop。e宝业务插件和账号将另行接入；旧版社区桌面文档仅用于历史追溯。

## 当前入口

| 文档 | 范围 |
| --- | --- |
| [官方 Desktop 参考](../deepseek-harness/apps/desktop/README.zh.md) | 当前桌面行为、开发、打包、插件与本地设置 |
| [当前开发与发行边界](development-release.md) | 根 Yarn 命令、官方 pnpm 委托、隔离数据与验证 |
| [参与贡献](../CONTRIBUTING.md) | 代码归属、提交与反馈 |
| [官方 Desktop 基线决策](../.agents/notes/implemented/process/2026-11-16-official-desktop-baseline.zh.md) | 替换社区桌面壳、停用业务插件与后续接入边界 |

## 历史产品参考

以下文件保留的是旧 e宝/社区桌面的设计或使用说明。其功能、命令、Profile 布局、插件服务和发布流程不适用于当前官方基线；与已移除桌面包相关的旧路径也可能已失效。

| 历史文档 | 原内容 |
| --- | --- |
| [旧用户指南](user-guide.md)、[旧常见问题](faq.md) | 旧安装包、Profile、插件、模式与更新 |
| [旧架构](architecture.md)、[为什么做 Desktop](why-desktop.md) | 社区桌面壳及原生适配设计 |
| [旧插件开发](plugin-development.md)、[插件生态倡议书](plugin-ecosystem.md) | 旧 Desktop 服务与社区生态设计 |
| [CQAI 扩展说明](cqai/README.md) | 尚待重新接入的业务插件 |
| [Community Market 源码与文档](../dsh-community-market/README.zh.md) | 保留的市场实现，当前未激活 |
| [Community Fabric 文档](../dsh-community-fabric/README.zh.md) | 保留的互操作提案，当前不参与构建 |
| [历史 e宝发行版](https://github.com/cqai-club/ebao-studio/releases) | 过去已发布安装包及其版本说明 |

根 `README.md` 和 `README.en.md` 是当前中英入口，`README.zh.md` 保留旧链接兼容作用。日期化 Agent Notes 用于追溯决策；新决策优先于被取代的旧拓扑说明。官方子模块自己的文档负责其实际实现，外层文档负责启动入口与集成边界。
