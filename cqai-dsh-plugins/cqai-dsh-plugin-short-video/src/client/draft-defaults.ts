import type {MediaDefaults} from 'cqai-dsh-media-settings/contracts'

export function draftDefaultPatch(defaults: MediaDefaults, dirty: ReadonlySet<string>, voices: readonly string[] = []): Record<string, string> {
  const voice = voices.find(value => value.startsWith(`${defaults.edgeVoiceId}-`)) || `${defaults.edgeVoiceId}-${defaults.edgeVoiceId.includes('Yun') ? 'Male' : 'Female'}`
  return {...(!dirty.has('video_aspect') ? {video_aspect: defaults.aspect} : {}), ...(!dirty.has('voice_name') ? {voice_name: voice} : {})}
}
