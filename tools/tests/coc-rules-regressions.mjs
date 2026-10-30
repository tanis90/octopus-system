// CoC source-repo regression probe (M1 core + M2 occupations/allocation + M3 combat/wounds
// + M5 specialisms/second-batch occupations/multi-formula + M6 third-batch occupations/
// POW formula/Science (Astronomy) + M7 coc-cardwright fourth batch + M8 SealDice
// compatibility batch; no Foundry required).
//
//   node tools/tests/coc-rules-regressions.mjs
//
// Covers:
//   1. deterministic CoC pack build (skills + professions) into the core packs
//      and the sibling distribution repo + octopus artifacts byte-unchanged
//   2. fact/pack contract: core values, specialism identity, pending exclusion,
//      source isolation, no fixed 0 for unverified specialisms
//   3. centralized rules: derived attributes, SAN/Luck, success bands, growth,
//      skill formula rounding, APP -> cha mapping
//   4. negative cases: BRP and CoC differ where they must, no cross-pack bleed
//   5. M2/M5/M6/M7 occupations: formula/credit range per source, wealth band never used as
//      CR, resolvable skill refs, deterministic ids, eight-skill shape, unique identities
//   6. M2/M5/M6/M7 creation rules: whitelist AST, either/or point formulas (incl. POW),
//      INT x 2, credit-rating rules, mythos ban, explicit base values, no base folding,
//      specialism identity
//   7. M3 pure combat/wounds: band ranks, required-band difficulty, bonus/penalty
//      tens pools, weapon profiles/extreme damage/half DB, opposed ties, dodge/
//      fightback/cover, Build/outnumbering/shots/point-blank, major wound/dying/
//      instant death and the healing bands
//   8. M5/M6/M7 provenance: every new record secondary, no official-first-party claim,
//      every cited source registered with an https URL, coc-cardwright as the only
//      source for the fourth batch, no public table splicing
//   9. M8 SealDice batch: 118 imports exactly eight slots, whitelisted formulas/CR, unique
//      ids, resolvable skill bases, 187 deferred entries with category+reason, source
//      and license boundary, legacy 38 choices preserved
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Rules } from "../../module/rules/index.mjs";
import { CoCSanity } from "../../module/rules/coc-sanity.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
// Same derivation the build uses: document ids come from the stable brpid.
const cocDocId = (seed) => {
  let out = "";
  let i = 0;
  while (out.length < 16) {
    const byte = createHash("sha256").update(`coc:${seed}:${i}`).digest()[0];
    out += "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[byte % 62];
    i += 1;
  }
  return out;
};
const checks = {};
const errors = [];
const check = (name, ok, detail) => {
  // A check must return exactly `true` to pass. Array-returning helpers use
  // `bad.length ? bad : true`; treating an array as truthy would silently turn
  // every one of those regressions into a pass.
  const passed = ok === true;
  checks[name] = passed ? true : { ok: false, detail: detail ?? ok };
  if (!passed) errors.push(`${name}: ${JSON.stringify(detail ?? ok)}`);
};

const walk = (dir, base = dir) => {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(path, base));
    else out.push(relative(base, path));
  }
  return out.sort();
};
const compareTrees = (left, right, dirs) => {
  const diffs = [];
  for (const dir of dirs) {
    const a = join(left, dir), b = join(right, dir);
    if (!existsSync(a) || !existsSync(b)) { diffs.push(`${dir}: missing`); continue; }
    const all = [...new Set([...walk(a), ...walk(b)])].sort();
    for (const rel of all) {
      const pa = join(a, rel), pb = join(b, rel);
      if (!existsSync(pa) || !existsSync(pb)) { diffs.push(`${dir}/${rel}: missing`); continue; }
      if (!readFileSync(pa).equals(readFileSync(pb))) diffs.push(`${dir}/${rel}: bytes differ`);
    }
  }
  return diffs;
};

// --- 1) deterministic build and octopus isolation ---
// The expansion is emitted into its own distribution repository, not into a
// second modules/ tree inside this repository.
const EXPAND_ROOT = process.env.ARCANE_INVESTIGATOR_OPTIONS_DIR
  ? resolve(process.env.ARCANE_INVESTIGATOR_OPTIONS_DIR)
  : resolve(ROOT, "../arcane-investigator-options");
const readExpand = (path) => JSON.parse(readFileSync(join(EXPAND_ROOT, path), "utf8"));
const CORE_DIRS = ["packs-json", "packs-index", "packs"];
const EXPAND_DIRS = ["packs-json", "packs-index", "packs"];
const OUT_REL = "expand-out";
const temp = mkdtempSync(join(tmpdir(), "octopus-coc-build-"));
try {
  for (const item of ["content", "tools/coc-pack", "module/rules", "system.json", "packs-json", "packs-index", "packs"]) {
    const src = join(ROOT, item);
    if (!existsSync(src)) throw new Error(`missing seed: ${item}`);
    cpSync(src, join(temp, item), { recursive: true });
  }
  const manifestSrc = join(EXPAND_ROOT, "module.json");
  if (!existsSync(manifestSrc)) throw new Error(`missing seed: ${manifestSrc}`);
  cpSync(manifestSrc, join(temp, OUT_REL, "module.json"));
  const build = () => {
    const result = spawnSync(process.execPath, ["tools/coc-pack/build.mjs"], {
      cwd: temp,
      encoding: "utf8",
      env: { ...process.env, ARCANE_INVESTIGATOR_OPTIONS_OUT: join(temp, OUT_REL) },
    });
    if (result.status !== 0) throw new Error(`build failed (${result.status}): ${result.stderr || result.stdout}`);
    return result.stdout;
  };
  build();
  for (const dir of CORE_DIRS) cpSync(join(temp, dir), join(temp, `__run1/${dir}`), { recursive: true });
  for (const dir of EXPAND_DIRS) cpSync(join(temp, OUT_REL, dir), join(temp, `__run1/${OUT_REL}/${dir}`), { recursive: true });
  cpSync(join(temp, "system.json"), join(temp, "__run1/system.json"));
  build();
  const consecutive = compareTrees(join(temp, "__run1"), temp, [
    ...CORE_DIRS, ...EXPAND_DIRS.map((dir) => `${OUT_REL}/${dir}`),
  ]);
  if (!existsSync(join(temp, "__run1/system.json")) || !readFileSync(join(temp, "system.json")).equals(readFileSync(join(temp, "__run1/system.json")))) {
    consecutive.push("system.json: bytes differ");
  }
  check("buildConsecutiveByteIdentical", consecutive.length === 0, consecutive.slice(0, 8));

  const cocCommitted = compareTrees(temp, ROOT, CORE_DIRS);
  check("coreBuildMatchesCommittedArtifacts", cocCommitted.length === 0, cocCommitted.slice(0, 8));

  const expandCommitted = compareTrees(join(temp, OUT_REL), EXPAND_ROOT, EXPAND_DIRS);
  check("expansionBuildMatchesDistributionRepo", expandCommitted.length === 0, expandCommitted.slice(0, 8));

  check("buildDoesNotWriteModulesTree", !existsSync(join(temp, "modules")), join(temp, "modules"));

  const octopusTemp = compareTrees(join(temp, "packs-json"), join(ROOT, "packs-json"), ["."]);
  const octopusIndex = compareTrees(join(temp, "packs-index"), join(ROOT, "packs-index"), ["."]);
  const octopusPacks = compareTrees(join(temp, "packs"), join(ROOT, "packs"), ["."]);
  check("octopusArtifactsByteUnchanged", octopusTemp.length === 0 && octopusIndex.length === 0 && octopusPacks.length === 0,
    { packsJson: octopusTemp.slice(0, 4), packsIndex: octopusIndex.slice(0, 4), packs: octopusPacks.slice(0, 4) });
} finally {
  rmSync(temp, { recursive: true, force: true });
}

// --- 2) facts and pack contract ---
const facts = readJson("content/coc/skills.json");
const provenance = readJson("content/coc/provenance.json");
// Two packs, one fact source. `cocDocs` stays the core pack; the expansion is
// emitted into the distribution repository and must never be registered in
// system.json.
const cocDocs = readJson("packs-json/coc-skills.json");
const cocIndex = readJson("packs-index/coc-skills.json");
const expandSkillDocs = readExpand("packs-json/arcane-investigator-skills.json");
const expandSkillIndex = readExpand("packs-index/arcane-investigator-skills.json");
const allSkillDocs = [...cocDocs, ...expandSkillDocs];
const octopusDocs = readJson("packs-json/octopus-skills.json");
const docsByKey = new Map(allSkillDocs.map((doc) => [doc.flags.brp.coc.key, doc]));

const CORE_SKILL_COUNT = 60;
const EXPAND_SKILL_COUNT = 31;
const LEGACY_SKILL_COUNT = 59;
const sealdiceSkillCount = Object.keys(provenance.skillsM8?.perSkill ?? {}).length;
check("factCount", facts.skills.length === CORE_SKILL_COUNT + EXPAND_SKILL_COUNT
  && facts.skills.length === LEGACY_SKILL_COUNT + sealdiceSkillCount
  && cocDocs.length === CORE_SKILL_COUNT && cocIndex.length === CORE_SKILL_COUNT
  && expandSkillDocs.length === EXPAND_SKILL_COUNT && expandSkillIndex.length === EXPAND_SKILL_COUNT
  && allSkillDocs.length === facts.skills.length
  && facts.packSplit?.counts?.core === CORE_SKILL_COUNT
  && facts.packSplit?.counts?.expand === EXPAND_SKILL_COUNT,
  { facts: facts.skills.length, core: cocDocs.length, expand: expandSkillDocs.length, sealDiceAdded: sealdiceSkillCount });

check("splitIsPartitionOfTheFactSource", (() => {
  // Every fact sits in exactly one pack, the two pack documents are the same
  // keys as the file, and nothing is emitted twice.
  const factKeys = facts.skills.map((skill) => skill.key);
  const coreKeys = facts.skills.filter((skill) => skill.pack === "core").map((skill) => skill.key);
  const expandKeys = facts.skills.filter((skill) => skill.pack === "expand").map((skill) => skill.key);
  const emitted = allSkillDocs.map((doc) => doc.flags.brp.coc.key);
  const brpids = allSkillDocs.map((doc) => doc.flags.brp.brpidFlag.id);
  const coreBrpids = new Set(cocDocs.map((doc) => doc.flags.brp.brpidFlag.id));
  const bad = [];
  if (!facts.skills.every((skill) => ["core", "expand"].includes(skill.pack))) bad.push("fact without a pack tag");
  if (coreKeys.length + expandKeys.length !== factKeys.length) bad.push("pack tags do not cover the file");
  if (new Set(coreKeys).size !== coreKeys.length || new Set(expandKeys).size !== expandKeys.length) bad.push("key in two packs");
  if (new Set(emitted).size !== emitted.length) bad.push("skill emitted twice");
  if (new Set(brpids).size !== brpids.length) bad.push("brpid reused across packs");
  if (expandSkillDocs.some((doc) => coreBrpids.has(doc.flags.brp.brpidFlag.id))) bad.push("expand doc also in core pack");
  if (JSON.stringify(cocDocs.map((doc) => doc.flags.brp.coc.key)) !== JSON.stringify(coreKeys)) bad.push("core pack order differs from facts");
  const expandDocKeys = expandSkillDocs.map((doc) => doc.flags.brp.coc.key);
  if (JSON.stringify([...expandDocKeys].sort()) !== JSON.stringify([...expandKeys].sort())) bad.push("expand pack keys differ from facts");
  const expandIds = expandSkillDocs.map((doc) => doc._id);
  if (JSON.stringify(expandIds) !== JSON.stringify([...expandIds].sort())) bad.push("expand pack is not _id sorted");
  if (cocDocs.some((doc) => doc.flags.brp.coc.pack !== "core")) bad.push("core doc tagged expand");
  if (expandSkillDocs.some((doc) => doc.flags.brp.coc.pack !== "expand")) bad.push("expand doc tagged core");
  return bad.length ? bad : true;
})(), facts.packSplit);

check("documentIdsUniqueAndDeterministic", new Set(allSkillDocs.map((doc) => doc._id)).size === allSkillDocs.length
  && allSkillDocs.every((doc) => /^[A-Za-z0-9]{16}$/.test(doc._id))
  && new Set(cocIndex.map((doc) => doc._id)).size === cocIndex.length
  && new Set(expandSkillIndex.map((doc) => doc._id)).size === expandSkillIndex.length,
  { docs: allSkillDocs.length, unique: new Set(allSkillDocs.map((doc) => doc._id)).size });

check("documentIdsDeriveFromBrpidOnlyAndAreStable", (() => {
  // The document id is a function of the brpid and nothing else, so moving a
  // record between packs can never migrate an id and the expansion can never
  // collide with the core pack.
  const derive = (seed) => {
    let out = "";
    let i = 0;
    while (out.length < 16) {
      const byte = createHash("sha256").update(`coc:${seed}:${i}`).digest()[0];
      out += "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[byte % 62];
      i += 1;
    }
    return out;
  };
  return allSkillDocs.every((doc) => doc._id === derive(doc.flags.brp.brpidFlag.id));
})(), allSkillDocs.filter((doc) => doc._id !== createHash("sha256").update(doc.flags.brp.brpidFlag.id).digest("hex")).length);

check("systemPackRegistration", (() => {
  const sys = readJson("system.json");
  const pack = sys.packs?.find((entry) => entry.name === "coc-skills");
  return pack?.path === "packs/coc-skills" && pack?.type === "Item" && pack?.system === "brp"
    && sys.packs.some((entry) => entry.name === "octopus-skills")
    && sys.packs.some((entry) => entry.name === "octopus-professions");
})());

check("expansionIsNotInSystemPacks", (() => {
  // Enabling the module is what adds the expansion; removing it has to fall
  // back to the core list, so system.json must stay at the four shipped packs.
  const sys = readJson("system.json");
  return sys.packs.length === 4
    && !sys.packs.some((entry) => String(entry.name).startsWith("arcane-investigator-"))
    && !JSON.stringify(sys).includes("arcane-investigator");
})());

check("moduleManifestDeclaresTheTwoItemPacks", (() => {
  const manifest = readExpand("module.json");
  const packs = manifest.packs ?? [];
  const skills = packs.find((entry) => entry.name === "arcane-investigator-skills");
  const professions = packs.find((entry) => entry.name === "arcane-investigator-professions");
  return manifest.id === "arcane-investigator-options"
    && manifest.version === "0.1.0"
    && manifest.title === "章鱼调查员扩展资料包"
    && packs.length === 2
    && (manifest.esmodules ?? []).length === 0
    && manifest.manifest === undefined && manifest.download === undefined
    && manifest.url === undefined
    && skills?.path === "packs/arcane-investigator-skills"
    && professions?.path === "packs/arcane-investigator-professions"
    && packs.every((entry) => entry.type === "Item" && entry.system === "brp")
    && existsSync(join(EXPAND_ROOT, "README.md"))
    && existsSync(join(EXPAND_ROOT, "LICENSE.txt"))
    && existsSync(join(EXPAND_ROOT, "NOTICE.md"))
    && existsSync(join(EXPAND_ROOT, "package.json"))
    && existsSync(join(EXPAND_ROOT, "tools/pack.mjs"));
})(), readExpand("module.json"));

check("expansionPacksAreLevelDbWal", (() => {
  // Foundry uploads a compendium directory, and its reader expects LevelDB
  // files. The distribution repo therefore ships a real WAL, not per-doc JSON.
  const bad = [];
  for (const name of ["arcane-investigator-skills", "arcane-investigator-professions"]) {
    const dir = join(EXPAND_ROOT, "packs", name);
    if (!existsSync(dir)) { bad.push(`${name}: missing`); continue; }
    const files = readdirSync(dir).sort();
    if (JSON.stringify(files) !== JSON.stringify(["000001.log"])) {
      bad.push(`${name}: files ${JSON.stringify(files)}`);
      continue;
    }
    const bytes = readFileSync(join(dir, files[0]));
    if (bytes.length < 7 || ![1, 2].includes(bytes[6])) bad.push(`${name}: not a WAL record`);
    if (!bytes.includes(Buffer.from("!items!"))) bad.push(`${name}: no !items! keys`);
  }
  return bad.length ? bad : true;
})(), null);

check("expansionDocsKeepLicenceAndTakedownBoundary", (() => {
  // Standard MIT covers only original code and prose. The NOTICE must not
  // pretend third-party facts are licensed, and the README must explain a
  // takedown without claiming that deletion recalls copies or that there is no
  // legal risk.
  const readme = readFileSync(join(EXPAND_ROOT, "README.md"), "utf8");
  const notice = readFileSync(join(EXPAND_ROOT, "NOTICE.md"), "utf8");
  const license = readFileSync(join(EXPAND_ROOT, "LICENSE.txt"), "utf8");
  const text = `${readme}\n${notice}\n${license}`;
  return /^MIT License\n/.test(license)
    && !/SCOPE OF THIS LICENSE/.test(license)
    && /MIT/.test(text)
    && /SealDice/.test(text) && /coc-cardwright/.test(text)
    && /仅覆盖本仓的原创代码与原创文案/.test(notice)
    && /不覆盖、也不授权任何第三方事实/.test(notice)
    && /不因本仓的 MIT 声明获得 MIT 授权/.test(notice)
    && /不声称.*授权|不声称任何形式的官方授权/.test(notice)
    && /60/.test(readme) && /9\b/.test(readme)
    && /31/.test(readme) && /148/.test(readme)
    && /91/.test(readme) && /50/.test(readme) && /157/.test(readme)
    && /custom-investigator/.test(readme) && /custom-eight/.test(readme)
    && /只上传/.test(readme)
    && /ArcaneMap/.test(readme)
    && /资料库/.test(readme)
    && /上传合集包/.test(readme)
    && /战役管理/.test(readme)
    && /只勾选其中一个包/.test(readme)
    && /两个都勾选/.test(readme)
    && /user-arcane-investigator-options\.arcane-investigator-skills/.test(readme)
    && /user-arcane-investigator-options\.arcane-investigator-professions/.test(readme)
    && /不生效|不启用/.test(readme)
    && /停止仓库/.test(readme) && /Release/.test(readme)
    && /不会撤回/.test(readme) && /git 历史/.test(readme)
    // No invented first-party/SRD claim, no old public-distribution ban and no
    // "there is no legal risk" claim.
    && !/COC SRD/.test(text) && !/已获官方授权|官方授权版本/.test(text)
    && !/不得声称整包可自由分发/.test(text)
    && !/保证[^。\n]*无法律风险|no legal risk/i.test(text);
})(), null);

check("pendingSpecialismsExcluded", (facts.pendingSpecialisms ?? []).length === 7
  && (facts.pendingSpecialisms ?? []).every((pending) => pending.base === null
    && pending.status === "pending-official-source"
    && !docsByKey.has(pending.factId)
    && !allSkillDocs.some((doc) => doc.flags.brp.coc.factId === pending.factId)),
  { pending: facts.pendingSpecialisms?.length, emitted: allSkillDocs.filter((doc) => doc.flags.brp.coc.status === "pending-official-source").length });

const core = {
  "credit-rating": 0,
  "cthulhu-mythos": 0,
  "library-use": 20,
  "fighting-brawl": 25,
  "firearms-handgun": 20,
  "firearms-rifle-shotgun": 25,
};
check("coreSkillValues", Object.entries(core).every(([key, base]) => docsByKey.get(key)?.system.base === base),
  Object.fromEntries(Object.keys(core).map((key) => [key, docsByKey.get(key)?.system.base])));

const dodge = docsByKey.get("dodge");
const own = docsByKey.get("language-own");
check("formulaSkillsUseVariableBaseFormula", dodge?.system.variable === true
  && dodge.system.baseFormula["1"].stat === "dex" && dodge.system.baseFormula["1"].value === 0.5
  && own?.system.variable === true
  && own.system.baseFormula["1"].stat === "edu" && own.system.baseFormula["1"].value === 1,
  { dodge: dodge?.system, own: own?.system });

check("noFixedZeroOutsideOfficialZeroSkills", allSkillDocs.filter((doc) => doc.system.base === 0 && !doc.system.variable)
  .every((doc) => ["credit-rating", "cthulhu-mythos"].includes(doc.flags.brp.coc.key)),
  allSkillDocs.filter((doc) => doc.system.base === 0).map((doc) => doc.flags.brp.coc.key));

const brpidRe = /^i\.skill\.coc\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const specIds = new Set();
check("brpidAsciiAndUnique", allSkillDocs.every((doc) => brpidRe.test(doc.flags.brp.brpidFlag.id))
  && new Set(allSkillDocs.map((doc) => doc.flags.brp.brpidFlag.id)).size === allSkillDocs.length,
  allSkillDocs.filter((doc) => !brpidRe.test(doc.flags.brp.brpidFlag.id)).map((doc) => doc.flags.brp.brpidFlag.id));

const specDocs = allSkillDocs.filter((doc) => doc.system.specialism);
const coreSpecDocs = cocDocs.filter((doc) => doc.system.specialism);
const LEGACY_SPECIALISM_COUNT = 21;
const sealdiceSpecialismCount = facts.skills.filter((skill) => String(skill.factId).startsWith("sealdice.skill.") && skill.specialism).length;
check("specialismIdentityIndependent", specDocs.length === LEGACY_SPECIALISM_COUNT + sealdiceSpecialismCount && specDocs.every((doc) => {
  const specKey = doc.flags.brp.coc.specKey;
  const parentKey = doc.flags.brp.coc.parentKey;
  if (!specKey || !parentKey || doc.system.chosen !== true || doc.system.specName !== doc.name) return false;
  const id = `${parentKey}/${specKey}`;
  if (specIds.has(id)) return false;
  specIds.add(id);
  return true;
}), { count: specDocs.length, ids: [...specIds] });

check("specialismIdentitySpansBothPacks", coreSpecDocs.length === 22 && specDocs.length === 50,
  { coreSpecialisms: coreSpecDocs.length, allSpecialisms: specDocs.length });

check("allDocsTaggedCoc", allSkillDocs.every((doc) => doc.flags.brp.contentSource === "coc"),
  allSkillDocs.filter((doc) => doc.flags.brp.contentSource !== "coc").length);

check("expansionSkillsAreNotStarterSkills", (() => {
  // Starter auto-attach selects every registered coc skill with `system.basic`.
  // An expansion member must therefore never be basic, or enabling the module
  // would silently add 31 skills to every new investigator.
  return cocDocs.every((doc) => doc.system.basic === true)
    && expandSkillDocs.every((doc) => doc.system.basic === false);
})(), { core: cocDocs.filter((doc) => doc.system.basic).length, expand: expandSkillDocs.filter((doc) => doc.system.basic).length });

// M3/M5/M6/M7 specialisms added after the first batch, all verified as secondary evidence.
const NEW_SPECIALISMS = {
  "science-pharmacy": { parentKey: "science", specKey: "pharmacy", base: 1, mainName: "科学" },
  "science-engineering": { parentKey: "science", specKey: "engineering", base: 1, mainName: "科学" },
  "science-physics": { parentKey: "science", specKey: "physics", base: 1, mainName: "科学" },
  "science-astronomy": { parentKey: "science", specKey: "astronomy", base: 1, mainName: "科学" },
  "science-zoology": { parentKey: "science", specKey: "zoology", base: 1, mainName: "科学" },
  "science-forensics": { parentKey: "science", specKey: "forensics", base: 1, mainName: "科学" },
  "art-craft-acting": { parentKey: "art-craft", specKey: "acting", base: 5, mainName: "艺术/手艺" },
  "art-craft-technical-drawing": { parentKey: "art-craft", specKey: "technical-drawing", base: 5, mainName: "艺术/手艺" },
  // M8 SealDice compatibility batch: only concrete skills with a verified
  // family base and a skills.py member value.
  "art-craft-farming": { parentKey: "art-craft", specKey: "farming", base: 5, mainName: "艺术/手艺" },
  "art-craft-forgery": { parentKey: "art-craft", specKey: "forgery", base: 5, mainName: "艺术/手艺" },
  "art-craft-music": { parentKey: "art-craft", specKey: "music", base: 5, mainName: "艺术/手艺" },
  "art-craft-woodworking": { parentKey: "art-craft", specKey: "woodworking", base: 5, mainName: "艺术/手艺" },
  "art-craft-writing": { parentKey: "art-craft", specKey: "writing", base: 5, mainName: "艺术/手艺" },
  "art-craft-typing": { parentKey: "art-craft", specKey: "typing", base: 5, mainName: "艺术/手艺" },
  "art-craft-shorthand": { parentKey: "art-craft", specKey: "shorthand", base: 5, mainName: "艺术/手艺" },
  "pilot-horse": { parentKey: "pilot", specKey: "horse", base: 1, mainName: "驾驶" },
  "science-botany": { parentKey: "science", specKey: "botany", base: 1, mainName: "科学" },
  "science-geology": { parentKey: "science", specKey: "geology", base: 1, mainName: "科学" },
  "science-math": { parentKey: "science", specKey: "math", base: 10, mainName: "科学" },
  "survival-mountain": { parentKey: "survival", specKey: "mountain", base: 5, mainName: "生存" },
};
check("m5SpecialismsCarryFamilyBaseAndIdentity", (() => {
  const bad = [];
  for (const [key, expected] of Object.entries(NEW_SPECIALISMS)) {
    const doc = docsByKey.get(key);
    if (!doc) { bad.push(`${key}: missing`); continue; }
    const coc = doc.flags.brp.coc;
    if (coc.parentKey !== expected.parentKey) bad.push(`${key}: parentKey ${coc.parentKey}`);
    if (coc.specKey !== expected.specKey) bad.push(`${key}: specKey ${coc.specKey}`);
    if (doc.system.base !== expected.base) bad.push(`${key}: base ${doc.system.base}`);
    if (doc.system.specialism !== true || doc.system.chosen !== true) bad.push(`${key}: not a chosen specialism`);
    if (doc.system.mainName !== expected.mainName) bad.push(`${key}: mainName ${doc.system.mainName}`);
    if (doc.system.specName !== doc.name) bad.push(`${key}: specName ${doc.system.specName}`);
    if (doc.flags.brp.brpidFlag.id !== `i.skill.coc.${key}`) bad.push(`${key}: brpid ${doc.flags.brp.brpidFlag.id}`);
    if (!(coc.sourceRefs ?? []).length) bad.push(`${key}: no sourceRefs`);
  }
  return bad.length ? bad : true;
})(), Object.keys(NEW_SPECIALISMS).map((key) => [key, docsByKey.get(key)?.system?.base]));

check("skillFamiliesConcreteCoversEveryPublishedSpecialism", (() => {
  // The profession families are the builder's pick-list: a concrete specialism
  // that exists in the skill pack but is missing from its family can never be
  // chosen, so the two lists must agree in both directions.
  const bad = [];
  const provenanceFamilies = readJson("content/coc/professions.json").skillFamilies ?? {};
  // Mathematics (10) and Survival (Mountain) (5) carry their own printed
  // values rather than the family default. Families whose base is intentionally
  // unknown (Fighting/Firearms, requiresExplicitBase) publish concrete members
  // with their own verified values, so only the member's base is checked.
  const SPECIALISM_BASE_OVERRIDES = { "science-math": 10, "survival-mountain": 5 };
  const published = new Map(specDocs.map((doc) => [`${doc.flags.brp.coc.parentKey}/${doc.flags.brp.coc.specKey}`, doc]));
  const listed = new Set();
  for (const [familyKey, family] of Object.entries(provenanceFamilies)) {
    for (const key of family.concrete ?? []) {
      const doc = docsByKey.get(key);
      if (!doc) { bad.push(`${familyKey}: unknown concrete ${key}`); continue; }
      if (doc.flags.brp.coc.parentKey !== family.parentKey) bad.push(`${familyKey}: ${key} parent ${doc.flags.brp.coc.parentKey}`);
      if (family.base === null) {
        if (family.requiresExplicitBase !== true) bad.push(`${familyKey}: null base without requiresExplicitBase`);
        if (!Number.isInteger(doc.system.base)) bad.push(`${familyKey}: ${key} has no verified member base`);
      } else {
        const expectedBase = SPECIALISM_BASE_OVERRIDES[key] ?? family.base;
        if (doc.system.base !== expectedBase) bad.push(`${familyKey}: ${key} base ${doc.system.base} != ${expectedBase}`);
      }
      listed.add(`${doc.flags.brp.coc.parentKey}/${doc.flags.brp.coc.specKey}`);
    }
  }
  for (const id of published.keys()) {
    if (!listed.has(id)) bad.push(`${id}: published but absent from skillFamilies.concrete`);
  }
  return bad.length ? bad : true;
})(), null);

check("octopusPackHasNoCocContent", octopusDocs.every((doc) => doc.flags.brp.contentSource !== "coc"
  && !String(doc.flags.brp.brpidFlag.id).startsWith("i.skill.coc.")),
  octopusDocs.filter((doc) => String(doc.flags.brp.brpidFlag.id).startsWith("i.skill.coc.")).map((doc) => doc.flags.brp.brpidFlag.id));
check("noCocBrpidCollisionWithOctopus", !allSkillDocs.some((doc) => octopusDocs.some((oct) => oct.flags.brp.brpidFlag.id === doc.flags.brp.brpidFlag.id)));
check("provenanceHasOfficialSourcesAndExclusions", provenance.sources.length >= 8
  && provenance.sources.every((source) => source.url.startsWith("https://"))
  && provenance.licenseBoundary.excluded.some((line) => line.includes("No official PDF")));
check("noStatsAppInContent", !JSON.stringify(facts).includes("\"app\"") && !JSON.stringify(allSkillDocs).includes("\"stats\""));

// --- 3) centralized rules ---
const coc = Rules.for("coc");
const cocAlias = Rules.for("coc7");
const brp = Rules.for("octopus");
const stats = (values) => Object.fromEntries(Object.entries(values).map(([key, total]) => [key, { total, base: total, redist: 0, culture: 0 }]));
const actorData = { type: "character", system: { age: 40 } };

const aliasDerived = cocAlias.deriveSecondary({
  actorData,
  systemData: { stats: stats({ con: 50, siz: 50, pow: 40, str: 60, dex: 55 }) },
});
check("coc7AliasResolvesToCocAdapter", cocAlias === coc && cocAlias.id === "coc"
  && Rules.for("coc") === coc && Rules.active("coc7") === coc
  && Rules.normalizeId("coc7") === "coc"
  && aliasDerived.healthMax === 10 && aliasDerived.powerMax === 8
  && cocAlias.check.successLevel({ rollVal: 96, targetScore: 40 }) === 0
  && brp.check.successLevel({ rollVal: 96, targetScore: 40 }) === 1,
  {
    aliasId: cocAlias.id,
    hp: aliasDerived.healthMax,
    mp: aliasDerived.powerMax,
    coc96: cocAlias.check.successLevel({ rollVal: 96, targetScore: 40 }),
    octopus96: brp.check.successLevel({ rollVal: 96, targetScore: 40 }),
  });
check("unknownRulesetFallsBackToOctopusNotCoc", Rules.for("unknown") === brp
  && Rules.active("unknown") === brp && Rules.for("coc7") !== Rules.for("unknown"),
  { unknown: Rules.for("unknown").id, coc7: Rules.for("coc7").id });

// --- M3 pure combat/wound rules (no Foundry) ---
const bandOf = (rollVal, targetScore) => coc.check.successBand({ rollVal, targetScore }).band;
check("cocBandRankIsMonotonic", ["fumble", "fail", "regular", "hard", "extreme"].every((band, index, all) => index === 0
  || coc.combat.bandRank(band) > coc.combat.bandRank(all[index - 1]))
  && coc.combat.bandRank("critical") === coc.combat.bandRank("extreme")
  && coc.combat.bandRank("hard") !== coc.combat.bandRank("regular"),
  { fumble: coc.combat.bandRank("fumble"), fail: coc.combat.bandRank("fail"),
    regular: coc.combat.bandRank("regular"), hard: coc.combat.bandRank("hard"),
    extreme: coc.combat.bandRank("extreme"), critical: coc.combat.bandRank("critical") });
check("cocCharacteristicTargetIsTheValue", coc.check.characteristicTarget(60) === 60
  && coc.check.characteristicTarget(1) === 1 && coc.check.characteristicTarget(-3) === 0
  && brp.check.characteristicTarget(60) === 300,
  { coc: coc.check.characteristicTarget(60), octopus: brp.check.characteristicTarget(60) });
check("cocDifficultyIsRequiredBandNotMultiplier", coc.check.requiredBand("average") === "regular"
  && coc.check.requiredBand("regular") === "regular"
  && coc.check.requiredBand("hard") === "hard"
  && coc.check.requiredBand("difficult") === "hard"
  && coc.check.requiredBand("extreme") === "extreme"
  && coc.check.requiredBand("no-such-difficulty") === "regular"
  && brp.check.requiredBand("hard") === null,
  { hard: coc.check.requiredBand("hard"), extreme: coc.check.requiredBand("extreme"), octopus: brp.check.requiredBand("hard") });
check("cocBonusDiceSeamIsCocOnly", coc.check.supportsBonusDice === true
  && brp.check.supportsBonusDice === false,
  { coc: coc.check.supportsBonusDice, octopus: brp.check.supportsBonusDice });
check("cocDicePoolCancelsBonusAndPenalty", (() => {
  const oneBonus = coc.check.dice.dicePool({ bonus: 1, penalty: 0 });
  const cancel = coc.check.dice.dicePool({ bonus: 1, penalty: 1 });
  const netBonus = coc.check.dice.dicePool({ bonus: 3, penalty: 1 });
  const netPenalty = coc.check.dice.dicePool({ bonus: 1, penalty: 3 });
  return oneBonus.choose === "lowest" && oneBonus.tensDice === 2
    && cancel.tensDice === 1 && cancel.net === 0
    && netBonus.bonus === 2 && netBonus.penalty === 0 && netBonus.tensDice === 3
    && netPenalty.penalty === 2 && netPenalty.bonus === 0 && netPenalty.choose === "highest";
})(), { one: coc.check.dice.dicePool({ bonus: 1 }), cancel: coc.check.dice.dicePool({ bonus: 1, penalty: 1 }),
  netBonus: coc.check.dice.dicePool({ bonus: 3, penalty: 1 }), netPenalty: coc.check.dice.dicePool({ bonus: 1, penalty: 3 }) });
check("cocD100Formula", coc.check.d100Formula({}) === "1D100"
  && coc.check.d100Formula({ bonus: 1 }) === "3D10"
  && coc.check.d100Formula({ penalty: 1 }) === "3D10"
  && coc.check.d100Formula({ penalty: 2 }) === "4D10"
  && brp.check.d100Formula === undefined,
  { plain: coc.check.d100Formula({}), bonus: coc.check.d100Formula({ bonus: 1 }), penalty2: coc.check.d100Formula({ penalty: 2 }) });
check("cocResolveD100ReadsTensAndUnits", (() => {
  const pairs = (units, tens, opts) => coc.check.resolveD100({ units, tens, ...opts });
  const zeroZero = pairs(0, [0]);
  const zeroThree = pairs(3, [0]);
  const bonus = pairs(5, [4, 2], { bonus: 1 });
  const penalty = pairs(5, [4, 2], { penalty: 1 });
  const hundredWithBonus = pairs(0, [0, 9], { bonus: 1 });
  return zeroZero.rollVal === 100 && zeroThree.rollVal === 3
    && bonus.rollVal === 25 && bonus.chosenTens === 2
    && penalty.rollVal === 45 && penalty.chosenTens === 4
    && hundredWithBonus.rollVal === 90 && hundredWithBonus.chosenTens === 9;
})(), { hundred: coc.check.resolveD100({ units: 0, tens: [0] }).rollVal,
  zeroThree: coc.check.resolveD100({ units: 3, tens: [0] }).rollVal,
  bonus: coc.check.resolveD100({ units: 5, tens: [4, 2], bonus: 1 }),
  penalty: coc.check.resolveD100({ units: 5, tens: [4, 2], penalty: 1 }) });
check("cocOpposedBandSkillThenReroll", (() => {
  const byBand = coc.combat.compareOpposed({ band: "regular", skill: 40, rollVal: 30 }, { band: "fail", skill: 90, rollVal: 80 });
  const bySkill = coc.combat.compareOpposed({ band: "regular", skill: 60, rollVal: 30 }, { band: "regular", skill: 50, rollVal: 40 });
  const tie = coc.combat.compareOpposed({ band: "hard", skill: 50, rollVal: 20 }, { band: "hard", skill: 50, rollVal: 10 });
  const reroll = coc.combat.compareOpposedReroll({ rollVal: 20 }, { rollVal: 10 });
  const equalReroll = coc.combat.compareOpposedReroll({ rollVal: 10 }, { rollVal: 10 });
  return byBand.winner === "attacker" && byBand.reason === "band"
    && bySkill.winner === "attacker" && bySkill.reason === "skill"
    && tie.reroll === true && tie.winner === null && tie.reason === "equal-skill"
    && reroll.winner === "defender" && reroll.reason === "lower-roll"
    && equalReroll.reroll === true && equalReroll.winner === null;
})(), { tie: coc.combat.compareOpposed({ band: "hard", skill: 50, rollVal: 20 }, { band: "hard", skill: 50, rollVal: 10 }) });
check("cocDodgeTieGoesToDefender", (() => {
  const tie = coc.combat.resolveCloseCombat(
    { band: "regular", targetScore: 60, rollVal: 40 },
    { band: "regular", targetScore: 50, rollVal: 30 }, { choice: "dodge" });
  const attackerHigher = coc.combat.resolveCloseCombat(
    { band: "hard", targetScore: 60, rollVal: 20 },
    { band: "regular", targetScore: 50, rollVal: 30 }, { choice: "dodge" });
  return tie.winner === "defender" && tie.reason === "dodge-tie"
    && attackerHigher.winner === "attacker";
})(), null);
check("cocFightbackNeedsStrictlyHigherAndRegularDamage", (() => {
  const tie = coc.combat.resolveCloseCombat(
    { band: "regular", targetScore: 60, rollVal: 40 },
    { band: "regular", targetScore: 50, rollVal: 30 }, { choice: "fightback" });
  const defenderHigher = coc.combat.resolveCloseCombat(
    { band: "regular", targetScore: 40, rollVal: 30 },
    { band: "extreme", targetScore: 50, rollVal: 8 }, { choice: "fightback" });
  const bothFail = coc.combat.resolveCloseCombat(
    { band: "fail", targetScore: 40, rollVal: 70 },
    { band: "fail", targetScore: 50, rollVal: 80 }, { choice: "fightback" });
  const fumbleVsFail = coc.combat.resolveCloseCombat(
    { band: "fumble", targetScore: 40, rollVal: 100 },
    { band: "fail", targetScore: 50, rollVal: 80 }, { choice: "fightback" });
  return tie.winner === "attacker" && tie.reason === "fightback-tie"
    && defenderHigher.winner === "defender" && defenderHigher.damageTier === "regular"
    && bothFail.winner === null && fumbleVsFail.winner === null;
})(), null);
check("cocUnopposedAttackResolvesOnItsOwnBand", (() => {
  // No declared defence is a legal close-combat state: the attack resolves on
  // its own band instead of inventing a dodge for the target.
  const hit = coc.combat.resolveCloseCombat(
    { band: "regular", targetScore: 60, rollVal: 40 }, null, { choice: "none", kind: "melee" });
  const miss = coc.combat.resolveCloseCombat(
    { band: "fail", targetScore: 60, rollVal: 70 }, null, { choice: "none", kind: "melee" });
  const fumble = coc.combat.resolveCloseCombat(
    { band: "fumble", targetScore: 40, rollVal: 100 }, null, { choice: "none", kind: "melee" });
  return hit.winner === "attacker" && hit.reason === "unopposed"
    && miss.winner === null && miss.reason === "unopposed"
    && fumble.winner === null;
})(), {
  hit: coc.combat.resolveCloseCombat({ band: "regular", targetScore: 60, rollVal: 40 }, null, { choice: "none" }),
  miss: coc.combat.resolveCloseCombat({ band: "fail", targetScore: 60, rollVal: 70 }, null, { choice: "none" }),
});
check("cocFirearmsCannotFightBackAndCanDiveForCover", (() => {
  const fightback = coc.combat.resolveCloseCombat(
    { band: "regular", targetScore: 60, rollVal: 40 },
    { band: "extreme", targetScore: 50, rollVal: 4 }, { choice: "fightback", kind: "firearm" });
  const cover = coc.combat.resolveCloseCombat(
    { band: "regular", targetScore: 60, rollVal: 40 },
    { band: "hard", targetScore: 50, rollVal: 20 }, { choice: "cover", kind: "firearm" });
  const dodge = coc.combat.resolveCloseCombat(
    { band: "regular", targetScore: 60, rollVal: 40 },
    { band: "extreme", targetScore: 50, rollVal: 4 }, { choice: "dodge", kind: "firearm" });
  return fightback.illegal === true && fightback.notes.includes("firearm-no-fightback")
    && cover.reroll === true && cover.attackerPenaltyDice === 1 && cover.defenderForfeitsNextAttack === true
    && dodge.illegal === true && dodge.notes.includes("firearm-no-dodge")
    && coc.combat.defenseOptions({ kind: "firearm" }).join() === "cover";
})(), null);
check("cocWeaponProfileUnarmedIsBluntFullDb", (() => {
  const unarmed = coc.combat.weaponProfile({
    system: { weaponType: "melee", dmg1: "1D3", db: "full", special: "crush" },
    flags: { brp: { unarmed: true } },
  });
  return unarmed.kind === "melee" && unarmed.ranged === false && unarmed.dbMode === "full"
    && unarmed.impaling === false && unarmed.formula === "1D3" && unarmed.unarmed === true;
})(), null);
check("cocNullDefenderSideDoesNotThrow", (() => {
  // A card with a single attacker entry passes a null defender side; reading it
  // must not throw and must rank as a plain failure.
  const outcome = coc.combat.resolveCloseCombat({ band: "hard", targetScore: 55, rollVal: 20 }, undefined, { choice: "none" });
  return outcome.winner === "attacker" && outcome.reason === "unopposed";
})(), coc.combat.resolveCloseCombat({ band: "hard", targetScore: 55, rollVal: 20 }, undefined, { choice: "none" }));
check("cocWeaponProfileFirearmNoDbNoImpale", (() => {
  const gun = coc.combat.weaponProfile({
    system: { weaponType: "firearm", dmg1: "1D10", dmg2: "1D10", db: "none", special: "impale", mal: 96 },
  });
  const bow = coc.combat.weaponProfile({ system: { weaponType: "missile", dmg1: "1D6+1", db: "" } });
  const marked = coc.combat.weaponProfile({
    system: { weaponType: "melee", dmg1: "1D8", db: "full", special: "crush" },
    flags: { brp: { coc: { weapon: { kind: "melee", dbMode: "half", impaling: true } } } },
  });
  return gun.ranged === true && gun.dbMode === "none" && gun.impaling === false && gun.mal === 96
    && bow.ranged === true && bow.dbMode === "half"
    && marked.dbMode === "half" && marked.impaling === true && marked.marker === true;
})(), null);
check("cocExtremeDamageBluntAndImpaling", (() => {
  const blunt = coc.combat.damageFormula({ weaponFormula: "1D3", dbFormula: "+1D4", impaling: false, tier: "extreme" });
  const impaling = coc.combat.damageFormula({ weaponFormula: "1D8", dbFormula: "+1D4", impaling: true, tier: "extreme" });
  const regular = coc.combat.damageFormula({ weaponFormula: "1D8", dbFormula: "+1D4", impaling: true, tier: "regular" });
  return blunt === "7" && coc.damageMax(blunt) === 7
    && coc.damageMax(impaling) === 8 + 4 + 8
    && regular === "1D8+1D4";
})(), { blunt: coc.combat.damageFormula({ weaponFormula: "1D3", dbFormula: "+1D4", impaling: false, tier: "extreme" }),
  impaling: coc.combat.damageFormula({ weaponFormula: "1D8", dbFormula: "+1D4", impaling: true, tier: "extreme" }) });
check("cocDamageTierMapsHardToRegular", coc.combat.damageTier({ rank: 3, role: "attacker" }) === "regular"
  && coc.combat.damageTier({ rank: 4, role: "attacker" }) === "extreme"
  && coc.combat.damageTier({ rank: 4, role: "defender" }) === "regular"
  && coc.combat.damageTier({ rank: 1, role: "attacker" }) === null,
  { hard: coc.combat.damageTier({ rank: 3 }), extreme: coc.combat.damageTier({ rank: 4 }),
    defender: coc.combat.damageTier({ rank: 4, role: "defender" }) });
check("cocHalfDamageBonus", coc.combat.halfDamageBonus("+1D6") === "1D3"
  && coc.combat.halfDamageBonus("+2D6") === "1D6"
  && coc.combat.halfDamageBonus("+3D6") === "1D6+1D3"
  && coc.combat.halfDamageBonus("-1") === "0"
  && coc.combat.halfDamageBonus("-2") === "-1"
  && coc.combat.damageBonusFor({ dbFull: "+1D6", dbHalf: "1D3", mode: "half" }) === "1D3"
  && coc.combat.damageBonusFor({ dbFull: "+1D6", dbHalf: "1D3", mode: "none" }) === "0",
  { one: coc.combat.halfDamageBonus("+1D6"), three: coc.combat.halfDamageBonus("+3D6"), minusOne: coc.combat.halfDamageBonus("-1") });
check("cocDerivedHalfDbIsHalved", (() => {
  const derived = coc.deriveSecondary({
    actorData: {},
    systemData: { stats: { str: { total: 80 }, siz: { total: 80 }, con: { total: 50 }, pow: { total: 40 }, dex: { total: 55 } } },
  });
  return derived.dmgBonus.full === "+1D4" && derived.dmgBonus.half === "1D2" && derived.build === 1;
})(), null);
check("cocMaxOfFormulaDoesNotUseRollMaximize", coc.damageMax("1D10+2") === 12
  && coc.damageMax("2D6+4") === 16 && coc.damageMax("1D8+1D6+3") === 17
  && coc.damageMax("1D3") === 3 && coc.damageMax("0") === 0,
  { a: coc.damageMax("1D10+2"), b: coc.damageMax("2D6+4"), c: coc.damageMax("1D8+1D6+3") });
check("cocMajorWoundThresholdOddHp", coc.wounds.majorWoundThreshold(11) === 6
  && coc.wounds.isMajorWound({ damage: 5, hpMax: 11 }) === false
  && coc.wounds.isMajorWound({ damage: 6, hpMax: 11 }) === true
  && coc.wounds.isInstantDeath({ damage: 10, hpMax: 11 }) === false
  && coc.wounds.isInstantDeath({ damage: 11, hpMax: 11 }) === true,
  { threshold: coc.wounds.majorWoundThreshold(11) });
check("cocApplyDamageDyingAndUnconsciousStates", (() => {
  const zeroNoMajor = coc.wounds.applyDamage({ hpValue: 3, hpMax: 11, damage: 3 });
  const zeroWithMajor = coc.wounds.applyDamage({ hpValue: 6, hpMax: 11, damage: 6 });
  const instant = coc.wounds.applyDamage({ hpValue: 11, hpMax: 11, damage: 11 });
  const existingMajor = coc.wounds.applyDamage({ hpValue: 1, hpMax: 11, damage: 1, majorWound: true });
  return zeroNoMajor.hpAfter === 0 && zeroNoMajor.unconscious === true
    && zeroNoMajor.dying === false && zeroNoMajor.majorWound === false
    && zeroWithMajor.majorWound === true && zeroWithMajor.dying === true
    && zeroWithMajor.conCheckRequired === true && zeroWithMajor.instantDeath === false
    && instant.instantDeath === true && instant.death === true
    && existingMajor.dying === true && existingMajor.anyMajorWound === true;
})(), null);
check("cocWoundStateKeepsExplicitUnconscious", (() => {
  const state = coc.wounds.woundState({ hpValue: 4, hpMax: 10, majorWound: true, unconscious: true });
  const dead = coc.wounds.woundState({ hpValue: 0, hpMax: 10, dead: true });
  const dying = coc.wounds.woundState({ hpValue: 0, hpMax: 10, dying: true });
  return state.unconscious === true && state.majorWound === true && state.dead === false
    && dead.dead === true && dead.unconscious === true
    && dying.dying === true && dying.unconscious === true;
})(), null);
check("cocHealingBands", (() => {
  const regular = coc.wounds.healingCheck({ band: "regular" });
  const hard = coc.wounds.healingCheck({ band: "hard" });
  const extreme = coc.wounds.healingCheck({ band: "extreme" });
  const critical = coc.wounds.healingCheck({ band: "critical" });
  const fail = coc.wounds.healingCheck({ band: "fail" });
  return regular.formula === "1D3" && regular.clearsMajorWound === false
    && hard.formula === "1D3"
    && extreme.formula === "2D3" && extreme.clearsMajorWound === true
    && critical.formula === "2D3"
    && fail.healed === false && fail.formula === "";
})(), null);
check("cocFirstAidAndMedicine", (() => {
  const aidDying = coc.wounds.firstAid({ band: "regular", dying: true, unconscious: true });
  const aidAwake = coc.wounds.firstAid({ band: "hard", unconscious: true });
  const aidFail = coc.wounds.firstAid({ band: "fail", unconscious: true });
  const medDying = coc.wounds.medicine({ band: "regular", dying: true });
  const medFail = coc.wounds.medicine({ band: "fumble" });
  const natural = coc.wounds.naturalHeal({ majorWound: true });
  const naturalFree = coc.wounds.naturalHeal({ majorWound: false });
  return aidDying.healed === true && aidDying.hp === 1 && aidDying.stabilizes === true && aidDying.rouses === false
    && aidAwake.rouses === true && aidFail.healed === false
    && medDying.formula === "1D3" && medDying.grantsWeeklyHealing === true
    && medFail.healed === false
    && natural.hp === 0 && natural.requiresWeeklyCheck === true
    && naturalFree.hp === 1;
})(), null);
check("cocMajorWoundClearsAtHalfOrExtreme", coc.wounds.majorWoundCleared({ hpValue: 5, hpMax: 10 }) === true
  && coc.wounds.majorWoundCleared({ hpValue: 4, hpMax: 10 }) === false
  && coc.wounds.majorWoundCleared({ hpValue: 1, hpMax: 10, extremeSuccess: true }) === true,
  null);
check("cocDamageModifiers", coc.combat.maneuverPenalty({ attackerBuild: 0, defenderBuild: 2 }).penalty === 2
  && coc.combat.maneuverPenalty({ attackerBuild: 0, defenderBuild: 3 }).effective === false
  && coc.combat.maneuverPenalty({ attackerBuild: 2, defenderBuild: 0 }).penalty === 0
  && coc.combat.outnumberedBonus({ defenderActedThisRound: true }) === 1
  && coc.combat.outnumberedBonus({ defenderActedThisRound: true, ranged: true }) === 0
  && coc.combat.shotsPenalty({ shots: 1 }) === 0 && coc.combat.shotsPenalty({ shots: 2 }) === 1
  && coc.combat.shotsPenalty({ shots: 3 }) === 1 && coc.combat.shotsPenalty({ shots: 4 }) === 0
  && coc.combat.pointBlankBonus({ distanceFeet: 10, dex: 55 }) === 1
  && coc.combat.pointBlankBonus({ distanceFeet: 12, dex: 55 }) === 0
  && coc.combat.initiativeBonus({ readiedFirearm: true }) === 50,
  { maneuver2: coc.combat.maneuverPenalty({ attackerBuild: 0, defenderBuild: 2 }),
    maneuver3: coc.combat.maneuverPenalty({ attackerBuild: 0, defenderBuild: 3 }),
    pointBlank: coc.combat.pointBlankBonus({ distanceFeet: 10, dex: 55 }) });
check("cocAttackTargetKeepsSkillTotal", (() => {
  const plain = coc.combat.attackTarget({ skillTotal: 60 });
  const penalized = coc.combat.attackTarget({ skillTotal: 60, diceMod: -1, requiredBand: "hard" });
  return plain.targetScore === 60 && plain.requiredBand === "regular" && plain.net === 0
    && penalized.targetScore === 60 && penalized.penalty === 1 && penalized.minimumRank === 3;
})(), null);
check("cocSkillRefResolvesBrpid", (() => {
  const ref = coc.combat.skillRefFromBrpid("i.skill.coc.fighting-brawl");
  const doc = coc.combat.skillRefFromDocument({
    flags: { brp: { brpidFlag: { id: "i.skill.coc.firearms-handgun" }, coc: { key: "firearms-handgun", parentKey: "firearms", specKey: "handgun" } } },
  });
  return ref?.key === "fighting-brawl" && coc.combat.skillRefFromBrpid("i.skill.brawl") === null
    && doc.parentKey === "firearms" && doc.specKey === "handgun";
})(), null);
check("cocStarterUnarmedMarker", coc.starter.unarmed.damage === "1D3"
  && coc.starter.unarmed.dbMode === "full" && coc.starter.unarmed.impaling === false
  && coc.starter.brawlBrpid === "i.skill.coc.fighting-brawl",
  coc.starter.unarmed);

const derived = coc.deriveSecondary({
  actorData,
  systemData: { stats: stats({ con: 50, siz: 50, pow: 40, str: 60, dex: 55 }), health: { mod: 0 }, power: { mod: 0 } },
});
check("cocHpMpBuildDb", derived.healthMax === 10 && derived.powerMax === 8
  && derived.build === 0 && derived.dmgBonus.full === "+0",
  derived);
const odd = coc.deriveSecondary({
  actorData: { system: { age: 20 } },
  systemData: { stats: stats({ con: 55, siz: 50, pow: 43, str: 50, dex: 50 }) },
});
check("cocHpMpRoundDown", odd.healthMax === 10 && odd.powerMax === 8,
  { hp: odd.healthMax, mp: odd.powerMax });
const movAt = (age) => coc.deriveSecondary({
  actorData: { system: { age } },
  systemData: { stats: stats({ con: 40, siz: 50, pow: 40, str: 40, dex: 40 }) },
}).mov;
const movEqual = coc.deriveSecondary({
  actorData: { system: { age: 20 } },
  systemData: { stats: stats({ con: 40, siz: 50, pow: 40, str: 50, dex: 50 }) },
}).mov;
check("cocMovAge", derived.mov === 8 && movAt(20) === 7 && movAt(40) === 6
  && movAt(50) === 5 && movAt(70) === 3 && movEqual === 9,
  { age20: movAt(20), age40: movAt(40), age50: movAt(50), age70: movAt(70), equalToSize: movEqual, dex55: derived.mov });

const dbAt = (strSiz) => coc.deriveSecondary({ actorData, systemData: { stats: stats({ con: 50, siz: 0, pow: 40, str: strSiz, dex: 50 }) } });
check("cocBuildDbTableBoundaries", [
  [124, 0, "+0"], [125, 1, "+1D4"], [164, 1, "+1D4"], [165, 2, "+1D6"],
  [204, 2, "+1D6"], [205, 3, "+2D6"], [285, 4, "+3D6"], [365, 5, "+4D6"], [445, 6, "+5D6"],
].every(([sum, build, db]) => {
  const value = dbAt(sum);
  return value.build === build && value.dmgBonus.full === db;
}), [124, 125, 165, 205, 285, 365, 445].map((sum) => ({ sum, ...dbAt(sum).build, db: dbAt(sum).dmgBonus.full })));

const san = coc.sanity.initial({ pow: 40, mythosPercent: 0 });
check("cocSanStartMaxAndMythos", san.starting === 40 && san.max === 99 && san.value === 40 && san.tis === 8,
  san);
const sanWithMythos = coc.sanity.prepare({ pow: 40, starting: 40, mythosPercent: 23 });
check("cocSanMythosCap", sanWithMythos.max === 76 && sanWithMythos.value === undefined && sanWithMythos.tis === 8,
  sanWithMythos);
check("cocLuckIndependentFormula", coc.luck.initial({ pow: 40 }).formula === "3D6*5"
  && brp.luck.initial({ pow: 40 }).max === 200,
  { coc: coc.luck.initial({ pow: 40 }), brp: brp.luck.initial({ pow: 40 }) });

const band = (rollVal, targetScore) => coc.check.successBand({ rollVal, targetScore }).band;
const level = (rollVal, targetScore) => coc.check.successLevel({ rollVal, targetScore });
check("cocSuccessBandsHighSkill", band(1, 60) === "critical" && band(12, 60) === "extreme"
  && band(30, 60) === "hard" && band(31, 60) === "regular" && band(60, 60) === "regular"
  && band(61, 60) === "fail" && band(96, 60) === "fail" && band(100, 60) === "fumble",
  [1, 12, 30, 31, 60, 61, 96, 100].map((roll) => [roll, band(roll, 60)]));
check("cocSuccessBandsLowSkillFumble96", band(95, 40) === "fail" && band(96, 40) === "fumble"
  && band(100, 40) === "fumble" && level(96, 40) === 0 && level(31, 60) === 2,
  [95, 96, 100].map((roll) => [roll, band(roll, 40)]));
check("cocHundredAlwaysFumblesEvenAtHundredSkill", band(100, 100) === "fumble"
  && band(99, 100) === "regular" && band(96, 49) === "fumble" && band(95, 49) === "fail"
  && band(96, 50) === "fail" && band(50, 100) === "hard",
  { hundredHundred: band(100, 100), ninetyNineHundred: band(99, 100), low96: band(96, 49), fifty: band(50, 100) });
check("brpSuccessBandsUnchanged", brp.check.successLevel({ rollVal: 3, targetScore: 60 }) === 4
  && brp.check.successLevel({ rollVal: 12, targetScore: 60 }) === 3
  && brp.check.successLevel({ rollVal: 13, targetScore: 60 }) === 2
  && brp.check.successLevel({ rollVal: 96, targetScore: 60 }) === 1
  && brp.check.successLevel({ rollVal: 98, targetScore: 60 }) === 0,
  [3, 12, 13, 60, 96, 98].map((roll) => [roll, brp.check.successLevel({ rollVal: roll, targetScore: 60 })]));

check("cocGrowthNoIntBonus", coc.growth.bonus({ system: { xpBonus: 99 } }) === 0
  && coc.growth.formula({ xpFormula: "1D6" }) === "1D10"
  && coc.growth.check({ roll: 51, targetScore: 50 }) === true
  && coc.growth.check({ roll: 50, targetScore: 50 }) === false
  && coc.growth.check({ roll: 100, targetScore: 101 }) === false,
  {
    bonus: coc.growth.bonus({ system: { xpBonus: 99 } }),
    formula: coc.growth.formula({ xpFormula: "1D6" }),
    over: coc.growth.check({ roll: 51, targetScore: 50 }),
    equal: coc.growth.check({ roll: 50, targetScore: 50 }),
    overHundred: coc.growth.check({ roll: 100, targetScore: 101 }),
  });
check("cocXpGatesDifferFromOctopus", (() => {
  // CoC never multiplies the target for difficulty, so an "easy" or raised-diff
  // roll must still tick; Mythos is the only skill that never ticks. Octopus
  // keeps its historical skip list and ticks any item.
  return coc.check.xpSkipsRaisedDifficulty === false && coc.check.xpSkipsNoXP === true
    && brp.check.xpSkipsRaisedDifficulty === true && brp.check.xpSkipsNoXP === false;
})(), { coc: { raised: coc.check.xpSkipsRaisedDifficulty, noXP: coc.check.xpSkipsNoXP },
  octopus: { raised: brp.check.xpSkipsRaisedDifficulty, noXP: brp.check.xpSkipsNoXP } });
check("brpGrowthKeepsIntAndCap", brp.growth.bonus({ system: { xpBonus: 25 } }) === 25
  && brp.growth.check({ roll: 80, targetScore: 100, bonus: 25 }) === true
  && brp.growth.check({ roll: 75, targetScore: 100, bonus: 25 }) === false,
  {
    bonus: brp.growth.bonus({ system: { xpBonus: 25 } }),
    over: brp.growth.check({ roll: 80, targetScore: 100, bonus: 25 }),
    equal: brp.growth.check({ roll: 75, targetScore: 100, bonus: 25 }),
  });

// --- M4 adapter contract: the CoC decision core is the only source of these
// decisions, and octopus keeps the historical answers.
check("cocM4SanityContract", coc.sanity.core === CoCSanity
  && coc.sanity.core.singleLossTrigger({ loss: 4 }).trigger === false
  && coc.sanity.core.singleLossTrigger({ loss: 5 }).trigger === true
  && coc.sanity.core.temporaryInsanity({ loss: 6, intCheck: null }).status === "pending-int-check"
  && coc.sanity.singleLossThreshold === 5
  && coc.sanity.dailyBasis === "day-start"
  && coc.sanity.coexistingStates === true
  && brp.sanity.core === null && brp.sanity.singleLossThreshold === null
  && brp.sanity.coexistingStates === false,
  { cocCore: coc.sanity.core === CoCSanity, cocThreshold: coc.sanity.singleLossThreshold,
    brpCore: brp.sanity.core, brpThreshold: brp.sanity.singleLossThreshold });

check("cocM4LuckContract", coc.luck.canSpend({ purpose: "SK", rollVal: 50 }).allowed === true
  && coc.luck.canSpend({ purpose: "CH", rollVal: 50 }).allowed === true
  && coc.luck.canSpend({ purpose: "SN", rollVal: 50 }).allowed === false
  && coc.luck.canSpend({ purpose: "sanity-loss", rollVal: 50 }).allowed === false
  && coc.luck.canSpend({ purpose: "DM", rollVal: 50 }).allowed === false
  && coc.luck.canSpend({ purpose: "CM", rollVal: 50 }).allowed === false
  && coc.luck.canSpend({ purpose: "LK", rollVal: 50 }).allowed === false
  && coc.luck.canSpend({ purpose: "growth-check", rollVal: 50 }).allowed === false
  && coc.luck.canSpend({ purpose: "SK", rollVal: 100 }).allowed === false
  && coc.luck.canSpend({ purpose: "SK", rollVal: 50, pushed: true }).allowed === false
  && coc.luck.canSpend({ purpose: "halve-san-loss" }).allowed === false
  && coc.luck.cap() === 99 && coc.luck.recoveryAction === "new-session"
  && coc.luck.resettlesSanLoss === false && coc.luck.recoveryNeedsRealRoll === true
  && brp.luck.canSpend().allowed === true && brp.luck.resettlesSanLoss === true,
  { cocSkill: coc.luck.canSpend({ purpose: "SK", rollVal: 50 }),
    cocSan: coc.luck.canSpend({ purpose: "SN", rollVal: 50 }),
    brp: brp.luck.canSpend(), brpResettle: brp.luck.resettlesSanLoss });

check("cocM4GrowthContract", coc.growth.canTick({ rollType: "SK", resultLevel: 2 }).allowed === true
  && coc.growth.canTick({ rollType: "SK", resultLevel: 2, luckSpent: 3 }).allowed === false
  && coc.growth.canTick({ rollType: "SK", resultLevel: 1 }).allowed === false
  && coc.growth.canTick({ rollType: "SK", resultLevel: 2, noXP: true }).allowed === false
  && coc.growth.canTick({ rollType: "SN", resultLevel: 4 }).allowed === false
  && coc.growth.canTick({ rollType: "CH", resultLevel: 3 }).allowed === false
  && coc.growth.canTick({ rollType: "SK", resultLevel: 2, actorType: "npc" }).allowed === false
  && coc.growth.settlement({ roll: 51, currentValue: 50, gainDie: 7 }).gained === 7
  && coc.growth.settlement({ roll: 50, currentValue: 50, gainDie: 7 }).gained === 0
  && coc.growth.allowFixedTier === false && coc.growth.allowPowImprovement === false
  && coc.growth.ticksOnFailure === false && coc.growth.tickOnLuckSuccess === false
  && brp.growth.allowFixedTier === true && brp.growth.allowPowImprovement === true
  && brp.growth.ticksOnFailure === true && brp.growth.tickOnLuckSuccess === true,
  { cocSuccess: coc.growth.canTick({ rollType: "SK", resultLevel: 2 }),
    cocLuck: coc.growth.canTick({ rollType: "SK", resultLevel: 2, luckSpent: 3 }),
    brpFixed: brp.growth.allowFixedTier });

check("cocM4MadnessTables", coc.madness.boutTable.length === 10
  && new Set(coc.madness.boutTable.map((entry) => entry.id)).size === 10
  && coc.madness.manifestationDie === "1D10" && coc.madness.durationDie === "1D10"
  && coc.madness.durationUnit === "hours" && coc.madness.boutRoundsDie === "1D10"
  && coc.madness.autoExpiry === false
  && JSON.stringify(coc.madness.traitBouts) === JSON.stringify(["phobia", "mania"])
  && brp.madness.manifestationDie === "1D6" && brp.madness.durationDie === "1D8"
  && brp.madness.boutTable === null && brp.madness.autoExpiry === true,
  { coc: { die: coc.madness.manifestationDie, entries: coc.madness.boutTable.length },
    brp: { die: brp.madness.manifestationDie, entries: brp.madness.boutTable } });

check("cocM4IntegrationUsesRealRollAndNoSecondRestPath", (() => {
  const files = [
    "module/apps/sanity.mjs", "module/apps/worldTime.mjs", "module/apps/luck.mjs",
    "module/apps/charDev.mjs", "module/apps/check.mjs",
  ];
  const text = files.map((file) => readFileSync(join(ROOT, file), "utf8")).join("\n");
  const sanity = readFileSync(join(ROOT, "module/apps/sanity.mjs"), "utf8");
  const settingsSource = readFileSync(join(ROOT, "module/settings/register-settings.mjs"), "utf8");
  return !/Math\.random/.test(text)
    && !/fetch\(|XMLHttpRequest|\/api\/collections/.test(text)
    && /new Roll\(/.test(sanity)
    && /new Roll\(/.test(readFileSync(join(ROOT, "module/apps/charDev.mjs"), "utf8"))
    && /game\.socket\.emit\('system\.brp'/.test(sanity)
    && /game\.settings\.register\('brp', "worldTime"/.test(settingsSource)
    && /scope: "world"/.test(settingsSource);
})(), null);

check("cocM4I18nAndTemplateFacts", (() => {
  const en = readJson("lang/en.json");
  const zh = readJson("lang/zh-CN.json");
  const ids = coc.madness.boutTable.map((entry) => entry.id);
  const enBouts = en.BRP?.coc?.madness?.bouts ?? {};
  const zhBouts = zh.BRP?.coc?.madness?.bouts ?? {};
  const enDesc = en.BRP?.coc?.madness?.boutsDesc ?? {};
  const zhDesc = zh.BRP?.coc?.madness?.boutsDesc ?? {};
  const template = readJson("template.json");
  const san = template.Actor?.templates?.base?.sanity ?? null;
  return ids.every((id) => typeof enBouts[id] === "string" && typeof zhBouts[id] === "string"
      && typeof enDesc[id] === "string" && typeof zhDesc[id] === "string")
    && new Set(ids.map((id) => zhBouts[id])).size === ids.length
    && en.BRP?.madness?.indefiniteInsane && zh.BRP?.madness?.indefiniteInsane
    && typeof en.BRP?.coc?.madness?.durationHours === "string"
    && san && san.singleLoss === 0 && san.dayId === null && san.dayStartSan === null
    && san.insanity && san.insanity.permanent === false;
})(), { ids: coc.madness.boutTable.map((entry) => entry.id) });

const skillDoc = (key) => docsByKey.get(key);
const skillStats = { dex: { base: 55, redist: 0, culture: 0 }, edu: { base: 60, redist: 0, culture: 0 } };
check("cocSkillFormulaRoundsDown", coc.skillBase({ item: skillDoc("dodge"), stats: skillStats, useEDU: true }) === 27
  && brp.skillBase({ item: skillDoc("dodge"), stats: skillStats, useEDU: true }) === 28
  && coc.skillBase({ item: skillDoc("language-own"), stats: skillStats, useEDU: true }) === 60,
  {
    cocDodge: coc.skillBase({ item: skillDoc("dodge"), stats: skillStats, useEDU: true }),
    brpDodge: brp.skillBase({ item: skillDoc("dodge"), stats: skillStats, useEDU: true }),
    own: coc.skillBase({ item: skillDoc("language-own"), stats: skillStats, useEDU: true }),
  });
check("cocAppMapsToNativeCha", coc.characteristics.key("app") === "cha"
  && coc.characteristics.key("cha") === "cha"
  && brp.characteristics.key("app") === "app",
  { coc: coc.characteristics.key("app"), brp: brp.characteristics.key("app") });
check("starterIsolationContract", coc.starter.source === "coc" && coc.starter.categories === false
  && coc.starter.brawlBrpid === "i.skill.coc.fighting-brawl"
  && brp.starter.source === "octopus" && brp.starter.categories === true
  && brp.starter.brawlBrpid === "i.skill.brawl"
  && Rules.contentSourceOf({ flags: { brp: { contentSource: "coc" } } }) === "coc"
  && Rules.contentSourceOf({ flags: { brp: { brpidFlag: { id: "i.skill.brawl" } } } }) === "octopus",
  { coc: coc.starter, brp: brp.starter });
check("specialismIndependentGrowthContract", (() => {
  const handgun = skillDoc("firearms-handgun");
  const rifle = skillDoc("firearms-rifle-shotgun");
  return handgun.flags.brp.brpidFlag.id !== rifle.flags.brp.brpidFlag.id
    && handgun.flags.brp.coc.specKey !== rifle.flags.brp.coc.specKey
    && coc.growth.check({ roll: handgun.system.base + 1, targetScore: handgun.system.base })
    && !coc.growth.check({ roll: rifle.system.base, targetScore: rifle.system.base });
})());

// --- 4) M2 occupations: data, pack, and creation rules ---
const professionFacts = readJson("content/coc/professions.json");
const profDocs = readJson("packs-json/coc-professions.json");
const profIndex = readJson("packs-index/coc-professions.json");
const expandProfDocs = readExpand("packs-json/arcane-investigator-professions.json");
const expandProfIndex = readExpand("packs-index/arcane-investigator-professions.json");
const allProfDocs = [...profDocs, ...expandProfDocs];
// Every record is resolvable by slug regardless of which pack it ships in;
// creation helpers below take the merged list, never only the core one.
const profBySlug = new Map(allProfDocs.map((doc) => [doc.flags.brp.coc.slug, doc]));
const proSlugsByPack = (pack) => professionFacts.professions
  .filter((entry) => entry.pack === pack).map((entry) => entry.slug);
const CORE_PROFESSION_COUNT = 9;
const EXPAND_PROFESSION_COUNT = 148;

const LEGACY_PROFESSION_COUNT = 38;
const CUSTOM_PROFESSION_COUNT = 1;
const sealdiceProfessionDocs = allProfDocs.filter((doc) => String(doc.flags.brp.coc.factId).startsWith("sealdice.occupation.")).length;
const sealdiceProfessionFacts = professionFacts.professions.filter((entry) => String(entry.factId).startsWith("sealdice.occupation.")).length;
// 38 transcribed occupations + 118 SealDice imports + 1 product-defined template.
const expectedProfessionCount = LEGACY_PROFESSION_COUNT + sealdiceProfessionDocs + CUSTOM_PROFESSION_COUNT;
check("professionFactCount", professionFacts.professions.length === expectedProfessionCount
  && allProfDocs.length === expectedProfessionCount
  && sealdiceProfessionFacts === sealdiceProfessionDocs
  && sealdiceProfessionDocs === provenance.occupations.deferredSummary?.imported
  && new Set(allProfDocs.map((doc) => doc._id)).size === expectedProfessionCount
  && allProfDocs.every((doc) => /^[A-Za-z0-9]{16}$/.test(doc._id)),
  { facts: professionFacts.professions.length, docs: allProfDocs.length,
    legacy: LEGACY_PROFESSION_COUNT, sealDice: sealdiceProfessionDocs, custom: CUSTOM_PROFESSION_COUNT });

check("professionSplitIsPartitionOfTheFactSource", (() => {
  const coreSlugs = proSlugsByPack("core");
  const expandSlugs = proSlugsByPack("expand");
  const bad = [];
  if (coreSlugs.length !== CORE_PROFESSION_COUNT) bad.push(`core ${coreSlugs.length}`);
  if (expandSlugs.length !== EXPAND_PROFESSION_COUNT) bad.push(`expand ${expandSlugs.length}`);
  if (profDocs.length !== CORE_PROFESSION_COUNT || profIndex.length !== CORE_PROFESSION_COUNT) bad.push("core pack size");
  if (expandProfDocs.length !== EXPAND_PROFESSION_COUNT || expandProfIndex.length !== EXPAND_PROFESSION_COUNT) bad.push("expand pack size");
  if (new Set(coreSlugs).size !== coreSlugs.length || new Set(expandSlugs).size !== expandSlugs.length) bad.push("slug in two packs");
  if (coreSlugs.some((slug) => expandSlugs.includes(slug))) bad.push("slug in both pack lists");
  if (JSON.stringify(profDocs.map((doc) => doc.flags.brp.coc.slug)) !== JSON.stringify(coreSlugs)) bad.push("core pack order differs from facts");
  const expandDocSlugs = expandProfDocs.map((doc) => doc.flags.brp.coc.slug);
  if (JSON.stringify([...expandDocSlugs].sort()) !== JSON.stringify([...expandSlugs].sort())) bad.push("expand pack slugs differ from facts");
  const expandProfIds = expandProfDocs.map((doc) => doc._id);
  if (JSON.stringify(expandProfIds) !== JSON.stringify([...expandProfIds].sort())) bad.push("expand pack is not _id sorted");
  if (profDocs.some((doc) => doc.flags.brp.coc.pack !== "core")) bad.push("core doc tagged expand");
  if (expandProfDocs.some((doc) => doc.flags.brp.coc.pack !== "expand")) bad.push("expand doc tagged core");
  // Legacy identities survive the move: slug, brpid and document id are the
  // same strings the merged pack used before the split.
  const badIdentities = [];
  for (const doc of expandProfDocs) {
    const coc = doc.flags.brp.coc;
    if (doc.flags.brp.brpidFlag.id !== `i.profession.coc.${coc.slug}`) badIdentities.push(`${coc.slug}: brpid`);
    if (doc._id !== cocDocId(`profession-i.profession.coc.${coc.slug}`)) badIdentities.push(`${coc.slug}: id`);
  }
  if (badIdentities.length) bad.push(...badIdentities);
  return bad.length ? bad : true;
})(), { core: profDocs.length, expand: expandProfDocs.length });

check("professionPackRegistration", (() => {
  const sys = readJson("system.json");
  const pack = sys.packs?.find((entry) => entry.name === "coc-professions");
  return pack?.path === "packs/coc-professions" && pack?.type === "Item" && pack?.system === "brp"
    && sys.packs.some((entry) => entry.name === "coc-skills")
    && sys.packs.some((entry) => entry.name === "octopus-skills")
    && sys.packs.some((entry) => entry.name === "octopus-professions");
})());

const ASCII_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const EXPECTED_OCCUPATIONS = {
  archaeologist: { formulas: ["EDU*4"], min: 10, max: 40, sources: ["coc-roll20-occupations"] },
  author: { formulas: ["EDU*4"], min: 9, max: 30, sources: ["coc-roll20-occupations"] },
  "cat-burglar": { formulas: ["EDU*2+DEX*2"], min: 5, max: 40, sources: ["coc-roll20-occupations"] },
  dilettante: { formulas: ["EDU*2+APP*2"], min: 50, max: 99, sources: ["coc-roll20-occupations"] },
  explorer: {
    formulas: ["EDU*2+APP*2", "EDU*2+DEX*2", "EDU*2+STR*2"], min: 55, max: 80,
    sources: ["coc-roll20-occupations"], noMax: true,
  },
  "investigative-journalist": { formulas: ["EDU*4"], min: 9, max: 30, sources: ["coc-roll20-occupations"] },
  nurse: { formulas: ["EDU*4"], min: 9, max: 30, sources: ["coc-roll20-occupations"] },
  "private-investigator": {
    formulas: ["EDU*2+STR*2", "EDU*2+DEX*2"], min: 9, max: 30,
    sources: ["coc-roll20-occupations"], noMax: true,
  },
  professor: { formulas: ["EDU*4"], min: 20, max: 70, sources: ["coc-roll20-occupations"] },
  soldier: {
    formulas: ["EDU*2+STR*2", "EDU*2+DEX*2"], min: 9, max: 30,
    sources: ["coc-roll20-occupations"], noMax: true,
  },
  // M3 second batch. Doctor of Medicine and Police Detective have a licensed
  // compendium page plus the public wiki; the other three rest on a three-way
  // secondary cross-check and never claim an official source.
  "doctor-of-medicine": {
    formulas: ["EDU*4"], min: 30, max: 80,
    sources: ["coc-roll20-occupations", "coc-wiki-skills"],
    crossChecked: ["coc-rpgstack-occupations"],
  },
  "police-detective": {
    formulas: ["EDU*2+DEX*2", "EDU*2+STR*2"], min: 20, max: 50,
    sources: ["coc-roll20-occupations", "coc-wiki-skills"],
    crossChecked: ["coc-rpgstack-occupations"],
  },
  librarian: {
    formulas: ["EDU*4"], min: 9, max: 35,
    sources: ["coc-gamersplane-occupations", "coc-org-uk-occupations", "coc-rpgstack-occupations"],
  },
  lawyer: {
    formulas: ["EDU*4"], min: 30, max: 80,
    sources: ["coc-gamersplane-occupations", "coc-org-uk-occupations", "coc-rpgstack-occupations"],
  },
  engineer: {
    formulas: ["EDU*4"], min: 30, max: 60,
    sources: ["coc-gamersplane-occupations", "coc-org-uk-occupations", "coc-rpgstack-occupations"],
  },
  // M6 third batch, re-sourced to coc-cardwright in M7: a single user repository
  // now backs formula, credit range and the complete skill list.
  "police-officer": {
    formulas: ["EDU*2+DEX*2", "EDU*2+STR*2"], min: 9, max: 30,
    sources: ["coc-cardwright"], onlySource: "coc-cardwright",
  },
  artist: {
    formulas: ["EDU*2+POW*2", "EDU*2+DEX*2"], min: 9, max: 50,
    sources: ["coc-cardwright"], onlySource: "coc-cardwright",
  },
  clergy: {
    formulas: ["EDU*4"], min: 9, max: 60,
    sources: ["coc-cardwright"], onlySource: "coc-cardwright",
  },
  pilot: {
    formulas: ["EDU*2+DEX*2"], min: 20, max: 70,
    sources: ["coc-cardwright"], onlySource: "coc-cardwright",
  },
  // M7 fourth batch: 19 occupations mapped one-to-one from coc-cardwright's
  // jobs.py. Formula order follows the printed source; every record has exactly
  // eight fixed+choice slots.
  psychiatrist: { formulas: ["EDU*4"], min: 30, max: 80, sources: ["coc-cardwright"], onlySource: "coc-cardwright" },
  "museum-curator": { formulas: ["EDU*4"], min: 10, max: 30, sources: ["coc-cardwright"], onlySource: "coc-cardwright" },
  coroner: { formulas: ["EDU*4"], min: 40, max: 60, sources: ["coc-cardwright"], onlySource: "coc-cardwright" },
  judge: { formulas: ["EDU*4"], min: 50, max: 80, sources: ["coc-cardwright"], onlySource: "coc-cardwright" },
  bookseller: { formulas: ["EDU*4"], min: 20, max: 40, sources: ["coc-cardwright"], onlySource: "coc-cardwright" },
  antiquarian: { formulas: ["EDU*4"], min: 30, max: 50, sources: ["coc-cardwright"], onlySource: "coc-cardwright" },
  intermediary: {
    formulas: ["EDU*2+STR*2", "EDU*2+DEX*2"], min: 20, max: 45,
    sources: ["coc-cardwright"], onlySource: "coc-cardwright", noMax: true,
  },
  orderly: { formulas: ["EDU*2+STR*2"], min: 6, max: 15, sources: ["coc-cardwright"], onlySource: "coc-cardwright" },
  "government-official": { formulas: ["EDU*2+APP*2"], min: 50, max: 90, sources: ["coc-cardwright"], onlySource: "coc-cardwright" },
  traveler: {
    formulas: ["EDU*2+STR*2", "EDU*2+DEX*2"], min: 5, max: 20,
    sources: ["coc-cardwright"], onlySource: "coc-cardwright", noMax: true,
  },
  firefighter: {
    formulas: ["EDU*2+STR*2", "EDU*2+DEX*2"], min: 9, max: 30,
    sources: ["coc-cardwright"], onlySource: "coc-cardwright", noMax: true,
  },
  fisherman: { formulas: ["EDU*4"], min: 20, max: 40, sources: ["coc-cardwright"], onlySource: "coc-cardwright" },
  hunter: {
    formulas: ["EDU*2+STR*2", "EDU*2+DEX*2"], min: 20, max: 50,
    sources: ["coc-cardwright"], onlySource: "coc-cardwright", noMax: true,
  },
  pharmacist: { formulas: ["EDU*4"], min: 35, max: 75, sources: ["coc-cardwright"], onlySource: "coc-cardwright" },
  gambler: {
    formulas: ["EDU*2+DEX*2", "EDU*2+APP*2"], min: 8, max: 50,
    sources: ["coc-cardwright"], onlySource: "coc-cardwright", noMax: true,
  },
  "tribe-member": {
    formulas: ["EDU*2+STR*2", "EDU*2+DEX*2"], min: 0, max: 15,
    sources: ["coc-cardwright"], onlySource: "coc-cardwright", noMax: true,
  },
  spy: {
    formulas: ["EDU*2+DEX*2", "EDU*2+APP*2"], min: 20, max: 60,
    sources: ["coc-cardwright"], onlySource: "coc-cardwright", noMax: true,
  },
  "gang-leader": { formulas: ["EDU*2+APP*2"], min: 60, max: 95, sources: ["coc-cardwright"], onlySource: "coc-cardwright" },
  "asylum-orderly": {
    formulas: ["EDU*2+STR*2", "EDU*2+DEX*2"], min: 8, max: 20,
    sources: ["coc-cardwright"], onlySource: "coc-cardwright", noMax: true,
  },
};

check("professionFormulasAndCreditRangesMatchSources", (() => {
  const mismatched = [];
  for (const [slug, expected] of Object.entries(EXPECTED_OCCUPATIONS)) {
    const doc = profBySlug.get(slug);
    const coc = doc?.flags?.brp?.coc;
    if (!doc || !coc) { mismatched.push(`${slug}: missing`); continue; }
    const formulas = coc.pointFormulas ?? [coc.pointFormula];
    if (formulas.length !== expected.formulas.length
      || formulas.some((formula, index) => formula !== expected.formulas[index])) {
      mismatched.push(`${slug}: formulas ${JSON.stringify(formulas)} != ${JSON.stringify(expected.formulas)}`);
    }
    // The single-formula spelling stays in step with the list: first option.
    if (coc.pointFormula !== expected.formulas[0]) mismatched.push(`${slug}: pointFormula ${coc.pointFormula}`);
    if (coc.pointFormulas !== undefined && formulas.length < 2) mismatched.push(`${slug}: pointFormulas with one entry`);
    if (coc.creditMin !== expected.min || coc.creditMax !== expected.max) {
      mismatched.push(`${slug}: credit ${coc.creditMin}-${coc.creditMax}`);
    }
    if (doc.flags.brp.contentSource !== "coc") mismatched.push(`${slug}: contentSource ${doc.flags.brp.contentSource}`);
    if (coc.evidence !== "secondary") mismatched.push(`${slug}: evidence ${coc.evidence}`);
    for (const source of expected.sources) {
      if (!(coc.sourceRefs ?? []).includes(source)) mismatched.push(`${slug}: missing sourceRefs ${source}`);
    }
    for (const source of expected.crossChecked ?? []) {
      const record = provenance.occupations.perRecord?.[`coc7.occupation.${slug}`];
      if (!(record?.crossCheckedWith ?? []).includes(source)) mismatched.push(`${slug}: missing cross-check ${source}`);
    }
    for (const source of expected.absentSources ?? []) {
      if ((coc.sourceRefs ?? []).includes(source)) mismatched.push(`${slug}: must not cite ${source}`);
    }
    if (expected.noMax && formulas.some((formula) => formula.includes("MAX"))) {
      mismatched.push(`${slug}: still uses a MAX formula`);
    }
    if (expected.onlySource && JSON.stringify(coc.sourceRefs ?? []) !== JSON.stringify([expected.onlySource])) {
      mismatched.push(`${slug}: cites ${JSON.stringify(coc.sourceRefs)} instead of only ${expected.onlySource}`);
    }
    if (doc.name !== professionFacts.professions.find((entry) => entry.slug === slug)?.name) mismatched.push(`${slug}: name`);
  }
  return mismatched.length === 0 ? true : mismatched;
})());

check("noShippedProfessionUsesMaxFormula", (() => {
  const bad = [];
  for (const doc of allProfDocs) {
    const coc = doc.flags.brp.coc;
    const formulas = coc.pointFormulas ?? [coc.pointFormula];
    if (formulas.some((formula) => String(formula).includes("MAX"))) bad.push(coc.slug);
  }
  return bad.length ? bad : true;
})(), allProfDocs.filter((doc) => (doc.flags.brp.coc.pointFormulas ?? [doc.flags.brp.coc.pointFormula])
  .some((formula) => String(formula).includes("MAX"))).map((doc) => doc.flags.brp.coc.slug));

check("legacyMaxProfessionsAreNowOrderedChoices", (() => {
  const wanted = {
    "private-investigator": ["EDU*2+STR*2", "EDU*2+DEX*2"],
    soldier: ["EDU*2+STR*2", "EDU*2+DEX*2"],
    explorer: ["EDU*2+APP*2", "EDU*2+DEX*2", "EDU*2+STR*2"],
  };
  const bad = [];
  for (const [slug, formulas] of Object.entries(wanted)) {
    const coc = profBySlug.get(slug)?.flags?.brp?.coc;
    if (!coc) { bad.push(`${slug}: missing`); continue; }
    if (JSON.stringify(coc.pointFormulas) !== JSON.stringify(formulas)) {
      bad.push(`${slug}: ${JSON.stringify(coc.pointFormulas)} != ${JSON.stringify(formulas)}`);
    }
    if (coc.pointFormula !== formulas[0]) bad.push(`${slug}: pointFormula ${coc.pointFormula}`);
    if (!(coc.choiceGroups ?? []).length) bad.push(`${slug}: lost its skill groups`);
    if (JSON.stringify(coc.sourceRefs) !== JSON.stringify(["coc-roll20-occupations"])) {
      bad.push(`${slug}: sources ${JSON.stringify(coc.sourceRefs)}`);
    }
  }
  return bad.length ? bad : true;
})(), ["private-investigator", "soldier", "explorer"]
  .map((slug) => [slug, profBySlug.get(slug)?.flags.brp.coc.pointFormulas]));

check("everyProfessionCarriesEightSlotsExceptSourceFaithfulAuthor", (() => {
  const bad = [];
  for (const doc of allProfDocs) {
    const coc = doc.flags.brp.coc;
    const total = (coc.fixedSkillKeys ?? []).length
      + (coc.choiceGroups ?? []).reduce((sum, group) => sum + group.choose, 0);
    if (coc.slug === "author") {
      // The printed Author list has seven items (Art/Craft, History, Other
      // Language, Own Language, Psychology, Library Use, Natural World or
      // Occult); adding an eighth slot would invent a fact.
      if (total !== 7) bad.push(`author: ${total}, source prints 7`);
    } else if (total !== 8) {
      bad.push(`${coc.slug}: ${total}`);
    }
  }
  return bad.length ? bad : true;
})(), allProfDocs.map((doc) => [doc.flags.brp.coc.slug,
  (doc.flags.brp.coc.fixedSkillKeys ?? []).length
  + (doc.flags.brp.coc.choiceGroups ?? []).reduce((sum, group) => sum + group.choose, 0)]));

check("professionIdentitiesAreUnique", (() => {
  const bad = [];
  for (const field of ["slug", "factId", "name"]) {
    const values = field === "name"
      ? allProfDocs.map((doc) => doc.name)
      : allProfDocs.map((doc) => doc.flags.brp.coc[field]);
    if (new Set(values).size !== values.length) bad.push(`${field} duplicated`);
  }
  const brpids = allProfDocs.map((doc) => doc.flags.brp.brpidFlag.id);
  if (new Set(brpids).size !== brpids.length) bad.push("brpid duplicated");
  const ids = allProfDocs.map((doc) => doc._id);
  if (new Set(ids).size !== ids.length) bad.push("_id duplicated");
  const factSlugs = professionFacts.professions.map((entry) => entry.slug);
  if (new Set(factSlugs).size !== factSlugs.length) bad.push("fact slug duplicated");
  if (professionFacts.professions.length !== allProfDocs.length) bad.push("fact/doc count mismatch");
  return bad.length ? bad : true;
})(), allProfDocs.length);

check("everyProfessionIsSecondaryEvidenceWithSources", allProfDocs.every((doc) => {
  const coc = doc.flags.brp.coc;
  // Published records are secondary evidence. The single product-defined
  // record declares itself as such and carries a boundary instead of a source.
  if (coc.evidence === "product") {
    return coc.slug === "custom-investigator"
      && typeof coc.productBoundary === "string" && coc.productBoundary.length > 0
      && Array.isArray(coc.sourceRefs) && coc.sourceRefs.length > 0
      && coc.sourceRefs.every((ref) => provenance.sources.some((source) => source.id === ref));
  }
  return coc.evidence === "secondary"
    && Array.isArray(coc.sourceRefs) && coc.sourceRefs.length > 0
    && coc.sourceRefs.every((ref) => provenance.sources.some((source) => source.id === ref));
}), allProfDocs.map((doc) => [doc.flags.brp.coc.slug, doc.flags.brp.coc.evidence, doc.flags.brp.coc.sourceRefs]));

check("onlyTheCustomTemplateIsProductDefined", (() => {
  const product = allProfDocs.filter((doc) => doc.flags.brp.coc.evidence === "product");
  const custom = profBySlug.get("custom-investigator");
  return product.length === 1
    && product[0].flags.brp.coc.slug === "custom-investigator"
    && custom.flags.brp.coc.pack === "core"
    && custom.flags.brp.coc.evidence === "product"
    && JSON.stringify(custom.flags.brp.coc.sourceRefs) === JSON.stringify(["coc-wiki-skills"])
    && !JSON.stringify(custom).includes("official")
    && !JSON.stringify(custom).includes("SRD");
})(), allProfDocs.filter((doc) => doc.flags.brp.coc.evidence === "product").map((doc) => doc.flags.brp.coc.slug));

check("m5ProfessionsCarryExactlyEightSkills", (() => {
  const expected = {
    "doctor-of-medicine": {
      fixed: ["first-aid", "language-other-latin", "medicine", "psychology", "science-biology", "science-pharmacy"],
      picks: [["any-specialty", 2]],
    },
    "police-detective": {
      fixed: ["law", "listen", "psychology", "spot-hidden"],
      picks: [["acting-or-disguise", 1], ["firearms", 1], ["interpersonal", 1], ["any-specialty", 1]],
    },
    librarian: {
      fixed: ["accounting", "library-use", "language-own"],
      picks: [["language-other", 1], ["any-specialty", 4]],
    },
    lawyer: {
      fixed: ["accounting", "law", "library-use", "psychology"],
      picks: [["interpersonal-two", 2], ["any-specialty", 2]],
    },
    engineer: {
      fixed: ["art-craft-technical-drawing", "electrical-repair", "library-use", "mechanical-repair",
        "operate-heavy-machinery", "science-engineering", "science-physics"],
      picks: [["any-specialty", 1]],
    },
    // M6 third batch.
    "police-officer": {
      fixed: ["fighting-brawl", "first-aid", "law", "psychology", "spot-hidden"],
      picks: [["firearms", 1], ["interpersonal", 1], ["drive-or-ride", 1]],
    },
    artist: {
      fixed: ["psychology", "spot-hidden"],
      picks: [["art-craft", 1], ["history-or-natural-world", 1], ["interpersonal", 1],
        ["language-other", 1], ["any-specialty", 2]],
    },
    clergy: {
      fixed: ["accounting", "history", "library-use", "listen", "psychology"],
      picks: [["language-other", 1], ["interpersonal", 1], ["any-specialty", 1]],
    },
    pilot: {
      fixed: ["electrical-repair", "mechanical-repair", "navigate", "operate-heavy-machinery",
        "pilot-aircraft", "science-astronomy"],
      picks: [["any-specialty", 2]],
    },
    // M7 fourth batch (coc-cardwright).
    psychiatrist: {
      fixed: ["listen", "medicine", "persuade", "psychoanalysis", "psychology",
        "science-biology", "science-chemistry"],
      picks: [["language-other", 1]],
    },
    "museum-curator": {
      fixed: ["accounting", "appraise", "archaeology", "history", "library-use", "occult", "spot-hidden"],
      picks: [["language-other", 1]],
    },
    coroner: {
      fixed: ["library-use", "medicine", "persuade", "science-biology", "science-forensics",
        "science-pharmacy", "spot-hidden"],
      picks: [["language-other", 1]],
    },
    judge: {
      fixed: ["history", "intimidate", "law", "library-use", "listen", "language-own",
        "persuade", "psychology"],
      picks: [],
    },
    bookseller: {
      fixed: ["accounting", "appraise", "drive-auto", "history", "library-use", "language-own"],
      picks: [["language-other", 1], ["interpersonal", 1]],
    },
    antiquarian: {
      fixed: ["accounting", "appraise", "drive-auto", "history", "library-use", "navigate"],
      picks: [["interpersonal", 1], ["interpersonal-two", 1]],
    },
    intermediary: {
      fixed: ["fighting-brawl", "law", "library-use", "psychology", "stealth", "track"],
      picks: [["firearms", 1], ["interpersonal", 1]],
    },
    orderly: {
      fixed: ["electrical-repair", "fighting-brawl", "first-aid", "listen", "mechanical-repair",
        "psychology", "stealth"],
      picks: [["interpersonal", 1]],
    },
    "government-official": {
      fixed: ["charm", "history", "intimidate", "fast-talk", "listen", "language-own",
        "persuade", "psychology"],
      picks: [],
    },
    traveler: {
      fixed: ["first-aid", "listen", "natural-world", "navigate", "spot-hidden", "track"],
      picks: [["firearms", 1], ["survival", 1]],
    },
    firefighter: {
      fixed: ["climb", "dodge", "drive-auto", "first-aid", "jump", "mechanical-repair",
        "operate-heavy-machinery", "throw"],
      picks: [],
    },
    fisherman: {
      fixed: ["first-aid", "mechanical-repair", "natural-world", "navigate", "pilot-boat",
        "spot-hidden", "swim"],
      picks: [["interpersonal", 1]],
    },
    hunter: {
      fixed: ["natural-world", "navigate", "science-zoology", "stealth", "track"],
      picks: [["firearms", 1], ["listen-or-spot-hidden", 1], ["language-or-survival", 1]],
    },
    pharmacist: {
      fixed: ["accounting", "first-aid", "language-other-latin", "library-use", "psychology",
        "science-chemistry", "science-pharmacy"],
      picks: [["interpersonal", 1]],
    },
    gambler: {
      fixed: ["accounting", "art-craft-acting", "listen", "psychology", "sleight-of-hand", "spot-hidden"],
      picks: [["interpersonal", 1], ["interpersonal-two", 1]],
    },
    "tribe-member": {
      fixed: ["climb", "listen", "natural-world", "occult", "spot-hidden", "swim"],
      picks: [["survival", 1], ["fighting-or-throw", 1]],
    },
    spy: {
      fixed: ["listen", "psychology", "sleight-of-hand", "stealth"],
      picks: [["firearms", 1], ["language-other", 1], ["acting-or-disguise", 1], ["interpersonal", 1]],
    },
    "gang-leader": {
      fixed: ["law", "listen", "psychology", "spot-hidden"],
      picks: [["fighting", 1], ["firearms", 1], ["interpersonal", 1], ["interpersonal-two", 1]],
    },
    "asylum-orderly": {
      fixed: ["dodge", "fighting-brawl", "first-aid", "listen", "psychology", "stealth"],
      picks: [["interpersonal", 1], ["interpersonal-two", 1]],
    },
  };
  const bad = [];
  for (const [slug, want] of Object.entries(expected)) {
    const coc = profBySlug.get(slug)?.flags?.brp?.coc;
    if (!coc) { bad.push(`${slug}: missing`); continue; }
    const fixed = coc.fixedSkillKeys ?? [];
    if (JSON.stringify(fixed) !== JSON.stringify(want.fixed)) bad.push(`${slug}: fixed ${JSON.stringify(fixed)}`);
    const groups = coc.choiceGroups ?? [];
    const shape = groups.map((group) => [group.key, group.choose]);
    if (JSON.stringify(shape) !== JSON.stringify(want.picks)) bad.push(`${slug}: picks ${JSON.stringify(shape)}`);
    const total = fixed.length + groups.reduce((sum, group) => sum + group.choose, 0);
    if (total !== 8) bad.push(`${slug}: ${total} skills, not 8`);
  }
  return bad.length ? bad : true;
})(), allProfDocs.filter((doc) => ["doctor-of-medicine", "police-detective", "librarian", "lawyer", "engineer",
  "police-officer", "artist", "clergy", "pilot",
  "psychiatrist", "museum-curator", "coroner", "judge", "bookseller", "antiquarian", "intermediary",
  "orderly", "government-official", "traveler", "firefighter", "fisherman", "hunter", "pharmacist",
  "gambler", "tribe-member", "spy", "gang-leader", "asylum-orderly"]
  .includes(doc.flags.brp.coc.slug))
  .map((doc) => [doc.flags.brp.coc.slug, (doc.flags.brp.coc.fixedSkillKeys ?? []).length
    + (doc.flags.brp.coc.choiceGroups ?? []).reduce((sum, group) => sum + group.choose, 0)]));

check("policeDetectiveEitherOrFormulaIsNotMaxed", (() => {
  const coc = profBySlug.get("police-detective")?.flags?.brp?.coc;
  const formulas = coc?.pointFormulas ?? [];
  return formulas.length === 2
    && formulas[0] === "EDU*2+DEX*2" && formulas[1] === "EDU*2+STR*2"
    && !formulas.some((formula) => formula.includes("MAX"))
    && coc.pointFormula === "EDU*2+DEX*2";
})(), profBySlug.get("police-detective")?.flags?.brp?.coc);

check("policeDetectiveIsNotPrivateInvestigator", (() => {
  const detective = profBySlug.get("police-detective");
  const pi = profBySlug.get("private-investigator");
  if (!detective || !pi) return false;
  const d = detective.flags.brp.coc;
  const p = pi.flags.brp.coc;
  const dKeys = new Set(d.fixedSkillKeys);
  const pKeys = new Set(p.fixedSkillKeys);
  const overlap = [...dKeys].filter((key) => pKeys.has(key));
  return detective._id !== pi._id
    && detective.flags.brp.brpidFlag.id !== pi.flags.brp.brpidFlag.id
    && (d.creditMin !== p.creditMin || d.creditMax !== p.creditMax)
    && JSON.stringify(d.pointFormulas) !== JSON.stringify([p.pointFormula])
    && dKeys.has("listen") && !pKeys.has("listen")
    && pKeys.has("disguise") && pKeys.has("library-use") && pKeys.has("art-craft-photography")
    && !dKeys.has("library-use") && !dKeys.has("art-craft-photography")
    && overlap.length < dKeys.size
    && !JSON.stringify(detective).includes(pi.flags.brp.brpidFlag.id);
})(), {
  detective: profBySlug.get("police-detective")?.flags.brp.coc.fixedSkillKeys,
  pi: profBySlug.get("private-investigator")?.flags.brp.coc.fixedSkillKeys,
});

check("lawyerInterpersonalGroupRequiresTwoDistinctSkills", (() => {
  const coc = profBySlug.get("lawyer")?.flags.brp?.coc;
  const group = (coc?.choiceGroups ?? []).find((entry) => entry.key === "interpersonal-two");
  if (!group) return false;
  const skills = group.options.filter((option) => option.kind === "skill").map((option) => option.skill);
  return group.choose === 2
    && group.distinct === true
    && skills.length === 4
    && new Set(skills).size === 4
    && ["charm", "fast-talk", "intimidate", "persuade"].every((key) => skills.includes(key));
})(), profBySlug.get("lawyer")?.flags.brp.coc.choiceGroups);

// M6 third batch: distinct records, printed formula order and exact slots.
check("scienceAstronomyIsPublishedInScienceFamily", (() => {
  const doc = docsByKey.get("science-astronomy");
  const family = professionFacts.skillFamilies?.science;
  if (!doc || !family) return false;
  return doc.system.base === 1 && doc.system.variable === false
    && doc.system.specialism === true && doc.system.mainName === "科学"
    && doc.flags.brp.coc.specKey === "astronomy"
    && doc.flags.brp.brpidFlag.id === "i.skill.coc.science-astronomy"
    && family.base === 1 && family.concrete.includes("science-astronomy")
    && (doc.flags.brp.coc.sourceRefs ?? []).length > 0
    && profBySlug.get("pilot").flags.brp.coc.fixedSkillKeys.includes("science-astronomy");
})(), { doc: docsByKey.get("science-astronomy")?.system, family: professionFacts.skillFamilies?.science });

check("policeOfficerIsNotPoliceDetective", (() => {
  const officer = profBySlug.get("police-officer");
  const detective = profBySlug.get("police-detective");
  if (!officer || !detective) return false;
  const o = officer.flags.brp.coc;
  const d = detective.flags.brp.coc;
  const oKeys = new Set(o.fixedSkillKeys);
  const dKeys = new Set(d.fixedSkillKeys);
  return officer._id !== detective._id
    && officer.flags.brp.brpidFlag.id !== detective.flags.brp.brpidFlag.id
    && o.creditMin === 9 && o.creditMax === 30
    && d.creditMin === 20 && d.creditMax === 50
    && JSON.stringify(o.pointFormulas) === JSON.stringify(d.pointFormulas)
    && oKeys.has("fighting-brawl") && oKeys.has("first-aid") && oKeys.has("spot-hidden")
    && !oKeys.has("listen") && dKeys.has("listen")
    && !dKeys.has("fighting-brawl") && !dKeys.has("first-aid")
    && (o.choiceGroups ?? []).some((group) => group.key === "drive-or-ride")
    && (d.choiceGroups ?? []).some((group) => group.key === "acting-or-disguise")
    && !JSON.stringify(officer).includes(detective.flags.brp.brpidFlag.id);
})(), {
  officer: profBySlug.get("police-officer")?.flags.brp.coc.fixedSkillKeys,
  detective: profBySlug.get("police-detective")?.flags.brp.coc.fixedSkillKeys,
});

check("artistUsesPowFormulaNotAppOrMax", (() => {
  const coc = profBySlug.get("artist")?.flags?.brp?.coc;
  const formulas = coc?.pointFormulas ?? [];
  const interpersonal = (coc?.choiceGroups ?? []).find((group) => group.key === "interpersonal");
  const options = (interpersonal?.options ?? []).filter((option) => option.kind === "skill")
    .map((option) => option.skill);
  return formulas.length === 2
    && formulas[0] === "EDU*2+POW*2" && formulas[1] === "EDU*2+DEX*2"
    && coc.pointFormula === "EDU*2+POW*2"
    && !formulas.some((formula) => formula.includes("APP") || formula.includes("MAX"))
    && !(coc.fixedSkillKeys ?? []).includes("persuade")
    && interpersonal?.choose === 1
    && options.length === 4 && new Set(options).size === 4
    && ["charm", "fast-talk", "intimidate", "persuade"].every((key) => options.includes(key));
})(), {
  formulas: profBySlug.get("artist")?.flags.brp.coc.pointFormulas,
  fixed: profBySlug.get("artist")?.flags.brp.coc.fixedSkillKeys,
  interpersonal: profBySlug.get("artist")?.flags.brp.coc.choiceGroups
    ?.find((group) => group.key === "interpersonal")?.options,
});

check("pilotFixesAircraftAndAstronomyNotBoat", (() => {
  const coc = profBySlug.get("pilot")?.flags?.brp?.coc;
  const fixed = coc?.fixedSkillKeys ?? [];
  return coc?.pointFormula === "EDU*2+DEX*2"
    && coc.pointFormulas === undefined
    && coc.creditMin === 20 && coc.creditMax === 70
    && fixed.includes("pilot-aircraft") && fixed.includes("science-astronomy")
    && !fixed.includes("pilot-boat")
    && !(coc.sourceRefs ?? []).includes("coc-rpgstack-occupations")
    && (coc.choiceGroups ?? []).length === 1
    && coc.choiceGroups[0].key === "any-specialty" && coc.choiceGroups[0].choose === 2;
})(), { fixed: profBySlug.get("pilot")?.flags.brp.coc.fixedSkillKeys,
  refs: profBySlug.get("pilot")?.flags.brp.coc.sourceRefs });

// Provenance: every second-batch fact is registered, every grade is secondary,
// and nothing claims an official first-party source.
const M5_PROVENANCE = {
  "coc7.occupation.doctor-of-medicine": { sources: ["coc-roll20-occupations", "coc-wiki-skills"], strict: true },
  "coc7.occupation.police-detective": {
    sources: ["coc-roll20-occupations", "coc-wiki-skills"], strict: true,
    formulas: ["EDU*2+DEX*2", "EDU*2+STR*2"],
  },
  "coc7.occupation.librarian": {
    sources: ["coc-gamersplane-occupations", "coc-org-uk-occupations", "coc-rpgstack-occupations"], strict: false,
  },
  "coc7.occupation.lawyer": {
    sources: ["coc-gamersplane-occupations", "coc-org-uk-occupations", "coc-rpgstack-occupations"], strict: false,
  },
  "coc7.occupation.engineer": {
    sources: ["coc-gamersplane-occupations", "coc-org-uk-occupations", "coc-rpgstack-occupations"], strict: false,
  },
};

// M7 fourth batch: coc-cardwright is the only cited source. The four M6
// records were re-sourced into this batch, so their old public-page citations
// must be gone rather than kept alongside.
const M7_PROVENANCE = {
  "coc7.occupation.police-officer": { sources: ["coc-cardwright"], formulas: ["EDU*2+DEX*2", "EDU*2+STR*2"] },
  "coc7.occupation.artist": { sources: ["coc-cardwright"], formulas: ["EDU*2+POW*2", "EDU*2+DEX*2"] },
  "coc7.occupation.clergy": { sources: ["coc-cardwright"], formulas: ["EDU*4"] },
  "coc7.occupation.pilot": { sources: ["coc-cardwright"], formulas: ["EDU*2+DEX*2"] },
  "coc7.occupation.psychiatrist": { sources: ["coc-cardwright"], formulas: ["EDU*4"] },
  "coc7.occupation.museum-curator": { sources: ["coc-cardwright"], formulas: ["EDU*4"] },
  "coc7.occupation.coroner": { sources: ["coc-cardwright"], formulas: ["EDU*4"] },
  "coc7.occupation.judge": { sources: ["coc-cardwright"], formulas: ["EDU*4"] },
  "coc7.occupation.bookseller": { sources: ["coc-cardwright"], formulas: ["EDU*4"] },
  "coc7.occupation.antiquarian": { sources: ["coc-cardwright"], formulas: ["EDU*4"] },
  "coc7.occupation.intermediary": { sources: ["coc-cardwright"], formulas: ["EDU*2+STR*2", "EDU*2+DEX*2"] },
  "coc7.occupation.orderly": { sources: ["coc-cardwright"], formulas: ["EDU*2+STR*2"] },
  "coc7.occupation.government-official": { sources: ["coc-cardwright"], formulas: ["EDU*2+APP*2"] },
  "coc7.occupation.traveler": { sources: ["coc-cardwright"], formulas: ["EDU*2+STR*2", "EDU*2+DEX*2"] },
  "coc7.occupation.firefighter": { sources: ["coc-cardwright"], formulas: ["EDU*2+STR*2", "EDU*2+DEX*2"] },
  "coc7.occupation.fisherman": { sources: ["coc-cardwright"], formulas: ["EDU*4"] },
  "coc7.occupation.hunter": { sources: ["coc-cardwright"], formulas: ["EDU*2+STR*2", "EDU*2+DEX*2"] },
  "coc7.occupation.pharmacist": { sources: ["coc-cardwright"], formulas: ["EDU*4"] },
  "coc7.occupation.gambler": { sources: ["coc-cardwright"], formulas: ["EDU*2+DEX*2", "EDU*2+APP*2"] },
  "coc7.occupation.tribe-member": { sources: ["coc-cardwright"], formulas: ["EDU*2+STR*2", "EDU*2+DEX*2"] },
  "coc7.occupation.spy": { sources: ["coc-cardwright"], formulas: ["EDU*2+DEX*2", "EDU*2+APP*2"] },
  "coc7.occupation.gang-leader": { sources: ["coc-cardwright"], formulas: ["EDU*2+APP*2"] },
  "coc7.occupation.asylum-orderly": { sources: ["coc-cardwright"], formulas: ["EDU*2+STR*2", "EDU*2+DEX*2"] },
};

const PROVENANCE_RECORDS = { ...M5_PROVENANCE, ...M7_PROVENANCE };

check("m5ProvenanceRegistersEveryRecordAsSecondary", (() => {
  const bad = [];
  for (const [factId, want] of Object.entries(PROVENANCE_RECORDS)) {
    const record = provenance.occupations.perRecord[factId];
    if (!record) { bad.push(`${factId}: unregistered`); continue; }
    if (record.evidence !== "secondary") bad.push(`${factId}: evidence ${record.evidence}`);
    const refs = record.sourceRefs ?? [];
    for (const source of want.sources) {
      if (!refs.includes(source)) bad.push(`${factId}: missing ${source}`);
    }
    // A record with no licensed compendium page must say so.
    if ((want.strict === false || want.sources.includes("coc-cardwright")) && !record.claimBoundary) {
      bad.push(`${factId}: no claimBoundary`);
    }
    if (want.formulas && JSON.stringify(record.formulas) !== JSON.stringify(want.formulas)) {
      bad.push(`${factId}: formulas ${JSON.stringify(record.formulas)}`);
    }
    if (record.formula !== (record.formulas ?? [])[0] && record.formulas) {
      bad.push(`${factId}: formula/list mismatch`);
    }
    for (const source of want.absentSources ?? []) {
      if (refs.includes(source)) bad.push(`${factId}: must not cite ${source}`);
    }
  }
  return bad.length ? bad : true;
})(), Object.keys(provenance.occupations.perRecord ?? {}));

check("m5ProvenanceNeverClaimsOfficialFirstParty", (() => {
  const forbidden = ["official", "first-party", "primary", "chaosium-confirmed", "verified-official"];
  const bad = [];
  for (const [factId] of Object.entries(PROVENANCE_RECORDS)) {
    const record = provenance.occupations.perRecord[factId];
    const grade = String(record?.evidence ?? "");
    if (forbidden.some((word) => grade.toLowerCase().includes(word))) bad.push(`${factId}: ${grade}`);
    // Only the two compendium-backed records may cite the official wiki.
    const citesWiki = (record?.sourceRefs ?? []).some((ref) => ref.startsWith("coc-wiki"));
    const want = PROVENANCE_RECORDS[factId];
    if (citesWiki && want.strict !== true) bad.push(`${factId}: unauthorised wiki citation`);
  }
  const datasetStatus = String(provenance.occupations.status ?? "");
  if (!datasetStatus.includes("secondary")) bad.push(`occupations.status ${datasetStatus}`);
  return bad.length ? bad : true;
})(), provenance.occupations.status);

check("m5ProvenanceSourcesResolveToRegisteredUrls", (() => {
  const ids = new Set(provenance.sources.map((source) => source.id));
  const bad = [];
  for (const [factId, want] of Object.entries(PROVENANCE_RECORDS)) {
    for (const ref of [...want.sources, ...(want.skillShapeSources ?? [])]) {
      if (!ids.has(ref)) bad.push(`${factId}: ${ref} not registered`);
    }
  }
  for (const id of ["coc-gamersplane-occupations", "coc-org-uk-occupations", "coc-org-uk-chargen", "coc-rpgstack-occupations", "coc-cardwright"]) {
    const source = provenance.sources.find((entry) => entry.id === id);
    if (!source) { bad.push(`${id}: missing`); continue; }
    if (!source.url.startsWith("https://")) bad.push(`${id}: url ${source.url}`);
    if (source.evidence !== "secondary") bad.push(`${id}: evidence ${source.evidence}`);
    if (!source.note) bad.push(`${id}: no note`);
  }
  return bad.length ? bad : true;
})(), provenance.sources.filter((source) => source.id.includes("occupations") || source.id === "coc-org-uk-chargen" || source.id === "coc-cardwright").map((source) => source.id));

check("m7CardwrightIsTheOnlySourceAndNoPublicTableIsSpliced", (() => {
  const bad = [];
  const publicPageSources = ["coc-roll20-occupations", "coc-wiki-skills", "coc-gamersplane-occupations",
    "coc-org-uk-occupations", "coc-org-uk-chargen", "coc-rpgstack-occupations"];
  for (const [factId] of Object.entries(M7_PROVENANCE)) {
    const record = provenance.occupations.perRecord[factId];
    if (JSON.stringify(record?.sourceRefs) !== JSON.stringify(["coc-cardwright"])) {
      bad.push(`${factId}: sourceRefs ${JSON.stringify(record?.sourceRefs)}`);
    }
    if ((record?.skillShapeSourceRefs ?? []).length) bad.push(`${factId}: stale skillShapeSourceRefs`);
    const slug = factId.replace("coc7.occupation.", "");
    const fact = professionFacts.professions.find((entry) => entry.slug === slug);
    if (JSON.stringify(fact?.sourceRefs) !== JSON.stringify(["coc-cardwright"])) {
      bad.push(`${slug}: fact sourceRefs ${JSON.stringify(fact?.sourceRefs)}`);
    }
    const doc = profBySlug.get(slug);
    if (JSON.stringify(doc?.flags?.brp?.coc?.sourceRefs) !== JSON.stringify(["coc-cardwright"])) {
      bad.push(`${slug}: pack sourceRefs ${JSON.stringify(doc?.flags?.brp?.coc?.sourceRefs)}`);
    }
    for (const source of publicPageSources) {
      if (JSON.stringify(doc ?? {}).includes(source)) bad.push(`${slug}: still cites ${source}`);
    }
  }
  const chargen = provenance.sources.find((entry) => entry.id === "coc-org-uk-chargen");
  if ((chargen?.usedFor ?? []).some((line) => /Police Officer|Artist|Clergy|Pilot/.test(line))) {
    bad.push("coc-org-uk-chargen still claims an M6 occupation");
  }
  const rpgstack = provenance.sources.find((entry) => entry.id === "coc-rpgstack-occupations");
  if (!/truncat/i.test(rpgstack?.note ?? "") || !/omits Pilot/i.test(rpgstack?.note ?? "")) {
    bad.push("RPG Stack truncation note missing");
  }
  return bad.length ? bad : true;
})(), Object.keys(M7_PROVENANCE));

check("m7CardwrightProvenanceRecordsUpstreamAndBoundary", (() => {
  const source = provenance.sources.find((entry) => entry.id === "coc-cardwright");
  const upstream = source?.upstream ?? [];
  const upstreamIds = upstream.map((entry) => entry.id);
  const boundary = String(provenance.licenseBoundary?.excluded?.join(" ") ?? "");
  return source?.url === "https://github.com/tanis90/coc-cardwright"
    && /^[0-9a-f]{40}$/.test(source.revision ?? "")
    && source.evidence === "secondary"
    && upstreamIds.includes("trpg-saikou") && upstreamIds.includes("cochar")
    && upstream.every((entry) => entry.url.startsWith("https://") && entry.note)
    && /trpg-saikou/.test(source.note) && /cochar/.test(source.note)
    && /not an official Chaosium publication/i.test(source.note)
    && /No coc-cardwright visual template/.test(boundary)
    && /Python implementation/.test(boundary)
    && /only the point formula, credit-rating range and skill names/i.test(boundary);
})(), provenance.sources.find((entry) => entry.id === "coc-cardwright"));

check("psychiatristIsModelledFromCardwright", (() => {
  const doc = profBySlug.get("psychiatrist");
  const coc = doc?.flags?.brp?.coc;
  const resolved = provenance.occupations.resolvedDeferredRecords?.psychiatrist;
  const fixed = coc?.fixedSkillKeys ?? [];
  const groups = coc?.choiceGroups ?? [];
  return doc !== undefined
    && JSON.stringify(fixed) === JSON.stringify(["listen", "medicine", "persuade", "psychoanalysis",
      "psychology", "science-biology", "science-chemistry"])
    && groups.length === 1 && groups[0].key === "language-other" && groups[0].choose === 1
    && JSON.stringify(coc?.sourceRefs) === JSON.stringify(["coc-cardwright"])
    && coc?.creditMin === 30 && coc?.creditMax === 80 && coc?.pointFormula === "EDU*4"
    && !provenance.occupations.deferredRecords?.psychiatrist
    && resolved?.status === "implemented"
    && professionFacts.professions.some((entry) => entry.slug === "psychiatrist");
})(), {
  fixed: profBySlug.get("psychiatrist")?.flags.brp.coc.fixedSkillKeys,
  deferred: provenance.occupations.deferredRecords,
});

check("professionNeverUsesWealthBandAsCreditRating", allProfDocs.every((doc) => {
  const coc = doc.flags.brp.coc;
  const fact = professionFacts.professions.find((entry) => entry.slug === coc.slug);
  return doc.system.minWealth === 0 && doc.system.maxWealth === 0
    && coc.wealthNotApplicable === true
    && Number.isInteger(coc.creditMin) && Number.isInteger(coc.creditMax)
    // The pack CR is copied from the profession fact, never from the UGE band;
    // Tribe Member legitimately prints CR 0-15, so equality with the zeroed
    // wealth fields is not the invariant.
    && coc.creditMin === fact?.creditMin && coc.creditMax === fact?.creditMax;
}), allProfDocs.map((doc) => [doc.flags.brp.coc.slug, doc.system.minWealth, doc.system.maxWealth]));

check("professionSkillRefsResolveWithinTheirOwnPacks", (() => {
  // A core profession must be usable with only the core packs loaded, so every
  // native ref has to come from coc-skills. An expansion profession may draw on
  // both packs (its own first) because enabling the module is what makes the
  // record present at all.
  const coreSkillBrpids = new Set(cocDocs.map((doc) => doc.flags.brp.brpidFlag.id));
  const expandSkillBrpids = new Set(expandSkillDocs.map((doc) => doc.flags.brp.brpidFlag.id));
  const allSkillBrpids = new Set([...coreSkillBrpids, ...expandSkillBrpids]);
  const bad = [];
  for (const doc of allProfDocs) {
    const slug = doc.flags.brp.coc.slug;
    const pack = doc.flags.brp.coc.pack;
    for (const ref of [...doc.system.skills, ...doc.system.groups.flatMap((group) => group.skills)]) {
      const allowed = pack === "core" ? coreSkillBrpids : allSkillBrpids;
      if (!allowed.has(ref.brpid)) bad.push(`${slug}(${pack})→${ref.brpid}`);
      if (ref.uuid !== cocDocId(ref.brpid)) bad.push(`${slug}→${ref.brpid}: uuid`);
    }
    for (const ref of doc.system.skills) {
      if (octopusDocs.some((oct) => oct.flags.brp.brpidFlag.id === ref.brpid)) bad.push(`octopus ref ${ref.brpid}`);
    }
  }
  return bad.length ? bad : true;
})(), []);

check("coreProfessionsStaySelfContainedWhileFamiliesSpanBothPacks", (() => {
  // The shared family expansion still works across the split: a core record
  // reports the expansion members it could not enumerate natively instead of
  // silently dropping them or pointing outside its own pack.
  const coreSkillBrpids = new Set(cocDocs.map((doc) => doc.flags.brp.brpidFlag.id));
  const expandSkillBrpids = new Set(expandSkillDocs.map((doc) => doc.flags.brp.brpidFlag.id));
  const bad = [];
  const dilettante = profBySlug.get("dilettante")?.flags.brp.coc;
  const artCraft = (dilettante?.choiceGroups ?? []).find((group) => group.key === "art-craft");
  const artOption = (artCraft?.options ?? []).find((option) => option.kind === "family");
  if (!artOption) bad.push("dilettante: art-craft family group missing");
  else {
    if (!artOption.brpids.includes("i.skill.coc.art-craft-writing")) bad.push("dilettante: core member art-craft-writing missing");
    if (artOption.brpids.some((brpid) => expandSkillBrpids.has(brpid))) bad.push("dilettante: expands into the expansion pack natively");
    if (!(artOption.expandPackBrpids ?? []).includes("i.skill.coc.art-craft-calligraphy")) {
      bad.push(`dilettante: expandPackBrpids ${JSON.stringify(artOption.expandPackBrpids)}`);
    }
    if ((artOption.expandPackBrpids ?? []).some((brpid) => !expandSkillBrpids.has(brpid))) {
      bad.push("dilettante: expandPackBrpids point outside the expansion pack");
    }
  }
  // Expansion records may use the whole family, core members included.
  const clergyman = profBySlug.get("clergy")?.flags.brp.coc;
  if (!clergyman || clergyman.pack !== "expand") bad.push("clergy: not in the expansion pack");
  for (const doc of expandProfDocs) {
    for (const group of doc.flags.brp.coc.choiceGroups ?? []) {
      for (const option of group.options) {
        if (option.kind !== "family") continue;
        if ((option.brpids ?? []).some((brpid) => expandSkillBrpids.has(brpid))) continue;
        const fact = professionFacts.skillFamilies?.[option.family];
        const hasExpansionMember = (fact?.concrete ?? []).some((key) => docsByKey.get(key)?.flags.brp.coc.pack === "expand");
        if (hasExpansionMember) bad.push(`${doc.flags.brp.coc.slug}/${group.key}: expansion member not enumerated`);
      }
    }
  }
  // Core native refs never point at a skill the core pack does not hold.
  for (const doc of profDocs) {
    for (const ref of [...doc.system.skills, ...doc.system.groups.flatMap((group) => group.skills)]) {
      if (!coreSkillBrpids.has(ref.brpid)) bad.push(`${doc.flags.brp.coc.slug}: core ref ${ref.brpid}`);
    }
  }
  return bad.length ? bad : true;
})(), profDocs.map((doc) => [doc.flags.brp.coc.slug, doc.system.skills.map((ref) => ref.brpid)]));

check("professionGroupsCarryPickCountsAndSpecialismSlotsStayOut", allProfDocs.every((doc) => {
  const groups = doc.system.groups;
  return groups.every((group) => Number.isInteger(group.options) && group.options >= 1
    && group.skills.length >= group.options)
    && doc.system.powers.length === 0;
}), allProfDocs.map((doc) => [doc.flags.brp.coc.slug, doc.system.groups.map((group) => [group.options, group.skills.length])]));

check("professionChoiceGroupsCarryResolvedSkillIds", (() => {
  const skillBrpids = new Set(allSkillDocs.map((doc) => doc.flags.brp.brpidFlag.id));
  const bad = [];
  for (const doc of allProfDocs) {
    const groups = doc.flags.brp.coc.choiceGroups ?? [];
    if (!groups.length) {
      // A source list with no either/or group is modelled as eight fixed skills;
      // it must not be silently emitted as an empty profession.
      if ((doc.flags.brp.coc.fixedSkillKeys ?? []).length !== 8) {
        bad.push(`${doc.flags.brp.coc.slug}: no groups and ${(doc.flags.brp.coc.fixedSkillKeys ?? []).length} fixed`);
      }
      continue;
    }
    for (const group of groups) {
      if (!group.key || !group.label || !Number.isInteger(group.choose)) bad.push(`${doc.flags.brp.coc.slug}/${group.key}: meta`);
      for (const option of group.options) {
        if (option.kind === "any") {
          if (option.brpids.length) bad.push(`${doc.flags.brp.coc.slug}/${group.key}: any has brpids`);
          continue;
        }
        if (!option.brpids.length) bad.push(`${doc.flags.brp.coc.slug}/${group.key}: ${option.kind} empty`);
        for (const brpid of option.brpids) {
          if (!skillBrpids.has(brpid)) bad.push(`${doc.flags.brp.coc.slug}/${group.key}: ${brpid}`);
        }
      }
      // Concrete (non-any) groups are exactly what the native pack mirrors.
      // An "any" group has no enumerable skill list, so the builder must omit it
      // from the native groups; the whole-document count check below proves it.
      if (group.options.every((option) => option.kind !== "any")) {
        const native = doc.system.groups.some((nativeGroup) => nativeGroup.options === group.choose
          && nativeGroup.skills.length === new Set(group.options.flatMap((option) => option.brpids)).size);
        if (!native) bad.push(`${doc.flags.brp.coc.slug}/${group.key}: not mirrored natively`);
      }
    }
    const concreteGroups = groups.filter((group) => group.options.every((option) => option.kind !== "any"));
    if (doc.system.groups.length !== concreteGroups.length) {
      bad.push(`${doc.flags.brp.coc.slug}: native groups ${doc.system.groups.length} != concrete ${concreteGroups.length}`);
    }
  }
  return bad.length ? bad : true;
})());

check("professionSpecialismSlotsCarryVerifiedFamilyBase", (() => {
  const bad = [];
  for (const doc of allProfDocs) {
    for (const slot of doc.flags.brp.coc.specialismSlots ?? []) {
      if (!ASCII_ID.test(slot.specKey ?? "")) bad.push(`${doc.flags.brp.coc.slug}: specKey ${slot.specKey}`);
      if (!ASCII_ID.test(slot.parentKey ?? "")) bad.push(`${doc.flags.brp.coc.slug}: parentKey ${slot.parentKey}`);
      if (slot.brpid !== `i.skill.coc.${slot.parentKey}-${slot.specKey}`) bad.push(`${doc.flags.brp.coc.slug}: brpid ${slot.brpid}`);
      if (slot.requiresExplicitBase) {
        if (slot.base !== null) bad.push(`${doc.flags.brp.coc.slug}: unverified slot has base ${slot.base}`);
      } else if (!Number.isInteger(slot.base) || !(slot.baseSourceRefs ?? []).length) {
        bad.push(`${doc.flags.brp.coc.slug}: verified slot missing base/source`);
      }
    }
  }
  return bad.length ? bad : true;
})(), allProfDocs.map((doc) => [doc.flags.brp.coc.slug, (doc.flags.brp.coc.specialismSlots ?? []).length]));

check("professionBrpidAsciiUniqueAndCocScoped", allProfDocs.every((doc) => /^i\.profession\.coc\.[a-z0-9]+(?:-[a-z0-9]+)*$/.test(doc.flags.brp.brpidFlag.id))
  && new Set(allProfDocs.map((doc) => doc.flags.brp.brpidFlag.id)).size === allProfDocs.length
  && !allProfDocs.some((doc) => octopusDocs.some((oct) => oct.flags.brp.brpidFlag.id === doc.flags.brp.brpidFlag.id))
  && !JSON.stringify(allProfDocs).includes('"\"app\""'),
  allProfDocs.map((doc) => doc.flags.brp.brpidFlag.id));

// Creation rules: pure functions imported exactly as the frontend will.
const creation = await import("../../module/rules/creation.mjs");
const {
  evaluatePointFormula, interestPoints, validateAllocation, parsePointFormula,
  buildSpecialism, specialismBrpid, specialismKey, professionRules, POINT_FORMULAS, CreationRuleError,
  normalizePointFormulas, isSupportedPointFormulas,
} = creation;

// --- M8 SealDice compatibility batch -------------------------------------
// Every imported record must be exactly eight slots, use only the existing
// formula whitelist, resolve every skill reference, and cite the registered
// SealDice source. The deferred catalogue must keep a category and a reason for
// every entry, and the legacy 38 records must not be overwritten.
const SEALDICE_FACT_PREFIX = "sealdice.occupation.";
const sealdiceFacts = professionFacts.professions.filter((entry) => String(entry.factId).startsWith(SEALDICE_FACT_PREFIX));
const sealdiceDocs = allProfDocs.filter((doc) => String(doc.flags.brp.coc.factId).startsWith(SEALDICE_FACT_PREFIX));
const sealdiceDeferred = provenance.occupations.deferredRecords ?? {};
const sealdiceSummary = provenance.occupations.deferredSummary ?? {};
const sealdicePerRecord = provenance.occupations.perRecord ?? {};
const sealdiceFamilies = professionFacts.skillFamilies ?? {};

check("sealdiceBatchReportMatchesRecords", sealdiceFacts.length > 0
  && sealdiceDocs.length === sealdiceFacts.length
  && sealdiceSummary.imported === sealdiceFacts.length
  && sealdiceSummary.total === 305
  && sealdiceSummary.imported + sealdiceSummary.deferred === sealdiceSummary.total
  && Object.keys(sealdiceDeferred).length === sealdiceSummary.deferred
  && Object.values(sealdiceSummary.byCategory ?? {}).reduce((sum, count) => sum + count, 0) === sealdiceSummary.deferred
  && sealdiceFacts.every((fact) => sealdicePerRecord[fact.factId])
  && professionFacts.professions.length === LEGACY_PROFESSION_COUNT + sealdiceFacts.length + CUSTOM_PROFESSION_COUNT,
  { imported: sealdiceFacts.length, summary: sealdiceSummary });

check("sealdiceDeferredRecordsCarryCategoryAndReason", (() => {
  const allowed = new Set(["alias", "format-anomaly", "custom", "missing-credit-rating",
    "missing-formula", "missing-skills", "invalid-credit-rating", "unsupported-formula",
    "not-eight-slots", "unverified-skill", "duplicate-existing", "duplicate-source",
    "display-name-conflict"]);
  const bad = [];
  const counts = {};
  for (const [key, entry] of Object.entries(sealdiceDeferred)) {
    if (!allowed.has(entry?.category)) bad.push(`${key}: category ${entry?.category}`);
    if (typeof entry?.reason !== "string" || !entry.reason.trim()) bad.push(`${key}: no reason`);
    counts[entry?.category] = (counts[entry?.category] ?? 0) + 1;
  }
  for (const [category, count] of Object.entries(counts)) {
    if (sealdiceSummary.byCategory?.[category] !== count) bad.push(`${category}: ${count} != ${sealdiceSummary.byCategory?.[category]}`);
  }
  if (sealdiceSummary.byCategory?.alias !== 79) bad.push(`aliases: ${sealdiceSummary.byCategory?.alias}`);
  if (sealdiceSummary.byCategory?.["format-anomaly"] !== 3) bad.push(`format anomalies: ${sealdiceSummary.byCategory?.["format-anomaly"]}`);
  if (sealdiceDeferred["自定义职业"]?.category !== "custom") bad.push("custom template not deferred");
  return bad.length ? bad : true;
})(), sealdiceSummary.byCategory);

check("sealdiceNormalizedDuplicatesAreProven", (() => {
  // Same option set + same pick count is one canonical choice shape, so the two
  // separate "one interpersonal skill" groups in the legacy records equal the
  // source's one "two interpersonal skills" group. These are duplicates, not
  // display-name conflicts.
  const duplicates = {
    "古董商": "antiquarian",
    "赌徒": "gambler",
    "黑帮-黑帮老大": "gang-leader",
    "精神病院看护": "asylum-orderly",
  };
  const bad = [];
  for (const [key, slug] of Object.entries(duplicates)) {
    const entry = sealdiceDeferred[key];
    if (entry?.category !== "duplicate-existing") bad.push(`${key}: ${entry?.category}`);
    else if (!entry.reason.includes(slug)) bad.push(`${key}: reason ${entry.reason}`);
  }
  // These keep the conflict because the normalized signature really differs.
  // Fisherman is not the same record: legacy is EDU*4 / CR 20-40 with First Aid
  // and one interpersonal pick; the source is EDU*2+STR/DEX / CR 9-30 with
  // Operate Heavy Machinery and Science (Astronomy). Never overwrite or clone
  // the same-name card to force a duplicate.
  for (const key of ["艺术家", "猎人", "渔民"]) {
    if (sealdiceDeferred[key]?.category !== "display-name-conflict") bad.push(`${key}: ${sealdiceDeferred[key]?.category}`);
  }
  return bad.length ? bad : true;
})(), sealdiceSummary.byCategory);

check("sealdiceComplexListsAreParsedNotSkipped", (() => {
  const bad = [];
  const expected = {
    // 10 and 9 slots are real over-long lists; they are rejected for the slot
    // count, not because the parser gave up on the comma/parenthesis grammar.
    "交际花": { category: "not-eight-slots", pattern: /10 项/ },
    "劳工": { category: "not-eight-slots", pattern: /9 项/ },
    // 8 slots, but Etiquette has no family or verified base; the reason names it.
    "佣人": { category: "unverified-skill", pattern: /礼仪/ },
  };
  for (const [key, want] of Object.entries(expected)) {
    const entry = sealdiceDeferred[key];
    if (entry?.category !== want.category) bad.push(`${key}: ${entry?.category}`);
    else if (!want.pattern.test(entry.reason)) bad.push(`${key}: ${entry.reason}`);
  }
  const importedSourceKeys = new Set(Object.values(sealdicePerRecord)
    .filter((record) => record?.sourceRefs?.[0] === "sealdice-occupations")
    .map((record) => record.sourceKey));
  for (const key of ["工人-伐木工", "游戏测试员", "歌手", "偶像", "搞笑艺人", "网络明星"]) {
    if (!importedSourceKeys.has(key)) bad.push(`${key}: still deferred`);
  }
  return bad.length ? bad : true;
})(), sealdiceSummary.byCategory);

check("sealdiceSurvivalMountainKeepsPrintedBase", (() => {
  // skills.py prints 生存(高山)=5. The Survival family default is 10, but a
  // family default must never overwrite a verified member value.
  const doc = docsByKey.get("survival-mountain");
  const fact = facts.skills.find((skill) => skill.key === "survival-mountain");
  return doc?.system.base === 5
    && fact?.base === 5
    && sealdiceFamilies.survival?.base === 10
    && provenance.skillsM8?.perSkill?.["survival-mountain"]?.base === 5
    && JSON.stringify(doc?.flags?.brp?.coc?.sourceRefs) === JSON.stringify(["coc-cardwright"]);
})(), {
  doc: docsByKey.get("survival-mountain")?.system.base,
  family: sealdiceFamilies.survival?.base,
  perSkill: provenance.skillsM8?.perSkill?.["survival-mountain"],
});

check("sealdiceImportedProfessionsAreExactlyEightSlots", (() => {
  const bad = [];
  for (const fact of sealdiceFacts) {
    const groups = fact.choiceGroups ?? [];
    const total = (fact.fixedSkills ?? []).length + groups.reduce((sum, group) => sum + group.choose, 0);
    if (total !== 8) bad.push(`${fact.slug}: ${total} slots`);
    const fixed = fact.fixedSkills ?? [];
    if (new Set(fixed).size !== fixed.length) bad.push(`${fact.slug}: repeated fixed skill`);
    const keys = new Set();
    for (const group of groups) {
      if (!ASCII_ID.test(group.key ?? "")) bad.push(`${fact.slug}/${group.key}: key`);
      if (keys.has(group.key)) bad.push(`${fact.slug}/${group.key}: duplicate group key`);
      keys.add(group.key);
      if (!Number.isInteger(group.choose) || group.choose < 1) bad.push(`${fact.slug}/${group.key}: choose`);
      if (!(group.options ?? []).length) bad.push(`${fact.slug}/${group.key}: no options`);
      for (const option of group.options ?? []) {
        if (!["skill", "family", "any"].includes(option.kind)) bad.push(`${fact.slug}/${group.key}: kind ${option.kind}`);
        if (option.kind === "skill" && !option.skill) bad.push(`${fact.slug}/${group.key}: skill missing`);
        if (option.kind === "family" && !option.family) bad.push(`${fact.slug}/${group.key}: family missing`);
      }
    }
  }
  for (const doc of sealdiceDocs) {
    const coc = doc.flags.brp.coc;
    const total = (coc.fixedSkillKeys ?? []).length + (coc.choiceGroups ?? []).reduce((sum, group) => sum + group.choose, 0);
    if (total !== 8) bad.push(`${coc.slug}: pack ${total} slots`);
  }
  return bad.length ? bad : true;
})(), sealdiceFacts.map((fact) => [fact.slug, (fact.fixedSkills ?? []).length
  + (fact.choiceGroups ?? []).reduce((sum, group) => sum + group.choose, 0)]));

check("sealdiceImportedProfessionsUseWhitelistedFormulasAndCredit", (() => {
  const bad = [];
  for (const fact of sealdiceFacts) {
    const formulas = fact.pointFormulas ?? [fact.pointFormula];
    if (!formulas.length || formulas.some((formula) => !POINT_FORMULAS.includes(formula))) bad.push(`${fact.slug}: formula`);
    if (fact.pointFormulas) {
      if (fact.pointFormulas.length < 2) bad.push(`${fact.slug}: one-entry pointFormulas`);
      if (fact.pointFormula !== undefined) bad.push(`${fact.slug}: both formula spellings`);
    }
    if (formulas.some((formula) => String(formula).includes("MAX"))) bad.push(`${fact.slug}: MAX`);
    if (!Number.isInteger(fact.creditMin) || !Number.isInteger(fact.creditMax)
      || fact.creditMin < 0 || fact.creditMax > 99 || fact.creditMin > fact.creditMax) {
      bad.push(`${fact.slug}: credit ${fact.creditMin}-${fact.creditMax}`);
    }
    if (fact.evidence !== "secondary") bad.push(`${fact.slug}: evidence`);
    if (JSON.stringify(fact.sourceRefs) !== JSON.stringify(["sealdice-occupations"])) bad.push(`${fact.slug}: sources`);
    const doc = sealdiceDocs.find((entry) => entry.flags.brp.coc.factId === fact.factId);
    if (!doc) { bad.push(`${fact.slug}: no pack doc`); continue; }
    const coc = doc.flags.brp.coc;
    const docFormulas = coc.pointFormulas ?? [coc.pointFormula];
    if (JSON.stringify(docFormulas) !== JSON.stringify(formulas)) bad.push(`${fact.slug}: pack formulas`);
    if (coc.creditMin !== fact.creditMin || coc.creditMax !== fact.creditMax) bad.push(`${fact.slug}: pack credit`);
    if (JSON.stringify(coc.sourceRefs) !== JSON.stringify(fact.sourceRefs)) bad.push(`${fact.slug}: pack sources`);
  }
  return bad.length ? bad : true;
})(), sealdiceFacts.map((fact) => [fact.slug, fact.pointFormulas ?? fact.pointFormula]));

check("sealdiceImportedProfessionsResolveSkillRefsAndBases", (() => {
  const bad = [];
  for (const fact of sealdiceFacts) {
    const doc = sealdiceDocs.find((entry) => entry.flags.brp.coc.factId === fact.factId);
    const checkSkill = (key, where) => {
      const skill = docsByKey.get(key);
      if (!skill) { bad.push(`${where}: unknown skill ${key}`); return; }
      if (!skill.system.variable && !Number.isFinite(skill.system.base)) bad.push(`${where}: ${key} has no base`);
      if (!skill.system.variable && skill.system.base === 0 && !["credit-rating", "cthulhu-mythos"].includes(key)) {
        bad.push(`${where}: ${key} is fixed 0`);
      }
    };
    for (const key of fact.fixedSkills ?? []) checkSkill(key, fact.slug);
    for (const group of fact.choiceGroups ?? []) {
      for (const option of group.options ?? []) {
        if (option.kind === "skill") checkSkill(option.skill, `${fact.slug}/${group.key}`);
        if (option.kind === "family") {
          const family = sealdiceFamilies[option.family];
          if (!family) bad.push(`${fact.slug}/${group.key}: unknown family ${option.family}`);
          else if (!(Number.isInteger(family.base) || family.requiresExplicitBase === true)) {
            bad.push(`${fact.slug}/${group.key}: family ${option.family} has no verified base`);
          }
        }
      }
    }
    if (doc) {
      for (const ref of [...doc.system.skills, ...doc.system.groups.flatMap((group) => group.skills)]) {
        if (!docsByKey.has(ref.brpid.replace("i.skill.coc.", ""))) bad.push(`${fact.slug}: ${ref.brpid}`);
      }
    }
  }
  return bad.length ? bad : true;
})(), sealdiceFacts.map((fact) => fact.slug));

check("sealdiceNewSkillsCarryVerifiedBases", (() => {
  const bad = [];
  const perSkill = provenance.skillsM8?.perSkill ?? {};
  if (!Object.keys(perSkill).length) bad.push("no skillsM8.perSkill");
  for (const [key, entry] of Object.entries(perSkill)) {
    const base = entry?.base;
    const sourceRefs = entry?.sourceRefs ?? [];
    const fact = facts.skills.find((item) => item.key === key);
    const doc = docsByKey.get(key);
    if (!fact || !doc) { bad.push(`${key}: missing`); continue; }
    if (!Number.isInteger(base)) bad.push(`${key}: base is not an integer`);
    if (fact.base !== base || doc.system.base !== base) bad.push(`${key}: base ${fact.base}/${doc.system.base} != ${base}`);
    if (!sourceRefs.length) bad.push(`${key}: no sourceRefs`);
    if (JSON.stringify(fact.sourceRefs) !== JSON.stringify(sourceRefs)) bad.push(`${key}: fact sources ${JSON.stringify(fact.sourceRefs)} != ${JSON.stringify(sourceRefs)}`);
    if (JSON.stringify(doc.flags.brp.coc.sourceRefs) !== JSON.stringify(sourceRefs)) bad.push(`${key}: doc sources`);
    if (doc.flags.brp.brpidFlag.id !== `i.skill.coc.${key}`) bad.push(`${key}: brpid`);
    if (fact.specialism) {
      const family = sealdiceFamilies[fact.parentKey];
      if (!family) bad.push(`${key}: family ${fact.parentKey}`);
      else {
        if (!(family.concrete ?? []).includes(key)) bad.push(`${key}: not in family concrete`);
        if (doc.flags.brp.coc.parentKey !== fact.parentKey) bad.push(`${key}: parentKey`);
        if (doc.flags.brp.coc.specKey !== fact.specKey) bad.push(`${key}: specKey`);
        if (doc.system.mainName !== family.label) bad.push(`${key}: mainName ${doc.system.mainName}`);
        if (doc.system.specName !== doc.name) bad.push(`${key}: specName ${doc.system.specName}`);
        if (doc.system.chosen !== true) bad.push(`${key}: chosen`);
        // Family-derived members (no same-name skills.py row) must use the
        // family's verified base. A same-name skills.py row may override it
        // (Mathematics 10, Survival (Mountain) 5, Fighting/Firearms members).
        if (sourceRefs.includes("coc-sheet-1920s") && base !== family.base) {
          bad.push(`${key}: family-base skill ${base} != family ${family.base}`);
        }
      }
    } else if (doc.system.specialism !== false || doc.system.chosen !== false) {
      bad.push(`${key}: standalone skill marked as specialism`);
    }
    if ((facts.pendingSpecialisms ?? []).some((pending) => pending.factId === fact.factId)) bad.push(`${key}: still pending`);
  }
  return bad.length ? bad : true;
})());

check("sealdiceSourceAndLicenseBoundaryAreRegistered", (() => {
  const source = provenance.sources.find((entry) => entry.id === "sealdice-occupations");
  const boundary = String(provenance.licenseBoundary?.excluded?.join(" ") ?? "");
  const notes = String(provenance.occupations.notes?.join(" ") ?? "");
  return source?.evidence === "secondary"
    && String(source?.url ?? "").startsWith("https://")
    && /no license/i.test(source?.note ?? "")
    && /not redistributed/i.test(source?.note ?? "")
    && /SealDice builtin JSON/.test(boundary)
    && /SealDice descriptions are self-written/.test(notes)
    && /helpdoc's 【介绍】 prose is not copied/.test(notes);
})(), provenance.sources.find((entry) => entry.id === "sealdice-occupations"));

check("sealdiceDescriptionsAreOriginalProse", sealdiceFacts.every((fact) => typeof fact.description === "string"
  && fact.description.length >= 8 && fact.description.length <= 120
  && !fact.description.includes("\n") && !fact.description.includes("【")
  && !fact.description.includes("职业序号")), sealdiceFacts.map((fact) => [fact.slug, fact.description?.length]));

check("sealdiceBatchPreservesLegacyRecordsAndChoices", (() => {
  const legacy = professionFacts.professions.filter((entry) => !String(entry.factId).startsWith(SEALDICE_FACT_PREFIX)
    && entry.evidence !== "product");
  const bySlug = new Map(legacy.map((entry) => [entry.slug, entry]));
  return legacy.length === LEGACY_PROFESSION_COUNT
    && JSON.stringify(bySlug.get("private-investigator")?.pointFormulas) === JSON.stringify(["EDU*2+STR*2", "EDU*2+DEX*2"])
    && JSON.stringify(bySlug.get("soldier")?.pointFormulas) === JSON.stringify(["EDU*2+STR*2", "EDU*2+DEX*2"])
    && JSON.stringify(bySlug.get("explorer")?.pointFormulas) === JSON.stringify(["EDU*2+APP*2", "EDU*2+DEX*2", "EDU*2+STR*2"])
    && JSON.stringify(bySlug.get("artist")?.pointFormulas) === JSON.stringify(["EDU*2+POW*2", "EDU*2+DEX*2"])
    && sealdiceFacts.every((fact) => !bySlug.has(fact.slug));
})(), sealdiceFacts.length);

const creationStats = { edu: 60, int: 50, dex: 70, app: 40, str: 30, pow: 45, cha: 40 };
check("pointFormulasEvaluateFromWhitelist", POINT_FORMULAS.length === 7
  && evaluatePointFormula("EDU*4", creationStats) === 240
  && evaluatePointFormula("EDU*2+DEX*2", creationStats) === 260
  && evaluatePointFormula("EDU*2+APP*2", creationStats) === 200
  && evaluatePointFormula("EDU*2+STR*2", creationStats) === 180
  && evaluatePointFormula("EDU*2+POW*2", creationStats) === 210
  && evaluatePointFormula("EDU*2+MAX(APP,DEX,STR)*2", creationStats) === 260
  && evaluatePointFormula("EDU*2+MAX(DEX,STR)*2", creationStats) === 260
  // Adding EDU*2+POW*2 must not move any pre-existing formula's result:
  // APP stays 40 (200), POW is 45 (210) and neither aliases the other.
  && evaluatePointFormula("EDU*2+POW*2", { ...creationStats, pow: 40 }) === 200
  && evaluatePointFormula("EDU*2+APP*2", { ...creationStats, pow: 90 }) === 200
  && new Set(POINT_FORMULAS).size === POINT_FORMULAS.length
  && POINT_FORMULAS.includes("EDU*4") && POINT_FORMULAS.includes("EDU*2+STR*2")
  && POINT_FORMULAS.includes("EDU*2+POW*2"),
  {
    edu4: evaluatePointFormula("EDU*4", creationStats),
    eduDex: evaluatePointFormula("EDU*2+DEX*2", creationStats),
    eduApp: evaluatePointFormula("EDU*2+APP*2", creationStats),
    eduStr: evaluatePointFormula("EDU*2+STR*2", creationStats),
    eduPow: evaluatePointFormula("EDU*2+POW*2", creationStats),
    explorer: evaluatePointFormula("EDU*2+MAX(APP,DEX,STR)*2", creationStats),
    pi: evaluatePointFormula("EDU*2+MAX(DEX,STR)*2", creationStats),
    list: [...POINT_FORMULAS],
  });

check("powFormulaFailsClosedWithoutPow", (() => {
  try {
    evaluatePointFormula("EDU*2+POW*2", { edu: 60, dex: 70 });
    return false;
  } catch (thrown) {
    return thrown.code === "stat-missing";
  }
})(), (() => {
  try { return evaluatePointFormula("EDU*2+POW*2", { edu: 60 }); } catch (thrown) { return thrown.code; }
})());

check("formulaUsageMatchesThePinnedOccupationTable", (() => {
  // Every shipped occupation's ordered formula list must match the pinned
  // table; no record may still carry the old MAX spelling, and the MAX
  // formulas stay whitelisted for backward compatibility only.
  // This table pins the M7 legacy 38. The M8 SealDice batch is checked by
  // sealdiceImportedProfessionsUseWhitelistedFormulasAndCredit instead, and the
  // product-defined template is pinned by
  // customInvestigatorFormulasAreTheFiveWhitelistedOnes.
  const legacyDocs = allProfDocs.filter((doc) => !String(doc.flags.brp.coc.factId).startsWith("sealdice.occupation.")
    && doc.flags.brp.coc.evidence !== "product");
  const actual = new Map(legacyDocs.map((doc) => [
    doc.flags.brp.coc.slug,
    doc.flags.brp.coc.pointFormulas ?? [doc.flags.brp.coc.pointFormula],
  ]));
  const bad = [];
  if (actual.size !== Object.keys(EXPECTED_OCCUPATIONS).length) bad.push(`count ${actual.size}`);
  for (const [slug, want] of Object.entries(EXPECTED_OCCUPATIONS)) {
    if (JSON.stringify(actual.get(slug)) !== JSON.stringify(want.formulas)) {
      bad.push(`${slug}: ${JSON.stringify(actual.get(slug))}`);
    }
  }
  for (const slug of actual.keys()) if (!EXPECTED_OCCUPATIONS[slug]) bad.push(`${slug}: unpinned`);
  const maxUsers = [...actual].filter(([, formulas]) => formulas.some((formula) => formula.includes("MAX")))
    .map(([slug]) => slug);
  const powUsers = [...actual].filter(([, formulas]) => formulas.includes("EDU*2+POW*2")).map(([slug]) => slug);
  if (maxUsers.length) bad.push(`MAX users ${JSON.stringify(maxUsers)}`);
  if (JSON.stringify(powUsers) !== JSON.stringify(["artist"])) bad.push(`POW users ${JSON.stringify(powUsers)}`);
  if (!POINT_FORMULAS.includes("EDU*2+MAX(APP,DEX,STR)*2")
    || !POINT_FORMULAS.includes("EDU*2+MAX(DEX,STR)*2")) bad.push("MAX formulas dropped from whitelist");
  return bad.length ? bad : true;
})(), {
  maxUsers: allProfDocs.filter((doc) => (doc.flags.brp.coc.pointFormulas ?? [doc.flags.brp.coc.pointFormula])
    .some((formula) => formula.includes("MAX"))).map((doc) => doc.flags.brp.coc.slug),
  powUsers: allProfDocs.filter((doc) => (doc.flags.brp.coc.pointFormulas ?? [doc.flags.brp.coc.pointFormula])
    .includes("EDU*2+POW*2")).map((doc) => doc.flags.brp.coc.slug),
  formulas: [...POINT_FORMULAS],
});

check("multiFormulaNormalizationBackwardCompatible", (() => {
  const single = normalizePointFormulas({ pointFormula: "EDU*4" });
  const multi = normalizePointFormulas({ pointFormulas: ["EDU*2+DEX*2", "EDU*2+STR*2"] });
  const singleFromArray = normalizePointFormulas({ pointFormulas: ["EDU*4"] });
  const both = normalizePointFormulas({ pointFormula: "EDU*4", pointFormulas: ["EDU*2+STR*2"] });
  const dup = (() => { try { normalizePointFormulas({ pointFormulas: ["EDU*4", "EDU*4"] }); return false; }
    catch (thrown) { return thrown.code === "formula-duplicate"; } })();
  const missing = (() => { try { normalizePointFormulas({}); return false; }
    catch (thrown) { return thrown.code === "formula-missing"; } })();
  const illegal = (() => { try { normalizePointFormulas({ pointFormulas: ["EDU*4", "EDU*5"] }); return false; }
    catch (thrown) { return thrown.code === "formula-not-allowed" || thrown.code === "formula-invalid"; } })();
  return Array.isArray(single) && single.length === 1 && single[0] === "EDU*4"
    && multi.length === 2 && multi[1] === "EDU*2+STR*2"
    && singleFromArray.length === 1
    // The plural form wins when both are present; the build rejects that shape.
    && both.length === 1 && both[0] === "EDU*2+STR*2"
    && dup && missing && illegal
    && isSupportedPointFormulas({ pointFormula: "EDU*4" })
    && isSupportedPointFormulas({ pointFormulas: ["EDU*2+DEX*2", "EDU*2+STR*2"] })
    && !isSupportedPointFormulas({ pointFormulas: [] })
    && Object.isFrozen(single);
})(), (() => { try { normalizePointFormulas({ pointFormulas: ["EDU*4", "EDU*4"] }); return "accepted"; }
  catch (thrown) { return thrown.code; } })());

check("pointFormulaRoundsDownAndReadsNativeStatObjects", evaluatePointFormula("EDU*2+MAX(DEX,STR)*2", { edu: 59, dex: 61, str: 30 }) === 240
  && evaluatePointFormula("EDU*4", { edu: { base: 50, redist: 5, culture: 0 } }) === 220
  && evaluatePointFormula("EDU*2+DEX*2", { edu: { total: 60 }, dex: { total: 45 } }) === 210
  && evaluatePointFormula("EDU*2+APP*2", { edu: 60, cha: 40 }) === 200,
  {
    rounded: evaluatePointFormula("EDU*2+MAX(DEX,STR)*2", { edu: 59, dex: 61, str: 30 }),
    native: evaluatePointFormula("EDU*2+DEX*2", { edu: { total: 60 }, dex: { total: 45 } }),
    appAlias: evaluatePointFormula("EDU*2+APP*2", { edu: 60, cha: 40 }),
  });

const formulaRejects = (formula, statsValue = creationStats) => {
  try { evaluatePointFormula(formula, statsValue); return false; }
  catch (thrown) { return thrown instanceof CreationRuleError; }
};
check("pointFormulaFailsClosedOnIllegalInput", [
  "EDU*10", "EDU+4", "EDU*4+DEX*2", "EDU * 4 + ", "", null, "process.exit(1)", "EDU*4;evil()",
  "MAX(EDU,EDU)*2", "LUCK*2", "INT*4", "EDU*2+MAX(APP)*2", "EDU*2+MAX(APP,DEX,STR,INT)*2",
].every((formula) => formulaRejects(formula))
  && formulaRejects("EDU*4", { dex: 50 })
  && formulaRejects("EDU*4", { edu: -1 })
  && Object.isFrozen(parsePointFormula("EDU*4")),
  ["EDU*10", "EDU+4", "EDU*4+DEX*2", "MAX(EDU,EDU)*2", "LUCK*2"].map((formula) => {
    try { evaluatePointFormula(formula, creationStats); return `${formula}:accepted`; }
    catch (thrown) { return `${formula}:${thrown.code}`; }
  }));

check("interestPointsIsIntTimesTwo", interestPoints(50) === 100 && interestPoints(0) === 0
  && interestPoints(63) === 126 && interestPoints({ total: 55 }) === 110
  && (() => { try { interestPoints(null); return false; } catch (thrown) { return thrown.code === "stat-missing"; } })(),
  { a: interestPoints(50), b: interestPoints(63), c: interestPoints({ total: 55 }) });

const profession = (slug) => professionFacts.professions.find((entry) => entry.slug === slug);
const alloc = (slug, skills, extra = {}) => validateAllocation({
  profession: profession(slug),
  stats: creationStats,
  skills,
  ...extra,
});

const okArchaeologist = alloc("archaeologist", [
  { key: "credit-rating", base: 0, occupation: 20 },
  { key: "archaeology", base: 1, occupation: 40 },
]);
check("allocationValidPathOnRealProfession", okArchaeologist.valid
  && okArchaeologist.budgets.occupation.max === 240
  && okArchaeologist.budgets.occupation.spent === 60
  && okArchaeologist.budgets.interest.max === 100
  && okArchaeologist.creditRating.value === 20
  && okArchaeologist.creditRating.valid
  && okArchaeologist.totals.find((row) => row.key === "archaeology").total === 41,
  okArchaeologist);

const budgetCodes = (result) => result.errors.map((entry) => entry.code);

// The product-defined template is validated here: these helpers need both the
// pack documents and the pure creation rules.
check("customInvestigatorFormulasAreTheFiveWhitelistedOnes", (() => {
  // Five real formulas to pick from, all already whitelisted. No sixth formula
  // and no MAX shorthand is invented for the template.
  const coc = profBySlug.get("custom-investigator")?.flags.brp.coc;
  const expected = ["EDU*4", "EDU*2+DEX*2", "EDU*2+APP*2", "EDU*2+STR*2", "EDU*2+POW*2"];
  if (!coc) return false;
  const formulas = coc.pointFormulas ?? [];
  return JSON.stringify(formulas) === JSON.stringify(expected)
    && coc.pointFormula === expected[0]
    && formulas.every((formula) => POINT_FORMULAS.includes(formula))
    && !formulas.some((formula) => formula.includes("MAX"))
    && coc.creditMin === 0 && coc.creditMax === 99;
})(), profBySlug.get("custom-investigator")?.flags.brp.coc.pointFormulas);

check("customInvestigatorChoiceShape", (() => {
  // Eight arbitrary skills, one choice group, and nothing hard-wired: the record
  // must not smuggle in a fixed skill or a narrower option list.
  const coc = profBySlug.get("custom-investigator")?.flags.brp.coc;
  if (!coc) return false;
  const groups = coc.choiceGroups ?? [];
  return (coc.fixedSkillKeys ?? []).length === 0
    && (coc.specialismSlots ?? []).length === 0
    && groups.length === 1
    && groups[0].key === "custom-eight"
    && groups[0].choose === 8
    && groups[0].distinct === true
    && groups[0].options.length === 1
    && groups[0].options[0].kind === "any"
    && groups[0].options[0].brpids.length === 0
    // An "any" group cannot be enumerated, so it stays out of the native groups.
    && profBySlug.get("custom-investigator").system.groups.length === 0;
})(), profBySlug.get("custom-investigator")?.flags.brp.coc.choiceGroups);

check("customInvestigatorBuildsThroughTheRealCreationRules", (() => {
  // The template has to work as a character-creation source, not just as data:
  // CR 0–99 is the Keeper-reviewed range, either end is legal, a CR outside it
  // is rejected, and the player still has to pin one of the five formulas.
  const doc = profBySlug.get("custom-investigator");
  const custom = (skills, pointFormula) => validateAllocation({
    profession: doc, stats: creationStats, skills, ...(pointFormula ? { pointFormula } : {}),
  });
  const atMin = custom([{ key: "credit-rating", base: 0, occupation: 0 }], "EDU*4");
  const atMax = custom([{ key: "credit-rating", base: 0, occupation: 99 }], "EDU*2+DEX*2");
  const unpinned = custom([{ key: "credit-rating", base: 0, occupation: 10 }]);
  const overMax = custom([{ key: "credit-rating", base: 0, occupation: 100 }], "EDU*4");
  const eightPicks = custom([
    { key: "credit-rating", base: 0, occupation: 20 },
    { key: "library-use", base: 20, occupation: 10 },
    { key: "art-craft-writing", base: 5, interest: 15 },
    { key: "history", base: 5, interest: 10 },
    { key: "occult", base: 5, interest: 10 },
    { key: "listen", base: 20, interest: 10 },
    { key: "psychology", base: 10, interest: 10 },
    { key: "stealth", base: 20, interest: 10 },
    { key: "swim", base: 20, interest: 5 },
  ], "EDU*2+POW*2");
  return atMin.valid && atMin.creditRating.value === 0
    && atMax.valid && atMax.creditRating.value === 99
    && atMax.budgets.occupation.max === 260
    && !unpinned.valid && unpinned.budgets === null
    && budgetCodes(unpinned).includes("formula-choice-required")
    && !overMax.valid && budgetCodes(overMax).includes("credit-rating-above-max")
    && eightPicks.valid
    && eightPicks.totals.length === 9
    && eightPicks.budgets.interest.max === 100;
})(), (() => {
  try {
    return budgetCodes(validateAllocation({
      profession: profBySlug.get("custom-investigator"), stats: creationStats,
      skills: [{ key: "credit-rating", base: 0, occupation: 100 }], pointFormula: "EDU*4",
    }));
  } catch (thrown) { return thrown.code; }
})());

check("allocationRejectsOverspendOnBothBudgets",
  budgetCodes(alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 21 }, { key: "archaeology", base: 1, occupation: 220 }]))
    .includes("budget-occupation-exceeded")
  && budgetCodes(alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 }, { key: "archaeology", base: 1, occupation: 0, interest: 101 }]))
    .includes("budget-interest-exceeded"),
  {
    occupation: budgetCodes(alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 21 }, { key: "archaeology", base: 1, occupation: 220 }])),
    interest: budgetCodes(alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 }, { key: "archaeology", base: 1, interest: 101 }])),
  });

check("allocationCreditRatingUsesOccupationPointsOnlyAndStaysInRange", (() => {
  const below = alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 9 }]);
  const above = alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 41 }]);
  const interestOnly = alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 10, interest: 20 }]);
  const baseFolded = alloc("archaeologist", [{ key: "credit-rating", base: 20, occupation: 10 }]);
  const atMin = alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 10 }]);
  const atMax = alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 40 }]);
  return budgetCodes(below).includes("credit-rating-below-min")
    && budgetCodes(above).includes("credit-rating-above-max")
    && budgetCodes(interestOnly).includes("credit-rating-interest")
    && budgetCodes(baseFolded).includes("credit-rating-base")
    && atMin.valid && atMax.valid && atMax.creditRating.value === 40;
})(), {
  below: budgetCodes(alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 9 }])),
  above: budgetCodes(alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 41 }])),
  interest: budgetCodes(alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 10, interest: 20 }])),
});

check("allocationCreditRatingIsMandatory", budgetCodes(alloc("archaeologist", [{ key: "archaeology", base: 1, occupation: 10 }]))
  .includes("credit-rating-missing"), budgetCodes(alloc("archaeologist", [{ key: "archaeology", base: 1, occupation: 10 }])));

check("allocationRejectsMythosPoints", (() => {
  const result = alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 }, { key: "cthulhu-mythos", base: 0, occupation: 5 }]);
  return budgetCodes(result).includes("mythos-allocation") && !result.valid;
})(), budgetCodes(alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 }, { key: "cthulhu-mythos", base: 0, interest: 5 }])));

check("allocationRejectsMissingOrIllegalBaseValues", (() => {
  const missing = alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 }, { key: "fighting-axe", base: null, occupation: 5 }]);
  const requiresExplicit = alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "fighting-sword", base: 0, occupation: 5, baseSource: "verified", baseRequiresExplicit: true }]);
  const explicitZero = alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "fighting-spear", base: 0, occupation: 5, baseSource: "explicit" }]);
  const explicitOk = alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "fighting-spear", base: 15, occupation: 5, baseSource: "explicit", baseRequiresExplicit: true }]);
  return budgetCodes(missing).includes("base-missing")
    && budgetCodes(requiresExplicit).includes("base-explicit-required")
    && budgetCodes(explicitZero).includes("base-explicit-zero")
    && explicitOk.valid
    && explicitOk.totals[1].total === 20;
})(), {
  missing: budgetCodes(alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 }, { key: "fighting-axe", base: null, occupation: 5 }])),
  requiresExplicit: budgetCodes(alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "fighting-sword", base: 0, occupation: 5, baseSource: "verified", baseRequiresExplicit: true }])),
});

check("allocationNeverFoldsBaseIntoTotal", (() => {
  // 50 = occupation 40 + interest 10, base 1 omitted -> folded.
  const folded = alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "archaeology", base: 1, occupation: 40, interest: 10, total: 50 }]);
  const honest = alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "archaeology", base: 1, occupation: 40, interest: 10, total: 51 }]);
  return budgetCodes(folded).includes("base-folded")
    && honest.valid
    && honest.totals.find((row) => row.key === "archaeology").base === 1
    && folded.totals.find((row) => row.key === "archaeology").total === 51;
})(), budgetCodes(alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 },
  { key: "archaeology", base: 1, occupation: 40, interest: 10, total: 50 }])));

check("allocationRejectsDuplicateAndNonAsciiSkillKeys", (() => {
  const dup = budgetCodes(alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "archaeology", base: 1, occupation: 1 }, { key: "archaeology", base: 1, occupation: 1 }]));
  const cjk = budgetCodes(alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "考古学", base: 1, occupation: 1 }]));
  return dup.includes("duplicate-skill") && cjk.includes("skill-key-invalid");
})(), {
  dup: budgetCodes(alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "archaeology", base: 1, occupation: 1 }, { key: "archaeology", base: 1, occupation: 1 }])),
  cjk: budgetCodes(alloc("archaeologist", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "考古学", base: 1, occupation: 1 }])),
});

const explorerAllocation = validateAllocation({
  profession: profession("explorer"), stats: creationStats,
  skills: [{ key: "credit-rating", base: 0, occupation: 55 }], pointFormula: "EDU*2+DEX*2",
});
check("professionSpecificFormulaDrivesBudget", explorerAllocation.valid
  && explorerAllocation.budgets.occupation.max === 260
  && allocateFor("dilettante").budgets.occupation.max === 200
  && allocateFor("cat-burglar").budgets.occupation.max === 260
  && allocateFor("author").budgets.occupation.max === 240
  // The MAX formulas stay whitelisted for legacy/custom records even though no
  // shipped occupation uses them.
  && validateAllocation({
    profession: { pointFormula: "EDU*2+MAX(DEX,STR)*2", creditMin: 9, creditMax: 30 }, stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 10 }],
  }).budgets.occupation.max === 260,
  {
    explorer: explorerAllocation.budgets.occupation.max,
    dilettante: allocateFor("dilettante").budgets.occupation.max,
    catBurglar: allocateFor("cat-burglar").budgets.occupation.max,
    author: allocateFor("author").budgets.occupation.max,
  });

function allocateFor(slug) {
  const entry = profession(slug);
  return validateAllocation({
    profession: entry, stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: entry.creditMin }],
  });
}

check("professionWithoutFormulaFailsClosed", (() => {
  const result = validateAllocation({
    profession: { slug: "custom", pointFormula: "EDU*5", creditMin: 0, creditMax: 10 },
    stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 0 }],
  });
  return !result.valid && result.errors.some((entry) => entry.code === "formula-not-allowed") && result.budgets === null;
})(), validateAllocation({
  profession: { slug: "custom", pointFormula: "EDU*5", creditMin: 0, creditMax: 10 },
  stats: creationStats, skills: [{ key: "credit-rating", base: 0, occupation: 0 }],
}).errors);

check("creditRangeMustBeSane", (() => {
  const lowered = validateAllocation({
    profession: { pointFormula: "EDU*4", creditMin: 50, creditMax: 40 }, stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 0 }],
  });
  const infeasible = validateAllocation({
    profession: { pointFormula: "EDU*2+APP*2", creditMin: 90, creditMax: 99 },
    stats: { ...creationStats, edu: 20, app: 20 },
    skills: [{ key: "credit-rating", base: 0, occupation: 0 }],
  }, { requireCreditRating: false });
  return !lowered.valid && lowered.errors.some((entry) => entry.code === "credit-range-invalid")
    && infeasible.errors.some((entry) => entry.code === "credit-rating-infeasible");
})(), {
  lowered: validateAllocation({
    profession: { pointFormula: "EDU*4", creditMin: 50, creditMax: 40 }, stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 0 }],
  }).errors.map((entry) => entry.code),
  infeasible: validateAllocation({
    profession: { pointFormula: "EDU*2+APP*2", creditMin: 90, creditMax: 99 },
    stats: { ...creationStats, edu: 20, app: 20 }, skills: [{ key: "credit-rating", base: 0, occupation: 0 }],
  }, { requireCreditRating: false }).errors.map((entry) => entry.code),
});

check("validateAllocationDoesNotMutateInput", (() => {
  const input = {
    profession: { pointFormula: "EDU*4", creditMin: 10, creditMax: 40 },
    stats: { ...creationStats },
    skills: [{ key: "credit-rating", base: 0, occupation: 20 }],
  };
  const snapshot = JSON.stringify(input);
  const result = validateAllocation(input);
  return JSON.stringify(input) === snapshot && result.valid && Object.isFrozen(result.totals[0]);
})());

// --- M3 either/or point formulas (Police Detective) ---
check("professionRulesCarriesEveryFormulaInOrder", (() => {
  const fromPack = professionRules(profBySlug.get("police-detective"));
  const fromRecord = professionRules(profession("police-detective"));
  const single = professionRules(profBySlug.get("librarian"));
  return fromPack.pointFormulas.length === 2
    && fromPack.pointFormulas[0] === "EDU*2+DEX*2" && fromPack.pointFormulas[1] === "EDU*2+STR*2"
    && fromPack.pointFormula === "EDU*2+DEX*2"
    && fromRecord.pointFormulas.length === 2
    && single.pointFormulas.length === 1 && single.pointFormula === "EDU*4"
    && Object.isFrozen(fromPack.pointFormulas);
})(), (() => {
  try { return professionRules(profBySlug.get("police-detective")).pointFormulas; } catch (thrown) { return thrown.code; }
})());

check("eitherOrFormulaPoolsDifferAndAreSelectedExplicitly", (() => {
  // edu 60 / dex 70 / str 30: DEX option 260, STR option 180.
  const byDex = validateAllocation({
    profession: profession("police-detective"), stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 20 }], pointFormula: "EDU*2+DEX*2",
  });
  const byStr = validateAllocation({
    profession: profession("police-detective"), stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 20 }], pointFormula: "EDU*2+STR*2",
  });
  const unpinned = validateAllocation({
    profession: profession("police-detective"), stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 20 }],
  });
  return byDex.valid && byDex.budgets.occupation.max === 260 && byDex.budgets.occupation.formula === "EDU*2+DEX*2"
    && byStr.valid && byStr.budgets.occupation.max === 180 && byStr.budgets.occupation.formula === "EDU*2+STR*2"
    && byDex.budgets.occupation.formulas.length === 2
    && !byDex.budgets.occupation.formulas.some((option) => option.formula.includes("MAX"))
    // No silent pick: an unpinned either/or profession has no budget at all.
    && !unpinned.valid && unpinned.budgets === null
    && budgetCodes(unpinned).includes("formula-choice-required");
})(), budgetCodes(validateAllocation({
  profession: profession("police-detective"), stats: creationStats,
  skills: [{ key: "credit-rating", base: 0, occupation: 20 }],
})));

check("eitherOrFormulaRejectsForeignOrIllegalChoice", (() => {
  const foreign = validateAllocation({
    profession: profession("police-detective"), stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 20 }], pointFormula: "EDU*4",
  });
  const illegal = validateAllocation({
    profession: profession("police-detective"), stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 20 }], pointFormula: "EDU*2+MAX(DEX,STR)*2",
  });
  const lowered = validateAllocation({
    profession: profession("police-detective"), stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 20 }], pointFormula: "EDU*2+STR*2",
  });
  // 260 > 180: a detective who overspent the DEX pool is caught under the STR choice.
  const overspent = validateAllocation({
    profession: profession("police-detective"), stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 20 }, { key: "law", base: 5, occupation: 200 }],
    pointFormula: "EDU*2+STR*2",
  });
  return !foreign.valid && budgetCodes(foreign).includes("formula-not-allowed")
    && !illegal.valid && budgetCodes(illegal).includes("formula-not-allowed")
    && lowered.budgets.occupation.max === 180
    && budgetCodes(overspent).includes("budget-occupation-exceeded");
})(), {
  foreign: budgetCodes(validateAllocation({
    profession: profession("police-detective"), stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 20 }], pointFormula: "EDU*4",
  })),
});

check("singleFormulaProfessionsKeepTheirOldBudgets", (() => {
  // Regression guard: multi-formula support must not move a single-formula
  // profession's pool or its budget shape.
  const expected = { archaeologist: 240, author: 240, nurse: 240, professor: 240, "librarian": 240, lawyer: 240, engineer: 240, "doctor-of-medicine": 240, clergy: 240 };
  const bad = [];
  for (const [slug, max] of Object.entries(expected)) {
    // Use a credit allocation inside each profession's printed range; lawyer,
    // engineer and Doctor of Medicine start at 30, so the old hard-coded 20 was
    // an invalid allocation and made this guard fail for the wrong reason.
    const entry = profession(slug);
    const credit = Math.max(20, entry.creditMin);
    const result = validateAllocation({
      profession: entry, stats: creationStats,
      skills: [{ key: "credit-rating", base: 0, occupation: credit }],
    });
    if (!result.valid) bad.push(`${slug}: invalid ${budgetCodes(result)}`);
    if (result.budgets?.occupation.max !== max) bad.push(`${slug}: max ${result.budgets?.occupation.max}`);
    if ((result.budgets?.occupation.formulas ?? []).length !== 1) bad.push(`${slug}: formulas ${result.budgets?.occupation.formulas?.length}`);
    if (result.budgets?.occupation.formula !== "EDU*4") bad.push(`${slug}: formula ${result.budgets?.occupation.formula}`);
  }
  return bad.length ? bad : true;
})(), null);

check("coreProfessionsBuildEndToEndFromCorePacksOnly", (() => {
  // The pinned core eight plus the custom template must be buildable with only
  // the core packs loaded: every skill key they reference exists in coc-skills,
  // and each one pins a formula and a credit rating inside its own range.
  const coreSkillKeys = new Set(cocDocs.map((doc) => doc.flags.brp.coc.key));
  const coreSlugs = ["antiquarian", "author", "dilettante", "doctor-of-medicine",
    "investigative-journalist", "police-detective", "private-investigator", "professor"];
  const bad = [];
  for (const slug of [...coreSlugs, "custom-investigator"]) {
    const doc = profBySlug.get(slug);
    if (!doc) { bad.push(`${slug}: missing`); continue; }
    if (doc.flags.brp.coc.pack !== "core") bad.push(`${slug}: pack ${doc.flags.brp.coc.pack}`);
    for (const key of doc.flags.brp.coc.fixedSkillKeys ?? []) {
      if (!coreSkillKeys.has(key)) bad.push(`${slug}: fixed ${key} not in the core pack`);
    }
    for (const group of doc.flags.brp.coc.choiceGroups ?? []) {
      for (const option of group.options) {
        if (option.kind === "skill" && !coreSkillKeys.has(option.skill)) bad.push(`${slug}: option ${option.skill}`);
        for (const brpid of option.brpids ?? []) {
          if (!cocDocs.some((skillDocEntry) => skillDocEntry.flags.brp.brpidFlag.id === brpid)) {
            bad.push(`${slug}: native ref ${brpid} outside the core pack`);
          }
        }
      }
    }
    const coc = doc.flags.brp.coc;
    const first = (coc.pointFormulas ?? [coc.pointFormula])[0];
    const result = validateAllocation({
      profession: doc, stats: creationStats,
      skills: [{ key: "credit-rating", base: 0, occupation: coc.creditMin }],
      ...(coc.pointFormulas ? { pointFormula: first } : {}),
    });
    if (!result.valid) bad.push(`${slug}: ${budgetCodes(result)}`);
  }
  return bad.length ? bad : true;
})(), null);

check("authorKeepsItsOpenLiteratureDirection", (() => {
  // The literary direction is an open specialism slot, not a published skill:
  // the player names the specialism, so no `art-craft-literature` document may
  // be invented and the slot must stay available without the module.
  const author = profBySlug.get("author")?.flags.brp.coc;
  const slot = (author?.specialismSlots ?? []).find((entry) => entry.specKey === "literature");
  return !!slot
    && slot.family === "art-craft"
    && slot.parentKey === "art-craft"
    && slot.brpid === "i.skill.coc.art-craft-literature"
    && slot.base === 5
    && (slot.baseSourceRefs ?? []).length > 0
    && slot.requiresExplicitBase === false
    && !docsByKey.has("art-craft-literature")
    && !cocDocs.some((doc) => doc.flags.brp.coc.key === "art-craft-literature")
    && JSON.stringify(author.sourceRefs) === JSON.stringify(["coc-roll20-occupations"]);
})(), profBySlug.get("author")?.flags.brp.coc.specialismSlots);

check("newProfessionsBuildValidAllocationsEndToEnd", (() => {
  // One realistic allocation per M5/M6 profession plus a credit-rating-only
  // pass over every shipped occupation, through the pack documents the builder
  // will actually hand in.
  const cases = [
    { slug: "doctor-of-medicine", cr: 40, budget: 240, extra: [{ key: "medicine", base: 1, occupation: 66 }] },
    { slug: "police-detective", cr: 20, budget: 260, pointFormula: "EDU*2+DEX*2", extra: [{ key: "law", base: 5, occupation: 60 }] },
    { slug: "librarian", cr: 12, budget: 240, extra: [{ key: "library-use", base: 20, occupation: 60 }] },
    { slug: "lawyer", cr: 30, budget: 240, extra: [{ key: "law", base: 5, occupation: 60 }] },
    { slug: "engineer", cr: 30, budget: 240, extra: [{ key: "mechanical-repair", base: 10, occupation: 50 }] },
    { slug: "police-officer", cr: 9, budget: 260, pointFormula: "EDU*2+DEX*2", extra: [{ key: "fighting-brawl", base: 25, occupation: 40 }] },
    { slug: "artist", cr: 9, budget: 210, pointFormula: "EDU*2+POW*2", extra: [{ key: "psychology", base: 10, occupation: 40 }] },
    { slug: "clergy", cr: 9, budget: 240, extra: [{ key: "accounting", base: 5, occupation: 40 }] },
    { slug: "pilot", cr: 20, budget: 260, extra: [{ key: "pilot-aircraft", base: 1, occupation: 40 }] },
  ];
  const bad = [];
  for (const entry of cases) {
    const doc = profBySlug.get(entry.slug);
    const result = validateAllocation({
      profession: doc,
      stats: creationStats,
      skills: [{ key: "credit-rating", base: 0, occupation: entry.cr }, ...entry.extra],
      ...(entry.pointFormula ? { pointFormula: entry.pointFormula } : {}),
    });
    if (!result.valid) bad.push(`${entry.slug}: ${budgetCodes(result)}`);
    if (result.creditRating?.value !== entry.cr) bad.push(`${entry.slug}: cr ${result.creditRating?.value}`);
    if (result.budgets?.occupation.max !== entry.budget) bad.push(`${entry.slug}: max ${result.budgets?.occupation.max}`);
  }
  // Every shipped occupation, including the M7 batch: pin the first printed
  // formula, allocate only Credit Rating at its minimum and expect the exact
  // pool from the whitelisted evaluator. This catches a record whose formula
  // and credit range disagree with its own pack document.
  for (const doc of allProfDocs) {
    const coc = doc.flags.brp.coc;
    const first = (coc.pointFormulas ?? [coc.pointFormula])[0];
    const result = validateAllocation({
      profession: doc,
      stats: creationStats,
      skills: [{ key: "credit-rating", base: 0, occupation: coc.creditMin }],
      ...(coc.pointFormulas ? { pointFormula: first } : {}),
    });
    if (!result.valid) bad.push(`${coc.slug}: ${budgetCodes(result)}`);
    if (result.creditRating?.value !== coc.creditMin) bad.push(`${coc.slug}: cr ${result.creditRating?.value}`);
    const expectedMax = evaluatePointFormula(first, creationStats);
    if (result.budgets?.occupation.max !== expectedMax) {
      bad.push(`${coc.slug}: max ${result.budgets?.occupation.max} != ${expectedMax} for ${first}`);
    }
  }
  return bad.length ? bad : true;
})(), null);

check("artistEitherOrFormulaSelectsPowOrDexExplicitly", (() => {
  const base = [{ key: "credit-rating", base: 0, occupation: 9 }];
  const byPow = validateAllocation({
    profession: profession("artist"), stats: creationStats, skills: base, pointFormula: "EDU*2+POW*2",
  });
  const byDex = validateAllocation({
    profession: profession("artist"), stats: creationStats, skills: base, pointFormula: "EDU*2+DEX*2",
  });
  const unpinned = validateAllocation({ profession: profession("artist"), stats: creationStats, skills: base });
  const appChoice = validateAllocation({
    profession: profession("artist"), stats: creationStats, skills: base, pointFormula: "EDU*2+APP*2",
  });
  return byPow.valid && byPow.budgets.occupation.max === 210
    && byPow.budgets.occupation.formula === "EDU*2+POW*2"
    && byDex.valid && byDex.budgets.occupation.max === 260
    && byDex.budgets.occupation.formula === "EDU*2+DEX*2"
    && byPow.budgets.occupation.formulas.length === 2
    && !unpinned.valid && unpinned.budgets === null
    && budgetCodes(unpinned).includes("formula-choice-required")
    && budgetCodes(appChoice).includes("formula-not-allowed");
})(), budgetCodes(validateAllocation({
  profession: profession("artist"), stats: creationStats, skills: [{ key: "credit-rating", base: 0, occupation: 9 }],
  pointFormula: "EDU*2+APP*2",
})));

check("specialismIdentityRequiresAsciiKeysAndProjectedNames", (() => {
  const ok = buildSpecialism({
    parentKey: "science", specKey: "geology", specName: "地质学", mainName: "科学",
    base: 1, baseSourceRefs: ["coc-sheet-1920s"],
  });
  const cjkKebab = (() => { try { specialismBrpid("科学", "地质学"); return false; } catch (thrown) { return thrown.code === "id-not-ascii"; } })();
  const placeholder = (() => { try { specialismKey("art-craft", "any"); return false; } catch (thrown) { return thrown.code === "spec-key-placeholder"; } })();
  return ok.brpid === "i.skill.coc.science-geology"
    && ok.key === "science-geology"
    && ok.chosen === true && ok.specName === "地质学" && ok.mainName === "科学"
    && ok.name === "科学（地质学）" && ok.base === 1
    && specialismKey("firearms", "handgun") === "firearms/handgun"
    && specialismKey("firearms", "handgun") !== specialismKey("firearms", "rifle-shotgun")
    && cjkKebab && placeholder;
})(), (() => { try { buildSpecialism({ parentKey: "science", specKey: "geology", specName: "", mainName: "科学", base: 1 }); return "accepted"; } catch (thrown) { return thrown.code; } })());

check("specialismRejectsUnverifiedZeroAndMissingBase", (() => {
  const zero = (() => { try { buildSpecialism({ parentKey: "fighting", specKey: "axe", specName: "斧", mainName: "格斗", base: 0, baseSource: "explicit" }); return false; } catch (thrown) { return thrown.code === "base-explicit-zero"; } })();
  const missing = (() => { try { buildSpecialism({ parentKey: "fighting", specKey: "axe", specName: "斧", mainName: "格斗", base: null }); return false; } catch (thrown) { return thrown.code === "base-missing"; } })();
  const unproven = (() => { try { buildSpecialism({ parentKey: "science", specKey: "geology", specName: "地质学", mainName: "科学", base: 1 }); return false; } catch (thrown) { return thrown.code === "base-source-unproven"; } })();
  const explicitOk = buildSpecialism({ parentKey: "science", specKey: "geology", specName: "地质学", mainName: "科学", base: 1, baseSource: "explicit" });
  return zero && missing && unproven && explicitOk.base === 1 && explicitOk.baseSource === "explicit";
})(), {
  zero: (() => { try { buildSpecialism({ parentKey: "fighting", specKey: "axe", specName: "斧", mainName: "格斗", base: 0, baseSource: "explicit" }); return "accepted"; } catch (thrown) { return thrown.code; } })(),
  missing: (() => { try { buildSpecialism({ parentKey: "fighting", specKey: "axe", specName: "斧", mainName: "格斗", base: null }); return "accepted"; } catch (thrown) { return thrown.code; } })(),
});

check("allocationSpecialismStaysInStepWithIdentityRules", (() => {
  const valid = alloc("author", [
    { key: "credit-rating", base: 0, occupation: 9 },
    {
      key: "art-craft-literature", base: 5, occupation: 20,
      specialism: { parentKey: "art-craft", specKey: "literature", specName: "文学", mainName: "艺术/手艺", base: 5, baseSourceRefs: ["coc-sheet-1920s"] },
    },
  ]);
  const placeholder = alloc("author", [
    { key: "credit-rating", base: 0, occupation: 9 },
    {
      key: "art-craft-other", base: 0, occupation: 20,
      specialism: { parentKey: "art-craft", specKey: "any", specName: "其他", mainName: "艺术/手艺", base: 5, baseSourceRefs: ["coc-sheet-1920s"] },
    },
  ]);
  const unnamed = alloc("author", [
    { key: "credit-rating", base: 0, occupation: 9 },
    {
      key: "art-craft-sculpture", base: 5, occupation: 20,
      specialism: { parentKey: "art-craft", specKey: "sculpture", specName: "", mainName: "艺术/手艺", base: 5, baseSourceRefs: ["coc-sheet-1920s"] },
    },
  ]);
  return valid.valid
    && valid.totals.some((row) => row.key === "art-craft-literature" && row.base === 5 && row.total === 25)
    && budgetCodes(placeholder).includes("spec-key-placeholder")
    && budgetCodes(unnamed).includes("spec-name-missing");
})(), {
  placeholder: budgetCodes(alloc("author", [
    { key: "credit-rating", base: 0, occupation: 9 },
    { key: "art-craft-other", base: 0, occupation: 20,
      specialism: { parentKey: "art-craft", specKey: "any", specName: "其他", mainName: "艺术/手艺", base: 5, baseSourceRefs: ["coc-sheet-1920s"] } },
  ])),
  unnamed: budgetCodes(alloc("author", [
    { key: "credit-rating", base: 0, occupation: 9 },
    { key: "art-craft-sculpture", base: 5, occupation: 20,
      specialism: { parentKey: "art-craft", specKey: "sculpture", specName: "", mainName: "艺术/手艺", base: 5, baseSourceRefs: ["coc-sheet-1920s"] } },
  ])),
});

check("creationModuleHasNoEvalAndIsFrameworkFree", (() => {
  const source = readFileSync(join(ROOT, "module/rules/creation.mjs"), "utf8");
  const code = source.replace(/\/\/[^\n]*/g, "").replace(/`[^`]*`/g, "");
  return !/\beval\s*\(/.test(code)
    && !/new\s+Function\s*\(/.test(code)
    && !/\bgame\./.test(code)
    && !/\bfoundry\./.test(code)
    && !/^\s*import\s/m.test(code.split("\n").filter((line) => !line.startsWith("//")).join("\n"))
    && /export\s+function\s+evaluatePointFormula/.test(source)
    && /export\s+function\s+interestPoints/.test(source)
    && /export\s+function\s+validateAllocation/.test(source)
    && /export\s+function\s+specialismBrpid/.test(source);
})(), (() => {
  const source = readFileSync(join(ROOT, "module/rules/creation.mjs"), "utf8");
  return { eval: /\beval\s*\(/.test(source), foundry: /foundry\./.test(source), imports: /^\s*import\s/m.test(source) };
})());

check("cocBrawlAndSpecialismKeysStayDistinctPerParent", (() => {
  const brawl = skillDoc("fighting-brawl");
  const handgun = skillDoc("firearms-handgun");
  const rifle = skillDoc("firearms-rifle-shotgun");
  return specialismKey(brawl.flags.brp.coc.parentKey ?? "fighting", brawl.flags.brp.coc.specKey) === "fighting/brawl"
    && specialismBrpid(handgun.flags.brp.coc.parentKey ?? "firearms", handgun.flags.brp.coc.specKey) === handgun.flags.brp.brpidFlag.id
    && specialismBrpid(rifle.flags.brp.coc.parentKey ?? "firearms", rifle.flags.brp.coc.specKey) === rifle.flags.brp.brpidFlag.id;
})());

check("professionDocIdsAreDeterministicFromSlug", (() => {
  const rebuild = (seed) => {
    let out = "";
    let i = 0;
    while (out.length < 16) {
      const byte = createHash("sha256").update(`coc:${seed}:${i}`).digest()[0];
      out += "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[byte % 62];
      i += 1;
    }
    return out;
  };
  return allProfDocs.every((doc) => doc._id === rebuild(`profession-${doc.flags.brp.brpidFlag.id}`))
    && new Set(allProfDocs.map((doc) => doc._id)).size === allProfDocs.length;
})(), allProfDocs.map((doc) => doc._id));

check("packProfessionDocumentFeedsValidateAllocationDirectly", (() => {
  // The builder will hand the pack document straight in, so normalization
  // must land on the same numbers the source record produces.
  const doc = profBySlug.get("explorer");
  const normalized = professionRules(doc);
  const result = validateAllocation({
    profession: doc,
    stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 55 }],
    pointFormula: "EDU*2+DEX*2",
  });
  const unpinned = validateAllocation({
    profession: doc,
    stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 55 }],
  });
  return normalized.pointFormula === "EDU*2+APP*2"
    && JSON.stringify(normalized.pointFormulas) === JSON.stringify(["EDU*2+APP*2", "EDU*2+DEX*2", "EDU*2+STR*2"])
    && normalized.creditMin === 55 && normalized.creditMax === 80
    && normalized.contentSource === "coc"
    && result.valid && result.budgets.occupation.max === 260
    // The same pack document refuses to guess which characteristic the player
    // intends: an unpinned either/or record has no budget at all.
    && !unpinned.valid && unpinned.budgets === null
    && budgetCodes(unpinned).includes("formula-choice-required");
})(), (() => {
  try { return professionRules(profBySlug.get("explorer")).pointFormulas; } catch (thrown) { return thrown.code; }
})());

check("professionRulesRejectsIncompleteOrForeignRecords", (() => {
  const codeOf = (source) => { try { professionRules(source); return "accepted"; } catch (thrown) { return thrown.code; } };
  const noRange = codeOf({ pointFormula: "EDU*4" });
  const badFormula = codeOf({ pointFormula: "EDU*5", creditMin: 0, creditMax: 10 });
  const foreign = codeOf({
    name: "冒牌", flags: { brp: { contentSource: "octopus", coc: { slug: "fake", pointFormula: "EDU*4", creditMin: 1, creditMax: 2 } } },
  });
  const missing = codeOf(null);
  const fromPack = professionRules(profBySlug.get("soldier"));
  return noRange === "credit-range-missing"
    && badFormula === "formula-not-allowed"
    && foreign === "profession-source-invalid"
    && missing === "profession-missing"
    && fromPack.creditMin === 9 && fromPack.creditMax === 30;
})(), {
  noRange: (() => { try { professionRules({ pointFormula: "EDU*4" }); return "accepted"; } catch (thrown) { return thrown.code; } })(),
  foreign: (() => { try { professionRules({ name: "冒牌", flags: { brp: { contentSource: "octopus", coc: { slug: "fake", pointFormula: "EDU*4", creditMin: 1, creditMax: 2 } } } }); return "accepted"; } catch (thrown) { return thrown.code; } })(),
});

check("validateAllocationFailsClosedOnPackDocWithBadFacts", (() => {
  const broken = {
    name: "残缺职业",
    flags: { brp: { brpidFlag: { id: "i.profession.coc.broken" }, contentSource: "coc", coc: { slug: "broken" } } },
  };
  const result = validateAllocation({ profession: broken, stats: creationStats, skills: [{ key: "credit-rating", base: 0, occupation: 0 }] });
  return !result.valid && result.budgets === null
    && result.errors.some((entry) => entry.code === "credit-range-missing");
})(), validateAllocation({
  profession: { name: "残缺职业", flags: { brp: { brpidFlag: { id: "i.profession.coc.broken" }, contentSource: "coc", coc: { slug: "broken" } } } },
  stats: creationStats, skills: [{ key: "credit-rating", base: 0, occupation: 0 }],
}).errors.map((entry) => entry.code));

const digest = (path) => createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex");
const result = {
  checks: Object.keys(checks).length,
  failed: errors.length,
  errors,
  summary: checks,
  hashes: {
    cocSkillsJson: digest("packs-json/coc-skills.json"),
    cocSkillsIndex: digest("packs-index/coc-skills.json"),
    cocProfessionsJson: digest("packs-json/coc-professions.json"),
    cocProfessionsIndex: digest("packs-index/coc-professions.json"),
    octopusSkillsJson: digest("packs-json/octopus-skills.json"),
    octopusProfessionsJson: digest("packs-json/octopus-professions.json"),
  },
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exit(1);
