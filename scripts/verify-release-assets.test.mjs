import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  expectedReleaseAssets,
  expectedUpdaterMetadata,
  verifyReleaseAssets,
} from './verify-release-assets.mjs'

const version = '1.2.3'
const assetNames = expectedReleaseAssets(version)

function sha512(value) {
  return createHash('sha512').update(value).digest('base64')
}

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-release-assets-'))
  const digests = []
  for (const [index, name] of assetNames.entries()) {
    const body = Buffer.from(`asset-${String(index)}`)
    await writeFile(join(directory, name), body)
    digests.push(`${createHash('sha256').update(body).digest('hex')}  ${name}`)
  }
  await writeFile(join(directory, 'SHA256SUMS'), `${digests.join('\n')}\n`)
  for (const entry of expectedUpdaterMetadata(version)) {
    const fileEntries = await Promise.all(entry.files.map(async filename => {
      const body = await readFile(join(directory, filename))
      return [
        `  - url: ${filename}`,
        `    sha512: ${sha512(body)}`,
        `    size: ${String(body.byteLength)}`,
      ]
    }))
    const body = await readFile(join(directory, entry.asset))
    const digest = sha512(body)
    await writeFile(join(directory, entry.filename), [
      `version: ${version}`,
      'files:',
      ...fileEntries.flat(),
      `path: ${entry.asset}`,
      `sha512: ${digest}`,
      'releaseDate: 2026-09-22T00:00:00.000Z',
      '',
    ].join('\n'))
  }
  return directory
}

test('verifies the exact release asset set, SHA256SUMS, and Electron Updater SHA-512 metadata', async () => {
  const directory = await createFixture()
  try {
    await assert.doesNotReject(verifyReleaseAssets(directory, version))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('accepts Electron Builder metadata that omits optional artifact sizes', async () => {
  const directory = await createFixture()
  try {
    for (const entry of expectedUpdaterMetadata(version)) {
      const metadataPath = join(directory, entry.filename)
      const metadata = await readFile(metadataPath, 'utf8')
      await writeFile(metadataPath, metadata.replaceAll(/^    size: [1-9][0-9]*\n/gmu, ''))
    }
    await assert.doesNotReject(verifyReleaseAssets(directory, version))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects a checksum mismatch and an unexpected asset', async () => {
  const directory = await createFixture()
  try {
    await writeFile(join(directory, assetNames[1]), 'changed')
    await assert.rejects(verifyReleaseAssets(directory, version), /SHA-256 mismatch/)
    await writeFile(join(directory, assetNames[1]), 'asset-1')
    await writeFile(join(directory, 'unexpected.txt'), 'no')
    await assert.rejects(verifyReleaseAssets(directory, version), /Unexpected release asset set/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects malformed, incomplete, and mismatched updater metadata', async () => {
  const directory = await createFixture()
  try {
    const checksumPath = join(directory, 'SHA256SUMS')
    const original = await readFile(checksumPath, 'utf8')
    await writeFile(checksumPath, `${original}not-a-checksum\n`)
    await assert.rejects(verifyReleaseAssets(directory, version), /invalid line/)
    await writeFile(checksumPath, original.replace(/^[^\n]+\n/u, ''))
    await assert.rejects(verifyReleaseAssets(directory, version), /exactly these assets/)
    await writeFile(checksumPath, original)

    const metadataPath = join(directory, 'latest.yml')
    const metadata = await readFile(metadataPath, 'utf8')
    await writeFile(metadataPath, metadata.replace('sha512: ', 'sha512: invalid'))
    await assert.rejects(verifyReleaseAssets(directory, version), /invalid SHA-512/)
    await writeFile(metadataPath, metadata.replace(`size: ${String(Buffer.byteLength('asset-2'))}`, 'size: 99'))
    await assert.rejects(verifyReleaseAssets(directory, version), /size does not match/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
