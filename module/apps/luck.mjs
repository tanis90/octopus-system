import { BRPCheck } from './check.mjs'
import { BRPactorDetails } from './actorDetails.mjs'
import BRPDialog from '../setup/brp-dialog.mjs'

//Luck spending (CthulhuD100 extension layer) - the settlement core is
//deliberately DOM-free: applyLuck settles a spend against the actor's budget
//and one roll entry from a check card, it never touches chat messages, the UI
//or the actor. The chat card buttons below are just one driving surface for
//the same logic (OPCard-style: mutate message flags, re-render).
//Two deliberate v1 omissions: no Luck re-roll (spending lowers the die result,
//push/re-roll is a separate future mechanism) and no automatic recovery
//(restoration is a keeper hand edit on the luck field, clamped at max).
export class BRPLuck {

  //Spend step-downs offered on every d100 check card (plus the custom dialog)
  static SPEND_PRESETS = [1, 5, 10]

  //The chat template family that carries the spend buttons
  static get CHECK_TEMPLATE() { return 'systems/brp/templates/chat/roll-result.html' }

  //The settlement core: clamp the requested spend by both margins (the
  //remaining Luck budget and the d100 floor), lower the die result and
  //re-rate the success level in place. Pure with respect to the game
  //surface - no DOM, no chat, no actor writes; the caller applies the result.
  //entry is the card entry the driving surface picked by its card index.
  static async applyLuck(actor, entry, amount, cardType = 'NO') {
    const luckData = actor?.system?.luck ?? {}
    const budget = Math.max(0, Math.floor(Number(luckData.value) || 0))
    const max = Math.max(0, Math.floor(Number(luckData.max) || 0))
    const rollVal = Math.max(1, Math.floor(Number(entry?.rollVal) || 0))
    const requested = Math.max(0, Math.floor(Number(amount) || 0))
    //Clamp by margin: never past the remaining budget, never below a d100 1
    const spent = Math.max(0, Math.min(requested, budget, rollVal - 1))
    const newRollVal = rollVal - spent
    //Original value leaves a trace: only the first spend records the raw die
    const originalRawScore = Number.isFinite(Number(entry?.originalRawScore))
      ? Number(entry.originalRawScore)
      : rollVal
    let resultLevel = await BRPCheck.successLevel({
      targetScore: Number(entry?.targetScore) || 0,
      rollVal: newRollVal,
      cardType
    })
    //Resistance rolls without detailed results collapse to pass/fail (makeRoll)
    if ((cardType === 'RE' || cardType === 'PP') && !game.settings.get('brp', 'resistLevels')) {
      if (resultLevel > 2) { resultLevel = 2 }
      if (resultLevel < 1) { resultLevel = 1 }
    }
    return {
      luck: { value: budget - spent, max, spent },
      roll: {
        rollVal: newRollVal,
        resultLevel,
        resultLabel: game.i18n.localize('BRP.resultLevel.' + resultLevel),
        originalRawScore,
        luckSpent: Math.max(0, Math.floor(Number(entry?.luckSpent) || 0)) + spent
      }
    }
  }

  //Snapshot of the actor's luck budget stored on a card entry at creation.
  //Only the roll-result template family carries spend buttons; a zero budget
  //stores null so the card simply doesn't render the button row.
  static cardLuck(actor, chatTemplate) {
    if (chatTemplate !== BRPLuck.CHECK_TEMPLATE) { return null }
    const luck = actor?.system?.luck
    if (!luck || !(Number(luck.value) > 0)) { return null }
    return { value: Math.floor(Number(luck.value)), max: Math.floor(Number(luck.max) || 0) }
  }

  //--------- Chat-card buttons (OPCard style: read flags, mutate, re-render) ---------

  //Spends are read-modify-write on both the card flags and the actor's Luck
  //budget. Two quick clicks (or two open cards for the same actor) would read
  //the same pre-spend budget and lose one update, so a single client-side
  //chain serializes them; the pure settlement core below stays unchanged.
  static _spendChain = Promise.resolve()

  static spendFromCard(data) {
    const run = BRPLuck._spendChain.then(
      () => BRPLuck._spendFromCardNow(data),
      () => BRPLuck._spendFromCardNow(data)
    )
    BRPLuck._spendChain = run.then(() => { }, () => { })
    return run
  }

  //Spend a fixed amount driven by a card button (data.amount resolved from the preset)
  static async _spendFromCardNow(data) {
    const msg = await game.messages.get(data.targetChatId)
    const card = msg?.flags?.brp
    if (!card?.chatCard?.length) { return }
    const cardIndex = Math.max(0, Math.min(Number(data.index ?? 0) || 0, card.chatCard.length - 1))
    const entry = card.chatCard[cardIndex]
    //No budget recorded on this roll (or a card beyond saving): nothing to spend
    if (!entry?.luck || entry.permaInsane) { return }
    const actor = await BRPactorDetails._getParticipant(entry.particId, entry.particType)
    if (!actor?.system?.luck) { return }
    //GM may spend for anyone; a player only for their own character
    if (!data.originGM) {
      const user = game.users.get(data.origin)
      const allowed = user ? (actor.testUserPermission ? actor.testUserPermission(user, 'OWNER') : actor.isOwner) : false
      if (!allowed) {
        ui.notifications.warn(game.i18n.localize('BRP.luck.notOwner'))
        return
      }
    }
    const result = await BRPLuck.applyLuck(actor, entry, data.amount, card.cardType)
    if (result.luck.spent < 1) {
      ui.notifications.info(game.i18n.localize('BRP.luck.noneLeft'))
      return
    }
    await actor.update({ 'system.luck.value': result.luck.value })
    //SN cards spend too: a spend that lifts the roll to success switches the
    //paired loss to the small value - reconcile what settlement already wrote
    if (card.rollType === 'SN') {
      await BRPLuck._resettleSanLoss(actor, entry, result)
    }
    //Trace + re-rate in place on the card entry (flags update + re-render)
    entry.rollVal = result.roll.rollVal
    entry.rollResult = result.roll.rollVal
    entry.resultLevel = result.roll.resultLevel
    entry.resultLabel = result.roll.resultLabel
    entry.originalRawScore = result.roll.originalRawScore
    entry.luckSpent = result.roll.luckSpent
    entry.luck = { value: result.luck.value, max: result.luck.max }
    await msg.update({ 'flags.brp.chatCard': card.chatCard })
    ui.notifications.info(game.i18n.format('BRP.luck.spentCard', { spent: result.luck.spent, roll: result.roll.rollVal }))
  }

  //Keeper/player typed amount: small dialog, then the same settlement path
  static async spendCustom(data) {
    const html = await foundry.applications.handlebars.renderTemplate(
      'systems/brp/templates/dialog/luckSpend.hbs', {}
    )
    const usage = await BRPDialog.input({
      window: { title: game.i18n.localize('BRP.luck.customTitle') },
      content: html,
      ok: { label: game.i18n.localize('BRP.proceed') }
    })
    const amount = Math.floor(Number(usage?.amount))
    if (!Number.isFinite(amount) || amount < 1) { return }
    await BRPLuck.spendFromCard({ ...data, amount })
  }

  //A Luck spend turned an SN fail into a success: the large loss already
  //applied gives way to the small value - refund the difference on both the
  //current SAN and the daily tally (the episode, if any, stays for the keeper)
  static async _resettleSanLoss(actor, entry, result) {
    const crossedToSuccess = (Number(entry.resultLevel) < 2) && (result.roll.resultLevel >= 2)
    if (!crossedToSuccess) { return }
    const newLoss = await BRPCheck._rollSanLoss(String(entry.sanLossSuccess ?? '0'))
    const oldLoss = Math.max(0, Number(entry.sanLoss) || 0)
    const refund = Math.max(0, oldLoss - newLoss)
    if (refund < 1) { return }
    const san = actor.system.sanity
    const value = Math.min(Number(san.value) + refund, Number(san.max))
    const dailyLoss = Math.max(0, Number(san.dailyLoss) - refund)
    await actor.update({
      'system.sanity.value': value,
      'system.sanity.dailyLoss': dailyLoss
    })
    entry.sanLoss = newLoss
    entry.sanAfter = value
    entry.sanLossFormulaUsed = String(entry.sanLossSuccess ?? '0')
  }
}
