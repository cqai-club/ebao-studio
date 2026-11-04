/** Separate redistribution authorizations confirmed for the Desktop release. */
export const REDISTRIBUTION_AUTHORIZATIONS = Object.freeze([
  Object.freeze({
    name: '@tencent-connect/qqbot-connector',
    version: '1.2.0',
    declaredLicense: 'UNLICENSED',
    confirmedOn: '2026-09-30',
    basis: 'Separate authorization confirmed by the eBao Studio release requester',
    reference: 'release/qqbot-connector-authorization.md',
  }),
])

/** Match the exact package, version, and unchanged upstream license metadata. */
export function redistributionAuthorization(manifest, license) {
  return REDISTRIBUTION_AUTHORIZATIONS.find(entry =>
    entry.name === manifest.name
    && entry.version === manifest.version
    && entry.declaredLicense === license)
}

/** Keep the original license visible alongside the separate authorization. */
export function redistributionAuthorizationNotices(entries) {
  if (entries.length === 0) return []
  return [
    '## Separate redistribution authorizations',
    'The packages below retain their upstream license metadata and are included under',
    'separate authorizations confirmed by the eBao Studio release requester.',
    '| Package | Version | Upstream license | Basis | Confirmed on | Record |',
    '| --- | --- | --- | --- | --- | --- |',
    ...entries.map(entry => `| ${entry.name} | ${entry.version} | ${entry.declaredLicense} | ${entry.basis} | ${entry.confirmedOn} | ${entry.reference} |`),
    'These authorizations apply to inclusion in eBao Studio; they do not relicense the packages',
    'or grant recipients unrestricted rights to redistribute them independently.',
  ]
}
