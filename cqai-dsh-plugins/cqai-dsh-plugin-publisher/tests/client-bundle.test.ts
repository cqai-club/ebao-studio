import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

interface Handoff {
  id: string
  factory: (require: (specifier: string) => unknown) => { apply?: unknown }
}

describe('publisher browser bundle', () => {
  it('loads using only DSH platform modules, not markdown-it from the module table', async () => {
    const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    let handoff: Handoff | undefined
    const sandbox = {
      window: { __ModuleLoader__: { load: (entry: Handoff) => { handoff = entry } } },
    }
    runInNewContext(source, sandbox, { filename: 'publisher-client.js' })

    expect(handoff?.id).toBe('cqai-dsh-plugin-publisher')
    const required: string[] = []
    const platformModules: Record<string, unknown> = {
      react: await import('react'),
      'react/jsx-runtime': await import('react/jsx-runtime'),
    }
    const exports = handoff?.factory((specifier) => {
      required.push(specifier)
      if (!Object.hasOwn(platformModules, specifier)) throw new Error(`unexpected browser require: ${specifier}`)
      return platformModules[specifier]
    })

    expect(required.sort()).toEqual(['react', 'react/jsx-runtime'])
    expect(exports?.apply).toBeTypeOf('function')
  })
})
