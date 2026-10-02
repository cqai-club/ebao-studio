import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({resolve: {alias: {
  '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./tests/primitives.tsx', import.meta.url)),
  'cqai-dsh-media-settings/client': fileURLToPath(new URL('../cqai-dsh-media-settings/src/client.tsx', import.meta.url)),
  'cqai-dsh-media-settings/contracts': fileURLToPath(new URL('../cqai-dsh-media-settings/src/contracts.ts', import.meta.url)),
}, dedupe: ['react', 'react-dom']}})
