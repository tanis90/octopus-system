import { BRPCheck } from './check.mjs'
import BRPDialog from '../setup/brp-dialog.mjs'

//Madness (temporary insanity) resolution - the settlement core is deliberately
//DOM-free: resolveMadness/buildMadness roll and shape data, they never touch
//chat messages, the UI or the actor. The chat card buttons below are just one
//driving surface for the same logic (OPCard-style: mutate message flags, re-render).
export class BRPMadness {

  //Six self-written manifestation tiers (d6); index 5 (phobia) and index 6
  // (mania) offer the keeper a prefilled persTrait creation window on the
  // episode card - nothing is created automatically
  static MANIFESTATION_KEYS = ['paralysis', 'flight', 'hysteria', 'violence', 'phobia', 'mania']

  //The manifestation tiers that can seed a lasting trait
  static get TRAIT_TIERS() { return ['phobia', 'mania'] }

  //Eight duration tiers (d8): key, label i18n key suffix and duration in seconds
  static DURATION_TIERS = [
    { key: '5m', seconds: 300 },
    { key: '1h', seconds: 3600 },
    { key: '2h', seconds: 7200 },
    { key: '12h', seconds: 43200 },
    { key: '1d', seconds: 86400 },
    { key: '2d', seconds: 172800 },
    { key: '1w', seconds: 604800 },
    { key: '2w', seconds: 1209600 }
  ]

  static get TEMP_INSANE_ID() { return 'tempInsane' }
  static get PERMA_INSANE_ID() { return 'permaInsane' }

  //The settlement core: roll the d6 manifestation and the d8 duration for a
  //madness episode. Pure with respect to the game surface - no DOM, no chat,
  //no actor writes; the caller decides what to do with the result.
  static async resolveMadness(actor) {
    const manRoll = new Roll('1D6')
    await manRoll.evaluate()
    const durRoll = new Roll('1D8')
    await durRoll.evaluate()
    return BRPMadness.buildMadness(actor, Number(manRoll.total), Number(durRoll.total))
  }

  //Deterministic builder used by resolveMadness and by the keeper reroll buttons
  static buildMadness(actor, manifestationIndex, durationIndex) {
    const mKey = BRPMadness.MANIFESTATION_KEYS[Math.min(Math.max(manifestationIndex, 1), 6) - 1]
    const manifestation = {
      index: manifestationIndex,
      key: mKey,
      name: game.i18n.localize(`BRP.madness.manifestations.${mKey}`),
      description: game.i18n.localize(`BRP.madness.manifestationsDesc.${mKey}`)
    }
    const tier = BRPMadness.DURATION_TIERS[Math.min(Math.max(durationIndex, 1), 8) - 1]
    const duration = {
      index: durationIndex,
      key: tier.key,
      label: game.i18n.localize(`BRP.madness.durations.${tier.key}`),
      seconds: tier.seconds
    }
    const effectData = {
      name: `${game.i18n.localize('BRP.madness.tempInsane')} (${manifestation.name})`,
      icon: 'systems/brp/assets/Icons/drama-masks.svg',
      statuses: [BRPMadness.TEMP_INSANE_ID],
      duration: { seconds: tier.seconds, startTime: game.time?.worldTime ?? 0 },
      description: manifestation.description,
      disabled: false
    }
    return { manifestation, duration, effectData }
  }

  //Apply the tempInsane status effect to the actor from an already-resolved madness result
  static async applyTempInsane(actor, madness) {
    const existing = actor.effects.find(e => e.statuses?.has?.(BRPMadness.TEMP_INSANE_ID))
    if (existing) { await existing.delete() }
    const [effect] = await ActiveEffect.createDocuments([madness.effectData], { parent: actor })
    return effect
  }

  //SAN reached zero: permanent insanity - no interaction, just the status and
  //an announcement card (SRD: retire the character or hand it to the keeper)
  static async applyPermaInsane(actor) {
    const effectData = {
      name: game.i18n.localize('BRP.madness.permaInsane'),
      icon: 'systems/brp/assets/Icons/inner-self.svg',
      statuses: [BRPMadness.PERMA_INSANE_ID],
      description: game.i18n.localize('BRP.madness.permaInsaneDesc'),
      disabled: false
    }
    await ActiveEffect.createDocuments([effectData], { parent: actor })
    const html = await foundry.applications.handlebars.renderTemplate(
      'systems/brp/templates/chat/madness-perma.html',
      { particName: actor.name, particId: actor.id }
    )
    await ChatMessage.create({
      author: game.user.id,
      content: html,
      flags: { brp: { permaInsane: true, initiator: actor.id } },
      speaker: { actor: actor.id, alias: actor.name }
    })
  }

  //Build the flag payload stored on the SN chat card (flags.brp.madness)
  static madnessFlag(actor, madness) {
    return {
      actorId: actor.id,
      particName: actor.name,
      manifestation: madness.manifestation,
      duration: madness.duration,
      effectData: madness.effectData,
      ended: false
    }
  }

  //--------- Keeper chat-card buttons (OPCard style: read flags, mutate, re-render) ---------

  static async _getMadnessMessage(targetChatId) {
    const msg = await game.messages.get(targetChatId)
    if (!msg?.flags?.brp?.madness) { return null }
    return msg
  }

  static async _updateMadnessFlag(msg, madness) {
    await msg.update({ 'flags.brp.madness': madness })
    const pushhtml = await BRPCheck.startChat(msg.flags.brp)
    await msg.update({ content: pushhtml })
  }

  //Reroll the d6 manifestation (public result)
  static async rerollManifestation(data) {
    const msg = await BRPMadness._getMadnessMessage(data.targetChatId)
    if (!msg || msg.flags.brp.madness.ended) { return }
    const madness = msg.flags.brp.madness
    const roll = new Roll('1D6')
    await roll.evaluate()
    const mKey = BRPMadness.MANIFESTATION_KEYS[Number(roll.total) - 1]
    madness.manifestation = {
      index: Number(roll.total),
      key: mKey,
      name: game.i18n.localize(`BRP.madness.manifestations.${mKey}`),
      description: game.i18n.localize(`BRP.madness.manifestationsDesc.${mKey}`)
    }
    await BRPMadness._updateMadnessFlag(msg, madness)
  }

  //Reroll the d8 duration (keeper only)
  static async rerollDuration(data) {
    const msg = await BRPMadness._getMadnessMessage(data.targetChatId)
    if (!msg || msg.flags.brp.madness.ended) { return }
    const madness = msg.flags.brp.madness
    const roll = new Roll('1D8')
    await roll.evaluate()
    const idx = Number(roll.total)
    const tier = BRPMadness.DURATION_TIERS[idx - 1]
    madness.duration = {
      index: idx,
      key: tier.key,
      label: game.i18n.localize(`BRP.madness.durations.${tier.key}`),
      seconds: tier.seconds
    }
    await BRPMadness._updateMadnessFlag(msg, madness)
    await BRPMadness._syncEffectDuration(madness)
  }

  //Keeper types a duration - offer the eight known tiers (kept as one of the
  //table entries so downstream logic stays on-table)
  static async setDuration(data) {
    const msg = await BRPMadness._getMadnessMessage(data.targetChatId)
    if (!msg || msg.flags.brp.madness.ended) { return }
    const durationOptions = {}
    for (const t of BRPMadness.DURATION_TIERS) {
      durationOptions[t.key] = game.i18n.localize(`BRP.madness.durations.${t.key}`)
    }
    const html = await foundry.applications.handlebars.renderTemplate(
      'systems/brp/templates/dialog/madnessDuration.hbs',
      { durationOptions, current: msg.flags.brp.madness.duration.key }
    )
    const usage = await BRPDialog.input({
      window: { title: game.i18n.localize('BRP.madness.setDuration') },
      content: html,
      ok: { label: game.i18n.localize('BRP.proceed') }
    })
    if (!usage?.duration) { return }
    const tier = BRPMadness.DURATION_TIERS.find(t => t.key === usage.duration)
    if (!tier) { return }
    const madness = msg.flags.brp.madness
    madness.duration = {
      index: BRPMadness.DURATION_TIERS.indexOf(tier) + 1,
      key: tier.key,
      label: game.i18n.localize(`BRP.madness.durations.${tier.key}`),
      seconds: tier.seconds
    }
    await BRPMadness._updateMadnessFlag(msg, madness)
    await BRPMadness._syncEffectDuration(madness)
  }

  //End the episode early: remove the tempInsane effect and freeze the card section
  static async endMadness(data) {
    const msg = await BRPMadness._getMadnessMessage(data.targetChatId)
    if (!msg || msg.flags.brp.madness.ended) { return }
    const madness = msg.flags.brp.madness
    madness.ended = true
    const actor = game.actors.get(madness.actorId)
    if (actor) {
      const effect = actor.effects.find(e => e.statuses?.has?.(BRPMadness.TEMP_INSANE_ID))
      if (effect) { await effect.delete() }
    }
    await BRPMadness._updateMadnessFlag(msg, madness)
  }

  //Mark every open madness card for an actor as ended and re-render it. This is
  //the fallback for effects that disappear outside the card (Times Up expiry,
  //effects-tab delete, disabling the effect): the card must not keep offering
  //keeper buttons for an episode whose ActiveEffect is gone.
  static async endOpenCards(actorId) {
    if (!actorId) { return }
    const messages = [...game.messages.values()].filter((msg) => {
      const madness = msg.flags?.brp?.madness
      return madness?.actorId === actorId && madness.ended !== true
    })
    for (const msg of messages) {
      const madness = foundry.utils.deepClone(msg.flags.brp.madness)
      madness.ended = true
      const cardData = foundry.utils.deepClone(msg.flags.brp)
      cardData.madness = madness
      const html = await BRPCheck.startChat(cardData)
      //One write: flags and content must not be observed out of step
      await msg.update({ 'flags.brp.madness': madness, content: html })
    }
  }

  //Hook body for deleteActiveEffect / updateActiveEffect(disabled)
  static async syncEndedFromEffect(effect) {
    try {
      if (!effect?.statuses?.has?.(BRPMadness.TEMP_INSANE_ID)) { return }
      await BRPMadness.endOpenCards(effect.parent?.id)
    } catch (e) {
      console.error('BRP madness effect sync failed', e)
    }
  }

  //Core 13.351 only displays duration.remaining; the system owns the limited
  //insanity rule, so retire temp effects whose seconds have elapsed.
  static async expireTempInsaneEffects() {
    if (!game.actors || !game.user.isGM) { return }
    const writer = game.users.activeGM
    if (writer && game.user.id !== writer.id) { return }
    const actors = new Set([...game.actors])
    const tokenActors = game.actors.tokens;
    if (tokenActors) {
      const list = typeof tokenActors.values === 'function' ? [...tokenActors.values()] : Object.values(tokenActors)
      for (const tokenActor of list) {
        if (tokenActor?.effects) { actors.add(tokenActor) }
      }
    }
    for (const actor of actors) {
      if (!actor?.effects) { continue }
      for (const effect of actor.effects) {
        if (!effect.statuses?.has?.(BRPMadness.TEMP_INSANE_ID)) { continue }
        const duration = effect.duration ?? {}
        if (!(Number(duration.seconds) > 0)) { continue }
        if (!(Number(duration.remaining) <= 0)) { continue }
        await BRPMadness.endOpenCards(actor.id)
        await effect.delete()
      }
    }
  }

  //Phobia/mania tier entry point: open the prefilled persTrait creation window
  //for the character that suffered the episode (keeper confirms - no auto-create)
  static async addTrait(data) {
    const msg = await BRPMadness._getMadnessMessage(data.targetChatId)
    if (!msg || msg.flags.brp.madness.ended) { return }
    const madness = msg.flags.brp.madness
    if (!BRPMadness.TRAIT_TIERS.includes(madness.manifestation.key)) { return }
    const actor = game.actors.get(madness.actorId)
    if (!actor) { return }
    const traitTypes = {}
    for (const t of ['trait', 'phobia', 'mania']) {
      traitTypes[t] = game.i18n.localize(`BRP.traitTypes.${t}`)
    }
    const html = await foundry.applications.handlebars.renderTemplate(
      'systems/brp/templates/dialog/madnessTrait.hbs',
      {
        traitTypes,
        traitType: madness.manifestation.key,
        traitName: madness.manifestation.name,
        particName: madness.particName
      }
    )
    const usage = await BRPDialog.input({
      window: { title: game.i18n.localize('BRP.madness.addTraitTitle') },
      content: html,
      ok: { label: game.i18n.localize('BRP.madness.createTrait') }
    })
    if (!usage) { return }
    await BRPMadness.createMadnessTrait(actor, {
      name: String(usage.name ?? '').trim() || madness.manifestation.name,
      traitType: usage.traitType ?? madness.manifestation.key,
      base: usage.base,
      oppName: usage.oppName ?? ''
    })
  }

  //Create the persTrait the keeper confirmed from the madness card
  static async createMadnessTrait(actor, usage = {}) {
    const traitType = BRPMadness.TRAIT_TIERS.includes(usage.traitType) ? usage.traitType : 'trait'
    const [item] = await Item.createDocuments([{
      name: usage.name || game.i18n.localize(`BRP.traitTypes.${traitType}`),
      type: 'persTrait',
      system: {
        traitType,
        base: Math.max(0, Math.min(100, Math.floor(Number(usage.base) || 0))),
        oppName: String(usage.oppName ?? '')
      }
    }], { parent: actor })
    //Follow the actor-sheet creation flow: tag the item with a BRPID flag
    if (item && game.system?.api?.brpid) {
      const key = await game.system.api.brpid.guessId(item)
      await item.update({
        'flags.brp.brpidFlag.id': key,
        'flags.brp.brpidFlag.lang': game.i18n.lang,
        'flags.brp.brpidFlag.priority': 0
      })
    }
    ui.notifications.info(game.i18n.format('BRP.madness.traitCreated', {
      type: game.i18n.localize(`BRP.traitTypes.${traitType}`),
      name: actor.name
    }))
    return item
  }

  //Keep the applied ActiveEffect duration in step with keeper adjudications
  static async _syncEffectDuration(madness) {
    const actor = game.actors.get(madness.actorId)
    if (!actor) { return }
    const effect = actor.effects.find(e => e.statuses?.has?.(BRPMadness.TEMP_INSANE_ID))
    if (effect) {
      await effect.update({ duration: { seconds: madness.duration.seconds } })
    }
  }
}
