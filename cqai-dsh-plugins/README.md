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
