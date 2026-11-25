# e宝工坊 runs the official DeepSeek Harness Desktop

[中文](README.md) · [Documentation](docs/README.en.md) · [Contributing](CONTRIBUTING.en.md)

This repository builds and runs DeepSeek Harness Desktop from pinned official source. The welcome window and workspace use e宝工坊 accounts backed by CQAI. Users can also configure a DeepSeek API key for official DeepSeek models. See [upstream.json](upstream.json) for the pinned version, commit, and pnpm release.

The e宝 account integration loads in source and packaged applications. Former business plugins remain available for separate future integrations. e宝工坊 maintains this repository independently. The [DeepSeek Harness Desktop documentation](deepseek-harness/apps/desktop/README.md) covers official runtime and plugin behavior.

## Run from source

Use Node.js `>=24.9.0`, Git, and Corepack. The outer commands use Yarn `4.18.0`, and the official submodule uses its pinned pnpm release.

```bash
corepack yarn upstream:init
corepack yarn install --immutable
corepack yarn upstream:install
corepack yarn upstream:prepare-electron
corepack yarn dev
```

`dev` builds official artifacts, prepares the CQAI Profile and e宝 welcome layer, and launches the graphical application. To launch a prepared build, run `corepack yarn build`, then `corepack yarn start`. Initial preparation of dependencies, Electron, and the official bundled runtime requires network access. Windows Git Bash can use `corepack.cmd`.

The official development instance stores Harness state in `.official-desktop/official/home` and Electron user data in `.official-desktop/official/electron-user-data`. Existing local Profiles, accounts, sessions, works, and installed-application data stay in their original locations. The [development guide](docs/development-release.en.md) explains how to select custom paths.

## Verify and package

| Repository-root command | Purpose |
| --- | --- |
| `corepack yarn build` | Run official `build:artifacts` and generate the e宝 welcome and account layers |
| `corepack yarn typecheck` | Check official Desktop types |
| `corepack yarn test` | Run launcher, CQAI account compatibility, and official Desktop tests |
| `corepack yarn check` | Check layout, component versions, launcher, build, types, and headless tests |
| `corepack yarn package:dir` | Generate an unsigned e宝工坊 application directory |
| `corepack yarn dist:mac:arm64`, `dist:mac:x64`, `dist:win` | Generate an unsigned e宝工坊 installer for the selected target |

See [e宝工坊 Releases](https://github.com/cqai-club/ebao-studio/releases) for installers.

This repository uses the [MIT License](LICENSE). Report repository issues through [e宝工坊 Issues](https://github.com/cqai-club/ebao-studio/issues).
