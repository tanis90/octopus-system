import { skillNoXP, skillSourceSystem, skillTicked } from '../../../rules/coc-skill-fields.mjs'

const itemsOf = (items) => {
  if (Array.isArray(items)) return items
  if (Array.isArray(items?.contents)) return items.contents
  if (typeof items?.[Symbol.iterator] === 'function') return [...items]
  return []
}

const isSkill = (item) => item?.type === 'skill'

export function cocInterludeSelectable(item) {
  return isSkill(item) && !skillNoXP(skillSourceSystem(item))
}

export function initialCocInterludeSelection(items) {
  return itemsOf(items)
    .filter((item) => cocInterludeSelectable(item) && skillTicked(skillSourceSystem(item)))
    .map((item) => item.id)
}

export function buildCocInterludePlan(actor, itemIds, manualIds = []) {
  const items = itemsOf(actor?.items)
  const finalIds = []
  const rejected = []
  for (const id of itemIds) {
    if (finalIds.includes(id)) {
      rejected.push({ itemId: id, reason: 'duplicate' })
      continue
    }
    const item = items.find((entry) => entry.id === id)
    if (!item) rejected.push({ itemId: id, reason: 'missing' })
    else if (!isSkill(item)) rejected.push({ itemId: id, reason: 'not-skill' })
    else if (skillNoXP(skillSourceSystem(item))) rejected.push({ itemId: id, reason: 'no-xp' })
    else if (!skillTicked(skillSourceSystem(item)) && !manualIds.includes(id)) rejected.push({ itemId: id, reason: 'not-ticked' })
    else finalIds.push(id)
  }
  const settle = finalIds.map((itemId) => {
    const item = items.find((entry) => entry.id === itemId)
    return { itemId, name: item.name }
  })
  const clear = items.filter((item) => {
    const source = skillSourceSystem(item)
    return (skillTicked(source) || source.oppimprove === true) && !finalIds.includes(item.id)
  }).map((item) => ({ itemId: item.id, name: item.name }))
  return { settle, clear, rejected }
}
