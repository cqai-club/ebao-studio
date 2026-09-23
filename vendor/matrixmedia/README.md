# MatrixMedia Publisher Worker source and license

e宝工坊不再打包或调用旧的 Windows `matrixmedia.exe + cli` 运行体。多平台发布改为 macOS 内置 **MatrixMedia Publisher Worker**：源码以根目录 `matrixmedia-publisher/` Git submodule 固定，构建产物作为独立 Electron Helper App 放在外层应用的 `resources/publisher/`。

## 固定源码

- 上游仓库：<https://github.com/hanliang97/MatrixMedia.git>
- e宝集成分支：`codex/ebao-article-adapters`（从 `feat/ebao-publisher-worker` 固定提交派生）
- 精确提交、许可证和构建命令：[`publisher-worker.json`](./publisher-worker.json)
- submodule：`matrixmedia-publisher/`

初始化源码：

```bash
git submodule update --init --recursive matrixmedia-publisher
```

MatrixMedia 保持自己的 Node.js 20 / Yarn 1 构建，不加入 e宝 Yarn workspace。Publisher Worker 的打包配置单独固定 Electron 43.3.0（Chromium 150），不会改变 MatrixMedia 原主程序的 Electron 依赖；头条账号与发布窗口使用与内核一致的 UA。在 Node 20 环境中执行：

```bash
cd matrixmedia-publisher
corepack yarn@1.22.22 install --frozen-lockfile
corepack yarn@1.22.22 test:publisher-worker
corepack yarn@1.22.22 build:publisher-worker:universal
```

产物路径：

```text
matrixmedia-publisher/build/publisher-worker/mac-universal/MatrixMedia Publisher Worker.app
```

e宝 macOS 打包前会校验 Helper 主可执行文件和 Electron Framework 同时包含 `x86_64`、`arm64`，并校验 submodule 精确提交与 GPL 许可证文本。签名构建由 Electron Builder 的 depth-first bundle walker 先签 Helper 的内部组件和 Helper App，再封装签名外层 e宝 App；发布验收会独立校验 Helper 的 Universal 架构和签名，然后再校验外层签名、Gatekeeper 与公证票据。非 macOS 平台不打包旧 CLI 作为回退。

## GPL-2.0-only

MatrixMedia 为 GPL-2.0-only。分发包包含：

- `resources/publisher/MatrixMedia Publisher Worker.app`
- `resources/publisher/LICENSE`
- `resources/publisher/SOURCE.json`

`SOURCE.json` 记录仓库 URL、分支和精确源码提交；对应完整源码由 Git submodule 提供。发布前仍须完成最终许可证审查，并确保该提交已在公开来源可获取。

`0.11.3/` 和 `fetch-matrixmedia.mjs` 仅保留为历史供应链证据，不再参与 e宝构建或运行。
