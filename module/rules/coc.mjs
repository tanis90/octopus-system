// Call of Cthulhu 7e rules adapter (M1 core + M3 combat/wounds).
// Facts are numeric/formula facts from official public sources; prose and code
// are written here. No GPL system source, template or text block is used.
//
// The M3 rule blocks live in sibling pure modules and are re-exported here so
// callers keep a single `Rules.active()` entry point:
//   ./coc-dice.mjs    bonus/penalty tens dice, d100 reading, formula maxima
//   ./coc-combat.mjs  weapon profile, damage tiers, opposed combat, modifiers
//   ./coc-wounds.mjs  HP/major wound/dying/first aid/medicine/weekly healing
import { CoCDice, d100Formula, resolveD100, maxOfFormula } from './coc-dice.mjs'
import { CoCCombatRules, bandRank, compareOpposed, resolveCloseCombat, halfDamageBonus } from './coc-combat.mjs'
import { CoCWoundRules } from './coc-wounds.mjs'
import { CoCSanity, SINGLE_LOSS_THRESHOLD } from './coc-sanity.mjs'

const num = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const half = (value) => Math.floor(num(value) / 2)
const fifth = (value) => Math.floor(num(value) / 5)

// Luck spend eligibility for the standard game. Official free rules allow Luck
// on skill and characteristic rolls only; it may not adjust a Sanity roll, the
// dice that decide how much Sanity is lost, a Luck roll, damage, weapon
// malfunction, a pushed roll or a natural fumble. One decision function is used
// by both the card snapshot and the settlement path so a UI can never offer a
// spend the rules refuse.
const cocLuckCanSpend = (config = {}) => {
  const { cardType = 'NO', rollType = null, purpose = null, rollVal = null, naturalRoll = null, band = null, pushed = false } = config
  if (cardType === 'RE' || cardType === 'PP') {
    return Object.freeze({ allowed: false, code: 'resistance-card', reason: '幸运不能用于对抗/抵抗骰' })
  }
  const natural = naturalRoll ?? rollVal
  return CoCSanity.canSpendLuck({
    purpose: purpose ?? rollType,
    rollType,
    naturalRoll: natural === null || natural === undefined ? null : num(natural),
    band,
    pushed: pushed === true,
  })
}

// Official autocalc sheet table, extended by the same 80-point ladder.
const buildAndDamageBonus = (strSiz) => {
  const total = num(strSiz)
  if (total <= 0) { return { build: 0, damageBonus: '+0' } }
  if (total <= 64) { return { build: -2, damageBonus: '-2' } }
  if (total <= 84) { return { build: -1, damageBonus: '-1' } }
  if (total <= 124) { return { build: 0, damageBonus: '+0' } }
  if (total <= 164) { return { build: 1, damageBonus: '+1D4' } }
  if (total <= 204) { return { build: 2, damageBonus: '+1D6' } }
  const build = Math.floor((total - 205) / 80) + 3
  return { build, damageBonus: `+${build - 1}D6` }
}

// Official autocalc sheet: 7 when DEX and STR are both below SIZ, 9 when both
// are equal or above, otherwise 8; age 40+ subtracts one per age decade.
const moveRate = (dex, str, siz, age) => {
  const d = num(dex)
  const s = num(str)
  const z = num(siz)
  const years = num(age)
  const base = (d < z && s < z) ? 7 : (d >= z && s >= z) ? 9 : 8
  const ageMod = years >= 40 ? Math.floor((years - 40) / 10) + 1 : 0
  return base - ageMod
}

// The sheet's DB slots: `full` is the listed damage bonus, `half` is the
// halved die used by thrown weapons and bows, `dbl` stays the full bonus (CoC
// has no doubling rule; BRP's `dbl` slot is never read for CoC weapons).
const damageBonusShape = (damageBonus) => ({
  full: damageBonus,
  half: halfDamageBonus(damageBonus),
  dbl: damageBonus,
})

export const CoCRules = {
  id: 'coc',
  label: 'Call of Cthulhu 7e',

  settings: {
    // EDU is a core CoC characteristic and SAN is part of the core sheet.
    useEDU() { return true },
    useSAN() { return true },
  },

  characteristics: {
    // CoC APP is the native `cha` slot; never persist a second `app` field.
    key(name) {
      return name === 'app' ? 'cha' : name
    },
  },

  // CoC percentages round down (half DEX, EDU, etc). The base formula still
  // lives on the item; this only changes the arithmetic.
  skillBase({ item, stats, useEDU }) {
    if (!item?.system?.variable) { return item?.system?.base ?? 0 }
    const term = (index) => {
      const formula = item.system.baseFormula?.[index] ?? {}
      const statKey = formula.stat
      if (!statKey || statKey === 'fixed') { return 0 }
      if (statKey === 'edu' && !useEDU) { return 0 }
      const stat = stats?.[statKey]
      if (!stat) { return 0 }
      const total = num(stat.base) + num(stat.redist) + num(stat.culture)
      return Math.floor(total * num(formula.value))
    }
    const first = term(1)
    const second = term(2)
    return item.system.baseFormula?.Func === 'and' ? first + second : Math.max(first, second)
  },

  deriveSecondary({ actorData, systemData }) {
    const stats = systemData?.stats ?? {}
    const con = num(stats.con?.total)
    const siz = num(stats.siz?.total)
    const pow = num(stats.pow?.total)
    const str = num(stats.str?.total)
    const dex = num(stats.dex?.total)
    const { build, damageBonus } = buildAndDamageBonus(str + siz)
    return {
      healthMax: Math.max(Math.floor((con + siz) / 10), 0),
      powerMax: Math.max(fifth(pow), 0),
      build,
      mov: moveRate(dex, str, siz, actorData?.system?.age),
      dmgBonus: damageBonusShape(damageBonus),
      dmgSpecBonus: damageBonusShape(damageBonus),
    }
  },

  sanity: {
    prepare({ pow, starting, mythosPercent }) {
      const resolvedStarting = Number.isFinite(Number(starting))
        ? Number(starting)
        : Math.max(num(pow), 0)
      const mythos = Math.max(num(mythosPercent), 0)
      const max = Math.max(99 - mythos, 0)
      return {
        starting: resolvedStarting,
        // Sheet display only (one fifth of starting SAN). The rules that decide
        // insanity are the single-loss and per-game-day thresholds below; `tis`
        // is never used as a CoC trigger.
        tis: Math.floor(resolvedStarting / 5),
        mythosPercent: mythos,
        max,
      }
    },

    initial({ pow, mythosPercent }) {
      const starting = Math.max(num(pow), 0)
      const mythos = Math.max(num(mythosPercent), 0)
      const max = Math.max(99 - mythos, 0)
      return {
        starting,
        tis: Math.floor(starting / 5),
        max,
        value: Math.min(starting, max),
      }
    },

    // M4: the CoC decision core (pure, no dice, no writes). Settlement lives in
    // module/apps/sanity.mjs and only applies what these functions decide.
    core: CoCSanity,
    settleInCard: true,
    singleLossThreshold: SINGLE_LOSS_THRESHOLD,
    // Threshold basis is explicit: `day-start` is the SAN snapshot taken at the
    // start of the current game day (secondary evidence; see provenance).
    dailyBasis: 'day-start',
    // A temporary episode never implies indefinite, and permanent is terminal.
    coexistingStates: true,
  },

  luck: {
    // Luck is an independent 3D6 x 5 roll, not POW x 5.
    initial() {
      return { formula: '3D6*5' }
    },

    // The starting value is not a ceiling: official free rules allow Luck to
    // rise to 99 through session-start recovery.
    cap() {
      return CoCSanity.LUCK_CAP
    },

    canSpend(config) {
      return cocLuckCanSpend(config)
    },

    cardEligible({ rollType, cardType, rollVal, band, pushed = false } = {}) {
      if (cardType === 'RE' || cardType === 'PP') { return false }
      const decision = cocLuckCanSpend({ purpose: rollType, rollType, naturalRoll: rollVal, band, pushed })
      return decision.allowed === true
    },

    apply(config) {
      return CoCSanity.applyLuckSpend(config)
    },

    recovery(config) {
      return CoCSanity.luckRecovery(config)
    },

    // The Keeper opens a new session: a real roll against the current Luck.
    recoveryAction: 'new-session',
    recoveryNeedsRealRoll: true,
    resettlesSanLoss: false,
  },

  check: {
    // CoC 7e bands: 01 critical; <= 1/5 extreme; <= 1/2 hard; <= skill
    // regular; 96-100 fumble when the skill is below 50, otherwise only 100.
    successBand({ rollVal, targetScore }) {
      const roll = num(rollVal)
      const target = Math.max(num(targetScore), 0)
      const fumble = roll === 100 || (target < 50 && roll >= 96)
      if (roll === 1) { return { level: 4, band: 'critical' } }
      // 100 is always a fumble, even against a skill of 100; 96-100 is a fumble
      // while the skill is below 50.
      if (fumble) { return { level: 0, band: 'fumble' } }
      if (roll <= fifth(target)) { return { level: 3, band: 'extreme' } }
      if (roll <= half(target)) { return { level: 2, band: 'hard' } }
      if (roll <= target) { return { level: 2, band: 'regular' } }
      return { level: 1, band: 'fail' }
    },

    successLevel(config) {
      return CoCRules.check.successBand(config).level
    },

    // A characteristic test is rolled against the characteristic value itself
    // (STR 60 with a Hard requirement needs 30 or less), never against x5.
    characteristicTarget(total) {
      return Math.max(num(total), 0)
    },

    // Difficulty in CoC is the band the roll must reach, not a multiplier on
    // the target: applying both would count the thresholds twice.
    difficultyBands() {
      return Object.freeze({
        average: 'regular',
        regular: 'regular',
        hard: 'hard',
        difficult: 'hard',
        extreme: 'extreme',
      })
    },

    // Challenge rank a Keeper's difficulty demands. `flatMod` is applied to the
    // target unchanged; unknown values fall open to `regular`.
    requiredBand(diff) {
      return CoCRules.check.difficultyBands()[String(diff)] ?? 'regular'
    },

    // Band achieved is what a caller must compare; the numeric level keeps the
    // legacy 0-4 shape but hard and regular both map to 2, so opposed and
    // damage decisions must read `band`.
    bandRank,

    dice: CoCDice,
    d100Formula,
    resolveD100,

    // CoC is the only ruleset that rolls bonus/penalty tens dice; the runtime
    // builds one real Nd10 pool and reads the percentile value from its faces.
    supportsBonusDice: true,

    // CoC has no difficulty multipliers, so the BRP "skip easy/raised" XP rule
    // does not apply; the Mythos skill never gets a development tick.
    xpSkipsRaisedDifficulty: false,
    xpSkipsNoXP: true,

    // Raw d10 faces in roll order: first face is the units die, rest are tens.
    readRoll(results, { bonus = 0, penalty = 0 } = {}) {
      return resolveD100({ results, bonus, penalty })
    },
  },

  combat: CoCCombatRules,

  wounds: CoCWoundRules,

  // `maximize: true` is ignored by the compat dice layer, so extreme damage is
  // computed from a whitelisted formula instead of asking the roller.
  damageMax: maxOfFormula,

  growth: {
    // No INT/idea bonus in CoC skill improvement.
    bonus() { return 0 },
    check({ roll, targetScore }) {
      return num(roll) > num(targetScore)
    },
    formula() {
      return '1D10'
    },

    // CoC has no fixed improvement tier: settlement always rolls 1D10.
    allowFixedTier: false,
    allowPowImprovement: false,
    // Only a success earns a tick, and only when no Luck was spent on it.
    // `autoXP === '2'` (tick on failure) is a BRP option and never applies here.
    ticksOnFailure: false,
    tickOnLuckSuccess: false,

    canTick(config = {}) {
      return CoCSanity.canTickGrowth({ ...config, rollType: config.rollType ?? 'SK' })
    },

    settlement(config = {}) {
      return CoCSanity.growthSettlement(config)
    },
  },

  // Madness presentation tables. CoC rolls 1D10 for the bout, 1D10 for the
  // hours of temporary insanity and 1D10 rounds per bout.
  madness: {
    manifestationDie: '1D10',
    durationDie: '1D10',
    durationUnit: 'hours',
    boutRoundsDie: '1D10',
    boutTable: CoCSanity.boutTable(),
    // Bouts 9 and 10 seed a lasting phobia / mania.
    traitBouts: Object.freeze(['phobia', 'mania']),
    autoExpiry: false,
  },

  starter: {
    source: 'coc',
    // CoC has no BRP skill-category bonus items; core skills stand alone.
    categories: false,
    brawlBrpid: 'i.skill.coc.fighting-brawl',
    // CoC unarmed is a blunt attack (1D3 + full DB). The BRP `special: 'crush'`
    // field is never the rule source; the item carries this explicit marker.
    unarmed: {
      name: '徒手（斗殴）',
      damage: '1D3',
      dbMode: 'full',
      impaling: false,
      special: 'none',
    },
  },
}

// Direct named exports so callers can import a single rule block without
// walking the adapter object (the adapter still exposes the same references).
export {
  CoCDice,
  CoCCombatRules,
  CoCWoundRules,
  d100Formula,
  resolveD100,
  maxOfFormula,
  bandRank,
  compareOpposed,
  resolveCloseCombat,
}
