# 章鱼料理研究会（Octopus Culinary Research Society）

一套克苏鲁式 d100 恐怖规则的 Foundry VTT 系统底座：百分位检定、理智值、运气、
职业创建、技能成长、守密人工具——为"克苏鲁D100"玩法自研的起点。

> 本项目是 **[cragstone/brp](https://github.com/cragstone/brp)（Basic Role Playing for
> Foundry VTT）的 fork**，fork 基点为上游 tag `13.57`（commit `d8e2b4c`，Foundry V13 线，
> verified 13.351）。感谢上游项目开源了整洁的 d100 引擎实现。

## Fork 信息

- **基点**：`upstream/13.57` = `d8e2b4c`；上游 remote 名为 `upstream`
  （`git remote add upstream https://github.com/cragstone/brp.git`）。
- **包 id 保持 `brp` 不变**（系统内部 settings 命名空间 / i18n 键 / BRPID 概念与 id 绑定，
  改名留待独立任务）；显示名（title）已改为「章鱼料理研究会」。与上游 brp 系统同装会
  目录冲突，二选一安装。
- **版本号独立演进**（从 0.1.0 起），不复用上游版本序列。
- **packs/ 已移除**：上游 LICENSE.txt 将 packs 目录排除在 MIT 之外（Chaosium 条款），
  该包（brp-id-macros 先攻宏）为规避许可歧义不随本 fork 分发。

## 致谢（Credits）

- **[BRP for Foundry VTT](https://github.com/cragstone/brp)** — Dangermouse、JamesB
  及贡献者：本项目的代码底座，MIT。
- **[Boilerplate System](https://github.com/Asacolips/projects)** — Asacolips Projects /
  Foundry Mods：上游项目的系统模板底座，MIT。
- **Chaosium Inc.** — 规则文本来源《Basic Roleplaying: Universal Game Engine》ORC SRD
  （见下节）；"Basic Roleplaying" 与 "Call of Cthulhu" 等名称与商标归 Chaosium 所有，
  本项目与 Chaosium 无关联，亦不使用其商标。

## 许可

- **代码**：MIT，见 [LICENSE.txt](LICENSE.txt)（原样保留上游署名链：Genii-Locorum +
  Asacolips boilerplate 两段）。
- **规则文本（现在与未来）**：本系统未来内置的规则描述文本若引用/改写自 BRP:UGE 的
  ORC Content Document，将按 ORC 许可要求随包附带 ORC 许可文本与 Licensed Content
  声明（当前版本尚未内置任何 SRD 文本）。

**BRP: Universal Game Engine Notice（上游原样保留）**

This product is licensed under the ORC License held in the License of Congress at
TX000 [number tbd] and available online at various locations including
www.chaosium.com/orclicense, www.azoralaw.com/orclicense, www.gencon.com/orclicense
and others. All warranties are disclaimed as set forth therein. This product is the
original work of Chaosium.

If you use our ORC Content, please also credit us as follows:

![Chaosium ORC credit](https://github.com/Genii-Locorum/brp/assets/121451824/ca848b0d-40a6-4fd1-ab73-81c48e243b99)

## 路线图（克苏鲁D100 专属层）

在 BRP d100 骨架上叠加六件套（挂点评估见 mt-foundry-compat 仓
`research/rules-brp` 分支 `docs/rules-integration/brp-report.md` §10）：

1. SAN 全链（actor 派生位 + 检定族：损失/临时疯狂/不定疯狂）
2. Luck 消费与重掷
3. 职业创建（profession 技能配额 + 信用等级）
4. 技能成长（dev phase 增益语义改造）
5. Keeper 守密人工具（批量检定/小组面板）
6. 恐惧症/躁狂（persTrait 对立面双轴复用）

## 开发

在 mt-foundry-compat 兼容层下无头开发：把本目录内容放进
`mt-foundry-compat/web/packages/brp/`，用 `MT_SYSTEM_ID=brp` 跑
`node --experimental-vm-modules tools/run-headless.mjs`。
