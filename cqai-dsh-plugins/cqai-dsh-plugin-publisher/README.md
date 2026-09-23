# 多平台账号管理与发布

易宝工坊的一个 React 主面板，内部包含“发布 / 发布历史 / 平台账号管理”。发布页可切换文章、图文、视频：

- **平台账号管理**：添加、改名、登录/重新登录、手动检查、打开账号专属后台、删除和导入旧 MatrixMedia 账号。
- **视频**：选择 e剪宝成片或直接选择本地 MP4 文件，为每个平台指定一个账号，立即发布或转存草稿。
- **文章和图文**：本地草稿库、Markdown 编辑和预览、文件导入、图片素材；平台通过真实验收后由 Worker 能力矩阵开放提交。

页面通过 DSH Web Route 调用 Electron 主进程的 `PublisherSupervisor`，再由 Supervisor 使用 stdin/stdout NDJSON 驱动独立的 MatrixMedia Publisher Worker。浏览器不能直连 Worker，不接收 Cookie、session partition 或任意本地文件路径。选择 e剪宝成片时，视频提交只传 `workId`，Host 固定解析 `<DSH home>/ejianbao/jobs/<workId>/final_video.mp4`；选择本地 MP4 时，由 Electron 原生文件对话框选取，浏览器只获得一次进程内有效的 `localVideoId` 和文件名/大小，Supervisor 在提交时重新校验文件并将真实路径交给 Worker。文章和图文提交只传内容 ID 与修订号，Host 解析 `<DSH home>/publisher/contents/<id>/`，Worker 接受前复制不可变内容快照。本地视频不复制到草稿库；提交后需保留原文件直到在平台后台确认。

## 产品语义

- 提交前同步校验作品、参数和全部目标账号登录态，任一失败则整单拒绝且不落提交记录。
- Worker 持久化后才返回 `accepted: true`，随后进入全局串行队列。
- 页面只显示 **“已提交，请稍后到平台后台确认”**，不轮询、不推送、不展示内部成功、失败、百分比、日志或截图。
- “打开平台后台”复用该账号同一 Chromium session。
- 不支持定时、非 MP4 本地视频、自动结果核验或自动重试。文章/图文平台能力在完成真实验收前保持关闭。
- 非 macOS 返回 `publisher-not-supported`；不再回退旧 Windows CLI。

## 本机安全边界

- Route 仅允许 loopback、同源读取和带 `x-ejianbao: 1` 的写请求。
- 常规 JSON 请求体上限 64 KiB，草稿保存请求上限 4 MiB（正文最多 2 MiB），原始图片上传上限 20 MiB；动作和字段采用白名单校验。
- 账号使用 UUID 身份；显示名与 session partition 分离。
- 登录窗口/后台窗口与同账号发布任务互斥。
- 已开始后中断的任务只标记为 Worker 内部未知状态，绝不自动重发。

## 构建与测试

```bash
corepack yarn workspace cqai-dsh-plugin-publisher build
corepack yarn workspace cqai-dsh-plugin-publisher typecheck
corepack yarn workspace cqai-dsh-plugin-publisher test
```

Worker 源码、Node 20 构建及 GPL-2.0-only 声明见 [`UPSTREAM.md`](./UPSTREAM.md) 与 [`vendor/matrixmedia/README.md`](../../vendor/matrixmedia/README.md)。
