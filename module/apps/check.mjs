import { BRPactorDetails } from "./actorDetails.mjs"
import { BRPSelectLists } from "./select-lists.mjs"
import { BRPCombatRoll } from "../combat/combat-roll.mjs"
import { BRPDamage } from "../combat/damage.mjs"
import { GRCard } from "../cards/combined-card.mjs"
import { OPCard } from "../cards/opposed-card.mjs"
import { COCard } from "../cards/cooperative-card.mjs"
import { CBCard } from "../cards/combat-card.mjs"
import { BRPMadness } from "./madness.mjs"
import { BRPSanity, bindSanityCheck } from "./sanity.mjs"
import { BRPLuck } from "./luck.mjs"
import BRPDialog from '../setup/brp-dialog.mjs';
import { Rules } from '../rules/index.mjs';

export class BRPCheck {

  //Roll Types
  //CH = Characteristic
  //SK = Skill
  //SN = Sanity
  //DM = Damage
  //CM = Combat
  //AR = Armour (Random)
  //AL = Allegiance Roll
  //PA - Passion Roll
  //PT - Personality Trait Roll
  //RP - Reputation Roll
  //IM - Spell Impact Roll
  //QC - Quick Combat

  //Card Types
  //NO = Normnal Roll
  //RE = Resistance Roll (CH only)
  //PP = POW v POW (CH only)
  //GR = Combined (Group) Roll
  //CO = Cooperative Roll
  //OP = Opposed Roll
  //CB = Combat Roll


  //Start to prepare the config
  static async _trigger(options = {}) {
    let config = await BRPCheck.normaliseRequest(options)
    if (config === false) { return false }
    return BRPCheck.startCheck(config)
  }


  // Resolve the skill a weapon attacks with. CoC identity is the stored skill
  // brpid (plus specKey when the weapon names one) - never the display name,
  // and never a cached hit score. Octopus keeps the sheet's resolved skillId.
  static weaponSkill(actor, weapon, skillId = false) {
    if (!actor || !weapon) { return null }
    if (!Rules.active().combat?.skillRefFromBrpid) { return actor.items.get(skillId) ?? null }
    const refs = [weapon.system?.skill1, weapon.system?.skill2]
      .filter((brpid) => brpid && brpid !== 'none' && String(brpid).startsWith('i.skill.coc.'))
    const marker = weapon.flags?.brp?.coc?.weapon ?? null
    for (const brpid of refs) {
      const found = [...actor.items].find((item) => item.type === 'skill'
        && item.flags?.brp?.brpidFlag?.id === brpid
        && (!marker?.skillSpec || item.flags?.brp?.coc?.specKey === marker.skillSpec))
      if (found) { return found }
    }
    return actor.items.get(skillId) ?? null
  }

  //Check the request and build out the config
  static async normaliseRequest(options) {
    //Set Basic Config
    let partic = await BRPactorDetails._getParticipantId(options.token, options.actor)
    let particImg = await BRPactorDetails.getParticImg(partic.particId, partic.particType)
    let particActor = await BRPactorDetails._getParticipant(partic.particId, partic.particType)
    let target = await BRPactorDetails._getTargetId()
    //Explicit target wins over the canvas selection (CoC attack/defence calls
    //pass the defender by id so the chain never depends on a token selection).
    if (options.targetId) {
      target = {
        targetId: options.targetId,
        targetType: options.targetType ?? 'actor',
        targetName: options.targetName ?? target.targetName,
      }
    }
    let weapon = ""
    let skill = ""
    let config = {
      rollType: options.rollType,
      cardType: options.cardType,
      dialogTemplate: 'systems/brp/templates/dialog/difficulty.hbs',
      chatTemplate: 'systems/brp/templates/chat/roll-result.html',
      state: options.state ?? "open",
      wait: options.wait ?? false,
      successLevel: -1,
      chatType: options.chatType,
      particName: partic.particName,
      particId: partic.particId,
      particType: partic.particType,
      particImg,
      targetName: target.targetName,
      targetId: target.targetId,
      targetType: target.targetType,
      characteristic: options.characteristic ?? false,
      skillId: options.skillId ?? false,
      skillBrpid: options.skillBrpid ?? null,
      itemId: options.itemId ?? false,
      addStat: options.addStat ?? "none",
      targetScore: options.targetScore ?? 0,
      rawScore: options.rawScore ?? 0,
      resistance: options.resistance ?? 0,
      diff: options.diff ?? "average",
      diffVal: options.diffVal ?? 1,
      //CoC's difficulty is a required band, not a target multiplier, so the
      //BRP numeric-difficulty setting must not replace the band dropdown.
      useDiffValue: Rules.active().check.requiredBand?.() ? false : game.settings.get('brp', 'diffValue'),
      rollFormula: options.rollFormula ?? "1D100",
      flatMod: options.flatMod ?? 0,
      diceMod: options.diceMod ?? 0,
      bonusDice: options.bonusDice ?? 0,
      penaltyDice: options.penaltyDice ?? 0,
      requiredBand: options.requiredBand ?? null,
      requiredBandLabel: null,
      minimumRank: 0,
      taskSuccess: null,
      band: null,
      bandRank: 0,
      diceDetail: null,
      opposed: options.opposed ?? null,
      tier: options.tier ?? null,
      damage: null,
      joinMessageId: options.joinMessageId ?? null,
      bandLabel: null,
      weaponId: options.itemId ?? null,
      weaponProfile: null,
      resultLevel: options.resultLevel ?? 0,
      malfunction: options.malfunction ?? 0,
      shiftKey: options.shiftKey ?? false,
      needDiff: options.needDiff ?? true,
      label: options.label ?? "",
      specLabel: options.specLabel ?? "",
      opp: options.opp ?? "false",
      description: "",
      askHand: false,
      askRange: false,
      handOptions: {},
      rangeOptions: {},
      handsUsed: "",
      rangeUsed: "dmg1",
      dmgCrit: 0,
      dmgSpec: 0,
      dmgNorm: 0,
      dmgCritForm: "",
      dmgSpecForm: "",
      dmgNormForm: "",
      firstAid: false,
      woundList: {},
      woundTreated: "",
      healing: 0,
      healingLabel: "",
      sanLossSuccess: options.sanLossSuccess ?? "1",
      sanLossFail: options.sanLossFail ?? "1D6",
      sanLossFormulaUsed: "",
      sanLoss: 0,
      sanAfter: null,
      permaInsane: false,
      madness: null
    }

    //A Sanity check is always a plain roll card
    if (options.rollType === 'SN') { options.cardType = 'NO' }

    //Adjust Config based on roll type
    switch (options.rollType) {
      case 'CH':
        config.label = particActor.system.stats[config.characteristic].labelShort ?? ""
        config.rawScore = particActor.system.stats[config.characteristic].total
        // CoC rolls a characteristic test against the value itself; the BRP
        // adapter keeps the historical x5 arithmetic.
        config.targetScore = Rules.active().check.characteristicTarget(config.rawScore)
        break
      case 'SK':
        skill = particActor.items.get(config.skillId)
        config.label = skill.name ?? ""
        config.skillBrpid = skill.flags?.brp?.brpidFlag?.id ?? null
        if (options.actor.type === 'npc') {
          config.rawScore = skill.system.total
          config.targetScore = skill.system.total
        } else {
          config.rawScore = skill.system.total + (options.actor.system.skillcategory[skill.system.category] ?? 0)
          config.targetScore = skill.system.total + (options.actor.system.skillcategory[skill.system.category] ?? 0)
        }
        if (["magic", "mutation", "psychic", "sorcery", "super", "failing"].includes(skill.type)) {
          config.description = skill.system.description.replace(/(<([^>]+)>)/g, "");
        }

        //Check for First Aid
        if (game.settings.get('brp', 'firstAidBRPID') != "" && game.settings.get('brp', 'firstAidBRPID') === skill.flags.brp.brpidFlag.id) {
          await BRPCheck.firstAid(config)
        }

        break
      case 'AL':
      case 'PA':
      case 'RP':
        skill = particActor.items.get(config.skillId)
        config.label = skill.name ?? ""
        config.rawScore = skill.system.total
        config.targetScore = skill.system.total
        break
      case 'PT':
        skill = particActor.items.get(config.skillId)
        config.label = skill.name ?? ""
        config.rawScore = skill.system.total
        config.targetScore = skill.system.total
        if (config.opp === 'true') {
          config.label = skill.system.oppName ?? ""
          config.rawScore = skill.system.opptotal
          config.targetScore = skill.system.opptotal
        }
        break;
      case 'SN':
        //Sanity check: target is the current SAN value itself (characteristic-style
        //channel, not a skill). Lazy creation snapshot for actors built by raw updates.
        await particActor.initSanity()
        config.label = particActor.system.sanity.label ?? game.i18n.localize('BRP.sanity')
        config.rawScore = particActor.system.sanity.value
        config.targetScore = particActor.system.sanity.value
        break
      case 'DM':
      case 'IM':
        weapon = particActor.items.get(config.itemId)
        config.label = weapon.name ?? ""
        if (options.rollType === 'IM') {
          config.label = config.label + " [" + game.i18n.localize('BRP.' + weapon.system.impact) + "] "
        }
        let damageData = await BRPCombatRoll.damageFormula(weapon, particActor, options.rollType, "")
        if (options.rollType === 'DM') {
          config.specLabel = game.i18n.localize('BRP.' + weapon.system.special)
        } else {
          config.specLabel = ""
        }
        config.rollFormula = damageData.damage
        config.resultLevel = damageData.success
        config.tier = Rules.active().combat?.damageTier
          ? (damageData.success === "4" ? 'extreme' : 'regular')
          : null
        config.shiftKey = true
        config.chatTemplate = 'systems/brp/templates/chat/roll-damage.html'
        break
      case 'CM':
        weapon = particActor.items.get(config.itemId)
        config.label = weapon.name ?? ""
        if (particActor.type === 'npc') {
          config.rawScore = weapon.system.npcVal
          config.targetScore = weapon.system.npcVal
        } else {
          skill = BRPCheck.weaponSkill(particActor, weapon, config.skillId)
          config.label = skill?.name ?? weapon.name ?? ""
          config.rawScore = (skill?.system?.total ?? 0) + (options.actor.system.skillcategory[skill?.system?.category] ?? 0)
          config.targetScore = config.rawScore
          config.skillId = skill?._id ?? config.skillId
        }
        config.malfunction = weapon.system.mal
        // CoC closes the attack: which defence the target declared and the
        // strike's own dice pool are decided here, not on a chat button.
        if (Rules.active().combat?.weaponProfile) {
          config.weaponProfile = Rules.active().combat.weaponProfile(weapon)
          config.weaponId = weapon._id
          config.skillBrpid = skill?.flags?.brp?.brpidFlag?.id ?? null
        }
        break
      case 'AR':
        config.label = options.label
        config.rollFormula = options.AVform
        config.shiftKey = true
        config.chatTemplate = 'systems/brp/templates/chat/roll-armour.html'
        break
      case 'QC':
        weapon = particActor.items.get(config.itemId)
        config.label = weapon.name ?? ""
        if (particActor.type === 'npc') {
          config.rawScore = weapon.system.npcVal
          config.targetScore = weapon.system.npcVal
        } else {
          skill = particActor.items.get(config.skillId)
          config.label = skill.name ?? ""
          config.rawScore = skill.system.total + (options.actor.system.skillcategory[skill.system.category] ?? 0)
          config.targetScore = skill.system.total + (options.actor.system.skillcategory[skill.system.category] ?? 0)
        }
        if (weapon.system.hands === "1-2H") {
          config.handOptions = Object.assign(config.handOptions, await BRPCombatRoll.getHandOptions(weapon));
          config.askHands = true
        }
        config.rangeOptions = Object.assign(config.rangeOptions, await BRPCombatRoll.getRangeOptions(weapon));
        if (Object.keys(config.rangeOptions).length > 1) { config.askRange = true }
        config.malfunction = weapon.system.mal
        config.chatTemplate = 'systems/brp/templates/chat/quick-combat.html'
        config.specLabel = game.i18n.localize('BRP.' + weapon.system.special)

        break
      default:
        ui.notifications.error(options.rollType + ": " + game.i18n.format('BRP.errorRollInvalid'))
        return false


    }

    //Adjust Config based on card type
    switch (options.cardType) {
      case 'NO':
        config.state = 'closed'
        break
      case 'RE':
      case 'PP':
        config.needDiff = false
        config.shiftKey = false
        config.state = 'closed'
        break
      case 'GR':
        config.wait = true
        config.chatType = CONST.CHAT_MESSAGE_STYLES.OTHER
        config.chatTemplate = 'systems/brp/templates/chat/roll-combined.html'
        break
      case 'OP':
        config.chatType = CONST.CHAT_MESSAGE_STYLES.OTHER
        config.chatTemplate = 'systems/brp/templates/chat/roll-opposed.html'
        break
      case 'CO':
        config.chatType = CONST.CHAT_MESSAGE_STYLES.OTHER
        config.chatTemplate = 'systems/brp/templates/chat/roll-cooperative.html'
        break
      case 'CB':
        config.chatType = CONST.CHAT_MESSAGE_STYLES.OTHER
        config.chatTemplate = 'systems/brp/templates/chat/roll-combat.html'
        break
      default:
        ui.notifications.error(options.cardType + ": " + game.i18n.format('BRP.errorCardInvalid'))
        return false
    }
    return config
  }


  //Start the check now that the config has been prepared
  static async startCheck(config) {
    let actor = await BRPactorDetails._getParticipant(config.particId, config.particType)
    //If Shift key has been held then accept the defaults above otherwise call a Dialog box for Difficulty, Modifier etc
    if (config.shiftKey) {
    } else {
      let usage = await BRPCheck.RollDialog(config)
      if (usage) {
        config.diff = usage.difficulty
        config.addStat = usage.addStat
        config.resistance = Number(usage.resistance)
        config.flatMod = Number(usage.flatMod)
        config.diffVal = Number(usage.diffVal)
        if (config.askHands) {
          config.handsUsed = usage.hands
        }
        if (config.askRange) {
          config.rangeUsed = usage.range
        }
        if (config.firstAid) {
          config.woundTreated = usage.wound
        }
        if (config.rollType === 'SN') {
          //Loss pair: a pure-formula preset wins unless the keeper customised it
          if (usage.sanLossPreset && usage.sanLossPreset !== 'custom') {
            const pair = String(usage.sanLossPreset).split('/')
            config.sanLossSuccess = pair[0] ?? '0'
            config.sanLossFail = pair[1] ?? '0'
          } else {
            config.sanLossSuccess = usage.sanLossSuccess ?? config.sanLossSuccess
            config.sanLossFail = usage.sanLossFail ?? config.sanLossFail
          }
        }

      } else {
        return
      }
    }

    //If this is a resistance roll and a second characteristic has been added updated chances and label
    if (config.addStat != 'none' && config.cardType === 'RE') {
      config.label = config.label + ' & ' + actor.system.stats[config.addStat].labelShort
      const add = actor.system.stats[config.addStat].total
      config.targetScore = config.targetScore + (Rules.active().check.characteristicTarget
        ? Rules.active().check.characteristicTarget(add)
        : add * 5)
    }

    //Adjust the targetScore for Difficulty.
    //CoC turns difficulty into a required success band and never multiplies the
    //target - doing both would count the half/fifth thresholds twice.
    const requiredBand = config.requiredBand ?? Rules.active().check.requiredBand?.(config.diff)
    if (requiredBand) {
      config.requiredBand = requiredBand
      config.minimumRank = Rules.active().combat?.bandRank
        ? Rules.active().combat.bandRank(requiredBand)
        : (config.resultLevel ?? 0)
      if (Number(config.flatMod)) { config.targetScore = Number(config.targetScore) + Number(config.flatMod) }
    } else if (config.useDiffValue) {
      if (config.rollType === 'CH') {
        config.targetScore = Math.ceil(config.targetScore * config.diffVal / 5)
      } else {
        config.targetScore = Math.ceil(config.targetScore * config.diffVal)
      }
    } else {
      switch (config.diff) {
        case "easy":
          config.targetScore = config.targetScore * 2
          break
        case "tricky":
          config.targetScore = Math.ceil(config.targetScore * 0.8)
          break
        case "awkward":
          config.targetScore = Math.ceil(config.targetScore * 0.6)
          break
        case "difficult":
          config.targetScore = Math.ceil(config.targetScore * 0.5)
          break
        case "hard":
          config.targetScore = Math.ceil(config.targetScore * 0.4)
          break
        case "extreme":
          config.targetScore = Math.ceil(config.targetScore * 0.2)
          break
        case "impossible":
          config.targetScore = 1
          break
      }
      //If this is not an impossible roll then add the flatModifier.
      if (config.diff != 'impossible') {
        config.targetScore = Number(config.targetScore) + Number(config.flatMod)
      }
    }

    //For Resistance and PvP recalc the Targetscore
    if (config.cardType === 'RE' || config.cardType === 'PP') {
      if (requiredBand) {
        // CoC has no resistance table: a POW-vs-POW contest is an opposed roll.
        // Keeping the BRP arithmetic here would fold a x5 target back into a
        // /5 step and invent a number, so the card stays a plain
        // characteristic test and the opposed comparison does the work.
        config.targetScore = Math.max(config.rawScore, 0)
        config.resistanceUnsupported = 'coc-resistance-use-opposed'
      } else {
        config.targetScore = (((config.targetScore / 5) - config.resistance) * 5) + 50
        //Change target score bases on game setting options
        if (game.settings.get('brp', 'resistRoll')) {
          config.targetScore = Math.max(config.targetScore, 1)
          config.targetScore = Math.min(config.targetScore, 99)
        } else {
          config.targetScore = Math.max(config.targetScore, 0)
          config.targetScore = Math.min(config.targetScore, 100)
        }
      }
    }

    if (!config.wait) {
      await BRPCheck.makeRoll(config)
    }

    //Sanity check settlement: write the paired loss back (success = small value,
    //failure = large value), accumulate the daily loss and drive the madness
    //state machine (tempInsane at TIS, permaInsane at zero).
    //CoC settles *after* the card exists: the write belongs to the active GM and
    //it rewrites this card's flags and content in one go (see _settleCoCSanity).
    const cocSanity = config.rollType === 'SN' && !!Rules.active().sanity?.core
    if (config.rollType === 'SN' && !cocSanity) {
      await BRPCheck._settleSanity(config, actor)
    }

    //CoC First Aid / Medicine: a successful roll itself is the treatment. The
    //write goes through the active GM when the patient is not owned by the
    //roller, and the card records what was applied.
    if (config.rollType === 'SK') {
      await BRPCheck._settleCoCMedical(config, actor)
    }

    //Format the data so it's in the same format as will be held in the Chat Message when saved
    let diffLabel = game.i18n.localize('BRP.' + config.diff)
    if (!config.diff) { diffLabel = config.diffVal }
    //CoC difficulty is a required band, so label it with the band wording.
    if (BRPCheck.isCoC() && config.requiredBand) {
      diffLabel = game.i18n.localize('BRP.cocBand.' + config.requiredBand)
    }

    let chatMsgData = {
      rollType: config.rollType,
      cardType: config.cardType,
      chatType: config.chatType,
      chatTemplate: config.chatTemplate,
      state: config.state,
      wait: config.wait,
      rolls: config.roll,
      successLevel: config.successLevel,
      rollResult: config.rollResult,
      chatCard: [{
        rollType: config.rollType,
        particName: config.particName,
        particId: config.particId,
        particType: config.particType,
        particImg: config.particImg,
        targetName: config.targetName,
        targetId: config.targetId,
        targetType: config.targetType,
        characteristic: config.characteristic ?? false,
        label: config.label,
        skillId: config.skillId,
        itemId: config.itemId,
        addStat: config.addStat,
        targetScore: config.targetScore,
        rawScore: config.rawScore,
        resistance: config.resistance,
        diff: config.diff,
        diffVal: config.diffVal,
        useDiffValue: config.useDiffValue,
        diffLabel: diffLabel,
        rollFormula: config.rollFormula,
        flatMod: config.flatMod,
        diceMod: config.diceMod,
        malfunction: config.malfunction,
        rollResult: config.rollResult,
        rollVal: config.rollVal,
        roll: config.roll,
        diceRolled: config.diceRolled,
        resultLevel: config.resultLevel,
        resultLabel: BRPCheck.resultLabel(config),
        band: config.band,
        bandRank: config.bandRank,
        bandLabel: config.bandLabel,
        diceDetail: config.diceDetail,
        requiredBand: config.requiredBand,
        requiredBandLabel: config.requiredBandLabel ?? null,
        minimumRank: config.minimumRank,
        taskSuccess: config.taskSuccess,
        opposed: config.opposed,
        tier: config.tier,
        damage: config.damage,
        cocTreatment: config.cocTreatment ?? null,
        weaponProfile: config.weaponProfile ?? null,
        specLabel: config.specLabel,
        opp: config.opp,
        description: config.description,
        dmgCrit: config.dmgCrit,
        dmgSpec: config.dmgSpec,
        dmgNorm: config.dmgNorm,
        dmgCritForm: config.dmgCritForm,
        dmgSpecForm: config.dmgSpecForm,
        dmgNormForm: config.dmgNormForm,
        healing: config.healing,
        healingLabel: config.healingLabel,
        sanLossSuccess: config.sanLossSuccess,
        sanLossFail: config.sanLossFail,
        sanLossFormulaUsed: config.sanLossFormulaUsed,
        sanLoss: config.sanLoss,
        sanAfter: config.sanAfter,
        permaInsane: config.permaInsane,
        luck: BRPLuck.cardLuck(actor, config.chatTemplate, {
          rollType: config.rollType,
          cardType: config.cardType,
          // The card is built after the roll, so the snapshot carries the
          // natural die/band. CoC then refuses a button on a fumble, a natural
          // 01, a Sanity/loss card or a damage/malfunction card; octopus ignores
          // these values and keeps its historical unrestricted spend.
          rollVal: Number.isFinite(Number(config.rollVal)) ? Number(config.rollVal) : null,
          band: config.band ?? null,
          pushed: config.pushed === true,
        }),
        luckSpent: 0
      }],
      madness: config.madness
    }


    //Create the ChatMessage and Roll Dice
    //A defence/injury roll joins an existing CoC card instead of opening another
    //message: one card, one comparison, one damage resolution.
    if (config.joinMessageId) {
      await GRCard.GRAdd({ ...chatMsgData, cocJoin: true }, config.joinMessageId)
      return config.joinMessageId
    }

    //CoC: an attack card is the attacker's own open card only when it is the
    //same attacker and still waiting for a defender. `checkNewMsg` matches on
    //card type alone, which would silently graft a second attacker's strike
    //onto an unrelated open card, so the reuse is gated on identity here.
    if (BRPCheck.isCoC() && config.cardType === 'CB') {
      const openId = await BRPCheck.checkNewMsg(chatMsgData)
      const open = openId ? await game.messages.get(openId) : null
      const sameInitiator = open?.flags?.brp?.chatCard?.length === 1
        && open.flags.brp.chatCard[0].particId === chatMsgData.chatCard[0].particId
        && open.flags.brp.chatCard[0].opposed?.role === 'attacker'
      if (sameInitiator && open.flags.brp.cardType === 'CB') {
        await GRCard.GRAdd({ ...chatMsgData, cocJoin: true }, openId)
        return openId
      }
    } else if (['GR', 'OP', 'CO', 'CB'].includes(config.cardType)) {
      let checkMsgId = await BRPCheck.checkNewMsg(chatMsgData)
      if (checkMsgId != false) {
        //Trigger adding check to the card.
        await GRCard.GRAdd({ ...chatMsgData, cocJoin: BRPCheck.isCoC() }, checkMsgId)
        return checkMsgId
      }
    }


    const html = await BRPCheck.startChat(chatMsgData)
    let msgId = await BRPCheck.showChat(html, chatMsgData)

    //CoC SAN: settle through the single writer, which rewrites this card. The
    //card exists first so the GM has a message id to patch in one write.
    if (cocSanity) {
      config.pendingMessageId = msgId
      await BRPCheck._settleSanity(config, actor)
    }

    //Check for adding Improvement tick depending on autoXP game setting
    if (actor.type === 'character' && ["1", "2"].includes(game.settings.get('brp', 'autoXP'))) {
      await BRPCheck.tickXP(chatMsgData)
    }

    return msgId
  }

  //Call Dice Roll, calculate Result and store original results in rollVal
  static async makeRoll(config) {
    const rules = Rules.active()
    // CoC bonus/penalty dice: one units die + (1 + net) tens dice in a single
    // real Roll; the percentile value is read from the faces (never from the
    // summed total, which is not a d100).
    const percentilePool = rules.check.supportsBonusDice && !['DM', 'AR', 'IM'].includes(config.rollType)
      ? rules.check.dice?.dicePool({ bonus: config.bonusDice, penalty: config.penaltyDice }) ?? null
      : null
    // The dice pool itself decides the formula; a plain check stays 1D100.
    if (percentilePool) {
      config.rollFormula = rules.check.d100Formula({ bonus: config.bonusDice, penalty: config.penaltyDice })
    }

    let roll = new Roll(config.rollFormula)
    await roll.evaluate()
    config.roll = roll
    config.rollResult = Number(roll.total)
    config.rollVal = Number(config.rollResult)

    const faceValues = []
    let diceRolled = ""
    for (let diceRoll = 0; diceRoll < roll.dice.length; diceRoll++) {
      for (let thisDice = 0; thisDice < roll.dice[diceRoll].values.length; thisDice++) {
        if (thisDice != 0 || diceRoll != 0) {
          diceRolled = diceRolled + ", "
        }
        diceRolled = diceRolled + roll.dice[diceRoll].values[thisDice]
        faceValues.push(Number(roll.dice[diceRoll].values[thisDice]))
      }
    }
    config.diceRolled = diceRolled

    if (percentilePool && percentilePool.tensDice > 1) {
      const resolved = rules.check.dice.resolveD100({
        results: faceValues,
        bonus: config.bonusDice,
        penalty: config.penaltyDice,
      })
      config.rollVal = resolved.rollVal
      config.diceDetail = {
        formula: config.rollFormula,
        faces: faceValues,
        units: resolved.units,
        tens: resolved.tens,
        chosenTens: resolved.chosenTens,
        candidates: resolved.candidates,
        bonus: resolved.bonus,
        penalty: resolved.penalty,
        choose: resolved.choose,
      }
    } else if (percentilePool) {
      // 1D100 reads as its own face (01-100); the tens/units pair is kept for
      // display and audit so the card shows the same faces the die had.
      const face = faceValues[0]
      const rollVal = Number.isFinite(face) ? face : Number(config.rollResult)
      const tens = Math.floor(rollVal / 10) % 10
      config.rollVal = rollVal
      config.diceDetail = {
        formula: config.rollFormula,
        faces: [face],
        units: rollVal % 10,
        tens,
        chosenTens: tens,
        candidates: [{ tens, value: rollVal }],
        bonus: 0,
        penalty: 0,
        choose: 'lowest',
      }
    }

    //Don't need success levels in some cases
    if (['DM', 'AR', 'IM'].includes(config.rollType)) { return }

    //Get the level of Success
    config.resultLevel = await BRPCheck.successLevel(config)
    const bandInfo = BRPCheck.successBand(config)
    config.band = bandInfo.band
    config.bandRank = rules.combat?.bandRank ? rules.combat.bandRank(bandInfo.band) : config.resultLevel
    // CoC shows the full band label; octopus keeps its historical 0-4 labels.
    config.bandLabel = BRPCheck.isCoC() && config.band
      ? game.i18n.localize('BRP.cocBand.' + config.band)
      : null
    // CoC difficulty is a required band: the task succeeds only if the roll
    // reached it. The roll keeps its own band either way.
    if (config.requiredBand) {
      config.taskSuccess = config.bandRank >= rules.combat.bandRank(config.requiredBand)
      config.requiredBandLabel = BRPCheck.isCoC()
        ? game.i18n.localize('BRP.cocBand.' + config.requiredBand)
        : null
    }

    //If a Sanity Roll then roll the paired loss formula (small on success, large on failure)
    if (config.rollType === 'SN') {
      const formula = (config.resultLevel >= 2) ? String(config.sanLossSuccess) : String(config.sanLossFail)
      config.sanLossFormulaUsed = formula
      const loss = await BRPCheck._rollSanLoss(formula)
      config.sanLoss = loss
    }

    //If a Combat Roll and with a malfunction chance > 0 then make the check
    if (config.rollType === 'CM' && config.malfunction > 0 && config.rollVal >= config.malfunction) {
      config.malfunction = -config.malfunction
    }

    //If Resistance roll and not using detailed results then change result to simple Success/Failure
    if ((config.cardType === 'RE' || config.cardType === 'PP') && !game.settings.get('brp', 'resistLevels')) {
      if (config.resultLevel > 2) { config.resultLevel = 2 }
      if (config.resultLevel < 1) { config.resultLevel = 1 }
    }

    //If Successful Quick Combat Roll then get the damage scores
    if (config.rollType === 'QC' && config.resultLevel > 1) {
      let actor = await BRPactorDetails._getParticipant(config.particId, config.particType)
      let weapon = await actor.items.get(config.itemId)
      let damBon = await BRPCombatRoll.getDamageBonus(actor, weapon, config.handsUsed)
      let damForm = weapon.system[config.rangeUsed]

      config.dmgCritForm = await BRPCombatRoll.damageAssess(weapon, damForm, damBon, "4", "DM")
      config.dmgSpecForm = await BRPCombatRoll.damageAssess(weapon, damForm, damBon, "3", "DM")
      config.dmgNormForm = await BRPCombatRoll.damageAssess(weapon, damForm, damBon, "2", "DM")

      let critRoll = new Roll(config.dmgCritForm)
      await critRoll.evaluate()
      config.dmgCrit = Number(critRoll.total)
      let specRoll = new Roll(config.dmgSpecForm)
      await specRoll.evaluate()
      config.dmgSpec = Number(specRoll.total)
      let normRoll = new Roll(config.dmgNormForm)
      await normRoll.evaluate()
      config.dmgNorm = Number(normRoll.total)
    }

    //If First Aid Roll
    if (config.firstAid) {
      let healing = []
      healing = await BRPDamage.applyHealing(config.woundTreated, config.resultLevel)
      config.healing = healing.value
      config.healingLabel = healing.formula
    }
    return
  }



  //Evaluate one side of a sanity loss formula; invalid/empty formulas cost nothing
  static async _rollSanLoss(formula) {
    if (!formula || Number(formula) === 0) { return 0 }
    try {
      const roll = new Roll(formula)
      await roll.evaluate()
      return Math.max(0, Math.floor(Number(roll.total) || 0))
    } catch {
      return 0
    }
  }

  //Apply a sanity loss to the actor: clamp at zero, never below, accumulate the
  //daily loss and return the resulting state
  static async _applySanLoss(actor, loss) {
    const san = actor.system.sanity
    const applied = Math.max(0, Math.min(Math.floor(Number(loss) || 0), san.value))
    const value = san.value - applied
    const dailyLoss = (Number(san.dailyLoss) || 0) + applied
    await actor.update({
      'system.sanity.value': value,
      'system.sanity.dailyLoss': dailyLoss
    })
    return { loss: applied, value, dailyLoss, tis: actor.system.sanity.tis }
  }

  //SN settlement after the roll. Octopus keeps the historical inline path (TIS
  //daily-loss threshold -> episode, zero -> permaInsane). CoC delegates to the
  //single-writer settlement in module/apps/sanity.mjs: loss >= 5 needs a real INT
  //roll and only then a 1D10h episode; the per-game-day fifth is the separate
  //indefinite state.
  static async _settleSanity(config, actor) {
    if (!Rules.active().settings.useSAN()) { return }
    if (Rules.active().sanity?.core) {
      return BRPCheck._settleCoCSanity(config, actor)
    }
    const result = await BRPCheck._applySanLoss(actor, config.sanLoss)
    config.sanLoss = result.loss
    config.sanAfter = result.value

    //SAN reached zero - permanent insanity, no interaction beyond the announcement
    if (result.value <= 0) {
      config.permaInsane = true
      await BRPMadness.applyPermaInsane(actor)
      return
    }

    //Daily loss reached the TIS threshold - a madness episode joins this card
    if (result.dailyLoss >= result.tis) {
      const madness = await BRPMadness.resolveMadness(actor)
      await BRPMadness.applyTempInsane(actor, madness)
      config.madness = BRPMadness.madnessFlag(actor, madness)
    }
    return
  }

  //CoC SAN settlement. The roll itself already happened on this client; the write
  //is not ours to make unless we are the active GM. Non-writers hand the decided
  //loss to the single writer and read the result back from the card flags.
  static async _settleCoCSanity(config, actor) {
    const result = await BRPSanity.settle({
      actor,
      loss: config.sanLoss,
      cardMessageId: config.pendingMessageId ?? null,
      reason: 'sanity-roll',
    })
    if (result?.queued) {
      // The GM applies the loss and rewrites the card; this client must not also
      // write, or two clients would both settle the same roll.
      config.sanityQueued = { by: result.by, loss: result.loss }
      config.reown = true
      return result
    }
    if (result?.error) {
      config.sanityError = result.error
      return result
    }
    if (result?.applied === false) {
      config.permaInsane = result.reason === 'permanent-insanity'
      return result
    }
    config.sanLoss = result.loss
    config.sanAfter = result.sanAfter
    config.permaInsane = result.permanent === true
    config.sanity = {
      value: result.sanAfter,
      singleLoss: result.singleLoss,
      dailyLoss: result.dailyLoss,
      dayId: result.dayId,
      dayStartSan: result.dayStartSan,
      intCheck: result.intCheck,
      temporary: result.temporary,
      indefinite: result.indefinite,
      permanent: result.permanent,
    }
    if (result.temporary?.active === true) {
      config.madness = {
        actorId: actor.id,
        particName: actor.name,
        ruleset: 'coc',
        manifestation: {
          index: result.temporary.bout.index,
          key: result.temporary.bout.id,
          name: game.i18n.localize(`BRP.coc.madness.bouts.${result.temporary.bout.id}`),
          description: game.i18n.localize(`BRP.coc.madness.boutsDesc.${result.temporary.bout.id}`),
        },
        duration: {
          key: `${result.temporary.hours}h`,
          hours: result.temporary.hours,
          label: game.i18n.localize('BRP.coc.madness.durationHours').replace('{hours}', String(result.temporary.hours)),
        },
        bout: result.temporary.rounds,
        intCheck: result.intCheck,
        expiresAt: result.temporary.expiresAt,
        ended: false,
      }
    }
    return result
  }

  //Function to call the Difficulty & Modifier Dialog box
  static async RollDialog(options) {
    let data = ""
    const addStatOptions = await BRPSelectLists.addStatOptions(options.characteristic)
    const difficultyOptions = await BRPSelectLists.getDifficultyOptions()
    switch (options.rollType) {
      case 'DM':
      case 'IM':
        data = {
          type: options.rollType,
          rangeOptions: options.rangeOptions,
          handOptions: options.handOptions,
          successOptions: options.successOptions,
          label: options.label,
          askHands: options.askHands,
          askRange: options.askRange,
          askSuccess: options.askSuccess,
          askLevel: options.askLevel
        }
        break
      case 'CH':
        const difficultyCHOptions = await BRPSelectLists.getCHDifficultyOptions()
        data = {
          type: options.rollType,
          addStat: options.addStat,
          diffVal: options.diffVal,
          cardType: options.cardType,
          needDiff: options.needDiff,
          useDiffValue: options.useDiffValue,
          label: options.label,
          diff: options.diff,
          difficultyOptions: difficultyCHOptions,
          addStatOptions,
        }
        break
      case 'QC':
        data = {
          type: options.rollType,
          diffVal: options.diffVal,
          cardType: options.cardType,
          needDiff: options.needDiff,
          useDiffValue: options.useDiffValue,
          label: options.label,
          diff: options.diff,
          difficultyOptions: difficultyOptions,
          askHands: options.askHands,
          askRange: options.askRange,
          rangeOptions: options.rangeOptions,
          handOptions: options.handOptions,
        }
        break
      case 'SN':
        data = {
          type: options.rollType,
          diffVal: options.diffVal,
          cardType: options.cardType,
          needDiff: options.needDiff,
          useDiffValue: options.useDiffValue,
          label: options.label,
          diff: options.diff,
          difficultyOptions: difficultyOptions,
          sanLossPresets: BRPCheck.sanLossPresets(),
          sanLossSuccess: options.sanLossSuccess,
          sanLossFail: options.sanLossFail
        }
        break

      default:

        data = {
          type: options.rollType,
          addStat: options.addStat,
          diffVal: options.diffVal,
          cardType: options.cardType,
          needDiff: options.needDiff,
          useDiffValue: options.useDiffValue,
          label: options.label,
          diff: options.diff,
          difficultyOptions,
          addStatOptions,
          firstAid: options.firstAid,
          woundList: options.woundList
        }
        break
    }
    const html = await foundry.applications.handlebars.renderTemplate(options.dialogTemplate, data)
    const dlg = await BRPDialog.input({
      window: {title: game.i18n.localize('BRP.diceRoll')},
      content: html,
      ok: {
        label: game.i18n.localize('BRP.proceed')
      }
    })
    return dlg
  }

  //Paired sanity loss formula presets - pure formulas only, the keeper pairs
  //them with the source of horror at the table (no table text is bundled)
  static sanLossPresets() {
    const pairs = ['0/1', '0/1D4', '1/1D4', '1/1D6', '1D3/1D10', '1D4/1D20']
    const presets = { custom: game.i18n.localize('BRP.sanLossPresets.custom') }
    for (const p of pairs) { presets[p] = p }
    return presets
  }

  // Calculate Success Level. Delegated to the active ruleset: the default
  // octopus implementation is the original BRP arithmetic, while CoC uses its
  // own official band thresholds.
  //
  static async successLevel(config) {
    return Rules.active().check.successLevel(config)
  }

  // Full band label for callers that need CoC's Regular/Hard/Extreme split.
  static successBand(config) {
    return Rules.active().check.successBand(config)
  }

  // CoC is the only ruleset with the band vocabulary and the contact sheet is
  // the ruleset seam for it; every CoC-only branch goes through this gate.
  static isCoC() {
    return Rules.activeId() === 'coc'
  }

  // Label for the roll's own band. Octopus keeps its 0-4 wording byte-for-byte.
  static resultLabel(config) {
    if (BRPCheck.isCoC() && config?.rollType === 'DM' && config.tier) {
      return game.i18n.localize('BRP.cocBand.' + config.tier)
    }
    if (BRPCheck.isCoC() && config?.band) {
      return game.i18n.localize('BRP.cocBand.' + config.band)
    }
    return game.i18n.localize('BRP.resultLevel.' + config.resultLevel)
  }


  // Prep the chat card
  static async startChat(chatMsgData) {
    let html = await foundry.applications.handlebars.renderTemplate(chatMsgData.chatTemplate, chatMsgData)
    return html
  }


  // Display the chat card and roll the dice
  static async showChat(html, chatMsgData) {
    let chatData = {}
    chatData = {
      author: game.user.id,
      type: chatMsgData.chatType,
      content: html,
      flags: {
        'brp': {
          initiator: chatMsgData.chatCard[0].particId,
          initiatorType: chatMsgData.chatCard[0].particType,
          chatTemplate: chatMsgData.chatTemplate,
          state: chatMsgData.state,
          cardType: chatMsgData.cardType,
          rollType: chatMsgData.rollType,
          wait: chatMsgData.wait,
          successLevel: chatMsgData.successLevel,
          chatCard: chatMsgData.chatCard,
          opp: chatMsgData.opp,
          madness: chatMsgData.madness,
        }
      },
      speaker: {
        actor: chatMsgData.chatCard[0].particId,
        alias: chatMsgData.chatCard[0].particName,
      },
    }
    if (['NO', 'RE', 'PP'].includes(chatMsgData.cardType)) {
      chatData.rolls = [chatMsgData.rolls]
    } else if (BRPCheck.isCoC() && chatMsgData.rolls) {
      //CoC combat/opposed cards carry the real Roll too, so the dice shown are
      //the dice that were rolled (Dice So Nice reads rolls, not the stored faces).
      chatData.rolls = [chatMsgData.rolls]
    }

    let msg = await ChatMessage.create(chatData)
    return msg._id
  }


  //Handle XP tickbox
  static async tickXP(msg) {
    let item = ""
    let actor = ""
    let autoXP = game.settings.get('brp', 'autoXP')
    //Auto-tick only exists for the two "on success"/"on failure" settings;
    //card resolves call this unconditionally, so keep "off" truly off.
    if (!['1', '2'].includes(String(autoXP))) { return }
    //CoC: only a success earns a tick. "Tick on failure" is a BRP option, so it
    //is read as the success-only setting here instead of ticking failures.
    const growth = Rules.active().growth
    if (growth?.ticksOnFailure === false && String(autoXP) === '2') { autoXP = '1' }
    //Don't do XP check until card is closed
    if (msg.state != 'closed') { return }
    if (!msg.chatCard?.length) { return }
    switch (msg.cardType) {
      case "RE":
        //No checks for a resist card
        return
      case "PP":
        //CoC has no POW improvement: a POW-vs-POW card never ticks a stat.
        if (growth?.allowPowImprovement === false) { return }
        //If a POW v POW check target POW greater than current POW
        actor = await BRPactorDetails._getParticipant(msg.chatCard[0].particId, msg.chatCard[0].particType)
        //Only characters get XP checks (NPCs have no development phase)
        if (!actor || actor.type !== 'character') { return }
        if (msg.chatCard[0].resistance <= actor.system.stats.pow.total) { return }
        if (String(autoXP) === '1' && msg.chatCard[0].resultLevel < 2) { return }
        if (String(autoXP) === '2' && msg.chatCard[0].resultLevel > 1) { return }
        await actor.update({ 'system.stats.pow.improve': true })
        break
      case "NO":
      case "GR":
      case "OP":
      case "CB":
      case "CO":
        //Allow checks for Normal,Combined and Oppossed cards, unless it's a Characteristic or Allegiance Check or a Damage Roll or an Impact Roll
        if (['CH', 'SN', 'AL', 'DM', 'IM'].includes(msg.rollType)) { return }
        for (let i of msg.chatCard) {
          //CoC has no difficulty multiplication; only octopus skips easy/raised
          //rolls. A CoC roll that missed its required band never ticks.
          if (Rules.active().check.xpSkipsRaisedDifficulty === true && (i.diff === 'easy' || i.diffVal > 1)) { continue }
          if (i.taskSuccess === false) { continue }
          if (String(autoXP) === '1' && i.resultLevel < 2) { continue }
          if (String(autoXP) === '2' && i.resultLevel > 1) { continue }
          actor = await BRPactorDetails._getParticipant(i.particId, i.particType)
          //Only characters get XP checks (NPCs have no development phase), and
          //NPC weapon/combat entries carry no skillId - nothing to tick there
          if (!actor || actor.type !== 'character') { continue }
          item = await actor.items.get(i.skillId)
          if (!item) { continue }
          //CoC: the Mythos skill can never be improved, so it never gets a tick.
          if (Rules.active().check.xpSkipsNoXP === true && item.system?.noXP === true) { continue }
          //CoC: the decision core owns the tick condition - a success, no Luck
          //spent on it, no noXP marker, and only skill rolls.
          if (growth?.canTick) {
            const decision = growth.canTick({
              rollType: msg.rollType,
              resultLevel: Number(i.resultLevel),
              band: i.band ?? null,
              luckSpent: Number(i.luckSpent ?? 0),
              noXP: item.system?.noXP === true,
              actorType: actor.type,
            })
            if (decision?.allowed !== true) { continue }
          }
          if (item.type != 'reputation') {
            if (item.type === 'persTrait' && i.opp === 'true') {
              await item.update({ 'system.oppimprove': true })
            } else {
              await item.update({ 'system.improve': true })
            }
          }
        }
        break
    }
    return
  }


  //Function when Chat Message buttons activated to call socket
  static async triggerChatButton(event) {
    const targetElement = event.currentTarget
    const presetType = targetElement.dataset?.preset
    const dataset = targetElement.dataset
    const targetChat = $(targetElement).closest('.message')
    let targetChatId = targetChat[0].dataset.messageId
    let origin = game.user.id
    let originGM = game.user.isGM

    //Single writer: Foundry's activeGM is deterministic among active GMs
    //(highest role, then lowest user id, core users.mjs). Every client routes
    //chat-button work to it; that client's BRPLuck._spendChain serializes the
    //read-modify-write, so two GMs cannot spend against the same stale budget.
    const writer = game.users.activeGM
    if (!writer) {
      ui.notifications.warn(game.i18n.localize('BRP.noAvailableGM'))
      return
    }
    if (game.user.id === writer.id) {
      await BRPCheck.handleChatButton({ presetType, targetChatId, origin, originGM, event, dataset })
    } else {
      game.socket.emit('system.brp', {
        type: 'chatUpdate',
        to: writer.id,
        //DOM event is not serializable; the handler does not read it
        value: { presetType, targetChatId, origin, originGM, dataset: { ...dataset } }
      })
    }
  }


  //Handle changes to Cards based on the presetType value - will be carried out by a GM
  static async handleChatButton(data) {
    //Defence in depth: only the designated GM acts, even if a client calls this
    //directly instead of going through triggerChatButton.
    const writer = game.users.activeGM
    if (!writer || game.user.id !== writer.id) { return }
    const presetType = data.presetType
    let targetMsg = await game.messages.get(data.targetChatId)

    switch (presetType) {
      case "close-card":
        await GRCard.GRClose(data)
        break
      case "remove-gr-roll":
        await GRCard.GRRemove(data)
        break
      case "resolve-gr-card":
        await GRCard.GRResolve(data)
        break
      case "resolve-op-card":
        await OPCard.OPResolve(data)
        break
      case "resolve-cb-card":
        await CBCard.CBResolve(data)
        break
      case "resolve-co-card":
        await COCard.COResolve(data)
        break
      case "madness-reroll-manifestation":
        await BRPMadness.rerollManifestation(data)
        break
      case "madness-reroll-duration":
        await BRPMadness.rerollDuration(data)
        break
      case "madness-set-duration":
        await BRPMadness.setDuration(data)
        break
      case "madness-end":
        await BRPMadness.endMadness(data)
        break
      case "luck-spend-1":
      case "luck-spend-5":
      case "luck-spend-10":
        await BRPLuck.spendFromCard({ ...data, amount: Number(presetType.split('-').pop()) })
        break
      case "luck-spend-custom":
        await BRPLuck.spendCustom(data)
        break
      case "madness-add-trait":
        await BRPMadness.addTrait(data)
        break
      default:
        return
    }
    const pushhtml = await BRPCheck.startChat(targetMsg.flags.brp)
    await targetMsg.update({ content: pushhtml })

    return
  }


  //Check to see if there is an open card that matches the cardTyoe that's not more than a day old
  static async checkNewMsg(config) {
    //Each CoC attack is its own card: joining an older open attack would merge
    //two unrelated fights into one comparison. Generic opposed (OP) cards keep
    //the native "one open card, add the opponent" flow.
    if (BRPCheck.isCoC() && config.cardType === 'CB') { return false }
    let messages = ui.chat.collection.filter(message => {
      if (
        config.cardType === message.getFlag('brp', 'cardType') &&
        message.getFlag('brp', 'state') !== 'closed'
      ) {
        if (['GR'].includes(config.cardType)) {
          return message.getFlag('brp', 'initiator') === config.chatCard[0].particId
        }
        return true
      }
      return false
    })

    if (messages.length) {
      // Old messages can't be used if message is more than a day old mark it as resolved
      const timestamp = new Date(messages[0].timestamp)
      const now = new Date()
      const timeDiffSec = (now - timestamp) / 1000
      if (60 * 60 * 24 < timeDiffSec) {
        await messages[0].setFlag('brp', 'state', 'closed')
        messages = []
      }
    }

    if (!messages.length) { return false }
    else { return messages[0].id }
  }

  // -------------------------------------------------------------------------
  // CoC M3 combat chain (native, callable without any chat DOM):
  //   cocAttack -> cocDefend -> cocResolve -> BRPDamage.applyCoCDamage
  // Every entry point accepts plain ids so a frontend adapter or a macro can
  // drive the same chain the sheet uses. Dice are always real Rolls; when a
  // rule asks for a new roll (tie, dive for cover) the result says `reroll`
  // instead of choosing a winner from dice that are already on the table.
  // -------------------------------------------------------------------------

  static async _cocActor({ actor, actorId, actorType } = {}) {
    if (actor) { return actor }
    if (!actorId) { return null }
    return BRPactorDetails._getParticipant(actorId, actorType ?? 'actor')
  }

  static _cocActorRef(actor) {
    return { actorId: actor.id, actorType: actor.token ? 'token' : 'actor' }
  }

  // Cross-owner writes go through Foundry's deterministic active GM; an owner
  // writing their own actor stays local.
  static async _cocWrite(fn, value = {}) {
    const target = await BRPCheck._cocActor(value)
    if (!target) { return { error: 'actor-missing' } }
    if (BRPDamage.cocWriteAllowed(target)) {
      const { actor, actorId, actorType, ...rest } = value
      return BRPDamage[fn](target, rest)
    }
    const writer = game.users?.activeGM
    if (!writer) { return { error: 'no-active-gm' } }
    const { actor: _actor, ...payload } = value
    game.socket.emit('system.brp', { type: 'cocWrite', to: writer.id, value: { fn, origin: game.user?.id, ...payload } })
    return { queued: true, by: writer.id }
  }

  // The active GM is the only writer for a card resolution (it touches both
  // combatants). Other clients hand the request over and return `queued`.
  static async _cocGmOnly(type, value) {
    const writer = game.users?.activeGM
    if (!writer) { return { error: 'no-active-gm' } }
    if (game.user?.id === writer.id) { return null }
    game.socket.emit('system.brp', { type, to: writer.id, value })
    return { queued: true, by: writer.id }
  }

  // Attacker side. Params:
  //   actor/actorId, itemId (weapon), skillId (optional; brpid is authoritative)
  //   targetId/targetType (defaults to the selected token)
  //   bonusDice/penaltyDice, requiredBand, flatMod
  //   shots, distanceFeet (only when the caller knows them)
  //   maneuver {defenderBuild}, outnumbered {defenderActedThisRound}
  static async cocAttack(options = {}) {
    if (!BRPCheck.isCoC()) { return { error: 'ruleset-not-coc' } }
    const actor = await BRPCheck._cocActor(options)
    if (!actor) { return { error: 'actor-missing' } }
    if (!game.user?.isGM && actor.isOwner !== true) { return { error: 'not-authorised' } }
    const weapon = actor.items.get(options.itemId)
    if (!weapon) { return { error: 'weapon-missing' } }
    // A PC weapon must resolve to a real skill by brpid; an unverified
    // specialism has no base value and must not silently attack at 0.
    if (actor.type !== 'npc') {
      const skill = BRPCheck.weaponSkill(actor, weapon, options.skillId ?? weapon.system?.skill1)
      if (!skill) { return { error: 'weapon-skill-missing', brpid: weapon.system?.skill1 ?? null } }
    }
    const combat = Rules.active().combat
    const profile = combat.weaponProfile(weapon)
    let bonus = Math.max(0, Number(options.bonusDice ?? 0))
    let penalty = Math.max(0, Number(options.penaltyDice ?? 0))

    if (profile.ranged) {
      penalty += combat.shotsPenalty({ shots: options.shots ?? 0 })
      if (options.distanceFeet !== undefined && options.distanceFeet !== null) {
        bonus += combat.pointBlankBonus({ distanceFeet: options.distanceFeet, dex: actor.system?.stats?.dex?.total ?? 0 })
      }
    }
    let maneuver = null
    if (options.maneuver && options.maneuver.defenderBuild !== undefined) {
      if (profile.ranged) { return { error: 'maneuver-needs-melee' } }
      maneuver = combat.maneuverPenalty({ attackerBuild: actor.system?.build ?? 0, defenderBuild: options.maneuver.defenderBuild })
      if (!maneuver.effective) { return { error: 'maneuver-ineffective', maneuver } }
      penalty += maneuver.penalty
    }
    if (options.outnumbered?.defenderActedThisRound) {
      bonus += combat.outnumberedBonus({ defenderActedThisRound: true, ranged: profile.ranged })
    }

    const target = options.targetId
      ? {
        targetId: options.targetId,
        targetType: options.targetType ?? (game.actors.get(options.targetId) ? 'actor' : 'token'),
        targetName: options.targetName,
      }
      : {}
    const messageId = await BRPCheck._trigger({
      rollType: 'CM',
      cardType: 'CB',
      itemId: options.itemId,
      skillId: options.skillId ?? weapon.system?.skill1 ?? false,
      shiftKey: true,
      actor,
      token: actor.token ?? null,
      bonusDice: bonus,
      penaltyDice: penalty,
      requiredBand: options.requiredBand ?? null,
      flatMod: options.flatMod ?? 0,
      ...target,
      opposed: {
        role: 'attacker',
        kind: profile.kind,
        ranged: profile.ranged,
        maneuver: !!maneuver,
        maneuverData: maneuver,
        defense: null,
      },
    })
    return { messageId, profile, bonusDice: bonus, penaltyDice: penalty, maneuver }
  }

  // Defender side: declares dodge / fightback / dive-for-cover and rolls into
  // the attacker's card. Params:
  //   messageId, actor/actorId, choice, itemId (fightback weapon), skillId (dodge)
  static async cocDefend(options = {}) {
    if (!BRPCheck.isCoC()) { return { error: 'ruleset-not-coc' } }
    const messageId = options.messageId
    if (!messageId) { return { error: 'message-missing' } }
    const message = await game.messages.get(messageId)
    if (!message) { return { error: 'message-missing' } }
    if (message.flags?.brp?.state === 'closed') { return { error: 'card-closed' } }
    const entries = message.flags?.brp?.chatCard ?? []
    if (entries.length >= 2) { return { error: 'card-full' } }
    const attacker = entries.find((entry) => entry.opposed?.role === 'attacker') ?? entries[0]
    if (!attacker) { return { error: 'attacker-entry-missing' } }

    const actor = await BRPCheck._cocActor(options)
    if (!actor) { return { error: 'actor-missing' } }
    if (!game.user?.isGM && actor.isOwner !== true) { return { error: 'not-authorised' } }
    if (!game.users?.activeGM) { return { error: 'no-active-gm' } }
    const kind = attacker.opposed?.kind ?? attacker.weaponProfile?.kind ?? 'melee'
    // A card names its target; a non-GM can only add the declared defender.
    const targetId = attacker.targetId ?? attacker.opposed?.targetId
    const defenderIds = [actor.id, actor.token?.id, actor.token?.document?.id].filter(Boolean)
    if (targetId && !defenderIds.includes(targetId) && !game.user?.isGM) {
      return { error: 'not-the-target' }
    }
    const choice = options.choice ?? 'dodge'
    const combat = Rules.active().combat
    const dodgeItem = [...actor.items].find((item) => item.type === 'skill'
      && (item.flags?.brp?.brpidFlag?.id === 'i.skill.coc.dodge' || item.flags?.brp?.coc?.key === 'dodge'))
    const allowed = combat.defenseOptions({ kind, defenderHasDodge: !!dodgeItem })
    if (!allowed.includes(choice)) { return { error: 'defense-not-allowed', allowed } }

    let rollType = 'SK'
    let itemId = options.itemId ?? false
    let skillId = options.skillId ?? dodgeItem?._id ?? false
    let profile = null
    if (choice === 'fightback') {
      const weapon = actor.items.get(itemId)
      if (!weapon) { return { error: 'fightback-weapon-missing' } }
      profile = combat.weaponProfile(weapon)
      if (profile.ranged) { return { error: 'fightback-needs-melee-weapon', kind: profile.kind } }
      if (actor.type !== 'npc' && !BRPCheck.weaponSkill(actor, weapon, weapon.system?.skill1)) {
        return { error: 'weapon-skill-missing', brpid: weapon.system?.skill1 ?? null }
      }
      rollType = 'CM'
    } else if (choice === 'dodge' || choice === 'cover') {
      if (!dodgeItem) { return { error: 'dodge-skill-missing' } }
      if (!skillId) { skillId = dodgeItem._id }
    }

    const joined = await BRPCheck._trigger({
      rollType,
      cardType: 'CB',
      itemId: rollType === 'CM' ? itemId : false,
      skillId,
      shiftKey: true,
      actor,
      token: actor.token ?? null,
      bonusDice: Math.max(0, Number(options.bonusDice ?? 0)),
      penaltyDice: Math.max(0, Number(options.penaltyDice ?? 0)),
      requiredBand: options.requiredBand ?? null,
      joinMessageId: messageId,
      opposed: {
        role: 'defender',
        choice,
        kind: profile?.kind ?? kind,
        weaponProfile: profile,
        weaponId: rollType === 'CM' ? itemId : null,
        maneuver: false,
      },
    })
    return { messageId: joined ?? messageId, choice }
  }

  // Resolve one CoC card (attacker + defender entries) on the active GM.
  // Returns the comparison, the real damage roll and the wound state.
  static async cocResolve(options = {}) {
    if (!BRPCheck.isCoC()) { return { error: 'ruleset-not-coc' } }
    const messageId = options.messageId ?? options.targetChatId
    const relay = await BRPCheck._cocGmOnly('cocResolve', { messageId, applyDamage: options.applyDamage !== false })
    if (relay) { return relay }
    const message = await game.messages.get(messageId)
    if (!message) { return { error: 'message-missing' } }
    if (message.flags?.brp?.state === 'closed') {
      return { error: 'card-closed', result: message.flags?.brp?.coc?.result ?? null }
    }
    const entries = [...(message.flags?.brp?.chatCard ?? [])]
    // A close-combat card can resolve with a single attacker entry when the
    // target declared no defence; a generic opposed card needs both sides.
    if (entries.length < 2 && message.flags?.brp?.cardType !== 'CB') {
      return { error: 'need-two-entries' }
    }
    const combat = Rules.active().combat
    const applyDamage = options.applyDamage !== false
    // A roll that missed the task's required band counts as a failure for the
    // comparison (CoC difficulty is a required band, never a target multiplier).
    const sideOf = (entry) => ({
      band: entry.band,
      rank: entry.taskSuccess === false ? 0 : Number(entry.bandRank ?? 0),
      skill: Number(entry.targetScore ?? entry.rawScore ?? 0),
      rollVal: entry.rollVal,
    })

    if (message.flags?.brp?.cardType === 'OP') {
      const aSide = sideOf(entries[0])
      const dSide = sideOf(entries[1])
      // Both failed the required band: no one succeeds and no winner is made up.
      const outcome = (aSide.rank === 0 && dSide.rank === 0)
        ? { winner: null, reroll: false, reason: 'both-failed' }
        : combat.compareOpposed(aSide, dSide)
      if (outcome.reroll) {
        await message.update({
          'flags.brp.coc.reroll': { reason: outcome.reason, mode: 'both' },
          'flags.brp.coc.outcome': outcome,
        })
        return { reroll: true, outcome, mode: 'both' }
      }
      const updated = entries.map((entry, index) => ({
        ...entry,
        opposedOutcome: { ...outcome, role: index === 0 ? 'attacker' : 'defender' },
      }))
      await message.update({
        'flags.brp.chatCard': updated,
        'flags.brp.state': 'closed',
        'flags.brp.coc.outcome': outcome,
      })
      await BRPCheck._rerender(message)
      await BRPCheck.tickXP({ ...(message.flags?.brp ?? {}), state: 'closed', chatCard: updated })
      return { outcome, winner: outcome.winner, reason: outcome.reason }
    }

    const attacker = entries.find((entry) => entry.opposed?.role === 'attacker') ?? entries[0]
    const defender = entries.find((entry) => entry !== attacker) ?? null
    // No declared defence: the attack resolves on its own band (the CoC tables
    // let a target simply not respond). `dodge` is never assumed on their behalf.
    const choice = defender?.opposed?.choice ?? 'none'
    const kind = attacker.opposed?.kind ?? attacker.weaponProfile?.kind ?? 'melee'
    const outcome = combat.resolveCloseCombat(
      sideOf(attacker),
      defender ? sideOf(defender) : { rank: 0, band: null, skill: 0, rollVal: null },
      { choice, kind },
    )

    if (outcome.illegal) {
      await message.update({ 'flags.brp.coc.outcome': outcome })
      return { error: outcome.reason, outcome }
    }
    if (outcome.reroll) {
      // Dive for cover: the attacker must roll again with a penalty die; the
      // defender forfeits the next attack. No winner is invented here.
      await message.update({
        'flags.brp.coc.reroll': {
          reason: outcome.reason,
          mode: 'attacker',
          penaltyDice: outcome.attackerPenaltyDice ?? 1,
          defenderForfeitsNextAttack: outcome.defenderForfeitsNextAttack === true,
        },
        'flags.brp.coc.outcome': outcome,
      })
      await BRPCheck._rerender(message)
      return { reroll: true, outcome, mode: 'attacker', penaltyDice: outcome.attackerPenaltyDice ?? 1 }
    }

    let summary = { outcome, winner: outcome.winner, reason: outcome.reason, choice, kind }
    if (outcome.winner) {
      const winnerEntry = outcome.winner === 'attacker' ? attacker : defender
      const loserEntry = outcome.winner === 'attacker' ? defender : attacker
      const winnerActor = await BRPactorDetails._getParticipant(winnerEntry.particId, winnerEntry.particType)
      // The target actor comes from the defender entry, or from the attacker's
      // declared target when the defender did not answer at all.
      const loserActor = loserEntry
        ? await BRPactorDetails._getParticipant(loserEntry.particId, loserEntry.particType)
        : (attacker.targetId
          ? await BRPactorDetails._getParticipant(attacker.targetId, attacker.targetType ?? 'actor')
          : null)
      const isManeuver = attacker.opposed?.maneuver === true
      // A maneuver win deals no damage; a dodge win deals no damage; only a
      // fight-back win hurts the attacker. A failed maneuver can still be
      // punished by a successful fight back.
      const dealsDamage = (outcome.winner === 'attacker' && !isManeuver)
        || (outcome.winner === 'defender' && choice === 'fightback')

      if (dealsDamage && (!winnerActor || !loserActor)) {
        return { error: 'actor-missing', outcome, winner: outcome.winner }
      }
      if (dealsDamage && winnerActor && loserActor) {
        const winnerRole = outcome.winner === 'attacker' ? 'attacker' : 'defender'
        const winnerWeapon = winnerActor.items.get(winnerEntry.opposed?.weaponId ?? winnerEntry.weaponId ?? winnerEntry.itemId)
        const profile = winnerEntry.opposed?.weaponProfile
          ?? winnerEntry.weaponProfile
          ?? (winnerWeapon ? combat.weaponProfile(winnerWeapon) : null)
        if (!profile) { return { error: 'weapon-missing', outcome, winner: outcome.winner } }
        const tier = outcome.damageTier ?? combat.damageTier({ rank: Number(winnerEntry.bandRank ?? 0), role: winnerRole })
        const weaponFormula = options.damageFormula
          ?? profile.formula
          ?? winnerWeapon?.system?.dmg1
          ?? '1D3'
        const dbFormula = combat.damageBonusFor({
          dbFull: winnerActor.system?.dmgBonus?.full,
          dbHalf: winnerActor.system?.dmgBonus?.half,
          mode: profile?.dbMode ?? 'none',
        })
        let formula
        let damageRoll
        let total
        try {
          formula = options.damageFormula
            ? combat.normalizeFormula(options.damageFormula)
            : combat.damageFormula({ weaponFormula, dbFormula, impaling: profile?.impaling === true, tier: tier ?? 'regular' })
          damageRoll = new Roll(formula)
          await damageRoll.evaluate()
          total = Math.max(0, Math.floor(Number(damageRoll.total) || 0))
        } catch (thrown) {
          return { error: 'invalid-damage-formula', detail: String(thrown?.message ?? thrown), outcome }
        }
        const applied = applyDamage && total > 0
          ? await BRPDamage.applyCoCDamage(loserActor, {
            damage: total,
            conCheck: true,
            source: { kind: 'coc-combat', messageId, tier: tier ?? 'regular', formula, rollVal: total },
          })
          : null

        Object.assign(winnerEntry, {
          tier: tier ?? 'regular',
          damageFormula: formula,
          damageTotal: total,
          damageRollVal: total,
          opposedOutcome: { winner: outcome.winner, reason: outcome.reason, notes: outcome.notes },
        })
        if (loserEntry) {
          Object.assign(loserEntry, {
            damage: { total, formula, tier: tier ?? 'regular', applied: !!applied?.applied },
            wounds: applied?.state ?? loserEntry.wounds ?? null,
            opposedOutcome: { winner: outcome.winner, reason: outcome.reason, notes: outcome.notes },
          })
        } else {
          // Undefended attack: the damage lands on the declared target and the
          // attacker entry records what hit them.
          Object.assign(winnerEntry, {
            damage: { total, formula, tier: tier ?? 'regular', applied: !!applied?.applied },
            wounds: applied?.state ?? null,
          })
        }
        summary = {
          ...summary,
          tier: tier ?? 'regular',
          formula,
          damage: total,
          damageRoll,
          wounds: applied?.state ?? null,
          hpAfter: applied?.hpAfter ?? null,
          instantDeath: applied?.instantDeath === true,
          majorWound: applied?.majorWound === true,
          dying: applied?.state?.dying === true,
          conCheck: applied?.conCheck ?? null,
        }
      } else {
        Object.assign(attacker, { opposedOutcome: { winner: outcome.winner, reason: outcome.reason, notes: outcome.notes, maneuver: isManeuver } })
        if (defender) {
          Object.assign(defender, { opposedOutcome: { winner: outcome.winner, reason: outcome.reason, notes: outcome.notes, maneuver: isManeuver } })
        }
        summary = { ...summary, damage: 0, maneuver: isManeuver }
      }
    } else {
      Object.assign(attacker, { opposedOutcome: { winner: null, reason: outcome.reason, notes: outcome.notes } })
      if (defender) {
        Object.assign(defender, { opposedOutcome: { winner: null, reason: outcome.reason, notes: outcome.notes } })
      }
      summary = { ...summary, damage: 0 }
    }

    const rolls = Array.isArray(message.rolls) ? [...message.rolls] : []
    if (summary.damageRoll) { rolls.push(summary.damageRoll) }
    const updatedEntries = defender ? [attacker, defender] : [attacker]
    await message.update({
      'flags.brp.chatCard': updatedEntries,
      'flags.brp.state': 'closed',
      'flags.brp.coc.outcome': outcome,
      'flags.brp.coc.result': summary,
      ...(rolls.length ? { rolls } : {}),
    })
    await BRPCheck._rerender(message)
    await BRPCheck.tickXP({ ...(message.flags?.brp ?? {}), state: 'closed', chatCard: updatedEntries })
    const { damageRoll, ...returned } = summary
    return { ...returned, damageRoll }
  }

  static async _rerender(message) {
    try {
      const html = await BRPCheck.startChat(message.flags.brp)
      await message.update({ content: html })
    } catch { /* rendering is best-effort; flags are the source of truth */ }
    return message
  }

  // One percentile pool as a real Roll. Used by the tie re-roll, which must not
  // recycle the dice that produced the tie.
  static async _cocRollPool({ formula = '1D100', bonus = 0, penalty = 0 } = {}) {
    const dice = Rules.active().check.dice
    const pool = dice.dicePool({ bonus, penalty })
    const usedFormula = dice.d100Formula({ bonus, penalty })
    const roll = new Roll(usedFormula)
    await roll.evaluate()
    const faces = []
    for (const die of roll.dice) { for (const value of die.values) { faces.push(Number(value)) } }
    let detail
    let rollVal
    if (pool.tensDice > 1) {
      const resolved = dice.resolveD100({ results: faces, bonus, penalty })
      rollVal = resolved.rollVal
      detail = {
        formula: usedFormula, faces, units: resolved.units, tens: resolved.tens,
        chosenTens: resolved.chosenTens, candidates: resolved.candidates,
        bonus: resolved.bonus, penalty: resolved.penalty, choose: resolved.choose,
      }
    } else {
      const face = faces[0]
      const tens = Math.floor(face / 10) % 10
      rollVal = Number.isFinite(face) ? face : Number(roll.total)
      detail = {
        formula: usedFormula, faces: [face], units: rollVal % 10, tens, chosenTens: tens,
        candidates: [{ tens, value: rollVal }], bonus: 0, penalty: 0, choose: 'lowest',
      }
    }
    return { roll, rollVal, detail, formula: usedFormula }
  }

  // Tie re-roll for a generic opposed card: both sides roll again and the lower
  // d100 wins (equal rolls ask for another re-roll). A combat card's dive for
  // cover asks the attacker to declare a new attack with the returned penalty
  // die instead - it is not resolved from the old dice.
  static async cocReroll(options = {}) {
    if (!BRPCheck.isCoC()) { return { error: 'ruleset-not-coc' } }
    const messageId = options.messageId ?? options.targetChatId
    const relay = await BRPCheck._cocGmOnly('cocReroll', { messageId })
    if (relay) { return relay }
    const message = await game.messages.get(messageId)
    if (!message) { return { error: 'message-missing' } }
    if (message.flags?.brp?.state === 'closed') { return { error: 'card-closed' } }
    if (message.flags?.brp?.cardType !== 'OP') {
      const reroll = message.flags?.brp?.coc?.reroll ?? {}
      return {
        error: 'combat-reroll-needs-new-attack',
        penaltyDice: reroll.penaltyDice ?? 0,
        defenderForfeitsNextAttack: reroll.defenderForfeitsNextAttack === true,
      }
    }
    const entries = [...(message.flags?.brp?.chatCard ?? [])]
    if (entries.length < 2) { return { error: 'need-two-entries' } }
    const updated = []
    const rolls = Array.isArray(message.rolls) ? [...message.rolls] : []
    for (const entry of entries) {
      const pool = await BRPCheck._cocRollPool({
        formula: entry.rollFormula,
        bonus: Number(entry.diceDetail?.bonus ?? 0),
        penalty: Number(entry.diceDetail?.penalty ?? 0),
      })
      const bandInfo = Rules.active().check.successBand({ rollVal: pool.rollVal, targetScore: entry.targetScore })
      const bandRank = Rules.active().combat.bandRank(bandInfo.band)
      rolls.push(pool.roll)
      updated.push({
        ...entry,
        roll: pool.roll,
        rollResult: Number(pool.roll.total),
        rollVal: pool.rollVal,
        diceRolled: pool.detail.faces.join(', '),
        diceDetail: pool.detail,
        rollFormula: pool.formula,
        band: bandInfo.band,
        bandRank,
        bandLabel: game.i18n.localize('BRP.cocBand.' + bandInfo.band),
        resultLevel: bandInfo.level,
        resultLabel: game.i18n.localize('BRP.cocBand.' + bandInfo.band),
        taskSuccess: bandRank >= Number(entry.minimumRank ?? 2),
      })
    }
    const outcome = Rules.active().combat.compareOpposedReroll(updated[0], updated[1])
    if (outcome.reroll) {
      await message.update({
        'flags.brp.chatCard': updated,
        'flags.brp.coc.reroll': { reason: outcome.reason, mode: 'both' },
        'flags.brp.coc.outcome': outcome,
        ...(rolls.length ? { rolls } : {}),
      })
      await BRPCheck._rerender(message)
      return { reroll: true, outcome, mode: 'both' }
    }
    await message.update({
      'flags.brp.chatCard': updated,
      'flags.brp.state': 'closed',
      'flags.brp.coc.outcome': outcome,
      'flags.brp.coc.reroll': null,
      ...(rolls.length ? { rolls } : {}),
    })
    await BRPCheck._rerender(message)
    return { outcome, winner: outcome.winner, rerolled: true }
  }

  // Public wound helpers (frontend/macro callable). Each routes to the active
  // GM when the actor is not owned by the caller.
  static async cocApplyDamage(options = {}) {
    return BRPCheck._cocWrite('applyCoCDamage', {
      ...options,
      actorId: options.actorId ?? options.actor?.id,
      damage: Number(options.damage ?? 0),
    })
  }

  static async cocFirstAid(options = {}) {
    return BRPCheck._cocWrite('cocFirstAid', { ...options, actorId: options.actorId ?? options.actor?.id })
  }

  static async cocMedicine(options = {}) {
    return BRPCheck._cocWrite('cocMedicine', { ...options, actorId: options.actorId ?? options.actor?.id })
  }

  static async cocWeeklyHeal(options = {}) {
    return BRPCheck._cocWrite('cocWeeklyHeal', { ...options, actorId: options.actorId ?? options.actor?.id })
  }

  static async cocNaturalHeal(options = {}) {
    return BRPCheck._cocWrite('cocNaturalHeal', { ...options, actorId: options.actorId ?? options.actor?.id })
  }

  static async cocDyingRound(options = {}) {
    return BRPCheck._cocWrite('cocDyingRound', { ...options, actorId: options.actorId ?? options.actor?.id })
  }

  // Current wound state for a UI (does not write anything).
  static cocState(actor) {
    const wounds = actor?.flags?.brp?.coc?.wounds ?? {}
    const state = Rules.active().wounds?.woundState?.({
      hpValue: actor?.system?.health?.value ?? 0,
      hpMax: actor?.system?.health?.max ?? 0,
      majorWound: wounds.majorWound === true,
      dying: wounds.dying === true,
      dead: wounds.dead === true,
      unconscious: wounds.unconscious === true,
    }) ?? null
    return { ...state, flags: wounds }
  }

  // A successful First Aid / Medicine skill roll is the treatment. The skill's
  // brpid decides which one; the patient is the selected target or the roller.
  static async _settleCoCMedical(config, rollActor) {
    if (!BRPCheck.isCoC() || !config.skillBrpid) { return }
    const isFirstAid = config.skillBrpid === 'i.skill.coc.first-aid'
    const isMedicine = config.skillBrpid === 'i.skill.coc.medicine'
    if (!isFirstAid && !isMedicine) { return }
    if (config.bandRank < 2) { return }
    const patient = config.targetId && config.targetId !== config.particId
      ? await BRPactorDetails._getParticipant(config.targetId, config.targetType)
      : rollActor
    if (!patient) { return }
    const value = {
      actorId: patient.id,
      actorType: patient.token ? 'token' : 'actor',
      band: config.band,
      rank: config.bandRank,
      healer: config.particId,
    }
    const result = isFirstAid
      ? await BRPCheck._cocWrite('cocFirstAid', value)
      : await BRPCheck._cocWrite('cocMedicine', value)
    config.healing = Number(result?.healing?.applied ?? 0)
    config.healingLabel = result?.effect?.formula ?? (isFirstAid && result?.applied ? '1' : '')
    config.cocTreatment = {
      skill: isFirstAid ? 'first-aid' : 'medicine',
      applied: result?.applied === true && (Number(result?.healing?.applied ?? 0) > 0 || result?.effect?.stabilizes === true),
      queued: result?.queued === true,
      band: config.band,
      formula: config.healingLabel,
    }
  }

  //First Aid Roll
  static async firstAid(config) {

    //DO NOT PROCESS YET - still a work in progress
    return

    //If not Coop, Combined or Normal Roll then don't trigger first aid
    if (!['GR', 'CO', 'NO'].includes(config.cardType)) {
      return
    }

    //If Cooperatie or Combined Roll and not first partipant then don't trigger first aid
    if (['GR', 'CO'].includes(config.cardType)) {
      let checkData = {
        cardType: config.cardType,
        chatCard: [{
          particId: config.particId
        }]
      }
      let checkMsgId = await BRPCheck.checkNewMsg(checkData)
      if (checkMsgId != false) {
        return
      }
    }

    let actor = await BRPactorDetails._getParticipant(config.particId, config.particType)
    let target = await BRPactorDetails._getParticipant(config.targetId, config.targetType)
    //If there is target selected then use them, otherwise the actor making the roll
    let partic = actor
    if (target) { partic = target }

    //Get wounds depending on whether this is a character or NPC
    if (partic.type === 'character') {
      let wounds = await partic.items.filter(itm => itm.type === 'wound').filter(wnd => !wnd.system.treated)
      if (wounds.length === 0) { return }
      config.firstAid = true
      wounds.sort(function (a, b) {
        let x = a.system.value;
        let y = b.system.value;
        if (x < y) { return 1 };
        if (x > y) { return -1 };
        return 0;
      });
      for (let wound of wounds) {
        let wndLoc = partic.items.get(wound.system.locId)
        let label = ""
        if (wndLoc) {
          label = partic.name + ": " + wndLoc.system.displayName + " (" + wound.system.value + ")"
        } else {
          label = partic.name + ": " + game.i18n.localize('BRP.general') + " (" + wound.system.value + ")"
        }
        config.woundList = Object.assign(config.woundList, { [wound.uuid]: label })
      }

    }


    return
  }



}
