import { BRPactorDetails } from './actorDetails.mjs'
import { BRPMadness } from './madness.mjs'
import { BRPWorldTime } from './worldTime.mjs'
import { Rules } from '../rules/index.mjs'

// CoC sanity settlement (M5: fixed writer + sequential idempotency).
//
// One writer per investigator, one read-modify-write chain, real dice. The pure
// decision core is module/rules/coc-sanity.mjs; this module only
//   1. picks the writer from ownership: an owned PC is written by the card
//      owner's own client (GM online or offline makes no difference), an
//      unowned NPC keeps the active-GM chain,
//   2. serializes the actor read-modify-write on that single client,
//   3. rolls the follow-up INT check and the 1D10h/1D10 bout/1D10 round dice as
//      real Rolls on that same client, persisting each result before continuing,
//   4. writes native attribs.san / conditions plus the ActiveEffect statuses, and
//   5. records the result on the chat card (flags + re-render).
//
// `settleId = coc-sn:<cardMessageId>` is the idempotency key of one SN card.
// The Actor's settlement record is the authority; the chat card is a
// projection that `retry` may repair without re-running the rules. This is
// fixed-writer + sequential idempotency, not distributed multi-device
// consistency: no socket message or backend conditional write is added.
//
// Ownership accepts both shapes the host writes: flags.mtcompat.ownerId /
// creatorId and native Foundry ownership OWNER levels. A GM's implicit
// all-actor OWNER is not a card assignment, so it never makes an NPC "owned".
//
// States are independent: temporary, indefinite and permanent can coexist as
// data; permanent is terminal and nothing here ever clears it implicitly.
// A temporary episode never stands in for an indefinite one.
//
// Native tempoInsane / indefInsane conditions mirror the active states. Extended
// settlement details live only in flags.brp.coc.sanity; permanent remains an
// extension plus its permaInsane ActiveEffect, not a native condition. State and
// effects are written together, so a refresh cannot lose or resurrect a state.

const NS = 'brp'
const TEXT = {
  tempInsane: 'tempInsane',
  indefinite: 'indefiniteInsane',
  permanent: 'permaInsane',
}

const OWNER_LEVEL = 3
const SETTLEMENT_LIMIT = 20

const int = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback
}

const textId = (value) => {
  if (value === null || value === undefined) { return null }
  const trimmed = String(value).trim()
  return trimmed ? trimmed : null
}

// `Number(null)` and `Number('')` are 0, which would silently turn a missing
// value into a real one. Every optional number goes through this.
const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') { return null }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
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

  static detailsOf(actor) {
    return actor?.flags?.brp?.coc?.sanity ?? {}
  }

  static insanityOf(actor) {
    const insanity = normalizeInsanity(this.detailsOf(actor).insanity)
    const conditions = actor?.system?.conditions ?? {}
    if (insanity.temporary) {
      insanity.temporary.active = conditions.tempoInsane?.value === true
    }
    if (insanity.indefinite) {
      insanity.indefinite.active = conditions.indefInsane?.value === true
    }
    return insanity
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
    const san = actor?.system?.attribs?.san ?? {}
    const details = this.detailsOf(actor)
    const insanity = this.insanityOf(actor)
    const dayId = details.dayId ?? null
    const rawDayStart = details.dayStartSan
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
      starting: int(details.starting, 0),
      singleLoss: int(details.singleLoss, 0),
      dailyLoss: int(san.dailyLoss, 0),
      dayId,
      dayStartSan,
      dayStartSource: details.dayStartSource ?? null,
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
    const san = actor?.system?.attribs?.san ?? {}
    const details = this.detailsOf(actor)
    const now = BRPWorldTime.now()
    const todayId = BRPWorldTime.dayId(now)
    let dayId = details.dayId ?? null
    const rawDayStart = details.dayStartSan
    let dayStartSan = rawDayStart === null || rawDayStart === undefined || rawDayStart === ''
      ? null
      : Number(rawDayStart)
    let source = details.dayStartSource ?? null
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

  // --- ownership: the fixed SAN writer ---

  // A PC belongs to the profile that owns it, in either of the two shapes the
  // host writes: `flags.mtcompat.ownerId` / `creatorId` (the compat bridge's
  // authoritative key, mirrored into `ownership[<profileId>] = 3`) and native
  // Foundry `ownership` OWNER levels. A GM's implicit all-actor OWNER is not a
  // card assignment, so it never turns an NPC into an owned character.
  static ownershipOf(actor) {
    if (!actor) { return { owned: false, ownerId: null, creatorId: null, native: [], owners: [], source: 'none' } }
    const flags = actor.flags?.mtcompat ?? actor._source?.flags?.mtcompat ?? {}
    const ownerId = textId(flags.ownerId)
    const creatorId = textId(flags.creatorId)
    const native = []
    const map = actor.ownership ?? actor._source?.ownership ?? null
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      for (const [key, level] of Object.entries(map)) {
        if (key === 'default') { continue }
        if (!(Number(level) >= OWNER_LEVEL)) { continue }
        const user = game.users?.get?.(key) ?? null
        if (user?.isGM === true) { continue }
        native.push(String(key))
      }
    }
    const owners = [...new Set([ownerId, creatorId, ...native].filter(Boolean))]
    const source = owners.length === 0
      ? 'none'
      : native.length > 0
        ? (ownerId || creatorId ? 'flags+native' : 'native')
        : 'flags'
    return { ownerId, creatorId, native, owners, owned: owners.length > 0, source }
  }

  static isCardOwner(actor, userId = null) {
    const id = textId(userId ?? game.user?.id)
    if (!id) { return false }
    return this.ownershipOf(actor).owners.includes(id)
  }

  // `settleId` is the idempotency key of one SN card, not an authorisation
  // token: the writer is decided by ownership, never by who holds the id.
  static settleIdFor(messageId) {
    const id = textId(messageId)
    return id ? `coc-sn:${id}` : null
  }

  static _settleIdFrom(options = {}) {
    const declared = textId(options.settleId)
    const derived = this.settleIdFor(options.cardMessageId)
    if (!declared) { return { settleId: derived } }
    if (!declared.startsWith('coc-sn:')) { return { error: 'invalid-settle-id' } }
    if (derived && derived !== declared) { return { error: 'settle-id-mismatch' } }
    return { settleId: declared }
  }

  // --- settlement records (the actor is the authority) ---

  static settlementsOf(actor) {
    const raw = this.detailsOf(actor).settlements
    return Array.isArray(raw)
      ? raw.filter((entry) => entry && typeof entry === 'object').map((entry) => ({ ...entry }))
      : []
  }

  static settlementOf(actor, settleId) {
    const id = textId(settleId)
    if (!id) { return null }
    return this.settlementsOf(actor).find((entry) => textId(entry.settleId) === id) ?? null
  }

  static pendingRecordOf(actor) {
    const id = textId(this.detailsOf(actor).pendingSettlementId)
    if (!id) { return null }
    const record = this.settlementOf(actor, id)
    // A stale pointer at an applied record is not an in-flight settlement.
    if (record?.status === 'applied') { return null }
    return record ?? { settleId: id, status: 'pending' }
  }

  static _messageList() {
    const collection = game.messages
    if (!collection) { return [] }
    if (Array.isArray(collection.contents)) { return collection.contents }
    if (typeof collection.values === 'function') {
      try { return [...collection.values()] } catch { return [] }
    }
    return Object.values(collection).filter((message) => message && typeof message === 'object')
  }

  static _messageAuthorId(message) {
    const author = message?.author ?? message?._source?.author ?? null
    if (typeof author === 'string') { return textId(author) }
    return textId(author?.id ?? author?._id)
  }

  // Who may rewrite this card's projection? Core Foundry and the compat shim
  // both allow only the message author or a GM to update a ChatMessage, so a
  // card authored by the keeper is repaired by that keeper (or the active GM),
  // never by a widened write guard. This is the one place that answers "who
  // repairs", and `retry` reports it instead of leaving the card silently
  // pending.
  static cardRepairAuthority(message) {
    const userId = textId(game.user?.id)
    const authorId = this._messageAuthorId(message)
    if (userId && authorId === userId) { return { mode: 'self', by: userId, authorId } }
    if (game.user?.isGM === true) { return { mode: 'gm', by: userId, authorId } }
    const activeGM = game.users?.activeGM ?? null
    if (activeGM?.id) { return { mode: 'active-gm', by: textId(activeGM.id), authorId } }
    return { mode: 'message-author', by: authorId, authorId }
  }

  // SN cards still carrying an unsettled projection. Legacy cards without
  // `sanitySettlement` are ignored: there is nothing on them to retry.
  // `settledOnActor` marks a card whose settleId the actor already applied: it
  // needs a projection repair, not a settlement, and never blocks a new SN.
  static pendingCards(actor) {
    if (!actor) { return [] }
    const actorType = this.actorTypeOf(actor)
    const pending = []
    for (const message of this._messageList()) {
      const card = message?.flags?.brp
      if (!card || card.rollType !== 'SN') { continue }
      const entry = Array.isArray(card.chatCard) ? card.chatCard[0] : null
      if (!entry || entry.particId !== actor.id) { continue }
      if ((entry.particType ?? 'actor') !== actorType) { continue }
      const settlement = entry.sanitySettlement ?? null
      if (!textId(settlement?.settleId)) { continue }
      if (settlement.status === 'applied') { continue }
      pending.push({
        messageId: message.id ?? message._id ?? null,
        settleId: settlement.settleId,
        status: settlement.status ?? 'pending',
        loss: settlement.loss ?? null,
        sanBefore: settlement.sanBefore ?? null,
        sanAfter: settlement.sanAfter ?? null,
        authorId: this._messageAuthorId(message),
        settledOnActor: this.settlementOf(actor, settlement.settleId)?.status === 'applied',
      })
    }
    return pending
  }

  // One in-flight SN per actor: an actor-level pending record or a card whose
  // settleId the actor has not applied blocks a new SN before any d100 or loss
  // die is rolled. A stale card (actor applied, projection behind) never blocks.
  static canStart(actor) {
    const record = this.pendingRecordOf(actor)
    const cards = this.pendingCards(actor).filter((card) => card.settledOnActor !== true)
    return {
      allowed: !record && cards.length === 0,
      reason: record ? 'actor-pending' : cards.length > 0 ? 'card-pending' : null,
      settleId: record?.settleId ?? cards[0]?.settleId ?? null,
      record,
      cards,
    }
  }

  // Read-only recovery surface: what a refreshed card needs in order to show
  // "loss N · unsettled" and offer [retry] instead of a settled SAN. A card with
  // `settledOnActor: true` is a stale projection: the SAN is already applied and
  // only the card needs its author / the active GM to rewrite it.
  static async pending(options = {}) {
    const actor = await this.resolveActor(options)
    if (!actor) { return { error: 'actor-missing' } }
    const ownership = this.ownershipOf(actor)
    const record = this.pendingRecordOf(actor)
    const cards = this.pendingCards(actor)
    const inFlight = cards.filter((card) => card.settledOnActor !== true)
    const stale = cards.filter((card) => card.settledOnActor === true)
    const settlements = this.settlementsOf(actor).filter((entry) => entry.status !== 'applied')
    return {
      actorId: actor.id,
      actorType: this.actorTypeOf(actor),
      owned: ownership.owned,
      writer: ownership.owned ? (this.isCardOwner(actor) ? 'owner' : 'owner-remote') : 'active-gm',
      pending: !!record || inFlight.length > 0,
      settleId: record?.settleId ?? inFlight[0]?.settleId ?? null,
      record,
      settlements,
      cards,
      // Cards whose SAN is already applied: repair-only, never re-settled.
      staleCards: stale,
    }
  }

  // Card projection at SN start: the rolled loss becomes visible as pending
  // before any actor write, so a refresh never shows a lost SAN that was not
  // written. Failure here never blocks the actor settlement.
  static async beginCardSettlement({ cardMessageId, actor = null, loss = 0, sanBefore = null, settleId = null } = {}) {
    const messageId = textId(cardMessageId)
    const id = textId(settleId) ?? this.settleIdFor(messageId)
    if (!messageId) { return { written: false, settleId: id, error: 'message-missing' } }
    const message = await game.messages?.get?.(messageId) ?? null
    const card = message?.flags?.brp
    if (!card) { return { written: false, settleId: id, error: 'message-missing' } }
    const entry = Array.isArray(card.chatCard) ? card.chatCard[0] : null
    if (!entry) { return { written: false, settleId: id, error: 'card-missing' } }
    if (entry.sanitySettlement?.settleId === id && entry.sanitySettlement?.status === 'applied') {
      return { written: false, settleId: id, alreadyApplied: true }
    }
    const declared = numberOrNull(sanBefore)
    const before = declared !== null
      ? Math.max(0, int(declared, 0))
      : Math.max(0, int(actor?.system?.attribs?.san?.value, 0))
    const clone = foundry.utils.deepClone(card)
    clone.chatCard[0].sanitySettlement = {
      settleId: id,
      status: 'pending',
      loss: Math.max(0, int(loss, 0)),
      sanBefore: before,
      sanAfter: null,
    }
    try {
      await message.update({ 'flags.brp.chatCard': clone.chatCard })
      return { written: true, settleId: id }
    } catch (error) {
      return { written: false, settleId: id, error: 'card-write-failed', detail: String(error?.message ?? error) }
    }
  }

  // Close a settleId without a settlement: the card keeps its rolled dice, but
  // the projection stops being pending. Used for terminal (permanent) actors so
  // a rejected roll cannot leave a pending card that blocks every later SN.
  static async closeCardSettlement(messageId, settlement = {}) {
    const id = textId(messageId)
    if (!id || !settlement?.settleId) { return false }
    const message = await game.messages?.get?.(id) ?? null
    if (!message?.flags?.brp) { return false }
    const clone = foundry.utils.deepClone(message.flags.brp)
    const entry = Array.isArray(clone.chatCard) ? clone.chatCard[0] : null
    if (!entry) { return false }
    entry.sanitySettlement = {
      settleId: settlement.settleId,
      status: 'applied',
      loss: settlement.loss ?? 0,
      sanBefore: settlement.sanBefore ?? null,
      sanAfter: settlement.sanAfter ?? null,
      updatedAtClient: numberOrNull(settlement.updatedAtClient),
      ...(settlement.rejected ? { rejected: settlement.rejected } : {}),
    }
    if (settlement.rejected === 'permanent-insanity') { entry.permaInsane = true }
    try {
      await message.update({ 'flags.brp.chatCard': clone.chatCard })
      return true
    } catch {
      return false
    }
  }

  static _recordListWith(actor, record) {
    const list = this.settlementsOf(actor)
    const id = textId(record?.settleId)
    const index = list.findIndex((entry) => textId(entry?.settleId) === id)
    if (index >= 0) { list[index] = { ...list[index], ...record } }
    else { list.push({ ...record }) }
    while (list.length > SETTLEMENT_LIMIT) { list.shift() }
    return list
  }

  // Persist in-flight material (the decision, the INT result, each rolled
  // follow-up die) before continuing. An interruption must resume from this
  // record, not re-roll what already happened. `updatedAt` stays world seconds
  // (rules clock); `updatedAtClient` is the writing client's wall clock, the
  // only field a "recently applied" UI may compare against Date.now().
  static async _stageSettlement(actor, settleId, patch = {}) {
    const current = this.settlementOf(actor, settleId) ?? {}
    const record = {
      ...current,
      ...patch,
      settleId,
      status: 'pending',
      decision: { ...(current.decision ?? {}), ...(patch.decision ?? {}) },
      updatedAt: BRPWorldTime.now(),
      updatedAtClient: Date.now(),
    }
    await actor.update({
      'flags.brp.coc.sanity.settlements': this._recordListWith(actor, record),
      'flags.brp.coc.sanity.pendingSettlementId': settleId,
    })
    return record
  }

  static _duplicateResult(actor, existing) {
    return {
      applied: true,
      duplicate: true,
      settleId: existing.settleId,
      loss: existing.loss,
      lossRolled: existing.lossRolled ?? existing.loss,
      sanBefore: existing.sanBefore,
      sanAfter: existing.sanAfter,
      dailyLoss: existing.dailyLoss,
      dayId: existing.dayId,
      dayStartSan: existing.dayStartSan,
      singleLoss: existing.singleLoss ?? existing.loss,
      intCheck: existing.intCheck ?? null,
      temporary: existing.temporary ?? null,
      indefinite: existing.indefinite ?? null,
      permanent: existing.permanent === true,
      decision: existing.decision ?? null,
      updatedAtClient: existing.updatedAtClient ?? null,
      state: this.state(actor),
      effects: { temporary: null, indefinite: null },
      cardError: null,
    }
  }

  // --- settlement entry points ---

  // Every client calls this. An owned PC is settled by its card owner on the
  // owner's own client; a keeper (or another player) only leaves the pending
  // card for the owner and never relays an owned PC to the active GM. An
  // unowned NPC keeps the active-GM chain: relay to that one writer, which
  // returns `{queued:true}` here and performs the write inside one chain.
  static async settle(options = {}) {
    if (!this.isCoC()) { return { error: 'ruleset-not-coc' } }
    const actor = await this.resolveActor(options)
    if (!actor) { return { error: 'actor-missing' } }
    const id = this._settleIdFrom(options)
    if (id.error) { return id }
    if (this.ownershipOf(actor).owned) {
      if (this.isCardOwner(actor)) { return this.settleOwned({ ...options, actor, settleId: id.settleId }) }
      return {
        pending: true,
        error: 'card-owner-required',
        settleId: id.settleId,
        by: game.user?.id ?? null,
        loss: Math.max(0, int(options.loss, 0)),
      }
    }
    const writer = this.writer()
    if (!writer) { return { error: 'no-active-gm' } }
    if (game.user?.id === writer.id) {
      return this.settleNow({ ...options, actor, settleId: id.settleId })
    }
    const payload = {
      actorId: actor.id,
      actorType: this.actorTypeOf(actor),
      loss: int(options.loss, 0),
      cardMessageId: options.cardMessageId ?? null,
      settleId: id.settleId,
      // A player never declares the game day; only a keeper action does.
      dayId: null,
      reason: options.reason ?? 'sanity-roll',
      origin: game.user?.id ?? null,
    }
    game.socket.emit('system.brp', { type: 'cocSanSettle', to: writer.id, value: payload })
    return { queued: true, by: writer.id, loss: payload.loss, settleId: payload.settleId }
  }

  // Owner-only settlement of an owned PC. This is not a second rules path: it
  // only replaces the writer authorisation and then enters the same `_settleNow`
  // / CoC rules core inside the same serialized chain.
  static async settleOwned(options = {}) {
    if (!this.isCoC()) { return { error: 'ruleset-not-coc' } }
    const actor = await this.resolveActor(options)
    if (!actor) { return { error: 'actor-missing' } }
    const ownership = this.ownershipOf(actor)
    if (!ownership.owned) { return { error: 'actor-unowned' } }
    const id = this._settleIdFrom(options)
    if (id.error) { return id }
    if (!this.isCardOwner(actor)) {
      return { error: 'not-card-owner', pending: true, settleId: id.settleId, by: game.user?.id ?? null }
    }
    return this._serialize(() => this._settleNow({ ...options, actor, settleId: id.settleId }))
  }

  // Active-GM settlement for an unowned NPC. Every entry point funnels through
  // this serialized wrapper - the local settle(), the socket relay and a keeper
  // macro - so two clients (or two clicks) can never apply a loss against the
  // same stale SAN. An owned PC is refused here: its writer is the card owner.
  static async settleNow(options = {}) {
    if (!this.isCoC()) { return { error: 'ruleset-not-coc' } }
    const actor = await this.resolveActor(options)
    if (!actor) { return { error: 'actor-missing' } }
    const id = this._settleIdFrom(options)
    if (id.error) { return id }
    if (this.ownershipOf(actor).owned) {
      return { error: 'card-owner-required', pending: true, settleId: id.settleId, by: game.user?.id ?? null }
    }
    if (!this.isWriter()) { return { error: 'not-active-gm' } }
    return this._serialize(() => this._settleNow({ ...options, actor, settleId: id.settleId }))
  }

  // Recovery entry point for a card that is still pending (or whose card write
  // failed). Reads the already-decided loss from the message, never calls
  // `_trigger` and never re-rolls the d100 or the loss die.
  static async retry(options = {}) {
    if (!this.isCoC()) { return { error: 'ruleset-not-coc' } }
    const messageId = textId(options.cardMessageId ?? options.messageId)
    if (!messageId) { return { error: 'message-missing' } }
    const message = await game.messages?.get?.(messageId) ?? null
    const card = message?.flags?.brp
    if (!card) { return { error: 'message-missing' } }
    if (card.rollType !== 'SN') { return { error: 'not-a-sanity-card' } }
    const entry = Array.isArray(card.chatCard) ? card.chatCard[0] : null
    if (!entry) { return { error: 'card-missing' } }
    const actor = await this.resolveActor({ actorId: entry.particId, actorType: entry.particType ?? 'actor' })
    if (!actor) { return { error: 'actor-missing' } }
    const settleId = textId(entry.sanitySettlement?.settleId) ?? this.settleIdFor(messageId)
    return this._serialize(async () => {
      const existing = this.settlementOf(actor, settleId)
      if (existing?.status === 'applied') {
        // The actor is the authority; the card is only a projection. Repair it
        // without re-running the rules or touching SAN. A card authored by
        // somebody else cannot be rewritten from here (core Foundry and the
        // compat shim allow only the author or a GM), so the projection is
        // handed to its author / the active GM and the result says who repairs.
        return this._repairProjection(message, actor, existing)
      }
      if (!existing && entry.sanitySettlement?.status === 'applied') {
        // The card says applied but the actor's bounded record is gone (older
        // than the last 20 settlements). Never deduct a second time.
        return {
          applied: true,
          duplicate: true,
          repaired: false,
          source: 'card',
          settleId,
          sanAfter: entry.sanitySettlement.sanAfter ?? null,
          updatedAtClient: numberOrNull(entry.sanitySettlement.updatedAtClient),
          cardError: null,
        }
      }
      const ownership = this.ownershipOf(actor)
      if (ownership.owned && !this.isCardOwner(actor)) {
        return { pending: true, error: 'card-owner-required', settleId, by: game.user?.id ?? null }
      }
      if (!ownership.owned && !this.isWriter()) { return { error: 'not-active-gm' } }
      const settled = await this._settleNow({
        actor,
        loss: Math.max(0, int(entry.sanLoss, 0)),
        cardMessageId: messageId,
        settleId,
        reason: 'sanity-retry',
      })
      if (settled?.applied === true && settled.cardError) {
        // The actor is settled but the card projection failed (typically a card
        // authored by the keeper). Hand the projection to its author / the
        // active GM in this same retry instead of leaving a silent pending card.
        const projection = await this._repairProjection(message, actor, settled)
        return {
          ...settled,
          repaired: projection.repaired,
          repairedNow: projection.repairedNow === true,
          repairBy: projection.repairBy,
          repairRelayed: projection.repairRelayed === true,
          cardError: projection.cardError ?? null,
          cardErrorDetail: projection.cardErrorDetail ?? null,
        }
      }
      return settled
    })
  }

  // Repair an applied settlement's chat projection. Direct write when this
  // client may update the message; otherwise relay the projection-only repair
  // to the active GM over the existing `cocSanSettle` channel (no actor write,
  // no new message type) and report exactly who owns the repair.
  static async _repairProjection(message, actor, settlement) {
    const settleId = settlement.settleId ?? null
    const current = message?.flags?.brp?.chatCard?.[0]?.sanitySettlement ?? null
    if (current?.status === 'applied'
      && textId(current.settleId) === settleId
      && numberOrNull(current.sanAfter) === numberOrNull(settlement.sanAfter)) {
      // Already projected: nothing to write, no relay, no second deduction.
      return {
        applied: true,
        duplicate: true,
        repaired: true,
        repairedNow: false,
        settleId,
        sanAfter: settlement.sanAfter,
        updatedAtClient: settlement.updatedAtClient ?? null,
        cardError: null,
        repairBy: { mode: 'self', by: game.user?.id ?? null, authorId: this._messageAuthorId(message) },
      }
    }
    const repair = await this._repairCard(message, actor, settlement)
    if (repair.repaired) {
      return {
        applied: true,
        duplicate: true,
        repaired: true,
        repairedNow: true,
        settleId,
        sanAfter: settlement.sanAfter,
        updatedAtClient: settlement.updatedAtClient ?? null,
        cardError: null,
        repairBy: { mode: 'self', by: game.user?.id ?? null, authorId: this._messageAuthorId(message) },
      }
    }
    const authority = this.cardRepairAuthority(message)
    const relayed = this._relayCardRepair({ message, actor, settleId, authority })
    return {
      applied: true,
      duplicate: true,
      repaired: false,
      settleId,
      sanAfter: settlement.sanAfter,
      updatedAtClient: settlement.updatedAtClient ?? null,
      cardError: repair.error?.code ?? 'card-write-failed',
      cardErrorDetail: repair.error?.message ?? null,
      // Never a silent pending card: the caller is told who can rewrite it.
      repairBy: { mode: authority.mode, by: authority.by ?? null, authorId: authority.authorId ?? null },
      repairRelayed: relayed,
    }
  }

  static _relayCardRepair({ message, actor, settleId, authority }) {
    const target = authority?.mode === 'active-gm' ? textId(authority.by) : null
    const self = textId(game.user?.id)
    if (!target || target === self) { return false }
    try {
      game.socket.emit('system.brp', {
        type: 'cocSanSettle',
        to: target,
        value: {
          action: 'cardRepair',
          actorId: actor.id,
          actorType: this.actorTypeOf(actor),
          cardMessageId: message.id ?? message._id ?? null,
          settleId,
          origin: self,
        },
      })
      return true
    } catch {
      return false
    }
  }

  // Projection-only repair executed by the card's author / the active GM. It
  // never settles and never deducts: the actor must already hold an applied
  // record for this settleId, the origin must be a GM or one of the actor's
  // owners, and the card must belong to that actor with the same settleId.
  static async repairCardFromRecord({ actor, cardMessageId, settleId, origin = null } = {}) {
    if (!this.isCoC()) { return { error: 'ruleset-not-coc' } }
    if (!actor) { return { error: 'actor-missing' } }
    const id = textId(settleId)
    if (!id) { return { error: 'settle-id-missing' } }
    // The relayed repair always names its origin; a missing origin fails closed
    // instead of being treated as "the GM asked for it".
    const originId = textId(origin)
    if (!originId) { return { error: 'origin-missing' } }
    const originUser = game.users?.get?.(originId) ?? null
    if (!originUser) { return { error: 'origin-missing' } }
    if (originUser.isGM !== true && !this.isCardOwner(actor, originUser.id)) {
      return { error: 'not-authorised' }
    }
    const record = this.settlementOf(actor, id)
    if (record?.status !== 'applied') { return { error: 'settlement-not-applied', settleId: id } }
    const messageId = textId(cardMessageId)
    const message = messageId ? await game.messages?.get?.(messageId) ?? null : null
    if (!message) { return { error: 'message-missing' } }
    const entry = Array.isArray(message.flags?.brp?.chatCard) ? message.flags.brp.chatCard[0] : null
    if (!entry || entry.particId !== actor.id) { return { error: 'card-actor-mismatch' } }
    const cardSettleId = textId(entry.sanitySettlement?.settleId) ?? this.settleIdFor(messageId)
    if (cardSettleId !== id) { return { error: 'settle-id-mismatch', settleId: id } }
    const repair = await this._repairCard(message, actor, record)
    if (!repair.repaired) {
      return {
        repaired: false,
        settleId: id,
        cardError: repair.error?.code ?? 'card-write-failed',
        detail: repair.error?.message ?? null,
      }
    }
    return { repaired: true, settleId: id, sanAfter: record.sanAfter, updatedAtClient: record.updatedAtClient ?? null }
  }

  static async _repairCard(message, actor, settlement) {
    try {
      await this._writeCard(message.id ?? message._id, {
        settleId: settlement.settleId ?? null,
        loss: settlement.loss,
        sanBefore: settlement.sanBefore,
        sanAfter: settlement.sanAfter,
        singleLoss: settlement.singleLoss ?? settlement.loss,
        dailyLoss: settlement.dailyLoss,
        dayId: settlement.dayId,
        dayStartSan: settlement.dayStartSan,
        intCheck: settlement.intCheck ?? null,
        temporary: settlement.temporary ?? null,
        indefinite: settlement.indefinite ?? null,
        permanent: settlement.permanent === true,
        // A repair must not make an old settlement look freshly applied.
        updatedAtClient: settlement.updatedAtClient ?? null,
      }, { intCheck: settlement.intCheck ?? null, episode: null, actor })
      return { repaired: true, error: null }
    } catch (error) {
      return {
        repaired: false,
        error: { code: error?.code ?? null, message: String(error?.message ?? error) },
      }
    }
  }

  static _insanityWrites({ temporary = null, indefinite = null, permanent = false }) {
    return {
      'flags.brp.coc.sanity.insanity': {
        temporary: temporary ?? null,
        indefinite: indefinite ?? null,
        permanent: permanent === true,
        lastUpdatedAt: BRPWorldTime.now(),
      },
      'system.conditions.tempoInsane': {
        value: temporary?.active === true,
        realTime: false,
        duration: temporary?.active === true ? Math.max(0, int(temporary.hours, 0)) : 0,
      },
      'system.conditions.indefInsane.value': indefinite?.active === true,
    }
  }

  static async _settleNow(options = {}) {
    if (!this.isCoC()) { return { error: 'ruleset-not-coc' } }
    const actor = await this.resolveActor(options)
    if (!actor) { return { error: 'actor-missing' } }
    const ownership = this.ownershipOf(actor)
    if (ownership.owned) {
      // Fixed writer: only the card owner's client may write this PC. A keeper
      // (or another player) leaves the pending card to the owner.
      if (!this.isCardOwner(actor)) {
        return {
          pending: true,
          error: 'card-owner-required',
          settleId: textId(options.settleId) ?? this.settleIdFor(options.cardMessageId),
          by: game.user?.id ?? null,
          loss: Math.max(0, int(options.loss, 0)),
        }
      }
    } else if (!this.isWriter()) {
      return { error: 'not-active-gm' }
    }
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

    const settleId = textId(options.settleId)
    const existing = settleId ? this.settlementOf(actor, settleId) : null
    if (existing?.status === 'applied') {
      // Sequential idempotency: the actor already holds this settlement. No
      // rule, no die, no second deduction.
      return this._duplicateResult(actor, existing)
    }
    const inFlight = this.pendingRecordOf(actor)
    if (inFlight?.settleId && inFlight.settleId !== settleId) {
      // One in-flight SN per actor; the owner has to settle or retry that one.
      return { error: 'settlement-pending', settleId: inFlight.settleId, pending: true }
    }

    const san = actor.system?.attribs?.san ?? {}
    const details = this.detailsOf(actor)
    const insanity = this.insanityOf(actor)
    if (insanity.permanent === true || this.hasStatus(actor, TEXT.permanent)) {
      // Terminal state: record the request, never open a new episode and never
      // deduct again. The settleId is still completed (loss 0) so its card
      // cannot stay pending and block every later SN.
      const current = Math.max(0, int(san.value, 0))
      if (settleId) {
        const terminal = {
          settleId,
          status: 'applied',
          rejected: 'permanent-insanity',
          permanent: true,
          loss: 0,
          lossRolled: 0,
          sanBefore: current,
          sanAfter: current,
          dailyLoss: int(san.dailyLoss, 0),
          dailyLossBefore: int(san.dailyLoss, 0),
          dayId: details.dayId ?? null,
          dayStartSan: numberOrNull(details.dayStartSan),
          intCheck: null,
          temporary: null,
          indefinite: insanity.indefinite ?? null,
          decision: { intCheck: null, dice: {} },
          cardMessageId: textId(options.cardMessageId),
          reason: 'permanent-insanity',
          by: game.user?.id ?? null,
          updatedAt: BRPWorldTime.now(),
          updatedAtClient: Date.now(),
        }
        await actor.update({
          'flags.brp.coc.sanity.settlements': this._recordListWith(actor, terminal),
          'flags.brp.coc.sanity.pendingSettlementId': null,
        })
        if (options.cardMessageId) {
          await this.closeCardSettlement(options.cardMessageId, terminal)
        }
      }
      return { applied: false, reason: 'permanent-insanity', settleId, state: this.state(actor) }
    }

    // Resume from the persisted record when this settleId was interrupted: the
    // rolled loss, SAN baseline, day window and already-rolled dice stay as they
    // were, so a retry cannot deduct twice or re-roll the follow-up dice.
    const loss = existing
      ? Math.max(0, int(existing.lossRolled ?? existing.loss, 0))
      : Math.max(0, int(options.loss, 0))
    const persistedSanBefore = existing ? numberOrNull(existing.sanBefore) : null
    const sanBefore = persistedSanBefore !== null
      ? Math.max(0, int(persistedSanBefore, 0))
      : Math.max(0, int(san.value, 0))
    const persistedWindow = existing && textId(existing.dayId) ? existing : null
    const persistedDayStart = persistedWindow ? numberOrNull(persistedWindow.dayStartSan) : null
    const window = persistedWindow
      ? {
        dayId: persistedWindow.dayId,
        dayStartSan: persistedDayStart !== null ? Math.max(0, persistedDayStart) : sanBefore,
        dailyLoss: Math.max(0, int(persistedWindow.dailyLossBefore, 0)),
        dayStartSource: persistedWindow.dayStartSource ?? null,
        rolled: false,
      }
      : this.dayWindow(actor, { keeperDayId })

    const base = {
      loss,
      sanBefore,
      dailyLossBefore: window.dailyLoss,
      dayId: window.dayId,
      dayStartSan: window.dayStartSan,
      dailyBasis: 'day-start',
      startingSan: int(details.starting, 0),
      currentSan: sanBefore,
    }
    const prior = existing?.decision ?? null
    const priorIntRoll = prior?.intCheck ? numberOrNull(prior.intCheck.roll) : null
    let intSeed = priorIntRoll !== null
      ? {
        roll: Math.max(1, Math.min(100, int(priorIntRoll, 1))),
        target: Math.max(0, int(numberOrNull(prior.intCheck.target) ?? 0, 0)),
      }
      : null
    const dice = { ...(prior?.dice ?? {}) }
    const stage = (patch) => (settleId ? this._stageSettlement(actor, settleId, patch) : Promise.resolve(null))

    // The INT check and the episode dice are real rolls on the writer, each
    // persisted before the next step so an interruption resumes instead of
    // re-rolling what already happened.
    let decision = core.settleSanLoss(base)
    if (settleId) {
      await stage({
        actorId: actor.id,
        actorType: this.actorTypeOf(actor),
        cardMessageId: textId(options.cardMessageId),
        reason: options.reason ?? 'sanity-roll',
        loss,
        lossRolled: loss,
        sanBefore,
        dailyLossBefore: window.dailyLoss,
        dayId: window.dayId,
        dayStartSan: window.dayStartSan,
        dayStartSource: window.dayStartSource,
        by: game.user?.id ?? null,
        decision: {
          intCheck: prior?.intCheck ?? null,
          dice: { ...dice },
          required: decision.intCheck.required === true,
        },
      })
    }
    if (decision.intCheck.required === true) {
      if (!intSeed) {
        const rolled = await this._rollIntCheck(actor)
        intSeed = { roll: rolled.rollVal, target: rolled.target }
        await stage({
          decision: { intCheck: { ...intSeed, passed: intSeed.roll <= intSeed.target }, dice: { ...dice } },
        })
      }
      const intPassed = intSeed.roll <= intSeed.target
      if (intPassed) {
        for (const key of ['hours', 'bout', 'rounds']) {
          if (numberOrNull(dice[key]) !== null) { continue }
          dice[key] = await this._rollDie(10)
          await stage({ decision: { intCheck: { ...intSeed, passed: true }, dice: { ...dice } } })
        }
      }
      decision = core.settleSanLoss({
        ...base,
        intCheck: { roll: intSeed.roll, target: intSeed.target },
        hoursDie: intPassed ? dice.hours : null,
        boutDie: intPassed ? dice.bout : null,
        roundsDie: intPassed ? dice.rounds : null,
      })
    }
    const intCheck = intSeed
      ? { rollVal: intSeed.roll, target: intSeed.target, passed: intSeed.roll <= intSeed.target }
      : null
    const episode = decision.temporaryInsanity ?? null

    // Apply the SAN numbers first: everything below reports the resulting state.
    const writes = {
      'system.attribs.san.value': decision.san.after,
      'system.attribs.san.dailyLoss': decision.dailyLoss.after,
      'flags.brp.coc.sanity.singleLoss': decision.loss.applied,
      'flags.brp.coc.sanity.dayId': window.dayId,
      'flags.brp.coc.sanity.dayStartSan': window.dayStartSan,
      'flags.brp.coc.sanity.dayStartSource': window.dayStartSource,
      'flags.brp.coc.sanity.lastLossAt': BRPWorldTime.now(),
    }
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

    Object.assign(writes, this._insanityWrites({ temporary, indefinite, permanent }))
    // The authoritative update: SAN, daily loss, insanity state, the applied
    // settlement record and the cleared pending id land in one write, so a
    // refresh can never see a half-applied settleId. The settlement carries both
    // clocks: world seconds for the rules and the client wall clock for UI
    // recency (`updatedAtClient`, never used for rules).
    const appliedAtClient = Date.now()
    if (settleId) {
      writes['flags.brp.coc.sanity.settlements'] = this._recordListWith(actor, {
        settleId,
        status: 'applied',
        actorId: actor.id,
        actorType: this.actorTypeOf(actor),
        cardMessageId: textId(options.cardMessageId),
        reason: options.reason ?? 'sanity-roll',
        loss: decision.loss.applied,
        lossRolled: decision.loss.rolled,
        sanBefore,
        sanAfter: decision.san.after,
        dailyLoss: decision.dailyLoss.after,
        dailyLossBefore: window.dailyLoss,
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
        decision: {
          intCheck: intCheck
            ? { roll: intCheck.rollVal, target: intCheck.target, passed: intCheck.passed }
            : null,
          dice: episode?.status === 'active'
            ? { hours: dice.hours, bout: dice.bout, rounds: dice.rounds }
            : { ...dice },
        },
        by: game.user?.id ?? null,
        updatedAt: BRPWorldTime.now(),
        updatedAtClient: appliedAtClient,
      })
      writes['flags.brp.coc.sanity.pendingSettlementId'] = null
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
      settleId: settleId ?? null,
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
      updatedAtClient: appliedAtClient,
    }

    // Card: the SAN numbers, the INT result and the episode. One write for
    // flags and content so the card is never read half-settled. A failed card
    // write never rolls the actor back: the actor record stays the authority
    // and `retry` repairs the projection.
    let cardError = null
    if (options.cardMessageId) {
      try {
        await this._writeCard(options.cardMessageId, record, { intCheck, episode, actor })
      } catch (error) {
        cardError = String(error?.message ?? error)
      }
    }
    await this._log(actor, { ...record, cardError })
    return {
      applied: true,
      duplicate: false,
      ...record,
      state: this.state(actor),
      effects: {
        temporary: tempEffect?.id ?? null,
        indefinite: indefiniteEffect?.id ?? null,
      },
      cardError,
    }
  }

  static async _rollDie(faces) {
    const roll = new Roll(`1D${faces}`)
    await roll.evaluate()
    return Math.max(1, Math.min(faces, int(roll.total, 1)))
  }

  // INT is a characteristic test: the target is the native INT value itself.
  static async _rollIntCheck(actor) {
    const target = Math.max(0, int(Rules.active().check.characteristicTarget(actor.system?.characteristics?.int?.value ?? 0), 0))
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
      const details = this.detailsOf(actor)
      if (insanity.permanent === true) { return { applied: false, reason: 'permanent-insanity' } }
      const target = Math.max(0, int(Rules.active().check.characteristicTarget(actor.system?.characteristics?.int?.value ?? 0), 0))
      const passed = rollVal <= target
      const record = { intCheck: { roll: rollVal, target, passed }, at: BRPWorldTime.now() }
      if (passed) {
        const loss = Math.max(0, int(details.singleLoss, 0))
        if (Rules.active().sanity.core.singleLossTrigger({ loss }).trigger !== true) {
          return { applied: false, reason: 'loss-below-threshold', ...record }
        }
        const episode = Rules.active().sanity.core.temporaryInsanity({
          loss,
          intCheck: { roll: rollVal, target },
          hoursDie: await this._rollDie(10),
          boutDie: await this._rollDie(10),
          roundsDie: await this._rollDie(10),
          dayId: details.dayId,
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
          dayId: details.dayId ?? null,
          endedAt: null,
        }
        await actor.update(this._insanityWrites({
          temporary,
          indefinite: insanity.indefinite,
          permanent: false,
        }))
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
      await actor.update(this._insanityWrites({
        temporary,
        indefinite: insanity.indefinite,
        permanent: insanity.permanent,
      }))
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
      await actor.update(this._insanityWrites({
        temporary: insanity.temporary,
        indefinite,
        permanent: insanity.permanent,
      }))
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
      await actor.update(this._insanityWrites({
        temporary: insanity.temporary,
        indefinite: insanity.indefinite,
        permanent: false,
      }))
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
      const san = Math.max(0, int(actor.system?.attribs?.san?.value, 0))
      await actor.update({
        'system.attribs.san.dailyLoss': 0,
        'flags.brp.coc.sanity.dayId': day.dayId,
        'flags.brp.coc.sanity.dayStartSan': san,
        'flags.brp.coc.sanity.dayStartSource': DAY_START_SOURCES.keeper,
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
      if (!actor?.system?.attribs?.lck) { return { error: 'actor-missing' } }
      const before = Math.max(0, int(actor.system.attribs.lck.value, 0))
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
      await actor.update({ 'system.attribs.lck.value': decision.luck.after })
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

  // Card update: flags (numbers + episode) and content in one write, so the card
  // is never read half-settled. The settlement block lets the mobile card tell
  // "applied" apart from a stranded pending card carrying the same rolled loss;
  // `sanAfter` always stays the actor's answer. A card write failure is the
  // caller's to record, never a reason to roll the actor back.
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
      entry.sanitySettlement = {
        settleId: record.settleId ?? null,
        status: 'applied',
        loss: record.loss,
        sanBefore: record.sanBefore,
        sanAfter: record.sanAfter,
        // Client wall clock of the write (a repair keeps the original stamp), so
        // the mobile card can show "just applied" without reading world seconds.
        updatedAtClient: numberOrNull(record.updatedAtClient),
      }
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
