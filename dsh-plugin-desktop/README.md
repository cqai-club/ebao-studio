# e宝工坊

English | [中文](README.zh.md)

e宝工坊 now uses the modern Desktop shell from `anywhere-labs/dsh-desktop` at `117e489913`, around the unmodified official DeepSeek Harness checkout. Stable and Beta share this architecture and the `0.2.2-rc.1` runtime built from the exact source recorded in the root `upstream.json`. Product identity, versions, update feeds, and account data remain e宝工坊 owned.

The Electron main process owns windows, native permissions, downloads, recovery and Publisher Worker lifecycle. A separate Electron Node-mode Host runs the official Web frontend and Profile plugins. Legacy helper and native UI source lives in the private `dsh-desktop-shared` workspace. Compatibility follows the official frontend; there is no copied chat implementation.

## Run and verify

Use Node.js `>=24.9.0` and root Corepack Yarn `4.18.0`. Run from the repository root:

```sh
corepack yarn install --immutable
corepack yarn workspace dsh-desktop-next exec playwright install chromium
corepack yarn dev
corepack yarn workspace dsh-plugin-desktop check
corepack yarn check:desktop-variants
```

The headless frontend checks require Chromium; on Linux, use `playwright install --with-deps chromium` for the first installation. `dev` explicitly opens the application. Build, type checking, tests and headless Host checks do not open windows. Root development commands refresh dshmarket and the official Agents Anywhere build before launch; first preparation needs network access. The locked primary runtime includes Python, Node, pnpm and Office skills. `DSH_MAC_SMOKE_ARCH` may select one verified macOS CPU for a local preview; release packaging defaults to both CPUs.

## Product capabilities

Normal Profile composition retains CQAI Club account and models, ImageGen, Publisher, IM, the CQAI market, Skills/MCP manager, PPT composer, the product presentation and CQAI Club theme. Application-owned bundle layers are recomposed on package operations and HMR, while the user's manifest and patch stay authoritative. Safe Mode omits these product plugins so recovery remains usable.

The private `desktopRuntime` bridge supports CQAI account browser login and Publisher operations. Native file selection returns an opaque identifier; local video paths stay in Electron main. Worker methods are allowlisted, requests are bounded and cancellable, and quitting during an upload asks before interruption. Interrupted publication is never retried automatically.

## Data and updates

The default Harness home is `~/.dsh`. A saved in-app directory takes precedence over `DSH_DESKTOP_HOME`; the environment value applies when no directory was chosen. Profiles share settings and credentials within their Harness home, so they are not account isolation. Existing Profile files are backed up by recovery before repair.

Updates and release notes use the e宝工坊 repository and its declared channel. The shell never redirects an e宝工坊 installation to an upstream DSH Desktop installer.

See [plugin services](docs/plugin-services.md) for the modern shell's narrow service boundary. Platform packaging and real-account acceptance remain separate from headless verification.
