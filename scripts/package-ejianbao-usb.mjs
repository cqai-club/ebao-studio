/** Stage a complete portable folder after the desktop Windows package gate passes. */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { packageDirectory } from '../dsh-plugin-desktop/scripts/package-dir.mjs'

const root = resolve(import.meta.dirname, '..')
const runtime = join(root, '.portable/runtime')
const video = join(root, 'cqai-dsh-plugins/cqai-dsh-plugin-video/runtime')
const output = resolve(root, '..', '交付', 'e剪宝U盘版')
if (existsSync(output)) throw new Error('Delivery directory already exists; keep the previous delivery and choose a fresh output')
for (const file of ['python312/python.exe', 'node/node.exe', 'browser/chrome-headless-shell.exe']) {
  if (!existsSync(join(runtime, file))) throw new Error(`Missing staged portable resource: ${file}`)
}
if (!existsSync(join(video, 'render-studio/node_modules/@remotion/cli/remotion-cli.js'))) throw new Error('Missing Remotion dependencies')
packageDirectory()
mkdirSync(output, {recursive: true})
// Avoid Node 24 cpSync native directory/overwrite failures on Windows Unicode paths.
function copy(from, to) {
  if (/[\\/](?:__pycache__|\.cache)(?:[\\/]|$)/.test(from)) return
  if (statSync(from).isDirectory()) {
    mkdirSync(to, {recursive: true})
    for (const name of readdirSync(from)) copy(join(from, name), join(to, name))
  } else {writeFileSync(to, readFileSync(from))}
}
copy(join(root, 'dsh-plugin-desktop/dist/win-unpacked'), output)
const extra = join(output, 'resources/ejianbao-runtime')
for (const name of ['python312', 'node', 'browser']) copy(join(runtime, name), join(extra, name))
copy(video, join(extra, 'video'))
renameSync(join(output, '易宝工坊.exe'), join(output, 'e剪宝.exe'))
writeFileSync(join(output, 'portable.json'), JSON.stringify({product: 'e剪宝', portable: true, schema: 1}) + '\n')
writeFileSync(join(output, '使用说明.txt'), `e剪宝 U 盘便携版（Windows x64）

1. 将整个“e剪宝U盘版”文件夹复制到 U 盘，不要只复制 EXE。
2. 双击“e剪宝.exe”，在易宝工坊左侧 e图宝下方打开 e剪宝。
3. 数字人口播：展开“个人 InferFlow 账户”，输入自己的 API Key 并连接。
4. 上传授权形象照和参考录音、填写文案，点击估算费用，确认后生成。
5. 已有口播视频可直接在本地制作；Python、FFmpeg、Node.js 和浏览器均已内置。

数据与任务保存在本文件夹的 data 中。密钥仅保留在本次运行内存里，关闭后需重新输入。
数字人生成必须联网，按 InferFlow 实际输出时长消耗个人积分。
停止本地等待不会取消云端生成；重新连接同一 API Key 后继续原任务。
若提交时断网且未收到任务编号，请先在 InferFlow 核对任务记录，避免重复付费。
成片完成后再退出程序并安全弹出 U 盘。建议 U 盘使用 NTFS 或 exFAT 并预留至少 8 GB 空间。
该版本未做数字签名。附带第三方组件的许可文件保留在各运行时目录中。
`)
console.log('PORTABLE_FOLDER_READY', output)
