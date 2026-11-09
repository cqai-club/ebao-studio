import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { packagedResourcesDirectory, releaseArtifactNameArgs, windowsArtifactFileName } from '../dsh-desktop-shared/scripts/electron-builder-environment.ts'
import { packageMacSmoke } from '../dsh-desktop-shared/scripts/package-mac.ts'
import { packageWindowsArtifact } from '../dsh-desktop-shared/scripts/package-win.ts'
import { releaseMac } from '../dsh-desktop-shared/scripts/release-mac.ts'
import { expectedReleaseAssets } from './verify-release-assets.mjs'

const releaseEnv = { DSH_RELEASE_ARTIFACT_NAMES: '1', DSH_PACKAGE_CHECK_ALREADY_RAN: '1' }
const version = '0.0.16'
const expand = (value, ext, arch) => value.replace('${version}', version).replace('${ext}', ext).replace('${arch}', arch)

test('release filenames match the updater verifier on each platform', () => {
  const [dmg, zip, installer, portable] = expectedReleaseAssets(version)
  const mac = releaseArtifactNameArgs(releaseEnv, 'mac')[0].split('=').at(-1)
  const nsis = releaseArtifactNameArgs(releaseEnv, 'nsis')[0].split('=').at(-1)
  const win = releaseArtifactNameArgs(releaseEnv, 'zip')[0].split('=').at(-1)
  assert.equal(expand(mac, 'dmg', 'universal'), dmg)
  assert.equal(expand(mac, 'zip', 'universal'), zip)
  assert.equal(expand(nsis, 'exe', 'x64'), installer)
  assert.equal(expand(win, 'zip', 'x64'), portable)
  assert.equal(windowsArtifactFileName(releaseEnv, version, 'nsis', 'e宝工坊'), installer)
  assert.equal(windowsArtifactFileName(releaseEnv, version, 'zip', 'e宝工坊'), portable)
  assert.equal(windowsArtifactFileName({}, version, 'nsis', 'e宝工坊-Beta'), `e宝工坊-Beta-${version}-x64-Setup.exe`)
  assert.deepEqual(releaseArtifactNameArgs({}, 'mac'), [], 'ordinary builds keep their channel identities')
})

test('signed and unsigned release packaging both request the macOS updater ZIP', () => {
  const signed = []
  releaseMac({ env: { ...releaseEnv, APPLE_KEYCHAIN_PROFILE: 'fixture' }, platform: 'darwin',
    desktopRoot: '/fixture/desktop', outputDir: '/fixture/out', resetOutput() {}, prepareRuntime() {},
    listCodeSigningIdentities: () => '1) "Developer ID Application: Fixture (123)"',
    run: (command, args) => signed.push({ command, args }), log() {} })
  const signedBuilder = signed.find(row => row.args.includes('electron-builder')).args
  assert.deepEqual(signedBuilder.slice(0, 6), ['exec', 'electron-builder', '--mac', 'dmg', 'zip', '--universal'])
  assert.ok(signedBuilder.includes(releaseArtifactNameArgs(releaseEnv, 'mac')[0]))
  const smoke = []
  packageMacSmoke({ env: { ...releaseEnv, DSH_RELEASE_MAC_ZIP: '1', DSH_MAC_SMOKE_ARCH: 'universal' },
    platform: 'darwin', arch: 'arm64', nodeVersion: '24.18.0', workspaceRoot: '/fixture',
    desktopRoot: '/fixture/desktop', outputDir: '/fixture/out', resetOutput() {}, prepareRuntime() {},
    builderCli: '/fixture/builder', verifier: '/fixture/verify', nodeExecutable: '/fixture/node',
    run: (command, args) => smoke.push({ command, args }), log() {} })
  assert.deepEqual(smoke[0].args.slice(0, 5), ['/fixture/builder', '--mac', 'dmg', 'zip', '--universal'])
  assert.ok(smoke[0].args.includes(releaseArtifactNameArgs(releaseEnv, 'mac')[0]))
})

test('Windows installer and portable archive use the release artifact names', () => {
  for (const [target, label] of [['nsis', 'installer'], ['zip', 'portable archive']]) {
    const calls = []
    packageWindowsArtifact({ env: releaseEnv, platform: 'win32', arch: 'x64', nodeVersion: '24.18.0',
      workspaceRoot: '/fixture', desktopRoot: '/fixture/desktop', commandShell: 'cmd.exe',
      builderCli: '/fixture/builder', nodeExecutable: '/fixture/node', verifier: '/fixture/verify',
      prepareRuntime() {}, run: (command, args) => calls.push({ command, args }), log() {} }, target, label)
    assert.ok(calls[0].args.includes(releaseArtifactNameArgs(releaseEnv, target)[0]))
  }
})

test('release workflow enables matching filenames and the unsigned updater ZIP', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  assert.match(workflow, /DSH_RELEASE_ARTIFACT_NAMES: '1'/u)
  assert.match(workflow, /DSH_RELEASE_MAC_ZIP: '1'/u)
})

test('each native release job builds bundled workspace plugins before packaging', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  for (const [name, next, gate] of [['windows', 'macos', 'check:win-package'], ['macos', 'publish', 'check:mac-package']]) {
    const start = workflow.indexOf(`\n  ${name}:`)
    const end = workflow.indexOf(`\n  ${next}:`, start + 1)
    assert.ok(start !== -1 && end > start, `${name} job must exist`)
    const job = workflow.slice(start, end)
    const build = job.indexOf('yarn build:cqai-plugins')
    assert.ok(build !== -1 && build < job.indexOf(gate), `${name} must build product plugins before its package gate`)
  }
})

test('macOS afterPack resolves the actual executable filename for each Desktop channel', () => {
  for (const desktop of ['dsh-plugin-desktop', 'dsh-plugin-desktop-beta']) {
    const manifest = JSON.parse(readFileSync(new URL(`../${desktop}/package.json`, import.meta.url), 'utf8'))
    const name = manifest.build.mac.executableName
    assert.ok(name && name !== manifest.build.productName, 'fixture exercises the renamed executable')
    assert.equal(packagedResourcesDirectory('/fixture', 'darwin', name), `/fixture/${name}.app/Contents/Resources`)
    const afterPack = readFileSync(new URL(`../${desktop}/scripts/verify-packaged.ts`, import.meta.url), 'utf8')
    assert.match(afterPack, /packagedResourcesDirectory\(context\.appOutDir, context\.electronPlatformName, context\.packager\.appInfo\.productFilename\)/u)
  }
})
