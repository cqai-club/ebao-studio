export const COMMON_FFMPEG_VERSION: string;
export function sharedMediaBinary(name: 'ffmpeg' | 'ffprobe', snapshot?: string | null, env?: NodeJS.ProcessEnv): string | undefined;
