import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyWindowsPortable } from '../scripts/verify-win-portable.ts'

const temporaryRoots: string[] = []

function portableExecutable(): Buffer {
  const executable = Buffer.alloc(132)
  executable.write('MZ', 0, 'ascii')
  executable.writeUInt32LE(128, 0x3c)
  executable.write('PE\0\0', 128, 'binary')
  return executable
}

function fixture(version = '2.0.0'): { readonly root: string; readonly portable: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-win-portable-'))
  temporaryRoots.push(root)
  const dist = join(root, 'dist')
  mkdirSync(dist, { recursive: true })
  const portable = join(dist, `易宝工坊-Beta-${version}-x64-Portable.zip`)
  const archive = new AdmZip()
  archive.addFile('易宝工坊 Beta.exe', portableExecutable())
  archive.addFile('resources/app.asar', Buffer.from('asar'))
  archive.addFile('resources/publisher/MatrixMedia Publisher Worker.exe', portableExecutable())
  archive.addFile('resources/publisher/resources/app.asar', Buffer.from('worker asar'))
  archive.addFile('resources/publisher/LICENSE', Buffer.from('license'))
  archive.addFile('resources/publisher/SOURCE.json', Buffer.from('{}'))
  archive.writeZip(portable)
  return { root, portable }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Windows portable artifact verification', () => {
  it('accepts the exact versioned portable ZIP archive', () => {
    const value = fixture()

    expect(verifyWindowsPortable({ desktopRoot: value.root, version: '2.0.0' })).toBe(value.portable)
  })

  it('rejects a stale portable archive from a different version', () => {
    const value = fixture('1.9.0')

    expect(() => verifyWindowsPortable({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('易宝工坊-Beta-2.0.0-x64-Portable.zip')
  })

  it('rejects an application entry without a Windows PE header', () => {
    const value = fixture()
    const invalid = portableExecutable()
    invalid.write('NO', 0, 'ascii')
    const archive = new AdmZip()
    archive.addFile('易宝工坊 Beta.exe', invalid)
    archive.addFile('resources/app.asar', Buffer.from('asar'))
    archive.writeZip(value.portable)

    expect(() => verifyWindowsPortable({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('does not have a Windows PE header')
  })

  it('rejects a portable archive without the Publisher Worker', () => {
    const value = fixture()
    const archive = new AdmZip()
    archive.addFile('易宝工坊 Beta.exe', portableExecutable())
    archive.addFile('resources/app.asar', Buffer.from('asar'))
    archive.writeZip(value.portable)
    expect(() => verifyWindowsPortable({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('resources/publisher/MatrixMedia Publisher Worker.exe')
  })
})
