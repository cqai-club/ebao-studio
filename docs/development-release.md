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

## 失败与重试

- `verify`、任一平台打包、汇总校验或产物保存失败：不创建新 tag，不发布 Release。可对原运行选择 **Re-run failed jobs**；原 SHA 保持固定。
- tag 已创建但上传/公开发布失败：标签保留；对原运行重新执行失败的 publish job，复用此前成功的 Windows/macOS artifacts，只补缺失文件，不覆盖已有文件。相同 SHA、run ID、模式和全部文件校验值才能复用已有 tag；不会重复创建标签或 Release。
- 对 tag 已存在的运行重跑全部 job 可能得到不同二进制字节；这种情况下校验会拒绝覆盖。已校验的每次 attempt artifacts 分别保存，不会覆盖旧的完整来源证据。
- 同版本另起一个新 Release run、不同提交/模式/字节或历史轻量 tag 均会被拒绝。需要修改源码、工作流或重新构建不一致的产物时，在 dev 修复，重新提升 master，并使用新版本；不要删除、移动或强推已有标签。
- 最后公开下载校验失败时，tag 已代表之前成功且验证过的打包；保留该 tag 并调查下载/发布错误，重试最后失败的 job。上传阶段不完整则保持 draft。
- Actions artifacts 已过期且无法恢复时，原流程不能重新证明相同文件；准备新版本和新运行。

## 验证范围

`node --test scripts/release-flow.test.mjs scripts/verify-release-assets.test.mjs` 覆盖成功打包后标记、失败/取消/未完成时不标记、失败重试、部分上传恢复、重复运行、不同提交/运行/文件冲突，以及工作流先保存产物后创建 tag 的顺序。API 测试使用内存替身，不会制造真实版本标签。CI 每次运行这些流程测试与分支入口检查。真实 Windows/macOS 打包和 Release API 上传仍由下一次有版本变更的 master Release 运行验收，不为测试发布流程额外生成产品版本。打包耗时和稳定性继续由 issue #23 跟踪。
