/**
 * Browser-half entry for the dsh-imagegen plugin — runs inside the dsh web
 * GUI.
 *
 * Registers the image settings surface, then contributes the studio through
 * DSH's official keyed main panel and sidebar list contracts. Account UI is
 * owned solely by @cqaiclub/dsn-account. The session-maybe child seat in
 * dsh-integration owns composer attachment wiring; no shell DOM is queried,
 * hidden, or replaced.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { createElement as h } from 'react'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ImageGenApi } from './api.ts'
import { tt, applyHostLocale } from './helpers.ts'
import { en, ru, zh, type ImageGenKey } from './locales.ts'
import { ImageGenPanel } from './ImageGenPanel.tsx'
import { ImageGenSettingsCard, ImageGenSettingsCardController } from './SettingsCard.tsx'
import { bindImageGenScope, type ImageGenScope } from './settings-scope.ts'
import {
  registerImageToolviews,
  type ImageCommandViewOwnerProps,
  type ImageToolViewOwnerProps,
} from './image-toolview.tsx'
import { registerImageGenStudio } from './dsh-integration.tsx'
import { registerChatImageEditors } from './chat-image-editor.tsx'
import { registerMarkdownImageEditor } from './markdown-image-editor.tsx'

/** Locale namespace this plugin owns. */
const NS = 'dsh-imagegen'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-imagegen surface copy. */
    'dsh-imagegen': ImageGenKey
  }

  interface SlotMap {
    /** Image-generation results render their durable image blocks inline. */
    'tool.call.toolview': { kind: 'keyed'; scope: 'session'; owner: ImageToolViewOwnerProps }
    /** `/edit_image` renders its durable generated attachments inside its command row. */
    'conversation.chat.commandview': { kind: 'keyed'; scope: 'session'; owner: ImageCommandViewOwnerProps }
  }
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'locale', 'connection', 'conversation']

// Internals re-exported for the standalone smoke test (the browser bundle is
// the only place these are reachable from Node); not part of the contract.
export { autoRemoveBackground, compositeAnnotatedResult, containRect, cropRaster, drawAnnotation, rectBetween, rectToPixels, removeBackground, transparencyRatio } from './image-ops.ts'

/**
 * Mount the studio, its sidebar entry, and the settings card.
 * @param ctx - client root context (services: slots, locale, connection).
 */
export function apply(ctx: ClientContext): void {
  // The host locale service only knows zh/en dictionaries (its type is
  // fixed); ru rides the untyped single-locale registration instead.
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-imagegen: dictionaries')
  // Russian ships as a language pack: the dictionary lands in this plugin's
  // namespace, and Русский joins the shared DSH language catalog (Settings →
  // General → Language) with per-key fallback to English for host copy.
  // Registration order/aggregation between register(NS, 'ru', …) and
  // addLanguage differs across host builds and a duplicate throws — these
  // surfaces must degrade silently, never fail the GUI boot.
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, 'ru', ru)
    } catch (error) {
      console.warn('[dsh-imagegen] ru dictionary not registered:', error)
      return () => {}
    }
  }, 'dsh-imagegen: ru dictionary')
  ctx.effect(() => {
    try {
      if (ctx.locale.getLocale().locales.some(locale => locale.id === 'ru')) return () => {}
      return ctx.locale.addLanguage({ id: 'ru', label: 'Русский', fallback: 'en' })
    } catch (error) {
      console.warn('[dsh-imagegen] ru language not added to the catalog:', error)
      return () => {}
    }
  }, 'dsh-imagegen: ru language pack')
  // Every plugin surface renders through tt(); bridge DSH locale switches
  // into it so the whole plugin follows the interface language.
  ctx.effect(() => {
    const applyLocale = (): void => { applyHostLocale(ctx.locale.getLocale().active) }
    applyLocale()
    return ctx.locale.subscribe(applyLocale)
  }, 'dsh-imagegen: follow host locale')

  const connection = ctx.get('connection') as ConnectionHandle | undefined
  const desktop = globalThis.location?.protocol === 'dsh-app:' && globalThis.location.hostname === 'app'
  const loopback = connection?.isLoopback === true || desktop
  // The bridge routes are loopback-fenced; remote browsers get an unavailable
  // scope (the card explains the gap) instead of failing fetches.
  const scope: ImageGenScope = bindImageGenScope(loopback
    ? (input, init) => fetch(input, init)
    : () => { throw new Error('settings bridge is loopback-only') })

  // Re-read the scope whenever the connection resets (same invalidation the
  // official settings binder wires).
  ctx.effect(() => {
    const disposers = [
      ctx.on('connection/reset', () => { void scope.load() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-imagegen: settings scope invalidation')

  // The shipped profile activates this plugin directly, so it also needs a
  // Settings entry when the Plugins page has no separate bundle detail.
  const settingsCard = new ImageGenSettingsCardController(scope)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'cqai-dsh-plugin-imagegen',
    order: 45,
    label: () => tt('settings.title'),
    inject: () => settingsCard.inject(),
  }, ImageGenSettingsCard))
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: 'cqai-dsh-plugin-imagegen',
    locale: NS,
    inject: () => settingsCard.inject(),
  }, ImageGenSettingsCard))

  const api = new ImageGenApi()
  registerImageToolviews(ctx, { api, scope })
  registerChatImageEditors(ctx, { api, scope })
  registerMarkdownImageEditor(ctx, { api, scope })
  registerImageGenStudio(ctx, {
    label: () => tt('entry.image'),
    order: 40,
    renderStudio: ({ conversation }) => h(ImageGenPanel, { api, scope, conversation }),
  })
}
