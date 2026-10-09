---
name: publisher-edit-draft
description: 仅在多平台发布编辑页已绑定当前草稿，且用户要求读取或修改该本地草稿时使用。保存编辑不会发布；明确发布需求使用 multiplatform-publish。
---

# 编辑当前本地草稿

读取本 Skill 后，下一步获得当前绑定草稿的编辑工具。先调用 `publisher_get_current_draft`；没有绑定时停止，不能选用其他草稿。只编辑绑定稿，不登记外部 Markdown 原稿或准备平台发布预览。

- 文章：标题、正文、摘要、标签、内容声明、封面、正文图片。
- 图文：标题、正文、标签、内容声明、封面、图片顺序；可添加用户选中的附件图片，或按明确要求删除图片。
- 视频：标题、简介、短标题、标签、内容声明；用 `publisher_list_video_works` / `publisher_select_current_video_work` 选择已有 e剪宝成片。画面剪辑在 e剪宝中完成，本地视频由用户通过文件选择器选择。

每次写入先读取最新 `content_id`、`revision` 和 `binding_token`，一起传入工具。草稿已更新或切换时重新读取，再按用户要求修改，不能用旧修订号覆盖。

`publisher_update_current_draft` 保存主稿字段；添加、插入、删除图片及视频成片选择各使用对应工具。只改用户要求的字段，保留其余主稿、平台版本与账号设置。

这些操作只保存本地草稿。只有用户明确要求发布或保存平台草稿时，读取 `multiplatform-publish`，用最新草稿版本创建确认卡片，由用户选择账号、方式并点击确认。不能绕过确认。
