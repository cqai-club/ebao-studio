# 应用公共媒体工具

本包没有 Loader bundle 或菜单。三个视频功能与 e剪宝使用同一个安装队列，在 `DSH_HOME/media-tools` 准备内置 uv、宿主 Node 启动器、兼容的 Python 3.11，以及普通媒体命令使用的 FFmpeg / ffprobe。各功能的 Python 包、Remotion 依赖、原生合成器、浏览器与识别模型仍由各功能管理。

FFmpeg 使用短视频现有 `uv.lock` 中的 `imageio-ffmpeg==0.6.0` 完整构建与 SHA-256；ffprobe 使用口播现有 `remotion-lock.json` 中的 `@remotion/compositor-<platform>@4.0.519` 及 npm SRI。安装仅下载固定 wheel 和 npm 包，不运行 npm 生命周期或 Python 源码构建。Remotion 的裁剪版 FFmpeg 缺少部分普通剪辑滤镜，不能代替公共完整 FFmpeg。

成功检查两个二进制后才写入安装标记。中断安装不会被引擎选中，重试只修复缺失项。任务启动时读取已验证的公共路径；显式引擎环境配置继续优先，未安装公共工具时保留各功能原有后备路径。

`commonToolHealth` 的 `python` 表示基础解释器；功能健康中的 `pythonPackages` 表示该功能的包环境。公开状态没有凭据或安装命令输入。

验证：构建本包后运行 `node scripts/verify-media-common-tools.mjs`，在隔离临时应用目录检查安装、color/crop/scale、H.264/AAC、ffprobe、第二次安装复用和损坏工具修复，最后清理该目录。该脚本需要下载固定工具包。
