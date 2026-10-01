import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DESKTOP_INSTALLER_QUIT_FLAG } from '../src/desktop-installer-quit.ts'

/** Execute the NSIS control-flow subset used by the app handoff against fake OS processes. */
function exerciseHandoff(
  source: string,
  currentName: string,
  processNames: readonly string[],
  acceptsHandoff = true,
) {
  const lines = source.split('\n').map(line => line.trim()).filter(line => line !== '' && !line.startsWith(';'))
  const labels = new Map(lines.flatMap((line, index) => line.endsWith(':') ? [[line.slice(0, -1), index] as const] : []))
  const values = new Map<string, string>([['${APP_EXECUTABLE_FILENAME}', currentName]])
  const processes = new Set(processNames)
  const handoffs: string[] = []
  const killed: string[] = []
  const expand = (value: string): string => {
    for (const [key, replacement] of values) value = value.replaceAll(key, replacement)
    return value
  }
  const jump = (label: string): number => {
    const target = labels.get(label)
    if (target === undefined) throw new Error(`unknown NSIS label: ${label}`)
    return target
  }
  let steps = 0
  for (let index = 0; index < lines.length; index++) {
    if (++steps > 1000) throw new Error('NSIS handoff did not terminate')
    const line = lines[index]!
    const find = /^!insertmacro FIND_PROCESS "([^"]+)" (\$\w+)$/.exec(line)
    if (find !== null) {
      values.set(find[2]!, processes.has(expand(find[1]!)) ? '0' : '1')
      continue
    }
    const assign = /^StrCpy (\$\w+) (?:"([^"]+)"|(\d+))$/.exec(line)
    if (assign !== null) { values.set(assign[1]!, expand(assign[2] ?? assign[3]!)); continue }
    const condition = /^\$\{if\} (\$\w+) (==|!=|<|>) (\d+)$/.exec(line)
    if (condition !== null) {
      const left = Number(values.get(condition[1]!)); const right = Number(condition[3])
      const matches = condition[2] === '==' ? left === right : condition[2] === '!=' ? left !== right : condition[2] === '<' ? left < right : left > right
      if (!matches) {
        while (lines[++index] !== '${endIf}') {
          if (index >= lines.length) throw new Error('unterminated NSIS condition')
        }
      }
      continue
    }
    const go = /^Goto (\w+)$/.exec(line)
    if (go !== null) { index = jump(go[1]!); continue }
    if (line.startsWith('ExecWait ')) {
      const filename = values.get('$dshInstallerExecutable')!
      expect(expand(line)).toContain(`$INSTDIR\\${filename}`)
      handoffs.push(filename)
      if (acceptsHandoff) processes.delete(filename)
      continue
    }
    const kill = /^!insertmacro KILL_PROCESS "([^"]+)" [01]$/.exec(line)
    if (kill !== null) { const filename = expand(kill[1]!); killed.push(filename); processes.delete(filename); continue }
    if (line.startsWith('IntOp ')) { values.set('$R1', String(Number(values.get('$R1')) + 1)); continue }
    if (line.startsWith('MessageBox ')) {
      const target = /IDOK (\w+)$/.exec(line) ?? /IDRETRY (\w+)$/.exec(line)
      if (target === null) throw new Error('unsupported NSIS prompt')
      index = jump(target[1]!); continue
    }
    if (line === 'Quit') throw new Error('unexpected installer quit')
  }
  return { handoffs, killed, remaining: [...processes] }
}

describe('Windows NSIS running-app handoff', () => {
  it('checks for the exact app before requesting orderly shutdown', () => {
    const script = readFileSync(join(process.cwd(), 'build', 'installer.nsh'), 'utf8')
    const firstDetection = script.indexOf('!insertmacro FIND_PROCESS')
    const request = script.indexOf(DESKTOP_INSTALLER_QUIT_FLAG)
    const wait = script.indexOf('dsh_installer_wait_for_exit:')
    const fallback = script.indexOf('dsh_installer_scoped_fallback:')

    expect(script).toContain('!macro customCheckAppRunning')
    expect(script).toContain('Var pid')
    expect(script).toContain('ExecWait')
    expect(script).toContain('$INSTDIR\\$dshInstallerExecutable')
    expect(script).toContain('!insertmacro IS_POWERSHELL_AVAILABLE')
    expect(firstDetection).toBeGreaterThanOrEqual(0)
    expect(request).toBeGreaterThan(firstDetection)
    expect(wait).toBeGreaterThan(request)
    expect(fallback).toBeGreaterThan(wait)
  })

  it('stops both renamed and historical apps while leaving unrelated helpers running', () => {
    const script = readFileSync(join(process.cwd(), 'build', 'installer.nsh'), 'utf8')
    expect(exerciseHandoff(script, 'e宝工坊 Beta.exe', ['易宝工坊 Beta.exe', 'e宝工坊 Beta.exe', 'DSH Helper.exe'])).toEqual({
      handoffs: ['e宝工坊 Beta.exe', '易宝工坊 Beta.exe'], killed: [], remaining: ['DSH Helper.exe'],
    })
  })

  it('uses the selected historical executable for the pre-handoff forced-close fallback', () => {
    const script = readFileSync(join(process.cwd(), 'build', 'installer.nsh'), 'utf8')
    expect(exerciseHandoff(script, 'e宝工坊 Beta.exe', ['易宝工坊 Beta.exe', 'DSH Helper.exe'], false)).toEqual({
      handoffs: ['易宝工坊 Beta.exe'], killed: ['易宝工坊 Beta.exe'], remaining: ['DSH Helper.exe'],
    })
  })

  it('waits for graceful disposal before using the scoped builder fallback', () => {
    const script = readFileSync(join(process.cwd(), 'build', 'installer.nsh'), 'utf8')

    expect(script).toContain('$R1 < 60')
    expect(script).toContain('Sleep 500')
    expect(script).toContain('!insertmacro KILL_PROCESS "$dshInstallerExecutable" 0')
    expect(script).toContain('!insertmacro KILL_PROCESS "$dshInstallerExecutable" 1')
    expect(script).not.toContain('taskkill')
    expect(script).not.toContain('nsProcess::KillProcess')
    expect(script).not.toContain('getProcessInfo.nsh')
  })
})
