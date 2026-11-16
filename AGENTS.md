# e宝工坊 repository rules

This repository runs the unmodified official DeepSeek Harness Desktop with a CQAI account provider composed through its external Desktop Profile. The former community Desktop channels remain retired. Other e宝 business capabilities are inactive.

## Prerequisites and setup

- Use Node.js `>=24.9.0`, Corepack, and the root Yarn `4.18.0` release.
- Initialize only the pinned official checkout with `corepack yarn upstream:init`.
- Install the outer command wrapper with `corepack yarn install --immutable`, install the official workspace through `corepack yarn upstream:install`, then download its Electron binary with `corepack yarn upstream:prepare-electron`. `corepack yarn setup` combines upstream initialization, installation, and Electron preparation.
- pnpm dependency installation does not download Electron. Prepare the binary before dev/start and before Desktop tests, including headless Windows tests. If an existing checkout has stale pnpm links, `corepack yarn upstream:repair-install` removes stale workspace dependency links, then reinstalls from the frozen lockfile.
- `deepseek-harness/` owns its pnpm workspace and pinned package-manager release. The outer repository has no active application or plugin Yarn workspaces.

## Build, run, and verify

- `corepack yarn build` runs official `build:artifacts` and builds the owned server-only CQAI account packages. `typecheck` targets the official Desktop project; `cqai:typecheck` targets the account integration. `test` runs launcher, CQAI, and official Desktop tests.
- `corepack yarn check` combines layout and launcher checks, official and owned account builds, Desktop and account type checks, and account/Desktop tests. Keep this gate headless-safe; graphical startup, real user authorization, model calls, and installers need separate evidence.
- `corepack yarn dev` and `corepack yarn start` prepare the CQAI account provider in the isolated external Profile, then explicitly launch official Desktop. `cqai:build` only builds server artifacts; `cqai:prepare` also installs the Profile packages. Build and verification commands must remain headless-safe.
- The root launcher defaults to the isolated `.official-desktop/home` and `.official-desktop/electron-user-data` directories. Do not point it at existing e宝 data or migrate Profiles implicitly.
- Run upstream operations through the root `upstream:*` scripts. Keep the official pnpm workspace out of the outer Yarn dependency graph.
- Official Desktop identity, native UI, plugin management, and packaging remain upstream-owned. The external CQAI provider replaces the default account service for source startup; no official tracked file is patched. The optional API Key entry still configures the official provider.
- `package:dir` and `dist:mac:arm64`, `dist:mac:x64`, and `dist:win` still delegate to unsigned pure-official packaging: they do not bundle this CQAI provider. Product packaging is a separate follow-up. No upload or public release workflow is active.

## Source and data ownership

- `deepseek-harness/` is a pinned Git submodule. Never edit its tracked files from a product feature branch. Update its pin and owning metadata in a separate commit when an upstream change is needed.
- Only the server code in `cqai-dsh-plugins/cqai-dsh-plugin-account/` and the adapter in `integrations/cqai-desktop-account/` are active product integrations. They use the official toolchain and isolated external Profile, without enabling the CQAI frontend or other business plugins.
- Other `cqai-dsh-plugins/` packages, Community Market/Fabric, and MatrixMedia source remain inactive.
- Keep Publisher Worker, AA, Market, themes, and other business integrations inactive until each has an explicit integration and verification change. Active login scopes cover identity, refresh, and AI access, not activity publication.
- CQAI credentials remain Host-owned. Do not expose them through the official DeepSeek inference-token resolver or embedded Platform session. The official monetary-balance UI has no CQAI currency adapter and must report unavailable rather than relabel raw quota.
- Default-model adoption may replace only the untouched official default; preserve user-selected providers, models, and reasoning settings.
- Preserve existing `~/.dsh`, `~/.dsh-beta`, application-support directories, accounts, sessions, attachments, and works. A source cutover is not a user-data reset.
- Historical product documentation and releases describe the retired e宝/community implementation. Do not infer current feature availability from them.
- Commit before a major change of direction. Keep migration, upstream pin changes, later product integrations, and releases independently reviewable.
- Follow the current [CQAI account integration Agent Note](.agents/notes/implemented/architecture/2026-11-16-cqai-official-desktop-account.md). The [pure-official baseline note](.agents/notes/implemented/process/2026-11-16-official-desktop-baseline.md) remains prerequisite history; its read-only upstream and package-manager boundary still apply.
