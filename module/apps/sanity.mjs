import { BRPactorDetails } from './actorDetails.mjs'
import { BRPMadness } from './madness.mjs'
import { BRPWorldTime } from './worldTime.mjs'
import { Rules } from '../rules/index.mjs'

// CoC sanity settlement (M4).
//
// One writer, one read-modify-write chain, real dice. The pure decision core is
// module/rules/coc-sanity.mjs; this module only
//   1. routes every settlement (including an owner's own roll) to the active GM,
//   2. serializes the actor read-modify-write on that single client,
//   3. rolls the follow-up INT check and the 1D10h/1D10 bout/1D10 round dice as
//      real Rolls on that same client,
//   4. writes system.sanity.* + the ActiveEffect statuses, and
//   5. records the result on the chat card (flags + re-render).
//
// States are independent: temporary, indefinite and permanent can coexist as
// data; permanent is terminal and nothing here ever clears it implicitly.
// A temporary episode never stands in for an indefinite one.
//
// `system.sanity.insanity` is the persisted authority for what is active;
// the ActiveEffects (`tempInsane` / `indefiniteInsane` / `permaInsane`) are the
// visible status that the sheet, the card and the delete/disable hooks read.
// Both are written together, so a refresh cannot lose or resurrect a state.

const NS = 'brp'
const TEXT = {
  tempInsane: 'tempInsane',
  indefinite: 'indefiniteInsane',
  permanent: 'permaInsane',
}

const int = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback
}

const emptyInsanity = () => ({
  temporary: null,
  indefinite: null,
  permanent: false,
  lastUpdatedAt: null,
})

const normalizeInsanity = (raw) => {
  const base = emptyInsanity()
  if (!raw || typeof raw !== 'object') { return base }
  const temporary = raw.temporary && typeof raw.temporary === 'object' ? { ...raw.temporary } : null
  const indefinite = raw.indefinite && typeof raw.indefinite === 'object' ? { ...raw.indefinite } : null
  return {
    temporary,
    indefinite,
    permanent: raw.permanent === true,
    lastUpdatedAt: raw.lastUpdatedAt ?? null,
  }
}

const DAY_START_SOURCES = Object.freeze({
  keeper: 'keeper-new-day',
  'first-loss': 'first-loss-of-day',
  migrated: 'migrated-day-start',
})

export class BRPSanity {

  static get STATUS() { return TEXT }

  static get daySeconds() { return BRPWorldTime.secondsPerDay }

  // --- read helpers (never write) ---

  static isCoC() {
    try { return Rules.activeId() === 'coc' } catch { return false }
  }

  static core() {
    return Rules.active().sanity?.core ?? null
  }

  static writer() {
    try {
      const active = game.users?.activeGM
      if (active) { return active }
      return game.user?.isGM ? game.user : null
    } catch {
      return null
    }
  }

  static isWriter() {
    const writer = this.writer()
    return !!writer && game.user?.id === writer.id
  }

  static actorTypeOf(actor) {
    return actor?.token ? 'token' : 'actor'
  }

  static async resolveActor(ref = {}) {
    if (ref.actor) { return ref.actor }
    if (!ref.actorId) { return null }
    return BRPactorDetails._getParticipant(ref.actorId, ref.actorType ?? 'actor')
  }

  static insanityOf(actor) {
    return normalizeInsanity(actor?.system?.sanity?.insanity)
  }

  static hasStatus(actor, id) {
    if (!actor?.effects) { return false }
    for (const effect of actor.effects) {
      if (effect?.statuses?.has?.(id) === true) { return true }
    }
    return false
  }

  static effectOf(actor, id) {
    if (!actor?.effects) { return null }
    for (const effect of actor.effects) {
      if (effect?.statuses?.has?.(id) === true) { return effect }
    }
    return null
  }

  // Public read surface for a card/adapter: current SAN, the day window and the
  // three independent insanity states. No writes, no dice.
  static state(actor) {
    const san = actor?.system?.sanity ?? {}
    const insanity = this.insanityOf(actor)
    const dayId = san.dayId ?? null
    const rawDayStart = san.dayStartSan
    const dayStartSan = rawDayStart === null || rawDayStart === undefined || rawDayStart === ''
      ? null
      : Number(rawDayStart)
    const core = this.core()
    const daily = core && dayStartSan !== null
      ? core.dailyInsanity({
        dailyLoss: int(san.dailyLoss, 0),
        basis: 'day-start',
        dayStartSan,
        dayId: dayId ?? undefined,
      })
      : null
    return {
      value: int(san.value, 0),
      max: int(san.max, 0),
      starting: int(san.starting, 0),
      singleLoss: int(san.singleLoss, 0),
      dailyLoss: int(san.dailyLoss, 0),
      dayId,
      dayStartSan,
      dayStartSource: san.dayStartSource ?? null,
      dailyThreshold: daily?.threshold ?? null,
      dailyReached: daily?.active === true,
      insanity,
      temporary: insanity.temporary,
      indefinite: insanity.indefinite,
      permanent: insanity.permanent === true,
      statuses: {
        temporary: this.hasStatus(actor, TEXT.tempInsane),
        indefinite: this.hasStatus(actor, TEXT.indefinite),
        permanent: this.hasStatus(actor, TEXT.permanent),
      },
      // The world clock the CoC durations are measured against (hours since epoch).
      worldTime: BRPWorldTime.now(),
    }
  }

  // --- the single writer chain ---

  static _chain = Promise.resolve()

  static _serialize(fn) {
    const run = this._chain.then(fn, fn)
    this._chain = run.then(() => {}, () => {})
    return run
  }

  // --- day window ---

  // The game day is a keeper snapshot, not a calendar lookup: `dayId` names the
  // day and `dayStartSan` is the current SAN when that day started. When nobody
  // declared the day yet, the first loss of the day becomes the snapshot and the
  // record says so (`dayStartSource`), because the threshold is a ratio of it.
  static dayWindow(actor, { keeperDayId = null } = {}) {
    const san = actor?.system?.sanity ?? {}
    const now = BRPWorldTime.now()
    const todayId = BRPWorldTime.dayId(now)
    let dayId = san.dayId ?? null
    const rawDayStart = san.dayStartSan
    let dayStartSan = rawDayStart === null || rawDayStart === undefined || rawDayStart === ''
      ? null
      : Number(rawDayStart)
    let source = san.dayStartSource ?? null
    let dailyLoss = int(san.dailyLoss, 0)
    let rolled = false

    const sameDay = (id) => {
      if (!id) { return false }
      // `day-<index>.<seq>`: the index is the calendar day of the world clock.
      const index = String(id).split('.')[0]
      return index === String(todayId).split('.')[0]
    }

    if (!dayId) {
      dayId = keeperDayId ?? todayId
      dayStartSan = int(san.value, 0)
      dailyLoss = 0
      source = keeperDayId ? DAY_START_SOURCES.keeper : DAY_START_SOURCES['first-loss']
      rolled = true
    } else if (keeperDayId && dayId !== keeperDayId) {
      // A keeper-declared day rebases the one-fifth line on the SAN the
      // investigator has at that moment; carrying the old day-start value
      // would silently move the threshold.
      dayId = keeperDayId
      dayStartSan = int(san.value, 0)
      source = DAY_START_SOURCES.keeper
      rolled = true
      dailyLoss = 0
    } else if (!sameDay(dayId) && now > 0) {
      // A real clock crossed midnight without an explicit keeper day: start a
      // new window at the current SAN (recorded, so the basis is auditable).
      dayId = todayId
      dayStartSan = int(san.value, 0)
      dailyLoss = 0
      source = DAY_START_SOURCES['first-loss']
      rolled = true
    }

    if (dayStartSan === null) {
      dayStartSan = int(san.value, 0)
      source = source ?? DAY_START_SOURCES.migrated
      rolled = true
    }
    if (rolled) { dailyLoss = 0 }
    return { dayId, dayStartSan, dailyLoss, dayStartSource: source, rolled }
  }

  // --- settlement entry points ---

  // Every client calls this. Non-writers relay to the active GM and return
  // `{queued:true}`; the GM performs the read-modify-write inside one chain.
  static async settle(options = {}) {
    if (!this.isCoC()) { return { error: 'ruleset-not-coc' } }
    const writer = this.writer()
    if (!writer) { return { error: 'no-active-gm' } }
    if (game.user?.id === writer.id) {
      return this.settleNow(options)
    }
    const payload = {
      actorId: options.actor?.id ?? options.actorId,
      actorType: options.actor ? this.actorTypeOf(options.actor) : options.actorType,
      loss: int(options.loss, 0),
      cardMessageId: options.cardMessageId ?? null,
      // A player never declares the game day; only a keeper action does.
      dayId: null,
      reason: options.reason ?? 'sanity-roll',
      origin: game.user?.id ?? null,
    }
    game.socket.emit('system.brp', { type: 'cocSanSettle', to: writer.id, value: payload })
    return { queued: true, by: writer.id, loss: payload.loss }
  }

  // Writer-only settlement. Every entry point funnels through this serialized
  // wrapper - the local settle(), the socket relay and a keeper macro - so two
  // clients (or two clicks) can never apply a loss against the same stale SAN.
  // The inner body reads, rolls and writes; the chain serializes the whole
  // read-modify-write, not just the final update.
  static async settleNow(options = {}) {
    if (!this.isCoC()) { return { error: 'ruleset-not-coc' } }
    if (!this.isWriter()) { return { error: 'not-active-gm' } }
    return this._serialize(() => this._settleNow(options))
  }

  static async _settleNow(options = {}) {
    if (!this.isCoC()) { return { error: 'ruleset-not-coc' } }
    if (!this.isWriter()) { return { error: 'not-active-gm' } }
    const actor = await this.resolveActor(options)
    if (!actor) { return { error: 'actor-missing' } }
    let keeperDayId = options.dayId ?? null
    if (options.origin) {
      // A relayed request must come from the actor's owner or a GM. A player
      // cannot settle sanity for somebody else's investigator, nor declare a
      // new game day (that would reset the one-fifth window).
      const originUser = game.users?.get?.(options.origin) ?? null
      if (!originUser) { return { error: 'origin-missing' } }
      if (originUser.isGM !== true) {
        keeperDayId = null
        const owns = actor.testUserPermission
          ? actor.testUserPermission(originUser, 'OWNER')
          : actor.isOwner === true
        if (!owns) { return { error: 'not-authorised' } }
      }
    }
    const core = this.core()
    if (!core) { return { error: 'no-sanity-core' } }
    const san = actor.system?.sanity ?? {}
    if (san.permanent === true || this.hasStatus(actor, TEXT.permanent)) {
      // Terminal state: record the request, never open a new episode.
      return { applied: false, reason: 'permanent-insanity', state: this.state(actor) }
    }

    const rolled = Math.max(0, int(options.loss, 0))
    const sanBefore = Math.max(0, int(san.value, 0))
    const window = this.dayWindow(actor, { keeperDayId })

    const decision = core.settleSanLoss({
      loss: rolled,
      sanBefore,
      dailyLossBefore: window.dailyLoss,
      dayId: window.dayId,
      dayStartSan: window.dayStartSan,
      dailyBasis: 'day-start',
      startingSan: int(san.starting, 0),
      currentSan: sanBefore,
    })

    // The INT check and the episode dice are real rolls on the writer.
    let intCheck = null
    let episode = null
    if (decision.intCheck?.required === true && decision.intCheck.status === 'pending') {
      intCheck = await this._rollIntCheck(actor)
      episode = core.temporaryInsanity({
        loss: decision.loss.applied,
        intCheck: { roll: intCheck.rollVal, target: intCheck.target },
        hoursDie: await this._rollDie(10),
        boutDie: await this._rollDie(10),
        roundsDie: await this._rollDie(10),
        dayId: window.dayId,
      })
    }

    // Apply the SAN numbers first: everything below reports the resulting state.
    const writes = {
      'system.sanity.value': decision.san.after,
      'system.sanity.dailyLoss': decision.dailyLoss.after,
      'system.sanity.singleLoss': decision.loss.applied,
      'system.sanity.dayId': window.dayId,
      'system.sanity.dayStartSan': window.dayStartSan,
      'system.sanity.dayStartSource': window.dayStartSource,
      'system.sanity.lastLossAt': BRPWorldTime.now(),
    }
    const insanity = this.insanityOf(actor)
    const permanent = decision.permanentInsanity === true || insanity.permanent === true
    // Starting a fresh episode replaces the old one in the persisted state; the
    // old chat card must not keep offering buttons for an episode that is over.
    if (episode?.status === 'active' && insanity.temporary?.active === true) {
      await BRPMadness.endOpenCards(actor.id)
    }
    const temporary = episode?.status === 'active'
      ? {
        active: true,
        since: BRPWorldTime.now(),
        hours: episode.hours.value,
        expiresAt: BRPWorldTime.now() + episode.hours.value * 3600,
        bout: { index: episode.bout.index, id: episode.bout.id, label: episode.bout.zh },
        rounds: { value: episode.rounds.value, die: '1D10' },
        intCheck: { roll: intCheck.rollVal, target: intCheck.target, status: 'passed' },
        dayId: window.dayId,
        endedAt: null,
      }
      : insanity.temporary
    const indefinite = permanent
      // Permanent is terminal: the core only reports the one-fifth material for
      // the record. Do not open a *new* indefinite state at the moment of
      // zeroing SAN; an indefinite state that already existed keeps coexisting.
      ? insanity.indefinite
      : (decision.indefiniteInsanity?.active === true
        ? {
          active: true,
          since: insanity.indefinite?.since ?? BRPWorldTime.now(),
          threshold: decision.indefiniteInsanity.threshold,
          basis: 'day-start',
          basisValue: decision.indefiniteInsanity.basisValue,
          dayId: window.dayId,
          // Recovery quantities are not verified: keeper review only.
          recovery: 'keeper-review',
          recoveredAt: null,
        }
        : insanity.indefinite)

    writes['system.sanity.insanity'] = {
      temporary: temporary ?? null,
      indefinite: indefinite ?? null,
      permanent,
      lastUpdatedAt: BRPWorldTime.now(),
    }
    await actor.update(writes)

    // Effects: temporary replaces only a temporary episode; indefinite and
    // permanent are separate statuses and are never removed here.
    let tempEffect = null
    if (temporary?.active === true && episode?.status === 'active') {
      tempEffect = await this._applyTemporaryEffect(actor, episode, intCheck)
    } else if (intCheck && intCheck.passed === false) {
      // A failed INT roll means no episode; an expired one is not resurrected.
      tempEffect = null
    }
    let indefiniteEffect = null
    if (indefinite?.active === true) {
      indefiniteEffect = await this._ensureIndefiniteEffect(actor, indefinite)
    }
    if (permanent && !this.hasStatus(actor, TEXT.permanent)) {
      await BRPMadness.applyPermaInsane(actor)
    }

    const record = {
      actorId: actor.id,
      actorType: this.actorTypeOf(actor),
      at: BRPWorldTime.now(),
      loss: decision.loss.applied,
      lossRolled: decision.loss.rolled,
      sanBefore,
      sanAfter: decision.san.after,
      dailyLoss: decision.dailyLoss.after,
      dayId: window.dayId,
      dayStartSan: window.dayStartSan,
      dayStartSource: window.dayStartSource,
      singleLoss: decision.loss.applied,
      intCheck: intCheck
        ? { roll: intCheck.rollVal, target: intCheck.target, passed: intCheck.passed }
        : null,
      temporary: temporary ?? null,
      indefinite: indefinite ?? null,
      permanent,
      // The core reports what a caller would still need to roll; this writer
      // rolled the INT check and the episode dice before writing, so nothing
      // stays pending. Kept separately for audit/tests.
      pending: Object.freeze([]),
      corePending: decision.pending,
      reason: options.reason ?? 'sanity-roll',
      by: game.user?.id ?? null,
      requestedBy: options.origin ?? game.user?.id ?? null,
    }
    await this._log(actor, record)

    // Card: the SAN numbers, the INT result and the episode. One write for
    // flags and content so the card is never read half-settled.
    if (options.cardMessageId) {
      await this._writeCard(options.cardMessageId, record, { intCheck, episode, actor })
    }
    return {
      applied: true,
      ...record,
      state: this.state(actor),
      effects: {
        temporary: tempEffect?.id ?? null,
        indefinite: indefiniteEffect?.id ?? null,
      },
    }
  }

  static async _rollDie(faces) {
    const roll = new Roll(`1D${faces}`)
    await roll.evaluate()
    return Math.max(1, Math.min(faces, int(roll.total, 1)))
  }

  // INT is a characteristic test: the target is the INT value itself.
  static async _rollIntCheck(actor) {
    const target = Math.max(0, int(Rules.active().check.characteristicTarget(actor.system?.stats?.int?.total ?? 0), 0))
    const roll = new Roll('1D100')
    await roll.evaluate()
    const rollVal = Math.max(1, Math.min(100, int(roll.total, 100)))
    return { roll, rollVal, target, passed: rollVal <= target }
  }

  // A caller that already rolled INT (a frontend adapter) can still hand the
  // result in; an unresolved INT never produces temporary insanity.
  static async completeIntCheck(options = {}) {
    if (!this.isCoC()) { return { error: 'ruleset-not-coc' } }
    if (!this.isWriter()) { return { error: 'not-active-gm' } }
    const rollVal = int(options.roll ?? options.rollVal, 0)
    if (!(rollVal >= 1 && rollVal <= 100)) { return { error: 'invalid-roll' } }
    return this._serialize(async () => {
      const actor = await this.resolveActor(options)
      if (!actor) { return { error: 'actor-missing' } }
      const insanity = this.insanityOf(actor)
      if (insanity.permanent === true) { return { applied: false, reason: 'permanent-insanity' } }
      const target = Math.max(0, int(Rules.active().check.characteristicTarget(actor.system?.stats?.int?.total ?? 0), 0))
      const passed = rollVal <= target
      const record = { intCheck: { roll: rollVal, target, passed }, at: BRPWorldTime.now() }
      if (passed) {
        const loss = Math.max(0, int(actor.system.sanity.singleLoss, 0))
        if (Rules.active().sanity.core.singleLossTrigger({ loss }).trigger !== true) {
          return { applied: false, reason: 'loss-below-threshold', ...record }
        }
        const episode = Rules.active().sanity.core.temporaryInsanity({
          loss,
          intCheck: { roll: rollVal, target },
          hoursDie: await this._rollDie(10),
          boutDie: await this._rollDie(10),
          roundsDie: await this._rollDie(10),
          dayId: actor.system.sanity.dayId,
        })
        // No unresolved single-loss episode: a successful INT roll on its own
        // must not open one (the loss that called for the check already
        // settled, or was below the threshold).
        if (episode.status !== 'active') {
          return { applied: false, reason: episode.status, ...record }
        }
        const temporary = {
          active: true,
          since: BRPWorldTime.now(),
          hours: episode.hours.value,
          expiresAt: BRPWorldTime.now() + episode.hours.value * 3600,
          bout: { index: episode.bout.index, id: episode.bout.id, label: episode.bout.zh },
          rounds: { value: episode.rounds.value, die: '1D10' },
          intCheck: { roll: rollVal, target, status: 'passed' },
          dayId: actor.system.sanity.dayId ?? null,
          endedAt: null,
        }
        await actor.update({
          'system.sanity.insanity': {
            temporary,
            indefinite: insanity.indefinite,
            permanent: false,
            lastUpdatedAt: BRPWorldTime.now(),
          },
        })
        await this._applyTemporaryEffect(actor, episode, { rollVal, target, passed })
        return { applied: true, ...record, temporary }
      }
      await this._applyEpisodeCardState(actor, { intCheck: { roll: rollVal, target, passed }, temporary: insanity.temporary })
      return { applied: true, ...record, temporary: insanity.temporary ?? null }
    })
  }

  static async _applyTemporaryEffect(actor, episode, intCheck) {
    const existing = this.effectOf(actor, TEXT.tempInsane)
    const hours = Math.max(1, int(episode.hours?.value, 1))
    const effectData = BRPMadness.cocEffectData({
      actor,
      episode,
      intCheck,
      seconds: hours * 3600,
      startTime: BRPWorldTime.now(),
    })
    // Replace in place. Deleting the old effect would fire deleteActiveEffect
    // and close the episode that was just written, and it would also lose the
    // effect id the card/UI may already hold.
    if (existing) {
      await existing.update({ ...effectData, disabled: false })
      return existing
    }
    const [effect] = await ActiveEffect.createDocuments([effectData], { parent: actor })
    return effect
  }

  static async _ensureIndefiniteEffect(actor, indefinite) {
    const existing = this.effectOf(actor, TEXT.indefinite)
    if (existing) { return existing }
    const [effect] = await ActiveEffect.createDocuments([{
      name: game.i18n.localize('BRP.madness.indefiniteInsane'),
      icon: 'systems/brp/assets/Icons/inner-self.svg',
      statuses: [TEXT.indefinite],
      description: game.i18n.localize('BRP.madness.indefiniteInsaneDesc'),
      flags: { brp: { coc: { insanity: { kind: 'indefinite', ...indefinite } } } },
      disabled: false,
    }], { parent: actor })
    return effect
  }

  static async _applyEpisodeCardState(actor, extra) {
    return extra
  }

  // --- ending episodes (explicit keeper / effect lifecycle) ---

  static async endTemporary(options = {}) {
    if (!this.isCoC()) { return { error: 'ruleset-not-coc' } }
    if (!this.isWriter()) { return { error: 'not-active-gm' } }
    return this._serialize(async () => {
      const actor = await this.resolveActor(options)
      if (!actor) { return { error: 'actor-missing' } }
      const reason = options.reason ?? 'keeper-ended'
      const insanity = this.insanityOf(actor)
      if (!insanity.temporary) {
        const effect = this.effectOf(actor, TEXT.tempInsane)
        if (effect) { await effect.delete() }
        return { ended: false, reason: 'no-temporary-episode' }
      }
      // The pure core owns the retention rule: delusions end, phobia/mania and
      // the indefinite/permanent states are untouched.
      const end = this.core().endTemporaryInsanity({ reason, dayId: insanity.temporary.dayId ?? undefined })
      const temporary = { ...insanity.temporary, active: false, endedAt: BRPWorldTime.now(), endReason: reason }
      await actor.update({
        'system.sanity.insanity': {
          temporary,
          indefinite: insanity.indefinite,
          permanent: insanity.permanent,
          lastUpdatedAt: BRPWorldTime.now(),
        },
      })
      const effect = this.effectOf(actor, TEXT.tempInsane)
      if (effect) { await effect.delete() }
      // Deleting the effect normally ends the card via the hook, but an
      // episode whose effect was already removed still has an open card.
      await BRPMadness.endOpenCards(actor.id)
      await this._log(actor, { at: BRPWorldTime.now(), event: 'end-temporary', reason, retained: end.retained })
      return { ended: true, reason, retained: end.retained, cleared: end.cleared, state: this.state(actor) }
    })
  }

  // Indefinite recovery has no verified numbers: the keeper ends it explicitly.
  static async endIndefinite(options = {}) {
    if (!this.isCoC()) { return { error: 'ruleset-not-coc' } }
    if (!this.isWriter()) { return { error: 'not-active-gm' } }
    const reason = String(options.reason ?? '').trim()
    if (!reason) { return { error: 'reason-required' } }
    return this._serialize(async () => {
      const actor = await this.resolveActor(options)
      if (!actor) { return { error: 'actor-missing' } }
      const insanity = this.insanityOf(actor)
      if (!insanity.indefinite) { return { ended: false, reason: 'no-indefinite-insanity' } }
      const indefinite = { ...insanity.indefinite, active: false, recoveredAt: BRPWorldTime.now(), recoveredBy: reason }
      await actor.update({
        'system.sanity.insanity': {
          temporary: insanity.temporary,
          indefinite,
          permanent: insanity.permanent,
          lastUpdatedAt: BRPWorldTime.now(),
        },
      })
      const effect = this.effectOf(actor, TEXT.indefinite)
      if (effect) { await effect.delete() }
      await this._log(actor, { at: BRPWorldTime.now(), event: 'end-indefinite', reason })
      return { ended: true, reason, state: this.state(actor) }
    })
  }

  // Permanent insanity is terminal. Only an explicit keeper decision clears it,
  // and the reason is recorded - a page refresh never does.
  static async clearPermanent(options = {}) {
    if (!this.isCoC()) { return { error: 'ruleset-not-coc' } }
    if (!this.isWriter()) { return { error: 'not-active-gm' } }
    const reason = String(options.reason ?? '').trim()
    if (!reason) { return { error: 'reason-required' } }
    return this._serialize(async () => {
      const actor = await this.resolveActor(options)
      if (!actor) { return { error: 'actor-missing' } }
      const insanity = this.insanityOf(actor)
      if (!insanity.permanent) { return { ended: false, reason: 'not-permanent' } }
      await actor.update({
        'system.sanity.insanity': {
          temporary: insanity.temporary,
          indefinite: insanity.indefinite,
          permanent: false,
          lastUpdatedAt: BRPWorldTime.now(),
        },
      })
      const effect = this.effectOf(actor, TEXT.permanent)
      if (effect) { await effect.delete() }
      await this._log(actor, { at: BRPWorldTime.now(), event: 'clear-permanent', reason })
      return { cleared: true, reason, state: this.state(actor) }
    })
  }

  // --- keeper clock / day ---

  // "New game day": the daily tally restarts and the threshold is re-based on
  // the SAN the investigator has *now*. Episodes are untouched.
  static async newDay(options = {}) {
    if (!this.isCoC()) { return { error: 'ruleset-not-coc' } }
    if (!this.isWriter()) { return { error: 'not-active-gm' } }
    return this._serialize(async () => {
      const actor = await this.resolveActor(options)
      if (!actor) { return { error: 'actor-missing' } }
      const day = await BRPWorldTime.newDayId()
      if (day.error) { return day }
      const san = Math.max(0, int(actor.system?.sanity?.value, 0))
      await actor.update({
        'system.sanity.dailyLoss': 0,
        'system.sanity.dayId': day.dayId,
        'system.sanity.dayStartSan': san,
        'system.sanity.dayStartSource': DAY_START_SOURCES.keeper,
      })
      await this._log(actor, { at: BRPWorldTime.now(), event: 'new-day', dayId: day.dayId, dayStartSan: san })
      return { started: true, dayId: day.dayId, dayStartSan: san, worldTime: day.worldTime }
    })
  }

  // Keeper advances the world clock; episodes whose 1D10 hours have elapsed end
  // because the *clock* moved, never because a page reloaded.
  static async advanceTime(options = {}) {
    if (!this.isCoC()) { return { error: 'ruleset-not-coc' } }
    if (!this.isWriter()) { return { error: 'not-active-gm' } }
    const moved = await BRPWorldTime.advance(options)
    if (moved.error) { return moved }
    const expired = await this.expireDueEpisodes()
    return { ...moved, expired }
  }

  // Sweep temp episodes whose stored expiry the world clock has passed. Runs on
  // the writer only; a missing clock (worldTime 0) never expires anything.
  static async expireDueEpisodes() {
    if (!this.isCoC() || !this.isWriter()) { return [] }
    const now = BRPWorldTime.now()
    if (!(now > 0)) { return [] }
    const ended = []
    const actors = new Set([...(game.actors ?? [])])
    const tokenActors = game.actors?.tokens
    if (tokenActors) {
      const list = typeof tokenActors.values === 'function' ? [...tokenActors.values()] : Object.values(tokenActors)
      for (const tokenActor of list) { if (tokenActor?.effects) { actors.add(tokenActor) } }
    }
    for (const actor of actors) {
      if (!actor?.effects) { continue }
      const insanity = this.insanityOf(actor)
      const temporary = insanity.temporary
      if (!temporary?.active) { continue }
      const expiresAt = Number(temporary.expiresAt)
      if (!Number.isFinite(expiresAt)) { continue }
      if (now < expiresAt) { continue }
      const result = await this.endTemporary({ actor, reason: 'hours-elapsed-keeper-confirmed' })
      if (result?.ended) { ended.push({ actorId: actor.id, reason: result.reason }) }
      await BRPMadness.endOpenCards(actor.id)
    }
    return ended
  }

  // --- Luck recovery (keeper opens a new session) ---

  // Real 1D100 against the current Luck; success adds 2D10+10, failure 1D10+5,
  // capped at 99. Never runs on a page load - only on the keeper's explicit
  // "new session" action, and only on the single writer.
  static async luckRecovery(options = {}) {
    if (!this.isCoC()) { return { error: 'ruleset-not-coc' } }
    if (!this.isWriter()) { return { error: 'not-active-gm' } }
    return this._serialize(async () => {
      const actor = await this.resolveActor(options)
      if (!actor?.system?.luck) { return { error: 'actor-missing' } }
      const before = Math.max(0, int(actor.system.luck.value, 0))
      const roll = new Roll('1D100')
      await roll.evaluate()
      const rollVal = Math.max(1, Math.min(100, int(roll.total, 100)))
      const dice = []
      const count = rollVal > before ? 2 : 1
      for (let i = 0; i < count; i++) { dice.push(await this._rollDie(10)) }
      const decision = this.core().luckRecovery({ roll: rollVal, currentLuck: before, d10: dice })
      const session = Math.max(0, int((() => {
        try { return game.settings.get('brp', 'cocSessionSeq') } catch { return 0 }
      })(), 0)) + 1
      try { await game.settings.set('brp', 'cocSessionSeq', session) } catch { /* audit only */ }
      await actor.update({ 'system.luck.value': decision.luck.after })
      await this._log(actor, {
        at: BRPWorldTime.now(),
        event: 'luck-recovery',
        session,
        roll: rollVal,
        dice,
        formula: decision.formula,
        before: decision.luck.before,
        after: decision.luck.after,
        capped: decision.luck.capped,
      })
      return {
        applied: true,
        session,
        roll: rollVal,
        dice,
        formula: decision.formula,
        luck: decision.luck,
        evidence: decision.evidence,
        state: { luck: decision.luck, insanity: this.insanityOf(actor) },
      }
    })
  }

  // --- persistence helpers ---

  static async _log(actor, record) {
    try {
      const log = Array.isArray(actor.flags?.brp?.coc?.sanityLog) ? [...actor.flags.brp.coc.sanityLog] : []
      log.push(record)
      while (log.length > 20) { log.shift() }
      await actor.update({ 'flags.brp.coc.sanityLog': log })
    } catch { /* audit log is best effort; the state writes above are the truth */ }
  }

  // Card update: flags (numbers + episode) and content in one write. Called only
  // by the writer, so the card is re-rendered exactly once per settlement.
  static async _writeCard(messageId, record, { intCheck, episode, actor }) {
    const message = await game.messages.get(messageId)
    if (!message?.flags?.brp) { return null }
    const card = foundry.utils.deepClone(message.flags.brp)
    const entry = card.chatCard?.[0]
    if (entry) {
      entry.sanLoss = record.loss
      entry.sanAfter = record.sanAfter
      entry.sanLossFormulaUsed = entry.sanLossFormulaUsed ?? ''
      entry.permaInsane = record.permanent === true
      entry.sanity = {
        value: record.sanAfter,
        singleLoss: record.singleLoss,
        dailyLoss: record.dailyLoss,
        dayId: record.dayId,
        dayStartSan: record.dayStartSan,
        threshold: record.indefinite?.threshold ?? null,
        intCheck: record.intCheck,
        temporary: record.temporary,
        indefinite: record.indefinite,
        permanent: record.permanent,
        statuses: {
          tempInsane: record.temporary?.active === true,
          indefiniteInsane: record.indefinite?.active === true,
          permaInsane: record.permanent === true,
        },
      }
    }
    card.sanity = entry?.sanity ?? null
    if (record.temporary?.active === true) {
      card.madness = {
        actorId: actor.id,
        particName: actor.name,
        ruleset: 'coc',
        manifestation: {
          index: record.temporary.bout.index,
          key: record.temporary.bout.id,
          name: game.i18n.localize(`BRP.coc.madness.bouts.${record.temporary.bout.id}`),
          description: game.i18n.localize(`BRP.coc.madness.boutsDesc.${record.temporary.bout.id}`),
        },
        duration: {
          key: `${record.temporary.hours}h`,
          hours: record.temporary.hours,
          label: game.i18n.localize('BRP.coc.madness.durationHours').replace('{hours}', String(record.temporary.hours)),
        },
        bout: { rounds: record.temporary.rounds.value, die: '1D10' },
        intCheck: record.intCheck,
        expiresAt: record.temporary.expiresAt,
        ended: false,
      }
    }
    const html = await BRPCheckStartChat(card)
    await message.update({ 'flags.brp.chatCard': card.chatCard, 'flags.brp.madness': card.madness ?? null, content: html })
    return message
  }
}

// The card renderer imports check.mjs, and check.mjs imports this module; a
// late-bound accessor keeps the cycle out of the module graph.
let BRPCheckRef = null
export const bindSanityCheck = (checkClass) => { BRPCheckRef = checkClass }
const BRPCheckStartChat = (card) => {
  const check = BRPCheckRef ?? game?.brp?.BRPCheck ?? null
  if (check?.startChat) { return check.startChat(card) }
  return ''
}
