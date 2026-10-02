import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { createMediaSettings, type CredentialsFace } from 'cqai-dsh-media-settings'
import { mediaProviderEnvironment, patchSettings, readSettings, validateDraft } from '../src/index.ts'
import { defaultParams } from '../src/protocol.ts'

const directories: string[] = []
afterEach(async () => {await Promise.all(directories.splice(0).map(path => rm(path, {recursive: true, force: true})))})
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'cqai-short-settings-')); directories.push(home)
  const root = join(home, 'short-video'); await mkdir(root)
  const records = new Map<CredentialKey, CredentialRecord>()
  const credentials: CredentialsFace = {
    readRecord: async key => structuredClone(records.get(key)),
    modifyRecord: async (key, mutate) => {const next = await mutate(structuredClone(records.get(key))); if (next) records.set(key, structuredClone(next)); return structuredClone(records.get(key))},
  }
  return {root, home, store: createMediaSettings({home, credentials})}
}
describe('short video settings ownership', () => {
  it('only exposes key status and passes credentials to the child environment rather than settings JSON', async () => {
    const {root, store} = await fixture()
    await writeFile(join(root, 'settings.json'), JSON.stringify({subtitle_provider: 'edge', video_codec: 'libx264', pexels_api_keys: 'private-pexels', coverr_api_keys: 'private-coverr'}))
    const settings = await readSettings(root, store)
    expect(settings).toEqual({subtitle_provider: 'edge', video_codec: 'libx264', pexelsConfigured: true, pixabayConfigured: false, coverrConfigured: true})
    expect(JSON.stringify(settings)).not.toContain('private-')
    expect(await mediaProviderEnvironment(store)).toEqual({MPT_PEXELS_API_KEY: 'private-pexels', MPT_PIXABAY_API_KEY: '', MPT_COVERR_API_KEY: 'private-coverr'})
    expect(await readFile(join(root,'settings.json'),'utf8')).not.toContain('private-')
  })
  it('merges only ordinary settings fields under a writer lock and preserves unknown settings', async () => {
    const {root, store} = await fixture()
    await writeFile(join(root, 'settings.json'), JSON.stringify({subtitle_provider: 'edge', video_codec: 'libx264', custom: {keep: true}}))
    await Promise.all([patchSettings(root,{subtitle_provider:'whisper'},store), patchSettings(root,{video_codec:'h264_nvenc'},store)])
    expect(JSON.parse(await readFile(join(root,'settings.json'),'utf8'))).toEqual({subtitle_provider:'whisper',video_codec:'h264_nvenc',custom:{keep:true}})
    await expect(patchSettings(root,{pexels_api_keys:'old-ui-key'},store)).rejects.toThrow('公共设置')
  })
  it('does not replace a saved task voice or aspect when public defaults change', async () => {
    const {store} = await fixture()
    const draft = validateDraft({textModel:'',imageModel:'',stopAt:'audio',params:{...defaultParams,video_script:'原任务',video_aspect:'16:9',voice_name:'zh-CN-YunxiNeural-Male'}})
    const before = structuredClone(draft)
    await store.patchDefaults({expectedRevision:0,set:{aspect:'9:16',edgeVoiceId:'zh-CN-XiaoxiaoNeural'}})
    expect(draft).toEqual(before)
    expect((await store.resolveNewTaskDefaults('shortVideo')).aspect).toBe('9:16')
  })
})
