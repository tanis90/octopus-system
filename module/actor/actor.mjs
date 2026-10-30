import { BRPactorItemDrop } from './actor-itemDrop.mjs'
import { BRPID } from '../brpid/brpid.mjs';
import { Rules } from '../rules/index.mjs';

export class BRPActor extends Actor {

  prepareData() {
    super.prepareData();
  }

  prepareBaseData() {
    this.system.brpidFlagItems = {}
    for (const i of this.items) {
      if (i.flags.brp?.brpidFlag?.id) {
        const parts = i.flags.brp?.brpidFlag?.id.match(/^([^\.]+)\.([^\.]+)\.([^\.]+)$/)
        if (parts) {
          if (typeof this.system.brpidFlagItems[parts[1]] === 'undefined') {
            this.system.brpidFlagItems[parts[1]] = {}
          }
          if (typeof this.system.brpidFlagItems[parts[1]][parts[2]] === 'undefined') {
            this.system.brpidFlagItems[parts[1]][parts[2]] = {}
          }
          this.system.brpidFlagItems[parts[1]][parts[2]][parts[3]] = i
        }
      }
    }
  }

  prepareDerivedData() {
    const actorData = this;
    const systemData = actorData.system;
    const flags = actorData.flags.boilerplate || {};

    //Prepare data for different actor types
    this._prepareCharacterData(actorData);
    this._prepareNpcData(actorData);
  }

  //Prepare Character specific data
  async _prepareCharacterData(actorData) {
    if (actorData.type !== 'character') return;
    const systemData = actorData.system;
    this._prepStats(actorData)
    this._prepDerivedStats(actorData)

    const persistedHp = Number(systemData.health.value)
    systemData.health.value = systemData.health.max;
    //CoC keeps current HP in the document itself (there are no wound items).
    //Once damage/healing has been recorded under flags.brp.coc.wounds the
    //persisted value is authoritative; before that a fresh character is at full
    //HP, which is the historical derived behaviour.
    if (Rules.active().wounds?.woundState && actorData.flags?.brp?.coc?.wounds?.initialised === true) {
      const hp = Number.isFinite(persistedHp) ? persistedHp : systemData.health.max
      systemData.health.value = Math.min(Math.max(hp, 0), systemData.health.max)
    }

    //Initialise Powers IDs
    systemData.magic = "";
    systemData.mutation = "";
    systemData.psychic = "";
    systemData.sorcery = "";
    systemData.super = "";

    //Initialise health statuses and other values
    systemData.dead = false;
    systemData.severed = false;
    systemData.unconscious = false;
    systemData.injured = false;
    systemData.incapacitated = false;
    systemData.bleeding = false
    systemData.enc = 0;
    systemData.av1 = 0;
    systemData.av2 = 0;
    systemData.avr1 = "";
    systemData.avr2 = "";
    systemData.psCurr = 0;
    systemData.psMax = 0;

    //Set Hit Location AP to zero
    for (let itm of actorData.items) {

      if (itm.type === 'hit-location') {
        itm.system.av1 = 0
        itm.system.av2 = 0
        itm.system.avr1 = ""
        itm.system.avr2 = ""
        itm.system.enc = 0
        itm.system.ppCurr = 0
        itm.system.pSCurr = 0
        itm.system.mnplmod = 0
        itm.system.percmod = 0
        itm.system.physmod = 0
        itm.system.stealthmod = 0
      }
    }

    //Calculate Skill Category Bonuses
    for (let itm of actorData.items) {
      if (itm.type === 'skillcat') {
        let bonus = 0;
        if (game.settings.get('brp', 'skillBonus') === "1" && itm.system.stat != 'none') {
          bonus = Math.ceil(systemData.stats[itm.system.stat].total / 2);
        } else if (game.settings.get('brp', 'skillBonus') === "2") {
          for (let [key, value] of Object.entries(itm.system.attrib)) {
            if (key === 'edu' && !Rules.active().settings.useEDU()) { continue }

            switch (value) {
              case "0":    //No adjustment
                break;
              case "1":    //Primary
                bonus += this._categoryprimary(systemData.stats[key].total)
                break;
              case "2":    //Secondary
                bonus += this._categorysecondary(systemData.stats[key].total)
                break;
              case "3":    //Negative
                bonus += this._categorynegative(systemData.stats[key].total)
                break;
              case "4":    //Negative Secondary
                bonus += this._categorynegsec(systemData.stats[key].total)
                break;
            }
          }
        }
        itm.system.bonus = bonus
        itm.system.total = itm.system.bonus + itm.system.mod
        let key = itm.flags.brp.brpidFlag.id
        systemData.skillcategory[key] = itm.system.total;
      }
    }
    let effects = actorData.effects.map(i=> {return {origin: i.origin} })
    //Calcualte/adjust scores for items (itm)
    for (let itm of actorData.items) {

      /*Replaced with code below as not correctly applying to weapons
      //Does the item have transferrable effects
      if (['gear', 'armour', 'weapon','wound'].includes(itm.type)) {
        if (itm.transferredEffects.length > 0) {
          itm.system.hasEffects = true;
        } else {
          itm.system.hasEffects = false;
        }
      }*/

      //Does the item have transferrable effects
      if (['gear', 'armour', 'weapon','wound'].includes(itm.type)) {
          itm.system.hasEffects = false;
        for (let effect of effects) {
          if (effect.origin === itm.uuid) {
            itm.system.hasEffects = true;
          }
        }
      }

      //If skill, magic or psychic calculate the total score and record the category bonus
      if (itm.type === 'skill' || itm.type === 'magic' || itm.type === 'psychic') {
        itm.system.total = itm.system.base + itm.system.xp + itm.system.effects + itm.system.profession + itm.system.personality + itm.system.personal + itm.system.culture
        itm.system.catBonus = systemData.skillcategory[itm.system.category]

        //If Allegiance the set total and potential Ally status
      } else if (itm.type === 'allegiance') {
        itm.system.total = itm.system.allegPoints + itm.system.xp
        itm.system.potAlly = false

        //If Passion the set total
      } else if (itm.type === 'passion') {
        itm.system.total = itm.system.base + itm.system.xp

        //If Personality Trait the set total
      } else if (itm.type === 'persTrait') {
        itm.system.total = Math.max(0, Math.min(100, itm.system.base + itm.system.xp))
        itm.system.opptotal = 100 - itm.system.total

        //If Reputation set total
      } else if (itm.type === 'reputation') {
        itm.system.total = itm.system.base

        //If gear/weapon, calculates the encumbrance
      } else if (['gear', 'weapon'].includes(itm.type)) {
        if (itm.system.equipStatus === 'carried') {
          itm.system.actlEnc = itm.system.quantity * itm.system.enc
          systemData.enc = Number(systemData.enc + itm.system.actlEnc)
        } else { itm.system.actlEnc = 0 }

        if (itm.system.equipStatus != 'stored') {
          if (itm.system.pSCurr > 0) { systemData.psCurr = systemData.psCurr + itm.system.pSCurr }
          if (itm.system.pSMax > 0) { systemData.psMax = systemData.psMax + itm.system.pSMax }
        }



        //If armour
      } else if (itm.type === 'armour') {
        //Calc encumbrance based on carry status and if using HPL
        //A CoC world has no hit locations at all, so the location-scoped
        //branches are skipped there instead of dereferencing a missing item.
        const hplArmour = game.settings.get('brp', 'useHPL') && !Rules.active().wounds
        itm.system.actlEnc = 0
        if (itm.system.equipStatus === 'carried') {
          if (hplArmour) {
            itm.system.actlEnc = Math.round(itm.system.quantity * itm.system.enc / actorData.items.get(itm.system.hitlocID).system.fractionENC * 10) / 10
          } else {
            itm.system.actlEnc = Number(itm.system.quantity * itm.system.enc)
          }
          //If not carried then zero ENC
        }
        systemData.enc = systemData.enc + itm.system.actlEnc
        if (itm.system.equipStatus != 'stored') {
          if (itm.system.pSCurr > 0) { systemData.psCurr = systemData.psCurr + itm.system.pSCurr }
          if (itm.system.pSMax > 0) { systemData.psMax = systemData.psMax + itm.system.pSMax }
          if (hplArmour) {
            let hitLoc = actorData.items.get(itm.system.hitlocID)
            hitLoc.system.ppCurr += itm.system.ppCurr
            hitLoc.system.pSCurr += Number(itm.system.pSCurr)
          }
        }


        //Add the Armour Point Score to the Hit Location if worn
        if (itm.system.equipStatus === 'worn') {
          if (hplArmour) {
            let hitLoc = actorData.items.get(itm.system.hitlocID)
            hitLoc.system.av1 += itm.system.av1
            hitLoc.system.mnplmod += itm.system.mnplmod
            hitLoc.system.percmod += itm.system.percmod
            hitLoc.system.physmod += itm.system.physmod
            hitLoc.system.stealthmod += itm.system.stealthmod
            if (itm.system.av2 > 0) {
              hitLoc.system.av2 += itm.system.av2
            }
            if (itm.system.avr1 != "") {
              hitLoc.system.avr1 += "+" + itm.system.avr1
            }
            if (itm.system.avr2 != "") {
              hitLoc.system.avr2 += "+" + itm.system.avr2
            }
          } else {
            systemData.av1 += itm.system.av1
            systemData.av2 += itm.system.av2
            if (itm.system.avr1 != "") {
              systemData.avr1 += "+" + itm.system.avr1
            }
            if (itm.system.avr2 != "") {
              systemData.avr2 += "+" + itm.system.avr2
            }
          }
        }
        if (hplArmour) {
          let hitLoc = actorData.items.get(itm.system.hitlocID)
          hitLoc.system.enc += itm.system.actlEnc
        }
        //If power then record the ID against the category
      } else if (itm.type === 'power') {
        systemData[itm.system.category] = itm._id;
      } else if (itm.type === 'profession') {
        systemData.profession = itm.name
        systemData.professionId = itm._id;
        //If hit locations calculation HPL max and current and statuses
        //CoC core has no hit locations: even in a world that still has the BRP
        //option on, a CoC actor never enters the location branch (otherwise a
        //location's own states would overwrite the wound flags).
      } else if (itm.type === 'hit-location' && game.settings.get('brp', 'useHPL') && !Rules.active().wounds) {
        itm.system.injured = false;
        itm.system.maxHP = Math.max((Math.ceil(systemData.health.max / itm.system.fractionHP) + itm.system.adj), 0);
        itm.system.currHP = itm.system.maxHP
        //Loop through items (wnd) to find wounds
        for (let wnd of actorData.items) {
          if (wnd.type === 'wound' && wnd.system.locId === itm._id) {
            itm.system.currHP = itm.system.currHP - wnd.system.value
          }
        }
        if (itm.system.currHP < 1 && itm.system.locType === 'limb') {
          itm.system.injured = true
        } else if (itm.system.currHP < 1 && itm.system.locType === 'abdomen') {
          itm.system.injured = true
          systemData.injured = true
        } else if (itm.system.currHP < 1 && itm.system.locType === 'chest') {
          itm.system.incapacitated = true
          systemData.incapacitated = true
        } else if (itm.system.currHP < 1 && itm.system.locType === 'head') {
          itm.system.unconscious = true
          systemData.unconscious = true
        }
        if (itm.system.bleeding) { systemData.bleeding = true }
        if (itm.system.unconscious) { systemData.unconscious = true }
        if (itm.system.incapacitated) { systemData.incapacitated = true }
        if (itm.system.severed) { systemData.severed = true }
        if (itm.system.dead) { systemData.dead = true }
        //If wound calculate total HPL
      } else if (itm.type === 'wound') {
        systemData.health.value = systemData.health.value - itm.system.value
      }

    }

    //Calculate allegiance target
    let allegiances = actorData.items.filter(itm => itm.type === 'allegiance')
    allegiances.sort(function (a, b) {
      let x = a.system.total;
      let y = b.system.total;
      if (x < y) { return 1 };
      if (x > y) { return -1 };
      return 0;
    });
    //If there is one allegiance
    let ally = ""
    if (allegiances.length === 1 && allegiances[0].system.total >= 20) {
      actorData.items.get(allegiances[0]._id).system.potAlly = true
    } else if (allegiances.length > 1 && (allegiances[0].system.total - allegiances[1].system.total) >= 20) {
      actorData.items.get(allegiances[0]._id).system.potAlly = true
    }


    //Round ENC to 2 decimals and then adjust fatigue
    systemData.enc = (systemData.enc).toFixed(2)
    systemData.fatigue.max = Math.ceil(systemData.stats.str.total + systemData.stats.con.total - systemData.enc + systemData.fatigue.mod + (systemData.fatigue.effects ?? 0));

    //Derive Health Statuses from total HP.
    //CoC keeps its own wound state in flags.brp.coc.wounds: zero HP alone is
    //unconsciousness, death only comes from instant death or a failed dying
    //CON roll. Octopus keeps the historical thresholds unchanged.
    const cocWounds = Rules.active().wounds
    if (cocWounds) {
      const state = cocWounds.woundState({
        hpValue: systemData.health.value,
        hpMax: systemData.health.max,
        majorWound: actorData.flags?.brp?.coc?.wounds?.majorWound === true,
        dying: actorData.flags?.brp?.coc?.wounds?.dying === true,
        dead: actorData.flags?.brp?.coc?.wounds?.dead === true,
        unconscious: actorData.flags?.brp?.coc?.wounds?.unconscious === true,
      })
      systemData.dead = state.dead
      systemData.unconscious = state.unconscious
      systemData.dying = state.dying
      systemData.majorWound = state.majorWound
      systemData.cocWounds = true
    } else if (systemData.health.value < 1) {
      systemData.dead = true;
    } else if (systemData.health.value < 3) {
      systemData.unconscious = true;
    }

    //Sanity chain derives last, once all skill scores exist (lore clamp)
    this._prepSanity(actorData)
    //Luck budget only needs the POW snapshot to exist - clamps after SAN
    this._prepLuck(actorData)

  }

  //Prepare NPC specific data.
  async _prepareNpcData(actorData) {
    if (actorData.type !== 'npc') return;
    const systemData = actorData.system;
    this._prepStats(actorData)
    this._prepDerivedStats(actorData)

    for (let [key, stat] of Object.entries(actorData.system.baseStats)) {
      stat.label = game.i18n.localize(CONFIG.BRP.stats[key]) ?? key;
      stat.labelShort = game.i18n.localize(CONFIG.BRP.statsAbbreviations[key]) ?? key;
      //Mark all stats as visible except for EDU where it's not being used
      stat.visible = true;
      if (key === 'edu' && !Rules.active().settings.useEDU()) { stat.visible = false }
    }


    let damage = 0
    systemData.fatigue.max = Math.ceil(systemData.stats.str.total + systemData.stats.con.total + systemData.fatigue.mod + (systemData.fatigue.effects ?? 0));

    for (let itm of actorData.items) {
      if (['skill', 'psychic', 'magic', 'passion', 'reputation'].includes(itm.type)) {
        itm.system.total = itm.system.base + (itm.system.effects ?? 0);
      } else if (['allegiance'].includes(itm.type)) {
        itm.system.total = itm.system.allegPoints;
      } else if (['persTrait'].includes(itm.type)) {
        itm.system.total = itm.system.base;
        itm.system.opptotal = 100 - itm.system.base;
      }
      else if (itm.type === 'hit-location' && (game.settings.get('brp', 'useHPL') || game.settings.get('brp', 'beastiary'))
        && !Rules.active().wounds) {
        itm.system.injured = false;
        itm.system.maxHP = Math.max((Math.ceil(systemData.health.max / itm.system.fractionHP) + itm.system.adj), 0);
        damage = damage + Math.max(itm.system.maxHP - itm.system.currHP, 0)
      }
    }

    //If using HPL then set current health (CoC has no hit locations; its current
    //HP lives in the document and is never recomputed from them)
    if (!Rules.active().wounds && (game.settings.get('brp', 'useHPL') || game.settings.get('brp', 'beastiary'))) {
      systemData.health.value = systemData.health.max - damage
    }

    //CoC NPCs carry the same wound flags as investigators; derive the four
    //states from them (octopus returns no wound block and is untouched).
    const npcWounds = Rules.active().wounds
    if (npcWounds?.woundState && actorData.flags?.brp?.coc?.wounds?.initialised === true) {
      const state = npcWounds.woundState({
        hpValue: systemData.health.value,
        hpMax: systemData.health.max,
        majorWound: actorData.flags?.brp?.coc?.wounds?.majorWound === true,
        dying: actorData.flags?.brp?.coc?.wounds?.dying === true,
        dead: actorData.flags?.brp?.coc?.wounds?.dead === true,
        unconscious: actorData.flags?.brp?.coc?.wounds?.unconscious === true,
      })
      systemData.dead = state.dead
      systemData.unconscious = state.unconscious
      systemData.dying = state.dying
      systemData.majorWound = state.majorWound
      systemData.cocWounds = true
    }

    //Sanity chain derives last, once all skill scores exist (lore clamp)
    this._prepSanity(actorData)
    //Luck budget only needs the POW snapshot to exist - clamps after SAN
    this._prepLuck(actorData)
  }


  getRollData() {
    const data = super.getRollData();

    // Prepare character roll data.
    this._getCharacterRollData(data);
    this._getNpcRollData(data);

    return data;
  }

  // Prepare character roll data.
  _getCharacterRollData(data) {
    if (this.type !== 'character') return;

    // Copy the ability scores to the top level
    if (data.stats) {
      for (let [k, v] of Object.entries(data.stats)) {
        data[k] = foundry.utils.deepClone(v);
      }
    }
  }

  // Prepare NPC roll data
  _getNpcRollData(data) {
    if (this.type !== 'npc') return;
  }


  //Prepare Stats
  _prepStats(actorData) {
    // Loop through ability scores, calculating total and derived scores
    actorData.system.redistInc = 0
    actorData.system.redistDec = 0
    for (let [key, stat] of Object.entries(actorData.system.stats)) {
      stat.label = game.i18n.localize(CONFIG.BRP.stats[key]) ?? key;
      stat.labelShort = game.i18n.localize(CONFIG.BRP.statsAbbreviations[key]) ?? key;
      stat.labelDeriv = game.i18n.localize(CONFIG.BRP.statsDerived[key]) ?? key;
      stat.total = Number(stat.base) + Number(stat.redist) + Number(stat.culture) + Number(stat.exp) + Number(stat.effects) + Number(stat.age);
      stat.deriv = stat.total * 5;
      if (stat.redist < 0) { actorData.system.redistDec = actorData.system.redistDec + stat.redist }
      if (stat.redist > 0) { actorData.system.redistInc = actorData.system.redistInc + stat.redist }

      //Mark all stats as visible except for EDU where it's not being used
      stat.visible = true;
      if (key === 'edu' && !Rules.active().settings.useEDU()) { stat.visible = false }
    }
    if (actorData.type === 'npc')
      for (let [key, stat] of Object.entries(actorData.system.baseStats)) {
        stat.labelShort = game.i18n.localize(CONFIG.BRP.statsAbbreviations[key]) ?? key;
        //Mark all stats as visible except for EDU where it's not being used
        stat.visible = true;
        if (key === 'edu' && !Rules.active().settings.useEDU()) { stat.visible = false }
      }
    actorData.system.redistTotal = actorData.system.redistInc + actorData.system.redistDec
  }

  // Calculate derived scores
  _prepDerivedStats(actorData) {
    let systemData = actorData.system
    if (actorData.type === 'character') {
      systemData.health.max = Math.ceil((systemData.stats.con.total + systemData.stats.siz.total) * game.settings.get('brp', 'hpMod') / 2) + systemData.health.mod + (systemData.health.effects ?? 0);
    } else {
      let health = 0
      let formula = ""
      let statCount = 0
      if (systemData.hp.stat1 != 'none') {
        health += systemData.stats[systemData.hp.stat1].total
        statCount++
        formula = game.i18n.localize(CONFIG.BRP.statsAbbreviations[systemData.hp.stat1])
      }
      if (systemData.hp.stat2 != 'none') {
        health += systemData.stats[systemData.hp.stat2].total
        statCount++
        if (statCount === 2) { formula = formula + " + " }
        formula = formula + game.i18n.localize(CONFIG.BRP.statsAbbreviations[systemData.hp.stat2])
      }
      health = Math.ceil(health * systemData.hp.multi)
      if (statCount === 1) {
        formula = "(" + formula + " * " + systemData.hp.multi + ")"
      } else if (statCount === 2) {
        formula = "((" + formula + ") * " + systemData.hp.multi + ")"
      }
      if (systemData.health.mod < 0) {
        formula = formula + " " + systemData.health.mod
      } else if (systemData.health.mod > 0) {
        formula = formula + " + " + systemData.health.mod
      }
      systemData.hp.formula = formula
      systemData.health.max = health + (systemData.health.mod ?? 0) + (systemData.health.effects ?? 0);
    }
    systemData.health.mjrwnd = Math.ceil(systemData.health.max / 2);
    systemData.power.max = systemData.stats.pow.total + systemData.power.mod + (systemData.power.effects ?? 0);
    systemData.xpBonus = Math.ceil(systemData.stats.int.total / 2);
    systemData.dmgBonus = this._damageBonus(systemData.stats.str.total + systemData.stats.siz.total)
    systemData.dmgSpecBonus = this._damageBonus(systemData.stats.str.total * 2)

    //Ruleset seam: octopus returns no overrides; CoC replaces HP/MP/Build/MOV/DB
    //with its own official formulas.
    const secondary = Rules.active().deriveSecondary({ actorData, systemData })
    if (Number.isFinite(secondary.healthMax)) { systemData.health.max = secondary.healthMax }
    if (Number.isFinite(secondary.powerMax)) { systemData.power.max = secondary.powerMax }
    if (Number.isFinite(secondary.build)) { systemData.build = secondary.build }
    if (Number.isFinite(secondary.mov)) { systemData.mov = secondary.mov }
    if (secondary.dmgBonus) { systemData.dmgBonus = secondary.dmgBonus }
    if (secondary.dmgSpecBonus) { systemData.dmgSpecBonus = secondary.dmgSpecBonus }
    systemData.health.mjrwnd = Math.ceil(systemData.health.max / 2);

    //Set Resource Labels
    if (game.settings.get('brp', 'ppLabelLong')) {
      systemData.power.label = game.settings.get('brp', 'ppLabelLong')
    } else {
      systemData.power.label = game.i18n.localize('BRP.pp')
    }
    if (game.settings.get('brp', 'ppLabelShort')) {
      systemData.power.labelAbbr = game.settings.get('brp', 'ppLabelShort')
    } else {
      systemData.power.labelAbbr = game.i18n.localize('BRP.ppShort')
    }
    if (game.settings.get('brp', 'hpLabelLong')) {
      systemData.health.label = game.settings.get('brp', 'hpLabelLong')
    } else {
      systemData.health.label = game.i18n.localize('BRP.health')
    }
    if (game.settings.get('brp', 'hpLabelShort')) {
      systemData.health.labelAbbr = game.settings.get('brp', 'hpLabelShort')
    } else {
      systemData.health.labelAbbr = game.i18n.localize('BRP.hp')
    }
    if (game.settings.get('brp', 'fpLabelLong')) {
      systemData.fatigue.label = game.settings.get('brp', 'fpLabelLong')
    } else {
      systemData.fatigue.label = game.i18n.localize('BRP.fatigue')
    }
    if (game.settings.get('brp', 'fpLabelShort')) {
      systemData.fatigue.labelAbbr = game.settings.get('brp', 'fpLabelShort')
    } else {
      systemData.fatigue.labelAbbr = game.i18n.localize('BRP.fp')
    }
    if (game.settings.get('brp', 'sanLabelLong')) {
      systemData.sanity.label = game.settings.get('brp', 'sanLabelLong')
    } else {
      systemData.sanity.label = game.i18n.localize('BRP.sanity')
    }
    if (game.settings.get('brp', 'sanLabelShort')) {
      systemData.sanity.labelAbbr = game.settings.get('brp', 'sanLabelShort')
    } else {
      systemData.sanity.labelAbbr = game.i18n.localize('BRP.san')
    }
    if (game.settings.get('brp', 'sanLabelLoss')) {
      systemData.sanity.labelLoss = game.settings.get('brp', 'sanLabelLoss')
    } else {
      systemData.sanity.labelLoss = game.i18n.localize('BRP.sanLoss')
    }
    if (game.settings.get('brp', 'res5LabelLong')) {
      systemData.res5.label = game.settings.get('brp', 'res5LabelLong')
    } else {
      systemData.res5.label = game.i18n.localize('BRP.res5')
    }
    if (game.settings.get('brp', 'res5LabelShort')) {
      systemData.res5.labelAbbr = game.settings.get('brp', 'res5LabelShort')
    } else {
      systemData.res5.labelAbbr = game.i18n.localize('BRP.res5Abbr')
    }
  }

  //Prepare the Sanity (SAN) chain - only when the optional Sanity system is enabled.
  //Runs LAST in the prepare chain, after item scores exist (lore skill percent).
  //Fields persisted on the actor: starting/tis (creation snapshot), dailyLoss.
  //Everything else (max, lore clamp, value bounds) is derived here each pass.
  _prepSanity(actorData) {
    if (!Rules.active().settings.useSAN()) { return }
    const systemData = actorData.system
    const san = systemData.sanity
    const pow = systemData.stats.pow.total

    const model = Rules.active().sanity.prepare({
      pow,
      starting: san.starting,
      tis: san.tis,
      lorePercent: this._sanityLorePercent(),
      mythosPercent: this._sanityMythosPercent(),
      settings: { sanityTisPow: game.settings.get('brp', 'sanityTisPow') }
    })
    san.starting = model.starting
    san.tis = model.tis
    if (Object.hasOwn(model, 'loreSkillPercent')) { san.loreSkillPercent = model.loreSkillPercent }
    if (Object.hasOwn(model, 'mythosPercent')) { san.mythosPercent = model.mythosPercent }
    san.max = model.max

    //Invariant: 0 <= value <= max
    san.dailyLoss = Math.max(Number(san.dailyLoss) || 0, 0)
    san.value = Math.min(Math.max(Number(san.value) || 0, 0), san.max)

    //CoC M4 state. These are documented facts about the current episode, not
    //derived numbers: they are only normalized here, never recomputed, so a
    //refresh cannot resurrect a finished episode or invent a new one.
    if (Rules.active().sanity?.core) {
      san.singleLoss = Math.max(Number(san.singleLoss) || 0, 0)
      // `Number(null)` is 0, which would make a never-snapshotted day look
      // like "day started at SAN 0" and disable the one-fifth threshold.
      const rawDayStart = san.dayStartSan
      san.dayStartSan = rawDayStart === null || rawDayStart === undefined || rawDayStart === ''
        ? null
        : Math.max(Number(rawDayStart) || 0, 0)
      san.dayId = typeof san.dayId === 'string' && san.dayId !== '' ? san.dayId : null
      san.dayStartSource = san.dayId ? (san.dayStartSource ?? null) : null
      const insanity = san.insanity && typeof san.insanity === 'object' ? san.insanity : {}
      san.insanity = {
        temporary: insanity.temporary ?? null,
        indefinite: insanity.indefinite ?? null,
        permanent: insanity.permanent === true,
        lastUpdatedAt: insanity.lastUpdatedAt ?? null
      }
    }
  }

  //Cthulhu Mythos percent for the CoC SAN cap (99 - Mythos).
  _sanityMythosPercent() {
    const skill = this.items.find(itm => itm.type === 'skill' && (
      itm.flags.brp?.brpidFlag?.id === 'i.skill.coc.cthulhu-mythos' ||
      itm.flags.brp?.coc?.key === 'cthulhu-mythos'
    ))
    if (!skill) { return 0 }
    const total = Number(skill.system.total) + Number(this.system.skillcategory?.[skill.system.category] ?? 0)
    return Number.isFinite(total) ? Math.max(0, Math.min(100, total)) : 0
  }

  //Find the "forbidden lore" style skill and return its percent (null = not found, no clamp)
  _sanityLorePercent() {
    let skill = null
    const loreId = game.settings.get('brp', 'sanityLoreSkill')
    if (loreId) { skill = this.items.get(loreId) }
    if (!skill) {
      const defaultName = game.i18n.localize('BRP.madness.loreSkill').toLowerCase()
      skill = this.items.find(itm => itm.type === 'skill' && (
        itm.flags.brp?.brpidFlag?.id === 'i.skill.forbidden-lore' ||
        itm.name.toLowerCase() === defaultName
      ))
    }
    if (!skill || !['skill', 'magic', 'psychic'].includes(skill.type)) { return null }
    const total = skill.system.total + (this.system.skillcategory?.[skill.system.category] ?? 0)
    if (!Number.isFinite(total)) { return null }
    return Math.max(0, Math.min(100, total))
  }

  //SAN maximum: the starting score, permanently eroded by lore skill growth
  _sanityMax(starting, lorePercent) {
    const cap = (lorePercent != null) ? (100 - lorePercent) : starting
    return Math.max(Math.min(starting, cap), 0)
  }

  //Create-time SAN snapshot. Octopus: starting = POW x 5. CoC: starting = POW,
  //max = 99 - Cthulhu Mythos. Idempotent - once the snapshot exists it is never
  //taken again (later POW changes don't move it).
  async initSanity() {
    if (!Rules.active().settings.useSAN()) { return false }
    if (this._sanitySnapshotted()) { return false }
    const pow = this.system.stats.pow.total
    if (!(pow > 0)) { return false }
    const initial = Rules.active().sanity.initial({
      pow,
      lorePercent: this._sanityLorePercent(),
      mythosPercent: this._sanityMythosPercent(),
      settings: { sanityTisPow: game.settings.get('brp', 'sanityTisPow') }
    })
    await this.update({
      'system.sanity.starting': initial.starting,
      'system.sanity.tis': initial.tis,
      'system.sanity.dailyLoss': 0,
      'system.sanity.max': initial.max,
      'system.sanity.value': initial.value
    })
    return true
  }

  //Is there a persisted creation snapshot? (reads raw source data, not the derived values)
  _sanitySnapshotted() {
    try {
      const raw = this.toObject(false)?.system?.sanity ?? {}
      return (raw.starting != null && Number.isFinite(Number(raw.starting)))
    } catch {
      return false
    }
  }

  //Prepare the Luck budget. max is a creation snapshot (POW x 5 for octopus,
  //3D6 x 5 for CoC) - it is never
  //re-derived, so later POW changes don't move it. Invariant: 0 <= value <= max
  //once the snapshot exists (keeper restores by hand, clamped at max).
  //CoC also has a rules ceiling of 99: the starting value is not a cap, so a
  //session-start recovery may take Luck above the creation snapshot. `cap`
  //carries that ceiling; octopus leaves it null and keeps the historical max.
  _prepLuck(actorData) {
    const luck = actorData.system.luck
    if (!luck) { return }
    const max = Math.floor(Number(luck.max))
    if (Number.isFinite(max) && max > 0) {
      // Older CoC actors predate `luck.cap`; derive the same 99 ceiling from
      // the ruleset instead of clamping a recovered value to the snapshot.
      let cap = Math.floor(Number(luck.cap))
      if (!(Number.isFinite(cap) && cap > 0) && Rules.activeId?.() === 'coc') {
        const pow = Number(actorData.system?.stats?.pow?.total) || 0
        const ruleCap = Rules.active().luck?.cap?.({ pow })
        cap = Math.floor(Number(ruleCap) || 0)
      }
      const ceiling = Number.isFinite(cap) && cap > 0 ? Math.max(max, cap) : max
      luck.max = max
      if (Number.isFinite(cap) && cap > 0) { luck.cap = cap }
      luck.value = Math.min(Math.max(Math.floor(Number(luck.value) || 0), 0), ceiling)
    }
  }

  //Create-time Luck snapshot: octopus uses POW x 5; CoC rolls 3D6 x 5.
  //Luck only spends down from there (check-card buttons); restoration is a
  //keeper hand edit. Idempotent - once max is persisted it is never taken again.
  async initLuck() {
    if (this._luckSnapshotted()) { return false }
    const pow = this.system.stats.pow.total
    const initial = Rules.active().luck.initial({ pow })
    let max = initial.max
    let value = initial.value
    if (initial.formula) {
      // CoC Luck is independent of POW (3D6 x 5).
      const roll = new Roll(initial.formula)
      await roll.evaluate()
      max = Math.floor(roll.total)
      value = max
    } else if (!(pow > 0)) {
      return false
    }
    if (!(max > 0)) { return false }
    const cap = Rules.activeId?.() === 'coc' && Rules.active().luck?.cap
      ? Math.max(max, Number(Rules.active().luck.cap({ pow })) || 0)
      : null
    await this.update({
      'system.luck.max': max,
      'system.luck.value': value,
      'system.luck.cap': cap
    })
    return true
  }

  //Has the Luck creation snapshot been persisted? (raw source, not derived)
  _luckSnapshotted() {
    try {
      const raw = this.toObject(false)?.system?.luck ?? {}
      return (raw.max != null && Number.isFinite(Number(raw.max)) && Number(raw.max) > 0)
    } catch {
      return false
    }
  }

  //Used for Rolling NPCs when token dropped
  get hasRollableCharacteristics() {
    for (const [, value] of Object.entries(this.system.baseStats)) {
      if (isNaN(Number(value.random))) return true
      if (isNaN(Number(value.average))) return true
    }
    return false
  }

  //Roll Random Stats
  async rollCharacteristicsValue() {
    const stats = {}
    for (const [key, value] of Object.entries(this.system.baseStats)) {
      if (value.random && !value.random.startsWith('@')) {
        const r = new Roll(value.random)
        await r.evaluate()
        if (r.total) {
          stats[`system.stats.${key}.base`] = Math.floor(
            r.total
          )
        }
      }
    }
    await this.update(stats)
    //First stat roll completes "creation" for SAN purposes - snapshot starting/tis once
    await this.initSanity()
    //Same creation moment fixes the Luck budget (POW x 5, spend-only)
    await this.initLuck()
    await this.updateVitals()
  }

  //Roll Average Stats
  async averageCharacteristicsValue() {
    const stats = {}
    for (const [key, value] of Object.entries(this.system.baseStats)) {
      if (value.average && !value.average.startsWith('@')) {
        const r = new Roll(value.average)
        await r.evaluate()
        if (r.total) {
          stats[`system.stats.${key}.base`] = Math.floor(
            r.total
          )
        }
      }
    }
    await this.update(stats)
    //First stat roll completes "creation" for SAN purposes - snapshot starting/tis once
    await this.initSanity()
    //Same creation moment fixes the Luck budget (POW x 5, spend-only)
    await this.initLuck()
    await this.updateVitals()
  }

  //Update Current HP, FP etc and HPL when Rolled or Average Roll
  //Sanity is deliberately NOT reset here: SAN only fills at creation (initSanity),
  //rerolling characteristics must not restore lost Sanity.
  async updateVitals() {
    let checkProp = {
      'system.health.value': this.system.health.max,
      'system.power.value': this.system.power.max,
      'system.fatigue.value': this.system.fatigue.max
    }
    //A CoC reroll is a fresh vitals track; the wound flags must not keep a
    //stale majorWound/dying/dead state next to a full HP bar.
    if (Rules.active().wounds) {
      checkProp['flags.brp.coc.wounds'] = {
        initialised: true,
        hpValue: this.system.health.max,
        hpMax: this.system.health.max,
        majorWound: false,
        dying: false,
        dead: false,
        unconscious: false,
        stabilized: false,
      }
    }
    await this.update(checkProp)
    if (game.settings.get('brp', 'useHPL') && !Rules.active().wounds) {
      let hitLocs = this.items.filter(itm => itm.type === 'hit-location').map(itm => {
        return { _id: itm.id, 'system.currHP': itm.system.maxHP }
      })
      await Item.updateDocuments(hitLocs, { parent: this })
    }
  }

  //Create a new actor - When creating an actor set basics including tokenlink, bars, displays sight
  static async create(data, options = {}) {
    //If dropping from compendium check to see if the actor already exists in game.actors and if it does then get the game.actors details rather than create a copy
    if (options.fromCompendium) {
      let tempActor = await (game.actors.filter(actr => actr.flags?.brp?.brpidFlag?.id === data.flags.brp.brpidFlag.id && actr.flags?.brp?.brpidFlag?.priority === data.flags.brp.brpidFlag.priority))[0]
      if (tempActor) { return tempActor }
    }


    if (data.type === 'character') {
      data.prototypeToken = foundry.utils.mergeObject({
        actorLink: true,
        lockRotation: true,
        disposition: 1,
        displayName: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
        displayBars: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
        sight: {
          enabled: true,
          range: 30,
          visionMode:"basic"
        }
      }, data.prototypeToken || {})
    } else if (data.type === 'npc') {
      data.prototypeToken = foundry.utils.mergeObject({
        lockRotation: true,
        sight: {
          enabled: true,
          range: 30,
          visionMode:"basic"
        }
      }, data.prototypeToken || {})
    }

    let actor = await super.create(data, options)

    //If the actor arrives with stats (e.g. compendium import) take the SAN creation snapshot now;
    //blank actors snapshot later on their first stat roll (initSanity is idempotent)
    await actor.initSanity()
    //Luck snapshots at the same creation moment (initLuck is idempotent too)
    await actor.initLuck()

    //Add BRPID based on actor name if the game setting is flagged.
    if (game.settings.get('brp', "actorBRPID")) {
      let tempID = await BRPID.guessId(actor)
      if (tempID) {
        await actor.update({ 'flags.brp.brpidFlag.id': tempID })
        const html = $(actor.sheet.element).find('header.window-header a.header-button.edit-brpid-warning,header.window-header a.header-button.edit-brpid-exisiting')
        if (html.length) {
          html.css({
            color: (tempID ? 'orange' : 'red')
          })
        }
        actor.render()
      }
    }


    //Set up a general hit location for a new actor if using HPL.
    //CoC core has no hit locations, so a CoC actor never gets the item even when
    //the world still has the BRP option on.
    if (actor.type === 'character' && game.settings.get('brp', 'useHPL') && !Rules.active().wounds) {
      let brpid = "i.hit-location.general"

      const itemData = [{
        name: game.i18n.localize('BRP.general'),
        type: 'hit-location',
        img: 'systems/brp/assets/Icons/arm-bandage.svg',
        flags: { brp: { brpidFlag: { id: "i.hit-location.general" } } },
        system: {
          "fractionHP": 1,
          "fractionENC": 1,
          "lowRoll": 0,
          "highRoll": 0,
          "locType": "general"
        }
      }];
      const newItem = await Item.createDocuments(itemData, { parent: actor });
    }

    const rules = Rules.active()

    //Add Starter Skills if toggled on. Content is source-scoped: octopus and
    //CoC packs never leak into each other's starter sets.
    if (actor.type === 'character' && game.settings.get('brp', 'starterSkills')) {
      let newSkills = []
      let skillList = (await game.system.api.brpid.fromBRPIDRegexBest({ brpidRegExp: new RegExp('^i.skill'), type: 'i' }))
        .filter(itm => itm.system.basic && Rules.contentSourceOf(itm) === rules.starter.source)
      for (let itm of skillList) {
        if (actor.items.filter(nitm => nitm.flags.brp.brpidFlag.id === itm.flags.brp.brpidFlag.id).length < 1) {
          itm.system.base = await BRPactorItemDrop._calcBase(itm, actor);
          newSkills.push(itm);
        }
      }
      await Item.createDocuments(newSkills, { parent: actor });
      await BRPActor.charBaseSkillScores(actor);
    }

    //Every new character gets a real Unarmed (Brawl) weapon. This only runs on
    //the create path: existing actors and world/compendium imports are never
    //back-filled or migrated. Brawl is also ensured when starter skills are off
    //so weapon.system.skill1 always resolves to a real actor skill.
    if (actor.type === 'character' && !options.fromCompendium) {
      const brawlBrpid = rules.starter.brawlBrpid
      let brawlSkill = actor.items.find(itm => itm.flags?.brp?.brpidFlag?.id === brawlBrpid)
      if (!brawlSkill) {
        const brawlDoc = (await game.system.api.brpid.fromBRPIDBest({ brpid: brawlBrpid }))[0]
        if (brawlDoc) {
          brawlDoc.system.base = await BRPactorItemDrop._calcBase(brawlDoc, actor)
          brawlSkill = (await Item.createDocuments([brawlDoc], { parent: actor }))[0]
        }
      }
      if (!brawlSkill) {
        const message = `BRP: brawl skill ${brawlBrpid} not found; unarmed weapon not created for ${actor.name}`
        console.warn(message)
        globalThis.ui?.notifications?.warn?.(message)
      } else if (!actor.items.some(itm => itm.flags?.brp?.unarmed === true)) {
        const unarmed = rules.starter.unarmed ?? {}
        //CoC marks the weapon with its own profile (`flags.brp.coc.weapon`) so
        //the BRP `special` field is never the rule source. Octopus keeps the
        //historical item byte-for-byte.
        const cocWeapon = rules.id === 'coc'
          ? { kind: 'melee', dbMode: unarmed.dbMode ?? 'full', impaling: unarmed.impaling === true }
          : null
        await Item.createDocuments([{
          name: '徒手（斗殴）',
          type: 'weapon',
          img: 'systems/brp/assets/Icons/deadly-strike.svg',
          flags: {
            brp: {
              unarmed: true,
              brpidFlag: { id: 'i.weapon.unarmed', lang: 'zh-CN', priority: 1 },
              enName: 'Unarmed',
              ...(cocWeapon ? { coc: { weapon: cocWeapon } } : {})
            }
          },
          system: {
            weaponType: 'melee',
            skill1: brawlBrpid,
            skill2: 'none',
            dmg1: unarmed.damage ?? '1D3',
            db: unarmed.dbMode ?? 'full',
            special: cocWeapon ? (unarmed.special ?? 'none') : 'crush',
            spclDmg: false,
            att: 1,
            range1: 'S',
            hands: '1H',
            parry: false,
            quantity: 1,
            enc: 0,
            equipStatus: 'carried',
            npcVal: 0
          }
        }], { parent: actor })
      }
    }

    //Add Starter Traits if toggled on
    if (actor.type === 'character' && game.settings.get('brp', 'starterTraits') && game.settings.get('brp', 'usePersTrait')) {
      let newTraits = []
      let traitList = (await game.system.api.brpid.fromBRPIDRegexBest({ brpidRegExp: new RegExp('^i.persTrait'), type: 'i' })).filter(itm => itm.system.basic)
      for (let itm of traitList) {
        if (actor.items.filter(nitm => nitm.flags.brp.brpidFlag.id === itm.flags.brp.brpidFlag.id).length < 1) {
          newTraits.push(itm);
        }
      }
      await Item.createDocuments(newTraits, { parent: actor });
    }



    //Add Skill Categories only for rulesets that use category bonuses. CoC
    //core skills stand alone, so a CoC actor gets no octopus/empty magic cat.
    if (actor.type === 'character' && rules.starter.categories) {
      let newSkillCats = []
      let skillCatList = (await game.system.api.brpid.fromBRPIDRegexBest({ brpidRegExp: new RegExp('^i.skillcat'), type: 'i' }))
        .filter(itm => Rules.contentSourceOf(itm) === rules.starter.source)
      for (let itm of skillCatList) {
        if (actor.items.filter(nitm => nitm.flags.brp.brpidFlag.id === itm.flags.brp.brpidFlag.id).length < 1) {
          newSkillCats.push(itm)
        }
      }
      await Item.createDocuments(newSkillCats, { parent: actor })
    }
    return actor
  }

  //Recalculate all skill base scores
  static async charBaseSkillScores(actor) {
    let change = []
    for (let itm of actor.items) {
      if (itm.type != 'skill') { continue }
      let baseScore = await BRPactorItemDrop._calcBase(itm, actor)
      change.push({ _id: itm._id, "system.base": baseScore })
    }
    await Item.updateDocuments(change, { parent: actor })
  }

  // Primary Skills Bonus
  _categoryprimary(statvalue) {
    var bonus = statvalue - 10;
    return bonus;
  }

  // Secondary Skills Bonus
  _categorysecondary(statvalue) {
    var bonus = (statvalue - 10) / 2
    if (bonus < 0) {
      bonus = Math.ceil(bonus);
    } else {
      bonus = Math.floor(bonus);
    }
    return bonus;
  }

  // Negative Skills Bonus
  _categorynegative(statvalue) {
    var bonus = 10 - statvalue;
    return bonus;
  }

  // Negative Secondary Skills Bonus
  _categorynegsec(statvalue) {
    var bonus = (10 - statvalue) / 2
    if (bonus < 0) {
      bonus = Math.ceil(bonus);
    } else {
      bonus = Math.floor(bonus);
    }
    return bonus;
  }

  //Damage Bonus
  _damageBonus(value) {
    let dmgBonus = {}
    if (value < 13) {
      dmgBonus.dbl = '-2D6'
      dmgBonus.full = '-1D6'
      dmgBonus.half = '-1D3'
    } else if (value < 17) {
      dmgBonus.dbl = '-2D4'
      dmgBonus.full = '-1D4'
      dmgBonus.half = '-1D2'
    } else if (value < 25) {
      dmgBonus.dbl = '+0'
      dmgBonus.full = '+0'
      dmgBonus.half = '+0'
    } else if (value < 33) {
      dmgBonus.dbl = '+2D4'
      dmgBonus.full = '+1D4'
      dmgBonus.half = '+1D2'
    } else if (value < 41) {
      dmgBonus.dbl = '+2D6'
      dmgBonus.full = '+1D6'
      dmgBonus.half = '+1D3'
    } else {
      dmgBonus.dbl = "+" + 2*(Math.ceil((value - 40) / 16) + 1) + "D6"
      dmgBonus.full = "+" + (Math.ceil((value - 40) / 16) + 1) + "D6"
      dmgBonus.half = "+" + (Math.ceil((value - 40) / 16) + 1) + "D3"
    }
    return dmgBonus
  }
}
