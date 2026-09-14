// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillConfigForm } from '../src/client/CanvasWorkspace.tsx'
import type { CanvasSkillLibrary } from '../src/protocol.ts'

vi.mock('../src/client/TemplateLibrary.tsx', () => ({ TemplateLibrary: () => null }))

afterEach(cleanup)

const library: CanvasSkillLibrary = {
  root: '/skills',
  entries: [],
  catalog: [],
  networkAvailable: true,
}

describe('skill config explicit confirmation', () => {
  it('shows the full redacted preview and does not apply until the second click', async () => {
    const onSave = vi.fn(async () => ({ ok: true, library }))
    const onPreview = vi.fn(async () => ({
      ok: true,
      ready: true,
      confirmationToken: 'one-time-token',
      expiresAt: Date.now() + 60_000,
      steps: [
        { kind: 'command' as const, detail: '["tool","--model","image-model"]', status: 'ready' as const },
        { kind: 'file' as const, detail: '<skill-config>/provider/config.yaml', content: 'API_KEY: •••\n', status: 'ready' as const },
      ],
    }))
    const onApply = vi.fn(async () => ({
      ok: true,
      library,
      steps: [{ kind: 'file' as const, detail: '→ <skill-config>/provider/config.yaml', ok: true }],
    }))

    render(<SkillConfigForm
      name="safe-skill"
      config={{
        fields: [{ id: 'model', label: 'Model', type: 'string' }],
        values: [{ id: 'model', set: true, value: 'image-model' }],
        source: 'skill',
        applicable: true,
        missing: [],
      }}
      busy={false}
      onSave={onSave}
      onPreview={onPreview}
      onApply={onApply}
    />)

    fireEvent.click(screen.getByRole('button', { name: '保存并预览' }))
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith('safe-skill'))
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByText(/\["tool","--model","image-model"\]/)).toBeTruthy()
    expect(screen.getByText(/<skill-config>\/provider\/config\.yaml/)).toBeTruthy()
    expect(screen.getByText(/API_KEY: •••/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '我已核对，确认应用' }))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith('safe-skill', 'one-time-token'))
  })
})
