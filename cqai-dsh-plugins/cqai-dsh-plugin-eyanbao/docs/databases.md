# 文献数据库与来源标识

e研宝通过 Host 环境变量读取数据库凭据。密钥不会发送到浏览器。

## 学术技能中的开放索引

`academic-research-skills:deep-research` 的文献工作流使用可复核检索协议，而不是一个内置的“万能期刊搜索按钮”。其中的机器可读开放索引包括 OpenAlex、Crossref、Semantic Scholar、arXiv；引用核验还使用 DOI、OpenAlex、Crossref 和 Semantic Scholar。

e研宝已把这些索引中适合期刊发现的部分接入一句话检索：

- **OpenAlex**：跨学科期刊、作者、机构、摘要和被引元数据。
- **Crossref**：DOI 注册信息和出版社元数据。
- **Semantic Scholar**：跨学科论文元数据、摘要、被引次数和 DOI。
- **PubMed**：生物医学与生命科学文献。

每条结果都在来源统计和文献卡片上标明具体数据库。生成正文时，来源数据库也会作为证据上下文传入模型。

arXiv 属于预印本索引，不是期刊数据库，因此不会混入“外文期刊”来源统计；它的论文若同时被 OpenAlex 或 Semantic Scholar 索引，会按实际返回的索引标注来源。

## 无需密钥

- **OpenAlex**：主检索源。
- **Crossref**：DOI 与出版元数据。
- **PubMed**：NCBI E-utilities。可选 `NCBI_API_KEY` 提高请求配额。
- **Semantic Scholar**：Academic Graph API。可选 `S2_API_KEY` 提高请求配额。

OpenAlex 还可选配置 `OPENALEX_API_KEY` 提高每日预算，或配置 `OPENALEX_POLITE_EMAIL` 使用礼貌请求标识。

## 需要供应商凭据

| 数据库 | 环境变量 | 说明 |
|---|---|---|
| Web of Science | `WOS_API_KEY` | Clarivate WoS Starter/Expanded API Key |
| Scopus | `SCOPUS_API_KEY`、可选 `SCOPUS_INST_TOKEN` | Elsevier API Key 和机构令牌 |
| Google Scholar | `SERPAPI_API_KEY` | 通过 SerpAPI 的 Google Scholar 引擎访问；不抓取 Scholar 网页 |
| CNKI 中国知网 | `EYANBAO_CNKI_API_URL`、可选 `EYANBAO_CNKI_API_KEY` | 机构已有 CNKI 企业检索 API 或内部网关 |
| 万方数据 | `EYANBAO_WANFANG_API_URL`、可选 `EYANBAO_WANFANG_API_KEY` | 机构已有万方 API 或内部网关 |

## CNKI / 万方网关协议

网关地址可以是完整的 `/search` 地址，也可以是服务根地址。e研宝会向该地址发送：

```json
{
  "query": "检索表达式",
  "limit": 12,
  "database": "cnki"
}
```

如配置 API Key，请求头为 `Authorization: Bearer <key>`。响应可以是数组，或：

```json
{
  "items": [
    {
      "id": "source-id",
      "title": "文献题名",
      "authors": ["作者"],
      "year": 2024,
      "venue": "期刊名",
      "doi": "10.xxxx/xxxx",
      "url": "https://...",
      "abstract": "摘要",
      "language": "zh",
      "citedBy": 10
    }
  ]
}
```

CNKI、万方没有可公开直接调用的通用检索 API。未配置机构网关时，界面会明确显示“需要 API 网关”，不会用网页抓取冒充数据库接入。
