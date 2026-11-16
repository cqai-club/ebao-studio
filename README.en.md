# e宝工坊: official Desktop with CQAI sign-in

[中文](README.md) · [Documentation](docs/README.en.md) · [Contributing](CONTRIBUTING.en.md)

This repository runs [the official DeepSeek Harness Desktop](deepseek-harness/apps/desktop/README.md), composing CQAI accounts through its external Desktop Profile. The native UI, identity, and plugin manager retain their upstream implementation. The former community Stable, Beta, and Next shells have been removed; official tracked source is not patched.

The default sign-in button opens CQAI browser authorization, after which the account plugin provides CQAI models. A recommended CQAI model replaces only the untouched factory default; existing model and reasoning choices remain. The optional Add API Key entry still belongs to the official provider: a CQAI login credential is not a DeepSeek API key.

Only the account service and account-provider adapter are active. The CQAI frontend, e图宝, e剪宝, Publisher, e研宝, AA, custom markets, and themes are not loaded. CQAI monetary balances are not mapped into the official balance UI, which reports unavailable; this does not establish the account's actual quota.

The official Git submodule is pinned to `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159` (`0.2.2-rc.1`). e宝工坊 maintains this repository independently of DeepSeek, without affiliation or endorsement.

## Run from source

Use Node.js `>=24.9.0`, Git, Corepack, and root Yarn `4.18.0`. The official submodule retains its own pnpm release.

```bash
corepack yarn upstream:init
corepack yarn install --immutable
corepack yarn upstream:install
corepack yarn upstream:prepare-electron
corepack yarn build
corepack yarn start
```

`dev` rebuilds and opens the graphical application; `start` uses existing official artifacts. Both prepare the CQAI external Profile first. Initial dependency, Electron, and bundled-runtime preparation may require network access. Windows Git Bash can use `corepack.cmd` instead of `corepack`.

Local state defaults to `.official-desktop/home` and `.official-desktop/electron-user-data`. Existing `~/.dsh`, `~/.dsh-beta`, accounts, sessions, works, and browser data remain in place; old credentials and dependencies are not migrated automatically. Users complete real authorization on CQAI's browser page; passing unit tests does not complete user authorization.

## Common commands

| Repository-root command | Purpose |
| --- | --- |
| `corepack yarn dev` / `start` | Prepare the CQAI Profile and launch official Desktop |
| `corepack yarn build` | Build official artifacts and owned account packages |
| `corepack yarn typecheck` | Check official Desktop types |
| `corepack yarn cqai:build` | Build account and adapter artifacts without modifying a Profile |
| `corepack yarn cqai:prepare` | Build and install into the isolated official Desktop Profile |
| `corepack yarn cqai:typecheck` / `cqai:test` | Check the account and provider adapter |
| `corepack yarn test` | Run launcher, account, and official Desktop tests |
| `corepack yarn check` | Combine layout, build, type, and headless test checks |

Outer Yarn owns command entry points without including the official pnpm workspace in its dependency graph. Account integration uses a standard external Profile installation; other business source stays outside the default build. See the [account adapter reference](integrations/cqai-desktop-account/README.md) and [development guide](docs/development-release.en.md) for implementation and verification boundaries.

## Layout and future integrations

| Directory | Current purpose |
| --- | --- |
| `deepseek-harness/` | Unmodified official source and the only Desktop application implementation |
| `integrations/cqai-desktop-account/` | Adapter between official account interfaces and the CQAI service |
| `cqai-dsh-plugins/cqai-dsh-plugin-account/` | Active Host account, OIDC, and model-service source |
| `.official-desktop/` | Isolated local state and generated account packages, ignored by Git |
| Other CQAI plugins, Community Market/Fabric, and MatrixMedia | Inactive material for later integrations |

## Release status

CQAI sign-in currently applies to **source startup**. Root `package:dir`, `dist:mac:arm64`, `dist:mac:x64`, and `dist:win` still perform unsigned pure-official packaging and **do not bundle the CQAI provider**. Product packaging, identity, updates, and release support require a separate follow-up; this change does not upload or publish a new e宝 installer.

[Historical e宝 Releases](https://github.com/cqai-club/ebao-studio/releases), screenshots, and user guides describe the previous product. See the [pinned upstream reference](deepseek-harness/apps/desktop/README.md) for official behavior and packaging. This repository uses the [MIT License](LICENSE); report issues through [e宝工坊 Issues](https://github.com/cqai-club/ebao-studio/issues).
