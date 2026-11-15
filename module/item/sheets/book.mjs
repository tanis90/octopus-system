import { BRPCoCItemSheet } from "./base-item-sheet.mjs";

export class BRPBookSheet extends BRPCoCItemSheet {
  static DEFAULT_OPTIONS = {
    ...BRPCoCItemSheet.DEFAULT_OPTIONS,
    classes: ['book'],
    position: {
      width: 600,
      height: 700
    },
  }

  static PARTS = {
    ...BRPCoCItemSheet.PARTS,
    details: {
      template: 'systems/brp/templates/item/book.detail.hbs',
      scrollable: ['']
    },
  }
}
