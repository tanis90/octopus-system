// 基础包构建（docs/base-pack.md §4）：canonical + zh 层 → 双格式包。
//   compat 栈：packs-json/<pack>.json（文档数组）+ packs-index/<pack>.json（索引，含 brpidFlag）
//   真 Foundry：packs/<pack>/<id>.json（folder pack，每文档一文件）
//   注册：system.json packs 两席（本脚本就地合并写入）
// 用法：node tools/base-pack/build.mjs   （幂等：system.json packs 段按键合并）
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const skillsEn = read("content/skills.canonical.json");
const skillsZh = read("content/skills.zh-CN.json");
const profsEn = read("content/professions.canonical.json");
const profsZh = read("content/professions.zh-CN.json");

// Foundry 16 位文档 id（确定性：slug 派生，重跑不变）
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const docId = (s) => {
  let out = "";
  let i = 0;
  while (out.length < 16) {
    const byte = createHash("sha256").update("octopus:" + s + ":" + i).digest()[0];
    out += ALPHABET[byte % ALPHABET.length];
    i += 1;
  }
  return out;
};

// —— skillcat（UGE 五类；system.category 以其 brpid 引用）——
const CATS = {
  Mental: { slug: "mental", zh: "心智类" },
  Perception: { slug: "perception", zh: "感知类" },
  Combat: { slug: "combat", zh: "战斗类" },
  Communication: { slug: "communication", zh: "沟通类" },
  Manipulation: { slug: "manipulation", zh: "操作类" },
  Magic: { slug: "magic", zh: "魔法类" },
};
const catBrpid = (en) => `i.skillcat.${(CATS[en] ?? { slug: "mental" }).slug}`;
const catDocs = Object.entries(CATS).map(([en, c]) => ({
  _id: docId("skillcat-" + c.slug),
  name: c.zh,
  type: "skillcat",
  flags: { brp: { brpidFlag: { id: `i.skillcat.${c.slug}`, lang: "zh-CN", priority: 1 }, enName: en + " Skills Category" } },
  system: { basic: false, description: `${en} 类技能分类（UGE）` },
}));

// —— 技能文档 ——
const skillBySlug = new Map(skillsEn.map((s, i) => [s.slug, { en: s, zh: skillsZh[i] }]));
const skillDocs = skillsEn.map((s, i) => {
  const zh = skillsZh[i];
  const base = Number.isFinite(s.base) ? s.base : 0;
  return {
    _id: docId("skill-" + s.slug),
    name: zh.name,
    type: "skill",
    flags: { brp: { brpidFlag: { id: `i.skill.${s.slug}`, lang: "zh-CN", priority: 1 }, enName: s.name } },
    system: {
      base, basic: true, combat: CATS[s.category]?.slug === "combat",
      category: catBrpid(s.category),
      baseFormula: { 1: { stat: "fixed", value: base }, 2: { stat: "fixed", value: 0 }, Func: "or" },
      specialism: /\(various\)|（各类）/.test(s.name + zh.name),
      description: zh.description + (s.base === null ? `（基础值口径：${s.baseRaw}）` : ""),
    },
  };
});
const skillNameToBrpid = new Map(skillDocs.map((d) => [d.name, d.flags.brp.brpidFlag.id]));

// Existing profession ref UUIDs are opaque per-occurrence keys. Reuse them when
// rebuilding so the 44 committed docs do not churn; new/unknown slots fall back
// to a deterministic id derived from brpid + occurrence. This keeps consecutive
// builds byte-identical without forcing an ID migration.
const refKey = (prof, section, brpid, occurrence) => `${prof}|${section}|${brpid}|${occurrence}`;
const existingRefUuids = (() => {
  const map = new Map();
  const path = join(ROOT, "packs-json/octopus-professions.json");
  if (!existsSync(path)) { return map; }
  let docs;
  try { docs = JSON.parse(readFileSync(path, "utf8")); }
  catch { return map; }
  const seed = (prof, section, refs) => {
    const seen = new Map();
    for (const ref of refs ?? []) {
      if (!ref?.brpid || !ref?.uuid) continue;
      const n = seen.get(ref.brpid) ?? 0;
      seen.set(ref.brpid, n + 1);
      map.set(refKey(prof, section, ref.brpid, n), ref.uuid);
    }
  };
  for (const doc of docs) {
    const prof = doc?.flags?.brp?.brpidFlag?.id;
    if (!prof) continue;
    seed(prof, "skills", doc.system?.skills);
    (doc.system?.groups ?? []).forEach((group, index) => seed(prof, `group:${index}`, group.skills));
  }
  return map;
})();

// —— 职业文档（解析 zh skills 文本 → 固定引用 + 任选组）——
const zhNum = { 一: 1, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const WEALTH = { 一贫如洗: 0, 贫穷: 1, 中等: 2, 殷实: 3, 富有: 4 };
const unresolved = [];
// 技能名索引：全名 + 裸名（去括号）双键，长名优先（"语言（其他）"→语言（各类）；"任意两项艺术技能"→艺术）
const skillNameEntries = [...skillNameToBrpid.entries()];
for (const [nm, id] of [...skillNameToBrpid.entries()]) {
  const bare = nm.replace(/（[^）]*）/g, "").trim();
  if (bare && bare !== nm) skillNameEntries.push([bare, id]);
}
skillNameEntries.sort((a, b) => b[0].length - a[0].length);
const resolveOne = (item) => {
  const cleaned = item.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim();
  const hit = skillNameEntries.find(([nm]) => item === nm)
    ?? skillNameEntries.find(([nm]) => item.includes(nm))
    ?? skillNameEntries.find(([nm]) => cleaned.includes(nm) && nm.length >= 2);
  return hit ? hit[1] : null;
};
const resolveNames = (text, context = "") => {
  const out = [];
  const seen = new Map();
  for (let part of text.split(/[、，,]/)) {
    part = part.trim().replace(/^并?/, "").replace(/[。；;]$/, "");
    if (!part) continue;
    const brpid = resolveOne(part);
    if (brpid) {
      const occurrence = seen.get(brpid) ?? 0;
      seen.set(brpid, occurrence + 1);
      const key = `${context}|${brpid}|${occurrence}`;
      const uuid = (context && existingRefUuids.get(key)) || docId(`ref-${key || `${brpid}-${occurrence}-${part}`}`);
      out.push({ brpid, uuid });
    }
    else if (part.length > 1 && !/^(任选|以下|下列|视设定|从下|技能|或|以及|并)/.test(part)) unresolved.push(part);
  }
  return out;
};
const parseWealth = (text) => {
  const found = Object.keys(WEALTH).filter((k) => text.includes(k)).map((k) => WEALTH[k]);
  return found.length ? { min: Math.min(...found), max: Math.max(...found) } : { min: 0, max: 4 };
};
const profDocs = profsEn.map((p, i) => {
  const zh = profsZh[i];
  const raw = zh.skills;
  const profBrpid = `i.profession.${p.slug}`;
  let fixedPart = raw, choosePart = "", options = 0;
  const m = raw.match(/^(.*?)任选([一两三四五六七八九十\d]+)项?[：:](.*)$/s) ?? raw.match(/^(.*?)，并从下列.*?[：:](.*)$/s);
  if (m) { fixedPart = m[1]; choosePart = m[3] ?? m[2] ?? ""; const n = raw.match(/任选([一两三四五六七八九十\d]+)项/); if (n) { options = zhNum[n[1]] ?? parseInt(n[1], 10) ?? 1; } }
  const groups = choosePart && options
    ? [{ options, skills: resolveNames(choosePart, `${profBrpid}|group:0`) }].filter((g) => g.skills.length)
    : [];
  const w = parseWealth(zh.wealth);
  return {
    _id: docId("profession-" + p.slug),
    name: zh.name,
    type: "profession",
    flags: { brp: { brpidFlag: { id: profBrpid, lang: "zh-CN", priority: 1 }, enName: p.name } },
    system: {
      skills: resolveNames(fixedPart, `${profBrpid}|skills`),
      groups,
      powers: [],
      minWealth: w.min, maxWealth: w.max,
      description: `${zh.description}\n\n财富（UGE 口径）：${zh.wealth}\n技能建议：${raw}`,
    },
  };
}).filter(Boolean);

// —— 校验 ——
const allSkillBrpids = new Set(skillDocs.map((d) => d.flags.brp.brpidFlag.id));
const names = new Set(), brpids = new Set();
for (const d of [...skillDocs, ...profDocs, ...catDocs]) {
  if (names.has(d.name)) throw new Error(`重名: ${d.name}`);
  if (brpids.has(d.flags.brp.brpidFlag.id)) throw new Error(`重复 brpid: ${d.flags.brp.brpidFlag.id}`);
  names.add(d.name); brpids.add(d.flags.brp.brpidFlag.id);
  if (d.type === "skill" && (d.system.base < 0 || d.system.base > 100)) throw new Error(`base 越界: ${d.name}`);
}
const badRefs = [];
for (const p of profDocs) for (const ref of [...p.system.skills, ...p.system.groups.flatMap(g => g.skills)]) {
  if (!allSkillBrpids.has(ref.brpid)) badRefs.push(`${p.name} → ${ref.brpid}`);
}

// —— 输出 ——
const packs = [
  { key: "octopus-skills", label: "章鱼料理 · 技能（UGE）", docs: [...catDocs, ...skillDocs] },
  { key: "octopus-professions", label: "章鱼料理 · 职业（UGE）", docs: profDocs },
];
for (const { key, docs } of packs) {
  mkdirSync(join(ROOT, `packs-json`), { recursive: true });
  mkdirSync(join(ROOT, `packs-index`), { recursive: true });
  writeFileSync(join(ROOT, `packs-json/${key}.json`), JSON.stringify(docs, null, 1) + "\n");
  const index = docs.map(({ _id, name, type, flags }) => ({ _id, name, type, img: null, sort: 0, flags: { brp: { brpidFlag: flags.brp.brpidFlag } } }));
  writeFileSync(join(ROOT, `packs-index/${key}.json`), JSON.stringify(index, null, 1) + "\n");
  const dir = join(ROOT, `packs/${key}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const d of docs) writeFileSync(join(dir, `${d._id}.json`), JSON.stringify(d, null, 1) + "\n");
}

// system.json packs 注册（按键幂等合并）
const sysPath = join(ROOT, "system.json");
const sys = JSON.parse(readFileSync(sysPath, "utf8"));
sys.packs = sys.packs ?? [];
for (const { key, label } of packs) {
  const exists = sys.packs.find((p) => p.name === key);
  const entry = { name: key, label, path: `packs/${key}`, type: "Item", system: "brp" };
  if (exists) Object.assign(exists, entry); else sys.packs.push(entry);
}
writeFileSync(sysPath, JSON.stringify(sys, null, 2) + "\n");

console.log(`技能包 ${skillDocs.length + catDocs.length} 文档（技能 ${skillDocs.length} + 分类 ${catDocs.length}）`);
console.log(`职业包 ${profDocs.length} 文档（任选组 ${profDocs.filter(p => p.system.groups.length).length} 个）`);
console.log(`未解析引用 ${unresolved.length} 条（留在描述文本）: ${[...new Set(unresolved)].slice(0, 8).join(" / ")}`);
console.log(`坏外键 ${badRefs.length}: ${badRefs.slice(0, 4).join(" / ")}`);
if (badRefs.length) process.exit(1);
