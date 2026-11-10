/** Verify every final Next executable: fuses, the sealed archive, a RunAsNode import smoke and a real Host boot. */
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyElectronExecutableFuses } from '../../dsh-desktop-shared/scripts/verify-electron-fuses.ts'
import { withoutMacReleaseSecrets } from '../../dsh-desktop-shared/scripts/release-preflight.ts'
import { withoutWindowsSigningSecrets } from '../../dsh-desktop-shared/scripts/package-win.ts'
import { archivedPayload, nextPackagingTarget, PAYLOAD_DIR, universalMergeRewrite, verifyNextRuntime, verifyUpdaterManifestShim } from './packaged-payload.ts'
import { expectedNextVersion, verifyNextRuntimeTree } from './prepare-runtime.ts'
import { verifiedPackagedResources } from './verify-packaged.ts'
import { packagingStep } from './packaging-step.ts'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))

function runPackagedNode(path: string, args: readonly string[], timeout: number, failure: string, arch?: 'x64'): Promise<void> {
  return packagingStep(`smoke:${failure.replace(/ failed$/u, '')}`, () => new Promise<void>((resolve, reject) => {
    const child = spawn(arch === undefined ? path : '/usr/bin/arch', arch === undefined ? args : ['-x86_64', path, ...args], {
      env: { ...withoutWindowsSigningSecrets(withoutMacReleaseSecrets(process.env)), ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeout)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      if (stdout) process.stdout.write(stdout)
      reject(error)
    })
    child.on('close', (status, signal) => {
      clearTimeout(timer)
      if (stdout) process.stdout.write(stdout)
      if (timedOut) {
        reject(new Error(`${failure}: timed out after ${String(timeout)}ms\n${stderr}`))
        return
      }
      if (status !== 0) {
        reject(new Error(`${failure}: exit ${String(status)} signal ${String(signal)}\n${stderr}`))
        return
      }
      resolve()
    })
  }))
}

async function verifyFinalArtifacts(result: { outDir: string }): Promise<string[]> {
  const paths = ['mac/易宝工坊.app/Contents/MacOS/易宝工坊', 'mac-arm64/易宝工坊.app/Contents/MacOS/易宝工坊',
    'mac-universal/易宝工坊.app/Contents/MacOS/易宝工坊', 'win-unpacked/e宝工坊.exe', 'linux-unpacked/dsh-desktop',
    'linux-arm64-unpacked/dsh-desktop']
  const executables = paths.map(path => join(result.outDir, path)).filter(existsSync)
  if (!executables.length) throw new Error('No packaged Next executable to verify')
  const expectedVersion = expectedNextVersion(desktopRoot)
  for (const path of executables) {
    // Upstream Desktop keeps both archive fuses off; the archive is sealed by code signing instead.
    await verifyElectronExecutableFuses(path, undefined, false)
    const darwin = path.includes('.app/')
    const resources = darwin ? join(dirname(path), '../Resources') : join(dirname(path), 'resources')
    const root = join(resources, 'app.asar')
    // electron-builder signs unpacked Mach-O files and nested bundles on macOS after afterPack
    // cross-checked the archive, so macOS re-checks the archive with code-signing tolerance.
    // On Windows/Linux, resources are not mutated after afterPack, so skip re-hashing when afterPack already verified them.
    const target = nextPackagingTarget(darwin ? 'darwin' : path.endsWith('.exe') ? 'win32' : 'linux')
    const alreadyVerifiedByAfterPack = verifiedPackagedResources.has(resolve(resources))
    if (darwin || !alreadyVerifiedByAfterPack) {
      const merge = universalMergeRewrite(join(desktopRoot, ...PAYLOAD_DIR.split('/')))
      const descriptor = verifyNextRuntime(resources, expectedVersion, target, { afterCodeSigning: true, acceptRewrite: merge.accept })
      console.log(`Verified ${root} against its sealed descriptor: ${String(descriptor.files.length)} files, dsh ${descriptor.release.dshVersion}`
        + (merge.accepted.length === 0 ? '' : `; the universal merge rewrote ${merge.accepted.join(', ')}`))
      // The manifest copy for the updaters of earlier releases must have come through signing and the merge unchanged.
      const archived = archivedPayload(resources)
      try { verifyUpdaterManifestShim(resources, archived, target.platform, expectedVersion) } finally { archived.close() }
    }
    // The interpreter payloads are pre-signed resources excluded from electron-builder signing; only re-verify when afterPack did not run.
    if (!alreadyVerifiedByAfterPack) {
      const runtimes = verifyNextRuntimeTree(join(resources, 'runtime'), target.platform, expectedVersion)
      if (runtimes.length > 0) console.log(`Verified the bundled primary runtimes: ${runtimes.map(runtime => runtime.arch).join(', ')}`)
    }
    await Promise.all([
      // Electron's Node mode reads the archive like a directory, as the Host and CLI will.
      runPackagedNode(path, ['--input-type=module', '-e', `
        import { createRequire } from 'node:module';
        import { pathToFileURL } from 'node:url';
        const root = process.argv[1];
        const require = createRequire(root + '/package.json');
        if (require('./package.json').name !== 'dsh-plugin-desktop') throw new Error('Wrong packaged application');
        await import(pathToFileURL(root + '/lib/profiles.js'));
        await import(pathToFileURL(root + '/lib/desktop-runtime.js'));
        require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html');
      `, root], 30_000, 'Packaged Next runtime failed'),
      // tr46 imports the npm package punycode/ rather than Node's built-in punycode.
      runPackagedNode(path, [join(desktopRoot, 'scripts', 'packaged-idna-smoke.mjs'), root], 30_000, 'Packaged IDNA dependency smoke failed'),
      // IM's mailbox transport spawns its platform CLI by the manifest path; it must resolve outside the archive.
      runPackagedNode(path, [join(desktopRoot, 'scripts', 'packaged-agently-smoke.mjs'), root], 120_000, 'Packaged Agently CLI smoke failed'),
      // The native computer-use driver opens its library with the system loader; the Host's resolver must answer with the unpacked copy.
      runPackagedNode(path, [join(desktopRoot, 'scripts', 'packaged-driver-smoke.mjs'), root], 120_000, 'Packaged computer-use driver smoke failed'),
      // The badge skill announces its asset directory to the model; the Host's resolver must make it physical.
      runPackagedNode(path, [join(desktopRoot, 'scripts', 'packaged-skill-badge-smoke.mjs'), root], 120_000, 'Packaged badge skill smoke failed'),
      // Image attachments and Market icons go through sharp; on Linux the Host's resolver must keep it on the WebAssembly build.
      runPackagedNode(path, [join(desktopRoot, 'scripts', 'packaged-sharp-smoke.mjs'), root], 120_000, 'Packaged sharp smoke failed'),
      // Session persistence uses the official native flock addon, not legacy fs-ext. Exercise both
      // universal macOS slices on Apple Silicon (Intel through Rosetta), and the native Linux slice.
      ...target.platform === 'win32' ? [] : [
        runPackagedNode(path, [join(desktopRoot, 'scripts', 'packaged-flock-smoke.mjs'), root, process.arch], 30_000, 'Packaged session lock smoke failed'),
        ...(darwin && process.arch === 'arm64' && path.includes('/mac-universal/') ? [
          runPackagedNode(path, [join(desktopRoot, 'scripts', 'packaged-flock-smoke.mjs'), root, 'x64'], 30_000, 'Packaged x64 session lock smoke failed', 'x64'),
        ] : []),
      ],
      // Linux has no tray terminal; the application executable itself answers `<app> dsh …` (#1568).
      ...target.platform === 'linux' ? [
        runPackagedNode(path, [join(desktopRoot, 'scripts', 'packaged-dsh-command-smoke.mjs'), root], 120_000, 'Packaged dsh command smoke failed'),
      ] : [],
      // The same Electron, in Node mode, starts the real Host from the archive with a private home.
      runPackagedNode(path, ['--expose-internals', join(desktopRoot, 'scripts', 'packaged-host-smoke.mjs'), root], 300_000, 'Packaged Next Host smoke failed'),
    ])
  }
  return []
}

export default async function afterAllArtifactBuild(result: { outDir: string }): Promise<string[]> {
  return packagingStep('verify:final-artifacts', () => verifyFinalArtifacts(result))
}
