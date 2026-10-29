// Pure CoC 7e dice helpers: bonus/penalty tens dice and formula maxima.
// No Foundry, no Roll, no game.* - usable from the source tests and from the
// browser adapter alike.
//
// Official facts (only numeric/semantic facts are used here, code is written
// for this project):
//   - A bonus die adds an extra tens die and the better (lower) result is
//     used; a penalty die adds an extra tens die and the worse (higher)
//     result is used; one bonus and one penalty cancel out.
//   - 00 on the tens die with 0 on the units die reads as 100; 00 with any
//     other units die reads as that digit (00 + 3 = 3).
// https://cthulhuwiki.chaosium.com/rules/game-system.html

const num = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const int = (value) => Math.max(0, Math.floor(num(value)))

const DIE_RE = /^(\d*)[dD](\d+)/

// Net up bonus and penalty dice. One bonus cancels one penalty, so only one
// side can remain; the tens-dice count is 1 (plain d100) or 1 + net.
export function dicePool({ bonus = 0, penalty = 0 } = {}) {
  const bonusDice = int(bonus)
  const penaltyDice = int(penalty)
  const net = bonusDice - penaltyDice
  if (net > 0) {
    return { bonus: net, penalty: 0, net, extraTens: net, tensDice: 1 + net, choose: 'lowest' }
  }
  if (net < 0) {
    return { bonus: 0, penalty: -net, net, extraTens: -net, tensDice: 1 + (-net), choose: 'highest' }
  }
  return { bonus: 0, penalty: 0, net: 0, extraTens: 0, tensDice: 1, choose: 'lowest' }
}

// The roll formula for a check. Plain d100 keeps the historical 1D100 string;
// bonus/penalty pools roll one units die plus (1 + net) tens dice in one Roll
// (`3D10` for one bonus die). The units die is the first die of the roll.
export function d100Formula({ bonus = 0, penalty = 0 } = {}) {
  const pool = dicePool({ bonus, penalty })
  return pool.tensDice === 1 ? '1D100' : `${pool.tensDice + 1}D10`
}

// 00 + 0 = 100; 00 + n = n; otherwise tens*10 + units.
export function pairValue(tensDigit, unitsDigit) {
  const tens = Math.abs(Math.floor(num(tensDigit))) % 10
  const units = Math.abs(Math.floor(num(unitsDigit))) % 10
  if (tens === 0 && units === 0) { return 100 }
  if (tens === 0) { return units }
  return tens * 10 + units
}

// Read a percentile result out of the dice faces of one real Roll.
//
// `results` holds the d10 faces in roll order: the first face is the units die
// and the rest are tens dice. Raw d10 faces are 1..10, where 10 is the "0"
// face, so digits are read modulo 10. Explicit `units`/`tens` arrays win when
// supplied (tests and adapters can pass known faces).
export function resolveD100({ results, units, tens, bonus = 0, penalty = 0 } = {}) {
  const faces = Array.isArray(results) ? results.map((value) => Math.abs(Math.floor(num(value))) % 10) : null
  let unitsDigit
  let tensDigits
  if (Array.isArray(units) || Array.isArray(tens)) {
    unitsDigit = Math.abs(Math.floor(num(units))) % 10
    tensDigits = (tens ?? []).map((value) => Math.abs(Math.floor(num(value))) % 10)
  } else if (faces) {
    unitsDigit = faces[0] ?? 0
    tensDigits = faces.slice(1)
  } else {
    throw new Error('resolveD100 needs dice results or units/tens')
  }
  if (!tensDigits.length) { throw new Error('resolveD100 needs at least one tens die') }

  const pool = dicePool({ bonus, penalty })
  const candidates = tensDigits.map((tensDigit) => ({ tens: tensDigit, value: pairValue(tensDigit, unitsDigit) }))
  // Select by the resulting number, not by the raw tens digit: with a units 0
  // face a tens 00 reads as 100, so "lowest tens" would pick the worse result.
  let chosen = candidates[0]
  for (const candidate of candidates.slice(1)) {
    if (pool.choose === 'lowest' ? candidate.value < chosen.value : candidate.value > chosen.value) {
      chosen = candidate
    }
  }
  return {
    rollVal: chosen.value,
    chosenTens: chosen.tens,
    units: unitsDigit,
    tens: tensDigits,
    candidates,
    bonus: pool.bonus,
    penalty: pool.penalty,
    net: pool.net,
    choose: pool.choose,
    critical: chosen.value === 1,
  }
}

// Parse a whitelisted damage formula into signed terms. Only integer constants
// and NdM dice are accepted; anything else fails closed.
export function parseFormula(formula) {
  const source = String(formula ?? '').replace(/\s+/g, '')
  if (!source) { return [] }
  const terms = []
  let index = 0
  let sign = 1
  let expectTerm = true
  while (index < source.length) {
    const char = source[index]
    if (expectTerm) {
      if (char === '+') { sign = 1; index += 1; continue }
      if (char === '-') { sign = -1; index += 1; continue }
      const rest = source.slice(index)
      const die = DIE_RE.exec(rest)
      if (die) {
        const count = die[1] === '' ? 1 : Number(die[1])
        const faces = Number(die[2])
        if (!Number.isFinite(count) || !Number.isFinite(faces) || count < 0 || faces < 1) {
          throw new Error(`invalid damage formula: ${formula}`)
        }
        terms.push({ sign, dice: { count, faces } })
        index += die[0].length
        expectTerm = false
        continue
      }
      const digits = /^\d+/.exec(rest)
      if (digits) {
        terms.push({ sign, value: Number(digits[0]) })
        index += digits[0].length
        expectTerm = false
        continue
      }
      throw new Error(`invalid damage formula: ${formula}`)
    }
    if (char === '+' || char === '-') {
      sign = char === '-' ? -1 : 1
      index += 1
      expectTerm = true
      continue
    }
    throw new Error(`invalid damage formula: ${formula}`)
  }
  if (expectTerm && terms.length) { throw new Error(`invalid damage formula: ${formula}`) }
  return terms
}

// Maximum of a whitelisted formula (the value `maximize: true` would give).
// The compat Roll layer ignores `maximize`, so extreme damage cannot ask the
// dice roller for a maximum - it must be computed here.
export function maxOfFormula(formula) {
  const terms = parseFormula(formula)
  return terms.reduce((total, term) => {
    if (term.dice) { return total + term.sign * term.dice.count * term.dice.faces }
    return total + term.sign * term.value
  }, 0)
}

export const CoCDice = Object.freeze({
  dicePool,
  d100Formula,
  pairValue,
  resolveD100,
  parseFormula,
  maxOfFormula,
})
