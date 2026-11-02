const text = (value) => typeof value === 'string' ? value.trim() : ''

export function buildPaperEffects(actor) {
  return [...(actor?.effects ?? [])].map((effect) => ({
    id: effect.id,
    name: text(effect.name) || '未命名效果',
    img: text(effect.img),
    disabled: effect.disabled === true,
    duration: effect.duration?.label ?? effect.duration?.remaining ?? '',
  }))
}

export function buildPaperBooks(actor) {
  const books = actor?.system?.books
  if (!Array.isArray(books)) return []
  return books.map((book, index) => ({
    id: text(book?._id ?? book?.id) || String(index),
    name: text(book?.name ?? book?.title) || `书籍 ${index + 1}`,
    progress: book?.progress ?? book?.value ?? book?.current ?? 0,
    total: book?.total ?? book?.max ?? book?.pages ?? '—',
  }))
}

export function buildPaperMonetary(actor, skills = []) {
  const monetary = actor?.system?.monetary ?? {}
  const credit = skills.find((skill) => skill.brpid === 'i.skill.coc.credit-rating')?.total ?? 0
  return {
    credit,
    cash: monetary.cash ?? '',
    assets: monetary.assets ?? '',
    spendingLevel: monetary.spendingLevel ?? '',
    symbol: monetary.symbol ?? '$',
    format: monetary.format ?? 'decimalLeft',
  }
}

export function paperConditionValue(actor, id) {
  return actor?.system?.conditions?.[id]?.value === true
}

export function paperFormulaAverage(formula) {
  const source = text(formula).replace(/\s+/g, '').toUpperCase()
  const match = source.match(/^(\d*)D(\d+)(?:\*(\d+(?:\.\d+)?))?([+-]\d+(?:\.\d+)?)?$/)
  if (!match) return null
  const count = match[1] ? Number(match[1]) : 1
  const sides = Number(match[2])
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(sides) || sides < 2) return null
  const multiplier = match[3] ? Number(match[3]) : 1
  const modifier = match[4] ? Number(match[4]) : 0
  const value = count * (sides + 1) / 2 * multiplier + modifier
  return Number.isFinite(value) ? Math.floor(value) : null
}
