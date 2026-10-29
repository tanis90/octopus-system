import { BRPCheck } from './check.mjs'
import { BRPactorDetails } from './actorDetails.mjs'
import BRPDialog from '../setup/brp-dialog.mjs'
import { Rules } from '../rules/index.mjs'

//Luck spending (CthulhuD100 extension layer) - the settlement core is
//deliberately DOM-free: applyLuck settles a spend against the actor's budget
//and one roll entry from a check card, it never touches chat messages, the UI
//or the actor. The chat card buttons below are just one driving surface for
//the same logic (OPCard-style: mutate message flags, re-render).
//Two deliberate v1 omissions: no Luck re-roll (spending lowers the die result,
//push/re-roll is a separate future mechanism).
//
//Ruleset split (M4): octopus keeps the historical behaviour byte for byte. CoC
//allows a spend on a skill or characteristic roll only - never on a Sanity roll,
//the dice that decide how much Sanity is lost, a Luck roll, damage, weapon
//malfunction, a pushed roll or a natural fumble - and never resettles a Sanity
//loss. Both the card snapshot and the settlement ask
//`Rules.active().luck.cardEligible` / `canSpend`, so no UI can offer a spend the
//rules refuse.
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
  static async applyLuck(actor, entry, amount, cardType = 'NO', context = {}) {
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
    const originalLevel = await BRPCheck.successLevel({
      targetScore: Number(entry?.targetScore) || 0,
      rollVal,
      cardType
    })
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
    //CoC re-judges with the live ruleset band so a Luck-adjusted 01 is an Extreme
    //success (never a critical), and the card carries the band the rules give.
    const adjust = Rules.active().luck?.apply
      ? Rules.active().luck.apply({
        purpose: entry?.rollType ?? context.rollType ?? null,
        rollType: context.rollType ?? entry?.rollType ?? null,
        naturalRoll: rollVal,
        targetScore: Number(entry?.targetScore) || 0,
        amount: spent,
        luckValue: budget,
        pushed: entry?.pushed === true || context.pushed === true,
        band: entry?.band ?? null,
      })
      : null
    const displayMax = Math.max(max, Math.floor(Number(luckData.cap) || 0))
    // Second gate: the ruleset can refuse the spend even though a card exists.
    // Nothing is deducted and the die/result stay exactly where they were.
    if (adjust && adjust.allowed !== true) {
      return {
        allowed: false,
        code: adjust.code,
        reason: adjust.reason,
        luck: { value: budget, max: displayMax, spent: 0 },
        roll: {
          rollVal,
          resultLevel: originalLevel,
          resultLabel: game.i18n.localize('BRP.resultLevel.' + originalLevel),
          originalRawScore,
          luckSpent: Math.max(0, Math.floor(Number(entry?.luckSpent) || 0)),
          band: entry?.band ?? null,
          criticalSource: rollVal === 1 ? 'natural' : null,
          adjustedToCritical: false,
        }
      }
    }
    const band = adjust?.allowed ? adjust.band.adjusted : null
    if (band) { resultLevel = band.level }
    return {
      allowed: true,
      luck: { value: budget - spent, max: displayMax, spent },
      roll: {
        rollVal: newRollVal,
        resultLevel,
        resultLabel: band
          ? game.i18n.localize('BRP.cocBand.' + band.band)
          : game.i18n.localize('BRP.resultLevel.' + resultLevel),
        originalRawScore,
        luckSpent: Math.max(0, Math.floor(Number(entry?.luckSpent) || 0)) + spent,
        band: band?.band ?? null,
        // A Luck-lowered 01 is an extreme success; only a natural 01 is critical.
        criticalSource: rollVal === 1 ? 'natural' : null,
        adjustedToCritical: false
      }
    }
  }

  //Snapshot of the actor's luck budget stored on a card entry at creation.
  //Only the roll-result template family carries spend buttons; a zero budget
  //stores null so the card simply doesn't render the button row. The ruleset
  //decides eligibility: CoC refuses the Sanity card and fumbles outright.
  static cardLuck(actor, chatTemplate, context = {}) {
    if (chatTemplate !== BRPLuck.CHECK_TEMPLATE) { return null }
    const luck = actor?.system?.luck
    if (!luck || !(Number(luck.value) > 0)) { return null }
    const eligible = Rules.active().luck?.cardEligible
    if (eligible) {
      const allowed = eligible({
        rollType: context.rollType ?? null,
        cardType: context.cardType ?? 'NO',
        rollVal: context.rollVal ?? null,
        band: context.band ?? null,
        pushed: context.pushed === true,
      })
      if (allowed !== true) { return null }
    }
    return {
      value: Math.floor(Number(luck.value)),
      // CoC's starting Luck is not a ceiling; show the rules cap (99) rather
      // than the creation snapshot. Octopus has no separate cap.
      max: Math.max(
        Math.floor(Number(luck.max) || 0),
        Math.floor(Number(luck.cap) || 0)
      )
    }
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
    //Ruleset gate, second line of defence: the card snapshot already refused an
    //ineligible roll, and a direct call is refused here too. CoC never lets Luck
    //touch a Sanity roll, a Sanity-loss die, a fumble or a Luck roll.
    const decision = Rules.active().luck?.canSpend?.({
      purpose: card.rollType,
      rollType: card.rollType,
      cardType: card.cardType,
      rollVal: entry.originalRawScore ?? entry.rollVal,
      band: entry.band ?? null,
      pushed: entry.pushed === true,
    })
    if (decision && decision.allowed !== true) {
      ui.notifications.warn(decision.reason || game.i18n.localize('BRP.luck.notAllowed'))
      return
    }
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
    const result = await BRPLuck.applyLuck(actor, entry, data.amount, card.cardType, { rollType: card.rollType })
    if (result.luck.spent < 1) {
      ui.notifications.info(game.i18n.localize('BRP.luck.noneLeft'))
      return
    }
    await actor.update({ 'system.luck.value': result.luck.value })
    //SN cards spend too (octopus only): a spend that lifts the roll to success
    //switches the paired loss to the small value - reconcile what settlement
    //already wrote. CoC forbids Luck on the Sanity chain entirely.
    const resettle = Rules.active().luck?.resettlesSanLoss === true
    if (card.rollType === 'SN' && resettle) {
      await BRPLuck._resettleSanLoss(actor, entry, result)
    }
    //A Luck-bought success does not earn a development tick. If the roll was
    //already ticked, remove it.
    const growth = Rules.active().growth
    if (growth?.tickOnLuckSuccess === false) {
      await BRPLuck._untickGrowth(entry, result)
    }
    //Trace + re-rate in place on the card entry (flags update + re-render)
    entry.rollVal = result.roll.rollVal
    entry.rollResult = result.roll.rollVal
    entry.resultLevel = result.roll.resultLevel
    entry.resultLabel = result.roll.resultLabel
    if (result.roll.band) {
      entry.band = result.roll.band
      const rules = Rules.active()
      const rank = rules.check?.bandRank ?? rules.combat?.bandRank
      if (rank) { entry.bandRank = rank(result.roll.band) }
      entry.bandLabel = game.i18n.localize('BRP.cocBand.' + result.roll.band)
      if (entry.requiredBand && rank) {
        entry.taskSuccess = entry.bandRank >= rank(entry.requiredBand)
      }
    }
    entry.criticalSource = result.roll.criticalSource ?? null
    entry.adjustedToCritical = false
    entry.originalRawScore = result.roll.originalRawScore
    entry.luckSpent = result.roll.luckSpent
    entry.luck = { value: result.luck.value, max: result.luck.max }
    //The spend itself is recorded, so a later settlement can see it was bought.
    entry.luckAdjusted = true
    await msg.update({ 'flags.brp.chatCard': card.chatCard })
    ui.notifications.info(game.i18n.format('BRP.luck.spentCard', { spent: result.luck.spent, roll: result.roll.rollVal }))
  }

  //CoC: a success bought with Luck must not leave a development tick behind.
  //Clearing is idempotent and only touches the item this roll named.
  static async _untickGrowth(entry, result) {
    if (!(Number(result.roll.resultLevel) >= 2)) { return }
    try {
      if (!entry?.skillId) { return }
      // The new spend is on the result, not yet on the card entry; reading
      // entry.luckSpent here would miss the first spend and leave the tick.
      if (!(Number(result.roll.luckSpent) > 0)) { return }
      const actor = await BRPactorDetails._getParticipant(entry.particId, entry.particType)
      const item = actor?.items?.get(entry.skillId)
      if (!item) { return }
      if (item.system?.improve === true) {
        await item.update({ 'system.improve': false })
      }
      if (item.system?.oppimprove === true) {
        await item.update({ 'system.oppimprove': false })
      }
    } catch (thrown) {
      console.error('BRP luck untick failed', thrown)
    }
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
  //current SAN and the daily tally (the episode, if any, stays for the keeper).
  //octopus only: CoC forbids spending Luck on the Sanity chain at all.
  static async _resettleSanLoss(actor, entry, result) {
    if (Rules.active().luck?.resettlesSanLoss !== true) { return }
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
