/** Locations of the pinned MatrixMedia Worker in source builds and desktop installers. */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

export const MAC_WORKER_EXECUTABLE = 'MatrixMedia Publisher Worker'
export const WORKER_RESOURCE_DIRECTORY = 'publisher'

export function publisherWorkerBuild(root, platform) {
  if (platform !== 'darwin' && platform !== 'win32') return undefined
  const metadata = JSON.parse(readFileSync(join(root, 'vendor', 'matrixmedia', 'publisher-worker.json'), 'utf8'))
  const artifact = resolve(root, platform === 'win32' ? metadata.windowsArtifact : metadata.artifact)
  if (platform === 'darwin') {
    return {
      executable: join(artifact, 'Contents', 'MacOS', MAC_WORKER_EXECUTABLE),
      resource: { from: artifact, to: `${WORKER_RESOURCE_DIRECTORY}/${basename(artifact)}` },
    }
  }
  return { executable: artifact, resource: { from: dirname(artifact), to: WORKER_RESOURCE_DIRECTORY } }
}

export function existingPublisherWorker(root, platform) {
  const build = publisherWorkerBuild(root, platform)
  return build !== undefined && existsSync(build.executable) ? build.executable : undefined
}
