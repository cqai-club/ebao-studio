// Headless installation and codec smoke in an isolated application home.
import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve, sep} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {commonToolEnvironment, commonToolSteps, installCommonMediaTools, sharedMediaTool} from '../cqai-dsh-plugins/cqai-dsh-plugin-media-runtime/lib/index.js'

const exec = promisify(execFile)
const parent = resolve(tmpdir())
// macOS's ffprobe launcher must also work in user paths with spaces and quotes.
const home = await mkdtemp(join(parent, "cqai-common-media-smoke-quoted ' "))
try {
  const python = commonToolSteps(home).find(step => step.id === 'python')
  if (!await python.ready()) await python.run(line => console.log(line))
  await installCommonMediaTools(home, line => console.log(line))
  const ffmpeg = sharedMediaTool(home, 'ffmpeg'), ffprobe = sharedMediaTool(home, 'ffprobe')
  assert(ffmpeg && ffprobe, 'both tools must pass installation verification')
  const env = commonToolEnvironment(home)
  assert.equal(env.CQAI_FFMPEG, ffmpeg)
  assert.equal(env.CQAI_FFPROBE, ffprobe)
  const output = join(home, 'codec-smoke.mp4')
  await exec(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=96x128:r=10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '0.5', '-vf', 'crop=64:96,scale=64:96', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', output], {env, windowsHide: true, timeout: 30000})
  const {stdout} = await exec(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], {env, windowsHide: true, timeout: 15000})
  const metadata = JSON.parse(stdout)
  assert(metadata.streams.some(stream => stream.codec_name === 'h264' && stream.width === 64 && stream.height === 96))
  assert(metadata.streams.some(stream => stream.codec_name === 'aac'))
  assert(Number(metadata.format.duration) > 0)
  const second = []
  await installCommonMediaTools(home, line => second.push(line))
  assert.deepEqual(second, ['公共 FFmpeg 与 ffprobe 已就绪'])
  // Repair must reinstall a damaged binary even if wheel metadata still exists.
  assert(resolve(ffmpeg).startsWith(resolve(home) + sep))
  await writeFile(ffmpeg, '')
  await installCommonMediaTools(home, line => console.log(line))
  await exec(sharedMediaTool(home, 'ffmpeg'), ['-version'], {windowsHide: true, timeout: 15000})
  console.log('Shared FFmpeg/ffprobe: filters, H.264 + AAC encode/probe, installation reuse and damaged-tool repair passed.')
} finally {
  const target = resolve(home)
  assert(target.startsWith(parent + sep) && target.split(sep).at(-1).startsWith('cqai-common-media-smoke-'))
  await rm(target, {recursive: true, force: true, maxRetries: 10, retryDelay: 250})
}
