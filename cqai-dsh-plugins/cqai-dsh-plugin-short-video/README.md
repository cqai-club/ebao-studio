# 短视频制作

独立的 DSH Cordis 插件，使用 MoneyPrinterTurbo 1.3.7 的视频流水线，提供重新设计的本机制作页面。与“e剪宝”是两个插件、两个任务目录。

## 第一阶段功能

- 主题或自写文案、自动生成脚本、段落与提示词、自动或手动关键词。
- Pexels、Pixabay、Coverr 素材检索；本地视频/图片上传；CQAI Club 图片模型生成画面。
- Edge TTS 声音与音量/语速，上传旁白，关闭/随机/上传背景音乐。
- 字幕开关、整句/逐字、动画、位置、系统字体、颜色、字号、描边。
- 画幅、裁切/适配、镜头时长/速度、随机/顺序、转场、生成数量与编码器。
- 分阶段制作文案、关键词、配音、字幕、素材或成片；本机持久化任务、取消、重做、下载和视频预览。
- 创作预设 JSON 导入/导出、素材平台密钥、运行环境检查和安装。

文本和图片模型均来自当前登录的 CQAI Club 账号。服务端创建任务及模型调用前都会检查模型目录；脚本请求通过 DSH LLM 服务发送，图片请求通过账号服务发送。插件不另存 CQAI API Key，也不暴露本地 Python HTTP 服务。若素材来自其它平台，该平台仍需要自己的素材 API Key。

## 使用

在本分支仓库根目录用 Git Bash 启动开发版：

```bash
DSH_AA_SOURCE_REF=pinned corepack yarn dev
```

此命令复用仓库中已校验的 Agents Anywhere 包。直接运行 `corepack yarn dev` 会先尝试从 Agents Anywhere 的最新 main 重新打包；当它与仓库固定的 DSH 依赖不兼容时，会在打开桌面窗口前因类型检查失败而退出。

首次打开“设置”页，点击“安装 / 修复依赖”。需要本机有 Python 3.11+、uv 和 FFmpeg；安装使用随插件附带的 uv.lock，把 Python 环境放在 DSH_HOME/short-video/engine/.venv，可能下载较大的语音识别和视频依赖。素材与任务位于 DSH_HOME/short-video/。可以用 MPT_PYTHON 环境变量指定已准备的 Python 解释器。

原仓库的付费 AI 视频提供商、专有 TTS/音乐模型、Upload-Post 自动发布、云端批量脚本报价与确认尚未接入此插件。第一阶段页面不提供这些开关，避免显示无法执行的选项或在未确认费用时提交付费任务。字幕使用本机系统字体；原仓库附带的字体与歌曲不在插件包内。

## 来源

- MoneyPrinterTurbo：本地源版本 1.3.7，提交 3d5f4e4；MIT 许可证见 UPSTREAM_LICENSE。
- runtime/mpt/app、config.example.toml、pyproject.toml 和 uv.lock 是该提交的副本。为了把可写数据放进 DSH_HOME，仅修改了 app/config/config.py 的配置文件路径和 app/utils/utils.py 的存储根路径。
- DSH 桥接代码在 runtime/bridge.py，不会修改上游 Git 子模块。
