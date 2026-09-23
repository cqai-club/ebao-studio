# 多平台账号管理与发布

易宝工坊的一个 React 主面板，内部包含“发布 / 发布历史 / 平台账号管理”。发布页可切换文章、图文、视频：

- **平台账号管理**：添加、改名、登录/重新登录、手动检查、打开账号专属后台、删除和导入旧 MatrixMedia 账号。
- **视频**：与文章、图文共用“选择本地草稿 / 新建 / 复制 / 删除”工具栏，支持多份自动保存的视频草稿；每份可选择 e剪宝成片或本地 MP4 文件，为每个平台指定一个账号，立即发布或转存平台草稿。
- **文章和图文**：多份本地草稿、Markdown 编辑与简易安全预览、`.md/.txt` 导入、图片素材。文章首张图片自动作为封面，删除封面后自动改用下一张；素材列表可将图片以 `ebao-asset://<UUID>` 插入正文，封面也可兼作插图。图文图片支持拖动或按钮排序。掘金/B站专栏、头条、百家号和小红书图文账号可先选择并准备草稿；账号选择不代表该平台已开放提交。页面按所选平台提示标题、素材数量和必填字段限制，平台通过真实验收后才由 Worker 能力矩阵开放提交。

页面通过 DSH Web Route 调用 Electron 主进程的 `PublisherSupervisor`，再由 Supervisor 使用 stdin/stdout NDJSON 驱动独立的 MatrixMedia Publisher Worker。浏览器不能直连 Worker，不接收 Cookie、session partition 或任意本地文件路径。视频草稿与文章、图文草稿均保存在 `<DSH home>/publisher/contents/<id>/`，支持约 800ms 防抖自动保存。选择 e剪宝成片时，草稿只保存 `workId`，Host 固定解析 `<DSH home>/ejianbao/jobs/<workId>/final_video.mp4`；选择本地 MP4 时，由 Electron 原生文件对话框选取，草稿只保存不含路径的 `localVideoId`、文件名和大小，真实路径由 Electron main 私有目录 `<userData>/publisher/local-videos/` 保存，重启后仍可解析。视频提交只传内容 ID 与修订号，Host 解析草稿并转成现有 Worker 视频请求；Supervisor 在提交时重新校验本地视频并将真实路径交给 Worker。文章和图文由 Worker 接受前复制不可变内容快照。本地视频本体不复制到草稿库；编辑及提交后需保留原文件，移动、删除或修改后需要重新选择。删除视频草稿不会自动删除文件，也不影响已接受的提交。

## 产品语义

- 提交前同步校验作品、参数和全部目标账号登录态，任一失败则整单拒绝且不落提交记录。
- 文章/图文在 React 和 Host 两层先校验正文、图片、封面、目标平台的标题与素材限制、必填字段及已知内容声明限制；Worker 仍独立复核并保存不可变快照。
- Worker 持久化后才返回 `accepted: true`，随后进入全局串行队列。
- Worker 接受后以默认 3 秒自动消失的 Tips 显示 **“已提交，请稍后到平台后台确认”**；账号忙碌等操作错误也使用 Tips。不轮询、不推送、不展示内部成功、失败、百分比、日志或截图。
- “打开平台后台”复用该账号同一 Chromium session。
- 不支持定时、非 MP4 本地视频、自动结果核验或自动重试。文章/图文平台能力在完成真实验收前保持关闭。
- 现有掘金、B站专栏和小红书图文实验行为保持不变。头条、百家号文章按 `draft` / `publish` 分别门控；本轮加入正文插图转换与账号 session 内上传适配，但尚未完成真实平台验收，默认关闭。掘金、B站专栏仍只支持单张封面；简易 Markdown 预览不等同于平台最终排版。
- 非 macOS 返回 `publisher-not-supported`；不再回退旧 Windows CLI。

## 本机安全边界

- Route 仅允许 loopback、同源读取和带 `x-ejianbao: 1` 的写请求。
- 常规 JSON 请求体上限 64 KiB，草稿保存请求上限 4 MiB（正文最多 2 MiB），原始图片上传上限 20 MiB；动作和字段采用白名单校验。
- 账号使用 UUID 身份；显示名与 session partition 分离。
- 登录窗口/后台窗口与同账号发布任务互斥。
- 已开始后中断的任务只标记为 Worker 内部未知状态，绝不自动重发。

## 构建与测试

头条文章草稿尚未经过真实账号验收，正式运行时能力仍关闭。macOS Beta 开发者如需受控验收，可先将当前源码构建的 Universal Helper 放在被 Git 忽略的 `matrixmedia-publisher/build/publisher-worker-article-test/mac-universal/MatrixMedia Publisher Worker.app`，完全退出已有 Beta 后运行 `corepack yarn dev:beta:tt-article-draft`。启动脚本会先用隔离临时数据目录检查 Helper 仅开放头条文章 `draft`，不会开放头条文章 `publish`；检查不通过则不启动 GUI。不要覆盖正在运行的默认 Helper，提交后仍需在同账号后台人工确认。

```bash
corepack yarn workspace cqai-dsh-plugin-publisher build
corepack yarn workspace cqai-dsh-plugin-publisher typecheck
corepack yarn workspace cqai-dsh-plugin-publisher test
```

Worker 源码、Node 20 构建及 GPL-2.0-only 声明见 [`UPSTREAM.md`](./UPSTREAM.md) 与 [`vendor/matrixmedia/README.md`](../../vendor/matrixmedia/README.md)。
