// Call of Cthulhu 7e sanity / insanity / luck / growth decision core (M4).
//
// Pure, dependency-free and side-effect-free: no Foundry globals, no imports,
// no dice engine, no actor writes, no clock (`Date.now`, worldTime), no `eval`
// and no mutable module state. Every random value is injected by the caller and
// every "game day" is an explicit keeper snapshot (`dayId` + SAN at day start)
// supplied by the caller. The module only decides what the rules say; the
// native settlement path applies it.
//
// This file is deliberately standalone: it is not wired into coc.mjs / index.mjs
// and is not imported by module/apps/* until the M4 integration step.
//
// Fact sources, evidence grades and the unverified gaps are recorded in
// content/coc/sanity-provenance.json. No GPL system source, template, YAML or
// text block was read or used. The ten bout tags below are this project's own
// short ids/labels for the documented categories, not official descriptions.

export class CoCSanityRuleError extends Error {
  constructor(code, message, detail = undefined) {
    super(message)
    this.name = 'CoCSanityRuleError'
    this.code = code
    this.detail = detail
  }
}

const invalid = (code, message, detail) => {
  throw new CoCSanityRuleError(code, message, detail)
}

const integer = (value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    invalid('not-integer', `${label} 必须是整数`, { label, value })
  }
  if (value < min || value > max) {
    invalid('out-of-range', `${label} 超出范围 ${min}..${max}`, { label, value })
  }
  return value
}

const d10 = (value, label) => integer(value, label, { min: 1, max: 10 })

const assertDayId = (value) => {
  if (typeof value !== 'string' || value.trim() === '') {
    invalid('day-id-required', 'dayId 必须是非空字符串（keeper 显式的游戏日开始快照）', { value })
  }
  return value
}

const option = (value) => value === null || value === undefined

// --- evidence grades (mirrored by content/coc/sanity-provenance.json) ---
export const EVIDENCE = Object.freeze({
  singleLoss: Object.freeze({ grade: 'primary-official-free', sourceRefs: Object.freeze(['coc-quickstart', 'coc-wiki-sanity']) }),
  intCheck: Object.freeze({ grade: 'primary-official-free', sourceRefs: Object.freeze(['coc-quickstart', 'coc-wiki-sanity']) }),
  temporaryDuration: Object.freeze({ grade: 'primary-official-free', sourceRefs: Object.freeze(['coc-quickstart', 'coc-wiki-sanity']) }),
  boutTable: Object.freeze({ grade: 'primary-official-free', sourceRefs: Object.freeze(['coc-wiki-sanity']) }),
  boutDuration: Object.freeze({ grade: 'primary-official-free', sourceRefs: Object.freeze(['coc-wiki-sanity']) }),
  temporaryEnd: Object.freeze({ grade: 'primary-official-free', sourceRefs: Object.freeze(['coc-wiki-sanity']) }),
  permanentInsanity: Object.freeze({ grade: 'secondary', sourceRefs: Object.freeze(['coc-trpgline']) }),
  dailyInsanity: Object.freeze({ grade: 'conflicting', sourceRefs: Object.freeze(['coc-trpgline', 'coc-lightless-beacon']) }),
  indefiniteRecovery: Object.freeze({ grade: 'pending-official-source', sourceRefs: Object.freeze(['coc-trpgline']) }),
  luckSpendAllowed: Object.freeze({ grade: 'primary-official-free', sourceRefs: Object.freeze(['coc-lightless-beacon', 'coc-roll20-using-luck']) }),
  luckSpendDenied: Object.freeze({ grade: 'primary-official-free', sourceRefs: Object.freeze(['coc-lightless-beacon', 'coc-roll20-using-luck']) }),
  luckNaturalCritical: Object.freeze({ grade: 'secondary', sourceRefs: Object.freeze(['coc-roll20-using-luck']) }),
  luckRecovery: Object.freeze({ grade: 'secondary', sourceRefs: Object.freeze(['coc-roll20-using-luck']) }),
  growthTick: Object.freeze({ grade: 'primary-official-free', sourceRefs: Object.freeze(['coc-wiki-game-system', 'coc-wiki-rewards']) }),
  growthNoLuckTick: Object.freeze({ grade: 'secondary', sourceRefs: Object.freeze(['coc-roll20-using-luck']) }),
  growthSettlement: Object.freeze({ grade: 'primary-official-free', sourceRefs: Object.freeze(['coc-wiki-rewards', 'coc-quickstart']) }),
  sanLossHalving: Object.freeze({ grade: 'pending-official-source', status: 'disabled-in-standard', sourceRefs: Object.freeze(['coc-roll20-using-luck', 'coc-lightless-beacon']) }),
})

// Pulp-only Luck spends that are out of scope for the standard game. They stay
// listed here so an integration cannot switch them on by accident.
export const PULP_ONLY_LUCK_SPENDS = Object.freeze([
  'halve-san-loss',
  'avoid-death',
  'restore-hit-points',
  'stay-conscious',
  'avoid-unconsciousness',
])

// --- sanity loss and its two independent thresholds ---
export const SINGLE_LOSS_THRESHOLD = 5
export const TEMPORARY_INSANITY_HOURS = Object.freeze({ die: '1D10', unit: 'hours' })
export const BOUT_ROUNDS = Object.freeze({ die: '1D10', unit: 'rounds' })

// Short project tags for the ten documented bout categories (1..10).
const BOUT_TABLE = Object.freeze([
  Object.freeze({ index: 1, id: 'amnesia', zh: '失忆' }),
  Object.freeze({ index: 2, id: 'psychosomatic-disability', zh: '心身失能' }),
  Object.freeze({ index: 3, id: 'violence', zh: '暴力' }),
  Object.freeze({ index: 4, id: 'paranoia', zh: '偏执' }),
  Object.freeze({ index: 5, id: 'significant-person', zh: '重要之人' }),
  Object.freeze({ index: 6, id: 'faint', zh: '昏厥' }),
  Object.freeze({ index: 7, id: 'flee-in-panic', zh: '惊慌逃窜' }),
  Object.freeze({ index: 8, id: 'hysterics', zh: '歇斯底里' }),
  Object.freeze({ index: 9, id: 'phobia', zh: '恐惧症' }),
  Object.freeze({ index: 10, id: 'mania', zh: '躁狂' }),
])

export function boutTable() {
  return BOUT_TABLE
}

export function resolveBout({ die, roundsDie } = {}) {
  const index = d10(die, 'boutDie')
  const rounds = d10(roundsDie, 'roundsDie')
  const entry = BOUT_TABLE[index - 1]
  return Object.freeze({
    index,
    id: entry.id,
    zh: entry.zh,
    rounds,
    roundsDie: '1D10',
    evidence: EVIDENCE.boutTable,
  })
}

// A single Sanity roll's loss is compared with the fixed 5-point threshold.
export function singleLossTrigger({ loss } = {}) {
  const applied = integer(loss, 'loss', { min: 0 })
  const trigger = applied >= SINGLE_LOSS_THRESHOLD
  return Object.freeze({
    loss: applied,
    threshold: SINGLE_LOSS_THRESHOLD,
    trigger,
    requiresIntCheck: trigger,
    intSuccessOn: 'roll <= INT',
    evidence: EVIDENCE.singleLoss,
  })
}

// Missing INT dice are "pending", never a silent success or failure.
export function intCheckState(value) {
  if (option(value)) {
    return Object.freeze({
      status: 'pending',
      roll: null,
      target: null,
      rule: 'roll <= target',
      reason: 'int-roll-not-provided',
      evidence: EVIDENCE.intCheck,
    })
  }
  const roll = integer(value.roll, 'intCheck.roll', { min: 1, max: 100 })
  const target = integer(value.target, 'intCheck.target', { min: 0, max: 100 })
  const passed = roll <= target
  return Object.freeze({
    status: passed ? 'passed' : 'failed',
    roll,
    target,
    rule: 'roll <= target',
    evidence: EVIDENCE.intCheck,
  })
}

// --- temporary insanity ---
export function temporaryInsanity({ loss, intCheck = null, hoursDie = null, boutDie = null, roundsDie = null, dayId = null } = {}) {
  const applied = integer(loss, 'loss', { min: 0 })
  if (applied < SINGLE_LOSS_THRESHOLD) {
    return Object.freeze({
      active: false,
      status: 'not-triggered',
      reason: 'loss-below-threshold',
      loss: applied,
      threshold: SINGLE_LOSS_THRESHOLD,
      evidence: EVIDENCE.singleLoss,
    })
  }

  const int = intCheckState(intCheck)
  if (int.status === 'pending') {
    return Object.freeze({
      active: false,
      status: 'pending-int-check',
      loss: applied,
      intCheck: int,
      requires: Object.freeze(['int-check']),
      evidence: EVIDENCE.intCheck,
    })
  }
  if (int.status === 'failed') {
    return Object.freeze({
      active: false,
      status: 'repressed',
      loss: applied,
      intCheck: int,
      // Official: a failed INT roll means the mind closes and the investigator
      // stays sane for now, so no episode and no dice are produced.
      evidence: EVIDENCE.intCheck,
    })
  }

  if (option(hoursDie) || option(boutDie) || option(roundsDie)) {
    const requires = []
    if (option(hoursDie)) { requires.push('hours-die') }
    if (option(boutDie)) { requires.push('bout-die') }
    if (option(roundsDie)) { requires.push('rounds-die') }
    return Object.freeze({
      active: false,
      status: 'pending-dice',
      loss: applied,
      intCheck: int,
      requires: Object.freeze(requires),
      dice: Object.freeze({ hours: '1D10', bout: '1D10', rounds: '1D10' }),
      evidence: EVIDENCE.temporaryDuration,
    })
  }

  const hours = d10(hoursDie, 'hoursDie')
  const bout = resolveBout({ die: boutDie, roundsDie })
  return Object.freeze({
    active: true,
    status: 'active',
    loss: applied,
    intCheck: int,
    hours: Object.freeze({ value: hours, die: '1D10', unit: 'hours' }),
    bout: Object.freeze({ index: bout.index, id: bout.id, zh: bout.zh }),
    rounds: Object.freeze({ value: bout.rounds, die: '1D10', unit: 'rounds' }),
    dayId: option(dayId) ? null : assertDayId(dayId),
    // The 1D10 hours are data only: elapsed time is confirmed by the keeper
    // clock, never inferred here (worldTime is not persisted by the shim).
    expiry: Object.freeze({
      autoRecovery: false,
      keeperClockRequired: true,
      duration: '1D10 hours',
    }),
    evidence: EVIDENCE.temporaryDuration,
  })
}

// Ending an episode is an explicit keeper/GM event. Persistent material gained
// during the episode (phobia, mania, rewritten backstory) is retained; delusions
// end with the episode.
const TEMPORARY_END_REASONS = Object.freeze([
  'keeper-ended',
  'hours-elapsed-keeper-confirmed',
  'effect-deleted',
  'effect-disabled',
])

export function endTemporaryInsanity({ reason, dayId = null } = {}) {
  if (!TEMPORARY_END_REASONS.includes(reason)) {
    invalid('invalid-end-reason', `结束临时疯狂需要明确原因：${TEMPORARY_END_REASONS.join(', ')}`, { reason })
  }
  return Object.freeze({
    ended: true,
    reason,
    dayId: option(dayId) ? null : assertDayId(dayId),
    temporaryActive: false,
    cleared: Object.freeze(['delusions']),
    retained: Object.freeze(['phobia', 'mania', 'backstory']),
    autoRecovery: false,
    keeperClockSource: reason === 'hours-elapsed-keeper-confirmed' ? 'explicit' : 'manual',
    leavesIndefiniteUntouched: true,
    leavesPermanentUntouched: true,
    evidence: EVIDENCE.temporaryEnd,
  })
}

// --- indefinite insanity (one game day; basis must be explicit) ---
const DAILY_BASES = Object.freeze({
  'day-start': Object.freeze({
    field: 'dayStartSan',
    evidence: EVIDENCE.dailyInsanity,
    note: 'SAN at the keeper-declared start of this game day; one game day window',
  }),
  starting: Object.freeze({
    field: 'startingSan',
    evidence: EVIDENCE.dailyInsanity,
    note: 'printed starting SAN; free official scenario measures cumulative loss over the scenario, not one game day',
  }),
  current: Object.freeze({
    field: 'currentSan',
    evidence: EVIDENCE.dailyInsanity,
    note: 'current SAN quoted by the Keeper Rulebook summary; conflicts with the free scenario wording',
  }),
})

export function dailyThreshold({ basis = 'day-start', dayStartSan = null, startingSan = null, currentSan = null } = {}) {
  const key = String(basis)
  const spec = DAILY_BASES[key]
  if (!spec) {
    invalid('invalid-basis', `不定疯狂阈值口径必须是 ${Object.keys(DAILY_BASES).join(' / ')}`, { basis })
  }
  const source = { 'day-start': dayStartSan, starting: startingSan, current: currentSan }[key]
  if (option(source)) {
    return Object.freeze({
      available: false,
      basis: key,
      basisValue: null,
      threshold: null,
      reason: `${spec.field}-missing`,
      window: 'game-day',
      evidence: spec.evidence,
      note: spec.note,
    })
  }
  const basisValue = integer(source, spec.field, { min: 0 })
  if (basisValue === 0) {
    return Object.freeze({
      available: false,
      basis: key,
      basisValue: 0,
      threshold: null,
      reason: 'basis-zero',
      window: 'game-day',
      evidence: spec.evidence,
      note: spec.note,
    })
  }
  // "one fifth or more" is a ratio: the smallest whole loss that reaches it.
  const threshold = Math.ceil(basisValue / 5)
  return Object.freeze({
    available: true,
    basis: key,
    basisValue,
    threshold,
    thresholdDie: null,
    thresholdRule: 'smallest whole loss that is at least one fifth of the basis',
    window: 'game-day',
    evidence: spec.evidence,
    note: spec.note,
  })
}

export function dailyInsanity({ dailyLoss, basis = 'day-start', dayStartSan = null, startingSan = null, currentSan = null, dayId = null } = {}) {
  const accumulated = integer(dailyLoss, 'dailyLoss', { min: 0 })
  const threshold = dailyThreshold({ basis, dayStartSan, startingSan, currentSan })
  const trigger = threshold.available && accumulated >= threshold.threshold
  return Object.freeze({
    active: trigger,
    status: !threshold.available ? 'unavailable' : (trigger ? 'indefinite' : 'none'),
    dailyLoss: accumulated,
    threshold: threshold.threshold,
    basis: threshold.basis,
    basisValue: threshold.basisValue,
    available: threshold.available,
    reason: threshold.reason ?? null,
    window: 'game-day',
    dayId: option(dayId) ? null : assertDayId(dayId),
    // A temporary-insanity episode never stands in for this state.
    temporaryStandInForIndefinite: false,
    // Recovery quantities are unverified: keeper review only, no automatic number.
    recovery: Object.freeze({
      mode: 'keeper-review',
      automatic: false,
      evidence: EVIDENCE.indefiniteRecovery,
    }),
    evidence: EVIDENCE.dailyInsanity,
  })
}

// Explicit keeper day boundary. The core never reads a clock.
export function beginGameDay({ dayId, san, dailyLoss = 0 } = {}) {
  const id = assertDayId(dayId)
  const sanNow = integer(san, 'san', { min: 0 })
  const carried = integer(dailyLoss, 'dailyLoss', { min: 0 })
  return Object.freeze({ dayId: id, dayStartSan: sanNow, dailyLoss: carried })
}

export function rollGameDay({ previous, dayId, san } = {}) {
  if (!previous || option(previous.dayId)) {
    invalid('previous-day-missing', 'rollGameDay 需要上一日的快照', { previous })
  }
  const id = assertDayId(dayId)
  if (previous.dayId === id) {
    invalid('day-id-reused', '新的一天必须使用新的 dayId', { dayId: id })
  }
  const sanNow = integer(san, 'san', { min: 0 })
  return Object.freeze({
    dayId: id,
    dayStartSan: sanNow,
    dailyLoss: 0,
    previousDayId: previous.dayId,
    resetDailyLoss: true,
    keeperConfirmed: true,
  })
}

// Continue an existing game day without rebasing its threshold. The day-start
// SAN is carried from the previous snapshot, so a mid-day settle can never
// silently move the one-fifth line.
export function advanceGameDay({ previous, san, dailyLoss } = {}) {
  if (!previous || option(previous.dayId)) {
    invalid('previous-day-missing', 'advanceGameDay 需要同一游戏日的快照', { previous })
  }
  const id = assertDayId(previous.dayId)
  if (!Number.isInteger(previous.dayStartSan) || previous.dayStartSan < 0) {
    invalid('day-start-missing', '上一快照缺少 dayStartSan，不能延续该游戏日', { dayStartSan: previous.dayStartSan })
  }
  const sanNow = integer(san, 'san', { min: 0 })
  const carried = integer(dailyLoss ?? previous.dailyLoss ?? 0, 'dailyLoss', { min: 0 })
  return Object.freeze({
    dayId: id,
    dayStartSan: previous.dayStartSan,
    dailyLoss: carried,
    carriedDayStartSan: true,
  })
}

// --- combined state: three independent keys, never one effect pretending to be another ---
export function insanityState({ temporary = null, indefinite = null, permanent = false } = {}) {
  if (typeof permanent !== 'boolean') {
    invalid('not-boolean', 'permanent 必须是布尔值', { permanent })
  }
  const temporaryActive = temporary?.active === true
  const indefiniteActive = indefinite?.active === true
  const active = []
  if (permanent) { active.push('permanent') }
  if (temporaryActive) { active.push('temporary') }
  if (indefiniteActive) { active.push('indefinite') }
  return Object.freeze({
    temporary: temporary ?? null,
    indefinite: indefinite ?? null,
    permanent,
    active: Object.freeze(active),
    coexisting: temporaryActive && indefiniteActive,
    // Permanent insanity is terminal: any temporary/indefinite key reported
    // alongside it is descriptive only and must not be settled as a new episode.
    terminal: permanent ? 'permanent' : null,
    temporaryStandInForIndefinite: false,
  })
}

// --- settlement orchestrator: decide, do not roll or write ---
export function settleSanLoss(input = {}) {
  const loss = integer(input.loss, 'loss', { min: 0 })
  const sanBefore = integer(input.sanBefore, 'sanBefore', { min: 0 })
  const snapshot = input.snapshot ?? null
  if (snapshot) {
    assertDayId(snapshot.dayId)
    if (!option(input.dayId) && input.dayId !== snapshot.dayId) {
      invalid('day-id-conflict', 'dayId 与快照不一致', { dayId: input.dayId, snapshot: snapshot.dayId })
    }
    if (!option(input.dailyLossBefore) && Number(input.dailyLossBefore) !== Number(snapshot.dailyLoss)) {
      invalid('daily-loss-conflict', 'dailyLossBefore 与快照不一致', { dailyLossBefore: input.dailyLossBefore, snapshot: snapshot.dailyLoss })
    }
  }
  const dayId = snapshot ? snapshot.dayId : (option(input.dayId) ? null : assertDayId(input.dayId))
  const dailyLossBefore = snapshot
    ? integer(snapshot.dailyLoss, 'snapshot.dailyLoss', { min: 0 })
    : integer(input.dailyLossBefore ?? 0, 'dailyLossBefore', { min: 0 })
  const dayStartSan = snapshot ? snapshot.dayStartSan ?? null : (input.dayStartSan ?? null)

  const applied = Math.min(loss, sanBefore)
  const sanAfter = sanBefore - applied
  const dailyLossAfter = dailyLossBefore + applied
  const permanent = sanAfter === 0

  const effects = [{ type: 'apply-san-loss', amount: applied, sanAfter, dailyLossAfter }]
  const pending = []
  let intCheck = Object.freeze({ required: false, status: 'not-required' })
  let temporary = null

  if (permanent) {
    effects.push({ type: 'set-permanent-insanity', san: sanAfter })
    intCheck = Object.freeze({
      required: false,
      status: 'not-required',
      reason: 'permanent-insanity',
      evidence: EVIDENCE.permanentInsanity,
    })
  } else {
    const single = singleLossTrigger({ loss: applied })
    if (single.requiresIntCheck) {
      intCheck = Object.freeze({ ...intCheckState(input.intCheck ?? null), required: true })
      if (intCheck.status === 'pending') {
        pending.push('int-check')
        effects.push({ type: 'request-int-check', characteristic: 'INT', successOn: 'roll <= INT', threshold: SINGLE_LOSS_THRESHOLD })
      }
      temporary = temporaryInsanity({
        loss: applied,
        intCheck: input.intCheck ?? null,
        hoursDie: input.hoursDie ?? null,
        boutDie: input.boutDie ?? null,
        roundsDie: input.roundsDie ?? null,
        dayId,
      })
      if (temporary.status === 'active') {
        effects.push({ type: 'apply-temporary-insanity', hours: temporary.hours.value, bout: temporary.bout.id, rounds: temporary.rounds.value })
      } else if (temporary.status === 'pending-dice') {
        pending.push('insanity-dice')
        effects.push({ type: 'roll-insanity-dice', dice: ['1D10 hours', '1D10 bout', '1D10 rounds'] })
      }
    } else {
      intCheck = Object.freeze({ required: false, status: 'not-required', loss: applied, threshold: SINGLE_LOSS_THRESHOLD })
    }
  }

  const indefinite = dailyInsanity({
    dailyLoss: dailyLossAfter,
    basis: input.dailyBasis ?? 'day-start',
    dayStartSan,
    startingSan: input.startingSan ?? null,
    currentSan: input.currentSan ?? null,
    dayId,
  })

  if (permanent) {
    // Permanent insanity is terminal: report the threshold material for the
    // record, but do not queue a second, contradicting state transition.
    effects.push({
      type: 'observe-indefinite-threshold',
      terminal: 'permanent',
      threshold: indefinite.threshold,
      reached: indefinite.active,
    })
  } else if (indefinite.active) {
    effects.push({ type: 'apply-indefinite-insanity', threshold: indefinite.threshold, basis: indefinite.basis, dayId })
    if (!dayId) {
      pending.push('day-id')
      effects.push({ type: 'record-game-day', reason: 'day-id-missing' })
    }
  } else if (!indefinite.available) {
    effects.push({ type: 'record-day-start-snapshot', reason: indefinite.reason })
  }

  const state = insanityState({ temporary, indefinite, permanent })

  return Object.freeze({
    input: Object.freeze({
      loss,
      sanBefore,
      dailyLossBefore,
      dayStartSan,
      dayId,
    }),
    loss: Object.freeze({ rolled: loss, applied, clamped: applied !== loss }),
    san: Object.freeze({ before: sanBefore, after: sanAfter }),
    dailyLoss: Object.freeze({ before: dailyLossBefore, after: dailyLossAfter, dayId }),
    permanentInsanity: permanent,
    intCheck,
    temporaryInsanity: temporary,
    indefiniteInsanity: indefinite,
    state,
    effects: Object.freeze(effects.map((effect) => Object.freeze(effect))),
    pending: Object.freeze(pending),
    rolledDice: false,
    wroteActor: false,
  })
}

// --- Luck spending ---
const PURPOSE_ALIASES = Object.freeze({
  SK: 'skill-roll',
  skill: 'skill-roll',
  'skill-roll': 'skill-roll',
  CH: 'characteristic-roll',
  characteristic: 'characteristic-roll',
  stat: 'characteristic-roll',
  'characteristic-roll': 'characteristic-roll',
  SN: 'sanity-roll',
  sanity: 'sanity-roll',
  'sanity-roll': 'sanity-roll',
  san: 'sanity-roll',
  'sanity-loss': 'sanity-loss-roll',
  'san-loss': 'sanity-loss-roll',
  'sanity-loss-roll': 'sanity-loss-roll',
  LK: 'luck-roll',
  luck: 'luck-roll',
  'luck-roll': 'luck-roll',
  DM: 'damage-roll',
  IM: 'damage-roll',
  AR: 'damage-roll',
  damage: 'damage-roll',
  'damage-roll': 'damage-roll',
  CM: 'weapon-malfunction',
  malfunction: 'weapon-malfunction',
  'weapon-malfunction': 'weapon-malfunction',
  XP: 'growth-check',
  growth: 'growth-check',
  'growth-check': 'growth-check',
})

const SPEND_DENY = Object.freeze({
  'sanity-roll': Object.freeze({ code: 'sanity-roll', reason: '幸运不能调整理智检定本身' }),
  'sanity-loss-roll': Object.freeze({ code: 'sanity-loss-roll', reason: '幸运不能调整决定理智损失量的骰' }),
  'luck-roll': Object.freeze({ code: 'luck-roll', reason: '幸运不能调整幸运检定' }),
  'damage-roll': Object.freeze({ code: 'damage-roll', reason: '幸运不能调整伤害骰' }),
  'weapon-malfunction': Object.freeze({ code: 'weapon-malfunction', reason: '幸运不能调整武器故障' }),
  'growth-check': Object.freeze({ code: 'growth-check', reason: '幸运不能调整成长检定' }),
})

const normalizePurpose = ({ purpose, rollType }) => {
  const raw = purpose ?? rollType
  if (option(raw)) { return null }
  return PURPOSE_ALIASES[String(raw)] ?? null
}

export function canSpendLuck({ purpose, rollType, naturalRoll = null, band = null, pushed = false, luckValue = null, amount = null } = {}) {
  if (PULP_ONLY_LUCK_SPENDS.includes(String(purpose))) {
    return Object.freeze({ allowed: false, code: 'pulp-only', reason: '该用法属 Pulp 规则，标准 CoC 未启用', purpose: String(purpose) })
  }
  const normalized = normalizePurpose({ purpose, rollType })
  if (!normalized) {
    return Object.freeze({ allowed: false, code: 'unknown-purpose', reason: '未知的掷骰用途', purpose: null })
  }
  const denied = SPEND_DENY[normalized]
  if (denied) {
    return Object.freeze({ allowed: false, code: denied.code, reason: denied.reason, purpose: normalized, evidence: EVIDENCE.luckSpendDenied })
  }
  if (pushed === true) {
    return Object.freeze({ allowed: false, code: 'pushed-roll', reason: '幸运不能改变 pushed 掷骰的结果', purpose: normalized, evidence: EVIDENCE.luckSpendDenied })
  }
  if (!option(naturalRoll)) {
    const roll = integer(naturalRoll, 'naturalRoll', { min: 1, max: 100 })
    if (roll === 100 || band === 'fumble') {
      return Object.freeze({ allowed: false, code: 'natural-fumble', reason: '自然大失败不能被幸运调整', purpose: normalized, evidence: EVIDENCE.luckSpendDenied })
    }
    if (roll === 1) {
      return Object.freeze({ allowed: false, code: 'already-critical', reason: '自然 01 已是最高结果，无需也不能再花幸运', purpose: normalized, evidence: EVIDENCE.luckNaturalCritical })
    }
  } else if (band === 'fumble') {
    return Object.freeze({ allowed: false, code: 'natural-fumble', reason: '自然大失败不能被幸运调整', purpose: normalized, evidence: EVIDENCE.luckSpendDenied })
  }

  if (!option(amount)) {
    if (typeof amount !== 'number' || !Number.isInteger(amount)) {
      invalid('not-integer', 'amount 必须是整数', { amount })
    }
    if (amount < 1) {
      return Object.freeze({ allowed: false, code: 'invalid-amount', reason: '花费点数必须为正整数', purpose: normalized, amount })
    }
    if (!option(luckValue) && amount > luckValue) {
      return Object.freeze({ allowed: false, code: 'insufficient-luck', reason: '幸运余额不足', purpose: normalized, amount, luckValue, evidence: EVIDENCE.luckSpendAllowed })
    }
    if (!option(naturalRoll) && amount > naturalRoll - 1) {
      return Object.freeze({ allowed: false, code: 'below-minimum', reason: '调整后骰值不能低于 01', purpose: normalized, amount, naturalRoll })
    }
  }

  return Object.freeze({
    allowed: true,
    code: 'allowed',
    reason: '只能用于技能/特征检定，1:1 调值',
    purpose: normalized,
    evidence: EVIDENCE.luckSpendAllowed,
  })
}

// The same bands as module/rules/coc.mjs; duplicated here so this file stays
// import-free. Integration must re-judge with the live
// Rules.active().check.successBand using the returned roll values.
export function cocBand({ rollVal, targetScore } = {}) {
  const roll = integer(rollVal, 'rollVal', { min: 1, max: 100 })
  const target = integer(targetScore, 'targetScore', { min: 0, max: 100 })
  if (roll === 1) { return Object.freeze({ level: 4, band: 'critical' }) }
  if (roll <= Math.floor(target / 5)) { return Object.freeze({ level: 3, band: 'extreme' }) }
  if (roll <= Math.floor(target / 2)) { return Object.freeze({ level: 2, band: 'hard' }) }
  if (roll <= target) { return Object.freeze({ level: 2, band: 'regular' }) }
  if (roll === 100 || (target < 50 && roll >= 96)) { return Object.freeze({ level: 0, band: 'fumble' }) }
  return Object.freeze({ level: 1, band: 'fail' })
}

export function applyLuckSpend({ purpose, rollType, naturalRoll, targetScore, amount, luckValue, pushed = false, band = null } = {}) {
  const roll = integer(naturalRoll, 'naturalRoll', { min: 1, max: 100 })
  const target = integer(targetScore, 'targetScore', { min: 0, max: 100 })
  const luckBefore = integer(luckValue, 'luckValue', { min: 0 })

  const decision = canSpendLuck({ purpose, rollType, naturalRoll: roll, band, pushed, luckValue: luckBefore, amount })
  const originalBand = cocBand({ rollVal: roll, targetScore: target })
  if (!decision.allowed) {
    return Object.freeze({
      allowed: false,
      code: decision.code,
      reason: decision.reason,
      spent: 0,
      luck: Object.freeze({ before: luckBefore, after: luckBefore }),
      roll: Object.freeze({ natural: roll, adjusted: roll, amount: 0 }),
      band: Object.freeze({ original: originalBand, adjusted: originalBand, criticalSource: roll === 1 ? 'natural' : null }),
      rejudge: Object.freeze({ naturalRoll: roll, amount: 0, adjustedRoll: roll, targetScore: target }),
    })
  }

  const spent = integer(amount, 'amount', { min: 1 })
  const adjusted = roll - spent
  const adjustedRaw = cocBand({ rollVal: adjusted, targetScore: target })
  // Reaching 01 by spending Luck is an Extreme success, never a critical.
  const adjustedBand = adjusted === 1 && roll !== 1
    ? Object.freeze({ level: 3, band: 'extreme', downgradedFromCritical: true })
    : Object.freeze({ ...adjustedRaw, downgradedFromCritical: false })

  return Object.freeze({
    allowed: true,
    code: 'allowed',
    reason: decision.reason,
    spent,
    luck: Object.freeze({ before: luckBefore, after: luckBefore - spent }),
    roll: Object.freeze({ natural: roll, adjusted, amount: spent }),
    band: Object.freeze({
      original: originalBand,
      adjusted: adjustedBand,
      criticalSource: roll === 1 ? 'natural' : null,
      adjustedToCritical: false,
    }),
    rejudge: Object.freeze({ naturalRoll: roll, amount: spent, adjustedRoll: adjusted, targetScore: target }),
    evidence: EVIDENCE.luckNaturalCritical,
  })
}

// --- Luck recovery (secondary evidence; cap 99, starting value is not a cap) ---
export const LUCK_CAP = 99

export function luckRecovery({ roll, currentLuck, d10: dice = null } = {}) {
  const dieRoll = integer(roll, 'roll', { min: 1, max: 100 })
  const before = integer(currentLuck, 'currentLuck', { min: 0, max: LUCK_CAP })
  const success = dieRoll > before
  const needed = success ? 2 : 1
  // Validate every supplied die first so a bad value reports as such, then
  // require the exact count for the branch. Extra dice are never summed in.
  const supplied = option(dice) ? [] : dice
  if (!Array.isArray(supplied)) {
    invalid('dice-missing', 'd10 必须是 D10 值数组', { dice })
  }
  supplied.forEach((value, index) => d10(value, `d10[${index}]`))
  if (supplied.length < needed) {
    invalid('dice-missing', `需要注入 ${needed} 个 D10 值`, { needed, dice })
  }
  const values = supplied.slice(0, needed)
  const flat = success ? 10 : 5
  const delta = values.reduce((sum, value) => sum + value, 0) + flat
  const uncapped = before + delta
  const after = Math.min(LUCK_CAP, uncapped)
  return Object.freeze({
    roll: dieRoll,
    currentLuck: before,
    success,
    rule: Object.freeze({ die: '1D100', successOn: 'roll > current luck' }),
    formula: success ? '2D10+10' : '1D10+5',
    dice: Object.freeze(values),
    flat,
    delta,
    luck: Object.freeze({ before, after, cap: LUCK_CAP, capped: uncapped > LUCK_CAP, overflow: Math.max(0, uncapped - LUCK_CAP) }),
    initialValueIsCap: false,
    evidence: EVIDENCE.luckRecovery,
  })
}

// --- growth: tick condition and end-of-scenario settlement ---
const BAND_LEVELS = Object.freeze({ fumble: 0, fail: 1, regular: 2, hard: 2, extreme: 3, critical: 4 })

export function canTickGrowth({ rollType = 'skill-roll', band = null, resultLevel = null, luckSpent = 0, noXP = false, actorType = 'character' } = {}) {
  const normalized = normalizePurpose({ purpose: rollType })
  const spent = integer(luckSpent, 'luckSpent', { min: 0 })
  const level = option(resultLevel) ? (option(band) ? null : BAND_LEVELS[band] ?? null) : integer(resultLevel, 'resultLevel', { min: 0, max: 4 })
  const deny = (code, reason) => Object.freeze({ allowed: false, code, reason, purpose: normalized, luckSpent: spent, noXP, actorType })

  if (actorType !== 'character') { return deny('npc', 'NPC 不记录成长勾选') }
  if (normalized !== 'skill-roll') { return deny('not-a-skill-roll', '只有技能检定成功才勾选成长') }
  if (spent > 0) { return deny('luck-spent', '花幸运取得的成功不勾选成长') }
  if (noXP === true) { return deny('no-xp', '该技能标记 noXP（如神话），不勾选成长') }
  if (level === null) { return deny('result-missing', '缺少检定结果等级') }
  if (level < 2) { return deny('not-success', '只有成功（regular 及以上）才勾选成长') }
  return Object.freeze({ allowed: true, code: 'allowed', reason: '成功且未花幸运', purpose: normalized, luckSpent: spent, noXP, actorType, evidence: EVIDENCE.growthNoLuckTick })
}

export function growthSettlement({ roll, currentValue, gainDie } = {}) {
  const dieRoll = integer(roll, 'roll', { min: 1, max: 100 })
  const current = integer(currentValue, 'currentValue', { min: 0 })
  const gain = d10(gainDie, 'gainDie')
  const improved = dieRoll > current
  const gained = improved ? gain : 0
  return Object.freeze({
    roll: dieRoll,
    currentValue: current,
    improved,
    rule: 'roll > current value',
    gainDie: Object.freeze({ die: '1D10', value: gain }),
    gained,
    after: current + gained,
    bonus: 0,
    // CoC skills may exceed 100; no cap or fixed tier is invented here.
    capped: false,
    evidence: EVIDENCE.growthSettlement,
  })
}

export const CoCSanity = Object.freeze({
  SINGLE_LOSS_THRESHOLD,
  TEMPORARY_INSANITY_HOURS,
  BOUT_ROUNDS,
  LUCK_CAP,
  EVIDENCE,
  PULP_ONLY_LUCK_SPENDS,
  boutTable,
  resolveBout,
  singleLossTrigger,
  intCheckState,
  temporaryInsanity,
  endTemporaryInsanity,
  dailyThreshold,
  dailyInsanity,
  beginGameDay,
  advanceGameDay,
  rollGameDay,
  insanityState,
  settleSanLoss,
  canSpendLuck,
  applyLuckSpend,
  cocBand,
  luckRecovery,
  canTickGrowth,
  growthSettlement,
})
