import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { collectProductionClosure } from '../scripts/prepare-payload.ts'
import { nextPackagingTarget } from '../scripts/packaged-payload.ts'

it('packages the current session lock provider without the legacy fs-ext addon', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const names = collectProductionClosure(root, nextPackagingTarget(process.platform)).map(entry => entry.name)
  expect(names).toContain('@deepseek-ai/dsh-session-persistence-jsonl')
  expect(names).toContain('@deepseek-ai/node-addon-system')
  expect(names).not.toContain('fs-ext')
})
