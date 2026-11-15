import { BRPCheck } from "../apps/check.mjs"
import { isCtrlKey } from '../apps/helper.mjs'
import { BRPID } from '../brpid/brpid.mjs';

const ITEM_ICONS = Object.freeze({
  item: 'systems/brp/assets/Icons/knapsack.svg',
  skill: 'systems/brp/assets/Icons/skills.svg',
  talent: 'systems/brp/assets/Icons/shining-heart.svg',
  weapon: 'systems/brp/assets/Icons/saber-and-pistol.svg',
  armor: 'systems/brp/assets/Icons/lamellar.svg',
  book: 'systems/brp/assets/Icons/scroll-unfurled.svg',
  occupation: 'systems/brp/assets/Icons/blacksmith.svg',
  spell: 'systems/brp/assets/Icons/bolt-spell-cast.svg',
  setup: 'systems/brp/assets/Icons/classical-knowledge.svg',
  status: 'systems/brp/assets/Icons/inverse-aura.svg',
  archetype: 'systems/brp/assets/Icons/inner-self.svg',
  'experience-package': 'systems/brp/assets/Icons/deadly-strike.svg',
  chase: 'systems/brp/assets/Icons/cowled.svg',
});

export class BRPItem extends Item {
  constructor(data, context) {
    if (typeof data.img === 'undefined') {
      data.img = ITEM_ICONS[data.type]
    }
    super(data, context)
  }


  prepareData() {
    super.prepareData();
  }

  prepareDerivedData() {
    const itemData = this;
    const systemData = itemData.system;

    //Set Resource Labels
    if (game.settings.get('brp', 'ppLabelLong')) {
      systemData.powerLabel = game.settings.get('brp', 'ppLabelLong')
    } else {
      systemData.powerLabel = game.i18n.localize('BRP.pp')
    }
    if (game.settings.get('brp', 'ppLabelShort')) {
      systemData.powerLabelAbbr = game.settings.get('brp', 'ppLabelShort')
    } else {
      systemData.powerLabelAbbr = game.i18n.localize('BRP.ppShort')
    }
    if (game.settings.get('brp', 'hpLabelShort')) {
      systemData.healthLabelAbbr = game.settings.get('brp', 'hpLabelShort')
    } else {
      systemData.healthLabelAbbr = game.i18n.localize('BRP.hp')
    }
  }

  getRollData() {
    if (!this.actor) return null;
    const rollData = this.actor.getRollData();
    rollData.item = foundry.utils.deepClone(this.system);
    return rollData;
  }

  async roll() {
    const item = this;
    const actor = this.actor;
    let altKey = event.altKey;
    let ctrlKey = isCtrlKey(event ?? false);
    let cardType = "NO";
    let rollType = ""
    let skillId = "";
    let itemId = "";
    let opp = 'false'
    let shiftKey = event.shiftKey;
    if (game.settings.get('brp', 'switchShift')) {
      shiftKey = !shiftKey
    }
    switch (item.type) {
      case 'skill':
        rollType = "SK"
        skillId = item._id
        if (ctrlKey) { cardType = 'OP' }
        if (altKey) { cardType = 'GR' }
        if (altKey & ctrlKey) { cardType='CO' }
        break
      case 'weapon':
        rollType = "CM"
        itemId = item._id
        skillId = BRPCheck.weaponSkill(actor, actor.items.get(itemId))?._id ?? null
        break
      default:
        item.sheet.render(true);
        return
    }

    BRPCheck._trigger({
      rollType,
      cardType,
      skillId,
      itemId,
      shiftKey,
      actor,
      opp,
    })
  }


  //Add BRPIDs to newly created items
  static async createDocuments(data = [], context = {}) {
    if (context.keepEmbeddedIds === undefined) context.keepEmbeddedIds = false;
    let created = await super.createDocuments(data, context);

    //Add BRPID based on item name if the game setting is flagged.
    for (let item of created) {
      if (game.settings.get('brp', "itemBRPID")) {
        let tempID = await BRPID.guessId(item)
        if (tempID) {
          await item.update({ 'flags.brp.brpidFlag.id': tempID })
          const html = $(item.sheet.element).find('header.window-header a.header-button.edit-brpid-warning,header.window-header a.header-button.edit-brpid-exisiting')
          if (html.length) {
            html.css({
              color: (tempID ? 'orange' : 'red')
            })
          }
          item.render()
        }
      }
    }
    return created
  }

  async _preDelete(options, user) {
    if (this.parent) {
      const ids = this.parent.effects.filter(e => e.origin === this.uuid).map(e => e.id)
      if (ids.length) {
        await this.parent.deleteEmbeddedDocuments('ActiveEffect', ids)
      }
    }
    return super._preDelete(options, user);
  }

  /** @override */
  static async _onCreateOperation(documents, operation, user) {
    super._onCreateOperation(documents, operation, user)
    /* Copied from FoundryVTT v12 item.js replacing Actor with ActorDelta */
    if ( !(operation.parent instanceof ActorDelta) || !CONFIG.ActiveEffect.legacyTransferral || !user.isSelf ) return;
    const cls = getDocumentClass("ActiveEffect");

    // Create effect data
    const toCreate = [];
    for ( let item of documents ) {
      for ( let e of item.effects ) {
        if ( !e.transfer ) continue;
        const effectData = e.toJSON();
        effectData.origin = item.uuid;
        toCreate.push(effectData);
      }
    }

    // Asynchronously create transferred Active Effects
    operation = {...operation};
    delete operation.data;
    operation.renderSheet = false;
    // noinspection ES6MissingAwait
    cls.createDocuments(toCreate, operation);
  }
}
