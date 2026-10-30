# ORC Notice — 章鱼料理基础包（octopus-skills / octopus-professions）

本产品依 **ORC 许可证**（License of Congress 登记号 TX 9-307-067，全文见
www.chaosium.com/orclicense / www.azoralaw.com/orclicense / www.paizo.com/orclicense
等处）授权。所有担保依该许可证免责声明免除。

## Licensed Content 声明

`packs/octopus-skills`、`packs/octopus-professions`（及其 `packs-json`/`packs-index`
派生格式）与 `content/*.zh-CN.json` 中的规则内容，改写自 Chaosium Inc.
*Basic Roleplaying: Universal Game Engine* 的 **ORC Content Document**，使用章节：

- Chapter 2: *Characters* — Professions（职业节：描述/财富口径/技能清单）
- Chapter 3: *Skills* — Skill Descriptions（技能名/基础值/分类/描述）

文本经由 [raleel/brpugesrd](https://github.com/raleel/brpugesrd)（commit
见 `content/provenance.json`）提取并译为简体中文。数据结构、代码与打包格式为
本项目原创（MIT，见 [LICENSE.txt](LICENSE.txt)）。

## 署名（Credit）

**Basic Roleplaying: Universal Game Engine** © Chaosium Inc. — 规则文本 Licensor。
按 Chaosium 的 ORC 使用指引致谢：

> This product is licensed under the ORC License held in the License of Congress
> at TX 9-307-067. It is the original work of Chaosium.

**未获授权且明确不使用**：Chaosium 商标（Basic Roleplaying™ / Call of Cthulhu™）、
其他 Chaosium 产品线内容（信用评级/克苏鲁神话技能/官方冒险等 Prohibited Content）。

## 独立 CoC 数据包（不属于 ORC 授权）

`packs/coc-skills`、`packs-json/coc-skills.json`、`packs-index/coc-skills.json`、
`packs/coc-professions`（及对应 `packs-json`/`packs-index`）与 `content/coc/` 是独立的
CoC 7e 事实数据，**不属于上述 ORC Licensed Content**，也不由 ORC 许可证覆盖。其数值/
公式只来自官方公开规则页、公开二手页与用户仓库，文案与代码自写；未提交官方 PDF、
正文、图片或字体。VTT 使用与公开发布的授权问题仍需单独评审（见
`docs/coc-compatibility-contract.md`）。

## 可选扩展（不属于 ORC 授权，也不随系统默认分发）

sibling 分发仓 `../arcane-investigator-options/`（「章鱼调查员扩展资料包」）及其两个
Item 包 `arcane-investigator-skills`（31 条技能）与
`arcane-investigator-professions`（148 个职业）：

- 不是 Chaosium 官方产品，不是 CoC SRD，也不由 ORC 许可证覆盖；不声称任何官方授权。
- 只在模块存在并被加载时出现；`system.json` 不登记这两个包，撤下模块即回到核心
  60 技能 / 9 职业入口。
- 标准 MIT 仅覆盖该仓的原创代码与原创文案（manifest、打包脚本、README/NOTICE、
  自写的中文描述与结构化字段）。**SealDice builtins、coc-cardwright、Roll20 /
  Chaosium wiki 等第三方事实不因这份 MIT 声明获得 MIT 授权**，权利仍归各自权利人。
- 未复制任何第三方原文：没有 SealDice JSON/helpdoc 正文、没有 coc-cardwright 模板或
  代码、没有官方 PDF/正文/图片/字体。
- 公开分发是维护者决定，不声称第三方事实已获授权，也不保证无法律风险；收到权利人异议时
  停止仓库与 Release。删除不会撤回已经分发的副本，也不清除既有 git 历史。
  详见 `../arcane-investigator-options/NOTICE.md`。
