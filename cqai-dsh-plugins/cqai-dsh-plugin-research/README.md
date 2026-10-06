# cqai-dsh-plugin-research · e研宝

学术研究数字员工。把开源项目
[academic-research-skills](https://github.com/Imbad0202/academic-research-skills)
（作者 Cheng-I Wu，CC-BY-NC-4.0）的四套技能接成易宝工坊里的一个工作台面板。

## 它在产品里是什么

| 位置 | 标识 |
| --- | --- |
| 侧边栏入口 | `sidebar.panellist` id `cqai-research`，order 44 |
| 主面板 | `main` key `cqai-research` |
| 首页数字员工卡片 | id `cqai-research`，标题「e研宝」 |

原来首页那张 `planned:writing`「e文宝」占位卡是另一个产品（内容写作与整理），本插件
不占用它；卡片由 `cqai-dsh-plugin-desktop-presentation` 按 `sidebar.panellist`
的标签自动生成，标签为「e研宝」时不会与既有占位卡合并。

## 技能从哪来

插件不打包任何技能正文。它读取 Harness 已安装的技能注册表：

- 用户级技能根：`~/.dsh/skills`（本机已装入 `academic-research-skills`）
- 四个技能名：`deep-research`、`academic-paper`、`academic-paper-reviewer`、`academic-pipeline`

因此上游更新技能时，面板会自动反映最新状态，不需要重新发版。

## 使用方式

1. 打开侧边栏的「e研宝」。
2. 选择需要的技能，点「复制调用指令」。
3. 把指令连同你的题目一起发给 e宝对话，技能会被加载并按其流程执行。

## HTTP 接口（仅本机回环）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/cqai-research/catalog` | 四个技能的安装状态与上游信息 |
| GET | `/api/cqai-research/skill?name=<skill>` | 预览某个技能的全文（截断到 200k 字符） |

两个接口都只接受来自 `127.0.0.1` / `::1` 的请求。

## 开发

```bash
corepack yarn workspace cqai-dsh-plugin-research build
corepack yarn workspace cqai-dsh-plugin-research typecheck
```

## 许可与归属

插件代码 MIT。被调用的技能内容来自 academic-research-skills，按 CC-BY-NC-4.0
授权，不得用于商业用途；内容与版权归原作者所有。
