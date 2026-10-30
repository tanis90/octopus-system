import { registerSheets } from '../setup/register-sheets.mjs'
import { BRPID } from '../brpid/brpid.mjs'
import { BRPActor } from '../actor/actor.mjs'
import { BRPItem } from '../item/item.mjs'
import { BRP } from "../setup/config.mjs";
import ChaosiumCanvasInterfaceInit from '../apps/chaosium-canvas-interface-init.mjs'
import { registerSettings } from '../settings/register-settings.mjs'
import { handlebarsHelper } from '../setup/handlebar-helper.mjs';
import { BRPCombat } from "../combat/combat.mjs";
import { BRPCombatTracker } from "../combat/combat-tracker.mjs";
import { BRPActiveEffect } from "../apps/active-effect.mjs";
import { BRPCheck } from '../apps/check.mjs';
import { BRPMadness } from '../apps/madness.mjs';
import { BRPLuck } from '../apps/luck.mjs';
import { BRPCharDev } from '../apps/charDev.mjs';
import { BRPSystemSocket } from '../apps/socket.mjs';
import { BRPSanity, bindSanityCheck } from '../apps/sanity.mjs';
import { BRPWorldTime } from '../apps/worldTime.mjs';
import { Rules } from '../rules/index.mjs';

export default function Init() {
  bindSanityCheck(BRPCheck);
  //Add classes to global game object
  game.brp = {
    BRPActor,
    BRPItem,
    BRPCheck,
    BRPMadness,
    BRPLuck,
    BRPCharDev,
    BRPSystemSocket,
    BRPSanity,
    BRPWorldTime,
    rules: Rules,
    //Native CoC combat/wound entry points (no chat-DOM dependency). Every
    //method takes plain data and routes cross-owner writes through activeGM.
    coc: {
      attack: (options) => BRPCheck.cocAttack(options),
      declareAttack: (options) => BRPCheck.cocDeclareAttack(options),
      defend: (options) => BRPCheck.cocDefend(options),
      resolve: (options) => BRPCheck.cocResolve(options),
      reroll: (options) => BRPCheck.cocReroll(options),
      state: (actor) => BRPCheck.cocState(actor),
      damage: (options) => BRPCheck.cocApplyDamage(options),
      firstAid: (options) => BRPCheck.cocFirstAid(options),
      medicine: (options) => BRPCheck.cocMedicine(options),
      weeklyHeal: (options) => BRPCheck.cocWeeklyHeal(options),
      naturalHeal: (options) => BRPCheck.cocNaturalHeal(options),
      dyingRound: (options) => BRPCheck.cocDyingRound(options),
    },
    //Native CoC M4 SAN / madness / Luck / growth entry points. Plain data in,
    //no chat DOM required; every settlement routes to the single active-GM
    //writer and returns `{queued:true}` when this client is not it.
    sanity: {
      state: (actor) => BRPSanity.state(actor),
      settle: (options) => BRPSanity.settle(options),
      intCheck: (options) => BRPSanity.completeIntCheck(options),
      endTemporary: (options) => BRPSanity.endTemporary(options),
      endIndefinite: (options) => BRPSanity.endIndefinite(options),
      clearPermanent: (options) => BRPSanity.clearPermanent(options),
      newDay: (options) => BRPSanity.newDay(options),
      luckRecovery: (options) => BRPSanity.luckRecovery(options),
      advanceTime: (options) => BRPSanity.advanceTime(options),
      expire: () => BRPSanity.expireDueEpisodes(),
    },
    clock: {
      now: () => BRPWorldTime.now(),
      dayId: () => BRPWorldTime.dayId(),
      advance: (options) => BRPSanity.advanceTime(options),
    },
    rollItemMacro,
    rollCharMacro,
    rollSanMacro,
    ClickRegionLeftUuid: ChaosiumCanvasInterfaceInit.ClickRegionLeftUuid,
    ClickRegionRightUuid: ChaosiumCanvasInterfaceInit.ClickRegionRightUuid
  };
  //Add Custom Configuration
  CONFIG.BRP = BRP;

  //Register Settings and Handlebar Helpers
  registerSettings();
  handlebarsHelper();

  // Define custom Document classes
  CONFIG.Actor.documentClass = BRPActor;
  CONFIG.Item.documentClass = BRPItem;
  CONFIG.Combat.documentClass = BRPCombat;
  CONFIG.ui.combat = BRPCombatTracker;
  CONFIG.ActiveEffect.documentClass = BRPActiveEffect;

  //Sanity chain: the system's status effects. Temporary, indefinite and
  //permanent insanity are separate statuses; permanent is terminal, the other
  //two can coexist.
  CONFIG.statusEffects.push(
    { id: BRPMadness.TEMP_INSANE_ID, name: game.i18n.localize('BRP.madness.tempInsane'), icon: 'systems/brp/assets/Icons/drama-masks.svg' },
    { id: BRPMadness.INDEFINITE_INSANE_ID, name: game.i18n.localize('BRP.madness.indefiniteInsane'), icon: 'systems/brp/assets/Icons/drama-masks.svg' },
    { id: BRPMadness.PERMA_INSANE_ID, name: game.i18n.localize('BRP.madness.permaInsane'), icon: 'systems/brp/assets/Icons/inner-self.svg' }
  )

  //An episode effect can end outside its card (Times Up, effects-tab delete or
  //disable). Mark the card ended too; world-time expiry is enforced below.
  Hooks.on('deleteActiveEffect', (effect) => BRPMadness.syncEndedFromEffect(effect))
  Hooks.on('updateActiveEffect', (effect, changed) => {
    if (changed?.disabled === true) { BRPMadness.syncEndedFromEffect(effect) }
  })
  Hooks.on('updateWorldTime', (worldTime) => {
    //Mirror the real clock into the persisted CoC clock first: episodes are
    //measured against it, so a refresh cannot restart a 1D10h duration.
    if (Rules.activeId?.() === 'coc') { BRPWorldTime.syncFromGameTime(worldTime) }
    BRPMadness.expireTempInsaneEffects()
  })


  ChaosiumCanvasInterfaceInit.initSelf()
  BRPID.init()
  registerSheets()

  // Active Effects are never copied to the Actor,
  // but will still apply to the Actor from within the Item
  // if the transfer property on the Active Effect is true.
  CONFIG.ActiveEffect.legacyTransferral = true;

}

// Run a Macro from an Item drop.
function rollItemMacro(itemUuid) {
  // Reconstruct the drop data so that we can load the item.
  const dropData = {
    type: 'Item',
    uuid: itemUuid
  };
  // Load the item from the uuid.
  Item.fromDropData(dropData).then(item => {
    // Determine if the item loaded and if it's an owned item.
    if (!item || !item.parent) {
      const itemName = item?.name ?? itemUuid;
      return ui.notifications.warn(`Could not find item ${itemName}. You may need to delete and recreate this macro.`);
    }

    // Trigger the item roll
    item.roll();
  });
}

//Roll a Characteristic Roll for an actor from the hotbar - work in progress
function rollCharMacro(actor, characteristic) {
  BRPCheck._trigger({
    rollType: 'CH',
    cardType: 'NO',
    characteristic,
    shiftKey: 'false',
    actor: actor,
    token: ""
  })
}

//Roll a Sanity check for an actor from the hotbar (default loss pair 1/1D6)
function rollSanMacro(actor) {
  BRPCheck._trigger({
    rollType: 'SN',
    cardType: 'NO',
    shiftKey: 'false',
    actor: actor,
    token: ""
  })
}
