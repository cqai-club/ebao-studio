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

## Selective image-editor integration - 2026-10-09

The image editor selectively adapts the client-side editor from
[`Dogwind221/img2img-studio`](https://github.com/Dogwind221/img2img-studio), pinned
to commit `ff2b2bb4e4ddeefec36c577d23359ecd48e39065` (MIT):

| Upstream path | Product path |
| --- | --- |
| `plugins/dsh-img2img-config/src/client/EditorModal.tsx` | `src/client/image-editor/EditorModal.tsx` |
| `plugins/dsh-img2img-config/src/client/raster.ts` | `src/client/image-editor/raster.ts` |
| `plugins/dsh-img2img-config/src/client/manifest.ts` | `src/client/image-editor/manifest.ts` |

The numbered change markers, brush selection, local flat-background cutout,
resize rules, and edit-manifest structure are adapted to the existing e图宝
image storage and CQAI generation path. Product integration and
`src/client/image-editor/editor.module.css` are maintained here. The original
image is retained; saved edits and generated results are separate images.

The upstream providers, environment/configuration readers, skill scripts,
composer docking, locale registration, and host bootstrap are not imported.
In particular, the local cutout does not imply that an upstream cloud-matting
script is installed. This integration does not add a second generation runtime
or credential store. The original fork baseline and previous selective updates
above remain unchanged.

The upstream copyright and full MIT notice are distributed in
[`docs/licenses/dsh-img2img-config-MIT.txt`](./docs/licenses/dsh-img2img-config-MIT.txt).

The native Chat, Trajectory, and Tool image-gallery adapters use the public
DSH image slots and retain the admitted attachment loader. Their thumbnail
geometry, retry behavior, and preview focus/dismissal behavior are adapted
from DeepSeek Harness `MessageImage` and `ImageLightbox` at the repository's
pinned commit `639ed015397290b3745d163aafe02ffee4aa3f84` (MIT). The product-owned
preview adds an edit action and opens the same editor, without modifying the
upstream checkout. The original DeepSeek notice is distributed in
[`docs/licenses/deepseek-harness-MIT.txt`](./docs/licenses/deepseek-harness-MIT.txt).

Agent reply images also use the official Markdown file-image renderer, which is
separate from those image slots. The repository-owned runtime compatibility
patches `patches/dsh-client-ui-primitives@0.2.0-rc.2.patch` and
`patches/dsh-web-frontend@0.2.0-rc.2.patch` add a lifecycle-aware
`registerMarkdownImagePreview` extension to the public primitives package and
the published frontend's static primitives namespace. This is an e宝工坊
extension, not an existing upstream API. `scripts/markdown-image-preview-compat.mjs`
generates and checks both patches against the unchanged vendored tarballs.
`src/client/markdown-image-editor.tsx` registers the product preview and reuses
the same editor. Without a registered extension, or after plugin disposal,
the original Markdown lightbox remains active. The admitted file-image URL,
streaming rules, linked-image navigation, and lazy loading stay upstream-owned.
