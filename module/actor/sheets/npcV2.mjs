import { BRPActorSheetV2 } from "./base-actor-sheet.mjs";

export class BRPNPCSheetV2 extends BRPActorSheetV2 {
  constructor(options = {}) {
    super(options)
  }

  static DEFAULT_OPTIONS = {
    classes: ['npcv2'],
    position: {
      width: 610,
      height: 770
    },
    window: {
      resizable: true,
    },
  }

  // Activate the shared drag-and-drop and inline-edit handlers. The CoC NPC
  // sheet supplies its own PARTS/tabs; this class is only the options base.
  _onRender(context, _options) {
    this._dragDrop.forEach((d) => d.bind(this.element));
    this.element.querySelectorAll('.inline-edit').forEach(n => n.addEventListener("change", BRPActorSheetV2.skillInline.bind(this)))
  }
}
