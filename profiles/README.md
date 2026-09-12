# CQAI Profiles

Profile 只负责组合已安装的插件，不放置插件业务源码。

当前开发 Profile：

```text
cqai-dsh-plugin-desktop/
```

后续如果需要不同产品组合，可以增加：

```text
cqai-dsh-plugin-desktop-minimal/
cqai-dsh-plugin-desktop-market/
cqai-dsh-plugin-desktop-dev/
```

Profile 目录不加入 `dsh-desktop` 根 Yarn workspace，避免把 DSH 运行时依赖和 CQAI 插件开发依赖混在一起。
