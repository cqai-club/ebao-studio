import { describe, expect, it } from 'vitest'
import { applyContentPatch, changedContentFields, mergeContentPatches } from '../src/client/content-patch.ts'
import type { PublisherContent } from '../src/protocol.ts'

function draft(): PublisherContent {
  return { id: 'one', contentType: 'article', revision: 1, createdAt: '', updatedAt: '', title: 'Original', body: 'Body', summary: '', tags: [], creativeStatement: 'none', assets: [], platformFields: {} }
}

describe('client field patches', () => {
  it('sends only edited fields, keeping unrelated remote fields and versions', () => {
    const before = draft()
    const patch = changedContentFields(before, { ...before, title: 'Manual title' })
    expect(patch).toEqual({ title: 'Manual title' })
    const remote = { ...before, revision: 2, body: 'Agent body', tags: ['remote'], platformVariants: { juejin: { summary: 'Agent summary' } } }
    expect(applyContentPatch(remote, patch)).toMatchObject({ title: 'Manual title', body: 'Agent body', tags: ['remote'], revision: 2, platformVariants: { juejin: { summary: 'Agent summary' } } })
  })

  it('preserves an explicit empty platform cover and uses unset for restored inheritance', () => {
    const before = { ...draft(), coverAssetId: 'cover', platformVariants: { juejin: { coverAssetId: null } } }
    expect(changedContentFields(draft(), before).platformVariants).toEqual({ juejin: { coverAssetId: null } })
    const patch = changedContentFields(before, { ...before, platformVariants: {} })
    expect(patch).toEqual({ unsetVariantFields: { juejin: ['coverAssetId'] } })
    const remote = { ...before, platformVariants: { juejin: { coverAssetId: null, summary: 'New Agent summary' } } }
    expect(applyContentPatch(remote, patch).platformVariants).toEqual({ juejin: { summary: 'New Agent summary' } })
  })

  it('merges newer local edits over in-flight fields, including resetting one override', () => {
    const pending = mergeContentPatches({ title: 'First', platformVariants: { juejin: { title: 'Old override', summary: 'Keep' } } },
      { title: 'Latest', unsetVariantFields: { juejin: ['title'] } })
    expect(applyContentPatch(draft(), pending)).toMatchObject({ title: 'Latest', platformVariants: { juejin: { summary: 'Keep' } } })
  })

  it('keeps whole-version reset semantics when a new override is typed before saving', () => {
    const patch = mergeContentPatches({ platformVariants: { juejin: null } }, { platformVariants: { juejin: { title: 'New title' } } })
    const before = { ...draft(), platformVariants: { juejin: { body: 'Old body', title: 'Old title', coverAssetId: null } } }
    expect(applyContentPatch(before, patch).platformVariants).toEqual({ juejin: { title: 'New title' } })
  })

  it('preserves assets added remotely while a local reorder is pending', () => {
    const assets = ['a', 'b', 'new'].map(id => ({ id })) as PublisherContent['assets']
    expect(applyContentPatch({ ...draft(), assets }, { assetOrder: ['b', 'a'] }).assets.map(asset => asset.id)).toEqual(['b', 'a', 'new'])
  })
})
