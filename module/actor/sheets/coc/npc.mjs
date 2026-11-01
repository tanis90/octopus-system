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

const BASE_OPTIONS = foundry.utils.mergeObject(
  BRPActorSheetV2.DEFAULT_OPTIONS,
  BRPNPCSheetV2.DEFAULT_OPTIONS,
  { inplace: false },
)

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key)

export class CocNpcSheet extends BRPNPCSheetV2 {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(BASE_OPTIONS, {
    classes: ['coc-card', 'coc-npc-card'],
    position: { width: 760, height: 840 },
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
    },
  }, { inplace: false })

  static PARTS = {
    sheet: {
      template: 'systems/brp/templates/actor/coc/npc.hbs',
      scrollable: [''],
    },
  }

  _configureRenderOptions(options) {
    super._configureRenderOptions(options)
    options.parts = ['sheet']
  }

  async _prepareContext(options) {
    // The old NPC prepare pass rewrites live Item documents; the card only
    // needs the shared actor context and its own read-only projections.
    const context = await BRPActorSheetV2.prototype._prepareContext.call(this, options)
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
    for (const power of view.powers) {
      power.descriptionHtml = await enrich(power.description)
    }
    const canEditSheet = this.isEditable === true
    const useMode = this.actor.system?.flags?.locked === true
    return Object.assign(context, {
      cocNpc: view,
      canEditSheet,
      isCoCUse: !canEditSheet || useMode,
      isCoCEdit: canEditSheet && !useMode,
    })
  }

  _onChangeForm(formConfig, event) {
    // Skill base inputs are handled by the sheet's capture handler; skipping
    // the whole-form submit keeps that edit from also rewriting the header.
    if (event.target.closest('[data-coc-local], .inline-edit')) return
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

  _onRender(context, options) {
    super._onRender(context, options)
    // Keep the shared window-header toggle label/state in sync with the
    // re-rendered body (and remove it entirely for observers).
    this._syncCharacterModeToggle(this.element)
    if (!this.isEditable || this.actor.system?.flags?.locked === true) return
    const root = this.element
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
