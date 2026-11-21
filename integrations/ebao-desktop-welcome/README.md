# e宝本地欢迎页适配

该目录包含 e宝工坊欢迎页品牌适配源码。启动器会在官方 Desktop 最后一次构建后生成欢迎页资源，保留官方认证 IPC 和 API Key 流程，并将默认登录接到 CQAI 账号 provider。

官方欢迎页通过根目录 `corepack yarn dev` 或 `corepack yarn start` 验收。生成资源位于忽略的官方 Desktop `lib/welcome` 目录，不能在官方构建完成前生成，否则会被上游构建覆盖。
