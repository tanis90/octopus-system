// CoC skill field contract (M5 growth write surface).
//
// One canonical write surface for a skill:
//   system.properties.noxpgain        future growth forbidden
//   system.flags.developement         ticked, waiting for the development phase
//   system.adjustments.experience     experience points already gained
//   system.adjustments.base/personal/occupation/archetype/experiencePackage
//   system.base                       printed/derived base score
//   system.total                      DERIVED ONLY (never persisted by this system)
//
// total = base + adjustments.base + personal + occupation + archetype
//              + experiencePackage + experience
//
// Reads are compatible with the legacy BRP flat skill fields (`system.noXP`,
// `system.improve`, `system.xp`, `system.personal`, `system.profession`
// [occupation], `system.personality` [archetype], `system.culture`
// [experiencePackage]). A canonical value always wins; legacy values are
// fallbacks, never added on top, so migrated and un-migrated documents cannot
// double count. Writes only ever use the canonical paths - the one migration in
// module/setup/update.mjs is the only place that touches the legacy keys, and it
// zeroes them so a stale reader cannot pick them up again.
//
// `system.properties.noxpgain` forbids NEW growth (tick / list / settlement) but
// never erases experience already gained: `base 0 + experience 10` stays total
// 10 (Cthulhu Mythos still lowers the SAN cap to 89). Unticking stays possible.
//
// NaN discipline: every numeric read falls back to 0 through `finite`, so an
// `undefined + N` can never produce NaN in total. `skillTotalInfo().valid`
// separates a real 0 from "this document has no score data at all"; callers that
// roll a growth check must refuse the latter instead of treating it as 0 and
// succeeding on every die (`score = NaN -> 0` fake improvement).
//
// Pure module: no imports, no Foundry globals, no writes.

const finite = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const present = (value) => value !== null && value !== undefined && value !== ''

const LEGACY_ADJUSTMENT_SOURCES = Object.freeze({
  personal: 'personal',
  occupation: 'profession',
  archetype: 'personality',
  experiencePackage: 'culture',
})

export const LEGACY_SKILL_KEYS = Object.freeze([
  'xp', 'noXP', 'improve', 'oppimprove',
  'personal', 'profession', 'personality', 'culture', 'effects',
  'occupation', 'prsnlty', 'cultural',
])

// Canonical "future growth forbidden". Legacy `noXP` still reads as true so an
// un-migrated document cannot suddenly become tickable.
export function skillNoXP(system = {}) {
  if (system?.properties?.noxpgain === true) return true
  return system?.noXP === true
}

// Canonical "ticked, waiting for settlement". Legacy `improve` is the read
// fallback for un-migrated documents and imported compendium entries.
export function skillTicked(system = {}) {
  if (system?.flags?.developement === true) return true
  return system?.improve === true
}

// Experience already gained. Canonical wins even when it is 0; the legacy `xp`
// is only a fallback, never summed in.
export function skillXp(system = {}) {
  const adjustments = system?.adjustments ?? {}
  if (present(adjustments.experience)) return Math.trunc(finite(adjustments.experience))
  return Math.trunc(finite(system?.xp))
}

// All six adjustment buckets with canonical-first, legacy-fallback reads.
export function skillAdjustments(system = {}) {
  const canonical = system?.adjustments ?? {}
  const bucket = (key, legacyKey = null) => {
    if (present(canonical[key])) return Math.trunc(finite(canonical[key]))
    if (legacyKey && present(system?.[legacyKey])) return Math.trunc(finite(system[legacyKey]))
    return 0
  }
  return Object.freeze({
    base: bucket('base'),
    personal: bucket('personal', LEGACY_ADJUSTMENT_SOURCES.personal),
    occupation: bucket('occupation', LEGACY_ADJUSTMENT_SOURCES.occupation),
    archetype: bucket('archetype', LEGACY_ADJUSTMENT_SOURCES.archetype),
    experiencePackage: bucket('experiencePackage', LEGACY_ADJUSTMENT_SOURCES.experiencePackage),
    experience: skillXp(system),
  })
}

// Derived total. Always a finite number; a document without any score data
// yields 0 and `skillTotalInfo().valid === false`.
export function skillTotal(system = {}) {
  const adjustments = skillAdjustments(system)
  return finite(system?.base)
    + adjustments.base
    + adjustments.personal
    + adjustments.occupation
    + adjustments.archetype
    + adjustments.experiencePackage
    + adjustments.experience
}

// Total plus the evidence a growth check needs: `valid` is false when the
// document carries no score data at all (nothing to roll against), `naN` lists
// the supplied values that were not numeric (audit only, they read as 0).
export function skillTotalInfo(system = {}) {
  const adjustments = skillAdjustments(system)
  const canonical = system?.adjustments ?? {}
  const sources = [
    ['base', system?.base],
    ['adjustments.base', canonical.base],
    ['adjustments.personal', canonical.personal],
    ['adjustments.occupation', canonical.occupation],
    ['adjustments.archetype', canonical.archetype],
    ['adjustments.experiencePackage', canonical.experiencePackage],
    ['adjustments.experience', canonical.experience],
    ['xp', system?.xp],
    ['personal', system?.personal],
    ['profession', system?.profession],
    ['personality', system?.personality],
    ['culture', system?.culture],
  ]
  const provided = sources.filter(([, value]) => present(value))
  const invalid = provided
    .filter(([, value]) => !Number.isFinite(Number(value)))
    .map(([key]) => key)
  return Object.freeze({
    total: skillTotal(system),
    valid: provided.length > 0 && invalid.length === 0,
    adjustments,
    noXP: skillNoXP(system),
    ticked: skillTicked(system),
    xp: skillXp(system),
    invalid,
  })
}

// ---------------------------------------------------------------------------
// Canonical write helpers. Callers pass these objects straight to
// `item.update()`; no helper ever emits a legacy key.
// ---------------------------------------------------------------------------

export function skillNoXPUpdate(noXP) {
  return { 'system.properties.noxpgain': noXP === true }
}

export function skillTickUpdate(ticked) {
  return { 'system.flags.developement': ticked === true }
}

export function skillXpUpdate(xp) {
  return { 'system.adjustments.experience': Math.trunc(finite(xp)) }
}

// A full canonical skill payload, for item creation/drop normalisation. Legacy
// score fields are intentionally absent: the caller writes this instead of the
// raw document, so an old drop cannot re-introduce legacy keys.
export function normalizeSkillSystem(system = {}) {
  const adjustments = skillAdjustments(system)
  const properties = { ...(system?.properties ?? {}) }
  properties.noxpgain = skillNoXP(system)
  const flags = { ...(system?.flags ?? {}) }
  flags.developement = skillTicked(system)
  // Legacy BRP marked the point source with flat booleans; keep the information
  // on the canonical flag slots so a re-dropped old skill does not lose it.
  if (system?.occupation === true) flags.occupation = true
  if (system?.prsnlty === true) flags.archetype = true
  if (system?.cultural === true) flags.experiencePackage = true
  return {
    base: present(system?.base) ? String(system.base) : '0',
    adjustments: {
      base: adjustments.base,
      personal: adjustments.personal,
      occupation: adjustments.occupation,
      archetype: adjustments.archetype,
      experiencePackage: adjustments.experiencePackage,
      experience: adjustments.experience,
    },
    properties,
    flags,
  }
}

// ---------------------------------------------------------------------------
// One-shot idempotent migration planner (type=skill only).
//
// `raw` is the item's raw source `system` (see skillSourceSystem), because core
// Foundry drops unknown legacy keys from the prepared model. Canonical values
// are never overwritten; legacy values only fill gaps; every legacy key that
// exists is then zeroed so a stale fallback cannot double count. Running the
// planner on an already-migrated document returns `changed: false`.
// ---------------------------------------------------------------------------

export function planSkillMigration(raw = {}) {
  const system = raw ?? {}
  const updates = {}
  const zeroed = []
  const migrated = []

  // Only a legacy key that still carries a value needs zeroing. Once it reads
  // 0/false the document is migrated, which keeps the planner idempotent.
  const legacyValue = (value) => present(value) && Number(value) !== 0
  const legacyFlag = (value) => value === true

  const adopt = (path, value, legacyKey) => {
    if (!present(value)) return
    if (!present(fieldAt(system, path))) {
      updates[path] = value
      migrated.push({ from: legacyKey, to: path, value })
    }
    if (legacyKey && legacyValue(system?.[legacyKey])) {
      zeroed.push(legacyKey)
      updates[`system.${legacyKey}`] = zeroFor(legacyKey)
    }
  }

  adopt('system.adjustments.experience', skillXp(system), 'xp')
  adopt('system.adjustments.personal', system?.personal, 'personal')
  adopt('system.adjustments.occupation', system?.profession, 'profession')
  adopt('system.adjustments.archetype', system?.personality, 'personality')
  adopt('system.adjustments.experiencePackage', system?.culture, 'culture')

  // Booleans: a canonical `false` is data too, so only adopt when the canonical
  // key is missing; the legacy key is cleared only while it is still true.
  if (!hasFlagAt(system, 'properties.noxpgain') && legacyFlag(system?.noXP)) {
    updates['system.properties.noxpgain'] = true
    migrated.push({ from: 'noXP', to: 'system.properties.noxpgain', value: true })
  }
  if (legacyFlag(system?.noXP)) {
    zeroed.push('noXP')
    updates['system.noXP'] = false
  }
  if (!hasFlagAt(system, 'flags.developement') && legacyFlag(system?.improve)) {
    updates['system.flags.developement'] = true
    migrated.push({ from: 'improve', to: 'system.flags.developement', value: true })
  }
  if (legacyFlag(system?.improve)) {
    zeroed.push('improve')
    updates['system.improve'] = false
  }
  if (legacyFlag(system?.oppimprove)) {
    zeroed.push('oppimprove')
    updates['system.oppimprove'] = false
  }
  // Legacy BRP point-source booleans -> canonical source flags.
  const adoptFlag = (legacyKey, path) => {
    if (!legacyFlag(system?.[legacyKey])) return
    if (!hasFlagAt(system, path)) {
      updates[`system.${path}`] = true
      migrated.push({ from: legacyKey, to: `system.${path}`, value: true })
    }
    zeroed.push(legacyKey)
    updates[`system.${legacyKey}`] = false
  }
  adoptFlag('occupation', 'flags.occupation')
  adoptFlag('prsnlty', 'flags.archetype')
  adoptFlag('cultural', 'flags.experiencePackage')
  if (legacyValue(system?.effects)) {
    zeroed.push('effects')
    updates['system.effects'] = 0
  }

  // A no-growth skill can never settle a tick: an imported dirty tick is
  // cleared here so it cannot linger in a development list. This includes a
  // legacy `improve` that the adopt step above just promoted. An absent flag
  // already reads as false, so nothing is written for a clean noXP skill.
  if (skillNoXP(system) && (system?.flags?.developement === true
    || updates['system.flags.developement'] === true)) {
    updates['system.flags.developement'] = false
    migrated.push({ from: 'dirty-tick', to: 'system.flags.developement', value: false })
  }

  // A persisted derived total is legacy noise; the field is derived only.
  if (legacyValue(system?.total)) {
    zeroed.push('total')
    updates['system.total'] = 0
  }

  return {
    changed: Object.keys(updates).length > 0,
    updates,
    migrated,
    zeroed,
    canonical: skillTotalInfo(system),
  }
}

const zeroFor = (key) => (['noXP', 'improve', 'oppimprove'].includes(key) ? false : 0)

const fieldAt = (system, path) => {
  const parts = path.split('.')
  if (parts[0] !== 'system') return undefined
  let cursor = system
  for (const part of parts.slice(1)) {
    cursor = cursor?.[part]
    if (cursor === undefined) return undefined
  }
  return cursor
}

const hasFlagAt = (system, path) => {
  const parts = path.split('.')
  let cursor = system
  for (const part of parts) {
    cursor = cursor?.[part]
    if (cursor === undefined) return false
  }
  return true
}

// Raw source system for a skill item: the live model first (it carries prepared
// values) plus the untyped `_source`/`toObject` layer, which is where core
// Foundry keeps legacy keys the current schema no longer declares.
export function skillSourceSystem(item) {
  let raw = {}
  try {
    raw = item?._source?.system ?? {}
  } catch {
    raw = {}
  }
  if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) {
    try {
      raw = item?.toObject?.(false)?.system ?? {}
    } catch {
      raw = {}
    }
  }
  return { ...raw, ...(item?.system ?? {}) }
}

export const CoCSkillFields = Object.freeze({
  skillNoXP,
  skillTicked,
  skillXp,
  skillAdjustments,
  skillTotal,
  skillTotalInfo,
  skillNoXPUpdate,
  skillTickUpdate,
  skillXpUpdate,
  normalizeSkillSystem,
  planSkillMigration,
  skillSourceSystem,
  LEGACY_SKILL_KEYS,
})
