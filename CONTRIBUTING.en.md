# Contributing

[中文](CONTRIBUTING.md)

The current development target is the pinned official DeepSeek Harness Desktop. Read the [repository entry](README.en.md) and [current development guide](docs/development-release.en.md) before making changes.

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

Run `corepack yarn dev` or `corepack yarn start` only when opening a graphical application is intended. Development state defaults to `.official-desktop/`, isolated from existing e宝 user data.

## Change boundaries

- The official application lives in the read-only `deepseek-harness/` submodule. Update its pin and owning metadata in a separate commit; do not edit official source on a product branch.
- Outer Yarn owns command delegation and repository boundaries. Official dependencies stay in the pinned pnpm workspace. The outer repository currently has no active application or business-plugin workspaces.
- `cqai-dsh-plugins/`, market/Fabric source, and `matrixmedia-publisher/` are retained for later integration. The current default build and feature acceptance exclude them. A later integration should describe extension interfaces, dependencies, user data, and verification scope explicitly.
- Builds, type checks, and tests remain headless-safe. Record application launch, login, and native installer acceptance separately.
- Preserve accounts, sessions, attachments, works, and historical application data. User-data migration requires an explicit implementation and verification.

The [official Desktop baseline Agent Note](.agents/notes/implemented/process/2026-11-16-official-desktop-baseline.md) owns the current topology. Stable/Beta mirroring, AA/Market preparation, and e宝 release instructions belong to the historical workflow.

## Commits and feedback

Use conventional commits such as `fix(launcher): ...` or `docs: ...`. PRs should explain concrete behavior, motivation, verification results, and any remaining acceptance work. A local build is not a published release. Update both languages and Git blob hashes for recorded bilingual documents.

Report repository issues through [e宝工坊 Issues](https://github.com/cqai-club/ebao-studio/issues), including the operating system, pinned upstream version, and reproduction steps. Follow the [code of conduct](CODE_OF_CONDUCT.en.md).
