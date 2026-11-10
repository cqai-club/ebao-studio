# e研宝

面向在职研究生与博士生的 DeepSeek Harness 研究写作工作台。它以一个侧栏入口承载：

- 一句话查文献
- 中外文、中文、外文三种文献范围
- 外文文献支持全部期刊、顶刊优先、仅顶级期刊三档
- AI 研究助手支持优化研究需求、生成检索词、推荐研究方法和论文提纲
- 多数据库检索：OpenAlex、Crossref、PubMed、Semantic Scholar、Web of Science、Scopus、Google Scholar、CNKI、万方
- 一句话生成文献综述
- 一句话生成期刊论文
- 一句话生成研究论文
- 一句话生成毕业论文
- 对已有 DOCX 预览并应用通用默认样式，或提取自有 DOCX 模板中的默认字体、字号和行距，确认后导出副本

## 功能边界

检索通过 OpenAlex、Crossref、PubMed 和 Semantic Scholar 完成，每条结果均标明实际来源数据库；生成使用 DSH 当前默认文字模型。外文或混合检索会优先使用模型生成英文检索词，
并在结果中过滤出对应语言的来源，来源列表会同时显示数据库统计和逐条语言标识。来源数据、正文、引用和排版设置保存在
`$DSH_HOME/eyanbao/projects/<id>/project.json`。研究材料可选填入文本，材料会发送给配置的模型提供方，不作为数据库检索词；材料本身不单独存入项目，但生成的草稿可能包含其内容。生成与引用需要作者检查，模型提示不能保证引用和事实准确。

“顶刊优先”使用跨学科精选顶刊库并结合被引次数排序；“仅顶级期刊”只保留精选库中的来源。Nature、Science、Cell、
The Lancet、Academy of Management Journal、MIS Quarterly、American Economic Review、Review of Educational Research、
IEEE TPAMI 等均在库中，完整分组见 [顶级外文期刊库](./docs/top-journals.md)。

任务栏左侧的 AI 研究助手围绕当前需求提供研究规划建议。结果可以替换或追加到研究需求；它不会把建议自动当作检索证据。

OpenAlex、Crossref、PubMed 和 Semantic Scholar 无需配置即可使用；Semantic Scholar 可通过 `S2_API_KEY` 提高配额。Web of Science、Scopus、Google Scholar、CNKI 和万方需要在宿主环境配置
供应商 API 凭据或企业网关；未配置的数据库会在选择器中显示原因并禁用。配置方法见 [数据库接入](./docs/databases.md)。

排版处理 DOCX 原稿并导出副本。通用基线和用户模板仅调整文档默认字体、字号与行距；命名样式、直接格式、页边距、页眉页脚、目录和引用格式不会按模板迁移。已有显式格式可能覆盖默认值。此功能不保证符合任何学校或期刊的规范，必须对照最新要求人工检查，原稿和模板仅提交给本机插件处理。

## 开发

从仓库根目录运行：

```sh
corepack yarn workspace cqai-dsh-plugin-eyanbao typecheck
corepack yarn workspace cqai-dsh-plugin-eyanbao test
corepack yarn workspace cqai-dsh-plugin-eyanbao build
```

插件不修改 `deepseek-harness` 子模块，也不依赖 e剪宝或任何视频插件。

## 在 e宝工坊中加载

先完成构建，再从 DSH Terminal 把本地插件包加入一个非 `desktop` 的开发 Profile：

```sh
dsh plugin --profile <profile> add "/path/to/Chongqing-AI-Innovation-Sharing-Club-Public-Plugin/plugins/cqai-dsh-plugin-eyanbao"
```

重启应用后，侧栏会出现独立的「e研宝」入口。默认使用当前 Profile 的默认文字模型，不需要另填 API Key。
