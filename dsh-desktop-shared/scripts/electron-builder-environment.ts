/** Dependency-collection policy shared by Electron Builder entry points. */
import { join } from 'node:path'

/**
 * Keep the Beta package on Electron Builder's bounded physical traversal.
 * Its Yarn Berry collector delegates to `npm list --all`, which expands the
 * outer stable and Beta workspace instead of the selected app's runtime graph.
 */
export function electronBuilderEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '1',
  }
}

/** Keep public release filenames stable without changing the product's displayed name. */
export function releaseArtifactNameArgs(
  environment: NodeJS.ProcessEnv,
  target: 'mac' | 'nsis' | 'zip',
): string[] {
  if (environment.DSH_RELEASE_ARTIFACT_NAMES !== '1') return []
  if (target === 'mac') return ['--config.mac.artifactName=eBao-Studio-${version}.${ext}']
  if (target === 'nsis') return ['--config.nsis.artifactName=eBao-Studio-${version}-${arch}-Setup.${ext}']
  return ['--config.win.artifactName=eBao-Studio-${version}-${arch}-Portable.${ext}']
}

/** Resolve the actual Windows archive/installer name selected for this build. */
export function windowsArtifactFileName(
  environment: NodeJS.ProcessEnv,
  version: string,
  target: 'nsis' | 'zip',
  defaultPrefix: string,
): string {
  const prefix = environment.DSH_RELEASE_ARTIFACT_NAMES === '1' ? 'eBao-Studio' : defaultPrefix
  return `${prefix}-${version}-x64-${target === 'nsis' ? 'Setup.exe' : 'Portable.zip'}`
}

/** Locate the packaged resources using Electron Builder's resolved app filename. */
export function packagedResourcesDirectory(appOutDir: string, platform: string, productFilename: string): string {
  return platform === 'darwin'
    ? join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
    : join(appOutDir, 'resources')
}
