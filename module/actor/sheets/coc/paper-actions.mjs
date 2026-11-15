import { paperFormulaAverage } from './paper-view.mjs'
import BRPDialog from '../../../setup/brp-dialog.mjs'
import { skillSourceSystem, skillTotal } from '../../../rules/coc-skill-fields.mjs'
import {
  applyCocStatus,
  cocConditionValue,
  cocStatusIdOfCondition,
  reviveCocActor,
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
    total: item.type === 'skill' ? skillTotal(skillSourceSystem(item)) : null,
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
  if (!statusId) return { applied: false, error: 'not-a-coc-status', conditionId }
  if (typeof actor.toggleStatusEffect === 'function') {
    return actor.toggleStatusEffect(statusId, { active })
  }
  return applyCocStatus(actor, statusId, active)
}

const notifyStatusError = (result) => {
  if (result?.applied !== false || !result?.error) return
  if (result.error === 'death-is-terminal') {
    ui.notifications.warn('死亡由规则判定，只有 KP 可以撤销。')
    return
  }
  ui.notifications.warn(`状态写入被拒绝（${result.error}）。`)
}

// A rules-declared death is terminal for the toggle, so the keeper gets an
// explicit undo instead of a silent no-op; a manual death marker never reaches
// this branch because it only touches the condition.
const confirmRevive = async (actor) => {
  const confirmed = await BRPDialog.confirm({
    window: { title: '撤销死亡' },
    content: '该角色已被规则判定死亡。撤销死亡并恢复 1 点 HP？',
  })
  if (!confirmed) return
  const result = await reviveCocActor(actor, { reason: 'sheet-toggle' })
  if (result?.applied !== true) notifyStatusError(result)
}

export async function paperToggleCondition(event, target) {
  event.preventDefault()
  if (!this.isEditable) return
  const id = target.dataset.condition
  if (!id || !(id in (this.actor.system.conditions ?? {}))) return
  const result = await setConditionStatus(this.actor, id, !cocConditionValue(this.actor, id))
  if (result?.applied !== false || !result?.error) return
  if (result.error === 'death-is-terminal' && game.user?.isGM === true) {
    await confirmRevive(this.actor)
    return
  }
  notifyStatusError(result)
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
  const refused = []
  for (const id of Object.keys(this.actor.system.conditions ?? {})) {
    if (!cocConditionValue(this.actor, id)) continue
    const result = await setConditionStatus(this.actor, id, false)
    if (result?.applied === false && result?.error) refused.push(result)
  }
  if (!refused.length) return
  // One notice per pass: a terminal death must not scroll the log once per
  // condition, and a keeper needs the pointer to the button that can undo it.
  if (refused.some((entry) => entry.error === 'death-is-terminal')) {
    ui.notifications.warn('规则判定的死亡需在死亡按钮上由 KP 撤销。')
    return
  }
  notifyStatusError(refused[0])
}
