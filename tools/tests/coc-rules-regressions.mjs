// CoC source-repo regression probe (M1 core + M2 occupations/allocation + M3 combat/wounds
// + M5 specialisms/second-batch occupations/multi-formula; no Foundry required).
//
//   node tools/tests/coc-rules-regressions.mjs
//
// Covers:
//   1. deterministic CoC pack build (skills + professions) + octopus artifacts byte-unchanged
//   2. fact/pack contract: core values, specialism identity, pending exclusion,
//      source isolation, no fixed 0 for unverified specialisms
//   3. centralized rules: derived attributes, SAN/Luck, success bands, growth,
//      skill formula rounding, APP -> cha mapping
//   4. negative cases: BRP and CoC differ where they must, no cross-pack bleed
//   5. M2/M5 occupations: formula/credit range per source, wealth band never used as
//      CR, resolvable skill refs, deterministic ids, eight-skill shape
//   6. M2/M5 creation rules: whitelist AST, either/or point formulas, INT x 2,
//      credit-rating rules, mythos ban, explicit base values, no base folding,
//      specialism identity
//   7. M3 pure combat/wounds: band ranks, required-band difficulty, bonus/penalty
//      tens pools, weapon profiles/extreme damage/half DB, opposed ties, dodge/
//      fightback/cover, Build/outnumbering/shots/point-blank, major wound/dying/
//      instant death and the healing bands
//   8. M5 provenance: every new record secondary, no official-first-party claim,
//      every cited source registered with an https URL
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Rules } from "../../module/rules/index.mjs";
import { CoCSanity } from "../../module/rules/coc-sanity.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const checks = {};
const errors = [];
const check = (name, ok, detail) => {
  checks[name] = ok ? true : { ok: false, detail };
  if (!ok) errors.push(`${name}: ${JSON.stringify(detail)}`);
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
const DIRS = ["packs-json", "packs-index", "packs"];
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
  for (const dir of DIRS) cpSync(join(temp, dir), join(temp, `__run1/${dir}`), { recursive: true });
  cpSync(join(temp, "system.json"), join(temp, "__run1/system.json"));
  build();
  const consecutive = compareTrees(join(temp, "__run1"), temp, DIRS);
  if (!existsSync(join(temp, "__run1/system.json")) || !readFileSync(join(temp, "system.json")).equals(readFileSync(join(temp, "__run1/system.json")))) {
    consecutive.push("system.json: bytes differ");
  }
  check("buildConsecutiveByteIdentical", consecutive.length === 0, consecutive.slice(0, 8));

  const cocCommitted = compareTrees(temp, ROOT, DIRS);
  check("buildMatchesCommittedArtifacts", cocCommitted.length === 0, cocCommitted.slice(0, 8));

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
const cocDocs = readJson("packs-json/coc-skills.json");
const cocIndex = readJson("packs-index/coc-skills.json");
const octopusDocs = readJson("packs-json/octopus-skills.json");
const docsByKey = new Map(cocDocs.map((doc) => [doc.flags.brp.coc.key, doc]));

check("factCount", facts.skills.length === 56 && cocDocs.length === 56 && cocIndex.length === 56,
  { facts: facts.skills.length, docs: cocDocs.length, index: cocIndex.length });
check("documentIdsUniqueAndDeterministic", new Set(cocDocs.map((doc) => doc._id)).size === cocDocs.length
  && cocDocs.every((doc) => /^[A-Za-z0-9]{16}$/.test(doc._id))
  && new Set(cocIndex.map((doc) => doc._id)).size === cocIndex.length,
  { docs: cocDocs.length, unique: new Set(cocDocs.map((doc) => doc._id)).size });
check("systemPackRegistration", (() => {
  const sys = readJson("system.json");
  const pack = sys.packs?.find((entry) => entry.name === "coc-skills");
  return pack?.path === "packs/coc-skills" && pack?.type === "Item" && pack?.system === "brp"
    && sys.packs.some((entry) => entry.name === "octopus-skills")
    && sys.packs.some((entry) => entry.name === "octopus-professions");
})());
check("pendingSpecialismsExcluded", (facts.pendingSpecialisms ?? []).length === 7
  && (facts.pendingSpecialisms ?? []).every((pending) => pending.base === null
    && pending.status === "pending-official-source"
    && !docsByKey.has(pending.factId)
    && !cocDocs.some((doc) => doc.flags.brp.coc.factId === pending.factId)),
  { pending: facts.pendingSpecialisms?.length, emitted: cocDocs.filter((doc) => doc.flags.brp.coc.status === "pending-official-source").length });

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

check("noFixedZeroOutsideOfficialZeroSkills", cocDocs.filter((doc) => doc.system.base === 0 && !doc.system.variable)
  .every((doc) => ["credit-rating", "cthulhu-mythos"].includes(doc.flags.brp.coc.key)),
  cocDocs.filter((doc) => doc.system.base === 0).map((doc) => doc.flags.brp.coc.key));

const brpidRe = /^i\.skill\.coc\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const specIds = new Set();
check("brpidAsciiAndUnique", cocDocs.every((doc) => brpidRe.test(doc.flags.brp.brpidFlag.id))
  && new Set(cocDocs.map((doc) => doc.flags.brp.brpidFlag.id)).size === cocDocs.length,
  cocDocs.filter((doc) => !brpidRe.test(doc.flags.brp.brpidFlag.id)).map((doc) => doc.flags.brp.brpidFlag.id));

const specDocs = cocDocs.filter((doc) => doc.system.specialism);
check("specialismIdentityIndependent", specDocs.length === 18 && specDocs.every((doc) => {
  const specKey = doc.flags.brp.coc.specKey;
  const parentKey = doc.flags.brp.coc.parentKey;
  if (!specKey || !parentKey || doc.system.chosen !== true || doc.system.specName !== doc.name) return false;
  const id = `${parentKey}/${specKey}`;
  if (specIds.has(id)) return false;
  specIds.add(id);
  return true;
}), { count: specDocs.length, ids: [...specIds] });

check("allDocsTaggedCoc", cocDocs.every((doc) => doc.flags.brp.contentSource === "coc"),
  cocDocs.filter((doc) => doc.flags.brp.contentSource !== "coc").length);

// M3 second batch: five new specialisms, verified as secondary evidence.
const NEW_SPECIALISMS = {
  "science-pharmacy": { parentKey: "science", specKey: "pharmacy", base: 1, mainName: "科学" },
  "science-engineering": { parentKey: "science", specKey: "engineering", base: 1, mainName: "科学" },
  "science-physics": { parentKey: "science", specKey: "physics", base: 1, mainName: "科学" },
  "art-craft-acting": { parentKey: "art-craft", specKey: "acting", base: 5, mainName: "艺术/手艺" },
  "art-craft-technical-drawing": { parentKey: "art-craft", specKey: "technical-drawing", base: 5, mainName: "艺术/手艺" },
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
  const published = new Map(specDocs.map((doc) => [`${doc.flags.brp.coc.parentKey}/${doc.flags.brp.coc.specKey}`, doc]));
  const listed = new Set();
  for (const [familyKey, family] of Object.entries(provenanceFamilies)) {
    for (const key of family.concrete ?? []) {
      const doc = docsByKey.get(key);
      if (!doc) { bad.push(`${familyKey}: unknown concrete ${key}`); continue; }
      if (doc.flags.brp.coc.parentKey !== family.parentKey) bad.push(`${familyKey}: ${key} parent ${doc.flags.brp.coc.parentKey}`);
      if (doc.system.base !== family.base) bad.push(`${familyKey}: ${key} base ${doc.system.base} != family ${family.base}`);
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
check("noCocBrpidCollisionWithOctopus", !cocDocs.some((doc) => octopusDocs.some((oct) => oct.flags.brp.brpidFlag.id === doc.flags.brp.brpidFlag.id)));
check("provenanceHasOfficialSourcesAndExclusions", provenance.sources.length >= 8
  && provenance.sources.every((source) => source.url.startsWith("https://"))
  && provenance.licenseBoundary.excluded.some((line) => line.includes("No official PDF")));
check("noStatsAppInContent", !JSON.stringify(facts).includes("\"app\"") && !JSON.stringify(cocDocs).includes("\"stats\""));

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
const profBySlug = new Map(profDocs.map((doc) => [doc.flags.brp.coc.slug, doc]));

check("professionFactCount", professionFacts.professions.length === 15
  && profDocs.length === 15 && profIndex.length === 15
  && new Set(profDocs.map((doc) => doc._id)).size === 15
  && profDocs.every((doc) => /^[A-Za-z0-9]{16}$/.test(doc._id)),
  { facts: professionFacts.professions.length, docs: profDocs.length, index: profIndex.length });

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
  explorer: { formulas: ["EDU*2+MAX(APP,DEX,STR)*2"], min: 55, max: 80, sources: ["coc-roll20-occupations"] },
  "investigative-journalist": { formulas: ["EDU*4"], min: 9, max: 30, sources: ["coc-roll20-occupations"] },
  nurse: { formulas: ["EDU*4"], min: 9, max: 30, sources: ["coc-roll20-occupations"] },
  "private-investigator": { formulas: ["EDU*2+MAX(DEX,STR)*2"], min: 9, max: 30, sources: ["coc-roll20-occupations"] },
  professor: { formulas: ["EDU*4"], min: 20, max: 70, sources: ["coc-roll20-occupations"] },
  soldier: { formulas: ["EDU*2+MAX(DEX,STR)*2"], min: 9, max: 30, sources: ["coc-roll20-occupations"] },
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
};

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
      if (!(coc.sourceRefs ?? []).includes(source)) mismatched.push(`${slug}: missing cross-check ${source}`);
    }
    if (doc.name !== professionFacts.professions.find((entry) => entry.slug === slug)?.name) mismatched.push(`${slug}: name`);
  }
  return mismatched.length === 0 ? true : mismatched;
})(), [...profBySlug.keys()]);

check("everyProfessionIsSecondaryEvidenceWithSources", profDocs.every((doc) => {
  const coc = doc.flags.brp.coc;
  return coc.evidence === "secondary"
    && Array.isArray(coc.sourceRefs) && coc.sourceRefs.length > 0
    && coc.sourceRefs.every((ref) => provenance.sources.some((source) => source.id === ref));
}), profDocs.map((doc) => [doc.flags.brp.coc.slug, doc.flags.brp.coc.sourceRefs]));

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
})(), profDocs.filter((doc) => ["doctor-of-medicine", "police-detective", "librarian", "lawyer", "engineer"]
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

check("m5ProvenanceRegistersEveryRecordAsSecondary", (() => {
  const bad = [];
  for (const [factId, want] of Object.entries(M5_PROVENANCE)) {
    const record = provenance.occupations.perRecord[factId];
    if (!record) { bad.push(`${factId}: unregistered`); continue; }
    if (record.evidence !== "secondary") bad.push(`${factId}: evidence ${record.evidence}`);
    const refs = record.sourceRefs ?? [];
    for (const source of want.sources) {
      if (!refs.includes(source)) bad.push(`${factId}: missing ${source}`);
    }
    // A record with no licensed compendium page must say so.
    if (want.strict === false && !record.claimBoundary) bad.push(`${factId}: no claimBoundary`);
    if (want.formulas && JSON.stringify(record.formulas) !== JSON.stringify(want.formulas)) {
      bad.push(`${factId}: formulas ${JSON.stringify(record.formulas)}`);
    }
    if (record.formula !== (record.formulas ?? [])[0] && record.formulas) {
      bad.push(`${factId}: formula/list mismatch`);
    }
  }
  return bad.length ? bad : true;
})(), Object.keys(provenance.occupations.perRecord ?? {}));

check("m5ProvenanceNeverClaimsOfficialFirstParty", (() => {
  const forbidden = ["official", "first-party", "primary", "chaosium-confirmed", "verified-official"];
  const bad = [];
  for (const [factId] of Object.entries(M5_PROVENANCE)) {
    const record = provenance.occupations.perRecord[factId];
    const grade = String(record?.evidence ?? "");
    if (forbidden.some((word) => grade.toLowerCase().includes(word))) bad.push(`${factId}: ${grade}`);
    // Only the two compendium-backed records may cite the official wiki.
    const citesWiki = (record?.sourceRefs ?? []).some((ref) => ref.startsWith("coc-wiki"));
    const want = M5_PROVENANCE[factId];
    if (citesWiki && want.strict !== true) bad.push(`${factId}: unauthorised wiki citation`);
  }
  const datasetStatus = String(provenance.occupations.status ?? "");
  if (!datasetStatus.includes("secondary")) bad.push(`occupations.status ${datasetStatus}`);
  return bad.length ? bad : true;
})(), provenance.occupations.status);

check("m5ProvenanceSourcesResolveToRegisteredUrls", (() => {
  const ids = new Set(provenance.sources.map((source) => source.id));
  const bad = [];
  for (const [factId, want] of Object.entries(M5_PROVENANCE)) {
    for (const ref of want.sources) {
      if (!ids.has(ref)) bad.push(`${factId}: ${ref} not registered`);
    }
  }
  for (const id of ["coc-gamersplane-occupations", "coc-org-uk-occupations", "coc-rpgstack-occupations"]) {
    const source = provenance.sources.find((entry) => entry.id === id);
    if (!source) { bad.push(`${id}: missing`); continue; }
    if (!source.url.startsWith("https://")) bad.push(`${id}: url ${source.url}`);
    if (source.evidence !== "secondary") bad.push(`${id}: evidence ${source.evidence}`);
    if (!source.note) bad.push(`${id}: no note`);
  }
  return bad.length ? bad : true;
})(), provenance.sources.filter((source) => source.id.includes("occupations")).map((source) => source.id));

check("professionNeverUsesWealthBandAsCreditRating", profDocs.every((doc) => {
  const coc = doc.flags.brp.coc;
  return doc.system.minWealth === 0 && doc.system.maxWealth === 0
    && coc.wealthNotApplicable === true
    && Number.isInteger(coc.creditMin) && Number.isInteger(coc.creditMax)
    && coc.creditMin !== doc.system.minWealth && coc.creditMax !== doc.system.maxWealth;
}), profDocs.map((doc) => [doc.flags.brp.coc.slug, doc.system.minWealth, doc.system.maxWealth]));

check("professionSkillRefsResolveToCocSkills", (() => {
  const skillBrpids = new Set(cocDocs.map((doc) => doc.flags.brp.brpidFlag.id));
  const bad = [];
  for (const doc of profDocs) {
    for (const ref of [...doc.system.skills, ...doc.system.groups.flatMap((group) => group.skills)]) {
      if (!skillBrpids.has(ref.brpid)) bad.push(`${doc.flags.brp.coc.slug}→${ref.brpid}`);
      if (ref.uuid !== cocDocId(ref.brpid)) bad.push(`${doc.flags.brp.coc.slug}→${ref.brpid}: uuid`);
    }
    for (const ref of doc.system.skills) {
      if (octopusDocs.some((oct) => oct.flags.brp.brpidFlag.id === ref.brpid)) bad.push(`octopus ref ${ref.brpid}`);
    }
  }
  return bad.length ? bad : true;
})());

check("professionGroupsCarryPickCountsAndSpecialismSlotsStayOut", profDocs.every((doc) => {
  const groups = doc.system.groups;
  return groups.every((group) => Number.isInteger(group.options) && group.options >= 1
    && group.skills.length >= group.options)
    && doc.system.powers.length === 0;
}), profDocs.map((doc) => [doc.flags.brp.coc.slug, doc.system.groups.map((group) => [group.options, group.skills.length])]));

check("professionChoiceGroupsCarryResolvedSkillIds", (() => {
  const skillBrpids = new Set(cocDocs.map((doc) => doc.flags.brp.brpidFlag.id));
  const bad = [];
  for (const doc of profDocs) {
    const groups = doc.flags.brp.coc.choiceGroups ?? [];
    if (!groups.length) bad.push(`${doc.flags.brp.coc.slug}: no choiceGroups`);
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
      const walkable = group.options.every((option) => option.kind !== "any");
      const native = doc.system.groups.some((nativeGroup) => nativeGroup.options === group.choose
        && nativeGroup.skills.length === new Set(group.options.flatMap((option) => option.brpids)).size);
      if (walkable && !native) bad.push(`${doc.flags.brp.coc.slug}/${group.key}: not mirrored natively`);
      if (!walkable && doc.system.groups.some((nativeGroup) => nativeGroup.options === group.choose
        && nativeGroup.skills.some((ref) => group.options.some((option) => option.kind === "any")))) {
        bad.push(`${doc.flags.brp.coc.slug}/${group.key}: any leaked into native group`);
      }
    }
  }
  return bad.length ? bad : true;
})(), profDocs.map((doc) => [doc.flags.brp.coc.slug, (doc.flags.brp.coc.choiceGroups ?? []).length]));

check("professionSpecialismSlotsCarryVerifiedFamilyBase", (() => {
  const bad = [];
  for (const doc of profDocs) {
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
})(), profDocs.map((doc) => [doc.flags.brp.coc.slug, (doc.flags.brp.coc.specialismSlots ?? []).length]));

check("professionBrpidAsciiUniqueAndCocScoped", profDocs.every((doc) => /^i\.profession\.coc\.[a-z0-9]+(?:-[a-z0-9]+)*$/.test(doc.flags.brp.brpidFlag.id))
  && new Set(profDocs.map((doc) => doc.flags.brp.brpidFlag.id)).size === profDocs.length
  && !profDocs.some((doc) => octopusDocs.some((oct) => oct.flags.brp.brpidFlag.id === doc.flags.brp.brpidFlag.id))
  && !JSON.stringify(profDocs).includes('"\"app\""'),
  profDocs.map((doc) => doc.flags.brp.brpidFlag.id));

// Creation rules: pure functions imported exactly as the frontend will.
const creation = await import("../../module/rules/creation.mjs");
const {
  evaluatePointFormula, interestPoints, validateAllocation, parsePointFormula,
  buildSpecialism, specialismBrpid, specialismKey, professionRules, POINT_FORMULAS, CreationRuleError,
  normalizePointFormulas, isSupportedPointFormulas,
} = creation;

const creationStats = { edu: 60, int: 50, dex: 70, app: 40, str: 30, cha: 40 };
check("pointFormulasEvaluateFromWhitelist", POINT_FORMULAS.length === 6
  && evaluatePointFormula("EDU*4", creationStats) === 240
  && evaluatePointFormula("EDU*2+DEX*2", creationStats) === 260
  && evaluatePointFormula("EDU*2+APP*2", creationStats) === 200
  && evaluatePointFormula("EDU*2+STR*2", creationStats) === 180
  && evaluatePointFormula("EDU*2+MAX(APP,DEX,STR)*2", creationStats) === 260
  && evaluatePointFormula("EDU*2+MAX(DEX,STR)*2", creationStats) === 260
  // Adding EDU*2+STR*2 must not move any pre-existing formula's result.
  && new Set(POINT_FORMULAS).size === POINT_FORMULAS.length
  && POINT_FORMULAS.includes("EDU*4") && POINT_FORMULAS.includes("EDU*2+STR*2"),
  {
    edu4: evaluatePointFormula("EDU*4", creationStats),
    eduDex: evaluatePointFormula("EDU*2+DEX*2", creationStats),
    eduApp: evaluatePointFormula("EDU*2+APP*2", creationStats),
    eduStr: evaluatePointFormula("EDU*2+STR*2", creationStats),
    explorer: evaluatePointFormula("EDU*2+MAX(APP,DEX,STR)*2", creationStats),
    pi: evaluatePointFormula("EDU*2+MAX(DEX,STR)*2", creationStats),
    list: [...POINT_FORMULAS],
  });

check("m5FormulasAreWhitelistedButNotUsedByLegacyRecords", (() => {
  // The new formula is supported for the second batch only; no first-batch
  // profession may silently switch to it.
  const legacy = ["archaeologist", "author", "cat-burglar", "dilettante", "explorer",
    "investigative-journalist", "nurse", "private-investigator", "professor", "soldier"];
  return legacy.every((slug) => {
    const coc = profBySlug.get(slug)?.flags?.brp?.coc;
    return coc && !(coc.pointFormulas ?? [coc.pointFormula]).includes("EDU*2+STR*2");
  });
})(), profBySlug.get("soldier")?.flags.brp.coc.pointFormula);

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

const explorerAllocation = alloc("explorer", [{ key: "credit-rating", base: 0, occupation: 55 }]);
check("professionSpecificFormulaDrivesBudget", explorerAllocation.valid
  && explorerAllocation.budgets.occupation.max === 260
  && allocateFor("dilettante").budgets.occupation.max === 200
  && allocateFor("cat-burglar").budgets.occupation.max === 260
  && allocateFor("author").budgets.occupation.max === 240
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
  const expected = { archaeologist: 240, author: 240, nurse: 240, professor: 240, "librarian": 240, lawyer: 240, engineer: 240, "doctor-of-medicine": 240 };
  const bad = [];
  for (const [slug, max] of Object.entries(expected)) {
    const result = validateAllocation({
      profession: profession(slug), stats: creationStats,
      skills: [{ key: "credit-rating", base: 0, occupation: 20 }],
    });
    if (!result.valid) bad.push(`${slug}: invalid ${budgetCodes(result)}`);
    if (result.budgets?.occupation.max !== max) bad.push(`${slug}: max ${result.budgets?.occupation.max}`);
    if ((result.budgets?.occupation.formulas ?? []).length !== 1) bad.push(`${slug}: formulas ${result.budgets?.occupation.formulas?.length}`);
    if (result.budgets?.occupation.formula !== "EDU*4") bad.push(`${slug}: formula ${result.budgets?.occupation.formula}`);
  }
  return bad.length ? bad : true;
})(), null);

check("newProfessionsBuildValidAllocationsEndToEnd", (() => {
  // One realistic allocation per second-batch profession, through the pack
  // documents the builder will actually hand in.
  const cases = [
    { slug: "doctor-of-medicine", cr: 40, extra: [{ key: "medicine", base: 1, occupation: 66 }] },
    { slug: "police-detective", cr: 20, pointFormula: "EDU*2+DEX*2", extra: [{ key: "law", base: 5, occupation: 60 }] },
    { slug: "librarian", cr: 12, extra: [{ key: "library-use", base: 20, occupation: 60 }] },
    { slug: "lawyer", cr: 30, extra: [{ key: "law", base: 5, occupation: 60 }] },
    { slug: "engineer", cr: 30, extra: [{ key: "mechanical-repair", base: 10, occupation: 50 }] },
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
  }
  return bad.length ? bad : true;
})(), null);

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
  return profDocs.every((doc) => doc._id === rebuild(`profession-${doc.flags.brp.brpidFlag.id}`))
    && new Set(profDocs.map((doc) => doc._id)).size === profDocs.length;
})(), profDocs.map((doc) => doc._id));

check("packProfessionDocumentFeedsValidateAllocationDirectly", (() => {
  // The builder will hand the pack document straight in, so normalization
  // must land on the same numbers the source record produces.
  const doc = profBySlug.get("explorer");
  const normalized = professionRules(doc);
  const result = validateAllocation({
    profession: doc,
    stats: creationStats,
    skills: [{ key: "credit-rating", base: 0, occupation: 55 }],
  });
  return normalized.pointFormula === "EDU*2+MAX(APP,DEX,STR)*2"
    && normalized.creditMin === 55 && normalized.creditMax === 80
    && normalized.contentSource === "coc"
    && result.valid && result.budgets.occupation.max === 260;
})(), (() => {
  try { professionRules(profBySlug.get("explorer")); return "ok"; } catch (thrown) { return thrown.code; }
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
