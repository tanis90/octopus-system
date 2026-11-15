import { CocCharacterSheet } from '../actor/sheets/coc/character.mjs';
import { CocNpcSheet } from '../actor/sheets/coc/npc.mjs';
import { CocVehicleSheet } from '../actor/sheets/coc/vehicle.mjs';
import { BRPSkillSheet } from '../item/sheets/skill.mjs';
import { BRPWeaponSheet } from '../item/sheets/weapon.mjs';
import { BRPArmorSheet } from '../item/sheets/armor.mjs';
import { BRPBookSheet } from '../item/sheets/book.mjs';
import { BRPOccupationSheet } from '../item/sheets/occupation.mjs';
import { BRPSpellSheet } from '../item/sheets/spell.mjs';
import { BRPRollTableConfig } from '../sheets/brp-roll-table-config.mjs';
import { BRPJournalSheet } from '../sheets/brp-journal-sheet.mjs';


export function registerSheets() {

  const { sheets } = foundry.applications;
  let { collections } = foundry.documents;


  foundry.documents.collections.Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
  foundry.documents.collections.Actors.registerSheet('brp', CocCharacterSheet, {
    types: ['character'],
    makeDefault: true
  })

  foundry.documents.collections.Actors.registerSheet('brp', CocNpcSheet, {
    types: ['npc', 'creature'],
    makeDefault: true
  })

  foundry.documents.collections.Actors.registerSheet('brp', CocVehicleSheet, {
    types: ['vehicle'],
    makeDefault: true
  })

  foundry.documents.collections.Items.unregisterSheet('core', foundry.appv1.sheets.ItemSheet)
  collections.Items.unregisterSheet("core", sheets.ItemSheetV2);
  foundry.documents.collections.Items.registerSheet('brp', BRPSkillSheet, {
    types: ['skill'],
    makeDefault: true
  })

  foundry.documents.collections.Items.registerSheet('brp', BRPWeaponSheet, {
    types: ['weapon'],
    makeDefault: true
  })

  foundry.documents.collections.Items.registerSheet('brp', BRPArmorSheet, {
    types: ['armor'],
    makeDefault: true
  })

  foundry.documents.collections.Items.registerSheet('brp', BRPBookSheet, {
    types: ['book'],
    makeDefault: true
  })

  foundry.documents.collections.Items.registerSheet('brp', BRPOccupationSheet, {
    types: ['occupation'],
    makeDefault: true
  })

  foundry.documents.collections.Items.registerSheet('brp', BRPSpellSheet, {
    types: ['spell'],
    makeDefault: true
  })

  foundry.documents.collections.RollTables.unregisterSheet('core', foundry.applications.sheets.RollTableSheet)
  foundry.documents.collections.RollTables.registerSheet('brp', BRPRollTableConfig, {
    makeDefault: true
  })

  foundry.documents.collections.Journal.unregisterSheet('core', foundry.appv1.sheets.JournalSheet)
  foundry.documents.collections.Journal.registerSheet('brp', BRPJournalSheet, {
    makeDefault: true
  })
}
