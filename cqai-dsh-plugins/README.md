# CQAI DSH Plugins

每个子目录都是一个可独立构建和安装的 DSH 插件包。

## 命名

所有插件使用：

```text
cqai-dsh-plugin-<capability>
```

例如：

- `cqai-dsh-plugin-quicknav`
- `cqai-dsh-plugin-market`
- `cqai-dsh-plugin-imagegen`
- `@cqaiclub/dsn-account`

## 创建新插件

新插件至少应包含：

```text
cqai-dsh-plugin-example/
├─ package.json
├─ dsh.plugin.json
├─ cordis.patch.yml
├─ tsconfig.json
├─ tsdown.config.ts
├─ README.md
└─ src/
   ├─ index.ts
   └─ client/
      └─ index.tsx
```

只有真正需要 Host 能力时才实现 `src/index.ts`；纯客户端插件也应保留一个轻量 Host entry，以便通过标准 DSH bundle 流程安装。

`@cqaiclub/dsn-account` 是来自 [cqai-club/cqaiclub-dsh-plugin](https://github.com/cqai-club/cqaiclub-dsh-plugin)
的 CQAI Club 共享账号插件。它由 Desktop 作为默认产品 bundle 纳入，负责 OAuth/PKCE 登录、账号与额度快照、模型目录和
`cqaiclub` LLM Provider；其他 CQAI 业务插件通过 Host 服务复用登录态，不应自行保存或传递 Token。

`cqai-dsh-plugin-imagegen` 是默认启用的 e图宝工作台。它通过 Host 注入复用 `@cqaiclub/dsn-account`，默认使用 CQAI
图像 Provider，同时保留需要用户显式选择的自定义渠道；插件本身不再实现第二套登录、Token 存储或账号设置页。

`cqai-dsh-plugin-eyanbao` 是独立的 e研宝研究工作台，提供一句话文献检索、中外文/中文/外文文献范围、综述与论文生成，以及期刊、
本科、硕士和博士学位论文的 DOCX 排版导出。它复用宿主默认文字模型，可作为普通 DSH bundle 安装，不依赖 e剪宝或视频插件。
