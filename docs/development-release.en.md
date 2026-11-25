# Official Desktop development and packaging

[中文](development-release.md)

Root Yarn provides the command entry points. The official Git submodule at `deepseek-harness/` supplies the desktop shell, authentication interface, runtime, and plugin management. e宝工坊 uses the CQAI account service for sign-in. [upstream.json](../upstream.json) records the official version, commit, and pnpm release. Commit changes to the submodule pointer and its metadata together, independently of product changes.

## Initialize

```bash
corepack yarn upstream:init
corepack yarn install --immutable
corepack yarn upstream:install
corepack yarn upstream:prepare-electron
```

Use Node.js `>=24.9.0`, Corepack, and root Yarn `4.18.0`. `corepack yarn setup` combines official submodule initialization, official dependency installation, and Electron preparation. pnpm dependency installation skips the Electron binary download. Run `upstream:prepare-electron` before launching Desktop or running its tests.

After a successful frozen install, `upstream:install` removes obsolete workspace links and dangling links to local virtual-store packages from pnpm's hoist directory. If stale links cause installation to fail, run `corepack yarn upstream:repair-install` to clean that directory before retrying the frozen install.

## Launch and manage plugins

```bash
corepack yarn dev

# Use an existing build
corepack yarn build
corepack yarn start
```

`dev` runs official `build:artifacts` and `build:desktop`, prepares the CQAI Profile, e宝 welcome page, and workspace account presentation, then delegates to official `start:desktop`. `start` applies the same account integration to an existing build. Rebuild before using `start` after changing versions. The first launch may need network access to prepare the official bundled runtime.

Harness and Electron default to `.official-desktop/official/home` and `.official-desktop/official/electron-user-data` respectively. Use `EBAO_OFFICIAL_DSH_HOME` and `EBAO_OFFICIAL_USER_DATA_DIR` to select absolute paths. Official Desktop initializes or reads the `desktop` Profile in the selected Harness home, and its plugin manager handles plugins installed by the user. Use a fresh directory to verify the official default plugins.

The former source-launch directories `.official-desktop/home` and `.official-desktop/electron-user-data`, `~/.dsh`, `~/.dsh-beta`, and installed-application data are preserved in place. Old Profile plugin lists, dependencies, and browser data stay with that state. Migration requires a separate change.

## Build and verify

```bash
corepack yarn check
```

`check` validates the repository layout, related component DSH versions, and launcher, runs official `build:artifacts`, checks Desktop types, runs the CQAI adapter compatibility suite, and runs headless Desktop tests. Graphical startup, real user authorization, model requests, and native installers require separate verification.

## Packaging and release

`package:dir`, `dist:mac:arm64`, `dist:mac:x64`, and `dist:win` use the official unsigned builder and include the e宝 welcome page, workspace account presentation, and CQAI provider. Packaged applications have their own application identity and data directories. The root `package.json` declares the product version, and `upstream.json` pins the Harness version.

The Desktop packages GitHub Actions workflow builds each installer target. Test prereleases include macOS installers for Apple silicon and Intel, a Windows x64 installer, and `SHA256SUMS`. Users install them manually from GitHub Releases or GitCode.

Other business plugins, the market, and MatrixMedia require separate integration and verification. See [e宝工坊 Releases](https://github.com/cqai-club/ebao-studio/releases) for downloads.
