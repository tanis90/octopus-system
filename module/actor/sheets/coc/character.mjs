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

const BASE_OPTIONS = foundry.utils.mergeObject(
  BRPActorSheetV2.DEFAULT_OPTIONS,
  BRPCharacterSheet.DEFAULT_OPTIONS,
  { inplace: false },
)

const TAB_IDS = ['attributes', 'skills', 'combat', 'items', 'background']
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
  }).filter((stat) => stat.value > 0)
  return {
    img: actor.img,
    name: actor.name,
    profession: system.infos?.occupation ?? '',
    age: system.infos?.age ?? null,
    hp: attribs.hp ?? {},
    mp: attribs.mp ?? {},
    san: buildCocSanityView(attribs.san),
    luck: { ...(attribs.lck ?? {}), cap: 99 },
    db: attribs.db?.value ?? '—',
    build: attribs.build?.value ?? 0,
    mov: attribs.mov?.value ?? 0,
    armour: attribs.armor?.value ?? 0,
    stats,
    badges: statusBadges(actor),
    identity: BACKGROUND_KEYS.map((key) => ({ key, value: actor.system[key] ?? '' })),
  }
}

export class CocCharacterSheet extends BRPCharacterSheet {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(BASE_OPTIONS, {
    classes: ['coc-card'],
    position: { width: 900, height: 850 },
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
    },
  }, { inplace: false })

  static PARTS = {
    header: { template: 'systems/brp/templates/actor/coc/header.hbs' },
    tabs: { template: 'systems/brp/templates/global/parts/actor-tab-navigation.hbs' },
    attributes: { template: 'systems/brp/templates/actor/coc/attributes.hbs', scrollable: [''] },
    skills: { template: 'systems/brp/templates/actor/coc/skills.hbs', scrollable: [''] },
    combat: { template: 'systems/brp/templates/actor/coc/combat.hbs', scrollable: [''] },
    items: { template: 'systems/brp/templates/actor/coc/items.hbs', scrollable: [''] },
    background: { template: 'systems/brp/templates/actor/coc/background.hbs', scrollable: [''] },
  }

  _configureRenderOptions(options) {
    super._configureRenderOptions(options)
    options.parts = ['header', 'tabs', ...TAB_IDS]
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
          tooltip: `CoCCard.Tabs.${partId}`,
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
    const weapons = items.filter((item) => item.type === 'weapon').map((item) => buildCocWeaponView(item, actor))
    const skillGroups = buildCocSkillGroups(items)
    const skills = skillGroups.flatMap((group) => group.skills)
    const dodge = skills.find((skill) => skill.brpid === 'i.skill.coc.dodge') ?? null
    const counterWeapons = weapons.filter((weapon) => weapon.melee && weapon.attackable)
    const background = buildCocBackground(actor)
    const header = headerData(actor)
    const mythos = skills.find((skill) => skill.brpid === 'i.skill.coc.cthulhu-mythos')?.total ?? 0
    header.san.mythosPercent = mythos
    return Object.assign(context, {
      cocHeader: header,
      cocSkillCount: skills.length,
      cocItemCount: items.filter((item) => ['weapon', 'armour', 'gear', 'item', 'talent'].includes(item.type)).length,
      skillGroups,
      weapons,
      armours: items.filter((item) => item.type === 'armour').map(buildCocArmourView),
      gears: items.filter((item) => ['gear', 'item', 'talent'].includes(item.type)).map(buildCocGearView),
      cocEquipStatusOptions: COC_EQUIP_STATUS_OPTIONS,
      background,
      dodge,
      counterWeapons,
      isCoCUse: this.actor.system.flags?.locked === true,
      isCoCEdit: this.actor.system.flags?.locked !== true,
      canEditSheet: this.isEditable,
    })
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
    if (event.target.closest('[data-coc-local]')) return
    return super._onChangeForm(formConfig, event)
  }

  _onRender(context, options) {
    super._onRender(context, options)
    const root = this.element
    root.querySelector('[data-coc-skill-search]')?.addEventListener('input', (event) => {
      const query = event.target.value.trim().toLowerCase()
      root.querySelectorAll('[data-coc-skill-group]').forEach((group) => {
        let visible = 0
        group.querySelectorAll('[data-coc-skill-row]').forEach((row) => {
          row.hidden = query.length > 0 && !row.dataset.name.toLowerCase().includes(query)
          if (!row.hidden) visible += 1
        })
        group.hidden = query.length > 0 && visible === 0
      })
    })
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
    root.querySelectorAll('[data-coc-background-key]').forEach((field) => {
      field.addEventListener('change', async () => {
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
    if (!this.isEditable) return
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
