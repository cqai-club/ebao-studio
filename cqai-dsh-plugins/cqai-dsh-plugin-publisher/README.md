# 一稿多发

易宝工坊 / DeepSeek Harness 多平台分发插件。把 e剪宝做出来的一条成片，一次投放到抖音、快手、百家号、哔哩哔哩、头条、视频号、小红书和番茄视频。

侧栏 **易宝工坊 → 一稿多发**。通过官方 `sidebar.panellist` 和 `main` 插槽挂载，保留原有对话界面。

平台自动化本身不重写：本插件驱动内置的 **矩媒（MatrixMedia）** 运行体的 `cli` 子命令，登录态、投稿表单、定时发布都由矩媒完成。矩媒是独立的 Electron 应用，以子进程方式从 `resources/matrixmedia/` 启动。

## 使用

1. **账号**：先登录。抖音和视频号可以直接在面板里扫码；其余平台请在矩媒界面里登录一次，本面板会自动读到登录状态。
2. **发布**：选择一条 e剪宝成片，填标题、简介、话题，勾选目标平台，可选定时发布或存入草稿箱。
3. **等待**：各平台按顺序逐个上传，一屏能看到每个平台的进度。发布期间请保持易宝工坊运行。
4. **平台记录**：查看矩媒自己记录的逐条发布结果。

## 结果判定

上游 CLI 没有文档化的成功标记，所以本插件**从不说谎报成功**：

- 进程退出码和 stdout 只作为**弱信号**（矩媒会固定打印 `[startup] CLI 执行结束，退出码=N`，这是非 TTY 下唯一可靠的完成信号）。
- 真正的判据是矩媒自己的记录文件 `<文档>/MatrixMedia/data/pushData/YYYY-MM-DD.json`。只有记录里写着 `success` 才算成功，写 `publishing` 就是还在传。
- 记录读不到、或者命令报告成功但记录里没有这一条，一律标成**「待人工核对」**并在面板上提示到矩媒界面确认，绝不静默算成功。

## 运行环境

- 运行体随易宝工坊一起安装，不需要用户另外装矩媒。
- 本插件**不读取、也不设置任何代理**：直连各家平台。
- 路径解析顺序：`EJIANBAO_MATRIXMEDIA` 环境变量（U 盘便携版由 `portable-runtime.ts` 设置）→ 打包态的 `resources/matrixmedia/` → 开发态的 `vendor/matrixmedia/`。找不到时面板会明确说明，而不是静默失败。
- 只监听回环地址，且要求 `x-ejianbao: 1` 头才能发变更请求，浏览器里的其他页面无法驱动它。

## 插件构建

在易宝工坊仓库根目录执行：

```sh
corepack yarn install
corepack yarn workspace cqai-dsh-plugin-publisher build
corepack yarn workspace cqai-dsh-plugin-publisher typecheck
corepack yarn workspace cqai-dsh-plugin-publisher test
```

运行体自身的来源、校验值与更新流程见 `UPSTREAM.md` 与 `vendor/matrixmedia/README.md`。
