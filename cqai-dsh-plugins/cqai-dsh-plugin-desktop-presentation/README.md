# Desktop 空会话首页呈现

本插件在官方 Desktop 的空会话中呈现 e宝首页。机器人周围的彩色图标打开已注册的数字员工主面板，相关插件未启用时入口显示禁用状态。欢迎气泡展示问候语、已启用员工的能力和当天提示，并遵循系统的减少动态效果设置。PPT 模式使用紧凑标题，为模板和原生输入框保留空间。

产品功能卡片打开当前已注册的主面板；未安装的设计示意卡片没有跳转。已注册员工的卡片复用其侧栏图标，待上线员工使用语义线性图标，卡片尺寸采用紧凑横向比例。活动 Profile 中其他插件只要提供主面板和侧栏标签，也会作为卡片出现。首页排序和隐藏只影响当前 Profile 的入口排列，不改变插件启停。

数字员工卡片使用透明主体插画，卡片底色、文字和操作色由主题变量控制。每张卡片都用与插画呼应的双色渐变：浅色模式从可读的浅彩色过渡到更鲜明的颜色，深色模式使用对应的深彩色。e图宝、e剪宝、短视频制作、口播视频制作和多平台发布各有专属插画；其他员工根据面板 ID 稳定选用三张通用插画。图片和生成说明见 [assets/covers](./assets/README.md)。插画随 Client bundle 内嵌，无需单独提供静态资源路由。主题可通过 `--ebao-home-card-fill`、`--ebao-home-card-label`、`--ebao-home-card-muted` 和 `--ebao-home-card-action` 分别覆盖卡片底色与文字色；通过 `--ebao-home-card-theme-gradient-start`、`--ebao-home-card-theme-gradient-end` 统一调整渐变，也可为单张图设置 `--ebao-home-card-<封面 ID>-gradient-start/end`。原有 `--ebao-home-card-theme-tint` 仍可统一设置单一色相。
