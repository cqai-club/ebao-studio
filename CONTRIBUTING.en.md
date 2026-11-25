# Contributing

[中文](CONTRIBUTING.md)

This repository maintains the build and launch entry points for the pinned official DeepSeek Harness Desktop. Read the [repository entry](README.en.md) and [development guide](docs/development-release.en.md) before making changes.

## Development environment

Use Node.js `>=24.9.0`, Corepack, and root Yarn `4.18.0`:

```bash
corepack yarn upstream:init
corepack yarn install --immutable
corepack yarn upstream:install
corepack yarn upstream:prepare-electron
corepack yarn build
corepack yarn typecheck
corepack yarn test
corepack yarn check
```

`corepack yarn dev` builds and launches the graphical application. `corepack yarn start` launches existing build output. Development state defaults to `.official-desktop/official/`, isolated from existing e宝 user data.

## Change boundaries

- The official application lives in the read-only `deepseek-harness/` submodule. Update its pin and owning metadata in a separate commit; do not edit official source on a product branch.
- Outer Yarn owns command delegation and repository boundaries. Official dependencies stay in the pinned pnpm workspace. The outer repository currently has no active application or business-plugin workspaces.
- Official Desktop owns the welcome page, sign-in, and plugin management. The CQAI account integration, e宝 welcome overlay, business plugins, market/Fabric, and MatrixMedia are retained as historical source.
- Builds, type checks, and tests remain headless-safe. Record application launch, login, and native installer acceptance separately.
- Preserve accounts, sessions, attachments, works, and historical application data. User-data migration requires an explicit implementation and verification.

The [official Desktop baseline decision](.agents/notes/implemented/process/2026-11-16-official-desktop-baseline.md) records the upstream source and package-manager boundaries.

## Commits and feedback

Use conventional commits such as `fix(launcher): ...` or `docs: ...`. PRs should explain concrete behavior, motivation, verification results, and any remaining acceptance work. A local build is not a published release. Update both languages and Git blob hashes for recorded bilingual documents.

Report repository issues through [e宝工坊 Issues](https://github.com/cqai-club/ebao-studio/issues), including the operating system, pinned upstream version, and reproduction steps. Follow the [code of conduct](CODE_OF_CONDUCT.en.md).
