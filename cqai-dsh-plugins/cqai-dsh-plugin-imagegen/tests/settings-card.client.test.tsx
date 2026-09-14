// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ImageGenSettingsCard,
  type ImageGenSettingsCardProps,
  type ImageGenSettingsCardState,
} from '../src/client/SettingsCard.tsx'

// The card rendering path does not construct its controller in this test; keep
// the Host-provided client store behind the same platform boundary as runtime.
vi.mock('@deepseek-ai/dsh-client-store', () => ({ createSnapshotStore: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const inheritedField = { text: '', overridden: false, invalid: false }

function settingsState(): ImageGenSettingsCardState {
  return {
    available: true,
    exposed: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    channels: {
      channels: [],
      keySet: {},
      defaultChannelId: 'cqai',
      dirty: false,
      writable: true,
      saving: false,
      failed: false,
    },
    enabled: inheritedField,
    announceToAgent: inheritedField,
    allowAgentImageGeneration: { text: 'true', overridden: true, invalid: false },
    promptApiUrl: inheritedField,
    promptApiKey: inheritedField,
    promptModel: inheritedField,
    localStoragePath: inheritedField,
    storageEnabled: inheritedField,
    storageEndpoint: inheritedField,
    storageRegion: inheritedField,
    storagePrefix: inheritedField,
    storageAccessKey: inheritedField,
    storageSecretKey: inheritedField,
    storageSyncGallery: inheritedField,
    storageSyncHistory: inheritedField,
    skillsEnabled: inheritedField,
    allowHeavySkills: inheritedField,
    skillAllowlist: inheritedField,
    skillOutputDir: inheritedField,
    skillHeavyTimeoutMinutes: inheritedField,
    skillAgentPreset: inheritedField,
  }
}

describe('imagegen settings card', () => {
  it('edits and resets the Agent image-generation switch, not the master switch', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      usage: { byChannel: {}, totals: {} },
    }), { headers: { 'content-type': 'application/json' } })))
    const edit = vi.fn()
    const resetField = vi.fn()
    const state = settingsState()
    const props = {
      useImageGenSettingsCard: () => state,
      edit,
      resetField,
      save: vi.fn(),
      discard: vi.fn(),
      storageTest: vi.fn(async () => ({ ok: true })),
      channels: {
        setChannels: vi.fn(),
        setChannelKey: vi.fn(),
        setDefaultChannel: vi.fn(),
        commit: vi.fn(async () => undefined),
        discard: vi.fn(),
      },
    } as unknown as ImageGenSettingsCardProps

    const view = render(<ImageGenSettingsCard {...props} />)
    const cardToggle = view.container.querySelector<HTMLButtonElement>('button[aria-expanded]')
    expect(cardToggle).not.toBeNull()
    fireEvent.click(cardToggle!)
    const moreToggle = screen.getByText('更多设置').closest('button')
    expect(moreToggle).not.toBeNull()
    fireEvent.click(moreToggle!)

    const select = screen.getByLabelText('允许 Agent 调用生图')
    fireEvent.change(select, { target: { value: 'false' } })
    expect(edit).toHaveBeenCalledWith('allowAgentImageGeneration', 'false')
    expect(edit).not.toHaveBeenCalledWith('enabled', expect.anything())

    const field = select.closest('div')
    expect(field).not.toBeNull()
    fireEvent.click(within(field!).getByRole('button', { name: '重置' }))
    expect(resetField).toHaveBeenCalledWith('allowAgentImageGeneration')
    expect(resetField).not.toHaveBeenCalledWith('enabled')
  })
})
