import { BRPActorSheetV2 } from '../base-actor-sheet.mjs'
import { CocNpcSheet } from './npc.mjs'
import { buildCocVehicleView } from './vehicle-view-data.mjs'

export class CocVehicleSheet extends CocNpcSheet {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(CocNpcSheet.DEFAULT_OPTIONS, {
    classes: ['coc-card', 'coc-npc-card', 'coc-vehicle-card'],
    position: { width: 680, height: 600 },
  }, { inplace: false })

  static PARTS = {
    header: { template: 'systems/brp/templates/actor/coc/paper-vehicle-header.hbs' },
    vehicle: { template: 'systems/brp/templates/actor/coc/paper-vehicle.hbs', scrollable: [''] },
  }

  _configureRenderOptions(options) {
    super._configureRenderOptions(options)
    options.parts = ['header', 'vehicle']
  }

  async _prepareContext(options) {
    const context = await BRPActorSheetV2.prototype._prepareContext.call(this, options)
    const view = buildCocVehicleView(this.actor)
    const editor = foundry.applications.ux.TextEditor.implementation
    const content = view.powers[0]?.description ?? ''
    if (view.powers[0]) {
      view.powers[0].descriptionHtml = content
        ? await editor.enrichHTML(content, { async: true, secrets: this.document.isOwner, rollData: this.actor.getRollData(), relativeTo: this.actor })
        : ''
    }
    view.noteHtml = view.note
      ? await editor.enrichHTML(view.note, { async: true, secrets: this.document.isOwner, rollData: this.actor.getRollData(), relativeTo: this.actor })
      : ''
    view.vehicle.descriptionHtml = view.vehicle.description
      ? await editor.enrichHTML(view.vehicle.description, { async: true, secrets: this.document.isOwner, rollData: this.actor.getRollData(), relativeTo: this.actor })
      : ''
    view.vehicle.keeperHtml = view.vehicle.keeper
      ? await editor.enrichHTML(view.vehicle.keeper, { async: true, secrets: this.document.isOwner, rollData: this.actor.getRollData(), relativeTo: this.actor })
      : ''
    const canEditSheet = this.isEditable === true
    if (!game.user.isGM) view.vehicle.keeper = ''
    return Object.assign(context, {
      cocNpc: view,
      canEditSheet,
      isCoCUse: !canEditSheet,
      isCoCEdit: false,
    })
  }
}
