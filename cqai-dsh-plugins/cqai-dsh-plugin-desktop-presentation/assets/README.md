# 首页插画与数字员工卡片封面

`ebao-robot.webp` 是基于用户提供的 E宝机器人截图，经内置 `image_gen` 提取并补全的透明插画。生成提示词的核心要求是保留白色圆润机身、黑色椭圆面罩、青蓝发光眼睛、蓝色耳机、胸前蓝色 `e` 与金色星星，移除场景和文字，输出透明背景。原始透明 PNG 为 1390 × 1132；项目内将其缩至 720 × 586 并编码为含透明通道的 WebP（quality 88，约 49 KiB）。机器人和已安装数字员工图标的轻微漂浮由 CSS 实现，不依赖 GIF 或视频资源。

2026-09-29 使用内置 `image_gen` 生成八张横向封面：五张对应现有工作台，三张作为其他数字员工的默认背景。生成时统一要求左侧保留深色文字区、右侧放主题画面，并排除文字、Logo 和界面控件。生成的 PNG 仅缩放至 960 × 540 后转为 WebP（quality 72），没有手绘修改画面；八张图片合计约 259 KiB。`tsdown` 将 WebP 作为 data URL 打入 Client bundle。

随后以原封面逐张作为参照，用内置 `image_gen` 将右侧主体重新生成带透明背景的切图，移除暗色场景、地面和文字区。透明 PNG 仅缩放至 800 × 450 并编码为保留 alpha 通道的 WebP（quality 72）；八张合计约 430 KiB。卡片的背景和前景色现在由 CSS 主题变量绘制，图片本身不再含整幅深色底图。输出图左侧 40% 区域没有可见不透明像素，卡片还使用随底色变化的柔和渐隐保护文字。生成的原始 PNG 留在本机 Codex generated_images 目录，包内只提供压缩后的 WebP。

| 文件 | 用途 |
| --- | --- |
| `covers/imagegen.webp` | e图宝：画面与镜头 |
| `covers/video.webp` | e剪宝：胶片与剪辑 |
| `covers/short-video.webp` | 短视频制作：竖幅分镜 |
| `covers/talkcraft.webp` | 口播视频制作：麦克风与声波 |
| `covers/publisher.webp` | 多平台发布：内容分发 |
| `covers/default-nebula.webp` | 通用：蓝紫星云 |
| `covers/default-sculpture.webp` | 通用：暖色抽象雕塑 |
| `covers/default-jade.webp` | 通用：翡翠色拱廊 |

匹配规则位于 `src/client/covers.ts`。已知面板用专属封面，内置的待上线员工轮换使用三张通用封面；其他未知面板以 ID 哈希映射到同一组通用封面，因此不同会话和重启后图片保持一致。
