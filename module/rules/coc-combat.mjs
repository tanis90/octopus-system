// Pure CoC 7e combat rules: weapon profiles, damage tiers, opposed combat and
// the situational modifiers that have an official public source.
// No Foundry, no Roll, no game.* - the runtime layer passes plain data in.
//
// Official facts used (numeric/semantic only; code written for this project):
//   https://cthulhuwiki.chaosium.com/rules/combat.html
//   https://cthulhuwiki.chaosium.com/equipment/weapons.html
//   https://cthulhuwiki.chaosium.com/rules/game-system.html
//   https://cthulhuwiki.chaosium.com/investigators/step-two-secondary-attributes.html
import { maxOfFormula, parseFormula, dicePool } from './coc-dice.mjs'

const num = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const int = (value) => Math.floor(num(value))

// Canonical form of a formula: signed dice and constants, zero terms dropped.
// Invalid formulas fail closed (parseFormula throws).
export function normalizeFormula(formula) {
  const terms = parseFormula(formula)
  let source = ''
  for (const term of terms) {
    const body = term.dice
      ? `${term.dice.count}D${term.dice.faces}`
      : String(term.value)
    const value = term.dice ? 1 : term.value
    if (!term.dice && value === 0) { continue }
    const sign = term.sign < 0 ? '-' : (source ? '+' : '')
    source += `${sign}${body}`
  }
  return source || '0'
}

// Sum of formulas: `1D3` + `+1D4` -> `1D3+1D4`; constants are folded.
export function combineFormulas(...formulas) {
  let dice = ''
  let constant = 0
  for (const formula of formulas) {
    for (const term of parseFormula(formula)) {
      if (term.dice) {
        const body = `${term.dice.count}D${term.dice.faces}`
        dice += `${term.sign < 0 ? '-' : (dice ? '+' : '')}${body}`
      } else {
        constant += term.sign * term.value
      }
    }
  }
  if (constant !== 0) {
    dice += `${constant < 0 ? '-' : (dice ? '+' : '')}${Math.abs(constant)}`
  }
  return dice || '0'
}

// Official DB table: half of a die roll halves the die. A single die halves
// its faces (1D6 -> 1D3, 1D4 -> 1D2); paired dice halve in count (2D6 -> 1D6);
// an odd leftover die keeps the halved face (3D6 -> 1D6+1D3). Constants round
// toward zero (the sheet's half column reads -1 -> 0, -2 -> -1). The printed
// sheet's half-DB column confirms the 1D4/1D6 steps; the higher steps are this
// project's derivation of the same rule.
export function halfDamageBonus(formula) {
  const terms = parseFormula(formula)
  const parts = []
  let constant = 0
  for (const term of terms) {
    if (!term.dice) { constant += term.sign * term.value; continue }
    const { count, faces } = term.dice
    const pairs = Math.floor(count / 2)
    if (pairs > 0) { parts.push({ sign: term.sign, count: pairs, faces }) }
    if (count % 2 === 1) {
      const halvedFace = Math.max(1, Math.floor(faces / 2))
      parts.push({ sign: term.sign, count: 1, faces: halvedFace === faces ? faces : halvedFace })
    }
  }
  constant = Math.trunc(constant / 2)
  let source = ''
  for (const part of parts) {
    source += `${part.sign < 0 ? '-' : (source ? '+' : '')}${part.count}D${part.faces}`
  }
  if (constant !== 0) { source += `${constant < 0 ? '-' : (source ? '+' : '')}${Math.abs(constant)}` }
  return source || '0'
}

// Damage bonus for a weapon's DB mode. CoC lists the mode per weapon
// (melee = full, thrown/bow = half, firearms = none); two-handed use does not
// change it - that is a BRP rule, not a CoC one.
export function damageBonusFor({ dbFull = '0', dbHalf = '0', mode = 'none' } = {}) {
  switch (String(mode)) {
    case 'full': return normalizeFormula(dbFull ?? '0')
    case 'half': return normalizeFormula(dbHalf ?? '0')
    case 'none': return '0'
    default: return '0'
  }
}

const DB_MODE_BY_FIELD = Object.freeze({
  full: 'full',
  oneh: 'full',
  str: 'full',
  dbl: 'full',
  half: 'half',
  none: 'none',
})

const KIND_DEFAULT_DB = Object.freeze({
  melee: 'full',
  missile: 'half',
  thrown: 'half',
  firearm: 'none',
})

const FIREARM_TYPES = new Set(['firearm', 'artillery', 'energy', 'explosive', 'heavy'])

const RANGED_KINDS = new Set(['firearm', 'artillery', 'energy', 'explosive', 'heavy', 'missile'])

// Weapon profile. An explicit `flags.brp.coc.weapon` marker wins; otherwise the
// profile is inferred from the native weapon fields. `special: 'crush'` is a
// BRP field and is never used as a CoC rule source - unarmed CoC weapons are
// identified by `flags.brp.unarmed` and are blunt with a full DB.
export function weaponProfile(weapon, options = {}) {
  const system = weapon?.system ?? {}
  const marker = weapon?.flags?.brp?.coc?.weapon ?? null
  const unarmed = options.unarmed ?? weapon?.flags?.brp?.unarmed === true
  const weaponType = String(system.weaponType ?? '')

  let kind = marker?.kind ?? null
  if (!kind) {
    if (unarmed) { kind = 'melee' } else if (FIREARM_TYPES.has(weaponType)) {
      kind = weaponType === 'firearm' ? 'firearm' : weaponType
    } else if (weaponType === 'missile') { kind = 'missile' } else { kind = 'melee' }
  }

  const dbField = String(system.db ?? '').toLowerCase()
  let dbMode = marker?.dbMode ?? null
  if (!dbMode) {
    dbMode = DB_MODE_BY_FIELD[dbField] ?? KIND_DEFAULT_DB[kind] ?? 'none'
  }

  let impaling = marker?.impaling
  if (impaling === undefined || impaling === null) {
    if (unarmed) { impaling = false } else {
      impaling = String(system.special ?? '') === 'impale' || String(system.special ?? '') === 'impknock'
    }
  }
  // Firearms never add the impaling damage die; the CoC weapon table marks
  // piercing melee/thrown weapons, not guns.
  if (FIREARM_TYPES.has(kind)) { impaling = false }

  const ranges = [system.dmg1, system.dmg2, system.dmg3]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    .map((value) => String(value))
  const rangeBands = [system.range1, system.range2, system.range3]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '' && String(value) !== 'S')
    .map((value) => String(value))

  return {
    kind,
    ranged: RANGED_KINDS.has(kind),
    dbMode,
    dbField: dbField || 'none',
    impaling: !!impaling,
    blast: kind === 'firearm' && ranges.length > 1,
    formula: ranges[0] ?? '0',
    ranges,
    rangeBands,
    mal: num(system.mal),
    shots: Math.max(0, int(system.att)),
    hands: String(system.hands ?? ''),
    marker: !!marker,
    unarmed: !!unarmed,
  }
}

// Extreme damage (official): blunt = maximum weapon damage + maximum damage
// bonus; impaling = maximum weapon damage + damage bonus + another weapon
// damage roll. Only the initiating attacker can deal it.
export function damageFormula({ weaponFormula, dbFormula, impaling = false, tier = 'regular' } = {}) {
  const weapon = normalizeFormula(weaponFormula ?? '0')
  const bonus = normalizeFormula(dbFormula ?? '0')
  if (tier !== 'extreme') { return combineFormulas(weapon, bonus) }
  if (!impaling) { return String(Math.max(0, maxOfFormula(weapon) + maxOfFormula(bonus))) }
  return combineFormulas(String(maxOfFormula(weapon)), bonus, weapon)
}

// Tier of damage for one attack. Fighting back never deals extreme damage.
export function damageTier({ rank = 0, role = 'attacker' } = {}) {
  if (num(rank) < 2) { return null }
  if (role === 'defender') { return 'regular' }
  return num(rank) >= 4 ? 'extreme' : 'regular'
}

// Fighting Maneuver: each point of Build deficit costs one penalty die, capped
// at two; a deficit of three or more makes maneuvers ineffective.
export function maneuverPenalty({ attackerBuild = 0, defenderBuild = 0 } = {}) {
  const deficit = int(defenderBuild) - int(attackerBuild)
  if (deficit <= 0) { return { penalty: 0, effective: true, deficit } }
  if (deficit >= 3) { return { penalty: 0, effective: false, deficit } }
  return { penalty: deficit, effective: true, deficit }
}

// Outnumbered: once the defender has fought back or dodged this round, every
// further melee attack against them gets one bonus die. Firearms ignore it.
export function outnumberedBonus({ defenderActedThisRound = false, ranged = false } = {}) {
  if (ranged) { return 0 }
  return defenderActedThisRound ? 1 : 0
}

// Readied firearms act at DEX +50 for initiative order.
export function initiativeBonus({ readiedFirearm = false } = {}) {
  return readiedFirearm ? 50 : 0
}

// Firing 2 or 3 shots in a round puts one penalty die on each shot. Burst and
// full-auto rates above three are not verified and add nothing here.
export function shotsPenalty({ shots = 1 } = {}) {
  const count = int(shots)
  return count === 2 || count === 3 ? 1 : 0
}

// Point blank is within one-fifth of DEX in feet: one bonus die.
export function pointBlankBonus({ distanceFeet = null, dex = 0 } = {}) {
  if (distanceFeet === null || distanceFeet === undefined) { return 0 }
  const range = Math.max(1, Math.floor(num(dex) / 5))
  return num(distanceFeet) <= range ? 1 : 0
}

// Diving for cover: a successful Dodge roll gives the attacker one penalty die
// and costs the diver their next attack.
export function diveForCover() {
  return { attackerPenalty: 1, forfeitsNextAttack: true }
}

// Defence options by attack kind. Firearms cannot be fought back; the only
// defence is diving for cover with Dodge. Point-blank Dodge against a firearm
// is a separate official exception and is not modelled here.
export function defenseOptions({ kind = 'melee', defenderHasDodge = true } = {}) {
  if (FIREARM_TYPES.has(String(kind))) {
    return defenderHasDodge ? ['cover'] : []
  }
  const options = []
  if (defenderHasDodge) { options.push('dodge') }
  options.push('fightback')
  return options
}

// Attack parameters handed to the native roll layer. The target is the live
// skill total: a characteristic test is the characteristic value itself.
export function attackTarget({ skillTotal = 0, diceMod = 0, requiredBand = 'regular' } = {}) {
  const pool = dicePool({ bonus: Math.max(diceMod, 0), penalty: Math.max(-diceMod, 0) })
  return {
    targetScore: Math.max(0, int(skillTotal)),
    requiredBand,
    minimumRank: BAND_RANK[requiredBand] ?? BAND_RANK.regular,
    bonus: pool.bonus,
    penalty: pool.penalty,
    net: pool.net,
  }
}

export const BAND_RANK = Object.freeze({ fumble: 0, fail: 1, regular: 2, hard: 3, extreme: 4, critical: 4 })

// Order of success bands. Critical is ranked with extreme (official pages never
// place critical in the opposed ladder; 01 still is the best roll).
export function bandRank(band) {
  return BAND_RANK[String(band)] ?? BAND_RANK.fail
}

const sideOf = (side) => ({
  rank: num(side?.rank, side?.band ? bandRank(side.band) : 0),
  band: side?.band ?? null,
  skill: num(side?.skill ?? side?.skillValue ?? side?.targetScore),
  rollVal: side?.rollVal === undefined ? null : num(side.rollVal),
})

// Opposed skill roll (official): higher success band wins; on a draw the higher
// skill value wins; if the skill values are equal the rules require both sides
// to roll again (lower roll wins) - this returns `reroll` instead of inventing
// a winner from the dice already on the table.
export function compareOpposed(attacker, defender) {
  const a = sideOf(attacker)
  const d = sideOf(defender)
  if (a.rank > d.rank) { return { winner: 'attacker', reroll: false, reason: 'band' } }
  if (d.rank > a.rank) { return { winner: 'defender', reroll: false, reason: 'band' } }
  if (a.skill > d.skill) { return { winner: 'attacker', reroll: false, reason: 'skill' } }
  if (d.skill > a.skill) { return { winner: 'defender', reroll: false, reason: 'skill' } }
  return { winner: null, reroll: true, reason: 'equal-skill' }
}

// Re-roll of a tied opposed check: the lower d100 wins. Equal rolls go to
// another re-roll rather than to a side of the table.
export function compareOpposedReroll(attacker, defender) {
  const a = sideOf(attacker)
  const d = sideOf(defender)
  if (a.rollVal === null || d.rollVal === null) {
    throw new Error('compareOpposedReroll needs both roll values')
  }
  if (a.rollVal < d.rollVal) { return { winner: 'attacker', reroll: false, reason: 'lower-roll' } }
  if (d.rollVal < a.rollVal) { return { winner: 'defender', reroll: false, reason: 'lower-roll' } }
  return { winner: null, reroll: true, reason: 'equal-roll' }
}

// Close combat. `choice` is what the defender declared:
//   'dodge'     - the attacker must achieve a strictly higher band; a tie goes
//                 to the defender
//   'fightback' - the defender must achieve a strictly higher band; a winning
//                 defender deals regular damage only, and a tie goes to the
//                 attacker
//   'cover'     - firearms only; a successful Dodge makes the attacker re-roll
//                 with one penalty die and costs the diver their next attack
export function resolveCloseCombat(attacker, defender, { choice = 'dodge', kind = 'melee' } = {}) {
  const a = sideOf(attacker)
  const d = sideOf(defender)
  const notes = []
  const ranged = FIREARM_TYPES.has(String(kind))

  if (ranged) {
    if (choice === 'fightback') {
      notes.push('firearm-no-fightback')
      return { winner: null, reroll: false, notes, reason: 'illegal-fightback', illegal: true }
    }
    if (choice === 'dodge') {
      // Dodging a bullet is not a legal defence; point-blank Dodge is an
      // official exception that this M3 does not model.
      notes.push('firearm-no-dodge', 'pending-point-blank-dodge')
      return { ...plainRangedOutcome(a, notes), illegal: true }
    }
    if (choice === 'cover') {
      if (d.rank < 2) {
        notes.push('cover-failed')
        return plainRangedOutcome(a, notes)
      }
      notes.push('cover-succeeded')
      return {
        winner: null, reroll: true, notes, reason: 'attacker-penalty-die',
        attackerPenaltyDice: 1, defenderForfeitsNextAttack: true,
      }
    }
    return plainRangedOutcome(a, notes)
  }

  if (choice === 'dodge') {
    if (a.rank > d.rank) { return { winner: 'attacker', reroll: false, notes, reason: 'attacker-higher' } }
    return { winner: 'defender', reroll: false, notes, reason: a.rank === d.rank ? 'dodge-tie' : 'dodged' }
  }

  if (choice === 'fightback') {
    // The defender must actually succeed and beat the attacker's band; a
    // failed fight back never deals damage even if the attacker fumbled.
    if (d.rank >= 2 && d.rank > a.rank) {
      return { winner: 'defender', reroll: false, notes, reason: 'defender-higher', damageTier: 'regular' }
    }
    if (a.rank >= 2) { return { winner: 'attacker', reroll: false, notes, reason: a.rank === d.rank ? 'fightback-tie' : 'attacker-higher' } }
    return { winner: null, reroll: false, notes, reason: 'both-failed' }
  }

  if (choice === 'cover') {
    notes.push('cover-not-allowed')
    return { winner: null, reroll: false, notes, reason: 'cover-not-allowed', illegal: true }
  }

  // No declared defence: a plain attack roll against the target.
  return { winner: a.rank >= 2 ? 'attacker' : null, reroll: false, notes, reason: 'unopposed' }
}

const plainRangedOutcome = (attacker, notes) => (attacker.rank >= 2
  ? { winner: 'attacker', reroll: false, notes, reason: 'hit' }
  : { winner: null, reroll: false, notes, reason: 'both-missed' })

// Common optional modifiers for one attack, kept explicit so callers can show
// what was applied. Unverified areas (burst/full auto, dual wield, aiming,
// cover values, range difficulty) are deliberately absent.
export function attackModifiers({
  bonus = 0, penalty = 0, ranged = false, shots = 1, pointBlank = 0,
  maneuverPenaltyDice = 0, outnumbered = 0, coverPenalty = 0,
} = {}) {
  const parts = []
  const push = (dice, reason) => { if (dice) { parts.push({ dice, reason }) } }
  push(maneuverPenaltyDice, 'maneuver-build')
  push(outnumbered, 'outnumbered')
  push(ranged ? shotsPenalty({ shots }) : 0, 'shots')
  push(ranged ? pointBlank : 0, 'point-blank')
  push(coverPenalty, 'dive-for-cover')
  for (const part of parts) {
    if (part.dice > 0) { bonus += part.dice } else { penalty += -part.dice }
  }
  const pool = dicePool({ bonus, penalty })
  return { ...pool, applied: parts }
}

// Skill identity helpers. Weapon rows store the skill brpid; identity is never
// matched by display name (localised, and specialisms can share a parent name).
export function skillRefFromBrpid(brpid) {
  const source = String(brpid ?? '')
  const match = /^i\.skill\.coc\.([a-z0-9-]+)$/.exec(source)
  if (!match) { return null }
  return { brpid: source, key: match[1] }
}

// Read a skill document's own CoC identity (parent/spec keys) when present.
export function skillRefFromDocument(item) {
  const brpid = item?.flags?.brp?.brpidFlag?.id ?? null
  const coc = item?.flags?.brp?.coc ?? null
  if (!brpid) { return null }
  return {
    brpid,
    key: coc?.key ?? skillRefFromBrpid(brpid)?.key ?? null,
    parentKey: coc?.parentKey ?? null,
    specKey: coc?.specKey ?? null,
  }
}

export const CoCCombatRules = Object.freeze({
  normalizeFormula,
  combineFormulas,
  halfDamageBonus,
  damageBonusFor,
  weaponProfile,
  damageFormula,
  damageTier,
  maneuverPenalty,
  outnumberedBonus,
  initiativeBonus,
  shotsPenalty,
  pointBlankBonus,
  diveForCover,
  defenseOptions,
  attackTarget,
  bandRank,
  BAND_RANK,
  compareOpposed,
  compareOpposedReroll,
  resolveCloseCombat,
  attackModifiers,
  skillRefFromBrpid,
  skillRefFromDocument,
})
