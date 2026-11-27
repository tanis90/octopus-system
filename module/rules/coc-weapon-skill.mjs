// The single source of truth for "which live skill does this weapon attack
// with, and at what score". CoC7 weapons store the skill Item in
// `system.skill.main` (id and/or name); that is the only resolution channel.
// The native sheet, the CM pipeline and the public BRPCheck entry point share
// this resolver, so their answers cannot fork.
//
// Name matching priority follows how the name is written: the full Item name
// (`item.name`, the display name a pack can ship) outranks the parent
// `system.skillName`, which stays a legacy fallback only.
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

const weaponMarker = (weapon) => (weapon?.flags?.brp?.coc?.weapon
  && typeof weapon.flags.brp.coc.weapon === 'object'
  ? weapon.flags.brp.coc.weapon
  : null)

const specKeyOf = (item) => {
  const cocSpec = text(item?.flags?.brp?.coc?.specKey)
  if (cocSpec) return cocSpec
  return text(item?.system?.specialization)
}

// A skill Item carries two names: the document name (the full display name,
// e.g. "射击（步枪/霰弹枪）") and `system.skillName` (the parent name, e.g.
// "射击"). Pack weapons are built before any live Actor exists, so they cannot
// carry a live `skill.main.id`; they reference the skill by its full display
// name. The full name is therefore the primary name channel and the parent
// name is only the legacy fallback.
const specMatches = (item, marker) => !marker?.skillSpec || specKeyOf(item) === marker.skillSpec

const matchesFullName = (item, reference, marker) => item.type === 'skill'
  && text(item?.name) === reference.name
  && specMatches(item, marker)

// Parent-name matching is the legacy channel: a weapon reference written as
// "射击" instead of the full "射击（手枪）". A full-name reference is unaffected
// because the two strings differ.
const matchesParentName = (item, reference, marker) => item.type === 'skill'
  && text(item?.system?.skillName) === reference.name
  && specMatches(item, marker)

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
 * Resolve the live skill Item a weapon attacks with. References are tried in
 * order (`skill.main.id` then `skill.main.name`); within a name reference every
 * skill's full display name is tried before any skill's parent `skillName`, so
 * a full-name reference can never be answered by a parent-name alias.
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
    if (reference.kind === 'native-id') {
      const byId = skills.find((item) => itemIdOf(item) === reference.id)
      if (byId) return byId
      continue
    }
    const byFullName = skills.find((item) => matchesFullName(item, reference, marker))
    if (byFullName) return byFullName
    // Legacy parent-name references keep their historic first-match behaviour;
    // pack content always ships the unambiguous full name.
    const byParentName = skills.find((item) => matchesParentName(item, reference, marker))
    if (byParentName) return byParentName
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
