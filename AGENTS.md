# e宝工坊 repository rules

This repository runs the pinned official DeepSeek Harness Desktop from unmodified upstream source. DeepSeek Harness owns the welcome page, sign-in, runtime, and plugin management.

## Prerequisites and setup

- Use Node.js `>=24.9.0`, Corepack, and the root Yarn `4.18.0` release.
- Initialize only the pinned official checkout with `corepack yarn upstream:init`.
- Install the outer command wrapper with `corepack yarn install --immutable`, install the official workspace through `corepack yarn upstream:install`, then download its Electron binary with `corepack yarn upstream:prepare-electron`. `corepack yarn setup` combines upstream initialization, installation, and Electron preparation.
- Prepare the Electron binary before dev/start and Desktop tests, including headless Windows tests. After a successful frozen install, `corepack yarn upstream:install` removes obsolete workspace links and dangling local virtual-store links from pnpm's hoist directory. If stale links block installation, use `corepack yarn upstream:repair-install` to clean that directory before retrying the frozen install.
- `deepseek-harness/` owns its pnpm workspace and pinned package-manager release. The outer repository has no active application or plugin Yarn workspaces.

## Build, run, and verify

- `corepack yarn build` runs the official build and generates the owned e宝 welcome layer and CQAI account artifacts. `typecheck` targets the official Desktop project. `test` runs launcher tests, the CQAI adapter compatibility suite, and official Desktop tests.
- `corepack yarn check` combines layout and DSH component-version checks, launcher tests, the official build, Desktop type checking, the CQAI adapter compatibility suite, and Desktop tests. Keep this gate headless-safe. Graphical startup, real user authorization, model calls, and installers need separate evidence.
- `corepack yarn dev` builds the official artifacts, prepares the CQAI Profile and e宝 welcome layer, then starts the official Desktop shell. `corepack yarn start` prepares the same owned layers before using the existing official build.
- The launcher defaults to `.official-desktop/official/home` and `.official-desktop/official/electron-user-data`. Preserve the former source-launch directories and installed app data. Override the new defaults with absolute paths only through `EBAO_OFFICIAL_DSH_HOME` and `EBAO_OFFICIAL_USER_DATA_DIR`. Use fresh paths to verify official default plugins.
- Run upstream operations through the root `upstream:*` scripts. Keep the official pnpm workspace out of the outer Yarn dependency graph.
- Let official Desktop initialize its `desktop` Profile and manage any plugins installed by the user.
- `package:dir`, `dist:mac:arm64`, `dist:mac:x64`, and `dist:win` delegate to unsigned official packaging for local use.

## Source and data ownership

- `deepseek-harness/` is a pinned Git submodule. Never edit its tracked files from a product feature branch. Update its pin and owning metadata in a separate commit when an upstream change is needed.
- The CQAI account provider and e宝 welcome overlay are active for source startup. Other `cqai-dsh-plugins/` packages, Publisher Worker, AA, Market/Fabric, themes, and MatrixMedia remain inactive source. Integrating each additional business capability requires a separate implementation and verification change.
- Preserve existing `~/.dsh`, `~/.dsh-beta`, application-support directories, accounts, sessions, attachments, and works. Data migration requires a separate change.
- Historical product documentation and releases describe the retired e宝/community implementation. Do not infer current feature availability from them.
- Commit before a major change of direction. Keep migration, upstream pin changes, later product integrations, and releases independently reviewable.
- Follow the [current development guide](docs/development-release.en.md) for launcher behavior and data paths. The [official Desktop baseline note](.agents/notes/implemented/process/2026-11-16-official-desktop-baseline.md) records the original upstream boundary. The [CQAI account and welcome note](.agents/notes/implemented/architecture/2026-11-16-cqai-official-desktop-account.md) describes the retired integration.
