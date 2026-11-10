import { describe, expect, it } from 'vitest'
import { createDocxBuffer, docxFileName, exportTemplateKey } from '../src/docx.ts'
import { project } from './fixtures.ts'

describe('DOCX layout export', () => {
  it('packages a journal manuscript with title, body, references, and page numbering', async () => {
    const buffer = await createDocxBuffer(project())
    expect(buffer.subarray(0, 2).toString()).toBe('PK')
    expect(buffer.byteLength).toBeGreaterThan(8_000)
    expect(buffer.indexOf(Buffer.from('word/document.xml'))).toBeGreaterThan(-1)
    expect(buffer.indexOf(Buffer.from('word/footer1.xml'))).toBeGreaterThan(-1)
    expect(docxFileName(project())).toContain('期刊排版.docx')
  })

  it('uses distinct thesis templates for each degree', async () => {
    const bachelor = project({ layout: { ...project().layout, template: 'thesis', degree: 'undergraduate' } })
    const master = project({ layout: { ...project().layout, template: 'thesis', degree: 'master' } })
    const doctor = project({ layout: { ...project().layout, template: 'thesis', degree: 'doctoral' } })
    expect(exportTemplateKey(bachelor)).toBe('undergraduate')
    expect(exportTemplateKey(master)).toBe('master')
    expect(exportTemplateKey(doctor)).toBe('doctoral')
    const buffers = await Promise.all([bachelor, master, doctor].map(createDocxBuffer))
    expect(new Set(buffers.map(buffer => buffer.byteLength)).size).toBeGreaterThan(1)
    expect(docxFileName(doctor)).toContain('博士论文排版.docx')
  })
})
