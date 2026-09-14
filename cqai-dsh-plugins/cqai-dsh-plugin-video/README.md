# e剪宝

易宝工坊 / DeepSeek Harness 视频制作插件，基于 `dsh-shortvideo-pipeline`。

侧栏 **e图宝 → e剪宝 → 工作区**。通过官方 `sidebar.panellist` 和 `main` 插槽挂载，保留原有对话界面。

## 使用

1. 选择已有口播视频、数字人口播，或仅生成动效方案。
2. 上传素材并填写文案。填写的文案优先于上传的文案文件。
3. 点击开始制作。在制作记录中查看阶段进度、取消或继续任务。
4. 完成后预览 MP4，下载成片、文案、计划、TSX 动效包和发布 JSON。

已有口播视频默认全部本地处理；AI 文案优化、数字人和封面生成功能需用户在界面选择后才调用对应云服务。发布阶段仅准备素材，不登录或自动发布至任何平台。

默认输出是 1920×1080、25 fps 横版画中画成片。参考图风格迁移与时间轴拖拽编辑不是本插件功能；可选择导入本机 `http://127.0.0.1:41735` 动效组件预览台进一步编辑。该预览台是独立应用。

## 运行环境

- Python 3.10+，`numpy`、`imageio-ffmpeg`（系统已安装 FFmpeg 时后者可省略）。
- Node.js 22+。在 `runtime/render-studio` 执行 `npm ci` 安装固定 Remotion 依赖。
- Remotion 首次渲染需下载浏览器，可用 `EJIANBAO_BROWSER_EXECUTABLE` 指向本机 Chromium 浏览器。
- `EJIANBAO_PYTHON` 可指定 Python 可执行文件；`FFMPEG_PATH` 可指定 FFmpeg。
- 数字人调用已安装的 `inferflow-codex/scripts/run_skill.py` 与其已有配置。
- AI 文案使用 `DEEPSEEK_API_KEY`；封面使用 `DASHSCOPE_API_KEY`，优先环境变量，其次 DSH_HOME 的 `.credentials.yaml`。密钥不送到客户端。
- 未安装 SenseVoice 模型时使用能量/停顿级字幕校准，界面明确显示校准等级。

任务保存到 `$DSH_HOME/ejianbao/jobs/<id>`。每个任务独立素材、渲染目录和产物。一次运行一个任务；取消时终止该任务子进程树；退出应用时中断任务，重新启动后可继续。已成功阶段会复用，修改素材请新建任务。

## 插件构建

在易宝工坊仓库根目录执行：

```sh
corepack yarn install
corepack yarn workspace cqai-dsh-plugin-video build
corepack yarn workspace cqai-dsh-plugin-video typecheck
corepack yarn workspace cqai-dsh-plugin-video test
```

插件已加入稳定版与 Beta 桌面默认组件。单独安装到普通 Web profile 时可使用 DSH 标准本地包安装流程；需要 DSH 0.1.5-rc.1 兼容的官方 UI 插槽。插件以本机服务为使用边界，不对局域网远程浏览器开放任务执行 API。

## 验证范围

自动测试覆盖任务状态、失败、请求来源、目录约束和视频 Range 读取。验收另外使用短测试视频执行真实本地渲染。云端数字人、AI 文案和付费封面不会为了安装验收而创建收费任务。
