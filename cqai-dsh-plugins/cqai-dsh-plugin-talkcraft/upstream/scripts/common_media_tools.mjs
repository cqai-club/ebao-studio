// Desktop-owned adapter: shared ordinary media tools never replace Remotion natives.
import fs from 'node:fs';
import path from 'node:path';

export const COMMON_FFMPEG_VERSION = '4.0.519';
const FFMPEG_PROVIDER = 'imageio-ffmpeg@0.6.0';

export function sharedMediaBinary(name, snapshot, env = process.env) {
  if (!['ffmpeg', 'ffprobe'].includes(name)) throw new Error('unsupported media tool');
  const file = (candidate) => {
    try {const info = candidate && fs.statSync(candidate); return info && info.isFile() && info.size > 0;} catch {return false;}
  };
  const explicit = env[`CQAI_${name.toUpperCase()}`];
  if (file(explicit)) return explicit;
  const home = env.CQAI_MEDIA_TOOLS_HOME ?? (env.DSH_HOME ? path.join(env.DSH_HOME, 'media-tools')
    : snapshot ? path.resolve(snapshot, '../../..', 'media-tools') : undefined);
  if (!home) return undefined;
  const directory = path.join(home, 'ffmpeg', COMMON_FFMPEG_VERSION);
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(directory, '.media-tools-ready.json'), 'utf8'));
    const libc = process.platform === 'linux' ? (process.report?.getReport()?.header?.glibcVersionRuntime ? '-gnu' : '-musl') : '';
    const pkg = `compositor-${process.platform}-${process.arch}${process.platform === 'win32' ? '-msvc' : libc}`;
    if (marker.version !== COMMON_FFMPEG_VERSION || marker.package !== `@remotion/${pkg}` || marker.ffmpegProvider !== FFMPEG_PROVIDER
      || typeof marker.ffmpegPath !== 'string' || !/^imageio\/imageio_ffmpeg\/binaries\/ffmpeg-[A-Za-z0-9_.-]+$/.test(marker.ffmpegPath)) return undefined;
    const root = path.join(directory, 'node_modules', '@remotion', pkg);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (name === 'ffprobe' && process.platform === 'darwin' && (marker.ffprobePath !== 'bin/ffprobe' || !file(path.join(root, 'ffprobe')))) return undefined;
    const binary = name === 'ffmpeg' ? path.join(directory, marker.ffmpegPath)
      : process.platform === 'darwin' ? path.join(directory, 'bin', 'ffprobe') : path.join(root, `ffprobe${process.platform === 'win32' ? '.exe' : ''}`);
    const relative = path.relative(fs.realpathSync(directory), fs.realpathSync(binary));
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    return manifest.version === COMMON_FFMPEG_VERSION && file(binary) ? binary : undefined;
  } catch {return undefined;}
}
