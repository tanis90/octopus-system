// Default "octopus" ruleset: the existing BRP/UGE behaviour, unchanged.
// Every method here is a delegation seam. Keep the old arithmetic exact.

const num = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const BRPRules = {
  id: 'octopus',
  label: 'Octopus / BRP:UGE',

  settings: {
    useEDU() {
      return game.settings.get('brp', 'useEDU')
    },
    useSAN() {
      return game.settings.get('brp', 'useSAN')
    },
  },

  characteristics: {
    key(name) {
      return name
    },
  },

  // Base score for a skill document, before category bonuses. This mirrors the
  // original BRPactorItemDrop._calcBase arithmetic (ceil + max/or).
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
      return Math.ceil(total * num(formula.value))
    }
    const first = term(1)
    const second = term(2)
    return item.system.baseFormula?.Func === 'and' ? first + second : Math.max(first, second)
  },

  // Secondary attributes. The default implementation leaves the native
  // BRP values in place; only CoC overrides them.
  deriveSecondary() {
    return {}
  },

  sanity: {
    // No decision core: octopus keeps the historical inline settlement in
    // module/apps/check.mjs (_applySanLoss + dailyLoss >= tis), untouched.
    core: null,
    settleInCard: true,
    singleLossThreshold: null,
    dailyBasis: null,
    coexistingStates: false,

    prepare({ pow, starting, tis, lorePercent, mythosPercent, settings }) {
      const resolvedStarting = Number.isFinite(Number(starting))
        ? Number(starting)
        : Math.max(num(pow) * 5, 0)
      const resolvedTis = Number.isFinite(Number(tis))
        ? Number(tis)
        : (settings?.sanityTisPow ? num(pow) : Math.floor(resolvedStarting / 2))
      const cap = lorePercent != null ? 100 - num(lorePercent) : resolvedStarting
      return {
        starting: resolvedStarting,
        tis: resolvedTis,
        loreSkillPercent: lorePercent,
        max: Math.max(Math.min(resolvedStarting, cap), 0),
      }
    },

    initial({ pow, lorePercent, settings }) {
      const starting = Math.max(num(pow) * 5, 0)
      const tis = settings?.sanityTisPow ? num(pow) : Math.floor(starting / 2)
      const cap = lorePercent != null ? 100 - num(lorePercent) : starting
      const max = Math.max(Math.min(starting, cap), 0)
      return { starting, tis, max, value: max }
    },
  },

  luck: {
    initial({ pow }) {
      const max = Math.max(num(pow) * 5, 0)
      return { max, value: max }
    },

    // BRP keeps the unrestricted spend and the POW x 5 ceiling.
    cap({ pow } = {}) {
      return Math.max(num(pow) * 5, 0)
    },
    canSpend() {
      return Object.freeze({ allowed: true, code: 'allowed', reason: '' })
    },
    cardEligible() {
      return true
    },
    apply: null,
    recovery: null,
    recoveryAction: null,
    recoveryNeedsRealRoll: false,
    resettlesSanLoss: true,
  },

  check: {
    // Characteristic tests in BRP:UGE are rolled against the characteristic x5.
    characteristicTarget(total) {
      return Math.max(num(total) * 5, 0)
    },

    // CoC's difficulty is a required band; BRP keeps the multiplicative
    // difficulty table, so this returns null and the caller uses the old path.
    requiredBand() {
      return null
    },

    // Bonus/penalty tens dice are a CoC rule; BRP rolls the plain d100.
    supportsBonusDice: false,

    // BRP auto-XP skips easy/raised-difficulty rolls and ticks any item that
    // was rolled (including a noXP one). Keep both behaviours for octopus.
    xpSkipsRaisedDifficulty: true,
    xpSkipsNoXP: false,

    successLevel(config) {
      const targetScore = num(config?.targetScore)
      const rollVal = num(config?.rollVal)
      const critChance = Math.ceil(0.05 * targetScore)
      const fumbleChance = Math.min(95 + critChance, 100)
      const specialChance = Math.round(0.2 * targetScore)
      let successChance = Math.min(targetScore, 95)
      if (config?.cardType === 'RE' || config?.cardType === 'PP') {
        successChance = targetScore
      }
      if (rollVal <= critChance) { return 4 }
      if (rollVal <= specialChance) { return 3 }
      if (rollVal <= successChance) { return 2 }
      if (rollVal >= fumbleChance) { return 0 }
      return 1
    },

    successBand(config) {
      const level = BRPRules.check.successLevel(config)
      return {
        level,
        band: ['fumble', 'fail', 'success', 'special', 'critical'][level],
      }
    },
  },

  growth: {
    bonus(actor) {
      return num(actor?.system?.xpBonus)
    },
    check({ roll, targetScore, bonus = 0 }) {
      return num(roll) + num(bonus) > Math.min(num(targetScore), 100)
    },
    formula(settings) {
      return settings?.xpFormula ?? '1D6'
    },

    // octopus keeps the BRP development face: fixed tier, POW improvement and
    // the autoXP "tick on failure" option.
    allowFixedTier: true,
    allowPowImprovement: true,
    ticksOnFailure: true,
    tickOnLuckSuccess: true,
    canTick: null,
    settlement: null,
  },

  // BRP madness tables stay exactly where they were (d6 manifestations,
  // d8 duration tiers) - they now live on the ruleset so callers stop
  // hard-coding them, but the values are the historical ones.
  madness: {
    manifestationDie: '1D6',
    durationDie: '1D8',
    durationUnit: 'tier',
    boutRoundsDie: null,
    boutTable: null,
    traitBouts: Object.freeze(['phobia', 'mania']),
    autoExpiry: true,
  },

  starter: {
    source: 'octopus',
    categories: true,
    brawlBrpid: 'i.skill.brawl',
  },
}
