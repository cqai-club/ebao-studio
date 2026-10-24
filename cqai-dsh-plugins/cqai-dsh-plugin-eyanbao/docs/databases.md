# 文献数据库接入

e研宝通过 Host 环境变量读取数据库凭据。密钥不会发送到浏览器。

## 无需配置

- **OpenAlex**：主检索源。
- **Crossref**：DOI 与出版元数据。
- **PubMed**：NCBI E-utilities。可选 `NCBI_API_KEY` 提高请求配额。

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
