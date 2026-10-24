# e研宝 Design System

The workspace uses the `ui-ux-pro-max` Swiss Modernism recommendation as its structural base, with the following product-specific overrides:

- The first screen is the research composer, not a marketing hero or portfolio grid.
- Desktop UI uses a compact three-level hierarchy: global shell, project rail, and manuscript workspace.
- The institutional navy, amber accent, and research green are exposed as semantic CSS variables. Application surfaces continue to inherit DSH theme tokens for light and dark modes.
- UI labels use the desktop system sans-serif stack. The manuscript preview uses a Chinese serif stack and remains light so it matches the exported document.
- Seven task types form one wrapped control at tablet and mobile widths instead of a horizontal scroller.
- Literature scope stays in the primary filter row; source cards use a compact language badge instead of a second modal.
- Journal level appears only for foreign literature, and curated top-journal sources use a separate green badge.
- Below 1180px, the source rail moves below the manuscript so the document keeps a readable measure.
- Icons use Lucide. Motion is limited to panel transitions, press states, and the generation spinner, and is disabled under `prefers-reduced-motion`.
- All controls use visible labels or accessible names, 44px minimum targets, visible focus rings, and status announcements for generation errors and completion.

The generated DOCX templates are a general academic baseline. Institution-specific rules should be implemented as additional templates rather than described as universal compliance.
