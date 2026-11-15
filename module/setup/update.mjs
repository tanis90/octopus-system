/**
 * Perform a system migration for the entire World, applying migrations for Actors, Items, and Compendium packs.
 * @param {object} [options={}]
 * @param {boolean} [options.bypassVersionCheck=false]  Bypass certain migration restrictions gated behind system
 *                                                      version stored in item stats.
 * @returns {Promise}      A Promise which resolves once the migration is completed
 */
import {
  planSkillMigration,
  skillSourceSystem,
} from '../rules/coc-skill-fields.mjs'

const CANONICAL_SKILL_PREFIXES = Object.freeze([
  'system.adjustments.',
  'system.properties.',
  'system.flags.',
  'system.base',
])

// Split a migration plan into schema-safe canonical writes and legacy cleanup.
// Core Foundry can reject unknown legacy fields on a data model; the cleanup is
// applied separately so a rejection can never roll back the canonical values.
const splitSkillUpdates = (updates = {}) => {
  const canonical = {}
  const legacy = {}
  for (const [path, value] of Object.entries(updates)) {
    if (CANONICAL_SKILL_PREFIXES.some((prefix) => path.startsWith(prefix))) canonical[path] = value
    else legacy[path] = value
  }
  return { canonical, legacy }
}

// One-shot, idempotent migration of the legacy flat skill growth fields onto the
// canonical surface. Only `type === 'skill'` documents are touched; every other
// item type keeps its own fields. Canonical values are never overwritten and
// every legacy key found is zeroed (or deleted if the model rejects it) so a
// stale reader cannot double count. Safe to run repeatedly.
export async function migrateSkillFields({ actors = null, items = null } = {}) {
  const skillItems = []
  for (const actor of actors ?? game.actors ?? []) {
    for (const item of actor?.items ?? []) {
      if (item?.type === 'skill') skillItems.push(item)
    }
  }
  for (const item of items ?? game.items ?? []) {
    if (item?.type === 'skill') skillItems.push(item)
  }
  let changed = 0
  let failed = 0
  for (const item of skillItems) {
    const plan = planSkillMigration(skillSourceSystem(item))
    if (!plan.changed) continue
    const { canonical, legacy } = splitSkillUpdates(plan.updates)
    try {
      if (Object.keys(canonical).length) await item.update(canonical)
      if (Object.keys(legacy).length) {
        try {
          await item.update(legacy)
        } catch (error) {
          // Unknown legacy field on this schema: delete it from the raw source
          // instead of leaving a fallback value behind.
          const deletions = {}
          for (const path of Object.keys(legacy)) {
            deletions[path.replace(/^system\./, 'system.-=')] = null
          }
          await item.update(deletions)
        }
      }
      changed += 1
    } catch (error) {
      failed += 1
      console.warn(`BRP: skill field migration failed for ${item?.name ?? item?.id ?? '?'}`, error)
    }
  }
  return { scanned: skillItems.length, changed, failed }
}

export async function updateWorld({ bypassVersionCheck = false } = {}) {
  const currentVersion = game.settings.get("brp", "gameVersion");
  const targetVersion = game.system.version;
  console.log("UPDATE", currentVersion, targetVersion)

    //Migration to 13.1.53
    if (foundry.utils.isNewerVersion('13.1.53', currentVersion ?? '0')) {
      let response = await updateDialog('systems/brp/templates/updates/update13.1.53.hbs')
      if (!response) {
        ui.notifications.warn("Item Migration to Version 13.1.53 cancelled");
        return
      }
      await v13153()
    }

  //Skill growth fields: one-shot, idempotent, type=skill only.
  try {
    const skillFields = await migrateSkillFields()
    if (skillFields.changed || skillFields.failed) {
      console.log("BRP skill field migration", skillFields)
    }
  } catch (error) {
    console.error('BRP skill field migration failed', error)
  }

  await game.settings.set("brp", "gameVersion", targetVersion);
}

export async function updateDialog(msg) {
  const content = await foundry.applications.handlebars.renderTemplate(msg)
  const response = await foundry.applications.api.DialogV2.prompt({
    position: {
      width: 500,
      height: 450,
    },
    classes: ['brp', 'item'],
    window: {
      title: "Update",
    },
    content,
    modal: true
  })
  return response
}



export async function v13153() {
  console.log("Updating  NPC & Character Notes")
  for (let actor of game.actors) {
    if (actor.type === 'npc') {
      let newNotes = actor.system.description
      if (newNotes === "") { continue }
      if (actor.system.extDesc != "") {
        newNotes = actor.system.extDesc + "<p><strong>Legacy Notes</strong)</p><p>" + newNotes + "</p>"
      }
      await actor.update({
        'system.extDesc': newNotes,
        'system.description': ""
      })
    } else if (actor.type === 'character') {
        let newStories = actor.system.stories
              ? foundry.utils.duplicate(actor.system.stories)
              : []
        if (actor.system.background != "") {
          newStories.push({
            title: game.settings.get('brp', 'background1'),
            value: actor.system.background
          })
        }
        if (actor.system.biography != "") {
          newStories.push({
            title: game.settings.get('brp', 'background1'),
            value: actor.system.biography
          })
        }
        if (actor.system.backstory != "") {
          newStories.push({
            title: game.settings.get('brp', 'background1'),
            value: actor.system.backstory
          })
        }
        await actor.update({"system.stories": newStories})
    }
  }

  //Migrate Compendium Packs
  for (const pack of game.packs) {
    if (pack.metadata.packageType === "system") { continue }
    if (pack.documentName != "Actor") { continue }
    console.log("Updating: ",pack.metadata.packageName)
    // Unlock the pack for editing
    const wasLocked = pack.locked;
    await pack.configure({ locked: false });
    // Begin by requesting server-side data model migration and get the migrated content
    const documents = await pack.getDocuments();
    for (let doc of documents) {
      if (doc.type === 'npc') {
        let newNotes = doc.system.description
        if (newNotes === "") { continue }
        if (doc.system.extDesc != "") {
          newNotes = doc.system.extDesc + "<p><strong>Legacy Notes</strong)</p>" + newNotes
        }
        await doc.update({
          'system.extDesc': newNotes,
          'system.description': ""
        })
      } else if (actor.type === 'character') {
        let newStories = actor.system.stories
              ? foundry.utils.duplicate(actor.system.stories)
              : []
        if (actor.system.background != "") {
          newStories.push({
            title: game.settings.get('brp', 'background1'),
            value: actor.system.background
          })
        }
        if (actor.system.biography != "") {
          newStories.push({
            title: game.settings.get('brp', 'background1'),
            value: actor.system.biography
          })
        }
        if (actor.system.backstory != "") {
          newStories.push({
            title: game.settings.get('brp', 'background1'),
            value: actor.system.backstory
          })
        }
        await actor.update({"system.stories": newStories})
      }
    }
    await pack.configure({ locked: wasLocked });
  }
  console.log("Update Complete")

}
