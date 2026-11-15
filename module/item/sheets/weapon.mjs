import { BRPCoCItemSheet } from "./base-item-sheet.mjs";

const RANGES = ['normal', 'long', 'extreme']

const RANGE_LABELS = {
  normal: '常规',
  long: '远程',
  extreme: '极限',
}

const PROPERTIES = [
  ['rngd', '远程'],
  ['mnvr', '机动'],
  ['thrown', '投掷'],
  ['shotgun', '霰弹'],
  ['dbrl', '双管'],
  ['impl', '穿刺'],
  ['brst', '连发'],
  ['auto', '全自动'],
  ['ahdb', '半DB'],
  ['addb', '加DB'],
  ['slnt', '消音'],
  ['spcl', '特殊'],
  ['mont', '架设'],
  ['blst', '爆炸'],
  ['stun', '眩晕'],
  ['rare', '稀有'],
  ['burn', '燃烧'],
]

export class BRPWeaponSheet extends BRPCoCItemSheet {
  static DEFAULT_OPTIONS = {
    ...BRPCoCItemSheet.DEFAULT_OPTIONS,
    classes: ['weapon'],
    position: {
      width: 620,
      height: 700
    },
  }

  static PARTS = {
    ...BRPCoCItemSheet.PARTS,
    details: {
      template: 'systems/brp/templates/item/weapon.detail.hbs',
      scrollable: ['']
    },
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options)
    const system = this.item.system ?? {}
    context.rangeRows = RANGES.map((key) => ({
      key,
      label: RANGE_LABELS[key],
      value: system.range?.[key]?.value ?? '',
      damage: system.range?.[key]?.damage ?? '',
    }))
    context.propertyRows = PROPERTIES.map(([key, label]) => ({
      key,
      label,
      checked: system.properties?.[key] === true,
    }))
    return context
  }
}
