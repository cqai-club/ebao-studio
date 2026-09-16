# 来源与适配

- 仓库：https://github.com/wangpeng668866/dsh-shortvideo-pipeline
- 固定提交：`d547174b65271e67932cdedd4f8b10c20be72ef8`
- 许可：MIT，保留原始 LICENSE。
- `runtime/stages`、`runtime/templates`、`runtime/align-engine`、`runtime/render-studio` 来自上述仓库。

新增 `runtime/runner.py`，为 DSH 提供独立任务目录、进度事件、已有视频模式、断点续跑和明确的产物校验。渲染通过固定本地 Remotion CLI 运行，使用每个任务自己的渲染目录。

适配修改：移除开发者固定 FFmpeg 路径与 156.6 秒时长；按实际视频长度缩放字幕；离线文案不丢首段或长句；修复正则替换中的反斜杠；标题从当前任务传入；移除示例推广二维码；视频保持原始比例；补齐 Vosk 模型查找函数；预览台上传/导入失败不再报成功；凭据支持环境变量与 DSH_HOME；兼容 Codex skill 目录。

原仓库中的 `pipeline.py` 不作为插件入口，原 `stage_render.py` 保留作来源参考，实际渲染由任务适配器执行。`demo` 目录不包含在插件中。
