# 技能配置（Skill configuration）

无限画布把 `~/.dsh/skills` 下**可被模型调用**的技能列进节点技能菜单。技能本身是纯数据
（`SKILL.md` + 资源），DSH 只负责发现与加载 —— registry / provider 层没有"配置"概念，
`ctx.shellEnv` 那套托管环境也只收 `DSH_*` 前缀的可信变量。所以技能自己的配置（API 密钥、
OCR token、模型名、后端地址…）过去只能靠技能文档手敲命令行或改 dotfile。

本文定义本插件提供的那一层：**技能声明它要什么配置，画布的技能库负责渲染、保存、生效**。
目标有两个：

1. 任何一个技能都能用同一套机制暴露配置，不需要插件为它写代码；
2. 什么都没声明的老技能行为完全不变（仍然走它自己的文档 / Agent 配置）。

## 1. 声明：`skill.config.json`

技能目录（与 `SKILL.md` 同级）可以放一份 JSON 声明：

```
~/.dsh/skills/<name>/SKILL.md
~/.dsh/skills/<name>/skill.config.json     ← 可选
```

```json
{
  "version": 1,
  "note": "图像 API 由 CQAI 在每次运行时临时提供；这里只保存非 CQAI 的可选配置。",
  "imageProvider": {
    "protocol": "openai-images-v1",
    "modelField": "image-model"
  },
  "fields": [
    {
      "id": "image-model",
      "label": "图像模型",
      "type": "select",
      "default": "gpt-image-2",
      "options": [
        { "value": "gpt-image-2", "label": "gpt-image-2" },
        { "value": "doubao-seedream-5-0-pro-260628", "label": "Seedream 5.0 Pro" }
      ]
    },
    {
      "id": "paddle-ocr-token",
      "label": "PaddleOCR token（可选）",
      "type": "secret"
    }
  ],
  "apply": [
    {
      "kind": "file",
      "path": "editppt/config.yaml",
      "content": "PADDLE_OCR_TOKEN: '{paddle-ocr-token}'\n",
      "when": { "field": "paddle-ocr-token", "set": true }
    }
  ]
}
```

### 字段（`fields[]`）

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | `^[a-z0-9][a-z0-9-]{0,63}$`，在 `apply` 里用 `{id}` 引用 |
| `label` | | 表单标签；缺省用 `id`（作者语言原样展示） |
| `description` | | 一行说明 |
| `type` | | `string` / `secret` / `boolean` / `number` / `select`，缺省 `string` |
| `required` | | 未填时在节点菜单里显示"需要配置"提示 |
| `default` | | 默认值；`secret` 不建议给默认值 |
| `options` | | 仅 `select`：`[{ value, label }]` |
| `expose` | | `true` 时把该字段值以"已配置"上下文块暴露给模型；`secret` 恒为 `false` |

### 运行时图像 Provider（`imageProvider`）

重型技能只有显式声明下列协议，Host 才会签发 CQAI 临时凭据：

```json
{
  "imageProvider": {
    "protocol": "openai-images-v1",
    "modelField": "image-model"
  }
}
```

- `protocol` 目前只接受精确值 `openai-images-v1`；未声明、拼写错误或其他协议都视为不兼容；
- `modelField` 可选，必须指向已声明的非密钥字段，仅用作本次任务的模型选择；
- 运行参数也可传 `imageProvider: "cqai"` 与 `imageModel`，不会改动全局默认模型；
- 明确请求图像 Provider 但技能没有兼容声明时，任务会直接报错，不会退回到持久化的第三方 Key。

### 生效步骤（`apply[]`）

按顺序执行，两种 kind：

- `{ "kind": "command", "argv": [...], "cwd"?: "skill" }`
  以**数组参数、无 shell** 方式执行；`{field}` 会被替换成保存的值。`cwd: "skill"` 表示在技能
  目录里执行（默认在该技能的配置运行目录）。命令行不得引用 `secret` 字段，因为 argv 会出现在
  系统进程列表里；这类声明会在预览阶段被阻止。技能应改为读取私有配置文件，或使用宿主明确提供的
  运行期环境变量。
- `{ "kind": "file", "path": "provider/config.yaml", "content": "...{field}..." }`
  `path` 必须是相对路径，目标固定在插件为该技能分配的私有配置根下。绝对路径、`~`、`..` 和任何
  符号链接穿越都会被拒绝；文件以原子方式写入并强制为 `0600`。预览只显示
  `<skill-config>/provider/config.yaml`，文件正文完整显示但密钥替换为 `•••`。

`when: { "field": "<id>", "set": true }` 让某一步只在对应字段有值时执行（可选跳过）。

### 约束（前向兼容 + 安全）

- `version` 不是 `1` 时整份声明被忽略（界面给出说明），老插件不会误读新格式。
- 未知 kind / 未知字段被忽略，不报错。
- 上限：32 个字段、16 个步骤、单文件内容 8KB。
- 声明来自**已安装的技能**，因此是不可信数据：解析阶段不做任何执行、不写任何文件。

## 2. 声明从哪里来

按优先级取第一个命中的：

1. `<技能目录>/skill.config.json` —— 技能自带（推荐，上游可直接提供）；
2. 插件内置配方（`src/skill-config-recipes.ts`）—— 给已知但没带声明的技能用，
   目前有 `image-to-editable-ppt`（`editppt config`）；
3. 都没有 → 面板只给通用提示（见 §6）。

内置配方让"已知技能开箱可用"，而技能自己的声明永远优先，上游更新带上声明后自动接管。
`image-to-editable-ppt` 的内置配方把 OCR token 写到私有的 `editppt/config.yaml`；运行该技能时，
宿主给 Agent 的非密钥配置说明会要求将 `EDITPPT_CONFIG_HOME` 指向这个私有目录，避免 token 进入 argv。

## 3. 值存在哪

技能配置按敏感性分开存储。普通值在插件自己的 settings 命名空间；密钥进入
插件专属的 DSH Credentials 记录：

```
dsh-imagegen:
  skillConfig: { "<skill>/<field>": "<明文非密钥值>" }

DSH Credentials (cqai-dsh-plugin-imagegen/secrets):
  skillConfigSecrets: { "<skill>/<field>": "<仅宿主可读的密钥>" }
```

- 密钥字段写进 Credentials 内的 `skillConfigSecrets`；settings 桥接只回兼容路径的
  `set: true/false`，浏览器和设置文档都拿不到值；
- 非密钥字段写进 `skillConfig`；
- 删除技能不会自动删值（重装后配置还在）；把字段清空即从 Credentials 记录中删除；
- 值**不写回技能目录**，所以 `--force` 覆盖安装不会冲掉配置。

## 4. 生效（apply）

应用采用强制的两阶段流程：

1. 「保存并预览」只保存字段并向宿主请求完整的脱敏执行计划，不运行命令、不写目标文件；
2. 面板展示全部 argv、私有目标相对路径、脱敏后的完整文件正文，以及被阻止/跳过的步骤；
3. 只有用户再次点击「我已核对，确认应用」，客户端才带上宿主签发的短期单次确认凭据执行。

确认凭据绑定技能声明与当前配置值，五分钟后失效，并且无论执行成功或失败都只能使用一次。声明、
配置或路径状态在预览后变化时，宿主拒绝执行并要求重新预览。

宿主按声明顺序执行步骤，返回逐步结果（`kind` / 详情 / 成功与否 / 输出尾部）：

- `command`：`spawn(argv[0], argv.slice(1), { cwd, shell: false, timeout })`，输出有上限，
  失败信息回显在面板里；
- `file`：只写 `<image-data-root>/skill-config/<skill>/files/` 内的相对目标；逐级 realpath/lstat
  检查并拒绝符号链接，原子写入后权限强制为 `0600`；
- 返回给浏览器的详情与输出里，**已配置的密钥值会被替换成 `•••`**；
- `command` 的 argv 中引用任何 `secret` 字段都会被拒绝，密钥不会出现在进程列表；
- 没有 `apply` 声明的技能只保存值（靠 `expose` 走提示词，或技能自己读配置文件）。

### 环境变量与临时凭据

对声明了 `openai-images-v1` 的重型技能，Host 会在本次 headless Agent 的作用域内注入
`DSH_IMAGEGEN_BASE_URL` / `DSH_IMAGEGEN_API_KEY` / `DSH_IMAGEGEN_MODEL`。其中 API Key 是随机、短期、
只允许图像生成/编辑端点和本次模型的本机桥接凭据；任务结束、取消、超时或插件卸载都会撤销它。

这三个值不进入浏览器 payload 或 Agent 提示词；提示词只列环境变量名。技能不得打印、记录或持久化这些值。
其他技能若依赖普通配置，仍应在声明里用 `command` 调用自己的 CLI，或提供 `file` 目标；声明里没有通用 `env` kind。

## 5. 界面

- **技能库面板**：每条已安装技能若有声明，展开「配置」：字段表单（密钥输入框只显示
  "已设置/未设置"）、必填标记、说明、`select` 下拉、密钥的「清除」按钮，以及
  「保存」/「保存并预览」。预览完整展示后，还必须再次点击「我已核对，确认应用」，最后展示逐步结果。
- **节点技能菜单**：声明了必填字段但还没值的技能，显示「需要配置：<字段名>」和「去配置」
  按钮（点开技能库并展开该技能）。提示不等于禁用：技能可能在没有该值时也能跑，真正的
  失败仍由运行时给出可读错误。

## 6. 没声明的技能

技能库给一段通用提示：该技能没有声明配置项，如果它有环境变量 / 配置文件 / 自己的 CLI，
可以让 Agent 按它的 `SKILL.md` 配置，或按技能文档手动配置。插件不猜、不擅自写文件。

## 7. 已知边界

- 只有**目录形态**的技能（`<name>/SKILL.md`）能带 `skill.config.json`；扁平 `<name>.md`
  只能命中内置配方。这是 DSH 的布局约束（扁平技能没有自己的目录）。
- `command` 只支持可执行文件（无 shell）；Windows 上 `.cmd`/`.bat` 包装器需要技能提供
  `.exe` 或 `.py` + 解释器形式的 argv。
- 为避免进程列表泄密，`command.argv` 不支持 `secret` 占位符；旧声明必须迁移到私有文件或宿主
  明确提供的运行期环境变量。
- 同名的两个写入者（两个标签页同时保存）以后写为准；保存接口每次返回刷新后的技能库。
