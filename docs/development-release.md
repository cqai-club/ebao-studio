# 开发与发布流程

开发改动 → `dev` → `master` → 打包成功 → 生成版本 tag。

## 阶段与进入条件

| 阶段 | 触发方式和进入条件 | 完成条件 |
| --- | --- | --- |
| 开发集成 | 从已同步的 `dev` 创建功能分支，提 PR 到 `dev` | PR 的 CI 通过并经审核合入；推送到 `dev` 再运行集成 CI |
| 发布准备 | 在 `dev` 提交版本记录、`release/vX.Y.Z.md`、最新 Market 与 Agents Anywhere 的产物、清单和锁文件 | 待发布内容确定，`dev` 的集成 CI 通过，工作区生成改动均已提交 |
| 提升到主分支 | 同仓库 `dev` 提 PR 到 `master`；CI 拒绝其他来源的 master PR | PR 的 CI 通过并审核合入；使用 merge commit 保留分支历史 |
| 主分支打包 | `master` 的 CI 通过后，手动运行 `Release`，选择 `master` 并输入尚未创建的版本 tag 和 macOS 模式 | 同一 dispatch SHA 的 `verify`、Windows 和 macOS 打包/必要校验全部成功，汇总产物的 SHA-256 和 Updater SHA-512 校验通过 |
| 标记与发布 | 打包成功后工作流自动进行 | 保存完整校验产物和来源记录后创建 annotated tag，上传并检查 Release 文件，再公开预发布版本 |
| GitCode 镜像 | 启用 GitCode 同步后，GitHub 公开下载校验成功自动调用镜像工作流 | 同步源码和版本 tag，复用七个原始 Release 附件；匿名下载及完整性校验通过后确认国内下载可用 |

CI 自动覆盖面向 `dev`、`master` 的 PR 及两分支推送，也可手动触发。仓库管理员应将 `changes` 和 `check` 设为两分支的必需检查并禁止绕过；CI 拒绝不合规 PR，Release 另外拒绝没有已合并 `dev → master` PR 记录的提交，直接推送 master 不满足发布条件。

## 一次发布

1. 开发改动先合入 `dev`。若 master 有历史修复尚未进入 dev，先将 master 合并回 dev，避免漏带修复。
2. 在 dev 准备版本和发布依赖。沿用现有 `vMAJOR.MINOR.PATCH` 输入、Stable `X.Y.Z`、Beta `X.Y.Z-beta.1` 和稳定版索引一致性规则；本流程不引入自动递增版本。发布说明放在 `release/vX.Y.Z.md`。
3. 运行 `corepack yarn market:prepare`、`corepack yarn aa:prepare-release`，将精确依赖、补丁、产物、provenance 和锁文件一并提交到 dev。使用根 Yarn `4.18.0`，保持上游子模块独立。
4. `dev → master` PR 通过 CI 后合入。等待 master CI，通过后在 Actions 的 Release 页面选择 master；不要预先创建或推送 tag。命令示例中的 `vX.Y.Z` 须替换为已提交版本：

   ```sh
   gh workflow run release.yml --repo cqai-club/ebao-studio --ref master \
     -f release_tag=vX.Y.Z -f macos_mode=signed
   ```

   `signed` 要求现有 macOS 签名、公证凭据；只有明确的测试发布使用 `unsigned-test`。现有 Windows 未签名、GitHub 预发布策略保持不变。
5. 每个 job 检出 dispatch 时的 `github.sha`，而非浮动的 master 或 tag。Release 再次检查该 SHA 在 master 历史中，且恰为已合并 dev PR 的提交；即使 master 后来推进，标签仍指向实际打包的旧 SHA。
6. 所有打包与校验成功，先保留 `release-validated-<run_id>-<attempt>` artifact，再创建带来源 JSON 的 annotated tag。记录包含提交 SHA、版本、macOS 模式、运行 URL、所有发布文件的 SHA-256；同样内容保存在 `release-provenance.json` 和 Release 正文中。Actions artifacts 保留 30 天；tag 和 Release 的来源记录长期保留。
7. 发布先创建 draft，逐个上传缺少的文件，以 GitHub 返回的文件 digest 检查所有文件与打包产物一致，才公开预发布版本。最后下载公开文件，再检查 SHA256SUMS 和 Updater 元数据。完成后将 master 合并回 dev 保持历史同步。
8. 若已启用 GitCode 同步，`mirror-gitcode` 在 GitHub 发布及公开下载校验成功后运行。它使用同一 dispatch SHA 的可信脚本，先同步源码和已有 tag，再镜像已验证的 Release；镜像失败可以单独重试，已经发布的 GitHub Release 保留。

## GitCode 源码与 Release 镜像

GitHub 是开发和打包主源，GitCode 目标为 [`g-dxw/ebao-studio`](https://gitcode.com/g-dxw/ebao-studio)。GitCode 导入仓库不会迁移 GitHub Release 附件；源码同步和 Release 同步分别执行。当前仍由 GitHub Actions 的原生 Windows/macOS runner 打包，GitCode 复用这些原始构件。若要让 GitCode 独立打包，需要另行提供原生 Windows/macOS 执行机及签名环境。

工作流默认关闭。在 GitHub 仓库设置中添加有目标仓库写入权限的 `GITCODE_TOKEN` secret，然后将 repository variable `GITCODE_SYNC_ENABLED` 设为字符串 `true`。可选 variable `GITCODE_REPOSITORY` 用于更换目标，默认是 `g-dxw/ebao-studio`。Token 仅放在 Actions secret 中，不写入源码、命令参数或下载链接。

启用后，`dev` 和 `master` 推送自动单向同步这两个分支；发布成功后再同步对应的已有 annotated tag。源码同步不强推，也不批量镜像或删除其他分支和 tag，遇到目标历史冲突时停止并报告。所有同步共用 `gitcode-mirror` concurrency，避免源码、发布和补同步同时写目标仓库。

可在 Actions 的 **Sync GitCode mirror** 中手动补同步。选择 `master` 运行可信脚本，不能从待同步的版本 tag 执行代码。`release` 模式要求输入一个已有 GitHub Release 的版本 tag，`source` 模式只同步源码，可选输入已有版本 tag：

```sh
gh workflow run sync-gitcode.yml --repo cqai-club/ebao-studio --ref master \
  -f mode=source

gh workflow run sync-gitcode.yml --repo cqai-club/ebao-studio --ref master \
  -f mode=release -f release_tag=vX.Y.Z
```

Release 镜像保持原版本、发布说明、签名/预发布标记及来源记录，上传四个安装包/压缩包、`latest.yml`、`latest-mac.yml` 和 `SHA256SUMS` 共七个原始文件。保留各文件名和字节，不重建、分卷或改写校验文件。平台单附件、总容量及流量限制需要用当前大安装包实测；上传受理成功不代表下载验收通过。必须以匿名下载返回的实际字节、SHA-256 和 Updater SHA-512 校验结果确认国内用户能获取完整包，真实结果另行记录。

本次镜像没有切换已安装应用的更新源：版本检查、Electron Updater 和既有下载服务仍沿用原配置。GitCode 提供用户手动下载安装包的入口；若要切换应用内更新源，应在 Beta 先适配并验证，再同步 Stable。

## 失败与重试

- `verify`、任一平台打包、汇总校验或产物保存失败：不创建新 tag，不发布 Release。可对原运行选择 **Re-run failed jobs**；原 SHA 保持固定。
- tag 已创建但上传/公开发布失败：标签保留；对原运行重新执行失败的 publish job，复用此前成功的 Windows/macOS artifacts，只补缺失文件，不覆盖已有文件。相同 SHA、run ID、模式和全部文件校验值才能复用已有 tag；不会重复创建标签或 Release。
- 对 tag 已存在的运行重跑全部 job 可能得到不同二进制字节；这种情况下校验会拒绝覆盖。已校验的每次 attempt artifacts 分别保存，不会覆盖旧的完整来源证据。
- 同版本另起一个新 Release run、不同提交/模式/字节或历史轻量 tag 均会被拒绝。需要修改源码、工作流或重新构建不一致的产物时，在 dev 修复，重新提升 master，并使用新版本；不要删除、移动或强推已有标签。
- 最后公开下载校验失败时，tag 已代表之前成功且验证过的打包；保留该 tag 并调查下载/发布错误，重试最后失败的 job。上传阶段不完整则保持 draft。
- Actions artifacts 已过期且无法恢复时，原流程不能重新证明相同文件；准备新版本和新运行。
- GitCode 同步失败：检查 secret、目标写入权限、源码历史冲突及平台附件限制，再单独重试 `mirror-gitcode` 或手动补同步已有版本。不要重跑 Windows/macOS 构建来修复镜像，也不要覆盖目标上校验不一致的文件。GitHub 原始 tag、Release 和构件保留。

## 验证范围

`node --test scripts/release-flow.test.mjs scripts/verify-release-assets.test.mjs` 覆盖成功打包后标记、失败/取消/未完成时不标记、失败重试、部分上传恢复、重复运行、不同提交/运行/文件冲突，以及工作流先保存产物后创建 tag 的顺序。API 测试使用内存替身，不会制造真实版本标签。CI 每次运行这些流程测试与分支入口检查。真实 Windows/macOS 打包和 Release API 上传仍由下一次有版本变更的 master Release 运行验收，不为测试发布流程额外生成产品版本。打包耗时和稳定性继续由 issue #23 跟踪。

GitCode 镜像接入增加了 `scripts/sync-gitcode-source.test.mjs` 和 `scripts/sync-gitcode-release.test.mjs`。`corepack yarn test:release-assets` 的 28 项测试与 `node --test scripts/release-flow.test.mjs` 的 13 项测试共 41 项本地检查通过，覆盖受信任源码与凭据边界、只同步指定分支/tag、幂等补传、冲突拒绝、来源一致性、匿名流式/分段下载校验，以及成功发布后调用镜像的工作流顺序。测试使用内存替身及临时本地服务，不代表真实平台上传或完整安装流程验收；现有原生 Windows/macOS 打包门禁保持不变。

2026-10-13 已将现有 `v0.0.14` 镜像到 [GitCode Release](https://gitcode.com/g-dxw/ebao-studio/releases/tag/v0.0.14)，七个原始附件合计 **2,535,484,234 bytes（约 2.54 GB）**，7/7 均通过匿名 GET 下载及 SHA-256 校验。Release 正文保留 GitHub 原发布说明、未签名测试/预发布标记及 provenance，原始源码提交和 annotated tag 未改变。本记录只确认该版本的大包容量和匿名下载实测结果，不承诺未来平台配额或流量策略。

GitHub 的 `GITCODE_TOKEN` secret、`GITCODE_REPOSITORY=g-dxw/ebao-studio` 和 `GITCODE_SYNC_ENABLED=true` 已配置并回读确认。自动同步工作流代码仍在功能分支，须经过 PR 审核合入 `dev`，并提升到 `master` 后生效；本次验收复用现有构件，没有重新运行原生 Windows/macOS 打包。代码仍要求显式启用，后续环境须自行配置凭据和 variable。
