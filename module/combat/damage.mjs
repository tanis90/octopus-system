import { BRPUtilities } from '../apps/utilities.mjs';
import BRPDialog from '../setup/brp-dialog.mjs';
import { Rules } from '../rules/index.mjs';
import { cocWoundConditionWrites } from '../actor/coc-status.mjs';

export class BRPDamage {

  // CoC 7e has one HP track and no wound/hit-location Items. Every damage
  // entry point writes through applyCoCDamage; the retired BRP wound path is
  // not reachable from the sheet, the chat card or the socket.
  static async addDamage(target, actor, token, damage) {
    const partic = actor ?? token?.actor
    if (!partic) { return }
    const amount = Number(damage) || 0
    if (amount < 1) { return BRPDamage.cocAddDamageDialog(partic) }
    return BRPDamage.applyCoCDamage(partic, { damage: amount, source: 'sheet' })
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

  // ---------------------------------------------------------------------------
  // CoC 7e wounds (M3). CoC has no wound items and no daily accumulation: the
  // current value is written straight to system.attribs.hp.value and every state
  // transition lives under flags.brp.coc.wounds. The BRP paths above are never
  // entered from here.
  // ---------------------------------------------------------------------------

  static cocWounds(actor) {
    return actor?.flags?.brp?.coc?.wounds ?? {}
  }

  // CoC HP is the native attribs.hp resource. A CoC actor has no
  // system.health; reading it silently turned every wound into hpMax 0.
  static _cocHp(actor) {
    const hp = actor?.system?.attribs?.hp ?? {}
    return {
      hpMax: Math.max(0, Math.floor(Number(hp.max) || 0)),
      hpValue: Math.max(0, Math.floor(Number(hp.value) || 0)),
    }
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
    const con = actor?.system?.characteristics?.con ?? {}
    const target = Number(con.total ?? con.value ?? 0)
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

    const { hpMax, hpValue } = BRPDamage._cocHp(actor)
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
      'system.attribs.hp.value': result.hpAfter,
      'flags.brp.coc.wounds': state,
      ...cocWoundConditionWrites(state),
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
    const { hpValue } = BRPDamage._cocHp(actor)
    await actor.update({
      'system.attribs.hp.value': next.dead ? 0 : hpValue,
      'flags.brp.coc.wounds': state,
      ...cocWoundConditionWrites(state),
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
    const { hpMax, hpValue } = BRPDamage._cocHp(actor)
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
    await actor.update({
      'system.attribs.hp.value': heal.hpAfter,
      'flags.brp.coc.wounds': state,
      ...cocWoundConditionWrites(state),
    })
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
    const { hpMax, hpValue } = BRPDamage._cocHp(actor)
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
    await actor.update({
      'system.attribs.hp.value': heal.hpAfter,
      'flags.brp.coc.wounds': state,
      ...cocWoundConditionWrites(state),
    })
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
    const { hpMax, hpValue } = BRPDamage._cocHp(actor)
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
    await actor.update({
      'system.attribs.hp.value': heal.hpAfter,
      'flags.brp.coc.wounds': state,
      ...cocWoundConditionWrites(state),
    })
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
    const { hpMax, hpValue } = BRPDamage._cocHp(actor)
    const heal = Rules.active().wounds.applyHealing({ hpValue, hpMax, amount: effect.hp })
    const state = { ...wounds, initialised: true, hpValue: heal.hpAfter, unconscious: heal.hpAfter <= 0 }
    await actor.update({
      'system.attribs.hp.value': heal.hpAfter,
      'flags.brp.coc.wounds': state,
      ...cocWoundConditionWrites(state),
    })
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

