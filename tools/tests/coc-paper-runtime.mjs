const out = { checks: {}, errors: [] }
const check = (name, ok, detail) => {
  out.checks[name] = ok ? true : { ok: false, detail }
  if (!ok) out.errors.push(`${name}: ${JSON.stringify(detail)}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const stats = Object.fromEntries(['str', 'con', 'siz', 'dex', 'app', 'int', 'pow', 'edu'].map((id) => [id, { value: 60, formula: '3D6*5' }]))
const previousStarter = game.settings.get('brp', 'starterSkills')
const actors = []
try {
  await game.settings.set('brp', 'starterSkills', false)
  const character = await Actor.create({
    name: 'Paper Character', type: 'character',
    system: {
      characteristics: stats,
      attribs: { hp: { value: 10, max: 12 }, mp: { value: 8, max: 10 }, san: { value: 55, max: 99 }, lck: { value: 60 } },
      infos: { occupation: '记者', age: '32', sex: '女', residence: '波士顿', playername: '小明' },
      biography: [{ title: '个人描述', value: '测试外貌' }, { title: '思想与信念', value: '测试信念' }],
      books: [{ name: '测试书', progress: 2, total: 40 }],
      monetary: { cash: '120', assets: '2500', spendingLevel: '10', symbol: '$' },
      development: { personal: 40, occupation: 120, archetype: 0, experiencePackage: 0 },
      lock: false,
      flags: { locked: false },
    },
  }, { renderSheet: false })
  actors.push(character)
  const skill = await Item.create({ name: '侦查', type: 'skill', system: { base: 25, total: 65, improve: true } }, { parent: character, renderSheet: false })
  await character.sheet.render(true)
  check('characterSevenTabs', character.sheet.element.querySelectorAll('.sheet-tabs [data-tab]').length === 7)
  check('characterSharedHeader', character.sheet.element.querySelectorAll('.ability').length === 8 && !!character.sheet.element.querySelector('.favorites'))
  check('characterVariant', character.sheet.element.dataset.variant === 'classic')
  check('characterCloseOnly', character.sheet.element.querySelectorAll('.window-header > .control-close').length === 1)
  check('characterNoVariantButton', !character.sheet.element.querySelector('[data-action="cocPaperVariant"]'))
  check('characterNoTabTooltips', character.sheet.element.querySelectorAll('.sheet-tabs [data-tooltip]').length === 0)
  check('characterPaperSortSelect', !!character.sheet.element.querySelector('select[data-coc-skill-sort]')?.closest('.select-shell'))
  check('characterDefaultsToUse', character.system.lock === true && !character.sheet.element.querySelector('input[name="name"]'))
  character.sheet.element.querySelector('[data-brp-mode-toggle]')?.click()
  await sleep(80)
  check('characterEditNameInput', character.system.lock === false && !!character.sheet.element.querySelector('input[name="name"]'))
  await character.update({ 'system.lock': true })
  await sleep(80)
  check('characterUseNameReadonly', !character.sheet.element.querySelector('input[name="name"]') && !!character.sheet.element.querySelector('h1.name'))
  check('characterUseStatsReadonly', character.sheet.element.querySelectorAll('.ability-input, .vital-value input').length === 0)
  await character.update({ 'system.lock': false })
  await sleep(80)
  check('characterEditNameRestored', !!character.sheet.element.querySelector('input[name="name"]'))
  await character.sheet.close()
  await character.sheet.render(true)
  check('characterReopenDefaultsToUse', character.system.lock === true && !character.sheet.element.querySelector('input[name="name"]'))
  character.sheet.element.querySelector('[data-brp-mode-toggle]')?.click()
  await sleep(80)
  check('characterReopenEditWorks', character.system.lock === false && !!character.sheet.element.querySelector('input[name="name"]'))

  character.sheet.element.querySelector(`[data-item-id="${skill.id}"] [data-action="paperToggleFavorite"]`)?.click()
  await sleep(120)
  check('favoriteWritesLocalList', [...character.sheet.element.querySelectorAll('.favorite')].some((button) => button.dataset.itemId === skill.id), character.sheet.element.querySelector('.favorites-list')?.textContent)
  character.sheet.element.querySelector('[data-condition="criticalWounds"]')?.click()
  await sleep(80)
  check('conditionWritesActor', character.system.conditions.criticalWounds.value === true)
  character.sheet.element.querySelector('[data-key="beliefs"]')?.click()
  await sleep(80)
  check('backgroundKeyMultiSelect', character.flags.brp.coc.keyConnections.includes('beliefs'))
  character.sheet.element.querySelector(`[data-item-id="${skill.id}"] [data-action="cocToggleGrowth"]`)?.click()
  await sleep(80)
  check('growthMarkerWritesItem', skill.system.improve === false, skill.system.improve)
  const bookInput = character.sheet.element.querySelector('[data-coc-book-progress="0"]')
  bookInput.value = '7'
  bookInput.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(40)
  check('bookProgressWritesArray', character.system.books[0].progress === 7)

  const effect = await ActiveEffect.create({ name: 'Paper Effect', changes: [] }, { parent: character })
  await character.sheet.render(true)
  character.sheet.element.querySelector(`[data-effect-id="${effect.id}"] [data-action="paperToggleEffect"]`)?.click()
  await sleep(80)
  check('effectDisable', effect.disabled === true, effect.disabled)
  character.sheet.element.querySelector(`[data-effect-id="${effect.id}"] [data-action="paperDeleteEffect"]`)?.click()
  await sleep(80)
  check('effectDelete', !character.effects.get(effect.id))

  const npc = await Actor.create({
    name: 'Paper NPC', type: 'npc',
    system: {
      characteristics: stats,
      attribs: { hp: { value: 13, max: 13 }, mp: { value: 16, max: 16 }, san: { value: null, max: 99 }, lck: { value: null } },
      infos: { type: '异界生物' },
      special: { attacksPerRound: '1D3', sanLoss: { checkPassed: '0', checkFailled: '1D6' }, movement: [{ value: 8, type: 'swim' }], macros: [{ uuid: 'Macro.missing' }] },
      biography: { personalDescription: { value: '测试描述' } },
      flags: { locked: false, displayFormula: false },
    },
  }, { renderSheet: false })
  actors.push(npc)
  await npc.sheet.render(true)
  check('npcSixTabsCombatDefault', npc.sheet.element.querySelectorAll('.sheet-tabs [data-tab]').length === 6 && npc.sheet.element.querySelector('.sheet-tabs [data-tab="combat"].active') !== null)
  check('npcNoFavorites', !npc.sheet.element.querySelector('.favorites'))
  check('npcResourceValuesValid', !/NaN|undefined/.test(npc.sheet.element.querySelector('.banner')?.textContent ?? ''))
  check('npcCombatFields', npc.sheet.element.textContent.includes('1D3') && npc.sheet.element.textContent.includes('异界生物'))
  check('npcDefaultsToUse', npc.system.flags.locked === true && !npc.sheet.element.querySelector('input[name="name"]'))
  check('npcHasModeToggle', npc.sheet.element.querySelectorAll('[data-brp-mode-toggle]').length === 1)
  check('npcNoFormulaControls', !npc.sheet.element.querySelector('[data-action="cocPaperFormula"], .ability-formula'))
  check('npcNoTabTooltips', npc.sheet.element.querySelectorAll('.sheet-tabs [data-tooltip]').length === 0)
  check('npcPaperSortSelect', !!npc.sheet.element.querySelector('select[data-coc-skill-sort]')?.closest('.select-shell'))
  const messagesBeforeAttacksRoll = game.messages.size
  npc.sheet.element.querySelector('[data-action="paperRollAttacksPerRound"]')?.click()
  await sleep(80)
  check('npcFormulaAttacksRoll', game.messages.size === messagesBeforeAttacksRoll + 1)
  await npc.update({ 'system.special.attacksPerRound': '3' })
  await sleep(80)
  check('npcFixedAttacksNoRollButton', !npc.sheet.element.querySelector('[data-action="paperRollAttacksPerRound"]') && npc.sheet.element.querySelector('.combat-pill')?.textContent.includes('每轮攻击 3'))
  npc.sheet.element.querySelector('[data-brp-mode-toggle]')?.click()
  await sleep(80)
  check('npcEditModeWorks', npc.system.flags.locked === false && !!npc.sheet.element.querySelector('input[name="name"]'))
  npc.sheet.element.querySelector('[data-action="paperAverageCharacteristics"]')?.click()
  await sleep(40)
  check('npcAverageCharacteristics', npc.system.characteristics.str.value === 52, npc.system.characteristics.str.value)
  npc.sheet.element.querySelector('[data-action="paperDeleteMacro"]')?.click()
  await sleep(40)
  check('npcDeleteMacro', npc.system.special.macros.length === 0)

  const vehicle = await Actor.create({
    name: 'Paper Vehicle', type: 'vehicle',
    system: {
      stats: { hp: { value: 42, max: 60 }, build: { value: 2 }, mov: 10, armor: { value: 3 } },
      crew: { total: '驾驶员 1 人；乘员 4 人。' },
      infos: { type: '重型越野车', origin: '岛民改装' },
      properties: { armed: true },
      description: { value: '测试载具描述', keeper: '测试守秘备注' },
    },
  }, { renderSheet: false })
  actors.push(vehicle)
  await vehicle.sheet.render(true)
  check('vehicleSinglePage', vehicle.sheet.element.querySelectorAll('.sheet-tabs [data-tab], .ability, .favorites').length === 0)
  check('vehicleNativeFields', vehicle.sheet.element.querySelectorAll('.vehicle-section').length === 3 && vehicle.sheet.element.textContent.includes('重型越野车') && vehicle.sheet.element.textContent.includes('武装'))
  check('vehicleKeeper', vehicle.sheet.element.textContent.includes('测试守秘备注'))
  check('allSheetsNoVariantButton', actors.every((actor) => !actor.sheet.element.querySelector('[data-action="cocPaperVariant"]')))
} finally {
  try { await game.settings.set('brp', 'starterSkills', previousStarter) } catch { /* shim only */ }
  for (const actor of actors) {
    try { await actor.sheet.close() } catch { /* shim only */ }
    await actor.delete()
  }
}
if (out.errors.length) throw new Error(out.errors.join(' | '))
return out
