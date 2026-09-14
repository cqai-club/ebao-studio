# e图宝

e图宝是 CQAI 的 DSH 生图工作台，提供文生图、图生图、Agent 工具、共享任务队列、历史、图库、提示词模板、电商模式、无限画布、画布技能和可选 S3 同步。

插件消费宿主唯一的 `@cqaiclub/dsn-account` 服务获取登录状态、额度、模型目录和 `fetchAi()`；不再注册第二套账号服务、RPC 或账号界面。默认生图 Provider 仍是 `cqai`，由共享账号服务通过 Account Service 调用 CQAI Relay；浏览器不会得到 OAuth Token 或 Relay Key。第三方渠道仅在用户明确选择时使用。

第三方 API Key、提示词增强 Key、S3 Access Key / Secret Key 和画布技能密钥统一保存在 DSH Credentials；设置界面只读取“已配置/未配置”状态。升级时先写入 Credentials，再清理旧 settings 字段，写入失败不会删除旧值。

## 开发

从仓库根目录运行：

```sh
corepack yarn workspace cqai-dsh-plugin-imagegen typecheck
corepack yarn workspace cqai-dsh-plugin-imagegen test
corepack yarn workspace cqai-dsh-plugin-imagegen build
```

运行时数据继续保存在 `~/.dsh/dsh-imagegen`，以兼容原插件历史、图库、模板缓存和画布数据。首次接管旧数据时会先校验并备份 JSON 元数据，再原子写入版本标记；原数据不会被删除。插件不包含在线自更新器，版本跟随 ebao-studio/Desktop 发行。

## 上游来源

完整功能迁移自 `@dickpy/dsh-imagegen` v1.5.12。具体版本、修改边界和许可证信息见 [UPSTREAM.md](./UPSTREAM.md) 与 [LICENSE](./LICENSE)。
