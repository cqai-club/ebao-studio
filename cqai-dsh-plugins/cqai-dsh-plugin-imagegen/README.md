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

## 历史任务

普通生图、电商套图和画布生成历史分别检索与清理。电商结果区的「历史任务」位于「新建商品」旁，选择任务会恢复保存的配置、参考图、整套结果和进度，读取历史不会再次生成。配置以只读方式显示；「复制配置」创建可编辑的新草稿。

每张电商结果图片下方提供「查看提示词」，展开查看、选择或复制该图成功生成时实际使用的提示词，包括主图锚定约束。重生成期间显示的旧图仍对应旧提示词。旧任务或缺失生成版本的记录会明确标注已保存文本或原计划，不能确认实际版本时不会冒充完整记录。

电商任务由 Host 保存并编排，离开界面后仍执行。参考图、结果与每次尝试独立保存，用户可删除已结束任务或清空电商已结束任务，进行中任务使用取消操作。新电商任务没有自动数量淘汰；普通与画布各保留最近 50 条，共享旧索引中的电商记录按完整项目保留最近 50 个项目。

旧版电商记录只能查看现存结果，缺失的配置和参考图有明确提示。Host 重启后无法确认的执行显示为中断，保留已完成结果，由用户明确重试。

## 技能库安装

技能库支持从仓库根链接、具体技能目录或 ZIP 安装。单个技能即使位于 `skills/<name>/SKILL.md` 也会自动识别；仓库包含多个技能时，需要提供具体目录链接。指定目录不存在时直接报错，不回退到仓库中另一技能；安装失败原因在技能库窗口中显示。

## 上游来源

完整功能迁移自 `@dickpy/dsh-imagegen` v1.5.12。具体版本、修改边界和许可证信息见 [UPSTREAM.md](./UPSTREAM.md) 与 [LICENSE](./LICENSE)。

已选择性集成上游至 2026-10-01 的 PNG、轻量任务队列、Dock、模型检测、画布收藏与图片缩放、电商提示词更新，并加入 Handraw、Prompt Signal、EvoLink 共 1,480 个社区模板。三个社区来源随插件版本更新，参考图片按需下载并缓存；原有模板刷新、收藏和数据目录继续兼容。社区数据来源与许可证见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
