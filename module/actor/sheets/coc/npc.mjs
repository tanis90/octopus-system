import { BRPActorSheetV2 } from '../base-actor-sheet.mjs'
import { BRPNPCSheetV2 } from '../npcV2.mjs'
import { BRPCheck } from '../../../apps/check.mjs'
import { BRPCombatRoll } from '../../../combat/combat-roll.mjs'
import { Rules } from '../../../rules/index.mjs'
import BRPDialog from '../../../setup/brp-dialog.mjs'
import {
  buildCocNpcAttackRow,
  buildCocNpcView,
  buildCocNpcWoundsAfterHpEdit,
} from './npc-view-data.mjs'
import { buildPaperBooks, buildPaperEffects, paperConditionValue } from './paper-view.mjs'
import {
  paperAverageCharacteristics,
  paperClearConditions,
  paperCreateEffect,
  paperDeleteEffect,
  paperDeleteMacro,
  paperExecuteMacro,
  paperOpenEffect,
  paperOpenItem,
  paperReloadWeapon,
  paperRollAttacksPerRound,
  paperRollCharacteristics,
  paperToggleCondition,
  paperToggleEffect,
} from './paper-actions.mjs'

const BASE_OPTIONS = foundry.utils.mergeObject(
  BRPActorSheetV2.DEFAULT_OPTIONS,
  BRPNPCSheetV2.DEFAULT_OPTIONS,
  { inplace: false },
)

const TAB_IDS = ['combat', 'skills', 'inventory', 'description', 'keeper', 'effects']
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key)

export class CocNpcSheet extends BRPNPCSheetV2 {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(BASE_OPTIONS, {
    classes: ['coc-card', 'coc-npc-card'],
    position: { width: 960, height: 720 },
    window: { minimizable: false },
    form: {
      handler: CocNpcSheet._updateObject,
      submitOnChange: true,
    },
    actions: {
      cocNpcStatRoll: CocNpcSheet._onCocNpcStatRoll,
      cocNpcSkillRoll: CocNpcSheet._onCocNpcSkillRoll,
      cocNpcAttack: CocNpcSheet._onCocNpcAttack,
      cocNpcDamage: CocNpcSheet._onCocNpcDamage,
      cocNpcDeleteItem: CocNpcSheet._onCocNpcDeleteItem,
      cocLuckRoll: CocNpcSheet._onCocLuckRoll,
      cocSanityRoll: CocNpcSheet._onCocSanityRoll,
      paperRollCharacteristics,
      paperAverageCharacteristics,
      paperRollAttacksPerRound,
      paperExecuteMacro,
      paperDeleteMacro,
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
    header: { template: 'systems/brp/templates/actor/coc/paper-npc-header.hbs' },
    tabs: { template: 'systems/brp/templates/global/parts/actor-tab-navigation.hbs' },
    combat: { template: 'systems/brp/templates/actor/coc/npc-combat.hbs', scrollable: [''] },
    skills: { template: 'systems/brp/templates/actor/coc/npc-skills.hbs', scrollable: [''] },
    inventory: { template: 'systems/brp/templates/actor/coc/npc-inventory.hbs', scrollable: [''] },
    description: { template: 'systems/brp/templates/actor/coc/npc-description.hbs', scrollable: [''] },
    keeper: { template: 'systems/brp/templates/actor/coc/npc-keeper.hbs', scrollable: [''] },
    effects: { template: 'systems/brp/templates/actor/coc/paper-effects.hbs', scrollable: [''] },
  }

  _configureRenderOptions(options) {
    super._configureRenderOptions(options)
    options.parts = ['header', 'tabs', ...TAB_IDS]
  }

  _getTabs(parts) {
    const group = 'primary'
    if (!this.tabGroups[group]) this.tabGroups[group] = 'combat'
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
    if (TAB_IDS.includes(partId) && context.tabs?.[partId]) context.tab = context.tabs[partId]
    return context
  }

  async _prepareContext(options) {
    const context = await BRPActorSheetV2.prototype._prepareContext.call(this, options)
    context.tabs = this._getTabs(options.parts)
    const view = buildCocNpcView(this.actor, { useSAN: context.useSAN === true })
    const editor = foundry.applications.ux.TextEditor.implementation
    const enrich = (content) => (String(content ?? '').trim()
      ? editor.enrichHTML(content, {
        async: true,
        secrets: this.document.isOwner,
        rollData: this.actor.getRollData(),
        relativeTo: this.actor,
      })
      : '')
    view.noteHtml = await enrich(view.note)
    view.descriptionHtml = await enrich(view.description)
    view.skillRows = [...view.skills.common, ...view.skills.remaining].map((skill) => ({
      ...skill,
      half: Math.floor(skill.total / 2),
      fifth: Math.floor(skill.total / 5),
    }))
    for (const power of view.powers) {
      power.descriptionHtml = await enrich(power.description)
      power.isSpell = ['magic', 'psychic', 'sorcery'].includes(power.type)
    }
    view.macros = await Promise.all((this.actor.system.special?.macros ?? []).map(async (entry) => {
      const macro = entry.uuid ? await fromUuid(entry.uuid).catch(() => null) : null
      return { uuid: entry.uuid, name: macro?.name ?? entry.uuid, valid: !!macro }
    }))
    const canEditSheet = this.isEditable === true
    const useMode = this.actor.system?.flags?.locked === true
    return Object.assign(context, {
      cocNpc: view,
      paperBooks: buildPaperBooks(this.actor),
      paperEffects: buildPaperEffects(this.actor),
      cocPaper: {
        canRollAttacksPerRound: /[d@]/i.test(String(this.actor.system.special?.attacksPerRound ?? '').trim()),
        spellCount: view.powers.filter((power) => power.isSpell).length,
        talentCount: view.powers.filter((power) => !power.isSpell).length,
      },
      canEditSheet,
      isCoCUse: !canEditSheet || useMode,
      isCoCEdit: canEditSheet && !useMode,
    })
  }

  _onChangeForm(formConfig, event) {
    // Skill base inputs are handled by the sheet's capture handler; skipping
    // the whole-form submit keeps that edit from also rewriting the header.
    if (this.actor.system.flags?.locked === true || event.target.closest('[data-coc-local], .inline-edit')) return
    return super._onChangeForm(formConfig, event)
  }

  _cocNpcChangeRoot = null

  // The shared inline handler writes the Item source but the shim leaves the
  // Actor's derived total stale until the next prepare pass. Handle the skill
  // source here (same native Item update) and refresh the derived values in
  // the same turn so the card never shows an old current score. One handler
  // per application root: re-renders reuse the frame, so it must not stack.
  _cocNpcSkillSourceChange = async (event) => {
    if (!this.isEditable || this.actor.system?.flags?.locked === true) return
    const input = event.target.closest?.('.inline-edit[data-field="base"]')
    if (!input) return
    event.stopPropagation()
    const item = this.actor.items.get(input.closest('.item')?.dataset.itemId)
    const value = Number(input.value)
    if (!item || !Number.isFinite(value)) return
    await item.update({ 'system.base': value })
    this.actor.prepareData()
    await this.render(false)
  }

  static async _onCocLuckRoll(event) {
    event.preventDefault()
    const value = Number(this.actor.system.attribs?.lck?.value ?? 0)
    await BRPCheck._trigger({
      rollType: 'LK', cardType: 'NO', label: '幸运', rawScore: value, targetScore: value,
      shiftKey: true, actor: this.document, token: this.document.token,
    })
  }

  static async _onCocSanityRoll(event) {
    event.preventDefault()
    const sanLoss = this.actor.system.special?.sanLoss ?? {}
    await BRPCheck._trigger({
      rollType: 'SN', cardType: 'NO', shiftKey: true,
      sanLossSuccess: sanLoss.checkPassed ?? '0', sanLossFail: sanLoss.checkFailled ?? '0',
      actor: this.document, token: this.document.token,
    })
  }

  async _onDrop(event) {
    const raw = event.dataTransfer?.getData('text/plain')
    const data = raw ? JSON.parse(raw) : null
    if (data?.type !== 'Macro') return super._onDrop(event)
    event.preventDefault()
    if (!game.user.isGM) return
    const uuid = data.uuid ?? data.data?.uuid
    if (!uuid) return
    const macros = [...(this.actor.system.special?.macros ?? [])]
    if (!macros.some((entry) => entry.uuid === uuid)) macros.push({ uuid })
    await this.actor.update({ 'system.special.macros': macros })
  }

  _onRender(context, options) {
    super._onRender(context, options)
    this._syncCharacterModeToggle(this.element)
    const root = this.element
    const filter = () => {
      const query = root.querySelector('[data-coc-skill-search]')?.value.trim().toLowerCase() ?? ''
      root.querySelectorAll('[data-coc-skill-row]').forEach((row) => {
        row.hidden = query.length > 0 && !row.dataset.name.toLowerCase().includes(query)
      })
    }
    root.querySelector('[data-coc-skill-search]')?.addEventListener('input', filter)
    root.querySelector('[data-coc-skill-sort]')?.addEventListener('change', (event) => {
      if (event.target.value === 'custom') return
      const list = root.querySelector('[data-coc-skill-list]')
      if (!list) return
      const rows = [...list.querySelectorAll('[data-coc-skill-row]')]
      rows.sort((a, b) => event.target.value === 'name'
        ? a.dataset.name.localeCompare(b.dataset.name, 'zh')
        : Number(b.dataset.total) - Number(a.dataset.total) || a.dataset.name.localeCompare(b.dataset.name, 'zh'))
      rows.forEach((row) => list.appendChild(row))
    })
    root.querySelectorAll('[data-coc-skill-row]').forEach((row) => {
      if (row.dataset.cocDragBound === '1') return
      row.dataset.cocDragBound = '1'
      row.draggable = this.isEditable && this.actor.system?.flags?.locked !== true
      row.addEventListener('dragstart', (event) => { this._cocDragSkillId = row.dataset.itemId; event.dataTransfer?.setData('text/plain', row.dataset.itemId) })
      row.addEventListener('dragover', (event) => event.preventDefault())
      row.addEventListener('drop', async (event) => {
        event.preventDefault()
        if (!this.isEditable || this.actor.system?.flags?.locked === true || !this._cocDragSkillId) return
        const dragged = root.querySelector(`[data-item-id="${this._cocDragSkillId}"]`)
        if (!dragged || dragged === row) return
        const list = row.parentElement
        list.insertBefore(dragged, row)
        const rows = [...list.querySelectorAll('[data-coc-skill-row]')]
        await Promise.all(rows.map((entry, index) => this.actor.items.get(entry.dataset.itemId)?.update({ sort: (index + 1) * 10 })))
        this._cocDragSkillId = null
      })
    })
    if (!this.isEditable || this.actor.system?.flags?.locked === true) return
    if (this._cocNpcChangeRoot !== root) {
      this._cocNpcChangeRoot?.removeEventListener('change', this._cocNpcSkillSourceChange, true)
      this._cocNpcChangeRoot = root
      root.addEventListener('change', this._cocNpcSkillSourceChange, true)
    }
    const openItemSheet = (card) => {
      if (!this.isEditable || this.actor.system?.flags?.locked === true) return
      const item = this.actor.items.get(card.dataset.itemId)
      item?.sheet?.render(true)
    }
    root.querySelectorAll('[data-coc-npc-item][data-coc-npc-editable]').forEach((card) => {
      if (card.dataset.cocNpcItemBound === '1') return
      card.dataset.cocNpcItemBound = '1'
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
  }

  static async _updateObject(event, form, formData) {
    const object = formData?.object
    if (!object) return super._updateObject(event, form, formData)
    const rules = Rules.active().wounds
    if (rules?.woundState && hasOwn(object, 'system.attribs.hp.value')) {
      const currentHp = Math.max(0, Math.floor(Number(this.actor.system.attribs?.hp?.value) || 0))
      const hpMax = Math.max(0, Math.floor(Number(this.actor.system.attribs?.hp?.max) || 0))
      const requested = Number(object['system.attribs.hp.value'])
      if (Number.isFinite(requested)) {
        const hpValue = Math.min(Math.max(Math.floor(requested), 0), hpMax)
        object['system.attribs.hp.value'] = hpValue
        if (hpValue !== currentHp) {
          const state = buildCocNpcWoundsAfterHpEdit({
            wounds: this.actor.flags?.brp?.coc?.wounds ?? {},
            hpValue,
            hpMax,
            previousHpValue: currentHp,
          }, rules)
          if (state) object['flags.brp.coc.wounds'] = state
        }
      }
    }
    if (hasOwn(object, 'system.attribs.mp.value')) {
      const mpMax = Math.max(0, Math.floor(Number(this.actor.system.attribs?.mp?.max) || 0))
      const requested = Number(object['system.attribs.mp.value'])
      if (Number.isFinite(requested)) {
        object['system.attribs.mp.value'] = Math.min(Math.max(Math.floor(requested), 0), mpMax)
      }
    }
    const powEdited = hasOwn(object, 'system.characteristics.pow.value')
      && Number(object['system.characteristics.pow.value']) !== Number(this.actor.system.characteristics.pow.value)
    await super._updateObject(event, form, formData)
    if (powEdited) {
      try {
        await this.actor.initSanity()
      } catch { /* a partial shim without the sanity chain keeps the edit */ }
    }
  }

  static async _onCocNpcStatRoll(event, target) {
    event.preventDefault()
    await BRPCheck._trigger({
      rollType: 'CH', cardType: 'NO', characteristic: target.dataset.characteristic,
      shiftKey: true, actor: this.document, token: this.document.token,
    })
  }

  static async _onCocNpcSkillRoll(event, target) {
    event.preventDefault()
    const item = this.actor.items.get(target.closest('.item')?.dataset.itemId)
    if (!item) return
    await BRPCheck._trigger({
      rollType: 'SK', cardType: 'NO', skillId: item.id,
      shiftKey: true, actor: this.document, token: this.document.token,
    })
  }

  static async _onCocNpcAttack(event, target) {
    event.preventDefault()
    const weapon = this.actor.items.get(target.closest('.item')?.dataset.itemId)
    if (!weapon) return
    const attack = buildCocNpcAttackRow(weapon, this.actor)
    if (attack.attackMode === 'cm') {
      await BRPCheck._trigger({
        rollType: 'CM', cardType: 'NO', itemId: weapon.id, skillId: false,
        shiftKey: true, actor: this.document, token: this.document.token,
      })
      return
    }
    if (attack.attackMode === 'sk' && attack.skillId) {
      await BRPCheck._trigger({
        rollType: 'SK', cardType: 'NO', skillId: attack.skillId,
        shiftKey: true, actor: this.document, token: this.document.token,
      })
    }
  }

  static async _onCocNpcDamage(event, target) {
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

  static async _onCocNpcDeleteItem(event, target) {
    event.preventDefault()
    if (!this.isEditable || this.actor.system.flags?.locked === true) return
    const item = this.actor.items.get(target.closest('.item')?.dataset.itemId)
    if (!item) return
    const confirmed = await BRPDialog.confirm({
      window: { title: game.i18n.localize('BRP.deleteItem') },
      content: `${game.i18n.localize('BRP.deleteConfirm')}<br><strong>${item.name}</strong>`,
    })
    if (confirmed) await item.delete()
  }
}
