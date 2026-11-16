# e宝工坊 documentation

[中文](README.md) · [Repository entry](../README.en.md)

The application builds on the pinned official Desktop with CQAI accounts and a local e宝 welcome overlay. The main workspace and Dock/application menus retain official identity; other business plugins remain inactive. Former community Desktop documents are historical references.

## Current entry points

| Document | Scope |
| --- | --- |
| [Official Desktop reference](../deepseek-harness/apps/desktop/README.md) | Current Desktop behavior, development, packaging, plugins, and local settings |
| [Current development and release boundaries](development-release.en.md) | Root Yarn commands, official pnpm delegation, isolated data, and verification |
| [Contributing](../CONTRIBUTING.en.md) | Source ownership, submissions, and feedback |
| [CQAI account adapter](../integrations/cqai-desktop-account/README.md) | Official account interfaces, real CQAI sign-in, and credential boundaries |
| [Local welcome overlay](../integrations/ebao-desktop-welcome/README.md) | e宝 welcome branding, official component reuse, and build order |
| [Account and welcome ownership decision](../.agents/notes/implemented/architecture/2026-11-16-cqai-official-desktop-account.md) | Current implementation, data, and verification boundaries |
| [Official Desktop baseline decision](../.agents/notes/implemented/process/2026-11-16-official-desktop-baseline.md) | Prerequisite pure-official cutover history and read-only upstream boundary |

## Historical product references

The following documents describe the previous e宝/community Desktop design or usage. Their features, commands, Profile layout, plugin services, and release workflow do not apply to the current official baseline. Old paths into removed Desktop packages may also be unavailable.

| Historical document | Former scope |
| --- | --- |
| [Previous user guide](user-guide.en.md), [previous FAQ](faq.en.md) | Former installers, Profiles, plugins, modes, and updates |
| [Previous architecture](architecture.en.md), [Why Desktop](why-desktop.en.md) | Community shell and native-adapter design |
| [Previous plugin development guide](plugin-development.en.md), [plugin ecosystem manifesto](plugin-ecosystem.en.md) | Former Desktop services and community ecosystem design |
| [CQAI extension notes](cqai/README.md) | Business plugins awaiting reconnection |
| [Community Market source and documents](../dsh-community-market/README.md) | Preserved market implementation, currently inactive |
| [Community Fabric documents](../dsh-community-fabric/README.md) | Preserved interoperability proposals, excluded from the active build |
| [Historical e宝 releases](https://github.com/cqai-club/ebao-studio/releases) | Previously published installers and version notes |

Root `README.md` and `README.en.md` are the current Chinese and English entry points; `README.zh.md` preserves a legacy link. Dated Agent Notes provide decision history, with current decisions superseding retired topology descriptions. Official submodule documents own its implementation; outer documents own launch entry points and integration boundaries.
