import { Rules } from '../rules/index.mjs';
import { LEGACY_SKILL_KEYS, normalizeSkillSystem } from '../rules/coc-skill-fields.mjs';

export class BRPactorItemDrop {

  //A dropped skill is stored canonically: legacy flat score/marker keys are
  //remapped onto adjustments `properties`/`flags` and removed, and the derived
  //`total` is never written. Non-skill items are returned untouched.
  static _canonicalSkillData(nItm) {
    if (nItm?.type !== 'skill') { return nItm }
    const source = nItm.system ?? {}
    const normalized = normalizeSkillSystem(source)
    const system = { ...source }
    for (const key of LEGACY_SKILL_KEYS) { delete system[key] }
    delete system.total
    system.base = normalized.base
    system.adjustments = { ...(system.adjustments ?? {}), ...normalized.adjustments }
    system.properties = normalized.properties
    system.flags = normalized.flags
    nItm.system = system
    return nItm
  }

  // CoC7-native items are stored as-is. Skills keep the computed base score and
  // are canonicalised; every other type relies on the template defaults, so a
  // drop never invents BRP-only fields.
  static async _BRPonDropItemCreate(actor, itemData) {
    const newItemData = [];
    itemData = itemData instanceof Array ? itemData : [itemData];
    for (const thisItem of itemData) {
      const nItm = thisItem.toObject()
      if (nItm.type === 'skill' && nItm.flags?.brp?.coc?.key) {
        nItm.system.base = String(await this._calcBase(nItm, actor))
      }
      if (nItm.type === 'skill') { this._canonicalSkillData(nItm) }
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
