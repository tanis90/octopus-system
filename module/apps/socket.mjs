import { BRPCheck } from './check.mjs';
import { GRCard } from '../cards/combined-card.mjs';
import { BRPDamage } from '../combat/damage.mjs';
import { BRPUtilities } from './utilities.mjs';
import { BRPSanity } from './sanity.mjs';

export class BRPSystemSocket {

  static async callSocket(data) {
    switch (data.type) {
      case 'chatUpdate':
        if (data.to === game.user.id) {
          BRPCheck.handleChatButton(data.value);
        }
        break;

      case 'cocSanSettle':
        if (data.to === game.user.id) {
          BRPSystemSocket.cocSanSettle(data.value);
        }
        break;

      case 'cocSanAction':
        if (data.to === game.user.id) {
          BRPSystemSocket.cocSanAction(data.value);
        }
        break;

      case 'cocResolve':
        if (data.to === game.user.id) {
          BRPCheck.cocResolve(data.value);
        }
        break;

      case 'cocReroll':
        if (data.to === game.user.id) {
          BRPCheck.cocReroll(data.value);
        }
        break;

      case 'cocWrite':
        if (data.to === game.user.id) {
          BRPSystemSocket.cocWrite(data.value);
        }
        break;

      case 'GRAdd':
        if (data.to === game.user.id) {
          GRCard.GRAdd(data.value.config, data.value.msgId);
        }
        break;

      case 'firstAidFumble':
        if (data.to === game.user.id) {
          BRPDamage.firstAidFumble(data.value.actorId, data.value.actorType, data.value.locationId);
        }
        break;

      case 'toggleMapNotes':
        game.settings.set('core', NotesLayer.TOGGLE_SETTING, data.toggle === true);
        break;

      case 'updateChar':
        BRPUtilities.updateCharSheets();
        break;
    }
  }

  // CoC wound write relayed to the active GM. Only the whitelisted damage
  // methods can be invoked; the GM client performs the actual document update.
  static async cocWrite(value = {}) {
    const allowed = ['applyCoCDamage', 'cocFirstAid', 'cocMedicine', 'cocWeeklyHeal', 'cocNaturalHeal', 'cocDyingRound']
    if (!allowed.includes(value.fn)) { return { error: 'unknown-coc-write' } }
    const actor = await actorFrom(value.actorId, value.actorType)
    if (!actor) { return { error: 'actor-missing' } }
    // Arbitrary cross-owner damage must come from a GM resolution; healing
    // requests may be relayed by the player who made the roll.
    const originUser = value.origin ? game.users.get?.(value.origin) : null
    if (value.fn === 'applyCoCDamage' && !originUser?.isGM) {
      return { error: 'not-authorised' }
    }
    const { fn, actorId, actorType, origin, ...rest } = value
    return BRPDamage[fn](actor, rest)
  }

  // CoC SAN settlement relayed to the single writer. The player's roll already
  // happened on their client; the decided loss is applied here, once, against
  // the writer's fresh read of the actor. `origin` is kept so the writer can
  // refuse a settlement for an investigator the sender neither owns nor keeps.
  static async cocSanSettle(value = {}) {
    if (!BRPSanity.isWriter()) { return { error: 'not-active-gm' } }
    const actor = await actorFrom(value.actorId, value.actorType)
    if (!actor) { return { error: 'actor-missing' } }
    return BRPSanity.settleNow({
      actor,
      loss: value.loss,
      cardMessageId: value.cardMessageId ?? null,
      dayId: value.dayId ?? null,
      reason: value.reason ?? 'sanity-roll',
      origin: value.origin ?? null,
    })
  }

  // CoC keeper actions relayed to the writer (new day, clock, episode end,
  // Luck recovery). These are keeper-only: a player client may ask, but the
  // writer refuses unless the origin user is a GM.
  static async cocSanAction(value = {}) {
    if (!BRPSanity.isWriter()) { return { error: 'not-active-gm' } }
    const originUser = value.origin ? game.users?.get?.(value.origin) ?? null : null
    if (!originUser?.isGM) { return { error: 'not-authorised' } }
    const fn = String(value.fn ?? '')
    const allowed = ['newDay', 'endTemporary', 'endIndefinite', 'clearPermanent', 'luckRecovery', 'advanceTime']
    if (!allowed.includes(fn)) { return { error: 'unknown-coc-sanity-action' } }
    const actor = value.actorId || value.actorType ? await actorFrom(value.actorId, value.actorType) : null
    if (fn !== 'advanceTime' && !actor) { return { error: 'actor-missing' } }
    if (fn === 'advanceTime') { return BRPSanity.advanceTime(value.options ?? {}) }
    return BRPSanity[fn]({ actor, ...(value.options ?? {}) })
  }
}

const actorFrom = async (actorId, actorType) => {
  if (!actorId) { return null }
  if (actorType === 'token') { return game.actors.tokens?.[actorId] ?? null }
  return game.actors.get(actorId) ?? null
}
