// CoC native card view data. Pure projections only: no Foundry globals, no
// document writes and no dice. The card template consumes these shapes, while
// rules, rolls and growth stay on the native system paths.
//
// Skill categories are a presentation mapping keyed by the stable
// `flags.brp.brpidFlag.id`. Display names are never used to classify a skill,
// and the mapping never writes back to an Item or Actor.

const OTHER_CATEGORY = 'other'

// Presentation-only labels. The stored `system.equipStatus` value stays raw;
// these maps decide what the card shows and what the edit select offers.
const EQUIP_STATUS_LABELS = Object.freeze({
  carried: '携带',
  packed: '打包',
  stored: '存放',
  worn: '穿戴',
})

export const COC_EQUIP_STATUS_OPTIONS = Object.freeze(
  Object.entries(EQUIP_STATUS_LABELS).map(([value, label]) => Object.freeze({ value, label })),
)

const WEAPON_SPECIAL_LABELS = Object.freeze({
  impale: '穿刺',
})

export const COC_SKILL_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'combat', key: 'combat', label: '战斗' }),
  Object.freeze({ id: 'investigation', key: 'investigation', label: '调查' }),
  Object.freeze({ id: 'social', key: 'social', label: '社交' }),
  Object.freeze({ id: 'survival', key: 'survival', label: '生存' }),
  Object.freeze({ id: 'craft', key: 'craft', label: '技艺' }),
  Object.freeze({ id: 'medical', key: 'medical', label: '医疗' }),
  Object.freeze({ id: OTHER_CATEGORY, key: OTHER_CATEGORY, label: '其他' }),
])

// Mirrors every skill in content/coc/skills.json (the 60 public core skills)
// plus the two octopus-equipment firearm specialisms. Unknown ids fall to
// `other` so a user-created skill never borrows a category by accident.
const SKILL_CATEGORY_BY_BRPID = Object.freeze({
  // combat
  'i.skill.coc.dodge': 'combat',
  'i.skill.coc.fighting-brawl': 'combat',
  'i.skill.coc.fighting-chainsaw': 'combat',
  'i.skill.coc.fighting-spear': 'combat',
  'i.skill.coc.fighting-sword': 'combat',
  'i.skill.coc.fighting-whip': 'combat',
  'i.skill.coc.firearms-bow': 'combat',
  'i.skill.coc.firearms-handgun': 'combat',
  'i.skill.coc.firearms-mg': 'combat',
  'i.skill.coc.firearms-rifle-shotgun': 'combat',
  'i.skill.coc.firearms-smg': 'combat',
  'i.skill.coc.throw': 'combat',
  // investigation
  'i.skill.coc.accounting': 'investigation',
  'i.skill.coc.anthropology': 'investigation',
  'i.skill.coc.appraise': 'investigation',
  'i.skill.coc.archaeology': 'investigation',
  'i.skill.coc.cthulhu-mythos': 'investigation',
  'i.skill.coc.history': 'investigation',
  'i.skill.coc.language-other-greek': 'investigation',
  'i.skill.coc.language-other-latin': 'investigation',
  'i.skill.coc.language-own': 'investigation',
  'i.skill.coc.law': 'investigation',
  'i.skill.coc.library-use': 'investigation',
  'i.skill.coc.listen': 'investigation',
  'i.skill.coc.natural-world': 'investigation',
  'i.skill.coc.occult': 'investigation',
  'i.skill.coc.psychology': 'investigation',
  'i.skill.coc.science-astronomy': 'investigation',
  'i.skill.coc.science-biology': 'investigation',
  'i.skill.coc.science-botany': 'investigation',
  'i.skill.coc.science-chemistry': 'investigation',
  'i.skill.coc.science-engineering': 'investigation',
  'i.skill.coc.science-forensics': 'investigation',
  'i.skill.coc.science-geology': 'investigation',
  'i.skill.coc.science-math': 'investigation',
  'i.skill.coc.science-pharmacy': 'investigation',
  'i.skill.coc.science-physics': 'investigation',
  'i.skill.coc.science-zoology': 'investigation',
  'i.skill.coc.spot-hidden': 'investigation',
  // social
  'i.skill.coc.charm': 'social',
  'i.skill.coc.credit-rating': 'social',
  'i.skill.coc.fast-talk': 'social',
  'i.skill.coc.intimidate': 'social',
  'i.skill.coc.persuade': 'social',
  // survival
  'i.skill.coc.climb': 'survival',
  'i.skill.coc.diving': 'survival',
  'i.skill.coc.drive-auto': 'survival',
  'i.skill.coc.jump': 'survival',
  'i.skill.coc.navigate': 'survival',
  'i.skill.coc.pilot-aircraft': 'survival',
  'i.skill.coc.pilot-boat': 'survival',
  'i.skill.coc.pilot-horse': 'survival',
  'i.skill.coc.ride': 'survival',
  'i.skill.coc.stealth': 'survival',
  'i.skill.coc.survival-mountain': 'survival',
  'i.skill.coc.survival-sea': 'survival',
  'i.skill.coc.survival-wilderness': 'survival',
  'i.skill.coc.swim': 'survival',
  'i.skill.coc.track': 'survival',
  // craft
  'i.skill.coc.art-craft-acrobatics': 'craft',
  'i.skill.coc.art-craft-acting': 'craft',
  'i.skill.coc.art-craft-barber': 'craft',
  'i.skill.coc.art-craft-calligraphy': 'craft',
  'i.skill.coc.art-craft-comedy': 'craft',
  'i.skill.coc.art-craft-cooking': 'craft',
  'i.skill.coc.art-craft-dancing': 'craft',
  'i.skill.coc.art-craft-farming': 'craft',
  'i.skill.coc.art-craft-fitter': 'craft',
  'i.skill.coc.art-craft-forgery': 'craft',
  'i.skill.coc.art-craft-game': 'craft',
  'i.skill.coc.art-craft-music': 'craft',
  'i.skill.coc.art-craft-painting': 'craft',
  'i.skill.coc.art-craft-photography': 'craft',
  'i.skill.coc.art-craft-plumbing': 'craft',
  'i.skill.coc.art-craft-shorthand': 'craft',
  'i.skill.coc.art-craft-singing': 'craft',
  'i.skill.coc.art-craft-tailoring': 'craft',
  'i.skill.coc.art-craft-technical-drawing': 'craft',
  'i.skill.coc.art-craft-typing': 'craft',
  'i.skill.coc.art-craft-welding': 'craft',
  'i.skill.coc.art-craft-woodworking': 'craft',
  'i.skill.coc.art-craft-writing': 'craft',
  'i.skill.coc.computer': 'craft',
  'i.skill.coc.disguise': 'craft',
  'i.skill.coc.electrical-repair': 'craft',
  'i.skill.coc.electronics': 'craft',
  'i.skill.coc.locksmith': 'craft',
  'i.skill.coc.mechanical-repair': 'craft',
  'i.skill.coc.operate-heavy-machinery': 'craft',
  'i.skill.coc.sleight-of-hand': 'craft',
  // medical
  'i.skill.coc.first-aid': 'medical',
  'i.skill.coc.medicine': 'medical',
  'i.skill.coc.psychoanalysis': 'medical',
})

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const text = (value) => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

const hasOwn = (record, key) => Object.prototype.hasOwnProperty.call(record, key)

/**
 * Chinese label for a stored `equipStatus`. Unknown values are returned as-is
 * so an unrecognised status is never silently hidden or rewritten.
 * @param {unknown} value
 * @returns {string}
 */
export function cocEquipStatusLabel(value) {
  const raw = text(value)
  if (!raw) return EQUIP_STATUS_LABELS.carried
  return hasOwn(EQUIP_STATUS_LABELS, raw) ? EQUIP_STATUS_LABELS[raw] : raw
}

/**
 * Chinese label for a weapon `special`. `none`/empty renders nothing and
 * unknown values stay raw for the same reason as equip status.
 * @param {unknown} value
 * @returns {string}
 */
export function cocWeaponSpecialLabel(value) {
  const raw = text(value)
  if (!raw) return ''
  const key = raw.toLowerCase()
  if (key === 'none') return ''
  return hasOwn(WEAPON_SPECIAL_LABELS, key) ? WEAPON_SPECIAL_LABELS[key] : raw
}

const numberOrNull = (value) => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const numberOr = (value, fallback = 0) => numberOrNull(value) ?? fallback

const itemIdOf = (item) => item?.id || item?._id || null

const flagCocOf = (item) => (isRecord(item?.flags?.brp?.coc) ? item.flags.brp.coc : {})

const brpidOf = (item) => {
  if (typeof item === 'string') return item.trim() || null
  return text(item?.flags?.brp?.brpidFlag?.id) || null
}

const toItems = (source) => {
  if (!source) return []
  if (Array.isArray(source)) return source
  if (Array.isArray(source.contents)) return source.contents
  if (typeof source.values === 'function') return Array.from(source.values())
  if (typeof source[Symbol.iterator] === 'function') return Array.from(source)
  if (isRecord(source)) return Object.values(source)
  return []
}

const skillBreakdownOf = (system) => ({
  base: numberOr(system?.base),
  profession: numberOr(system?.adjustments?.occupation),
  personal: numberOr(system?.adjustments?.personal),
  xp: numberOr(system?.adjustments?.experience),
  effects: numberOr(system?.adjustments?.base),
  personality: numberOr(system?.adjustments?.archetype),
  culture: numberOr(system?.adjustments?.experiencePackage),
})

const sumBreakdown = (breakdown) => breakdown.base + breakdown.profession + breakdown.personal
  + breakdown.xp + breakdown.effects + breakdown.personality + breakdown.culture

const hasBreakdownValue = (system) => numberOrNull(system?.base) !== null
  || Object.values(system?.adjustments ?? {}).some((value) => numberOrNull(value) !== null)

const skillTotalOf = (item) => {
  const stored = numberOrNull(item?.system?.total)
  if (stored !== null) return stored
  if (!hasBreakdownValue(item?.system)) return null
  return sumBreakdown(skillBreakdownOf(item?.system))
}

/**
 * Stable category id for a skill Item (or a brpid string).
 * @param {{flags?: {brp?: {brpidFlag?: {id?: string}}}}} item
 * @returns {'combat'|'investigation'|'social'|'survival'|'craft'|'medical'|'other'}
 */
export function cocSkillCategoryOf(item) {
  const brpid = brpidOf(item)
  if (!brpid) return OTHER_CATEGORY
  if (!Object.prototype.hasOwnProperty.call(SKILL_CATEGORY_BY_BRPID, brpid)) return OTHER_CATEGORY
  return SKILL_CATEGORY_BY_BRPID[brpid]
}

const skillRowOf = (item) => {
  const system = item?.system ?? {}
  const specKey = text(system.specialization) || null
  const parentKey = null
  const breakdown = skillBreakdownOf(system)
  const total = skillTotalOf(item) ?? 0
  breakdown.total = total
  const breakdownText = [
    ['基础', breakdown.base], ['职业', breakdown.profession], ['兴趣', breakdown.personal],
    ['成长', breakdown.xp], ['效果', breakdown.effects], ['人格', breakdown.personality], ['文化', breakdown.culture],
  ].filter(([, value]) => value !== 0).map(([label, value]) => `${label} ${value}`)
  return {
    id: itemIdOf(item),
    name: text(item?.name),
    brpid: brpidOf(item),
    total,
    base: breakdown.base,
    half: Math.floor(total / 2),
    fifth: Math.floor(total / 5),
    specialism: system.specialism === true || specKey !== null,
    improve: system.improve === true,
    uncommon: brpidOf(item) === 'i.skill.coc.cthulhu-mythos',
    specKey,
    parentKey,
    breakdown,
    breakdownText: breakdownText.join(' + '),
  }
}

const compareSkillRows = (left, right) => {
  const byTotal = right.total - left.total
  if (byTotal !== 0) return byTotal
  const byName = left.name.localeCompare(right.name, 'zh')
  if (byName !== 0) return byName
  return String(left.id ?? '').localeCompare(String(right.id ?? ''))
}

/**
 * Group skill Items for the skills tab.
 * @param {Array|Iterable|{contents?: Array}} items actor.items or a plain collection
 * @returns {Array<{id: string, key: string, label: string, skills: Array<object>}>}
 */
export function buildCocSkillGroups(items) {
  const rowsByCategory = new Map()
  for (const item of toItems(items)) {
    if (item?.type !== 'skill') continue
    const category = cocSkillCategoryOf(item)
    if (!rowsByCategory.has(category)) rowsByCategory.set(category, [])
    rowsByCategory.get(category).push(skillRowOf(item))
  }
  const groups = []
  for (const category of COC_SKILL_CATEGORIES) {
    const skills = rowsByCategory.get(category.id)
    if (!skills?.length) continue
    skills.sort(compareSkillRows)
    groups.push({ id: category.id, key: category.key, label: category.label, skills })
  }
  return groups
}

/**
 * Resolve the live actor skill a weapon attacks with. A weapon that declares
 * `flags.brp.coc.weapon.skillSpec` only matches the skill specialism, so both
 * the card projection and the roll handlers share one lookup instead of
 * matching the bare brpid and ignoring the specialisation.
 * @param {object} weapon weapon Item
 * @param {object} actor owning Actor
 * @returns {object|null} skill Item
 */
export function resolveCocWeaponSkill(weapon, actor) {
  const reference = weapon?.system?.skill?.main ?? {}
  const referenceId = text(reference.id)
  const referenceName = text(reference.name)
  if (!referenceId && !referenceName) return null
  const skills = toItems(actor?.items).filter((item) => item?.type === 'skill')
  if (referenceId) {
    const byId = skills.find((item) => itemIdOf(item) === referenceId)
    if (byId) return byId
  }
  return skills.find((item) => text(item?.system?.skillName) === referenceName || text(item?.name) === referenceName) ?? null
}

const joinSegments = (...values) => values
  .map((value) => text(value))
  .filter((value) => value !== '')
  .join('/')

const DB_LABELS = Object.freeze({
  none: '—',
  half: '½',
  full: 'DB',
  str: 'DB',
  dbl: 'DB',
  db: 'DB',
})

const dbLabelOf = (value) => {
  const key = text(value).toLowerCase()
  if (!key || key === '0') return '—'
  return DB_LABELS[key] ?? text(value)
}

const cocEquipmentOf = (item) => (isRecord(item?.flags?.brp?.cocEquipment)
  ? item.flags.brp.cocEquipment
  : {})

// octopus-equipment stores alternate magazine sizes as numbers or numeric
// strings. Empty/invalid entries never reach the card, and the label is only
// a list of printed options - it never switches the live capacity.
const ammoOptionsOf = (item) => {
  const raw = cocEquipmentOf(item).ammoOptions
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    if (typeof entry === 'number') return Number.isFinite(entry) ? String(entry) : ''
    if (typeof entry === 'string') {
      const value = entry.trim()
      return value !== '' && Number.isFinite(Number(value)) ? value : ''
    }
    return ''
  }).filter((value) => value !== '')
}

/**
 * Sanity panel projection. The current SAN and the keeper day-start SAN are
 * separate fields: the CoC daily threshold is ceil(dayStartSan / 5) and only
 * exists when a real day-start value was recorded. Missing data degrades to
 * `—`/0 rather than NaN, and the progress meter caps at 100.
 * @param {object} sanity `system.sanity`
 * @returns {object}
 */
export function buildCocSanityView(sanity) {
  const value = numberOr(sanity?.value)
  const max = numberOr(sanity?.max)
  const starting = numberOr(sanity?.starting)
  const rawDayStart = numberOrNull(sanity?.dayStartSan)
  const dayStartSan = rawDayStart !== null && rawDayStart >= 0 ? rawDayStart : null
  const dailyLoss = Math.max(0, numberOr(sanity?.dailyLoss))
  const singleLoss = Math.max(0, numberOr(sanity?.singleLoss))
  const dayThreshold = dayStartSan === null ? null : Math.ceil(dayStartSan / 5)
  const dailyLossPercent = dayThreshold !== null && dayThreshold > 0
    ? Math.max(0, Math.min(100, Math.round((dailyLoss / dayThreshold) * 100)))
    : 0
  const percent = max > 0
    ? Math.max(0, Math.min(100, Math.round((value / max) * 100)))
    : 0
  return {
    value,
    max,
    starting,
    percent,
    mythosPercent: 0,
    dayStartSan,
    dayStartSanLabel: dayStartSan === null ? '—' : String(dayStartSan),
    dayThreshold,
    dayThresholdLabel: dayThreshold === null ? '—' : String(dayThreshold),
    dailyLoss,
    dailyLossPercent,
    singleLoss,
  }
}

/**
 * Weapon row for both the combat and item tabs.
 * @param {object} item weapon Item
 * @param {object} actor owning Actor, used for the live skill total
 * @returns {object}
 */
export function buildCocWeaponView(item, actor) {
  const system = item?.system ?? {}
  const skill = resolveCocWeaponSkill(item, actor)
  const skillTotal = skill ? skillTotalOf(skill) : null
  const ammoCapacity = numberOr(system.ammo)
  const ammoCurrent = numberOr(system.bullets, ammoCapacity)
  const malfunction = numberOr(system.malfunction)
  const damage = text(system.range?.normal?.damage)
  const range = text(system.range?.normal?.value) || (system.properties?.rngd === true ? '' : 'S')
  const special = text(system.description?.special)
  const specialLabel = system.properties?.impl === true ? '穿刺' : ''
  const meta = []
  if (specialLabel) meta.push({ key: 'special', label: specialLabel })
  return {
    id: itemIdOf(item),
    name: text(item?.name),
    img: text(item?.img),
    description: text(system.description?.value),
    skillId: skill ? itemIdOf(skill) : null,
    skillName: skill ? text(skill.name) : null,
    skillTotal,
    damage,
    dbLabel: system.properties?.addb === true ? 'DB' : '—',
    range,
    rof: text(system.usesPerRound?.normal),
    ammo: ammoCapacity > 0 ? `${ammoCurrent}/${ammoCapacity}` : '—',
    mal: malfunction > 0 ? malfunction : '—',
    hands: '',
    special,
    specialLabel,
    ammoType: '',
    parry: false,
    fire: system.properties?.burn === true,
    ammoOptions: [],
    ammoOptionsLabel: '',
    meta,
    cost: null,
    costLabel: '',
    quantity: 1,
    equipStatus: 'carried',
    equipStatusLabel: cocEquipStatusLabel('carried'),
    melee: system.properties?.rngd !== true,
    attackable: Boolean(skill) && skillTotal !== null,
    dmg1: damage,
    dmg2: '',
    dmg3: '',
    range1: range,
    range2: '',
    range3: '',
    ammoCurr: ammoCurrent,
    ammoCapacity,
    malValue: malfunction,
  }
}

/**
 * Armour card for the item tab.
 * @param {object} item armour Item
 * @returns {object}
 */
export function buildCocArmourView(item) {
  const system = item?.system ?? {}
  const equipStatus = text(system.equipStatus) || 'carried'
  return {
    id: itemIdOf(item),
    name: text(item?.name),
    img: text(item?.img),
    description: text(system.description),
    av1: numberOr(system.av1),
    coverage: text(system.coverage),
    quantity: numberOr(system.quantity, 1),
    equipStatus,
    equipStatusLabel: cocEquipStatusLabel(equipStatus),
  }
}

/**
 * Gear card for the item tab. Uses the same equip-status presentation mapping
 * as weapons and armour so all three card types render identical labels.
 * @param {object} item gear Item
 * @returns {object}
 */
export function buildCocGearView(item) {
  const system = item?.system ?? {}
  const nativeItem = item?.type === 'item' || item?.type === 'talent'
  const equipStatus = nativeItem ? '' : text(system.equipStatus) || 'carried'
  return {
    id: itemIdOf(item),
    name: text(item?.name),
    img: text(item?.img),
    description: text(system.description?.value ?? system.description),
    quantity: numberOr(system.quantity, 1),
    equipStatus,
    equipStatusLabel: cocEquipStatusLabel(equipStatus),
  }
}

export const COC_BACKGROUND_FIELDS = Object.freeze([
  Object.freeze({ key: 'personalDescription', label: '个人描述' }),
  Object.freeze({ key: 'beliefs', label: '思想与信念' }),
  Object.freeze({ key: 'significantPeople', label: '重要之人' }),
  Object.freeze({ key: 'meaningfulLocations', label: '意义之地' }),
  Object.freeze({ key: 'treasuredPossessions', label: '珍贵之物' }),
  Object.freeze({ key: 'traits', label: '特质' }),
  Object.freeze({ key: 'injuriesScars', label: '创伤与疤痕' }),
  Object.freeze({ key: 'phobiasManias', label: '恐惧症与躁狂' }),
  Object.freeze({ key: 'arcaneTomesSpells', label: '秘法典籍与法术' }),
  Object.freeze({ key: 'strangeEncounters', label: '遭遇怪异实体' }),
])

const BACKGROUND_TITLE_ALIASES = Object.freeze({
  personalDescription: Object.freeze(['个人描述', 'Personal Description', 'Personal description']),
  beliefs: Object.freeze([
    '思想与信念', 'Beliefs', 'Belief', 'Ideology', 'Ideology and Beliefs',
    'Ideology & Beliefs', 'Ideology/Beliefs', 'Beliefs & Ideology',
  ]),
  significantPeople: Object.freeze(['重要之人', 'Significant People', 'Significant Person']),
  meaningfulLocations: Object.freeze(['意义之地', 'Meaningful Locations', 'Meaningful Location']),
  treasuredPossessions: Object.freeze(['珍贵之物', 'Treasured Possessions', 'Treasured Possession']),
  traits: Object.freeze(['特质', 'Traits', 'Trait']),
  injuriesScars: Object.freeze(['创伤与疤痕', 'Injuries & Scars', 'Injuries and Scars', 'Injury & Scar']),
  phobiasManias: Object.freeze(['恐惧症与躁狂', 'Phobias & Manias', 'Phobias and Manias', 'Phobia & Mania']),
  arcaneTomesSpells: Object.freeze(['秘法典籍与法术', 'Arcane Tomes & Spells', 'Arcane Tomes and Spells', 'Arcane Tomes']),
  strangeEncounters: Object.freeze(['遭遇怪异实体', 'Strange Encounters', 'Strange Encounter']),
})

// Existing studio data writes `ideology` / `arcaneTomes` / `encounters`.
// Read those aliases without making them the new canonical keys.
const BACKGROUND_FLAG_ALIASES = Object.freeze({
  personalDescription: Object.freeze(['personalDescription']),
  beliefs: Object.freeze(['beliefs', 'ideology']),
  significantPeople: Object.freeze(['significantPeople']),
  meaningfulLocations: Object.freeze(['meaningfulLocations']),
  treasuredPossessions: Object.freeze(['treasuredPossessions']),
  traits: Object.freeze(['traits']),
  injuriesScars: Object.freeze(['injuriesScars']),
  phobiasManias: Object.freeze(['phobiasManias']),
  arcaneTomesSpells: Object.freeze(['arcaneTomesSpells', 'arcaneTomes']),
  strangeEncounters: Object.freeze(['strangeEncounters', 'encounters']),
})

const normalizeTitle = (value) => text(value).toLowerCase().replace(/\s+/g, ' ')

const TITLE_TO_FIELD = new Map()
for (const field of COC_BACKGROUND_FIELDS) {
  for (const title of BACKGROUND_TITLE_ALIASES[field.key] ?? []) {
    TITLE_TO_FIELD.set(normalizeTitle(title), field.key)
  }
}

const backgroundText = (value) => (typeof value === 'string' ? value.trim() : '')

const storyValueFor = (stories, fieldKey) => {
  if (!Array.isArray(stories)) return ''
  for (const story of stories) {
    if (!isRecord(story)) continue
    if (TITLE_TO_FIELD.get(normalizeTitle(story.title)) !== fieldKey) continue
    const value = backgroundText(story.value)
    if (value) return value
  }
  return ''
}

const flagValueFor = (flags, fieldKey) => {
  if (!isRecord(flags)) return ''
  const keys = new Map(Object.keys(flags).map((key) => [key.toLowerCase(), key]))
  for (const alias of BACKGROUND_FLAG_ALIASES[fieldKey] ?? []) {
    const key = Object.prototype.hasOwnProperty.call(flags, alias) ? alias : keys.get(alias.toLowerCase())
    if (key === undefined) continue
    const value = backgroundText(flags[key])
    if (value) return value
  }
  return ''
}

const IDENTITY_FIELDS = Object.freeze([
  Object.freeze({ key: 'age', label: '年龄' }),
  Object.freeze({ key: 'sex', label: '性别' }),
  Object.freeze({ key: 'residence', label: '居住地' }),
  Object.freeze({ key: 'birthplace', label: '出生地' }),
  Object.freeze({ key: 'archetype', label: '原型' }),
  Object.freeze({ key: 'organization', label: '所属组织' }),
])

/**
 * Background tab: profession, credit rating, identity and the ten narrative
 * fields. CoC biography chapters are the primary source, with the card's
 * stable background keys supplementing them.
 * @param {object} actor
 * @returns {object}
 */
export function buildCocBackground(actor) {
  const system = actor?.system ?? {}
  const stories = system.biography
  const flagsBackground = actor?.flags?.brp?.coc?.background
  const items = toItems(actor?.items)

  const fields = COC_BACKGROUND_FIELDS.map(({ key, label }) => ({
    key,
    label,
    value: storyValueFor(stories, key) || flagValueFor(flagsBackground, key),
  }))
  const hasFields = fields.some((field) => field.value !== '')
  const legacy = hasFields ? '' : backgroundText(system.backstory)

  const professionItem = items.find((item) => item?.type === 'profession') ?? null
  const professionCoc = flagCocOf(professionItem)
  const professionName = text(professionItem?.name) || text(system.infos?.occupation)

  const creditMin = numberOrNull(professionCoc.creditMin)
  const creditMax = numberOrNull(professionCoc.creditMax)
  const creditSkill = items.find((item) => item?.type === 'skill' && (
    brpidOf(item) === 'i.skill.coc.credit-rating'
    || text(flagCocOf(item).key) === 'credit-rating'
  )) ?? null

  return {
    profession: {
      id: itemIdOf(professionItem),
      name: professionName,
      creditMin,
      creditMax,
    },
    creditRating: {
      value: creditSkill ? skillTotalOf(creditSkill) : null,
      min: creditMin,
      max: creditMax,
    },
    identity: IDENTITY_FIELDS.map(({ key, label }) => ({
      key,
      label,
      value: system[key] ?? '',
    })),
    fields,
    legacy,
  }
}
