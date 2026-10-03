export const AGGREGATE_VIDEO_PANEL = 'cqai-ejianbao'
export const CHILD_VIDEO_PANELS = new Set(['cqai-video', 'cqai-short-video', 'cqai-talkcraft'])

/** Legacy main keys remain routable, so a usable aggregate sidebar contribution is also required. */
export function aggregateVideoAvailable(main: ReadonlySet<string>, sidebar: ReadonlySet<string>): boolean {
  return main.has(AGGREGATE_VIDEO_PANEL) && sidebar.has(AGGREGATE_VIDEO_PANEL)
}

export function projectVideoEntries<T extends {id: string}>(entries: readonly T[], aggregate: boolean): T[] {
  return entries.filter(entry => aggregate ? !CHILD_VIDEO_PANELS.has(entry.id) : entry.id !== AGGREGATE_VIDEO_PANEL)
}

/** Keep temporarily suppressed child preferences when the user reorders the projected home. */
export function preserveSuppressedOrder(previous: readonly string[], displayed: readonly string[]): string[] {
  const current = new Set(displayed)
  let index = 0
  const retained = previous.map(id => current.has(id) ? displayed[index++]! : id)
  return [...new Set([...retained, ...displayed.slice(index)])]
}
