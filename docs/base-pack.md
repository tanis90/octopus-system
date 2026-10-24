# 技术方案：章鱼料理基础包 v1（技能 + 职业内容包）

状态：v1 定稿（2026-10-24）· 分支 `feat/base-pack`
纪律：方案即台账（§8）——偏离先改 §9 再改代码。

## 1. 目标 / 非目标

**目标**：ORC 干净的首个内容包——UGE 技能全集 + 职业全集（中文名/描述/基础值），
落成 Foundry 包；新角色 starter 附挂自动带全中文技能表；职业可拖入卡面配点车卡。

**非目标**：生物包（v1.1）；职业配点余额校验器与车卡向导（后续系统/产品件）；
英文平行包（机制已支持，后补）。

## 2. 数据源与许可

- **唯一文本源**：`raleel/brpugesrd`（BRP:UGE ORC 版全文 markdown，与我们底座同许可）
  ——本地克隆于 `.tmp/brpugesrd`（不入本仓），**提取时记录其 HEAD commit** 入 provenance。
- 结构：`rules/en/0300_Skills.md` 技能条目（`### 名` + `**Base Chance:** N%` +
  `**Category:** X` + 描述）；`rules/en/0200_Characters.md` "Professions A Through Z"
  职业条目（`#### 名` + 描述 + `**Wealth**` + `**Skills**` 清单）。
- **ORC 义务**：随包附 ORC 许可文本 + Licensed Content 声明（列出所用 UGE 章节：
  Ch2 Characters 职业节 / Ch3 Skills）+ Chaosium 署名（徽章文本形态，照 brpugesrd LICENSE）。
  **Red zone 零进入**：无信用评级（wealth 用 UGE 原文口径 Poor/Average/...）、
  无克苏鲁神话技能、无任何 CoC 7e 专属文本。

## 3. 规范中间格式与 Item 文档约定

`content/skills.canonical.json` / `content/professions.canonical.json`（en 提取产物，
带 sourceLocator）→ `content/*.zh-CN.json`（译层：name/description/wealth）。

**Item 文档形态**（双格式由 build 从同源生成）：

```
skill:    { type: "skill", name: <中文>, flags: { brp: { brpidFlag: { id: "i.skill.<slug>",
            lang: "zh-CN", priority: 1 } }, enName: <英文> },
            system: { base: <UGE 基础值>, basic: true, category: <映射码|默认>, baseFormula: 固定值 } }
profession: { type: "profession", name: <中文>, 同款 brpidFlag("i.profession.<slug>"),
            system: { skills: <技能名清单（中文，逗号分隔，可选组照 UGE 原文语义）, wealth: <UGE 口径> } }
```

关键机制依据（代码实证）：
- starter 附挂 = `starterSkills` 设置 → `fromBRPIDRegexBest('^i.skill')` 过滤 `system.basic`
  （actor.mjs:786-796）——**basic 必须为 true，brpid lang 标记 zh-CN 使中文文档直接命中**
  （brpid.mjs #filterByLanguage：当前语言版本存在时压制 en 版）。
- `_calcBase` 重算以 `baseFormula` 固定值形态回填同值，无副作用。
- category 映射：UGE 五类（Mental/Perception/Combat/Communication/Manipulation）→
  系统 skillcat 码（cmmnmod 等）；映射不全的落默认值，v1 不追求分类加成语义。

## 4. 交付形态（build 产物，`tools/base-pack/build.mjs`）

| 面 | 产物 | 消费方 |
|---|---|---|
| compat 栈 | `packs-json/octopus-skills.json`（文档数组）+ `packs-index/*.json` | shim 静态包加载器（bootstrap registerCompendiumPack→staticPackLoaders） |
| 真 Foundry | `packs/octopus-skills/<uuid>.json`（folder pack，每文档一文件） | 本机 FVTT/未来真机 |
| 注册 | `system.json` packs 数组两席（skills/professions，label 中文） | 两面共用 manifest |

`packs-*` 目录随仓分发（自有 ORC 内容，非上游被剥离的 Chaosium packs）。
`.gitignore` 若有 packs 排除需为本包路径开白。

## 5. 翻译纪律（BP-M3）

- 术语锁：沿用仓内 zh-CN.json 已定稿术语（特殊成功/理智值/幸运/八属性…）；
  brpugesrd `zh-CN.json` 术语表为校验源；新术语（技能/职业名）逐条定稿入术语表。
- 译文风格：规则书语气、简练；描述全译（LLM 批量 + 术语锁 + 人工抽检 10 条）。
- 数值/清单结构字段**不译**（base/skills 引用名需与技能包中文名一致——职业清单里的
  技能引用按已定技能名回写）。

## 6. 验证（BP-M5）

1. build 产物自检：文档数 = 提取数；技能名/职业名唯一；职业引用的技能名 ⊆ 技能名集；
   base ∈ [0,100]；brpid 唯一。
2. 无头探针（mt-wt-brp brp-spike-eval 扩展）：装包后新建角色 → 技能条数 ≥ 40、
   中文名含"侦查/聆听"类样本、base 值抽样对拍 UGE、`system.basic` 真。
3. 本地栈 E2E：真 lobby/play 新建角色 → starter 附挂可见中文技能表（截图留证）。
4. 本机 FVTT（D:\FVTT_DATA）folder pack 装载冒烟。

## 7. 发布

v0.3.0：tag + release zip + compat 仓 vendor 台账 hash 更新（brp-hash.mjs）+ 本地演示面同步。

## 8. 实现台账（随 commit 填写）

| 工作项 | commit | 验证结果 |
|---|---|---|
| 方案 v1 | 本 commit | — |
| BP-M2 提取管线（en canonical） | | |
| BP-M3 中译 | | |
| BP-M4 build 双格式 + 注册 + notice | | |
| BP-M5 验证 + v0.3.0 发布 | | |

## 9. 变更记录（偏离申报）

- v1：无。
