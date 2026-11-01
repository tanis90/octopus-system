// Native CoC actor-schema regression probe for SAN / insanity / Luck settlement.
//
//   node tools/tests/sanity-regressions.mjs
//
// The pure decision tables remain covered by coc-sanity-regressions.mjs. This
// probe exercises the real app modules with a minimal Foundry surface and native
// actor fixtures: attribs.san/lck, characteristics.int and conditions.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const clone = (value) => value === undefined ? undefined : structuredClone(value);
const setPath = (target, path, value) => {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
};

const settings = new Map();
const settingKey = (namespace, key) => `${namespace}.${key}`;
settings.set(settingKey("brp", "ruleset"), "coc");
settings.set(settingKey("brp", "worldTime"), 3 * 86400 + 3600);
settings.set(settingKey("brp", "cocDaySeq"), 0);
settings.set(settingKey("brp", "cocSessionSeq"), 0);

const gm = { id: "gm", isGM: true };
const player = { id: "player", isGM: false };
const actors = new Map();
actors.tokens = {};
const messages = new Map();
const notifications = [];

globalThis.game = {
  user: gm,
  users: {
    activeGM: gm,
    get(id) { return id === gm.id ? gm : id === player.id ? player : null; },
  },
  actors,
  messages,
  settings: {
    get(namespace, key) { return settings.get(settingKey(namespace, key)) ?? 0; },
    async set(namespace, key, value) { settings.set(settingKey(namespace, key), value); },
  },
  time: { worldTime: 3 * 86400 + 3600 },
  i18n: {
    localize(key) { return key; },
    format(key, values) { return `${key}:${JSON.stringify(values)}`; },
  },
  socket: { emit() {} },
};

globalThis.ui = {
  notifications: {
    info(message) { notifications.push(message); },
    warn(message) { notifications.push(message); },
  },
};

globalThis.foundry = {
  applications: {
    api: {
      DialogV2: class {},
      ApplicationV2: class {},
      DocumentSheetV2: class {},
      HandlebarsApplicationMixin: (base) => class extends base {},
    },
    sheets: { ActorSheetV2: class {}, ItemSheetV2: class {} },
    ux: { ContextMenu: { implementation: class {} } },
    handlebars: { renderTemplate: async () => "<div>mock</div>" },
  },
  utils: { deepClone: clone },
};

let rollQueue = [];
const queueRolls = (...totals) => { rollQueue.push(...totals); };
globalThis.Roll = class Roll {
  constructor(formula) {
    this.formula = formula;
    this.total = 0;
  }

  async evaluate() {
    assert.ok(rollQueue.length > 0, `unexpected real roll ${this.formula}`);
    this.total = rollQueue.shift();
    return this;
  }
};

let effectSequence = 0;
class MockActiveEffect {
  constructor(data, parent) {
    Object.assign(this, clone(data));
    this.id = `effect-${++effectSequence}`;
    this.parent = parent;
    this.statuses = new Set(data.statuses ?? []);
    this.disabled = data.disabled === true;
  }

  static async createDocuments(data, { parent }) {
    return data.map((entry) => {
      const effect = new MockActiveEffect(entry, parent);
      parent.effects.push(effect);
      return effect;
    });
  }

  async update(changes) {
    for (const [path, value] of Object.entries(changes)) setPath(this, path, clone(value));
    return this;
  }

  async delete() {
    this.parent.effects = this.parent.effects.filter((effect) => effect !== this);
  }
}
globalThis.ActiveEffect = MockActiveEffect;
globalThis.Actor = class {};
globalThis.Item = class {};
globalThis.ChatMessage = class {
  static async create(data) { return clone(data); }
};

const { BRPSanity } = await import("../../module/apps/sanity.mjs");
const { BRPLuck } = await import("../../module/apps/luck.mjs");
const { BRPMadness } = await import("../../module/apps/madness.mjs");
const { BRPWorldTime } = await import("../../module/apps/worldTime.mjs");
const { Rules } = await import("../../module/rules/index.mjs");

let actorSequence = 0;
class MockActor {
  constructor({ san = 60, dailyLoss = 0, luck = 50, int: intelligence = 60, details = {} } = {}) {
    this.id = `actor-${++actorSequence}`;
    this.name = this.id;
    this.type = "character";
    this.token = null;
    this.system = {
      attribs: {
        san: { auto: false, value: san, max: 99, dailyLoss, dailyLimit: 0 },
        lck: { value: luck },
      },
      characteristics: { int: { value: intelligence } },
      conditions: {
        tempoInsane: { value: false, realTime: false, duration: 0 },
        indefInsane: { value: false },
      },
    };
    this.flags = {
      brp: {
        coc: {
          sanity: {
            starting: 60,
            dayId: BRPWorldTime.dayId(),
            dayStartSan: 60,
            dayStartSource: "keeper-new-day",
            ...clone(details),
          },
        },
      },
    };
    this.effects = [];
    this.items = new Map();
    this.isOwner = true;
    this.updates = [];
    actors.set(this.id, this);
  }

  testUserPermission(user, level) {
    return user?.isGM === true || (this.isOwner && level === "OWNER");
  }

  async update(changes) {
    this.updates.push(clone(changes));
    for (const [path, value] of Object.entries(changes)) setPath(this, path, clone(value));
    return this;
  }
}

class MockMessage {
  constructor(card) {
    this.id = `message-${messages.size + 1}`;
    this.flags = { brp: clone(card) };
    this.content = "before";
    this.updates = [];
    messages.set(this.id, this);
  }

  async update(changes) {
    this.updates.push(clone(changes));
    for (const [path, value] of Object.entries(changes)) setPath(this, path, clone(value));
    return this;
  }
}

const allActorWrites = (actor) => Object.assign({}, ...actor.updates);
const assertNoLegacyWrites = (actor) => {
  for (const update of actor.updates) {
    for (const path of Object.keys(update)) {
      assert.equal(/^system\.(?:sanity|luck)\b/.test(path), false, path);
      assert.equal(path.includes("sanityLossEvents"), false, path);
    }
  }
};

const checks = {};
const failures = [];
const check = async (name, fn) => {
  try {
    await fn();
    checks[name] = true;
  } catch (thrown) {
    checks[name] = { ok: false, detail: thrown?.stack ?? String(thrown) };
    failures.push(`${name}: ${thrown?.message ?? thrown}`);
  }
};

await check("stateReadsNativeAttribsConditionsAndOnlyExtendedFlags", async () => {
  const actor = new MockActor({
    san: 47,
    dailyLoss: 8,
    details: {
      starting: 55,
      singleLoss: 5,
      dayStartSan: 50,
      dayStartSource: "first-loss-of-day",
      insanity: {
        temporary: { active: false, hours: 4 },
        indefinite: { active: false, threshold: 10 },
        permanent: true,
      },
    },
  });
  actor.system.conditions.tempoInsane.value = true;
  actor.system.conditions.indefInsane.value = true;
  const state = BRPSanity.state(actor);
  assert.equal(state.value, 47);
  assert.equal(state.max, 99);
  assert.equal(state.starting, 55);
  assert.equal(state.singleLoss, 5);
  assert.equal(state.dailyLoss, 8);
  assert.equal(state.dayStartSan, 50);
  assert.equal(state.dailyThreshold, 10);
  assert.equal(state.dailyReached, false);
  assert.equal(state.temporary.active, true);
  assert.equal(state.indefinite.active, true);
  assert.equal(state.permanent, true);
});

await check("settlementWritesNativeSanAndAllExtendedDetailsToOneFlag", async () => {
  const actor = new MockActor({ dailyLoss: 2 });
  const result = await BRPSanity.settleNow({ actor, loss: 4 });
  assert.equal(result.applied, true);
  assert.equal(actor.system.attribs.san.value, 56);
  assert.equal(actor.system.attribs.san.dailyLoss, 6);
  const details = actor.flags.brp.coc.sanity;
  assert.equal(details.singleLoss, 4);
  assert.equal(details.dayId, BRPWorldTime.dayId());
  assert.equal(details.dayStartSan, 60);
  assert.equal(details.lastLossAt, BRPWorldTime.now());
  assert.equal(details.insanity.permanent, false);
  assert.equal(actor.system.conditions.tempoInsane.value, false);
  assert.equal(actor.system.conditions.indefInsane.value, false);
  assert.equal(actor.flags.brp.coc.sanityLog.at(-1).sanAfter, 56);
  assertNoLegacyWrites(actor);
});

await check("singleLossUsesNativeINTAndSynchronizesTemporaryCondition", async () => {
  const actor = new MockActor({ int: 60 });
  queueRolls(40, 4, 2, 6);
  const result = await BRPSanity.settleNow({ actor, loss: 6 });
  assert.equal(result.applied, true);
  assert.equal(result.intCheck.target, 60);
  assert.equal(result.intCheck.passed, true);
  assert.equal(result.temporary.hours, 4);
  assert.deepEqual(actor.system.conditions.tempoInsane, { value: true, realTime: false, duration: 4 });
  assert.equal(actor.flags.brp.coc.sanity.insanity.temporary.active, true);
  assert.equal(actor.flags.brp.coc.sanity.insanity.temporary.hours, 4);
  assert.ok(actor.effects.some((effect) => effect.statuses.has("tempInsane")));
  assertNoLegacyWrites(actor);
});

await check("dailyThresholdSynchronizesOnlyIndefiniteCondition", async () => {
  const actor = new MockActor({ dailyLoss: 8 });
  const result = await BRPSanity.settleNow({ actor, loss: 4 });
  assert.equal(result.applied, true);
  assert.equal(result.indefinite.active, true);
  assert.equal(result.temporary, null);
  assert.equal(actor.system.attribs.san.dailyLoss, 12);
  assert.equal(actor.system.conditions.indefInsane.value, true);
  assert.equal(actor.system.conditions.tempoInsane.value, false);
  assert.equal(actor.flags.brp.coc.sanity.insanity.indefinite.active, true);
  assert.ok(actor.effects.some((effect) => effect.statuses.has("indefiniteInsane")));
  assertNoLegacyWrites(actor);
});

await check("completeIntCheckReadsNativeINTAndExtendedSingleLoss", async () => {
  const actor = new MockActor({
    int: 55,
    details: { singleLoss: 6 },
  });
  queueRolls(3, 4, 5);
  const result = await BRPSanity.completeIntCheck({ actor, roll: 55 });
  assert.equal(result.applied, true);
  assert.equal(result.intCheck.target, 55);
  assert.equal(result.temporary.hours, 3);
  assert.equal(actor.system.attribs.san.value, 60);
  assert.deepEqual(actor.system.conditions.tempoInsane, { value: true, realTime: false, duration: 3 });
  assert.equal(actor.flags.brp.coc.sanity.insanity.temporary.dayId, BRPWorldTime.dayId());
  assertNoLegacyWrites(actor);
});

await check("endingEpisodesSynchronizesNativeConditionsWithoutClearingPeers", async () => {
  const actor = new MockActor({
    details: {
      insanity: {
        temporary: { active: true, hours: 4, dayId: BRPWorldTime.dayId() },
        indefinite: { active: true, threshold: 12 },
        permanent: false,
      },
    },
  });
  actor.system.conditions.tempoInsane = { value: true, realTime: false, duration: 4 };
  actor.system.conditions.indefInsane.value = true;
  await MockActiveEffect.createDocuments([{ statuses: ["tempInsane"] }], { parent: actor });
  await MockActiveEffect.createDocuments([{ statuses: ["indefiniteInsane"] }], { parent: actor });

  const temporary = await BRPSanity.endTemporary({ actor, reason: "keeper-ended" });
  assert.equal(temporary.ended, true);
  assert.deepEqual(actor.system.conditions.tempoInsane, { value: false, realTime: false, duration: 0 });
  assert.equal(actor.system.conditions.indefInsane.value, true);
  assert.equal(actor.flags.brp.coc.sanity.insanity.temporary.active, false);
  assert.equal(actor.flags.brp.coc.sanity.insanity.indefinite.active, true);

  const indefinite = await BRPSanity.endIndefinite({ actor, reason: "keeper-recovery" });
  assert.equal(indefinite.ended, true);
  assert.equal(actor.system.conditions.indefInsane.value, false);
  assert.equal(actor.flags.brp.coc.sanity.insanity.indefinite.active, false);
  assertNoLegacyWrites(actor);
});

await check("madnessEditsAndEffectDeletionSynchronizeNativeState", async () => {
  const actor = new MockActor({
    details: {
      insanity: {
        temporary: { active: true, hours: 4 },
        indefinite: { active: true, threshold: 10 },
        permanent: false,
      },
    },
  });
  actor.system.conditions.tempoInsane = { value: true, realTime: false, duration: 4 };
  actor.system.conditions.indefInsane.value = true;
  await BRPMadness._syncCocInsanity({ actorId: actor.id, duration: { hours: 6 } });
  assert.deepEqual(actor.system.conditions.tempoInsane, { value: true, realTime: false, duration: 6 });
  assert.equal(actor.flags.brp.coc.sanity.insanity.temporary.hours, 6);
  assert.equal(actor.system.conditions.indefInsane.value, true);

  const effect = new MockActiveEffect({ statuses: ["tempInsane"], disabled: true }, actor);
  actor.effects.push(effect);
  await BRPMadness.syncEndedFromEffect(effect);
  assert.deepEqual(actor.system.conditions.tempoInsane, { value: false, realTime: false, duration: 0 });
  assert.equal(actor.flags.brp.coc.sanity.insanity.temporary.active, false);
  assert.equal(actor.flags.brp.coc.sanity.insanity.temporary.endReason, "effect-disabled");
  assert.equal(actor.flags.brp.coc.sanity.insanity.indefinite.active, true);
  assertNoLegacyWrites(actor);
});

await check("zeroSANUsesExtendedPermanentAndEffectNotNativePermanentCondition", async () => {
  const actor = new MockActor({ san: 3 });
  const result = await BRPSanity.settleNow({ actor, loss: 9 });
  assert.equal(result.applied, true);
  assert.equal(result.permanent, true);
  assert.equal(actor.system.attribs.san.value, 0);
  assert.equal(actor.flags.brp.coc.sanity.insanity.permanent, true);
  assert.equal("permaInsane" in actor.system.conditions, false);
  assert.equal("permanent" in actor.system.conditions, false);
  assert.ok(actor.effects.some((effect) => effect.statuses.has("permaInsane")));
  const updateCount = actor.updates.length;
  const blocked = await BRPSanity.settleNow({ actor, loss: 1 });
  assert.equal(blocked.reason, "permanent-insanity");
  assert.equal(actor.updates.length, updateCount);

  const cleared = await BRPSanity.clearPermanent({ actor, reason: "keeper-retirement-review" });
  assert.equal(cleared.cleared, true);
  assert.equal(actor.flags.brp.coc.sanity.insanity.permanent, false);
  assert.equal(actor.effects.some((effect) => effect.statuses.has("permaInsane")), false);
  assertNoLegacyWrites(actor);
});

await check("newDayResetsNativeDailyLossAndStoresFlagSnapshot", async () => {
  const actor = new MockActor({ san: 47, dailyLoss: 9 });
  const result = await BRPSanity.newDay({ actor });
  assert.equal(result.started, true);
  assert.equal(actor.system.attribs.san.dailyLoss, 0);
  assert.equal(actor.flags.brp.coc.sanity.dayStartSan, 47);
  assert.equal(actor.flags.brp.coc.sanity.dayId, result.dayId);
  assert.equal(actor.flags.brp.coc.sanity.dayStartSource, "keeper-new-day");
  assertNoLegacyWrites(actor);
});

await check("luckCardAndSpendUseNativeValueAndRulesCapWithoutNativeMax", async () => {
  const actor = new MockActor({ luck: 50 });
  const snapshot = BRPLuck.cardLuck(actor, BRPLuck.CHECK_TEMPLATE, {
    rollType: "SK",
    cardType: "NO",
    rollVal: 40,
  });
  assert.deepEqual(snapshot, { value: 50, max: 99 });
  const result = await BRPLuck.applyLuck(actor, {
    rollType: "SK",
    rollVal: 40,
    targetScore: 60,
    luckSpent: 0,
  }, 10, "NO", { rollType: "SK" });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.luck, { value: 40, max: 99, spent: 10 });
  assert.equal(result.roll.rollVal, 30);
  assert.equal("max" in actor.system.attribs.lck, false);
  assert.equal(Rules.for("coc").luck.cap(), 99);
});

await check("concurrentCardSpendsSerializeAndWriteOnlyNativeLuck", async () => {
  const actor = new MockActor({ luck: 50 });
  const message = new MockMessage({
    rollType: "SK",
    cardType: "NO",
    chatCard: [{
      particId: actor.id,
      particType: "actor",
      rollType: "SK",
      rollVal: 60,
      rollResult: 60,
      targetScore: 50,
      resultLevel: 1,
      luck: { value: 50, max: 99 },
      luckSpent: 0,
    }],
  });
  const data = { targetChatId: message.id, index: 0, amount: 20, origin: gm.id, originGM: true };
  await Promise.all([BRPLuck.spendFromCard(data), BRPLuck.spendFromCard(data)]);
  assert.equal(actor.system.attribs.lck.value, 10);
  assert.equal("max" in actor.system.attribs.lck, false);
  const entry = message.flags.brp.chatCard[0];
  assert.equal(entry.rollVal, 20);
  assert.equal(entry.originalRawScore, 60);
  assert.equal(entry.luckSpent, 40);
  assert.deepEqual(entry.luck, { value: 10, max: 99 });
  assertNoLegacyWrites(actor);
});

await check("nonOwnerCardSpendIsRefusedBeforeNativeLuckWrite", async () => {
  const actor = new MockActor({ luck: 50 });
  actor.isOwner = false;
  const message = new MockMessage({
    rollType: "SK",
    cardType: "NO",
    chatCard: [{
      particId: actor.id,
      particType: "actor",
      rollType: "SK",
      rollVal: 60,
      targetScore: 50,
      luck: { value: 50, max: 99 },
    }],
  });
  await BRPLuck.spendFromCard({
    targetChatId: message.id,
    index: 0,
    amount: 5,
    origin: player.id,
    originGM: false,
  });
  assert.equal(actor.system.attribs.lck.value, 50);
  assert.equal(actor.updates.length, 0);
  assert.equal(message.updates.length, 0);
});

await check("relayedSettlementStillRejectsNonOwnerBeforeAnyWrite", async () => {
  const actor = new MockActor();
  actor.isOwner = false;
  const result = await BRPSanity.settleNow({ actor, loss: 5, origin: player.id });
  assert.equal(result.error, "not-authorised");
  assert.equal(actor.system.attribs.san.value, 60);
  assert.equal(actor.updates.length, 0);
});

await check("luckRecoveryUsesNativeValueAndCapsAt99WithoutCreatingMax", async () => {
  const actor = new MockActor({ luck: 85 });
  queueRolls(90, 10, 10);
  const result = await BRPSanity.luckRecovery({ actor });
  assert.equal(result.applied, true);
  assert.equal(result.formula, "2D10+10");
  assert.equal(result.luck.after, 99);
  assert.equal(result.luck.capped, true);
  assert.equal(actor.system.attribs.lck.value, 99);
  assert.equal("max" in actor.system.attribs.lck, false);
  assert.equal(actor.flags.brp.coc.sanityLog.at(-1).event, "luck-recovery");
  assertNoLegacyWrites(actor);
});

await check("appSourcesContainNoLegacySchemaOrInventedLossEventSchema", async () => {
  for (const file of ["module/apps/sanity.mjs", "module/apps/luck.mjs"]) {
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.equal(/system\??\.(?:sanity|luck)\b/.test(source), false, file);
    assert.equal(/stats\??\.int\??\.total/.test(source), false, file);
    assert.equal(source.includes("sanityLossEvents"), false, file);
  }
});

assert.deepEqual(rollQueue, [], "every queued roll must be consumed");
const failed = failures.length;
console.log(JSON.stringify({
  checks: Object.keys(checks).length,
  failed,
  errors: failures,
  summary: checks,
}, null, 2));
if (failed) process.exit(1);
