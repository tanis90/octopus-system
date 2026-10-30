# Sanity Chain Design（SAN 链设计）

状态：已拍板 v1 · 2026-10-24 · 分支 `feature/sanity-chain`

规则文本依据：BRP:UGE ORC SRD p259-261（Sanity 可选系统）。机制照 SRD 实现；
**v1 不捆绑任何 SRD 成文文本**（见「已拍板决定」#1），故不触发 ORC NOTICE。

## 已拍板决定

1. **不内置 roll table**（宿主 VTT 不支持 roll table 文档）：疯狂表现 d6 / 时长 d8
   由代码侧直掷、结果渲染进聊天卡，keeper 可改判；表现文案自写六条（自有神话皮）。
   恐怖源损失表（SRD p261）不做成内容，keeper 在检定卡手填成对公式或从纯公式
   预设下拉选择（公式属机制，不带 SRD 行标签）。**v1 包内零 ORC Licensed Content，
   ORC NOTICE 义务推迟。**
2. **两态疯狂**：`tempInsane`（限时）+ `permaInsane`（SAN=0 永久退场）。
   不设"不定疯狂"（CoC 7e 表述，非 SRD 内容）。

## 数据模型（M1）

`system.sanity` 在既有 `value` / `max` 基础上补：

| 字段 | 语义 | 写入时机 |
|---|---|---|
| `starting` | 建卡快照 = POW×5，此后 POW 变化不改 | 建卡时 |
| `tis` | 临时疯狂阈值 = starting/2（永久）；setting 开关 `普通人口径 TIS=POW` | 建卡时 |
| `dailyLoss` | 当日累计损失，keeper「新的一天」按钮清零 | 每次损失 |

派生链：`max = min(starting, 100 − loreSkillPercent)`；`loreSkill` 为 setting
指定的技能 id（默认指向自建"禁忌学识"技能），技能成长联动 max 永久下降。
不变量：`0 ≤ value ≤ max`。

**语义修正**：上游 `updateVitals()` 将 `sanity.value` 与 HP 一起重置——重掷属性
会回满 SAN。改为：SAN 仅建卡初始化置满，`updateVitals()` 不再触碰 sanity。

## 检定与损失链（M2）

`module/apps/check.mjs` 新增 rollType `'SN'`：

- targetScore = 当前 `sanity.value`（走 characteristic 通道，非 skill）
- 检定卡带成对损失公式（`success/fail`，如 `1/1d6`；纯公式预设 + 手填）
- 结算：成功掉小值、失败掉大值，自动写回并 clamp ≥0，累加 `dailyLoss`
- 归零 → `permaInsane` 状态 + keeper 提示（SRD：退场或转 NPC）
- NPC 第一版不做恐怖等级字段，公式 keeper 填

## 疯狂状态机与承接交互（M3）

### 状态

- `tempInsane`：触发 = `dailyLoss ≥ tis` → 疯狂发作（见下）
- `permaInsane`：SAN=0 即挂，不可恢复（SRD：仅重大剧情干预）
- 表现掷出「恐惧症」档位时：卡上提示 keeper 建对立面 persTrait 物品挂角色
  （与六件套 #6 恐惧症/躁狂的咬合点，v1 只做提示不自动建）

### 承接交互（已定稿 2026-10-24）：OPCard 式同卡追加段

沿用系统自家 `module/cards/opposed-card.mjs` 的「flags 存态 + 就地更新」惯例，
不发明新模式、不开对话框、不做宿主面板：

1. SAN 检定卡结算时检测 `dailyLoss ≥ tis` → **同一张卡**的 flags（`flags.brp.madness`）
   追加疯狂发作段，**d6 表现 + d8 时长已掷好**——keeper 打开卡即可念结果；
2. 可见性分层：**表现结果公开**（玩家表演素材）；**时长数值与操作按钮 keeper-only**；
3. keeper 按钮组（均为 OPCard 式 static 方法改 flags 重渲染）：
   `重掷表现` / `重掷时长` / `手填时长` / `提前结束`（撤销 effect）；
4. d6 落「恐惧症」档 → 卡上浮现「为其建恐惧症特质」提示钮（v1 仅提示）；
5. `permaInsane` 不走交互——无操作公告卡（终局时刻）。

**逻辑层与卡面解耦（工程铁律）**：结算核心为纯函数
`resolveMadness(actor) → {manifestation, duration, effectData}`，不碰 DOM；
聊天卡按钮只是驱动面之一。若宿主 VTT 聊天面对系统卡按钮绑定不灵（待验证项），
降级为 keeper 小对话框（ApplicationV2），逻辑层零改动。

**验收补条**：M2 收尾在本地浏览器栈（serve.mjs + sandbox/play 页）人工点一次
卡上按钮确认真机链路；无头验收走纯函数 + flags 断言（无头不测点击）。

系统当前 0 个状态效果——本特性引入前两个，注册形态对齐
`module/apps/active-effect.mjs` 既有结构。

## Keeper 批量与恢复（M4/M5，第二周）

- 全组 SAN 检定面板（复用 check 批量 + 聚合聊天卡）
- 「新的一天」重置 dailyLoss；恢复 = keeper 调整 + 理由记账（flag 简史）
- lore 技能成长 → max 联动下降

**0.3.1-dev 最小实现**：角色/NPC 卡的 SAN 行提供 GM-only「新的一天」按钮
（`BRPActorSheetV2._onSanityResetDaily`），只清零 `system.sanity.dailyLoss`，
不动当前 SAN 与本日已发作的 episode；全组面板与恢复记账仍未实现。`tempInsane`
ActiveEffect 被删除、禁用或世界时间到期时，`BRPMadness.endOpenCards` 会把对应
发作卡标记 `ended` 并重渲染，避免卡面继续显示 keeper 按钮。

## 验证

无头探针（宿主 mt-foundry-compat 研究栈 `tools/brp-spike-eval.js` 扩展）不变量组：

1. 建卡 starting = POW×5；2. tis = starting/2（含 POW 口径开关档）；3. max 钳制
（lore 技能抬升后 max 下降）；4. 损失 clamp（不足不减到负）；5. dailyLoss 累加与
重置；6. 达 TIS 触发 tempInsane（时长 ∈ 表）；7. SAN=0 触发 permaInsane；
8. updateVitals 重掷属性后 SAN 不回满（回归修正断言）；9. 既有 d100 检定 12 项
不变量不回归；10. SN 卡渲染零报错；11. GM「新的一天」只清零 dailyLoss；12. 删除/
禁用/世界时间到期 tempInsane 时发作卡 `ended=true` 且内容重渲染。

## 许可纪律

- 机制照 SRD，文案全部自写（en.json 新键为主，zh-CN 整文件翻译后置）
- CoC7 仅作行为参照：不抄其文案 / 代码 / 字段命名
- 将来若内置 SRD 表文本 → 按仓库 README 预留机制补 ORC NOTICE（v1 不触发）
