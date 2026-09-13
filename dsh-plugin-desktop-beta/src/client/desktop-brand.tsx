/** Desktop-owned product branding for upstream's replaceable UI slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only import for the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import {
  DESKTOP_BRAND_MARK_DATA_URI,
  DESKTOP_BRAND_NAME_DATA_URI,
} from './desktop-brand-assets.ts'

/** Lower priorities render first, so the desktop product owns the brand slots. */
const DESKTOP_BRAND_SLOT_PRIORITY = -100

interface DesktopBrandMarkProps extends SidebarBrandMarkOwnerProps {
  readonly className?: HeroBrandMarkOwnerProps['className']
}

function withClassName(base: string, className: string | undefined): string {
  return className === undefined ? base : `${base} ${className}`
}

/** Render the supplied-size mark used by the sidebar and blank-session hero. */
export function DesktopBrandMark({ size, className }: DesktopBrandMarkProps) {
  return <img
    aria-hidden="true"
    className={withClassName('dshDesktopBrandMark', className)}
    draggable={false}
    height={size}
    src={DESKTOP_BRAND_MARK_DATA_URI}
    width={size}
    alt=""
  />
}

/** Render the text-only wordmark used in the expanded sidebar. */
export function DesktopBrandName(_props: SidebarBrandNameOwnerProps) {
  return <img
    aria-hidden="true"
    className="dshDesktopBrandName"
    draggable={false}
    src={DESKTOP_BRAND_NAME_DATA_URI}
    style={{ display: 'block', flex: '0 1 auto', width: 'auto', maxWidth: '100%', height: 24, objectFit: 'contain' }}
    alt=""
  />
}

/**
 * Register product branding only after each upstream host declares its slot.
 * This keeps the desktop plugin load-order independent from the UI packages.
 * @param ctx - browser Cordis context.
 */
export function applyDesktopBrand(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({
        name: 'sidebar.brand.mark',
        priority: DESKTOP_BRAND_SLOT_PRIORITY,
      }, DesktopBrandMark)
      yield ctx.slots.register({
        name: 'sidebar.brand.name',
        priority: DESKTOP_BRAND_SLOT_PRIORITY,
      }, DesktopBrandName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({
      name: 'conversation.hero.brand.mark',
      priority: DESKTOP_BRAND_SLOT_PRIORITY,
    }, DesktopBrandMark))
}
