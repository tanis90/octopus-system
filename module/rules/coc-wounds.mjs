// Pure CoC 7e hit points, major wound, dying and healing rules.
// No Foundry, no Roll, no game.* - the runtime layer applies the result.
//
// Official facts used:
//   https://cthulhuwiki.chaosium.com/rules/hit-points-wounds-and-healing.html
//   - HP cannot drop below zero.
//   - Damage >= half full HP in one blow = major wound: CON roll or fall
//     unconscious. With a major wound at zero HP the character is dying: a CON
//     roll at the end of the following round and every round thereafter or die.
//     Only First Aid stabilizes.
//   - Damage >= maximum HP in one blow = instant death.
//   - At zero HP without a major wound the character is unconscious but does
//     not die.
//   - No major wound: +1 HP per day. Major wound: CON roll each week; success
//     +1D3, extreme +2D3. The major wound ends on an extreme success or when HP
//     reach half the maximum again.
//   - First Aid: +1 HP, rouses an unconscious character, extends a dying
//     character's life so Medicine can be used. Medicine: +1D3 (>= 1 hour and
//     equipment) and gives a dying character a healing roll at the end of a week.

const num = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const int = (value) => Math.floor(num(value))

// Success bands in rank order; `rank` wins when the caller already resolved it.
const BAND_ORDER = Object.freeze({ fumble: 0, fail: 1, regular: 2, hard: 3, extreme: 4, critical: 4 })

const rankOf = ({ band = 'fail', rank = 0 } = {}) => (Number.isFinite(Number(rank)) && Number(rank) > 0)
  ? Number(rank)
  : (BAND_ORDER[String(band)] ?? 0)

export const HP_FLOOR = 0

// Major wound threshold: damage in a single blow equal to or above half the
// full HP value, rounded up (HP 11 -> 6 damage is a major wound).
export function majorWoundThreshold(hpMax) {
  return Math.max(1, Math.ceil(num(hpMax) / 2))
}

export function isMajorWound({ damage = 0, hpMax = 0 } = {}) {
  if (num(hpMax) <= 0) { return false }
  return num(damage) >= majorWoundThreshold(hpMax)
}

export function isInstantDeath({ damage = 0, hpMax = 0 } = {}) {
  if (num(hpMax) <= 0) { return false }
  return num(damage) >= num(hpMax)
}

// Apply damage to a current HP value. Returns the clamped HP and the state
// transitions called for by this single blow.
export function applyDamage({ hpValue = 0, hpMax = 0, damage = 0, majorWound = false } = {}) {
  const amount = Math.max(0, int(damage))
  const max = Math.max(0, int(hpMax))
  const clamped = Math.max(0, int(hpValue))
  const before = max > 0 ? Math.min(clamped, max) : clamped
  const instantDeath = isInstantDeath({ damage: amount, hpMax: max })
  const major = isMajorWound({ damage: amount, hpMax: max })
  const after = Math.max(HP_FLOOR, before - amount)
  const wounded = majorWound || major
  // Zero HP without any major wound is unconsciousness only: death needs a
  // major wound (or a single blow of at least the full HP value).
  const isDying = !instantDeath && after <= 0 && wounded
  const unconscious = !instantDeath && after <= 0
  return {
    hpBefore: before,
    hpAfter: after,
    damage: amount,
    instantDeath,
    majorWound: major,
    anyMajorWound: wounded,
    dying: isDying,
    unconscious: instantDeath ? true : unconscious,
    // A major wound forces a CON roll; passing it keeps the character awake.
    conCheckRequired: major && !instantDeath,
    death: instantDeath,
  }
}

// State of a character between blows, from stored flags + current HP. CoC has
// four states: standing, unconscious, dying, dead. Being at 0 HP without a
// major wound is unconscious but not dying. An explicit `unconscious` flag
// (e.g. a failed major-wound CON roll at positive HP) is preserved.
export function woundState({ hpValue = 0, hpMax = 0, majorWound = false, dying = false, dead = false, unconscious = false } = {}) {
  const max = Math.max(0, int(hpMax))
  const value = Math.max(0, int(hpValue))
  if (dead) { return { dead: true, dying: false, unconscious: true, majorWound: !!majorWound, hpValue: value, hpMax: max } }
  const isDying = !!dying && value <= 0
  if (isDying) { return { dead: false, dying: true, unconscious: true, majorWound: !!majorWound, hpValue: value, hpMax: max } }
  return {
    dead: false,
    dying: false,
    unconscious: value <= 0 || !!unconscious,
    majorWound: !!majorWound,
    hpValue: value,
    hpMax: max,
  }
}

// CON roll at the end of each round for a dying character. Failing the roll
// kills; the caller owns the actual dice.
export function dyingRound({ conPassed } = {}) {
  return conPassed ? { dead: false, dying: true } : { dead: true, dying: true }
}

// Weekly healing roll for a major wound. Extreme success heals 2D3 and clears
// the major wound; a regular/hard success heals 1D3; failure heals nothing.
export function healingCheck({ band = 'fail', rank = 0 } = {}) {
  const resolved = rankOf({ band, rank })
  if (resolved >= 4) { return { formula: '2D3', clearsMajorWound: true, healed: true, band: 'extreme' } }
  if (resolved >= 2) { return { formula: '1D3', clearsMajorWound: false, healed: true, band: 'regular' } }
  return { formula: '', clearsMajorWound: false, healed: false, band: resolved === 0 ? 'fumble' : 'fail' }
}

// Individual healing actions. Each returns what the caller should apply.
export function firstAid({ band = 'fail', rank = 0, dying = false, unconscious = false } = {}) {
  const resolved = rankOf({ band, rank })
  if (resolved < 2) { return { healed: false, hp: 0, stabilizes: false, rouses: false, band } }
  return {
    healed: true,
    hp: 1,
    // First Aid on a dying character stops the per-round CON checks so that
    // Medicine can take over; it does not end the dying condition itself.
    stabilizes: !!dying,
    rouses: !!unconscious && !dying,
    band,
  }
}

export function medicine({ band = 'fail', rank = 0, dying = false } = {}) {
  const resolved = rankOf({ band, rank })
  if (resolved < 2) { return { healed: false, formula: '', grantsWeeklyHealing: false, band } }
  return {
    healed: true,
    formula: '1D3',
    // Medicine on a dying character allows a healing roll at the end of a week.
    grantsWeeklyHealing: !!dying,
    band,
  }
}

export function naturalHeal({ majorWound = false } = {}) {
  if (majorWound) { return { hp: 0, formula: '', requiresWeeklyCheck: true } }
  return { hp: 1, formula: '1', requiresWeeklyCheck: false }
}

// A major wound ends on an extreme healing success or once HP are back to half
// the maximum or more.
export function majorWoundCleared({ hpValue = 0, hpMax = 0, extremeSuccess = false } = {}) {
  if (extremeSuccess) { return true }
  if (num(hpMax) <= 0) { return false }
  return num(hpValue) >= majorWoundThreshold(hpMax)
}

// Clamp a healing amount so HP never exceeds the maximum.
export function applyHealing({ hpValue = 0, hpMax = 0, amount = 0 } = {}) {
  const max = Math.max(0, int(hpMax))
  const before = Math.max(0, int(hpValue))
  const healed = Math.max(0, int(amount))
  const after = Math.min(max, before + healed)
  return { hpBefore: before, hpAfter: after, applied: after - before }
}

export const CoCWoundRules = Object.freeze({
  majorWoundThreshold,
  isMajorWound,
  isInstantDeath,
  applyDamage,
  woundState,
  dyingRound,
  healingCheck,
  firstAid,
  medicine,
  naturalHeal,
  majorWoundCleared,
  applyHealing,
})
