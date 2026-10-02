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

## Selective upstream updates - 2026-10-01

The original fork baseline above remains unchanged. Selected updates were
adapted from upstream through `edd000a734a262ec3b9f3e9eb2138079fd2f3a24`
(main, 2026-10-01), rather than replacing the product-specific implementation:

- `6fa509e` (v1.6.1): stored PNG MIME correction, lightweight task summaries,
  and on-demand task detail. Active tasks are always included; terminal tasks
  are capped by completion time so older slow tasks remain observable.
- `f6b55df` (v1.6.2): stable Dock spring geometry and bounded animation steps,
  with reduced-motion support, resize recovery, and wrapped controls on narrow canvases.
- `29c109d` (v1.6.5): model discovery URL/response compatibility, lazy gallery
  and thumbnails, and full canvas image previews with zoom controls.
- `9120f20` / `eeebf65` (v1.6.6): persistent canvas favorites, differentiated
  ecommerce prompts, and per-image prompt polishing through the shared CQAI
  completion service.
- `cea143f`: bundled community prompt libraries with URL image caching,
  legacy numeric IDs/favorite keys, and source attribution preserved.

Bundled community snapshots contain prompts and metadata, not image binaries:

| Source | Cases | Pinned revision | License |
| --- | ---: | --- | --- |
| yang0/handraw-style | 441 | `3737026e2e829540faf5c0627f37251be02b092d` | MIT |
| andy7076/image_prompt | 577 | `ab00db4e4301f172e16ff178691e41d941fa1acc` | MIT |
| EvoLinkAI/awesome-gpt-image-2-prompts | 462 | `e2a269ad1a055a0b4f6c1e170341c6c1aba30faa` | CC0 1.0 |

These three snapshots update with the plugin release; existing VibeUI/Canghe
refresh behavior remains available. Reference images are fetched through the
existing guarded downloader and cached under `imageDataRoot()`. See
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for bundled-data notices.

Upstream subscription login, self-update, alternate client mounting, full-URL
generation transport, and optional settings/favorites redesign are not part
of this selective integration.
