# Upstream: MatrixMedia（矩媒）

本插件不自己实现任何平台自动化。它驱动的是内置的 **MatrixMedia** 运行体，通过其
`matrixmedia cli` 子命令完成扫码登录、投稿与定时发布。这份文档记录我们依赖的上游
版本、来源与校验值，便于后续追溯与升级。

## 依赖的上游

| 项 | 值 |
| --- | --- |
| 项目 | MatrixMedia（矩媒） |
| 仓库 | https://github.com/hanliang97/MatrixMedia |
| Tag | `v0.11.3` |
| 许可证 | **GPL-2.0-only** |
| 分发资产 | `MatrixMedia-0.11.3-win-x64.exe`（NSIS 安装器，71,587,366 字节） |
| 资产 sha256 | 见 `vendor/matrixmedia/0.11.3/provenance.json` |
| 展开形态 | 22 个文件 / 253,462,689 字节，逐文件 sha256 见 `manifest.json` |

运行体**不是 npm 依赖**：它不在本包的 `dependencies` / `optionalDependencies` 里，
也不出现在 yarn workspace 里。它由桌面端的 `build.extraResources` 复制到
`resources/matrixmedia/`，与 `app.asar` 并列，插件再以子进程方式启动它。

## 我们依赖的 CLI 表面

只有下面这些调用是契约；上游其余命令本插件不碰。

- `cli publish -p <platform> -f <abs path> -t <title> [--phone] [--description]
  [--tags] [--cs] [--publish-at] [--draft] [--short-title] [--name]`
- `cli login -p <dy|sph> [--phone] [--save-qr-png <path>] [--timeout-sec]`
- `cli accounts --json`
- `cli history --json -n <limit>`
- `cli --help`（只为版本横幅，不是功能调用）

上游**没有** `--version`：CLI 模式由参数里出现裸 `cli` 决定，`--version` 会整个启动 GUI
且永不退出。所以版本探测用的是最便宜的 CLI 调用 `cli --help`（约 0.7 s），从它打印的
`0.11.3 -------` 横幅里取版本号。

**退出码**（来自上游自己的帮助文本，本插件照搬为常量）：

| 码 | 单文件 | 批量 |
| --- | --- | --- |
| 0 | 成功 | 全部成功 |
| 1 | 异常 | 部分失败 |
| 2 | 参数错误 | 全部失败 |
| 3 | 任务失败（上传未成功） | — |
| 4 | 已转存草稿需检查 | — |

（批量只有 0/1/2 三个码；3 和 4 是单文件模式专有的，上游自己的帮助文本就是这么写的。）

**完成信号**：上游在任何一条命令结束前都会打印
`[startup] CLI 执行结束，退出码=N`。非 TTY 下这是唯一可靠的结束标记——上游启动的
Chromium 会比这行活得更久，所以等待 `close` 会挂住。本插件因此以这行准点收尾，只在
它没出现时才退回 `close` / 超时。

**权威事实来源**不是退出码，而是矩媒自己落盘的
`<文档>/MatrixMedia/data/pushData/YYYY-MM-DD.json`。只有记录里写着 `success` 才算
成功；写 `publishing` 就是还在传。看不到记录一律标「待人工核对」，绝不谎报成功。

## 已知上游限制

- `cli login` 只驱动 **抖音** 和 **视频号**。其余平台必须在矩媒界面里登录一次，本
  插件的账号面板会如实说明，而不是启动一个注定失败的子进程。
- `--tags` 上限 4 个话题。
- `self_made_no_repost`（自制，禁止转载）只在哔哩哔哩受支持。
- 没有任何文档化的 stdout 成功标记；`CLI_SKILLS.md` 只描述功能。所以判定逻辑全部
  建立在退出码弱信号 + 记录回读之上。

## 许可证义务怎么履行

MatrixMedia 是 GPL-2.0-only。义务按仓库既有方式承担，不改门禁：

- `dsh-plugin-desktop/THIRD_PARTY_NOTICES.md`（同时是 NSIS 的 `license`）里手工声明
  版本、许可证与出处；
- 上游 `LICENSE` 全文随运行体安装到 `resources/matrixmedia/LICENSE`；
- `verify-licenses.mjs` 的 `ALLOWED_LICENSES` 与 BFS 逻辑**未改动**——二进制不在
  npm 依赖图上，门禁根本遍历不到它。

## 升级流程

运行体自身的下载、校验、展开与 `--check` 都在
`vendor/matrixmedia/README.md` 与 `vendor/matrixmedia/fetch-matrixmedia.mjs` 里。升级
时需要同步的地方：`fetch-matrixmedia.mjs` 的 `RELEASE`、`build.extraResources` 的路
径（两个桌面变体各一处）、本文件的版本表、以及 `vendor/matrixmedia/README.md` 的
校验历史。
