// The single source of truth for "which live skill does this weapon attack
// with, and at what score". Native CoC weapons store the skill Item in
// `system.skill.main/alternativ` (id and/or name); legacy worlds store a
// brpid in `system.skill1/skill2` and sometimes a live Item id in
// `system.sourceID`. Both shapes resolve here so the native sheet, the CM
// pipeline and the public BRPCheck entry point cannot fork.
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

const brpidOf = (item) => text(item?.flags?.brp?.brpidFlag?.id)

const specKeyOf = (item) => {
  const cocSpec = text(item?.flags?.brp?.coc?.specKey)
  if (cocSpec) return cocSpec
  return text(item?.system?.specialization)
}

const skillNameOf = (item) => text(item?.system?.skillName) || text(item?.name)

const weaponMarker = (weapon) => (weapon?.flags?.brp?.coc?.weapon
  && typeof weapon.flags.brp.coc.weapon === 'object'
  ? weapon.flags.brp.coc.weapon
  : null)

const skillMatches = (item, reference, marker) => {
  if (!item || item.type !== 'skill') return false
  if (reference.kind === 'native-id') return itemIdOf(item) === reference.id
  if (reference.kind === 'native-name') return skillNameOf(item) === reference.name
  if (reference.kind === 'brpid') {
    if (brpidOf(item) !== reference.brpid) return false
    // A weapon that declares a specialism only accepts that specialism. The
    // bare brpid is not enough: two Items can share it with different specs.
    return !marker?.skillSpec || specKeyOf(item) === marker.skillSpec
  }
  if (reference.kind === 'item-id') {
    if (itemIdOf(item) === reference.id) return true
    if (brpidOf(item) === reference.id) {
      return !marker?.skillSpec || specKeyOf(item) === marker.skillSpec
    }
    return false
  }
  return false
}

/**
 * Ordered references a weapon carries, native first and legacy after. The
 * order is the resolution priority (main, alternativ, skill1, skill2,
 * sourceID), matching how the card displays a weapon.
 * @param {object} weapon weapon Item (or plain data)
 * @returns {Array<object>} references
 */
export function weaponSkillReferences(weapon) {
  const system = weapon?.system ?? {}
  const refs = []
  for (const key of ['main', 'alternativ']) {
    const reference = system.skill?.[key] ?? {}
    const id = text(reference.id)
    const name = text(reference.name)
    if (id) refs.push({ kind: 'native-id', id, source: `skill.${key}.id` })
    if (name) refs.push({ kind: 'native-name', name, source: `skill.${key}.name` })
  }
  for (const key of ['skill1', 'skill2']) {
    const brpid = text(system[key])
    if (brpid && brpid !== 'none') refs.push({ kind: 'brpid', brpid, source: key })
  }
  const sourceId = text(system.sourceID)
  if (sourceId && sourceId !== 'none') refs.push({ kind: 'item-id', id: sourceId, source: 'sourceID' })
  return refs
}

// An explicit skillId can be a live Item id, a brpid or a skill name. Old
// callers pass sourceID (an Item id) and CM callers pass skill1 (a brpid).
const explicitReference = (skillId) => {
  const value = text(skillId)
  if (!value || value === 'none') return null
  return { kind: 'explicit', value }
}

const explicitMatches = (item, value, marker) => {
  if (!item || item.type !== 'skill') return false
  if (itemIdOf(item) === value) return true
  if (brpidOf(item) === value) {
    return !marker?.skillSpec || specKeyOf(item) === marker.skillSpec
  }
  return skillNameOf(item) === value
}

/**
 * Resolve the live skill Item a weapon attacks with.
 * @param {object} actor owning Actor (or plain data with `items`)
 * @param {object} weapon weapon Item
 * @param {string|false} [skillId] optional explicit Item id/brpid/name
 * @returns {object|null} live skill Item
 */
export function resolveWeaponSkill(actor, weapon, skillId = false) {
  if (!actor || !weapon) return null
  const skills = toItems(actor.items).filter((item) => item?.type === 'skill')
  if (!skills.length) return null
  const marker = weaponMarker(weapon)
  for (const reference of weaponSkillReferences(weapon)) {
    const found = skills.find((item) => skillMatches(item, reference, marker))
    if (found) return found
  }
  const explicit = explicitReference(skillId)
  return explicit ? (skills.find((item) => explicitMatches(item, explicit.value, marker)) ?? null) : null
}

/**
 * The weapon's live attack score. A resolved skill always wins over a missing
 * value, and the legacy `skillcategory` correction only applies when the skill
 * carries a category (native skills do not, so their correction is 0).
 * @param {object} actor owning Actor
 * @param {object} weapon weapon Item
 * @param {{skillId?: string|false, skillcategory?: object|null}} [options]
 * @returns {{skill: object|null, total: number|null, categoryBonus: number, score: number|null, reference: object|null}}
 */
export function weaponSkillScore(actor, weapon, { skillId = false, skillcategory = null } = {}) {
  const skill = resolveWeaponSkill(actor, weapon, skillId)
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
 * Attack score for the CM/declare-attack paths. A positive legacy `npcVal` is
 * the old natural attack and keeps its old behaviour; otherwise the live skill
 * total plus its legacy category correction is used. A weapon with neither is
 * an error, never a silent 0.
 * @param {object} actor owning Actor
 * @param {object} weapon weapon Item
 * @param {{skillId?: string|false, skillcategory?: object|null, naturalValue?: number|string|null}} [options]
 * @returns {{mode: 'natural'|'skill'|null, skill: object|null, total: number|null, categoryBonus: number, score: number|null, error?: string, reference?: object|null}}
 */
export function weaponAttackScore(actor, weapon, {
  skillId = false, skillcategory = null, naturalValue = null,
} = {}) {
  const natural = Number(naturalValue)
  if (Number.isFinite(natural) && natural > 0) {
    return { mode: 'natural', skill: null, total: natural, categoryBonus: 0, score: natural }
  }
  const resolved = weaponSkillScore(actor, weapon, { skillId, skillcategory })
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
