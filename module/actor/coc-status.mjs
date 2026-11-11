// One status vocabulary for native CoC Actors. The card writes the native
// `system.conditions` flags, the Token HUD reads `actor.statuses` and calls
// `actor.toggleStatusEffect`, and the damage chain writes
// `flags.brp.coc.wounds`. All three are projected and written here.
//
// Storage is deliberately not collapsed into one boolean: conditions are the
// native sheet state, ActiveEffects carry the Foundry status/episode lifecycle
// and `flags.brp.coc.wounds` is the damage audit trail. This module is the only
// mapping between them; no sheet or HUD may invent its own alias.

const WOUND_CONDITIONS = Object.freeze({
  criticalWounds: 'majorWound',
  unconscious: 'unconscious',
  dying: 'dying',
  dead: 'dead',
})

const CONDITION_STATUS = Object.freeze({
  criticalWounds: 'criticalWounds',
  unconscious: 'unconscious',
  dying: 'dying',
  dead: 'dead',
  prone: 'prone',
  tempoInsane: 'tempInsane',
  indefInsane: 'indefiniteInsane',
})

const STATUS_CONDITION = Object.freeze(Object.fromEntries(
  Object.entries(CONDITION_STATUS).map(([condition, status]) => [status, condition]),
))

const STATUS_ALIASES = Object.freeze({
  tempoInsane: 'tempInsane',
  tempInsane: 'tempInsane',
  indefInsane: 'indefiniteInsane',
  indefiniteInsane: 'indefiniteInsane',
  permaInsane: 'permaInsane',
  criticalWounds: 'criticalWounds',
  unconscious: 'unconscious',
  dying: 'dying',
  dead: 'dead',
  prone: 'prone',
})

export const COC_STATUS_EFFECTS = Object.freeze([
  Object.freeze({ id: 'criticalWounds', nameKey: 'BRP.cocStatus.criticalWounds', icon: 'systems/brp/assets/Icons/arm-bandage.svg' }),
  Object.freeze({ id: 'unconscious', nameKey: 'BRP.cocStatus.unconscious', icon: 'systems/brp/assets/Icons/broken-shield.svg' }),
  Object.freeze({ id: 'dying', nameKey: 'BRP.cocStatus.dying', icon: 'systems/brp/assets/Icons/shining-heart.svg' }),
  Object.freeze({ id: 'dead', nameKey: 'BRP.cocStatus.dead', icon: 'systems/brp/assets/Icons/drop.svg' }),
  Object.freeze({ id: 'prone', nameKey: 'BRP.cocStatus.prone', icon: 'systems/brp/assets/Icons/cowled.svg' }),
  Object.freeze({ id: 'tempInsane', nameKey: 'BRP.madness.tempInsane', icon: 'systems/brp/assets/Icons/drama-masks.svg' }),
  Object.freeze({ id: 'indefiniteInsane', nameKey: 'BRP.madness.indefiniteInsane', icon: 'systems/brp/assets/Icons/drama-masks.svg' }),
  Object.freeze({ id: 'permaInsane', nameKey: 'BRP.madness.permaInsane', icon: 'systems/brp/assets/Icons/inner-self.svg' }),
])

const text = (value) => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

const toItems = (source) => {
  if (!source) return []
  if (Array.isArray(source)) return source
  if (Array.isArray(source.contents)) return source.contents
  if (typeof source.values === 'function') return Array.from(source.values())
  if (typeof source[Symbol.iterator] === 'function') return Array.from(source)
  if (typeof source === 'object') return Object.values(source)
  return []
}

const effectCarries = (effect, id) => {
  const statuses = effect?.statuses
  const has = (value) => {
    if (typeof statuses?.has === 'function') return statuses.has(value)
    if (Array.isArray(statuses)) return statuses.includes(value)
    return false
  }
  return has(id)
    || (id === 'tempInsane' && has('tempoInsane'))
    || (id === 'indefiniteInsane' && has('indefInsane'))
}

const effectHasStatus = (effect, id) => !!effect
  && effect.disabled !== true
  && effect.isSuppressed !== true
  && effectCarries(effect, id)

const effectFor = (actor, id) => toItems(actor?.effects)
  .find((effect) => effectHasStatus(effect, id)) ?? null

const anyEffectFor = (actor, id) => toItems(actor?.effects)
  .find((effect) => effectCarries(effect, id)) ?? null

export function canonicalCocStatusId(id) {
  return STATUS_ALIASES[text(id)] ?? null
}

export function cocConditionIdOf(statusId) {
  return STATUS_CONDITION[canonicalCocStatusId(statusId)] ?? null
}

export function cocStatusIdOfCondition(conditionId) {
  return CONDITION_STATUS[text(conditionId)] ?? null
}

export function cocWounds(actor) {
  const wounds = actor?.flags?.brp?.coc?.wounds
  return wounds && typeof wounds === 'object' ? wounds : {}
}

function sanityInsanity(actor) {
  const native = actor?.flags?.brp?.coc?.sanity?.insanity
  const legacy = actor?.system?.sanity?.insanity
  const source = native && typeof native === 'object' ? native : (legacy && typeof legacy === 'object' ? legacy : {})
  return source
}

/**
 * Whether one native condition is active. Conditions are the sheet state, but
 * the projection also accepts the wounds audit trail and the persisted sanity
 * episode so a stale condition cannot hide a real state after a refresh.
 * @param {object} actor
 * @param {string} conditionId
 * @returns {boolean}
 */
export function cocConditionValue(actor, conditionId) {
  const id = text(conditionId)
  const conditions = actor?.system?.conditions ?? {}
  if (conditions[id]?.value === true) return true
  const woundField = WOUND_CONDITIONS[id]
  if (woundField && cocWounds(actor)[woundField] === true) return true
  const insanity = sanityInsanity(actor)
  if (id === 'tempoInsane' && insanity.temporary?.active === true) return true
  if (id === 'indefInsane' && insanity.indefinite?.active === true) return true
  return false
}

/**
 * Whether a canonical status is live. ActiveEffect statuses win first, then the
 * native condition/wounds/sanity projection.
 * @param {object} actor
 * @param {string} statusId
 * @returns {boolean}
 */
export function cocStatusActive(actor, statusId) {
  const id = canonicalCocStatusId(statusId)
  if (!id) return false
  if (id === 'permaInsane') {
    return !!effectFor(actor, id) || sanityInsanity(actor).permanent === true
  }
  if (effectFor(actor, id)) return true
  const conditionId = cocConditionIdOf(id)
  return conditionId ? cocConditionValue(actor, conditionId) : false
}

/**
 * Complete Set of live CoC status ids, merged with the raw ActiveEffect
 * statuses. Callers (BRPActor#statuses) can add this to the host's own set.
 * @param {object} actor
 * @returns {Set<string>}
 */
export function cocStatusIds(actor) {
  const statuses = new Set()
  for (const effect of toItems(actor?.effects)) {
    if (!effect || effect.disabled === true || effect.isSuppressed === true) continue
    for (const id of toItems(effect.statuses)) statuses.add(text(id))
  }
  for (const effect of toItems(actor?.effects)) {
    if (effect?.disabled === true) continue
    if (effectHasStatus(effect, 'tempoInsane')) statuses.add('tempInsane')
    if (effectHasStatus(effect, 'indefInsane')) statuses.add('indefiniteInsane')
  }
  for (const id of Object.keys(STATUS_ALIASES)) {
    const canonical = canonicalCocStatusId(id)
    if (canonical && cocStatusActive(actor, canonical)) statuses.add(canonical)
  }
  return statuses
}

/**
 * Condition writes for one persisted wound state. The damage/treatment chain
 * appends these to its single actor.update so HP, flags and the native
 * conditions cannot be observed out of step.
 * @param {object} state `flags.brp.coc.wounds`
 * @returns {Record<string, boolean>}
 */
export function cocWoundConditionWrites(state = {}) {
  return {
    'system.conditions.criticalWounds.value': state?.majorWound === true,
    'system.conditions.unconscious.value': state?.unconscious === true,
    'system.conditions.dying.value': state?.dying === true,
    'system.conditions.dead.value': state?.dead === true,
  }
}

function effectLabel(statusId) {
  const definition = COC_STATUS_EFFECTS.find((entry) => entry.id === statusId)
  if (!definition) return statusId
  try {
    return globalThis.game?.i18n?.localize?.(definition.nameKey) ?? statusId
  } catch {
    return statusId
  }
}

async function createStatusEffect(actor, statusId) {
  const ActiveEffectClass = globalThis.ActiveEffect
  if (typeof ActiveEffectClass?.createDocuments !== 'function') return null
  const definition = COC_STATUS_EFFECTS.find((entry) => entry.id === statusId)
  if (!definition) return null
  const [effect] = await ActiveEffectClass.createDocuments([{
    name: effectLabel(statusId),
    icon: definition.icon,
    statuses: [statusId],
    disabled: false,
  }], { parent: actor })
  return effect ?? null
}

async function removeStatusEffects(actor, statusId) {
  for (const effect of toItems(actor?.effects)) {
    if (!effect) continue
    const own = effectCarries(effect, statusId)
    if (own && typeof effect.delete === 'function') await effect.delete()
  }
}

function conditionPatch(conditionId, active) {
  return { [`system.conditions.${conditionId}.value`]: !!active }
}

async function setCondition(actor, conditionId, active, { extra = {} } = {}) {
  if (!conditionId) return
  if (conditionId === 'tempoInsane') {
    const current = actor?.system?.conditions?.tempoInsane ?? { value: false, realTime: false, duration: 0 }
    await actor.update({
      'system.conditions.tempoInsane': {
        ...current,
        value: !!active,
        realTime: false,
        duration: active ? current.duration ?? 0 : 0,
      },
      ...extra,
    })
    return
  }
  await actor.update({ ...conditionPatch(conditionId, active), ...extra })
}

async function setWoundStatus(actor, statusId, active) {
  const conditionId = statusId
  const woundField = WOUND_CONDITIONS[statusId]
  // Death is terminal in the damage chain. A status toggle may mark it, but it
  // must not clear the audit flag and silently make First Aid/healing revive.
  if (statusId === 'dead' && active === false && cocWounds(actor).dead === true) {
    return { applied: false, error: 'death-is-terminal', statusId, conditionId, active: true }
  }
  const patch = { [`system.conditions.${conditionId}.value`]: !!active }
  if (woundField) {
    patch['flags.brp.coc.wounds'] = { ...cocWounds(actor), [woundField]: !!active }
  }
  await actor.update(patch)
  return { applied: true, statusId, conditionId, active: !!active, wounds: !!woundField }
}

async function endThroughChain(method, actor, reason, options) {
  const handler = options?.[method]
  if (typeof handler === 'function') {
    return handler(actor, { reason })
  }
  try {
    const { BRPSanity } = await import('../apps/sanity.mjs')
    return await BRPSanity[method]({ actor, reason })
  } catch (error) {
    return { error: 'madness-chain-unavailable', detail: String(error?.message ?? error) }
  }
}

async function setPermanentStatus(actor, active, options) {
  if (active) {
    // Permanent insanity is a SAN-zero/keeper settlement, never a free HUD
    // checkbox. The existing chain stays the only way to create it.
    return { applied: false, error: 'permanent-insanity-requires-sanity' }
  }
  const insanity = sanityInsanity(actor)
  if (insanity.permanent === true) {
    return endThroughChain('clearPermanent', actor, 'status-toggle', options)
  }
  await removeStatusEffects(actor, 'permaInsane')
  return { applied: true, statusId: 'permaInsane', active: false }
}

async function setMadnessStatus(actor, statusId, active, options) {
  const conditionId = cocConditionIdOf(statusId)
  if (!active) {
    const insanity = sanityInsanity(actor)
    if (statusId === 'tempInsane' && insanity.temporary?.active === true) {
      return endThroughChain('endTemporary', actor, 'status-toggle', options)
    }
    if (statusId === 'indefiniteInsane' && insanity.indefinite?.active === true) {
      return endThroughChain('endIndefinite', actor, 'status-toggle', options)
    }
    await removeStatusEffects(actor, statusId)
    await setCondition(actor, conditionId, false)
    return { applied: true, statusId, conditionId, active: false }
  }
  const insanity = sanityInsanity(actor)
  if ((statusId === 'tempInsane' && insanity.temporary?.active === true)
    || (statusId === 'indefiniteInsane' && insanity.indefinite?.active === true)) {
    // A real episode already owns its effect and flags. Do not turn it into a
    // bare marker effect; just make the native mirror agree with it.
    await setCondition(actor, conditionId, true)
    return { applied: true, statusId, conditionId, active: true, episode: true }
  }
  const effect = anyEffectFor(actor, statusId)
  if (!effect) await createStatusEffect(actor, statusId)
  else if (effect.disabled === true && typeof effect.update === 'function') {
    await effect.update({ disabled: false })
  }
  await setCondition(actor, conditionId, true)
  return { applied: true, statusId, conditionId, active: true }
}

/**
 * The one write entry for a CoC status. Wound statuses write the native
 * condition plus the matching `flags.brp.coc.wounds` field; madness statuses
 * use the episode chain when a real episode is active and a plain marker when
 * it is not. Permanent insanity is never created here.
 * @param {object} actor
 * @param {string} statusId status id or condition alias
 * @param {boolean} active desired state
 * @param {{endTemporary?: Function, endIndefinite?: Function, clearPermanent?: Function}} [options]
 *   test/integration seams for the existing episode chain
 * @returns {Promise<object>} write result
 */
export async function applyCocStatus(actor, statusId, active, options = {}) {
  if (!actor) return { error: 'actor-missing' }
  const id = canonicalCocStatusId(statusId)
  if (!id) return { error: 'not-a-coc-status', statusId: text(statusId) }
  const desired = active === true
  if (id === 'permaInsane') return setPermanentStatus(actor, desired, options)
  if (id in WOUND_CONDITIONS || id === 'prone') return setWoundStatus(actor, id, desired)
  return setMadnessStatus(actor, id, desired, options)
}

export const CoCStatus = Object.freeze({
  COC_STATUS_EFFECTS,
  canonicalCocStatusId,
  cocConditionIdOf,
  cocStatusIdOfCondition,
  cocWounds,
  cocConditionValue,
  cocStatusActive,
  cocStatusIds,
  cocWoundConditionWrites,
  applyCocStatus,
})
