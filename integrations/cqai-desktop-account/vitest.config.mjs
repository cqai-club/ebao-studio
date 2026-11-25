import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const upstream = resolve(root, 'deepseek-harness')
const fromOfficial = createRequire(resolve(upstream, 'node_modules/.pnpm/cqai-test.cjs'))
const account = resolve(root, 'cqai-dsh-plugins/cqai-dsh-plugin-account')

export default {
  root,
  plugins: [{
    name: 'cqai-official-runtime-resolution',
    enforce: 'pre',
    resolveId(id) {
      if (id === '@cqaiclub/dsn-account') return resolve(account, 'src/index.ts')
      if (id === '@cqaiclub/dsn-account/protocol') return resolve(account, 'src/protocol.ts')
      if (id === 'vitest') return resolve(dirname(fromOfficial.resolve('vitest/package.json')), 'dist/index.js')
      if (id.startsWith('@deepseek-ai/') || id === 'yaml') {
        return fromOfficial.resolve(id)
      }
    },
  }],
  test: {
    environment: 'node',
    include: [
      'integrations/cqai-desktop-account/tests/**/*.test.{ts,mjs}',
      'cqai-dsh-plugins/cqai-dsh-plugin-account/tests/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/tests/client-registration.test.ts',
      '**/tests/*.client.test.tsx',
      '**/tests/models-settings-card.test.tsx',
    ],
    maxWorkers: 4,
    execArgv: process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : [],
    testTimeout: 15_000,
  },
}
