# e宝本地欢迎页适配

本目录只维护源码运行时的欢迎/登录页呈现：e宝机器人标志、e宝工坊标题、说明和登录按钮文案。登录继续进入 CQAI 授权，API Key 选项明确标注 DeepSeek。主工作区、Dock 和应用菜单仍使用官方身份。

## 实现与构建顺序

- 复用固定官方 Desktop 的 `WelcomePage.tsx`、renderer 入口和 sandboxed preload，不重新实现登录状态机或认证 IPC。
- `presentation.mjs` 包装 messages，保留原 API 的方法与账号状态。
- 构建转换只替换唯一品牌节点，并包装唯一 Welcome mount。两个接缝都要求恰好匹配一次；上游变化导致标记缺失或重复时拒绝构建，等待人工审查。
- e宝机器人图片取自现有静态资源，不加载旧 presentation 插件或社区桌面壳。
- 只写入官方忽略的 `deepseek-harness/apps/desktop/lib/welcome` 构建产物，不改官方 tracked 源码或用户数据。

从仓库根目录运行：

```bash
corepack yarn build
corepack yarn start
```

根 build 在官方 artifacts 构建后应用本适配。根 dev 的顺序为官方构建、欢迎页适配、官方 start；根 start 对已有官方产物应用适配，不触发上游重建。官方后续重建会覆盖 welcome 产物，因此必须最后应用本适配。

## 验证与发行

构建/测试需检查标记唯一性、未改动官方源码、保留 preload API、品牌文案和明确的 DeepSeek API Key 说明。图形欢迎页、真实 CQAI 授权和模型请求分别验收；构建成功不代表用户已经登录。

当前仅接入源码 build/dev/start。根未签名打包入口仍是纯官方打包，不包含本适配或 CQAI provider；产品安装包、全应用身份、更新和发行需后续单独适配。本次不发布新安装包。
