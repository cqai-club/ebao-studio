# 口播视频制作插件（基于 TalkCraft）

这是 DSH Desktop 的独立插件，Stable/Beta 默认加载。启用 `cqai-dsh-plugin-ejianbao` 时，页面位于“e剪宝 → 口播视频制作”；停用聚合插件后恢复独立入口。Host API、Agent 任务和 `$DSH_HOME/talkcraft/jobs/<id>` 保持独立；新草稿默认 9:16，恢复稿保留原参数。

Pexels/Pixabay 与短视频使用公共 Credentials 记录，冲突旧值保留为功能覆盖；Fish Audio 保持原凭据记录。画幅和标准 Edge 音色 ID 由普通共享库 `cqai-dsh-media-settings` 管理。聚合标签或设置页往返保留草稿、已选文件和工作台 iframe；隐藏页暂停读取、播放与键盘操作，Host 制作任务继续执行。

上游 TalkCraft 采用 [PolyForm Noncommercial 1.0.0](LICENSE)；个人非商用可以使用，商业使用需取得上游作者授权。安装包随插件附带完整许可证和版权声明。

## 桌面版依赖准备

在仓库根目录执行：

```powershell
corepack yarn install --immutable
corepack yarn dev       # Stable；Beta 改用 corepack yarn dev:beta
```

在插件“设置 → 制作状态”点击“一键安装所有缺失依赖”。Node/npm 和 uv 使用应用内置工具；Python 3.11 与普通媒体处理用的 FFmpeg/ffprobe 由应用统一准备到 `DSH_HOME/media-tools`，可与其他视频功能复用。安装器在 `DSH_HOME/talkcraft/runtime/<版本>` 保留独立 Python 包环境（含 Edge TTS）、锁定的 Remotion 依赖及对应原生组件、无头浏览器；公共 FFmpeg 就绪不能代替 Remotion 原生组件检查。设置中的“口播 Python 包环境”表示依赖模块是否齐全。旧快照或公共工具尚未准备时，普通媒体命令继续使用原快照的工具。FireRed 模型约 776 MB，下载到 `DSH_HOME/talkcraft/models/firered`，完整性校验后才标记就绪。已有兼容模型可通过 `FIRERED_ASR_MODEL_DIR` 指向包含 `model.int8.onnx` 和 `tokens.txt` 的目录。安装支持 Windows、macOS 和 Linux 的现有打包架构；无需修改系统 PATH，Desktop 启动不会自动升级依赖。

在新建视频的声音步骤可选择上传成品配音、Edge TTS 或 Fish Audio。Edge TTS 使用在线语音服务，不需要密钥；首次使用需在设置中完成依赖安装。音色列表在用户选择 Edge TTS 时从服务读取，中文优先，支持查找和查看全部语言，并在本机缓存一天；服务不可访问时显示基础中文音色。选中音色后点击“试听声音”，会用当前口播稿开头最多 80 字生成短样音，在页面直接播放；切换音色会清除旧试听。在插件的“设置”中可连接 Fish Audio、Pexels、Pixabay。密钥由 DSH Credentials 存储；任务 JSON 和日志仅存是否配置、素材来源及状态。画面至少上传一份，或启用“需要时找在线素材”并连接 Pexels/Pixabay。远端配音请求结果不明时任务停止，不自动重复提交；Edge TTS 可由用户明确重试，也可上传一份配音继续。

## 制作流程

首页列出最近视频，并把待确认或暂停的任务放在“需要你处理”。最近视频卡片提供独立的“删除”按钮；确认后会先停止该任务的制作和工作台，再永久删除其本机任务目录、上传素材和产物。点击“做新视频”依次填写文案、选择声音来源、添加画面并选择横屏或竖屏。未提交的文案和选择保存在本机浏览器中。插件先用 TalkCraft 的 Python 脚本做字级对齐并收集素材，再用当前 DSH 模型和 Agent preset 分阶段制作。界面先请用户确认逐段画面安排，再试看有声试片；退回时携带修改意见重做。完整成片经 ffprobe 音视频流检查和新 Agent 上下文审片后可预览、下载。阶段完成以任务目录中的真实产物为准；重启时运行中任务变为“已中断”，继续时重新验证已完成阶段。

样板镜确认后可打开嵌入的 TalkCraft React 19 多轨工作台。每次只有一个任务的工作台服务运行；切换任务会终止旧服务。工作台监听 `127.0.0.1`，工程路径通过 `TALKCRAFT_PROJECT` 显式映射，参数写回任务的 `remotion/overrides.json`，导出在任务的 `exports/`。工作台的 React/Remotion 依赖在应用私有的 `talkcraft/runtime/<版本>/upstream/runtime/node_modules`，与 DSH Client React 18 隔离。

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

`runtime:prepare` 脚本仍可供原源码开发环境使用；Desktop 安装包使用设置页的私有运行时安装器。
