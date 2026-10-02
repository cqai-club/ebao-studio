import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'

export type EjianbaoWorkspaceId = 'video' | 'short-video' | 'talkcraft'
export const EJIANBAO_PANEL = 'cqai-ejianbao' as MainPanelId
export const EJIANBAO_WORKSPACES = [
  {id: 'video', panelId: 'cqai-video', label: '数字人视频制作', api: '/api/cqai-video'},
  {id: 'short-video', panelId: 'cqai-short-video', label: '短视频制作', api: '/cqai-short-video'},
  {id: 'talkcraft', panelId: 'cqai-talkcraft', label: '口播视频制作', api: '/api/cqai-talkcraft'},
] as const

export interface EjianbaoWorkspaceOwner {
  active: boolean
  containerPanelId: MainPanelId
  onOpenSettings: () => void
}

export interface EjianbaoUi {
  open(workspace: EjianbaoWorkspaceId): void
  openSettings(from: EjianbaoWorkspaceId): void
}

declare module '@deepseek-ai/cordis' {
  interface Context { ejianbaoUi: EjianbaoUi }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'ejianbao.workspace': {kind: 'keyed'; scope: 'root'; owner: EjianbaoWorkspaceOwner}
  }
}

export type MediaEngine = 'shortVideo' | 'talkcraft'
export type MediaProvider = 'pexels' | 'pixabay' | 'coverr'
export interface MediaDefaults {aspect: '9:16' | '16:9'; edgeVoiceId: string}
export interface MediaSettingsPublic {
  revision: number
  credentialRevision: number
  coverrRevision: number
  defaults: MediaDefaults
  overrides: Partial<Record<MediaEngine, Partial<MediaDefaults>>>
  providers: Record<'pexels' | 'pixabay', {
    configured: boolean
    overrides: Partial<Record<MediaEngine, boolean>>
    conflict: boolean
  }>
  coverrConfigured: boolean
  effective?: MediaDefaults & {pexels: boolean; pixabay: boolean; coverr: boolean}
}

export type MediaSettingsMutation =
  | {operation: 'defaults'; expectedRevision: number; set: Partial<MediaDefaults>; engine?: MediaEngine}
  | {operation: 'credential'; expectedRevision: number; provider: MediaProvider; engine?: MediaEngine; value: string | null}
  | {operation: 'clearOverride'; expectedRevision: number; engine: MediaEngine; field: keyof MediaDefaults | 'pexels' | 'pixabay'}
