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
- 一句话生成期刊排版
- 一句话生成毕业论文排版
- 本科、硕士、博士三种学位论文排版基线

## 功能边界

检索通过 OpenAlex、Crossref、PubMed 和 Semantic Scholar 完成，每条结果均标明实际来源数据库；生成使用 DSH 当前默认文字模型。外文或混合检索会优先使用模型生成英文检索词，
并在结果中过滤出对应语言的来源，来源列表会同时显示数据库统计和逐条语言标识。来源数据、正文、引用和排版设置保存在
`$DSH_HOME/eyanbao/projects/<id>/project.json`。生成的正文只使用本次检索到的来源，证据不足时模型必须明确说明，不会伪造引用。

“顶刊优先”使用跨学科精选顶刊库并结合被引次数排序；“仅顶级期刊”只保留精选库中的来源。Nature、Science、Cell、
The Lancet、Academy of Management Journal、MIS Quarterly、American Economic Review、Review of Educational Research、
IEEE TPAMI 等均在库中，完整分组见 [顶级外文期刊库](./docs/top-journals.md)。

任务栏左侧的 AI 研究助手围绕当前需求提供研究规划建议。结果可以替换或追加到研究需求；它不会把建议自动当作检索证据。

OpenAlex、Crossref、PubMed 和 Semantic Scholar 无需配置即可使用；Semantic Scholar 可通过 `S2_API_KEY` 提高配额。Web of Science、Scopus、Google Scholar、CNKI 和万方需要在宿主环境配置
供应商 API 凭据或企业网关；未配置的数据库会在选择器中显示原因并禁用。配置方法见 [数据库接入](./docs/databases.md)。

排版导出为 DOCX。内置模板是通用学术基线，不等同于任何具体学校的强制规范；学校或期刊另有模板时，应以其最新文件为准。

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
