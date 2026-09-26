# Upstream provenance

- Project: `dickpy/dsh-imagegen`
- Tag: `v1.5.12`
- Commit: `fd4a0b6ecd6ea82f443acab12920e576a40b06a5`
- License: Apache-2.0

This package preserves the upstream studio, generation engines, queue, history,
gallery, templates, ecommerce workflow, infinite canvas, canvas skills, skill
library, file previews, Agent tools, and optional object-storage sync.

CQAI adaptations replace the default provider path, integrate DSH 0.1.7-rc.2 public
UI and attachment services, move secrets to host credentials, and remove the
upstream self-updater. CQAI account state and authenticated requests are
consumed from the separately mounted `@cqaiclub/dsn-account` Host service; this
package does not ship a second account runtime or account UI. Demo screenshots,
GIFs, and videos are deliberately not vendored or shipped.
