<p align="center">
  <img src="assets/desktop-hero-en.png" alt="e宝工坊 desktop app" width="100%">
</p>

# e宝工坊

[中文](README.md) · [Download](https://github.com/cqai-club/ebao-studio/releases) · [User guide](docs/user-guide.en.md)

e宝工坊 is an open-source desktop app for Windows and macOS built around [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It brings the upstream local Web client, Host service, and plugin system into a native window, with a system tray, Profile management, a terminal, recovery, and plugin management. Installed builds include the required runtime.

This repository pins an **unmodified upstream** version. Repository-owned plugins and an Electron launcher compose the desktop features around it. The project is maintained independently by the community and is not affiliated with or endorsed by DeepSeek or the official upstream team.

<p align="center">
  <img src="assets/desktop-chat-en.png" alt="e宝工坊 chat interface screenshot" width="100%">
</p>

## Use

Choose a build from [Releases](https://github.com/cqai-club/ebao-studio/releases). Check its Release page for supported platforms and installation notes. For first-run steps, Profiles, plugins, and updates, see the [user guide](docs/user-guide.en.md) and [FAQ](docs/faq.en.md).

- **Desktop experience:** Start and manage DSH locally, with a native window, tray, browser access, and terminal.
- **Work Profiles:** Compose plugins and settings per Profile, with startup recovery for configuration problems.
- **Plugin extensions:** Extend the app through [DSH Community Market](dsh-community-market/README.md) and repository plugins; see the [plugin development guide](docs/plugin-development.en.md).

## Develop from source

Use Node.js `^22.19.0` or `>=24.0.0`, Git, and Corepack. This repository uses Yarn `4.18.0`. From the **repository root**, initialize the pinned upstream submodule and install dependencies:

```bash
git submodule update --init --recursive
corepack.cmd yarn install --immutable
```

`corepack.cmd` is for Windows Git Bash. Use `corepack yarn` in PowerShell, macOS, or Linux.

### Start Stable

```bash
corepack.cmd yarn dev
```

### Start Beta (Windows Git Bash)

To keep its Profiles separate from an installed Stable app, use the existing `~/.dsh-beta` home:

```bash
export DSH_HOME="$(cygpath -w "$HOME/.dsh-beta")"
corepack.cmd yarn dev:beta
```

`DSH_HOME` selects the DSH data directory, including Profiles and sessions; installed Stable defaults to `~/.dsh`. A data-directory choice previously saved by Beta in its own app data takes precedence over this environment variable. To **also isolate development from an installed Beta**, give it separate DSH and Electron user-data directories:

```bash
mkdir -p "$HOME/.dsh-beta-dev" "$HOME/.ebao-beta-dev-user-data"
export DSH_HOME="$(cygpath -w "$HOME/.dsh-beta-dev")"
export DSH_DESKTOP_DEV_USER_DATA="$(cygpath -w "$HOME/.ebao-beta-dev-user-data")"
corepack.cmd yarn dev:beta
```

In PowerShell, set `$env:DSH_HOME = Join-Path $HOME '.dsh-beta'` and run `corepack yarn dev:beta`. On macOS or Linux, use `DSH_HOME="$HOME/.dsh-beta" corepack yarn dev:beta`.

`dev` and `dev:beta` prepare Market, Agents Anywhere, and plugin dependencies. They may access the network and update generated artifacts or the lockfile. Review working-tree changes before committing.

### Checks and layout

```bash
corepack.cmd yarn check
corepack.cmd yarn check:desktop-variants
```

`check` runs the full headless gate. After shared Stable/Beta desktop changes, `check:desktop-variants` verifies both editions. Launch the experimental Next shell separately with `corepack.cmd yarn dev:next`.

| Directory | Purpose |
| --- | --- |
| `dsh-plugin-desktop-beta/`, `dsh-plugin-desktop/` | Beta and Stable desktop implementations |
| `dsh-desktop-next/` | Separate experimental Next desktop shell |
| `dsh-community-market/`, `cqai-dsh-plugins/` | Market and product plugins |
| `deepseek-harness/` | Pinned upstream submodule; do not edit it for desktop features |

See the [documentation index](docs/README.en.md), [architecture](docs/architecture.en.md), and [contribution guide](CONTRIBUTING.en.md). The upstream submodule has its own pnpm workspace; run upstream operations through the repository-root `upstream:*` scripts.

## Community and license

Send feedback through [GitHub Issues](https://github.com/cqai-club/ebao-studio/issues).

This project uses the [MIT License](LICENSE). “DeepSeek Harness” is mentioned only to describe technical origin and compatibility.
