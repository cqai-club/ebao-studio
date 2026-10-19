import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  TextRun,
} from 'docx'
import { formatAuthorsForCitation } from './literature.ts'
import { safeFileStem, type Degree, type ScholarProject } from './protocol.ts'

interface TemplateMetrics {
  marginTop: number
  marginBottom: number
  marginLeft: number
  marginRight: number
  titleSize: number
  headingSizes: [number, number, number]
  bodySize: number
  line: number
  firstLine: number
  titlePage: boolean
}

const MM = 56.6929

const METRICS: Record<Degree | 'journal', TemplateMetrics> = {
  journal: {
    marginTop: 25 * MM,
    marginBottom: 25 * MM,
    marginLeft: 24 * MM,
    marginRight: 24 * MM,
    titleSize: 36,
    headingSizes: [28, 24, 22],
    bodySize: 21,
    line: 300,
    firstLine: 420,
    titlePage: false,
  },
  undergraduate: {
    marginTop: 25 * MM,
    marginBottom: 25 * MM,
    marginLeft: 30 * MM,
    marginRight: 25 * MM,
    titleSize: 42,
    headingSizes: [32, 28, 24],
    bodySize: 24,
    line: 360,
    firstLine: 480,
    titlePage: true,
  },
  master: {
    marginTop: 30 * MM,
    marginBottom: 25 * MM,
    marginLeft: 32 * MM,
    marginRight: 26 * MM,
    titleSize: 48,
    headingSizes: [34, 28, 24],
    bodySize: 24,
    line: 360,
    firstLine: 480,
    titlePage: true,
  },
  doctoral: {
    marginTop: 35 * MM,
    marginBottom: 28 * MM,
    marginLeft: 34 * MM,
    marginRight: 28 * MM,
    titleSize: 52,
    headingSizes: [36, 30, 26],
    bodySize: 24,
    line: 384,
    firstLine: 480,
    titlePage: true,
  },
}

function run(text: string, size: number, options: { bold?: boolean; italics?: boolean; color?: string } = {}): TextRun {
  return new TextRun({
    text,
    size,
    ...options,
    font: {
      ascii: 'Times New Roman',
      hAnsi: 'Times New Roman',
      eastAsia: '宋体',
      cs: 'Times New Roman',
    },
  })
}

function cleanInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[*_~`]/gu, '')
    .replace(/<[^>]+>/gu, '')
    .trim()
}

function stripFirstTitle(markdown: string, title: string): string {
  const normalized = markdown.replace(/\r\n/gu, '\n').trim()
  const firstBreak = normalized.indexOf('\n')
  const first = firstBreak < 0 ? normalized : normalized.slice(0, firstBreak)
  if (/^#\s+/u.test(first) && cleanInlineMarkdown(first.slice(2)).toLocaleLowerCase() === title.toLocaleLowerCase()) {
    return firstBreak < 0 ? '' : normalized.slice(firstBreak + 1).trim()
  }
  return normalized
}

function markdownParagraphs(markdown: string, metrics: TemplateMetrics): Paragraph[] {
  const lines = markdown.replace(/\r\n/gu, '\n').split('\n')
  const paragraphs: Paragraph[] = []
  let paragraphBuffer: string[] = []
  let inCode = false

  const flush = () => {
    const text = cleanInlineMarkdown(paragraphBuffer.join(' '))
    paragraphBuffer = []
    if (text === '') return
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { line: metrics.line, after: 0 },
      indent: { firstLine: metrics.firstLine },
      children: [run(text, metrics.bodySize)],
    }))
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.trim() === '```') {
      flush()
      inCode = !inCode
      continue
    }
    if (inCode) {
      if (line.trim() !== '') {
        paragraphs.push(new Paragraph({
          spacing: { line: 280, after: 0 },
          indent: { left: 360 },
          children: [new TextRun({
            text: line,
            size: 18,
            font: { ascii: 'Consolas', hAnsi: 'Consolas', eastAsia: '等线', cs: 'Consolas' },
          })],
        }))
      }
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line)
    if (heading !== null) {
      flush()
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3
      const size = level === 1 ? metrics.headingSizes[0] : level === 2 ? metrics.headingSizes[1] : metrics.headingSizes[2]
      paragraphs.push(new Paragraph({
        heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        spacing: { before: level === 1 ? 360 : 240, after: level === 1 ? 180 : 120, line: metrics.line },
        alignment: level === 1 ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [run(cleanInlineMarkdown(heading[2]), size, { bold: true })],
      }))
      continue
    }
    const quote = /^>\s?(.*)$/u.exec(line)
    if (quote !== null) {
      flush()
      const text = cleanInlineMarkdown(quote[1])
      if (text !== '') {
        paragraphs.push(new Paragraph({
          spacing: { line: metrics.line, after: 0 },
          indent: { left: 480, right: 360, firstLine: 0 },
          children: [run(text, metrics.bodySize, { italics: true })],
        }))
      }
      continue
    }
    const bullet = /^[-*+]\s+(.+)$/u.exec(line)
    if (bullet !== null) {
      flush()
      paragraphs.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { line: metrics.line, after: 0 },
        children: [run(cleanInlineMarkdown(bullet[1]), metrics.bodySize)],
      }))
      continue
    }
    const numbered = /^\d+[.)]\s+(.+)$/u.exec(line)
    if (numbered !== null) {
      flush()
      paragraphs.push(new Paragraph({
        numbering: { reference: 'research-numbering', level: 0 },
        spacing: { line: metrics.line, after: 0 },
        children: [run(cleanInlineMarkdown(numbered[1]), metrics.bodySize)],
      }))
      continue
    }
    if (/^\s*---+\s*$/u.test(line)) {
      flush()
      paragraphs.push(new Paragraph({ children: [new PageBreak()] }))
      continue
    }
    if (line.trim() === '') flush()
    else paragraphBuffer.push(line.trim())
  }
  flush()
  return paragraphs
}

function titlePage(project: ScholarProject, metrics: TemplateMetrics): Paragraph[] {
  const degreeLabel = project.layout.degree === 'undergraduate'
    ? '本科毕业论文'
    : project.layout.degree === 'doctoral'
      ? '博士学位论文'
      : '硕士学位论文'
  return [
    new Paragraph({ spacing: { before: 900, after: 0 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 900 },
      children: [run(degreeLabel, 32, { bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 720 },
      children: [run(project.title, metrics.titleSize, { bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [run(`作者：${project.layout.author || '________'}`, 24)],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [run(`单位：${project.layout.affiliation || '________'}`, 24)],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600 },
      children: [run(new Date(project.updatedAt).toLocaleDateString('zh-CN'), 24)],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ]
}

function referenceParagraphs(project: ScholarProject): Paragraph[] {
  if (project.sources.length === 0) return []
  if (/^#{1,3}\s*(参考文献|references)\s*$/imu.test(project.content)) return []
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 360, after: 180, line: 360 },
      alignment: AlignmentType.CENTER,
      children: [run(project.language === 'zh' ? '参考文献' : 'References', 30, { bold: true })],
    }),
    ...project.sources.map((source, index) => new Paragraph({
      spacing: { line: 320, after: 0 },
      indent: { hanging: 360 },
      children: [run(`[${index + 1}] ${formatAuthorsForCitation(source.authors, project.language)}. ${
        source.title
      }${source.venue === undefined ? '' : `. ${source.venue}`}${source.year === undefined ? '' : `, ${source.year}`}.${
        source.doi === undefined ? '' : ` https://doi.org/${source.doi}`
      }`, 21)],
    })),
  ]
}

export function exportTemplateKey(project: ScholarProject): 'journal' | Degree {
  return project.layout.template === 'journal' ? 'journal' : project.layout.degree
}

export async function createDocxBuffer(project: ScholarProject): Promise<Buffer> {
  const key = exportTemplateKey(project)
  const metrics = METRICS[key]
  const body = stripFirstTitle(project.content, project.title)
  const content = markdownParagraphs(body, metrics)
  const references = referenceParagraphs(project)
  const title = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 360, line: metrics.line },
    children: [run(project.title, metrics.titleSize, { bold: true })],
  })
  const summary = project.abstract.trim() === ''
    ? []
    : [
        new Paragraph({
          spacing: { after: 120, line: metrics.line },
          indent: { firstLine: metrics.firstLine },
          children: [
            run(project.language === 'zh' ? '摘要：' : 'Abstract: ', metrics.bodySize, { bold: true }),
            run(project.abstract, metrics.bodySize),
          ],
        }),
        ...project.keywords.length === 0 ? [] : [new Paragraph({
          spacing: { after: 240, line: metrics.line },
          children: [
            run(project.language === 'zh' ? '关键词：' : 'Keywords: ', metrics.bodySize, { bold: true }),
            run(project.keywords.join(project.language === 'zh' ? '；' : '; '), metrics.bodySize),
          ],
        })],
      ]
  const document = new Document({
    creator: 'e研宝',
    title: project.title,
    description: project.prompt,
    numbering: {
      config: [{
        reference: 'research-numbering',
        levels: [{
          level: 0,
          format: 'decimal',
          text: '%1.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 480, hanging: 240 } } },
        }],
      }],
    },
    styles: {
      default: {
        document: {
          run: {
            size: metrics.bodySize,
            font: { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: '宋体', cs: 'Times New Roman' },
          },
          paragraph: { spacing: { line: metrics.line, after: 0 } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: {
            top: metrics.marginTop,
            right: metrics.marginRight,
            bottom: metrics.marginBottom,
            left: metrics.marginLeft,
            header: 720,
            footer: 720,
          },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({
              children: [PageNumber.CURRENT],
              size: 20,
              font: { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: '宋体', cs: 'Times New Roman' },
            })],
          })],
        }),
      },
      children: [
        ...metrics.titlePage ? titlePage(project, metrics) : [],
        title,
        ...summary,
        ...content,
        ...references,
      ],
    }],
  })
  return await Packer.toBuffer(document)
}

export function docxFileName(project: ScholarProject): string {
  const suffix = project.layout.template === 'journal'
    ? '期刊排版'
    : project.layout.degree === 'undergraduate'
      ? '本科论文排版'
      : project.layout.degree === 'doctoral'
        ? '博士论文排版'
        : '硕士论文排版'
  return `${safeFileStem(project.title)}-${suffix}.docx`
}
