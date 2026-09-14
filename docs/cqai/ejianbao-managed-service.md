# e剪宝产品账户托管生成

客户端与 cqai-account-service 接入代码已实现，本地完整链路已导出测试 MP4。线上渠道、商户收款与真实扣费仍需部署验收；当前运行的旧版桌面没有自动切换。

## 用户流程

CQAI 登录 → 在平台充值 → 上传照片、录音并填写文案 → 获取积分报价 → 确认生成 → 下载原片 → 本地字幕、动效、MP4 渲染。

用户充值支付给平台配置的商户，积分和消费账本均在现有 Relay。平台统一支付 InferFlow 成本。积分兑换比例、充值折扣和模型售价由运营方管理。用户不申请 InferFlow Key。

## 调用与配置

Renderer → 本地 Host ManagedJobs → dsnAccount.fetchAi → Account Service /v1/ejianbao → Relay 任务插件 ejianbao → InferFlow digital_human_standard。

Account Service 用服务端平台 Key 上传照片与声音，通过签名授权 Relay 创建任务；Relay 使用用户现有账户额度，预占、轮询和按实际时长结算。平台 Key 只配置在 Account Service Secret 和 Relay 渠道。OAuth Token 不传给 Renderer 或 Python。

| 接口 | 行为 |
| --- | --- |
| POST /v1/ejianbao/quotes | 文案绑定的十分钟报价；amount 是原始额度整数，displayAmount 显示平台积分或货币。 |
| POST /v1/ejianbao/runs | multipart 素材；持久化本地任务 ID 作为 Idempotency-Key。 |
| GET /v1/ejianbao/runs/:id | 校验归属后读取 Relay 任务状态。最终收费查看平台账单。 |
| GET /v1/ejianbao/runs/:id/video | 通过账户服务下载 MP4，不暴露厂商 Key。 |
| POST /v1/ejianbao/runs/:id/cancel | 当前返回 409，云端不支持通用取消。 |

后端详细部署、兑换公式、容量限制、异常对账和上线验收见 cqai-account-service/docs/ejianbao-operations.md。

## 桌面行为

新 Host 总是使用托管模式，不读取本机 InferFlow 配置。stage_digitalhuman_legacy.py 仅用于尚未升级的旧 Host 兼容；新 Host 显式设置托管标志。

数字人托管模式暂时关闭可选 AI 文案优化和封面生成。脚本整理、字幕校准、动效、Remotion 与 FFmpeg 渲染在本地执行。

任务保存报价、账户 ID、服务端 run ID 和提交标志。账户切换后不能继续其他账户的云端任务；丢失创建响应后沿用原幂等键。服务端无法确认是否受理时提示联系管理员核对，不引导新建重复任务。报价过期且尚未受理时可重新报价。

停止本地等待或关闭页面不取消云端生成，继续任务查询原任务。历史本地文件保持不变。

## 已验证范围

测试覆盖归属隔离、低余额、幂等重试、服务重启、上传与下载、失去提交确认、账户切换和错误脱敏。本地端到端使用真实 JWT/HTTP/SQLite/Python/Remotion、测试上游响应；未调用真实收费任务。

生产上线前仍需验证管理员收款商户、新用户实际充值、真实 InferFlow 任务与 Relay 最终扣费。后端完成验收后再切换桌面默认构建。
