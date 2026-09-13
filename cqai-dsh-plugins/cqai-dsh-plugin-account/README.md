# @cqaiclub/dsn-account

本目录固定了 [cqai-club/cqaiclub-dsh-plugin](https://github.com/cqai-club/cqaiclub-dsh-plugin)
的 3bad8bed59be26573e3b2881bd9f105576e53532 提交，并作为 易宝工坊 的默认 CQAI
账号插件使用。

为适配本仓库锁定的 DSH 0.1.5-rc.1，本目录调整了插件元数据和依赖版本，并补充了
桌面原生登录适配。OAuth 使用每次登录独立的随机端口回环监听器，不经过 Desktop Web
载体；Desktop 会直接打开系统浏览器，回调后自动关闭监听器并重新置前桌面窗口。回调页还提供
不携带授权码的 `dsh-desktop://oauth/complete` 按钮，用于通过系统协议重新唤醒应用。上游提交遗漏了 src/client，
本目录同时补充了桌面风格的 CQAI Club 账号、充值和模型服务页签，恢复按用途分类的模型目录与五类默认模型选择。
充值订单由 Host 创建，支付页面在系统浏览器打开；需要表单 POST 的渠道通过一次性随机本机
页面转交支付字段，不把字段放入 URL。支付完成或取消后，固定的
`dsh-desktop://payment/result` 回跳会重新唤醒应用并刷新账户额度。

首次登录需要在系统浏览器完成授权。Native App Client 需要允许
`http://127.0.0.1/cqaiclub-dsn-account/oauth/callback` 的动态端口回调。插件不把 Access
Token 暴露给 Renderer，默认配置仍由 cordis.patch.yml 管理。
