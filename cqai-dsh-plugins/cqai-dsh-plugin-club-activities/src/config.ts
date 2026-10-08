import z from '@deepseek-ai/schemastery'

import type { ActivityConfig } from './protocol.ts'

/** One optional extension owns both activities and the Profile's MCP preference. */
export const Config = z.object({
  portalUrl: z.string().default('https://cqaiclub.asia'),
  // No default: an absent value permits one-time migration from the base account.
  mcpEnabled: z.boolean().volatile(),
}) as unknown as z<ActivityConfig>
