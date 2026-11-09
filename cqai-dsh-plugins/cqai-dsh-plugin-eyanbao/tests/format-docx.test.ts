import { describe, expect, it } from 'vitest'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import JSZip from 'jszip'
import { formatDocx, previewDocx } from '../src/format-docx.ts'

describe('通用 DOCX 排版副本', () => {
  it('只改变样式文件，保留正文、资源与其他包条目', async () => {
    const source = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('真实原稿内容')] })] }] }))
    const a = await JSZip.loadAsync(source)
    a.file('word/media/user-data.bin', Buffer.from([1, 2, 3]))
    const existingStyles = await a.file('word/styles.xml')!.async('string')
    a.file('word/styles.xml', existingStyles.replace(/<w:docDefaults(?:\s[^>]*)?>[\s\S]*?<\/w:docDefaults>/, '<w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="fr-FR"/><w:rFonts w:cs="ExistingFont"/><w:sz w:val="18"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="160" w:after="200"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults>'))
    const input = await a.generateAsync({ type: 'nodebuffer' })
    const formatted = await formatDocx({ fileName: '论文.docx', dataBase64: input.toString('base64'), preset: 'thesis' })
    expect(formatted.name).toBe('论文-格式副本.docx')
    const before = await JSZip.loadAsync(input), after = await JSZip.loadAsync(formatted.buffer)
    const files = Object.keys(before.files).filter(x => !before.files[x].dir)
    for (const file of files) {
      if (file === 'word/styles.xml') continue
      expect(await after.file(file)?.async('nodebuffer')).toEqual(await before.file(file)?.async('nodebuffer'))
    }
    const styles = await after.file('word/styles.xml')!.async('string')
    expect(styles).toContain('Times New Roman')
    expect(styles).toContain('w:val="fr-FR"')
    expect(styles).toContain('w:cs="ExistingFont"')
    expect(styles).toContain('w:before="160"')
    expect(styles).toContain('w:after="200"')
    expect(styles).toContain('w:widowControl')
    expect(styles).toContain('w:line="360"')
  })
  it('拒绝非 DOCX、错误参数和损坏的 ZIP', async () => {
    await expect(formatDocx({fileName:'x.txt', dataBase64:'', preset:'journal'})).rejects.toThrow()
    await expect(formatDocx({fileName:'x.docx', dataBase64:Buffer.from('not a zip').toString('base64'), preset:'journal'})).rejects.toThrow()
    await expect(formatDocx({fileName:'x.docx', dataBase64:'@@@@', preset:'thesis'})).rejects.toThrow()
  })
  it('提取自有模板的默认样式并返回变化，应用时保留源文件其他内容', async () => {
    const source = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('原始内容')] }] }))
    const templateZip = await JSZip.loadAsync(source)
    const styles = await templateZip.file('word/styles.xml')!.async('string')
    templateZip.file('word/styles.xml', styles.replace(/<w:docDefaults(?:\s[^>]*)?>[\s\S]*?<\/w:docDefaults>/, '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="黑体"/><w:sz w:val="28"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="480" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'))
    const template = await templateZip.generateAsync({ type: 'nodebuffer' })
    const request = {fileName:'source.docx', dataBase64:source.toString('base64'), preset:'custom', templateFileName:'template.docx', templateBase64:template.toString('base64')}
    const preview = previewDocx(request)
    expect(preview.changes).toEqual(expect.arrayContaining([expect.objectContaining({field:'东亚字体', after:'黑体'}), expect.objectContaining({field:'字号（半磅）', after:'28'}), expect.objectContaining({field:'行距（Word 单位）', after:'480'})]))
    const output = await formatDocx(request)
    const a = await JSZip.loadAsync(source), b = await JSZip.loadAsync(output.buffer)
    expect(await b.file('word/document.xml')!.async('nodebuffer')).toEqual(await a.file('word/document.xml')!.async('nodebuffer'))
    expect(await b.file('word/styles.xml')!.async('string')).toContain('w:eastAsia="黑体"')
  })
})
