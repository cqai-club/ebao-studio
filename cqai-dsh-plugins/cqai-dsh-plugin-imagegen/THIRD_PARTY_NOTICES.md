# Third-Party Notices

This package includes selectively adapted image-editor code and bundled prompt
snapshots. Prompt image assets are not bundled; they are fetched on demand from
the pinned upstream revisions recorded in the snapshot metadata.

## Dogwind221/img2img-studio

- Source: https://github.com/Dogwind221/img2img-studio
- Pinned commit: `ff2b2bb4e4ddeefec36c577d23359ecd48e39065`
- Upstream directory: `plugins/dsh-img2img-config/src/client/`
- Adapted files: `EditorModal.tsx`, `raster.ts`, and `manifest.ts`, under
  `src/client/image-editor/` in this package.
- License: MIT
- Copyright (c) 2026 img2img-studio contributors
- Full upstream notice:
  [docs/licenses/dsh-img2img-config-MIT.txt](./docs/licenses/dsh-img2img-config-MIT.txt)

The adaptation reuses the editor surface, raster operations, and edit manifest;
it does not import the upstream provider engines, environment files, or skills.

## DeepSeek Harness image presentation

- Source: https://github.com/deepseek-ai/deepseek-harness
- Upstream files: `packages/client/ui-attachment/src/MessageImage.tsx` and
  `MessageImage.module.css`, plus `packages/client/ui-primitives/src/ImageLightbox.tsx`
  and `ImageLightbox.module.css`, and its Markdown file-image renderer in
  `packages/client/ui-primitives/src/markdown/render.tsx`.
- Adapted behavior and styles: native image dimensions, retryable attachment
  loading, preview dismissal, focus restoration, and thumbnail presentation in
  `src/client/chat-image-editor.tsx` and `chat-image-editor.module.css`.
- Agent Markdown preview integration: repository-owned compatibility patches to
  the vendored `dsh-client-ui-primitives` and published `dsh-web-frontend` runtime;
  the original vendored tarballs and upstream checkout are retained unchanged.
- License: MIT
- Copyright (c) 2026 DeepSeek
- Full upstream notice:
  [docs/licenses/deepseek-harness-MIT.txt](./docs/licenses/deepseek-harness-MIT.txt)

## yang0/handraw-style

- Source: https://github.com/yang0/handraw-style
- License: MIT
- Copyright (c) 2026 yang0

## andy7076/image_prompt

- Source: https://github.com/andy7076/image_prompt
- License: MIT
- Copyright (c) 2026 andy7076

## EvoLinkAI/awesome-gpt-image-2-prompts

- Source: https://github.com/EvoLinkAI/awesome-gpt-image-2-prompts
- License: CC0 1.0 Universal

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
