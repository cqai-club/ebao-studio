# Shared e剪宝 settings

`cqai-dsh-media-settings` is a private workspace library, not a loadable DSH bundle.
Its Host API and browser helpers allow the e剪宝 workspace and independently enabled
video plugins to use the same settings without requiring the workspace to be enabled.

## Ownership and updates

Hosts create a store with `createMediaSettings({ home: resolveDshHome(), credentials: ctx.credentials })`.
Common defaults and per-engine default overrides live in `media-settings/settings.json`
under that data home. New tasks default to portrait `9:16` and the standard Edge voice
`zh-CN-XiaoxiaoNeural`. Existing drafts, presets, task voices and task aspects keep their
explicit values; defaults are resolved only when initializing a new draft.

Pexels and Pixabay keys use the shared `cqai-dsh-media-settings/services` credential
record. Conflicting legacy values remain per-engine overrides. Coverr has its own
`cqai-dsh-plugin-short-video/coverr` credential record. Fish Audio stays in TalkCraft's
existing record. Public responses contain configured status and revision numbers,
never credential values. Ordinary model selection still belongs to the account and
agent services; engine-specific subtitle, codec and runtime settings keep their owners.

Default changes use `revision`; Pexels/Pixabay changes use `credentialRevision`;
Coverr changes use `coverrRevision`. Mutations require the matching expected revision.
Credential updates merge under `credentials.modifyRecord`; ordinary settings use
`withFileLock` and `writeFileAtomic`. Clear operations are explicit and distinct from
returning to the shared default by removing an engine override.

## Migration

The first settings read imports legacy Short Video and TalkCraft material keys,
verifies the stored result, and removes only migrated fields from their old sources.
Non-secret settings, Fish credentials and unknown fields are preserved. Matching
values share one key; conflicting nonempty values remain separate engine overrides.
Malformed or unsupported data fails without cleaning its source. Interrupted
migrations can retry. No plaintext credential backup is created.

Short Video passes effective provider keys to its Python child through process
environment variables; task `request.json` contains only ordinary settings and
configured flags. Each plugin exposes `GET/POST <plugin API>/media-settings` through
`createMediaSettingsHandler`, which requires a loopback host, same-origin requests,
and `x-ejianbao: 1` for writes.

The package exports `.` for Host code, `./contracts` for browser-safe shared types
and constants, and `./client` for browser ESM helpers. Client plugins bundle the
browser exports into their own DSH Client entry. This library has no ModuleLoader
registration, bundle patch, service registration or Client entry of its own.

Run `corepack yarn workspace cqai-dsh-media-settings build`, `typecheck` and `test`
from the product workspace. Tests use temporary data homes and in-memory credentials.
