# Official Desktop and CQAI account development

[中文](development-release.md)

The application uses unmodified official DeepSeek Harness tracked source, an external CQAI account provider, and a local e宝 welcome overlay. The former community shells and release workflows have been removed. Accounts are the only active business service; other business plugins remain inactive. The main workspace and Dock/application menus retain official identity, while the welcome page uses e宝 branding.

## Initialize

```bash
corepack yarn upstream:init
corepack yarn install --immutable
corepack yarn upstream:install
corepack yarn upstream:prepare-electron
```

Use Node.js `>=24.9.0`, Corepack, and root Yarn `4.18.0`. `corepack yarn setup` combines upstream initialization, dependency installation, and Electron preparation. pnpm installation does not download Electron; complete `upstream:prepare-electron` before graphical startup or headless Desktop tests, including Windows.

For an existing checkout with stale pnpm links, `corepack yarn upstream:repair-install` removes obsolete workspace links and installs from the frozen lockfile. The official submodule owns its pinned pnpm workspace. The outer repository has no active Yarn application workspaces and does not include the official workspace in Yarn's dependency graph.

Official source remains pinned to `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159` (`0.2.2-rc.1`). Update its pin and metadata separately. This account extension does not patch official tracked source.

## Build and verify

```bash
corepack yarn build
corepack yarn typecheck
corepack yarn cqai:typecheck
corepack yarn test
corepack yarn check
```

`build` runs official `build:artifacts`, builds the owned account packages, and generates the welcome overlay last. `typecheck` targets official Desktop; `cqai:typecheck` targets the account and adapter. `test` includes launcher, account, and official Desktop tests. `check` combines layout, builds, both type checks, and headless tests. Record real authorization, model calls, graphical behavior, and installer acceptance separately; unit tests do not establish those outcomes.

Prepare the account extension independently with:

```bash
# Generate server-only packages without modifying a Profile:
corepack yarn cqai:build
# Build and install into the isolated Desktop Profile:
corepack yarn cqai:prepare
corepack yarn cqai:test
```

Generated packages use the pinned official toolchain and exclude the CQAI frontend and other business plugins. Quit a running Desktop before Profile preparation; the preparer refuses concurrent modification while the official Profile lock exists.

## Launch and account boundaries

```bash
corepack yarn dev
# Use existing official artifacts:
corepack yarn start
```

`dev` completes the official build, applies the welcome overlay, and invokes official `start`; it must not subsequently invoke official `dev`, whose rebuild would overwrite the overlay. Root `start` applies the overlay to existing artifacts without rebuilding official source. Both prepare the CQAI external Profile before opening the graphical application.

The welcome logo, heading, copy, and branded sign-in labels use e宝 branding. Sign-in still delegates browser OIDC authorization to the CQAI provider, reusing the account plugin's PKCE, loopback callback, Host credential storage, refresh, and cancellation mechanisms. Active authorization scopes cover identity, refresh, and AI access, without activity-publication permission.

The API Key button explicitly identifies DeepSeek and remains an independent optional route for the official provider. CQAI tokens are not returned through the official DeepSeek inference-token interface or injected into official embedded Platform documents. CQAI currency/monetary balances are not mapped into the official balance UI, which reports unavailable; raw quota must not be labeled as money.

An initial CQAI sign-in may adopt a recommended CQAI model only while the untouched factory default remains selected. Preserve user-selected providers, models, and reasoning settings. Users must still complete authorization on CQAI's browser page; implementation and automated tests do not complete it.

State defaults to `.official-desktop/home` and `.official-desktop/electron-user-data`; generated account artifacts live under `.official-desktop/extensions`. Existing `~/.dsh`, `~/.dsh-beta`, accounts, sessions, works, and old Profiles remain in place, without automatically migrating credentials, lockfiles, or dependencies. See the [account adapter reference](../integrations/cqai-desktop-account/README.md) for details.

## Welcome overlay ownership

`integrations/ebao-desktop-welcome/` reuses the official Welcome component and sandboxed preload. It wraps messages for local copy and uses a guarded build-time transform to replace only the unique brand node. Missing or ambiguous matches must fail the build rather than silently expanding its scope. Output goes into the official ignored `lib/welcome` directory; tracked source, authentication IPC, the main workspace, Dock, and application menus are not rewritten.

This local welcome overlay does not rename the entire application. Record branding, login behavior, real authorization, and graphical acceptance separately; build or snapshot results do not complete user authorization. See the [welcome overlay reference](../integrations/ebao-desktop-welcome/README.md).

## Further integration and release

The CQAI frontend, image/video tools, Publisher Worker, AA, markets, themes, and MatrixMedia are outside this account change. Later capabilities need explicit official extension interfaces, Host/native service ownership, dependencies, data handling, and verification. Do not restore the private community-shell bridge.

**The CQAI provider and welcome overlay currently apply only to source startup.** `package:dir`, `dist:mac:arm64`, `dist:mac:x64`, and `dist:win` still delegate to unsigned pure-official packaging and do not bundle the provider or overlay. Full product installers, branding, updates, and distribution need separate adaptations. There is no active upload/publication workflow and this change publishes no new e宝 version.

Historical e宝 Releases and `release/` files describe the previous product. See the [pinned upstream reference](../deepseek-harness/apps/desktop/README.md) for official packaging. The [official Desktop baseline Agent Note](../.agents/notes/implemented/process/2026-11-16-official-desktop-baseline.md) records the earlier pure-official cutover; this account change extends that baseline with an external provider.
