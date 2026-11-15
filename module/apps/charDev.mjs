import { BRPactorDetails } from './actorDetails.mjs'
import { OPCard } from "../cards/opposed-card.mjs"
import { BRPUtilities } from './utilities.mjs'
import { Rules } from '../rules/index.mjs'
import {
  skillNoXP,
  skillTickUpdate,
  skillTicked,
  skillTotalInfo,
  skillXp,
  skillXpUpdate,
} from '../rules/coc-skill-fields.mjs'

export class BRPCharDev {

  //Toggle GM Devevlopment Phase off and on
  static async developmentPhase(toggle) {
    let state = await game.settings.get('brp', 'development')
    await game.settings.set('brp', 'development', !state)
    ui.notifications.info(
      state
        ? game.i18n.localize('BRP.devPhaseOff')
        : game.i18n.localize('BRP.devPhaseOn')
    )
    game.socket.emit('system.brp', {
      type: 'updateChar'
    })
    BRPUtilities.updateCharSheets(true)
  }

  //Do XP improve for all items in actor
  static async onXPGainAll(actor, token, rollType) {
    let success = []
    let results = {}
    let partic = await BRPactorDetails._getParticipantPriority(token, actor);
    for (let i of partic.items) {
      //Skills use the canonical tick flag; other item types keep the legacy one.
      const ticked = i.type === 'skill' ? skillTicked(i.system) : i.system?.improve === true
      if (ticked) {
        results = await BRPCharDev.xpCheck(actor, token, i._id, rollType, false);
        success.push(results)
      }
    }
    await BRPCharDev.xpOutput(success, partic)
    return;
  }

  //Prep a single XP check
  static async onXPGainSingle(itemId, actor, token, rollType, opp) {
    let success = []
    let results = {}
    let partic = await BRPactorDetails._getParticipantPriority(token, actor);
    let item = partic.items.get(itemId)
    if (!item) { return }
    const ticked = item.type === 'skill' ? skillTicked(item.system) : item.system?.improve === true
    if (opp === 'false' && !ticked) { return }
    if (opp === 'true' && !item.system.oppimprove) { return }
    results = await BRPCharDev.xpCheck(actor, token, itemId, rollType, opp);
    success.push(results)
    await BRPCharDev.xpOutput(success, partic)
    return;
  }

  //Make XP check and if appropriate calc/roll XP gain
  static async xpCheck(actor, token, itemId, type, opp) {
    let partic = await BRPactorDetails._getParticipantPriority(token, actor);
    let improvVal = 0
    let item = partic.items.get(itemId)
    if (!item) { return { error: 'item-missing', itemId } }
    const isSkill = item.type === 'skill'
    // Canonical score for skills (base + adjustments). `valid: false` means the
    // document carries no score data at all; rolling against that would coerce
    // NaN to 0 and "succeed" on every die, so refuse instead.
    const info = isSkill ? skillTotalInfo(item.system) : null
    if (isSkill && !info.valid) {
      return { error: 'skill-score-invalid', itemId, name: item.name, invalid: info.invalid }
    }
    let name = item.name
    let score = isSkill ? info.total : Number(item.system.total)
    if (opp) {
      score = Number(item.system.opptotal)
      name = item.system.oppName
    }
    if (!Number.isFinite(score)) {
      return { error: 'skill-score-invalid', itemId, name }
    }

    const ticked = isSkill ? skillTicked(item.system) : (opp ? !!item.system.oppimprove : !!item.system.improve)
    if (!opp && !ticked) { return { error: 'not-ticked', itemId, name } }
    if (opp && !item.system.oppimprove) { return { error: 'not-ticked', itemId, name } }
    // No future growth for a noxpgain skill - even if an imported document left
    // a tick behind. Experience already gained is untouched; the dirty tick is
    // cleared so the skill cannot keep appearing as settleable.
    if (isSkill && skillNoXP(item.system)) {
      if (skillTicked(item.system)) {
        await item.update(skillTickUpdate(false))
      }
      return { error: 'no-xp', itemId, name }
    }
    const rules = Rules.active()
    // CoC has no fixed improvement tier: the "fixed" button settles as 1D10 too,
    // so a client that still sends it cannot mint a constant +3.
    const effectiveType = rules.growth.allowFixedTier === false ? 'formula' : type
    let result = await BRPCharDev.xpRoll(score, rules.growth.bonus(actor))
    if (result?.error) { return { ...result, itemId, name, score } }
    if (result.level === 1) {
      if (effectiveType === 'fixed') {
        improvVal = Number(game.settings.get('brp', 'xpFixed')) || 0
      } else {
        let roll = new Roll(rules.growth.formula({
          xpFormula: game.settings.get('brp', 'xpFormula')
        }))
        await roll.evaluate();
        improvVal = Number(roll.total)
        if (!Number.isFinite(improvVal)) { improvVal = 0 }
        if (game.settings.get('brp', 'xpRollDice') && game.modules.get('dice-so-nice')?.active) {
          game.dice3d.showForRoll(roll, game.user, true, null, false)  //Roll,user,sync,whispher,blind
        }
      }
    }

    if (!opp) {
      if (isSkill) {
        // Canonical settlement: clear the tick and add the gained points to
        // adjustments.experience. `system.xp`/`system.improve` are never written.
        await item.update({ ...skillTickUpdate(false), ...skillXpUpdate(skillXp(item.system) + improvVal) })
      } else {
        await item.update({
          'system.improve': false,
          'system.xp': (Number(item.system.xp) || 0) + improvVal
        })
      }
    } else {
      await item.update({
        'system.oppimprove': false,
        'system.xp': (Number(item.system.xp) || 0) - improvVal
      })
    }
    return ({
      name: name,
      level: result.level,
      diceRoll: result.diceRoll,
      rollResult: result.rollResult,
      score: score,
      improvVal,
    })
  }


  //XP Check Dice Roll & return success level
  static async xpRoll(target, bonus) {
    const score = Number(target)
    // A non-finite target must not fall through `growth.check` as 0: that turns
    // every die into a success and invents a gained point.
    if (!Number.isFinite(score)) {
      return { level: 0, diceRoll: null, rollResult: null, error: 'skill-score-invalid' }
    }
    let resultLevel = 0
    let roll = new Roll('1D100')
    await roll.evaluate();
    if (Rules.active().growth.check({ roll: Number(roll.total), targetScore: score, bonus })) {
      resultLevel = 1
    }
    //If Game Settings and Dice So Nice then show dice roll
    if (game.settings.get('brp', 'xpRollDice') && game.modules.get('dice-so-nice')?.active) {
      game.dice3d.showForRoll(roll, game.user, true, null, false)  //Roll,user,sync,whispher,blind
    }

    return ({
      'level': resultLevel,
      'diceRoll': Number(roll.total) + bonus,
      'rollResult': Number(roll.total)
    })
  }


  //Get ready to produce the XP check Output
  static async xpOutput(success, partic) {
    const html = await BRPCharDev.xpChatCard(success, partic.name, partic.img);
    let msg = await BRPCharDev.showXPChat(html, partic)
  }


  //Prepare XP Roll Chat Card
  static async xpChatCard(success, actorName, actrImg) {
    let messageData = {
      speaker: ChatMessage.getSpeaker({ actor: actorName }),
      actrImage: actrImg,
      success: success
    }
    const messageTemplate = 'systems/brp/templates/chat/XP-result.html'
    let html = await foundry.applications.handlebars.renderTemplate(messageTemplate, messageData);
    return html;
  }


  // Display the XP chat card
  static async showXPChat(html, actor) {
    let chatData = {};
    let chatType = ""
    if (!foundry.utils.isNewerVersion(game.version, '11')) {
      chatType = CONST.CHAT_MESSAGE_STYLES.OTHER
    } else {
      chatType = CONST.CHAT_MESSAGE_OTHER
    }



    chatData = {
      user: game.user.id,
      type: chatType,
      content: html,
      speaker: {
        actor: actor._id,
        alias: actor.name,
      },
    }
    let msg = await ChatMessage.create(chatData);
    foundry.audio.AudioHelper.play({ src: CONFIG.sounds.dice }, true)
    return
  }


  //POW Improvement Check (BRP only - CoC has no POW improvement)
  static async powImprov(actor, token, type) {
    if (Rules.active().growth.allowPowImprovement === false) { return { error: 'no-pow-improvement' } }
    let partic = await BRPactorDetails._getParticipantPriority(token, actor);
    let max = 21   //TODO - replace this with variable based on culture
    let score = partic.system.stats.pow.total
    let chance = (max - score) * 5
    let resultLevel = 0
    let roll = new Roll('1D100')
    let improvVal = 0
    await roll.evaluate();
    //If Game Settings and Dice So Nice then show dice roll
    if (game.settings.get('brp', 'xpRollDice') && game.modules.get('dice-so-nice')?.active) {
      game.dice3d.showForRoll(roll, game.user, true, null, false)  //Roll,user,sync,whispher,blind
    }

    if (roll.total <= chance) {
      resultLevel = 1
      if (type === "fixed") {
        improvVal = 1
      } else if (type != "fixed") {
        let impRoll = new Roll('1D3-1')
        await impRoll.evaluate()
        improvVal = impRoll.total
        //If Game Settings and Dice So Nice then show dice roll
        if (game.settings.get('brp', 'xpRollDice') && game.modules.get('dice-so-nice')?.active) {
          game.dice3d.showForRoll(impRoll, game.user, true, null, false)  //Roll,user,sync,whispher,blind
        }
      }
    }
    let success = []
    success.push({
      name: game.i18n.localize('BRP.StatsPowAbbr'),
      level: resultLevel,
      diceRoll: roll.total,
      rollResult: roll.total,
      score: chance,
      improvVal,
    })
    await BRPCharDev.xpOutput(success, partic)

    await partic.update({
      'system.stats.pow.exp': partic.system.stats.pow.exp + improvVal,
      'system.stats.pow.improve': false
    })
    return;
  }
}
