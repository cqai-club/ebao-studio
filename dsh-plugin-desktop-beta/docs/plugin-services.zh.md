# 新版桌面插件服务

[English](plugin-services.md) | 中文

Stable 与 Beta 已使用独立 Host 架构。旧版桌面 Cordis 插件的完整原生运行时 API 不再是公开扩展约定。`dsh-desktop-shared` 内的旧版共享源码仅提供实现支持，不运行第二套桌面壳。

应用能力 bundle 提供：

- `desktopProfiles.current`：当前 Profile 名称与目录。
- `desktopPnpm`：使用所选 Profile 和内置 pnpm 的可取消包执行器。官方插件操作继续执行原有的状态协调。
- `desktopPermissions`：针对具名系统权限操作的私有 Host 到主进程桥接。
- `desktopActions`：重启及受支持的终端操作。
- `desktopRuntime`：e宝工坊内部账号与发布器适配层，不提供通用原生代码或文件系统调用。

账号适配层只打开 HTTPS 目标和用于开发回调的 loopback HTTP，并可聚焦应用。发布器只接受具名 Worker 操作，对 IPC 请求设大小限制，传递取消信号，并在 Host 释放时停止请求。原生选择的视频保留在主进程；使用方仅获得不透明 ID 与有上限的 base64 分块。

渲染进程不获得 Node 或 Electron 权限。已有功能插件通过官方 Web 客户端 Loader 和约定插槽注册。功能 Host 失败时，恢复、Profile 选择与数据目录控制仍保持可用。

产品 bundle 通过应用自有 Profile 层组合；用户 patch 在其后应用。包管理与 HMR 重新安装该层，不重写用户的 bundle manifest。安全模式排除产品 bundle。
