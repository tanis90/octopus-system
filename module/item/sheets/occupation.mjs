import { BRPCoCItemSheet } from "./base-item-sheet.mjs";

export class BRPOccupationSheet extends BRPCoCItemSheet {
  static DEFAULT_OPTIONS = {
    ...BRPCoCItemSheet.DEFAULT_OPTIONS,
    classes: ['occupation'],
    position: {
      width: 640,
      height: 720
    },
  }

  static PARTS = {
    ...BRPCoCItemSheet.PARTS,
    details: {
      template: 'systems/brp/templates/item/occupation.detail.hbs',
      scrollable: ['']
    },
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options)
    const points = this.item.system.occupationSkillPoints ?? {}
    context.attributes = ['str', 'con', 'siz', 'dex', 'app', 'int', 'pow', 'edu'].map((key) => ({
      key,
      label: key.toUpperCase(),
      multiplier: points[key]?.multiplier ?? null,
      selected: points[key]?.selected === true,
      optional: points[key]?.optional === true,
    }))
    return context
  }
}
