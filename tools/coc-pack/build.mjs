// CoC 7e content pack build (M1 core skills + M2 first-batch occupations).
// Source of truth: content/coc/skills.json and content/coc/professions.json
// (facts + provenance). Prose in the packs is written for this project.
// Outputs: packs-json/coc-skills.json, packs-index/coc-skills.json,
//          packs/coc-skills/<id>.json (real Foundry folder pack),
//          packs-json/coc-professions.json, packs-index/coc-professions.json,
//          packs/coc-professions/<id>.json, system.json registration.
// Deterministic: document ids derive from the stable ASCII brpid only.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isSupportedPointFormulas, isAsciiId } from "../../module/rules/creation.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const facts = read("content/coc/skills.json");
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const docId = (seed) => {
  let out = "";
  let i = 0;
  while (out.length < 16) {
    const byte = createHash("sha256").update("coc:" + seed + ":" + i).digest()[0];
    out += ALPHABET[byte % ALPHABET.length];
    i += 1;
  }
  return out;
};

const BRPID_RE = /^i\.skill\.coc\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROF_BRPID_RE = /^i\.profession\.coc\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SPEC_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_ZERO = new Set(["credit-rating", "cthulhu-mythos"]);
const sourceRefs = (entry) => entry.sourceRefs ?? facts.defaultSourceRefs ?? [];
const isCombat = (entry) => entry.key === "dodge"
  || entry.parentKey === "fighting"
  || entry.parentKey === "firearms";

const errors = [];
const seenBrpid = new Set();
const seenName = new Set();
const seenKey = new Set();
const seenSpec = new Set();

for (const entry of facts.skills) {
  if (!BRPID_RE.test(entry.brpid ?? "")) errors.push(`非 ASCII/格式错误的 brpid: ${entry.brpid}`);
  if (!SPEC_RE.test(entry.key ?? "")) errors.push(`非 ASCII key: ${entry.key}`);
  if (seenBrpid.has(entry.brpid)) errors.push(`重复 brpid: ${entry.brpid}`);
  if (seenKey.has(entry.key)) errors.push(`重复 key: ${entry.key}`);
  if (seenName.has(entry.name)) errors.push(`重名: ${entry.name}`);
  seenBrpid.add(entry.brpid);
  seenKey.add(entry.key);
  seenName.add(entry.name);

  if (entry.specialism) {
    if (!SPEC_RE.test(entry.specKey ?? "")) errors.push(`专精缺少稳定 ASCII specKey: ${entry.key}`);
    if (!entry.parentKey) errors.push(`专精缺少 parentKey: ${entry.key}`);
    if (!entry.mainName) errors.push(`专精缺少 mainName: ${entry.key}`);
    const specId = `${entry.parentKey}/${entry.specKey}`;
    if (seenSpec.has(specId)) errors.push(`重复专精标识: ${specId}`);
    seenSpec.add(specId);
  }

  if (entry.variable) {
    const formula = entry.baseFormula ?? {};
    const terms = [formula[1], formula[2]].filter(Boolean);
    if (!terms.some((term) => term.stat && term.stat !== "fixed" && Number(term.value) > 0)) {
      errors.push(`公式技能没有有效变量项: ${entry.key}`);
    }
  } else if (!Number.isFinite(entry.base)) {
    errors.push(`固定技能缺少基础值: ${entry.key}`);
  } else if (entry.base === 0 && !ALLOWED_ZERO.has(entry.key)) {
    errors.push(`未证实专精不得写成 fixed 0: ${entry.key}`);
  } else if (entry.base < 0 || entry.base > 100) {
    errors.push(`基础值越界: ${entry.key}`);
  }
}

for (const pending of facts.pendingSpecialisms ?? []) {
  if (pending.base !== null) errors.push(`pending 专精不得有固定基础值: ${pending.factId}`);
  if (!pending.reason) errors.push(`pending 专精缺少原因: ${pending.factId}`);
}

if (errors.length) {
  console.error(`CoC 内容校验失败 ${errors.length} 条：`);
  errors.slice(0, 12).forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

const docs = facts.skills.map((entry) => {
  const base = entry.variable ? 0 : entry.base;
  return {
    _id: docId(entry.brpid),
    name: entry.name,
    type: "skill",
    flags: {
      brp: {
        brpidFlag: { id: entry.brpid, lang: "zh-CN", priority: 1 },
        enName: entry.enName,
        contentSource: "coc",
        coc: {
          factId: entry.factId,
          key: entry.key,
          specKey: entry.specKey ?? null,
          parentKey: entry.parentKey ?? null,
          sourceRefs: sourceRefs(entry),
        },
      },
    },
    system: {
      base,
      basic: true,
      combat: isCombat(entry),
      category: "none",
      baseFormula: entry.variable
        ? entry.baseFormula
        : { 1: { stat: "fixed", value: base }, 2: { stat: "fixed", value: 0 }, Func: "or" },
      variable: !!entry.variable,
      specialism: !!entry.specialism,
      chosen: !!entry.specialism,
      specName: entry.specialism ? entry.name : "",
      mainName: entry.mainName ?? "",
      noXP: !!entry.noXP,
      description: entry.description,
    },
  };
});

const skillByKey = new Map(facts.skills.map((entry) => [entry.key, entry]));
const skillDocId = (key) => docId(skillByKey.get(key).brpid);

// Hard isolation guard: no octopus brpid may ever be emitted into this pack.
const octopusBrpids = new Set();
const octopusSkillsPath = join(ROOT, "packs-json/octopus-skills.json");
if (existsSync(octopusSkillsPath)) {
  for (const doc of JSON.parse(readFileSync(octopusSkillsPath, "utf8"))) {
    const id = doc?.flags?.brp?.brpidFlag?.id;
    if (id) octopusBrpids.add(id);
  }
}
const collisions = docs.filter((doc) => octopusBrpids.has(doc.flags.brp.brpidFlag.id));
if (collisions.length) {
  console.error(`CoC 与 octopus 的 brpid 冲突 ${collisions.length} 条：${collisions.map((d) => d.flags.brp.brpidFlag.id).join(", ")}`);
  process.exit(1);
}

// ---------------------------------------------------------------- occupations
// M2 first batch. Every record must carry a verified point formula, a verified
// credit-rating range and resolvable skill references. Anything missing is a
// hard build failure: a profession without those facts may not become a
// character-creation default.
const occupations = read("content/coc/professions.json");
const families = occupations.skillFamilies ?? {};
const profErrors = [];
const seenSlug = new Set();
const seenProfBrpid = new Set();
const seenProfName = new Set();
const seenFact = new Set();

const skillRef = (key, where) => {
  if (!skillByKey.has(key)) {
    profErrors.push(`${where}: 未知技能 key ${key}`);
    return null;
  }
  return { brpid: skillByKey.get(key).brpid, uuid: skillDocId(key) };
};

const familyOptions = (familyKey, where) => {
  const family = families[familyKey];
  if (!family) {
    profErrors.push(`${where}: 未知技能族 ${familyKey}`);
    return [];
  }
  if (!isAsciiId(family.parentKey)) profErrors.push(`${where}: 技能族 ${familyKey} 的 parentKey 非 ASCII`);
  if (!(family.concrete ?? []).length) profErrors.push(`${where}: 技能族 ${familyKey} 没有具体专精`);
  // A family base is either verified (integer + source) or explicitly unknown.
  // An unknown base is only allowed when the family is marked as requiring an
  // explicit user-supplied value: never silently default it to 0.
  if (family.base === null) {
    if (family.requiresExplicitBase !== true) {
      profErrors.push(`${where}: 技能族 ${familyKey} 基础值为空，必须标记 requiresExplicitBase`);
    }
  } else {
    if (!Number.isInteger(family.base) || family.base < 0 || family.base > 100) {
      profErrors.push(`${where}: 技能族 ${familyKey} 缺少合法基础值`);
    }
    if (!(family.baseSourceRefs ?? []).length) profErrors.push(`${where}: 技能族 ${familyKey} 缺少基础值来源`);
  }
  const refs = [];
  for (const key of family.concrete ?? []) {
    const ref = skillRef(key, `${where}/${familyKey}`);
    if (ref) refs.push(ref);
  }
  return refs;
};

const professions = (occupations.professions ?? []).map((entry) => {
  const where = `occupation ${entry.slug}`;
  const profBrpid = entry.brpid ?? `i.profession.coc.${entry.slug}`;
  if (!isAsciiId(entry.slug)) profErrors.push(`${where}: slug 非 ASCII`);
  if (!PROF_BRPID_RE.test(profBrpid)) profErrors.push(`${where}: brpid 非 ASCII/格式错误 ${profBrpid}`);
  if (profBrpid !== `i.profession.coc.${entry.slug}`) profErrors.push(`${where}: brpid 与 slug 不一致`);
  if (seenSlug.has(entry.slug)) profErrors.push(`${where}: 重复 slug`);
  if (seenProfBrpid.has(profBrpid)) profErrors.push(`${where}: 重复 brpid`);
  if (seenProfName.has(entry.name)) profErrors.push(`${where}: 重名 ${entry.name}`);
  if (seenFact.has(entry.factId)) profErrors.push(`${where}: 重复 factId ${entry.factId}`);
  seenSlug.add(entry.slug);
  seenProfBrpid.add(profBrpid);
  seenProfName.add(entry.name);
  seenFact.add(entry.factId);

  if (!entry.name || !entry.enName) profErrors.push(`${where}: 缺少显示名`);
  if (!entry.description) profErrors.push(`${where}: 缺少描述`);

  // Point formulas: same closed whitelist the runtime evaluator enforces. A
  // record carries either `pointFormula` (one) or `pointFormulas` (either/or,
  // ordered — the player picks one). Both may not be present at once.
  const hasSingle = entry.pointFormula !== undefined && entry.pointFormula !== null;
  const hasMultiple = entry.pointFormulas !== undefined;
  if (hasSingle && hasMultiple) profErrors.push(`${where}: pointFormula 与 pointFormulas 不能同时给出`);
  if (!hasSingle && !hasMultiple) profErrors.push(`${where}: 缺少职业点公式`);
  try {
    if (!isSupportedPointFormulas(entry)) {
      profErrors.push(`${where}: 职业点公式不在白名单 ${JSON.stringify(entry.pointFormula ?? entry.pointFormulas)}`);
    }
  } catch (error) {
    profErrors.push(`${where}: 职业点公式非法 ${JSON.stringify(entry.pointFormula ?? entry.pointFormulas)} (${error?.code ?? error})`);
  }
  if (hasMultiple && (!Array.isArray(entry.pointFormulas) || entry.pointFormulas.length < 2)) {
    profErrors.push(`${where}: pointFormulas 必须是至少两项的数组；单公式用 pointFormula`);
  }

  // Credit rating: occupation constraint, never the UGE wealth band.
  const { creditMin, creditMax } = entry;
  const rangeOk = Number.isInteger(creditMin) && Number.isInteger(creditMax)
    && creditMin >= 0 && creditMax <= 99 && creditMin <= creditMax;
  if (!rangeOk) profErrors.push(`${where}: 信用区间非法 ${creditMin}–${creditMax}`);
  if (entry.minWealth !== undefined || entry.maxWealth !== undefined) {
    profErrors.push(`${where}: 职业数据不得提供 UGE 财富档（minWealth/maxWealth 与 CR 无关）`);
  }
  if (entry.evidence !== "secondary") profErrors.push(`${where}: 证据强度必须是 secondary，实际 ${entry.evidence}`);
  if (!(entry.sourceRefs ?? []).length) profErrors.push(`${where}: 缺少来源`);

  const fixedRefs = [];
  const fixedKeys = new Set();
  for (const key of entry.fixedSkills ?? []) {
    if (fixedKeys.has(key)) profErrors.push(`${where}: 固定技能重复 ${key}`);
    fixedKeys.add(key);
    const ref = skillRef(key, where);
    if (ref) fixedRefs.push(ref);
  }

  for (const slot of entry.specialismSlots ?? []) {
    const family = families[slot.family];
    if (!family) {
      profErrors.push(`${where}: 专精槽引用未知技能族 ${slot.family}`);
      continue;
    }
    if (!isAsciiId(slot.specKey)) profErrors.push(`${where}: 专精槽 specKey 非 ASCII ${slot.specKey}`);
    if (slot.specKey === "any") profErrors.push(`${where}: 专精槽 specKey 不得是占位值 any`);
    if (!slot.label) profErrors.push(`${where}: 专精槽缺少 label`);
    if (family.open !== true) profErrors.push(`${where}: 专精槽 ${slot.key} 引用的技能族不是开放族`);
    if (seenSpec.has(`${family.parentKey}/${slot.specKey}`) && skillByKey.has(`${family.parentKey}-${slot.specKey}`)) {
      profErrors.push(`${where}: 专精槽与已发布技能文档冲突 ${family.parentKey}/${slot.specKey}`);
    }
  }

  // Native profession groups: only options that resolve to a concrete skill
  // document. An "any" pick cannot be enumerated, so it lives in flags for the
  // builder instead of silently shrinking the native choice group.
  const groups = [];
  const resolvedChoiceGroups = [];
  for (const group of entry.choiceGroups ?? []) {
    if (!isAsciiId(group.key)) profErrors.push(`${where}: 选择组 key 非 ASCII ${group.key}`);
    if (!Number.isInteger(group.choose) || group.choose < 1) profErrors.push(`${where}: 选择组 ${group.key} pick 数非法`);
    if (!(group.options ?? []).length) profErrors.push(`${where}: 选择组 ${group.key} 没有选项`);
    const refs = [];
    const resolvedOptions = [];
    const seenRef = new Set();
    let anyPick = false;
    for (const option of group.options ?? []) {
      if (option.kind === "skill") {
        const ref = skillRef(option.skill, `${where}/${group.key}`);
        resolvedOptions.push({ kind: "skill", skill: option.skill, brpids: ref ? [ref.brpid] : [] });
        if (ref && !seenRef.has(ref.brpid)) { seenRef.add(ref.brpid); refs.push(ref); }
      } else if (option.kind === "family") {
        const familyRefs = familyOptions(option.family, `${where}/${group.key}`);
        resolvedOptions.push({
          kind: "family",
          family: option.family,
          parentKey: families[option.family]?.parentKey ?? null,
          base: families[option.family]?.base ?? null,
          requiresExplicitBase: families[option.family]?.requiresExplicitBase === true,
          brpids: familyRefs.map((ref) => ref.brpid),
        });
        for (const ref of familyRefs) {
          if (seenRef.has(ref.brpid)) continue;
          seenRef.add(ref.brpid);
          refs.push(ref);
        }
      } else if (option.kind === "any") {
        anyPick = true;
        resolvedOptions.push({ kind: "any", brpids: [] });
      } else {
        profErrors.push(`${where}: 选择组 ${group.key} 选项类型未知 ${option.kind}`);
      }
    }
    if (!anyPick && refs.length && group.choose > refs.length) {
      profErrors.push(`${where}: 选择组 ${group.key} 需要选 ${group.choose} 项，但只有 ${refs.length} 个可解析选项`);
    }
    resolvedChoiceGroups.push({
      key: group.key,
      label: group.label ?? group.key,
      choose: group.choose,
      ...(group.distinct === true ? { distinct: true } : {}),
      options: resolvedOptions,
    });
    // An "any" group stays out of native groups; the builder reads flags.
    if (!anyPick && refs.length) groups.push({ options: group.choose, skills: refs });
  }

  const minWealth = 0;
  const maxWealth = 0;
  // Either/or occupations keep every formula, in the printed order, so the
  // frontend can offer the choice. `pointFormula` stays the first option for
  // backward compatibility with single-formula readers.
  const pointFormulas = entry.pointFormulas ? entry.pointFormulas.slice() : undefined;
  return {
    _id: docId(`profession-${profBrpid}`),
    name: entry.name,
    type: "profession",
    flags: {
      brp: {
        brpidFlag: { id: profBrpid, lang: "zh-CN", priority: 1 },
        enName: entry.enName,
        contentSource: "coc",
        coc: {
          factId: entry.factId,
          slug: entry.slug,
          creditMin,
          creditMax,
          pointFormula: pointFormulas ? pointFormulas[0] : entry.pointFormula,
          ...(pointFormulas ? { pointFormulas } : {}),
          evidence: entry.evidence,
          sourceRefs: entry.sourceRefs ?? [],
          fixedSkillKeys: (entry.fixedSkills ?? []).slice(),
          specialismSlots: (entry.specialismSlots ?? []).map((slot) => ({
            ...slot,
            parentKey: families[slot.family]?.parentKey ?? null,
            base: families[slot.family]?.base ?? null,
            baseSourceRefs: families[slot.family]?.baseSourceRefs ?? [],
            requiresExplicitBase: families[slot.family]?.requiresExplicitBase === true,
            brpid: families[slot.family]
              ? `i.skill.coc.${families[slot.family].parentKey}-${slot.specKey}`
              : null,
          })),
          choiceGroups: resolvedChoiceGroups,
          // The native profession sheet has UGE wealth fields. CoC credit
          // rating is not a wealth band, so both stay at 0 and the sheet is
          // told not to treat them as CR.
          wealthNotApplicable: true,
        },
      },
    },
    system: {
      skills: fixedRefs,
      groups,
      powers: [],
      minWealth,
      maxWealth,
      description: [
        entry.description,
        `职业点：${(pointFormulas ?? [entry.pointFormula]).join(" 或 ")}（引擎按白名单公式求值${pointFormulas ? "，建卡时选定一条" : ""}）`,
        `信用评级：${creditMin}–${creditMax}（只能用职业点，且必须落在区间内）`,
      ].join("\n\n"),
    },
  };
});

for (const entry of professions) {
  if (octopusBrpids.has(entry.flags.brp.brpidFlag.id)) {
    profErrors.push(`职业 brpid 与 octopus 冲突: ${entry.flags.brp.brpidFlag.id}`);
  }
}

if (profErrors.length) {
  console.error(`CoC 职业校验失败 ${profErrors.length} 条：`);
  profErrors.slice(0, 12).forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

// ---------------------------------------------------------------- writers
const writePack = (key, label, packDocs) => {
  mkdirSync(join(ROOT, "packs-json"), { recursive: true });
  mkdirSync(join(ROOT, "packs-index"), { recursive: true });
  writeFileSync(join(ROOT, `packs-json/${key}.json`), JSON.stringify(packDocs, null, 1) + "\n");
  const index = packDocs.map(({ _id, name, type, flags }) => ({ _id, name, type, img: null, sort: 0, flags: { brp: { brpidFlag: flags.brp.brpidFlag } } }));
  writeFileSync(join(ROOT, `packs-index/${key}.json`), JSON.stringify(index, null, 1) + "\n");
  const dir = join(ROOT, `packs/${key}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const doc of packDocs) writeFileSync(join(dir, `${doc._id}.json`), JSON.stringify(doc, null, 1) + "\n");
  return { name: key, label, path: `packs/${key}`, type: "Item", system: "brp" };
};

const skillsKey = "coc-skills";
const skillsLabel = "克苏鲁的呼唤 · 核心技能（CoC 7e · M1）";
const professionsKey = "coc-professions";
const professionsLabel = "克苏鲁的呼唤 · 职业（CoC 7e · M2）";

const entries = [
  writePack(skillsKey, skillsLabel, docs),
  writePack(professionsKey, professionsLabel, professions),
];

const sysPath = join(ROOT, "system.json");
const sys = JSON.parse(readFileSync(sysPath, "utf8"));
sys.packs = sys.packs ?? [];
for (const entry of entries) {
  const existing = sys.packs.find((pack) => pack.name === entry.name);
  if (existing) Object.assign(existing, entry);
  else sys.packs.push(entry);
}
writeFileSync(sysPath, JSON.stringify(sys, null, 2) + "\n");

console.log(`CoC 技能包 ${docs.length} 文档（专精 ${docs.filter((doc) => doc.system.specialism).length}）`);
console.log(`pending 未证实专精 ${(facts.pendingSpecialisms ?? []).length} 条已排除，未写入固定值`);
console.log(`octopus 技能 brpid 冲突 ${collisions.length}`);
console.log(`CoC 职业包 ${professions.length} 文档（选择组 ${professions.reduce((n, doc) => n + doc.system.groups.length, 0)} 个 / 专精槽 ${professions.reduce((n, doc) => n + doc.flags.brp.coc.specialismSlots.length, 0)} 个）`);
