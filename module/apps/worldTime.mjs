import { Rules } from '../rules/index.mjs'

// Persistent world clock for the CoC insanity durations (M4).
//
// Why this exists: `game.time.worldTime` is authoritative in core Foundry but is
// NOT persisted by the compat shim - it starts at 0 on every page load. A 1D10
// hour temporary insanity stored only as an ActiveEffect `duration.seconds`
// would therefore read as "full duration" after a refresh and never expire, or
// (if anything reset the start time) expire instantly.
//
// The system therefore keeps its own world-scoped setting (`brp.worldTime`,
// Number, world scope) which the compat settings layer persists into the
// campaign store and core Foundry persists into the world database. The clock
// never touches octopus/DND behaviour: nothing outside the CoC paths reads it.
//
// Rules:
//   - `now()` is max(game.time.worldTime, persisted value) - whichever source
//     has advanced furthest wins, so a real Foundry clock is never fought.
//   - Only a GM writes it. `updateWorldTime` (fired when game.time advances on
//     the shim) saves the new value; the keeper's explicit advance does the same.
//   - Nothing expires on its own: an episode ends when the clock really reached
//     its end, and only the active GM performs the write.
const NS = 'brp'
const SETTING = 'worldTime'
const DAY_SEQ = 'cocDaySeq'
const DAY_SECONDS = 86400

const readNumber = (key, fallback = 0) => {
  try {
    const value = Number(game.settings.get(NS, key))
    return Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

const isCoC = () => {
  try { return Rules.activeId() === 'coc' } catch { return false }
}

export class BRPWorldTime {

  static get settingKey() { return SETTING }
  static get daySequenceKey() { return DAY_SEQ }
  static get secondsPerDay() { return DAY_SECONDS }

  // Persisted value only (0 when the world never advanced or the setting is absent).
  static stored() {
    return Math.max(0, Math.floor(readNumber(SETTING, 0)))
  }

  // Live core clock (0 when the platform does not run one).
  static gameTime() {
    try {
      const value = Number(game.time?.worldTime)
      return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
    } catch {
      return 0
    }
  }

  static now() {
    return Math.max(this.stored(), this.gameTime())
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

  // Save the clock. World-scoped settings are GM-writable; a player request for
  // an advance is relayed by the caller, never written locally.
  static async save(seconds, { force = false } = {}) {
    if (!isCoC()) { return { saved: false, reason: 'ruleset-not-coc' } }
    if (!force && !this.isWriter()) { return { saved: false, reason: 'not-active-gm' } }
    const value = Math.max(0, Math.floor(Number(seconds) || 0))
    try {
      await game.settings.set(NS, SETTING, value)
    } catch (thrown) {
      return { saved: false, reason: 'write-failed', detail: String(thrown?.message ?? thrown) }
    }
    return { saved: true, worldTime: value }
  }

  // `updateWorldTime` hook body: a real clock moved, so mirror it into the
  // persisted setting (never backwards).
  static async syncFromGameTime(worldTime) {
    if (!isCoC() || !this.isWriter()) { return { saved: false, reason: 'not-writer' } }
    const value = Math.max(0, Math.floor(Number(worldTime) || 0))
    if (!(value > this.stored())) { return { saved: false, reason: 'not-newer', worldTime: value } }
    return this.save(value, { force: true })
  }

  // Keeper moves the clock. Accepts hours/days/seconds like the core API does.
  static async advance({ hours = 0, days = 0, seconds = 0, minutes = 0 } = {}) {
    if (!isCoC()) { return { error: 'ruleset-not-coc' } }
    if (!this.isWriter()) { return { error: 'not-active-gm' } }
    const delta = Math.floor(
      (Number(hours) || 0) * 3600 + (Number(days) || 0) * DAY_SECONDS
      + (Number(minutes) || 0) * 60 + (Number(seconds) || 0),
    )
    if (delta === 0) { return { error: 'no-delta' } }
    const before = this.now()
    // Advance the platform clock when it exists: this is what ActiveEffect
    // durations and Times Up read. If it is absent (or does not move) the
    // persisted clock is still authoritative for the CoC rules.
    if (this.gameTime() > 0 && typeof game.time?.advance === 'function') {
      try { await game.time.advance(delta) } catch { /* platform clock absent */ }
    }
    const after = Math.max(this.gameTime(), before) + (this.gameTime() > before ? 0 : delta)
    await this.save(Math.max(after, this.stored()), { force: true })
    const now = this.now()
    return {
      advanced: now - before,
      worldTime: now,
      dayIndex: this.dayIndex(now),
      crossedDay: this.dayIndex(now) !== this.dayIndex(before),
    }
  }

  static dayIndex(now = this.now()) {
    return Math.floor(Math.max(0, Number(now) || 0) / DAY_SECONDS)
  }

  static daySequence() {
    return Math.max(0, Math.floor(readNumber(DAY_SEQ, 0)))
  }

  // Stable identity for the current game day. The keeper's explicit "new day"
  // bumps the sequence so the pure core can reject a reused day id.
  static dayId(now = this.now()) {
    return `day-${this.dayIndex(now)}.${this.daySequence()}`
  }

  static async newDayId() {
    if (!isCoC()) { return { error: 'ruleset-not-coc' } }
    if (!this.isWriter()) { return { error: 'not-active-gm' } }
    const next = this.daySequence() + 1
    try { await game.settings.set(NS, DAY_SEQ, next) } catch { return { error: 'write-failed' } }
    return { dayId: `day-${this.dayIndex()}.${next}`, sequence: next, worldTime: this.now() }
  }

  // Load-time restore. Runs on every client so everyone reads the same clock;
  // only the active GM repairs effect start times (a document write).
  static async hydrate() {
    if (!isCoC()) { return { hydrated: false, reason: 'ruleset-not-coc' } }
    const stored = this.stored()
    const live = this.gameTime()
    // Best effort: adopt the persisted value into the platform clock when the
    // platform lost it (the shim starts at 0 after a refresh). Wrapped because
    // core Foundry exposes worldTime as a read-only getter.
    if (stored > 0 && live < stored) {
      try { game.time.worldTime = stored } catch { /* read-only clock: rules use `stored()` */ }
    }
    return { hydrated: true, worldTime: this.now(), stored, live }
  }
}
