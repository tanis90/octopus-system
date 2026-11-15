import { Rules } from '../rules/index.mjs';

export class BRPactorItemDrop {

  // CoC7-native items are stored as-is. Skills keep the computed base score;
  // every other type relies on the template defaults, so a drop never invents
  // BRP-only fields.
  static async _BRPonDropItemCreate(actor, itemData) {
    const newItemData = [];
    itemData = itemData instanceof Array ? itemData : [itemData];
    for (const thisItem of itemData) {
      const nItm = thisItem.toObject()
      if (nItm.type === 'skill' && nItm.flags?.brp?.coc?.key) {
        nItm.system.base = String(await this._calcBase(nItm, actor))
      }
      newItemData.push(nItm);
    }
    return (newItemData);
  }

  //Calculate Base Skill on Dropping the item on actor
  static async _calcBase(itm, actor) {
    return Rules.for('coc').skillBase({
      item: itm,
      characteristics: actor.system.characteristics,
      useEDU: Rules.for('coc').settings.useEDU()
    })
  }
}
