# e剪宝产品账户托管生成接入

状态：客户端调用适配及契约测试已准备；服务端仓库、部署位置和现有钱包事务接口待确认。本文接口为拟定契约，不代表线上已存在。当前运行版本尚未切换计费方式。

## 用户流程

登录已有 CQAI Club 账户 → 上传照片、录音并填写文案 → 获取服务端报价 → 确认制作 → 查看进度和结算 → 下载视频。

复用现有 OAuth 登录、充值入口和账户余额。用户无需申请或填写 InferFlow Key；平台 Key 由运营方通过部署环境的秘密配置提供，不能打包进 Electron、Python、仓库或用户配置。现有个人 InferFlow Key 不自动复制到服务器。

## 请求链路

e剪宝 Renderer → 本地 Host → `dsnAccount.fetchAi` → `account.cqaiclub.asia/v1/ejianbao` → 服务端任务队列 → InferFlow。

OAuth Token 继续由现有账户插件保管，Renderer 与 Python 不接触 Token。数字人云端步骤应由 Host 调用账户服务，替换当前 `stage_digitalhuman.py` 直接执行本地 InferFlow Skill 的路径。Remotion、FFmpeg 和字幕校准继续本地执行。可选文案和封面能力应复用账户模型服务，不能要求新用户另配厂商 Key。

## 拟定接口

所有接口使用既有账户 Bearer Token；服务端验证签名、issuer、audience、scope 并解析不可伪造的用户 ID。

| 接口 | 内容 |
| --- | --- |
| POST `/v1/ejianbao/quotes` | 输入 script、mode；返回 id、amount、unit、expiresAt。amount 为现有钱包最小整数单位，价格由服务端配置。 |
| POST `/v1/ejianbao/runs` | multipart：quoteId、script、avatar、voice；`Idempotency-Key` 为持久化的本地任务 ID。返回 id、status、progress。 |
| GET `/v1/ejianbao/runs/:id` | 返回任务状态、进度，结算后包含 billedAmount。 |
| POST `/v1/ejianbao/runs/:id/cancel` | 请求取消；服务端确认后返回状态。不能取消时返回 409。 |
| GET `/v1/ejianbao/runs/:id/video` | 验证任务归属后代理输出 MP4；不向桌面暴露 InferFlow Key 或跨域带授权跳转。 |

状态：queued、generating、completed、failed、cancelled。未登录 401、额度不足 402、无权访问 403、报价/状态冲突 409、超限 413、限流 429。

## 服务端实现要求

- 所有素材、报价、任务、下载都绑定同一个账户主体，不能只校验“已登录”。限制上传大小，实际探测文件类型，拒绝客户端指定任意上游 URL 或模型节点参数。
- 报价绑定账户、文案摘要、服务选项、价格版本及有效期。实际计费依据是服务端收到的输出时长，不能相信客户端传入的时长或金额。运营方需确定产品售价、最小计费长度及超预估费用的处理规则；不能直接把上游的 13 积分/秒当作产品售价。
- 同一数据库事务中锁定用户钱包并检查可用额度，建立冻结记录、任务记录和唯一的 `(user_id, idempotency_key)`。相同 key、相同内容返回原任务；内容不同返回 409。余额检查和扣款不能分成没有锁保护的两个请求。
- 使用持久化 outbox/队列提交上游，任务在桌面关闭后继续执行。保存平台任务和上游运行的映射。确认 InferFlow 创建接口的幂等/查重能力前，不得对“已发送但响应丢失”的创建请求盲目重试，否则可能生成和付费两次。
- 终态通过可信回调或服务端轮询获得；按唯一结算键完成一次扣费并释放多余冻结额度。明确失败、取消和上游退款的产品政策后实现一次性退款。重复回调、重启和轮询竞争不得重复扣费/退款。
- 取消本地等待不代表取消云端任务；取消需经过账户后端和上游确认。断线恢复查询原任务，不自动创建新任务。
- 任务访问和结果下载执行账户归属检查。记录账本引用、报价版本、状态迁移用于对账；日志不记录 Key、用户 Token、参考音频内容或带签名的下载 URL。

## 上线前验收

1. 无 `.inferflow` 配置的全新 Windows 账户，仅登录产品即可获取报价和生成。
2. 双击、超时重试、进程重启仍只产生一个任务和一笔结算。
3. 并发请求不能超用余额；低余额和不同用户读取任务被拒绝。
4. 成功、失败、取消、重复回调和上游响应丢失场景可正确对账。
5. 桌面安装包与运行文件均不含平台 InferFlow Key。

客户端适配位于 `cqai-dsh-plugins/cqai-dsh-plugin-video/src/managed-video.ts`。在后端契约验证前不接入正在运行的用户制作入口，避免将现有可用功能切换到不存在的线上接口。
