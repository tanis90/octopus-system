# 内容包（content packs）

状态：2026-11-15 现行事实。本文描述源仓当前构建并分发的两个核心内容包；
同名旧文档（UGE 基础包 v1 方案）描述的 octopus 内容线已退役。

## 1. 现行包清单

| pack | 文档数 | Item 类型 | 产物 |
| --- | --- | --- | --- |
| `coc-skills` | 60（22 条专精） | `skill` | `packs-json/coc-skills.json`、`packs-index/coc-skills.json`、`packs/coc-skills/<id>.json` |
| `coc-professions` | 9（8 个职业 + 自定义调查员） | `occupation` | `packs-json/coc-professions.json`、`packs-index/coc-professions.json`、`packs/coc-professions/<id>.json` |

`system.json` 的 `packs` 只注册这两个包（`type: "Item"`、`system: "brp"`）。
octopus 的 `octopus-skills` / `octopus-professions` 以及任何扩展包都不再注册。

## 2. 事实源与构建

- 事实源：`content/coc/skills.json`、`content/coc/professions.json`；
  来源与许可边界记在 `content/coc/provenance.json`，SAN 相关来源记在
  `content/coc/sanity-provenance.json`。
- 构建：`node tools/coc-pack/build.mjs`。文档 id 由稳定 ASCII brpid 经
  sha256 确定性派生，同一事实源连续构建逐字节一致。
- 输出：每个包同时写 compat 栈文档数组（`packs-json/`）、索引
  （`packs-index/`）和真 Foundry folder pack（`packs/<pack>/<id>.json`），
  并把两个包按名字幂等写入 `system.json`。
- 构建期 fail-closed 校验：核心技能正好 60、核心职业正好 9；brpid/key/slug
  唯一且为 ASCII；技能基础值在 0–100；职业点公式必须在白名单内；信用区间
  为 0–99 且 `min <= max`；职业引用的技能必须能在 `coc-skills` 内解析；
  `system.json` 不得出现两个核心包以外的 pack。

## 3. Item 文档形态

两个包只使用 `skill` 与 `occupation` 两种 Item 类型。

### skill

```jsonc
{
  "type": "skill",
  "flags": { "brp": {
    "brpidFlag": { "id": "i.skill.coc.<slug>", "lang": "zh-CN", "priority": 1 },
    "enName": "<英文名>",
    "contentSource": "coc",
    "coc": { "factId": "...", "key": "...", "pack": "core",
             "specKey": null, "parentKey": null, "sourceRefs": ["..."] }
  } },
  "system": {
    "skillName": "<主名>", "specialization": "<专精名或空>", "base": "25",
    "basic": true,
    "adjustments": { "base": 0, "personal": 0, "occupation": 0,
                     "archetype": 0, "experiencePackage": 0, "experience": 0 },
    "properties": { "push": true, "fighting": false, "firearm": false, "ranged": false,
                    "special": false, "noxpgain": false, "rarity": false,
                    "requiresname": false, "picknameonly": false, "own": false,
                    "keepbasevalue": false },
    "description": { "value": "...", "keeper": "" }
  }
}
```

### occupation

```jsonc
{
  "type": "occupation",
  "flags": { "brp": {
    "brpidFlag": { "id": "i.profession.coc.<slug>", "lang": "zh-CN", "priority": 1 },
    "enName": "<英文名>",
    "contentSource": "coc",
    "coc": { "factId": "...", "slug": "...", "pack": "core",
             "summary": "一句玩家可见的简介。",
             "creditMin": 9, "creditMax": 30,
             "pointFormula": "EDU*4", "pointFormulas": ["..."],
             "evidence": "secondary", "sourceRefs": ["..."],
             "fixedSkillKeys": ["..."], "specialismSlots": [],
             "choiceGroups": [/* 每项 options[].brpids[] */] }
  } },
  "system": {
    "description": { "value": "...", "keeper": "" },
    "source": "<sourceRefs 逗号拼接>",
    "type": { "classic": false, "lovecraftian": false, "modern": false, "pulp": false },
    "occupationSkillPoints": {
      "str": { "multiplier": null, "selected": false, "optional": false },
      "con": { "multiplier": null, "selected": false, "optional": false },
      "siz": { "multiplier": null, "selected": false, "optional": false },
      "dex": { "multiplier": null, "selected": false, "optional": false },
      "app": { "multiplier": null, "selected": false, "optional": false },
      "int": { "multiplier": null, "selected": false, "optional": false },
      "pow": { "multiplier": null, "selected": false, "optional": false },
      "edu": { "multiplier": 4, "selected": true, "optional": false }
    },
    "creditRating": { "min": 9, "max": 30 },
    "itemDocuments": [], "itemKeys": ["i.skill.coc.history", "..."],
    "groups": [{ "options": 1, "itemDocuments": [], "itemKeys": ["..."] }],
    "personal": 0, "personalText": ""
  }
}
```

- 信用评级是职业约束，写 `system.creditRating`；不再使用 UGE 财富档
  （`minWealth` / `maxWealth` 已随旧型删除）。
- 二选一职业（如私家侦探、警探）：首条公式写入 `occupationSkillPoints`
  的乘数，全部选项仍按原文顺序保存在 `flags.brp.coc.pointFormula(s)`，
  建卡时必须显式选定一条。
- 原生 `itemKeys` / `groups[].itemKeys` 存技能 brpid；无法枚举的“任意技能”
  组只保留在 `flags.brp.coc.choiceGroups`，不伪造原生选项。
- `flags.brp.coc.summary` 是源职业数据里逐条写好的单行简介，构建器只校验格式并
  原样映射，不从 `system.description` 截断；`description` 首段保持源文不变。
- 专精槽、证据强度、固定技能 key 等构建期事实保留在 `flags.brp.coc`，
  供车卡器读取；不写第二份身份表。

## 4. 类型名册

`template.json` 是唯一名册源：

- Item（13）：`item`、`skill`、`talent`、`weapon`、`armor`、`book`、
  `occupation`、`spell`、`setup`、`status`、`archetype`、
  `experience-package`、`chase`。
- Actor（4）：`character`、`npc`、`vehicle`、`creature`（与 `npc` 同结构，
  由 `CocNpcSheet` 接管）。
- 内容包只产出 `skill` 与 `occupation`；其余类型由世界/模组导入或手工创建。

## 5. octopus 基础包退役

UGE/octopus 内容线已废弃，现状由代码强制：

- `content/skills.*.json`、`content/professions.*.json`、`content/provenance.json`、
  `content/terminology.json` 与 `tools/base-pack/extract.mjs` 已删除。
- `packs/octopus-*`、`packs-json/octopus-*.json`、`packs-index/octopus-*.json`
  已删除；`system.json` 不再注册这两个包。
- `node tools/base-pack/build.mjs` 保留为退役守卫：拒绝回归的 octopus 内容源，
  清理残留产物，并断言 `system.json` 只有两个核心 CoC 包。

## 6. 验证

```bash
node tools/coc-pack/build.mjs
node tools/base-pack/build.mjs
node tools/tests/base-pack-determinism.mjs
node tools/tests/coc-rules-regressions.mjs
git diff --exit-code
```

`base-pack-determinism` 连续两次构建并比对已提交产物；`git diff --exit-code`
证明重建字节等于已提交字节。内容集固定为 73 个 `packs*` 文件：69 个 folder pack 文档（60 技能 + 9 职业）
加 2 个 `packs-json` 与 2 个 `packs-index` 文件。
