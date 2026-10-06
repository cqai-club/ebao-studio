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

## Failures and retries

- Failed verification, platform packaging, aggregate checks or artifact retention creates no new tag or Release. Use **Re-run failed jobs** on the original run; its SHA stays pinned.
- If the tag exists but upload/publication failed, retain it and rerun the failed publish job in the original run. Reuse successful Windows/macOS artifacts and upload only missing files. Existing tags require identical SHA, run ID, mode and every file digest; no duplicate tag or Release is created and no asset is overwritten.
- Rerunning all jobs after tagging may rebuild different binary bytes; mismatches are rejected. Each verified attempt artifact is retained separately, preserving the original complete evidence.
- A new run for an existing version, another commit/mode/byte set, or a historical lightweight tag is rejected. For source/workflow changes or inconsistent rebuilds, fix in dev, promote again and use a new version. Never delete, move or force-push an existing tag.
- If the final public-download check fails, the tag still represents previously successful, verified packaging. Preserve it, investigate the download/publication problem and rerun the failed job. Incomplete uploads remain draft.
- If Actions artifacts expire and cannot be recovered, the original process cannot prove identical files; prepare a new version/run.

## Validation scope

`node --test scripts/release-flow.test.mjs scripts/verify-release-assets.test.mjs` covers successful packaging before tagging, failed/cancelled/incomplete packaging without tagging, retries, partial-upload recovery, duplicate runs, commit/run/file conflicts and artifact retention before tagging. API tests use in-memory substitutes and create no real version tags. CI runs these tests and the branch-entry check each time. Real Windows/macOS packaging and Release API uploads remain acceptance gates for the next master release with a version change; testing this workflow does not create an extra product version. Packaging duration and stability remain tracked in issue #23.
