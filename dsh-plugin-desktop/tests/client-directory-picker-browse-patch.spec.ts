import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(new URL(
  '../../patches/dsh-client-ui-directory-picker-browse@0.1.5-rc.1.patch',
  import.meta.url,
), 'utf8')

describe('RC1 browse directory-picker client patch', () => {
  it('publishes the desktop bridge through the compiled flow and declarations', () => {
    for (const marker of [
      '__DSH_DESKTOP_PICK_DIRECTORY__',
      '__DSH_DESKTOP_VALIDATE_DIRECTORY__',
      'pickNativeDirectory?: () => Promise<string | null>;',
      'validateDirectory?: (path: string) => Promise<boolean>;',
      '"browser.nativePicker": "使用系统选择文件夹"',
      '"browser.nativePicker": "Choose with system dialog"',
      'IconFolderOpen16',
    ]) {
      expect(patch).toContain(marker)
    }
  })

  it('shows the native picker on macOS and Windows while validating Windows paths only', () => {
    const compiled = readFileSync(new URL(
      '../node_modules/@deepseek-ai/dsh-client-ui-directory-picker-browse/lib/client.js',
      import.meta.url,
    ), 'utf8')
    for (const source of [patch, compiled]) {
      expect(source).toContain('pickNativeDirectory: ["darwin", "win32"].includes(new URLSearchParams(window.location.search).get("dsh-desktop-platform"))')
      expect(source).toContain('validateDirectory: new URLSearchParams(window.location.search).get("dsh-desktop-platform") === "win32"')
    }
  })

  it('validates native and browser choices while keeping cancellation and busy work in the panel', () => {
    for (const marker of [
      'const parentInert = busy || folderDraft !== null || nativePicking || validatingDirectory;',
      'if (!parentInert) onClose();',
      '"aria-busy": nativePicking || void 0,',
      'disabled: parentInert,',
      'if (path !== null) openDirectory(path);',
      'if (targetPath !== null) openDirectory(targetPath);',
      'Promise.resolve().then(() => validateDirectory(path)).then((allowed) => {',
      'if (allowed) onOpen(path);',
    ]) {
      expect(patch).toContain(marker)
    }
    expect(patch).not.toContain('if (path === null) onClose()')
  })
})
