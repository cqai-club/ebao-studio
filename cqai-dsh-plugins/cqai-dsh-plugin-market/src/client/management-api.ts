const ROOT = '/api/cqai-plugin-management'

export interface ProductBundle {
  readonly bundleId: string
  readonly packageName: string
  /** Saved choice for the next Desktop generation. */
  readonly status: 'active' | 'disabled'
  readonly mutable: boolean
  readonly uninstallable: boolean
}

export interface ProductInventory {
  readonly bundles: readonly ProductBundle[]
  /** Bundles selected into the currently running Loader generation. */
  readonly loadedPackageNames: readonly string[]
}

interface Preview {
  readonly previewId: string
  readonly packageName: string
  readonly expiresAt: string
}

async function readJson<T>(response: Response): Promise<T> {
  const value = await response.json() as T & { error?: unknown }
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : `HTTP ${response.status}`)
  return value
}

function post<T>(path: string, body: unknown): Promise<T> {
  return fetch(`${ROOT}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'error',
    headers: { 'accept': 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(readJson<T>)
}

export async function readProductInventory(): Promise<ProductInventory> {
  return readJson<ProductInventory>(await fetch(`${ROOT}/bundles`, {
    cache: 'no-store', credentials: 'same-origin', redirect: 'error',
    headers: { 'accept': 'application/json' },
  }))
}

export async function changeProductBundle(bundle: ProductBundle, action: 'enable' | 'disable'): Promise<void> {
  const preview = await post<Preview>('/preview', { action, bundleId: bundle.bundleId })
  if (preview.packageName !== bundle.packageName || Date.parse(preview.expiresAt) <= Date.now()) {
    throw new Error('插件状态已变化，请刷新后重试')
  }
  await post('/execute', { action, previewId: preview.previewId })
}

export async function requestDesktopRestart(): Promise<void> {
  // Desktop exposes a main-process action so the request survives Host shutdown.
  const bridge = (globalThis as typeof globalThis & {
    dshDesktopActions?: { invoke?: (action: 'restart') => Promise<void> }
  }).dshDesktopActions
  if (typeof bridge?.invoke === 'function') {
    await bridge.invoke('restart')
    return
  }
  await readJson(await fetch('/api/desktop/restart', {
    method: 'POST', credentials: 'same-origin', redirect: 'error',
    headers: { 'accept': 'application/json', 'content-type': 'application/json' },
    body: '{}',
  }))
}
