import { BRPCheck } from "../apps/check.mjs"
import { OPCard } from "./opposed-card.mjs"

export class GRCard {

  //Add a new skill to a Combined Card
  static async GRAdd(config, msgId) {
    //CoC joins are always written by the deterministic active GM and cap the
    //card at the two combatants; the octopus path below is untouched.
    const cocJoin = config?.cocJoin === true
    const cocWriter = cocJoin ? game.users?.activeGM : null
    const canWrite = cocJoin ? !!cocWriter && game.user.id === cocWriter.id : game.user.isGM
    if (canWrite) {
      let targetMsg = await game.messages.get(msgId)
      if (!targetMsg) { return false }
      if (cocJoin && (targetMsg.flags.brp.chatCard ?? []).length >= 2) {
        ui.notifications.warn(game.i18n.localize('BRP.resolveMax'))
        return false
      }
      if ((targetMsg.flags.brp.chatCard).length >= 5 && (targetMsg.flags.brp.cardType === 'GR' || targetMsg.flags.brp.cardType === 'CO')) {
        ui.notifications.warn(game.i18n.localize('BRP.resolveMax'))
        return
      } else if ((targetMsg.flags.brp.chatCard).length >= 2 && targetMsg.flags.brp.cardType === 'OP') {
        ui.notifications.warn(game.i18n.localize('BRP.resolveMax'))
        return
      }

      let newChatCards = targetMsg.flags.brp.chatCard
      newChatCards.push(config.chatCard[0])
      const update = { 'flags.brp.chatCard': newChatCards }
      if (cocJoin && config.rolls) {
        //Keep the defender's real Roll on the message next to the attacker's.
        const rolls = Array.isArray(targetMsg.rolls) ? [...targetMsg.rolls] : []
        rolls.push(config.rolls)
        update.rolls = rolls
      }
      await targetMsg.update(update)
      const pushhtml = await BRPCheck.startChat(targetMsg.flags.brp)
      await targetMsg.update({ content: pushhtml })
      return true
    } else {
      const availableGM = cocJoin
        ? cocWriter?.id
        : game.users.find(d => d.active && d.isGM)?.id
      if (availableGM) {
        game.socket.emit('system.brp', {
          type: 'GRAdd',
          to: availableGM,
          value: { config, msgId }
        })
      } else {
        ui.notifications.warn(game.i18n.localize('BRP.noAvailableGM'))
      }
      return false
    }
  }


  //Remove a skill from a combined card
  static async GRRemove(config) {
    let targetMsg = await game.messages.get(config.targetChatId)
    let rank = config.dataset.rank
    let newChatCards = targetMsg.flags.brp.chatCard
    newChatCards.splice(rank, 1)
    await targetMsg.update({ 'flags.brp.chatCard': newChatCards })
    return
  }


  //Resolve a combined card - roll dice, update and close
  static async GRResolve(config) {
    let targetMsg = await game.messages.get(config.targetChatId)
    let chatCards = targetMsg.flags.brp.chatCard
    let cardType = targetMsg.flags.brp.cardType
    if (chatCards.length < 2) {
      ui.notifications.warn(game.i18n.localize('BRP.resolveMore'))
      return
    }

    let newchatCards = []
    let roll = new Roll(chatCards[0].rollFormula)
    await roll.evaluate()
    let rollResult = Number(roll.result)

    let diceRolled = ""
    for (let diceRoll = 0; diceRoll < roll.dice.length; diceRoll++) {
      for (let thisDice = 0; thisDice < roll.dice[diceRoll].values.length; thisDice++) {
        if (thisDice != 0 || diceRoll != 0) {
          diceRolled = diceRolled + ", "
        }
        diceRolled = diceRolled + roll.dice[diceRoll].values[thisDice]
      }
    }

    let successes = 0
    for (let i of chatCards) {
      i.rollResult = rollResult
      i.diceRolled = diceRolled
      i.rollVal = rollResult
      i.resultLevel = await BRPCheck.successLevel({
        targetScore: i.targetScore,
        rollVal: i.rollVal,
        cardType,
      })
      if (i.resultLevel > 1) { successes++ }
      i.resultLabel = game.i18n.localize('BRP.resultLevel.' + i.resultLevel)
      newchatCards.push(i)
    }
    //await OPCard.showDiceRoll(chatCards[0])
    successes = successes / chatCards.length
    await targetMsg.update({
      'flags.brp.chatCard': newchatCards,
      'flags.brp.state': 'closed',
      'flags.brp.successLevel': successes,
      'flags.brp.rollResult': rollResult,
      'rolls': [roll]
    })
    const pushhtml = await BRPCheck.startChat(targetMsg.flags.brp)
    await targetMsg.update({ content: pushhtml })
    await BRPCheck.tickXP(targetMsg.flags.brp)
    return
  }

  static async GRClose(config) {
    let targetMsg = await game.messages.get(config.targetChatId)
    await targetMsg.update({
      'flags.brp.state': 'closed',
      'flgs.brp.successLevel': -1,
      'flags.brp.chatCard': []
    })
    const pushhtml = await BRPCheck.startChat(targetMsg.flags.brp)
    await targetMsg.update({ content: pushhtml })
    return
  }
}
