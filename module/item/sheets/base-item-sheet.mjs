import { BRPIDEditor } from "../../brpid/brpid-editor.mjs";

const { api, sheets } = foundry.applications;

export class BRPItemSheetV2 extends api.HandlebarsApplicationMixin(sheets.ItemSheetV2) {
  constructor(options = {}) {
    super(options);
  }

  static DEFAULT_OPTIONS = {
    classes: ['brp', 'sheet', 'item'],
    position: {
      width: 520,
      height: 620
    },
    window: {
      resizable: true,
    },
    tag: "form",
    form: {
      submitOnChange: true,
    },
    actions: {
      onEditImage: this._onEditImage,
      editBRPid: this._onEditBRPid,
    }
  }

  //Add BRPID Editor Button as seperate icon on the Window header
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    //define button
    const sheetBRPID = this.item.flags?.brp?.brpidFlag;
    const noId = (typeof sheetBRPID === 'undefined' || typeof sheetBRPID.id === 'undefined' || sheetBRPID.id === '');
    //add button
    const label = game.i18n.localize("BRP.BRPIDFlag.id");
    const brpidEditor = `<button type="button" class="header-control icon fa-solid fa-fingerprint ${noId ? 'edit-brpid-warning' : 'edit-brpid-exisiting'}"
        data-action="editBRPid" data-tooltip="${label}" aria-label="${label}"></button>`;
    let el = this.window.close;
    while (el.previousElementSibling.localName === 'button') {
      el = el.previousElementSibling;
    }
    el.insertAdjacentHTML("beforebegin", brpidEditor);
    return frame;
  }

  async _prepareContext(options) {
    return {
      editable: this.isEditable,
      owner: this.document.isOwner,
      limited: this.document.limited,
      item: this.item,
      flags: this.item.flags,
      system: this.item.system,
      hasOwner: this.item.isEmbedded === true,
      isGM: game.user.isGM,
      itemType: game.i18n.localize('TYPES.Item.' + this.item.type),
      headerDisplay: false,
      useWealth: game.settings.get('brp', 'useWealth'),
      wealthLabel: game.settings.get('brp', 'wealthLabel'),
    }
  }

  //------------ACTIONS-------------------

  // Change Image
  static async _onEditImage(event, target) {
    const attr = target.dataset.edit;
    const current = foundry.utils.getProperty(this.document, attr);
    const { img } = this.document.constructor.getDefaultArtwork?.(this.document.toObject()) ??
      {};
    const fp = new foundry.applications.apps.FilePicker({
      current,
      type: 'image',
      redirectToRoot: img ? [img] : [],
      callback: (path) => {
        this.document.update({ [attr]: path });
      },
      top: this.position.top + 39,
      left: this.position.left + 9,
    });
    return fp.browse();
  }

  // Handle editBRPid action
  static _onEditBRPid(event, target) {
    event.stopPropagation(); // Don't trigger other events
    if (event.detail > 1) return; // Ignore repeated clicks
    new BRPIDEditor({ document: this.document }, {}).render(true, { focus: true })
  }
}

export class BRPCoCItemSheet extends BRPItemSheetV2 {
  // CoC7-native types only carry a description plus their own system fields.
  // This shell renders one details tab and the native description object
  // (`system.description.value`), so a new type never falls back to the BRP
  // string/`gmDescription` template.
  static DEFAULT_OPTIONS = {
    ...BRPItemSheetV2.DEFAULT_OPTIONS,
    classes: ['brp', 'sheet', 'item', 'coc-item'],
    position: {
      width: 560,
      height: 660
    },
    actions: {
      onEditImage: this._onEditImage,
    }
  }

  static PARTS = {
    header: { template: 'systems/brp/templates/item/item.header.hbs' },
    tabs: { template: 'systems/brp/templates/global/parts/tab-navigation.hbs' },
    description: { template: 'systems/brp/templates/item/coc7.description.hbs' },
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options)
    context.headerDisplay = false
    context.tabs = this._getTabs(this.options.parts ?? Object.keys(this.constructor.PARTS))
    return context
  }

  async _preparePartContext(partId, context) {
    if (partId === 'details') context.tab = context.tabs[partId]
    if (partId === 'description') {
      context.tab = context.tabs[partId]
      context.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        this.item.system.description?.value ?? '',
        {
          secrets: this.document.isOwner,
          rollData: this.document.getRollData(),
          relativeTo: this.document,
        }
      )
    }
    return context
  }

  _getTabs(parts) {
    const tabGroup = 'primary'
    if (!this.tabGroups[tabGroup]) this.tabGroups[tabGroup] = 'description'
    return parts.reduce((tabs, partId) => {
      if (partId === 'header' || partId === 'tabs') return tabs
      tabs[partId] = {
        cssClass: this.tabGroups[tabGroup] === partId ? 'active' : '',
        group: tabGroup,
        id: partId,
        icon: '',
        label: 'BRP.' + partId,
      }
      return tabs
    }, {})
  }
}
