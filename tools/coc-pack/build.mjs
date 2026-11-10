// CoC 7e core content pack build (skills + occupations).
// Source of truth: content/coc/skills.json and content/coc/professions.json
// (core facts + core provenance). Prose in the packs is written for this project.
//
// The public repository owns only the two core packs:
//   core -> packs-json/coc-skills.json, packs-index/coc-skills.json,
//           packs/coc-skills/<id>.json, and the same trio for coc-professions;
//           registered in system.json, always available.
// Extension-only facts, their importer and their distribution build live outside
// this public repository and are never emitted or declared here.
//
// Deterministic: document ids derive from the stable ASCII brpid only.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isSupportedPointFormulas, isAsciiId } from "../../module/rules/creation.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const CORE_SKILL_COUNT = 60;
const CORE_PROFESSION_COUNT = 9;
const corePack = (entry) => entry.pack;

const facts = read("content/coc/skills.json");
const occupations = read("content/coc/professions.json");

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

// One core fact source, one identity space: brpids, keys, names and specialism
// identities must be unique. Anything tagged as an extension pack is rejected:
// this repository builds only the core packs.
for (const entry of facts.skills) {
  if (corePack(entry) !== "core") errors.push(`技能只能属于 core pack，实际 ${corePack(entry)}: ${entry.key}`);
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

// The declared split must describe the file exactly: the core count must be the
// real one, and the public owner must not carry extension records.
const declaredSplit = facts.packSplit ?? {};
const actualSkillCounts = {
  core: facts.skills.filter((entry) => corePack(entry) === "core").length,
};
if (declaredSplit.counts?.core !== actualSkillCounts.core) {
  errors.push(`packSplit.counts.core 与实际 ${actualSkillCounts.core} 不符`);
}
if (actualSkillCounts.core !== CORE_SKILL_COUNT) {
  errors.push(`核心技能必须正好 ${CORE_SKILL_COUNT} 条，实际 ${actualSkillCounts.core}`);
}
if (facts.skills.length !== actualSkillCounts.core) {
  errors.push(`事实源含有 ${facts.skills.length - actualSkillCounts.core} 条非核心技能`);
}

if (errors.length) {
  console.error(`CoC 内容校验失败 ${errors.length} 条：`);
  errors.slice(0, 12).forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

const skillDoc = (entry) => {
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
          pack: corePack(entry),
          specKey: entry.specKey ?? null,
          parentKey: entry.parentKey ?? null,
          sourceRefs: sourceRefs(entry),
        },
      },
    },
    system: {
      skillName: entry.mainName || entry.name,
      specialization: entry.specialism ? entry.name : "",
      base: String(base),
      basic: true,
      adjustments: { base: 0, personal: 0, occupation: 0, archetype: 0, experiencePackage: 0, experience: 0 },
      properties: {
        push: true,
        fighting: isCombat(entry),
        firearm: String(entry.key).startsWith("firearms-"),
        ranged: false,
        special: false,
        noxpgain: !!entry.noXP,
        rarity: false,
        requiresname: false,
        picknameonly: false,
        own: false,
        keepbasevalue: false,
      },
      description: { value: entry.description ?? "", keeper: "" },
    },
  };
};

const coreSkillDocs = facts.skills.map(skillDoc);
const docs = coreSkillDocs;

const skillByKey = new Map(facts.skills.map((entry) => [entry.key, entry]));
const skillDocId = (key) => docId(skillByKey.get(key).brpid);

// Hard isolation guard: no octopus brpid may ever be emitted into a core pack.
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
// Every record must carry a verified point formula and credit-rating range, and
// resolvable skill references. Anything missing is a hard build failure: a
// profession without those facts may not become a character-creation default.
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

// A core record must stay self-contained: every member of a family it offers is
// already part of the core skill pack, so no extension lookup is possible.
const familyMembers = (familyKey, where) => {
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
  const native = [];
  for (const key of family.concrete ?? []) {
    const ref = skillRef(key, `${where}/${familyKey}`);
    if (ref) native.push(ref);
  }
  return native;
};

const professions = [];
for (const entry of occupations.professions) {
  const where = `occupation ${entry.slug}`;
  if (entry.pack !== "core") profErrors.push(`${where}: 职业只能属于 core pack，实际 ${entry.pack}`);
  const profBrpid = entry.brpid ?? `i.profession.coc.${entry.slug}`;
  if (!isAsciiId(entry.slug)) profErrors.push(`${where}: slug 非 ASCII`);
  if (profBrpid !== `i.profession.coc.${entry.slug}`) profErrors.push(`${where}: brpid 与 slug 不一致`);
  if (!PROF_BRPID_RE.test(profBrpid)) profErrors.push(`${where}: brpid 非 ASCII/格式错误 ${profBrpid}`);
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
  // Published occupations are secondary evidence. The one product-defined
  // record says so explicitly and carries a claim boundary instead of a source
  // that never printed it.
  if (entry.evidence === "product") {
    if (!entry.productBoundary) profErrors.push(`${where}: product 记录必须写清 productBoundary`);
  } else if (entry.evidence !== "secondary") {
    profErrors.push(`${where}: 证据强度必须是 secondary，实际 ${entry.evidence}`);
  }
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
    const addRef = (ref, bucket) => {
      if (seenRef.has(ref.brpid)) return;
      seenRef.add(ref.brpid);
      bucket.push(ref);
    };
    for (const option of group.options ?? []) {
      if (option.kind === "skill") {
        const ref = skillRef(option.skill, `${where}/${group.key}`);
        resolvedOptions.push({ kind: "skill", skill: option.skill, brpids: ref ? [ref.brpid] : [] });
        if (ref) addRef(ref, refs);
      } else if (option.kind === "family") {
        const members = familyMembers(option.family, `${where}/${group.key}`);
        resolvedOptions.push({
          kind: "family",
          family: option.family,
          parentKey: families[option.family]?.parentKey ?? null,
          base: families[option.family]?.base ?? null,
          requiresExplicitBase: families[option.family]?.requiresExplicitBase === true,
          brpids: members.map((ref) => ref.brpid),
        });
        for (const ref of members) addRef(ref, refs);
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

  // Either/or occupations keep every formula, in the printed order, so the
  // frontend can offer the choice. `pointFormula` stays the first option for
  // backward compatibility with single-formula readers.
  const pointFormulas = entry.pointFormulas ? entry.pointFormulas.slice() : undefined;
  professions.push({
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
          pack: "core",
          creditMin,
          creditMax,
          pointFormula: pointFormulas ? pointFormulas[0] : entry.pointFormula,
          ...(pointFormulas ? { pointFormulas } : {}),
          evidence: entry.evidence,
          ...(entry.productBoundary ? { productBoundary: entry.productBoundary } : {}),
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
      minWealth: 0,
      maxWealth: 0,
      description: [
        entry.description,
        `职业点：${(pointFormulas ?? [entry.pointFormula]).join(" 或 ")}（引擎按白名单公式求值${pointFormulas ? "，建卡时选定一条" : ""}）`,
        `信用评级：${creditMin}–${creditMax}（只能用职业点，且必须落在区间内）`,
      ].join("\n\n"),
    },
  });
}

for (const entry of professions) {
  if (octopusBrpids.has(entry.flags.brp.brpidFlag.id)) {
    profErrors.push(`职业 brpid 与 octopus 冲突: ${entry.flags.brp.brpidFlag.id}`);
  }
}

const declaredProfessionSplit = occupations.packSplit ?? {};
const actualProfessionCounts = {
  core: professions.filter((doc) => doc.flags.brp.coc.pack === "core").length,
};
if (declaredProfessionSplit.counts?.core !== actualProfessionCounts.core) {
  profErrors.push(`professions.packSplit.counts.core 与实际 ${actualProfessionCounts.core} 不符`);
}
if (actualProfessionCounts.core !== CORE_PROFESSION_COUNT) {
  profErrors.push(`核心职业必须正好 ${CORE_PROFESSION_COUNT} 条，实际 ${actualProfessionCounts.core}`);
}
if (occupations.professions.length !== actualProfessionCounts.core) {
  profErrors.push(`事实源含有 ${occupations.professions.length - actualProfessionCounts.core} 条非核心职业`);
}

if (profErrors.length) {
  console.error(`CoC 职业校验失败 ${profErrors.length} 条：`);
  profErrors.slice(0, 12).forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

// ---------------------------------------------------------------- writers
const writePack = (base, key, packDocs) => {
  mkdirSync(join(base, "packs-json"), { recursive: true });
  mkdirSync(join(base, "packs-index"), { recursive: true });
  writeFileSync(join(base, `packs-json/${key}.json`), JSON.stringify(packDocs, null, 1) + "\n");
  const index = packDocs.map(({ _id, name, type, flags }) => ({ _id, name, type, img: null, sort: 0, flags: { brp: { brpidFlag: flags.brp.brpidFlag } } }));
  writeFileSync(join(base, `packs-index/${key}.json`), JSON.stringify(index, null, 1) + "\n");
  const dir = join(base, `packs/${key}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const doc of packDocs) writeFileSync(join(dir, `${doc._id}.json`), JSON.stringify(doc, null, 1) + "\n");
  return { name: key, path: `packs/${key}`, type: "Item", system: "brp" };
};

const coreProfessionDocs = professions.filter((doc) => doc.flags.brp.coc.pack === "core");
const entries = {
  skills: { ...writePack(ROOT, "coc-skills", coreSkillDocs), label: "克苏鲁的呼唤 · 核心技能（CoC 7e）" },
  professions: { ...writePack(ROOT, "coc-professions", coreProfessionDocs), label: "克苏鲁的呼唤 · 核心职业（CoC 7e）" },
};

// system.json stays exactly the four shipped packs: two octopus packs and the
// two core CoC packs. No extension pack may be declared here.
const sysPath = join(ROOT, "system.json");
const sys = JSON.parse(readFileSync(sysPath, "utf8"));
sys.packs = (sys.packs ?? []).filter((pack) => !String(pack.name).startsWith("arcane-investigator-"));
for (const entry of [entries.skills, entries.professions]) {
  const existing = sys.packs.find((pack) => pack.name === entry.name);
  if (existing) Object.assign(existing, entry);
  else sys.packs.push(entry);
}
const expectedPacks = ["octopus-skills", "octopus-professions", "coc-skills", "coc-professions"];
const actualPacks = sys.packs.map((pack) => pack.name);
if (actualPacks.length !== expectedPacks.length || expectedPacks.some((name) => !actualPacks.includes(name))) {
  console.error(`system.json pack 注册必须正好是 ${expectedPacks.join(", ")}，实际 ${actualPacks.join(", ")}`);
  process.exit(1);
}
writeFileSync(sysPath, JSON.stringify(sys, null, 2) + "\n");

console.log(`CoC 核心技能包 ${coreSkillDocs.length} 文档（专精 ${coreSkillDocs.filter((doc) => doc.system.specialization).length}）`);
console.log(`pending 未证实专精 ${(facts.pendingSpecialisms ?? []).length} 条已排除，未写入固定值`);
console.log(`octopus 技能 brpid 冲突 ${collisions.length}`);
console.log(`CoC 核心职业包 ${coreProfessionDocs.length} 文档`);
console.log(`选择组 核心 ${coreProfessionDocs.reduce((n, doc) => n + doc.system.groups.length, 0)}`);
