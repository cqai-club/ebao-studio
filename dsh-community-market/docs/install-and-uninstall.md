# Install, update, and uninstall

[中文说明](install-and-uninstall.zh.md)

This guide describes the package-operation boundary used by DSH Community Market.

## Views

| View | Source of truth | Available operations |
| --- | --- | --- |
| Discover | Normalized selected catalog source | Browse details and request install preview |
| Installable | Catalog entries with one npm package identity | Request install preview |
| Installed | Active Profile direct dependencies and bundle list | Uninstall removable dependencies; core bundles are read-only |
| Updates | Actual installed npm bundle versions and npm stable latest | Check versions; review and confirm single or all-package updates |
| Sources | User-owned catalog source settings | Add, select, order, and remove sources |

Installed state is independent of the selected catalog and of which market performed the installation.

## Install flow

1. The user selects a catalog item. The Renderer sends only `sourceRecordId` and `itemId`.
2. The Host resolves the normalized npm package identity it previously observed.
3. The Host requests `https://registry.npmjs.org/<package>/latest` and requires the same package name, an exact stable version, and a valid `dsh.bundle.patch` declaration.
4. The confirmation shows the package, exact version, current Profile, and preview expiry.
5. On confirmation, the Host consumes the one-shot `previewId` and calls `desktopPnpm.run()` with Host-owned argv for an exact `pnpm add`.
6. The Host reconciles the package into `dsh.profile.bundles` and confirms that it is now a direct Profile dependency.

The source's listed version is never used as the install target. Repository equality, deprecation metadata, lifecycle scripts, engine ranges, integrity metadata, and provider verification flags do not block the operation. Provider command strings are discarded.

Market installation creates no receipt, checkpoint, retry, cleanup, or rollback operation. Desktop's ordinary Profile checkpoints cover the resulting state.

## Automatic-install conditions

A catalog entry can reach automatic install preview only when:

- exactly one valid npm package name is normalized from the entry;
- the package is not a Desktop-owned product bundle;
- npm `latest` is an exact stable version for that same package; and
- the npm manifest declares a safe relative DSH bundle patch path.

Failure keeps the item browseable and may expose a display-only manual command.

## Update checks

The Client checks for updates after startup and every 30 minutes. The Market's **Check for updates** action forces a fresh registry check; ordinary checks use a bounded Host cache. Available updates show an installed-version → latest-version comparison and a notice. Failed registry checks are shown separately from successful up-to-date results.

The Host resolves targets from the current Desktop inventory instead of trusting a package name or version supplied by the Renderer or a catalog. A target must be a mutable direct npm plugin bundle with a verifiable actual installed version. Product-owned core bundles and local or Git dependencies are skipped; unknown installed versions produce a check error and cannot be updated. npm's official `latest` manifest must identify the same package, an exact stable version, and a safe `dsh.bundle.patch` path. Semver comparison allows only a newer stable version, never a downgrade or prerelease.

Checks are independent of the active catalog and of the market that originally installed a plugin. They use Community Market's own services without depending on DSH Market.

## Update flow

1. The Renderer submits the current inventory's opaque `bundleId` for each selected update.
2. The Host resolves the direct npm bundle, reads its actual installed version, and resolves the registry's stable `latest` version.
3. The Host rejects a target with a known incompatible installed official DSH peer. A short-lived one-shot preview binds the active Profile, package, and exact installed and target versions. The confirmation displays the old and new versions.
4. The user confirms a single update or **Update all**. Checks and notices alone never start a package mutation.
5. Immediately before execution, the Host rechecks the Profile, direct dependency, bundle, and installed version. It consumes the preview and uses Host-owned argv for an exact `desktopPnpm.run()` add operation.
6. The Host retains the bundle reference and configuration and verifies the new installed version. The user explicitly restarts to load the updated plugin.

Package operations are mutually exclusive. **Update all** runs individual updates in sequence and stops at the first failure; it is not an atomic transaction. Earlier successes remain installed. The result lists successful, failed, and remaining unattempted packages, and failed or unattempted items can be reviewed and retried.

If an update fails, the Host attempts to reinstall the old exact version while preserving the bundle reference and configuration. If restoration succeeds, the old version remains available and the original update error is reported. If restoration also fails, the error directs the user to an explicit Desktop Recovery checkpoint restore. This recovery is specific to updates; installation does not gain a rollback path.

## Uninstall flow

1. Desktop reads the active Profile's `dependencies` and `dsh.profile.bundles`.
2. Each direct bundle receives a generation-scoped opaque `bundleId`. Product-owned bundles are read-only; other direct dependencies are removable.
3. The Renderer submits only that `bundleId`.
4. The Host resolves it again against current inventory, verifies that the package is still a direct dependency, and returns a one-shot confirmation.
5. On confirmation, the Host calls `desktopPnpm.run(['remove', packageName])`, removes the bundle entry, and confirms that the Profile no longer references the package.

This flow applies equally to plugins installed by Community Market, another plugin market, or the DSH CLI. Market offers no enable or disable action.

## Manual fallback

If automatic preview is unavailable, the Host may construct a bounded display-only npm command from normalized identity. **Open DSH Terminal** opens the terminal only; it sends no package command, path, or Profile and performs no mutation.

## Failure behavior

| Failure | Result |
| --- | --- |
| npm latest cannot be resolved or is not a stable DSH plugin | No package operation starts |
| Profile changes after preview | The one-shot preview is rejected |
| Installation or uninstallation fails | The error is reported; Market performs no automatic cleanup or rollback |
| Installation Profile reconciliation fails after pnpm | The error is reported for diagnosis or explicit Recovery checkpoint restore |
| Update fails | The Host attempts to restore the old exact version and reports the failed item |
| Update restoration also fails | The error reports the restoration failure and directs the user to Desktop Recovery |
| One item in Update all fails | The batch stops; successful items remain installed, and failed and unattempted items are listed for review and retry |
| Renderer closes after confirmation | The Host-owned package operation continues; only the response may be lost |

For a pnpm process failure, the Host retains only a bounded tail of stdout and stderr. It records that diagnostic in the Desktop log and returns it to the local failure dialog. The dialog shows the verified package command and can open DSH Terminal, but never pastes, executes, or silently retries it.
After a successful mutation, the user may restart now or later. Restart is never silent.
