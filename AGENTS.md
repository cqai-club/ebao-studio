# e宝工坊 repository rules

This repository uses unmodified official DeepSeek Harness tracked source, an external CQAI account provider, and an owned local e宝 welcome-page overlay. The former community Desktop channels remain retired. Other e宝 business capabilities are inactive.

## Prerequisites and setup

- Use Node.js `>=24.9.0`, Corepack, and the root Yarn `4.18.0` release.
- Initialize only the pinned official checkout with `corepack yarn upstream:init`.
- Install the outer command wrapper with `corepack yarn install --immutable`, install the official workspace through `corepack yarn upstream:install`, then download its Electron binary with `corepack yarn upstream:prepare-electron`. `corepack yarn setup` combines upstream initialization, installation, and Electron preparation.
- pnpm dependency installation does not download Electron. Prepare the binary before dev/start and before Desktop tests, including headless Windows tests. If an existing checkout has stale pnpm links, `corepack yarn upstream:repair-install` removes stale workspace dependency links, then reinstalls from the frozen lockfile.
- `deepseek-harness/` owns its pnpm workspace and pinned package-manager release. The outer repository has no active application or plugin Yarn workspaces.

## Build, run, and verify

- `corepack yarn build` runs official `build:artifacts`, builds the owned server-only CQAI account packages, and applies the welcome overlay last. `typecheck` targets the official Desktop project; `cqai:typecheck` targets the account integration. `test` runs launcher, CQAI, and official Desktop tests.
- `corepack yarn check` combines layout and launcher checks, official and owned account builds, Desktop and account type checks, and account/Desktop tests. Keep this gate headless-safe; graphical startup, real user authorization, model calls, and installers need separate evidence.
- `corepack yarn dev` builds official artifacts, prepares CQAI and the welcome overlay, then uses the official start entry so a later upstream rebuild cannot overwrite the overlay. `start` applies the overlay to existing official artifacts and prepares the isolated CQAI Profile. `cqai:build` only builds server artifacts; `cqai:prepare` also installs Profile packages. Build and verification stay headless-safe.
- The root launcher defaults to the isolated `.official-desktop/home` and `.official-desktop/electron-user-data` directories. Do not point it at existing e宝 data or migrate Profiles implicitly.
- Run upstream operations through the root `upstream:*` scripts. Keep the official pnpm workspace out of the outer Yarn dependency graph.
- Main workspace UI, Dock/application-menu identity, and plugin management remain official. The owned welcome overlay changes only the local welcome page logo, heading, copy, and branded login labels; CQAI still owns real sign-in, and the API Key option explicitly remains DeepSeek.
- `integrations/ebao-desktop-welcome/` reuses the official Welcome component and sandboxed preload. Messages are wrapped, and a guarded build-time transform replaces only the unique brand node. Generate into ignored `lib/welcome` output; refuse missing/ambiguous brand matches. Never edit official tracked source or replace authentication IPC.
- `package:dir` and `dist:mac:arm64`, `dist:mac:x64`, and `dist:win` still delegate to unsigned pure-official packaging: they do not bundle the CQAI provider or welcome overlay. Product packaging is a separate follow-up. No upload or public release workflow is active.

## Source and data ownership

- `deepseek-harness/` is a pinned Git submodule. Never edit its tracked files from a product feature branch. Update its pin and owning metadata in a separate commit when an upstream change is needed.
- Active product integrations are the server code in `cqai-dsh-plugins/cqai-dsh-plugin-account/`, its provider in `integrations/cqai-desktop-account/`, and the welcome renderer overlay in `integrations/ebao-desktop-welcome/`. They use the official toolchain without loading the CQAI account frontend or other business plugins.
- Other `cqai-dsh-plugins/` packages, Community Market/Fabric, and MatrixMedia source remain inactive.
- Keep Publisher Worker, AA, Market, themes, and other business integrations inactive until each has an explicit integration and verification change. Active login scopes cover identity, refresh, and AI access, not activity publication.
- CQAI credentials remain Host-owned. Do not expose them through the official DeepSeek inference-token resolver or embedded Platform session. The official monetary-balance UI has no CQAI currency adapter and must report unavailable rather than relabel raw quota.
- Default-model adoption may replace only the untouched official default; preserve user-selected providers, models, and reasoning settings.
- Preserve existing `~/.dsh`, `~/.dsh-beta`, application-support directories, accounts, sessions, attachments, and works. A source cutover is not a user-data reset.
- Historical product documentation and releases describe the retired e宝/community implementation. Do not infer current feature availability from them.
- Commit before a major change of direction. Keep migration, upstream pin changes, later product integrations, and releases independently reviewable.
- Follow the current [CQAI account and welcome integration Agent Note](.agents/notes/implemented/architecture/2026-11-16-cqai-official-desktop-account.md). The [pure-official baseline note](.agents/notes/implemented/process/2026-11-16-official-desktop-baseline.md) remains prerequisite history; its read-only upstream and package-manager boundary still apply.
