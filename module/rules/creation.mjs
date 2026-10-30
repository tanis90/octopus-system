// Call of Cthulhu 7e character-creation rules (M2 + M5).
//
// Pure, dependency-free functions shared by the character builder and the
// source-repo build/tests. No Foundry globals, no `eval`, no network: the
// occupation point formula is parsed into a small AST and evaluated from a
// fixed whitelist of characteristics.
//
// Public contract (kept stable for `web/studio-coc`):
//   evaluatePointFormula(formula, stats) -> number        (throws CreationRuleError)
//   normalizePointFormulas(source) -> frozen formula ids   (throws CreationRuleError)
//   isSupportedPointFormula(formula) / isSupportedPointFormulas(source) -> boolean
//   interestPoints(intelligence) -> number                (throws CreationRuleError)
//   validateAllocation({ profession, stats, skills, pointFormula }) -> result object (never throws for data problems)
//   professionRules(packDocumentOrRecord) -> normalized profession (throws CreationRuleError)
//   specialismBrpid(parentKey, specKey) / specialismKey(parentKey, specKey)
//   buildSpecialism({ parentKey, specKey, specName, mainName, base, ... }) -> validated identity
//
// An occupation publishes either one formula (`pointFormula`) or an ordered
// either/or list (`pointFormulas`). The list form exists because some
// occupations print "EDU x 2 + DEX x 2 or EDU x 2 + STR x 2": collapsing that
// to MAX(DEX,STR) would hand out a larger pool than the game does.
//
// Facts come only from public sources; see content/coc/provenance.json. M2/M5
// occupation formulas and credit ranges are recorded there as secondary
// evidence, not as first-party text.

export const CREDIT_RATING_KEY = 'credit-rating'
export const MYTHOS_KEY = 'cthulhu-mythos'

// Zero is a real printed base only for these two skills. Any other explicit
// zero is treated as "forgot to fill it in" and rejected.
const ZERO_BASE_KEYS = new Set([CREDIT_RATING_KEY, MYTHOS_KEY])

// Characteristics usable in an occupation point formula. APP is the CoC name
// for the native `cha` slot; both spellings resolve here.
const STAT_ALIASES = Object.freeze({
  app: ['app', 'cha'],
  cha: ['cha', 'app'],
})

const ALLOWED_STATS = new Set(['EDU', 'INT', 'STR', 'CON', 'SIZ', 'DEX', 'APP', 'POW', 'LUCK'])

// The only occupation formulas the public batches need. Keep this list closed:
// an unknown formula fails closed instead of guessing.
export const POINT_FORMULAS = Object.freeze([
  'EDU*4',
  'EDU*2+DEX*2',
  'EDU*2+APP*2',
  'EDU*2+STR*2',
  'EDU*2+POW*2',
  'EDU*2+MAX(APP,DEX,STR)*2',
  'EDU*2+MAX(DEX,STR)*2',
])

const FORMULA_SET = new Set(POINT_FORMULAS)

export class CreationRuleError extends Error {
  constructor(code, message, detail = undefined) {
    super(message)
    this.name = 'CreationRuleError'
    this.code = code
    this.detail = detail
  }
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isAsciiId(value) {
  return typeof value === 'string' && ID_RE.test(value)
}

export function assertAsciiId(value, label = 'id') {
  if (!isAsciiId(value)) {
    throw new CreationRuleError('id-not-ascii', `${label} 必须是稳定 ASCII kebab-case：${JSON.stringify(value)}`, { label, value })
  }
  return value
}

const statValue = (stats, name) => {
  const key = String(name).toLowerCase()
  const candidates = STAT_ALIASES[key] ?? [key]
  for (const candidate of candidates) {
    const raw = stats?.[candidate]
    if (raw === undefined || raw === null) { continue }
    let value
    if (typeof raw === 'number') {
      value = raw
    } else if (Number.isFinite(Number(raw.total))) {
      value = Number(raw.total)
    } else if (['base', 'redist', 'culture'].some((field) => raw[field] !== undefined)) {
      value = Number(raw.base ?? 0) + Number(raw.redist ?? 0) + Number(raw.culture ?? 0)
    } else {
      throw new CreationRuleError('stat-invalid', `属性 ${name} 不是可用数值`, { name, raw })
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new CreationRuleError('stat-invalid', `属性 ${name} 不是非负数`, { name, value })
    }
    return value
  }
  throw new CreationRuleError('stat-missing', `缺少属性 ${name}`, { name })
}

const parseTerm = (text, source) => {
  const simple = /^([A-Za-z]+)\s*\*\s*(\d+)$/.exec(text)
  if (simple) {
    const stat = simple[1].toUpperCase()
    if (!ALLOWED_STATS.has(stat)) {
      throw new CreationRuleError('formula-unknown-stat', `公式含未授权属性 ${stat}`, { formula: source, stat })
    }
    return { kind: 'stat', stats: [stat], multiplier: Number(simple[2]) }
  }
  const max = /^MAX\s*\(\s*([A-Za-z]+(?:\s*,\s*[A-Za-z]+)+)\s*\)\s*\*\s*(\d+)$/i.exec(text)
  if (max) {
    const names = max[1].split(',').map((name) => name.trim().toUpperCase())
    for (const stat of names) {
      if (!ALLOWED_STATS.has(stat)) {
        throw new CreationRuleError('formula-unknown-stat', `公式含未授权属性 ${stat}`, { formula: source, stat })
      }
    }
    const unique = new Set(names)
    if (unique.size !== names.length || names.length < 2) {
      throw new CreationRuleError('formula-invalid', `MAX 子句需要至少两个不同属性：${text}`, { formula: source, term: text })
    }
    return { kind: 'max', stats: names, multiplier: Number(max[2]) }
  }
  throw new CreationRuleError('formula-invalid', `无法识别的公式项：${text}`, { formula: source, term: text })
}

// Parse a whitelisted formula into an AST. Throws CreationRuleError otherwise.
export function parsePointFormula(formula) {
  if (typeof formula !== 'string' || !formula.trim()) {
    throw new CreationRuleError('formula-invalid', '职业点公式为空', { formula })
  }
  const source = formula.trim()
  const parts = source.split('+').map((part) => part.trim())
  if (parts.some((part) => !part) || parts.length === 0) {
    throw new CreationRuleError('formula-invalid', `公式结构非法：${source}`, { formula: source })
  }
  const terms = parts.map((part) => parseTerm(part, source))
  const id = terms.map((term) => `${term.kind === 'max' ? `MAX(${term.stats.join(',')})` : term.stats[0]}*${term.multiplier}`).join('+')
  if (!FORMULA_SET.has(id)) {
    throw new CreationRuleError('formula-not-allowed', `公式不在白名单：${source}`, { formula: source, normalized: id })
  }
  return Object.freeze({ id, source, terms: Object.freeze(terms.map((term) => Object.freeze(term))) })
}

export function isSupportedPointFormula(formula) {
  try {
    parsePointFormula(formula)
    return true
  } catch {
    return false
  }
}

// Some occupations publish an either/or point formula (e.g. Police Detective:
// "EDU x 2 + DEX x 2" or "EDU x 2 + STR x 2"). A record may therefore carry
// `pointFormulas` (ordered, player picks one). `pointFormula` remains the
// single-formula spelling and keeps working unchanged.
export function normalizePointFormulas(source = {}) {
  const list = Array.isArray(source.pointFormulas)
    ? source.pointFormulas
    : source.pointFormula === undefined || source.pointFormula === null || source.pointFormula === ''
      ? []
      : [source.pointFormula]
  if (!list.length) {
    throw new CreationRuleError('formula-missing', '职业缺少职业点公式', { name: source?.name ?? null })
  }
  const ids = []
  for (const formula of list) {
    const id = parsePointFormula(formula).id
    if (ids.includes(id)) {
      throw new CreationRuleError('formula-duplicate', `职业点公式重复：${id}`, { formula: id })
    }
    ids.push(id)
  }
  return Object.freeze(ids)
}

export function isSupportedPointFormulas(source) {
  try {
    normalizePointFormulas(source)
    return true
  } catch {
    return false
  }
}

// Occupation skill points. Fail closed: unknown formula or missing
// characteristic raises instead of returning 0.
export function evaluatePointFormula(formula, stats) {
  const ast = parsePointFormula(formula)
  let total = 0
  for (const term of ast.terms) {
    const values = term.stats.map((stat) => statValue(stats, stat))
    const picked = term.kind === 'max' ? Math.max(...values) : values[0]
    total += picked * term.multiplier
  }
  return Math.floor(total)
}

// Personal interest points are INT x 2 in CoC 7e (not the UGE INT x 10 pool).
export function interestPoints(intelligence) {
  const value = statValue({ int: intelligence }, 'int')
  return Math.floor(value * 2)
}

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const toInt = (value) => (Number.isInteger(value) ? value : null)

// Identity helpers for specialisms. A specialism is never identified by a
// display name: it needs parentKey + specKey, and an ASCII brpid.
export function specialismKey(parentKey, specKey) {
  assertAsciiId(parentKey, 'parentKey')
  assertAsciiId(specKey, 'specKey')
  if (specKey === 'any') {
    throw new CreationRuleError('spec-key-placeholder', 'specKey 不能是占位值 any', { parentKey, specKey })
  }
  return `${parentKey}/${specKey}`
}

export function specialismBrpid(parentKey, specKey) {
  specialismKey(parentKey, specKey)
  return `i.skill.coc.${parentKey}-${specKey}`
}

// Build a validated specialism identity for the character builder. An
// unverified base value must be supplied explicitly; null/0 are not accepted
// as placeholders.
export function buildSpecialism({
  parentKey,
  specKey,
  specName,
  mainName,
  base,
  baseSource = 'verified',
  baseSourceRefs = [],
} = {}) {
  const brpid = specialismBrpid(parentKey, specKey)
  const key = `${parentKey}-${specKey}`
  const name = typeof specName === 'string' ? specName.trim() : ''
  const parent = typeof mainName === 'string' ? mainName.trim() : ''
  if (!name) { throw new CreationRuleError('spec-name-missing', '专精缺少 specName', { parentKey, specKey }) }
  if (!parent) { throw new CreationRuleError('spec-main-name-missing', '专精缺少 mainName', { parentKey, specKey }) }
  if (baseSource !== 'explicit' && baseSource !== 'verified') {
    throw new CreationRuleError('base-source-invalid', `基础值来源非法：${baseSource}`, { baseSource })
  }
  if (base === null || base === undefined || base === '') {
    throw new CreationRuleError('base-missing', '专精基础值必须显式提供，不得留空', { parentKey, specKey })
  }
  const value = toInt(base)
  if (value === null || value < 0 || value > 100) {
    throw new CreationRuleError('base-out-of-range', `专精基础值必须是 0–100 的整数：${base}`, { parentKey, specKey, base })
  }
  if (value === 0 && baseSource === 'explicit') {
    throw new CreationRuleError('base-explicit-zero', '未证实专精不得以 0 作为显式基础值', { parentKey, specKey })
  }
  if (baseSource === 'verified' && baseSourceRefs.length === 0) {
    throw new CreationRuleError('base-source-unproven', '标为已证实的基础值必须带上来源', { parentKey, specKey })
  }
  return Object.freeze({
    brpid,
    key,
    parentKey,
    specKey,
    specName: name,
    mainName: parent,
    name: `${parent}（${name}）`,
    chosen: true,
    specialism: true,
    base: value,
    baseSource,
    baseSourceRefs: Object.freeze([...baseSourceRefs]),
  })
}

const error = (code, message, extra = {}) => ({ code, message, ...extra })

// Normalize a `coc-professions` document (or a plain record) into the shape
// `validateAllocation` accepts. The pack stores the facts under flags.brp.coc;
// keep that mapping in one place so the builder never hand-copies fields.
export function professionRules(source) {
  if (!isPlainObject(source)) {
    throw new CreationRuleError('profession-missing', '缺少职业数据')
  }
  const coc = source.flags?.brp?.coc
  const fromFlags = isPlainObject(coc)
  const record = fromFlags
    ? {
      slug: coc.slug,
      pointFormula: coc.pointFormula,
      pointFormulas: coc.pointFormulas,
      creditMin: coc.creditMin,
      creditMax: coc.creditMax,
      specialismSlots: coc.specialismSlots ?? [],
      choiceGroups: coc.choiceGroups ?? [],
      fixedSkillKeys: coc.fixedSkillKeys ?? [],
      name: source.name,
      brpid: source.flags?.brp?.brpidFlag?.id,
    }
    : source
  if (fromFlags && source.flags?.brp?.contentSource !== 'coc') {
    throw new CreationRuleError('profession-source-invalid', '职业文档没有 coc 内容来源标记', { name: source.name })
  }
  const creditMin = toInt(record.creditMin)
  const creditMax = toInt(record.creditMax)
  if (creditMin === null || creditMax === null) {
    throw new CreationRuleError('credit-range-missing', '职业缺少信用评级区间，不能建卡', { name: record.name })
  }
  let pointFormulas
  try {
    pointFormulas = normalizePointFormulas(record)
  } catch (thrown) {
    throw new CreationRuleError('formula-not-allowed', `职业点公式缺失或不在白名单：${record.pointFormula ?? record.pointFormulas}`, {
      name: record.name,
      formula: record.pointFormula ?? record.pointFormulas,
      cause: thrown?.code ?? null,
    })
  }
  return Object.freeze({
    ...record,
    creditMin,
    creditMax,
    pointFormula: pointFormulas[0],
    pointFormulas,
    contentSource: 'coc',
  })
}

// Validate a full CoC creation allocation.
//
// Input:
//   profession: { slug?, pointFormula | pointFormulas, creditMin, creditMax } or a pack document
//   stats:      { edu, dex, app|cha, int, str, ... } numbers or stat objects
//   skills:     [{ key, base, baseSource?, baseRequiresExplicit?, occupation, interest,
//                  specialism?, total? }]
//   pointFormula: optional chosen formula for an either/or occupation; must be
//                 one of the profession's `pointFormulas`. Omitted takes the first.
//
// The function never mutates its input and never folds allocation into `base`:
// the returned total is base + occupation + interest.
export function validateAllocation({
  profession,
  stats,
  skills = [],
  requireCreditRating = true,
  requireFullyAllocated = false,
  pointFormula: chosenFormula = null,
} = {}) {
  const errors = []
  const push = (code, message, extra) => errors.push(error(code, message, extra))

  // Accept either a raw record or a `coc-professions` document. A pack
  // document with a missing formula/range must not become a silent default.
  let resolved = profession
  if (isPlainObject(profession) && isPlainObject(profession.flags?.brp?.coc)) {
    try {
      resolved = professionRules(profession)
    } catch (thrown) {
      push(thrown.code ?? 'profession-invalid', thrown.message, thrown.detail)
      resolved = null
    }
  }

  if (!isPlainObject(resolved)) {
    push('profession-missing', '缺少职业（含职业点公式与信用区间）')
  }
  if (!Array.isArray(skills)) {
    push('skills-invalid', 'skills 必须是数组')
    return { valid: false, errors, budgets: null, creditRating: null, totals: [] }
  }

  // An either/or occupation has several formulas; every one must be a
  // whitelisted, evaluable formula, and the caller must pin one of them.
  let formulaOptions = []
  if (isPlainObject(resolved)) {
    try {
      formulaOptions = [...normalizePointFormulas(resolved)]
    } catch (thrown) {
      push(thrown.code === 'formula-missing' ? 'formula-missing' : (thrown.code ?? 'formula-invalid'), thrown.message, thrown.detail)
    }
  }
  let formulaMaxima = []
  for (const option of formulaOptions) {
    try {
      formulaMaxima.push({ formula: option, max: evaluatePointFormula(option, stats) })
    } catch (thrown) {
      push(thrown.code ?? 'formula-invalid', thrown.message, thrown.detail)
      formulaMaxima = []
      break
    }
  }

  let selected = formulaMaxima.length === 1 ? formulaMaxima[0] : null
  if (chosenFormula !== null && chosenFormula !== undefined) {
    const normalized = (() => {
      try { return parsePointFormula(chosenFormula).id } catch { return null }
    })()
    const match = normalized ? formulaMaxima.find((option) => option.formula === normalized) : null
    if (!match) {
      push('formula-not-allowed', `所选职业点公式不属于该职业：${chosenFormula}`, {
        chosen: chosenFormula,
        allowed: formulaMaxima.map((option) => option.formula),
      })
      selected = null
    } else {
      selected = match
    }
  } else if (formulaMaxima.length > 1) {
    // A multi-formula occupation without a pinned choice cannot have a budget:
    // defaulting to the first (or the largest) would silently pick for the player.
    push('formula-choice-required', '该职业有多条职业点公式，必须选定一条', {
      allowed: formulaMaxima.map((option) => option.formula),
    })
  }
  const formulaMax = selected ? selected.max : null
  const formula = selected ? selected.formula : (formulaOptions[0] ?? resolved?.pointFormula ?? null)
  const formulas = formulaMaxima.map((option) => Object.freeze({ ...option }))

  let interestMax = null
  try {
    interestMax = interestPoints(stats?.int)
  } catch (thrown) {
    push(thrown.code ?? 'stat-missing', thrown.message, thrown.detail)
  }

  const creditMin = toInt(resolved?.creditMin)
  const creditMax = toInt(resolved?.creditMax)
  const creditRangeValid = creditMin !== null && creditMax !== null
    && creditMin >= 0 && creditMax <= 99 && creditMin <= creditMax
  if (isPlainObject(resolved) && !creditRangeValid) {
    push('credit-range-invalid', `信用区间非法：${resolved?.creditMin}–${resolved?.creditMax}`, {
      creditMin: resolved?.creditMin,
      creditMax: resolved?.creditMax,
    })
  }
  if (formulaMax !== null && creditRangeValid && creditMin > formulaMax) {
    push('credit-rating-infeasible', `职业点上限 ${formulaMax} 不足以把信用评级提到下限 ${creditMin}`, {
      formulaMax,
      creditMin,
    })
  }

  const totals = []
  const seen = new Set()
  let occupationSpent = 0
  let interestSpent = 0
  let creditRating = null
  let mythos = null

  for (const raw of skills) {
    if (!isPlainObject(raw)) {
      push('skill-invalid', '技能条目必须是对象', { entry: raw })
      continue
    }
    const key = raw.key
    if (!isAsciiId(key)) {
      push('skill-key-invalid', `技能 key 必须是稳定 ASCII：${JSON.stringify(key)}`, { key })
      continue
    }
    if (seen.has(key)) {
      push('duplicate-skill', `技能重复：${key}`, { key })
      continue
    }
    seen.add(key)

    const occupation = raw.occupation ?? 0
    const interest = raw.interest ?? 0
    for (const [field, value] of [['occupation', occupation], ['interest', interest]]) {
      if (!Number.isInteger(value)) {
        push('allocation-not-integer', `${key} 的 ${field} 必须是整数：${value}`, { key, field, value })
      } else if (value < 0) {
        push('allocation-negative', `${key} 的 ${field} 不得为负：${value}`, { key, field, value })
      }
    }
    const occ = Number.isInteger(occupation) && occupation > 0 ? occupation : 0
    const int = Number.isInteger(interest) && interest > 0 ? interest : 0
    occupationSpent += occ
    interestSpent += int

    const base = raw.base
    if (base === null || base === undefined || base === '' || !Number.isFinite(Number(base))) {
      push('base-missing', `${key} 缺少基础值；未证实的基础值必须由用户显式提供，不得按 0 处理`, { key })
    } else {
      const baseValue = Number(base)
      if (!Number.isInteger(baseValue) || baseValue < 0 || baseValue > 100) {
        push('base-out-of-range', `${key} 基础值必须是 0–100 的整数：${base}`, { key, base })
      }
      const baseSource = raw.baseSource ?? 'verified'
      if (baseSource !== 'verified' && baseSource !== 'explicit' && baseSource !== 'derived') {
        push('base-source-invalid', `${key} 基础值来源非法：${baseSource}`, { key, baseSource })
      }
      if (raw.baseRequiresExplicit === true && baseSource !== 'explicit') {
        push('base-explicit-required', `${key} 的基础值未经证实，必须由用户显式填写`, { key, baseSource })
      }
      if (baseSource === 'explicit' && baseValue === 0 && !ZERO_BASE_KEYS.has(key)) {
        push('base-explicit-zero', `${key} 的显式基础值不得为 0（未证实不得以 0 代替）`, { key })
      }
      const expected = baseValue + occ + int
      const supplied = raw.total ?? raw.final
      if (supplied !== undefined && Number(supplied) !== expected) {
        push('base-folded', `${key} 的终值被折叠：给了 ${supplied}，应为 base ${baseValue} + 职业 ${occ} + 兴趣 ${int} = ${expected}`, {
          key,
          supplied,
          expected,
        })
      }
    }

    if (raw.specialism !== undefined) {
      try {
        buildSpecialism(raw.specialism)
      } catch (thrown) {
        push(thrown.code ?? 'specialism-invalid', thrown.message, { key, ...(thrown.detail ?? {}) })
      }
    }

    const baseValue = Number.isFinite(Number(base)) ? Number(base) : 0
    const total = baseValue + occ + int
    totals.push(Object.freeze({ key, base: baseValue, occupation: occ, interest: int, total }))

    if (key === MYTHOS_KEY) {
      mythos = { base: baseValue, occupation: occ, interest: int, total }
      if (occ !== 0 || int !== 0) {
        push('mythos-allocation', '克苏鲁神话不可分配职业点或兴趣点', { key, occupation: occ, interest: int })
      }
    }

    if (key === CREDIT_RATING_KEY) {
      creditRating = { key, base: baseValue, occupation: occ, interest: int, value: total, min: creditMin, max: creditMax, valid: true }
      if (int !== 0) {
        creditRating.valid = false
        push('credit-rating-interest', '信用评级只能用职业点，不能用兴趣点', { interest: int })
      }
      if (profileBaseOk(raw) && baseValue !== 0) {
        creditRating.valid = false
        push('credit-rating-base', `信用评级基础值必须为 0（官方 00），当前 ${baseValue}`, { base: baseValue })
      }
      if (creditRangeValid) {
        if (total < creditMin) {
          creditRating.valid = false
          push('credit-rating-below-min', `信用评级 ${total} 低于职业下限 ${creditMin}`, { value: total, min: creditMin })
        } else if (total > creditMax) {
          creditRating.valid = false
          push('credit-rating-above-max', `信用评级 ${total} 高于职业上限 ${creditMax}`, { value: total, max: creditMax })
        }
      }
    }
  }

  if (requireCreditRating && isPlainObject(resolved) && creditRating === null) {
    push('credit-rating-missing', '建卡必须包含信用评级并落在职业区间内')
  }

  const budgetOk = formulaMax !== null && interestMax !== null
  if (formulaMax !== null && occupationSpent > formulaMax) {
    push('budget-occupation-exceeded', `职业点超出 ${occupationSpent - formulaMax}（上限 ${formulaMax}）`, {
      spent: occupationSpent,
      max: formulaMax,
    })
  }
  if (interestMax !== null && interestSpent > interestMax) {
    push('budget-interest-exceeded', `兴趣点超出 ${interestSpent - interestMax}（上限 ${interestMax}）`, {
      spent: interestSpent,
      max: interestMax,
    })
  }
  if (requireFullyAllocated && formulaMax !== null && occupationSpent < formulaMax) {
    push('budget-occupation-unspent', `职业点还剩 ${formulaMax - occupationSpent}`, { spent: occupationSpent, max: formulaMax })
  }
  if (requireFullyAllocated && interestMax !== null && interestSpent < interestMax) {
    push('budget-interest-unspent', `兴趣点还剩 ${interestMax - interestSpent}`, { spent: interestSpent, max: interestMax })
  }

  return {
    valid: errors.length === 0,
    errors,
    budgets: budgetOk
      ? {
        occupation: {
          formula,
          formulas,
          max: formulaMax,
          spent: occupationSpent,
          remaining: formulaMax - occupationSpent,
        },
        interest: { max: interestMax, spent: interestSpent, remaining: interestMax - interestSpent },
      }
      : null,
    creditRating,
    mythos,
    totals,
  }
}

// CR base is only "OK" when it is a real number; a missing base already
// reported `base-missing`, so do not double-report here.
const profileBaseOk = (raw) => raw?.base !== null && raw?.base !== undefined && raw?.base !== ''
