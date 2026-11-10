/** Verify native Computer Use loading and catalog discovery without executing tools. */
import type { CuaDriverLike } from '@trycua/cua-driver'
import { z } from 'zod'

type CatalogDriver = Pick<CuaDriverLike, 'listToolsJson' | 'shutdown'> & { uniffiDestroy?: () => void }

export async function verifyNativeComputerUseCatalog(createDriver: () => CatalogDriver): Promise<void> {
  const driver = createDriver()
  try {
    const catalog = z.object({
      tools: z.array(z.object({
        name: z.string().min(1),
        inputSchema: z.record(z.string(), z.unknown()),
      })).min(1),
    }).parse(JSON.parse(await driver.listToolsJson()))
    for (const name of ['check_permissions', 'get_window_state']) {
      if (!catalog.tools.some(tool => tool.name === name)) {
        throw new Error(`packaged Computer Use catalog is missing ${name}`)
      }
    }
  } finally {
    try {
      await driver.shutdown()
    } finally {
      driver.uniffiDestroy?.()
    }
  }
}
