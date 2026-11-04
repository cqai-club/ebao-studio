# Agent Note: Modern Desktop channels and private shared source

Status: implemented

English | [中文](2026-11-04-modern-desktop-channels.zh.md)

## Decision

The product follows the modern isolated Host architecture from `anywhere-labs/dsh-desktop` commit `117e4899132553b230cafd902d78c0f8f0020132`. The user explicitly selected migrating both Stable and Beta to this architecture. Stable and Beta still mirror their owned source, apart from declared product identities. Next remains a separate experimental channel.

All three application channels use the official Harness source and runtime built from `8bd073392eef6f54e921a093b95076248eb08cbb`, version `0.2.2-alpha.3`. The source remains an unmodified Git submodule. Its pin was committed independently before desktop integration. The official build and pack commands generated the vendored artifacts; their manifest records the actual source commit and checksums. Desktop compatibility changes remain versioned outer-repository patches.

The newer shell still uses native controls and utilities from the former Stable implementation. Those imports now target the private `dsh-desktop-shared` workspace instead of importing implementation from a different release channel. Shared has no application entrypoint, package exports or DSH bundle declaration. Its compile-time dependencies follow the same official runtime family as the application channels. It is not added to user Profile bundles or production application dependencies.

## Product capabilities

Stable and Beta compose the existing CQAI account, image, publishing, market and presentation capabilities as application-owned layers. Recomposition preserves them during Profile operations and HMR without persisting shell entries in the user's manifest. Safe mode omits the product capabilities. The modern official frontend owns the main interface; the former advanced-mode presentation remains conditional on its legacy mode.

A narrow Host-to-main bridge provides the CQAI account and Publisher services required by those layers. Publisher worker methods remain allowlisted, native video selection returns opaque handles, cancellation follows Host disposal, and the worker is stopped during application shutdown. Shared source retains the existing Publisher supervisor rather than introducing a second worker protocol.

## Verification

The official Harness build must pass before packing runtime artifacts. Acceptance also requires an immutable root install, runtime provenance and patch replay checks, the Stable/Beta source mirror gate, the owned package headless checks, and a separate explicit graphical launch. A successful headless check does not qualify an installer or real-account publishing flow.

## Consequences

Node 24.9 or newer is required by the current official runtime. The root Yarn and upstream pnpm boundaries remain unchanged. Future shared control changes belong in `dsh-desktop-shared`; application behavior remains in the corresponding modern shell. Do not restore cross-channel implementation imports or turn shared source into a loadable plugin.
