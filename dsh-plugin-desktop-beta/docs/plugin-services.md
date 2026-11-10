# Modern Desktop plugin services

English | [中文](plugin-services.zh.md)

Stable and Beta now use the independent Host architecture. The old desktop Cordis plugin's full native runtime API is not a public extension contract. Shared legacy source is implementation support in `dsh-desktop-shared`, not a second running shell.

The application capability bundle provides:

- `desktopProfiles.current`: the active Profile name and directory.
- `desktopPnpm`: an owned, cancellable package runner using the selected Profile and bundled pnpm. Official plugin operations retain their normal reconciliation behavior.
- `desktopPermissions`: a private Host-to-main bridge for named operating-system permission operations.
- `desktopActions`: restart and supported terminal actions.
- `desktopRuntime`: the e宝工坊 internal account and Publisher adapter; it is not a general native-code or filesystem API.

The account adapter opens HTTPS destinations and loopback HTTP development callbacks and can focus the application. Publisher requests accept only named Worker operations, enforce a bounded IPC envelope, propagate cancellation and stop on Host disposal. Native-selected video files remain in main; consumers receive an opaque ID and bounded base64 chunks.

Renderer code receives no Node or Electron capability. Existing feature plugins register through the official Web client loader and documented slots. Recovery, Profile selection and data-directory controls remain available when the feature Host fails.

Product bundles are application-owned Profile layers. The user patch follows them; package-manager and HMR recomposition reinstall the layer without rewriting the user's bundle manifest. Safe Mode excludes the product bundles.
