# 纸墨角色卡设计系统

## 现有项目依据

- Token：`web/ui-tokens.css`
- 浮窗：`web/compat-ui.css`
- 角色卡：`css/coc-card.css`、`css/brp.css`
- 当前卡截图：`/tmp/coc-window-controls-character.png`
- 参考项目截图：`/tmp/coc7-tidy-investigator-reference-20261101/docs/screenshots/`

## 冻结值

- 纸深 `#eae3d0`；纸面 `#f2ede1`；白化纸 `#faf7ee`。
- 墨 `#16130f`；淡墨 `#57503f`；CoC 牛血红 `rgb(68, 7, 4)` / `#440704`。
- 危险 `#7a2e22`；成功 `#3f5a3a`；警示 `#6b4f24`。
- 标题/正文：Georgia、Noto Serif SC、Songti SC、SimSun 衬线回退。
- 数字：Roboto Mono、Noto Sans Mono CJK SC、ui-monospace 等宽回退。
- 2px 墨框、零圆角、硬投影 `7px 7px 0 #16130f`；细分隔用墨色半透明线。
- 基础字号 13/14/16/22px；行距采用 4/8/12/16px 节奏。

## 布局与组件

- 信息排列完全遵循 `product-facts.md`，不改变参考项目顺序。
- 视觉不用参考项目的深色漆面、黄铜渐变、盾形徽章和 Art Deco 角饰。
- 特性采用纸面矩形票签；表头采用墨底纸字；当前页签采用墨底纸字；关键链接采用牛血红。
- 窗口右侧仅保留关闭，沿用刚完成的头部调整。

## 变体

- A 经典档案：默认纸墨、34px 表格行、宽松横幅。
- B 紧凑桌面：相同信息顺序，28px 行、收窄间距与横幅，适合频繁操作。
- C 墨印高对比：更白纸面、更重墨块与数字、更强当前态，不引入新颜色。

## NPC 与载具扩展

- NPC：全宽主区、无收藏侧栏；六页签，默认战斗；战斗数值使用与表格一致的墨线速览条，不增加新色彩。
- 载具：单页紧凑档案，不放置人物特性、技能、武器或状态；以耐久和乘员信息为主。
- 两类卡共享 A/B/C 三变体，变化只涉及密度、纸面和对比，不改变字段顺序。

## 本地素材

- 角色头像：`assets/investigator-portrait.jpg`。
- 生物头像：`assets/creature-portrait.jpg`。
- 载具图片：`assets/vehicle-portrait.jpg`。
- 图片均取自用户本地 CoC 世界素材，仅用于本地设计稿；不使用外链字体、图片、脚本或样式。
