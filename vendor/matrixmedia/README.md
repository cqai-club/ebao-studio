# Bundled MatrixMedia runtime (矩媒)

Desktop ships the MatrixMedia Windows runtime so 一稿多发 works out of the box.
`cqai-dsh-plugin-publisher` spawns `matrixmedia.exe cli …` as a child process;
the binary is **not** an npm dependency and never passes through `verify-licenses.mjs`.

## Layout

```
vendor/matrixmedia/
  README.md                        # this file — committed
  fetch-matrixmedia.mjs            # snapshot script (--check re-hashes the tree) — committed
  0.11.3/
    manifest.json                  # per-file {path, bytes, sha256}, plus files/bytes totals — committed
    provenance.json                # release tag, asset digest, install args, upstream LICENSE digest — committed
    LICENSE                        # upstream GPL-2.0-only text, shipped to resources/matrixmedia/LICENSE — committed
    MatrixMedia-0.11.3-win-x64.exe # pinned upstream release asset — NOT committed (gitignored)
    matrixmedia-win-x64/           # expanded runtime tree — NOT committed (gitignored)
```

The two large artifacts are deliberately outside version control: 253 MB of expanded Electron
runtime would make every clone pay for a third-party binary. What *is* committed is the pin
that makes the tree reproducible — `manifest.json` holds a SHA-256 per file, `provenance.json`
holds the release asset's own digest, and `fetch-matrixmedia.mjs` rejects either on mismatch.
Run the fetch once after cloning; `verify:vendor` re-hashes afterwards and fails loudly if a
file drifted. A missing tree therefore produces an explicit error naming the command to run,
never a silently incomplete build.

`build.extraResources` copies `matrixmedia-win-x64/` to `resources/matrixmedia/` beside
`app.asar` — outside the ASAR, outside `app.asar.unpacked`, and therefore outside
`verify-packaged-runtime.ts`'s unpacked-file budget and smart-unpack allowlist. The tree
must stay outside the ASAR because it is an independent Electron app that has to be
spawned from a real filesystem path. Upstream's GPL-2.0 text rides along as a second
`extraResources` entry landing at `resources/matrixmedia/LICENSE`.

## Release-time updates

```sh
# Fetch the pinned runtime (needs the tree to exist at all, and to rebuild it)
node vendor/matrixmedia/fetch-matrixmedia.mjs

# Re-hash the working tree against manifest.json (no network)
node vendor/matrixmedia/fetch-matrixmedia.mjs --check

# Refresh from GitHub — needs egress; a proxy is used only if the environment supplies one
MATRIXMEDIA_PROXY=socks5://127.0.0.1:10808 node vendor/matrixmedia/fetch-matrixmedia.mjs
# Or expand an installer already on disk, with no network at all
MATRIXMEDIA_ASSET=/path/to/MatrixMedia-<version>-win-x64.exe node vendor/matrixmedia/fetch-matrixmedia.mjs
```

`MATRIXMEDIA_PROXY` is a workstation convenience for reaching GitHub and is never read by
the plugin or the desktop app: end users connect directly. The script downloads the pinned
asset, rejects a byte-count or SHA-256 mismatch, expands the NSIS installer with `/S /D=`,
drops the per-machine `Uninstall matrixmedia.exe`, and rewrites `manifest.json` plus the
asset fields of `provenance.json`. Bump `RELEASE` in the script when adopting a version;
the upstream `LICENSE` digest is recorded in `provenance.json.license`.

`/S /D=` is NSIS's own silent-expand path; it needs no 7-Zip, `innounp` or other unpacker,
and `/D=` must stay last and unquoted. The expanded tree is an "installed" shape — the
runtime does not care, because the plugin starts the executable and reads its data
directory rather than its install registry.

## Product behavior

The publisher panel resolves the runtime by environment variable and never by a hardcoded
path: `EJIANBAO_MATRIXMEDIA` (set by `portable-runtime.ts` for the USB build), else
`process.resourcesPath/matrixmedia` when packaged, else the vendored development tree.
When the runtime is missing the panel says so instead of failing silently.

MatrixMedia keeps its own state under `<Documents>/MatrixMedia/data/` — `account/*.json`,
`publishData`/`pushData/YYYY-MM-DD.json`, and `config.json` — shared with its own GUI. The
plugin treats those files as the authoritative record of what actually published and only
treats CLI exit codes and stdout as weak signals.

`cli login` covers 抖音 and 视频号 only; the remaining platforms are signed in through the
MatrixMedia GUI. This is an upstream limitation, surfaced in the panel's copy.

## Licensing

MatrixMedia is GPL-2.0-only. The obligation is discharged the way this repository already
does it: `THIRD_PARTY_NOTICES.md` carries the declaration and provenance, and the upstream
`LICENSE` text ships at `resources/matrixmedia/LICENSE`. `ALLOWED_LICENSES` is unchanged and
`verify-licenses.mjs` is untouched — the binary is not on the npm dependency graph.

## Validation history

v0.11.3 (`MatrixMedia-0.11.3-win-x64.exe`, 71,587,366 bytes, sha256
`461e958d…75d072`, matching the GitHub release's own reported digest) was expanded with
`/S /D=` into 22 files / 253,462,689 bytes. The expanded tree is not committed; the
manifest that pins it is. `--check` round-trips against `manifest.json`. The CLI surface
was read out of `resources/app.asar` rather than from `CLI_SKILLS.md`: `publish` exits
0 success / 1 error / 2 bad args / 3 task failure / 4 saved as draft, and `accounts`
and `history` both support `--json`. No interactive publishing against a live platform
account has been exercised yet.
