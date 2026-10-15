# Community Market shell

[中文说明](market-shell.zh.md)

Status: delivered and built into 易宝工坊.

## Ownership

`dsh-community-market` owns catalog-source settings, source adapters, normalized discovery, the Market Client surface, npm latest preview, plugin update checks and notices, and Profile package-operation orchestration. It does not own Profile storage, pnpm execution, recovery checkpoints, terminal windows, or restart implementation. Update checks and execution use its own services and do not depend on DSH Market.

## Runtime shape

```text
catalog source -> Host adapter -> normalized catalog -> Market Client
                                      |
                                      +-> npm latest preview

Desktop Profile inventory -> Installed view -> opaque bundleId -> uninstall preview -> pnpm remove
                                      |
                                      +-> installed version + npm latest -> update notice
                                                                          |
                                                                          +-> confirmed update preview -> exact pnpm add
```

The Client receives normalized data and opaque operation identities. It never receives a package-manager capability.

## Source behavior

Standard cursor-based sources and dshfind are scanned into a bounded local index. Search, category filters, and visible pagination use that index.

DSH 1024Store discovery uses the provider's current paginated v2 API for every query, including the unfiltered directory. Single-category filters are forwarded directly. Multi-category OR filters merge bounded provider-ranked prefixes and retain an opaque local cursor. Installable requests 200 remote registry entries per batch and keeps only direct npm targets from that page; the Client requests the next opaque cursor instead of materializing the complete directory in the Host or Renderer.

Provider commands are discarded. The reviewed 1024Store adapter may parse one exact inert command shape solely to recover an npm package name; it never forwards or executes that command. A source can supply catalog identity but cannot supply executable argv, credentials, adapter code, source selection, or install authority.

## Install behavior

An installable catalog entry contributes only one npm package identity. Install preview resolves npm's official `latest` manifest and requires:

- matching npm package name;
- exact stable version; and
- valid `dsh.bundle.patch`.

The preview binds these facts, the observed catalog item, and the active Profile to a short-lived one-shot token. Execution calls only `desktopPnpm.run(argv)`, saves the exact version, and reconciles `dsh.profile.bundles`.

There are no Market receipts or install-specific protection and recovery paths. Source version, repository matching, lifecycle scripts, deprecation, engine ranges, and provider verification badges do not gate installation.

## Installed inventory, updates, and uninstall

Desktop inventory reads direct Profile dependencies and bundles. It therefore includes plugins installed by this Market, other markets, and the DSH CLI. Product-owned bundles are read-only. Other direct plugin dependencies receive an opaque generation-scoped `bundleId` and offer uninstall. Eligible mutable direct npm bundles also offer updates.

The Client starts a check after startup and repeats it every 30 minutes. Normal checks use a bounded Host cache; the Market's manual check refreshes it. The Host derives npm targets from current inventory and compares actual installed versions with the official npm registry's stable `latest` versions using semver. Core bundles, local or Git sources, unknown installed versions, downgrades, and prereleases cannot become update targets. Unknown installed versions produce an explicit check error. Failed checks remain distinct from successful up-to-date results.

An update preview binds the active Profile, package, and exact old and new versions to a short-lived one-shot token. The Host rechecks these facts before execution, adds the exact target version through `desktopPnpm.run(argv)`, preserves the bundle reference and configuration, and verifies the resulting installed version. Updates are serialized with other package operations and require an explicit confirmation and restart.

The Client offers single-package and all-package review. **Update all** runs individual updates in sequence and stops at the first failure; it is not atomic. Successful items remain installed. The result lists successful, failed, and remaining unattempted packages, with another review required before retrying the remaining items.

The Host resolves `bundleId` immediately before preview and rechecks the direct dependency before execution. Uninstall uses `desktopPnpm.run(['remove', packageName])` and removes the bundle reference. The Market does not expose enable or disable.

## Failure boundary

Browsing remains available when Desktop package capabilities are absent. A source failure never blocks Desktop startup. Installation and uninstallation errors do not trigger automatic cleanup or rollback.

When an update fails, the Host attempts to reinstall the previous exact version while retaining the bundle reference and configuration. It reports the update failure even if restoration succeeds. If restoration also fails, the message directs the user to Desktop's three healthy-start Profile checkpoints. Checkpoint restoration remains an explicit Recovery-page action.

## Headless requirements

Contract generation, type checking, unit tests, package builds, export verification, and Loader smoke tests must remain headless-safe. Tests must not launch Electron or a graphical application.
