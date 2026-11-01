export function buildCocInterludePlan(actor, itemIds, manualIds = []) {
  const items = [...actor.items]
  const finalIds = []
  const rejected = []
  for (const id of itemIds) {
    if (finalIds.includes(id)) {
      rejected.push({ itemId: id, reason: 'duplicate' })
      continue
    }
    const item = items.find((entry) => entry.id === id)
    if (!item) rejected.push({ itemId: id, reason: 'missing' })
    else if (item.type !== 'skill') rejected.push({ itemId: id, reason: 'not-skill' })
    else if (item.system?.noXP === true) rejected.push({ itemId: id, reason: 'no-xp' })
    else if (item.system?.improve !== true && !manualIds.includes(id)) rejected.push({ itemId: id, reason: 'not-ticked' })
    else finalIds.push(id)
  }
  const settle = finalIds.map((itemId) => {
    const item = items.find((entry) => entry.id === itemId)
    return { itemId, name: item.name, preMark: item.system.improve !== true }
  })
  const clear = items.filter((item) => (item.system?.improve === true || item.system?.oppimprove === true)
    && !finalIds.includes(item.id)).map((item) => ({ itemId: item.id, name: item.name }))
  return { settle, clear, rejected }
}
