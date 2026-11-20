# e宝本地欢迎页适配

该目录保留旧版 e宝 欢迎页品牌适配源码。当前官方 DeepSeek Harness Desktop 直接提供欢迎页、登录、API Key 和认证 IPC，默认构建不会加载本适配。

官方欢迎页通过根目录 `corepack yarn dev` 或 `corepack yarn start` 验收。自定义插件和品牌扩展需要单独接入官方 Profile，并完成独立的构建、功能和 UI 回归。
