import { BRPCoCItemSheet } from "./base-item-sheet.mjs";

const ADJUSTMENTS = ['base', 'personal', 'occupation', 'archetype', 'experiencePackage', 'experience']

const PROPERTIES = [
  ['push', '可推', 'push'],
  ['fighting', '格斗', 'fighting'],
  ['firearm', '枪械', 'firearm'],
  ['ranged', '远程', 'ranged'],
  ['special', '特殊', 'special'],
  ['noxpgain', '不可成长', 'noxpgain'],
  ['rarity', '稀有', 'rarity'],
  ['requiresname', '需要名称', 'requiresname'],
  ['picknameonly', '仅选名称', 'picknameonly'],
  ['own', '自有', 'own'],
  ['keepbasevalue', '保留基础值', 'keepbasevalue'],
]

const ADJUSTMENT_LABELS = {
  base: '基础',
  personal: '兴趣',
  occupation: '职业',
  archetype: '原型',
  experiencePackage: '经验包',
  experience: '成长',
}

export class BRPSkillSheet extends BRPCoCItemSheet {
  static DEFAULT_OPTIONS = {
    ...BRPCoCItemSheet.DEFAULT_OPTIONS,
    classes: ['skill'],
    position: {
      width: 560,
      height: 680
    },
    form: {
      handler: BRPSkillSheet.mySkillHandler,
      submitOnChange: true,
    },
  }

  static PARTS = {
    ...BRPCoCItemSheet.PARTS,
    details: {
      template: 'systems/brp/templates/item/skill.detail.hbs',
      scrollable: ['']
    },
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options)
    const system = this.item.system ?? {}
    context.adjustmentRows = ADJUSTMENTS.map((key) => ({
      key,
      label: ADJUSTMENT_LABELS[key],
      value: Number(system.adjustments?.[key] ?? 0),
    }))
    context.propertyRows = PROPERTIES.map(([key, label]) => ({
      key,
      label,
      checked: system.properties?.[key] === true,
    }))
    context.skillTotal = Number(system.base ?? 0)
      + ADJUSTMENTS.reduce((total, key) => total + Number(system.adjustments?.[key] ?? 0), 0)
    return context
  }

  static async mySkillHandler(event, form, formData) {
    const skillName = String(formData.object['system.skillName'] ?? this.item.system.skillName ?? '').trim()
    if (skillName) {
      const specialization = String(formData.object['system.specialization'] ?? this.item.system.specialization ?? '').trim()
      formData.object.name = specialization ? `${skillName} (${specialization})` : skillName
    }
    await this.document.update(formData.object)
  }
}
