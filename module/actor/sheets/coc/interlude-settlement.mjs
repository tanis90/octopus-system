import { BRPCharDev } from '../../../apps/charDev.mjs'
import { Rules } from '../../../rules/index.mjs'
import {
  skillSourceSystem,
  skillTickUpdate,
  skillTotalInfo,
  skillXpUpdate,
} from '../../../rules/coc-skill-fields.mjs'
import { buildCocInterludePlan } from './interlude-plan.mjs'

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key)

// Settlement consumes the tick and writes only the canonical growth surface.
// Legacy flat ticks are zeroed when the document still carries them, otherwise
// `skillTicked()` would keep reading the stale fallback. The two writes are
// separate: a schema that rejects the legacy path cannot roll back the
// canonical tick/experience write.
const clearLegacyTicks = async (item, source = {}) => {
  const legacy = {}
  if (hasOwn(source, 'improve')) legacy['system.improve'] = false
  if (hasOwn(source, 'oppimprove')) legacy['system.oppimprove'] = false
  if (!Object.keys(legacy).length) return
  try {
    await item.update(legacy)
  } catch {
    // Unknown legacy field on this data model; the world migration deletes it.
  }
}

async function rollGain(rules) {
  const formula = rules.growth.formula({ xpFormula: game.settings.get('brp', 'xpFormula') })
  const roll = new Roll(formula)
  await roll.evaluate()
  if (game.settings.get('brp', 'xpRollDice') && game.modules?.get?.('dice-so-nice')?.active) {
    game.dice3d.showForRoll(roll, game.user, true, null, false)
  }
  const total = Number(roll.total)
  return Number.isFinite(total) ? total : 0
}

export async function settleCocInterlude(actor, token, itemIds, { manualIds = [], requestId = null } = {}) {
  if (Rules.activeId() !== 'coc') return { error: 'ruleset-not-coc' }
  if (!actor || actor.type !== 'character') return { error: 'actor-missing' }
  if (!game.user.isGM && actor.isOwner !== true) return { error: 'not-authorised' }
  const previousRequests = actor.flags?.brp?.coc?.interludeRequests ?? []
  if (requestId && previousRequests.includes(requestId)) {
    return { alreadySettled: true, settled: [], cleared: [], rejected: [] }
  }
  const plan = buildCocInterludePlan(actor, itemIds, manualIds)
  for (const entry of plan.clear) {
    const item = actor.items.get(entry.itemId)
    if (!item) continue
    const source = skillSourceSystem(item)
    await item.update(skillTickUpdate(false))
    await clearLegacyTicks(item, source)
  }
  await actor.prepareData()
  const settled = []
  const rules = Rules.active()
  for (const entry of plan.settle) {
    const item = actor.items.get(entry.itemId)
    if (!item) {
      plan.rejected.push({ itemId: entry.itemId, reason: 'missing' })
      continue
    }
    const source = skillSourceSystem(item)
    const total = skillTotalInfo(source)
    if (!total.valid) {
      plan.rejected.push({ itemId: entry.itemId, reason: 'invalid-score' })
      continue
    }
    const result = await BRPCharDev.xpRoll(total.total, rules.growth.bonus(actor))
    if (result?.error) {
      plan.rejected.push({ itemId: entry.itemId, reason: result.error })
      continue
    }
    const improved = result?.level === 1
    const gain = improved ? await rollGain(rules) : 0
    const patch = { ...skillTickUpdate(false) }
    if (improved) Object.assign(patch, skillXpUpdate(total.xp + gain))
    await item.update(patch)
    await clearLegacyTicks(item, source)
    settled.push({
      itemId: entry.itemId,
      name: item.name,
      before: total.total,
      target: total.total,
      roll: result?.rollResult ?? result?.diceRoll ?? 0,
      improved,
      gain,
      after: total.total + gain,
      // xpOutput renders the native XP chat card, which reads these names.
      score: total.total,
      diceRoll: result?.diceRoll ?? result?.rollResult ?? 0,
      level: result?.level ?? 0,
      improvVal: gain,
    })
  }
  await actor.prepareData()
  if (settled.length) {
    await BRPCharDev.xpOutput(settled, actor)
    const settlementId = requestId ?? foundry.utils.randomID()
    const module = actor.flags?.brp?.coc?.growthModule ?? '默认模组'
    const timeLabel = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const entries = settled.map((entry) => ({
      id: `${settlementId}:${entry.itemId}`,
      requestId: settlementId,
      module,
      timeLabel,
      skillId: entry.itemId,
      skillName: entry.name,
      before: entry.before,
      after: entry.after,
      gain: entry.gain,
      deltaLabel: `+${entry.gain}`,
      undone: false,
    }))
    const previousLog = actor.flags?.brp?.coc?.growthLog ?? []
    await actor.update({ 'flags.brp.coc.growthLog': [...entries.reverse(), ...previousLog].slice(0, 100) })
    if (requestId) {
      await actor.update({ 'flags.brp.coc.interludeRequests': [...previousRequests, requestId].slice(-20) })
    }
  }
  return { settled, cleared: plan.clear, rejected: plan.rejected }
}
