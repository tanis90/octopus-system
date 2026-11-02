import { BRPCharacterSheet } from '../character.mjs'
import { BRPActorSheetV2 } from '../base-actor-sheet.mjs'
import { BRPCheck } from '../../../apps/check.mjs'
import { BRPCombatRoll } from '../../../combat/combat-roll.mjs'
import BRPDialog from '../../../setup/brp-dialog.mjs'
import {
  COC_EQUIP_STATUS_OPTIONS,
  buildCocArmourView,
  buildCocBackground,
  buildCocGearView,
  buildCocSanityView,
  buildCocSkillGroups,
  buildCocWeaponView,
  resolveCocWeaponSkill,
} from './view-data.mjs'
import { buildPaperBooks, buildPaperEffects, buildPaperMonetary, paperConditionValue } from './paper-view.mjs'
import {
  paperClearConditions,
  paperCreateEffect,
  paperDeleteEffect,
  paperFavoriteItems,
  paperIsFavorite,
  paperOpenEffect,
  paperOpenItem,
  paperReloadWeapon,
  paperToggleCondition,
  paperToggleEffect,
  paperToggleFavorite,
} from './paper-actions.mjs'

const BASE_OPTIONS = foundry.utils.mergeObject(
  BRPActorSheetV2.DEFAULT_OPTIONS,
  BRPCharacterSheet.DEFAULT_OPTIONS,
  { inplace: false },
)

const TAB_IDS = ['skills', 'summary', 'items', 'background', 'growth', 'notes', 'effects']
const STAT_IDS = ['str', 'con', 'siz', 'dex', 'app', 'int', 'pow', 'edu']
const BACKGROUND_KEYS = ['gender', 'culture', 'religion', 'hand', 'height', 'weight']
const BACKGROUND_STORIES = {
  personalDescription: ['个人描述', 'Personal Description'],
  beliefs: ['思想与信念', '思想信念', 'Ideology & Beliefs', 'Ideology and Beliefs'],
  significantPeople: ['重要之人', '重要的人', 'Significant People'],
  meaningfulLocations: ['意义之地', '意义非凡之地', 'Meaningful Locations'],
  treasuredPossessions: ['珍贵之物', '宝贵之物', 'Treasured Possessions'],
  traits: ['特质', 'Traits'],
  injuriesScars: ['创伤与疤痕', '伤疤和恐惧症', 'Injuries & Scars', 'Scars and Phobias'],
  phobiasManias: ['恐惧症与躁狂', 'Phobias and Manias'],
  arcaneTomesSpells: ['秘法典籍与法术', 'Arcane Tomes and Spells'],
  strangeEncounters: ['遭遇怪异实体', 'Encounters with Strange Entities'],
}

function statusBadges(actor) {
  const conditions = actor.system.conditions ?? {}
  const statuses = actor.effects?.contents ?? []
  const hasStatus = (id) => statuses.some((effect) => !effect.disabled && effect.statuses?.has?.(id))
  const badges = []
  if (conditions.tempoInsane?.value === true || hasStatus('tempInsane')) badges.push({ id: 'temporary', label: '临时疯狂', detail: '' })
  if (conditions.indefInsane?.value === true || hasStatus('indefiniteInsane')) badges.push({ id: 'indefinite', label: '不定疯狂', detail: '' })
  if (hasStatus('permaInsane')) badges.push({ id: 'permanent', label: '永久疯狂', detail: '' })
  if (conditions.criticalWounds?.value === true) badges.push({ id: 'major', label: '重伤', detail: '' })
  if (conditions.unconscious?.value === true) badges.push({ id: 'unconscious', label: '昏迷', detail: '' })
  if (conditions.dying?.value === true) badges.push({ id: 'dying', label: '濒死', detail: '' })
  if (conditions.dead?.value === true) badges.push({ id: 'dead', label: '死亡', detail: '' })
  return badges
}

function headerData(actor) {
  const system = actor.system
  const attribs = system.attribs ?? {}
  const percent = (resource) => Number(resource?.max) > 0 ? Math.max(0, Math.min(100, Math.round(Number(resource?.value ?? 0) / Number(resource.max) * 100))) : 0
  const stats = STAT_IDS.map((id) => {
    const source = system.characteristics?.[id] ?? {}
    const value = Number(source.value ?? 0)
    return {
      id,
      label: id.toUpperCase(),
      value,
      half: Math.floor(value / 2),
      fifth: Math.floor(value / 5),
      base: value,
      formula: source.formula ?? '',
    }
  })
  const conditions = [
    ['criticalWounds', '重伤'], ['unconscious', '昏迷'], ['dying', '濒死'], ['dead', '死亡'],
    ['prone', '倒地'], ['tempoInsane', '临时疯狂'], ['indefInsane', '长期疯狂'],
  ].map(([id, label]) => ({ id, label, active: paperConditionValue(actor, id) }))
  const luck = { ...(attribs.lck ?? {}), cap: 99 }
  luck.percent = Math.max(0, Math.min(100, Math.round(Number(luck.value ?? 0) / 99 * 100)))
  return {
    img: actor.img,
    name: actor.name,
    profession: system.infos?.occupation ?? '',
    age: system.infos?.age ?? null,
    sex: system.infos?.sex ?? '',
    residence: system.infos?.residence ?? '',
    playername: system.infos?.playername ?? '',
    hp: { ...(attribs.hp ?? {}), percent: percent(attribs.hp) },
    mp: { ...(attribs.mp ?? {}), percent: percent(attribs.mp) },
    san: buildCocSanityView(attribs.san),
    luck,
    db: attribs.db?.value ?? '—',
    build: attribs.build?.value ?? 0,
    mov: attribs.mov?.value ?? 0,
    armour: attribs.armor?.value ?? 0,
    idea: stats.find((stat) => stat.id === 'int')?.value ?? 0,
    know: stats.find((stat) => stat.id === 'edu')?.value ?? 0,
    stats,
    conditions,
    badges: statusBadges(actor),
    identity: BACKGROUND_KEYS.map((key) => ({ key, value: actor.system[key] ?? '' })),
  }
}

export class CocCharacterSheet extends BRPCharacterSheet {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(BASE_OPTIONS, {
    classes: ['coc-card'],
    position: { width: 1040, height: 780 },
    window: { minimizable: false },
    actions: {
      cocReaction: CocCharacterSheet._onCocReaction,
      cocSkillRoll: CocCharacterSheet._onCocSkillRoll,
      cocStatRoll: CocCharacterSheet._onCocStatRoll,
      cocDamage: CocCharacterSheet._onCocDamage,
      cocWeaponSkill: CocCharacterSheet._onCocWeaponSkill,
      cocSanityRoll: CocCharacterSheet._onCocSanityRoll,
      cocSkillToggle: CocCharacterSheet._onCocSkillToggle,
      cocSkillGroup: CocCharacterSheet._onCocSkillGroup,
      cocWeaponToggle: CocCharacterSheet._onCocWeaponToggle,
      cocKeeper: CocCharacterSheet._onCocKeeper,
      cocInterlude: CocCharacterSheet._onCocInterlude,
      cocDeleteItem: CocCharacterSheet._onCocDeleteItem,
      cocLuckRoll: CocCharacterSheet._onCocLuckRoll,
      cocToggleGrowth: CocCharacterSheet._onCocToggleGrowth,
      cocGrowthModule: CocCharacterSheet._onCocGrowthModule,
      cocUndoGrowth: CocCharacterSheet._onCocUndoGrowth,
      cocBackgroundKeyLink: CocCharacterSheet._onCocBackgroundKeyLink,
      cocPaperFavorites: CocCharacterSheet._onCocPaperFavorites,
      paperToggleFavorite,
      paperOpenItem,
      paperReloadWeapon,
      paperToggleCondition,
      paperToggleEffect,
      paperOpenEffect,
      paperCreateEffect,
      paperDeleteEffect,
      paperClearConditions,
    },
  }, { inplace: false })

  static PARTS = {
    header: { template: 'systems/brp/templates/actor/coc/paper-header.hbs' },
    tabs: { template: 'systems/brp/templates/global/parts/actor-tab-navigation.hbs' },
    favorites: { template: 'systems/brp/templates/actor/coc/paper-favorites.hbs' },
    skills: { template: 'systems/brp/templates/actor/coc/skills.hbs', scrollable: [''] },
    summary: { template: 'systems/brp/templates/actor/coc/summary.hbs', scrollable: [''] },
    items: { template: 'systems/brp/templates/actor/coc/items.hbs', scrollable: [''] },
    background: { template: 'systems/brp/templates/actor/coc/background.hbs', scrollable: [''] },
    growth: { template: 'systems/brp/templates/actor/coc/growth.hbs', scrollable: [''] },
    notes: { template: 'systems/brp/templates/actor/coc/notes.hbs', scrollable: [''] },
    effects: { template: 'systems/brp/templates/actor/coc/paper-effects.hbs', scrollable: [''] },
  }

  _configureRenderOptions(options) {
    super._configureRenderOptions(options)
    options.parts = ['header', 'tabs', 'favorites', ...TAB_IDS]
  }

  _getTabs(parts) {
    const group = 'primary'
    if (!this.tabGroups[group]) this.tabGroups[group] = 'skills'
    return parts.reduce((tabs, partId) => {
      if (TAB_IDS.includes(partId)) {
        tabs[partId] = {
          id: partId,
          group,
          cssClass: this.tabGroups[group] === partId ? 'item active' : 'item',
          label: `CoCCard.Tabs.${partId}`,
        }
      }
      return tabs
    }, {})
  }

  async _preparePartContext(partId, context) {
    if (TAB_IDS.includes(partId)) context.tab = context.tabs[partId]
    return context
  }

  _prepareItems() {}

  async _prepareContext(options) {
    const context = await super._prepareContext(options)
    const actor = this.actor
    const items = [...actor.items]
    const weapons = items.filter((item) => item.type === 'weapon').map((item) => ({
      ...buildCocWeaponView(item, actor), favorite: paperIsFavorite(actor, item.id),
    }))
    const skillGroups = buildCocSkillGroups(items).map((group) => ({
      ...group,
      skills: group.skills.map((skill) => ({ ...skill, favorite: paperIsFavorite(actor, skill.id) })),
    }))
    const skills = skillGroups.flatMap((group) => group.skills)
    const dodge = skills.find((skill) => skill.brpid === 'i.skill.coc.dodge') ?? null
    const counterWeapons = weapons.filter((weapon) => weapon.melee && weapon.attackable)
    const baseBackground = buildCocBackground(actor)
    const header = headerData(actor)
    const mythos = skills.find((skill) => skill.brpid === 'i.skill.coc.cthulhu-mythos')?.total ?? 0
    header.san.mythosPercent = mythos
    const gears = items.filter((item) => ['gear', 'item', 'talent'].includes(item.type)).map((item) => ({
      ...buildCocGearView(item), isTalent: item.type === 'talent',
    }))
    const keyConnections = actor.flags?.brp?.coc?.keyConnections ?? []
    const fieldMap = new Map(baseBackground.fields.map((field) => [field.key, field]))
    const backgroundFields = [
      ['personalDescription', '外貌形象', 'wide'], ['beliefs', '思想信念', ''],
      ['treasuredPossessions', '宝贵之物', ''], ['meaningfulLocations', '意义非凡之地', ''],
      ['significantPeople', '重要之人', ''], ['traits', '特质', 'wide'],
    ].map(([key, label, wide]) => ({
      key, label, wide, value: fieldMap.get(key)?.value ?? '', keyLink: keyConnections.includes(key),
    }))
    const scars = [fieldMap.get('injuriesScars')?.value, fieldMap.get('phobiasManias')?.value].filter(Boolean).join('\n')
    backgroundFields.push({ key: 'injuriesScars', label: '伤疤和恐惧症', wide: 'wide', value: scars, keyLink: keyConnections.includes('injuriesScars') })
    const background = {
      ...baseBackground,
      fields: backgroundFields,
      story: { key: 'arcaneTomesSpells', label: '背景故事', value: fieldMap.get('arcaneTomesSpells')?.value || baseBackground.legacy },
      encounters: { key: 'strangeEncounters', label: '遭遇记录', value: fieldMap.get('strangeEncounters')?.value ?? '' },
    }
    const paperIdentity = [
      ['occupation', '职业'], ['age', '年龄'], ['sex', '性别'],
      ['birthplace', '出生地'], ['residence', '居住地'], ['organization', '组织 / 团体'],
    ].map(([key, label]) => ({ key, label, value: actor.system.infos?.[key] ?? '' }))
    const keySummary = backgroundFields.filter((field) => field.keyLink).map((field) => field.label).join('、') || '无'
    const editor = foundry.applications.ux.TextEditor.implementation
    const keeper = actor.system.description?.keeper ?? ''
    const keeperHtml = keeper ? await editor.enrichHTML(keeper, { async: true, secrets: this.document.isOwner, rollData: actor.getRollData(), relativeTo: actor }) : ''
    const development = { personal: 0, occupation: 0, archetype: 0, experiencePackage: 0, ...(actor.system.development ?? {}) }
    return Object.assign(context, {
      cocHeader: header,
      cocSkillCount: skills.length,
      cocItemCount: items.filter((item) => ['weapon', 'armour', 'gear', 'item', 'talent'].includes(item.type)).length,
      skillGroups,
      quickGroups: skillGroups.map((group) => ({ ...group, skills: group.skills.filter((skill) => skill.total > skill.base) })).filter((group) => group.skills.length),
      weapons,
      armours: items.filter((item) => item.type === 'armour').map(buildCocArmourView),
      gears,
      cocEquipStatusOptions: COC_EQUIP_STATUS_OPTIONS,
      background,
      paperIdentity,
      paperBooks: buildPaperBooks(actor),
      paperMoney: buildPaperMonetary(actor, skills),
      paperEffects: buildPaperEffects(actor),
      dodge,
      counterWeapons,
      cocPaper: {
        showUncommon: actor.system.flags?.skillShowUncommon !== false,
        favorites: paperFavoriteItems(actor).map((item) => ({ ...item, action: item.type === 'skill' ? 'cocSkillRoll' : item.type === 'weapon' ? 'cocWeaponSkill' : 'paperOpenItem' })),
        favoritesExpanded: this._favoritesExpanded !== false,
        development,
        growthSkills: skills.filter((skill) => skill.improve === true || items.find((item) => item.id === skill.id)?.system.improve === true),
        growthLog: actor.flags?.brp?.coc?.growthLog ?? [],
        growthModule: actor.flags?.brp?.coc?.growthModule ?? '默认模组',
        keySummary,
        talentCount: gears.filter((gear) => gear.isTalent).length,
        gearCount: gears.filter((gear) => !gear.isTalent).length,
        keeper,
        keeperHtml,
        sanityLossEvents: (actor.system.sanityLossEvents ?? []).map((entry) => ({
          label: entry.reason ?? entry.label ?? entry.name ?? 'SAN 损失',
          lossLabel: `−${entry.sanLoss ?? entry.loss ?? 0} SAN${entry.immune ? ' · 免疫' : ''}`,
        })),
        mythosHardened: actor.system.flags?.mythosHardened === true,
        mythosInsanityExperienced: actor.system.flags?.mythosInsanityExperienced === true,
      },
      isCoCUse: !this.isEditable || this.actor.system.lock === true,
      isCoCEdit: this.isEditable && this.actor.system.lock !== true,
      canEditSheet: this.isEditable && this.actor.system.lock !== true,
    })
  }

  static async _onCocLuckRoll(event) {
    event.preventDefault()
    const value = Number(this.actor.system.attribs?.lck?.value ?? 0)
    await BRPCheck._trigger({
      rollType: 'LK', cardType: 'NO', label: '幸运', rawScore: value, targetScore: value,
      shiftKey: true, actor: this.document, token: this.document.token,
    })
  }

  static async _onCocToggleGrowth(event, target) {
    event.preventDefault()
    if (!this.isEditable || this.actor.system.lock === true) return
    const item = this.actor.items.get(target.closest('.item')?.dataset.itemId)
    if (!item || item.type !== 'skill' || item.system.noXP === true) return
    await item.update({ 'system.improve': item.system.improve !== true })
  }

  static async _onCocGrowthModule(event) {
    event.preventDefault()
    if (!this.isEditable || this.actor.system.lock === true) return
    const name = this.element.querySelector('[name="cocGrowthModuleName"]')?.value.trim()
    if (!name) return
    await this.actor.update({ 'flags.brp.coc.growthModule': name })
  }

  static async _onCocUndoGrowth(event, target) {
    event.preventDefault()
    if (!this.isEditable || this.actor.system.lock === true) return
    const log = [...(this.actor.flags?.brp?.coc?.growthLog ?? [])]
    const index = log.findIndex((entry) => entry.id === target.dataset.entryId)
    const entry = log[index]
    if (!entry || entry.undone) return
    const item = this.actor.items.get(entry.skillId)
    const gain = Number(entry.gain ?? (Number(entry.after) - Number(entry.before))) || 0
    const xp = Number(item?.system.xp ?? 0)
    if (!item || xp < gain) {
      ui.notifications.warn('技能此后已被其他调整修改，不能按原成长记录撤销。')
      return
    }
    await item.update({ 'system.xp': xp - gain })
    log[index] = { ...entry, undone: true }
    await this.actor.update({ 'flags.brp.coc.growthLog': log })
  }

  static async _onCocBackgroundKeyLink(event, target) {
    event.preventDefault()
    if (!this.isEditable || this.actor.system.lock === true) return
    const key = target.dataset.key
    const current = this.actor.flags?.brp?.coc?.keyConnections ?? []
    const next = current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
    await this.actor.update({ 'flags.brp.coc.keyConnections': next })
  }

  static async _onCocPaperFavorites(event) {
    event.preventDefault()
    this._favoritesExpanded = this._favoritesExpanded === false
    await this.render(false)
  }

  static async _onCocSkillRoll(event, target) {
    event.preventDefault()
    const skill = this.actor.items.get(target.closest('.item')?.dataset.itemId)
    if (!skill) return
    await BRPCheck._trigger({
      rollType: 'SK', cardType: 'NO', skillId: skill.id,
      shiftKey: true, actor: this.document, token: this.document.token,
    })
  }

  static async _onCocStatRoll(event, target) {
    event.preventDefault()
    await BRPCheck._trigger({
      rollType: 'CH', cardType: 'NO', characteristic: target.dataset.characteristic,
      shiftKey: true, actor: this.document, token: this.document.token,
    })
  }

  static async _onCocDamage(event, target) {
    event.preventDefault()
    const weapon = this.actor.items.get(target.closest('.item')?.dataset.itemId)
    if (!weapon) return
    const sourceFormula = typeof weapon.system?.range?.normal?.damage === 'string' ? weapon.system.range.normal.damage.trim() : ''
    if (!sourceFormula) return
    const damageBonus = await BRPCombatRoll.getDamageBonus(this.actor, weapon, '')
    const formula = await BRPCombatRoll.damageAssess(weapon, sourceFormula, damageBonus, '2', 'DM')
    if (!String(formula ?? '').trim()) return
    const roll = await new Roll(formula).evaluate()
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      content: `<div class="coc-damage"><b>${weapon.name}</b><span>${formula}</span></div>`,
      rolls: [roll.toJSON()],
      flags: { brp: { rollType: 'DM', cardType: 'NO' } },
    })
    return roll
  }

  static async _onCocWeaponSkill(event, target) {
    event.preventDefault()
    const weapon = this.actor.items.get(target.closest('.item')?.dataset.itemId)
    const skill = resolveCocWeaponSkill(weapon, this.actor)
    if (!skill) return
    await BRPCheck._trigger({
      rollType: 'SK', cardType: 'NO', skillId: skill.id,
      shiftKey: true, actor: this.document, token: this.document.token,
    })
  }

  static async _onCocSanityRoll(event) {
    event.preventDefault()
    const preset = this.element.querySelector('[name="cocSanLossPreset"]')?.value ?? '1/1D6'
    const pair = preset === 'custom' ? [] : preset.split('/')
    const success = pair[0] ?? this.element.querySelector('[name="cocSanLossSuccess"]')?.value ?? '1'
    const fail = pair[1] ?? this.element.querySelector('[name="cocSanLossFail"]')?.value ?? '1D6'
    await BRPCheck._trigger({
      rollType: 'SN', cardType: 'NO', shiftKey: true,
      sanLossSuccess: success, sanLossFail: fail,
      actor: this.document, token: this.document.token,
    })
  }

  static _onCocSkillToggle(event, target) {
    event.preventDefault()
    const details = target.closest('.item')?.querySelector('[data-coc-skill-details]')
    if (!details) return
    const opening = details.hidden
    this.element.querySelectorAll('[data-coc-skill-details]').forEach((el) => { el.hidden = true })
    details.hidden = !opening
  }

  static _onCocSkillGroup(event, target) {
    event.preventDefault()
    const list = target.closest('.coc-skill-group')?.querySelector('[data-coc-skill-list]')
    if (list) list.hidden = !list.hidden
  }

  static _onCocWeaponToggle(event, target) {
    event.preventDefault()
    const details = target.closest('.item')?.querySelector('[data-coc-weapon-details]')
    if (details) details.hidden = !details.hidden
  }

  _onChangeForm(formConfig, event) {
    if (this.actor.system.lock === true || event.target.closest('[data-coc-local]')) return
    return super._onChangeForm(formConfig, event)
  }

  _onRender(context, options) {
    super._onRender(context, options)
    const root = this.element
    const filterSkills = () => {
      const query = root.querySelector('[data-coc-skill-search]')?.value.trim().toLowerCase() ?? ''
      const showUncommon = root.querySelector('[data-coc-uncommon]')?.checked ?? true
      root.querySelectorAll('[data-coc-skill-group]').forEach((group) => {
        let visible = 0
        group.querySelectorAll('[data-coc-skill-row]').forEach((row) => {
          row.hidden = (!showUncommon && row.dataset.uncommon === 'true') || (query.length > 0 && !row.dataset.name.toLowerCase().includes(query))
          if (!row.hidden) visible += 1
        })
        group.hidden = visible === 0
      })
    }
    root.querySelector('[data-coc-skill-search]')?.addEventListener('input', filterSkills)
    root.querySelector('[data-coc-uncommon]')?.addEventListener('change', async (event) => {
      filterSkills()
      if (this.isEditable) await this.actor.update({ 'system.flags.skillShowUncommon': event.target.checked })
    })
    filterSkills()
    root.querySelector('[data-coc-skill-sort]')?.addEventListener('change', (event) => {
      root.querySelectorAll('[data-coc-skill-list]').forEach((list) => {
        const rows = [...list.querySelectorAll('[data-coc-skill-row]')]
        rows.sort((a, b) => event.target.value === 'name'
          ? a.dataset.name.localeCompare(b.dataset.name, 'zh')
          : Number(b.dataset.total) - Number(a.dataset.total) || a.dataset.name.localeCompare(b.dataset.name, 'zh'))
        rows.forEach((row) => list.appendChild(row))
      })
    })
    const filterItems = () => {
      const query = root.querySelector('[data-coc-item-search]')?.value.trim().toLowerCase() ?? ''
      const status = root.querySelector('[data-coc-item-status]')?.value ?? ''
      root.querySelectorAll('.coc-item-group').forEach((group) => {
        let visible = 0
        group.querySelectorAll('[data-coc-item-card]').forEach((card) => {
          card.hidden = (query && !card.dataset.name.toLowerCase().includes(query)) || (status && card.dataset.status !== status)
          if (!card.hidden) visible += 1
        })
        group.hidden = visible === 0
      })
    }
    root.querySelector('[data-coc-item-search]')?.addEventListener('input', filterItems)
    root.querySelector('[data-coc-item-status]')?.addEventListener('change', filterItems)
    // Item source fields belong to the native item sheet; cards stay read-only in both modes.
    const openItemSheet = (card) => {
      if (!this.isEditable || this.actor.system.lock === true) return
      const item = this.actor.items.get(card.dataset.itemId)
      item?.sheet?.render(true)
    }
    root.querySelectorAll('[data-coc-item-card][data-coc-item-editable]').forEach((card) => {
      card.addEventListener('dblclick', (event) => {
        if (event.target.closest('button, a, input, select, textarea, [data-action]')) return
        openItemSheet(card)
      })
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.target !== card) return
        event.preventDefault()
        openItemSheet(card)
      })
    })
    root.querySelector('[name="counterWeapon"]')?.addEventListener('change', (event) => {
      const total = event.target.selectedOptions[0]?.dataset.total ?? '—'
      const button = root.querySelector('[data-action="cocReaction"]')
      if (button) button.textContent = `${total}%`
    })
    root.querySelectorAll('[data-coc-book-progress]').forEach((input) => {
      input.addEventListener('change', async () => {
        if (!this.isEditable || this.actor.system.lock === true) return
        const index = Number(input.dataset.cocBookProgress)
        const books = foundry.utils.duplicate(this.actor.system.books ?? [])
        if (!Number.isInteger(index) || !books[index]) return
        books[index].progress = Math.max(0, Number(input.value) || 0)
        await this.actor.update({ 'system.books': books })
      })
    })
    root.querySelectorAll('[data-coc-background-key]').forEach((field) => {
      field.addEventListener('change', async () => {
        if (!this.isEditable || this.actor.system.lock === true) return
        const key = field.dataset.cocBackgroundKey
        const titles = BACKGROUND_STORIES[key] ?? []
        const biography = foundry.utils.duplicate(this.actor.system.biography ?? [])
        let story = biography.find((entry) => titles.includes(entry.title))
        if (!story) {
          story = { title: titles[0] ?? key, value: '' }
          biography.push(story)
        }
        story.value = field.value
        await this.actor.update({ 'system.biography': biography })
      })
    })
  }

  static async _onCocReaction(event, target) {
    event.preventDefault()
    const weaponId = this.element.querySelector('[name="counterWeapon"]')?.value
    const weapon = this.actor.items.get(weaponId)
    if (!weapon || weapon.type !== 'weapon' || weapon.system?.properties?.rngd === true) return
    const skill = resolveCocWeaponSkill(weapon, this.actor)
    if (!skill) return
    await BRPCheck._trigger({
      rollType: 'SK', cardType: 'NO', skillId: skill.id,
      shiftKey: true, actor: this.document, token: this.document.token,
    })
  }

  static async _onCocKeeper(event, target) {
    event.preventDefault()
    if (!game.user.isGM) return
    const operation = target.dataset.op
    const reason = String(this.element.querySelector('[name="cocKeeperReason"]')?.value ?? '').trim()
    // Indefinite recovery and permanent clearance need a real recorded reason;
    // the keeper-review marker is a rule mode, not a human explanation.
    if ((operation === 'endIndefinite' || operation === 'clearPermanent') && !reason) {
      ui.notifications?.warn?.('请填写真实理由后再执行该守秘人操作。')
      return
    }
    const options = { actorId: this.actor.id, actorType: 'actor', reason }
    const actions = {
      newDay: () => game.brp.sanity.newDay(options),
      advanceHour: () => game.brp.sanity.advanceTime({ hours: 1 }),
      advanceDay: () => game.brp.sanity.advanceTime({ days: 1 }),
      luckRecovery: () => game.brp.sanity.luckRecovery(options),
      endTemporary: () => game.brp.sanity.endTemporary(options),
      endIndefinite: () => game.brp.sanity.endIndefinite(options),
      clearPermanent: () => game.brp.sanity.clearPermanent(options),
    }
    await actions[operation]?.()
  }

  static async _onCocInterlude(event) {
    event.preventDefault()
    if (!this.isEditable || this.actor.system.lock === true) return
    const { CocInterludeSheet } = await import('./interlude.mjs')
    new CocInterludeSheet({ document: this.document }).render(true)
  }

  static async _onCocDeleteItem(event, target) {
    event.preventDefault()
    if (!this.isEditable || this.actor.system.lock === true) return
    const item = this.actor.items.get(target.closest('.item')?.dataset.itemId)
    if (!item) return
    const confirmed = await BRPDialog.confirm({
      window: { title: game.i18n.localize('BRP.deleteItem') },
      content: `${game.i18n.localize('BRP.deleteConfirm')}<br><strong>${item.name}</strong>`,
    })
    if (confirmed) await item.delete()
  }
}
