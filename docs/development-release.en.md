# Official Desktop development and release boundaries

[中文](development-release.md)

This repository now uses the pinned official DeepSeek Harness Desktop directly. The former Stable/Beta/Next community Desktop packages and e宝 release workflow are inactive. CQAI business-plugin source is retained for separate future integration. This page replaces the previous community Desktop development and e宝 release instructions.

## Initialize

```bash
corepack yarn upstream:init
corepack yarn install --immutable
corepack yarn upstream:install
corepack yarn upstream:prepare-electron
```

`corepack yarn setup` combines upstream initialization, dependency installation, and Electron preparation. pnpm installation does not download Electron; complete `upstream:prepare-electron` before launch or headless Desktop tests, including Windows. If an existing checkout has stale pnpm links, run `corepack yarn upstream:repair-install` to remove stale workspace dependency links, then reinstall from the frozen lockfile.

Use Node.js `>=24.9.0` and Corepack. The outer entry uses Yarn `4.18.0`; `deepseek-harness/` uses the pnpm release pinned by its package manifest. The outer repository has no active application/plugin workspaces and does not include the official submodule in its Yarn dependency graph.

The official source pin is `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`, version `0.2.2-rc.1`. Update the pin and owning metadata in a separate commit; business-feature changes must not edit official source.

## Build and verify

```bash
corepack yarn build
corepack yarn typecheck
corepack yarn test
corepack yarn check
```

`build` invokes official `build:artifacts`; `typecheck` checks official `apps/desktop/tsconfig.json`; `test` runs outer launcher Node tests and official Desktop Vitest tests. `check` combines repository layout, launcher tests, official artifacts, Desktop type checking, and Desktop tests in sequence. Root scripts own the exact commands and upstream owns their implementation coverage. Builds, type checking, and tests stay headless-safe. They do not replace actual graphical startup, account login, or platform installer acceptance.

## Launch and isolate data

```bash
corepack yarn dev
# Use existing build output:
corepack yarn start
```

Both commands explicitly open official Desktop with its official product identity and default capabilities. The launcher defaults to `.official-desktop/home` for Harness state and `.official-desktop/electron-user-data` for Electron user data; consult its log for the resolved paths. These local directories are not committed to Git.

Existing `~/.dsh`, `~/.dsh-beta`, and e宝 application data remain in place. Old Profile executable dependencies, lockfiles, installed plugins, and browser partitions are not automatically migrated into the official `desktop` Profile. Design, verify, and record any future data migration separately.

First use may need network access to prepare the officially pinned bundled runtime. Address preparation failures directly rather than substituting a community shell or old build output.

## Business source and integration scope

Preserved `cqai-dsh-plugins/`, `dsh-community-market/`, `dsh-community-fabric/`, and `matrixmedia-publisher/` source does not participate in the current default installation, build, or launch. CQAI accounts, Publisher, business tools, AA, custom markets, and themes are outside this baseline's feature acceptance.

A later integration should identify official extension interfaces, Host/native services, dependency installation, user data, and verification results. The former `desktopRuntime`, channel-mirroring behavior, and other private community-shell interfaces are not official Desktop services.

## Release status

This change only switches the source-development baseline. It does not create a new e宝 version, tag, installer, or public Release. Historical e宝 Releases and `release/` files remain historical records rather than current official Desktop release instructions.

Root `package:dir` delegates to official application-directory packaging; `dist:mac:arm64`, `dist:mac:x64`, and `dist:win` delegate to unsigned packaging for those official targets. No upload or public release workflow is active.

See the [pinned official Desktop reference](../deepseek-harness/apps/desktop/README.md) for platform packaging, signing, updates, and publication. A local build or successful check does not complete those release steps. Reintroducing e宝 product identity and business capabilities requires separate integration and release changes.

The [official Desktop baseline Agent Note](../.agents/notes/implemented/process/2026-11-16-official-desktop-baseline.md) owns these boundaries.
