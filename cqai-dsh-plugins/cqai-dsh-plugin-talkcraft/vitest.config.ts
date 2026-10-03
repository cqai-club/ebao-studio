import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {alias: {'cqai-dsh-media-settings/client': fileURLToPath(new URL('../cqai-dsh-media-settings/src/client.tsx', import.meta.url))}},
  test: {include: ['tests/**/*.test.{ts,tsx}']},
})
