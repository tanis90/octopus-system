// The single source of truth for "which live skill does this weapon attack
// with, and at what score". CoC7 weapons store the skill Item in
// `system.skill.main` (id and/or name); that is the only resolution channel.
// The native sheet, the CM pipeline and the public BRPCheck entry point share
// this resolver, so their answers cannot fork.
//
// Pure data in, live Item out: no Foundry globals, no writes, no cached score.

const text = (value) => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

const itemIdOf = (item) => item?.id || item?._id || null

const toItems = (source) => {
  if (!source) return []
  if (Array.isArray(source)) return source
  if (Array.isArray(source.contents)) return source.contents
  if (typeof source.values === 'function') return Array.from(source.values())
  if (typeof source[Symbol.iterator] === 'function') return Array.from(source)
  if (typeof source === 'object') return Object.values(source)
  return []
}

const skillNameOf = (item) => text(item?.system?.skillName) || text(item?.name)

const weaponMarker = (weapon) => (weapon?.flags?.brp?.coc?.weapon
  && typeof weapon.flags.brp.coc.weapon === 'object'
  ? weapon.flags.brp.coc.weapon
  : null)

const specKeyOf = (item) => {
  const cocSpec = text(item?.flags?.brp?.coc?.specKey)
  if (cocSpec) return cocSpec
  return text(item?.system?.specialization)
}

const skillMatches = (item, reference, marker) => {
  if (!item || item.type !== 'skill') return false
  if (reference.kind === 'native-id') return itemIdOf(item) === reference.id
  if (reference.kind === 'native-name') {
    if (skillNameOf(item) !== reference.name) return false
    return !marker?.skillSpec || specKeyOf(item) === marker.skillSpec
  }
  return false
}

/**
 * Ordered references a CoC7 weapon carries: `skill.main.id` then
 * `skill.main.name`. The order is the resolution priority.
 * @param {object} weapon weapon Item (or plain data)
 * @returns {Array<object>} references
 */
export function weaponSkillReferences(weapon) {
  const system = weapon?.system ?? {}
  const reference = system.skill?.main ?? {}
  const refs = []
  const id = text(reference.id)
  const name = text(reference.name)
  if (id) refs.push({ kind: 'native-id', id, source: 'skill.main.id' })
  if (name) refs.push({ kind: 'native-name', name, source: 'skill.main.name' })
  return refs
}

/**
 * Resolve the live skill Item a weapon attacks with.
 * @param {object} actor owning Actor (or plain data with `items`)
 * @param {object} weapon weapon Item
 * @returns {object|null} live skill Item
 */
export function resolveWeaponSkill(actor, weapon) {
  if (!actor || !weapon) return null
  const skills = toItems(actor.items).filter((item) => item?.type === 'skill')
  if (!skills.length) return null
  const marker = weaponMarker(weapon)
  for (const reference of weaponSkillReferences(weapon)) {
    const found = skills.find((item) => skillMatches(item, reference, marker))
    if (found) return found
  }
  return null
}

/**
 * The weapon's live attack score. A resolved skill always wins over a missing
 * value; the legacy `skillcategory` correction only applies when the skill
 * carries a category (native skills do not, so their correction is 0).
 * @param {object} actor owning Actor
 * @param {object} weapon weapon Item
 * @param {{skillcategory?: object|null}} [options]
 * @returns {{skill: object|null, total: number|null, categoryBonus: number, score: number|null, reference: object|null}}
 */
export function weaponSkillScore(actor, weapon, { skillcategory = null } = {}) {
  const skill = resolveWeaponSkill(actor, weapon)
  if (!skill) {
    const reference = weaponSkillReferences(weapon)[0] ?? null
    return { skill: null, total: null, categoryBonus: 0, score: null, reference }
  }
  const total = Number(skill.system?.total)
  if (!Number.isFinite(total)) {
    return { skill, total: null, categoryBonus: 0, score: null, reference: null }
  }
  const category = text(skill.system?.category)
  const categoryBonus = category
    ? Number(skillcategory?.[category] ?? 0) || 0
    : 0
  return { skill, total, categoryBonus, score: total + categoryBonus, reference: null }
}

/**
 * Attack score for the CM/declare-attack paths. A weapon with no resolvable
 * skill is an error, never a silent 0.
 * @param {object} actor owning Actor
 * @param {object} weapon weapon Item
 * @param {{skillcategory?: object|null}} [options]
 * @returns {{mode: 'skill'|null, skill: object|null, total: number|null, categoryBonus: number, score: number|null, error?: string, reference?: object|null}}
 */
export function weaponAttackScore(actor, weapon, { skillcategory = null } = {}) {
  const resolved = weaponSkillScore(actor, weapon, { skillcategory })
  if (!resolved.skill || resolved.score === null) {
    return {
      mode: null,
      ...resolved,
      error: 'weapon-skill-missing',
      reference: resolved.reference ?? weaponSkillReferences(weapon)[0] ?? null,
    }
  }
  return { mode: 'skill', ...resolved }
}

export const CoCWeaponSkill = Object.freeze({
  weaponSkillReferences,
  resolveWeaponSkill,
  weaponSkillScore,
  weaponAttackScore,
})
