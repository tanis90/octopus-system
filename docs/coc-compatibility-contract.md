# CoC 7e 兼容契约（M1 + M2 + M3 + M4 + M5 + M6 + M7 + M8 源仓切片）

状态：实验性第八期源仓切片（2026-10-30）。M4 完成原生 SAN/疯狂、Luck 消费与恢复、
技能成长和持久化 CoC 世界时钟的源仓实现与无头集成探针（真实 `Roll`、真实 Actor/
ChatMessage/flags/ActiveEffect、activeGM 单写与串行 relay）。源仓切片当时只改源仓、
源仓测试与文档，只在临时 compat 镜像验证，未改前端/后端、未 commit/push/部署、未跑
浏览器 E2E；随后主代理已把本仓内容同步到 compat 的 `web/packages/brp`，并完成正式 compat
无头 161/161、`npm test`、M4 前端/真实多端场景 58/58 与全场景 423/423。这不是
“完整 CoC 已上线”的声明，也不覆盖真实 Keycloak、生产部署或可选规则。

M5（2026-10-30）在本源仓追加 5 条专精与 5 个职业、多公式职业点与对应回归；
M6（2026-10-30）追加 1 条专精（科学（天文学））与第三批 4 个职业（警察（巡警）、
艺术家、神职人员、飞行员），新增 `EDU*2+POW*2` 公式。M5/M6 当时只改源仓，
前端/后端由 compat 仓后续接线。

M7（2026-10-30）把职业/技能事实源切换为用户仓库 `tanis90/coc-cardwright`
revision `c0a0733`（README 自述上游 `trpg-saikou/cochar`），不再用公开职业网页拼表。
本批新增 19 个职业、保留 M6 的 4 条记录并统一来源，合计 **38 个职业**；技能
**59 条 / 21 条专精**；公式白名单 **7 条**。精神病学家已成功落地，不再 deferred；
没有完整八项的职业不导入。`coc-cardwright` 自述 112 个职业，本批**不是 112 全表**，
不宣称全职业覆盖；全部记录仍为 **secondary**，不冒充官方一手。compat 前端已同步本批
并完成真实栈 550/550（dev HS256），证据记在 compat 仓 `PROGRESS.md`；本源仓只对数据、
共享规则与源仓回归负责。

M8（2026-10-30）从 SealDice 内置 `COC职业查询` helpdoc 批量导入能映射的正式定义：
新增 **118** 个职业（合计 **156**）、**32** 条具体技能（合计 **91**）、**29** 条专精
（合计 **50**）；公式白名单仍为 **7** 条，不新增 MAX。79 个别名、3 个格式异常、自定义
模板、非八项、缺公式/信用区间、缺可核基础值与精确重复共 **187** 条按类别记入 deferred。
`sealdice-core` 是 MIT，但 `sealdice-builtins` 未声明许可证：本仓不分发其 JSON/职业
描述，只取公式、信用区间与技能名，描述全部自写；证据仍为 **secondary**。compat 同步
目标为 `web/packages/brp/`，本源仓未执行前端/E2E 验收。

## 目标

在保留 MIT BRP 底座与既有 octopus/UGE 行为的前提下，提供可验证的 CoC 7e 基础片：

- 独立核心技能数据包 `coc-skills` 与职业包 `coc-professions`，与 octopus 包物理隔离。
- 集中式规则接口：派生属性、成功等级、成长、starter 选择。
- 共享纯函数车卡规则（职业点公式、兴趣点、信用评级、专精身份、配点校验）。
- 原生 `BRPCheck` 仍走真实检定链；CoC 只替换判级阈值。
- 新角色 starter 按规则集/内容来源隔离；旧 Actor、导入和 NPC 不迁移。
- M3：原生攻击→闪避/反击/扑掩体→真实伤害→创伤/急救/医学/恢复全链，骰子为真实
  `Roll`，状态写入 `flags.brp.coc.wounds`，跨所有者写走 `activeGM` relay。
- M4：原生理智检定→真实成对损失→单次 ≥5 的真实 INT 检定→1D10 小时/1D10 轮发作；
  日内累计第五阈值→独立不定疯狂；临时/不定/永久并存；Luck 只允许技能/特征 1:1 调值；
  成长按“成功且未花 Luck”勾选；keeper 显式推进小时/天/新会话并持久化 CoC 世界时钟。
- M7：职业/技能事实源切换为 `coc-cardwright`，职业扩到 38、技能 59 / 专精 21、
  公式 7 条；只导入完整八项，不宣称 112 全表或全职业覆盖。
- M8：从 SealDice 内置 helpdoc 批量导入 118 个职业（共 156）、32 条技能（共 91）、
  29 条专精（共 50）；deferred 187 条带类别与原因；不覆盖已有 38 职业，不新增 MAX，
  不复制无许可证 JSON/职业描述。

## 允许来源

只使用官方公开规则事实（数值、公式、字段语义、URL）。M1 使用：

- [官方 7e Standard autocalc 调查员表](https://downloads.chaosium.com/call-of-cthulhu/cha2300-investigator-sheets/CoC7_Investigator_Sheet_Standard_autocalc.pdf)：HP、MP、SAN 上限、MOV、Build/DB、Dodge/母语公式。
- [官方 wiki：Secondary Attributes](https://cthulhuwiki.chaosium.com/investigators/step-two-secondary-attributes.html)
- [官方 wiki：Occupation and Skills](https://cthulhuwiki.chaosium.com/investigators/step-three-occupation-and-skills.html)
- [官方 wiki：The Game System](https://cthulhuwiki.chaosium.com/rules/game-system.html)
- [官方 wiki：Rewards of Success](https://cthulhuwiki.chaosium.com/rules/rewards-of-success.html)
- [官方 1920s 调查员表](https://www.chaosium.com/content/FreePDFs/CoC/Character%20Sheets/1920s/Character%20Sheet%20-%201920s%20-%20basic%20autocalc%20-%20Call%20of%20Cthulhu%207th%20Ed.pdf)：核心技能基础值。
- [官方 Starter Set 预生成角色](https://www.chaosium.com/content/FreePDFs/CoC/CHA23158%20-%20Call%20of%20Cthulhu%20Starter%20Set/CHA23158%20-%20PreGen%20Characters.pdf)：成功/失败/大失败边界。
- [官方 7e Quick-Start](https://www.chaosium.com/content/FreePDFs/CoC/CHA23131%20Call%20of%20Cthulhu%207th%20Edition%20Quick-Start%20Rules.pdf)
- [官方 Legacy AutoCalc 表说明](https://www.chaosium.com/legacy-autocalc-character-sheet-instructions/)

M3 追加（一手官方 wiki，仅取数值/语义事实）：

- [官方 wiki：Combat](https://cthulhuwiki.chaosium.com/rules/combat.html)：先攻、闪避/反击与平局、极难伤害、火器、战技 Build、寡不敌众。
- [官方 wiki：Hit Points, Wounds, and Healing](https://cthulhuwiki.chaosium.com/rules/hit-points-wounds-and-healing.html)：重伤/濒死/即死、急救/医学/周末/自然恢复。

M2 追加（**次级证据**，仅用于职业数据）：

- [Roll20 Compendium 职业索引](https://roll20.net/compendium/coc/Index%3AOccupations)
  与各职业页（Archaeologist、Author、Cat Burglar、Dilettante、Explorer、
  Investigative Journalist、Nurse、Private Investigator、Professor、Soldier）：
  职业点公式、信用评级区间、固定技能与选择组。各页自身标注来源为 Free Basic
  Rules；本仓按次级证据记录，只取数值/公式/技能名，不抄正文或版式。

M5 追加（**全部次级证据**，不声称官方一手）：

- 医生 / 医学博士、警探：Roll20 Compendium 职业属性块（Doctor of Medicine、
  Police Detective），另加 [官方 wiki：Occupation and Skills](https://cthulhuwiki.chaosium.com/investigators/step-three-occupation-and-skills.html)
  的技能清单复述（该页复述的是 Free Quick-Start 职业表）；两者仍只算 secondary。
- 图书管理员、律师、工程师：无授权 compendium 页，改用三处二手交叉核验——
  [Gamers' Plane 7e 职业速查](https://gamersplane.com/games/1581)、
  [callofcthulhu.org.uk 车卡帖](https://www.callofcthulhu.org.uk/pbp/viewtopic.php?t=5927)、
  [RPG Stack 职业参考](https://rpgstack.com/systems/coc7e/occupations)。
  三处一致才收录；三处都不是 Chaosium 出版物，也不当成官方。

M4 追加（M4 纯核与整合的证据分级见 `content/coc/sanity-provenance.json`）：

- [官方 7e Quick-Start](https://www.chaosium.com/content/FreePDFs/CoC/CHA23131%20Call%20of%20Cthulhu%207th%20Edition%20Quick-Start%20Rules.pdf)：
  理智检定用当前 SAN、单次损失 ≥5 触发 INT、INT 成功才临时疯狂 1D10 小时、发作 1D10。
- [官方 wiki: Sanity](https://cthulhuwiki.chaosium.com/rules/sanity.html)：十项发作表、
  1D10 轮、第 9/10 项留下恐惧症/躁狂、临时疯狂结束只保留持久内容。
- [官方 wiki: The Game System](https://cthulhuwiki.chaosium.com/rules/game-system.html)：
  成功才勾成长、难度为 regular/hard/extreme band。
- [官方 wiki: Rewards of Success](https://cthulhuwiki.chaosium.com/rules/rewards-of-success.html)：
  幕末 1D100 严格超过当前值才 +1D10，无 INT 加成。
- [官方免费 The Lightless Beacon](https://www.chaosium.com/content/FreePDFs/WeAreAllUs/2019/The%20Lightless%20Beacon%20-%20Call%20of%20Cthulhu.pdf)：
  Luck 只能 1:1 调整技能骰；不得用于理智检定/损失骰/伤害/武器故障/pushed/大失败。
- [Roll20: Using Luck](https://roll20.net/compendium/coc/Using%20Luck)（**secondary**）：
  自然 01 才是大成功，Luck 调到 01 只是极难成功；新会话 1D100 对当前 Luck，成功
  +2D10+10、失败 +1D10+5、上限 99；Pulp 项与 SAN 减半不启用。

M7 追加（**唯一职业/技能来源，secondary**）：

- [coc-cardwright](https://github.com/tanis90/coc-cardwright)（`tanis90/coc-cardwright`，
  revision `c0a0733`）：M7 的 19 个新职业与 4 个保留职业的公式、信用区间、完整八项
  技能名；科学（动物学）/科学（鉴证）专精。README 自述上游
  [trpg-saikou](https://github.com/masquevil/trpg-saikou) 与
  [cochar](https://github.com/ajwalkiewicz/cochar)，本仓只按 README 声明记录，
  不当作独立一手核验。该仓库是次级转录，不是 Chaosium 官方出版物；不复制其模板、
  HTML/CSS、Python 实现或其他仓代码。

M8 追加（**SealDice 内置 helpdoc，secondary；无许可证声明**）：

- `sealdice/sealdice-builtins` 的 `COC职业查询` helpdoc，本地只读副本
  `/tmp/sealdice-coc-occupations.json`。只取职业点公式、信用区间、技能构成与
  职业名称；helpdoc 的【介绍】正文、JSON 文件与整表均不入库、不发布、不转 MIT。
  `sealdice-core` 的 MIT 许可不延伸到 `sealdice-builtins`；该仓库未声明许可证。
- 79 个别名、3 个格式异常条目、自定义模板、非八项、缺公式/信用区间、缺可核基础值
  与精确重复的记录全部 deferred，逐条原因见 `content/coc/provenance.json`。
- 新增 32 条具体技能的基础值对照用户 `coc-cardwright` 的 `skills.py` 或开放族已核基础值；只发布
  「开放族已有已核基础值 + `skills.py` 有成员值」的专精，不猜值、不写 0。

逐条事实映射见 `content/coc/provenance.json`。

## 禁止来源

- 不读取、不参考、不复制 CoC7-FoundryVTT 或其它 GPL 系统的源码、模板、YAML、资源或实现。
- 不复制 `coc-cardwright` 的模板、HTML/CSS、Python 实现或其他仓代码；只取数值、公式、
  信用区间与技能名。
- 不复制 `sealdice-builtins` 的 JSON、helpdoc 正文或职业描述，也不把该仓库的数据
  标成 MIT；只取公式、信用区间与技能名。
- 不提交官方 PDF、正文块、图片、字体、图标、排版或商标资源。
- 不把 BRP:UGE 的数值/技能/职业改名冒充 CoC。
- 不把本仓代码视为已获得 VTT 授权。Chaosium Fan Material Policy 明确将 VTT 排除在政策覆盖之外；公开发布前需另做许可评审。

## M1 事实

### 核心技能

- 独立包 59 条，其中 21 条专精；每条使用稳定 ASCII `brpid`，专精另有 `specKey`。
  （M1 时为 51 条 / 13 专精，M5 追加 5 条专精，M6 追加 1 条，M7 追加 2 条，见下文各期事实。）
- 已证实基础值示例：Credit Rating 00、Cthulhu Mythos 00、Library Use 20、Fighting (Brawl) 25、Firearms (Handgun) 20、Firearms (Rifle/Shotgun) 25。
- Dodge = ½ DEX；Language (Own) = EDU；两者用原生 `variable` + `baseFormula`，CoC 计算向下取整。
- 未证实的专精（剑/斧/矛/鞭/弓/弩/其他艺术）保留在 `pendingSpecialisms`，基础值为 `null`，不写入包，不写 fixed 0。

### 派生

- HP = `floor((CON + SIZ) / 10)`
- MP = `floor(POW / 5)`
- SAN 起始 = POW；SAN 上限 = `max(99 - Cthulhu Mythos, 0)`
- Luck = 独立 `3D6 × 5`（不是 POW × 5）
- Build/DB 用官方表及 80 点延伸
- MOV 按 DEX/STR/SIZ 比较，再减去年龄修正（40 岁起每十年 -1）
- APP 明确映射原生 `cha`；不创建、不持久化 `stats.app`
- CoC 规则下 EDU 视为启用

### 成功等级

- 01 = 大成功（critical）
- ≤ 1/5 技能 = 极限成功（extreme）
- ≤ 1/2 技能 = 困难成功（hard）
- ≤ 技能 = 常规成功（regular）
- 技能 < 50 时 96–100 为大失败；技能 ≥ 50 时仅 100 为大失败
- 原生 `resultLevel` 仍为 0–4；`successBand()` 提供 CoC 的六档标签。困难与常规在原生数值上都映射为 2，避免破坏既有卡面比较逻辑。

### 成长

- 1D100 超过当前技能值后 +1D10。
- 无 INT/idea 加成。
- 原生 `BRPCharDev` 通过规则接口取成长判定与骰式。

## 隔离与不迁移

- 隐藏 world setting `brp.ruleset`，默认 `octopus`。外部 catalog/settingsSeed 值
  `coc7` 显式映射到内部 `coc` 适配器；`coc` 也接受；未知值回落 `octopus`，不会
  被当作 CoC。
- CoC starter 只取 `flags.brp.contentSource === "coc"` 的技能；octopus 只取未标记/octopus 内容。
- CoC 不附挂 `skillcat`；octopus 保持 57 技能 + 6 分类。
- Brawl：octopus 用 `i.skill.brawl`，CoC 用 `i.skill.coc.fighting-brawl`。
- `fromCompendium`、旧 Actor、世界导入不迁移；NPC 不跑 character starter。
- 既有 PC 双态、徒手武器、`cha` canonical 修复保留。

## M1 未覆盖

- 完整职业创建、信用评级区间、技能点分配（M2 已补）。
- 完整战斗、武器专精、对抗/奖励惩罚骰、创伤（M3 源仓切片已补，见下文；M1 阶段未覆盖）。
- 完整 SAN/疯狂链、幸运消费、恢复（M4 源仓切片已补，见下文；M1 阶段未覆盖）。
- CoC 卡面/前端向导（M1 只做原生 Actor 与原生 `BRPCheck`；M2 起 compat 仓另有 `studio-coc`）。
- 后端 profile/catalog、生产部署、真实 Keycloak 验证。
- 未证实专精的正式数值来源。

## M2 事实（首批职业与配点规则）

### 覆盖范围

- 职业包 `coc-professions` 首批 10 条（M5 后 15 条，M6 后 19 条，M7 后共 38 条），
  独立于 `octopus-professions`：Archaeologist、Author、Cat Burglar、Dilettante、Explorer、
  Investigative Journalist、Nurse、Private Investigator、Professor、Soldier
  （M5/M6/M7 各批见下文事实）。M7 起后续职业事实源为 `coc-cardwright`，首批 10 条仍保留
  原 Roll20/secondary 记录，不改写成一手。
- 数据源：`content/coc/professions.json`；证据：`content/coc/provenance.json`
  的 `coc-roll20-occupations`（Roll20 职业页，页面自身标注 Free Basic Rules），
  证据强度记为 **secondary**，逐职业钉住公式、信用区间与页码。
- 未列出的职业一律不冒充：没有可核对公式或信用区间的职业不进入包，也不能作为
  车卡默认值。

| 职业 | 职业点公式 | 信用评级 |
| --- | --- | --- |
| Archaeologist | `EDU*4` | 10–40 |
| Author | `EDU*4` | 9–30 |
| Cat Burglar | `EDU*2+DEX*2` | 5–40 |
| Dilettante | `EDU*2+APP*2` | 50–99 |
| Explorer | `EDU*2+MAX(APP,DEX,STR)*2` | 55–80 |
| Investigative Journalist | `EDU*4` | 9–30 |
| Nurse | `EDU*4` | 9–30 |
| Private Investigator | `EDU*2+MAX(DEX,STR)*2` | 9–30 |
| Professor | `EDU*4` | 20–70 |
| Soldier | `EDU*2+MAX(DEX,STR)*2` | 9–30 |

> 上表是 M2 时点记录。M7 已把 Explorer 的 `MAX(APP,DEX,STR)`、Private Investigator /
> Soldier 的 `MAX(DEX,STR)` 改为真实二选一/三选一（见 M7 事实），不再发 MAX 点数。

Dilettante 的 Roll20 页正文为空，仅有属性块（信用 50–99、公式、Firearms/Ride、
四个选择组），该记录只依赖属性块。

### 文档形态

- `flags.brp.contentSource = "coc"`；`flags.brp.coc` 保存
  `slug` / `creditMin` / `creditMax` / `pointFormula` / `evidence` /
  `sourceRefs` / `fixedSkillKeys` / `specialismSlots` / `choiceGroups`。
  M5 起多公式职业另有 `pointFormulas`（有序数组），单公式职业不带该键。
- `system.skills` 与 `system.groups` 只用可解析到 `coc-skills` 文档的引用；
  「任意技能」类选择组无法枚举，保留在 `flags.brp.coc.choiceGroups` 供车卡器展开，
  不悄悄缩小原生选择组。
- `system.minWealth`/`maxWealth` 固定为 `0` 且带 `wealthNotApplicable`：
  UGE 财富档不是信用评级，不读不写。

### 共享纯函数 `module/rules/creation.mjs`

无 Foundry 依赖、无 `eval`/`Function`，供 `studio-coc` 直接 import：

- `evaluatePointFormula(formula, stats)`：白名单 AST 求值七个公式（M5 增
  `EDU*2+STR*2`，M6 增 `EDU*2+POW*2`）；未知公式、未知属性、缺失/负数属性一律抛
  `CreationRuleError`（fail closed）。
- `interestPoints(int)`：INT × 2；不是 UGE 的 INT × 10 / 250 点池。
- `validateAllocation({ profession, stats, skills })`：职业点预算、兴趣点预算、
  信用评级（只用职业点、落区间、基础值必须为 0）、克苏鲁神话禁投、缺基础值或
  未证实基础值拒绝（不按 0）、终值 = base + 职业 + 兴趣（折叠进 base 报错）。
  M5 增可选 `pointFormula`：多公式职业必须显式选定，否则 `formula-choice-required`。
  `normalizePointFormulas` / `isSupportedPointFormulas` 为多公式归一与校验。
- `specialismKey` / `specialismBrpid` / `buildSpecialism`：专精身份必须是
  ASCII `parentKey` + `specKey`（`i.skill.coc.<parent>-<spec>`），带
  `chosen`/`specName`/`mainName`；禁止中文 kebab、禁止 `any` 占位、未证实基础值
  必须显式提供且不得为 0。
- 前端导入契约（名字与语义稳定）：
  `import { evaluatePointFormula, interestPoints, validateAllocation } from "../../packages/brp/module/rules/creation.mjs"`。
  专精 key 用 `specialismBrpid`/`specialismKey`，职业文档归一用 `professionRules`。

## M2 未覆盖（M2 时点的本源仓边界；前端已在 compat 仓验收）

- `studio-coc` 车卡向导、卡面适配器、execute/落库链属于 compat 仓，不在本源仓；compat 仓
  已完成并有 `studio-coc-verify` / `studio-coc-browser-verify` / 场景 08 证据。
- 首批之外的职业、职业建议联系人、资产/现金表、完整年龄调整（M5 已补第二批五职业）。
- 完整战斗（M3 已补源仓切片）、SAN/疯狂、Luck 消费与恢复（M4 已补源仓切片）。
- 后端 profile/catalog、生产部署、真实 Keycloak 验证。

## M5 事实（第二批专精与职业、多公式职业点）

### 新增专精（技能 51 → 56，专精 13 → 18）

| 技能 | key | 父族 | 基础值 | 族来源 |
| --- | --- | --- | --- | --- |
| 科学（药学） | `science-pharmacy` | science | 1 | `coc-sheet-1920s` |
| 科学（工程学） | `science-engineering` | science | 1 | 三处二手交叉 |
| 科学（物理学） | `science-physics` | science | 1 | `coc-sheet-1920s` |
| 艺术/手艺（表演） | `art-craft-acting` | art-craft | 5 | `coc-sheet-1920s` |
| 艺术/手艺（技术制图） | `art-craft-technical-drawing` | art-craft | 5 | 三处二手交叉 |

- Science 族基础值 1、Art/Craft 族基础值 5 是对应印刷家庭值，专精继承族基础值；
  族来源登记在 `professions.json` 的 `skillFamilies.*.baseSourceRefs`。
- `skillFamilies.concrete` 与已发布专精双向一致：包里有而族里没有 = 选项永远选不到，
  族里有而包里没有 = 引用悬空，构建与回归都拒绝。
- UGE/octopus 技能集不变（仍 57 条），CoC 专精不写入 octopus 包。

### 第二批职业（职业 10 → 15）

| 职业 | 职业点公式 | 信用评级 | 八项构成 |
| --- | --- | --- | --- |
| 医生（医学博士）Doctor of Medicine | `EDU*4` | 30–80 | 急救、其他语言（拉丁语）、医学、心理学、科学（生物学）、科学（药学）固定 6 + 任意 2 |
| 警探 Police Detective | `EDU*2+DEX*2` **或** `EDU*2+STR*2` | 20–50 | 艺术/手艺（表演）或乔装 1、射击族 1、法律、聆听、心理学、侦查固定 4 + 人际 1 + 任意 1 |
| 图书管理员 Librarian | `EDU*4` | 9–35 | 会计、图书馆使用、母语固定 3 + 其他语言 1 + 任意 4 |
| 律师 Lawyer | `EDU*4` | 30–80 | 会计、法律、图书馆使用、心理学固定 4 + **两项不同**人际 2 + 任意 2 |
| 工程师 Engineer | `EDU*4` | 30–60 | 艺术/手艺（技术制图）、电气维修、图书馆使用、机械维修、操作重型机械、科学（工程学）、科学（物理学）固定 7 + 任意 1 |

- 八项恒等由构建与回归共同锁定：固定技能数 + 各选择组 `choose` 之和必须为 8。
- 警探与私家侦探是两条独立记录：信用区间（20–50 / 9–30）、公式措辞、固定技能
  （警探有聆听、无图书馆使用与摄影；私家侦探有乔装、图书馆使用、摄影）都不同，
  互不别名、互不复用 brpid。
- 律师的「两项人际技能」按产品口径记录为 `choose: 2` + `distinct: true`：从
  魅惑/话术/恐吓/说服中选**两个不同**技能，同名列两次会被拒绝。这是对歧义表述的
  产品解释，已在 `provenance.json` 的 `lawyer.productNote` 里写明。
- 五项均为 `evidence: "secondary"` 且带 `sourceRefs`；不声称官方一手。

### 多公式职业点（后兼容）

- 数据形态：单公式继续用 `pointFormula`；二选一用 `pointFormulas`（有序数组，
  玩家选一条）。两者**不得同时出现**，构建直接失败；`pointFormulas` 少于两项也算
  数据错误（单公式请用 `pointFormula`）。
- 共享白名单新增 `EDU*2+STR*2`（M5 时共 6 条；M6 再增 `EDU*2+POW*2`，现共 7 条）；
  两次都是**新增**，不改任何已有公式的求值结果，回归里 `EDU*4=240`、
  `EDU*2+DEX*2=260`、`EDU*2+APP*2=200`、`EDU*2+MAX(APP,DEX,STR)*2=260`、
  `EDU*2+MAX(DEX,STR)*2=260` 全部逐条钉住；M6 另钉 `EDU*2+POW*2=210` 与
  “POW 缺失即 fail closed”。
- `creation.mjs`：
  - `normalizePointFormulas(source)` 归一 `pointFormula`/`pointFormulas`，返回冻结
    的规范化公式 id 数组；重复、缺失、不在白名单一律抛 `CreationRuleError`。
  - `isSupportedPointFormulas(source)` 是它的布尔包装。
  - `professionRules()` 输出同时带 `pointFormula`（第一条，向后兼容）与
    `pointFormulas`（完整有序列表）。
  - `validateAllocation({ ..., pointFormula })` 新增可选入参：多公式职业**必须**显式
    选定一条，否则报 `formula-choice-required` 且 `budgets` 为 `null`——不默认取
    第一条、更不取 MAX（取 MAX 等于白送点数）。选了不属于该职业或不在白名单的
    公式报 `formula-not-allowed`。
  - `budgets.occupation` 新增 `formulas: [{ formula, max }]`，供前端渲染选项；
    `formula`/`max` 仍是选定那一条，单公式职业形状不变。
- 构建产物 `flags.brp.coc` 同时保留 `pointFormula`（首项）与 `pointFormulas`
  （完整列表），并把 `system.description` 写成「A 或 B（建卡时选定一条）」。

### M5 未覆盖 / 需前端同步

- 本源仓只到数据、共享规则与构建产物；`studio-coc` 向导、卡面适配器、后端
  profile/catalog 都在 compat 仓，M5 未接线。
- 前端需要接的三处：读取 `flags.brp.coc.pointFormulas` 渲染二选一；把选定公式作为
  `validateAllocation({ pointFormula })` 传回；按 `budgets.occupation.formulas`
  展示每条公式的点数上限。
- 律师的 `distinct: true` 选择组、警探的 `acting-or-disguise` 单选项组需要前端
  去重/二选一的 UI 支持。
- 没有可核对公式或信用区间的其他 CoC 职业仍不进入包，也不能作为车卡默认值。
- 三个二手来源不是官方出版物；将来若拿到官方一手确认，应在 `provenance.json`
  另起记录，而不是就地升级既有条目。

## M6 事实（第三批职业、POW 公式、科学（天文学））

### 新增专精（技能 56 → 57，专精 18 → 19）

| 技能 | key | 父族 | 基础值 | 族来源 |
| --- | --- | --- | --- | --- |
| 科学（天文学） | `science-astronomy` | science | 1 | `coc-sheet-1920s`（族基础值） |

- 专精存在性由飞行员职业表钉住（Pilot 固定 `Science (Astronomy)`）；基础值取 Science
  族基础值 1，不声称单独印刷值。`professions.json` 的 `skillFamilies.science.concrete`
  同步加入，双向一致检查继续生效。
- 副作用：带“科学族任选”的既有职业（如考古学家的导航或科学）会多出天文学选项；
  这是族清单变更的预期结果，不是职业数据改写。

### 第三批职业（职业 15 → 19）

| 职业 | 职业点公式 | 信用评级 | 八项构成 |
| --- | --- | --- | --- |
| 警察（巡警）Police Officer | `EDU*2+DEX*2` **或** `EDU*2+STR*2` | 9–30 | 格斗（斗殴）、急救、法律、心理学、侦查固定 5 + 射击族 1 + 人际 1 + 汽车驾驶或骑术 1 |
| 艺术家 Artist | `EDU*2+POW*2` **或** `EDU*2+DEX*2` | 9–50 | 心理学、侦查固定 2 + 艺术/手艺族 1 + 历史或自然学 1 + 人际 1 + 其他语言族 1 + 任意 2 |
| 神职人员 Clergy | `EDU*4` | 9–60 | 会计、历史、图书馆使用、聆听、心理学固定 5 + 其他语言族 1 + 人际 1 + 任意 1 |
| 飞行员 Pilot | `EDU*2+DEX*2` | 20–70 | 电气维修、机械维修、导航、操作重型机械、驾驶（飞行器）、科学（天文学）固定 6 + 任意 2 |

- 八项恒等继续由构建与回归锁定（固定数 + `choose` 之和 = 8）。
- 艺术家按印刷顺序记录 `POW` 在前的二选一：不得用 APP 替换 POW，也不得折叠成 MAX；
  人际项是四选一，不得把 Persuade 写死。
- 飞行员固定 `Pilot (Aircraft)`；`Pilot (Boat)` 是另一专精，不在该职业内。
- 警察（巡警）与警探是两条独立记录：信用区间 9–30 / 20–50，巡警有格斗（斗殴）、
  急救、侦查、无聆听，且有汽车驾驶或骑术槽；警探有聆听、无格斗（斗殴）/急救，
  且有表演或乔装槽。两者公式相同但文档、brpid 与固定技能集均不同，互不复用。
- 精神科医生在 M6 时点暂缓：RPG Stack 只给出 4 项（语言、医学、说服、精神分析），
  无法确认完整八项，因此当时不发布；现有“医生（医学博士）+ 任意两项（可含精神分析）”
  已覆盖玩法。**M7 已按 `coc-cardwright` 的完整八项落地，不再 deferred**（见 M7 事实）；
  本条保留 M6 时点记录。

### 公式白名单（M6）

- 新增 `EDU*2+POW*2`，白名单现共 7 条；既有六条求值逐条不变（回归钉住）。
- POW 与 APP 互不别名：`EDU*2+POW*2` 读 `pow`，`EDU*2+APP*2` 读 `app|cha`；
  POW 缺失时 fail closed（`stat-missing`）。
- `tools/coc-pack/build.mjs` 的公式门直接复用 `isSupportedPointFormulas`，无需另列名单。

### M6 来源与边界

- 四个职业均为 `evidence: "secondary"` + `sourceRefs`，无官方一手声明。
- 艺术家 / 神职人员 / 警察（巡警）由 Gamers' Plane 完整职业表、callofcthulhu.org.uk
  索引页与 RPG Stack 三处交叉（后者只用于公式/信用区间）；飞行员由前两处交叉，
  因为 RPG Stack 职业表没有飞行员条目。
- RPG Stack 的速览表把每个职业截断为前四项技能（例如巡警只列 Firearms、First Aid、
  Law、Persuade），因此**不得**把它当作完整八项技能表；`provenance.json` 的每条 M6
  记录带 `skillShapeSourceRefs`，回归拒绝把 RPG Stack 列入八项来源。
- callofcthulhu.org.uk 对直接抓取返回 HTTP 403；该页事实来自搜索引擎索引文本，
  与 M5 条目同样按二手处理，不升级为一手。
- **M7 已把上述 4 条记录统一改记 `coc-cardwright` 来源**，移除对公开职业表的拼接依赖；
  本条保留 M6 时点的来源审计轨迹。

### M6 未覆盖 / 需前端同步

- 本源仓仍只到数据、共享规则与构建产物；`studio-coc` 向导、卡面适配器与后端
  profile/catalog 在 compat 仓。
- 前端需在 `COC_FORMULAS`/共享 `creation.mjs` 已支持 `EDU*2+POW*2` 的基础上，
  把新职业的选择组（族选择、`drive-or-ride`、`history-or-natural-world`）渲染为
  单选；艺术家二选一必须把选定公式回传 `validateAllocation({ pointFormula })`。
- 精神科医生在 M6 时点不在包内；M7 已按 `coc-cardwright` 完整八项落地，本条不再适用。

## M7 事实（第四批职业、两项科学专精、coc-cardwright 事实源）

### 事实源与边界

- 本批职业/技能事实源为用户仓库 `tanis90/coc-cardwright` revision `c0a0733`
  （README 自述上游 `trpg-saikou/cochar`），不再用公开职业网页拼表。只取数值、公式、
  信用区间与技能名；不复制其模板、HTML/CSS、Python 实现或其他仓代码。
- `coc-cardwright` 是次级转录，**不是 Chaosium 官方出版物**；本批全部记录标
  `evidence: "secondary"`，不把项目数据说成官方一手。README 声明的上游链只按声明记录，
  不当作独立一手核验。
- 只导入能确认完整八项、公式与信用区间的条目；没有完整八项的职业不导入。
  `coc-cardwright` 自述 112 个职业，本批**不是 112 全表**，不宣称全职业覆盖。

### 新增专精（技能 57 → 59，专精 19 → 21）

| 技能 | key | 父族 | 基础值 | 来源 |
| --- | --- | --- | --- | --- |
| 科学（动物学） | `science-zoology` | science | 1 | `coc-cardwright` |
| 科学（鉴证） | `science-forensics` | science | 1 | `coc-cardwright` |

- 两条均归 `science` 族、基础值取族级 1；`skillFamilies.science.concrete` 同步加入，
  双向一致检查继续生效。
- 科学（天文学）保留；M7 不删除 M6 的专精。

### 新增 19 职业（职业 19 → 38）

| 职业 | 公式 | 信用评级 |
| --- | --- | --- |
| 精神病学家 Psychiatrist | `EDU*4` | 30–80 |
| 博物馆管理员 Museum Curator | `EDU*4` | 10–30 |
| 法医 Coroner | `EDU*4` | 40–60 |
| 法官 Judge | `EDU*4` | 50–80 |
| 书商 Bookseller | `EDU*4` | 20–40 |
| 古董商 Antiquarian | `EDU*4` | 30–50 |
| 中介调查员 Intermediary Investigator | `EDU*2+STR*2` **或** `EDU*2+DEX*2` | 20–45 |
| 勤杂护工 Orderly | `EDU*2+STR*2` | 6–15 |
| 政府官员 Government Official | `EDU*2+APP*2` | 50–90 |
| 旅行家 Traveler | `EDU*2+STR*2` **或** `EDU*2+DEX*2` | 5–20 |
| 消防员 Firefighter | `EDU*2+STR*2` **或** `EDU*2+DEX*2` | 9–30 |
| 渔民 Fisherman | `EDU*4` | 20–40 |
| 猎人 Hunter | `EDU*2+STR*2` **或** `EDU*2+DEX*2` | 20–50 |
| 药剂师 Pharmacist | `EDU*4` | 35–75 |
| 赌徒 Gambler | `EDU*2+DEX*2` **或** `EDU*2+APP*2` | 8–50 |
| 部落成员 Tribe Member | `EDU*2+STR*2` **或** `EDU*2+DEX*2` | 0–15 |
| 间谍 Spy | `EDU*2+DEX*2` **或** `EDU*2+APP*2` | 20–60 |
| 黑帮老大 Gang Leader | `EDU*2+APP*2` | 60–95 |
| 精神病院护工 Asylum Orderly | `EDU*2+STR*2` **或** `EDU*2+DEX*2` | 8–20 |

- 精神病学家已成功落地，不再 deferred；固定 7 项含精神分析 + 任选 1 门其他语言。
- 渔民固定 7 项含驾驶（船）/游泳；猎人固定 5 项含科学（动物学）/追踪，另有射击、
  聆听或侦查、外语或生存三个选择组；法医固定 7 项含科学（鉴证）与 1 门其他语言。
- 警察（巡警）、艺术家、神职人员、飞行员 4 条 M6 记录保留，并统一改记
  `coc-cardwright` 来源；艺术家仍按 `EDU*2+POW*2` / `EDU*2+DEX*2` 二选一，不折叠 MAX。
- 每条的固定技能数 + 各选择组 `choose` 之和必须为 8；构建与回归双向锁定。

### 公式与选择（7 条）

- 白名单新增 `EDU*2+POW*2`，共 7 条；既有 6 条求值逐条不变，POW 与 APP 不互为别名。
- 私家侦探、士兵从 `MAX(DEX,STR)` 改为 `[STR,DEX]` 真实二选一；探险家从
  `MAX(APP,DEX,STR)` 改为 `[APP,DEX,STR]` 真实三选一。预算按所选属性分别计算，
  不白送 MAX 点数；职业文档的 `pointFormula` 保存实际选择（构建产物同时保留
  `pointFormulas` 列表）。
- 多公式职业仍必须显式选择；未选择报 `formula-choice-required`，不默认取第一条或 MAX。

### M7 验证与来源

- 源仓 `tools/tests/coc-rules-regressions.mjs` **137/137**；确定性构建通过，
  `coc-skills` / `coc-professions` / packs 连续构建一致，octopus 包字节不变。
- 证据全部为 **secondary**：本批 19 条与 4 条保留记录均以 `coc-cardwright` 为
  `sourceRefs`，不再引用公开职业页拼接；README 的上游声明只作审计线索。
- compat 前端已同步本批并完成真实栈 550/550（dev HS256），证据记在 compat 仓
  `PROGRESS.md` 与 `docs/coc-compatibility-contract.md`；本源仓不声称跑过浏览器 E2E。
- 仍未覆盖：`coc-cardwright` 112 全表、Investigator Handbook 全量、资产/装备/现金自动化。

## M8 事实（SealDice 职业批量兼容导入）

### 事实源与许可边界

- 事实源为 SealDice 内置 `COC职业查询` helpdoc（`sealdice/sealdice-builtins`），
  从 `/tmp/sealdice-coc-occupations.json` 只读副本解析，仓库不保存该文件。
- `sealdice-core` 是 MIT，但 `sealdice-builtins` 没有声明许可证。本仓**不分发**
  该 JSON、helpdoc 正文或【介绍】段落；只取职业点公式、信用区间与技能构成三类
  事实，全部职业描述为本仓自写。该来源记为 **secondary**，不冒充 Chaosium 一手，
  也不把海豹数据说成 MIT。
- 去重按「公式选项 + 信用区间 + 规范化技能形状」；同名但定义不同的记录不覆盖已有 38
  职业。规范化形状会把「两个各选一项社交技能」与「一次选两项社交技能」视为同一形状，
  因此 古董商/赌徒/黑帮老大/精神病院看护 归 `duplicate-existing`；艺术家/猎人/渔民
  因 CR、公式或固定专精确实不同，保留 `display-name-conflict`。79 个别名、3 个格式
  异常、1 个自定义模板、1 条缺公式、44 条非八项、11 条缺可核基础值、35 条与已有职业
  精确重复、10 条来源内重复、3 条显示名冲突，均带类别与原因写入
  `content/coc/provenance.json` 的 `occupations.deferredRecords`。

### 最终计数

| 项 | M7 | M8 | 说明 |
| --- | ---: | ---: | --- |
| 职业 | 38 | **156** | 新增 118，已有 38 未覆盖 |
| 技能文档 | 59 | **91** | 新增 32 条具体技能 |
| 专精 | 21 | **50** | 新增 29 条（Computer/Electronics/Diving 不是专精） |
| deferred | — | **187** | 305 条 helpdoc = 118 导入 + 187 deferred |

### 新增技能与基础值

- 新增独立技能：计算机 5、电子学 1、潜水 1。
- 新增专精：艺术/手艺 19 条（耕作/伪造/音乐/木工/写作/打字/速记/歌唱/舞蹈/游戏/
  杂技/喜剧/钳工/书法/烹饪/裁缝/理发/焊接/管道工）各 5；格斗 4 条（剑 20/鞭 5/
  矛 20/链锯 10）；射击（弓）15；驾驶（马车）1；科学（植物学/地质学）各 1、
  科学（数学）10；生存（山地）5。
- 基础值规则：有同名 `skills.py` 条目的专精取该值；没有同名条目的开放族成员取族
  已核基础值与 `baseSourceRefs`（艺术/手艺族 5，来源 `coc-sheet-1920s`）。印刷成员值
  优先于族默认值：数学 10（不是科学族 1）、生存（山地）**5**（不是生存族 10）；
  格斗/射击族本身没有族基础值，但其具体成员有 `skills.py` 值，不能因此把成员
  deferred，也不能反推族基础值。
- 没有族或明确依据的继续 deferred：学问（Knowledge）、自行车驾驶、礼仪等不猜值、
  不写 0。

### 八项与公式

- 每条新增职业恰好 8 项：`fixedSkills` + `choiceGroups[].choose` 之和，
  任选组按 `choose` 计入。括号内的同类专精算一个选择槽（例如
  科学（生物学、药剂学）是一条二选一），不把并列项误算成多固定槽；不补
  未印出的「任意技能」凑数。
- 复杂并列句按真实选项解析后再判 8 项：交际花解析为 10 项、劳工 9 项，均以
  `not-eight-slots` 拒绝而不是「句子复杂」跳过；佣人解析为 8 项，但礼仪没有族或
  已核基础值，以 `unverified-skill: 礼仪` 拒绝。
- 公式只用现有 7 条白名单；不新增 MAX。多选公式写成有序 `pointFormulas`，
  单公式写 `pointFormula`；构建同时保留两者的一致性。
- 已有 Private Investigator / Soldier / Explorer 的真实二选一/三选一与 Artist
  的 POW 公式保持不变；新增记录不写 UGE 财富档，信用评级只作职业约束。

### M8 验证与同步

- 源仓 `tools/tests/coc-rules-regressions.mjs` **149/149**；构建连续运行字节一致，
  octopus 包字节不变；`base-pack-determinism` 通过。测试 harness 现在只把
  `ok === true` 视为通过，修复了此前数组返回值被当成 truthy 的静默通过。
- 导入器幂等：重跑后 `content/coc/{professions,skills,provenance}.json` 哈希不变；
  `sealdice.occupation.*` 记录整体替换，已有 38 条不参与替换。
- 同步路径（本源仓不执行）：compat 仓 `web/packages/brp/`，逐字节同步
  `content/coc/*`、`module/rules/*`、`packs-json/*`、`packs-index/*`、`packs/*`
  与 `system.json`。前端 E2E 与真实栈验收不在本源仓声明。

## M3 事实（原生战斗与创伤，源仓切片）

### 判级与骰池

- 特征检定目标 = 特征值本身（STR 60 的困难成功需 ≤30），**不乘 5**。
- 难度是“所需成功等级”（regular/hard/extreme），不再乘目标值；`band` 与 `taskSuccess`
  分开记录，避免难度与 ½、⅕ 阈值双重计数。
- 奖励/惩罚骰 = 额外十位骰，一次真实 `Nd10`（1 个位 + 1+净额 个十位）；奖励取低、
  惩罚取高，一颗抵一颗；`00+0=100`，`00+n=n`。
- `resultLevel` 仍保留 0–4 以兼容旧卡；对抗与伤害一律读 `band`/`bandRank`
  （hard=3、regular=2，二者不再混为同一档）。

### 武器与伤害

- 武器技能按 `system.skill1/skill2` 的 brpid（+ 专精 `specKey`）实时解析到角色技能
  `system.total`，不按显示名、不缓存命中值。
- 徒手：独立 `flags.brp.coc.weapon = {kind:'melee', dbMode:'full', impaling:false}`
  标记；伤害 1D3 + 全额 DB。BRP 的 `special:'crush'` 不是 CoC 规则来源。
- DB 口径：近战全额、投掷/弓半骰、火器无 DB；双手不改变 DB（BRP 规则不用于 CoC）。
- 极难伤害：钝击 = 武器满骰 + DB 满骰；穿刺 = 武器满骰 + DB + 追加武器骰。
  `maximize` 在 compat 被忽略，因此满骰由纯函数 `maxOfFormula` 计算。
- 仅发起攻击方享受极难伤害；反击命中最高只到 regular。
- 火器：2–3 发/轮每发一颗惩罚骰；抵近（DEX 英尺的 1/5）一颗奖励骰；不可被反击；
  目标可扑掩体（Dodge 成功后攻击方带一颗惩罚骰重骰，扑倒者放弃下次攻击）。

### 对抗与情景修正

- 普通对抗：band 高者胜 → 平 band 比技能值 → 技能同值**双方重骰**，新骰低者胜
  （不拿旧骰子硬判胜负）。
- 近战：闪避平局防守方胜；反击必须严格更高，平局攻击方胜。
- 战技：Build 差每点一颗惩罚骰，最多 2；差 ≥3 直接无效。
- 寡不敌众：防守方本轮已近战防御过后，后续近战 +1 奖励骰；火器不受影响。
- 先攻：DEX 顺序；就绪火器 DEX+50 已作为纯函数提供，但 per-combatant 覆盖未接线。

### 创伤与治疗

- 伤害直接写 `system.health.value`（夹到 ≥0），状态存 `flags.brp.coc.wounds`；
  **不建 BRP wound 条目、不累加 `health.daily`、不走命中部位**。世界若仍开着
  `useHPL`，CoC 路径忽略并记录 `hplIgnored`，且角色准备的命中部位/护甲 HPL 分支与建卡
  hit-location 生成对 CoC actor 全部短路（否则位置状态会覆盖伤口 flags）。
- `updateVitals`（重掷属性）会同时把 `flags.brp.coc.wounds` 复位为满血无伤，避免
  “满血 + 濒死/死亡”的错配。
- 单次伤害 ≥ `ceil(maxHP/2)` → 重伤，立刻真实 CON 检定，失败昏迷；
  单次伤害 ≥ maxHP → 当场死亡；0 HP 且无重伤 → 仅昏迷。
- 重伤且 0 HP → 濒死：每轮结束 CON（`cocDyingRound`，Combat.nextRound 由 activeGM
  自动执行），失败死亡；急救可稳定。重伤/濒死 CON 与恢复骰都是真实 `Roll`，
  结果连同骰值/band 写入 flags（不额外发聊天卡，避免一伤多卡）。
- 急救 +1 HP、唤醒非濒死昏迷、稳定濒死；医学 +1D3（≥1 小时 + 器械），并给濒死者
  周末恢复资格；周末 CON 成功 +1D3、极难 +2D3，极难或 HP 回到半血解除重伤；
  无重伤每天 +1 HP。
- 角色/NPC 的 `dead/unconscious/dying/majorWound` 由 flags + 当前 HP 派生；
  octopus 的 `HP<1 → dead`、`HP<3 → unconscious` 原逻辑保留在非 CoC 分支。

### 原生/前端可调用面

`game.brp.coc`（`module/hooks/init.mjs`）全部接受纯数据，跨所有者写自动走
`game.users.activeGM`：

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `attack(options)` | `{actor 或 actorId, itemId, skillId?, targetId?, targetType?, bonusDice?, penaltyDice?, requiredBand?, flatMod?, shots?, distanceFeet?, maneuver?{defenderBuild}, outnumbered?{defenderActedThisRound}}` | `{messageId, profile, bonusDice, penaltyDice, maneuver}` |
| `defend(options)` | `{messageId, actor 或 actorId, choice: 'dodge' / 'fightback' / 'cover', itemId?, skillId?, bonusDice?, penaltyDice?, requiredBand?}` | `{messageId, choice}` 或 `{error}` |
| `resolve(options)` | `{messageId, applyDamage?=true}` | `{outcome, winner, reason, choice, tier, formula, damage, wounds, conCheck}`；平局/扑掩体返回 `{reroll}`。目标不防御时 `choice: 'none'` 并按攻击方 band 结算 |
| `reroll(options)` | `{messageId}` | 普通对抗平局的双方新骰；战斗扑掩体返回 `{error:'combat-reroll-needs-new-attack', penaltyDice}` |
| `state(actor)` | actor | 四态 + flags |
| `damage/firstAid/medicine/weeklyHeal/naturalHeal/dyingRound` | `{actorId 或 actor, band, rank, damage?, ...}` | 应用结果 + 新状态 |

各返回边界（前端判断用）：

- `attack`: 无权限 `{error:'not-authorised'}`；非 CoC `{error:'ruleset-not-coc'}`；PC 武器解析不到
  CoC 技能 `{error:'weapon-skill-missing'}`；战技 Build 差 ≥3 `{error:'maneuver-ineffective'}`。
- `defend`: `{error:'defense-not-allowed', allowed:[...]}`（火器只允许 `cover`）；
  `{error:'not-the-target'}` 非目标玩家；`{error:'card-full'}` 已有两人。
- `resolve`: 非 GM 客户端返回 `{queued:true, by}`（relay 给 activeGM）；未凑齐两人时普通对抗
  `{error:'need-two-entries'}`，近战卡可单方结算。
- `damage` 等写操作：跨所有者且调用者不是 activeGM 时返回 `{queued:true}`；
  同一 actor 上已 `dead` 返回 `{applied:false, reason:'already-dead'}`。

聊天卡：攻击/防御/普通对抗都会把真实 `Roll` 挂到 `ChatMessage.rolls`；卡面显示
`band`、所需成功等级、骰池/采用十位/全部骰面、伤害公式与骰值、HP 与四态。
卡上的按钮不是结算入口；结算由上述 API（或 `BRPCheck.handleChatButton` 的 GM 路径）
驱动，不依赖 compat 未触发的 `renderChatMessageHTML`。

### M3 未实现 / 待官方来源

- 武器大全：只有原生徒手与用户自建武器；不引入官方武器表数值。
- 01 在伤害上的额外效果（本切片把其伤害层视同极难）；奖励/惩罚骰下的 01/96–100
  多十位边界；多奖励 vs 多惩罚的净额上限。
- 连发/全自动、双持、瞄准、掩体数值、距离难度修正；怪物通用护甲/减伤与多次攻击
  行动经济；火器故障只报在卡面，不改武器/弹药状态。
- 火器抵近闪避的官方例外；重伤/濒死 CON 是否套难度；稳定状态机的细枝末节。
- 就绪火器 DEX+50 的 per-combatant 先攻覆盖；按日历自动触发周末恢复。
- 本源仓 M3 阶段未做 `studio-coc` 战斗 tab 或前端 `attackImplemented`；compat 仓前端
  现已把 `attackImplemented` 翻真（`web/cards/coc.mjs`），浏览器/E2E 证据以 compat 仓为准，
  本源仓未重跑这些前端门。M4 的 vendor 同步与正式验收另见 §验证口径与 §未验证。
- 未验证专精（斧/剑/矛/鞭/弓/弩/其他艺术）没有基础值，用它们的武器 `attack()` 直接
  返回 `weapon-skill-missing`，不按 0 命中处理。

## M4 事实（原生 SAN / 疯狂 / Luck / 成长 / 世界时钟，源仓切片）

### 理智检定与损失

- 理智检定目标 = **当前 SAN**（不是 POW 或起始 SAN）；成对损失公式（成功/失败）各掷真实
  `Roll`，卡上记录采用的公式与实际损失。
- 单次损失（夹到剩余 SAN 后）**≥5** 才要求 INT 检定：真实 1D100 对 INT（目标 = INT 值本身）。
  INT 成功才进入临时疯狂；失败表示“暂时压住”，不产生发作、不掷发作骰。
- INT 未决时只返回 `pending-int-check`；整合路径在同一 activeGM 写者上立即掷 INT，未掷出
  结果前不会写 temporary 状态或建 effect。
- SAN 归零 = 永久疯狂（终态）：不再开始新发作；只有 keeper 显式 `clearPermanent(reason)`
  才能清除，刷新/重开不会自动恢复。
- 临时疯狂：真实 1D10 小时 + 真实 1D10 发作 + 真实 1D10 轮/发作。持续时间是数据，
  由持久化世界时钟/keeper 显式推进确认，不由墙钟或刷新推断。
- 不定疯狂：独立于临时疯狂，按 **一个游戏日** 累计损失 ≥ `ceil(dayStartSan / 5)` 触发；
  `dayStartSan` 是 keeper 声明当日开始时的**当前 SAN**。核心也支持 `starting`（Lightless
  Beacon 的 scenario 累计口径，**secondary/冲突**）与 `current`，但默认只使用 `day-start`，
  不把 scenario 阈值混进默认。
- 临时/不定/永久是三个独立键，可并存；临时结束保留不定与恐惧症/躁狂/背景改写，只清除
  妄想；永久是终态。
- 不定疯狂的恢复数量/周期没有可核对的一手公开文本：只返回 `keeper-review` 标记，不编表。

### 单写者、串行与权限

- 所有 SAN 结算、keeper 动作都在 `game.users.activeGM` 上执行；非写者把已决定的损失通过
  `system.brp` socket 的 `cocSanSettle` 转给写者，返回 `{queued:true}`，本端不写 actor/effect/card。
- 写者把整个读-改-写放进一条 Promise 链（`settleNow`），并发/连续结算不会对同一份旧 SAN
  各写一次。
- relay 携带 `origin`：写者只接受该 actor 的 OWNER 或 GM；其他玩家来源返回
  `{error:'not-authorised'}`，缺来源返回 `{error:'origin-missing'}`。玩家 relay 的
  `dayId` 一律置空，不能靠声明新游戏日重置第五阈值。
- keeper 动作（新的一天、结束临时/不定、清除永久、Luck 恢复、推进时钟）通过
  `cocSanAction` 时要求 origin 是 GM；玩家端直接调用返回 `{error:'not-active-gm'}`。
- 单损、`dayId`、`dayStartSan`、`dayStartSource`、`dailyLoss`、`singleLoss`、三态 insanity
  都写入 `system.sanity.*` 并保留在 actor 上；`flags.brp.coc.sanityLog` 保留最近 20 条审计。

### Luck

- 只允许技能/特征检定 1:1 调值；以下全部拒绝，UI 快照与结算核心双门：
  理智检定、决定 SAN 损失量的骰、Luck 检定、伤害、武器故障、pushed 掷骰、自然大失败
  （自然 100，或 band=fumble），以及自然 01（已最高，不允许再花）。
- 自然 01 才是 critical；Luck 把骰值降到 01 只算 extreme。自然大失败不能被 Luck 洗白。
- 上限 99，起始 Luck 不是上限：`system.luck.cap` 保存 CoC 上限，`system.luck.max` 仍是
  3D6×5 的创建快照；恢复可把当前值抬到 99。
- Luck 恢复只在 keeper 显式“开始新会话”时执行：真实 1D100 对当前 Luck；成功
  `+2D10+10`，失败 `+1D10+5`，夹到 99；写入 `cocSessionSeq` 与审计日志。渲染/ready/刷新
  不调用恢复。
- Pulp 专属消费（免死、回血、保持清醒等）与 SAN 损失减半保持禁用；`PULP_ONLY_LUCK_SPENDS`
  只作为拒绝清单存在。

### 成长

- 只有**成功且未花 Luck** 的技能检定才勾成长；花 Luck 改判成功不勾，若已勾则清除。
- `noXP`（克苏鲁神话）、NPC、SAN/特征/伤害/其它非技能检定不勾。
- `autoXP='2'`（BRP 的“失败也勾”）在 CoC 下按成功-only 处理，失败不勾。
- 幕末结算：真实 1D100 **严格超过**当前值才 +1D10；无 INT/idea 加成、无固定档、无 POW 成长；
  技能可超过 100，不设自造上限。
- 角色卡 dev 页在 CoC 下隐藏 fixed 档与 POW 成长控件；octopus 保持原五列/POW 行为。

### 时间

- `game.time.worldTime` 在 compat shim 刷新后归 0，不能作为唯一时长来源。
- 系统用 world-scoped `game.settings` 持久化 `brp.worldTime` 与 `brp.cocDaySeq`：
  ready 时 `hydrate()` 恢复；平台时钟前进时 `updateWorldTime` 钩子保存；keeper 可推进
  1 小时/1 天（API 可任意 `{hours,days,minutes,seconds}`）或开始新的一天/新会话。
- 临时疯狂 effect 的 `duration.startTime`/`expiresAt` 与 `system.sanity.insanity.temporary`
  使用同一持久化时钟；到期、effect 删除、effect 禁用都会把 actor 临时状态关闭并把卡片
  标为 `ended`。永久/不定不被临时结束连带清除。
- 共享 shim 未加任何 CoC 特判；DND/octopus 的时钟与疯狂行为不变。

### 原生/前端可调用面

`game.brp.sanity`（`module/hooks/init.mjs`）全部接受纯数据；跨所有者写自动走 activeGM：

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `state(actor)` | actor | 当前 SAN、day 窗口、临时/不定/永久三态 + statuses + worldTime |
| `settle(options)` | `{actor 或 actorId/actorType, loss, cardMessageId?, dayId?, reason?}` | 写者：完整结算记录；非写者：`{queued:true, by, loss}` |
| `intCheck(options)` | `{actor, roll}` | 失败/低于阈值不建发作；成功且单损 ≥5 才建临时发作（主 SAN 卡路径已由 `settle` 内联完成 INT，不需要二次调用） |
| `endTemporary` / `endIndefinite` / `clearPermanent` | `{actor, reason}` | 结束/清除结果 + `state`；后两者必须给 reason |
| `newDay` | `{actor}` | `{started, dayId, dayStartSan, worldTime}` |
| `luckRecovery` | `{actor}` | 真实 1D100/2D10+10 或 1D10+5、上限 99、session |
| `advanceTime` | `{hours,days,minutes,seconds}` | `{advanced, worldTime, dayIndex, crossedDay, expired}` |
| `expire` | — | 到期临时发作列表 |

`game.brp.clock`：`now()`、`dayId()`、`advance(options)`。
`game.brp.BRPSystemSocket`：`cocSanSettle` / `cocSanAction` 的 socket 入口（测试与 API 用）。
原生角色卡：SAN 行“新的一天”按钮在 CoC 下走 `newDay`；GM 还有 +1 小时、+1 天与
“新会话 Luck 恢复”按钮。所有按钮只声明意图，不复制规则。

### 证据分级（详见 `content/coc/sanity-provenance.json`）

- 一手官方免费：单损阈值、INT 规则、1D10h/1D10 发作、发作结束保留、Luck 允许/禁止用途、
  成长勾选与幕末 1D10、成功等级。
- secondary：自然 01/调值 01 的判级、Luck 恢复两分支与 99 上限、成长“未花 Luck”半句、
  不定疯狂/永久疯狂的术语。
- conflicting：不定疯狂阈值（Lightless 的 starting/scenario 口径 vs Keeper 转录的
  current/one-game-day 口径）；默认取 day-start，不静默混用。
- pending-official-source：不定疯狂恢复数量/周期、Luck 减半 SAN 损失、完整游戏日历。

### M4 边界 / 未做（阶段二已验收的项不再列为未验证）

- 双端（两个 GM + 玩家）、刷新后真实浏览器 E2E：源仓切片当时未跑；阶段二主代理已完成
  M4 前端/真实多端场景 **58/58** 与全场景 **423/423**，证据
  `/tmp/coc-sanity/reports-all-m4-final/`。本契约不据此宣称真实 Keycloak、生产部署或
  可选规则已覆盖。
- 不定疯狂的恢复数值与周期没有可核对一手文本，不编表；只做 keeper 复核。
- Pulp 天赋/幸运消费、SAN 损失减半不启用。
- 不用墙钟/刷新自动结束发作；时长必须来自持久化世界时钟或 keeper 显式推进。
- 核心/第三方 UI 的 `effect.duration.remaining` 在平台时钟归零后只做 best-effort
  `hydrate`；本系统的规则到期读 `system.sanity.insanity.temporary.expiresAt` 与
  `BRPWorldTime.now()`，不把该显示值当作判据。
- 前端 M4 卡面交互不在本源仓范围；本仓只提供 `game.brp.sanity` / 卡 flags / api；
  阶段二已验收 M4 前端/真实多端 58/58。

## 验证口径

- `node tools/tests/coc-rules-regressions.mjs`：数据/构建/规则/配点/战斗/创伤/M4 适配器契约
  纯函数，M4 时点 **107 项**、M5 **124**、M6 **132**、M7 **137**、M8 **146 项**
  （当前为 149/149）。
- M7 当前（2026-10-30）：`coc-rules-regressions` **137/137**、确定性构建通过；
  compat 前端 `studio-coc-verify` **198/198**、真实栈 07/08/09/10 **550/550**
  （dev HS256），证据在 `/tmp/coc-cardwright-e2e/`；本源仓不声称跑过浏览器 E2E。
- M8 源仓（2026-10-30）：`coc-rules-regressions` **149/149**、`base-pack-determinism`
  通过；118 条新增职业全部八项、公式/CR/来源/唯一 ID/技能引用与基础值通过，187 条
  deferred 全部有类别与原因。compat 同步目标 `web/packages/brp/`，本源仓未跑前端 E2E。
- `node tools/tests/coc-sanity-regressions.mjs`：M4 SAN/疯狂/Luck/成长纯核 **45 项**
  （在 38 项基础上新增阈值口径、Luck 全负例、恢复上限、成长边界、显式结束原因、永久终态）。
- `tools/tests/rules-regressions.mjs`：无头原生链 **161 项**（M3 的 114 项全部保留；
  M4 新增 47 项，覆盖真实 SN 卡、INT 成败、日阈值、三态并存、permanent、relay 权限、
  并发单写、Luck UI+结算双门、恢复两分支、成长勾选/结算/autoXP=2、dev UI、世界时钟/
  hydrate/updateWorldTime/到期/禁用/删除、completeIntCheck）。
  该文件是 Foundry 页面内 eval（顶层 `return out`），不是 `node` 直跑脚本；必须通过
  `MT_SYSTEM_ID=brp MT_SPIKE_EVAL=... node --experimental-vm-modules tools/run-headless.mjs`
  在包含 `game` 的 compat 镜像里执行。直接 `node tools/tests/rules-regressions.mjs` 会在
  解析阶段报 `Illegal return statement`，这是文件形态而非测试失败。
- `node tools/tests/base-pack-determinism.mjs`：octopus 基础包连续构建与提交产物一致。
- `coc-skills` 与 `coc-professions` 连续构建 byte-identical；octopus 包字节不变。
- M4 源仓切片当时只在临时副本（compat 检出 + 本仓 `module`/`templates`/`lang`/
  `template.json`/`system.json` 镜像到 `web/packages/brp`）中运行，**未**改 compat 工作树、
  未同步 vendor；临时镜像里 `npm test`（static + unit + headless）exit 0。这是**阶段一**。
- **阶段二（主代理后续，正式 compat）**：主代理已把本仓内容同步到 compat 的
  `web/packages/brp`，正式 compat 无头 **161/161**、`npm test` 通过；M4 前端/真实多端场景 **58/58**，
  全场景 **423/423**；证据在 `/tmp/coc-sanity/reports-all-m4-final/`。

阶段一（2026-10-29，M4 源仓切片，本 agent）实跑结果：`coc-rules-regressions` **107/107**、
`coc-sanity-regressions` **45/45**、`rules-regressions` **161/161**（临时 compat 镜像，
`报错总数 0`、FAIL-CLOSED 通过）、`base-pack-determinism` 连续构建 byte-identical 且已提交
octopus 产物未变；临时镜像 `npm test` exit 0。
阶段二（主代理正式验收）：正式 compat 无头 **161/161**、`npm test` 通过，M4 前端/真实多端
场景 **58/58**、全场景 **423/423**，证据 `/tmp/coc-sanity/reports-all-m4-final/`。本源仓仍只对
M4 原生链负责；上述验收不扩张为真实 Keycloak、生产部署或可选规则已覆盖。

### 收口时修掉的链路缺口（有断言）

- 第二个攻击者不得并入别人未结算的攻击卡：CoC 分支只在同一发起者、且该卡仍只有攻击方
  一条时复用；断言 `cocM3SecondAttackerOpensItsOwnCard`。
- 目标不宣告防御是合法状态（`choice: 'none'`）：按攻击方自身 band 结算并把伤害落到
  声明目标上，不再需要“补一个闪避”；断言 `cocM3UnopposedAttackResolvesAndDamagesTarget`
  与纯函数 `cocUnopposedAttackResolvesOnItsOwnBand`。
- `resolve()` 返回体补 `reason`（原先只有嵌套 `outcome.reason`）。
- 世界仍开着 BRP `useHPL` 时，CoC 角色的命中部位分支/护甲 HPL 分支/建卡 hit-location 全部
  短路（原先会有位置状态覆盖伤口 flags 或对缺失 hit-location 解引用）；`updateVitals`
  重掷时同时重置 `flags.brp.coc.wounds`，不留“满血 + 濒死”的错配。
- CoC 难度选项改为 required band（`average/hard/extreme` 三档），不再显示 BRP 的 ×2/×0.4。
- XP 门按规则集分派：CoC 不吃 `diff/diffVal` 跳过、Mythos（`noXP`）永不勾选；octopus 原样。
- M4：SAN 卡目标改为当前 SAN；成对损失与 INT/发作骰全部是真实 `Roll`；INT 失败不建发作。
- M4：非写者不再本地结算，统一 `{queued:true}` relay；写者 `settleNow` 串行整段读-改-写，
  并发两次损失不会各写同一份旧 SAN。
- M4：`origin` 权限门拒绝非 OWNER 的 relay；keeper 动作要求 GM origin。
- M4：临时发作替换改为 update-in-place，避免删除旧 effect 触发 delete 钩子把新发作关掉。
- M4：Luck UI 快照现在带真实骰值/band，fumble/自然 01/SAN/伤害/故障/pushed 不再下发按钮；
  `applyLuck` 在结算层也拒绝，不能绕过 UI 直接扣点。自然大失败不会被“花幸运”洗白。
- M4：`_untickGrowth` 读取本次 spend 结果而不是旧卡字段，Luck 买来的成功会清掉已勾成长。
- M4：`dayStartSan` 不再把 `null` 当 0；keeper “新的一天”重设 `dayId`/`dayStartSan`。
- M4：Luck 恢复用 `luck.cap=99` 而非创建快照 `max` 夹值，起始值不是上限；每次恢复写 session。
- M4：`brp.worldTime`/`brp.cocDaySeq` world settings 持久化；ready hydrate、updateWorldTime
  镜像、keeper 推进小时/天；临时发作的 effect start/expires 与状态使用同一时钟。

## 未验证 / 不冒充

- 真实 Keycloak 登录链未跑（本机共享后端为其它 profile，未替换未中断）。
- M2 首批职业数据与共享配点规则在本源仓；`studio-coc` 真实出卡已由 compat 仓前端/隔离栈
  验收（`studio-coc-verify` 103/103、`studio-coc-browser-verify` 48/48、场景 08），本源仓
  未重跑这些前端门。不再声称“真实出卡未实现”。
- M3 源仓原生战斗/创伤切片已交付；compat vendor 已含 `module/rules/coc-*.mjs`，前端
  `attackImplemented` 已翻真。本源仓未跑浏览器/隔离栈；M4 源仓切片当时未同步 vendor，
  主代理随后已把本仓内容同步到 compat 的 `web/packages/brp` 并完成正式验收（见 §验证口径）。
- M4 源仓切片只验证源仓原生链 + 临时 compat 镜像无头；阶段二主代理已完成正式 compat
  同步、无头 **161/161**、`npm test`、M4 前端/真实多端 **58/58**、全场景 **423/423**
  （证据 `/tmp/coc-sanity/reports-all-m4-final/`）。本契约不据此宣称真实 Keycloak、
  生产部署或可选规则已覆盖。
- M4 不定疯狂的恢复数量/周期仍是 `pending-official-source`；仅 keeper 复核，不填数字。
- M4 的 Lightless Beacon starting/scenario 阈值只作为可选 `basis`，默认不启用；不得把
  scenario 简化阈值冒充核心规则。
- M7 的 38 职业不是 `coc-cardwright` 的 112 全表，也不是 Investigator Handbook 全量；
  没有完整八项的职业不导入。职业公式/信用区间是公开页面或用户仓库的次级证据，不是
  Chaosium 一手 PDF 的逐字核对。
- M7 的 compat 真实栈仍是 dev HS256，不是真实 Keycloak；本契约不据此宣称生产部署、
  真实 OIDC 或可选规则已覆盖。
- M8 的 156 职业不是 Chaosium 官方全职业表，也不是 `sealdice-builtins` 的全表：
  只导入能核到公式、信用区间、完整八项与技能基础值的正式定义；187 条按类别 deferred。
  海豹数据不是 MIT，helpdoc 正文/职业描述未复制；全部记录仍是 secondary。
- M8 的 compat 前端/E2E 未在本源仓执行；同步目标为 `web/packages/brp/`，是否接线与
  真实栈验收由 compat 仓单独记录。
- VTT 授权未评审：Fan Material Policy 排除 VTT，本仓自研代码不等于已获授权。
