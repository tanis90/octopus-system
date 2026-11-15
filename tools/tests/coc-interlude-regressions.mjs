// CoC interlude / native skill field regressions (no live Foundry required).
//
//   node tools/tests/coc-interlude-regressions.mjs
//
// Covers the M5 growth write surface:
//   - interlude entry point/selection contract (noXP never selectable, dirty
//     ticks surface for clearing, manual add still works)
//   - card view data reads the canonical `system.adjustments.*` contract with
//     legacy fallbacks and never renders NaN
//   - settlement writes `system.adjustments.experience` + `flags.developement`,
//     clears legacy ticks, enforces strict-exceed, empty-list and requestId
//     idempotency, and refuses an invalid (no score) skill
//   - undo decrements the canonical experience bucket instead of legacy `xp`
//   - the shared paper-card inline handler maps CoC aliases to adjustments and
//     refuses non-finite input
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const checks = [];
const failures = [];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const expect = (name, actual, wanted) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  checks.push(name);
  if (!ok) failures.push(`${name}: ${JSON.stringify(actual)} != ${JSON.stringify(wanted)}`);
};
const expectTrue = (name, ok, detail) => {
  checks.push(name);
  if (ok !== true) failures.push(`${name}: ${JSON.stringify(detail ?? ok)}`);
};

const {
  buildCocInterludePlan,
  cocInterludeSelectable,
  initialCocInterludeSelection,
} = await import("../../module/actor/sheets/coc/interlude-plan.mjs");
const { buildCocSkillGroups } = await import("../../module/actor/sheets/coc/view-data.mjs");
const {
  skillNoXP,
  skillSourceSystem,
  skillTicked,
  skillXp,
  skillTotal,
} = await import("../../module/rules/coc-skill-fields.mjs");

const skill = (id, system) => ({ id, _id: id, name: id, type: "skill", system });
const weapon = (id) => ({ id, _id: id, name: id, type: "weapon", system: {} });
const collectionOf = (items) => ({
  get: (id) => items.find((item) => item.id === id || item._id === id),
  *[Symbol.iterator]() { yield* items; },
});

// ------------------------------------------------------- interlude entry UI
const paperHeader = read("templates/actor/coc/paper-header.hbs");
expect("paperHeaderSingleInterludeEntry", (paperHeader.match(/data-action="cocInterlude"/g) ?? []).length, 1);
expectTrue("paperHeaderInterludeLabel", paperHeader.includes(">幕间结算<"), paperHeader.match(/cocInterlude[^>]*>[^<]*/));
expectTrue("paperHeaderInterludeOwnerGate", paperHeader.includes("{{#if canInterlude}}"), false);
const growthTemplate = read("templates/actor/coc/growth.hbs");
expectTrue("growthNoDuplicateInterlude", !growthTemplate.includes("cocInterlude") && !growthTemplate.includes("一键成长"),
  growthTemplate);
expectTrue("npcNoInterludeEntry", !read("templates/actor/coc/paper-npc-header.hbs").includes("cocInterlude"), false);
expectTrue("characterInterludeGate",
  /canInterlude: this\.document\.isOwner === true \|\| game\.user\.isGM === true/.test(read("module/actor/sheets/coc/character.mjs")),
  false);

// ---------------------------------------------------------------- pure reads
const canonical = {
  base: "40",
  adjustments: {
    base: 2, personal: 3, occupation: 5, archetype: 7, experiencePackage: 11, experience: 13,
  },
  flags: { developement: true },
};
expectTrue("canonicalTotal", skillTotal(canonical) === 81, skillTotal(canonical));
expectTrue("canonicalXp", skillXp(canonical) === 13, skillXp(canonical));
expectTrue("canonicalTicked", skillTicked(canonical) === true, skillTicked(canonical));
expectTrue("canonicalNoXP", skillNoXP(canonical) === false, skillNoXP(canonical));
expectTrue("legacyFallbackTotal", skillTotal({ base: 10, xp: 7, adjustments: {} }) === 17,
  skillTotal({ base: 10, xp: 7, adjustments: {} }));
expectTrue("legacyTicked", skillTicked({ improve: true }) === true, skillTicked({ improve: true }));
expectTrue("legacyNoXP", skillNoXP({ noXP: true }) === true, skillNoXP({ noXP: true }));
expectTrue("canonicalNoXpWins", skillNoXP({ properties: { noxpgain: true }, noXP: false }) === true,
  skillNoXP({ properties: { noxpgain: true }, noXP: false }));
expectTrue("noXpKeepsExistingXp", skillTotal({ base: 0, adjustments: { experience: 10 }, properties: { noxpgain: true } }) === 10,
  skillTotal({ base: 0, adjustments: { experience: 10 }, properties: { noxpgain: true } }));
expectTrue("invalidScoreIsFiniteZero", skillTotal({}) === 0, skillTotal({}));
expectTrue("noNanFromGarbage", Number.isFinite(skillTotal({ base: "abc", adjustments: { experience: "x" } })),
  skillTotal({ base: "abc", adjustments: { experience: "x" } }));

// Core Foundry drops unknown legacy keys from the prepared model, so the source
// layer is where `_source`/`toObject` keeps them; the interlude and card read
// through `skillSourceSystem` and must still see them.
const legacySource = {
  id: "source-ticked", name: "source-ticked", type: "skill",
  _source: { system: { base: "5", xp: 7, improve: true } },
  system: { base: "5", adjustments: {} },
};
expectTrue("sourceSystemLegacyXp", skillTotal(skillSourceSystem(legacySource)) === 12,
  skillTotal(skillSourceSystem(legacySource)));
expectTrue("sourceSystemLegacyTick", skillTicked(skillSourceSystem(legacySource)) === true,
  skillTicked(skillSourceSystem(legacySource)));
const legacyNoXpSource = {
  id: "source-no-xp", name: "source-no-xp", type: "skill",
  _source: { system: { base: "0", noXP: true } },
  system: { base: "0", adjustments: {} },
};
expectTrue("sourceSystemLegacyNoXP", skillNoXP(skillSourceSystem(legacyNoXpSource)) === true,
  skillNoXP(skillSourceSystem(legacyNoXpSource)));
expect("sourceSelection", initialCocInterludeSelection([legacySource, legacyNoXpSource]), ["source-ticked"]);

// ------------------------------------------------------ interlude selection
const ticked = skill("ticked", { base: "20", adjustments: { experience: 0 }, flags: { developement: true } });
const legacyTicked = skill("legacy-ticked", { base: "10", xp: 4, adjustments: {}, improve: true });
const mythos = skill("mythos", { base: "0", adjustments: { experience: 10 }, properties: { noxpgain: true }, flags: { developement: true } });
const plain = skill("plain", { base: "30", adjustments: {} });
const other = weapon("weapon");
const all = [ticked, legacyTicked, mythos, plain, other];

expect("initialSelectionSkipsNoXP", initialCocInterludeSelection(all), ["ticked", "legacy-ticked"]);
expectTrue("selectableBlocksNoXP", cocInterludeSelectable(mythos) === false, cocInterludeSelectable(mythos));
const actor = { items: collectionOf(all) };
const plan = buildCocInterludePlan(actor, ["ticked", "legacy-ticked", "mythos", "plain", "ticked", "weapon"], ["plain"]);
expect("planSettlesTickedAndManual", plan.settle.map((entry) => entry.itemId), ["ticked", "legacy-ticked", "plain"]);
expect("planClearsDirtyNoXP", plan.clear.map((entry) => entry.itemId), ["mythos"]);
expect("planRejectsNoXP", plan.rejected.find((entry) => entry.itemId === "mythos")?.reason, "no-xp");
expect("planRejectsDuplicate", plan.rejected.find((entry) => entry.itemId === "ticked")?.reason, "duplicate");
expect("planRejectsWeapon", plan.rejected.find((entry) => entry.itemId === "weapon")?.reason, "not-skill");

const untickedPlan = buildCocInterludePlan({ items: collectionOf([plain]) }, ["plain"]);
expect("planRejectsUnticked", untickedPlan.rejected.find((entry) => entry.itemId === "plain")?.reason, "not-ticked");

// ------------------------------------------------------------- card view data
const groups = buildCocSkillGroups([canonical, mythos.system].map((system, index) => skill(`view-${index}`, system)));
const view = Object.fromEntries(groups.flatMap((group) => group.skills).map((row) => [row.name, row]));
expect("viewCanonicalTotal", view["view-0"].total, 81);
expect("viewCanonicalBreakdown", view["view-0"].breakdown, {
  base: 40, profession: 5, personal: 3, xp: 13, effects: 2, personality: 7, culture: 11, total: 81,
});
expect("viewCanonicalTicked", view["view-0"].improve, true);
expect("viewNoXP", view["view-1"].noXP, true);
expect("viewNoXPTotal", view["view-1"].total, 10);
expectTrue("viewNoNaN", !/NaN/.test(`${view["view-1"].total}${view["view-1"].breakdownText}`), view["view-1"]);

// ------------------------------------------------ settlement through the app
// Resolve the real settlement module with the same minimal Foundry surface the
// owner tests use. `Roll` is a queue so each d100/1D10 is deterministic.
class QueueRoll {
  constructor(formula) { this.formula = formula; this.total = 0; this.dice = []; }
  async evaluate() {
    if (!rollQueue.length) throw new Error(`unexpected roll ${this.formula}`);
    this.total = rollQueue.shift();
    this.dice = [{ values: [this.total] }];
    return this;
  }
}
const rollQueue = [];

const applyPatch = (target, patch) => {
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split(".");
    let cursor = target;
    while (parts[0] === "system") parts.shift();
    for (const part of parts.slice(0, -1)) {
      cursor[part] = cursor[part] ?? {};
      cursor = cursor[part];
    }
    cursor[parts.at(-1)] = value;
  }
};

const makeItem = (id, system) => {
  const item = {
    id, _id: id, name: id, type: "skill", system, updates: [],
    isOwner: true,
    async update(patch) {
      this.updates.push(patch);
      applyPatch(this.system, patch);
    },
  };
  return item;
};

const makeActor = (items, flags = {}) => {
  const collection = collectionOf(items);
  const actor = {
    id: "actor-1", name: "调查员", type: "character", isOwner: true,
    items: collection,
    flags,
    system: { lock: false },
    updates: [],
    prepareData() {
      for (const entry of items) entry.system.total = skillTotal(entry.system);
    },
    async update(patch) {
      this.updates.push(patch);
      applyPatch(this, patch);
    },
  };
  return actor;
};

let randomCounter = 0;
const Stub = class {};
const stub = new Proxy(Stub, {
  get(target, prop) {
    if (prop === "implementation") return Stub;
    if (prop === "prototype") return Stub.prototype;
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
    randomID: () => `stub-${randomCounter += 1}`,
    isEmpty: (value) => !value || Object.keys(value).length === 0,
    isNewerVersion: () => true,
  },
  applications: {
    handlebars: { renderTemplate: async () => "<div></div>" },
    api: new Proxy({
      ApplicationV2: class {
        constructor(options = {}) { this.options = options; }
        render() { return this; }
      },
      HandlebarsApplicationMixin: (Base) => class extends Base {},
    }, { get(target, prop) { return prop in target ? target[prop] : stub; } }),
    sheets: new Proxy({}, { get: () => stub }),
    ux: new Proxy({
      TextEditor: { implementation: { enrichHTML: async () => "" } },
      DragDrop: { implementation: Stub },
      ContextMenu: { implementation: Stub },
    }, { get(target, prop) { return prop in target ? target[prop] : stub; } }),
  },
  audio: { AudioHelper: { play() {} } },
}, { get(target, prop) { return prop in target ? target[prop] : stub; } });
globalThis.game = {
  version: "13.0.0",
  settings: {
    get: (namespace, key) => {
      if (namespace !== "brp") return false;
      if (key === "ruleset") return "coc";
      if (key === "xpFormula") return "1D10";
      return false;
    },
    register() {},
  },
  i18n: { localize: (key) => key, format: (key) => key },
  user: { id: "owner-1", isGM: false, targets: new Set() },
  users: { activeGM: null },
  modules: { get: () => null },
  actors: { get: () => null },
  messages: { get: () => null },
  items: { get: () => null },
  socket: { emit() {} },
};
globalThis.ui = { notifications: { error() {}, warn() {}, info() {} } };
globalThis.ChatMessage = { getSpeaker: () => ({}), create: async () => ({}) };
globalThis.CONST = { CHAT_MESSAGE_STYLES: { OTHER: 0 } };
globalThis.Roll = QueueRoll;
globalThis.Hooks = { on() {}, once() {}, callAll() {} };
for (const name of ["ActiveEffect", "Item", "Actor", "Combat", "Macro", "ItemSheet",
  "ActorSheet", "JournalEntry", "Folder", "Scene", "Token", "TokenDocument", "Drawing",
  "AmbientLight", "Cards", "RollTable", "MeasuredTemplate", "Dialog", "Application",
  "FormApplication", "TextEditor", "CONFIG", "canvas"]) globalThis[name] = stub;

const { settleCocInterlude } = await import("../../module/actor/sheets/coc/interlude-settlement.mjs");

// One ticked skill improves (d100 90 > 45, gain 7); the ticked Mythos is
// rejected and its dirty tick is cleared instead of settled.
const settleTicked = makeItem("settle-ticked", {
  base: "40",
  adjustments: { base: 0, personal: 0, occupation: 0, archetype: 0, experiencePackage: 0, experience: 5 },
  flags: { developement: true },
});
const settleMythos = makeItem("settle-mythos", {
  base: "0",
  adjustments: { experience: 10 },
  properties: { noxpgain: true },
  flags: { developement: true },
  improve: true,
});
settleTicked.system.total = skillTotal(settleTicked.system);
settleMythos.system.total = skillTotal(settleMythos.system);
const settleActor = makeActor([settleTicked, settleMythos], { brp: { coc: { growthLog: [] } } });
rollQueue.push(90, 7);
const settled = await settleCocInterlude(settleActor, null, ["settle-ticked", "settle-mythos"], { requestId: "req-1" });
expect("settleOne", settled.settled.length, 1);
expect("settleGain", settled.settled[0].gain, 7);
expect("settleBeforeAfter", [settled.settled[0].before, settled.settled[0].after], [45, 52]);
expect("settleNoXPRejected", settled.rejected.find((entry) => entry.itemId === "settle-mythos")?.reason, "no-xp");
expect("settleClearedNoXP", settled.cleared.map((entry) => entry.itemId), ["settle-mythos"]);
expectTrue("settleWritesCanonicalXp", settleTicked.updates.some((patch) => patch["system.adjustments.experience"] === 12),
  settleTicked.updates);
expectTrue("settleClearsCanonicalTick", settleTicked.updates.some((patch) => patch["system.flags.developement"] === false),
  settleTicked.updates);
expectTrue("settleClearsLegacyImprove", settleMythos.updates.some((patch) => patch["system.improve"] === false),
  settleMythos.updates);
expectTrue("settleNeverWritesLegacyXp", settleTicked.updates.every((patch) => !("system.xp" in patch)),
  settleTicked.updates);
expect("settleDerivedTotal", settleTicked.system.total, 52);
expect("settleGrowthLog", settleActor.flags.brp.coc.growthLog[0], {
  id: "req-1:settle-ticked",
  requestId: "req-1",
  module: "默认模组",
  timeLabel: settleActor.flags.brp.coc.growthLog[0]?.timeLabel,
  skillId: "settle-ticked",
  skillName: "settle-ticked",
  before: 45,
  after: 52,
  gain: 7,
  deltaLabel: "+7",
  undone: false,
});
expect("settleRequestRecorded", settleActor.flags.brp.coc.interludeRequests, ["req-1"]);
const updatesBeforeDuplicate = settleTicked.updates.length;
const duplicate = await settleCocInterlude(settleActor, null, ["settle-ticked"], { requestId: "req-1" });
expect("settleRequestIdempotent", duplicate.alreadySettled, true);
expect("settleDuplicateNoWrite", settleTicked.updates.length, updatesBeforeDuplicate);

// Permission is re-checked inside the settlement, not only by the sheet action.
const deniedItem = makeItem("denied", {
  base: "10",
  adjustments: {},
  flags: { developement: true },
});
const deniedActor = makeActor([deniedItem], { brp: { coc: { growthLog: [] } } });
deniedActor.isOwner = false;
const denied = await settleCocInterlude(deniedActor, null, ["denied"], { requestId: "req-denied" });
expect("settleRechecksPermission", denied.error, "not-authorised");
expect("settleDeniedNoWrite", deniedItem.updates.length, 0);
game.user.isGM = true;
rollQueue.push(90, 3);
const gmAllowed = await settleCocInterlude(deniedActor, null, ["denied"], { requestId: "req-denied-gm" });
game.user.isGM = false;
expect("settleGmAllowed", gmAllowed.settled.length, 1);
expectTrue("settleGmWrites", deniedItem.updates.some((patch) => patch["system.adjustments.experience"] === 3),
  deniedItem.updates);

// Strictly greater only: 60 against 60 is not an improvement, the tick is still
// consumed and no experience is written.
const boundary = makeItem("boundary", {
  base: "60",
  adjustments: { base: 0, personal: 0, occupation: 0, archetype: 0, experiencePackage: 0, experience: 0 },
  flags: { developement: true },
});
boundary.system.total = skillTotal(boundary.system);
const boundaryActor = makeActor([boundary], { brp: { coc: { growthLog: [] } } });
rollQueue.push(60);
const boundaryResult = await settleCocInterlude(boundaryActor, null, ["boundary"], { requestId: "req-boundary" });
expect("settleStrictlyGreater", boundaryResult.settled[0].improved, false);
expect("settleStrictlyGreaterGain", boundaryResult.settled[0].gain, 0);
expectTrue("settleFailureConsumesTick", boundary.updates.some((patch) => patch["system.flags.developement"] === false),
  boundary.updates);
expectTrue("settleFailureNoXpWrite", boundary.updates.every((patch) => patch["system.adjustments.experience"] === undefined),
  boundary.updates);

// Empty selection is a no-op: no roll, no growth log, no request record.
const emptySkill = makeItem("empty-skill", { base: "10", adjustments: {} });
emptySkill.system.total = skillTotal(emptySkill.system);
const emptyActor = makeActor([emptySkill], { brp: { coc: { growthLog: [], interludeRequests: [] } } });
const empty = await settleCocInterlude(emptyActor, null, [], { requestId: "req-empty" });
expect("settleEmptyNoRolls", empty.settled.length, 0);
expect("settleEmptyNoLog", emptyActor.flags.brp.coc.growthLog, []);
expect("settleEmptyNoRequest", emptyActor.flags.brp.coc.interludeRequests, []);
expect("settleEmptyNoItemWrites", emptySkill.updates.length, 0);

// A skill with no score data is refused rather than rolled as 0 (which would
// improve on almost every die).
const invalid = makeItem("invalid", {});
const invalidActor = makeActor([invalid], { brp: { coc: { growthLog: [] } } });
const invalidResult = await settleCocInterlude(invalidActor, null, ["invalid"], { manualIds: ["invalid"], requestId: "req-invalid" });
expect("settleInvalidScore", invalidResult.rejected.find((entry) => entry.itemId === "invalid")?.reason, "invalid-score");
expect("settleInvalidNoWrites", invalid.updates.length, 0);

// ------------------------------------------------------------------- undo
const { CocCharacterSheet } = await import("../../module/actor/sheets/coc/character.mjs");

// Interlude entry: use mode (`system.lock === true`) must still open for an
// editor, while a non-editable sheet (observer) never opens the settlement app.
const { CocInterludeSheet } = await import("../../module/actor/sheets/coc/interlude.mjs");
let interludeOpened = 0;
const originalInterludeRender = CocInterludeSheet.prototype.render;
CocInterludeSheet.prototype.render = function () { interludeOpened += 1; return this; };
const interludeSheetHost = {
  isEditable: true,
  actor: { system: { lock: true }, items: [] },
  document: { id: "interlude-host", isOwner: true },
};
await CocCharacterSheet._onCocInterlude.call(interludeSheetHost, { preventDefault() {} });
expect("interludeOpensWhileLocked", interludeOpened, 1);
interludeOpened = 0;
await CocCharacterSheet._onCocInterlude.call({ ...interludeSheetHost, isEditable: false }, { preventDefault() {} });
expect("interludeBlockedWhenNotEditable", interludeOpened, 0);
CocInterludeSheet.prototype.render = originalInterludeRender;

// Growth tick: a noxpgain skill can never be newly ticked, but a dirty imported
// tick can still be removed from the card.
const dirtyNoXp = makeItem("dirty-no-xp", {
  base: "0",
  adjustments: { experience: 4 },
  properties: { noxpgain: true },
  flags: { developement: true },
});
const cleanNoXp = makeItem("clean-no-xp", {
  base: "0",
  adjustments: {},
  properties: { noxpgain: true },
  flags: { developement: false },
});
const toggleSheet = {
  isEditable: true,
  actor: {
    system: { lock: false },
    items: collectionOf([dirtyNoXp, cleanNoXp]),
  },
};
const toggleTarget = (id) => ({ closest: () => ({ dataset: { itemId: id } }) });
await CocCharacterSheet._onCocToggleGrowth.call(toggleSheet, { preventDefault() {} }, toggleTarget("clean-no-xp"));
expect("noXpNewTickBlocked", cleanNoXp.updates.length, 0);
await CocCharacterSheet._onCocToggleGrowth.call(toggleSheet, { preventDefault() {} }, toggleTarget("dirty-no-xp"));
expectTrue("noXpDirtyTickRemovable", dirtyNoXp.updates.some((patch) => patch["system.flags.developement"] === false),
  dirtyNoXp.updates);

const undoItem = makeItem("undo-skill", {
  base: "30",
  adjustments: { base: 0, personal: 0, occupation: 0, archetype: 0, experiencePackage: 0, experience: 12 },
  flags: { developement: false },
});
undoItem.system.total = skillTotal(undoItem.system);
const undoActor = makeActor([undoItem], {
  brp: { coc: { growthLog: [{ id: "entry-1", skillId: "undo-skill", gain: 7, before: 30, after: 37, undone: false }] } },
});
const undoSheet = { isEditable: true, actor: undoActor };
await CocCharacterSheet._onCocUndoGrowth.call(undoSheet, { preventDefault() {} }, { dataset: { entryId: "entry-1" } });
expectTrue("undoWritesCanonicalXp", undoItem.updates.some((patch) => patch["system.adjustments.experience"] === 5),
  undoItem.updates);
expectTrue("undoNeverWritesLegacyXp", undoItem.updates.every((patch) => !("system.xp" in patch)), undoItem.updates);
expect("undoMarksLog", undoActor.flags.brp.coc.growthLog[0].undone, true);
// The guard still refuses an undo larger than the accumulated experience.
const guardItem = makeItem("guard-skill", { base: "10", adjustments: { experience: 2 } });
const guardActor = makeActor([guardItem], {
  brp: { coc: { growthLog: [{ id: "entry-2", skillId: "guard-skill", gain: 7, undone: false }] } },
});
let warned = false;
const originalWarn = globalThis.ui.notifications.warn;
globalThis.ui.notifications.warn = () => { warned = true; };
await CocCharacterSheet._onCocUndoGrowth.call({ isEditable: true, actor: guardActor }, { preventDefault() {} }, { dataset: { entryId: "entry-2" } });
globalThis.ui.notifications.warn = originalWarn;
expect("undoGuardWarns", warned, true);
expect("undoGuardNoWrite", guardItem.updates.length, 0);

// ------------------------------------------------------- inline edit mapping
const { BRPActorSheetV2 } = await import("../../module/actor/sheets/base-actor-sheet.mjs");
const inlineItem = makeItem("inline-skill", {
  base: "20",
  adjustments: { base: 0, personal: 1, occupation: 2, archetype: 3, experiencePackage: 4, experience: 5 },
});
let prepared = 0;
let rendered = 0;
const inlineSheet = {
  isEditable: true,
  actor: {
    items: collectionOf([inlineItem]),
    prepareData() { prepared += 1; },
    render() { rendered += 1; },
  },
};
globalThis.$ = () => ({ closest: () => ({ data: () => "inline-skill" }) });
const inline = async (field, value) => {
  inlineItem.updates.length = 0;
  await BRPActorSheetV2.skillInline.call(inlineSheet, {
    preventDefault() {},
    currentTarget: {},
    target: { dataset: { field }, value },
  });
  return inlineItem.updates[0] ?? null;
};
expect("inlineBase", await inline("base", "22"), { "system.base": 22 });
expect("inlineXp", await inline("xp", "9"), { "system.adjustments.experience": 9 });
expect("inlineProfession", await inline("profession", "10"), { "system.adjustments.occupation": 10 });
expect("inlinePersonal", await inline("personal", "8"), { "system.adjustments.personal": 8 });
expect("inlineEffects", await inline("effects", "2"), { "system.adjustments.base": 2 });
expect("inlineCulture", await inline("culture", "6"), { "system.adjustments.experiencePackage": 6 });
expect("inlinePersonality", await inline("personality", "4"), { "system.adjustments.archetype": 4 });
expect("inlineEmptyNumber", await inline("xp", ""), { "system.adjustments.experience": 0 });
expect("inlineGarbageIsIgnored", await inline("xp", "not-a-number"), null);
expectTrue("inlineRepreparesDerivedTotal", prepared >= 8, prepared);
expectTrue("inlineRerenders", rendered >= 8, rendered);

const result = {
  checks: checks.length,
  failed: failures.length,
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exit(1);
