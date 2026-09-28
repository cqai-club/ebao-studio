import { describe, expect, it } from 'vitest'
import { parseShotbook } from '../src/client/shotbook.ts'

describe('分镜确认展示', () => {
  it('extracts narration and the matching uploaded picture from a TalkCraft shotbook', () => {
    const markdown = `# SHOTBOOK
### S01 0.00–2.16 · 开场提问「徒步是什么？」
- **画面意图**：海边人物缓慢靠近。
- **文案**：很多人问，徒步到底是什么？
- 素材：图（remotion/public/assets/image-abc.jpg）
  - 来源：用户上传 DJI_0206.JPG（原档 inputs/image-abc.jpg）

### S02 2.16–8.28 · 解释
- **文案**：其实徒步没有那么复杂。
- 素材：图（remotion/public/assets/image-def.jpg）
`
    const uploads = [{kind: 'image' as const, file: 'inputs/image-abc.jpg', name: 'DJI_0206.JPG'}]
    const cards = parseShotbook(markdown, uploads)
    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({id: 'S01', start: 0, end: 2.16, title: '开场提问「徒步是什么？」', narration: '很多人问，徒步到底是什么？', visual: '海边人物缓慢靠近。', upload: uploads[0]})
    expect(cards[1].upload).toBeUndefined()
    expect(parseShotbook(markdown.replace(/\n/g, '\r\n'), uploads)).toHaveLength(2)
  })
})
