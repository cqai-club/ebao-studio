# 固定来源

- 上游：`Vincentwei1021/video-talkcraft`
- 本地提交：`914103688cdec20ea35699f73b08e357a817c37a`
- 来源目录：`E:\workspace\project\video-talkcraft`
- `upstream/` 复制该提交中的 924 个受 Git 跟踪的普通文件；四个符号链接没有复制（`workbench/node_modules`、`workbench/tplcards`、两个 gallery 预览目录）。工程源码与模板通过显式路径映射；`node_modules` 由一次性准备流程建立指向独立 React 19 运行时的 Windows junction。
- 对固定快照的插件适配涉及 `workbench/kbsrc.map.mjs`、`workbench/scripts/gen-index.mjs`、`workbench/vite.config.ts`、`workbench/remotion.config.ts`、`workbench/src/App.tsx`、`workbench/src/exportJob.ts`、`workbench/src/pipeline/ShotPanel.tsx`、`scripts/tts_fishaudio.py`、`scripts/timestamps_cpu.py`、`scripts/test_fish_regressions.py`、`scripts/render_shots.mjs`、`scripts/private_tools.py`、使用 FFmpeg 的 Python 检查脚本和 `runtime/.gitignore`。这些改动实现任务目录映射、独立导出、应用内预览、私有 Remotion 平台工具路径、Fish 请求不重试、GBK 控制台警告输出兼容和本地环境产物忽略。其余上游文件仍是该提交的内容。
- 依赖版本以 `upstream/runtime/package-lock.json` 为准；不会在 Desktop 启动时升级。
- 上游 `SKILL.md` 仍描述每片调用 `check-runtime.sh --upgrade`；插件的分阶段 Agent 指令明确覆盖这一条。Desktop 设置页的一键安装将锁定运行时准备到版本化的应用私有目录，`runtime:prepare` 仅供原源码开发使用。

本插件的 Host、Client、任务数据、Credentials 记录和工作台服务都独立于 e剪宝。
