// CoC NPC / monster single-page card view data. Pure projections only: no
// Foundry globals, no document writes and no dice. The sheet consumes these
// shapes; rolls, wounds and item edits stay on the native system paths.
//
// This module deliberately does not reuse the old NPC sheet's `_prepareItems`
// pass: that method writes derived fields onto live Item documents. Everything
// here is computed from the live Actor/Item values without mutating them.

import {
  buildCocSanityView,
  cocEquipStatusLabel,
  cocWeaponSpecialLabel,
  resolveCocWeaponSkill,
} from './view-data.mjs'

export const COC_NPC_STAT_IDS = Object.freeze(['str', 'con', 'siz', 'dex', 'app', 'int', 'pow', 'edu'])

export const COC_NPC_STAT_LABELS = Object.freeze({
  str: 'STR',
  con: 'CON',
  siz: 'SIZ',
  dex: 'DEX',
  app: 'APP',
  int: 'INT',
  pow: 'POW',
  edu: 'EDU',
})

// Real skills that occupy the common grid first, in keeper-use order. A skill
// is only shown when the Actor actually owns it; nothing is created to fill
// the six slots.
export const COC_NPC_COMMON_SKILL_BRPIDS = Object.freeze([
  'i.skill.coc.fighting-brawl',
  'i.skill.coc.dodge',
  'i.skill.coc.listen',
  'i.skill.coc.spot-hidden',
  'i.skill.coc.stealth',
  'i.skill.coc.track',
])

export const COC_NPC_COMMON_SKILL_LIMIT = 6

export const COC_NPC_POWER_TYPES = Object.freeze(['power', 'magic', 'mutation', 'psychic', 'sorcery', 'super', 'talent'])

const POWER_TYPE_LABELS = Object.freeze({
  power: '异能',
  magic: '魔法',
  mutation: '变异',
  psychic: '灵能',
  sorcery: '巫术',
  super: '超能力',
  talent: '天赋',
})

const POWER_LEVEL_LABELS = Object.freeze({
  normal: '普通',
  epic: '史诗',
  heroic: '英雄',
  superhuman: '超人',
})

const MUTATION_IMPACT_LABELS = Object.freeze({
  adv: '优势',
  dis: '劣势',
})

const DB_LABELS = Object.freeze({
  none: '—',
  half: '½',
  full: 'DB',
  str: 'DB',
  dbl: 'DB',
  db: 'DB',
})

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const text = (value) => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

const numberOrNull = (value) => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const numberOr = (value, fallback = 0) => numberOrNull(value) ?? fallback

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const itemIdOf = (item) => item?.id || item?._id || null

const brpidOf = (item) => text(item?.flags?.brp?.brpidFlag?.id) || null

const cocFlagOf = (item) => (isRecord(item?.flags?.brp?.coc) ? item.flags.brp.coc : {})

const toItems = (source) => {
  if (!source) return []
  if (Array.isArray(source)) return source
  if (Array.isArray(source.contents)) return source.contents
  if (typeof source.values === 'function') return Array.from(source.values())
  if (typeof source[Symbol.iterator] === 'function') return Array.from(source)
  if (isRecord(source)) return Object.values(source)
  return []
}

const hasEffectStatus = (effects, id) => toItems(effects).some((effect) => {
  if (!effect || effect.disabled === true) return false
  const statuses = effect.statuses
  if (typeof statuses?.has === 'function') return statuses.has(id)
  if (Array.isArray(statuses)) return statuses.includes(id)
  return false
})

/**
 * Live CoC status badges. Wounds come from the persisted flags plus the values
 * derived by the Actor prepare pass; insanity comes from the persisted sanity
 * state or a real ActiveEffect status. Nothing is shown when it is not true.
 * @param {object} actor
 * @returns {Array<{id: string, label: string}>}
 */
export function buildCocNpcStatusBadges(actor) {
  const conditions = actor?.system?.conditions ?? {}
  const effects = actor?.effects
  const badges = []
  if (conditions.tempoInsane?.value === true || hasEffectStatus(effects, 'tempInsane')) {
    badges.push({ id: 'temporary', label: '临时疯狂' })
  }
  if (conditions.indefInsane?.value === true || hasEffectStatus(effects, 'indefiniteInsane')) {
    badges.push({ id: 'indefinite', label: '不定疯狂' })
  }
  if (hasEffectStatus(effects, 'permaInsane')) badges.push({ id: 'permanent', label: '永久疯狂' })
  if (conditions.criticalWounds?.value === true) badges.push({ id: 'major', label: '重伤' })
  if (conditions.unconscious?.value === true) badges.push({ id: 'unconscious', label: '昏迷' })
  if (conditions.dying?.value === true) badges.push({ id: 'dying', label: '濒死' })
  if (conditions.dead?.value === true) badges.push({ id: 'dead', label: '死亡' })
  return badges
}

const resourceView = (source, max, { show = true, clampValue = false } = {}) => {
  const rawValue = numberOr(source?.value)
  const value = clampValue ? clamp(rawValue, 0, Math.max(0, max)) : rawValue
  return {
    show,
    value,
    max,
    percent: max > 0 ? clamp(Math.round((value / max) * 100), 0, 100) : 0,
  }
}

/**
 * Header projection: resources, eight current characteristics, derived numbers
 * and real status badges. MP/SAN are only shown when they are actual resources
 * for this Actor (POW-derived MP, SAN enabled with a real starting/value).
 * @param {object} actor
 * @param {{useSAN?: boolean}} [options]
 */
export function buildCocNpcHeader(actor, { useSAN = true } = {}) {
  const system = actor?.system ?? {}
  const attribs = system.attribs ?? {}
  const hpMax = Math.max(0, Math.floor(numberOr(attribs.hp?.max)))
  const mpMax = Math.max(0, Math.floor(numberOr(attribs.mp?.max)))
  const sanMax = Math.max(0, Math.floor(numberOr(attribs.san?.max, 99)))
  const san = resourceView(attribs.san, sanMax, { clampValue: true })
  const hp = resourceView(attribs.hp, hpMax, { clampValue: true })
  const mp = resourceView(attribs.mp, mpMax, { clampValue: true, show: mpMax > 0 })
  const sanShow = useSAN === true && numberOr(attribs.san?.value) > 0
  const luckValue = attribs.lck?.value
  const luck = {
    show: luckValue !== null && luckValue !== undefined && luckValue !== '',
    value: numberOr(luckValue),
    percent: Math.max(0, Math.min(100, Math.round(numberOr(luckValue) / 99 * 100))),
  }
  const stats = COC_NPC_STAT_IDS.map((id) => {
    const source = system.characteristics?.[id] ?? {}
    const rawValue = source.value
    const hasValue = rawValue !== null && rawValue !== undefined && rawValue !== ''
    const value = numberOr(rawValue)
    return {
      id,
      label: COC_NPC_STAT_LABELS[id],
      value,
      base: value,
      formula: text(source.formula),
      hasValue,
      half: hasValue ? Math.floor(value / 2) : null,
      fifth: hasValue ? Math.floor(value / 5) : null,
    }
  })
  return {
    name: text(actor?.name),
    img: text(actor?.img),
    hp,
    mp,
    san: {
      show: sanShow,
      value: san.value,
      max: san.max,
      percent: san.percent,
    },
    luck,
    stats,
    derived: {
      db: text(attribs.db?.value) || '—',
      build: numberOr(attribs.build?.value),
      mov: numberOr(attribs.mov?.value),
      armour: numberOr(attribs.armor?.value),
    },
    badges: buildCocNpcStatusBadges(actor),
  }
}

const joinSegments = (...values) => values
  .map((value) => text(value))
  .filter((value) => value !== '')
  .join('/')

const dbLabelOf = (value) => {
  const key = text(value).toLowerCase()
  if (!key || key === '0') return '—'
  return DB_LABELS[key] ?? text(value)
}

const COC_SKILL_ADJUSTMENTS = ['base', 'personal', 'occupation', 'archetype', 'experiencePackage', 'experience']

const cocSkillTotal = (skill) => {
  if (!skill) return null
  const system = skill.system ?? {}
  return numberOr(system.base) + COC_SKILL_ADJUSTMENTS
    .reduce((total, key) => total + numberOr(system.adjustments?.[key]), 0)
}

export function buildCocNpcAttackRow(weapon, actor) {
  const system = weapon?.system ?? {}
  const skill = resolveCocWeaponSkill(weapon, actor)
  const skillTotal = cocSkillTotal(skill)
  const attackMode = skill && skillTotal !== null ? 'sk' : 'none'
  const damage = text(system.range?.normal?.damage)
  const range = text(system.range?.normal?.value) || (system.properties?.rngd === true ? '' : 'S')
  const rof = text(system.usesPerRound?.normal)
  const ammoCapacity = numberOr(system.ammo)
  const ammoCurrent = numberOr(system.bullets, ammoCapacity)
  const malfunction = numberOr(system.malfunction)
  return {
    id: itemIdOf(weapon),
    name: text(weapon?.name),
    img: text(weapon?.img),
    description: text(system.description?.value),
    npcVal: 0,
    skillId: skill ? itemIdOf(skill) : null,
    skillName: skill ? text(skill.name) : null,
    skillTotal,
    attackMode,
    attackable: attackMode !== 'none',
    hitValue: skillTotal,
    hitLabel: skillTotal === null ? '—' : `${skillTotal}%`,
    damage,
    dmg1: damage,
    damageRollable: damage !== '',
    dbLabel: system.properties?.addb === true ? 'DB' : '—',
    range: range || '—',
    rof: rof || '—',
    ammo: ammoCapacity > 0 ? `${ammoCurrent}/${ammoCapacity}` : '—',
    specialLabel: '',
    hands: '',
    mal: malfunction > 0 ? malfunction : '—',
    equipStatusLabel: '',
    quantity: 1,
  }
}

export function buildCocNpcAttacks(items, actor) {
  return toItems(items)
    .filter((item) => item?.type === 'weapon')
    .map((item) => buildCocNpcAttackRow(item, actor))
}

const skillRowOf = (item) => {
  const system = item?.system ?? {}
  return {
    id: itemIdOf(item),
    name: text(item?.name),
    brpid: brpidOf(item),
    total: cocSkillTotal(item),
    base: numberOr(system.base),
    specialism: text(system.specialization) !== '',
    specKey: text(system.specialization) || null,
  }
}

const compareByTotal = (left, right) => right.total - left.total
  || left.name.localeCompare(right.name, 'zh')
  || String(left.id ?? '').localeCompare(String(right.id ?? ''))

/**
 * Common grid + folded remainder. Existing preferred skills come first, then
 * higher scores fill any remaining slots; only six are common and every other
 * real skill stays available in the expandable list.
 * @param {Array|Iterable|{contents?: Array}} items
 */
export function buildCocNpcSkills(items) {
  const rows = toItems(items)
    .filter((item) => item?.type === 'skill')
    .map(skillRowOf)
  const used = new Set()
  const preferred = []
  for (const brpid of COC_NPC_COMMON_SKILL_BRPIDS) {
    const match = rows.filter((row) => row.brpid === brpid && !used.has(row.id))
      .sort(compareByTotal)[0]
    if (!match) continue
    used.add(match.id)
    preferred.push(match)
  }
  const rest = rows.filter((row) => !used.has(row.id)).sort(compareByTotal)
  const ordered = [...preferred, ...rest]
  const common = ordered.slice(0, COC_NPC_COMMON_SKILL_LIMIT)
  const commonIds = new Set(common.map((row) => row.id))
  const remaining = ordered.filter((row) => !commonIds.has(row.id)).sort(compareByTotal)
  return {
    total: rows.length,
    common,
    remaining,
    moreCount: remaining.length,
  }
}

const pushMeta = (meta, key, label, value) => {
  const resolved = text(value)
  if (!resolved) return
  meta.push({ key, label, value: resolved })
}

/**
 * Real special-ability Items. Only magic/psychic expose a live SK action;
 * every other type is text (name, real fields, description) with no invented
 * "use" control. Descriptions are enriched by the sheet, not here.
 * @param {Array|Iterable|{contents?: Array}} items
 */
export function buildCocNpcPowers(items) {
  return toItems(items)
    .filter((item) => COC_NPC_POWER_TYPES.includes(item?.type))
    .map((item) => {
      const system = item.system ?? {}
      const type = item.type
      const meta = []
      let total = null
      let rollable = false
      if (type === 'magic' || type === 'psychic') {
        total = numberOrNull(system.total) ?? (numberOr(system.base) + numberOr(system.effects))
        rollable = total !== null
        pushMeta(meta, 'base', '基础', system.base)
        pushMeta(meta, 'cost', '消耗', system.pppl)
        pushMeta(meta, 'range', '射程', system.range)
        pushMeta(meta, 'duration', '持续', system.duration)
        if (system.impact === 'damage') pushMeta(meta, 'damage', '伤害', system.damage)
        if (system.impact === 'healing') pushMeta(meta, 'healing', '治疗', system.damage)
      } else if (type === 'power') {
        const level = text(system.level)
        if (level) pushMeta(meta, 'level', '等级', POWER_LEVEL_LABELS[level] ?? level)
      } else if (type === 'mutation') {
        const impact = text(system.impact)
        if (impact) pushMeta(meta, 'impact', '影响', MUTATION_IMPACT_LABELS[impact] ?? impact)
        pushMeta(meta, 'severity', '程度', system.minor === true ? '轻度' : '重度')
      } else if (type === 'sorcery') {
        pushMeta(meta, 'level', '等级', `${numberOr(system.currLvl, 1)}/${numberOr(system.maxLvl, 1)}`)
        pushMeta(meta, 'range', '射程', system.range)
        pushMeta(meta, 'cost', '消耗', system.powCost)
      } else if (type === 'super') {
        pushMeta(meta, 'level', '等级', system.level)
        pushMeta(meta, 'range', '射程', system.range)
        pushMeta(meta, 'duration', '持续', system.duration)
        pushMeta(meta, 'cost', '消耗', system.pppl)
      }
      return {
        id: itemIdOf(item),
        name: text(item.name),
        img: text(item.img),
        type,
        typeLabel: POWER_TYPE_LABELS[type] ?? type,
        description: type === 'talent' ? text(system.description?.value) : text(system.description),
        base: numberOr(system.base),
        total,
        rollable,
        rollLabel: total === null ? '—' : `${total}%`,
        meta,
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'zh'))
}

const equipmentRowOf = (item, typeLabel, meta) => {
  const system = item?.system ?? {}
  return {
    id: itemIdOf(item),
    name: text(item.name),
    img: text(item.img),
    type: item.type,
    typeLabel,
    description: text(system.description?.value ?? system.description),
    quantity: numberOr(system.quantity, 1),
    equipStatus: item?.type === 'item' ? '' : text(system.equipStatus) || 'carried',
    equipStatusLabel: item?.type === 'item' ? '' : cocEquipStatusLabel(system.equipStatus),
    meta,
  }
}

export function buildCocNpcEquipment(items) {
  const armours = []
  const gears = []
  for (const item of toItems(items)) {
    if (item?.type === 'armour') {
      const system = item.system ?? {}
      const meta = []
      pushMeta(meta, 'av', '护甲', numberOr(system.av1))
      pushMeta(meta, 'coverage', '覆盖', system.coverage)
      armours.push(equipmentRowOf(item, '护具', meta))
    } else if (item?.type === 'gear' || item?.type === 'item') {
      gears.push(equipmentRowOf(item, '装备', []))
    }
  }
  return {
    armours: armours.sort((left, right) => left.name.localeCompare(right.name, 'zh')),
    gears: gears.sort((left, right) => left.name.localeCompare(right.name, 'zh')),
    count: armours.length + gears.length,
  }
}

export function buildCocNpcNote(actor) {
  return text(actor?.system?.description?.keeper)
}

/**
 * Wound flags after a direct HP edit on the card. Uses the real CoC wound
 * rules passed by the caller; this function only opens the edit as an input to
 * them. A dead actor stays dead (the rules define no revival), dying ends once
 * HP is positive, a major wound ends at the real half-maximum threshold and
 * unconsciousness caused by reaching zero HP is cleared when HP returns.
 * @param {{wounds?: object, hpValue: number, hpMax: number, previousHpValue?: number}} edit
 * @param {{woundState?: Function, majorWoundCleared?: Function}} woundRules
 * @returns {object|null}
 */
export function buildCocNpcWoundsAfterHpEdit({ wounds = {}, hpValue, hpMax, previousHpValue = 0 } = {}, woundRules) {
  if (typeof woundRules?.woundState !== 'function') return null
  const max = Math.max(0, Math.floor(numberOr(hpMax)))
  const value = clamp(Math.floor(numberOr(hpValue)), 0, max)
  const previous = Math.max(0, Math.floor(numberOr(previousHpValue)))
  const wasAtZero = previous <= 0
  const state = woundRules.woundState({
    hpValue: value,
    hpMax: max,
    majorWound: wounds.majorWound === true,
    dying: wounds.dying === true,
    dead: wounds.dead === true,
    unconscious: wounds.unconscious === true && !wasAtZero,
  })
  const majorWound = state.majorWound === true
    ? !(typeof woundRules.majorWoundCleared === 'function'
      && woundRules.majorWoundCleared({ hpValue: value, hpMax: max, extremeSuccess: false }))
    : false
  return {
    ...wounds,
    initialised: true,
    hpValue: value,
    hpMax: max,
    majorWound,
    dying: state.dying,
    dead: state.dead,
    unconscious: state.unconscious,
    stabilized: wounds.stabilized === true,
  }
}

/**
 * Complete single-page projection.
 * @param {object} actor
 * @param {{useSAN?: boolean}} [options]
 */
export function buildCocNpcView(actor, options = {}) {
  const items = actor?.items
  const system = actor?.system ?? {}
  const infos = system.infos ?? {}
  const special = system.special ?? {}
  const conditions = [
    ['criticalWounds', '重伤'], ['unconscious', '昏迷'], ['dying', '濒死'], ['dead', '死亡'],
    ['prone', '倒地'], ['tempoInsane', '临时疯狂'], ['indefInsane', '长期疯狂'],
  ].map(([id, label]) => ({ id, label, active: system.conditions?.[id]?.value === true }))
  return {
    header: buildCocNpcHeader(actor, options),
    identity: {
      type: text(infos.type) || (text(infos.occupation) ? '' : 'NPC'),
      typeLabel: text(infos.type) ? '类型' : text(infos.occupation) ? '职业' : '类型',
      occupation: text(infos.occupation),
      organization: text(infos.organization),
      age: text(infos.age),
    },
    conditions,
    special: {
      attacksPerRound: text(special.attacksPerRound) || '1',
      sanLoss: {
        checkPassed: text(special.sanLoss?.checkPassed) || '—',
        checkFailled: text(special.sanLoss?.checkFailled) || '—',
      },
      movement: Array.isArray(special.movement) ? special.movement : [],
      movType: text(system.attribs?.mov?.type) || 'walk',
      movAuto: system.attribs?.mov?.auto === true,
    },
    description: text(system.biography?.personalDescription?.value),
    attacks: buildCocNpcAttacks(items, actor),
    skills: buildCocNpcSkills(items),
    powers: buildCocNpcPowers(items),
    equipment: buildCocNpcEquipment(items),
    note: buildCocNpcNote(actor),
  }
}
