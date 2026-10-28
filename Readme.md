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
- Base pack: profession ref UUIDs are reproduced from the committed seed with a
  deterministic fallback; consecutive builds are byte-identical.

Regression checks:

```bash
node tools/tests/base-pack-determinism.mjs
MT_SYSTEM_ID=brp MT_SPIKE_EVAL=tools/tests/rules-regressions.mjs \
  node --experimental-vm-modules tools/run-headless.mjs
```

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
- 基础包：职业引用 UUID 从已提交产物复用，并有确定性回退；连续两次构建
  byte-identical，不制造 ID 迁移。

回归检查：

```bash
node tools/tests/base-pack-determinism.mjs
MT_SYSTEM_ID=brp MT_SPIKE_EVAL=tools/tests/rules-regressions.mjs \
  node --experimental-vm-modules tools/run-headless.mjs
```
