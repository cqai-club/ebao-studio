# 多平台账号管理与发布

易宝工坊的两个 React 主面板：

- **多平台账号管理**：添加、改名、登录/重新登录、手动检查、打开账号专属后台、删除和导入旧 MatrixMedia 账号。
- **多平台发布**：选择 e剪宝成片，为每个平台指定一个账号，立即发布或转存草稿。

页面通过 DSH Web Route 调用 Electron 主进程的 `PublisherSupervisor`，再由 Supervisor 使用 stdin/stdout NDJSON 驱动独立的 MatrixMedia Publisher Worker。浏览器不能直连 Worker，不接收 Cookie、session partition 或任意本地文件路径；提交只传 `workId`，Host 固定解析 `<DSH home>/ejianbao/jobs/<workId>/final_video.mp4`。

## 产品语义

- 提交前同步校验作品、参数和全部目标账号登录态，任一失败则整单拒绝且不落提交记录。
- Worker 持久化后才返回 `accepted: true`，随后进入全局串行队列。
- 页面只显示 **“已提交，请稍后到平台后台确认”**，不轮询、不推送、不展示内部成功、失败、百分比、日志或截图。
- “打开平台后台”复用该账号同一 Chromium session。
- 一期不支持定时、文章、任意本地文件、自动结果核验或自动重试。
- 非 macOS 返回 `publisher-not-supported`；不再回退旧 Windows CLI。

## 本机安全边界

- Route 仅允许 loopback、同源读取和带 `x-ejianbao: 1` 的写请求。
- JSON 请求体上限 64 KiB，动作和字段采用白名单校验。
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
