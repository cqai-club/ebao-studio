# Desktop 空会话首页呈现

本插件只在 Desktop 的扩展模式和增强模式呈现空会话首页。标准模式的顶部标题区展示 E宝机器人透明插画，并复用已安装数字员工的侧栏图标作前后景缓慢漂浮；原生的左侧品牌标记与预览徽标在这一区域隐藏。PPT 模式仍显示紧凑文字标题，保留原有输入框和模板空间。工作区、模式、PPT 和输入框继续由原生界面负责。正式布局见 [设计稿](../../docs/desktop-empty-home-design.md)。兼容模式使用上游默认页面。动效会遵循系统的「减少动态效果」设置。

产品功能卡片打开当前已注册的主面板；未安装的设计示意卡片没有跳转。已注册员工的卡片复用其侧栏图标，待上线员工使用语义线性图标，卡片尺寸采用紧凑横向比例。活动 Profile 中其他插件只要提供主面板和侧栏标签，也会作为卡片出现。首页排序和隐藏只影响当前 Profile 的入口排列，不改变插件启停。

数字员工卡片使用透明主体插画，卡片底色、文字和操作色由主题变量控制。每张卡片都用与插画呼应的双色渐变：浅色模式从可读的浅彩色过渡到更鲜明的颜色，深色模式使用对应的深彩色。e图宝、e剪宝、短视频制作、口播视频制作和多平台发布各有专属插画；其他员工根据面板 ID 稳定选用三张通用插画。图片和生成说明见 [assets/covers](./assets/README.md)。插画随 Client bundle 内嵌，无需单独提供静态资源路由。主题可通过 `--ebao-home-card-fill`、`--ebao-home-card-label`、`--ebao-home-card-muted` 和 `--ebao-home-card-action` 分别覆盖卡片底色与文字色；通过 `--ebao-home-card-theme-gradient-start`、`--ebao-home-card-theme-gradient-end` 统一调整渐变，也可为单张图设置 `--ebao-home-card-<封面 ID>-gradient-start/end`。原有 `--ebao-home-card-theme-tint` 仍可统一设置单一色相。
