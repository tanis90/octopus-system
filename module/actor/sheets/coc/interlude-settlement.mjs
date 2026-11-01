import { BRPCharDev } from '../../../apps/charDev.mjs'
import { Rules } from '../../../rules/index.mjs'
import { buildCocInterludePlan } from './interlude-plan.mjs'

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
    if (item) await item.update({ 'system.improve': false, 'system.oppimprove': false })
  }
  for (const entry of plan.settle) {
    if (!entry.preMark) continue
    const item = actor.items.get(entry.itemId)
    if (item) await item.update({ 'system.improve': true })
  }
  await actor.prepareData()
  const settled = []
  for (const entry of plan.settle) {
    const item = actor.items.get(entry.itemId)
    if (!item) {
      plan.rejected.push({ itemId: entry.itemId, reason: 'missing' })
      continue
    }
    const before = Number(item.system?.total ?? 0)
    const result = await BRPCharDev.xpCheck(actor, token, entry.itemId, 'formula', false)
    if (!result) {
      plan.rejected.push({ itemId: entry.itemId, reason: 'not-ticked' })
      continue
    }
    settled.push({
      itemId: entry.itemId,
      name: result.name,
      before,
      target: result.score,
      roll: result.rollResult,
      improved: result.level === 1,
      gain: result.improvVal,
      after: before + result.improvVal,
    })
  }
  if (settled.length) await BRPCharDev.xpOutput(settled, actor)
  if (requestId) {
    await actor.update({ 'flags.brp.coc.interludeRequests': [...previousRequests, requestId].slice(-20) })
  }
  return { settled, cleared: plan.clear, rejected: plan.rejected }
}
