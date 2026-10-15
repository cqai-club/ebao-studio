# Development and release workflow

Development changes → `dev` → `master` → successful packaging → version tag.

## Stages and entry conditions

| Stage | Trigger and entry conditions | Completion |
| --- | --- | --- |
| Integration | Create a feature branch from synchronized dev and open a PR targeting dev | Reviewed PR passes CI and merges; dev push runs integration CI again |
| Release preparation | Commit version records, `release/vX.Y.Z.md`, current Market and Agents Anywhere artifacts, manifests and lockfile in dev | Release scope is confirmed, dev integration CI passes, all generated changes are committed |
| Promotion | Open a same-repository dev PR targeting master; CI rejects other sources | Reviewed PR passes CI and merges; use a merge commit to preserve branch history |
| Master packaging | After master CI succeeds, manually dispatch Release on master with a version tag that does not exist yet and a macOS mode | verify, Windows and macOS packaging/checks succeed for the same dispatch SHA; aggregate SHA-256 and Updater SHA-512 checks pass |
| Tagging and publishing | Automatic after successful packaging | Retain verified artifacts and provenance, create an annotated tag, upload and verify Release files, then publish a prerelease |
| GitCode mirror | When enabled, automatic after GitHub public-download verification | Synchronize source and the version tag, reuse all seven original Release assets, and confirm domestic downloads only after anonymous download and integrity verification |

CI automatically covers PRs targeting dev/master and pushes to both branches, with manual dispatch also available. Administrators should require `changes` and `check` on both branches and prohibit bypasses. CI rejects noncompliant PRs; Release separately rejects commits without a merged dev-to-master PR. Direct master pushes do not qualify for release.

## Releasing

1. Integrate development changes into dev first. If historical master fixes have not reached dev, merge master back into dev before preparing the release.
2. Prepare versions and dependencies in dev. Keep the existing `vMAJOR.MINOR.PATCH` input, Stable `X.Y.Z`, Beta `X.Y.Z-beta.1`, and matching stable release index. This workflow introduces no automatic version increment. Commit release notes as `release/vX.Y.Z.md`.
3. Run `corepack yarn market:prepare` and `corepack yarn aa:prepare-release`. Commit exact dependencies, patches, artifacts, provenance and lockfile into dev. Use root Yarn 4.18.0 and keep the upstream submodule isolated.
4. Merge the dev-to-master PR after CI passes. Wait for master CI, then select master in Actions → Release. Do not create or push the tag first. Replace the placeholder below with the committed version:

   ```sh
   gh workflow run release.yml --repo cqai-club/ebao-studio --ref master \
     -f release_tag=vX.Y.Z -f macos_mode=signed
   ```

   `signed` requires existing macOS signing/notarization credentials; use `unsigned-test` only for an explicitly intended test release. The existing unsigned Windows and GitHub prerelease policies remain.
5. Every job checks out the dispatch `github.sha`, never a moving master/tag. Release verifies that SHA is on master and exactly the merged dev PR commit. Later master advancement does not change the packaged/tagged SHA.
6. After all packaging and checks pass, retain `release-validated-<run_id>-<attempt>` before creating an annotated tag carrying provenance JSON. It records SHA, version, macOS mode, run URL and SHA-256 of every release file; the same record appears in `release-provenance.json` and the Release body. Actions artifacts are retained for 30 days; tag and Release provenance persists.
7. Create a draft, upload missing files, and compare GitHub asset digests with the verified bytes before publishing a prerelease. Download public assets afterward and verify SHA256SUMS and Updater metadata again. Merge master back into dev to keep history synchronized.
8. When GitCode synchronization is enabled, `mirror-gitcode` runs after GitHub publication and public-download verification succeed. It executes trusted scripts from the same dispatch SHA, synchronizes source and the existing tag, then mirrors the verified Release. A failed mirror can be retried separately; the published GitHub Release is retained.

## GitCode source and Release mirror

GitHub remains the development and packaging source, with [`g-dxw/ebao-studio`](https://gitcode.com/g-dxw/ebao-studio) as the GitCode target. Importing a repository into GitCode does not migrate GitHub Release assets; source and Release synchronization run separately. GitHub Actions still packages on native Windows/macOS runners, and GitCode reuses those original artifacts. Independent GitCode packaging requires separately provisioned native Windows/macOS execution hosts and signing environments.

Synchronization is disabled by default. Add the `GITCODE_TOKEN` GitHub repository secret with write access to the target repository, then set the repository variable `GITCODE_SYNC_ENABLED` to the string `true`. The optional `GITCODE_REPOSITORY` variable overrides the default target, `g-dxw/ebao-studio`. Keep the token in Actions secrets; never include it in source, command arguments or download URLs.

Once enabled, pushes to `dev` and `master` synchronize those two branches in one direction. Successful releases also synchronize the corresponding existing annotated tag. Source synchronization does not force-push, mirror every ref or delete unrelated branches/tags; target history conflicts stop synchronization and are reported. All synchronization uses the shared `gitcode-mirror` concurrency group so source pushes, releases and manual recovery do not write to the target simultaneously.

To recover an existing mirror, manually run **Sync GitCode mirror** in Actions. Select `master` to execute trusted scripts; scripts never execute from the release tag being mirrored. `release` mode requires an existing GitHub Release tag. `source` mode synchronizes source and may optionally include an existing version tag:

```sh
gh workflow run sync-gitcode.yml --repo cqai-club/ebao-studio --ref master \
  -f mode=source

gh workflow run sync-gitcode.yml --repo cqai-club/ebao-studio --ref master \
  -f mode=release -f release_tag=vX.Y.Z
```

The Release mirror preserves the version, notes, signing/prerelease status and provenance, and uploads seven original files: the four installers/archives, `latest.yml`, `latest-mac.yml` and `SHA256SUMS`. File names and bytes are retained without rebuilding, splitting or rewriting checksum files. Per-asset, total-capacity and traffic limits require testing with the current large installers; an accepted upload is not download acceptance. Verify actual anonymously downloaded bytes, SHA-256 and Updater SHA-512 before confirming that domestic users can obtain complete packages, and record the live result separately.

Update sources follow the actual network egress IP. Stable and Beta first request the project's `https://cqaiclub.asia/api/ebao-studio/download?platform=windows|macos` routing endpoint (selecting `windows` or `macos` for the platform), omit `source`, do not follow the 302 redirect, and read only `X-Download-Source`. The server uses a local `geoip-country` lookup: only `CN` selects GitCode. Other regions (including HK/MO/TW), unknown locations, and failed, timed-out or invalid client probes use GitHub. Language and time zone are not used. A successful source decision is cached only in the current process for five minutes without persistence; the next decision after expiry probes again, so a changed network egress can reuse a successful decision for up to five minutes.

The GitHub version manifest is `https://raw.githubusercontent.com/cqai-club/ebao-studio/master/release/desktop-version.json`; the mainland China source uses `https://api.gitcode.com/api/v5/repos/g-dxw/ebao-studio/raw/release%2Fdesktop-version.json?ref=master`. After confirmation, Stable sets the Electron Updater generic source to the confirmed version's selected directory: `https://github.com/cqai-club/ebao-studio/releases/download/v<version>/` for GitHub or `https://gitcode.com/g-dxw/ebao-studio/releases/download/v<version>/` for GitCode. It reads `latest.yml` (Windows) or `latest-mac.yml` (macOS) and downloads relative files referenced by the metadata from that same directory. The target version must match the confirmed value, and the complete NSIS installer or macOS ZIP must pass SHA-512 validation. A failure of the selected manifest or download source remains retryable without automatic switching to the other source; this is distinct from defaulting to GitHub when the routing probe fails. Beta retains version checks and manual-check results without in-app installation; Next retains its upstream update source.

IP-based source selection takes effect only after the next application release containing this code is installed. Existing installations do not switch automatically when the mirror or repository configuration changes. GitHub remains the development, packaging and original release source. Releases require the GitCode synchronization above to be enabled and the version manifest, matching tag and seven original Release assets to be synchronized and verified by anonymous downloads. Source and manifest synchronization can finish before the assets; a confirmed download for a mainland China user may fail during that interval and can be retried after mirroring completes.

## Failures and retries

- Failed verification, platform packaging, aggregate checks or artifact retention creates no new tag or Release. Use **Re-run failed jobs** on the original run; its SHA stays pinned.
- If the tag exists but upload/publication failed, retain it and rerun the failed publish job in the original run. Reuse successful Windows/macOS artifacts and upload only missing files. Existing tags require identical SHA, run ID, mode and every file digest; no duplicate tag or Release is created and no asset is overwritten.
- Rerunning all jobs after tagging may rebuild different binary bytes; mismatches are rejected. Each verified attempt artifact is retained separately, preserving the original complete evidence.
- A new run for an existing version, another commit/mode/byte set, or a historical lightweight tag is rejected. For source/workflow changes or inconsistent rebuilds, fix in dev, promote again and use a new version. Never delete, move or force-push an existing tag.
- If the final public-download check fails, the tag still represents previously successful, verified packaging. Preserve it, investigate the download/publication problem and rerun the failed job. Incomplete uploads remain draft.
- If Actions artifacts expire and cannot be recovered, the original process cannot prove identical files; prepare a new version/run.
- If GitCode synchronization fails, check the secret, target write permissions, source history conflicts and platform asset limits, then retry `mirror-gitcode` alone or manually mirror the existing version. Do not rebuild Windows/macOS artifacts to repair a mirror or overwrite target files with conflicting checksums. Retain the original GitHub tag, Release and artifacts.

## Validation scope

`node --test scripts/release-flow.test.mjs scripts/verify-release-assets.test.mjs` covers successful packaging before tagging, failed/cancelled/incomplete packaging without tagging, retries, partial-upload recovery, duplicate runs, commit/run/file conflicts and artifact retention before tagging. API tests use in-memory substitutes and create no real version tags. CI runs these tests and the branch-entry check each time. Real Windows/macOS packaging and Release API uploads remain acceptance gates for the next master release with a version change; testing this workflow does not create an extra product version. Packaging duration and stability remain tracked in issue #23.

GitCode integration adds `scripts/sync-gitcode-source.test.mjs` and `scripts/sync-gitcode-release.test.mjs`. All 41 local checks passed: 28 from `corepack yarn test:release-assets` and 13 from `node --test scripts/release-flow.test.mjs`. They cover trusted source and credential boundaries, synchronization of selected branches/tags, idempotent missing-asset uploads, conflict rejection, provenance consistency, anonymous streamed/ranged download verification and workflow ordering after successful publication. Tests use in-memory substitutes and temporary local services; they do not establish live platform uploads or complete installer acceptance. Existing native Windows/macOS packaging gates remain unchanged.

On 2026-10-13, the existing `v0.0.14` was mirrored to its [GitCode Release](https://gitcode.com/g-dxw/ebao-studio/releases/tag/v0.0.14). The seven original assets total **2,535,484,234 bytes (approximately 2.54 GB)**, and all 7/7 passed anonymous GET download and SHA-256 verification. The Release body preserves the original GitHub notes, unsigned-test/prerelease status and provenance; the source commit and annotated tag remain unchanged. This record confirms large-asset capacity and anonymous downloads for this version only, without promising future platform quotas or traffic policies.

The GitHub `GITCODE_TOKEN` secret, `GITCODE_REPOSITORY=g-dxw/ebao-studio` and `GITCODE_SYNC_ENABLED=true` are configured and confirmed by readback. The automatic synchronization workflow remains on a feature branch and takes effect after PR review and integration into `dev`, followed by promotion to `master`. This acceptance reused existing artifacts without rerunning native Windows/macOS packaging. The code remains opt-in, and other environments must configure their own credentials and variables.
