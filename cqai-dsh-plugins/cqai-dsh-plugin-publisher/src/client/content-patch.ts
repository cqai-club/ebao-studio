import type { Platform, PublisherContent, PublisherContentPatch, PublisherPlatformVariant } from '../protocol.ts'

export type PublisherEditorTarget = { kind: 'main' } | { kind: 'platform'; platform: Platform }

const FIELDS = ['title', 'body', 'summary', 'tags', 'creativeStatement', 'articleTheme', 'coverAssetId', 'description', 'shortTitle', 'videoSource'] as const
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const VARIANT_FIELDS: Array<keyof PublisherPlatformVariant> = ['title', 'body', 'summary', 'tags', 'coverAssetId', 'assetOrder']

/** Only send fields changed by this editor, rather than a stale copy of the whole draft. */
export function changedContentFields(before: PublisherContent, after: PublisherContent): PublisherContentPatch {
  const patch: Record<string, unknown> = {}
  for (const field of FIELDS) if (!same(before[field], after[field])) patch[field] = after[field] ?? null
  const previousOrder = before.assets.map(asset => asset.id)
  const nextOrder = after.assets.map(asset => asset.id)
  if (!same(previousOrder, nextOrder)) patch.assetOrder = nextOrder
  const variants: Record<string, unknown> = {}
  const unset: Record<string, string[]> = {}
  for (const platform of new Set([...Object.keys(before.platformVariants ?? {}), ...Object.keys(after.platformVariants ?? {})])) {
    const prior = before.platformVariants?.[platform as Platform]
    const next = after.platformVariants?.[platform as Platform]
    if (same(prior, next)) continue
    if (!next) { unset[platform] = Object.keys(prior ?? {}); continue }
    const fields: Record<string, unknown> = {}
    for (const field of new Set([...Object.keys(prior ?? {}), ...Object.keys(next)])) {
      if (same(prior?.[field as keyof PublisherPlatformVariant], next[field as keyof PublisherPlatformVariant])) continue
      if (!Object.hasOwn(next, field)) (unset[platform] ??= []).push(field)
      else fields[field] = next[field as keyof PublisherPlatformVariant]
    }
    if (Object.keys(fields).length) variants[platform] = fields
  }
  if (Object.keys(variants).length) patch.platformVariants = variants
  if (Object.keys(unset).length) patch.unsetVariantFields = unset
  const platformFields: Record<string, Record<string, unknown>> = {}
  for (const platform of new Set([...Object.keys(before.platformFields), ...Object.keys(after.platformFields)])) {
    const prior = before.platformFields[platform as Platform] ?? {}
    const next = after.platformFields[platform as Platform] ?? {}
    const fields: Record<string, unknown> = {}
    for (const field of new Set([...Object.keys(prior), ...Object.keys(next)])) {
      if (!same(prior[field], next[field])) fields[field] = next[field] ?? null
    }
    if (Object.keys(fields).length) platformFields[platform] = fields
  }
  if (Object.keys(platformFields).length) patch.platformFields = platformFields
  return patch as PublisherContentPatch
}

/** Preserve newer local changes made while an earlier patch is saving. */
export function mergeContentPatches(earlier: PublisherContentPatch, later: PublisherContentPatch): PublisherContentPatch {
  const merged = { ...earlier, ...later } as PublisherContentPatch
  for (const key of ['platformVariants', 'platformFields'] as const) {
    if (!earlier[key] && !later[key]) continue
    const groups: Record<string, unknown> = { ...earlier[key] }
    for (const [platform, fields] of Object.entries(later[key] ?? {})) {
      groups[platform] = fields === null ? null : { ...(groups[platform] as object ?? {}), ...fields }
    }
    merged[key] = groups as never
  }
  const unset: Partial<Record<Platform, (keyof PublisherPlatformVariant)[]>> = {}
  for (const platform of new Set([...Object.keys(earlier.unsetVariantFields ?? {}), ...Object.keys(later.unsetVariantFields ?? {}), ...Object.keys(earlier.platformVariants ?? {}), ...Object.keys(later.platformVariants ?? {})])) {
    const id = platform as Platform
    const fields = new Set(earlier.unsetVariantFields?.[id] ?? [])
    if (earlier.platformVariants?.[id] === null && later.platformVariants?.[id]) for (const field of VARIANT_FIELDS) fields.add(field)
    if (later.platformVariants && Object.hasOwn(later.platformVariants, id)) {
      const replacement = later.platformVariants[id]
      if (replacement === null) fields.clear()
      else for (const field of Object.keys(replacement ?? {})) fields.delete(field as keyof PublisherPlatformVariant)
    }
    for (const field of later.unsetVariantFields?.[id] ?? []) fields.add(field)
    if (fields.size) unset[id] = [...fields]
  }
  // An explicit reset must also remove an older pending override for that field.
  for (const [platform, fields] of Object.entries(later.unsetVariantFields ?? {})) {
    const variant = merged.platformVariants?.[platform as Platform]
    if (variant) {
      const next = { ...variant }
      for (const field of fields) delete next[field]
      merged.platformVariants = { ...merged.platformVariants, [platform]: next }
    }
  }
  if (Object.keys(unset).length) merged.unsetVariantFields = unset
  else delete merged.unsetVariantFields
  return merged
}

/** Overlay pending local fields on the latest Host snapshot, keeping unrelated Agent edits. */
export function applyContentPatch(content: PublisherContent, patch: PublisherContentPatch): PublisherContent {
  const next = { ...content } as PublisherContent
  for (const field of FIELDS) if (Object.hasOwn(patch, field)) {
    const value = patch[field]
    if (value === null) delete (next as unknown as Record<string, unknown>)[field]
    else (next as unknown as Record<string, unknown>)[field] = value
  }
  if (patch.assetOrder) {
    const byId = new Map(content.assets.map(asset => [asset.id, asset]))
    next.assets = [...patch.assetOrder.flatMap(id => byId.has(id) ? [byId.get(id)!] : []), ...content.assets.filter(asset => !patch.assetOrder!.includes(asset.id))]
  }
  next.platformVariants = { ...content.platformVariants }
  for (const [platform, fields] of Object.entries(patch.platformVariants ?? {})) {
    const id = platform as Platform
    if (fields === null) { delete next.platformVariants[id]; continue }
    const variant = { ...next.platformVariants[id] }
    for (const [field, value] of Object.entries(fields)) {
      if (value === null && field !== 'coverAssetId') delete (variant as Record<string, unknown>)[field]
      else (variant as Record<string, unknown>)[field] = value
    }
    next.platformVariants[id] = variant
  }
  for (const [platform, fields] of Object.entries(patch.unsetVariantFields ?? {})) {
    const id = platform as Platform
    const variant = { ...next.platformVariants[id] }
    for (const field of fields) delete variant[field]
    if (Object.keys(variant).length) next.platformVariants[id] = variant
    else delete next.platformVariants[id]
  }
  next.platformFields = { ...content.platformFields }
  for (const [platform, fields] of Object.entries(patch.platformFields ?? {})) {
    const id = platform as Platform
    if (fields === null) { delete next.platformFields[id]; continue }
    const values = { ...next.platformFields[id] }
    for (const [field, value] of Object.entries(fields ?? {})) {
      if (value === null) delete values[field]
      else values[field] = value
    }
    if (Object.keys(values).length) next.platformFields[id] = values
    else delete next.platformFields[id]
  }
  return next
}
