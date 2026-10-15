# Publisher 写作 Skill 来源与修改说明

四个写作 Skill 与新增的文章配图 Skill 都是面向多平台发布专属会话的自包含适配版本，不是上游项目的原样分发。正文不需要读取上游参考文件或执行第三方脚本；配图使用产品已有的原生 `ebao-imagegen` 能力。来源核对日期：2026-10-15。

## 来源与许可证

| 上游来源 | 取材范围 | 保留的原始许可 |
| --- | --- | --- |
| [op7418/Humanizer-zh](https://github.com/op7418/Humanizer-zh)，[SKILL.md](https://github.com/op7418/Humanizer-zh/blob/main/SKILL.md) | `publisher-polish-copy` 参考其保留原意、信息边界和按语境处理模板化表达的方法；未复制示例或整套词表。上游注明其方法参考 blader/humanizer、Humanizer-zh PR 39 及 hardikpandya/stop-slop。 | MIT，Copyright (c) 2026 歸藏；原文见 [humanizer-zh-MIT.txt](licenses/humanizer-zh-MIT.txt)。 |
| [yaoleifly/wechat-writing-style](https://github.com/yaoleifly/wechat-writing-style)，[SKILL.md](https://github.com/yaoleifly/wechat-writing-style/blob/main/SKILL.md) | `publisher-write-article` 与 `publisher-polish-copy` 参考中文可读性、短段落及标题表达建议；未保留作者主题、第一人称经历、固定免责声明和互动文案。 | MIT，Copyright (c) 2026 yaoleifly；原文见 [wechat-writing-style-MIT.txt](licenses/wechat-writing-style-MIT.txt)。 |
| [xstongxue/best-skills](https://github.com/xstongxue/best-skills)，[风格提取维度](https://github.com/xstongxue/best-skills/blob/main/skills/wechat-article-writer/reference/extraction_dimensions.md) 与 [SKILL.md](https://github.com/xstongxue/best-skills/blob/main/skills/wechat-article-writer/SKILL.md) | `publisher-learn-voice` 参考结构、语言和阅读节奏等分析维度；去除原作者身份、固定风格示例、规定规则数量、Draw.io、脚本与微信公众号上传流程。 | Apache License 2.0；原文见 [best-skills-Apache-2.0.txt](licenses/best-skills-Apache-2.0.txt)。 |
| [JimLiu/baoyu-skills](https://github.com/JimLiu/baoyu-skills)，[baoyu-article-illustrator](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-article-illustrator/SKILL.md)，本次核对版本 `1.117.4`；[提示词构造](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-article-illustrator/references/prompt-construction.md) 与 [配图流程](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-article-illustrator/references/workflow.md) | `publisher-illustrate-article` 参考按论点选择配图位置、区分图的信息结构与画风配色、提示词明确构图及文章数据的方法；中文独立改写，不复制长模板、风格目录、示例或脚本。 | MIT，Copyright (c) 2026 Jim Liu；原文见 [baoyu-skills-MIT.txt](licenses/baoyu-skills-MIT.txt)。 |

## 本地修改

- 起稿和平台适配的业务流程自主编写；不复制许可全文尚未确认的 Daniel123jia/wechat-article-generator-skills 或 Composio 资料的表达、模板、示例或文件。
- 将文件输出及全局安装约定替换为 Publisher 当前稿件读写，不建立外部草稿目录、会话或工作区。
- 采用最新绑定令牌、修订号与右侧编辑目标，仅提交本次涉及的字段，保留并合并用户手动修改。
- 将学习文风与持久写作偏好独立出来；只在用户要求持续记住时保存表达规则，不保存样稿正文、个人身份或经历事实，不把偏好混入文章。
- 按任务选择轻量修改或需要的研究，取消固定长链、默认全字段改写、虚构个人实测与夸张传播承诺。
- 写作类 Skill 仅保存本地草稿，不包含配图生成、凭证处理、上传或发布功能。
- 配图 Skill 使用现有原生生图 Skill 与 Publisher 附件导入工具；去除上游全局偏好、外部文件目录、专属后端与脚本、固定批量及强制多轮确认。逐张向最新绑定文章的通用正文插图，不修改持久文风，不上传或发布。

## 许可文件获取记录

以下文本从各上游 `main/LICENSE` 直接下载，未改写许可或版权声明；保留其原始字节。文件的 SHA-256 用于核对本次分发内容，不表示上游主分支永远不变。

| 文件 | 原始 URL | SHA-256 |
| --- | --- | --- |
| `humanizer-zh-MIT.txt` | <https://raw.githubusercontent.com/op7418/Humanizer-zh/main/LICENSE> | `aa00e74769e1b9d8e7fa7094dbfcca9b129a0ded6dce1cf4da050b99146d2fa7` |
| `wechat-writing-style-MIT.txt` | <https://raw.githubusercontent.com/yaoleifly/wechat-writing-style/main/LICENSE> | `61fad49d5a8a4635830c5989ee211cdb82142225bee425e0e2e7624e03c054b6` |
| `best-skills-Apache-2.0.txt` | <https://raw.githubusercontent.com/xstongxue/best-skills/main/LICENSE> | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `baoyu-skills-MIT.txt` | <https://raw.githubusercontent.com/JimLiu/baoyu-skills/main/LICENSE> | `601839401f6ce68b7a8aec0f7ba247ab8ef0848113378220bec4b2615cc84ee7` |

上游 README 中的质量、传播效果与兼容性陈述不代表本插件已实测或保证其结果。
