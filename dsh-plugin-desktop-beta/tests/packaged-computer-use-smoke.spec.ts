import { expect, it, vi } from 'vitest'
import { verifyNativeComputerUseCatalog } from '../src/packaged-computer-use-smoke.ts'

const catalog = JSON.stringify({ tools: [
  { name: 'check_permissions', inputSchema: { type: 'object' } },
  { name: 'get_window_state', inputSchema: { type: 'object' } },
] })

function catalogDriver() {
  return {
    listToolsJson: vi.fn().mockResolvedValue(catalog),
    shutdown: vi.fn().mockResolvedValue(undefined),
    uniffiDestroy: vi.fn(),
  }
}

it('discovers the native catalog and releases the runtime without invoking tools', async () => {
  const driver = catalogDriver()
  const create = vi.fn(() => driver)
  await expect(verifyNativeComputerUseCatalog(create)).resolves.toBeUndefined()
  expect(create).toHaveBeenCalledOnce()
  expect(driver.listToolsJson).toHaveBeenCalledExactlyOnceWith()
  expect(driver.shutdown).toHaveBeenCalledExactlyOnceWith()
  expect(driver.uniffiDestroy).toHaveBeenCalledExactlyOnceWith()
})

it.each([
  ['empty', { tools: [] }],
  ['missing native window tool', { tools: [{ name: 'check_permissions', inputSchema: {} }] }],
  ['invalid tool schema', { tools: [{ name: 'check_permissions' }, { name: 'get_window_state', inputSchema: {} }] }],
])('rejects an %s catalog before a packaged runtime can pass', async (_description, value) => {
  const driver = catalogDriver()
  driver.listToolsJson.mockResolvedValue(JSON.stringify(value))
  await expect(verifyNativeComputerUseCatalog(() => driver)).rejects.toThrow()
  expect(driver.shutdown).toHaveBeenCalledOnce()
  expect(driver.uniffiDestroy).toHaveBeenCalledOnce()
})

it('shuts down and releases the runtime when native catalog discovery fails', async () => {
  const driver = catalogDriver()
  const failure = new Error('native catalog could not load')
  driver.listToolsJson.mockRejectedValue(failure)
  await expect(verifyNativeComputerUseCatalog(() => driver)).rejects.toBe(failure)
  expect(driver.shutdown).toHaveBeenCalledOnce()
  expect(driver.uniffiDestroy).toHaveBeenCalledOnce()
})

it('rejects failed native shutdown and still releases the runtime', async () => {
  const driver = catalogDriver()
  const failure = new Error('native shutdown failed')
  driver.shutdown.mockRejectedValue(failure)
  await expect(verifyNativeComputerUseCatalog(() => driver)).rejects.toBe(failure)
  expect(driver.uniffiDestroy).toHaveBeenCalledOnce()
})
