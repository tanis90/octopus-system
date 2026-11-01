import { CoCRules } from './coc.mjs'

export const RULESET_IDS = Object.freeze(['coc'])

// `brp` and `octopus` remain container/import identifiers. The live actor
// schema and runtime rules are CoC; the old BRP adapter is not a fallback.
export const RULESET_ALIASES = Object.freeze({
  octopus: 'coc',
  coc: 'coc',
  coc7: 'coc',
})

const REGISTRY = Object.freeze({
  coc: CoCRules,
})

export const DEFAULT_RULESET = 'coc'

export function normalizeRulesetId(value) {
  return RULESET_ALIASES[value] ?? DEFAULT_RULESET
}

export function getRulesetId() {
  try {
    return normalizeRulesetId(game.settings.get('brp', 'ruleset'))
  } catch {
    return DEFAULT_RULESET
  }
}

export function getRules(value) {
  const id = value === undefined ? getRulesetId() : normalizeRulesetId(value)
  return REGISTRY[id] ?? CoCRules
}

// Content provenance: only CoC documents carry an explicit marker. Existing
// octopus/UGE documents have no marker and are therefore octopus by default.
export function contentSourceOf(document) {
  const marker = document?.flags?.brp?.contentSource
  return marker === 'coc' ? 'coc' : 'octopus'
}

export const Rules = Object.freeze({
  ids: RULESET_IDS,
  defaultId: DEFAULT_RULESET,
  aliases: RULESET_ALIASES,
  normalizeId: normalizeRulesetId,
  for(id) {
    return getRules(id)
  },
  active: getRules,
  activeId: getRulesetId,
  contentSourceOf,
})
