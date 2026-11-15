import { BRPCoCItemSheet } from "./base-item-sheet.mjs";

export class BRPSpellSheet extends BRPCoCItemSheet {
  static DEFAULT_OPTIONS = {
    ...BRPCoCItemSheet.DEFAULT_OPTIONS,
    classes: ['spell'],
    position: {
      width: 600,
      height: 700
    },
  }

  static PARTS = {
    ...BRPCoCItemSheet.PARTS,
    details: {
      template: 'systems/brp/templates/item/spell.detail.hbs',
      scrollable: ['']
    },
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options)
    context.spellTypes = ['bind', 'call', 'combat', 'contact', 'dismiss', 'enchantment', 'gate', 'summon']
      .map((key) => ({
        key,
        label: 'BRP.spellType.' + key,
        checked: this.item.system.type?.[key] === true,
      }))
    return context
  }
}
