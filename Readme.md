# 章鱼料理研究会 · Octopus Culinary Research Society

A Foundry VTT system for Cthulhu-style d100 horror roleplaying — percentile
checks, Sanity, Luck, occupations, skill advancement, and Keeper tooling.
Built as a friendly fork of the MIT-licensed **BRP (Basic Role Playing)**
system, building toward a self-owned "Cthulhu d100" ruleset.

**[中文说明见下半部分](#中文说明) · 章鱼料理研究会 = "Octopus Culinary Research Society",
an affectionate nod to tentacled horror without touching anyone's trademark.**

## Fork provenance

- This project is a fork of **[cragstone/brp](https://github.com/cragstone/brp)**
  ("Basic Role Playing for Foundry VTT"), forked from upstream tag `13.57`
  (commit `d8e2b4c`, the Foundry **V13** line, verified 13.351).
- The upstream repository is kept as the git remote `upstream`, so upstream
  fixes can be merged in.
- The **package id stays `brp`** for now (internal settings namespaces, i18n
  keys, and the BRPID data concept are tied to the id; a rename is a separate
  task). The display title is 「章鱼料理研究会」. Do not install alongside the
  upstream `brp` system — same directory id, pick one.
- Version numbering is independent from upstream (starts at `0.1.0`).
- The upstream `packs/` directory was **removed** in this fork: upstream's
  `LICENSE.txt` excludes `packs/` from the MIT grant (Chaosium conditions
  apply to that content), so it is not redistributed here.

## Credits

- **[BRP for Foundry VTT](https://github.com/cragstone/brp)** — Dangermouse,
  JamesB, and contributors: the code base of this project. MIT.
- **[Boilerplate System](https://github.com/Asacolips/projects)** — Asacolips
  Projects / Foundry Mods: the system template the upstream project was built
  on. MIT.
- **Chaosium Inc.** — rules text source: the *Basic Roleplaying: Universal
  Game Engine* ORC SRD (see License). "Basic Roleplaying", "Call of Cthulhu",
  and related names are trademarks of Chaosium Inc.; this project is not
  affiliated with or endorsed by Chaosium and does not use those trademarks.

## License

- **Code**: MIT — see [LICENSE.txt](LICENSE.txt), preserved verbatim from
  upstream (both grant blocks: Genii-Locorum + Asacolips boilerplate).
- **Rules text** (current and future): any in-system rules text derived from
  or adapted out of the BRP:UGE ORC Content Document will ship with the ORC
  license text and a Licensed Content declaration, as ORC requires. The
  current release bundles no SRD text yet.

**BRP: Universal Game Engine Notice** (carried over verbatim from upstream):

> This product is licensed under the ORC License held in the License of
> Congress at TX000 [number tbd] and available online at various locations
> including www.chaosium.com/orclicense, www.azoralaw.com/orclicense,
> www.gencon.com/orclicense and others. All warranties are disclaimed as set
> forth therein. This product is the original work of Chaosium.
>
> If you use our ORC Content, please also credit us as follows:
>
> ![Chaosium ORC credit](https://github.com/Genii-Locorum/brp/assets/121451824/ca848b0d-40a6-4fd1-ab73-81c48e243b99)

## Roadmap — the "Cthulhu d100" layer

Six subsystems layered onto the BRP d100 skeleton (integration-point analysis
in the `mt-foundry-compat` repo, branch `research/rules-brp`,
`docs/rules-integration/brp-report.md` §10):

1. [x] Full Sanity chain (POW×5 snapshot / TIS threshold / paired-loss checks /
   temporary madness with in-card d6 manifestation + d8 duration / permanent insanity)
2. [x] Luck points (POW×5 snapshot, spend-to-lower on check cards; no reroll by design)
3. [x] Occupation base content (44 UGE professions, ORC-clean; quotas = power-level pools + INT×10 — point-budget validators land with the character builder)
4. [ ] Skill advancement (reworked dev-phase gain semantics)
5. [ ] Keeper tooling (batch checks / party panel)
6. [x] Phobias & manias (persTrait traitType; madness-card pre-filled creation entry)

Base content pack: UGE skills (57, zh) + professions (44, zh) + skill categories, dual-format (compat packs-json / real-Foundry folder packs), ORC notice included (ORC-NOTICE.md); starter auto-attach verified E2E.

Localization: Simplified Chinese ships complete (1057/1057 keys, terminology aligned
with authoritative CoC zh conventions); see lang/zh-CN.json.

## Development

Headless development under the mt-foundry-compat harness: drop this directory
into `mt-foundry-compat/web/packages/brp/` and run

```bash
MT_SYSTEM_ID=brp node --experimental-vm-modules tools/run-headless.mjs
```

### 0.3.1-dev (unreleased)

This tree is an unreleased fix snapshot on top of `v0.3.0` (system version
`0.3.1-dev`). Do not vendor it as the original `0.3.0`.

- NPC/combat: CB cards resolve without the missing-`skillId` XP crash; auto-XP
  off no longer ticks. Native NPC HP is the roll/average `updateVitals` fill or
  a keeper hand edit (non-HPL); wounds are character/HPL-only, not an NPC HP
  model. See `CHANGELOG.md` and the regression probe.
- SAN: keeper "New Day" clears `dailyLoss`; deleting/disabling/expiring
  `tempInsane` ends and re-renders the episode card.
- Luck: check-card spends are serialized and all clients route chat actions to
  Foundry's deterministic `activeGM` single writer.
- Character sheet: new PCs start in use mode (`system.lock=true`); a single native
  Edit/Use toggle at the far left of the window header drives the existing lock
  action and normal-list/dev-grid view. The duplicate body lock is removed;
  existing unlocked actors stay unlocked and NPCs are unchanged.
- Stats: the canonical characteristic key is `cha` (template/schema). The d100
  creator and card adapter must write/read `cha`; there is no `app` alias or
  migration. Invalid test cards written with `app` are rebuilt.
- Character creation: new characters get one real `徒手（斗殴）` weapon linked to
  `i.skill.brawl` (`1D3`, full Damage Modifier, Crushing, Short, 1H, no Parry).
  Attacks read Brawl's live total; no hit score is persisted. With starter skills
  off only Brawl is added. Existing actors, imports and NPCs are not migrated.
- Base pack: profession ref UUIDs are reproduced from the committed seed with a
  deterministic fallback; consecutive builds are byte-identical.

### CoC 7e M1 (experimental)

An opt-in CoC layer now sits beside the octopus/UGE rules without replacing it.
`brp.ruleset` is a hidden world setting and defaults to `octopus`. The external
`coc7` value used by the backend catalog/settingsSeed maps explicitly to the
internal `coc` adapter; `coc` is also accepted. Unknown values fall back to
`octopus`, never CoC. This is a core slice, not a complete CoC implementation.

- `content/coc/skills.json` + `packs-json/coc-skills.json` + `packs/coc-skills/`:
  the public owner ships only the **60 core skills** (22 specialisms) in the
  `coc-skills` pack. Seven unverified specialisms stay
  `pending-official-source` with no fixed value. Extension-only skills and their
  importer/build chain were moved out of this public repository. Octopus pack
  bytes are unchanged.
- `module/rules/`: centralized rules interface. CoC derives HP/MP/SAN/Luck/
  Build/DB/MOV, uses its own success bands and +1D10 growth, and maps APP to the
  native `cha` field. EDU is enabled. Dodge (½ DEX) and mother tongue (EDU) use
  native `variable`/`baseFormula`.
- Native `BRPCheck` remains the real check path; it delegates only the grade.
  Starter skills and skill categories are source-scoped: CoC gets no octopus
  skills or BRP categories, and octopus gets no CoC skills. Imports, old actors
  and NPCs are not migrated.
- Weapon rows keep a numeric hit score when the ruleset has no skill categories
  (`skillcategory` empty): the missing category bonus falls back to `0` instead of
  producing `NaN`. Rulesets with categories are unchanged.

### CoC 7e M2 (experimental): occupations, credit rating, allocation

The first occupation batch is data-driven and build-verified. It is not a
complete occupation table; anything without a verified formula or credit range
simply does not exist as a buildable default.

- `content/coc/professions.json` + `packs-json/coc-professions.json` +
  `packs/coc-professions/`: the public owner ships only the **9 core entries**
  (Author, Dilettante, Investigative Journalist, Private Investigator, Professor,
  Doctor of Medicine, Police Detective, Antiquarian, and the product-defined
  custom investigator) in their own `coc-professions` pack, registered in
  `system.json`. Every record carries `flags.brp.contentSource = "coc"` and
  `flags.brp.coc` with `slug`, `creditMin`, `creditMax` and `pointFormula`.
  Extension-only occupations were moved out of this public repository. Octopus
  pack bytes are unchanged.
- Facts are recorded as **secondary evidence** in `content/coc/provenance.json`
  (Roll20 compendium occupation pages, themselves sourced from Free Basic Rules),
  with per-occupation formula and credit range pinned.
- Credit rating is an occupation constraint, never the UGE wealth band:
  `minWealth`/`maxWealth` stay `0` and `wealthNotApplicable` marks why.
- `module/rules/creation.mjs` is a framework-free pure module the character
  builder imports directly:
  - `evaluatePointFormula(formula, stats)` — whitelist/AST evaluation of
    `EDU*4`, `EDU*2+DEX*2`, `EDU*2+APP*2`, `EDU*2+STR*2`,
    `EDU*2+MAX(APP,DEX,STR)*2`, `EDU*2+MAX(DEX,STR)*2`. No `eval`, no
    `Function`, unknown formulas throw `CreationRuleError`.
  - `normalizePointFormulas(source)` / `isSupportedPointFormulas(source)` — an
    occupation may publish `pointFormulas` (ordered either/or list) instead of
    `pointFormula`; the single spelling keeps working unchanged.
  - `interestPoints(int)` — INT × 2 (not the UGE INT × 10 pool).
  - `validateAllocation({ profession, stats, skills, pointFormula })` —
    occupation budget, interest budget, credit rating (occupation points only,
    inside the range), Cthulhu Mythos never allocatable, missing/unverified base
    values rejected instead of defaulted to 0, and totals reported as base +
    occupation + interest (folding into `base` is an error). An either/or
    occupation must pin `pointFormula`; without it the budget is `null`
    (`formula-choice-required`) rather than silently taking the first or the max.
  - `specialismKey` / `specialismBrpid` / `buildSpecialism` — stable ASCII
    `brpid + specKey`, `chosen`/`specName`/`mainName`, no CJK kebab, no `any`
    placeholder, explicit base required.
- M2 source scope stops at data and shared rules. The `studio-coc` wizard, card
  adapter and backend profile/catalog live in the compat repository. Full combat,
  full SAN/insanity, luck-spend, age/asset tables and the remaining occupations
  are still open.
- M1/M2 do not ship a full conversion. The VTT licensing question is still open —
  Chaosium's Fan Material Policy excludes VTTs, and this repository's own code is
  not a licence. See `docs/coc-compatibility-contract.md`.

### CoC 7e M5 (experimental): second batch — five specialisms, five occupations

- Five new specialisms in the `coc-skills` pack (56 skills / 18 specialisms):
  Science (Pharmacy), Science (Engineering), Science (Physics) at base 1 and
  Art/Craft (Acting), Art/Craft (Technical Drawing) at base 5. Each inherits its
  family base; `skillFamilies.concrete` in `content/coc/professions.json` lists
  exactly the published specialisms (checked in both directions).
- Five new occupations (15 total): Doctor of Medicine (`EDU*4`, CR 30–80),
  Police Detective (`EDU*2+DEX*2` **or** `EDU*2+STR*2`, CR 20–50),
  Librarian (`EDU*4`, CR 9–35), Lawyer (`EDU*4`, CR 30–80),
  Engineer (`EDU*4`, CR 30–60). Each has exactly eight occupation skills
  (fixed + choice picks), asserted by the build and the regression.
- Police Detective is never collapsed to `MAX(DEX,STR)`. Its published either/or
  formula is an ordered `pointFormulas` list; the builder must pin one, otherwise
  the allocation has no budget at all.
- Lawyer's "two interpersonal skills" is recorded as `choose: 2` + `distinct: true`
  (two different skills out of Charm/Fast Talk/Intimidate/Persuade). This is the
  product reading of an ambiguous phrase and is documented in provenance.
- Evidence stays **secondary** for all five. Doctor of Medicine and Police
  Detective cite the Roll20 compendium plus the public Chaosium wiki; Librarian,
  Lawyer and Engineer rest on a three-way cross-check of Gamers' Plane,
  callofcthulhu.org.uk and RPG Stack. Nothing here claims an official
  first-party source.
- M5-era compat status: the wizard/adapter was **not** wired for M5 then; M7
  wires the current batch (see below). The builder must read
  `flags.brp.coc.pointFormulas`, pass the chosen formula into
  `validateAllocation({ pointFormula })`, and honour `distinct` choice groups.

### CoC 7e M7 (experimental): coc-cardwright batch — 38 occupations, 59 skills, 21 specialisms

- Fact source switched to the user's **coc-cardwright** repository
  (`tanis90/coc-cardwright`, revision `c0a0733`; its README names `trpg-saikou`
  and `cochar` upstream). The earlier public-page splicing is no longer used for
  this batch. Only numeric formulas, credit ranges and skill names are mapped;
  no template, HTML/CSS, Python implementation or other repository code is copied.
- Evidence stays **secondary**: the repository is a transcription, not a
  Chaosium first-party publication. Its README's upstream chain is recorded as
  a statement, not as independent first-party verification.
- 19 new occupations: Psychiatrist, Museum Curator, Coroner, Judge, Bookseller,
  Antiquarian, Intermediary Investigator, Orderly, Government Official,
  Traveler, Firefighter, Fisherman, Hunter, Pharmacist, Gambler, Tribe Member,
  Spy, Gang Leader, Asylum Orderly. The four M6 records (Police Officer, Artist,
  Clergy, Pilot) are retained and re-sourced to coc-cardwright. Total: **38**.
  Psychiatrist is now buildable, not deferred.
- Only records with a complete eight-item skill shape, a point formula and a
  credit range are imported. coc-cardwright itself carries 112 jobs; this is
  **not the 112-job table**, and no full-occupation coverage is claimed.
- Skills: **59** documents / **21** specialisms. Science (Zoology) and Science
  (Forensics) are added at the Science family base 1; Science (Astronomy) is
  retained.
- Formulas: **7** entries, adding `EDU*2+POW*2`. Private Investigator and
  Soldier move from `MAX(DEX,STR)` to a real `[STR,DEX]` either/or choice;
  Explorer moves from `MAX(APP,DEX,STR)` to `[APP,DEX,STR]`. The chosen formula
  is kept in the occupation document's `pointFormula`; `pointFormulas` remains
  the ordered list for the builder.
- Source-repo tests: `tools/tests/coc-rules-regressions.mjs` **137/137**;
  deterministic builds pass and octopus artifacts stay byte-identical. The
  compat-repo front-end sync and real-stack 550/550 (dev HS256) are recorded in
  the compat repo's `PROGRESS.md` and `docs/coc-compatibility-contract.md`.

### CoC 7e core content closure: 60 skills / 9 professions

The public owner now carries only the core content closure. The full
occupation/skill fact source, its extension-only provenance, the SealDice
importer, the extension LevelDB pack builder and the sibling distribution
references (including `expansionRef`) were moved out of this repository; the
rules, compatibility documentation, SAN/Luck design and
`content/coc/sanity-provenance.json` stay here.

| Object | Public owner |
| --- | --- |
| `coc-skills` | **60** documents (22 specialisms), `packs` + `packs-index` + `packs-json` |
| `coc-professions` | **9** entries (8 occupations + custom investigator) |
| `system.json` packs | exactly **4**: `octopus-skills`, `octopus-professions`, `coc-skills`, `coc-professions` |
| Extension packs / importer / `expansionRef` | **0** in this repository |
| `content/coc/` | core facts only (`skills.json`, `professions.json`, core provenance, sanity provenance) |

- `node tools/coc-pack/build.mjs` builds only the two core packs and rejects any
  non-core fact, non-core profession, or non-core pack in `system.json`.
- `node tools/tests/coc-rules-regressions.mjs` asserts the exact 60/9 counts,
  the four-pack registration and the absence of extension artifacts, importers
  and `expandPackBrpids` pointers. It is **147/147** after the migration.
- Consecutive builds are byte-identical; the octopus/UGE artifacts stay
  byte-unchanged.
- `tools/owner-ci/content-pin.json` no longer carries `expansionRef`. Its
  `contentRef` is still the historical 91/156 baseline because the migration
  commit has not been approved yet; the content job's core-60/9 gate fails
  closed on it until the new immutable commit is pinned with a freshly computed
  `contentSetHashSha256` (see `docs/owner-ci.md`).

Regression checks:

```bash
node tools/coc-pack/build.mjs
node tools/tests/coc-rules-regressions.mjs
node tools/tests/base-pack-determinism.mjs
```

### Owner CI

Source-repo owner CI (`.github/workflows/owner-ci.yml`) accepts the release
candidate in two separate lines, never merged: the **runtime job** runs the
source repo's own semantic suites at the tested commit and emits a runtime
manifest + receipt; the **content job** checks out the content baseline pinned in
`tools/owner-ci/content-pin.json` and emits a content manifest + receipt. The
pin still names the legacy 91/156 baseline until the migration commit is
approved; a fail-closed core-60/9 gate rejects it, so the content job cannot
silently bless the old expansion set. Bumping the pin (with a recomputed set
hash) is the explicit upgrade path. `workflow_dispatch` accepts
`runtimeRef` / `contentRef` to re-verify any historical published combination.
Manifests/receipts and the assembled BRP system artifact are uploaded as
workflow artifacts on every run; nothing is pushed back to the repo. A
`release-*` tag pushed from `main` additionally runs the **release-publish**
job, which re-verifies that the artifact bytes belong to the tagged commit and
uploads `system.zip` / `system-manifest.json` / `system-receipt.json` as a
GitHub Release (A-class coordinate, D2/D8). Tags off the `main` ancestry and
non-`release-*` tags fail closed without publishing. Rules, commands, file-set
rules and receipts: [docs/owner-ci.md](docs/owner-ci.md).

---

# 中文说明

一套克苏鲁式 d100 恐怖规则的 Foundry VTT 系统：百分位检定、理智值、运气、
职业创建、技能成长、守密人工具——为"克苏鲁D100"玩法自研的规则底座。

## Fork 信息

- 本项目是 **[cragstone/brp](https://github.com/cragstone/brp)**（Basic Role
  Playing for Foundry VTT）的 fork，基点为上游 tag `13.57`（commit `d8e2b4c`，
  Foundry V13 线，verified 13.351）；上游 remote 名为 `upstream`，可随时合并上游修复。
- **包 id 保持 `brp`**（settings 命名空间 / i18n 键 / BRPID 概念与 id 绑定，改名是
  独立任务）；显示名为「章鱼料理研究会」。与上游 brp 系统同装会目录冲突，二选一。
- 版本号独立演进（0.1.0 起），不复用上游序列。
- **packs/ 已移除**：上游 LICENSE.txt 将 packs 目录排除在 MIT 之外（Chaosium 条款），
  该内容不随本 fork 分发。

## 致谢

- **[BRP for Foundry VTT](https://github.com/cragstone/brp)** — Dangermouse、JamesB
  及贡献者：本项目的代码底座，MIT。
- **[Boilerplate System](https://github.com/Asacolips/projects)** — Asacolips：上游
  项目的系统模板底座，MIT。
- **Chaosium Inc.** — 规则文本来源《Basic Roleplaying: Universal Game Engine》ORC
  SRD；"Basic Roleplaying"“克苏鲁的呼唤”等名称与商标归 Chaosium 所有，本项目与
  Chaosium 无关联、不使用其商标。ORC notice 原文见上方英文 License 节（法律文本
  不翻译，以英文原文为准）。

## 许可

- **代码**：MIT，见 [LICENSE.txt](LICENSE.txt)（原样保留上游两段署名）。
- **规则文本**：将来内置的 SRD 衍生文本将按 ORC 要求随附许可文本与 Licensed
  Content 声明；当前版本尚未内置任何 SRD 文本。

## 路线图（克苏鲁D100 专属层）

在 BRP d100 骨架上叠加六件套（挂点评估见 mt-foundry-compat 仓 `research/rules-brp`
分支 `docs/rules-integration/brp-report.md` §10）：SAN 全链、Luck 消费降值（不重掷）、职业创建、
技能成长改造、Keeper 工具、恐惧症/躁狂。

## 开发

在 mt-foundry-compat 兼容层下无头开发：本目录内容放进
`mt-foundry-compat/web/packages/brp/`，然后：

```bash
MT_SYSTEM_ID=brp node --experimental-vm-modules tools/run-headless.mjs
```

### 0.3.1-dev（未发布）

本树是 `v0.3.0` 之上的未发布修复快照（system 版本 `0.3.1-dev`），集成时按
dev 包处理，不要当成原版 `0.3.0` 交付。

- NPC/战斗：战斗卡结算不再因 NPC 武器缺少 `skillId` 崩溃；autoXP 关闭时不再勾
  XP。非 HPL 的 NPC 当前 HP 走原生“掷/平均属性 → updateVitals 置满”或 keeper
  手改，wound 只属于 character/HPL 模型，不是 NPC 的 HP 模型。
- SAN：keeper「新的一天」清零 `dailyLoss`；`tempInsane` 被删除、禁用或世界时间
  到期时，发作卡同步结束并重渲染。
- Luck：检定卡消费串行；所有客户端把聊天卡操作路由到 Foundry 确定性的
  `activeGM` 单写者。
- 角色卡：新建 PC 默认使用态（`system.lock=true`）；窗头最左侧一个原生
  编辑/使用切换，复用既有 lock 动作，正常技能列表/开发网格随之切换；正文重复锁
  入口已移除。既有未锁角色保持原状，NPC 不变。
- 属性：canonical 属性键是 `cha`（模板 schema）。d100 车卡器与 CardAdapter 必须
  读写 `cha`；不提供 `app` 别名或迁移，错写 `app` 的测试卡直接重建。
- 角色创建：新角色默认附挂 1 条真实「徒手（斗殴）」武器，关联 `i.skill.brawl`
  （`1D3`、full Damage Modifier、Crushing、Short、1H、不能 Parry）；攻击读取斗殴
  技能实时 total，不落库固化命中率。starter skills 关闭时只补斗殴。既有角色、
  导入与 NPC 不迁移。
- 角色卡战斗页：规则集没有技能分类加成时（`skillcategory` 为空，例如 CoC 核心
  技能），武器命中率按 `0` 分类加成计算，不再显示 `NaN`；有分类的规则集行为不变。
- 基础包：职业引用 UUID 从已提交产物复用，并有确定性回退；连续两次构建
  byte-identical，不制造 ID 迁移。

### CoC 7e M1（实验）

CoC 规则作为可选项与 octopus/UGE 并存，不替换原行为。隐藏 world setting
`brp.ruleset` 缺省为 `octopus`；后端 catalog/settingsSeed 使用的外部值 `coc7`
显式映射到内部 `coc` 适配器，`coc` 也继续可用；未知值回落 `octopus`，不会当成
CoC。本期只是核心纵向切片，不是完整 CoC。

- `content/coc/skills.json` + `packs-json/coc-skills.json` + `packs/coc-skills/`：
  公开 owner 只保留 **60 条核心技能**（22 条专精）。7 条未证实专精标为
  `pending-official-source`，不写固定值、不写入包。扩展技能、专属事实源与构建链
  已迁出公开仓。octopus 包字节不变。
- `module/rules/`：集中式规则接口。CoC 派生 HP/MP/SAN/Luck/Build/DB/MOV，
  使用 CoC 成功等级与 +1D10 成长，APP 映射原生 `cha`，EDU 启用。闪避（½ DEX）
  与母语（EDU）走原生 `variable`/`baseFormula`。
- 验收口径：当前收缩后的源仓 `coc-rules-regressions` 为 **147/147**（核心
  60/9 + 扩展 0）；M1/M2/M5 的历史计数仅作记录。基础包连续构建
  byte-identical；前端卡面、runtime profile、隔离栈真实 REST/WS+浏览器验收与清理
  证据记在 compat 仓的 `PROGRESS.md` 与 `docs/coc-compatibility-contract.md`。
- 原生 `BRPCheck` 仍是真实检定链，只委托判级。starter 技能与技能分类按内容
  来源隔离：CoC 不继承 octopus 技能/分类，octopus 不混入 CoC 技能。导入、旧
  Actor 与 NPC 不迁移。
- 本期不含完整职业创建、战斗、SAN/疯狂、幸运消费；CoC 卡面/适配器与后端
  profile/catalog 在 compat 仓，不在本源仓。VTT 授权问题仍未结论：Chaosium 的
  Fan Material Policy 明确把 VTT 排除在政策覆盖之外，本仓自研代码不等于已获授权，
  见 `docs/coc-compatibility-contract.md`。

### CoC 7e M2（实验）：职业、信用评级与配点规则

首批职业是数据驱动、构建期校验的，不是完整职业表：没有可核对公式或信用区间的
职业不会成为可建卡默认值。

- `content/coc/professions.json` + `packs-json/coc-professions.json` +
  `packs/coc-professions/`：公开 owner 只保留 **9 条核心入口**（作家、纨绔子弟、
  调查记者、私家侦探、教授、医生（医学博士）、警探、古董商，以及产品定义的自定义
  调查员），已注册进 `system.json`。每条带 `flags.brp.contentSource="coc"` 与
  `flags.brp.coc`（`slug`/`creditMin`/`creditMax`/`pointFormula`）。
  扩展职业与专属事实源已迁出公开仓。octopus 包字节不变。
- 事实以**次级证据**记入 `content/coc/provenance.json`（Roll20 职业页，页面自身
  标注来源为 Free Basic Rules），逐职业钉住公式与信用区间。
- 信用评级是职业约束，不是 UGE 财富档：`minWealth`/`maxWealth` 保持 `0`，并用
  `wealthNotApplicable` 标出原因。
- `module/rules/creation.mjs`：无框架依赖的纯函数模块，车卡器直接 import：
  - `evaluatePointFormula(formula, stats)`：白名单/AST 求值 `EDU*4`、
    `EDU*2+DEX*2`、`EDU*2+APP*2`、`EDU*2+STR*2`、
    `EDU*2+MAX(APP,DEX,STR)*2`、`EDU*2+MAX(DEX,STR)*2`；不用
    `eval`/`Function`，非法公式抛 `CreationRuleError`。
  - `normalizePointFormulas(source)` / `isSupportedPointFormulas(source)`：职业
    可用 `pointFormulas`（有序二选一数组）替代 `pointFormula`，单公式写法行为不变。
  - `interestPoints(int)`：INT × 2（不是 UGE 的 INT × 10 点池）。
  - `validateAllocation({ profession, stats, skills, pointFormula })`：职业点预算、
    兴趣点预算、信用评级（只用职业点且落区间）、克苏鲁神话禁投、缺基础值/未证实
    基础值拒绝而不按 0 处理；终值按 base + 职业 + 兴趣返回，折叠进 `base` 视为错误。
    多公式职业必须显式选定 `pointFormula`，否则报 `formula-choice-required` 且
    `budgets` 为 `null`（不默认取第一条，更不取 MAX）。
  - `specialismKey` / `specialismBrpid` / `buildSpecialism`：稳定 ASCII
    `brpid + specKey`、`chosen`/`specName`/`mainName`；不允许中文 kebab、不允许
    `any` 占位、基础值必须显式给出。
- M2 本源仓范围只到数据与共享规则。`studio-coc` 向导、卡面适配器与后端
  profile/catalog 在 compat 仓；完整战斗、SAN/疯狂、幸运消费、年龄/资产表与其余
  职业仍未完成。VTT 授权问题仍未结论：Chaosium 的 Fan Material Policy 明确把 VTT
  排除在政策覆盖之外，本仓自研代码不等于已获授权。

### CoC 7e M5（实验）：第二批——5 条专精、5 个职业

- `coc-skills` 新增 5 条专精（技能 51 → 56，专精 13 → 18）：科学（药学）、
  科学（工程学）、科学（物理学）基础值 1；艺术/手艺（表演）、艺术/手艺
  （技术制图）基础值 5。专精继承族基础值，`professions.json` 的
  `skillFamilies.concrete` 与已发布专精双向一致（包里多一条就永远选不到，
  族里多一条就是悬空引用，构建与回归都拒绝）。
- 职业 10 → 15：医生（医学博士）`EDU*4` CR30–80；警探 `EDU*2+DEX*2` **或**
  `EDU*2+STR*2` CR20–50；图书管理员 `EDU*4` CR9–35；律师 `EDU*4` CR30–80；
  工程师 `EDU*4` CR30–60。五个职业都是固定技能 + 选择组恰好 8 项，由构建与回归
  双向锁定。
- 警探不折叠成 `MAX(DEX,STR)`：按原文的二选一记成有序 `pointFormulas`，建卡时
  必须选定一条，否则不给预算。
- 律师的「两项人际技能」按产品口径记成 `choose: 2` + `distinct: true`，即从
  魅惑/话术/恐吓/说服中选两个**不同**技能；这是对歧义表述的产品解释，已写进
  provenance。
- 证据全部为 **secondary**：医生与警探用 Roll20 授权页 + Chaosium 公开 wiki；
  图书管理员、律师、工程师用 Gamers' Plane、callofcthulhu.org.uk、RPG Stack
  三处二手交叉核验。不声称官方一手。
- compat 仓的车卡向导/适配器在 M5 时点尚未接线；M7 已接当前批次（见下）。
  接线需读 `flags.brp.coc.pointFormulas` 渲染二选一、把选定公式传回
  `validateAllocation({ pointFormula })`，并支持 `distinct` 选择组。

### CoC 7e M7（实验）：coc-cardwright 批次——38 职业 / 59 技能 / 21 专精

- 事实源切换为用户仓库 **coc-cardwright**（`tanis90/coc-cardwright`，revision
  `c0a0733`；其 README 自述上游 `trpg-saikou`、`cochar`）。本批不再用公开职业
  网页拼表，只取数值、公式、信用区间与技能名；不复制其模板、HTML/CSS、Python
  实现或其他仓代码。
- 证据仍全部为 **secondary**：该仓库是次级转录，不是 Chaosium 官方出版物；
  README 的上游声明只作审计线索，不当作独立一手核验。
- 新增 19 个职业：精神病学家、博物馆管理员、法医、法官、书商、古董商、中介调查员、
  勤杂护工、政府官员、旅行家、消防员、渔民、猎人、药剂师、赌徒、部落成员、间谍、
  黑帮老大、精神病院护工；M6 的警察（巡警）、艺术家、神职人员、飞行员 4 条记录
  保留并统一来源。合计 **38 个职业**；精神病学家已落地，不再 deferred。
- 只导入能确认完整八项、公式与信用区间的条目。coc-cardwright 自述 112 个职业，
  本批**不是 112 全表**，不宣称全职业覆盖。
- 技能 **59 条 / 21 条专精**：新增科学（动物学）、科学（鉴证），均取 Science 族
  基础值 1；科学（天文学）保留。
- 公式 **7 条**，新增 `EDU*2+POW*2`。私家侦探、士兵从 `MAX(DEX,STR)` 改为
  `[STR,DEX]` 真实二选一；探险家从 `MAX(APP,DEX,STR)` 改为 `[APP,DEX,STR]`
  三选一。职业文档的 `pointFormula` 保存实际选择，`pointFormulas` 保留完整列表。
- 源仓验证：`tools/tests/coc-rules-regressions.mjs` **137/137**、确定性构建通过，
  octopus 产物字节不变。compat 前端同步与真实栈 550/550（dev HS256）记在 compat
  仓 `PROGRESS.md` 与 `docs/coc-compatibility-contract.md`。

### CoC 7e 核心内容闭包：60 技能 / 9 职业

公开 owner 现在只承载核心内容闭包。全量职业/技能事实源、扩展专属 provenance、
SealDice 导入器、扩展 LevelDB 打包器、扩展引用（含 `expansionRef`）均已迁出本仓；
规则实现、兼容文档、SAN/Luck 设计与 `content/coc/sanity-provenance.json` 保留。

| 对象 | 公开 owner |
| --- | --- |
| `coc-skills` | **60** 条文档（22 条专精），`packs` + `packs-index` + `packs-json` |
| `coc-professions` | **9** 条入口（8 个职业 + 自定义调查员） |
| `system.json` packs | 正好 **4** 个：`octopus-skills`、`octopus-professions`、`coc-skills`、`coc-professions` |
| 扩展包 / 导入器 / `expansionRef` | 本仓 **0** |
| `content/coc/` | 只保留核心事实（`skills.json`、`professions.json`、核心 provenance、sanity provenance） |

- `node tools/coc-pack/build.mjs` 只构建两个核心包；任何非核心技能/职业或
  `system.json` 中的非核心 pack 都会构建失败。
- `node tools/tests/coc-rules-regressions.mjs` 断言精确 60/9、四个 pack 注册、
  扩展产物/导入器/`expandPackBrpids` 指针全部缺席；迁移后为 **147/147**。
- 连续构建 byte-identical，octopus/UGE 产物字节不变。
- `tools/owner-ci/content-pin.json` 已移除 `expansionRef`。`contentRef` 仍是
  历史 91/156 基线（迁移提交尚未获批），content job 的 core-60/9 门会 fail
  closed；新 commit 获批后须按 `docs/owner-ci.md` 重钉不可变 commit 并重算
  `contentSetHashSha256`。

回归检查：

```bash
node tools/coc-pack/build.mjs
node tools/tests/coc-rules-regressions.mjs
node tools/tests/base-pack-determinism.mjs
```

### Owner CI

源仓自有 owner CI（`.github/workflows/owner-ci.yml`）分两条独立线验收发布候选，
不合并：**runtime job** 对被测 commit 跑源仓自有语义测试并出 runtime
manifest + receipt；**content job** 用 `actions/checkout` 钉住
`tools/owner-ci/content-pin.json` 里的内容基线并出 content manifest + receipt。
迁移提交获批前 pin 仍指向旧 91/156 基线，content job 的 core-60/9 fail-closed 门
会拒绝它，不会把旧扩展集悄悄当成本次内容；显式改 pin（并重算集合 hash）才是
升级路径。`workflow_dispatch` 可指定
`runtimeRef` / `contentRef` 复核任意历史已发布组合。manifest/receipt 与组装出的
BRP system artifact 在每次 run 都作为 workflow artifact 上传，不推回仓库；
自 `main` 推 `release-*` tag 时会额外跑 **release-publish** job，复核产物字节
确实属于该 tag 的 commit 后，把 `system.zip` / `system-manifest.json` /
`system-receipt.json` 上传为 GitHub Release（A 类坐标，D2/D8）。不在 main 祖先线
上的 tag 与非 `release-*` tag 一律 fail-closed，不出件。规则、命令、file set 与
receipt 口径见 [docs/owner-ci.md](docs/owner-ci.md)。
