import { expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Button: 'button' }))
import { desktopTranslate } from '../src/client/settings.tsx'

it('titles the settings page with the channel name instead of the shared Desktop copy', () => {
  expect(desktopTranslate('zh-CN')('title')).toBe('e宝工坊 Beta 设置')
  expect(desktopTranslate('en')('title')).toBe('e宝工坊 Beta settings')
})
