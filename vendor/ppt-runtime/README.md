# DSH PPT runtime archives

The Desktop default profile loads `dsh-ppt-composer`, which mounts `dsh-ppt` for editable PPTD authoring and PPTX export. These archives were built from [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop/tree/eec5d57e658f63431ab312dae3dd30d9d03c4cd4/packages/ppt-runtime) at commit `eec5d57e658f63431ab312dae3dd30d9d03c4cd4`. Upstream now tracks maintained runtime seeds and template generators instead of committed distribution archives.

| Archive | SHA-256 |
| --- | --- |
| `dsh-ppt-0.1.1-rc.2-desktop-20260926-eec5d57.tgz` | `0a89e6b17491cbf5bfce3211fc0d2ae9ae47502d43de5901abe2585ff3cd8321` |
| `dsh-ppt-composer-0.1.1-rc.2-desktop-20260926-eec5d57.tgz` | `71fa81a21184293899a285fda00cf10b7e4abb75c094e7bceff4bf4e3374c434` |

Each archive contains its MIT license and `THIRD_PARTY_NOTICES.md`. The upstream README records that this is maintained distributed JavaScript; the complete original TypeScript source was not available. It also records the provenance and licenses for adapted templates. The archives retain the legacy `kimi-ppt` data directory for existing projects.

The archives were packed from the two directories under upstream `.build/ppt-runtime/packages/` after `npm run ppt:build`. That build checked all 16 templates with 12 pages each and reported zero errors and warnings. The upstream npm lockfile's registry URLs were normalized to the official npm registry in a temporary checkout; integrity values and package versions remained unchanged.

To update them, review the upstream runtime and notices, build both packages from one pinned commit, record the archive hashes here, and refresh the Yarn lockfile and Desktop validation. The current Composer expects `conversation.hero.modeActions`, `conversation.input.accessory`, and `conversation.hero.dock` outlets. The Desktop patch for `@deepseek-ai/dsh-client-ui-conversation@0.1.7-rc.2` supplies those outlets to Stable and Beta.
