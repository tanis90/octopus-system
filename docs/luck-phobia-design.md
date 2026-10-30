# Luck 与恐惧症/躁狂 设计（六件套 #2 + #6）

状态：已拍板 v1 · 2026-10-24 · 分支 `feature/luck-phobia`（基于含 SAN 链的 main）

## Luck（克苏鲁D100 扩展层）

**许可口径**：ORC SRD 中 Luck 仅为「POW×5 特征掷」（fork 已有该派生位，标签
`BRP.StatsPowDeriv`）。**「运气分值与消费」不是 ORC 内容**——机制不受版权保护、
我们自创实现（行为参考 CoC 7e 桌面惯例），数值与文案全部自定，无 ORC 义务。

### 数据模型

`system.luck`：`value` / `max`。`max` = 建卡快照 POW×5（同 `sanity.starting`
模式：建卡定死，此后 POW 变化不改）；`value` 只降不升（keeper 手动恢复除外，
上限 max）。建卡与掷属性初始化路径复用 `initSanity` 的四点挂接模式。

### 消费交互（核心）

任意本系统 d100 检定卡（`roll-result.html` 家族）上，对卡内**属于自己**
（GM 可任意）的演员掷骰提供降档按钮组：`-1` / `-5` / `-10` / 自填：

- 每次消费：`luck.value -= n`（clamp ≥0，不足按余量）+ 该 roll 的
  `rawScore -= n`，**成功等级按新值就地重算**（flags 更新 + 卡重渲染）；
- 原始值留痕：`originalRawScore` 保留首次值，卡面显示"运气调整后"标记；
- SN 检定同样可花（降值可把失败改成成功=掉小值）；
- 纯函数内核 `applyLuck(actor, cardIndex, amount) → {luck, roll}`，不碰 DOM，
  按钮只是驱动面（同 `resolveMadness` 惯例）。

**多客户端单写者（0.3.1-dev）**：聊天卡按钮统一路由到 Foundry 的
`game.users.activeGM`（core 语义：最高角色、同角色取最小 user id，见
`client/documents/collections/users.mjs`），由该客户端的 `BRPLuck._spendChain`
串行执行读改写；不新增后端端点。`applyLuck` 仍是无锁纯函数，SN 差额回补不变。

### 两个明确不做（v1）

1. **不做运气重掷**：7e 桌面本体是"降值"不是"重掷"；重掷归入将来的
   push 检定机制（不在六件套）。
2. **不做自动恢复**：恢复 = keeper 在角色卡 luck 区手动调整（无奖励结算 UI）。

## 恐惧症/躁狂（persTrait 复用）

1. `persTrait` 加 `system.traitType: 'trait' | 'phobia' | 'mania'`（默认
   `trait`，存量零迁移）；卡面上一个下拉 + i18n 标签。
2. 疯狂表现六档文案改写为含**一档恐惧症风味、一档躁狂风味**（全部自写替换，
   index 映射保持 1-6 不变）；这两档发作的卡上出现
   **「为其建恐惧症/躁狂特质」按钮** → 打开 persTrait 预填创建窗
   （traitType 预选、挂在发作角色），keeper 确认才创建——**不自动建**。
3. 既有 `madness-phobia-hint`（v1 仅提示）升级为上述真实创建入口。
4. 机制绑定（面对恐惧源的惩罚等）后置 v2。

## 验证（无头不变量 + 浏览器点击）

- Luck：①建卡 max=POW×5 快照、POW 后变不改 ②消费降值重算成功等级
  （失败→成功案例）③clamp 余量 ④originalRawScore 留痕 ⑤恢复钳 max
  ⑥SN 卡可消费；纯函数直测。
- 恐惧症：⑦两风味档触发创建钮 ⑧预填 traitType 正确 ⑨persTrait 持久化
  ⑩存量 persTrait 无 traitType 时回读为 trait。
- 回归：SAN 24+2 不变量、12 项 d100 不变量、run-headless 报错 0。
- 浏览器：真实点击一次「-5 花运气」按钮与「建特质」按钮（.message 包装
  + data-message-id 构造，照 SAN 验收先例）。
