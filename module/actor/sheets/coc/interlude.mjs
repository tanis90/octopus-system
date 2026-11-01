import { buildCocSkillGroups } from './view-data.mjs'
import { settleCocInterlude } from './interlude-settlement.mjs'

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

export class CocInterludeSheet extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options)
    this.actor = this.options.document
    this.selectedIds = [...this.actor.items]
      .filter((item) => item.type === 'skill' && item.system?.improve === true && item.system?.noXP !== true)
      .map((item) => item.id)
    this.result = null
    this.busy = false
    this.manualIds = []
    this.requestId = foundry.utils.randomID()
  }

  static DEFAULT_OPTIONS = {
    classes: ['brp', 'coc-interlude'],
    position: { width: 680, height: 'auto' },
    window: { title: '幕间结算', resizable: true },
    actions: {
      add: CocInterludeSheet._onAdd,
      remove: CocInterludeSheet._onRemove,
      cancel: CocInterludeSheet._onCancel,
      settle: CocInterludeSheet._onSettle,
      done: CocInterludeSheet._onDone,
    },
  }

  static PARTS = {
    main: { template: 'systems/brp/templates/actor/coc/interlude.hbs' },
  }

  async _prepareContext() {
    const items = [...this.actor.items]
    const selected = this.selectedIds.map((id) => items.find((item) => item.id === id)).filter(Boolean)
    const available = items.filter((item) => item.type === 'skill' && item.system?.noXP !== true && !this.selectedIds.includes(item.id))
    return {
      selected,
      groups: buildCocSkillGroups(available),
      result: this.result,
      busy: this.busy,
      canConfirm: this.selectedIds.length > 0 || items.some((item) => item.system?.improve === true && !this.selectedIds.includes(item.id)),
    }
  }

  static async _onAdd(event, target) {
    event.preventDefault()
    const itemId = target.closest('.item')?.dataset.itemId
    const item = this.actor.items.get(itemId)
    if (!item || item.type !== 'skill' || item.system?.noXP === true) return
    if (!this.selectedIds.includes(itemId)) this.selectedIds.push(itemId)
    if (!this.manualIds.includes(itemId)) this.manualIds.push(itemId)
    await this.render()
  }

  static async _onRemove(event, target) {
    event.preventDefault()
    const itemId = target.closest('.item')?.dataset.itemId
    this.selectedIds = this.selectedIds.filter((id) => id !== itemId)
    this.manualIds = this.manualIds.filter((id) => id !== itemId)
    await this.render()
  }

  static async _onCancel(event) {
    event.preventDefault()
    await this.close()
  }

  static async _onSettle(event) {
    event.preventDefault()
    if (this.busy) return
    this.busy = true
    try {
      this.result = await settleCocInterlude(this.actor, this.actor.token, this.selectedIds, {
        manualIds: this.manualIds,
        requestId: this.requestId,
      })
      if (this.result.error) {
        ui.notifications.error(this.result.error)
        this.result = null
      }
    } finally {
      this.busy = false
      await this.render()
    }
  }

  static async _onDone(event) {
    event.preventDefault()
    await this.actor.sheet.render(true)
    await this.close()
  }

  _onRender() {
    this._abort?.abort()
    const controller = this._abort = new AbortController()
    const { signal } = controller
    const root = this.element
    const details = root.querySelector('.coc-interlude-add')
    const search = root.querySelector('[data-coc-interlude-search]')
    if (!search || !details) return
    const visibleAddButtons = () => [...root.querySelectorAll('[data-coc-interlude-skill]')]
      .filter((row) => !row.hidden && row.closest('[data-coc-interlude-group]')?.hidden !== true)
      .map((row) => row.querySelector('[data-action="add"]'))
      .filter(Boolean)
    const closeOptions = () => details.removeAttribute('open')
    const filter = () => {
      const query = search.value.trim().toLowerCase()
      root.querySelectorAll('[data-coc-interlude-group]').forEach((group) => {
        let visible = 0
        group.querySelectorAll('[data-coc-interlude-skill]').forEach((row) => {
          row.hidden = query.length > 0 && !row.dataset.name.toLowerCase().includes(query)
          if (!row.hidden) visible += 1
        })
        group.hidden = query.length > 0 && visible === 0
      })
    }
    search.addEventListener('input', filter, { signal })
    details.addEventListener('toggle', () => {
      if (!details.open) return
      const active = document.activeElement
      if (active === search || active?.closest?.('[data-action="add"]')) return
      search.focus()
    }, { signal })
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!details.open) return
        event.preventDefault()
        closeOptions()
        search.focus()
        return
      }
      if (event.key === 'Enter') {
        if (event.target !== search) return
        event.preventDefault()
        visibleAddButtons()[0]?.click()
        return
      }
      if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !details.open) return
      const buttons = visibleAddButtons()
      if (!buttons.length) return
      event.preventDefault()
      const index = buttons.indexOf(event.target.closest?.('[data-action="add"]'))
      if (index === -1) {
        buttons[event.key === 'ArrowDown' ? 0 : buttons.length - 1]?.focus()
        return
      }
      const next = Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
      buttons[next]?.focus()
    }, { signal })
    document.addEventListener('click', (event) => {
      if (!details.open || details === event.target || details.contains(event.target)) return
      closeOptions()
    }, { signal })
  }

  _onClose(options) {
    this._abort?.abort()
    this._abort = null
    return super._onClose(options)
  }
}
