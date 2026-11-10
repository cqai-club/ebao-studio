/** Verify the IM mailbox CLI resolves and runs from the unpacked payload without network or authentication. */
import { execFileSync } from 'node:child_process'
import { createRequire, findPackageJSON } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.argv[2]
if (!root) throw new Error('packaged-agently-smoke: expected the packaged application root')
const { installAgentlyCliResolution, AGENTLY_CLI_PLATFORM_PACKAGES } = await import(pathToFileURL(join(root, 'lib', 'host-resolution.js')).href)
if (installAgentlyCliResolution(root) === undefined) throw new Error(`packaged-agently-smoke: ${root} is not an archive`)
const manifest = findPackageJSON('@xmanrui/dsh-im', pathToFileURL(join(root, 'package.json')))
if (manifest === undefined) throw new Error('packaged-agently-smoke: the archive carries no IM plugin')
const platform = `${AGENTLY_CLI_PLATFORM_PACKAGES}${process.platform}-${process.arch}`
const resolved = createRequire(manifest).resolve(`${platform}/package.json`)
if (!resolved.includes('app.asar.unpacked')) throw new Error(`packaged-agently-smoke: ${platform} resolved inside the archive: ${resolved}`)
const binary = join(dirname(resolved), 'bin', process.platform === 'win32' ? 'agently-cli.exe' : 'agently-cli')
const help = execFileSync(binary, ['--help'], { encoding: 'utf8', timeout: 30_000 })
if (!help.includes('Agently CLI')) throw new Error('packaged-agently-smoke: unexpected help output')
console.log(`Packaged Agently CLI ran from ${dirname(resolved)}`)
