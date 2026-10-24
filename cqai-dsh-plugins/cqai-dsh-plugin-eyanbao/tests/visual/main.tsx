import { createRoot } from 'react-dom/client'
import type { ScholarProject } from '../../src/protocol.ts'
import { EyanbaoWorkspace } from '../../src/client/EyanbaoWorkspace.tsx'
import { project } from '../fixtures.ts'

const content = `# 生成式 AI 与在职研究生的学术写作实践

> 摘要：本文基于 2021 年以来的实证研究，分析生成式 AI 对在职研究生学术写作投入、证据组织与学术规范的影响。研究发现，工具带来的效率提升并不自动转化为研究能力提升，写作过程中的判断、核验与反思仍然决定成果质量。

> 关键词：生成式 AI；学术写作；在职研究生；研究能力

## 1 引言

学术写作既是知识生产的结果，也是研究者形成判断的方法。对在职研究生而言，时间碎片化、资料获取渠道分散以及工作与学习双重压力，使写作推进常常受制于研究节奏。生成式 AI 的普及改变了资料整理、语言润色和结构草拟的成本，也把新的证据责任带回研究者本身[1]。

现有讨论容易把生成效率等同于研究质量。效率提高意味着单位时间可以完成更多文本操作，但研究质量还取决于问题是否清晰、材料是否可靠、论证是否可复核。本文据此区分“写作操作效率”和“研究判断能力”，并讨论二者在真实学习情境中的关系。

## 2 文献脉络

### 2.1 工具使用与写作投入

已有研究普遍观察到生成式工具能够降低起草阶段的认知负担，并帮助作者快速形成结构[2]。不过，工具使用与深度投入并非线性关系。若作者把结构判断完全交给模型，文本可能更流畅，但问题意识与证据链反而更弱。

### 2.2 证据核验与引用责任

学术写作的可信度依赖来源可追溯。模型可能生成看似完整但不存在的引文，因此检索结果、原文链接与人工核验必须进入写作流程[3]。将引用责任明确留在作者一侧，是使用生成式工具时不可替代的规范要求。

### 2.3 学习情境中的差异化影响

在职研究生的写作时间高度碎片化。工具可以帮助他们恢复写作连续性，但也可能造成“只改语言、不推进论证”的局部优化。对博士生而言，研究贡献与理论定位要求更高，工具更适合承担检索整理和语言校对，而非替代理论判断。

## 3 分析框架

本文将写作过程拆为四个环节：问题形成、证据组织、文本生成与规范校验。模型在文本生成环节具有明显优势，在问题形成与规范校验环节则需要作者保持主导。有效的协作不是把任务整体外包，而是根据环节重新分配注意力。

## 4 讨论

第一，写作效率必须与可复核性一起评价。第二，工具使用应当留下来源、版本和修改痕迹，使导师和合作者能够判断论证如何形成。第三，研究生需要把工具使用纳入学术规范训练，而不是只在提交前做形式检查。

## 5 结论

生成式 AI 可以成为在职研究生与博士生推进学术写作的辅助工具，但其价值取决于研究者是否保有问题的主导权、证据的核验权和文本的最终责任。后续研究可进一步比较不同学科、不同写作阶段中的使用差异。

## 参考文献

[1] Lovelace A、Turing A. Generative AI and knowledge work: a systematic review. Journal of Knowledge Systems, 2024. https://doi.org/10.1000/example.2024.1

[2] Hopper G. Writing with generative systems. Research Methods Quarterly, 2023.

[3] Berners-Lee T. Traceable evidence in digital scholarship. Open Scholarship, 2022.
`

const demoProject: ScholarProject = project({
  title: '生成式 AI 与在职研究生的学术写作实践',
  prompt: '写一篇关于生成式 AI 对在职研究生学术写作影响的研究论文',
  content,
  abstract: '本文基于 2021 年以来的实证研究，分析生成式 AI 对在职研究生学术写作投入、证据组织与学术规范的影响。',
  keywords: ['生成式 AI', '学术写作', '在职研究生', '研究能力'],
  sources: [
    {
      ...project().sources[0]!,
      venue: 'Academy of Management Journal',
      topJournal: true,
    },
    {
      id: 'crossref-2',
      title: 'Writing with generative systems',
      authors: ['Grace Hopper'],
      year: 2023,
      venue: 'Research Methods Quarterly',
      doi: '10.1000/example.2023.2',
      abstract: 'A study of writing practices when generative systems enter the drafting process.',
      source: 'crossref',
    },
    {
      id: 'crossref-3',
      title: 'Traceable evidence in digital scholarship',
      authors: ['Tim Berners-Lee'],
      year: 2022,
      venue: 'Open Scholarship',
      doi: '10.1000/example.2022.3',
      abstract: 'The paper argues that traceable evidence is a precondition for trustworthy digital scholarship.',
      source: 'crossref',
    },
  ],
})

const payload = (value: unknown): Response => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})

const realFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (url.includes('/api/cqai-eyanbao/health')) {
    return payload({ ok: true, modelReady: true, provider: 'DeepSeek', model: 'deepseek-chat' })
  }
  if (url.endsWith('/api/cqai-eyanbao/databases')) {
    return payload({
      databases: [
        { id: 'openalex', label: 'OpenAlex', available: true, requiresConfiguration: false },
        { id: 'crossref', label: 'Crossref', available: true, requiresConfiguration: false },
        { id: 'pubmed', label: 'PubMed', available: true, requiresConfiguration: false },
        { id: 'web-of-science', label: 'Web of Science', available: false, requiresConfiguration: true, reason: '需要 Clarivate WOS_API_KEY' },
        { id: 'scopus', label: 'Scopus', available: false, requiresConfiguration: true, reason: '需要 Elsevier SCOPUS_API_KEY' },
        { id: 'google-scholar', label: 'Google Scholar', available: false, requiresConfiguration: true, reason: '需要 SerpAPI Google Scholar 密钥' },
        { id: 'cnki', label: 'CNKI 中国知网', available: false, requiresConfiguration: true, reason: '需要 CNKI 企业 API 网关地址' },
        { id: 'wanfang', label: '万方数据', available: false, requiresConfiguration: true, reason: '需要万方数据 API 网关地址' },
      ],
    })
  }
  if (url.endsWith('/api/cqai-eyanbao/projects')) {
    return payload({
      projects: [{
        id: demoProject.id,
        title: demoProject.title,
        prompt: demoProject.prompt,
        kind: demoProject.kind,
        status: demoProject.status,
        sourceCount: demoProject.sources.length,
        updatedAt: demoProject.updatedAt,
      }],
    })
  }
  if (url.includes(`/api/cqai-eyanbao/projects/${demoProject.id}`)) {
    return payload({ project: demoProject })
  }
  return realFetch(input, init)
}

const params = new URLSearchParams(location.search)
const root = createRoot(document.querySelector('#root')!)
root.render(<EyanbaoWorkspace />)
if (params.get('scope') === 'foreign') {
  window.setTimeout(() => {
    const scope = document.querySelector<HTMLSelectElement>('#ey-literature-scope')
    if (scope !== null) {
      scope.value = 'foreign'
      scope.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }, 150)
}
if (params.get('quality') === 'top-only') {
  window.setTimeout(() => {
    const quality = document.querySelector<HTMLSelectElement>('#ey-journal-quality')
    if (quality !== null) {
      quality.value = 'top-only'
      quality.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }, 300)
}
if (params.get('ai') === 'open') {
  window.setTimeout(() => {
    const prompt = document.querySelector<HTMLTextAreaElement>('#ey-research-prompt')
    if (prompt !== null) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        prompt,
        '研究生成式 AI 对在职研究生学术写作投入与证据核验的影响',
      )
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }, 220)
  window.setTimeout(() => {
    document.querySelector<HTMLButtonElement>('[aria-label="打开 AI 研究助手"]')?.click()
  }, 350)
}
if (params.get('databases') === 'open') {
  window.setTimeout(() => {
    document.querySelector<HTMLElement>('.ey-database-picker summary')?.click()
  }, 350)
}
if (params.get('state') === 'document') {
  window.setTimeout(() => {
    const row = document.querySelector<HTMLButtonElement>('.ey-project')
    row?.click()
  }, 250)
}
