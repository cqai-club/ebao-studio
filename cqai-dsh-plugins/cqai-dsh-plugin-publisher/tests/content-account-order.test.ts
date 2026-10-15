import { describe, expect, it } from 'vitest'
import { accountPlatformOrder } from '../src/client/account-platform-order.ts'

describe('publication target account order', () => {
  it('places requested platforms first without removing other supported account choices', () => {
    expect(accountPlatformOrder('article', ['wxmp', 'tt'])).toEqual(['wxmp', 'tt', 'juejin', 'blbl', 'dy', 'bjh'])
    expect(accountPlatformOrder('article', ['dy'])).toEqual(['dy', 'juejin', 'blbl', 'tt', 'bjh', 'wxmp'])
    expect(accountPlatformOrder('image-note', ['tt', 'xhs'])).toEqual(['xhs', 'dy', 'ks', 'wxmp'])
  })

  it('ignores unsupported or duplicate targets in the display order', () => {
    expect(accountPlatformOrder('article', ['wxmp', 'xhs', 'wxmp'])).toEqual(['wxmp', 'juejin', 'blbl', 'dy', 'tt', 'bjh'])
  })
})
