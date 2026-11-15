import { BRPCoCItemSheet } from "./base-item-sheet.mjs";

export class BRPArmorSheet extends BRPCoCItemSheet {
  static DEFAULT_OPTIONS = {
    ...BRPCoCItemSheet.DEFAULT_OPTIONS,
    classes: ['armor'],
  }

  static PARTS = {
    ...BRPCoCItemSheet.PARTS,
    details: {
      template: 'systems/brp/templates/item/armor.detail.hbs',
      scrollable: ['']
    },
  }
}
