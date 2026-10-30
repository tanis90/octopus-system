# CHANGE LOG

## 0.3.1-dev (unreleased)
Fork development snapshot on top of d5d4a22 / v0.3.0. Not tagged or released; do not ship as v0.3.0.
- NPC/combat: resolving a CB card no longer throws when an entry has no `skillId` (NPC weapons); auto-XP off no longer ticks XP on card resolve.
- NPC HP semantics documented and regression-locked: non-HPL NPC current HP is the native roll/average `updateVitals` fill or a keeper hand edit, not character-style wound derivation; wounds remain character/HPL-only.
- Luck: concurrent spends on the same card are serialized; all chat-button clients route to Foundry's deterministic `activeGM` single writer (no backend endpoint); real card path re-renders adjusted result.
- SAN: keeper "New Day" action clears `dailyLoss`; deleting, disabling or world-time-expiring the `tempInsane` effect marks the episode card ended and re-renders it.
- Character sheet: new PCs default to use mode (`system.lock=true`); a single native Edit/Use toggle at the far left of the window header drives the existing `actorToggle`/lock action and normal-list/dev-grid view. The duplicate body lock control is removed. Existing unlocked actors stay unlocked; NPCs are unchanged.
- Stats: the canonical characteristic key is `cha` (template/schema). The d100 creator and card adapter must write/read `cha`; no `app` alias or migration is provided. Test cards written with `app` are invalid and must be rebuilt.
- Character creation: every new character gets one real `徒手（斗殴）` weapon linked to `i.skill.brawl` (`1D3`, full Damage Modifier, Crushing, Short, 1H, no Parry). The attack reads Brawl's live total; no hit score is persisted. Brawl is added alone when starter skills are off. Existing actors, imports and NPCs are not migrated.
- Character sheet: the combat weapon row now falls back to a `0` category bonus when the active ruleset has no skill categories (`skillcategory` empty, e.g. CoC core skills). Weapon hit scores stay numeric instead of rendering `NaN`; rulesets with categories are unchanged.
- Base pack: profession ref UUIDs are reproduced from the committed seed and have a deterministic fallback; consecutive builds are byte-identical without an ID migration.
- Tests: `tools/tests/rules-regressions.mjs` (harness, 78 checks including PC use/edit mode, Unarmed, CoC native path and the CoC weapon-row fallback) and `tools/tests/base-pack-determinism.mjs` (Node).
- Docs: Luck is spend-to-lower, not a re-roll; Chinese README wording aligned.

### CoC 7e M1 (experimental, opt-in)
- New isolated content pack `coc-skills`: 51 core-skill documents (13 specialisms) built from `content/coc/skills.json`; 7 unverified specialisms stay `pending-official-source` with no fixed value and are not emitted. Octopus packs remain byte-identical.
- New centralized rules seam `module/rules/` (`octopus` default, `coc` opt-in through hidden world setting `brp.ruleset`). External `coc7` (backend catalog/settingsSeed value) maps explicitly to the internal `coc` adapter; `coc` remains accepted; unknown values fall back to `octopus`, never CoC. Derived HP/MP/SAN/Luck/Build/DB/MOV, success bands, growth and starter selection delegate through the interface; no scattered `if (coc)` in public shims.
- CoC facts: HP `floor((CON+SIZ)/10)`, MP `floor(POW/5)`, SAN start POW / max `99 - Cthulhu Mythos`, Luck `3D6×5`, official Build/DB table, MOV by DEX/STR/SIZ and age, APP mapped to native `cha`, EDU enabled.
- CoC success bands: 01 critical, ≤1/5 extreme, ≤1/2 hard, ≤ skill regular; fumble 96–100 below skill 50, otherwise 100. Native `BRPCheck` delegates to the ruleset; `successBand()` exposes the full six-band label.
- Growth delegates to CoC: `1D100 > skill` then `+1D10`, no INT bonus. Dodge uses ½ DEX and mother tongue uses EDU via native `variable`/`baseFormula` with round-down.
- Starter isolation: CoC gets only CoC skills and no BRP skill categories; octopus keeps 57 skills + 6 categories. Brawl uses `i.skill.coc.fighting-brawl` for CoC. Imported/old actors and NPCs are not migrated.
- Not covered in M1: occupation creation, credit-rating spend ranges, full combat, full SAN/insanity and luck-spend flows. The CoC card adapter and backend profile/catalog live in the compat repo. VTT licensing still needs a separate review: Chaosium's Fan Material Policy excludes VTTs, and this repository's own code is not a licence.
- Tests: `tools/tests/coc-rules-regressions.mjs` (35 Node checks at M1 time; see the M2 section for the expanded set) and `tools/tests/rules-regressions.mjs` (78 headless checks, 17 CoC incl. the numeric weapon row). `base-pack-determinism` scoped to octopus artifacts so the new pack cannot mask base-pack drift.

### CoC 7e M2 (experimental, opt-in): occupations, credit rating and allocation

First public batch only: ten occupations whose point formula and credit-rating
range could be checked against a public occupation page. Occupations without those
facts are not buildable defaults and are not present.

- Data: new `content/coc/professions.json` (Archaeologist, Author, Cat Burglar,
  Dilettante, Explorer, Investigative Journalist, Nurse, Private Investigator,
  Professor, Soldier). Each record carries a stable ASCII slug, display names,
  fixed skills, choice groups (skill / family / open "any"), a whitelisted point
  formula and a credit-rating range. Evidence is recorded as **secondary** in
  `content/coc/provenance.json` (`coc-roll20-occupations`, per-occupation
  formula/range/page). No official text, layout or asset is copied.
- Pack: `tools/coc-pack/build.mjs` now also emits an independent
  `coc-professions` pack (packs-json / packs-index / folder pack) and registers it
  in `system.json`. Every document has `flags.brp.contentSource="coc"` and
  `flags.brp.coc` with `slug`/`creditMin`/`creditMax`/`pointFormula`. The
  `coc-skills` and all octopus packs stay byte-identical.
- Credit rating: kept separate from the UGE wealth band (`minWealth`/`maxWealth`
  are `0`, `wealthNotApplicable` marks them as not CR). A profession without a
  verified formula or range fails the build instead of falling back to a default.
- New shared pure module `module/rules/creation.mjs` (framework-free, no `eval`):
  `evaluatePointFormula` (whitelist/AST over `EDU*4`, `EDU*2+DEX*2`,
  `EDU*2+APP*2`, `EDU*2+MAX(APP,DEX,STR)*2`, `EDU*2+MAX(DEX,STR)*2`),
  `interestPoints` (INT×2), `validateAllocation` (occupation budget, interest
  budget, credit rating from occupation points inside the range, Cthulhu Mythos
  never allocatable, explicit base required for unverified skills, no folding into
  `base`), plus `specialismKey`/`specialismBrpid`/`buildSpecialism` identity
  helpers (ASCII brpid + specKey, `chosen`/`specName`/`mainName`, no CJK kebab,
  no `any` placeholder).
- Not in M2 source scope: the `studio-coc` wizard, card adapter and backend
  catalog (compat repo), the remaining occupations, age/asset tables, full combat,
  full SAN/insanity and luck-spend flows.
- Tests: `tools/tests/coc-rules-regressions.mjs` expands from 35 to 69 checks; `tools/tests/rules-regressions.mjs` goes from 78 to 81 headless checks (3 new: `coc-professions` loads through the real compendium path, its documents carry CR/formula and not wealth bands, and every profession skill ref resolves to a CoC skill in-world).
  New coverage: per-occupation formula and credit range against the recorded
  source, wealth band never used as CR, skill refs resolving to CoC documents,
  deterministic profession ids, whitelist AST acceptance/rejection (illegal,
  unknown stat, single-argument MAX, missing/negative stats), INT×2, CR rules,
  mythos ban, base-value explicit/explicit-zero/missing, no base folding,
  specialism identity and allocation. Build determinism and the byte-unchanged
  octopus artifacts remain asserted.

### CoC 7e M5 (experimental, opt-in): five specialisms, five occupations, either/or point formulas

Source-repo slice only; no vendor sync into the compat worktree, no browser run
and no E2E is claimed. The compat-repo wizard/adapter is **not** wired for M5.

- Skills: `coc-skills` grows from 51 to 56 documents and from 13 to 18
  specialisms. New: Science (Pharmacy), Science (Engineering),
  Science (Physics) at family base 1, and Art/Craft (Acting), Art/Craft
  (Technical Drawing) at family base 5. `skillFamilies.concrete` in
  `content/coc/professions.json` lists exactly the published specialisms; the
  build and the regression reject both a published-but-unlisted specialism and a
  listed-but-unpublished one. The octopus/UGE skill set (57) and its pack bytes
  are unchanged.
- Occupations: `coc-professions` grows from 10 to 15. Doctor of Medicine
  (`EDU*4`, CR 30–80), Police Detective (`EDU*2+DEX*2` **or** `EDU*2+STR*2`,
  CR 20–50), Librarian (`EDU*4`, CR 9–35), Lawyer (`EDU*4`, CR 30–80),
  Engineer (`EDU*4`, CR 30–60). Each record has exactly eight occupation skills
  (fixed skills + the sum of the choice-group picks); the build and the
  regression both assert the count and the exact skill shape.
- Either/or formulas: a profession record may carry `pointFormulas` (ordered
  list, player picks one) instead of `pointFormula`. Both at once is a build
  error; a `pointFormulas` with fewer than two entries is also an error. The
  emitted document keeps `pointFormula` as the first option for backward
  compatibility and adds `pointFormulas` for the UI.
- Police Detective is deliberately not modelled as `MAX(DEX,STR)`: that would
  hand out a strictly larger pool than the published "DEX × 2 or STR × 2".
- Lawyer's "two interpersonal skills" is recorded as `choose: 2` +
  `distinct: true`, i.e. two *different* skills out of Charm/Fast Talk/
  Intimidate/Persuade. This is the product reading of an ambiguous phrase and is
  documented as such in `content/coc/provenance.json`.
- `module/rules/creation.mjs`: `POINT_FORMULAS` gains `EDU*2+STR*2` (six
  entries). No existing formula result changes — `EDU*4`, `EDU*2+DEX*2`,
  `EDU*2+APP*2`, `EDU*2+MAX(APP,DEX,STR)*2` and `EDU*2+MAX(DEX,STR)*2` are
  pinned individually. Adds `normalizePointFormulas(source)` /
  `isSupportedPointFormulas(source)`; `professionRules()` emits both
  `pointFormula` and `pointFormulas`; `validateAllocation({ ..., pointFormula })`
  accepts a pinned choice and reports `formula-choice-required` with a `null`
  budget when an either/or profession has none (never a silent first-or-max
  pick); `budgets.occupation.formulas` lists `{ formula, max }` per option.
- Evidence: all five occupations stay `evidence: "secondary"`. Doctor of
  Medicine and Police Detective cite the Roll20 compendium plus the public
  Chaosium wiki; Librarian, Lawyer and Engineer have no licensed compendium page
  and rest on a three-way cross-check of Gamers' Plane, callofcthulhu.org.uk and
  RPG Stack. No record claims an official first-party source, and the three
  new source entries carry their own `secondary` note.
- Tests: `tools/tests/coc-rules-regressions.mjs` expands from 107 to 124 checks.
  New coverage: 56/56 skills and 18/18 specialisms, the five new specialisms'
  family base and identity, `skillFamilies.concrete` → published specialisms
  bidirectional agreement, 15/15 professions, per-profession formula list and
  source refs, eight-skill shape for each new profession, Police Detective
  either/or (not MAX) and its distinction from Private Investigator, Lawyer's
  distinct-interpersonal group, whitelist evaluation of `EDU*2+STR*2`, backward
  compatible single/double formula normalization, explicit-formula selection
  (unpinned either/or → `formula-choice-required`, foreign formula →
  `formula-not-allowed`, overspend caught under the chosen pool),
  single-formula budgets unchanged, end-to-end valid allocations for all five
  new professions through the pack documents, and provenance secondary-only /
  no-official-claim / resolvable-source checks.

### CoC 7e M6 (experimental, opt-in): Science (Astronomy), four occupations, POW formula

Source-repo slice only; no vendor sync into the compat worktree and no browser
run is claimed.

- Skills: `coc-skills` grows from 56 to 57 documents and from 18 to 19
  specialisms. Science (Astronomy) takes the Science family base 1, sits under
  the `science` parent and is listed in `skillFamilies.science.concrete`; the
  bidirectional family check keeps working. Professions whose "any Science" slot
  expands the family (e.g. Archaeologist) gain the new option — expected, not a
  data rewrite.
- Occupations: `coc-professions` grows from 15 to 19. Police Officer
  (`EDU*2+DEX*2` **or** `EDU*2+STR*2`, CR 9–30), Artist (`EDU*2+POW*2` **or**
  `EDU*2+DEX*2`, CR 9–50), Clergy (`EDU*4`, CR 9–60) and Pilot
  (`EDU*2+DEX*2`, CR 20–70). Each record has exactly eight occupation skills;
  the exact fixed list and pick shape is asserted in the regression.
- Formula order is the printed order: Artist keeps `POW` before `DEX`, never
  substitutes `APP` and never collapses the pair to `MAX`. Police Officer keeps
  the same either/or pair as Police Detective but is a separate document with a
  different credit band, fixed skills and a Drive Auto-or-Ride slot.
- Pilot fixes Pilot (Aircraft) and Science (Astronomy); Pilot (Boat) is a
  different specialism and is deliberately absent.
- `module/rules/creation.mjs`: `POINT_FORMULAS` gains `EDU*2+POW*2` (seven
  entries). The six existing formulas are pinned to the same results; POW and
  APP do not alias, and a missing POW fails closed with `stat-missing`. The pack
  build gate reuses `isSupportedPointFormulas`, so no second whitelist exists.
- Evidence: all four occupations are `evidence: "secondary"` with `sourceRefs`.
  Artist/Clergy/Police Officer cross-check Gamers' Plane (complete eight-item
  list), callofcthulhu.org.uk (indexed page text; the site returns HTTP 403 to
  direct fetches) and RPG Stack (formula/credit range only). Pilot rests on the
  first two because RPG Stack omits it. RPG Stack truncates every occupation to
  four skills, so each record carries `skillShapeSourceRefs` excluding it; the
  regression rejects citing it for the eight-item shape.
- Psychiatrist is deferred, not guessed: no consulted page prints a complete
  eight-item list, and Doctor of Medicine + Psychoanalysis already covers the
  concept. Registered under `occupations.deferredRecords.psychiatrist`.
- Tests: `tools/tests/coc-rules-regressions.mjs` expands from 124 to 132 checks
  (57/57 skills, 19/19 specialisms, 19/19 professions, four new eight-skill
  shapes, seven-formula evaluation with POW, Artist either/or selection,
  Police Officer vs Police Detective, Astronomy under the Science family,
  RPG Stack truncation boundary and the deferred psychiatrist). The headless
  harness counts move to 57 starter skills and 19 profession documents.
- Build: `packs-json` / `packs-index` / `packs` and `system.json` regenerated;
  octopus artifacts stay byte-identical and consecutive builds are
  deterministic.

### CoC 7e M7 (experimental, opt-in): coc-cardwright batch — 38 occupations, 59 skills, 21 specialisms

- Fact source switched to the user's **coc-cardwright** repository
  (`tanis90/coc-cardwright`, revision `c0a0733`; its README names `trpg-saikou`
  and `cochar` upstream). The earlier public-page splicing is no longer used for
  this batch. Only numeric formulas, credit ranges and skill names are mapped;
  no template, HTML/CSS, Python implementation or other repository code is
  copied.
- Evidence for every record stays **secondary**: the repository is a
  transcription, not a Chaosium first-party publication. The README's upstream
  chain is recorded as a statement, not as independent verification.
- 19 new occupations: Psychiatrist, Museum Curator, Coroner, Judge, Bookseller,
  Antiquarian, Intermediary Investigator, Orderly, Government Official,
  Traveler, Firefighter, Fisherman, Hunter, Pharmacist, Gambler, Tribe Member,
  Spy, Gang Leader, Asylum Orderly. The four M6 records (Police Officer, Artist,
  Clergy, Pilot) are retained and re-sourced to coc-cardwright. Total: **38**.
  Psychiatrist is now buildable, not deferred; its fixed seven include
  Psychoanalysis plus one Other Language. Fisherman fixes Pilot (Boat) and Swim;
  Hunter fixes Science (Zoology) and Track; Coroner fixes Science (Forensics)
  plus one Other Language.
- Only records with a complete eight-item skill shape, a point formula and a
  credit range are imported. coc-cardwright itself carries 112 jobs; this is
  **not the 112-job table**, and no full-occupation coverage is claimed.
- Skills: `coc-skills` grows from 57 to **59** documents and from 19 to **21**
  specialisms. Science (Zoology) and Science (Forensics) are added at the
  Science family base 1; Science (Astronomy) is retained. The bidirectional
  `skillFamilies.science.concrete` check still applies.
- Formulas: `POINT_FORMULAS` gains `EDU*2+POW*2` (**seven** entries). Existing
  six results are unchanged; POW and APP do not alias, and a missing POW fails
  closed with `stat-missing`.
- Private Investigator and Soldier move from `MAX(DEX,STR)` to a real
  `[STR,DEX]` either/or choice; Explorer moves from `MAX(APP,DEX,STR)` to
  `[APP,DEX,STR]`. The budget follows the chosen characteristic; the occupation
  document keeps the actual choice in `pointFormula` and the ordered list in
  `pointFormulas`. No MAX pool is handed out.
- Tests: `tools/tests/coc-rules-regressions.mjs` expands from 132 to **137**
  checks (59/59 skills, 21/21 specialisms, 38/38 occupations, 19 new eight-item
  shapes, seven-formula evaluation, the three real-choice conversions,
  Psychiatrist no longer deferred, Fisherman/Hunter/Coroner key skills,
  secondary-only provenance and the 112-table boundary).
- Build: `packs-json` / `packs-index` / `packs` and `system.json` regenerated;
  consecutive builds are deterministic and octopus artifacts stay byte-identical.
- The compat front-end sync and real-stack 550/550 (dev HS256) are recorded in
  the compat repo's `PROGRESS.md` and `docs/coc-compatibility-contract.md`;
  this source slice does not claim a browser run of its own.

### CoC 7e M8 (experimental, opt-in): SealDice compatibility batch — 156 occupations, 91 skills, 50 specialisms

- New importer `tools/coc-pack/import-sealdice-occupations.mjs` reads the
  SealDice builtin `COC职业查询` helpdoc and imports every formal definition that
  maps onto the existing creation rules. The helpdoc file and its 【介绍】 prose
  are not copied: `sealdice-core` is MIT, but `sealdice-builtins` declares no
  license, so only formulas, credit-rating ranges and skill names are used, and
  every description in `content/coc/professions.json` is original to this repo.
- **118** occupations imported (total **156**). The existing 38 records are
  untouched; Private Investigator / Soldier / Explorer keep their ordered
  either/or formulas and Artist keeps POW. Every imported record has exactly
  eight slots (fixed + choice picks + explicit "any N" picks).
- **187** entries deferred with a category and reason in
  `content/coc/provenance.json`: 79 aliases, 3 malformed entries, 1 custom
  template, 1 missing formula, 44 non-eight-slot lists, 11 unverified skill
  bases, 35 duplicates of existing records, 10 duplicates within the source and
  3 display-name conflicts. The normalized shape proof moves
  古董商/赌徒/黑帮老大/精神病院看护 to duplicate-existing; 艺术家/猎人/渔民 remain
  conflicts because their printed CR/formula/fixed skills really differ.
- Skills grow from 59 to **91** documents and from 21 to **50** specialisms.
  32 concrete skills are added. Members with a same-name `skills.py` row take
  that value; members without one take the open family's verified base and
  `baseSourceRefs`. A printed member value wins over the family default:
  Mathematics 10, Survival (Mountain) **5** (not the Survival family default
  10). The batch also adds Fighting (Sword/Whip/Spear/Chainsaw), Firearms (Bow)
  and the Art/Craft singing/dancing/game/acrobatics/comedy/fitter/calligraphy/
  cooking/tailoring/barber/welding/plumbing members. No value is guessed.
- Point formulas stay on the seven-entry whitelist; no MAX formula is added.
  A parenthetical family list is one choice slot and an explicit "any N" is N
  picks — no unprinted padding. 交际花/劳工 parse to 10/9 real slots and are
  rejected for the slot count, not skipped; 佣人 parses to 8 but Etiquette has
  no family or verified base and is named in the deferred reason.
- Tests: `tools/tests/coc-rules-regressions.mjs` **149/149** (8 slots, formula
  whitelist, CR range, unique identity, resolvable skill refs and verified bases
  for every imported record; categories/reasons for every deferred record;
  normalized duplicate proof; legacy 38 and their real choices preserved).
  Consecutive builds are deterministic and octopus artifacts stay byte-identical.
- Sync target (not executed from this source repo): `web/packages/brp/` in the
  compat repo, byte-for-byte `content/coc/*`, `module/rules/*`, `packs-json/*`,
  `packs-index/*`, `packs/*` and `system.json`.

### CoC 7e M3 (experimental, opt-in): native combat and wounds

Source-repo slice only; no vendor sync, browser run or E2E is claimed.

- Damage bonus/penalty dice: one real `Nd10` percentile pool per check (units +
  1+net tens), `00+0=100`, `00+n=n`, one bonus cancels one penalty. `band`,
  `bandRank`, `diceDetail` (formula, all faces, chosen tens, candidates) and the
  `taskSuccess` result travel on the chat card; CoC CB/OP messages carry the real
  `Roll` in `rolls`.
- Difficulty is the required success band (regular/hard/extreme); the target is
  never multiplied and characteristic tests use the characteristic value itself.
- Weapon skill resolves from `weapon.system.skill1/skill2` brpid (+ specialism
  key) to the live skill total. CoC unarmed is 1D3 + full DB with an explicit
  `flags.brp.coc.weapon` marker; the BRP `special:'crush'` field is ignored. DB:
  melee full, thrown/bow half, firearms none.
- Extreme damage: blunt max weapon + max DB; impaling max weapon + DB + another
  weapon die. `maximize` is not used (the compat Roll ignores it).
- Opposed: band, then skill, then fresh re-rolls on an exact tie (lower d100
  wins). Dodge tie -> defender; fight back needs a strictly higher band and
  deals regular damage only; firearms cannot be fought back and can dive for
  cover (attacker re-rolls with one penalty die, diver forfeits the next attack).
  Shots/point-blank/Build/outnumbering modifiers use only the facts the caller
  supplies.
- Wounds: damage writes `system.health.value` directly and state to
  `flags.brp.coc.wounds` (major wound, dying, dead, unconscious, stabilised).
  No BRP wound items, no `health.daily`, no hit locations; `useHPL` is ignored
  and recorded as `hplIgnored`. Major-wound CON, dying per-round CON (active GM
  in `Combat.nextRound`), instant death, First Aid, Medicine, weekly CON and
  natural healing are implemented as real rolls.
- Native API `game.brp.coc.{attack,defend,resolve,reroll,state,damage,firstAid,
  medicine,weeklyHeal,naturalHeal,dyingRound}`; cross-owner writes and card
  resolutions relay to `game.users.activeGM`. Chat-card buttons are not required.
- Not in M3: weapon catalogue, critical extra effects, burst/full-auto, dual
  wield, aiming, cover values, range-difficulty, monster armour, per-combatant
  readied-firearm initiative, automatic weekly calendar healing, the studio
  combat tab / `attackImplemented`, vendor sync and E2E.
- Tests: `coc-rules-regressions` 98/98; `rules-regressions` 112/112 in a
  temporary compat copy (81 previous + 31 M3); `base-pack-determinism` green.

## 13.57
- If using Random Armour and not using Hits per LOcation, you can now roll the Random Armour Values from the combat tab (bugfix)

## 13.56
- Migration of Github account

## 13.1.55
- A few more damage categories added to weapons
- Weapons can also do double damage bonus

## 13.1.54
- Special Damage and Disease Damage indicators added to weapons
- GIFs and HTML in spell descriptions etc should now appear in Description to Chat rolls
- A series of NPC options added to Base Stats sheet
- Removed gap between NPC sheet and notes
- NPCs no longer add weapon skills when adding a weapon (since they don't use them)
- NPC weapons now have a "Special" damage column added - a red burst indicates special weapon type with a tooltip showing what the damages are (e.g. Poison)
- Item images can be changed once again

## 13.1.53
- The system has moved to V2 Application - and the sheets run in Dark Mode as well.
- Context menus have been removed on the character sheet and replaced with key options or additional icons.  Please see the wiki
- Character Sheet Background Tab is renamed to Story.  You can now add multiple sections each with a title and text to edit.  Existing background entries have been migrated.  Thanks to the Call of Cthulhu system.
- Background Name Game Settings have been removed as now replaced with Story tab.
- When Development Phase is turned on then a new tab appears on the character sheet - you make improvement rolls from here
- Setting colours etc in the Display Options override the values in both Light and Dark Mode.
- There are a few tweaks to the NPC sheet as well (Notes have been migrated to a new tab), there is an ALT MOVE option (Move Notes will be deleted in due course), NPC sheet only shows populated sections when locked
- Character Sheet Combat Tab now shows the Damage Bonus type for each weapon and there's a tooltip on "Damage" to show the Special Damage Type
- There is a new game setting for users to decide if they want the Item sheets to open to the Description tab by default.  Users set this according to their preference rather than at a game level.
- Under Optional Game Rules you can now rename Sanity
- Physical Items (Gear, Weapons and Armour) now let you enter a cost value (e.g. 10) if you've turned off Wealth Levels.
- BRPID Editor no longer errors where game language doesn't have a BRPIDKey list - Thank you to FreeRaisor.

## 13.1.52
- Changes to CCI: Open Document (James B)
- Wound sheet no longer auto closes when making edits

## 13.1.51
-  Missing BRPIDs on actors in world shouldn't stop NPCs being imported
-  Active Effects added to wounds
-  Minor change to tlayout of skills tab on character sheet when unlocked - Cat Bonus is now included in total

## 13.1.50
- Additional CCI option, Ambient Light toggle added
- All CCI show/hide options have become show/hide/toggle

## 13.1.49
- Additional Chaosium Canvas Interface options added

## 13.1.48
- French language pack added thanks to Vonv
- A default scene will be created for new worlds (to help with using GM tools) - thanks to James B
- A Dark/Light mode macro has been added (to help with testing) - thanks to James B

## 13.1.47
- Chaosium Canvas Interface Added thanks to James B

## 13.1.46
- Fixed character sheet so the box doesn't cut through CHA when not using EDU
- Added a game option under "Character Options" to opt to use wealth ratings (default) or use a cash value along with a label for it
- There is now a "+" icon on the Character Sheet Sorcery and Magic tabs that will let you add a spell directly to the character sheet

## 13.1.45
-  Spanish Language pack added courtesy of Adrian_Martin(bakali77)

## 13.1.44
- (Hopefully) this is updated for Foundry V13.
- Please note this version does not support Foundry V12 - please stay on BRP v12.1.43 if you haven't moved to Foundry v13
- And please do back up your world before migtation in case you need to roll back
- The system is stil on Application v1 - the move to v2 will happen in due course
- Please report any issues at https://github.com/Genii-Locorum/brp/issues

## 12.1.43
- Active Effects have been added to Weapons, Armour and Gear.  You can read more at https://github.com/Genii-Locorum/brp/wiki/Active-Effects
- Active Effects do work for Unlinked Actors - when Foundry fix the underlying issue we may see duplicate effects until we remove the fix.
- There is now an Active Effects tab on these item sheets - GMs can edit effects, Players can only view the current effects.
- Weapons and Gear must be carried for the effects to apply, Armour must be worn
- There is a limited list of active effects - these can be added to - please let me have your feedback if there are more to be added
- You can add bonuses to skills, magic and psychic abilities by manually adding a customised data path -  see the Wiki for more info on this.
- There is now an "effects" tab on the character sheet which lists the effects and the item they are attached to.  Click on the Source Item name to open the item sheet.
- This is all the hard work of JamesB.  Thank you so much for this.

## 12.1.42
- Error witn Item "HP and PP" labels showing as undefined fixed.
- Damage to the chest now triggers the correct statuses
- There are icons to the left and right of Hit Points, the sword adds a wound, the heart heals a wound.
- For powers (Magic, Sorcery, Superpower etc) the context menu now has the option to send the item description to the chat window.
- When power roles (Magic, Psychic) are made then the description is also shown in the "hidden" section of the roll.  This only applies to Normal rolls at the moment.
- There's a new Combat game setting that let's you have a "Quick Combat" roll.  This is a non-oppossed combat roll that also shows the damage that would be caused for each success level
- There is now a Custom Resource in the "Optional Rules" menu - you can turn it on/off and give it a label.  It will then appear on the actor sheet.  There is no automation added.
- There is now a Fatigue Point modifier on actors.

## 12.1.41
- Slight tweak to roll cards to centre the first line next to the actor image
- A lot more options to adjust the character sheet - https://github.com/Genii-Locorum/brp/wiki/Game-Settings:-Display-Options
- The character sheet logo setting has moved to the Display Options
- The character sheet visual adjustments are a work in progress - please feedback any other changes needed or areas where the expected results aren't working.
- Instead of selecting to use Magic Points rather than Power Points you can now add a name and abbreviation instead of Power Points/PP - see the Optional Game Rules settings
- You can also change the name and abbreviations for Hit Points and Fatigue Points.
- BRP IDs can be automatically added for Items now - see the BRPID game settings (Actor BRPID has moved here from Char Settings)

## 12.1.40
- Roll chat cards updated to increase size of the actor image and the space for the skill, weapon etc name and there is some additional info in the "expandable" section of the card
- There is now a game setting to choose if you want to show XP & POW Improvement Dice Rolls where you have Dice So Nice module activated.  You could see a lot of dice rolled.
- POW improvement rolls no longer increase POW when the roll is failed (oops).
- When dropping professions etc you should no longer get console errors if actor items don't have BRPIDs.
- There's a new game setting, which if activated, autogenerates the BRP ID for new actors based on the name.  Initially the BRPID fingerprint icon will be orange to warn you.
- Special Weapon Damages are now being applied properly
- Game Settings have been reorganised (the list was getting too long) in to several sub-forms - click on the relevant button to open the subform
- There is a new advances skill category calculation - Negative Secondary - like Secondary but for stat values less than 10
- Where you've added a different label to a Power in game settings this also applies to the list on the relevant character sheet tab and the item sheet.
- Under BRP Game Settings > Display Options there is now two Colour settings to change the main background and secondary background colours on the actor sheet.  Enter a colour reference such as rgba(0,141,142) or #008080.
  These are sort of a test to see if it's what people want.  I will expand the list if it is.

## 12.1.39
- Personal Skill Points are now totalled on the Skills tab, in unlocked mode, under the correct column
- MOVE score added to culture item and added to character sheet along with the culture
- On the character sheet there is now an option under the Skills tab context menu to toggle how the skills are displayed
- When adding a profession to the character you now choose the wealth level.  This can be edited when the character sheet is unlocked.
- On the "CHAR" tab the Redistribute values are no longer manually entered.  When in "Development Mode" and with the character sheet unlocked use the arrows by the
  stats to redistribute stats.  You can only redistribute 3 points and there are min/maxes in place.  Unless the redistributed points net to nil the column is red
- Age has been added to the character sheet neer the top left of the Personal Section
- Clicking on the "Impact" of a Magic Spell or a Psychic Ability on the actor sheet causes an Impact (Damage or Healing) dice roll
- When adding a skill, profession, personality etc the system will check if you have the Skill Category on the character and if not it will add it automatically
- There are two game settings for the initiative formula - select a stat (or none) and enter a modifier.  If your formula is invalid you will get an error message when your world starts and the default formula is used


## 12.1.38
- Context menu for Psychic Abilities now shows XP improvement options when there is an improvement tick and development mode is on
- All improvement checks exclude the item.system.effects score
- Psychic Ability item sheet, when owned, now shows the Improvement button which can be toggled on and off
- Personality Traits now have a "Starter Trait" toggle.
- There is a new game setting "Starter Traits".  If turned on then any new character will, if Personality Traits are used, automatically start with
  any trait which has the "Starter Trait" toggle activated.

## 12.1.37
- Fixed issue with "easy" rolls incorrectly getting XP checks
- Only characters can get XP checks (not NPCs) - this was throwing an error in the console for weapons
- Chat card for skills rolls etc now show the correct actor image where wildcard tokens are used.


## 12.1.36
- The autoXP game setting has changed from a tick box to a drop down selection - None (not auto XP), Any Success (tick XP for success, special success of critical) or On Fail/Fumble.
  Please re-check your setting following world migration, as they are likely to have reset to "none".

## 12.1.35
- Culture now has the correct title on the item sheet
- Failings on the character sheet now display the failing name if the short description is blank
- Where the system can't find a skill category in dice rolls then the Cat Bonus now correctly sets to nil
- There are now game settings to allow you to change the titles of the "power" tabs on the character sheet.  Leave them blank to use the defaults
- You can now click on the skill category in the character sheet skill tab to open up the Skill Category item
- In the skill category, when on a character, you can enter a "manual" modifier that is added to the calculated bonus

## 12.1.34
- Layout of Items on characters now fixed to a consistent grid size
- Culture has been added as an Item.  You can set the characteristic dice rolls and culture bonuses, plus skills with skill modifiers.
- Adding a culture to a character adds the characterstic formulae, bonuses, skills with modifiers.
- When in development mode and with the character sheet unlocked there is a dice icon on the "CHAR" tab that lets you roll the dice - with a chat message showing the results.
- When you have added a culture the name is shown on the character sheet and there's a context menu to view or delete the culture.
- If you don't drop a culture item on the character you can manually enter a culture name
- You can also manually enter/edit the dice rolls for characteristics if development mode is on and the character sheet is unlocked.
- You can now edit (and keep the changes) to weapon ammo and hitpoints on the NPC sheet
- Specialised skills now show under a common "main skill" heading on the actor sheet (so all Languages appear under "Language")
- A macro has been included in BRP ID Macros compendium to rename all actor and game world specialised skills

## 12.1.33
- When dropping a Specialism skill on to the character sheet where the specialism hasn't been chosen you will get asked for the specialism name
- When the character sheet is unlocked the Skills Tab context menu now includes a "Recalculate skill base scores" which does exactly that.
- When dropping Personality on to a character - the skills included in the personality are added to the character - with relevant choices presented to the player and base scores calculated.
- The same applies for a Profession
- Skills added via the Personality gain the +20 bonus and are highlighted in the Skill Dev tab (Skill tab when character sheet unlocked), though you can edit the Personality Points on any skill
- Skills added via the Profession are highlighted in the Skill Dev tab, though the system doesn't restrict you to spending Professional Skill Points on just these skill
- NPCs now have a Power Modifier option on the Base Stats tab
- NPCs now have a 'Move Notes" entry on the base stats tab for a longer description of their movement.  This appears as a tooltip on the main NPC sheet
- GMs should now be able to drag all items from the Characters and NPCs to the items menu or compendia
- The skill category on the Skill Item Sheet should now display properly for players (it was fine for GMs)

## 12.1.32
- Fixed issue with the Sorcery Spell sheet nullifying levels when opened by a player
- Fixed issue with Psychic abilities not being able to access Description/GM Notes
- Added 'Crush and Knockabck' as a special damage type.  This and 'Impale and Knockback' now do the relevant special damage.
- Most Item names can now be edited by players since the name is less critical with the intro of BRPIDs.  This doesnt include Hit Location, Skill Category and Wound
- When creating a new character only adds new skills and skill categories if not already on the sheet (was a problem with duplicating characters)
- You can now drop NPCs from the compendium to the canvas.  If the NPC already exists in the game actors (where BRPID and Priority match) then you won't get an additional copy created in game
- For characteristic rolls there are now two new difficulty levels - Tricky and Awkward for STAT * 4 and STAT * 3 respectively.  Difficulty levels now show the multiplier.


## 12.1.31
- BRP IDs have been added to the game - see the Github Wiki for more information - https://github.com/Genii-Locorum/brp/wiki/BRP-IDs.  This is a major change so please BACKUP YOUR WORLDS before implementing this.
- A number of macros have been included to help with migration - more info at https://github.com/Genii-Locorum/brp/wiki/Migrating-to-BRP-IDs
- You no longer need to bring comepndium items in to the game items and can drag items etc straight from the compendia
- The list of weapon types (and some other checks) are no longer generated from just in world game items, but pull a list from game items and compendia based on BRPIDs.  You will still need some combat skills etc before you create weapons but they can be in the compendia rather than in world
- Under skills there is a new toggle option "Combat Skill" - if toggled on then the skill is included in the list of weapon types.  You don't need to toggle this on if the Category is set to Combat as these are automatically included.  This removes some hard coding to include Dodge, Throw and Demolitions.  It means you can also include other skills you create or rename those skills.
- Most compendia have been removed from this system but have been placed in to a separate module - the aim is to make customising your world easier (you can use the new module, import the content, remove the module, edit the content and save your own compendia)
- Instructions have been removed from within the game but have migrated to the Github Wiki - https://github.com/Genii-Locorum/brp/wiki
- For Personality, you can now manually enter the personality name when the character sheet is unlocked if you don't have a Personality Item on the character sheet - if you later add a Personality item it supercedes (but doesnt erase) the manual entry.  If you right click the "personality" title and there is no context menu this shows you don't have a relevant item.  The same applies to Profession.
- When skills or powers are shown on Personality, Profession etc either in the main list or optional groups you can now click on the name to open the relevant Item sheet.  These will be the best match based on the BRPID with the highest priority as the actual skill etc is not stored in the Personality, Profession etc.  This means you can ammend a skill etc without having to relink it to the Personality etc
-Hit Locations (the item) now have a Display Name (e.g. Head) and a Creature Type (e.g. Humanoid).  The item name will be a combination of the two with the Creature Type, if populated, appearing in brackets.  The Display Name is what's shown on the Character & NPC sheets.  This is to make finding the right hit location for a creature easier in a big list of hit locations
-Skill Categories have been added as a new Item.  You can change the name and configure how the category modifiers are calculated.  The BRPID for each modifier in world or the compendium is used to generate the list of possible skill categories.  Skill categories are automatically added to new characters.  It is imperative that you either have a skill category with the BRPID 'i.skillcat.combat' or you flag all the weapon skills as combat skills.  If you don't you won't see a list of weapon skills.
- Because of the above the game settings for Social and Supernatural have been removed (include or don't include the relevant game items as you see fit.)
- For NPCs you can now enter Max HP formula (as two stats, a multiple and a modifier) on the Base Stats Tab and the calculation formula is then displayed.  It defaults to CON, SIZ, 0.5 & 0
- When dropping unlinked NPC actors to a scene you can get the Random or Average stats to be autorolled for you - you may get asked depending on the game settings - there's a new one to choose Ask, Do nothing, use Random stats or Average Stats.
- In game settings you can also choose whether to show NPC names on tokens as defaults. You can also do the same for Resource Bars

## 12.1.29
- Added a Description section to NPCs for extended notes.
- You now access NPC stats and base stats (dice to roll) via separate icons rather than toggling one
- There is a new GM tool - Bestiary Mode.  When toggled on you will see more HPL and Armour & SAN Loss sections on the NPC sheet even if your game doesn't use them.  This mode is aimed at creating a Bestiary for distribution to other users who may use game settings that you don't.
- SAN Loss has been added to NPC sheets
- Fixed a bug with NPC hit points on HPL not recording properly.

## 12.1.28
- Fixed Combat rolls not correctly reducing success level.

## 12.1.27
- HP on weapons on NPC sheet are now saved
- NPC Fatigue Points Max are autocalculated
- When rolling or averaging stats for an NPC the Current HP, PP, FP and SP are set to maximum values

## 12.1.26
- A Special Success Damage Roll for a Crushing Weapon now adds +1D4 Damage Bonus if the base Damage Bonus = 0
- Macros can now be dragged between hotbar slots and from the Macro Directory
- When rolling damage the rolled dice are now visible if you expand the chat message
- Combat cards can now be resolved with only 1 roll in them
- Combat rolls now tick relevant XP skills when successfully made and relevant game setting is on
- Hit Locations now check they are not already on the character sheet before they can be dropped
- Armour - previously if the Ballistic Armour values were left blank, then the non-ballistics armour value was assumed to be used.  This no longer happens - you will need to update the Ballistic Armour values in each piece of armour
- If using Hits Per Location, Armour on the Items tab is grouped by Hit Location with a summary of the location.  Clicking on the expand icon (on the right) hides the specific hit location but shows the relevant armour items.  Clicking on the collapse icon hides the armour items and reveals the hit location.  Clicking on the title "ARMOUR" expands all hit locations whilst SHIFT + CLICK collapses them all.

## 12.1.25
- Added a game setting for "Reputation" - choose from None (reputation not used), single (single reputation item allowed) or multiple (multiple reputation items allowed).  NPCs will always use the mutliple option.
- Reputation item can be dragged to macro bar
- New tab on character sheet "SOCIAL" that combines Reputation and Allegiance Items.  Visible if either is allowed in game
- New tab on character sheet "PERS" (Personality) that combines Passion and Personality Traits. Visible if either is allowed in game
- There are now "+" icons on the Armour and Weapons grids on the character sheet to directly add Armour and Weapons to the character sheet.
- Please note that Instructions for new items are being added to the Github wiki (https://github.com/Genii-Locorum/brp/wiki) - overtime more instructions will be added to, and ingame instructions migrated to, the wiki.

## 12.1.24
- Removed the superfluous true/false flag on the Character Sheet Allegiance tab (this was for potenital ally status)
- Fixed the inline edit for NPC Allegiance points
- Total Professional Skill Points, Personal Skill Points and XP now shown on the "CHAR" tab (this adds up totals from Skill, Magic and Psychic items)
- Fixed error with Critical Damage not rolling

## 12.1.23
- Skill categories on the actor sheet get to use the full width of the skill list column to prevent wrap around issues
- Add Supernatural as a skill category and a game setting.  If unticked then any skills with Supernatural won't be shown on the character sheet
- Add Social as a skill category and a game setting.  If unticked then any skills with Social won't be shown on the character sheet
- Personality Traits have been added.  You can roll on the Personality Trait or the Opposed Trait and do XP improvements as well.
- You can drag Personality Traits to the hotbar for a macro.  Using the ALT key when clicking on it triggers the Opposed roll.
- Added macro roll functionality for Passions (previously only displayed the item sheet).
- All item Descriptions and GM Descriptions are now rich text.
- Background, backstory and biography are now rich text.
- NPC sheets now have Passions, Allegiance and Personality Traits.  Unless you have an item on the NPC or the sheet is unlocked you won't see the sections (to save space) - you can drag and drop an item on and it will appear.  This has been added for Powers as well.

## 12.1.22
- Change to manifest URL to correct it

## 12.1.21
- Fix to NPC sheet to allow in line edit of #ATT on weapons ((it was failing to make the update after a new value was entered))
- Tooltip added on NPC sheet explaining BAP

## 12.1.20
- Added option to adjust maximum magic points to character (on the CHAR tab)
- Gear, Weapons and Armour can now have stored magic/power points.  Enter them on the item sheet (default is zero).  The current value can be edited directly on the character sheet.
- If you hover over Power/Magic points then a tool tip shows current and maximum stored power points.  If an item is "stored" then it is not included
- A few tweaks to the character sheet Combat/Item tab with font size to accomodate the Stored PP/MP.  These are only shown if the Max is set to 1 or more.

## 12.1.19
- Added Dodge to list of weapon skills available when creating weapon.  Added Dodge as a weapon to the compendium.  Use this to "Dodge" in combat (this is a a workaround pending a better option)

## 12.1.18
- Fixed issue with Combined/Oppossed/Cooperative rolls in V11 (Issue#16)
- Fixed issue with AudioHelper error on XP rolls.

## 12.1.17
- Fixed issue with Wounds not being created if not using HPL on actors (worked for tokens)

## 12.1.16
- Updated for V12 release 324

## 11.1.15
- Added NPC actor type
- Added a game settings for Allegiances
- Added Allegiance item, and an allegiance roll (normal roll only)
- Allegiance Improvement has an XP check like skills and magic
- Added a game settings for Passions
- Added Passion item, and a passion roll (normal and opposed)
- Passion Improvement has an XP check like skills and magic
- Fixed issue with not being able to add Wounds to an unlinked token (and couldn't roll XP checks either)
- Can open mutation, psychic, sorcery and superpower item sheets on Character sheet by clicking on the names

## 11.1.14
- Added combat rolls from weapons on the hotbar
- Tidied up some of the chat message outputs
- Can cast Magic spells - click on the spell total score

## 11.1.13
- Tweaked context menus so they go up if the start point is in the bottom half of the screen
- Roll cards fixed so the correct roll is deleted rather than always the first roll
- Dice rolls now visible on opposed, cooperative and combined rolls when using Dice so Nice when roll is resolved
- Updated roll chat messages to add extra info when expanding the roll (GM or owner can click on the indidividual result lines)

## 11.1.12
- Hotfix to reinsert code to calculate stats total

## 11.1.11
- Context menus should now render upwards if they would drop off the bottom of the screen
- Skills will roll from the macro bar (you can roll weapon skills from the Skills tab, but not weapons from the items tab - yet)
- Skill tab percentages now include the category bonus
- ENC now calculated (shown on Characteristics tab).  FP adjusted an
- "Carry status" is now shown as icon rather than words (the words are available as a tooltip)
- Auto calc of Encumberance (Items, Armour Weapons) which in turn updates the Max Fatigue Points
- Changed the combat tab.  Rate of Fire is now visible by hovering over "Attack".  Added ENC (hover to see quantity).
- Fatigue and Power point spend and recovery added
- Added error check on dropping Weapon on character sheet to make sure a Skill has been added to the weapon if first skill slot
- Added an game setting  to change the logo at the top centre of the character sheet.  58px height and 700px wide max.
- Added a setting in Skills for "Starter Skills".  Any skill flagged as a starter skill we be automatically added to a new character sheet
  if the relevant game setting is on (this may get added in time)

## 11.1.10
- Removed a testing element left in (oops) that forced max dice roll values
- Added context menu options for weapon skill and damage rolls

## 11.1.9
- Added GM Tools to the scene tools and a Development Phase
- Added XP improvement checks, only available when Development Phase is turned on by the GM.  Applies to Normal Skill, Combined, Oppossed and POW v POW rolls.
- Added POW improvement roll, only available when Dev Phase is turned on
- Option to turn on "auto XP" checks when succesfully using a skill
- Cooperative skill rolls added
- Can roll weapon damage from items in the Combat tab (unless damage is "Special")
- Can roll weapon attacks from skill% in items in the Combat tab
- Updated partial success rolls for Combined rolls

## 11.1.8
- Added Socket functionality (pre-cursor to combined/opposed rolls)
- Combined and Opposed skill rolls added
- Skills now roll off the values not the name (context menus are off the name).  Clicking on the name opens the skill item sheet
- Some changes to skills and weapons (additional skills added - Lasso, Net, Thrown Axe) and which weapons use which skills changed
  based on discussions with author.  Rates of Fire also added to advanced missile weapons

## 11.1.7
- Added wound/hit point statuses, minor and major wounds
- Update hit locations for wound statuses
- Characteristics now roll off the value not the name (context menus are off the name)

## 11.1.6
- Minor change to natural healing
- Added a "general" hit location when new character is created and the game is using HPL to hold poison damage etc
- Moved Damage Bonus to show correctly in the derived stats area rather than the Combat Tab
- Characteristic Rolls added along with instructions
- Game settings added for Impossible rolls, Resistance rolls always having a 1% success/fail and detailed Resistance Roll results
- Specialised skills, where "specialism chosen" is toggled on will now have the specialism name shown first so it is more visible in the skill list

## 11.1.5
- Hits per location autocalculated
- Added Wounds which autoupdate hits (total and HPL)
- Added healing (treat wounds, natural healing, heal all wounds)
- Add HP adjustment to hit locations

## 11.1.4
- Updated item drop so base skill scores are automatically calculated
- Autocalc for Max HP, PP & FP added
- Added a Game Setting to allow characters to have enhanced HP
- Added a flat modifier to characters on Characteristics tab to increase HP (driven by superpowers)

## 11.1.3
- Corrected error in character.mjs pointing to wrong sheet in some operating systems.

## 11.1.2
- Corrected error in actor-itemDrop for adding skills to character sheet when a weapon is dropped (refencing skill1 instead of skill2)
- Added note in readme reminding users to "Keep Document ID" on importing from Compendia

## 11.1.1
- Initial Beta Release
