// CoC source-repo regression probe (core skills, core occupations, creation,
// combat/wounds, SAN/Luck/growth; no Foundry required).
//
//   node tools/tests/coc-rules-regressions.mjs
//
// Covers:
//   1. deterministic core pack build (60 skills + 9 profession entries) and
//      byte-unchanged octopus artifacts
//   2. core-only fact/pack contract: exact counts, specialism identity,
//      pending exclusion, source isolation, no fixed 0 for unverified skills,
//      and a hard assertion that no extension pack or build chain is present
//   3. centralized rules: derived attributes, SAN/Luck, success bands, growth,
//      skill formula rounding, native APP/CHA key preservation
//   4. negative cases: BRP and CoC differ where they must, no cross-pack bleed
//   5. core occupations: formula/credit range per source, wealth band never
//      used as CR, resolvable skill refs, deterministic ids, eight-skill shape,
//      unique identities
//   6. core creation rules: whitelist AST, either/or point formulas (incl. POW),
//      INT x 2, credit-rating rules, mythos ban, explicit base values, no base
//      folding, specialism identity
//   7. pure combat/wounds: band ranks, required-band difficulty, bonus/penalty
//      tens pools, weapon profiles/extreme damage/half DB, opposed ties, dodge/
//      fightback/cover, Build/outnumbering/shots/point-blank, major wound/dying/
//      instant death and the healing bands
//   8. core provenance: every retained record secondary, no official-first-party
//      claim, every cited source registered with an https URL, no public table
//      splicing
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Rules } from "../../module/rules/index.mjs";
import { BRPRules } from "../../module/rules/brp.mjs";
import { CoCSanity } from "../../module/rules/coc-sanity.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
// Same derivation the build uses: document ids come from the stable brpid.
const cocDocId = (seed) => {
  let out = "";
  let i = 0;
  while (out.length < 16) {
    const byte = createHash("sha256").update("coc:" + seed + ":" + i).digest()[0];
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

// --- 1) deterministic core build and octopus isolation ---
const CORE_DIRS = ["packs-json", "packs-index", "packs"];
const temp = mkdtempSync(join(tmpdir(), "octopus-coc-build-"));
try {
  for (const item of ["content", "tools/coc-pack", "module/rules", "system.json", "packs-json", "packs-index", "packs"]) {
    const src = join(ROOT, item);
    if (!existsSync(src)) throw new Error(`missing seed: ${item}`);
    cpSync(src, join(temp, item), { recursive: true });
  }
  const build = () => {
    const result = spawnSync(process.execPath, ["tools/coc-pack/build.mjs"], { cwd: temp, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`build failed (${result.status}): ${result.stderr || result.stdout}`);
    return result.stdout;
  };
  build();
  for (const dir of CORE_DIRS) cpSync(join(temp, dir), join(temp, `__run1/${dir}`), { recursive: true });
  cpSync(join(temp, "system.json"), join(temp, "__run1/system.json"));
  build();
  const consecutive = compareTrees(join(temp, "__run1"), temp, CORE_DIRS);
  if (!existsSync(join(temp, "__run1/system.json")) || !readFileSync(join(temp, "system.json")).equals(readFileSync(join(temp, "__run1/system.json")))) {
    consecutive.push("system.json: bytes differ");
  }
  check("buildConsecutiveByteIdentical", consecutive.length === 0, consecutive.slice(0, 8));

  const cocCommitted = compareTrees(temp, ROOT, CORE_DIRS);
  check("coreBuildMatchesCommittedArtifacts", cocCommitted.length === 0, cocCommitted.slice(0, 8));

  check("buildDoesNotWriteModulesTree", !existsSync(join(temp, "modules")), join(temp, "modules"));
  check("buildDoesNotWriteExtensionTree", !existsSync(join(temp, "arcane-investigator-options"))
    && !readdirSync(join(temp, "packs-json")).some((name) => name.startsWith("arcane-investigator-")),
    readdirSync(join(temp, "packs-json")));

  const octopusTemp = compareTrees(join(temp, "packs-json"), join(ROOT, "packs-json"), ["."]);
  const octopusIndex = compareTrees(join(temp, "packs-index"), join(ROOT, "packs-index"), ["."]);
  const octopusPacks = compareTrees(join(temp, "packs"), join(ROOT, "packs"), ["."]);
  check("octopusArtifactsByteUnchanged", octopusTemp.length === 0 && octopusIndex.length === 0 && octopusPacks.length === 0,
    { packsJson: octopusTemp.slice(0, 4), packsIndex: octopusIndex.slice(0, 4), packs: octopusPacks.slice(0, 4) });
} finally {
  rmSync(temp, { recursive: true, force: true });
}

// --- 2) core facts and pack contract ---
const facts = readJson("content/coc/skills.json");
const provenance = readJson("content/coc/provenance.json");
const cocDocs = readJson("packs-json/coc-skills.json");
const cocIndex = readJson("packs-index/coc-skills.json");
const allSkillDocs = [...cocDocs];
const octopusDocs = readJson("packs-json/octopus-skills.json");
const docsByKey = new Map(allSkillDocs.map((doc) => [doc.flags.brp.coc.key, doc]));
const factsByKey = new Map(facts.skills.map((fact) => [fact.key, fact]));

const CORE_SKILL_COUNT = 60;
check("factCount", facts.skills.length === CORE_SKILL_COUNT
  && cocDocs.length === CORE_SKILL_COUNT && cocIndex.length === CORE_SKILL_COUNT
  && allSkillDocs.length === facts.skills.length
  && facts.packSplit?.counts?.core === CORE_SKILL_COUNT,
  { facts: facts.skills.length, core: cocDocs.length, split: facts.packSplit });

check("coreOnlyFactSource", facts.skills.every((skill) => skill.pack === "core")
  && !JSON.stringify(facts).includes('"expand"')
  && !JSON.stringify(facts).includes("arcane-investigator"),
  facts.skills.filter((skill) => skill.pack !== "core").map((skill) => skill.key));

check("splitIsPartitionOfTheFactSource", (() => {
  const factKeys = facts.skills.map((skill) => skill.key);
  const emitted = allSkillDocs.map((doc) => doc.flags.brp.coc.key);
  const brpids = allSkillDocs.map((doc) => doc.flags.brp.brpidFlag.id);
  const bad = [];
  if (!facts.skills.every((skill) => skill.pack === "core")) bad.push("fact without the core pack tag");
  if (new Set(emitted).size !== emitted.length) bad.push("skill emitted twice");
  if (new Set(brpids).size !== brpids.length) bad.push("brpid reused");
  if (JSON.stringify(emitted) !== JSON.stringify(factKeys)) bad.push("core pack order differs from facts");
  if (cocDocs.some((doc) => doc.flags.brp.coc.pack !== "core")) bad.push("core doc tagged non-core");
  return bad.length ? bad : true;
})(), facts.packSplit);

check("documentIdsUniqueAndDeterministic", new Set(allSkillDocs.map((doc) => doc._id)).size === allSkillDocs.length
  && allSkillDocs.every((doc) => /^[A-Za-z0-9]{16}$/.test(doc._id))
  && new Set(cocIndex.map((doc) => doc._id)).size === cocIndex.length,
  { docs: allSkillDocs.length, unique: new Set(allSkillDocs.map((doc) => doc._id)).size });

check("documentIdsDeriveFromBrpidOnlyAndAreStable", (() => {
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

check("systemHasExactlyFourCorePacks", (() => {
  // Two octopus packs + two CoC core packs. No extension pack is declared and
  // no extension name appears anywhere in system.json.
  const sys = readJson("system.json");
  const names = (sys.packs ?? []).map((entry) => entry.name).sort();
  return JSON.stringify(names) === JSON.stringify(["coc-professions", "coc-skills", "octopus-professions", "octopus-skills"])
    && !JSON.stringify(sys).includes("arcane-investigator");
})());

check("extensionBuildChainIsAbsent", !existsSync(join(ROOT, "tools/coc-pack/import-sealdice-occupations.mjs"))
  && !existsSync(join(ROOT, "tools/coc-pack/leveldb.mjs"))
  && !readdirSync(join(ROOT, "packs")).some((name) => name.startsWith("arcane-investigator-"))
  && !readdirSync(join(ROOT, "packs-index")).some((name) => name.startsWith("arcane-investigator-"))
  && !readdirSync(join(ROOT, "packs-json")).some((name) => name.startsWith("arcane-investigator-")),
  { packs: readdirSync(join(ROOT, "packs")), packsJson: readdirSync(join(ROOT, "packs-json")) });

check("pendingSpecialismsExcluded", (facts.pendingSpecialisms ?? []).length === 7
  && (facts.pendingSpecialisms ?? []).every((pending) => pending.base === null
    && pending.status === "pending-official-source"
    && !docsByKey.has(pending.factId)
    && !allSkillDocs.some((doc) => doc.flags.brp.coc.factId === pending.factId)),
  { pending: facts.pendingSpecialisms?.length, emitted: allSkillDocs.filter((doc) => doc.flags.brp.coc.status === "pending-official-source").length });

const core = {
  "credit-rating": "0",
  "cthulhu-mythos": "0",
  "library-use": "20",
  "fighting-brawl": "25",
  "firearms-handgun": "20",
  "firearms-rifle-shotgun": "25",
};
check("coreSkillValues", Object.entries(core).every(([key, base]) => docsByKey.get(key)?.system.base === base)
  && allSkillDocs.every((doc) => typeof doc.system.base === "string"),
  Object.fromEntries(Object.keys(core).map((key) => [key, docsByKey.get(key)?.system.base])));

const dodge = docsByKey.get("dodge");
const own = docsByKey.get("language-own");
const dodgeFact = factsByKey.get("dodge");
const ownFact = factsByKey.get("language-own");
check("formulaSkillsUseCreationFactsWithoutLegacyItemFields", dodgeFact?.variable === true
  && dodgeFact.baseFormula["1"].stat === "dex" && dodgeFact.baseFormula["1"].value === 0.5
  && ownFact?.variable === true
  && ownFact.baseFormula["1"].stat === "edu" && ownFact.baseFormula["1"].value === 1
  && [dodge, own].every((doc) => doc?.system.base === "0"
    && doc.system.variable === undefined && doc.system.baseFormula === undefined
    && typeof doc.system.skillName === "string" && doc.system.specialization === ""
    && typeof doc.system.properties?.push === "boolean"),
  { dodgeFact, ownFact, dodge: dodge?.system, own: own?.system });

check("noFixedZeroOutsideOfficialZeroSkills", allSkillDocs.filter((doc) => doc.system.base === "0"
    && !factsByKey.get(doc.flags.brp.coc.key)?.variable)
  .every((doc) => ["credit-rating", "cthulhu-mythos"].includes(doc.flags.brp.coc.key)),
  allSkillDocs.filter((doc) => doc.system.base === "0").map((doc) => doc.flags.brp.coc.key));

const brpidRe = /^i\.skill\.coc\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const specIds = new Set();
check("brpidAsciiAndUnique", allSkillDocs.every((doc) => brpidRe.test(doc.flags.brp.brpidFlag.id))
  && new Set(allSkillDocs.map((doc) => doc.flags.brp.brpidFlag.id)).size === allSkillDocs.length,
  allSkillDocs.filter((doc) => !brpidRe.test(doc.flags.brp.brpidFlag.id)).map((doc) => doc.flags.brp.brpidFlag.id));

const specDocs = allSkillDocs.filter((doc) => doc.system.specialization);
const CORE_SPECIALISM_COUNT = 22;
check("specialismIdentityIndependent", specDocs.length === CORE_SPECIALISM_COUNT && specDocs.every((doc) => {
  const specKey = doc.flags.brp.coc.specKey;
  const parentKey = doc.flags.brp.coc.parentKey;
  if (!specKey || !parentKey || !doc.system.skillName || doc.system.specialization !== doc.name
    || typeof doc.system.properties?.push !== "boolean"
    || doc.system.specialism !== undefined || doc.system.chosen !== undefined) return false;
  const id = `${parentKey}/${specKey}`;
  if (specIds.has(id)) return false;
  specIds.add(id);
  return true;
}), { count: specDocs.length, ids: [...specIds] });

check("allDocsTaggedCocAndStarterSafe", allSkillDocs.every((doc) => doc.flags.brp.contentSource === "coc" && doc.system.basic === true),
  allSkillDocs.filter((doc) => doc.flags.brp.contentSource !== "coc" || doc.system.basic !== true).map((doc) => doc.flags.brp.coc.key));

// Core specialisms added after the first batch, all verified as secondary evidence.
const CORE_SPECIALISMS = {
  "science-pharmacy": { parentKey: "science", specKey: "pharmacy", base: 1, mainName: "科学" },
  "science-engineering": { parentKey: "science", specKey: "engineering", base: 1, mainName: "科学" },
  "science-physics": { parentKey: "science", specKey: "physics", base: 1, mainName: "科学" },
  "science-astronomy": { parentKey: "science", specKey: "astronomy", base: 1, mainName: "科学" },
  "science-zoology": { parentKey: "science", specKey: "zoology", base: 1, mainName: "科学" },
  "science-forensics": { parentKey: "science", specKey: "forensics", base: 1, mainName: "科学" },
  "art-craft-acting": { parentKey: "art-craft", specKey: "acting", base: 5, mainName: "艺术/手艺" },
  "art-craft-technical-drawing": { parentKey: "art-craft", specKey: "technical-drawing", base: 5, mainName: "艺术/手艺" },
};
check("coreSpecialismsCarryFamilyBaseAndIdentity", (() => {
  const bad = [];
  for (const [key, expected] of Object.entries(CORE_SPECIALISMS)) {
    const doc = docsByKey.get(key);
    if (!doc) { bad.push(`${key}: missing`); continue; }
    const coc = doc.flags.brp.coc;
    if (coc.parentKey !== expected.parentKey) bad.push(`${key}: parentKey ${coc.parentKey}`);
    if (coc.specKey !== expected.specKey) bad.push(`${key}: specKey ${coc.specKey}`);
    if (doc.system.base !== String(expected.base)) bad.push(`${key}: base ${doc.system.base}`);
    if (!doc.system.specialization || doc.system.specialism !== undefined || doc.system.chosen !== undefined
      || typeof doc.system.properties?.push !== "boolean") bad.push(`${key}: not a native specialism`);
    if (doc.system.skillName !== expected.mainName) bad.push(`${key}: skillName ${doc.system.skillName}`);
    if (doc.system.specialization !== doc.name) bad.push(`${key}: specialization ${doc.system.specialization}`);
    if (doc.flags.brp.brpidFlag.id !== `i.skill.coc.${key}`) bad.push(`${key}: brpid ${doc.flags.brp.brpidFlag.id}`);
    if (!(coc.sourceRefs ?? []).length) bad.push(`${key}: no sourceRefs`);
  }
  return bad.length ? bad : true;
})(), Object.keys(CORE_SPECIALISMS).map((key) => [key, docsByKey.get(key)?.system?.base]));

check("skillFamiliesConcreteCoversEveryPublishedSpecialism", (() => {
  // The profession families are the builder's pick-list: a concrete specialism
  // that exists in the skill pack but is missing from its family can never be
  // chosen, so the two lists must agree in both directions.
  const bad = [];
  const families = readJson("content/coc/professions.json").skillFamilies ?? {};
  const published = new Map(specDocs.map((doc) => [`${doc.flags.brp.coc.parentKey}/${doc.flags.brp.coc.specKey}`, doc]));
  const listed = new Set();
  for (const [familyKey, family] of Object.entries(families)) {
    for (const key of family.concrete ?? []) {
      const doc = docsByKey.get(key);
      if (!doc) { bad.push(`${familyKey}: unknown concrete ${key}`); continue; }
      if (doc.flags.brp.coc.parentKey !== family.parentKey) bad.push(`${familyKey}: ${key} parent ${doc.flags.brp.coc.parentKey}`);
      if (family.base === null) {
        if (family.requiresExplicitBase !== true) bad.push(`${familyKey}: null base without requiresExplicitBase`);
        if (typeof doc.system.base !== "string" || !/^\d+$/.test(doc.system.base)) {
          bad.push(`${familyKey}: ${key} has no verified member base`);
        }
      } else if (doc.system.base !== String(family.base)) {
        bad.push(`${familyKey}: ${key} base ${doc.system.base} != ${family.base}`);
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
check("noStatsAppInContent", !JSON.stringify(facts).includes('"app"') && !JSON.stringify(allSkillDocs).includes('"stats"'));

// --- 3) centralized rules ---
const coc = Rules.for("coc");
const cocAlias = Rules.for("coc7");
const runtimeOctopus = Rules.for("octopus");
const nativeSystem = (values) => ({
  characteristics: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, formula: "" }])),
  attribs: {
    hp: { auto: true, value: null, max: null },
    mp: { auto: true, value: null, max: null },
  },
});
const actorData = { type: "character", system: { infos: { age: 40 } } };

const aliasDerived = cocAlias.deriveSecondary({
  actorData,
  systemData: nativeSystem({ con: 50, siz: 50, pow: 40, str: 60, dex: 55 }),
});
check("coc7AliasResolvesToCocAdapter", cocAlias === coc && cocAlias.id === "coc"
  && Rules.for("coc") === coc && Rules.active("coc7") === coc
  && Rules.normalizeId("coc7") === "coc"
  && runtimeOctopus === coc && Rules.active("octopus") === coc
  && Rules.normalizeId("octopus") === "coc"
  && aliasDerived.healthMax === 10 && aliasDerived.powerMax === 8
  && cocAlias.check.successLevel({ rollVal: 96, targetScore: 40 }) === 0
  && runtimeOctopus.check.successLevel({ rollVal: 96, targetScore: 40 }) === 0
  && BRPRules.check.successLevel({ rollVal: 96, targetScore: 40 }) === 1,
  {
    aliasId: cocAlias.id,
    hp: aliasDerived.healthMax,
    mp: aliasDerived.powerMax,
    coc96: cocAlias.check.successLevel({ rollVal: 96, targetScore: 40 }),
    octopus96: runtimeOctopus.check.successLevel({ rollVal: 96, targetScore: 40 }),
    historical96: BRPRules.check.successLevel({ rollVal: 96, targetScore: 40 }),
  });
check("unknownRulesetFallsBackToCoc", Rules.for("unknown") === coc
  && Rules.active("unknown") === coc && Rules.for("coc7") === Rules.for("unknown")
  && Rules.normalizeId("unknown") === "coc" && Rules.defaultId === "coc"
  && JSON.stringify(Rules.ids) === JSON.stringify(["coc"]),
  { unknown: Rules.for("unknown").id, coc7: Rules.for("coc7").id, ids: Rules.ids });

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
  && runtimeOctopus.check.characteristicTarget(60) === 60
  && BRPRules.check.characteristicTarget(60) === 300,
  { coc: coc.check.characteristicTarget(60), octopus: runtimeOctopus.check.characteristicTarget(60),
    historical: BRPRules.check.characteristicTarget(60) });
check("cocDifficultyIsRequiredBandNotMultiplier", coc.check.requiredBand("average") === "regular"
  && coc.check.requiredBand("regular") === "regular"
  && coc.check.requiredBand("hard") === "hard"
  && coc.check.requiredBand("difficult") === "hard"
  && coc.check.requiredBand("extreme") === "extreme"
  && coc.check.requiredBand("no-such-difficulty") === "regular"
  && runtimeOctopus.check.requiredBand("hard") === "hard"
  && BRPRules.check.requiredBand("hard") === null,
  { hard: coc.check.requiredBand("hard"), extreme: coc.check.requiredBand("extreme"),
    octopus: runtimeOctopus.check.requiredBand("hard"), historical: BRPRules.check.requiredBand("hard") });
check("cocBonusDiceEnabledForRuntimeAliases", coc.check.supportsBonusDice === true
  && runtimeOctopus.check.supportsBonusDice === true
  && BRPRules.check.supportsBonusDice === false,
  { coc: coc.check.supportsBonusDice, octopus: runtimeOctopus.check.supportsBonusDice,
    historical: BRPRules.check.supportsBonusDice });
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
  && runtimeOctopus.check.d100Formula({ penalty: 2 }) === "4D10"
  && BRPRules.check.d100Formula === undefined,
  { plain: coc.check.d100Formula({}), bonus: coc.check.d100Formula({ bonus: 1 }),
    penalty2: coc.check.d100Formula({ penalty: 2 }), octopus: runtimeOctopus.check.d100Formula({ penalty: 2 }) });
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
    system: {
      range: { normal: { damage: "1D3" } },
      properties: { impl: false, addb: true, ahdb: false, rngd: false },
    },
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
check("cocWeaponProfileFirearmNoDbUsesNativeImpale", (() => {
  const gun = coc.combat.weaponProfile({
    system: {
      range: { normal: { damage: "1D10" }, long: { damage: "1D10" } },
      properties: { impl: true, addb: false, ahdb: false, rngd: true },
      malfunction: 96,
    },
  });
  const nonImpalingGun = coc.combat.weaponProfile({
    system: {
      range: { normal: { damage: "1D10" } },
      properties: { impl: false, addb: false, ahdb: false, rngd: true },
    },
  });
  const thrown = coc.combat.weaponProfile({
    system: {
      range: { normal: { damage: "1D6+1" } },
      properties: { thrown: true, impl: false, addb: false, ahdb: true, rngd: false },
    },
  });
  const spear = coc.combat.weaponProfile({
    system: {
      range: { normal: { damage: "1D8" } },
      properties: { impl: true, addb: true, ahdb: false, rngd: false },
    },
  });
  const marked = coc.combat.weaponProfile({
    system: {
      range: { normal: { damage: "1D8" } },
      properties: { impl: false, addb: true, ahdb: false, rngd: false },
    },
    flags: { brp: { coc: { weapon: { kind: "melee", dbMode: "half", impaling: true } } } },
  });
  return gun.ranged === true && gun.dbMode === "none" && gun.impaling === true && gun.mal === 96
    && nonImpalingGun.ranged === true && nonImpalingGun.dbMode === "none" && nonImpalingGun.impaling === false
    && thrown.ranged === true && thrown.dbMode === "half"
    && spear.impaling === true && spear.dbMode === "full" && spear.formula === "1D8"
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
    systemData: nativeSystem({ str: 80, siz: 80, con: 50, pow: 40, dex: 55 }),
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
  systemData: nativeSystem({ con: 50, siz: 50, pow: 40, str: 60, dex: 55 }),
});
check("cocHpMpBuildDb", derived.healthMax === 10 && derived.powerMax === 8
  && derived.build === 0 && derived.dmgBonus.full === "+0",
  derived);
const odd = coc.deriveSecondary({
  actorData: { system: { infos: { age: 20 } } },
  systemData: nativeSystem({ con: 55, siz: 50, pow: 43, str: 50, dex: 50 }),
});
check("cocHpMpRoundDown", odd.healthMax === 10 && odd.powerMax === 8,
  { hp: odd.healthMax, mp: odd.powerMax });
const movAt = (age) => coc.deriveSecondary({
  actorData: { system: { infos: { age } } },
  systemData: nativeSystem({ con: 40, siz: 50, pow: 40, str: 40, dex: 40 }),
}).mov;
const movEqual = coc.deriveSecondary({
  actorData: { system: { infos: { age: 20 } } },
  systemData: nativeSystem({ con: 40, siz: 50, pow: 40, str: 50, dex: 50 }),
}).mov;
check("cocMovAge", derived.mov === 8 && movAt(20) === 7 && movAt(40) === 6
  && movAt(50) === 5 && movAt(70) === 3 && movEqual === 9,
  { age20: movAt(20), age40: movAt(40), age50: movAt(50), age70: movAt(70), equalToSize: movEqual, dex55: derived.mov });

const dbAt = (strSiz) => coc.deriveSecondary({
  actorData,
  systemData: nativeSystem({ con: 50, siz: 0, pow: 40, str: strSiz, dex: 50 }),
});
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
  && runtimeOctopus.luck.initial({ pow: 40 }).formula === "3D6*5"
  && BRPRules.luck.initial({ pow: 40 }).max === 200,
  { coc: coc.luck.initial({ pow: 40 }), octopus: runtimeOctopus.luck.initial({ pow: 40 }),
    historical: BRPRules.luck.initial({ pow: 40 }) });

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
check("brpSuccessBandsUnchanged", BRPRules.check.successLevel({ rollVal: 3, targetScore: 60 }) === 4
  && BRPRules.check.successLevel({ rollVal: 12, targetScore: 60 }) === 3
  && BRPRules.check.successLevel({ rollVal: 13, targetScore: 60 }) === 2
  && BRPRules.check.successLevel({ rollVal: 96, targetScore: 60 }) === 1
  && BRPRules.check.successLevel({ rollVal: 98, targetScore: 60 }) === 0,
  [3, 12, 13, 60, 96, 98].map((roll) => [roll, BRPRules.check.successLevel({ rollVal: roll, targetScore: 60 })]));

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
check("cocXpGatesSharedByRuntimeAliases", (() => {
  // Every runtime id uses CoC growth gates; the direct BRP adapter remains only
  // a historical pure-algorithm comparison.
  return coc.check.xpSkipsRaisedDifficulty === false && coc.check.xpSkipsNoXP === true
    && runtimeOctopus.check.xpSkipsRaisedDifficulty === false && runtimeOctopus.check.xpSkipsNoXP === true
    && BRPRules.check.xpSkipsRaisedDifficulty === true && BRPRules.check.xpSkipsNoXP === false;
})(), { coc: { raised: coc.check.xpSkipsRaisedDifficulty, noXP: coc.check.xpSkipsNoXP },
  octopus: { raised: runtimeOctopus.check.xpSkipsRaisedDifficulty, noXP: runtimeOctopus.check.xpSkipsNoXP },
  historical: { raised: BRPRules.check.xpSkipsRaisedDifficulty, noXP: BRPRules.check.xpSkipsNoXP } });
check("brpGrowthKeepsIntAndCap", BRPRules.growth.bonus({ system: { xpBonus: 25 } }) === 25
  && BRPRules.growth.check({ roll: 80, targetScore: 100, bonus: 25 }) === true
  && BRPRules.growth.check({ roll: 75, targetScore: 100, bonus: 25 }) === false,
  {
    bonus: BRPRules.growth.bonus({ system: { xpBonus: 25 } }),
    over: BRPRules.growth.check({ roll: 80, targetScore: 100, bonus: 25 }),
    equal: BRPRules.growth.check({ roll: 75, targetScore: 100, bonus: 25 }),
  });

// --- M4 adapter contract: the CoC decision core is the only source of these
// decisions, and every runtime id shares the same adapter.
check("cocM4SanityContract", coc.sanity.core === CoCSanity
  && coc.sanity.core.singleLossTrigger({ loss: 4 }).trigger === false
  && coc.sanity.core.singleLossTrigger({ loss: 5 }).trigger === true
  && coc.sanity.core.temporaryInsanity({ loss: 6, intCheck: null }).status === "pending-int-check"
  && coc.sanity.singleLossThreshold === 5
  && coc.sanity.dailyBasis === "day-start"
  && coc.sanity.coexistingStates === true
  && runtimeOctopus.sanity === coc.sanity
  && runtimeOctopus.sanity.core === CoCSanity && runtimeOctopus.sanity.singleLossThreshold === 5
  && runtimeOctopus.sanity.dailyBasis === "day-start" && runtimeOctopus.sanity.coexistingStates === true,
  { cocCore: coc.sanity.core === CoCSanity, cocThreshold: coc.sanity.singleLossThreshold,
    octopusCore: runtimeOctopus.sanity.core === CoCSanity, octopusThreshold: runtimeOctopus.sanity.singleLossThreshold });

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
  && runtimeOctopus.luck === coc.luck
  && runtimeOctopus.luck.canSpend({ purpose: "SK", rollVal: 50 }).allowed === true
  && runtimeOctopus.luck.canSpend({ purpose: "SN", rollVal: 50 }).allowed === false
  && runtimeOctopus.luck.cap() === 99 && runtimeOctopus.luck.recoveryAction === "new-session"
  && runtimeOctopus.luck.resettlesSanLoss === false && runtimeOctopus.luck.recoveryNeedsRealRoll === true,
  { cocSkill: coc.luck.canSpend({ purpose: "SK", rollVal: 50 }),
    cocSan: coc.luck.canSpend({ purpose: "SN", rollVal: 50 }),
    octopusSkill: runtimeOctopus.luck.canSpend({ purpose: "SK", rollVal: 50 }),
    octopusResettle: runtimeOctopus.luck.resettlesSanLoss });

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
  && runtimeOctopus.growth === coc.growth
  && runtimeOctopus.growth.canTick({ rollType: "SK", resultLevel: 2 }).allowed === true
  && runtimeOctopus.growth.allowFixedTier === false && runtimeOctopus.growth.allowPowImprovement === false
  && runtimeOctopus.growth.ticksOnFailure === false && runtimeOctopus.growth.tickOnLuckSuccess === false,
  { cocSuccess: coc.growth.canTick({ rollType: "SK", resultLevel: 2 }),
    cocLuck: coc.growth.canTick({ rollType: "SK", resultLevel: 2, luckSpent: 3 }),
    octopusFixed: runtimeOctopus.growth.allowFixedTier });

check("cocM4MadnessTables", coc.madness.boutTable.length === 10
  && new Set(coc.madness.boutTable.map((entry) => entry.id)).size === 10
  && coc.madness.manifestationDie === "1D10" && coc.madness.durationDie === "1D10"
  && coc.madness.durationUnit === "hours" && coc.madness.boutRoundsDie === "1D10"
  && coc.madness.autoExpiry === false
  && JSON.stringify(coc.madness.traitBouts) === JSON.stringify(["phobia", "mania"])
  && runtimeOctopus.madness === coc.madness
  && runtimeOctopus.madness.manifestationDie === "1D10" && runtimeOctopus.madness.durationDie === "1D10"
  && runtimeOctopus.madness.boutTable === coc.madness.boutTable && runtimeOctopus.madness.autoExpiry === false,
  { coc: { die: coc.madness.manifestationDie, entries: coc.madness.boutTable.length },
    octopus: { die: runtimeOctopus.madness.manifestationDie, entries: runtimeOctopus.madness.boutTable.length } });

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

check("cocM4I18nFacts", (() => {
  const en = readJson("lang/en.json");
  const zh = readJson("lang/zh-CN.json");
  const ids = coc.madness.boutTable.map((entry) => entry.id);
  const enBouts = en.BRP?.coc?.madness?.bouts ?? {};
  const zhBouts = zh.BRP?.coc?.madness?.bouts ?? {};
  const enDesc = en.BRP?.coc?.madness?.boutsDesc ?? {};
  const zhDesc = zh.BRP?.coc?.madness?.boutsDesc ?? {};
  return ids.every((id) => typeof enBouts[id] === "string" && typeof zhBouts[id] === "string"
      && typeof enDesc[id] === "string" && typeof zhDesc[id] === "string")
    && new Set(ids.map((id) => zhBouts[id])).size === ids.length
    && en.BRP?.madness?.indefiniteInsane && zh.BRP?.madness?.indefiniteInsane
    && typeof en.BRP?.coc?.madness?.durationHours === "string";
})(), { ids: coc.madness.boutTable.map((entry) => entry.id) });

// Native CoC actor schema: the real world pack (CoC7 8.16) stores investigator
// and NPC data under characteristics/attribs/description/infos; vehicles keep
// their own stats/crew/description. There is no BRP stats/health block.
check("cocNativeTemplateContract", (() => {
  const template = readJson("template.json");
  const actor = template.Actor ?? {};
  const item = template.Item ?? {};
  const shared = actor.templates?.coc ?? {};
  const character = actor.character ?? {};
  const npc = actor.npc ?? {};
  const vehicle = actor.vehicle ?? {};
  const characteristics = shared.characteristics ?? {};
  const attribs = shared.attribs ?? {};
  const talent = item.talent ?? {};
  const generic = item.item ?? {};
  const noLegacyVitals = (data) => !Object.hasOwn(data, "stats") && !Object.hasOwn(data, "health");
  return Array.isArray(actor.types)
    && ["character", "npc", "vehicle"].every((type) => actor.types.includes(type))
    && !Object.hasOwn(actor.templates ?? {}, "base")
    && Object.keys(characteristics).join(",") === "str,con,siz,dex,app,int,pow,edu"
    && !Object.hasOwn(characteristics, "cha")
    && Object.values(characteristics).every((entry) => entry.value === 0 && entry.formula === "")
    && ["hp", "mp", "mov", "san", "lck", "db", "build", "armor"].every((key) => Object.hasOwn(attribs, key))
    && attribs.hp.auto === true && attribs.hp.value === null && attribs.hp.max === null
    && attribs.mp.auto === true && attribs.mov.auto === true && attribs.mov.type === "walk"
    && attribs.san.auto === false && attribs.san.max === 99 && attribs.san.dailyLoss === 0
    && attribs.san.dailyLimit === 0 && attribs.lck.value === null
    && attribs.db.auto === true && attribs.build.auto === true
    && attribs.armor.notes === false && attribs.armor.value === null
    && noLegacyVitals(shared) && noLegacyVitals(character) && noLegacyVitals(npc)
    && character.templates?.includes("coc") && npc.templates?.includes("coc")
    && Object.hasOwn(shared, "description") && Object.hasOwn(shared, "conditions")
    && Object.hasOwn(character, "infos") && Object.hasOwn(character, "biography")
    && Object.hasOwn(npc, "infos") && Object.hasOwn(npc, "special")
    && npc.special.sanLoss?.checkPassed === null && npc.special.sanLoss?.checkFailled === null
    && vehicle.templates === undefined
    && Object.hasOwn(vehicle, "stats") && Object.hasOwn(vehicle, "crew") && Object.hasOwn(vehicle, "description")
    && Object.hasOwn(vehicle.stats, "mov") && Object.hasOwn(vehicle.stats, "build")
    && Object.hasOwn(vehicle.stats, "armor") && Object.hasOwn(vehicle.stats, "hp")
    && vehicle.crew.total === "" && typeof vehicle.crew.count === "object"
    && vehicle.description.value === "" && vehicle.description.keeper === ""
    && Array.isArray(item.types) && item.types.includes("talent") && item.types.includes("item")
    && talent.description?.value === "" && talent.description?.keeper === "" && talent.description?.notes === ""
    && talent.source === "" && talent.type?.physical === false && talent.type?.other === false
    && Array.isArray(talent.adjustments)
    && generic.description?.value === "" && generic.description?.keeper === ""
    && generic.quantity === 1 && generic.weight === 0 && typeof generic.price === "object";
})(), (() => {
  const template = readJson("template.json");
  return {
    actorTypes: template.Actor?.types,
    actorTemplates: Object.keys(template.Actor?.templates ?? {}),
    itemTalent: template.Item?.talent ? "registered" : "missing",
    itemGeneric: template.Item?.item ? "registered" : "missing",
  };
})());

const skillDoc = (key) => docsByKey.get(key);
const skillCharacteristics = { dex: { value: 55 }, edu: { value: 60 } };
const brpDodge = { system: { variable: dodgeFact.variable, baseFormula: dodgeFact.baseFormula } };
const brpSkillStats = { dex: { base: 55, redist: 0, culture: 0 }, edu: { base: 60, redist: 0, culture: 0 } };
check("cocSkillFormulaRoundsDown", coc.skillBase({ item: skillDoc("dodge"), characteristics: skillCharacteristics, useEDU: true }) === 27
  && BRPRules.skillBase({ item: brpDodge, stats: brpSkillStats, useEDU: true }) === 28
  && coc.skillBase({ item: skillDoc("language-own"), characteristics: skillCharacteristics, useEDU: true }) === 60,
  {
    cocDodge: coc.skillBase({ item: skillDoc("dodge"), characteristics: skillCharacteristics, useEDU: true }),
    brpDodge: BRPRules.skillBase({ item: brpDodge, stats: brpSkillStats, useEDU: true }),
    own: coc.skillBase({ item: skillDoc("language-own"), characteristics: skillCharacteristics, useEDU: true }),
  });
check("cocAppKeepsNativeAppKey", coc.characteristics.key("app") === "app"
  && coc.characteristics.key("cha") === "cha"
  && runtimeOctopus.characteristics.key("app") === "app",
  { coc: coc.characteristics.key("app"), octopus: runtimeOctopus.characteristics.key("app") });
check("starterRuntimeUnificationAndProvenanceContract", coc.starter.source === "coc" && coc.starter.categories === false
  && coc.starter.brawlBrpid === "i.skill.coc.fighting-brawl"
  && runtimeOctopus.starter === coc.starter
  && runtimeOctopus.starter.source === "coc" && runtimeOctopus.starter.categories === false
  && runtimeOctopus.starter.brawlBrpid === "i.skill.coc.fighting-brawl"
  && Rules.contentSourceOf({ flags: { brp: { contentSource: "coc" } } }) === "coc"
  && Rules.contentSourceOf({ flags: { brp: { brpidFlag: { id: "i.skill.brawl" } } } }) === "octopus",
  { coc: coc.starter, octopus: runtimeOctopus.starter,
    octopusProvenance: Rules.contentSourceOf({ flags: { brp: { brpidFlag: { id: "i.skill.brawl" } } } }) });
check("specialismIndependentGrowthContract", (() => {
  const handgun = skillDoc("firearms-handgun");
  const rifle = skillDoc("firearms-rifle-shotgun");
  return handgun.flags.brp.brpidFlag.id !== rifle.flags.brp.brpidFlag.id
    && handgun.flags.brp.coc.specKey !== rifle.flags.brp.coc.specKey
    && coc.growth.check({ roll: Number(handgun.system.base) + 1, targetScore: handgun.system.base })
    && !coc.growth.check({ roll: rifle.system.base, targetScore: rifle.system.base });
})());

// --- 4) core occupations: data, pack, and creation rules ---
const professionFacts = readJson("content/coc/professions.json");
const profDocs = readJson("packs-json/coc-professions.json");
const profIndex = readJson("packs-index/coc-professions.json");
const allProfDocs = [...profDocs];
const profBySlug = new Map(allProfDocs.map((doc) => [doc.flags.brp.coc.slug, doc]));
const CORE_PROFESSION_COUNT = 9;

check("professionFactCount", professionFacts.professions.length === CORE_PROFESSION_COUNT
  && allProfDocs.length === CORE_PROFESSION_COUNT
  && new Set(allProfDocs.map((doc) => doc._id)).size === CORE_PROFESSION_COUNT
  && allProfDocs.every((doc) => /^[A-Za-z0-9]{16}$/.test(doc._id))
  && professionFacts.packSplit?.counts?.core === CORE_PROFESSION_COUNT,
  { facts: professionFacts.professions.length, docs: allProfDocs.length, split: professionFacts.packSplit });

check("professionSplitIsPartitionOfTheFactSource", (() => {
  const coreSlugs = professionFacts.professions.map((entry) => entry.slug);
  const bad = [];
  if (professionFacts.professions.some((entry) => entry.pack !== "core")) bad.push("fact outside the core pack");
  if (profDocs.length !== CORE_PROFESSION_COUNT || profIndex.length !== CORE_PROFESSION_COUNT) bad.push("core pack size");
  if (new Set(coreSlugs).size !== coreSlugs.length) bad.push("slug in two packs");
  if (JSON.stringify(profDocs.map((doc) => doc.flags.brp.coc.slug)) !== JSON.stringify(coreSlugs)) bad.push("core pack order differs from facts");
  if (profDocs.some((doc) => doc.flags.brp.coc.pack !== "core")) bad.push("core doc tagged non-core");
  return bad.length ? bad : true;
})(), { core: profDocs.length });

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
  author: { formulas: ["EDU*4"], min: 9, max: 30, sources: ["coc-roll20-occupations"] },
  dilettante: { formulas: ["EDU*2+APP*2"], min: 50, max: 99, sources: ["coc-roll20-occupations"] },
  "investigative-journalist": { formulas: ["EDU*4"], min: 9, max: 30, sources: ["coc-roll20-occupations"] },
  "private-investigator": {
    formulas: ["EDU*2+STR*2", "EDU*2+DEX*2"], min: 9, max: 30,
    sources: ["coc-roll20-occupations"], noMax: true,
  },
  professor: { formulas: ["EDU*4"], min: 20, max: 70, sources: ["coc-roll20-occupations"] },
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
  antiquarian: {
    formulas: ["EDU*4"], min: 30, max: 50,
    sources: ["coc-cardwright"], onlySource: "coc-cardwright",
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
    "police-detective": ["EDU*2+DEX*2", "EDU*2+STR*2"],
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
  }
  return bad.length ? bad : true;
})(), ["private-investigator", "police-detective"]
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
    antiquarian: {
      fixed: ["accounting", "appraise", "drive-auto", "history", "library-use", "navigate"],
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
})(), allProfDocs.filter((doc) => ["doctor-of-medicine", "police-detective", "antiquarian"]
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

check("scienceAstronomyIsPublishedInScienceFamily", (() => {
  const doc = docsByKey.get("science-astronomy");
  const family = professionFacts.skillFamilies?.science;
  return doc && family
    && doc.system.base === "1" && doc.system.variable === undefined
    && doc.system.skillName === "科学" && doc.system.specialization === doc.name
    && typeof doc.system.properties?.push === "boolean"
    && doc.flags.brp.coc.parentKey === "science" && doc.flags.brp.coc.specKey === "astronomy"
    && doc.flags.brp.brpidFlag.id === "i.skill.coc.science-astronomy"
    && family.base === 1 && family.concrete.includes("science-astronomy")
    && (doc.flags.brp.coc.sourceRefs ?? []).length > 0;
})(), { doc: docsByKey.get("science-astronomy")?.system, family: professionFacts.skillFamilies?.science });

// Provenance: every retained core fact is registered, every grade is secondary,
// and nothing claims an official first-party source.
const CORE_PROVENANCE = {
  "coc7.occupation.doctor-of-medicine": { sources: ["coc-roll20-occupations", "coc-wiki-skills"], strict: true },
  "coc7.occupation.police-detective": {
    sources: ["coc-roll20-occupations", "coc-wiki-skills"], strict: true,
    formulas: ["EDU*2+DEX*2", "EDU*2+STR*2"],
  },
  "coc7.occupation.antiquarian": { sources: ["coc-cardwright"], formulas: ["EDU*4"], onlySource: true },
};

check("coreProvenanceRegistersEveryRecordAsSecondary", (() => {
  const bad = [];
  for (const [factId, want] of Object.entries(CORE_PROVENANCE)) {
    const record = provenance.occupations.perRecord[factId];
    if (!record) { bad.push(`${factId}: unregistered`); continue; }
    if (record.evidence !== "secondary") bad.push(`${factId}: evidence ${record.evidence}`);
    const refs = record.sourceRefs ?? [];
    for (const source of want.sources) {
      if (!refs.includes(source)) bad.push(`${factId}: missing ${source}`);
    }
    if ((want.strict === false || want.onlySource) && !record.claimBoundary) bad.push(`${factId}: no claimBoundary`);
    if (want.formulas && JSON.stringify(record.formulas) !== JSON.stringify(want.formulas)) {
      bad.push(`${factId}: formulas ${JSON.stringify(record.formulas)}`);
    }
    if (record.formula !== (record.formulas ?? [])[0] && record.formulas) {
      bad.push(`${factId}: formula/list mismatch`);
    }
    if (want.onlySource && JSON.stringify(refs) !== JSON.stringify(want.sources)) {
      bad.push(`${factId}: sourceRefs ${JSON.stringify(refs)}`);
    }
  }
  return bad.length ? bad : true;
})(), Object.keys(provenance.occupations.perRecord ?? {}));

check("coreProvenanceNeverClaimsOfficialFirstParty", (() => {
  const forbidden = ["official", "first-party", "primary", "chaosium-confirmed", "verified-official"];
  const bad = [];
  for (const [factId] of Object.entries(CORE_PROVENANCE)) {
    const record = provenance.occupations.perRecord[factId];
    const grade = String(record?.evidence ?? "");
    if (forbidden.some((word) => grade.toLowerCase().includes(word))) bad.push(`${factId}: ${grade}`);
    const citesWiki = (record?.sourceRefs ?? []).some((ref) => ref.startsWith("coc-wiki"));
    if (citesWiki && CORE_PROVENANCE[factId].strict !== true) bad.push(`${factId}: unauthorised wiki citation`);
  }
  const datasetStatus = String(provenance.occupations.status ?? "");
  if (!datasetStatus.includes("secondary")) bad.push(`occupations.status ${datasetStatus}`);
  return bad.length ? bad : true;
})(), provenance.occupations.status);

check("coreProvenanceSourcesResolveToRegisteredUrls", (() => {
  const ids = new Set(provenance.sources.map((source) => source.id));
  const bad = [];
  for (const [factId, want] of Object.entries(CORE_PROVENANCE)) {
    for (const ref of want.sources) {
      if (!ids.has(ref)) bad.push(`${factId}: ${ref} not registered`);
    }
  }
  for (const id of ["coc-roll20-occupations", "coc-rpgstack-occupations", "coc-cardwright"]) {
    const source = provenance.sources.find((entry) => entry.id === id);
    if (!source) { bad.push(`${id}: missing`); continue; }
    if (!source.url.startsWith("https://")) bad.push(`${id}: url ${source.url}`);
    if (source.evidence !== "secondary") bad.push(`${id}: evidence ${source.evidence}`);
    if (!source.note) bad.push(`${id}: no note`);
  }
  return bad.length ? bad : true;
})(), provenance.sources.filter((source) => source.id.includes("occupations") || source.id === "coc-wiki-skills" || source.id === "coc-cardwright").map((source) => source.id));

check("coreCardwrightProvenanceRecordsUpstreamAndBoundary", (() => {
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

check("professionNeverUsesWealthBandAsCreditRating", allProfDocs.every((doc) => {
  const coc = doc.flags.brp.coc;
  const fact = professionFacts.professions.find((entry) => entry.slug === coc.slug);
  return doc.system.minWealth === 0 && doc.system.maxWealth === 0
    && coc.wealthNotApplicable === true
    && Number.isInteger(coc.creditMin) && Number.isInteger(coc.creditMax)
    && coc.creditMin === fact?.creditMin && coc.creditMax === fact?.creditMax;
}), allProfDocs.map((doc) => [doc.flags.brp.coc.slug, doc.system.minWealth, doc.system.maxWealth]));

check("professionSkillRefsResolveWithinCorePacks", (() => {
  // A core profession must be usable with only the core packs loaded, so every
  // native ref has to come from coc-skills and every document is core.
  const coreSkillBrpids = new Set(cocDocs.map((doc) => doc.flags.brp.brpidFlag.id));
  const bad = [];
  for (const doc of allProfDocs) {
    const slug = doc.flags.brp.coc.slug;
    if (doc.flags.brp.coc.pack !== "core") bad.push(`${slug}: pack ${doc.flags.brp.coc.pack}`);
    for (const ref of [...doc.system.skills, ...doc.system.groups.flatMap((group) => group.skills)]) {
      if (!coreSkillBrpids.has(ref.brpid)) bad.push(`${slug}→${ref.brpid}`);
      if (ref.uuid !== cocDocId(ref.brpid)) bad.push(`${slug}→${ref.brpid}: uuid`);
    }
    for (const ref of doc.system.skills) {
      if (octopusDocs.some((oct) => oct.flags.brp.brpidFlag.id === ref.brpid)) bad.push(`octopus ref ${ref.brpid}`);
    }
  }
  return bad.length ? bad : true;
})(), []);

check("coreFamiliesStaySelfContained", (() => {
  // Every family option is enumerated from core members only. No core document
  // may carry an extension-only pack pointer.
  const coreSkillBrpids = new Set(cocDocs.map((doc) => doc.flags.brp.brpidFlag.id));
  const bad = [];
  for (const doc of profDocs) {
    if (JSON.stringify(doc).includes("expandPackBrpids")) bad.push(`${doc.flags.brp.coc.slug}: expandPackBrpids`);
    for (const group of doc.flags.brp.coc.choiceGroups ?? []) {
      for (const option of group.options) {
        if (option.kind !== "family") continue;
        if (!(option.brpids ?? []).length) bad.push(`${doc.flags.brp.coc.slug}/${group.key}: empty family`);
        for (const brpid of option.brpids ?? []) {
          if (!coreSkillBrpids.has(brpid)) bad.push(`${doc.flags.brp.coc.slug}/${group.key}: ${brpid}`);
        }
      }
    }
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

// Creation rules are exercised against the core pack documents below.

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
    appDexStr: evaluatePointFormula("EDU*2+MAX(APP,DEX,STR)*2", creationStats),
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
  // This table pins every published core occupation; the product-defined
  // template is pinned by customInvestigatorFormulasAreTheFiveWhitelistedOnes.
  const legacyDocs = allProfDocs.filter((doc) => doc.flags.brp.coc.evidence !== "product");
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
  if (powUsers.length) bad.push(`POW users ${JSON.stringify(powUsers)}`);
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

const okAuthor = alloc("author", [
  { key: "credit-rating", base: 0, occupation: 20 },
  { key: "archaeology", base: 1, occupation: 40 },
]);
check("allocationValidPathOnRealProfession", okAuthor.valid
  && okAuthor.budgets.occupation.max === 240
  && okAuthor.budgets.occupation.spent === 60
  && okAuthor.budgets.interest.max === 100
  && okAuthor.creditRating.value === 20
  && okAuthor.creditRating.valid
  && okAuthor.totals.find((row) => row.key === "archaeology").total === 41,
  okAuthor);

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
  budgetCodes(alloc("author", [{ key: "credit-rating", base: 0, occupation: 21 }, { key: "archaeology", base: 1, occupation: 220 }]))
    .includes("budget-occupation-exceeded")
  && budgetCodes(alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 }, { key: "archaeology", base: 1, occupation: 0, interest: 101 }]))
    .includes("budget-interest-exceeded"),
  {
    occupation: budgetCodes(alloc("author", [{ key: "credit-rating", base: 0, occupation: 21 }, { key: "archaeology", base: 1, occupation: 220 }])),
    interest: budgetCodes(alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 }, { key: "archaeology", base: 1, interest: 101 }])),
  });

check("allocationCreditRatingUsesOccupationPointsOnlyAndStaysInRange", (() => {
  const below = alloc("author", [{ key: "credit-rating", base: 0, occupation: 8 }]);
  const above = alloc("author", [{ key: "credit-rating", base: 0, occupation: 31 }]);
  const interestOnly = alloc("author", [{ key: "credit-rating", base: 0, occupation: 10, interest: 20 }]);
  const baseFolded = alloc("author", [{ key: "credit-rating", base: 20, occupation: 10 }]);
  const atMin = alloc("author", [{ key: "credit-rating", base: 0, occupation: 10 }]);
  const atMax = alloc("author", [{ key: "credit-rating", base: 0, occupation: 30 }]);
  return budgetCodes(below).includes("credit-rating-below-min")
    && budgetCodes(above).includes("credit-rating-above-max")
    && budgetCodes(interestOnly).includes("credit-rating-interest")
    && budgetCodes(baseFolded).includes("credit-rating-base")
    && atMin.valid && atMax.valid && atMax.creditRating.value === 30;
})(), {
  below: budgetCodes(alloc("author", [{ key: "credit-rating", base: 0, occupation: 8 }])),
  above: budgetCodes(alloc("author", [{ key: "credit-rating", base: 0, occupation: 31 }])),
  interest: budgetCodes(alloc("author", [{ key: "credit-rating", base: 0, occupation: 10, interest: 20 }])),
});

check("allocationCreditRatingIsMandatory", budgetCodes(alloc("author", [{ key: "archaeology", base: 1, occupation: 10 }]))
  .includes("credit-rating-missing"), budgetCodes(alloc("author", [{ key: "archaeology", base: 1, occupation: 10 }])));

check("allocationRejectsMythosPoints", (() => {
  const result = alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 }, { key: "cthulhu-mythos", base: 0, occupation: 5 }]);
  return budgetCodes(result).includes("mythos-allocation") && !result.valid;
})(), budgetCodes(alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 }, { key: "cthulhu-mythos", base: 0, interest: 5 }])));

check("allocationRejectsMissingOrIllegalBaseValues", (() => {
  const missing = alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 }, { key: "fighting-axe", base: null, occupation: 5 }]);
  const requiresExplicit = alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "fighting-sword", base: 0, occupation: 5, baseSource: "verified", baseRequiresExplicit: true }]);
  const explicitZero = alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "fighting-spear", base: 0, occupation: 5, baseSource: "explicit" }]);
  const explicitOk = alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "fighting-spear", base: 15, occupation: 5, baseSource: "explicit", baseRequiresExplicit: true }]);
  return budgetCodes(missing).includes("base-missing")
    && budgetCodes(requiresExplicit).includes("base-explicit-required")
    && budgetCodes(explicitZero).includes("base-explicit-zero")
    && explicitOk.valid
    && explicitOk.totals[1].total === 20;
})(), {
  missing: budgetCodes(alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 }, { key: "fighting-axe", base: null, occupation: 5 }])),
  requiresExplicit: budgetCodes(alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "fighting-sword", base: 0, occupation: 5, baseSource: "verified", baseRequiresExplicit: true }])),
});

check("allocationNeverFoldsBaseIntoTotal", (() => {
  // 50 = occupation 40 + interest 10, base 1 omitted -> folded.
  const folded = alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "archaeology", base: 1, occupation: 40, interest: 10, total: 50 }]);
  const honest = alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "archaeology", base: 1, occupation: 40, interest: 10, total: 51 }]);
  return budgetCodes(folded).includes("base-folded")
    && honest.valid
    && honest.totals.find((row) => row.key === "archaeology").base === 1
    && folded.totals.find((row) => row.key === "archaeology").total === 51;
})(), budgetCodes(alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 },
  { key: "archaeology", base: 1, occupation: 40, interest: 10, total: 50 }])));

check("allocationRejectsDuplicateAndNonAsciiSkillKeys", (() => {
  const dup = budgetCodes(alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "archaeology", base: 1, occupation: 1 }, { key: "archaeology", base: 1, occupation: 1 }]));
  const cjk = budgetCodes(alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "考古学", base: 1, occupation: 1 }]));
  return dup.includes("duplicate-skill") && cjk.includes("skill-key-invalid");
})(), {
  dup: budgetCodes(alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "archaeology", base: 1, occupation: 1 }, { key: "archaeology", base: 1, occupation: 1 }])),
  cjk: budgetCodes(alloc("author", [{ key: "credit-rating", base: 0, occupation: 20 },
    { key: "考古学", base: 1, occupation: 1 }])),
});

const policeAllocation = validateAllocation({
  profession: profession("police-detective"), stats: creationStats,
  skills: [{ key: "credit-rating", base: 0, occupation: 20 }], pointFormula: "EDU*2+DEX*2",
});
check("professionSpecificFormulaDrivesBudget", policeAllocation.valid
  && policeAllocation.budgets.occupation.max === 260
  && allocateFor("dilettante").budgets.occupation.max === 200
  && allocateFor("author").budgets.occupation.max === 240
  // The MAX formulas stay whitelisted for legacy/custom records even though no
  // shipped occupation uses them.
  && validateAllocation({
    profession: { pointFormula: "EDU*2+MAX(DEX,STR)*2", creditMin: 9, creditMax: 30 }, stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 10 }],
  }).budgets.occupation.max === 260,
  {
    police: policeAllocation.budgets.occupation.max,
    dilettante: allocateFor("dilettante").budgets.occupation.max,
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
  const single = professionRules(profBySlug.get("author"));
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
  const expected = { author: 240, professor: 240, "investigative-journalist": 240, "doctor-of-medicine": 240, antiquarian: 240 };
  const bad = [];
  for (const [slug, max] of Object.entries(expected)) {
    // Use a credit allocation inside each profession's printed range.
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
  // One realistic allocation per multi-slot core profession plus a
  // credit-rating-only pass over every shipped core occupation, through the pack
  // documents the builder will actually hand in.
  const cases = [
    { slug: "doctor-of-medicine", cr: 40, budget: 240, extra: [{ key: "medicine", base: 1, occupation: 66 }] },
    { slug: "police-detective", cr: 20, budget: 260, pointFormula: "EDU*2+DEX*2", extra: [{ key: "law", base: 5, occupation: 60 }] },
    { slug: "antiquarian", cr: 30, budget: 240, extra: [{ key: "accounting", base: 5, occupation: 30 }] },
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

check("privateInvestigatorEitherOrFormulaSelectsStrOrDexExplicitly", (() => {
  const base = [{ key: "credit-rating", base: 0, occupation: 9 }];
  const byStr = validateAllocation({
    profession: profession("private-investigator"), stats: creationStats, skills: base, pointFormula: "EDU*2+STR*2",
  });
  const byDex = validateAllocation({
    profession: profession("private-investigator"), stats: creationStats, skills: base, pointFormula: "EDU*2+DEX*2",
  });
  const unpinned = validateAllocation({ profession: profession("private-investigator"), stats: creationStats, skills: base });
  const appChoice = validateAllocation({
    profession: profession("private-investigator"), stats: creationStats, skills: base, pointFormula: "EDU*2+APP*2",
  });
  return byStr.valid && byStr.budgets.occupation.max === 180
    && byStr.budgets.occupation.formula === "EDU*2+STR*2"
    && byDex.valid && byDex.budgets.occupation.max === 260
    && byDex.budgets.occupation.formula === "EDU*2+DEX*2"
    && byStr.budgets.occupation.formulas.length === 2
    && !unpinned.valid && unpinned.budgets === null
    && budgetCodes(unpinned).includes("formula-choice-required")
    && budgetCodes(appChoice).includes("formula-not-allowed");
})(), budgetCodes(validateAllocation({
  profession: profession("private-investigator"), stats: creationStats, skills: [{ key: "credit-rating", base: 0, occupation: 9 }],
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
  const doc = profBySlug.get("private-investigator");
  const normalized = professionRules(doc);
  const result = validateAllocation({
    profession: doc,
    stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 9 }],
    pointFormula: "EDU*2+DEX*2",
  });
  const unpinned = validateAllocation({
    profession: doc,
    stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 9 }],
  });
  return normalized.pointFormula === "EDU*2+STR*2"
    && JSON.stringify(normalized.pointFormulas) === JSON.stringify(["EDU*2+STR*2", "EDU*2+DEX*2"])
    && normalized.creditMin === 9 && normalized.creditMax === 30
    && normalized.contentSource === "coc"
    && result.valid && result.budgets.occupation.max === 260
    // The same pack document refuses to guess which characteristic the player
    // intends: an unpinned either/or record has no budget at all.
    && !unpinned.valid && unpinned.budgets === null
    && budgetCodes(unpinned).includes("formula-choice-required");
})(), (() => {
  try { return professionRules(profBySlug.get("private-investigator")).pointFormulas; } catch (thrown) { return thrown.code; }
})());

check("professionRulesRejectsIncompleteOrForeignRecords", (() => {
  const codeOf = (source) => { try { professionRules(source); return "accepted"; } catch (thrown) { return thrown.code; } };
  const noRange = codeOf({ pointFormula: "EDU*4" });
  const badFormula = codeOf({ pointFormula: "EDU*5", creditMin: 0, creditMax: 10 });
  const foreign = codeOf({
    name: "冒牌", flags: { brp: { contentSource: "octopus", coc: { slug: "fake", pointFormula: "EDU*4", creditMin: 1, creditMax: 2 } } },
  });
  const missing = codeOf(null);
  const fromPack = professionRules(profBySlug.get("antiquarian"));
  return noRange === "credit-range-missing"
    && badFormula === "formula-not-allowed"
    && foreign === "profession-source-invalid"
    && missing === "profession-missing"
    && fromPack.creditMin === 30 && fromPack.creditMax === 50;
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

// CM/QC read the category multiplier from `actor.system.skillcategory`. The CoC
// native actor schema has no such map, so a missing map must mean "no category
// bonus" (the documented 0 fallback), not a TypeError that kills the roll.
// Drive the real normaliseRequest path with stubbed host globals: this is
// module/apps/check.mjs itself, not a copy of its formula.
check("cocCombatCategoryBonusFallsBackToZero", await (async () => {
  const Base = class {};
  const stub = new Proxy(Base, {
    get(target, prop) {
      if (prop === "implementation") return Base;
      if (prop === "prototype") return Base.prototype;
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === Symbol.iterator) return function* () {};
      if (prop === "then") return undefined;
      return stub;
    },
    apply() { return stub; },
    construct() { return {}; },
  });
  globalThis.foundry = new Proxy({
    utils: {
      deepClone: (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value))),
      duplicate: (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value))),
      mergeObject: (left, right) => Object.assign({}, left, right),
      getProperty: (object, path) => String(path).split(".").reduce((value, key) => value?.[key], object),
      setProperty: () => true,
      expandObject: (value) => value,
      flattenObject: (value) => value,
      randomID: () => "stub-id",
      isEmpty: (value) => !value || Object.keys(value).length === 0,
    },
  }, { get(target, prop) { return prop in target ? target[prop] : stub; } });

  const skill = {
    _id: "skill1", name: "手枪", type: "skill",
    system: { total: 55, category: "firearms" },
    flags: { brp: { brpidFlag: { id: "i.skill.coc.firearms-handgun" }, coc: { specKey: "handgun" } } },
  };
  const weapon = {
    _id: "weapon1", name: ".38 左轮", type: "weapon",
    system: { skill1: "i.skill.coc.firearms-handgun", mal: 100, hands: "1H", properties: {}, range: {} },
    flags: {},
  };
  const items = {
    get: (id) => [skill, weapon].find((item) => item._id === id),
    *[Symbol.iterator]() { yield skill; yield weapon; },
  };
  const actor = {
    id: "actor1", name: "调查员", img: "actor.png", type: "character",
    prototypeToken: { randomImg: false }, system: {}, items,
  };
  globalThis.Hooks = { on() {}, once() {}, callAll() {} };
  globalThis.game = {
    settings: { get: () => "", register() {} },
    i18n: { localize: (key) => key, format: (key) => key },
    user: { isGM: true, targets: new Set() },
    actors: { get: () => actor },
    messages: { get: () => null },
    items: { get: () => null },
    socket: { emit() {} },
  };
  globalThis.ui = { notifications: { error() {}, warn() {} } };
  globalThis.ChatMessage = { getSpeaker: () => ({}), create: async () => ({}) };
  globalThis.Roll = class {};
  globalThis.CONST = { CHAT_MESSAGE_STYLES: { OTHER: 0 } };
  for (const name of ["ActiveEffect", "Item", "Actor", "Combat", "Macro", "ItemSheet",
    "ActorSheet", "JournalEntry", "Folder", "Scene", "Token", "TokenDocument", "Drawing",
    "AmbientLight", "Cards", "RollTable", "MeasuredTemplate", "Dialog", "Application",
    "FormApplication", "TextEditor", "CONFIG", "canvas"]) globalThis[name] = stub;

  const { BRPCheck } = await import(pathToFileURL(join(ROOT, "module/apps/check.mjs")).href);
  const cases = [
    { label: "missing-map", system: {}, expected: 55 },
    { label: "empty-map", system: { skillcategory: {} }, expected: 55 },
    { label: "category-bonus", system: { skillcategory: { firearms: 10 } }, expected: 65 },
  ];
  const failures = [];
  for (const entry of cases) {
    actor.system = entry.system;
    for (const rollType of ["CM", "QC"]) {
      let config;
      try {
        config = await BRPCheck.normaliseRequest({
          rollType, cardType: "CB", actor, itemId: weapon._id, skillId: skill._id,
        });
      } catch (thrown) {
        failures.push(`${entry.label}/${rollType}: ${thrown.message}`);
        continue;
      }
      if (config?.rawScore !== entry.expected || config?.targetScore !== entry.expected) {
        failures.push(`${entry.label}/${rollType}: raw=${config?.rawScore} target=${config?.targetScore} expected=${entry.expected}`);
      }
    }
  }
  return failures.length ? failures : true;
})(), "expected 55 without a category map and 65 with firearms +10");

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
