# 安装、更新与卸载

[English](install-and-uninstall.md)

本文说明 DSH Community Market 的 package 操作边界。

## 视图

| 视图 | 事实来源 | 可用操作 |
| --- | --- | --- |
| 发现 | 当前目录来源的标准化数据 | 查看详情并请求安装 preview |
| 可安装 | 提供唯一 npm package 身份的目录条目 | 请求安装 preview |
| 已安装 | 当前 Profile 的直接依赖和 bundle 列表 | 卸载可移除依赖；核心 bundle 只读 |
| 更新 | 真实安装的 npm bundle 版本及 npm 稳定 latest | 检查版本；查看确认单个或全部更新 |
| 来源 | 用户拥有的目录来源设置 | 添加、选择、排序和移除来源 |

已安装状态与当前目录来源无关，也与最初由哪个市场安装无关。

## 安装流程

1. 用户选择目录条目，Renderer 只发送 `sourceRecordId` 和 `itemId`。
2. Host 解析自己此前观察到的标准化 npm package 身份。
3. Host 请求 `https://registry.npmjs.org/<package>/latest`，要求返回相同 package name、精确稳定版本和合法的 `dsh.bundle.patch` 声明。
4. 确认框展示 package、精确版本、当前 Profile 和 preview 过期时间。
5. 用户确认后，Host 消费一次性 `previewId`，使用自己拥有的 argv 调用 `desktopPnpm.run()`，执行精确版本的 `pnpm add`。
6. Host 把 package 写入 `dsh.profile.bundles`，并确认它已经成为 Profile 直接依赖。

来源列出的版本永远不会成为安装目标。仓库是否一致、deprecated metadata、lifecycle script、engine 范围、integrity metadata 和 provider 验证标记都不会阻止操作；provider 命令字符串会被丢弃。

Market 安装不会创建 receipt、checkpoint、重试、清理或回滚 operation。结果状态由 Desktop 普通的 Profile checkpoint 统一覆盖。

## 自动安装条件

目录条目只有满足以下条件才能进入自动安装 preview：

- 条目能标准化出且只标准化出一个合法 npm package name；
- package 不是 Desktop 自己拥有的产品 bundle；
- npm `latest` 对同一 package 返回精确稳定版本；以及
- npm manifest 声明安全的相对 DSH bundle patch 路径。

失败时条目仍可浏览，也可以显示只用于展示的手动命令。

## 更新检查

Client 在启动后及每隔 30 分钟检查更新。Market 的**检查更新**会强制重新请求 registry；普通检查使用 Host 的有界缓存。可更新项显示已安装版本 → 最新版本及更新提醒。Registry 检查失败会单独显示，不会被当作成功的“已是最新”结果。

Host 从当前 Desktop 清单解析目标，不信任 Renderer 或目录提供的 package name 或版本。目标必须是允许修改的直接 npm 插件 bundle，并且能验证真实安装版本。产品自有核心 bundle、本地或 Git 依赖会被跳过；安装版本未知的 package 会显示检查错误，不能更新。npm 官方 `latest` manifest 必须标识同一 package、精确稳定版本和安全的 `dsh.bundle.patch` 路径。Semver 比较只允许更新到更高的稳定版本，不允许降级或预发布版本。

检查不依赖当前目录来源或最初安装插件的市场，使用 Community Market 自身服务，不依赖 DSH Market。

## 更新流程

1. Renderer 为每个选中的更新提交当前清单的不透明 `bundleId`。
2. Host 解析直接 npm bundle，读取真实安装版本，并解析 registry 的稳定 `latest` 版本。
3. Host 拒绝与已安装官方 DSH peer 存在已知不兼容的目标。短时一次性 preview 绑定当前 Profile、package 和精确的新旧版本；确认框展示新旧版本。
4. 用户确认单个更新或**全部更新**。检查和提醒本身不会启动 package 修改。
5. 执行前，Host 重新检查 Profile、直接依赖、bundle 和真实安装版本，消费 preview，并用自己拥有的 argv 通过 `desktopPnpm.run()` 添加精确目标版本。
6. Host 保留 bundle 引用和配置，并验证新版本已安装；用户明确重启后加载更新后的插件。

Package 操作互斥。**全部更新**逐项执行，首次失败即停止，不是原子事务；此前成功项保留。结果列出成功项、失败项和剩余未执行项，失败及未执行项可以重新查看确认后重试。

更新失败时，Host 尝试重新安装旧的精确版本，保留 bundle 引用和配置。恢复成功后保留旧版本并报告最初的更新错误；如果恢复也失败，错误提示用户显式恢复 Desktop Recovery checkpoint。这条恢复路径专用于更新；安装仍不提供回滚路径。

## 卸载流程

1. Desktop 读取当前 Profile 的 `dependencies` 和 `dsh.profile.bundles`。
2. 每个直接 bundle 获得当前 generation 有效的不透明 `bundleId`。产品自有 bundle 只读，其他直接依赖可以移除。
3. Renderer 只提交该 `bundleId`。
4. Host 根据当前清单重新解析目标，确认 package 仍是直接依赖，并返回一次性确认。
5. 用户确认后，Host 调用 `desktopPnpm.run(['remove', packageName])`，移除 bundle 条目，并确认 Profile 不再引用该 package。

无论插件由 Community Market、其他插件市场还是 DSH CLI 安装，都使用同一流程。Market 不提供启用或禁用操作。

## 手动兜底

自动 preview 不可用时，Host 可以根据标准化身份构造一条有界且只用于展示的 npm 命令。**打开 DSH 终端**只打开终端，不会提交 package 命令、路径或 Profile，也不会执行修改。

## 失败行为

| 故障 | 结果 |
| --- | --- |
| 无法解析 npm latest，或它不是稳定 DSH 插件 | 不启动 package 操作 |
| Preview 后 Profile 发生变化 | 拒绝一次性 preview |
| 安装或卸载失败 | 报告错误；Market 不自动清理或回滚 |
| 安装在 pnpm 后 Profile reconcile 失败 | 报告错误，供诊断或显式恢复 checkpoint |
| 更新失败 | Host 尝试恢复旧的精确版本，并报告失败项 |
| 更新恢复也失败 | 错误中报告恢复失败并提示使用 Desktop 恢复页面 |
| 全部更新中某项失败 | 停止批量操作，保留成功项，并列出失败及未执行项供重新查看确认和重试 |
| 用户确认后 Renderer 关闭 | Host 持有的 package 操作继续，仅可能丢失响应 |

pnpm 进程失败时，Host 只保留有上限的 stdout/stderr 尾部，将该诊断写入 Desktop 日志，并返回给本地失败弹窗。弹窗显示已验证 package 对应的命令，也可以打开 DSH 终端，但不会粘贴、执行或静默重试该命令。
修改成功后，用户可以立即重启或稍后重启；重启绝不会静默进行。
