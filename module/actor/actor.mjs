import { BRPactorItemDrop } from './actor-itemDrop.mjs'
import { BRPID } from '../brpid/brpid.mjs';
import { Rules } from '../rules/index.mjs';
import {
  applyCocStatus,
  canonicalCocStatusId,
  cocStatusActive,
  cocStatusIds,
} from './coc-status.mjs';

export class BRPActor extends Actor {
  // The host HUD reads `actor.statuses`; native CoC conditions and the wounds
  // audit trail are projected here so a card toggle, a damage write and an
  // ActiveEffect are all visible through the same read surface.
  get statuses() {
    let host = null
    try { host = super.statuses } catch { host = null }
    const statuses = new Set(host ?? [])
    for (const id of cocStatusIds(this)) statuses.add(id)
    return statuses
  }

  // Token HUD entry. CoC statuses go through the single owner writer; every
  // other status keeps the host's own toggle implementation.
  async toggleStatusEffect(statusId, options = {}) {
    const id = canonicalCocStatusId(statusId)
    if (id) {
      const active = options?.active === undefined
        ? !cocStatusActive(this, id)
        : options.active === true
      return applyCocStatus(this, id, active)
    }
    if (typeof super.toggleStatusEffect === 'function') {
      return super.toggleStatusEffect(statusId, options)
    }
    return undefined
  }

  // Explicit card/keeper entry for the same writer (episode chain seams stay
  // injectable for tests and integrations).
  async setCocStatus(statusId, active, options = {}) {
    return applyCocStatus(this, statusId, active, options)
  }

  prepareBaseData() {
    this.system.brpidFlagItems = {}
    for (const item of this.items) {
      const id = item.flags.brp?.brpidFlag?.id
      if (!id) continue
      const parts = id.match(/^([^\.]+)\.([^\.]+)\.([^\.]+)$/)
      if (!parts) continue
      this.system.brpidFlagItems[parts[1]] ??= {}
      this.system.brpidFlagItems[parts[1]][parts[2]] ??= {}
      this.system.brpidFlagItems[parts[1]][parts[2]][parts[3]] = item
    }
  }

  prepareDerivedData() {
    if (this.type !== 'character' && this.type !== 'npc') return
    this._prepCocNativeStats()
    this._prepCocNativeDerived()
    for (const item of this.items) {
      if (item.type !== 'skill') continue
      const system = item.system ?? {}
      const adjustments = system.adjustments ?? {}
      item.system.total = Number(system.base ?? 0)
        + Number(adjustments.base ?? 0) + Number(adjustments.personal ?? 0)
        + Number(adjustments.occupation ?? 0) + Number(adjustments.archetype ?? 0)
        + Number(adjustments.experiencePackage ?? 0) + Number(adjustments.experience ?? 0)
    }
    this._prepSanity()
    this._prepLuck()
  }

  getRollData() {
    return super.getRollData()
  }

  _prepCocNativeStats() {
    for (const [key, stat] of Object.entries(this.system.characteristics ?? {})) {
      stat.total = Number(stat.value) || 0
      stat.label = game.i18n.localize(CONFIG.BRP.stats[key] ?? `BRP.Stats${key}Abbr`) || key
      stat.labelShort = game.i18n.localize(CONFIG.BRP.statsAbbreviations[key] ?? `BRP.Stats${key}Abbr`) || key
      stat.visible = true
    }
  }

  _prepCocNativeDerived() {
    const attribs = this.system.attribs ?? {}
    const secondary = Rules.for('coc').deriveSecondary({ actorData: this, systemData: this.system })
    const applyResource = (resource, max) => {
      if (resource.auto !== true) return
      resource.max = max
      if (resource.value === null || resource.value === undefined || resource.value === '') {
        resource.value = max
      } else {
        resource.value = Math.min(Math.max(Number(resource.value) || 0, 0), max)
      }
    }
    if (attribs.hp) applyResource(attribs.hp, secondary.healthMax)
    if (attribs.mp) applyResource(attribs.mp, secondary.powerMax)
    if (attribs.mov?.auto === true) attribs.mov.value = secondary.mov
    if (attribs.db?.auto === true) attribs.db.value = secondary.dmgBonus.full
    if (attribs.build?.auto === true) attribs.build.value = secondary.build
  }

  _prepSanity() {
    const san = this.system.attribs?.san
    if (!san || san.auto !== true) return
    const model = Rules.for('coc').sanity.prepare({
      pow: Number(this.system.characteristics?.pow?.value) || 0,
      starting: san.value,
      mythosPercent: this._sanityMythosPercent(),
    })
    san.max = model.max
    if (san.value === null || san.value === undefined || san.value === '') {
      san.value = model.starting
    } else {
      san.value = Math.min(Math.max(Number(san.value) || 0, 0), san.max)
    }
    san.dailyLoss = Math.max(Number(san.dailyLoss) || 0, 0)
    san.dailyLimit = Math.max(Number(san.dailyLimit) || 0, 0)
  }

  _sanityMythosPercent() {
    const skill = this.items.find(item => item.type === 'skill' && (
      item.flags.brp?.brpidFlag?.id === 'i.skill.coc.cthulhu-mythos'
      || item.flags.brp?.coc?.key === 'cthulhu-mythos'
      || item.system?.skillName === '克苏鲁神话'
    ))
    return Math.max(0, Math.min(100, Number(skill?.system?.total) || 0))
  }

  async initSanity() {
    if (this.type !== 'character' && this.type !== 'npc') return false
    if (this._sanitySnapshotted()) return false
    const pow = Number(this.system.characteristics?.pow?.value) || 0
    if (!(pow > 0)) return false
    const initial = Rules.for('coc').sanity.initial({ pow, mythosPercent: this._sanityMythosPercent() })
    await this.update({
      'system.attribs.san.dailyLoss': 0,
      'system.attribs.san.max': initial.max,
      'system.attribs.san.value': initial.value,
    })
    return true
  }

  _sanitySnapshotted() {
    try {
      const raw = this.toObject(false)?.system?.attribs?.san ?? {}
      return raw.value !== null && raw.value !== undefined && raw.value !== '' && Number.isFinite(Number(raw.value))
    } catch {
      return false
    }
  }

  _prepLuck() {
    const luck = this.system.attribs?.lck
    if (!luck || luck.value === null || luck.value === undefined || luck.value === '') return
    luck.value = Math.min(Math.max(Math.floor(Number(luck.value) || 0), 0), Rules.for('coc').luck.cap({}))
  }

  async initLuck() {
    if (this.type !== 'character' && this.type !== 'npc') return false
    if (this._luckSnapshotted()) return false
    const initial = Rules.for('coc').luck.initial({})
    const roll = new Roll(initial.formula)
    await roll.evaluate()
    const value = Math.floor(roll.total)
    if (!(value > 0)) return false
    await this.update({ 'system.attribs.lck.value': value })
    return true
  }

  _luckSnapshotted() {
    try {
      const raw = this.toObject(false)?.system?.attribs?.lck ?? {}
      return raw.value !== null && raw.value !== undefined && raw.value !== '' && Number.isFinite(Number(raw.value))
    } catch {
      return false
    }
  }

  get hasRollableCharacteristics() {
    return Object.values(this.system.characteristics ?? {})
      .some(characteristic => String(characteristic.formula ?? '').trim() !== '')
  }

  async rollCharacteristicsValue() {
    const changes = {}
    for (const [key, characteristic] of Object.entries(this.system.characteristics ?? {})) {
      const formula = String(characteristic.formula ?? '').trim()
      if (!formula) continue
      const roll = new Roll(formula)
      await roll.evaluate()
      changes[`system.characteristics.${key}.value`] = Math.floor(roll.total)
    }
    if (Object.keys(changes).length) await this.update(changes)
    await this.initSanity()
    await this.initLuck()
    await this.updateVitals()
  }

  async updateVitals() {
    const attribs = this.system.attribs ?? {}
    const changes = {}
    if (attribs.hp?.auto === true) changes['system.attribs.hp.value'] = attribs.hp.max
    if (attribs.mp?.auto === true) changes['system.attribs.mp.value'] = attribs.mp.max
    if (Object.keys(changes).length) await this.update(changes)
  }

  static async create(data, options = {}) {
    if (options.fromCompendium) {
      const tempActor = game.actors.find(actor =>
        actor.flags?.brp?.brpidFlag?.id === data.flags?.brp?.brpidFlag?.id
        && actor.flags?.brp?.brpidFlag?.priority === data.flags?.brp?.brpidFlag?.priority)
      if (tempActor) return tempActor
    }

    const isNew = !options.fromCompendium && !data._id
    if (isNew && data.type === 'character') {
      data.prototypeToken = foundry.utils.mergeObject({
        actorLink: true,
        lockRotation: true,
        disposition: 1,
        displayName: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
        displayBars: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
        bar1: { attribute: 'attribs.hp' },
        bar2: { attribute: 'attribs.san' },
        sight: { enabled: true, range: 30, visionMode: 'basic' },
      }, data.prototypeToken || {})
    } else if (isNew && data.type === 'npc') {
      data.prototypeToken = foundry.utils.mergeObject({
        lockRotation: true,
        bar1: { attribute: 'attribs.hp' },
        bar2: { attribute: 'attribs.san' },
        sight: { enabled: true, range: 30, visionMode: 'basic' },
      }, data.prototypeToken || {})
    }

    const actor = await super.create(data, options)
    if (!isNew) return actor

    await actor.initSanity()
    await actor.initLuck()

    if (game.settings.get('brp', 'actorBRPID')) {
      const tempID = await BRPID.guessId(actor)
      if (tempID) {
        await actor.update({ 'flags.brp.brpidFlag.id': tempID })
        const html = $(actor.sheet.element).find('header.window-header a.header-button.edit-brpid-warning,header.window-header a.header-button.edit-brpid-exisiting')
        if (html.length) html.css({ color: 'orange' })
        actor.render()
      }
    }

    if (actor.type !== 'character') return actor
    const rules = Rules.for('coc')
    if (game.settings.get('brp', 'starterSkills')) {
      const newSkills = []
      const skillList = (await game.system.api.brpid.fromBRPIDRegexBest({ brpidRegExp: /^i\.skill/, type: 'i' }))
        .filter(item => item.system.basic && Rules.contentSourceOf(item) === rules.starter.source)
      for (const item of skillList) {
        if (actor.items.some(existing => existing.flags.brp?.brpidFlag?.id === item.flags.brp?.brpidFlag?.id)) continue
        item.system.base = String(await BRPactorItemDrop._calcBase(item, actor))
        newSkills.push(item)
      }
      if (newSkills.length) await Item.createDocuments(newSkills, { parent: actor })
    }

    const brawlBrpid = rules.starter.brawlBrpid
    let brawlSkill = actor.items.find(item => item.flags?.brp?.brpidFlag?.id === brawlBrpid)
    if (!brawlSkill) {
      const brawlDoc = (await game.system.api.brpid.fromBRPIDBest({ brpid: brawlBrpid }))[0]
      if (brawlDoc) {
        brawlDoc.system.base = String(await BRPactorItemDrop._calcBase(brawlDoc, actor))
        brawlSkill = (await Item.createDocuments([brawlDoc], { parent: actor }))[0]
      }
    }
    if (!brawlSkill) {
      const message = `BRP: brawl skill ${brawlBrpid} not found; unarmed weapon not created for ${actor.name}`
      console.warn(message)
      globalThis.ui?.notifications?.warn?.(message)
    } else if (!actor.items.some(item => item.flags?.brp?.unarmed === true)) {
      const unarmed = rules.starter.unarmed
      await Item.createDocuments([{
        name: unarmed.name,
        type: 'weapon',
        img: 'systems/brp/assets/Icons/deadly-strike.svg',
        flags: { brp: { unarmed: true } },
        system: {
          description: { value: '', special: '', keeper: '' },
          skill: {
            main: { name: brawlSkill.name, id: brawlSkill.id },
            alternativ: { name: '', id: '' },
          },
          range: {
            normal: { value: '', damage: unarmed.damage },
            long: { value: '', damage: '' },
            extreme: { value: '', damage: '' },
          },
          properties: {
            rngd: false, ahdb: false, slnt: false, stun: false, mnvr: false,
            thrown: false, shotgun: false, dbrl: false, impl: false, brst: false,
            auto: false, addb: true, spcl: false, mont: false, blst: false,
            rare: false, burn: false,
          },
          usesPerRound: { normal: '1', max: null, burst: null },
          bullets: null,
          ammo: 0,
          malfunction: null,
          blastRadius: null,
          price: {},
        },
      }], { parent: actor })
    }
    return actor
  }

  static async charBaseSkillScores(actor) {
    const changes = []
    for (const item of actor.items) {
      if (item.type !== 'skill') continue
      changes.push({ _id: item._id, 'system.base': String(await BRPactorItemDrop._calcBase(item, actor)) })
    }
    if (changes.length) await Item.updateDocuments(changes, { parent: actor })
  }
}
