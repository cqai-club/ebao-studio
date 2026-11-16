# e宝工坊: official Desktop baseline

[中文](README.md) · [Documentation](docs/README.en.md) · [Contributing](CONTRIBUTING.en.md)

This repository now runs [the official DeepSeek Harness Desktop](deepseek-harness/apps/desktop/README.md) directly. The application uses the official interface, identity, login, and plugin manager. The former Stable, Beta, and Next shells based on `anywhere-labs/dsh-desktop` have been retired from the active build.

This change establishes a pure official Desktop baseline first. CQAI accounts, e图宝, e剪宝, Publisher, e研宝, AA remote control, custom markets, themes, and other product capabilities have not been reconnected. Retaining their plugin source does not activate them.

The unmodified official Git submodule is pinned to `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159` (`0.2.2-rc.1`). This repository is maintained by e宝工坊 independently of DeepSeek; see [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) for its technical origin.

## Run from source

Use Node.js `>=24.9.0`, Git, and Corepack. The outer command entry uses Yarn `4.18.0`; the official submodule retains its own pinned pnpm release.

```bash
corepack yarn upstream:init
corepack yarn install --immutable
corepack yarn upstream:install
corepack yarn upstream:prepare-electron
corepack yarn build
corepack yarn dev
```

In Windows Git Bash, replace `corepack` with `corepack.cmd` if needed. Initial installation, downloading Electron, or preparing the official bundled runtime requires network access. pnpm dependency installation does not download Electron; complete `upstream:prepare-electron` before launch or headless Desktop tests. `dev` opens a graphical application.

The root launcher defaults to separate `.official-desktop/home` and `.official-desktop/electron-user-data` directories for official Harness state and Electron browser data. Existing e宝 accounts, sessions, works, and installed-application data remain in their original locations; this change does not migrate them automatically.

## Common commands

| Repository-root command | Purpose |
| --- | --- |
| `corepack yarn dev` | Build and launch official Desktop |
| `corepack yarn start` | Launch official Desktop using existing build output |
| `corepack yarn build` | Run official `build:artifacts` |
| `corepack yarn typecheck` | Check the official Desktop TypeScript project |
| `corepack yarn test` | Run outer launcher tests and official Desktop tests |
| `corepack yarn check` | Check repository layout, launcher, official artifacts, Desktop types, and tests |

The root scripts invoke the official pnpm workspace. They do not install or build outer business plugins by default. Consult the root scripts for the exact gate composition; graphical execution and platform installer acceptance are recorded separately.

## Layout and future integrations

| Directory | Current purpose |
| --- | --- |
| `deepseek-harness/` | Unmodified official source and Desktop implementation; the only active application source |
| `scripts/` | Outer command delegation, data isolation, and repository validation |
| `.official-desktop/` | Local official development state, ignored by Git |
| `cqai-dsh-plugins/` | Preserved CQAI business-plugin source awaiting adaptation |
| `dsh-community-market/`, `dsh-community-fabric/` | Preserved market source and interoperability documents, excluded from the active build |
| `matrixmedia-publisher/` | Preserved Publisher submodule, excluded from official Desktop startup |

Future product capabilities require separate changes using official extension interfaces, with account, data, and native-function verification. Do not reuse old Profiles, lockfiles, or `node_modules` as the official Desktop executable dependency graph.

## Documentation and release status

The current workflow runs official Desktop from source. It does not represent a new published e宝 installer. Root `package:dir`, `dist:mac:arm64`, `dist:mac:x64`, and `dist:win` only delegate to unsigned official packaging; they do not upload or publish artifacts. The [pinned upstream reference](deepseek-harness/apps/desktop/README.md) owns official Desktop behavior, development, and packaging. See the [development guide](docs/development-release.en.md) for outer entry points and verification.

[Historical e宝 Releases](https://github.com/cqai-club/ebao-studio/releases) and the retained user guides, screenshots, and architecture documents describe the previous product. They do not establish the current official baseline's capabilities or installation procedure.

This repository uses the [MIT License](LICENSE). Report repository issues through [e宝工坊 Issues](https://github.com/cqai-club/ebao-studio/issues).
