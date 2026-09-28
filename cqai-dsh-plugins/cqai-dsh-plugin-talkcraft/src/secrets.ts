import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'

export type SecretName = 'fish' | 'pexels' | 'pixabay'
const key = credentialKey('cqai-dsh-plugin-talkcraft', 'services')
type Face = {readRecord(k: typeof key): Promise<CredentialRecord | undefined>; modifyRecord(k: typeof key, fn: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>): Promise<CredentialRecord | undefined>}

export class Secrets {
  constructor(private readonly credentials: Face) {}
  async read(): Promise<Partial<Record<SecretName, string>>> {
    const record = await this.credentials.readRecord(key)
    if (record === undefined) return {}
    if (record.kind !== 'grant' || !record.payload || typeof record.payload !== 'object') throw new Error('口播视频制作凭据格式不受支持')
    const payload = record.payload as Record<string, unknown>
    if (payload.version !== 1) throw new Error('口播视频制作凭据版本不受支持')
    const values: Partial<Record<SecretName, string>> = {}
    for (const name of ['fish', 'pexels', 'pixabay'] as const) if (typeof payload[name] === 'string') values[name] = payload[name] as string
    return values
  }
  async set(name: SecretName, value: string): Promise<void> {
    if (!['fish', 'pexels', 'pixabay'].includes(name)) throw new Error('未知服务')
    await this.credentials.modifyRecord(key, async current => {
      const original = current?.kind === 'grant' && current.payload && typeof current.payload === 'object' ? current.payload as Record<string, unknown> : {}
      if (current && original.version !== 1) throw new Error('口播视频制作凭据格式不受支持')
      const next: Record<string, unknown> = {...original, version: 1}
      if (value.trim()) next[name] = value.trim(); else delete next[name]
      return {kind: 'grant', payload: next}
    })
  }
  async publicState(): Promise<Record<SecretName, boolean>> {const values = await this.read(); return {fish: !!values.fish, pexels: !!values.pexels, pixabay: !!values.pixabay}}
}
