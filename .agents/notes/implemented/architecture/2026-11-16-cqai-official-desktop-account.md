# Agent Note: CQAI accounts and the local e宝 welcome page

Status: implemented

English | [中文](2026-11-16-cqai-official-desktop-account.zh.md)

## Decision

Compose CQAI sign-in through the official external `desktop` Profile and apply an owned e宝 welcome-page presentation. Retain official tracked source, the main workspace, Dock/application-menu identity, Host, and package-manager boundary. This is the first account integration on top of the [pure-official baseline](../process/2026-11-16-official-desktop-baseline.md); that earlier note remains prerequisite history, not a prohibition on this explicit extension. The official source pin is unchanged.

The server-side `@cqaiclub/dsn-account`, owned `@cqaiclub/desktop-account` provider, and local welcome overlay are active. The CQAI account frontend, community shell, Publisher Worker, AA, markets, themes, and other business plugins remain inactive.

## Composition and ownership

The preparation tool builds fingerprinted owned packages under `.official-desktop/extensions` with the official toolchain, then adds standard file dependencies and the provider bundle to the isolated external Profile. It preserves user patch files, settings, other dependencies, and bundle order. Profile preparation holds the official lock and fails while another process owns it.

The bundle inserts `cqaiclub-dsn-account` and `cqai-desktop-account`, then disables the original `deepseek-account` and `llm-deepseek-account` entries. In the official Include grammar, a patch's `name` guards an existing plugin identity; it cannot rename that plugin. Replacing the provider therefore requires **disabling the original entry and inserting the owned provider under its own entry ID**, rather than changing the original row's name.

The provider extends the actual official `DeepSeekAccount` Service SDK and translates the existing CQAI lifecycle into its account RPC and stream contract. Official SDK imports remain shared runtime peers. No service spoofing, fake API key, native-window interception, upstream tracked-source patch, or community bridge implements this flow.

## Welcome presentation

`integrations/ebao-desktop-welcome/` reuses official `WelcomePage.tsx`, its renderer entry, and the sandboxed welcome preload. An owned messages wrapper supplies e宝 headings, copy, and sign-in labels while keeping every preload operation intact. A guarded build-time transform replaces only the unique brand image node and wraps the unique Welcome mount; missing or multiple marker matches fail before output is written. The existing e宝 robot asset is copied as static data without loading its former presentation plugin.

Only ignored `deepseek-harness/apps/desktop/lib/welcome` artifacts are generated. Official tracked files, account IPC, main workspace, Dock, and application menus are not rewritten. Root build applies the overlay after the official build. Root dev must build official artifacts, apply the overlay, then call official start; root start applies it to existing artifacts. A later official rebuild replaces these artifacts, so do not apply the overlay before it.

The welcome page uses e宝 branding, CQAI remains the real sign-in destination, and the API Key option explicitly identifies DeepSeek. This is local welcome presentation, not a full application identity migration.

## Credentials and behavior

Reuse the account service's Authorization Code + PKCE, state verification, loopback callback, Host credential storage, refresh, cancellation, and local-first sign-out. Awaited cancellation settles the old attempt before immediate retry. The active scope set covers identity, refresh, and AI access, excluding activity publication.

CQAI credentials never enter renderer account state, the official DeepSeek inference-token resolver, or an embedded official Platform session. The official API Key entry remains an independent official-provider option. CQAI monetary balances are not adapted into the official balance UI; return unavailable instead of relabeling raw quota. Model adoption may replace only the untouched factory default and must retain explicit provider, model, and reasoning selections.

Default data stays under `.official-desktop/home` and `.official-desktop/electron-user-data`. Preserve existing e宝 homes, credentials, sessions, attachments, works, and browser data; do not migrate them implicitly.

## Verification and distribution boundary

Headless checks cover provider state projection, real Service SDK integration, allowed authorization destinations, credential isolation, cancellation/retry, account/model behavior, Profile composition, and build/type contracts. A real Host smoke must confirm that the owned provider serves account RPC and streams, and that native sign-in opens the CQAI issuer. Mocked authorization tests or signed-out RPC responses do not establish completed real-user authorization or successful model inference; record those separately.

This integration applies to source `dev/start`. Root unsigned packaging commands still build the pure official application without this provider or welcome overlay. Full product packaging/identity, updates, and publication require a separate change. Renderer branding and genuine user authorization require separate graphical evidence; headless output does not establish them. This decision creates no public release.
