# 口播视频制作插件（基于 TalkCraft）

这是 DSH Desktop 的独立插件。Stable/Beta 开发版默认加载；当前默认插件尚不能通过界面启停。它有自己的侧栏、Host API、Agent 任务、`$DSH_HOME/talkcraft/jobs/<id>` 和 Credentials 记录；不调用 e剪宝。

上游 TalkCraft 采用 [PolyForm Noncommercial 1.0.0](LICENSE)；个人非商用可以使用，商业使用需取得上游作者授权。安装包随插件附带完整许可证和版权声明。

## Windows 开发版准备

在仓库根目录执行：

```powershell
corepack yarn install --immutable
corepack yarn workspace cqai-dsh-plugin-talkcraft runtime:prepare --with-asr-model
corepack yarn dev       # Stable；Beta 改用 corepack yarn dev:beta
```

准备命令安装锁定的 npm/Remotion、Python 虚拟环境（含 Edge TTS）与无头浏览器，并下载约 776 MB 的 FireRed 模型。只用 Fish Audio 时可去掉 `--with-asr-model`；上传配音和 Edge TTS 使用 FireRed 做字级对齐。已有模型也可通过 `FIRERED_ASR_MODEL_DIR` 指向含 `model.int8.onnx` 和 `tokens.txt` 的目录。Node 22.19+/24、Python 3.11 与 FFmpeg/ffprobe 需在 PATH。准备流程只在用户显式运行时安装/下载，Desktop 启动不会自动升级依赖。

在新建视频的声音步骤可选择上传成品配音、Edge TTS 或 Fish Audio。Edge TTS 使用在线语音服务，不需要密钥；首次使用需运行一次上面的准备命令。音色列表在用户选择 Edge TTS 时从服务读取，中文优先，支持查找和查看全部语言，并在本机缓存一天；服务不可访问时显示基础中文音色。选中音色后点击“试听声音”，会用当前口播稿开头最多 80 字生成短样音，在页面直接播放；切换音色会清除旧试听。在插件的“设置”中可连接 Fish Audio、Pexels、Pixabay。密钥由 DSH Credentials 存储；任务 JSON 和日志仅存是否配置、素材来源及状态。画面至少上传一份，或启用“需要时找在线素材”并连接 Pexels/Pixabay。远端配音请求结果不明时任务停止，不自动重复提交；Edge TTS 可由用户明确重试，也可上传一份配音继续。

## 制作流程

首页列出最近视频，并把待确认或暂停的任务放在“需要你处理”。最近视频卡片提供独立的“删除”按钮；确认后会先停止该任务的制作和工作台，再永久删除其本机任务目录、上传素材和产物。点击“做新视频”依次填写文案、选择声音来源、添加画面并选择横屏或竖屏。未提交的文案和选择保存在本机浏览器中。插件先用 TalkCraft 的 Python 脚本做字级对齐并收集素材，再用当前 DSH 模型和 Agent preset 分阶段制作。界面先请用户确认逐段画面安排，再试看有声试片；退回时携带修改意见重做。完整成片经 ffprobe 音视频流检查和新 Agent 上下文审片后可预览、下载。阶段完成以任务目录中的真实产物为准；重启时运行中任务变为“已中断”，继续时重新验证已完成阶段。

样板镜确认后可打开嵌入的 TalkCraft React 19 多轨工作台。每次只有一个任务的工作台服务运行；切换任务会终止旧服务。工作台监听 `127.0.0.1`，工程路径通过 `TALKCRAFT_PROJECT` 显式映射，参数写回任务的 `remotion/overrides.json`，导出在任务的 `exports/`。工作台的 React/Remotion 依赖在 `upstream/runtime/node_modules`，与 DSH Client React 18 隔离。

## 验证命令

```powershell
corepack yarn workspace cqai-dsh-plugin-talkcraft typecheck
corepack yarn workspace cqai-dsh-plugin-talkcraft test
corepack yarn workspace cqai-dsh-plugin-talkcraft build
corepack yarn check:desktop-variants
node --experimental-transform-types cqai-dsh-plugins/cqai-dsh-plugin-talkcraft/scripts/smoke-workbench.mjs
node --experimental-transform-types cqai-dsh-plugins/cqai-dsh-plugin-talkcraft/scripts/smoke-workbench-export.mjs
node --experimental-transform-types cqai-dsh-plugins/cqai-dsh-plugin-talkcraft/scripts/smoke-uploaded-voice.mjs C:\path\to\spoken.wav
```

首版面向 Windows `corepack yarn dev`。安装包内的 npm/Python/浏览器分发尚未适配。
