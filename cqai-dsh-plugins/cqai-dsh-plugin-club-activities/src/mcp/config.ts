import z from '@deepseek-ai/schemastery'

export type ClubMcpConfigInput = {
  enabled?: boolean | { get(): boolean | undefined }
  requestTimeoutMs?: number
}
export type ClubMcpPluginConfig = { enabled: { get(): boolean | undefined }; requestTimeoutMs: number }

// Undefined distinguishes a first install from an explicit user choice.
export const Config = z.object({
  enabled: z.boolean().volatile(),
  requestTimeoutMs: z.natural().min(1000).default(15_000),
}) as unknown as z<ClubMcpPluginConfig>

export function configuredEnabled(config?: ClubMcpConfigInput): boolean | undefined {
  const enabled = typeof config?.enabled === 'object' ? config.enabled.get() : config?.enabled
  if (enabled !== undefined && typeof enabled !== 'boolean') throw new Error('enabled must be a boolean')
  return enabled
}
