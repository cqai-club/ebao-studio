import { chmodSync, existsSync } from 'node:fs'
import { MACOS_UNIVERSAL_NATIVE_ENTRIES, prepareMacUniversalRuntime } from '../../dsh-plugin-desktop-beta/scripts/mac-universal.ts'
// Next uses the official Host, which has no dependency on the old desktop lock binding.
export const NEXT_MAC_NATIVE_ENTRIES = [
  ...MACOS_UNIVERSAL_NATIVE_ENTRIES.filter(entry => !entry.path.startsWith('node_modules/fs-ext/')),
]
export function prepareNextMacRuntime(desktopRoot: string): void {
  prepareMacUniversalRuntime({ desktopRoot, nativeEntries: NEXT_MAC_NATIVE_ENTRIES, exists: existsSync, chmod: chmodSync })
}
