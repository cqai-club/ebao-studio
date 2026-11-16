# Agent Note: Run the official Desktop as the only active baseline

Status: implemented

English | [中文](2026-11-16-official-desktop-baseline.zh.md)

## Decision and scope

Run the unmodified official DeepSeek Harness Desktop directly before reconnecting e宝 accounts and business capabilities. The official `deepseek-harness/apps/desktop` implementation is the only active desktop application. The source pin remains `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159` (`0.2.2-rc.1`).

This decision supersedes the active community-channel topology described by [the pinned-upstream and isolated-Yarn note](2026-08-15-pinned-upstream-and-isolated-yarn-workspace.md). Its read-only upstream and package-manager boundary remain: the official checkout is a pinned Git submodule with its own pnpm workspace; root Yarn is an outer command wrapper. The former Stable/Beta mirror, Next shell, shared community desktop controls, and their Profile composition no longer define the active application.

## Ownership

Root build, typecheck, test, check, dev, and start commands delegate to the official pnpm workflow, with outer launcher and layout checks. Build targets official artifacts, type checking targets the Desktop project, and tests cover the launcher and official Desktop tests. The outer repository has no active application or plugin workspaces. Build and verification remain headless-safe; dev/start explicitly open the graphical application.

The root launcher defaults to `.official-desktop/home` and `.official-desktop/electron-user-data`. Existing e宝 homes, accounts, sessions, attachments, works, and browser data remain untouched. Official executable dependencies and its `desktop` Profile are not composed by reusing a former e宝 lockfile or dependency tree.

CQAI plugin source, Community Market/Fabric source, and the MatrixMedia Publisher submodule are preserved as inactive integration material. The default workflow does not install, build, load, or promise their capabilities. In particular, account and Publisher code currently relies on private `desktopRuntime` services that the official shell does not provide. Reconnecting it needs a separate adapter design and validation.

The application retains official identity and behavior. This change is not a new e宝 release, installer, or automatic migration. Historical e宝 Releases, screenshots, guides, and earlier Agent Notes remain records of the former product. Current README and documentation indexes identify them as historical.

## Verification boundary

Validate the outer delegation, pinned-source cleanliness, data-directory defaults, inactive-source boundary, and bilingual documentation records. Run the available official build, typecheck, and test gates through the root entry; record the commands actually completed and their outcomes in the change report. Graphical application startup, account login, native installation, signing, and publication need their own evidence and are not implied by headless results.

## Future integration

Keep later product integrations independently reviewable. Use official plugin interfaces where available and give native/Host adapters explicit ownership where needed. Preserve the unmodified upstream checkout. Restoring e宝 branding, business features, distribution, or user-data migration requires a deliberate subsequent change rather than silently restoring a community desktop shell.
