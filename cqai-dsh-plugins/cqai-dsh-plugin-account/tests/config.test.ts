import { describe, expect, it } from 'vitest'
import { normalizeConfig } from '../src/config.ts'

describe('CQAI Club MCP configuration', () => {
  it('preserves both existing audiences and keeps MCP disabled for existing profiles', () => {
    const config = normalizeConfig(undefined)
    expect(config.clubMcpEnabled).toBe(false)
    expect(config.resource).toBe('https://account.cqaiclub.asia')
    expect(config.clubPortalResource).toBe('https://cqaiclub.asia/')
    expect(config.clubPortalUrl).toBe('https://cqaiclub.asia')
    expect(config).not.toHaveProperty('clubMcpUrl')
  })

  it('restores the persisted volatile switch and rejects malformed switch values', () => {
    expect(normalizeConfig({ clubMcpEnabled: { get: () => true } }).clubMcpEnabled).toBe(true)
    expect(() => normalizeConfig({ clubMcpEnabled: { get: () => 'false' as unknown as boolean } })).toThrow('clubMcpEnabled must be a boolean')
  })
})
