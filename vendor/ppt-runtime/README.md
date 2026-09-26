# DSH PPT runtime archives

The Desktop default profile loads `dsh-ppt-composer`, which mounts `dsh-ppt` for editable PPTD authoring and PPTX export. These archives are pinned copies of the distributions maintained in [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop/tree/8507aa076902215a6746b6c4ae57b9502fee70c0/packages/ppt-runtime) at commit `8507aa076902215a6746b6c4ae57b9502fee70c0`.

| Archive | SHA-256 |
| --- | --- |
| `dsh-ppt-0.1.1-rc.2-desktop-20260906.tgz` | `cc21950559993b92faed2eaa8cb11ad38e1223c3b1d5c10cfdfab94093a5b1ad` |
| `dsh-ppt-composer-0.1.1-rc.2-desktop-20260906.tgz` | `c6b3c6454bca833835be5a69e70817db29c32167f7715c3ad451fa48e746b4db` |

Each archive contains its MIT license and `THIRD_PARTY_NOTICES.md`. The upstream README records that this is maintained distributed JavaScript; the complete original TypeScript source was not available. It also records the provenance and licenses for adapted templates. The archives retain the legacy `kimi-ppt` data directory for existing projects.

To update them, review the upstream runtime and notices, copy both distributions from the same pinned commit, verify their hashes against `packages/ppt-runtime/artifacts.json`, and refresh the Yarn lockfile and Desktop validation.
