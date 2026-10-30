import { BRPUtilities } from '../apps/utilities.mjs';
import { BRPactorDetails } from "../apps/actorDetails.mjs";
import BRPDialog from '../setup/brp-dialog.mjs';
import { Rules } from '../rules/index.mjs';

export class BRPDamage {

  // Add Damage
  static async addDamage(target, actor, token, damage) {
    //CoC never creates BRP wound items: route every legacy caller to the CoC
    //writer so a wound item cannot appear and desync the HP track.
    if (Rules.active().wounds) {
      const partic = actor ?? token?.actor
      if (!partic) { return }
      const amount = Number(damage) || 0
      if (amount < 1) { return BRPDamage.cocAddDamageDialog(partic) }
      return BRPDamage.applyCoCDamage(partic, { damage: amount, source: 'legacy-addDamage' })
    }
    let partic = await BRPactorDetails._getParticipantPriority(token, actor)
    let getLoc = false
    let getDam = false
    let locs = {}
    let listLocs = {}
    let locationId = target.dataset.itemId;
    if (!locationId && game.settings.get('brp', 'useHPL')) {
      locs = await actor.items.filter(itm => itm.type === 'hit-location')
      if (locs.length === 1) {
        locationId = locs[0]._id
      } else if (locs.length > 1) {
        getLoc = true
        locs.sort(function (a, b) {
          let x = a.system.lowRoll;
          let y = b.system.lowRoll;
          if (x < y) { return 1 };
          if (x > y) { return -1 };
          return 0;
        });
        for (let loc of locs) {
          let label = loc.system.displayName + "(" + loc.system.lowRoll + "-" + loc.system.highRoll + ")"
          if (loc.system.lowRoll === loc.system.highRoll) {
            label = loc.system.displayName + "(" + loc.system.lowRoll + ")"
          }
          listLocs = Object.assign(listLocs, { [loc._id]: label })
        }
      }
    }
    if (damage < 1) {
      getDam = true
    }
    if (getDam || getLoc) {
      let usage = await this.getWoundForm(getDam, getLoc, partic.name, listLocs)
      if (getDam) { damage = Number(usage.damage) };
      if (getLoc) { locationId = usage.woundLoc};
    }
    if (damage < 1) { return }

    let location = ""
    if (actor) {
      location = actor.items.get(locationId)
    } else {
      location = token.actor.items.get(locationId)
    }

    //Check for damage at 2 or 3 times HPL (where current HP<=0 dealt with in actor.mjs)
    let checkprop = {}
    //If using HPL and this is a an actual hit location (not general)
    if (game.settings.get('brp', 'useHPL') && location.system.locType != 'general') {
      if (damage >= location.system.maxHP * 3 && location.system.locType === 'limb') {
        checkprop = {
          'system.severed': true,
          'system.bleeding': true
        }
      } else if (damage >= location.system.maxHP * 3 && location.system.locType != 'general') {
        checkprop = {
          'system.dead': true,
          'system.incapacitated': true,
          'system.bleeding': true
        }
      } else if (damage >= location.system.maxHP * 2 && location.system.locType === 'limb') {
        checkprop = {
          'system.incapacitated': true,
          'system.bleeding': true
        }
      } else if (damage >= location.system.maxHP * 2 && location.system.locType != 'general') {
        checkprop = {
          'system.unconscious': true,
          'system.bleeding': true
        }
      } else if (damage >= location.system.currHP && location.system.locType != 'limb') {
        checkprop = { 'system.bleeding': true }
      }
      damage = Math.min(damage, location.system.maxHP * 2)
      //Otherwise if not using HPL
    } else if (!game.settings.get('brp', 'useHPL')) {
      if (damage >= partic.system.health.mjrwnd) {
        await partic.update({
          'system.majorWnd': true,
          'system.health.daily': 0
        })
      } else if (partic.system.health.daily + damage >= partic.system.health.mjrwnd) {
        await partic.update({
          'system.minorWnd': true,
          'system.health.daily': 0
        })
      }
      if (!partic.system.minorWnd && !partic.system.majorWnd)
        await partic.update({ 'system.health.daily': partic.system.health.daily + damage })
    }
    if (game.settings.get('brp', 'useHPL')) { await location.update(checkprop) }

    //Prepare the new wound data and create it
    const itemData = {
      name: game.i18n.localize('BRP.wound'),
      type: 'wound',
      system: {
        locId: locationId,
        value: damage
      }
    };
    const newItem = await Item.create(itemData, { parent: partic });
    let key = await game.system.api.brpid.guessId(newItem)
    await newItem.update({
      'flags.brp.brpidFlag.id': key,
      'flags.brp.brpidFlag.lang': game.i18n.lang,
      'flags.brp.brpidFlag.priority': 0
    })

  }

  static async allHeal(el, actor) {
    let confirmation = await BRPUtilities.confirmation('allHeal', 'chatMsg');
    if (confirmation) {
      for (let i of actor.items) {
        if (i.type === 'wound') {
          i.delete();
        } else if (i.type === 'hit-location') {
          i.update({
            'system.bleeding': false,
            'system.incapacitated': false,
            'system.injured': false,
            'system.unconscious': false
          })
        }
      }
    }
    return
  }

  //Treat a Wound - First Aid or Magic
  static async treatWound(event, actor, dataitem, type) {
    let itemID = ""
    if (dataitem === "itemId" || dataitem === "woundId") {
      itemID = await BRPUtilities.getDataset(event, dataitem)
    }

    let getType = false
    let getWnd = false
    let healTypes = {}
    let wndList = {}

    if (!['medical', 'magic'].includes(type)) {
      getType = true
      healTypes = Object.assign(healTypes, {
        'medical': game.i18n.localize('BRP.medical'),
        'magical': game.i18n.localize('BRP.magical')
      })
    }
    if (!itemID) {
      let wounds = await actor.items.filter(itm => itm.type === 'wound')
      if (wounds.length === 0) { return }
      if (wounds.length === 1) {
        itemID = wounds[0]._id
      } else {
        getWnd = true
        wounds.sort(function (a, b) {
          let x = a.system.value;
          let y = b.system.value;
          if (x < y) { return 1 };
          if (x > y) { return -1 };
          return 0;
        });
        for (let wound of wounds) {
          let wndLoc = actor.items.get(wound.system.locId)
          let label = ""
          if (wndLoc) {
            label = wndLoc.system.displayName + "(" + wound.system.value + ")"
          } else {
            label = game.i18n.localize('BRP.general') + "(" + wound.system.value + ")"
          }
          if (wound.system.treated) {
            label = label + " " + game.i18n.localize('BRP.treated')
          }
          wndList = Object.assign(wndList, { [wound._id]: label })
        }
      }


    }
    let healing = 0
    let usage = await BRPDamage.healingAmount(game.i18n.localize('BRP.treatWound'), getType, getWnd, wndList, healTypes)
    if (usage) {
      healing = Number(usage.treatWound);
      if (getType) { type = usage.healType };
      if (getWnd) { itemID = usage.woundId };
    } else if (!usage) return

    const item = actor.items.get(itemID);
    let hitLoc = actor.items.get(item.system.locId)
    if (item.system.treated && type === 'medical') {
      ui.notifications.warn(game.i18n.localize('BRP.woundTreated'));
      return;
    }

    //If amout of healing is zero then simply ignore and stop
    if (healing === 0) { return }



    //If amount of healing >- wound then simply delete the wound
    if (healing >= item.system.value) {
      item.delete();
      actor.render(true)
      return
    }

    //Otherwise reduce the wound score by amount healed (or increase if a negative) and set treated status to true
    let newWound = item.system.value
    let checkProp = {
      'system.value': item.system.value - healing,
      'system.treated': true
    }
    item.update(checkProp)
    if (game.settings.get('brp', 'useHPL')) {
      hitLoc.update({
        'system.bleeding': false,
        'system.incapacitated': false,
        'system.unconscious': false
      })
    }
    //Take the opportunity to delete any wounds with zero damage they may not be visible
    await BRPDamage.cleanseWounds(actor)
  }


  static async naturalHeal(event, actor) {
    let usage = await BRPDamage.healingAmount(game.i18n.localize('BRP.naturalHealing'), false, false)
    let healing = 0
    let updates = [];
    let deletes = [];
    if (usage) {
      healing = Number(usage.treatWound);
    }
    //If amout of healing is zero then simply ignore and stop
    if (healing === 0) { return }

    //Put wounds in array and sort lowest to highest damage
    let wounds = [];
    for (let i of actor.items) {
      if (i.type === 'wound') {
        wounds.push(i);
      }
    }
    wounds.sort(function (a, b) {
      let x = a.system.value;
      let y = b.system.value;
      if (x < y) { return -1 };
      if (x > y) { return 1 };
      return 0;
    });

    let nw = wounds.length;
    for (let i of wounds) {
      if (i.system.value < 1) {
        deletes.push(i._id)
      } else {
        let avgHeal = Math.ceil(healing / nw)
        let woundHeal = Math.min(healing, i.system.value, avgHeal);
        healing = healing - woundHeal;
        if (woundHeal >= i.system.value) {
          deletes.push(i._id)
        } else if (woundHeal > 0) {
          updates.push({
            _id: i._id,
            'system.treated.': true,
            'system.value': i.system.value - woundHeal
          })
        } else {
          updates.push({
            _id: i._id,
            'system.treated.': true
          })
        }
      }
      nw--;
    }
    await Item.updateDocuments(updates, { parent: actor });
    await Item.deleteDocuments(deletes, { parent: actor });
  }


  //Delete any wounds that have zero or less damage - they may not be visible on the character sheet
  static async cleanseWounds(actor) {
    for (let i of actor.items) {
      if (i.type === 'wound' && i.system.value < 1) {
        i.delete();
      }
    }
  }

  // Form to get amount of damage or healing
  static async healingAmount(title, getType, getWnd, wndList, healTypes) {
    const html = await foundry.applications.handlebars.renderTemplate(
      'systems/brp/templates/dialog/treatWound.hbs',
      {
        getType,
        getWnd,
        wndList,
        healTypes
      }
    )
    const dlg = await BRPDialog.input({
      window: {title: title},
      content: html,
      ok: {
        label: game.i18n.localize('BRP.confirm')
      }
    })
    return dlg
  }

  static async resetDaily(event, actor) {
    actor.update({ 'system.health.daily': 0 })
    ui.notifications.warn(game.i18n.localize('BRP.resetDaily')+": "+actor.name)
  }

  //Get New Wound Dialog
  static async getWoundForm(getDam, getLoc, name, locs) {
    let title = game.i18n.localize('BRP.addWound') + ": " + name;
    const html = await foundry.applications.handlebars.renderTemplate(
      'systems/brp/templates/dialog/newWound.hbs',
      {
        getDam,
        getLoc,
        locs
      }
    )

    const dlg = await BRPDialog.input({
      window: {title: title},
      content: html,
      ok: {
        label: game.i18n.localize('BRP.confirm')
      }
    })
    return dlg
  }

  //Treat Wound by UUID
  static async applyHealing(woundUuid, successLevel) {
    let wound = await fromUuid(woundUuid)
    let actor = wound.parent
    let healing = 0
    let healingForm = ""
    successLevel = 0
    switch (successLevel) {
      case 0:
        //Fumble - create a wound
        let locationId = "total"
        if (game.settings.get('brp', 'useHPL')) {
          locationId = await (actor.items.filter(itm => itm.type === 'hit-location').filter(nItm => nItm.system.locType === 'general'))[0]._id
        }
        //If GM create wound routine, otherwise call socket so GM creates wound
        if (game.user.isGM) {
          await BRPDamage.firstAidFumble([actor._id], [actor.type], locationId)
        } else {
          const availableGM = game.users.find(d => d.active && d.isGM)?.id
          if (availableGM) {
            game.socket.emit('system.brp', {
              type: 'firstAidFumble',
              to: availableGM,
              value: { actorId: actor._id, actorType: actor.type, locationId }
            })
          } else {
            ui.notifications.warn(game.i18n.localize('BRP.noAvailableGM'))
          }
        }
        healing = -1
        break
      case 2:
        //Success
        healingForm = "1D3"
        break
      case 3:
        //Special Success
        healingForm = "2D3"
        break
      case 4:
        //Critical Success
        healingForm = "1D3+3"
        break
    }
    if (healingForm != "") {
      let healRoll = new Roll(healingForm)
      await healRoll.evaluate()
      healing = Number(healRoll.total)
      if (game.modules.get('dice-so-nice')?.active) {
        game.dice3d.showForRoll(healRoll, game.user, true, null, false)  //Roll,user,sync,whispher,blind
      }
    }

    if (healing >= wound.system.value) {
      wound.delete();
      actor.render(true)
    } else {
      await wound.update({
        'system.treated': true,
        'system.value': wound.system.value - healing
      })
      actor.render(true)
    }

    return { value: healing, formula: healingForm }
  }

  //Create First Aid Fumble Wound
  static async firstAidFumble(actorId, actorType, locationId) {

    let actor = await BRPactorDetails._getParticipant(actorId, actorType)
    const itemData = {
      name: game.i18n.localize('BRP.wound'),
      type: 'wound',
      system: {
        locId: locationId,
        value: 1
      }
    };
    const newItem = await Item.create(itemData, { parent: actor });
    let key = await game.system.api.brpid.guessId(newItem)
    await newItem.update({
      'flags.brp.brpidFlag.id': key,
      'flags.brp.brpidFlag.lang': game.i18n.lang,
      'flags.brp.brpidFlag.priority': 0
    })
  }

  // ---------------------------------------------------------------------------
  // CoC 7e wounds (M3). CoC has no wound items and no daily accumulation: the
  // current value is written straight to system.health.value and every state
  // transition lives under flags.brp.coc.wounds. The BRP paths above are never
  // entered from here.
  // ---------------------------------------------------------------------------

  static cocWounds(actor) {
    return actor?.flags?.brp?.coc?.wounds ?? {}
  }

  // A client may write its own actor; any GM that is not the deterministic
  // active GM relays to it. This is the single-writer rule for cross-owner
  // damage, not a second source of randomness.
  static cocWriteAllowed(actor) {
    if (!actor) { return false }
    const writer = game.users?.activeGM
    if (writer && game.user?.id === writer.id) { return true }
    if (game.user?.isGM) { return false }
    return actor.isOwner === true
  }

  // One real percentile roll. Callers own the visible card; this only decides a
  // CON check, so it returns the faces it actually rolled.
  static async _cocD100() {
    const roll = new Roll('1D100')
    await roll.evaluate()
    const face = roll.dice?.[0]?.values?.[0]
    const rollVal = Number.isFinite(Number(face)) ? Number(face) : Number(roll.total)
    return { roll, rollVal }
  }

  static async _cocConCheck(actor, reason) {
    const target = Number(actor.system?.stats?.con?.total ?? 0)
    const { roll, rollVal } = await BRPDamage._cocD100()
    const band = Rules.active().check.successBand({ rollVal, targetScore: target }).band
    const passed = Rules.active().combat.bandRank(band) >= 2
    return { roll, rollVal, target, band, passed, reason }
  }

  // Apply one blow. Returns the pure result plus the persisted state; the actor
  // document is updated once, so no second resolution can be observed.
  static async applyCoCDamage(actor, { damage = 0, source = null, conCheck = true } = {}) {
    if (!Rules.active().wounds) { return { error: 'ruleset-not-coc' } }
    if (!BRPDamage.cocWriteAllowed(actor)) { return { error: 'not-authorised' } }
    const wounds = BRPDamage.cocWounds(actor)
    if (wounds.dead === true) { return { applied: false, reason: 'already-dead', state: wounds } }
    const amount = Math.max(0, Math.floor(Number(damage) || 0))
    if (amount < 1) { return { applied: false, reason: 'no-damage', state: wounds } }

    const hpMax = Math.max(0, Math.floor(Number(actor.system?.health?.max) || 0))
    const hpValue = Math.max(0, Math.floor(Number(actor.system?.health?.value) || 0))
    const result = Rules.active().wounds.applyDamage({
      hpValue, hpMax, damage: amount, majorWound: wounds.majorWound === true,
    })
    // CoC core has no hit locations. If the world still has the BRP hit-location
    // option on, CoC damage deliberately ignores it and says so.
    const hplIgnored = game.settings.get('brp', 'useHPL') === true

    // A major wound forces an immediate CON roll; failing it knocks the
    // character out. The roll is real and its faces are recorded.
    let con = null
    let knockedOut = false
    if (conCheck && result.conCheckRequired) {
      con = await BRPDamage._cocConCheck(actor, 'major-wound')
      knockedOut = !con.passed
    }

    const state = {
      initialised: true,
      majorWound: result.anyMajorWound,
      dying: result.dying,
      dead: result.death,
      unconscious: result.instantDeath || result.hpAfter <= 0 || knockedOut,
      stabilized: false,
      hpValue: result.hpAfter,
      hpMax,
      lastDamage: amount,
      totalDamage: Number(wounds.totalDamage ?? 0) + amount,
      conCheck: con ? { rollVal: con.rollVal, band: con.band, passed: con.passed, target: con.target, reason: con.reason } : (wounds.conCheck ?? null),
      source,
      hplIgnored,
      at: Date.now(),
    }

    await actor.update({
      'system.health.value': result.hpAfter,
      'flags.brp.coc.wounds': state,
    })
    return { ...result, applied: true, conCheck: con, state, hplIgnored }
  }

  // End-of-round CON roll for a dying character: failing it kills; a stabilised
  // character skips the check until the next wound.
  static async cocDyingRound(actor, { reason = 'dying-round' } = {}) {
    if (!Rules.active().wounds) { return { error: 'ruleset-not-coc' } }
    if (!BRPDamage.cocWriteAllowed(actor)) { return { error: 'not-authorised' } }
    const wounds = BRPDamage.cocWounds(actor)
    if (wounds.dead === true) { return { skipped: 'dead', state: wounds } }
    if (wounds.dying !== true) { return { skipped: 'not-dying', state: wounds } }
    if (wounds.stabilized === true) { return { skipped: 'stabilised', state: wounds } }
    const con = await BRPDamage._cocConCheck(actor, reason)
    const next = Rules.active().wounds.dyingRound({ conPassed: con.passed })
    const state = {
      ...wounds,
      initialised: true,
      dying: next.dying,
      dead: next.dead,
      unconscious: true,
      conCheck: { rollVal: con.rollVal, band: con.band, passed: con.passed, target: con.target, reason },
      at: Date.now(),
    }
    await actor.update({
      'system.health.value': next.dead ? 0 : Math.max(0, Number(actor.system?.health?.value) || 0),
      'flags.brp.coc.wounds': state,
    })
    return { ...next, conCheck: con, state, applied: true }
  }

  // First Aid: +1 HP, rouses an unconscious character, stabilises a dying one.
  static async cocFirstAid(actor, { band = 'fail', rank = 0, healer = null } = {}) {
    if (!Rules.active().wounds) { return { error: 'ruleset-not-coc' } }
    if (!BRPDamage.cocWriteAllowed(actor)) { return { error: 'not-authorised' } }
    const wounds = BRPDamage.cocWounds(actor)
    if (wounds.dead === true) { return { applied: false, reason: 'already-dead', state: wounds } }
    const effect = Rules.active().wounds.firstAid({ band, rank, dying: wounds.dying === true, unconscious: wounds.unconscious === true })
    if (!effect.healed) { return { applied: false, effect, state: wounds } }
    const hpMax = Math.max(0, Math.floor(Number(actor.system?.health?.max) || 0))
    const hpValue = Math.max(0, Math.floor(Number(actor.system?.health?.value) || 0))
    const heal = Rules.active().wounds.applyHealing({ hpValue, hpMax, amount: effect.hp })
    const state = {
      ...wounds,
      initialised: true,
      hpValue: heal.hpAfter,
      // One HP or more ends the dying condition; the major wound remains until
      // Medicine/weekly recovery. First aid only rouses a non-dying patient.
      dying: heal.hpAfter > 0 ? false : wounds.dying === true,
      unconscious: effect.rouses ? false : (heal.hpAfter <= 0 || wounds.unconscious === true),
      stabilized: effect.stabilizes || wounds.stabilized === true,
      firstAid: { band, rank, healer, healed: heal.applied, at: Date.now() },
    }
    await actor.update({ 'system.health.value': heal.hpAfter, 'flags.brp.coc.wounds': state })
    return { applied: true, effect, healing: heal, state }
  }

  // Medicine: +1D3 HP (one hour and equipment), and a dying patient becomes
  // eligible for the weekly healing roll.
  static async cocMedicine(actor, { band = 'fail', rank = 0, healer = null } = {}) {
    if (!Rules.active().wounds) { return { error: 'ruleset-not-coc' } }
    if (!BRPDamage.cocWriteAllowed(actor)) { return { error: 'not-authorised' } }
    const wounds = BRPDamage.cocWounds(actor)
    if (wounds.dead === true) { return { applied: false, reason: 'already-dead', state: wounds } }
    const effect = Rules.active().wounds.medicine({ band, rank, dying: wounds.dying === true })
    if (!effect.healed) { return { applied: false, effect, state: wounds } }
    const roll = new Roll(effect.formula)
    await roll.evaluate()
    const amount = Math.max(0, Math.floor(Number(roll.total) || 0))
    const hpMax = Math.max(0, Math.floor(Number(actor.system?.health?.max) || 0))
    const hpValue = Math.max(0, Math.floor(Number(actor.system?.health?.value) || 0))
    const heal = Rules.active().wounds.applyHealing({ hpValue, hpMax, amount })
    const state = {
      ...wounds,
      initialised: true,
      hpValue: heal.hpAfter,
      dying: heal.hpAfter > 0 ? false : wounds.dying === true,
      unconscious: heal.hpAfter > 0 ? false : wounds.unconscious === true,
      stabilized: true,
      weeklyHealing: effect.grantsWeeklyHealing || wounds.weeklyHealing === true,
      medicine: { band, rank, healer, formula: effect.formula, healed: heal.applied, at: Date.now() },
    }
    await actor.update({ 'system.health.value': heal.hpAfter, 'flags.brp.coc.wounds': state })
    return { applied: true, effect, roll, healing: heal, state }
  }

  // Weekly recovery roll for a major wound: extreme clears the wound (2D3),
  // a normal success heals 1D3. Without a major wound there is no weekly roll.
  static async cocWeeklyHeal(actor, { band = 'fail', rank = 0 } = {}) {
    if (!Rules.active().wounds) { return { error: 'ruleset-not-coc' } }
    if (!BRPDamage.cocWriteAllowed(actor)) { return { error: 'not-authorised' } }
    const wounds = BRPDamage.cocWounds(actor)
    if (wounds.dead === true) { return { applied: false, reason: 'already-dead', state: wounds } }
    const effect = Rules.active().wounds.healingCheck({ band, rank })
    if (!effect.healed) { return { applied: false, effect, state: wounds } }
    const roll = new Roll(effect.formula)
    await roll.evaluate()
    const amount = Math.max(0, Math.floor(Number(roll.total) || 0))
    const hpMax = Math.max(0, Math.floor(Number(actor.system?.health?.max) || 0))
    const hpValue = Math.max(0, Math.floor(Number(actor.system?.health?.value) || 0))
    const heal = Rules.active().wounds.applyHealing({ hpValue, hpMax, amount })
    const cleared = Rules.active().wounds.majorWoundCleared({ hpValue: heal.hpAfter, hpMax, extremeSuccess: effect.clearsMajorWound })
    const state = {
      ...wounds,
      initialised: true,
      hpValue: heal.hpAfter,
      majorWound: cleared ? false : wounds.majorWound === true,
      dying: false,
      unconscious: heal.hpAfter <= 0,
      weeklyHealing: false,
      weekly: { band, rank, formula: effect.formula, healed: heal.applied, clearedMajorWound: cleared, at: Date.now() },
    }
    await actor.update({ 'system.health.value': heal.hpAfter, 'flags.brp.coc.wounds': state })
    return { applied: true, effect, roll, healing: heal, state }
  }

  // Between blows: one HP per day without a major wound; a major wound only
  // heals through the weekly CON roll (cocWeeklyHeal).
  static async cocNaturalHeal(actor) {
    if (!Rules.active().wounds) { return { error: 'ruleset-not-coc' } }
    if (!BRPDamage.cocWriteAllowed(actor)) { return { error: 'not-authorised' } }
    const wounds = BRPDamage.cocWounds(actor)
    if (wounds.dead === true) { return { applied: false, reason: 'already-dead', state: wounds } }
    const effect = Rules.active().wounds.naturalHeal({ majorWound: wounds.majorWound === true })
    if (effect.hp < 1) { return { applied: false, effect, state: wounds } }
    const hpMax = Math.max(0, Math.floor(Number(actor.system?.health?.max) || 0))
    const hpValue = Math.max(0, Math.floor(Number(actor.system?.health?.value) || 0))
    const heal = Rules.active().wounds.applyHealing({ hpValue, hpMax, amount: effect.hp })
    const state = { ...wounds, initialised: true, hpValue: heal.hpAfter, unconscious: heal.hpAfter <= 0 }
    await actor.update({ 'system.health.value': heal.hpAfter, 'flags.brp.coc.wounds': state })
    return { applied: true, effect, healing: heal, state }
  }

  // Sheet "add damage" action for CoC: ask for the amount with the existing
  // wound dialog, then write it through the CoC path.
  static async cocAddDamageDialog(actor) {
    if (!Rules.active().wounds) { return { error: 'ruleset-not-coc' } }
    const usage = await BRPDamage.getWoundForm(true, false, actor.name, {})
    if (!usage) { return { applied: false, reason: 'cancelled' } }
    return BRPDamage.applyCoCDamage(actor, { damage: Number(usage.damage), source: 'sheet' })
  }

}

