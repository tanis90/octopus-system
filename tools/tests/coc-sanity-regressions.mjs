// CoC sanity regression probe: pure-core decisions + the M5 app chains.
//
//   node tools/tests/coc-sanity-regressions.mjs
//
// Sections 1-11 test module/rules/coc-sanity.mjs, which has no Foundry imports,
// so they run with plain node and no harness. Section 12 runs the real app
// modules (module/apps/sanity.mjs, check.mjs, socket.mjs) against a minimal
// Foundry surface for the ownership/writer contract; section 13 drives the real
// skill-field modules (item/actor prepare, tick/untick/settlement, drop,
// migration). It covers:
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
//  11. daily basis / Luck negatives / growth boundaries integration contract
//  12. M5 fixed writer: owned PC written by its card owner (GM online or offline),
//      keeper leaves only pending, pending refuses a new SN, retry reuses the
//      decided loss and persisted decision/dice, settleId idempotency, card repair,
//      both ownership shapes, non-owner refusal and the unowned-NPC activeGM relay
//  13. M5 skill fields: derived-only total (no NaN), Mythos experience and the SAN
//      cap, auto-tick / Luck untick / development settlement writing only the
//      canonical paths, invalid-score refusal, drop normalisation and the one-shot
//      idempotent migration
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

// --- 12) M5 fixed writer / owned-PC settlement --------------------------------
//
// The pure core above cannot decide who may write an actor. This section runs
// the real app modules (module/apps/sanity.mjs, check.mjs, socket.mjs) against a
// minimal Foundry surface, so the fixed writer, the pending/retry projection and
// sequential idempotency are asserted end to end: real `_trigger` SN start, real
// card flags, real settleId records on the actor.
const appClone = (value) => value === undefined ? undefined : structuredClone(value);
const setPath = (target, path, value) => {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
};

const appSettings = new Map();
const settingKey = (namespace, key) => `${namespace}.${key}`;
appSettings.set(settingKey("brp", "ruleset"), "coc");
appSettings.set(settingKey("brp", "worldTime"), 3 * 86400 + 3600);
appSettings.set(settingKey("brp", "cocDaySeq"), 0);
appSettings.set(settingKey("brp", "cocSessionSeq"), 0);
appSettings.set(settingKey("brp", "autoXP"), 0);

const gmUser = { id: "gm", isGM: true, targets: new Set() };
const ownerUser = { id: "owner", isGM: false, targets: new Set() };
const otherUser = { id: "other", isGM: false, targets: new Set() };
const userById = new Map([[gmUser.id, gmUser], [ownerUser.id, ownerUser], [otherUser.id, otherUser]]);
let activeGmUser = gmUser;
let currentUser = ownerUser;

const appActors = new Map();
appActors.tokens = {};
const appMessages = {
  map: new Map(),
  get(id) { return this.map.get(id) ?? null; },
  set(id, message) { this.map.set(id, message); },
  get contents() { return [...this.map.values()]; },
  values() { return this.map.values(); },
  get size() { return this.map.size; },
};
const notifications = [];
const emitted = [];

globalThis.game = {
  get user() { return currentUser; },
  users: {
    get activeGM() { return activeGmUser; },
    get(id) { return userById.get(id) ?? null; },
  },
  actors: appActors,
  messages: appMessages,
  settings: {
    get(namespace, key) { return appSettings.get(settingKey(namespace, key)) ?? 0; },
    async set(namespace, key, value) { appSettings.set(settingKey(namespace, key), value); },
  },
  time: { worldTime: 3 * 86400 + 3600 },
  i18n: {
    localize(key) { return key; },
    format(key, values) { return `${key}:${JSON.stringify(values)}`; },
  },
  socket: {
    emit(channel, payload) { emitted.push({ channel, payload }); },
  },
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
  utils: { deepClone: appClone },
};

let rollQueue = [];
const queueRolls = (...totals) => { rollQueue.push(...totals); };
globalThis.Roll = class Roll {
  constructor(formula) {
    this.formula = formula;
    this.total = 0;
    this.dice = [];
  }

  async evaluate() {
    assert.ok(rollQueue.length > 0, `unexpected real roll ${this.formula}`);
    this.total = rollQueue.shift();
    this.dice = [{ values: [this.total] }];
    return this;
  }
};

let effectSequence = 0;
class MockEffect {
  constructor(data, parent) {
    Object.assign(this, appClone(data));
    this.id = `effect-${++effectSequence}`;
    this.parent = parent;
    this.statuses = new Set(data.statuses ?? []);
    this.disabled = data.disabled === true;
  }

  static async createDocuments(data, { parent }) {
    return data.map((entry) => {
      const effect = new MockEffect(entry, parent);
      parent.effects.push(effect);
      return effect;
    });
  }

  async update(changes) {
    for (const [path, value] of Object.entries(changes)) setPath(this, path, appClone(value));
    return this;
  }

  async delete() {
    this.parent.effects = this.parent.effects.filter((effect) => effect !== this);
  }
}
globalThis.ActiveEffect = MockEffect;
globalThis.Actor = class {};
globalThis.Item = class {};

let messageSequence = 0;
// Chat messages follow the compat/core rule: only the trusted author or a GM
// may update one. This is the guard the owner's card repair must work with,
// not a widened write permission.
const canWriteMessage = (message) => {
  const author = message?.author ?? null;
  if (author && author === currentUser?.id) { return true; }
  return currentUser?.isGM === true;
};
const ownershipForbidden = () => {
  const error = new Error("OWNERSHIP_FORBIDDEN: only the GM or the author may modify this message");
  error.code = "OWNERSHIP_FORBIDDEN";
  return error;
};

class MockMessage {
  constructor(card, { author = null } = {}) {
    this.id = `message-${++messageSequence}`;
    this._id = this.id;
    this.flags = { brp: appClone(card) };
    this.content = "";
    this.author = author ?? currentUser?.id ?? null;
    this.updates = [];
    this.failUpdate = false;
    appMessages.set(this.id, this);
  }

  async update(changes) {
    if (this.failUpdate) { throw new Error("card write refused"); }
    if (!canWriteMessage(this)) { throw ownershipForbidden(); }
    this.updates.push(appClone(changes));
    for (const [path, value] of Object.entries(changes)) setPath(this, path, appClone(value));
    return this;
  }
}
globalThis.ChatMessage = class {
  static async create(data) { return new MockMessage(data.flags.brp); }
};

let actorSequence = 0;
class MockActor {
  constructor({
    name = null, san = 60, int: intelligence = 60, details = {},
    ownerId = null, creatorId = null, ownership = null,
  } = {}) {
    this.id = `actor-${++actorSequence}`;
    this.name = name ?? this.id;
    this.type = "character";
    this.token = null;
    this.img = "mock.png";
    this.prototypeToken = { randomImg: false };
    this.system = {
      attribs: {
        san: { auto: false, value: san, max: 99, dailyLoss: 0, dailyLimit: 0 },
        lck: { value: 50 },
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
            dayId: null,
            dayStartSan: 60,
            dayStartSource: "keeper-new-day",
            ...appClone(details),
          },
        },
      },
    };
    if (ownerId || creatorId) {
      this.flags.mtcompat = {
        ...(ownerId ? { ownerId } : {}),
        ...(creatorId ? { creatorId } : {}),
      };
    }
    if (ownership) { this.ownership = { ...ownership }; }
    this.effects = [];
    this.items = new Map();
    this.isOwner = true;
    this.updates = [];
    appActors.set(this.id, this);
  }

  initSanity() { return this.system.attribs.san; }

  testUserPermission(user, level) {
    return user?.isGM === true || (this.isOwner && level === "OWNER");
  }

  async update(changes) {
    this.updates.push(appClone(changes));
    for (const [path, value] of Object.entries(changes)) setPath(this, path, appClone(value));
    return this;
  }
}

const { BRPSanity, bindSanityCheck } = await import("../../module/apps/sanity.mjs");
const { BRPCheck } = await import("../../module/apps/check.mjs");
const { BRPSystemSocket } = await import("../../module/apps/socket.mjs");
const { BRPItem } = await import("../../module/item/item.mjs");
const { BRPActor } = await import("../../module/actor/actor.mjs");
const { BRPactorItemDrop } = await import("../../module/actor/actor-itemDrop.mjs");
const { BRPCharDev } = await import("../../module/apps/charDev.mjs");
const { BRPLuck } = await import("../../module/apps/luck.mjs");
const { migrateSkillFields } = await import("../../module/setup/update.mjs");
const {
  skillNoXP,
  skillTicked,
  skillXp,
  skillTotal,
} = await import("../../module/rules/coc-skill-fields.mjs");
bindSanityCheck(BRPCheck);

const checksAsync = {};
const checkAsync = async (name, fn) => {
  try {
    await fn();
    checksAsync[name] = true;
    checks[name] = true;
  } catch (thrown) {
    checksAsync[name] = { ok: false, detail: thrown?.message ?? String(thrown) };
    checks[name] = { ok: false, detail: thrown?.message ?? String(thrown) };
    failures.push(`${name}: ${thrown?.message ?? thrown}`);
  }
};
const triggerSn = (actor, extra = {}) => BRPCheck._trigger({
  rollType: "SN",
  shiftKey: true,
  actor,
  token: "",
  sanLossSuccess: "1",
  sanLossFail: "1D6",
  ...extra,
});
const resetDay = (actor) => {
  actor.flags.brp.coc.sanity.dayId = null;
};

await checkAsync("ownedPcIsWrittenByItsOwnerWhileTheGmIsOffline", async () => {
  activeGmUser = null;
  currentUser = ownerUser;
  const actor = new MockActor({ name: "Owner Offline", ownerId: ownerUser.id });
  // d100 80 fails SAN 60 -> 1D6 = 6; INT 90 vs 60 fails (repressed, no episode dice)
  queueRolls(80, 6, 90);
  const cardMessageId = await triggerSn(actor);
  assert.equal(typeof cardMessageId, "string");
  const settleId = `coc-sn:${cardMessageId}`;
  assert.equal(actor.system.attribs.san.value, 54);
  assert.equal(actor.system.attribs.san.dailyLoss, 6);
  const record = BRPSanity.settlementOf(actor, settleId);
  assert.equal(record.status, "applied");
  assert.equal(record.loss, 6);
  assert.equal(record.sanBefore, 60);
  assert.equal(record.sanAfter, 54);
  assert.equal(actor.flags.brp.coc.sanity.pendingSettlementId, null);
  assert.equal(actor.flags.brp.coc.sanity.settlements.length, 1);
  assert.equal(actor.flags.brp.coc.sanityLog.at(-1).settleId, settleId);
  const card = appMessages.get(cardMessageId).flags.brp.chatCard[0];
  assert.equal(card.sanAfter, 54);
  assert.equal(card.sanitySettlement.settleId, settleId);
  assert.equal(card.sanitySettlement.status, "applied");
  assert.equal(card.sanitySettlement.sanBefore, 60);
  assert.deepEqual(rollQueue, []);
  assert.equal(emitted.length, 0, "an owned PC must not be relayed");
});

await checkAsync("ownerStaysTheWriterWhileTheGmIsOnline", async () => {
  activeGmUser = gmUser;
  currentUser = ownerUser;
  emitted.length = 0;
  const actor = new MockActor({ name: "Owner Online", ownerId: ownerUser.id });
  // d100 40 is a regular success at SAN 60 -> loss 1, no INT check
  queueRolls(40, 1);
  const cardMessageId = await triggerSn(actor);
  assert.equal(typeof cardMessageId, "string");
  assert.equal(actor.system.attribs.san.value, 59);
  assert.equal(BRPSanity.settlementOf(actor, `coc-sn:${cardMessageId}`).status, "applied");
  assert.equal(emitted.length, 0, "the keeper being online must not reroute the write");
  assert.deepEqual(rollQueue, []);
});

let pendingCardId = null;
let pendingActor = null;

await checkAsync("keeperOnAnOwnedPcLeavesOnlyAPendingCard", async () => {
  activeGmUser = gmUser;
  currentUser = gmUser;
  const actor = new MockActor({ name: "Keeper Rolled", ownerId: ownerUser.id });
  queueRolls(80, 6);
  const cardMessageId = await triggerSn(actor);
  assert.equal(typeof cardMessageId, "string");
  assert.equal(actor.system.attribs.san.value, 60, "the keeper never writes an owned PC");
  assert.equal(actor.updates.length, 0);
  const card = appMessages.get(cardMessageId).flags.brp.chatCard[0];
  assert.equal(card.sanitySettlement.status, "pending");
  assert.equal(card.sanitySettlement.loss, 6);
  assert.equal(card.sanitySettlement.sanBefore, 60);
  assert.equal(card.sanAfter, null);
  const pending = await BRPSanity.pending({ actor });
  assert.equal(pending.pending, true);
  assert.equal(pending.owned, true);
  assert.equal(pending.writer, "owner-remote");
  assert.equal(pending.cards[0].messageId, cardMessageId);
  assert.equal(pending.cards[0].status, "pending");
  assert.deepEqual(rollQueue, []);
  assert.equal(emitted.length, 0, "an owned PC is never relayed to the active GM");
  pendingCardId = cardMessageId;
  pendingActor = actor;
});

await checkAsync("pendingCardRefusesANewSnBeforeAnyDie", async () => {
  currentUser = ownerUser;
  const before = appMessages.size;
  const sanBefore = pendingActor.system.attribs.san.value;
  const result = await triggerSn(pendingActor);
  assert.equal(result, false, "_trigger still returns false on a refused request");
  assert.equal(BRPCheck.lastSanityGuard.reason, "card-pending");
  assert.equal(BRPCheck.lastSanityGuard.settleId, `coc-sn:${pendingCardId}`);
  assert.equal(appMessages.size, before, "no new SN card may be opened");
  assert.equal(pendingActor.system.attribs.san.value, sanBefore);
  assert.deepEqual(rollQueue, [], "no fresh d100/loss die may be rolled");
  assert.ok(notifications.some((message) => String(message).includes("settlementPending")));
});

await checkAsync("ownerRetrySettlesTheActorThenRelaysTheKeeperAuthoredCardRepair", async () => {
  currentUser = ownerUser;
  activeGmUser = gmUser;
  emitted.length = 0;
  const updatesBefore = pendingActor.updates.length;
  queueRolls(90); // only the follow-up INT check
  const result = await BRPSanity.retry({ cardMessageId: pendingCardId });
  assert.equal(result.applied, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.settleId, `coc-sn:${pendingCardId}`);
  assert.equal(result.loss, 6, "the card's decided loss is reused");
  assert.equal(result.sanBefore, 60);
  assert.equal(result.sanAfter, 54);
  assert.equal(pendingActor.system.attribs.san.value, 54);
  assert.deepEqual(rollQueue, []);
  // The card was authored by the keeper: the owner cannot rewrite it, so the
  // projection-only repair is relayed instead of a widened write permission.
  assert.equal(result.cardError, "OWNERSHIP_FORBIDDEN");
  assert.equal(result.repairRelayed, true);
  assert.equal(result.repairBy.mode, "active-gm");
  assert.equal(result.repairBy.by, gmUser.id);
  assert.equal(result.repairBy.authorId, gmUser.id);
  assert.equal(pendingActor.updates.length > updatesBefore, true);
  const relay = emitted.at(-1);
  assert.equal(relay.channel, "system.brp");
  assert.equal(relay.payload.type, "cocSanSettle");
  assert.equal(relay.payload.to, gmUser.id);
  assert.equal(relay.payload.value.action, "cardRepair");
  assert.equal(relay.payload.value.settleId, `coc-sn:${pendingCardId}`);
  assert.equal(relay.payload.value.origin, ownerUser.id);
  // Still pending until the author-side writer repairs it.
  assert.equal(appMessages.get(pendingCardId).flags.brp.chatCard[0].sanitySettlement.status, "pending");

  // The active GM performs the projection-only repair. No actor write happens.
  currentUser = gmUser;
  const actorUpdates = pendingActor.updates.length;
  const sanAfter = pendingActor.system.attribs.san.value;
  const repaired = await BRPSystemSocket.cocSanSettle(relay.payload.value);
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.settleId, `coc-sn:${pendingCardId}`);
  assert.equal(pendingActor.updates.length, actorUpdates, "repair must not touch the actor");
  assert.equal(pendingActor.system.attribs.san.value, sanAfter, "repair must not deduct again");
  const card = appMessages.get(pendingCardId).flags.brp.chatCard[0];
  assert.equal(card.sanitySettlement.status, "applied");
  assert.equal(card.sanAfter, 54);
  assert.equal(card.sanitySettlement.loss, 6);
  assert.equal(card.sanitySettlement.sanAfter, 54);
  assert.equal(typeof card.sanitySettlement.updatedAtClient, "number");
  currentUser = ownerUser;
});

await checkAsync("sameSettleIdIsIdempotent", async () => {
  const updates = pendingActor.updates.length;
  emitted.length = 0;
  const result = await BRPSanity.retry({ cardMessageId: pendingCardId });
  assert.equal(result.applied, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.repaired, true);
  assert.equal(result.repairedNow, false, "an applied card needs no write");
  assert.equal(emitted.length, 0, "an applied card needs no relay");
  assert.equal(pendingActor.system.attribs.san.value, 54);
  assert.equal(pendingActor.updates.length, updates, "a duplicate must not write the actor");
  assert.deepEqual(rollQueue, []);
});

await checkAsync("appliedSettlementNeverDeductsTwice", async () => {
  const sanBefore = pendingActor.system.attribs.san.value;
  const updates = pendingActor.updates.length;
  const result = await BRPSanity.settleOwned({
    actor: pendingActor,
    loss: 6,
    cardMessageId: pendingCardId,
    settleId: `coc-sn:${pendingCardId}`,
  });
  assert.equal(result.duplicate, true);
  assert.equal(result.applied, true);
  assert.equal(result.sanAfter, sanBefore);
  assert.equal(pendingActor.system.attribs.san.value, sanBefore);
  assert.equal(pendingActor.updates.length, updates);
  assert.deepEqual(rollQueue, []);
});

await checkAsync("declaredSettleIdMustMatchTheCard", async () => {
  const result = await BRPSanity.settleOwned({
    actor: pendingActor,
    loss: 1,
    cardMessageId: pendingCardId,
    settleId: "coc-sn:some-other-card",
  });
  assert.equal(result.error, "settle-id-mismatch");
});

await checkAsync("actorAppliedCardFailedIsRepairedWithoutSecondDeduction", async () => {
  currentUser = ownerUser;
  const actor = new MockActor({ name: "Repair", ownerId: ownerUser.id });
  const message = new MockMessage({
    rollType: "SN",
    chatCard: [{
      particId: actor.id,
      particType: "actor",
      sanLoss: 5,
      sanLossFormulaUsed: "1D6",
      sanAfter: null,
      sanitySettlement: { settleId: "", status: "pending", loss: 5, sanBefore: 60, sanAfter: null },
    }],
  });
  const settleId = `coc-sn:${message.id}`;
  message.flags.brp.chatCard[0].sanitySettlement.settleId = settleId;
  message.failUpdate = true;
  // loss 5 requires INT; INT 10 passes, then 1D10h/1D10 bout/1D10 rounds
  queueRolls(10, 4, 3, 2);
  const settled = await BRPSanity.settleOwned({ actor, loss: 5, cardMessageId: message.id, settleId });
  assert.equal(settled.applied, true);
  assert.equal(settled.cardError, "card write refused");
  assert.equal(actor.system.attribs.san.value, 55);
  assert.equal(BRPSanity.settlementOf(actor, settleId).status, "applied");

  message.failUpdate = false;
  const updates = actor.updates.length;
  const repaired = await BRPSanity.retry({ cardMessageId: message.id });
  assert.equal(repaired.applied, true);
  assert.equal(repaired.duplicate, true);
  assert.equal(repaired.repaired, true);
  assert.equal(actor.system.attribs.san.value, 55, "repair must not re-run the rules");
  assert.equal(actor.updates.length, updates);
  const card = message.flags.brp.chatCard[0];
  assert.equal(card.sanitySettlement.status, "applied");
  assert.equal(card.sanitySettlement.sanAfter, 55);
  assert.equal(card.sanAfter, 55);
  assert.deepEqual(rollQueue, []);
});

await checkAsync("settlementCarriesAClientWallClockBesideWorldSeconds", async () => {
  currentUser = ownerUser;
  activeGmUser = null;
  const actor = new MockActor({ name: "Wall Clock", ownerId: ownerUser.id });
  const realNow = Date.now;
  const stamp = 1763000000123;
  Date.now = () => stamp;
  try {
    queueRolls(40, 1); // regular success at SAN 60 -> loss 1, no INT check
    const messageId = await triggerSn(actor);
    const settleId = `coc-sn:${messageId}`;
    const record = BRPSanity.settlementOf(actor, settleId);
    assert.equal(record.updatedAtClient, stamp, "the client wall clock is stored in ms");
    assert.ok(record.updatedAt > 0 && record.updatedAt < 1e9, "updatedAt keeps world seconds");
    assert.notEqual(record.updatedAt, record.updatedAtClient);
    const card = appMessages.get(messageId).flags.brp.chatCard[0];
    assert.equal(card.sanitySettlement.updatedAtClient, stamp);
    assert.equal(actor.flags.brp.coc.sanityLog.at(-1).updatedAtClient, stamp);
    assert.equal(card.sanitySettlement.updatedAtClient, actor.flags.brp.coc.sanityLog.at(-1).updatedAtClient);

    Date.now = () => stamp + 60000;
    const duplicate = await BRPSanity.settleOwned({ actor, loss: 1, cardMessageId: messageId });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.updatedAtClient, stamp, "a duplicate keeps the original client stamp");
    assert.equal(BRPSanity.settlementOf(actor, settleId).updatedAtClient, stamp);
  } finally {
    Date.now = realNow;
  }
});

await checkAsync("keeperAuthoredCardWithNoActiveGmNamesTheRepairer", async () => {
  // 1) the keeper rolls SN for the PC while online: the card is keeper-authored.
  activeGmUser = gmUser;
  currentUser = gmUser;
  const actor = new MockActor({ name: "Offline Repair", ownerId: ownerUser.id });
  queueRolls(80, 6);
  const messageId = await triggerSn(actor);
  const settleId = `coc-sn:${messageId}`;
  assert.equal(appMessages.get(messageId).author, gmUser.id);

  // 2) the owner settles while no GM is online.
  activeGmUser = null;
  currentUser = ownerUser;
  emitted.length = 0;
  queueRolls(90);
  const result = await BRPSanity.retry({ cardMessageId: messageId });
  assert.equal(result.applied, true);
  assert.equal(actor.system.attribs.san.value, 54);
  assert.equal(result.repaired, false);
  assert.equal(result.cardError, "OWNERSHIP_FORBIDDEN");
  assert.equal(result.repairRelayed, false);
  assert.equal(result.repairBy.mode, "message-author");
  assert.equal(result.repairBy.by, gmUser.id);
  assert.equal(result.repairBy.authorId, gmUser.id);
  assert.equal(emitted.length, 0);

  // 3) Not a silent pending block: the SAN is applied on the actor, so a new SN
  //    is allowed and pending() reports the card as stale, with its author.
  assert.equal(BRPSanity.canStart(actor).allowed, true);
  const pending = await BRPSanity.pending({ actor });
  assert.equal(pending.pending, false);
  assert.equal(pending.cards.length, 1);
  assert.equal(pending.cards[0].settledOnActor, true);
  assert.equal(pending.cards[0].authorId, gmUser.id);
  assert.equal(pending.staleCards.length, 1);
  assert.equal(actor.flags.brp.coc.sanity.pendingSettlementId, null);

  // 4) The author repairs on return: no actor write, no second deduction.
  currentUser = gmUser;
  activeGmUser = gmUser;
  const updates = actor.updates.length;
  const sanAfter = actor.system.attribs.san.value;
  const repaired = await BRPSystemSocket.cocSanSettle({
    action: "cardRepair",
    actorId: actor.id,
    cardMessageId: messageId,
    settleId,
    origin: ownerUser.id,
  });
  assert.equal(repaired.repaired, true);
  assert.equal(actor.updates.length, updates);
  assert.equal(actor.system.attribs.san.value, sanAfter);
  const card = appMessages.get(messageId).flags.brp.chatCard[0];
  assert.equal(card.sanitySettlement.status, "applied");
  assert.equal(card.sanitySettlement.sanAfter, 54);
  assert.equal(card.sanAfter, 54);
  assert.equal(BRPSanity.canStart(actor).allowed, true);
});

await checkAsync("cardRepairIsNarrowAndFailsClosed", async () => {
  const actor = new MockActor({ name: "Narrow Repair", ownerId: ownerUser.id });
  const message = new MockMessage({
    rollType: "SN",
    chatCard: [{
      particId: actor.id,
      particType: "actor",
      sanLoss: 5,
      sanAfter: null,
      sanitySettlement: { settleId: "", status: "pending", loss: 5, sanBefore: 60, sanAfter: null },
    }],
  }, { author: gmUser.id });
  const settleId = `coc-sn:${message.id}`;
  message.flags.brp.chatCard[0].sanitySettlement.settleId = settleId;
  currentUser = gmUser;
  activeGmUser = gmUser;

  // A stranger cannot ask for a repair of somebody else's card.
  const noOrigin = await BRPSystemSocket.cocSanSettle({
    action: "cardRepair",
    actorId: actor.id,
    cardMessageId: message.id,
    settleId,
  });
  assert.equal(noOrigin.error, "origin-missing");
  const stranger = await BRPSystemSocket.cocSanSettle({
    action: "cardRepair",
    actorId: actor.id,
    cardMessageId: message.id,
    settleId,
    origin: otherUser.id,
  });
  assert.equal(stranger.error, "not-authorised");
  assert.equal(message.updates.length, 0);

  // A repair never settles: without an applied record there is nothing to project.
  const notApplied = await BRPSystemSocket.cocSanSettle({
    action: "cardRepair",
    actorId: actor.id,
    cardMessageId: message.id,
    settleId,
    origin: ownerUser.id,
  });
  assert.equal(notApplied.error, "settlement-not-applied");
  assert.equal(actor.updates.length, 0);
  assert.equal(message.updates.length, 0);

  // The real settlement is performed by the owner; the GM then repairs.
  currentUser = ownerUser;
  queueRolls(10, 4, 3, 2); // INT + 1D10h/1D10 bout/1D10 rounds
  const settled = await BRPSanity.retry({ cardMessageId: message.id });
  assert.equal(settled.applied, true);
  assert.equal(actor.system.attribs.san.value, 55);
  currentUser = gmUser;
  const repaired = await BRPSystemSocket.cocSanSettle({
    action: "cardRepair",
    actorId: actor.id,
    cardMessageId: message.id,
    settleId,
    origin: ownerUser.id,
  });
  assert.equal(repaired.repaired, true);
  assert.equal(actor.system.attribs.san.value, 55);
  assert.equal(message.flags.brp.chatCard[0].sanitySettlement.status, "applied");
});

await checkAsync("retryResumesPersistedDecisionAndDice", async () => {
  currentUser = ownerUser;
  const actor = new MockActor({ name: "Resume", ownerId: ownerUser.id });
  const settleId = "coc-sn:resume-message";
  actor.flags.brp.coc.sanity.pendingSettlementId = settleId;
  actor.flags.brp.coc.sanity.settlements = [{
    settleId,
    status: "pending",
    loss: 6,
    lossRolled: 6,
    sanBefore: 60,
    dailyLossBefore: 0,
    dayId: "day-4.1",
    dayStartSan: 60,
    dayStartSource: "keeper-new-day",
    // INT already rolled and hours already persisted; bout/rounds were not.
    decision: { intCheck: { roll: 20, target: 60, passed: true }, dice: { hours: 5 } },
  }];
  const message = new MockMessage({
    rollType: "SN",
    chatCard: [{
      particId: actor.id,
      particType: "actor",
      sanLoss: 6,
      sanLossFormulaUsed: "1D6",
      sanAfter: null,
      sanitySettlement: { settleId, status: "pending", loss: 6, sanBefore: 60, sanAfter: null },
    }],
  });
  queueRolls(7, 3); // only the two dice that were never persisted
  const result = await BRPSanity.retry({ cardMessageId: message.id });
  assert.equal(result.applied, true);
  assert.equal(result.loss, 6);
  assert.equal(result.sanAfter, 54);
  assert.equal(result.temporary.hours, 5, "the persisted hours die is reused");
  assert.equal(result.temporary.bout.index, 7);
  assert.equal(result.temporary.rounds.value, 3);
  assert.equal(actor.system.attribs.san.value, 54);
  assert.deepEqual(rollQueue, []);
  const record = BRPSanity.settlementOf(actor, settleId);
  assert.equal(record.status, "applied");
  assert.deepEqual(record.decision.dice, { hours: 5, bout: 7, rounds: 3 });
  assert.equal(actor.flags.brp.coc.sanity.pendingSettlementId, null);
});

await checkAsync("nativeOwnershipShapeAuthorisesTheSameWriter", async () => {
  currentUser = ownerUser;
  const actor = new MockActor({ name: "Native", ownership: { [ownerUser.id]: 3, default: 0 } });
  assert.equal(BRPSanity.ownershipOf(actor).source, "native");
  assert.equal(BRPSanity.ownershipOf(actor).owned, true);
  const result = await BRPSanity.settleOwned({ actor, loss: 1 });
  assert.equal(result.applied, true);
  assert.equal(actor.system.attribs.san.value, 59);
});

await checkAsync("nonOwnerCannotSettleAnOwnedPc", async () => {
  const actor = new MockActor({ name: "Refuse", ownerId: ownerUser.id });
  currentUser = otherUser;
  const byOther = await BRPSanity.settleOwned({ actor, loss: 5 });
  assert.equal(byOther.error, "not-card-owner");
  assert.equal(actor.updates.length, 0);

  currentUser = gmUser;
  activeGmUser = gmUser;
  const byKeeper = await BRPSanity.settleNow({ actor, loss: 5 });
  assert.equal(byKeeper.error, "card-owner-required");
  assert.equal(byKeeper.pending, true);
  assert.equal(actor.updates.length, 0);

  emitted.length = 0;
  currentUser = otherUser;
  const viaSettle = await BRPSanity.settle({ actor, loss: 5, cardMessageId: null });
  assert.equal(viaSettle.pending, true);
  assert.equal(viaSettle.error, "card-owner-required");
  assert.equal(emitted.length, 0, "an owned PC is never relayed to the active GM");
  assert.equal(actor.updates.length, 0);
});

await checkAsync("unownedNpcKeepsTheActiveGmRelay", async () => {
  const npc = new MockActor({ name: "Byakhee" });
  assert.equal(BRPSanity.ownershipOf(npc).owned, false);
  currentUser = otherUser;
  activeGmUser = gmUser;
  emitted.length = 0;
  const relayed = await BRPSanity.settle({ actor: npc, loss: 5, cardMessageId: null });
  assert.equal(relayed.queued, true);
  assert.equal(relayed.by, gmUser.id);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].channel, "system.brp");
  assert.equal(emitted[0].payload.type, "cocSanSettle");
  assert.equal(emitted[0].payload.to, gmUser.id);
  assert.equal(emitted[0].payload.value.origin, otherUser.id);

  currentUser = gmUser;
  // The active-GM chain still rolls the follow-up INT check and episode dice.
  queueRolls(10, 4, 3, 2);
  const applied = await BRPSystemSocket.cocSanSettle({
    actorId: npc.id,
    loss: 5,
    origin: otherUser.id,
  });
  assert.equal(applied.applied, true);
  assert.equal(npc.system.attribs.san.value, 55);
  assert.equal(applied.temporary.active, true);
  assert.equal(npc.updates.length > 0, true);
  assert.deepEqual(rollQueue, []);
});

await checkAsync("actorLevelPendingBlocksANewSnAndAnotherSettleId", async () => {
  const settleId = "coc-sn:stalled";
  const actor = new MockActor({
    name: "Stalled",
    ownerId: ownerUser.id,
    details: {
      pendingSettlementId: settleId,
      settlements: [{
        settleId,
        status: "pending",
        loss: 6,
        sanBefore: 60,
        dayId: "day-4.1",
        dayStartSan: 60,
        decision: { intCheck: null, dice: {} },
      }],
    },
  });
  currentUser = ownerUser;
  const guard = BRPSanity.canStart(actor);
  assert.equal(guard.allowed, false);
  assert.equal(guard.reason, "actor-pending");
  assert.equal(guard.settleId, settleId);
  const refused = await triggerSn(actor);
  assert.equal(refused, false);
  assert.deepEqual(rollQueue, []);

  const otherSettle = await BRPSanity.settleOwned({
    actor,
    loss: 6,
    cardMessageId: "another-card",
    settleId: "coc-sn:another-card",
  });
  assert.equal(otherSettle.error, "settlement-pending");
  assert.equal(otherSettle.settleId, settleId);
  assert.equal(actor.updates.length, 0);
});

await checkAsync("settlementRecordsStayBounded", async () => {
  currentUser = ownerUser;
  const actor = new MockActor({ name: "Bounded", ownerId: ownerUser.id });
  for (let index = 0; index < 25; index += 1) {
    const messageId = `bounded-${index}`;
    await BRPSanity.settleOwned({
      actor,
      loss: 1,
      cardMessageId: messageId,
      settleId: `coc-sn:${messageId}`,
    });
  }
  assert.equal(actor.system.attribs.san.value, 35);
  assert.equal(actor.flags.brp.coc.sanity.settlements.length, 20);
  assert.equal(actor.flags.brp.coc.sanity.settlements.at(-1).settleId, "coc-sn:bounded-24");
  assert.equal(actor.flags.brp.coc.sanity.settlements[0].settleId, "coc-sn:bounded-5");
  assert.equal(actor.flags.brp.coc.sanityLog.length, 20);
  assert.deepEqual(rollQueue, []);
});

await checkAsync("pendingCardsWithoutSettlementAreIgnored", async () => {
  const actor = new MockActor({ name: "Legacy", ownerId: ownerUser.id });
  const legacy = new MockMessage({
    rollType: "SN",
    chatCard: [{ particId: actor.id, particType: "actor", sanLoss: 6, sanAfter: null }],
  });
  const pending = await BRPSanity.pending({ actor });
  assert.equal(pending.pending, false);
  assert.deepEqual(pending.cards, []);
  assert.equal(BRPSanity.canStart(actor).allowed, true);
  assert.equal(typeof legacy.id, "string");
});

await checkAsync("permanentActorClosesItsSettleIdInsteadOfStrandingPending", async () => {
  currentUser = ownerUser;
  const actor = new MockActor({
    name: "Terminal",
    ownerId: ownerUser.id,
    san: 0,
    details: { insanity: { temporary: null, indefinite: null, permanent: true } },
  });
  queueRolls(80, 6);
  const cardMessageId = await triggerSn(actor);
  assert.equal(typeof cardMessageId, "string");
  assert.equal(actor.system.attribs.san.value, 0);
  const record = BRPSanity.settlementOf(actor, `coc-sn:${cardMessageId}`);
  assert.equal(record.status, "applied");
  assert.equal(record.rejected, "permanent-insanity");
  assert.equal(record.loss, 0);
  const card = appMessages.get(cardMessageId).flags.brp.chatCard[0];
  assert.equal(card.sanitySettlement.status, "applied");
  assert.equal(card.sanitySettlement.loss, 0);
  assert.equal(card.permaInsane, true);
  const pending = await BRPSanity.pending({ actor });
  assert.equal(pending.pending, false);
  assert.equal(BRPSanity.canStart(actor).allowed, true);
  assert.deepEqual(rollQueue, []);
});

// --- 13) M5 skill growth fields: one canonical write surface -----------------
//
// The pure resolver is covered in coc-rules-regressions. Here the real app
// modules are driven: item prepare derives the total (never NaN), Mythos
// experience still lowers the SAN cap, auto-tick / Luck untick / development
// settlement / drop normalisation / the one-shot migration only ever write
// properties.noxpgain, flags.developement and adjustments.*.
const itemCollection = (items) => ({
  get: (id) => items.find((item) => item.id === id || item._id === id),
  *[Symbol.iterator]() { yield* items; },
});

const makeSkill = ({ id = `skill-${++actorSequence}`, system = {}, flags = {}, name = "测试技能" } = {}) => {
  const skill = {
    id,
    _id: id,
    name,
    type: "skill",
    flags: { brp: { ...flags } },
    system: appClone(system),
    updates: [],
    async update(changes) {
      this.updates.push(appClone(changes));
      for (const [path, value] of Object.entries(changes)) setPath(this, path, appClone(value));
      return this;
    },
  };
  return skill;
};

const makeMigratableItem = (type, system) => {
  const item = {
    id: `mig-${++actorSequence}`,
    name: type,
    type,
    system: appClone(system),
    _source: { system: appClone(system) },
    updates: [],
    async update(changes) {
      this.updates.push(appClone(changes));
      for (const [path, value] of Object.entries(changes)) {
        setPath(this, path, appClone(value));
        setPath(this._source, path, appClone(value));
      }
      return this;
    },
  };
  return item;
};

await checkAsync("skillItemPrepareDerivesFiniteCanonicalTotal", async () => {
  const prepare = (system) => {
    const item = Object.create(BRPItem.prototype);
    item.type = "skill";
    item.name = "测试技能";
    item.system = system;
    item.prepareDerivedData();
    return item.system;
  };
  const canonical = prepare({ base: "25", adjustments: { personal: 10, experience: 5 } });
  assert.equal(canonical.total, 40);
  const legacy = prepare({ base: "25", xp: 5, personal: 10, noXP: true, improve: true });
  assert.equal(legacy.total, 40, "legacy flat scores still count through the resolver");
  const nan = prepare({ base: "abc", adjustments: { personal: "oops" } });
  assert.equal(nan.total, 0);
  assert.equal(Number.isFinite(nan.total), true, "undefined + N can never leak NaN");
  const both = prepare({ base: "25", adjustments: { experience: 7 }, xp: 5 });
  assert.equal(both.total, 32, "canonical experience wins, never summed with legacy xp");
});

await checkAsync("mythosExperienceCountsEvenWithNoFutureGrowth", async () => {
  const mythos = makeSkill({
    id: "skill-mythos",
    name: "克苏鲁神话",
    flags: { brpidFlag: { id: "i.skill.coc.cthulhu-mythos" } },
    system: { base: "0", adjustments: { experience: 10 }, properties: { noxpgain: true } },
  });
  assert.equal(skillTotal(mythos.system), 10);
  assert.equal(skillXp(mythos.system), 10);
  assert.equal(skillNoXP(mythos.system), true);
  assert.equal(BRPActor.prototype._sanityMythosPercent.call({ items: [mythos] }), 10);
  const fake = Object.create(BRPActor.prototype);
  fake.items = [mythos];
  fake.system = {
    attribs: { san: { auto: true, value: 40, max: 99, dailyLoss: 0, dailyLimit: 0 } },
    characteristics: { pow: { value: 40 } },
  };
  BRPActor.prototype._prepSanity.call(fake);
  assert.equal(fake.system.attribs.san.max, 89);
  assert.equal(fake.system.attribs.san.value, 40);
});

await checkAsync("autoTickWritesOnlyTheCanonicalGrowthFlag", async () => {
  currentUser = ownerUser;
  appSettings.set(settingKey("brp", "autoXP"), "1");
  try {
    const actor = new MockActor({ name: "Ticker", ownerId: ownerUser.id });
    const skill = makeSkill({ id: "skill-tick", system: { base: "50", adjustments: { personal: 5 } } });
    actor.items = itemCollection([skill]);
    await BRPCheck.tickXP({
      state: "closed",
      cardType: "NO",
      rollType: "SK",
      chatCard: [{
        particId: actor.id,
        particType: "actor",
        skillId: skill.id,
        resultLevel: 2,
        taskSuccess: true,
        band: "regular",
        luckSpent: 0,
      }],
    });
    assert.deepEqual(skill.updates.at(-1), { "system.flags.developement": true });

    const noxp = makeSkill({
      id: "skill-noxp",
      system: { base: "0", adjustments: { experience: 10 }, properties: { noxpgain: true } },
    });
    actor.items = itemCollection([noxp]);
    await BRPCheck.tickXP({
      state: "closed",
      cardType: "NO",
      rollType: "SK",
      chatCard: [{
        particId: actor.id,
        particType: "actor",
        skillId: noxp.id,
        resultLevel: 2,
        taskSuccess: true,
        band: "regular",
        luckSpent: 0,
      }],
    });
    assert.equal(noxp.updates.length, 0, "noxpgain never gains a new tick");
    assert.equal(skillTicked(noxp.system), false);
  } finally {
    appSettings.set(settingKey("brp", "autoXP"), 0);
  }
});

await checkAsync("luckUntickClearsOnlyTheCanonicalFlag", async () => {
  currentUser = ownerUser;
  const actor = new MockActor({ name: "Untick", ownerId: ownerUser.id });
  const skill = makeSkill({
    id: "skill-untick",
    system: { base: "50", adjustments: { experience: 5 }, flags: { developement: true } },
  });
  actor.items = itemCollection([skill]);
  await BRPLuck._untickGrowth(
    { particId: actor.id, particType: "actor", skillId: skill.id },
    { roll: { resultLevel: 2, luckSpent: 3 } },
  );
  assert.deepEqual(skill.updates.at(-1), { "system.flags.developement": false });
  assert.equal(skillXp(skill.system), 5, "unticking never removes experience already gained");
});

await checkAsync("developmentSettlementAddsCanonicalExperience", async () => {
  currentUser = ownerUser;
  const actor = new MockActor({ name: "Dev", ownerId: ownerUser.id });
  const skill = makeSkill({
    id: "skill-dev",
    system: { base: "50", adjustments: { experience: 5 }, flags: { developement: true } },
  });
  actor.items = itemCollection([skill]);
  queueRolls(90, 7); // 1D100 above 55 -> improvement; 1D10 = 7
  const result = await BRPCharDev.xpCheck(actor, null, skill.id, "formula", false);
  assert.equal(result.error, undefined);
  assert.equal(result.score, 55);
  assert.equal(result.improvVal, 7);
  assert.deepEqual(skill.updates.at(-1), {
    "system.flags.developement": false,
    "system.adjustments.experience": 12,
  });
  assert.deepEqual(rollQueue, []);
});

await checkAsync("developmentRefusesInvalidScoreAndNoXP", async () => {
  currentUser = ownerUser;
  const actor = new MockActor({ name: "Refuse", ownerId: ownerUser.id });
  const broken = makeSkill({
    id: "skill-broken",
    system: { base: "abc", adjustments: { personal: "oops" }, flags: { developement: true } },
  });
  actor.items = itemCollection([broken]);
  const invalid = await BRPCharDev.xpCheck(actor, null, broken.id, "formula", false);
  assert.equal(invalid.error, "skill-score-invalid");
  assert.equal(broken.updates.length, 0);
  assert.deepEqual(rollQueue, [], "an invalid score must not roll a die (no NaN->0 fake success)");

  const noxp = makeSkill({
    id: "skill-noxp-dev",
    system: { base: "0", adjustments: { experience: 10 }, properties: { noxpgain: true }, flags: { developement: true } },
  });
  actor.items = itemCollection([noxp]);
  const blocked = await BRPCharDev.xpCheck(actor, null, noxp.id, "formula", false);
  assert.equal(blocked.error, "no-xp");
  // The dirty tick is cleared, but the experience already gained is untouched.
  assert.deepEqual(noxp.updates.at(-1), { "system.flags.developement": false });
  assert.equal(skillXp(noxp.system), 10);
  assert.deepEqual(rollQueue, [], "no growth check is rolled for a noxpgain skill");
});

await checkAsync("skillRollUsesTheDerivedCanonicalScore", async () => {
  currentUser = ownerUser;
  const actor = new MockActor({ name: "Roller", ownerId: ownerUser.id });
  const skill = makeSkill({ id: "skill-roll", system: { base: "25", adjustments: { personal: 10 } } });
  skill.flags = { brp: {} };
  actor.items = itemCollection([skill]);
  const config = await BRPCheck.normaliseRequest({
    rollType: "SK",
    cardType: "NO",
    actor,
    skillId: skill.id,
    shiftKey: true,
  });
  assert.equal(config.rawScore, 35);
  assert.equal(config.targetScore, 35);
});

await checkAsync("droppedLegacySkillIsStoredCanonically", async () => {
  const dropped = {
    type: "skill",
    name: "旧式技能",
    flags: { brp: { brpidFlag: { id: "i.skill.extension-arcane-lore" } } },
    system: {
      base: "25", total: 100, effects: 3,
      xp: 5, personal: 10, profession: 20, personality: 10, culture: 5,
      occupation: true, prsnlty: true, cultural: true, noXP: true, improve: true,
      adjustments: { personal: 1 },
      properties: { keepbasevalue: true },
      flags: { occupation: false },
      skillName: "旧式技能",
    },
  };
  BRPactorItemDrop._canonicalSkillData(dropped);
  assert.equal(dropped.system.base, "25");
  assert.equal(dropped.system.adjustments.personal, 1, "canonical wins over the flat fallback");
  assert.equal(dropped.system.adjustments.occupation, 20);
  assert.equal(dropped.system.adjustments.archetype, 10);
  assert.equal(dropped.system.adjustments.experiencePackage, 5);
  assert.equal(dropped.system.adjustments.experience, 5);
  assert.equal(dropped.system.properties.noxpgain, true);
  assert.equal(dropped.system.properties.keepbasevalue, true);
  assert.equal(dropped.system.flags.developement, true);
  assert.equal(dropped.system.flags.occupation, true);
  assert.equal(dropped.system.flags.archetype, true);
  assert.equal(dropped.system.flags.experiencePackage, true);
  for (const key of ["xp", "personal", "profession", "personality", "culture", "occupation",
    "prsnlty", "cultural", "noXP", "improve", "total", "effects"]) {
    assert.equal(key in dropped.system, false, `${key} must not be persisted again`);
  }
  assert.equal(skillTotal(dropped.system), 25 + 1 + 20 + 10 + 5 + 5);
});

await checkAsync("skillFieldMigrationIsOneShotAndIdempotent", async () => {
  const skill = makeMigratableItem("skill", {
    base: "25", total: 80,
    xp: 5, noXP: true, improve: true,
    personal: 10, profession: 20, personality: 10, culture: 5, effects: 2,
    occupation: true, prsnlty: true, cultural: true,
  });
  const actor = { id: "mig-actor", items: itemCollection([skill]) };
  const first = await migrateSkillFields({ actors: [actor], items: [] });
  assert.equal(first.changed, 1);
  assert.equal(skill.system.adjustments.experience, 5);
  assert.equal(skill.system.adjustments.occupation, 20);
  assert.equal(skill.system.adjustments.archetype, 10);
  assert.equal(skill.system.adjustments.experiencePackage, 5);
  assert.equal(skill.system.properties.noxpgain, true);
  assert.equal(skill.system.flags.developement, false, "a noxpgain skill never keeps a dirty tick");
  assert.equal(skill.system.flags.occupation, true);
  assert.equal(skill.system.xp, 0);
  assert.equal(skill.system.noXP, false);
  assert.equal(skill.system.improve, false);
  assert.equal(skill.system.total, 0);
  const writesAfterFirst = skill.updates.length;
  const second = await migrateSkillFields({ actors: [actor], items: [] });
  assert.equal(second.changed, 0);
  assert.equal(skill.updates.length, writesAfterFirst, "a migrated skill is never rewritten");
  assert.equal(skillTotal(skill.system), 25 + 10 + 20 + 10 + 5 + 5);

  const magic = makeMigratableItem("magic", { xp: 5, improve: true });
  const other = await migrateSkillFields({ actors: [{ id: "mig-other", items: itemCollection([magic]) }], items: [] });
  assert.equal(other.scanned, 0);
  assert.equal(magic.updates.length, 0, "only type=skill is migrated");
});

await checkAsync("legacyNativeAndExtensionSkillsShareTheTotalContract", async () => {
  const legacy = makeSkill({ id: "skill-old", system: { base: "30", xp: 5, profession: 10 } });
  const native = makeSkill({ id: "skill-new", system: { base: "30", adjustments: { experience: 5, occupation: 10 } } });
  const extension = makeSkill({
    id: "skill-ext",
    flags: { brpidFlag: { id: "i.skill.extension-forbidden-lore" } },
    system: { base: "30", adjustments: { experience: 5, occupation: 10 } },
  });
  for (const item of [legacy, native, extension]) {
    assert.equal(skillTotal(item.system), 45, item.id);
  }
  const prepared = Object.create(BRPItem.prototype);
  prepared.type = "skill";
  prepared.name = "扩展技能";
  prepared.system = extension.system;
  prepared.prepareDerivedData();
  assert.equal(prepared.system.total, 45);
});

assert.deepEqual(rollQueue, [], "every queued roll must be consumed");
assert.equal(emitted.length > 0, true, "the unowned-NPC relay path must still emit");

const failed = failures.length;
console.log(JSON.stringify({
  checks: Object.keys(checks).length,
  failed,
  errors: failures,
  summary: checks,
}, null, 2));
if (failed) process.exit(1);
