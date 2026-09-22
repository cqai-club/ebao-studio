# 易宝工坊 FAQ

[中文](faq.md)

This page answers common questions about installation, supported platforms, the bundled runtime, and plugins in the current release. The [eBao Studio GitHub Releases](https://github.com/cqai-club/ebao-studio/releases) and [user guide](user-guide.en.md) define the shipped product scope.

## What is 易宝工坊?

易宝工坊 is an open-source DeepSeek Harness desktop client for Windows and macOS. It packages the official Harness local Web UI, Host service, and plugin system into a native desktop application with a window, system tray, terminal, updates, and profile management.

## Is this an official DeepSeek product?

No. 易宝工坊 is an independent, community-maintained open-source project. It is not affiliated with or endorsed by DeepSeek. The name only describes its technical relationship with the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

## Which operating systems are supported?

Current prerelease artifacts support Windows x64 and universal macOS (Intel and Apple Silicon). `v0.0.3` is an explicitly **unsigned macOS test release**: testers must deliberately download it and approve Gatekeeper manually before opening it. It is not a production macOS auto-update package. Windows artifacts are not yet Authenticode-signed and may show a SmartScreen warning. There is currently no Linux installer.

## Do I need to install Node.js, pnpm, or DSH?

No. The installer includes Electron, Node.js, pnpm, and pinned DSH dependencies. Ordinary users can install and launch directly, and Desktop does not modify the global system PATH or user shell configuration.

## Does the first launch download a runtime?

No separate Node.js or Harness core download is required. The installer is larger because it contains the runtime and pinned dependencies, trading download size for a more deterministic first launch and dependency set. Cloud models, update checks, and new-version downloads still require network access.

## Does 易宝工坊 modify official Harness?

No. The repository pins an unmodified official Harness checkout. Compatibility mode runs the upstream default Web client below an independent overlay frame. Extended and enhanced modes each install their own Desktop-owned root registration through the plugin/profile composition boundary while retaining the official slot occupants. None of these modes edits upstream source.

## Is data stored locally?

The Desktop Host, profiles, and DSH home live on the local machine. Whether content is sent to an external service depends on the model or tool providers the user configures; requests to cloud models still go to those providers.

## Can I install DSH plugins?

Yes. 易宝工坊 uses the official Harness plugin system. Open DSH Terminal from the tray and run `dsh plugin add`, `dsh plugin remove`, or `dsh plugin update`. These commands default to the active profile, and Desktop must be restarted after plugin changes.

## Does the Desktop profile automatically sync with an existing web profile?

No plugins are copied automatically. Each profile has its own bundle and dependency composition. After switching profiles, default plugin commands target the active profile; `--profile <name>` can always select one explicitly.

## How are updates installed?

Packaged stable applications check for releases in the background but never install silently. A newer version requires confirmation. After confirmation, Electron Updater stages a verified Windows NSIS installer or macOS ZIP in its private cache, without a save-location dialog, opened DMG, or manual installer handoff. When staging completes, select **Restart and Update** to apply and reopen; choosing later leaves the current version running. Network, metadata, download, cancellation, or installation failures leave the current installation intact and can be retried. macOS automatic updates require the official Developer ID-signed and notarized build. The unsigned `v0.0.3` macOS test release is intentionally excluded from that production claim: download and open its DMG manually, then approve Gatekeeper only if you are an authorized tester.

## Where can I download the app or report a problem?

Download from the [eBao Studio GitHub Releases](https://github.com/cqai-club/ebao-studio/releases). Check the [troubleshooting section](user-guide.en.md#troubleshooting) first. If the problem remains, open a [GitHub Issue](https://github.com/cqai-club/ebao-studio/issues/new/choose) with the operating system, app version, reproduction steps, and error details.
