/** Runtime admission for saved Includes belonging to the former E剪宝 preset. */
import type { Context } from '@deepseek-ai/cordis'
import { Entry } from '@deepseek-ai/cordis-plugin-loader'
import { isEjianbaoEntry } from './ejianbao-migration.ts'

/**
 * Keep the official Include's parsed rows, patches and persistence untouched.
 * Loader exposes entry-init and an effective disabled accessor; wrapping that
 * accessor skips retired rows before import and also makes startup audit skip
 * them. The closure follows the admitted generation, including package HMR.
 * Never write `options.disabled`: reinstalling restores the saved settings.
 */
export function installEjianbaoEntryAdmission(ctx: Context, installed: () => boolean): void {
  const disabled = Object.getOwnPropertyDescriptor(Entry.prototype, 'disabled')?.get
  if (disabled === undefined) throw new Error('Desktop requires the public Loader Entry.disabled accessor')
  ctx.on('loader/entry-init', entry => {
    Object.defineProperty(entry, 'disabled', {
      configurable: true,
      get(this: Entry): boolean {
        return (isEjianbaoEntry(this.options) && !installed()) || disabled.call(this)
      },
    })
  })
}
