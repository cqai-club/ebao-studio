# e宝工坊内置插件 Harness 兼容性排查

初次排查日期：2026-11-09。以下记录的是升级前 `0.2.2-alpha.3` 的现象，不代表当前版本状态。2026-11-10 已升级至 `0.2.2-rc.1`，并修复首页、主题、账号、插件管理、Skills／MCP、社区市场和 PPT 的接入；最终验证以本次发布的检查结果为准。

初次排查结论：9 个默认产品 bundle 的 Host 均能激活，其中 6 个的产品界面或入口需要适配；社区市场需要随插件管理入口一起调整。Host 激活状态不能证明 Client 页面已经生效。

## 范围与验证方式

- 默认清单来自 `dsh-plugin-desktop-beta/src/ebao-bundles.ts` 的 `EBAO_PRODUCT_BUNDLES`，共 9 个。Stable 清单相同。
- 在临时 Profile 和临时用户目录中启动现有 Beta 构建，用无头 Chromium 加载已安装的官方 `0.2.2-alpha.3` Web 前端；页面使用当前 Desktop 的无模式参数 URL 和不含 `cqaiPrimaryLogin` 的桥接标记。
- 读取真实 Host 的插件管理结果和真实 Client 的插槽注册情况，打开 e图宝、多平台发布和官方插件页，并尝试打开 CQAI Club 独立面板。
- Stable/Beta 的变体检查通过：154 个共享源文件对齐。此次浏览器实测运行 Beta；没有单独运行 Stable 和 Next 的完整浏览器回归。
- 未执行真实登录、付费模型请求、内容发布、IM 发消息或 AA 设备配对，因此相关端到端能力不属于本次通过结论。

## 默认插件结果

| 插件 | 结果 | 证据与适配范围 |
| --- | --- | --- |
| `cqai-dsh-plugin-desktop-presentation`（首页） | 需要适配 | `src/client/index.tsx:199` 仍要求 URL 中的 `dsh-desktop-mode=extended/advanced`，当前桌面没有这个参数。它依赖的 `conversation.hero.headline`、`conversation.hero.dock` 也不再由新版 Conversation 声明。实测没有机器人和这两个插槽的 occupant。需迁移首页呈现接入点，并同步现有依赖旧模式属性的 CSS。 |
| `cqai-dsh-plugin-cqai-club-theme`（主题） | 需要适配 | `src/client/index.ts:23` 使用同样的旧模式门控，导致配色、设置项和壁纸均不注册。`src/client/wallpaper.ts:35` 还要求旧 `.dshDesktopFrame`、`.dshDesktopMainPanelSurface` 和 `.eBaoHomeDock` 结构。实测常规设置没有 `cqai-club-theme`。需同步启用条件与壁纸挂载范围。 |
| `cqai-dsh-plugin-market`（产品插件管理） | 需要适配 | `src/client/index.tsx:33` 要求 `dshDesktop.cqaiPrimaryLogin === true`，当前 preload 不提供这个字段，`apply` 直接返回。即使补回标记，`plugins.shell`、`plugins.installed.cards` 也已从官方插件页移除。需使用新版 `plugins.tab`、`plugins.item`、`plugins.bundle.config` 等受支持接口重新接入。不能仅靠补 TypeScript 插槽声明解决。 |
| `dsh-skill-mcp-panel`（Skills／MCP） | 需要联动适配 | `src/client.ts:2938` 只注册到 `cqai.pluginManagement.skills/mcp`；这两个插槽由未挂载的旧产品管理外壳声明。实测两者都没有 occupant，旧 Skills／MCP 页失去入口。Host 仍 active，且当前组合已隔离其旧 `mcpManager`，因此不能把页面入口缺失表述为所有技能或 MCP 后端都失效。需与新版产品管理入口一起迁移。 |
| `dsh-ppt-composer`（PPT 模板） | 需要适配 | 已安装的 `lib/client.js:1355` 仍注册 `conversation.hero.modeActions`、`conversation.input.accessory`、`conversation.hero.dock`。这些旧插槽在实测中全部没有 occupant，新版 Conversation 合同也不再声明它们。需通过桌面拥有的 vendored 补丁迁移模板选择与输入附属界面，并保留原有 Host 能力；本次临时 Host 未传入打包 Office runtime，不能据此判断 Office 引擎可用性。 |
| `@cqaiclub/dsn-account`（账号） | 需要适配产品入口 | `src/client/index.tsx:45` 同样检查缺失的 `cqaiPrimaryLogin` 标记。账号会退回普通设置页；实测 `settings.section` 中有 `cqaiclub-dsn-account`，但 `main` 中没有 `cqai-club`，打开该面板明确报未注册。需对齐桌面能力判断，并恢复 CQAI 入口及关联扩展。账号协议与后端相关测试通过。 |
| `cqai-dsh-plugin-imagegen`（e图宝） | 本轮未发现相同接入阻断 | 主面板和侧栏入口均注册，能打开普通生图界面；未登录时显示需要连接 CQAI Club，符合临时环境状态。64 项选定兼容性测试通过。实际生图及所有二级功能尚需登录后回归。 |
| `cqai-dsh-plugin-publisher`（多平台发布） | 本轮未发现相同接入阻断 | 主面板和侧栏入口均注册，能打开页面。100 项选定客户端合同、工具运行时、发布确认和文章交接测试通过。未执行真实平台登录或发布。 |
| `@xmanrui/dsh-im` | 本轮未发现相同接入阻断 | Host active，Client 注册了 `xmanrui-dsh-im` 主面板、设置项和 `plugins.detail.actions`。包声明的兼容版本仍偏旧，但不能据此直接判为故障；需要连接具体 IM 渠道后单独验证。 |

## 需要一起考虑的可选插件

- **`dsh-community-market`**：实测独立侧栏入口和 overlay 已注册；由于 `src/client/index.ts:47` 仍检查 `cqaiPrimaryLogin`，它没有加入 CQAI 产品管理页的市场／更新入口。需与产品管理迁移一起对齐，不应描述为整个社区市场加载失败。
- **`cqai-dsh-plugin-quicknav`**：不在当前 9 个默认清单中，但旧 `profiles/cqai-dsh-plugin-desktop/package.json` 仍引用它。它的 Client 强依赖 `betterSidebar`；当前现代默认组合不提供此服务。如果恢复预装，必须先迁移到当前布局和主面板 API。
- **e剪宝、数字人视频、短视频、口播、e研宝**：不在当前默认清单中；当前用户 Profile 还有旧视频 bundle 的显式迁移停用记录。不能把它们未自动出现视为本次升级的加载故障。需要在各自被选择安装的组合中另做回归。
- **Agents Anywhere、`dshmarket`**：属于可选能力，本次没有进行手机配对或市场安装操作，未给出完整兼容性通过结论。

## 验证记录与检查缺口

- `corepack yarn typecheck:cqai-plugins`：通过。类型检查并不能检测未声明的实际插槽和被条件跳过的界面。
- `corepack yarn check:desktop-variants`：通过。
- 账号完整 Vitest：107 项通过。
- e图宝选定兼容性测试：64 项通过，覆盖 DSH 集成、Agent 图片技能、Markdown 图片预览、上游画布图片预览、设置入口和上游路由。
- 多平台发布选定测试：100 项通过，覆盖客户端合同、Agent 工具、发布路由、发布确认、文章交接和工作区导航。
- 主题完整 Vitest：25 项通过；产品插件管理完整 Vitest：11 项通过。这些通过结果没有覆盖当前真实桌面入口失配。
- 共 307 项上述单元／行为测试通过。
- 首页 `node --test tests/home-layout.test.mjs`：8 项失败，均先在旧 renderer 测试夹具上报 `host.specOf is not a function`，尚未运行到有效的布局断言。此失败表明测试夹具也需升级，不能把它当作 8 种独立布局问题。首页包默认 `test` 仍为 `echo No tests yet`，该布局检查未纳入常规测试入口。
- 真实临时 Host：9 个默认插件的 `fiberPhase` 全部为 `active`。最终浏览器检查无页面异常；自定义页面没有挂载时也可以没有报错。
- 现有 `verify-host.mjs` 检查产品 Host 的 active 状态；应补充真实前端中的产品入口、插槽 occupant 与页面渲染检查，才能拦住本次静默退化。

## 建议实施顺序

1. 先对齐桌面能力判断与账号／产品管理入口，再迁移 Skills／MCP 及社区市场集成。新版插件页已有公开扩展接口，优先使用这些接口。
2. 接入新版 Conversation 的受支持呈现接口，恢复首页与 PPT 模板入口，再同步主题的启用条件、壁纸范围和现有外观。
3. 更新首页过时测试夹具，将布局检查和真实前端产品入口检查纳入默认门禁。回归无工作区、空白会话、已有会话、PPT、浅深色及窄窗口。
4. 按仓库规则先在 Beta 验证，再同步 Stable 共享部分，保留渠道差异；Next 单独验证。适配代码和补丁留在桌面拥有的包内，不修改 `deepseek-harness/` 子模块。

本报告其余内容保留初次排查时的证据和验证范围。
