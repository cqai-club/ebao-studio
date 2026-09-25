import { describe, expect, it } from 'vitest'
import { accountPlatformOrder } from '../src/client/account-platform-order.ts'

describe('publication target account order', () => {
  it('places requested platforms first without removing other supported account choices', () => {
    expect(accountPlatformOrder('article', ['wxmp', 'tt'])).toEqual(['wxmp', 'tt', 'juejin', 'blbl', 'bjh'])
    expect(accountPlatformOrder('image-note', ['tt', 'xhs'])).toEqual(['tt', 'xhs', 'dy', 'ks'])
  })

  it('ignores unsupported or duplicate targets in the display order', () => {
    expect(accountPlatformOrder('article', ['wxmp', 'xhs', 'wxmp'])).toEqual(['wxmp', 'juejin', 'blbl', 'tt', 'bjh'])
  })
})
