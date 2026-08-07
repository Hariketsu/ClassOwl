# ClassOwl 设计系统

> 视觉权威文档。`frontend/src/styles.css` 与 `frontend/src/plan-center.css` 的令牌以本文件为准。
> 设计语言走「Clay 风」暖调路线：奶油底、大圆角、暖色柔影、克制的色彩纪律。

## 色彩角色（三色纪律）

- **Coral `#ff6b5a`（--primary）** — 唯一主行动色。每屏一处：主按钮、当前步骤序号、进度当前段。
- **深 Teal `#0d7a6f`（--blue，令牌名为历史遗留）** — 交互语义色：文字链接、选中/active 态、focus 环、checkbox/radio/switch 的 accent、信息徽章（如「已排 N」）。不做大面积填充，不是行动色。
  配套：`--blue-active #0a6358`、`--blue-soft #e5f1ee`、`--blue-border #9dcec2`。
- **品牌饱和色（coral/pink/lavender/peach/ochre/mint）** — 只进「呼吸区」（方案中心身份块等装饰位），不进排课工作区网格：拖拽四态与课程色板已用颜色表达语义。
- **语义色（green/orange/red）** — 成功/警告/错误，按 soft/border/文字三件套使用。绿为暖叶绿 `#3e7a45`。
  后台同步状态（如顶栏「已保存」）不是成功庆祝，用中性灰 `--muted`；只有保存失败才用红。

## 表面与质感

- 画布为奶油调白（cream canvas），不用冷灰；遮罩与阴影一律暖棕调（如 `rgba(61,50,36,…)`），不用冷蓝灰。
- 圆角刻度：`--radius-md` / `--radius-lg`（12px）为主，卡片与弹窗圆角一致。
- 弹卡（Modal/Drawer）为悬浮圆角卡片：暖色半透遮罩 + 轻微背景模糊 + 分层暖影，进出场用短动画（≤200ms），`prefers-reduced-motion` 时关闭。

## 选中态

- 列表选中 = 暖沙底 `--surface-strong` + `--ink` 字 + teal 左指示条（Step3 条件类型 nav 用 border-left，Step4 班级树用 inset box-shadow）。
- 不用 teal-soft 浅底做选中——那是「SaaS 默认浅蓝」观感。

## 表单控件

- 全站 checkbox/radio/switch 用 `accent-color: var(--blue)`（teal），不允许 Chromium 默认蓝出现。

---

*历史注：本文件由内部 `DESIGN-Clay.md` 的 ClassOwl 产品决策章节提取而来（2026-08-07 定稿），原文件含外部设计分析，未随仓库公开。*
