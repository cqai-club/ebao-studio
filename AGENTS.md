# e宝工坊 repository rules

This repository currently runs the unmodified official DeepSeek Harness Desktop. The former community Desktop channels have been retired from the active build. CQAI account and business capabilities will be integrated separately later.

## Prerequisites and setup

- Use Node.js `>=24.9.0`, Corepack, and the root Yarn `4.18.0` release.
- Initialize only the pinned official checkout with `corepack yarn upstream:init`.
- Install the outer command wrapper with `corepack yarn install --immutable`, install the official workspace through `corepack yarn upstream:install`, then download its Electron binary with `corepack yarn upstream:prepare-electron`. `corepack yarn setup` combines upstream initialization, installation, and Electron preparation.
- pnpm dependency installation does not download Electron. Prepare the binary before dev/start and before Desktop tests, including headless Windows tests. If an existing checkout has stale pnpm links, `corepack yarn upstream:repair-install` removes stale workspace dependency links, then reinstalls from the frozen lockfile.
- `deepseek-harness/` owns its pnpm workspace and pinned package-manager release. The outer repository has no active application or plugin Yarn workspaces.

## Build, run, and verify

- `corepack yarn build` delegates to official `build:artifacts`; `typecheck` runs the official Desktop TypeScript project; `test` runs outer launcher tests and official Desktop tests.
- `corepack yarn check` combines repository-layout checks, launcher tests, official artifact building, Desktop type checking, and Desktop tests. Keep this gate headless-safe; it is not a graphical or installer acceptance test.
- `corepack yarn dev` and `corepack yarn start` explicitly launch the official Desktop. Keep graphical application launch explicit; build and verification commands must remain headless-safe.
- The root launcher defaults to the isolated `.official-desktop/home` and `.official-desktop/electron-user-data` directories. Do not point it at existing e宝 data or migrate Profiles implicitly.
- Run upstream operations through the root `upstream:*` scripts. Keep the official pnpm workspace out of the outer Yarn dependency graph.
- Official Desktop identity, login, plugin management, and packaging behavior belong to upstream. `package:dir` and `dist:mac:arm64`, `dist:mac:x64`, and `dist:win` delegate to unsigned official packaging. No upload or public release workflow is active. This cutover does not create a new e宝 installer or publish a release.

## Source and data ownership

- `deepseek-harness/` is a pinned Git submodule. Never edit its tracked files from a product feature branch. Update its pin and owning metadata in a separate commit when an upstream change is needed.
- `cqai-dsh-plugins/`, `dsh-community-market/`, `dsh-community-fabric/`, and `matrixmedia-publisher/` retain source for later integration. They are not installed, built, or activated by the default official Desktop workflow.
- Keep CQAI account, Publisher Worker, AA, Market, custom themes, and other product integrations out of the official baseline until each has an explicit integration and verification change.
- Preserve existing `~/.dsh`, `~/.dsh-beta`, application-support directories, accounts, sessions, attachments, and works. A source cutover is not a user-data reset.
- Historical product documentation and releases describe the retired e宝/community implementation. Do not infer current feature availability from them.
- Commit before a major change of direction. Keep migration, upstream pin changes, later product integrations, and releases independently reviewable.
- Follow the current [owning Agent Note](.agents/notes/implemented/process/2026-11-16-official-desktop-baseline.md). It supersedes the former community-channel topology while preserving the read-only upstream and package-manager boundary.
