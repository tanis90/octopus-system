import { paperFormulaAverage } from './paper-view.mjs'
import {
  applyCocStatus,
  cocConditionValue,
  cocStatusIdOfCondition,
} from '../../coc-status.mjs'

const paperCanEdit = (sheet) => sheet.isEditable && (sheet.actor.type === 'character'
  ? sheet.actor.system.lock !== true
  : sheet.actor.system.flags?.locked !== true)

const favoriteKey = (actor) => `coc-paper-favorites:${game.user.id}:${actor.uuid}`
const readFavorites = (actor) => {
  try {
    const value = JSON.parse(localStorage.getItem(favoriteKey(actor)) ?? '[]')
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []
  } catch { return [] }
}
const writeFavorites = (actor, ids) => {
  try { localStorage.setItem(favoriteKey(actor), JSON.stringify(ids)) } catch { /* local UI preference only */ }
}

export function paperFavoriteItems(actor) {
  const ids = readFavorites(actor)
  return ids.map((id) => actor.items.get(id)).filter(Boolean).map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    total: item.type === 'skill' ? item.system.total : null,
  }))
}

export function paperIsFavorite(actor, id) {
  return readFavorites(actor).includes(id)
}

export async function paperToggleFavorite(event, target) {
  event.preventDefault()
  const id = target.closest('[data-item-id]')?.dataset.itemId
  if (!id || !this.actor.items.get(id)) return
  const ids = readFavorites(this.actor)
  const next = ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id]
  writeFavorites(this.actor, next)
  await this.render(false)
}

export async function paperOpenItem(event, target) {
  event.preventDefault()
  const item = this.actor.items.get(target.closest('[data-item-id]')?.dataset.itemId)
  await item?.sheet?.render(true)
}

const setConditionStatus = async (actor, conditionId, active) => {
  const statusId = cocStatusIdOfCondition(conditionId)
  if (!statusId) return
  if (typeof actor.toggleStatusEffect === 'function') {
    await actor.toggleStatusEffect(statusId, { active })
    return
  }
  await applyCocStatus(actor, statusId, active)
}

export async function paperToggleCondition(event, target) {
  event.preventDefault()
  if (!this.isEditable) return
  const id = target.dataset.condition
  if (!id || !(id in (this.actor.system.conditions ?? {}))) return
  await setConditionStatus(this.actor, id, !cocConditionValue(this.actor, id))
}

export async function paperToggleEffect(event, target) {
  event.preventDefault()
  if (!this.isEditable) return
  const effect = this.actor.effects.get(target.closest('[data-effect-id]')?.dataset.effectId)
  if (effect) await effect.update({ disabled: !effect.disabled })
}

export async function paperOpenEffect(event, target) {
  event.preventDefault()
  const effect = this.actor.effects.get(target.closest('[data-effect-id]')?.dataset.effectId)
  await effect?.sheet?.render(true)
}

export async function paperCreateEffect(event) {
  event.preventDefault()
  if (!paperCanEdit(this)) return
  const effect = await ActiveEffect.create({ name: '新效果', origin: this.actor.uuid, changes: [], disabled: false }, { parent: this.actor })
  await effect?.sheet?.render(true)
}

export async function paperDeleteEffect(event, target) {
  event.preventDefault()
  if (!paperCanEdit(this)) return
  const effect = this.actor.effects.get(target.closest('[data-effect-id]')?.dataset.effectId)
  if (effect) await effect.delete()
}

export async function paperReloadWeapon(event, target) {
  event.preventDefault()
  if (!this.isEditable) return
  const weapon = this.actor.items.get(target.closest('[data-item-id]')?.dataset.itemId)
  if (!weapon || weapon.type !== 'weapon') return
  const capacity = Number(weapon.system.ammo) || 0
  if (capacity <= 0) return
  const current = Number(weapon.system.bullets ?? capacity) || 0
  let next
  if (event.detail > 1) next = event.shiftKey ? current - 1 : 0
  else next = event.shiftKey ? current + 1 : capacity
  next = Math.max(0, Math.min(capacity, next))
  if (next !== current) await weapon.update({ 'system.bullets': next })
}

export async function paperRollAttacksPerRound(event) {
  event.preventDefault()
  const formula = String(this.actor.system.special?.attacksPerRound ?? '').trim()
  if (!/[d@]/i.test(formula)) return
  const roll = await new Roll(formula, this.actor.getRollData?.() ?? {}).evaluate()
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: this.document }),
    content: `<div class="coc-damage"><b>${this.actor.name}</b><span>每轮攻击：${formula}</span></div>`,
    rolls: [roll.toJSON()],
  })
}

export async function paperRollCharacteristics(event) {
  event.preventDefault()
  if (!paperCanEdit(this)) return
  await this.actor.rollCharacteristicsValue()
}

export async function paperAverageCharacteristics(event) {
  event.preventDefault()
  if (!paperCanEdit(this)) return
  const updates = {}
  for (const [id, characteristic] of Object.entries(this.actor.system.characteristics ?? {})) {
    const formula = characteristic?.formula
    if (!formula) continue
    const value = paperFormulaAverage(formula)
    if (value === null) {
      ui.notifications.warn(`${id.toUpperCase()} 的公式暂不支持取平均：${formula}`)
      continue
    }
    updates[`system.characteristics.${id}.value`] = value
  }
  if (Object.keys(updates).length) await this.actor.update(updates)
}

export async function paperExecuteMacro(event, target) {
  event.preventDefault()
  if (!game.user.isGM) return
  const uuid = target.dataset.macroUuid
  const macro = uuid ? await fromUuid(uuid) : null
  if (!macro) return ui.notifications.warn('宏不存在或已失效。')
  await macro.execute({ speaker: ChatMessage.getSpeaker({ actor: this.document }), actor: this.actor, token: this.document.token, event })
}

export async function paperDeleteMacro(event, target) {
  event.preventDefault()
  if (!game.user.isGM || !paperCanEdit(this)) return
  const uuid = target.dataset.macroUuid
  const macros = (this.actor.system.special?.macros ?? []).filter((entry) => entry.uuid !== uuid)
  await this.actor.update({ 'system.special.macros': macros })
}

export async function paperClearConditions(event) {
  event.preventDefault()
  if (!paperCanEdit(this)) return
  for (const id of Object.keys(this.actor.system.conditions ?? {})) {
    if (!cocConditionValue(this.actor, id)) continue
    await setConditionStatus(this.actor, id, false)
  }
}
