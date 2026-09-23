# Upstream: MatrixMedia Publisher Worker

| 项 | 值 |
| --- | --- |
| 项目 | MatrixMedia（矩媒） |
| 仓库 | https://github.com/hanliang97/MatrixMedia.git |
| e宝集成分支 | `codex/ebao-article-adapters`（从 `feat/ebao-publisher-worker` 固定提交派生） |
| 精确提交 | 见 `vendor/matrixmedia/publisher-worker.json` |
| 版本 | 0.11.4 |
| 许可证 | GPL-2.0-only |
| 源码位置 | 根目录 `matrixmedia-publisher/` Git submodule |

MatrixMedia 不加入 e宝 Yarn workspace，保持 Node.js 20 / Yarn 1 / Electron 24 构建。e宝 Electron 43 只负责启动与监督独立 Helper，不把 MatrixMedia 代码装进 DSH utility process。

Worker 专用入口不启动 Vue 主窗口、托盘、自动更新、30088 HTTP 服务或原菜单。它复用上游的 BrowserWindow 登录、UA、代理、Chromium session、Puppeteer 发布队列和失败截图，并通过私有 NDJSON 方法暴露账号与提交操作。stdout 只允许协议帧，日志进入 stderr。

公开给 React 的账号和提交快照不含 Cookie、partition、内部队列状态或执行结果。独立 MatrixMedia 旧账号通过复制导入，源数据不移动、不删除。

## 构建

```bash
git submodule update --init --recursive matrixmedia-publisher
cd matrixmedia-publisher
corepack yarn@1.22.22 install --frozen-lockfile
corepack yarn@1.22.22 test:publisher-worker
corepack yarn@1.22.22 build:publisher-worker:universal
```

发布前必须确保 `publisher-worker.json` 中的精确提交可从公开仓库获取，并完成 GPL-2.0-only 最终许可证审查。Helper、许可证全文和源码声明分别安装到 `resources/publisher/MatrixMedia Publisher Worker.app`、`resources/publisher/LICENSE`、`resources/publisher/SOURCE.json`。
