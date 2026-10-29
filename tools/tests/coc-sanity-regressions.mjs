// M4 pure-core regression probe: CoC sanity / insanity / luck / growth decisions.
//
//   node tools/tests/coc-sanity-regressions.mjs
//
// The module under test (module/rules/coc-sanity.mjs) has no Foundry imports, so
// this runs with plain node and no harness. It covers:
//   1. SAN single-loss threshold boundary 4 / 5 / 6 and the clamp to remaining SAN
//   2. INT check pending / passed / failed, never defaulted to either
//   3. keeper game-day snapshot, same-day accumulation and day rollover
//   4. SAN reaching zero = permanent, and temporary/indefinite/permanent coexisting
//   5. injected hours/bout/rounds dice and explicit keeper end semantics
//   6. Luck spend negatives (each purpose plus pushed/fumble/natural 01/balance)
//   7. natural 01 versus Luck-adjusted 01 banding
//   8. growth tick (success, Luck-spent success, noXP, NPC) and settlement
//   9. Luck recovery both branches and the 99 cap
//  10. input immutability, fail-closed illegal input, source isolation
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CoCSanity, CoCSanityRuleError, EVIDENCE, PULP_ONLY_LUCK_SPENDS, LUCK_CAP,
  SINGLE_LOSS_THRESHOLD, boutTable, resolveBout, singleLossTrigger, intCheckState,
  temporaryInsanity, endTemporaryInsanity, dailyThreshold, dailyInsanity,
  beginGameDay, advanceGameDay, rollGameDay, insanityState, settleSanLoss, canSpendLuck,
  applyLuckSpend, cocBand, luckRecovery, canTickGrowth, growthSettlement,
} from "../../module/rules/coc-sanity.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const checks = {};
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    checks[name] = true;
  } catch (thrown) {
    checks[name] = { ok: false, detail: thrown?.message ?? String(thrown) };
    failures.push(`${name}: ${thrown?.message ?? thrown}`);
  }
};
const codeOf = (fn) => {
  try { fn(); return "accepted"; } catch (thrown) { return thrown instanceof CoCSanityRuleError ? thrown.code : `other:${thrown?.name}`; }
};
const deepFreeze = (value) => {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
};

// --- 1) single-loss threshold ---
check("singleLossBoundary4_5_6", () => {
  const four = singleLossTrigger({ loss: 4 });
  const five = singleLossTrigger({ loss: 5 });
  const six = singleLossTrigger({ loss: 6 });
  assert.equal(four.trigger, false);
  assert.equal(four.requiresIntCheck, false);
  assert.equal(five.trigger, true);
  assert.equal(five.requiresIntCheck, true);
  assert.equal(five.intSuccessOn, "roll <= INT");
  assert.equal(six.trigger, true);
  assert.equal(SINGLE_LOSS_THRESHOLD, 5);
  assert.equal(singleLossTrigger({ loss: 0 }).trigger, false);
});

check("singleLossClampsToRemainingSan", () => {
  const result = settleSanLoss({ loss: 8, sanBefore: 3, dayStartSan: 40, dayId: "day-1", dailyLossBefore: 0 });
  assert.equal(result.loss.rolled, 8);
  assert.equal(result.loss.applied, 3);
  assert.equal(result.loss.clamped, true);
  assert.equal(result.san.after, 0);
  assert.equal(result.dailyLoss.after, 3);
  // The applied (3), not the rolled (8), drives the single-loss INT trigger.
  assert.equal(result.intCheck.required, false);
  assert.equal(result.permanentInsanity, true);
});

// --- 2) INT states ---
check("intCheckPendingNeverDefaults", () => {
  const pending = intCheckState(null);
  assert.equal(pending.status, "pending");
  assert.equal(pending.roll, null);
  const episode = temporaryInsanity({ loss: 6, intCheck: null });
  assert.equal(episode.active, false);
  assert.equal(episode.status, "pending-int-check");
  assert.deepEqual([...episode.requires], ["int-check"]);
  const settled = settleSanLoss({ loss: 6, sanBefore: 40, dayStartSan: 40, dayId: "day-1", dailyLossBefore: 0 });
  assert.equal(settled.temporaryInsanity.status, "pending-int-check");
  assert.ok(settled.pending.includes("int-check"));
  assert.ok(settled.effects.some((effect) => effect.type === "request-int-check"));
  assert.equal(settled.effects.some((effect) => effect.type === "apply-temporary-insanity"), false);
});

check("intCheckPassedStartsEpisode", () => {
  const passed = intCheckState({ roll: 40, target: 40 });
  assert.equal(passed.status, "passed");
  const borderline = intCheckState({ roll: 41, target: 40 });
  assert.equal(borderline.status, "failed");
  const episode = temporaryInsanity({ loss: 5, intCheck: { roll: 12, target: 60 }, hoursDie: 7, boutDie: 4, roundsDie: 9, dayId: "day-1" });
  assert.equal(episode.active, true);
  assert.equal(episode.status, "active");
  assert.equal(episode.hours.value, 7);
  assert.equal(episode.hours.unit, "hours");
  assert.equal(episode.bout.index, 4);
  assert.equal(episode.bout.id, "paranoia");
  assert.equal(episode.rounds.value, 9);
  assert.equal(episode.expiry.autoRecovery, false);
  assert.equal(episode.expiry.keeperClockRequired, true);
});

check("intCheckFailedLeavesInvestigatorSaneForNow", () => {
  const episode = temporaryInsanity({ loss: 9, intCheck: { roll: 80, target: 55 }, hoursDie: 3, boutDie: 1, roundsDie: 2 });
  assert.equal(episode.active, false);
  assert.equal(episode.status, "repressed");
  assert.equal(episode.hours, undefined);
  const settled = settleSanLoss({
    loss: 9, sanBefore: 60, dayStartSan: 60, dayId: "day-1", dailyLossBefore: 0,
    intCheck: { roll: 80, target: 55 },
  });
  assert.equal(settled.temporaryInsanity.status, "repressed");
  assert.equal(settled.effects.some((effect) => effect.type === "apply-temporary-insanity"), false);
});

check("intPassedWithoutDiceStaysPending", () => {
  const episode = temporaryInsanity({ loss: 5, intCheck: { roll: 10, target: 50 } });
  assert.equal(episode.status, "pending-dice");
  assert.deepEqual([...episode.requires], ["hours-die", "bout-die", "rounds-die"]);
  const settled = settleSanLoss({ loss: 5, sanBefore: 50, dayStartSan: 50, dayId: "day-1", intCheck: { roll: 10, target: 50 } });
  assert.ok(settled.pending.includes("insanity-dice"));
  assert.equal(settled.temporaryInsanity.active, false);
});

// --- 3) game day ---
check("dailyThresholdNeedsExplicitBasis", () => {
  const missing = dailyThreshold({ basis: "day-start", dayStartSan: null });
  assert.equal(missing.available, false);
  assert.equal(missing.threshold, null);
  assert.equal(missing.reason, "dayStartSan-missing");

  const zero = dailyThreshold({ basis: "day-start", dayStartSan: 0 });
  assert.equal(zero.available, false);
  assert.equal(zero.threshold, null);

  const dayStart = dailyThreshold({ basis: "day-start", dayStartSan: 45 });
  assert.equal(dayStart.threshold, 9);
  const starting = dailyThreshold({ basis: "starting", startingSan: 50 });
  assert.equal(starting.threshold, 10);
  const current = dailyThreshold({ basis: "current", currentSan: 30 });
  assert.equal(current.threshold, 6);
  // 5 -> 1, 6 -> 2: one fifth rounds up to the smallest whole loss that reaches it.
  assert.equal(dailyThreshold({ basis: "day-start", dayStartSan: 5 }).threshold, 1);
  assert.equal(dailyThreshold({ basis: "day-start", dayStartSan: 6 }).threshold, 2);
});

check("dailyThresholdRejectsUnknownBasis", () => {
  assert.equal(codeOf(() => dailyThreshold({ basis: "power", dayStartSan: 40 })), "invalid-basis");
});

check("sameDayAccumulatesAcrossRolls", () => {
  const day = beginGameDay({ dayId: "day-1", san: 60 });
  const first = settleSanLoss({ loss: 4, sanBefore: 60, snapshot: day });
  assert.equal(first.dailyLoss.after, 4);
  assert.equal(first.indefiniteInsanity.active, false);
  assert.equal(first.indefiniteInsanity.threshold, 12);

  // Continuing the same day must carry the day-start SAN, not rebase on it.
  const midDay = advanceGameDay({ previous: day, san: 56, dailyLoss: first.dailyLoss.after });
  assert.equal(midDay.dayStartSan, 60);
  assert.equal(midDay.dayId, "day-1");
  const second = settleSanLoss({ loss: 4, sanBefore: 56, snapshot: midDay });
  assert.equal(second.dailyLoss.after, 8);
  assert.equal(second.indefiniteInsanity.threshold, 12);
  assert.equal(second.indefiniteInsanity.active, false);

  const thirdDay = advanceGameDay({ previous: midDay, san: 52, dailyLoss: second.dailyLoss.after });
  const third = settleSanLoss({ loss: 4, sanBefore: 52, snapshot: thirdDay });
  // 12 >= ceil(60/5) = 12 -> indefinite, while no single roll reached 5.
  assert.equal(third.dailyLoss.after, 12);
  assert.equal(third.intCheck.required, false);
  assert.equal(third.indefiniteInsanity.active, true);
  assert.equal(third.indefiniteInsanity.threshold, 12);
  assert.equal(third.indefiniteInsanity.basisValue, 60);
});

check("advanceGameDayRequiresPriorSnapshot", () => {
  assert.equal(codeOf(() => advanceGameDay({ san: 50 })), "previous-day-missing");
  assert.equal(codeOf(() => advanceGameDay({ previous: {}, san: 50 })), "previous-day-missing");
  assert.equal(codeOf(() => advanceGameDay({ previous: { dayId: "day-1", dailyLoss: 0 }, san: 50 })), "day-start-missing");
  const carried = advanceGameDay({ previous: { dayId: "day-1", dayStartSan: 60, dailyLoss: 3 }, san: 57 });
  assert.equal(carried.dailyLoss, 3);
  assert.equal(carried.carriedDayStartSan, true);
});

check("dayRolloverResetsDailyLossAndThreshold", () => {
  const dayOne = beginGameDay({ dayId: "day-1", san: 60 });
  const spent = settleSanLoss({ loss: 4, sanBefore: 60, snapshot: { ...dayOne, dailyLoss: 10 } });
  assert.equal(spent.indefiniteInsanity.active, true);

  const dayTwo = rollGameDay({ previous: { ...dayOne, dailyLoss: 10 }, dayId: "day-2", san: 56 });
  assert.equal(dayTwo.dailyLoss, 0);
  assert.equal(dayTwo.dayStartSan, 56);
  assert.equal(dayTwo.resetDailyLoss, true);
  assert.equal(codeOf(() => rollGameDay({ previous: dayOne, dayId: "day-1", san: 50 })), "day-id-reused");
  assert.equal(codeOf(() => rollGameDay({ previous: {}, dayId: "day-2", san: 50 })), "previous-day-missing");

  // The day-2 threshold follows the day-2 snapshot, not the original 60.
  const afterRollover = dailyThreshold({ basis: "day-start", dayStartSan: dayTwo.dayStartSan });
  assert.equal(afterRollover.threshold, 12);
  // 56 / 5 = 11.2 -> 12; a 5-loss on day 2 (threshold 12) is not indefinite yet.
  const partial = settleSanLoss({ loss: 5, sanBefore: 56, snapshot: dayTwo, intCheck: { roll: 90, target: 50 } });
  assert.equal(partial.dailyLoss.after, 5);
  assert.equal(partial.indefiniteInsanity.active, false);
});

check("dailyTriggerWithoutDayIdStaysPending", () => {
  const result = settleSanLoss({ loss: 12, sanBefore: 60, dayStartSan: 60, dailyLossBefore: 0, intCheck: { roll: 99, target: 40 } });
  assert.equal(result.indefiniteInsanity.active, true);
  assert.ok(result.pending.includes("day-id"));
  assert.equal(result.indefiniteInsanity.dayId, null);
});

check("dailyAndSingleThresholdsStayIndependent", () => {
  // 4 lost on each of three rolls: daily fires, single never does.
  const result = settleSanLoss({ loss: 4, sanBefore: 60, dayStartSan: 60, dailyLossBefore: 8, dayId: "day-1" });
  assert.equal(result.intCheck.required, false);
  assert.equal(result.indefiniteInsanity.active, true);
  assert.equal(result.temporaryInsanity, null);

  // 6 lost once: single fires, daily (threshold 12) does not.
  const single = settleSanLoss({ loss: 6, sanBefore: 60, dayStartSan: 60, dailyLossBefore: 0, dayId: "day-1", intCheck: { roll: 5, target: 50 }, hoursDie: 4, boutDie: 2, roundsDie: 6 });
  assert.equal(single.intCheck.required, true);
  assert.equal(single.temporaryInsanity.active, true);
  assert.equal(single.indefiniteInsanity.active, false);
});

check("dailyBasisIsNotSilentlyCrossed", () => {
  // A day-start SAN must never be reused as if it were the "current" basis.
  const result = settleSanLoss({
    loss: 12, sanBefore: 48, dayStartSan: 60, dailyLossBefore: 0, dayId: "day-1",
    dailyBasis: "current", intCheck: { roll: 99, target: 40 },
  });
  assert.equal(result.indefiniteInsanity.available, false);
  assert.equal(result.indefiniteInsanity.active, false);
  assert.equal(result.indefiniteInsanity.threshold, null);
  assert.equal(result.indefiniteInsanity.reason, "currentSan-missing");
  assert.equal(result.indefiniteInsanity.basis, "current");

  // The same figures do fire under the explicitly declared day-start basis.
  const dayStartResult = settleSanLoss({
    loss: 12, sanBefore: 48, dayStartSan: 60, dailyLossBefore: 0, dayId: "day-1",
    dailyBasis: "day-start", intCheck: { roll: 99, target: 40 },
  });
  assert.equal(dayStartResult.indefiniteInsanity.available, true);
  assert.equal(dayStartResult.indefiniteInsanity.active, true);
  assert.equal(dayStartResult.indefiniteInsanity.threshold, 12);

  // The starting-SAN basis uses the printed start, not the day snapshot.
  const startingResult = settleSanLoss({
    loss: 12, sanBefore: 48, dayStartSan: 60, startingSan: 50, dailyLossBefore: 0, dayId: "day-1",
    dailyBasis: "starting", intCheck: { roll: 99, target: 40 },
  });
  assert.equal(startingResult.indefiniteInsanity.basisValue, 50);
  assert.equal(startingResult.indefiniteInsanity.threshold, 10);
});

// --- 4) permanent and coexistence ---
check("sanZeroIsPermanentAndSkipsInt", () => {
  const result = settleSanLoss({ loss: 10, sanBefore: 8, dayStartSan: 40, dayId: "day-1", dailyLossBefore: 0, intCheck: { roll: 1, target: 90 }, hoursDie: 10, boutDie: 10, roundsDie: 10 });
  assert.equal(result.san.after, 0);
  assert.equal(result.permanentInsanity, true);
  assert.equal(result.intCheck.status, "not-required");
  assert.equal(result.intCheck.reason, "permanent-insanity");
  assert.ok(result.effects.some((effect) => effect.type === "set-permanent-insanity"));
  assert.equal(result.state.active.includes("permanent"), true);
  assert.equal(result.state.terminal, "permanent");
  assert.equal(EVIDENCE.permanentInsanity.grade, "secondary");
});

check("permanentNeverInventsRecoveryOrAutomaticExpiry", () => {
  const result = settleSanLoss({ loss: 99, sanBefore: 4, dayStartSan: 40, dayId: "day-1", dailyLossBefore: 2 });
  assert.equal(result.state.terminal, "permanent");
  assert.equal(result.indefiniteInsanity.recovery.automatic, false);
  assert.equal(result.indefiniteInsanity.recovery.mode, "keeper-review");
  assert.equal(result.indefiniteInsanity.recovery.evidence.grade, "pending-official-source");
  // No numeric recovery amount is ever fabricated.
  assert.equal(JSON.stringify(result.indefiniteInsanity.recovery).includes("D10"), false);
  assert.equal(result.indefiniteInsanity.evidence.grade, "conflicting");
  // Permanent is terminal: no second, contradicting state transition is queued.
  assert.equal(result.effects.some((effect) => effect.type === "apply-indefinite-insanity"), false);
  assert.ok(result.effects.some((effect) => effect.type === "observe-indefinite-threshold"
    && effect.terminal === "permanent"));
});

check("temporaryIndefinitePermanentCoexist", () => {
  const result = settleSanLoss({
    loss: 14, sanBefore: 70, dayStartSan: 70, dailyLossBefore: 0, dayId: "day-1",
    intCheck: { roll: 20, target: 55 }, hoursDie: 6, boutDie: 9, roundsDie: 3,
  });
  assert.equal(result.temporaryInsanity.active, true);
  assert.equal(result.indefiniteInsanity.active, true);
  assert.equal(result.state.coexisting, true);
  assert.deepEqual([...result.state.active], ["temporary", "indefinite"]);
  assert.equal(result.state.temporaryStandInForIndefinite, false);
  assert.equal(result.indefiniteInsanity.temporaryStandInForIndefinite, false);
  assert.equal(result.permanentInsanity, false);

  const merged = insanityState({
    temporary: result.temporaryInsanity,
    indefinite: result.indefiniteInsanity,
    permanent: true,
  });
  assert.deepEqual([...merged.active], ["permanent", "temporary", "indefinite"]);
});

check("temporaryEndKeepsIndefiniteAndPersistentGains", () => {
  const ended = endTemporaryInsanity({ reason: "keeper-ended", dayId: "day-1" });
  assert.equal(ended.ended, true);
  assert.equal(ended.temporaryActive, false);
  assert.deepEqual([...ended.cleared], ["delusions"]);
  assert.deepEqual([...ended.retained], ["phobia", "mania", "backstory"]);
  assert.equal(ended.autoRecovery, false);
  assert.equal(ended.leavesIndefiniteUntouched, true);
  assert.equal(ended.leavesPermanentUntouched, true);
  assert.equal(endTemporaryInsanity({ reason: "hours-elapsed-keeper-confirmed" }).keeperClockSource, "explicit");
  assert.equal(codeOf(() => endTemporaryInsanity({ reason: "time-passed-automatically" })), "invalid-end-reason");
  assert.equal(codeOf(() => endTemporaryInsanity({})), "invalid-end-reason");
});

// --- 5) bout table ---
check("boutTableHasTenProjectLabels", () => {
  const table = boutTable();
  assert.equal(table.length, 10);
  assert.deepEqual(table.map((entry) => entry.index), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(new Set(table.map((entry) => entry.id)).size, 10);
  assert.equal(new Set(table.map((entry) => entry.zh)).size, 10);
  assert.equal(table[8].id, "phobia");
  assert.equal(table[9].id, "mania");
  for (const entry of table) {
    assert.match(entry.id, /^[a-z]+(?:-[a-z]+)*$/);
  }
  for (let die = 1; die <= 10; die += 1) {
    const bout = resolveBout({ die, roundsDie: 1 });
    assert.equal(bout.index, die);
    assert.equal(bout.rounds, 1);
  }
  assert.equal(codeOf(() => resolveBout({ die: 0, roundsDie: 1 })), "out-of-range");
  assert.equal(codeOf(() => resolveBout({ die: 11, roundsDie: 1 })), "out-of-range");
  assert.equal(codeOf(() => resolveBout({ die: 2.5, roundsDie: 1 })), "not-integer");
});

// --- 6) Luck spend negatives ---
check("canSpendAllowsOnlySkillAndCharacteristic", () => {
  for (const purpose of ["skill-roll", "SK", "characteristic-roll", "CH"]) {
    assert.equal(canSpendLuck({ purpose }).allowed, true, purpose);
  }
  const denied = {
    "sanity-roll": "sanity-roll",
    SN: "sanity-roll",
    "sanity-loss-roll": "sanity-loss-roll",
    "san-loss": "sanity-loss-roll",
    "luck-roll": "luck-roll",
    LK: "luck-roll",
    "damage-roll": "damage-roll",
    DM: "damage-roll",
    IM: "damage-roll",
    "weapon-malfunction": "weapon-malfunction",
    "growth-check": "growth-check",
  };
  for (const [purpose, expected] of Object.entries(denied)) {
    const result = canSpendLuck({ purpose, luckValue: 99, amount: 1 });
    assert.equal(result.allowed, false, purpose);
    assert.equal(result.code, expected, purpose);
  }
  assert.equal(canSpendLuck({}).code, "unknown-purpose");
  assert.equal(canSpendLuck({ purpose: "cast-spell" }).code, "unknown-purpose");
});

check("canSpendRejectsPushedAndNaturalEnds", () => {
  assert.equal(canSpendLuck({ purpose: "skill-roll", pushed: true, luckValue: 80, amount: 5 }).code, "pushed-roll");
  assert.equal(canSpendLuck({ purpose: "skill-roll", naturalRoll: 100, luckValue: 80, amount: 5 }).code, "natural-fumble");
  assert.equal(canSpendLuck({ purpose: "skill-roll", band: "fumble", luckValue: 80, amount: 5 }).code, "natural-fumble");
  assert.equal(canSpendLuck({ purpose: "skill-roll", naturalRoll: 96, targetScore: 40, luckValue: 80, amount: 5 }).allowed, true);
  assert.equal(canSpendLuck({ purpose: "skill-roll", naturalRoll: 1, luckValue: 80, amount: 5 }).code, "already-critical");
});

check("canSpendRejectsIllegalAmounts", () => {
  assert.equal(canSpendLuck({ purpose: "skill-roll", luckValue: 5, amount: 6 }).code, "insufficient-luck");
  assert.equal(canSpendLuck({ purpose: "skill-roll", luckValue: 0, amount: 1 }).code, "insufficient-luck");
  assert.equal(canSpendLuck({ purpose: "skill-roll", luckValue: 10, amount: 0 }).code, "invalid-amount");
  assert.equal(canSpendLuck({ purpose: "skill-roll", luckValue: 10, amount: -3 }).code, "invalid-amount");
  assert.equal(canSpendLuck({ purpose: "skill-roll", naturalRoll: 5, luckValue: 20, amount: 5 }).code, "below-minimum");
  assert.equal(canSpendLuck({ purpose: "skill-roll", naturalRoll: 6, luckValue: 20, amount: 5 }).allowed, true);
  assert.equal(codeOf(() => canSpendLuck({ purpose: "skill-roll", luckValue: 10, amount: 1.5 })), "not-integer");
});

check("pulpOnlySpendsStayDisabled", () => {
  for (const id of PULP_ONLY_LUCK_SPENDS) {
    assert.equal(canSpendLuck({ purpose: id, luckValue: 99, amount: 10 }).code, "pulp-only", id);
  }
  assert.equal(canSpendLuck({ purpose: "halve-san-loss", luckValue: 99, amount: 10 }).allowed, false);
  assert.equal(EVIDENCE.sanLossHalving.status, "disabled-in-standard");
});

// --- 7) natural 01 vs adjusted 01 ---
check("natural01IsCriticalAdjusted01IsExtreme", () => {
  const natural = applyLuckSpend({ purpose: "skill-roll", naturalRoll: 1, targetScore: 60, amount: 1, luckValue: 10 });
  assert.equal(natural.allowed, false, "spending on a natural 01 must be refused");
  assert.equal(natural.code, "already-critical");

  // 21 on target 60 is Hard (<=30, >12); spending 20 lands on 01.
  const adjusted = applyLuckSpend({ purpose: "skill-roll", naturalRoll: 21, targetScore: 60, amount: 20, luckValue: 40 });
  assert.equal(adjusted.allowed, true);
  assert.equal(adjusted.roll.natural, 21);
  assert.equal(adjusted.roll.adjusted, 1);
  assert.equal(adjusted.spent, 20);
  assert.equal(adjusted.luck.before, 40);
  assert.equal(adjusted.luck.after, 20);
  assert.equal(adjusted.band.original.band, "hard");
  assert.equal(adjusted.band.adjusted.band, "extreme");
  assert.equal(adjusted.band.adjusted.level, 3);
  assert.equal(adjusted.band.adjusted.downgradedFromCritical, true);
  assert.equal(adjusted.band.adjustedToCritical, false);
  assert.equal(adjusted.band.criticalSource, null);

  // A natural 01 does report the critical source so a card cannot mistake it.
  const critical = cocBand({ rollVal: 1, targetScore: 11 });
  assert.equal(critical.band, "critical");
  assert.equal(critical.level, 4);
});

check("luckAdjustmentKeepsOriginalValuesForRejudge", () => {
  const result = applyLuckSpend({ purpose: "SK", naturalRoll: 63, targetScore: 35, amount: 28, luckValue: 56 });
  assert.equal(result.allowed, true);
  assert.equal(result.roll.adjusted, 35);
  assert.equal(result.band.original.band, "fail");
  assert.equal(result.band.adjusted.band, "regular");
  assert.equal(result.rejudge.naturalRoll, 63);
  assert.equal(result.rejudge.amount, 28);
  assert.equal(result.rejudge.adjustedRoll, 35);
  assert.equal(result.rejudge.targetScore, 35);
});

check("luckSpendRefusalLeavesStateUntouched", () => {
  for (const request of [
    { purpose: "SN", naturalRoll: 60, targetScore: 40, amount: 10, luckValue: 50 },
    { purpose: "sanity-loss", naturalRoll: 8, targetScore: 8, amount: 1, luckValue: 50 },
    { purpose: "skill-roll", naturalRoll: 60, targetScore: 40, amount: 60, luckValue: 50 },
    { purpose: "skill-roll", naturalRoll: 60, targetScore: 40, amount: 10, luckValue: 50, pushed: true },
    { purpose: "skill-roll", naturalRoll: 100, targetScore: 40, amount: 10, luckValue: 50 },
    { purpose: "damage-roll", naturalRoll: 5, targetScore: 5, amount: 1, luckValue: 50 },
  ]) {
    const result = applyLuckSpend(request);
    assert.equal(result.allowed, false, JSON.stringify(request));
    assert.equal(result.spent, 0);
    assert.equal(result.luck.before, result.luck.after);
    assert.equal(result.roll.adjusted, result.roll.natural);
    assert.equal(result.band.adjusted.level, result.band.original.level);
  }
});

// --- 8) growth ---
check("growthTicksOnlyOnUnluckySkillSuccess", () => {
  assert.equal(canTickGrowth({ rollType: "SK", band: "regular" }).allowed, true);
  assert.equal(canTickGrowth({ rollType: "skill-roll", band: "hard" }).allowed, true);
  assert.equal(canTickGrowth({ rollType: "skill-roll", band: "extreme" }).allowed, true);
  assert.equal(canTickGrowth({ rollType: "skill-roll", resultLevel: 4 }).allowed, true);

  assert.equal(canTickGrowth({ rollType: "skill-roll", band: "fail" }).code, "not-success");
  assert.equal(canTickGrowth({ rollType: "skill-roll", band: "fumble" }).code, "not-success");
  assert.equal(canTickGrowth({ rollType: "skill-roll", band: "regular", luckSpent: 3 }).code, "luck-spent");
  assert.equal(canTickGrowth({ rollType: "skill-roll", band: "regular", noXP: true }).code, "no-xp");
  assert.equal(canTickGrowth({ rollType: "skill-roll", band: "regular", actorType: "npc" }).code, "npc");
  assert.equal(canTickGrowth({ rollType: "CH", band: "regular" }).code, "not-a-skill-roll");
  assert.equal(canTickGrowth({ rollType: "SN", band: "regular" }).code, "not-a-skill-roll");
  assert.equal(canTickGrowth({ rollType: "DM", band: "regular" }).code, "not-a-skill-roll");
  assert.equal(canTickGrowth({ rollType: "skill-roll", band: null }).code, "result-missing");
});

check("growthSettlementUsesStrictOverAndOneD10", () => {
  const over = growthSettlement({ roll: 51, currentValue: 50, gainDie: 7 });
  assert.equal(over.improved, true);
  assert.equal(over.gained, 7);
  assert.equal(over.after, 57);
  assert.equal(over.bonus, 0);

  const equal = growthSettlement({ roll: 50, currentValue: 50, gainDie: 10 });
  assert.equal(equal.improved, false);
  assert.equal(equal.gained, 0);
  assert.equal(equal.after, 50);

  const under = growthSettlement({ roll: 12, currentValue: 50, gainDie: 4 });
  assert.equal(under.improved, false);
  assert.equal(under.gained, 0);

  const overHundred = growthSettlement({ roll: 100, currentValue: 99, gainDie: 10 });
  assert.equal(overHundred.improved, true);
  assert.equal(overHundred.after, 109);
  assert.equal(overHundred.capped, false);
  assert.equal(codeOf(() => growthSettlement({ roll: 51, currentValue: 50, gainDie: 11 })), "out-of-range");
});

// --- 9) luck recovery ---
check("luckRecoveryBothBranches", () => {
  const success = luckRecovery({ roll: 36, currentLuck: 4, d10: [3, 5, 9] });
  assert.equal(success.success, true);
  assert.equal(success.formula, "2D10+10");
  assert.equal(success.delta, 18);
  assert.equal(success.luck.after, 22);
  assert.equal(success.dice.length, 2, "the third die is ignored, never summed in");

  const failure = luckRecovery({ roll: 10, currentLuck: 40, d10: [6] });
  assert.equal(failure.success, false);
  assert.equal(failure.formula, "1D10+5");
  assert.equal(failure.delta, 11);
  assert.equal(failure.luck.after, 51);

  // Equal to the current value is not a success.
  assert.equal(luckRecovery({ roll: 40, currentLuck: 40, d10: [1] }).success, false);
  assert.equal(luckRecovery({ roll: 41, currentLuck: 40, d10: [1, 1] }).success, true);
});

check("luckRecoveryCapsAt99NotAtStartingValue", () => {
  const capped = luckRecovery({ roll: 90, currentLuck: 85, d10: [10, 10] });
  assert.equal(capped.delta, 30);
  assert.equal(capped.luck.after, LUCK_CAP);
  assert.equal(capped.luck.capped, true);
  assert.equal(capped.luck.overflow, 16);
  assert.equal(capped.initialValueIsCap, false);

  const nearCap = luckRecovery({ roll: 1, currentLuck: 96, d10: [4] });
  assert.equal(nearCap.luck.after, 99);
  assert.equal(nearCap.luck.overflow, 6);

  // Starting Luck 75 does not stop recovery from reaching 99.
  const beyondStarting = luckRecovery({ roll: 99, currentLuck: 75, d10: [2, 3] });
  assert.equal(beyondStarting.luck.after, 90);

  assert.equal(codeOf(() => luckRecovery({ roll: 50, currentLuck: 100, d10: [1] })), "out-of-range");
  assert.equal(codeOf(() => luckRecovery({ roll: 50, currentLuck: 10, d10: [] })), "dice-missing");
  assert.equal(codeOf(() => luckRecovery({ roll: 90, currentLuck: 10, d10: [5] })), "dice-missing");
  assert.equal(codeOf(() => luckRecovery({ roll: 50, currentLuck: 10, d10: [0] })), "out-of-range");
});

check("cocBandMatchesDocumentedBands", () => {
  // Independent of module/rules/coc.mjs on purpose: the M4 core must not break
  // when the M3 adapter is edited concurrently, so the band ladder is asserted
  // against the documented facts directly.
  const cases = [
    [1, 60, "critical", 4],
    [12, 60, "extreme", 3],
    [13, 60, "hard", 2],
    [30, 60, "hard", 2],
    [31, 60, "regular", 2],
    [60, 60, "regular", 2],
    [61, 60, "fail", 1],
    [96, 60, "fail", 1],
    [100, 60, "fumble", 0],
    [95, 40, "fail", 1],
    [96, 40, "fumble", 0],
    [1, 0, "critical", 4],
    [2, 0, "fail", 1],
    [100, 0, "fumble", 0],
  ];
  for (const [rollVal, targetScore, band, level] of cases) {
    const result = cocBand({ rollVal, targetScore });
    assert.equal(result.band, band, `${rollVal}/${targetScore}`);
    assert.equal(result.level, level, `${rollVal}/${targetScore}`);
  }
  // A critical is unreachable once the roll is above 01, whatever the target.
  for (let roll = 2; roll <= 100; roll += 1) {
    assert.notEqual(cocBand({ rollVal: roll, targetScore: 100 }).band, "critical", `roll ${roll}`);
  }
});

// --- 10) immutability, fail-closed input, isolation ---
check("inputsAreNotMutated", () => {
  const snapshot = deepFreeze({ dayId: "day-1", dayStartSan: 55, dailyLoss: 4 });
  const intCheck = deepFreeze({ roll: 30, target: 55 });
  const input = deepFreeze({
    loss: 6,
    sanBefore: 55,
    snapshot,
    intCheck,
    hoursDie: 5,
    boutDie: 3,
    roundsDie: 8,
    dailyBasis: "day-start",
  });
  const before = JSON.stringify(input);
  const result = settleSanLoss(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.effects), true);
  assert.equal(Object.isFrozen(result.state), true);

  const luckInput = deepFreeze({ purpose: "skill-roll", naturalRoll: 40, targetScore: 60, amount: 10, luckValue: 30 });
  const luckBefore = JSON.stringify(luckInput);
  applyLuckSpend(luckInput);
  assert.equal(JSON.stringify(luckInput), luckBefore);

  const growthInput = deepFreeze({ roll: 70, currentValue: 60, gainDie: 5 });
  const growthBefore = JSON.stringify(growthInput);
  growthSettlement(growthInput);
  assert.equal(JSON.stringify(growthInput), growthBefore);
});

check("illegalInputFailsClosed", () => {
  assert.equal(codeOf(() => singleLossTrigger({ loss: -1 })), "out-of-range");
  assert.equal(codeOf(() => singleLossTrigger({ loss: 1.5 })), "not-integer");
  assert.equal(codeOf(() => singleLossTrigger({ loss: "5" })), "not-integer");
  assert.equal(codeOf(() => singleLossTrigger({})), "not-integer");
  assert.equal(codeOf(() => settleSanLoss({})), "not-integer");
  assert.equal(codeOf(() => settleSanLoss({ loss: 5, sanBefore: -1 })), "out-of-range");
  assert.equal(codeOf(() => settleSanLoss({ loss: 5, sanBefore: 40, dayId: "" })), "day-id-required");
  assert.equal(codeOf(() => settleSanLoss({ loss: 5, sanBefore: 40, dayId: "day-1", dailyLossBefore: -2 })), "out-of-range");
  assert.equal(codeOf(() => settleSanLoss({
    loss: 5, sanBefore: 40, dayId: "day-2",
    snapshot: { dayId: "day-1", dayStartSan: 40, dailyLoss: 0 },
  })), "day-id-conflict");
  assert.equal(codeOf(() => settleSanLoss({
    loss: 5, sanBefore: 40, snapshot: { dayId: "day-1", dayStartSan: 40, dailyLoss: 0 }, dailyLossBefore: 3,
  })), "daily-loss-conflict");
  assert.equal(codeOf(() => beginGameDay({ dayId: "  ", san: 40 })), "day-id-required");
  assert.equal(codeOf(() => beginGameDay({ san: 40 })), "day-id-required");
  assert.equal(codeOf(() => insanityState({ permanent: "yes" })), "not-boolean");
  assert.equal(codeOf(() => canTickGrowth({ rollType: "skill-roll", band: "regular", luckSpent: -1 })), "out-of-range");
  assert.equal(codeOf(() => cocBand({ rollVal: 0, targetScore: 50 })), "out-of-range");
  assert.equal(codeOf(() => cocBand({ rollVal: 50, targetScore: 101 })), "out-of-range");
  assert.equal(codeOf(() => temporaryInsanity({ loss: 5, intCheck: { roll: 101, target: 40 } })), "out-of-range");
});

check("settleReportsDecisionsOnlyNoRollNoWrite", () => {
  const result = settleSanLoss({
    loss: 6, sanBefore: 50, dayStartSan: 50, dayId: "day-1",
    intCheck: { roll: 20, target: 50 }, hoursDie: 8, boutDie: 7, roundsDie: 4,
  });
  assert.equal(result.rolledDice, false);
  assert.equal(result.wroteActor, false);
  assert.equal(result.effects[0].type, "apply-san-loss");
  assert.equal(result.effects[0].amount, 6);
  assert.equal(result.effects.some((effect) => effect.type === "apply-temporary-insanity"), true);
  assert.equal(Object.isFrozen(result.effects[0]), true);
});

check("coreIsFrameworkFreeAndImportFree", () => {
  const source = readFileSync(join(ROOT, "module/rules/coc-sanity.mjs"), "utf8");
  const code = source.replace(/\/\/[^\n]*/g, "").replace(/`[^`]*`/g, "");
  assert.equal(/^\s*import\s/m.test(code), false, "no imports");
  assert.equal(/\bexport\s+default\b/.test(code), false);
  assert.equal(/\beval\s*\(/.test(code), false);
  assert.equal(/new\s+Function\s*\(/.test(code), false);
  assert.equal(/\bgame\./.test(code), false);
  assert.equal(/\bfoundry\./.test(code), false);
  assert.equal(/\bRoll\b/.test(code), false);
  assert.equal(/Math\.random/.test(code), false);
  assert.equal(/Date\.now|new Date|worldTime|performance\.now/.test(code), false);
  assert.equal(/fetch\(|XMLHttpRequest|WebSocket/.test(code), false);
  // No module-level mutable state: only frozen consts are declared at top level.
  assert.equal(/^(?:let|var)\s/m.test(code), false);
  assert.equal(/\bglobalThis\./.test(code), false);
  assert.match(source, /export\s+function\s+settleSanLoss/);
  assert.match(source, /export\s+function\s+canSpendLuck/);
  assert.match(source, /export\s+function\s+canTickGrowth/);
});

// --- 11) thresholds, Luck negatives and growth boundaries (M4 integration contract) ---
check("dailyBasisStartingAndCurrentAreExplicitNotDefault", () => {
  const starting = dailyThreshold({ basis: "starting", startingSan: 50 });
  const dayStart = dailyThreshold({ basis: "day-start", dayStartSan: 55 });
  const current = dailyThreshold({ basis: "current", currentSan: 41 });
  assert.equal(starting.threshold, 10);
  assert.equal(dayStart.threshold, 11);
  assert.equal(current.threshold, 9);
  // The default basis is day-start: supplying only a starting/current value
  // must not silently switch the one-fifth line to that value.
  const defaulted = dailyThreshold({ startingSan: 50, currentSan: 41 });
  assert.equal(defaulted.available, false);
  assert.equal(defaulted.basis, "day-start");
  assert.equal(defaulted.reason, "dayStartSan-missing");
  assert.equal(dailyThreshold({ basis: "day-start", dayStartSan: 1 }).threshold, 1);
  assert.equal(dailyThreshold({ basis: "day-start", dayStartSan: 5 }).threshold, 1);
  assert.equal(dailyThreshold({ basis: "day-start", dayStartSan: 6 }).threshold, 2);
  assert.equal(dailyThreshold({ basis: "day-start", dayStartSan: 0 }).available, false);
});

check("dailyTriggerUsesDayStartAndNeverStartingSanByDefault", () => {
  // Same accumulated loss, two different published bases: the day-start basis
  // fires at 8/40 while the scenario's starting basis needs 10/50.
  const dayBasis = settleSanLoss({ loss: 4, sanBefore: 36, dayStartSan: 40, dayId: "day-2", dailyLossBefore: 4 });
  assert.equal(dayBasis.indefiniteInsanity.active, true);
  const startingBasis = dailyInsanity({ dailyLoss: 8, basis: "starting", startingSan: 50 });
  assert.equal(startingBasis.active, false);
  const startingAtTen = dailyInsanity({ dailyLoss: 10, basis: "starting", startingSan: 50 });
  assert.equal(startingAtTen.active, true);
});

check("luckSpendRejectsEveryForbiddenPurpose", () => {
  const forbidden = [
    ["SN", null], ["sanity-roll", null], ["sanity-loss", null], ["sanity-loss-roll", null],
    ["LK", null], ["luck-roll", null], ["DM", null], ["damage", null],
    ["CM", null], ["weapon-malfunction", null], ["XP", null], ["growth-check", null],
  ];
  for (const [purpose] of forbidden) {
    const decision = canSpendLuck({ purpose, rollVal: 50 });
    assert.equal(decision.allowed, false, `${purpose} must be refused`);
  }
  assert.equal(canSpendLuck({ purpose: "SK", naturalRoll: 50 }).allowed, true);
  assert.equal(canSpendLuck({ purpose: "CH", naturalRoll: 50 }).allowed, true);
  assert.equal(canSpendLuck({ purpose: "SK", naturalRoll: 50, pushed: true }).allowed, false);
  assert.equal(canSpendLuck({ purpose: "SK", naturalRoll: 1 }).allowed, false);
  assert.equal(canSpendLuck({ purpose: "SK", naturalRoll: 100 }).allowed, false);
  assert.equal(canSpendLuck({ purpose: "SK", naturalRoll: 50, band: "fumble" }).allowed, false);
});

check("luckRecoveryFailureBranchAndCap", () => {
  const failure = luckRecovery({ roll: 20, currentLuck: 60, d10: [3] });
  assert.equal(failure.success, false);
  assert.equal(failure.formula, "1D10+5");
  assert.equal(failure.luck.after, 68);
  const capped = luckRecovery({ roll: 100, currentLuck: 90, d10: [10, 10] });
  assert.equal(capped.success, true);
  assert.equal(capped.formula, "2D10+10");
  assert.equal(capped.luck.after, 99);
  assert.equal(capped.luck.capped, true);
  assert.equal(capped.luck.overflow, 21);
  assert.equal(codeOf(() => luckRecovery({ roll: 80, currentLuck: 40, d10: [5] })), "dice-missing");
  assert.equal(codeOf(() => luckRecovery({ roll: 80, currentLuck: 40, d10: [5, 11] })), "out-of-range");
});

check("growthTicksOnlyCharactersAndOnlySkills", () => {
  assert.equal(canTickGrowth({ rollType: "SK", resultLevel: 2, actorType: "npc" }).allowed, false);
  assert.equal(canTickGrowth({ rollType: "CH", resultLevel: 4 }).allowed, false);
  assert.equal(canTickGrowth({ rollType: "DM", resultLevel: 4 }).allowed, false);
  assert.equal(canTickGrowth({ rollType: "SN", resultLevel: 4 }).allowed, false);
  assert.equal(canTickGrowth({ rollType: "SK", band: null }).allowed, false);
  assert.equal(canTickGrowth({ rollType: "SK", band: "regular" }).allowed, true);
  assert.equal(canTickGrowth({ rollType: "SK", band: "hard" }).allowed, true);
  assert.equal(canTickGrowth({ rollType: "SK", band: "extreme" }).allowed, true);
  assert.equal(canTickGrowth({ rollType: "SK", band: "fail" }).allowed, false);
  assert.equal(canTickGrowth({ rollType: "SK", band: "fumble" }).allowed, false);
});

check("temporaryEndRequiresExplicitReasonAndNeverAutoExpires", () => {
  assert.equal(codeOf(() => endTemporaryInsanity({ reason: "time-passed" })), "invalid-end-reason");
  assert.equal(codeOf(() => endTemporaryInsanity({ reason: null })), "invalid-end-reason");
  const ended = endTemporaryInsanity({ reason: "effect-disabled", dayId: "day-3" });
  assert.equal(ended.autoRecovery, false);
  assert.deepEqual([...ended.retained], ["phobia", "mania", "backstory"]);
  assert.deepEqual([...ended.cleared], ["delusions"]);
  const episode = temporaryInsanity({ loss: 6, intCheck: { roll: 10, target: 50 }, hoursDie: 4, boutDie: 10, roundsDie: 2, dayId: "day-3" });
  assert.equal(episode.expiry.autoRecovery, false);
  assert.equal(episode.expiry.keeperClockRequired, true);
  assert.equal(episode.bout.id, "mania");
});

check("permanentDecisionIsTerminalAndRecordsIndefiniteThreshold", () => {
  const result = settleSanLoss({ loss: 9, sanBefore: 3, dayStartSan: 40, dayId: "day-4", dailyLossBefore: 0 });
  assert.equal(result.permanentInsanity, true);
  assert.equal(result.temporaryInsanity, null);
  assert.equal(result.effects.some((effect) => effect.type === "apply-temporary-insanity"), false);
  assert.equal(result.effects.some((effect) => effect.type === "set-permanent-insanity"), true);
  const observed = result.effects.find((effect) => effect.type === "observe-indefinite-threshold");
  assert.equal(observed.terminal, "permanent");
  assert.equal(result.state.terminal, "permanent");
  assert.equal(result.state.temporaryStandInForIndefinite, false);
});

// M4 wiring: the core used to be standalone. It is now imported by the CoC
// adapter so the native chain reuses its decisions instead of duplicating them.
// The core itself must stay dependency-free (checked by the source assertions
// above), and octopus must not gain a CoC decision core.
check("coreWiredIntoCoCAdapterOnly", () => {
  const coc = readFileSync(join(ROOT, "module/rules/coc.mjs"), "utf8");
  const brp = readFileSync(join(ROOT, "module/rules/brp.mjs"), "utf8");
  const index = readFileSync(join(ROOT, "module/rules/index.mjs"), "utf8");
  assert.match(coc, /from '\.\/coc-sanity\.mjs'/, "coc.mjs must import the M4 core");
  assert.equal(/coc-sanity/.test(brp), false, "brp.mjs must not import the M4 core");
  assert.equal(/coc-sanity/.test(index), false, "index.mjs must stay a registry only");
  const core = readFileSync(join(ROOT, "module/rules/coc-sanity.mjs"), "utf8");
  assert.equal(/from\s+['"]\.\.?\//.test(core), false, "the core must stay import-free");
  assert.equal(/\bgame\./.test(core.replace(/\/\/.*$/gm, "")), false, "the core must not read game state");
});

check("provenanceRecordsEvidenceAndGaps", () => {
  const provenance = JSON.parse(readFileSync(join(ROOT, "content/coc/sanity-provenance.json"), "utf8"));
  const ids = provenance.sources.map((source) => source.id);
  for (const required of ["coc-quickstart", "coc-wiki-sanity", "coc-wiki-game-system",
    "coc-wiki-rewards", "coc-wiki-secondary", "coc-lightless-beacon", "coc-roll20-using-luck"]) {
    assert.ok(ids.includes(required), `missing source ${required}`);
  }
  assert.ok(provenance.sources.every((source) => source.url.startsWith("https://")));
  assert.ok(provenance.sources.filter((source) => source.evidence === "secondary").length >= 2);
  assert.equal(provenance.facts.indefiniteInsanity.grade, "conflicting");
  assert.equal(provenance.facts.indefiniteInsanity.recovery.implemented, false);
  assert.equal(provenance.facts.luckSanLossHalving.status, "disabled-in-standard");
  assert.equal(provenance.facts.luckRecovery.grade, "secondary");
  assert.equal(provenance.unverified.status, "pending-official-source");
  assert.ok(provenance.unverified.items.length >= 4);
  assert.ok(provenance.licenseBoundary.excluded.some((line) => line.includes("No Call of Cthulhu 7e Foundry VTT system source")));
  assert.ok(provenance.licenseBoundary.excluded.some((line) => line.includes("Pulp")));
  // No rules text body is stored: facts are numbers, formulas and URLs only.
  const blob = JSON.stringify(provenance);
  assert.equal(blob.includes("psychosomatic"), false);
  assert.equal(blob.includes("Significant Person"), false);
});

check("publicSurfaceIsCompleteAndFrozen", () => {
  const expected = [
    "boutTable", "resolveBout", "singleLossTrigger", "intCheckState", "temporaryInsanity",
    "endTemporaryInsanity", "dailyThreshold", "dailyInsanity", "beginGameDay", "advanceGameDay", "rollGameDay",
    "insanityState", "settleSanLoss", "canSpendLuck", "applyLuckSpend", "cocBand",
    "luckRecovery", "canTickGrowth", "growthSettlement",
  ];
  assert.deepEqual(Object.keys(CoCSanity).filter((key) => typeof CoCSanity[key] === "function").sort(), expected.sort());
  assert.equal(Object.isFrozen(CoCSanity), true);
  assert.equal(Object.isFrozen(EVIDENCE), true);
  assert.equal(Object.isFrozen(PULP_ONLY_LUCK_SPENDS), true);
});

const failed = failures.length;
console.log(JSON.stringify({
  checks: Object.keys(checks).length,
  failed,
  errors: failures,
  summary: checks,
}, null, 2));
if (failed) process.exit(1);
