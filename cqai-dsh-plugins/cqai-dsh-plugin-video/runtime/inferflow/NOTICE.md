The Python client, schema validation, configuration helpers and duration estimator
were copied from the locally installed `inferflow-codex` skill on 2026-09-15.
`bridge.py` is the e剪宝 stdio integration. It uses the official public
`https://saas.inferflow.dev/openapi/v1` API and does not load or persist keys through
the skill's configuration helpers. Keys arrive over stdin for one operation only.

Only digital_human_standard is exposed by this integration. No generated video,
private account configuration, uploaded material, or API key belongs in a release.
