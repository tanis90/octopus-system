// Regression probe for the unreleased post-d5d4a22 fixes:
//   1) NPC/combat: CB card resolve must not throw when the entry has no skillId
//      (NPC weapons never get weapon skills); auto-XP off must not tick XP;
//      native NPC HP path is updateVitals/manual HP, not character wounds.
//   2) Luck: racing spends serialize; the real chat-button path writes flags and
//      re-renders content; all clients route chat actions to Foundry's activeGM.
//   3) SAN: keeper "new day" clears dailyLoss; deleting/disabling/expiring the
//      tempInsane effect ends the episode card instead of leaving it open.
//   4) Base-pack UUID determinism lives in tools/tests/base-pack-determinism.mjs.
//   5) New characters get one real Unarmed (Brawl) weapon linked to the live
//      Brawl total; NPCs/imports/existing actors are not migrated and
//      starterSkills=false still creates only Brawl + Unarmed.
//   6) CoC M3: real bonus/penalty d100 pools with band/diceDetail/rolls on the
//      card, attack -> dodge/fightback/cover -> real damage -> major wound /
//      dying / instant death / First Aid / Medicine / weekly healing, all
//      written to health.value + flags.brp.coc.wounds (never BRP wound items).
//      Tie rerolls ask for fresh dice instead of picking a winner from old ones.
//
// Run under mt-foundry-compat with this source tree vendored as
// web/packages/brp (the harness's normal development path):
//
//   MT_SYSTEM_ID=brp MT_SPIKE_EVAL=<path>/tools/tests/rules-regressions.mjs \
//     node --experimental-vm-modules tools/run-headless.mjs
//
// The probe is fail-closed: any failed check throws, so the harness exits
// non-zero. It only creates documents in the headless world.
const out = { checks: {}, errors: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(10);
  }
  return null;
};
const check = (name, ok, detail) => {
  out.checks[name] = ok ? true : { ok: false, detail };
  if (!ok) out.errors.push(`${name}: ${JSON.stringify(detail)}`);
};

// Foundry always has ui.chat; the headless shim does not (CB card lookup reads
// ui.chat.collection). Shim-only scaffolding, not a system behaviour change.
if (!ui.chat) { ui.chat = { collection: game.messages, scrollBottom() {} }; }
if (!ui.chat.collection) { ui.chat.collection = game.messages; }

// --- 1) NPC weapon attack card resolves without an XP-tick crash ---
{
  // Native creation path: rolling/averaging the base stats is what calls
  // updateVitals and fills current HP to max.
  const avgStats = Object.fromEntries(['str', 'con', 'siz', 'int', 'pow', 'dex', 'cha', 'edu']
    .map((key) => [key, { random: '50', average: '50' }]));
  const avgNpc = await Actor.create({ name: 'Regression Avg NPC', type: 'npc', system: { baseStats: avgStats } }, { renderSheet: false });
  await avgNpc.averageCharacteristicsValue();
  check('npcAverageCreationFillsHp', avgNpc.system.health.value === avgNpc.system.health.max && avgNpc.system.health.max > 0,
    { hp: avgNpc.system.health.value, max: avgNpc.system.health.max });
  await avgNpc.delete();

  const npc = await Actor.create({
    name: 'Regression Cultist', type: 'npc',
    system: {
      stats: {
        str: { base: 60 }, con: { base: 55 }, siz: { base: 50 }, int: { base: 50 },
        pow: { base: 50 }, dex: { base: 55 }, cha: { base: 40 }, edu: { base: 40 }
      }
    }
  }, { renderSheet: false });
  const weapon = await Item.create({
    name: 'Regression Knife', type: 'weapon',
    system: { npcVal: 60, dmg1: '1D8', dmg2: '', dmg3: '', db: 'none', special: 'none', range1: '', range2: '', range3: '', att: '', hpCurr: 0, ammoCurr: 0 }
  }, { parent: npc, renderSheet: false });
  check('npcWeaponHasNoSkill', npc.items.filter((i) => i.type === 'skill').length === 0,
    { skills: npc.items.filter((i) => i.type === 'skill').length });
  // Native NPC creation path: rolling/averaging stats calls updateVitals; the
  // base NPC has no automatic wound->HP model, so HP is a manual/HP-derived field.
  const hpMax = npc.system.health.max;
  await npc.updateVitals();
  check('npcVitalsFillHp', npc.system.health.value === hpMax,
    { hp: npc.system.health.value, max: hpMax });
  await npc.update({ 'system.health.value': hpMax - 7 });
  check('npcManualHpDamage', npc.system.health.value === hpMax - 7,
    { hp: npc.system.health.value, max: hpMax });
  await Item.create({ name: 'Regression Wound', type: 'wound', system: { locId: '', value: 7 } }, { parent: npc, renderSheet: false });
  await npc.update({});
  check('npcWoundIsNotHpModel', npc.system.health.value === hpMax - 7,
    { hp: npc.system.health.value, max: hpMax, note: 'wounds are character/HPL-only' });
  await npc.update({ 'system.viewTab': '1' });
  await npc.sheet.render(true);
  check('npcSheetWeaponRow', (npc.sheet.element?.innerHTML ?? '').includes('Regression Knife'),
    { htmlLen: npc.sheet.element?.innerHTML?.length ?? 0 });

  game.brp.BRPCheck._trigger({
    rollType: 'CM', cardType: 'CB', itemId: weapon.id, skillId: false,
    actor: npc, token: null, shiftKey: true
  });
  const cb = await waitFor(() => [...game.messages.values()]
    .filter((m) => m.flags?.brp?.cardType === 'CB' && m.flags?.brp?.chatCard?.[0]?.particId === npc.id).at(-1));
  check('npcAttackCardCreated', !!cb && Number(cb.flags.brp.chatCard[0].targetScore) === 60,
    cb ? { targetScore: cb.flags.brp.chatCard[0].targetScore } : { missing: true });

  if (cb) {
    let threw = null;
    try {
      await game.brp.BRPCheck.handleChatButton({
        presetType: 'resolve-cb-card', targetChatId: cb.id, origin: game.user.id, originGM: true
      });
    } catch (e) { threw = String(e?.message ?? e); }
    check('npcCombatResolveNoThrow', threw === null, { threw });
    check('npcCombatCardClosed', game.messages.get(cb.id)?.flags?.brp?.state === 'closed',
      { state: game.messages.get(cb.id)?.flags?.brp?.state });
    await cb.delete();
  }
  await npc.delete();
}

// --- 2) Two concurrent Luck spends on one SN card are serialized ---
{
  let actor = null, card = null;
  for (let i = 0; i < 40 && !actor; i++) {
    const a = await Actor.create({ name: `Regression Lucky ${i}`, type: 'character' }, { renderSheet: false });
    await a.update({ 'system.stats.pow.base': 12 });
    await a.initSanity();
    await a.initLuck();
    game.brp.rollSanMacro(a);
    const c = await waitFor(() => [...game.messages.values()]
      .filter((m) => m.flags?.brp?.rollType === 'SN' && m.flags?.brp?.chatCard?.[0]?.particId === a.id).at(-1));
    const rv = Number(c?.flags?.brp?.chatCard?.[0]?.rollVal);
    // Ten points must be spendable (rollVal >= 11) to make the race observable
    if (c && rv > 10) { actor = a; card = c; }
    else { if (c) await c.delete(); await a.delete(); }
  }
  check('luckRaceCardFound', !!actor && !!card, { found: !!actor });
  if (actor && card) {
    const entry = card.flags.brp.chatCard[0];
    const before = { rollVal: Number(entry.rollVal), luck: actor.system.luck.value };
    await Promise.all([
      game.brp.BRPLuck.spendFromCard({ targetChatId: card.id, index: 0, amount: 5, origin: game.user.id, originGM: true }),
      game.brp.BRPLuck.spendFromCard({ targetChatId: card.id, index: 0, amount: 5, origin: game.user.id, originGM: true })
    ]);
    const after = game.messages.get(card.id)?.flags?.brp?.chatCard?.[0];
    check('luckRaceRollVal', Number(after?.rollVal) === before.rollVal - 10,
      { before: before.rollVal, after: after?.rollVal });
    check('luckRaceLuckSpent', Number(after?.luckSpent) === 10, { luckSpent: after?.luckSpent });
    check('luckRaceActorLuck', actor.system.luck.value === before.luck - 10,
      { before: before.luck, after: actor.system.luck.value });
    check('luckRaceOriginalTrace', after?.originalRawScore === before.rollVal,
      { originalRawScore: after?.originalRawScore, before: before.rollVal });
    const t = Number(after.targetScore), rv = Number(after.rollVal);
    const crit = Math.ceil(0.05 * t), spec = Math.round(0.2 * t), succ = Math.min(t, 95), fum = Math.min(95 + crit, 100);
    const expect = rv <= crit ? 4 : rv <= spec ? 3 : rv <= succ ? 2 : rv >= fum ? 0 : 1;
    check('luckRaceResultRerated', Number(after.resultLevel) === expect,
      { resultLevel: after.resultLevel, expect, rv, t });
    await card.delete();
    await actor.delete();
  }
}

// --- 3) The real chat-button path writes flags back and re-renders content ---
{
  let actor = null, card = null;
  for (let i = 0; i < 40 && !actor; i++) {
    const a = await Actor.create({ name: `Regression UI Lucky ${i}`, type: 'character' }, { renderSheet: false });
    await a.update({ 'system.stats.pow.base': 12 });
    await a.initSanity();
    await a.initLuck();
    game.brp.rollSanMacro(a);
    const c = await waitFor(() => [...game.messages.values()]
      .filter((m) => m.flags?.brp?.rollType === 'SN' && m.flags?.brp?.chatCard?.[0]?.particId === a.id).at(-1));
    const rv = Number(c?.flags?.brp?.chatCard?.[0]?.rollVal);
    if (c && rv > 5) { actor = a; card = c; }
    else { if (c) await c.delete(); await a.delete(); }
  }
  check('luckUiCardFound', !!actor && !!card, { found: !!actor });
  if (actor && card) {
    const before = Number(card.flags.brp.chatCard[0].rollVal);
    let threw = null;
    try {
      await game.brp.BRPCheck.handleChatButton({
        presetType: 'luck-spend-5', targetChatId: card.id, origin: game.user.id, originGM: true
      });
    } catch (e) { threw = String(e?.message ?? e); }
    const msg = game.messages.get(card.id);
    const entry = msg?.flags?.brp?.chatCard?.[0];
    check('luckUiNoThrow', threw === null, { threw });
    check('luckUiFlagsWritten', Number(entry?.rollVal) === before - 5 && Number(entry?.luckSpent) === 5 &&
      entry?.originalRawScore === before && actor.system.luck.value === 55,
      { before, entry: { rollVal: entry?.rollVal, luckSpent: entry?.luckSpent, originalRawScore: entry?.originalRawScore }, actorLuck: actor.system.luck.value });
    check('luckUiContentRerendered', (msg?.content ?? '').includes(game.i18n.format('BRP.luck.adjusted', { original: before })) &&
      (msg?.content ?? '').includes(game.i18n.format('BRP.luck.remaining', { value: 55, max: entry?.luck?.max ?? 60 })),
      { hasAdjusted: (msg?.content ?? '').includes('adjusted'), len: msg?.content?.length });
    await card.delete();
    await actor.delete();
  }
}

// --- 4) Auto-XP off: resolving a character CB card must not tick XP ---
{
  const prevAutoXP = game.settings.get('brp', 'autoXP');
  await game.settings.set('brp', 'autoXP', '0');
  const a = await Actor.create({ name: 'Regression XP', type: 'character' }, { renderSheet: false });
  await a.update({ 'system.stats.pow.base': 12, 'system.stats.dex.base': 55, 'system.stats.str.base': 55, 'system.stats.con.base': 55, 'system.stats.siz.base': 50 });
  await a.initSanity();
  await a.initLuck();
  const skill = await Item.create({
    name: 'Regression Sword', type: 'skill',
    system: { base: 50 }, flags: { brp: { brpidFlag: { id: 'i.skill.regression-sword' } } }
  }, { parent: a, renderSheet: false });
  const weapon = await Item.create({
    name: 'Regression Sword', type: 'weapon',
    system: { dmg1: '1D8', sourceID: skill.id, db: 'none', special: 'none', dmg2: '', dmg3: '', range1: '', range2: '', range3: '', att: '', hpCurr: 0, ammoCurr: 0 }
  }, { parent: a, renderSheet: false });
  check('autoXPOffStartsUnticked', !skill.system.improve, { improve: skill.system.improve });
  game.brp.BRPCheck._trigger({
    rollType: 'CM', cardType: 'CB', itemId: weapon.id, skillId: skill.id,
    actor: a, token: null, shiftKey: true
  });
  const cb = await waitFor(() => [...game.messages.values()]
    .filter((m) => m.flags?.brp?.cardType === 'CB' && m.flags?.brp?.chatCard?.[0]?.particId === a.id).at(-1));
  check('autoXPOffCardCreated', !!cb, { missing: true });
  if (cb) {
    let threw = null;
    try {
      await game.brp.BRPCheck.handleChatButton({
        presetType: 'resolve-cb-card', targetChatId: cb.id, origin: game.user.id, originGM: true
      });
    } catch (e) { threw = String(e?.message ?? e); }
    check('autoXPOffNoThrow', threw === null, { threw });
    check('autoXPOffNoTick', !a.items.get(skill.id)?.system?.improve,
      { improve: a.items.get(skill.id)?.system?.improve });
    await cb.delete();
  }
  await a.delete();
  await game.settings.set('brp', 'autoXP', prevAutoXP);
}

// --- 5) SAN lifecycle: daily reset and effect-driven card ending ---
{
  await game.settings.set('brp', 'useSAN', true);
  const mkMadness = async (label) => {
    const a = await Actor.create({ name: `Regression San ${label}`, type: 'character' }, { renderSheet: false });
    await a.update({ 'system.stats.pow.base': 11 });
    await a.initSanity();
    await a.update({ 'system.sanity.dailyLoss': 26 }); // tis = 27
    game.brp.rollSanMacro(a);
    const card = await waitFor(() => [...game.messages.values()]
      .filter((m) => m.flags?.brp?.rollType === 'SN' && m.flags?.brp?.chatCard?.[0]?.particId === a.id).at(-1));
    const effect = await waitFor(() => [...a.effects].find((e) => e.statuses?.has?.('tempInsane')));
    return { a, card, effect };
  };
  const hasTemp = (a) => [...a.effects].some((e) => e.statuses?.has?.('tempInsane'));

  // Keeper "new day" action clears only the daily tally
  const reset = await Actor.create({ name: 'Regression San Reset', type: 'character' }, { renderSheet: false });
  await reset.update({ 'system.stats.pow.base': 11 });
  await reset.initSanity();
  await reset.update({ 'system.sanity.dailyLoss': 9 });
  await reset.sheet.render(true);
  check('sanResetButtonRendered', (reset.sheet.element?.innerHTML ?? '').includes('data-action="sanityResetDaily"'),
    { htmlLen: reset.sheet.element?.innerHTML?.length ?? 0 });
  const resetAction = reset.sheet.constructor._onSanityResetDaily;
  if (typeof resetAction === 'function') {
    await resetAction.call(reset.sheet, {}, {});
    check('sanResetDailyLoss', reset.system.sanity.dailyLoss === 0, { dailyLoss: reset.system.sanity.dailyLoss });
  } else {
    check('sanResetDailyLoss', false, { missing: 'BRPActorSheetV2._onSanityResetDaily' });
  }
  await reset.delete();

  // Effect deleted from the effects tab / Times Up
  const del = await mkMadness('delete');
  check('sanEpisodeCreatedForDelete', !!del.card && !!del.effect && del.card.flags?.brp?.madness?.ended === false,
    { card: !!del.card, effect: !!del.effect, ended: del.card?.flags?.brp?.madness?.ended });
  if (del.card && del.effect) {
    await del.effect.delete();
    const ended = await waitFor(() => game.messages.get(del.card.id)?.flags?.brp?.madness?.ended === true);
    check('sanEffectDeleteEndsCard', !!ended,
      { ended: game.messages.get(del.card.id)?.flags?.brp?.madness?.ended });
    check('sanEffectDeleteRerenders', (game.messages.get(del.card.id)?.content ?? '').includes(game.i18n.localize('BRP.madness.ended')),
      { len: game.messages.get(del.card.id)?.content?.length });
    check('sanEffectDeleteRemoved', !hasTemp(del.a), { effects: [...del.a.effects].length });
    await del.card.delete();
  }
  await del.a.delete();

  // Effect disabled without deletion
  const dis = await mkMadness('disable');
  check('sanEpisodeCreatedForDisable', !!dis.card && !!dis.effect, { card: !!dis.card, effect: !!dis.effect });
  if (dis.card && dis.effect) {
    await dis.effect.update({ disabled: true });
    const ended = await waitFor(() => game.messages.get(dis.card.id)?.flags?.brp?.madness?.ended === true);
    check('sanEffectDisableEndsCard', !!ended,
      { ended: game.messages.get(dis.card.id)?.flags?.brp?.madness?.ended });
    await dis.card.delete();
  }
  await dis.a.delete();

  // World-time expiry (seconds duration); core only displays remaining, the
  // system retires its own tempInsane effect and ends the card.
  const exp = await mkMadness('expire');
  check('sanEpisodeCreatedForExpiry', !!exp.card && !!exp.effect, { card: !!exp.card, effect: !!exp.effect });
  if (exp.card && exp.effect) {
    const wt = game.time.worldTime;
    try {
      await game.time.advance(Number(exp.effect.duration.seconds) + 1);
      const ended = await waitFor(() => game.messages.get(exp.card.id)?.flags?.brp?.madness?.ended === true);
      check('sanEffectExpiryEndsCard', !!ended,
        { ended: game.messages.get(exp.card.id)?.flags?.brp?.madness?.ended });
      check('sanEffectExpiryRemoved', !hasTemp(exp.a), { effects: [...exp.a.effects].length });
    } finally {
      try { game.time.worldTime = wt; } catch { /* shim only */ }
    }
    await exp.card.delete();
  }
  await exp.a.delete();
}

// --- 6) All chat-button clients route to Foundry activeGM (single writer) ---
{
  const realUser = game.user;
  const realUsers = game.users;
  const realEmit = game.socket.emit;
  const realHandle = game.brp.BRPCheck.handleChatButton;
  const gmActive = { id: 'gm-a', name: 'GM A', isGM: true, active: true };
  const gmOther = { id: 'gm-b', name: 'GM B', isGM: true, active: true };
  const player = { id: 'player-1', name: 'Player', isGM: false, active: true };
  const coll = new Collection();
  coll.set(gmActive.id, gmActive);
  coll.set(gmOther.id, gmOther);
  coll.set(player.id, player);
  Object.defineProperty(coll, 'activeGM', { get: () => gmActive, configurable: true });
  const sent = [], handled = [];
  const wrap = document.createElement('div');
  wrap.className = 'message';
  wrap.dataset.messageId = 'route-msg';
  const button = document.createElement('button');
  button.dataset.preset = 'luck-spend-5';
  wrap.appendChild(button);
  document.body.appendChild(wrap);
  try {
    game.users = coll;
    game.socket.emit = (channel, data) => { sent.push({ channel, ...data }); };
    game.brp.BRPCheck.handleChatButton = async (data) => { handled.push(data); };

    game.user = gmOther;
    await game.brp.BRPCheck.triggerChatButton({ currentTarget: button });
    check('activeGmRoutesOtherGm', sent.length === 1 && sent[0].channel === 'system.brp' &&
      sent[0].type === 'chatUpdate' && sent[0].to === 'gm-a' &&
      sent[0].value?.presetType === 'luck-spend-5' && sent[0].value?.targetChatId === 'route-msg' &&
      sent[0].value?.dataset?.preset === 'luck-spend-5',
      { sent: sent.slice(0, 1), handled: handled.length });
    check('activeGmOtherGmNoLocal', handled.length === 0, { handled: handled.length });

    sent.length = 0; handled.length = 0; game.user = player;
    await game.brp.BRPCheck.triggerChatButton({ currentTarget: button });
    check('activeGmRoutesPlayer', sent.length === 1 && sent[0].to === 'gm-a' &&
      sent[0].value?.originGM === false, { sent: sent.slice(0, 1) });
    check('activeGmPlayerNoLocal', handled.length === 0, { handled: handled.length });

    sent.length = 0; handled.length = 0; game.user = gmActive;
    await game.brp.BRPCheck.triggerChatButton({ currentTarget: button });
    check('activeGmHandlesLocal', handled.length === 1 && handled[0].originGM === true && sent.length === 0,
      { handled: handled.length, sent: sent.length });

    // Defence in depth: the real handler must not act for a non-writer.
    const realGet = game.messages.get;
    let getCalled = false;
    game.messages.get = (id) => { getCalled = true; return realGet(id); };
    let guardThrew = null;
    try {
      game.user = gmOther;
      await realHandle({ presetType: 'luck-spend-5', targetChatId: 'route-msg' });
    } catch (e) { guardThrew = String(e?.message ?? e); }
    finally { game.messages.get = realGet; }
    check('activeGmGuardBlocksNonWriter', !getCalled && guardThrew === null, { getCalled, guardThrew });
  } finally {
    game.user = realUser;
    game.users = realUsers;
    game.socket.emit = realEmit;
    game.brp.BRPCheck.handleChatButton = realHandle;
    wrap.remove();
  }
}

// --- 7) Character sheet use/edit mode toggle (PC only, backed by system.lock) ---
{
  const realUser = game.user;
  const modeBtn = (sheet) => sheet.element?.querySelector('[data-brp-mode-toggle]');
  const lockActions = (sheet) => sheet.element?.querySelectorAll('[data-action="actorToggle"][data-property="lock"]') ?? [];
  const waitMode = async (sheet, lock) => {
    await waitFor(() => sheet.actor.system.lock === lock && modeBtn(sheet)?.dataset.mode === (lock ? 'use' : 'edit'));
    return modeBtn(sheet);
  };
  const pc = await Actor.create({ name: 'Regression Mode PC', type: 'character', ownership: { default: 0 } }, { renderSheet: false });
  let npc = null;
  try {
    await pc.sheet.render(true);
    const initialBtn = await waitFor(() => modeBtn(pc.sheet));
    const initial = {
      lock: pc.system.lock, editable: pc.sheet.isEditable, toggleCount: pc.sheet.element.querySelectorAll('[data-brp-mode-toggle]').length,
      first: pc.sheet.element.querySelector('.window-header')?.firstElementChild === initialBtn,
      text: initialBtn?.textContent, pressed: initialBtn?.getAttribute('aria-pressed'), mode: initialBtn?.dataset.mode,
      aria: initialBtn?.getAttribute('aria-label'), title: initialBtn?.title,
      tag: initialBtn?.tagName, type: initialBtn?.type, tabIndex: initialBtn?.tabIndex,
      normal: !!pc.sheet.element.querySelector('.skill-list'), dev: !!pc.sheet.element.querySelector('.skillsDev-list'),
      bodyLockActions: lockActions(pc.sheet).length,
    };
    check('pcDefaultUseMode', initial.lock === true && initial.text === game.i18n.localize('BRP.sheetModeEdit')
      && initial.pressed === 'false' && initial.mode === 'use' && initial.normal && !initial.dev,
      initial);
    check('pcModeToggleFarLeftUniqueNative', initial.editable && initial.toggleCount === 1 && initial.first
      && initial.tag === 'BUTTON' && initial.type === 'button' && initial.tabIndex === 0
      && initial.aria.includes(game.i18n.localize('BRP.sheetModeEdit'))
      && initial.title === game.i18n.localize('BRP.sheetModeEditHint')
      && initial.bodyLockActions === 1,
      initial);

    initialBtn.click();
    const editBtn = await waitMode(pc.sheet, false);
    const edited = {
      lock: pc.system.lock, persisted: game.actors.get(pc.id)?.system.lock,
      text: editBtn?.textContent, pressed: editBtn?.getAttribute('aria-pressed'), mode: editBtn?.dataset.mode,
      title: editBtn?.title, normal: !!pc.sheet.element.querySelector('.skill-list'), dev: !!pc.sheet.element.querySelector('.skillsDev-list'),
      toggleCount: pc.sheet.element.querySelectorAll('[data-brp-mode-toggle]').length,
    };
    check('pcMouseToggleToEdit', edited.lock === false && edited.persisted === false
      && edited.text === game.i18n.localize('BRP.sheetModeUse') && edited.pressed === 'true'
      && edited.mode === 'edit' && edited.title === game.i18n.localize('BRP.sheetModeUseHint')
      && !edited.normal && edited.dev && edited.toggleCount === 1,
      edited);

    const useBtn = await waitMode(pc.sheet, false);
    useBtn.focus();
    const focusOk = document.activeElement === useBtn && useBtn.tabIndex === 0;
    useBtn.click();
    const backBtn = await waitMode(pc.sheet, true);
    check('pcMouseToggleBackAndFocusable', focusOk && pc.system.lock === true
      && backBtn?.textContent === game.i18n.localize('BRP.sheetModeEdit')
      && !!pc.sheet.element.querySelector('.skill-list') && !pc.sheet.element.querySelector('.skillsDev-list'),
      { focusOk, lock: pc.system.lock, text: backBtn?.textContent });

    // Persist across close/reopen: edit state must survive a real sheet re-open.
    (await waitMode(pc.sheet, true)).click();
    await waitMode(pc.sheet, false);
    await pc.sheet.close();
    await pc.sheet.render(true);
    const reopenBtn = await waitMode(pc.sheet, false);
    check('pcEditModePersistsAcrossReopen', pc.system.lock === false
      && reopenBtn?.textContent === game.i18n.localize('BRP.sheetModeUse')
      && reopenBtn?.getAttribute('aria-pressed') === 'true'
      && !!pc.sheet.element.querySelector('.skillsDev-list'),
      { lock: pc.system.lock, text: reopenBtn?.textContent, dev: !!pc.sheet.element.querySelector('.skillsDev-list') });
    reopenBtn.click();
    await waitMode(pc.sheet, true);

    // No permission: a non-owner must not get the toggle (nor a body lock entry).
    game.user = { id: 'regression-player-pc', name: 'Regression Player', isGM: false, active: true };
    await pc.sheet.render(true);
    check('pcNonOwnerNoToggle', pc.sheet.isEditable === false
      && pc.sheet.element.querySelectorAll('[data-brp-mode-toggle]').length === 0
      && lockActions(pc.sheet).length === 0
      && !!pc.sheet.element.querySelector('.skill-list'),
      { editable: pc.sheet.isEditable, toggles: pc.sheet.element.querySelectorAll('[data-brp-mode-toggle]').length });

    // Explicit old-document shape (lock:false) stays in edit mode; NPCs never get the PC toggle.
    game.user = realUser;
    const old = await Actor.create({ name: 'Regression Old Unlocked', type: 'character', system: { lock: false }, ownership: { default: 0 } }, { renderSheet: false });
    await old.sheet.render(true);
    const oldBtn = await waitFor(() => modeBtn(old.sheet));
    check('pcExplicitUnlockedStaysEdit', old.system.lock === false && oldBtn?.textContent === game.i18n.localize('BRP.sheetModeUse')
      && oldBtn?.getAttribute('aria-pressed') === 'true' && !!old.sheet.element.querySelector('.skillsDev-list'), { lock: old.system.lock });
    await old.delete();

    npc = await Actor.create({ name: 'Regression Mode NPC', type: 'npc' }, { renderSheet: false });
    await npc.sheet.render(true);
    check('npcNoModeToggle', !npc.sheet.element.querySelector('[data-brp-mode-toggle]'),
      { toggles: npc.sheet.element.querySelectorAll('[data-brp-mode-toggle]').length });
  } finally {
    game.user = realUser;
    try { await pc.sheet.close(); } catch { /* shim only */ }
    await pc.delete();
    if (npc) await npc.delete();
  }
}

// --- 8) New characters get one real Unarmed (Brawl) weapon; existing data is not migrated ---
{
  const prevStarter = game.settings.get('brp', 'starterSkills');
  const unarmedOf = (actor) => [...actor.items].filter((itm) => itm.type === 'weapon' && itm.flags?.brp?.unarmed === true);
  const brawlOf = (actor) => [...actor.items].find((itm) => itm.flags?.brp?.brpidFlag?.id === 'i.skill.brawl');
  const mkStats = () => ({
    str: { base: 20 }, con: { base: 50 }, siz: { base: 13 }, int: { base: 50 },
    pow: { base: 50 }, dex: { base: 50 }, cha: { base: 50 }, edu: { base: 50 }
  });
  const attackTarget = async (actor, weapon, skillId) => {
    const before = game.messages.size;
    game.brp.BRPCheck._trigger({
      rollType: 'CM', cardType: 'CB', itemId: weapon.id, skillId,
      actor, token: null, shiftKey: true
    });
    const card = await waitFor(() => [...game.messages.values()].slice(before)
      .find((m) => m.flags?.brp?.cardType === 'CB' && m.flags?.brp?.chatCard?.[0]?.particId === actor.id));
    const target = Number(card?.flags?.brp?.chatCard?.[0]?.targetScore);
    if (card) await card.delete();
    return target;
  };
  let pc = null, bare = null, npc = null, comp = null;
  try {
    await game.settings.set('brp', 'starterSkills', true);
    pc = await Actor.create({ name: 'Regression Unarmed PC', type: 'character', system: { stats: mkStats() } }, { renderSheet: false });
    const brawl = brawlOf(pc);
    const unarmed = unarmedOf(pc)[0] ?? null;
    const skills = [...pc.items].filter((itm) => itm.type === 'skill');
    check('pcUnarmedSingleWeapon', unarmedOf(pc).length === 1 && skills.length === 57 && !!brawl,
      { weapons: unarmedOf(pc).length, skills: skills.length, brawl: !!brawl });
    check('pcUnarmedTemplateFields', !!unarmed && unarmed.name === '徒手（斗殴）'
      && unarmed.img === 'systems/brp/assets/Icons/deadly-strike.svg'
      && unarmed.flags?.brp?.unarmed === true
      && unarmed.flags?.brp?.brpidFlag?.id === 'i.weapon.unarmed'
      && unarmed.flags?.brp?.brpidFlag?.lang === 'zh-CN'
      && unarmed.flags?.brp?.brpidFlag?.priority === 1
      && unarmed.flags?.brp?.enName === 'Unarmed'
      && unarmed.system?.weaponType === 'melee'
      && unarmed.system?.skill1 === 'i.skill.brawl' && unarmed.system?.skill2 === 'none'
      && unarmed.system?.dmg1 === '1D3' && unarmed.system?.db === 'full'
      && unarmed.system?.special === 'crush' && unarmed.system?.spclDmg === false
      && unarmed.system?.att === 1 && unarmed.system?.range1 === 'S'
      && unarmed.system?.hands === '1H' && unarmed.system?.parry === false
      && unarmed.system?.quantity === 1 && unarmed.system?.enc === 0
      && unarmed.system?.equipStatus === 'carried' && unarmed.system?.npcVal === 0,
      unarmed ? { name: unarmed.name, flags: unarmed.flags, system: unarmed.system } : { missing: true });
    check('pcUnarmedNoPersistedDerivedFields', !!unarmed && unarmed.system?.sourceID === undefined
      && unarmed.system?.skillScore === undefined && unarmed.system?.skillName === undefined
      && unarmed.system?.dmgName === undefined && unarmed.system?.dbName === undefined
      && unarmed.system?.damageHint === undefined && unarmed.system?.specialDmg === undefined,
      unarmed ? { system: unarmed.system } : { missing: true });

    await pc.sheet.render(true);
    const row = pc.sheet.element?.querySelector?.('[data-item-id="' + (unarmed?.id ?? '') + '"]') ?? null;
    const catBonus = Number(pc.system.skillcategory?.[brawl?.system?.category] ?? 0);
    const expectedScore = Number(brawl?.system?.total) + catBonus;
    check('pcUnarmedCombatRowLinked', !!unarmed && unarmed.system?.sourceID === brawl?.id
      && unarmed.system?.skillName === '斗殴' && Number(unarmed.system?.skillScore) === expectedScore
      && Number.isFinite(expectedScore) && (pc.sheet.element?.innerHTML ?? '').includes('徒手（斗殴）'),
      { sourceID: unarmed?.system?.sourceID, brawlId: brawl?.id, skillName: unarmed?.system?.skillName,
        skillScore: unarmed?.system?.skillScore, expectedScore, row: !!row });
    check('pcUnarmedEncNoExtraLoad', !!unarmed && unarmed.system?.enc === 0
      && Number.isFinite(Number(pc.system.enc)) && Number(pc.system.enc) === 0,
      { weaponEnc: unarmed?.system?.enc, actorEnc: pc.system.enc });

    // Re-render/update must not duplicate or migrate the weapon.
    await pc.update({});
    await pc.prepareData();
    await pc.sheet.render(true);
    check('pcUnarmedIdempotentRerender', unarmedOf(pc).length === 1,
      { weapons: unarmedOf(pc).length, names: unarmedOf(pc).map((itm) => itm.name) });

    // A real weapon attack reads Brawl's live total (plus category bonus).
    const target1 = await attackTarget(pc, unarmed, unarmed.system.sourceID);
    await brawl.update({ 'system.base': 45 });
    await pc.prepareData();
    await pc.sheet.render(true);
    const target2 = await attackTarget(pc, unarmed, unarmed.system.sourceID);
    const catAfter = Number(pc.system.skillcategory?.[brawl.system.category] ?? 0);
    check('pcUnarmedAttackTargetTracksBrawl', target1 === 25 + catBonus
      && target2 === 45 + catAfter && target2 === target1 + 20,
      { target1, target2, catBonus, catAfter, brawlBase: brawl.system.base, brawlTotal: brawl.system.total });

    // Real quick-combat card computes all three damage branches through the
    // system kernel; force a critical (D100=1) so the card is created.
    const realRandom = Math.random;
    let qcCard = null;
    try {
      Math.random = () => 0;
      const before = game.messages.size;
      game.brp.BRPCheck._trigger({
        rollType: 'QC', cardType: 'NO', itemId: unarmed.id, skillId: unarmed.system.sourceID,
        actor: pc, token: null, shiftKey: true
      });
      qcCard = await waitFor(() => [...game.messages.values()].slice(before)
        .find((m) => m.flags?.brp?.chatCard?.[0]?.particId === pc.id));
    } finally {
      Math.random = realRandom;
    }
    const qc = qcCard?.flags?.brp?.chatCard?.[0] ?? null;
    const fullDb = pc.system.dmgBonus.full;
    check('pcUnarmedDamageFullDb', fullDb !== '+0' && qc?.resultLevel === 4 && qc?.dmgNormForm === '1D3' + fullDb,
      { fullDb, resultLevel: qc?.resultLevel, normal: qc?.dmgNormForm });
    check('pcUnarmedDamageCrushBranch', qc?.dmgSpecForm === '1D3' + fullDb + fullDb,
      { damage: qc?.dmgSpecForm, fullDb, special: unarmed.system.special, db: unarmed.system.db });
    if (qcCard) await qcCard.delete();

    // starterSkills=false: only Brawl is added (not the other 56 octopus skills), then Unarmed.
    await game.settings.set('brp', 'starterSkills', false);
    bare = await Actor.create({ name: 'Regression Bare PC', type: 'character', system: { stats: mkStats() } }, { renderSheet: false });
    const bareSkills = [...bare.items].filter((itm) => itm.type === 'skill');
    const bareBrawl = brawlOf(bare);
    check('pcUnarmedStarterOffOnlyBrawl', bareSkills.length === 1 && bareBrawl?.flags?.brp?.brpidFlag?.id === 'i.skill.brawl'
      && Number(bareBrawl?.system?.base) === 25 && unarmedOf(bare).length === 1,
      { skills: bareSkills.length, brawl: bareBrawl?.flags?.brp?.brpidFlag?.id, base: bareBrawl?.system?.base, weapons: unarmedOf(bare).length });

    // fromCompendium is a copy/import path and must not create Unarmed.
    comp = await Actor.create({
      name: 'Regression Compendium Copy', type: 'character',
      flags: { brp: { brpidFlag: { id: 'i.actor.compendium-copy', priority: 1 } } }
    }, { fromCompendium: true, renderSheet: false });
    check('pcUnarmedFromCompendiumSkipped', unarmedOf(comp).length === 0 && !brawlOf(comp),
      { weapons: unarmedOf(comp).length, brawl: !!brawlOf(comp) });

    // Removing the weapon then update/render must not back-fill it (no old-actor migration).
    await unarmed.delete();
    await pc.update({});
    await pc.prepareData();
    await pc.sheet.render(true);
    check('pcUnarmedNoBackfillOnUpdate', unarmedOf(pc).length === 0,
      { weapons: unarmedOf(pc).length });

    npc = await Actor.create({ name: 'Regression Unarmed NPC', type: 'npc' }, { renderSheet: false });
    check('npcNoUnarmedOrBrawl', unarmedOf(npc).length === 0 && !brawlOf(npc),
      { weapons: unarmedOf(npc).length, brawl: !!brawlOf(npc) });
  } finally {
    for (const actor of [pc, bare, npc, comp]) { if (actor) { try { await actor.delete(); } catch { /* shim only */ } } }
    await game.settings.set('brp', 'starterSkills', prevStarter);
  }
}

// --- 9) CoC M1 native path: actor derivation, skill totals, BRPCheck and starter isolation ---
{
  const prevRuleset = game.settings.get('brp', 'ruleset');
  const prevStarter = game.settings.get('brp', 'starterSkills');
  const skillBy = (actor, brpid) => [...actor.items].find((itm) => itm.type === 'skill' && itm.flags?.brp?.brpidFlag?.id === brpid);
  const cocStats = {
    str: { base: 60 }, con: { base: 50 }, siz: { base: 50 }, int: { base: 50 },
    pow: { base: 40 }, dex: { base: 55 }, cha: { base: 45 }, edu: { base: 60 }
  };
  let coc = null, cocBare = null, cocNpc = null, octo = null;
  try {
    // External catalog/profile value is `coc7`; the adapter key is `coc`.
    await game.settings.set('brp', 'ruleset', 'coc7');
    await game.settings.set('brp', 'starterSkills', true);
    coc = await Actor.create({
      name: 'Regression CoC Investigator', type: 'character', system: { age: 40, stats: cocStats }
    }, { renderSheet: false });
    const skills = [...coc.items].filter((itm) => itm.type === 'skill');
    const cats = [...coc.items].filter((itm) => itm.type === 'skillcat');
    check('cocStarterCountAndIsolation', skills.length === 59 && cats.length === 0
      && skills.every((itm) => itm.flags?.brp?.contentSource === 'coc')
      && !skills.some((itm) => itm.flags?.brp?.brpidFlag?.id === 'i.skill.brawl')
      && skills.every((itm) => String(itm.flags?.brp?.brpidFlag?.id).startsWith('i.skill.coc.')),
      { skills: skills.length, cats: cats.length, sample: skills.slice(0, 3).map((itm) => itm.flags?.brp?.brpidFlag?.id) });
    check('coc7SettingSelectsCocAdapter', game.brp.rules.activeId() === 'coc'
      && game.brp.rules.active().id === 'coc' && game.brp.rules.normalizeId('coc7') === 'coc',
      { activeId: game.brp.rules.activeId(), adapter: game.brp.rules.active().id });

    await game.settings.set('brp', 'starterSkills', false);
    cocBare = await Actor.create({
      name: 'Regression CoC Bare Investigator', type: 'character', system: { stats: cocStats }
    }, { renderSheet: false });
    const bareSkills = [...cocBare.items].filter((itm) => itm.type === 'skill');
    const bareUnarmed = [...cocBare.items].find((itm) => itm.flags?.brp?.unarmed === true);
    check('cocStarterOffOnlyCocBrawl', bareSkills.length === 1
      && bareSkills[0].flags?.brp?.brpidFlag?.id === 'i.skill.coc.fighting-brawl'
      && bareSkills[0].system.base === 25
      && bareUnarmed?.system?.skill1 === 'i.skill.coc.fighting-brawl'
      && !bareSkills.some((itm) => itm.flags?.brp?.brpidFlag?.id === 'i.skill.brawl'),
      { skills: bareSkills.map((itm) => itm.flags?.brp?.brpidFlag?.id), unarmed: bareUnarmed?.system?.skill1 });
    await game.settings.set('brp', 'starterSkills', true);

    const dodge = skillBy(coc, 'i.skill.coc.dodge');
    const own = skillBy(coc, 'i.skill.coc.language-own');
    const brawl = skillBy(coc, 'i.skill.coc.fighting-brawl');
    const handgun = skillBy(coc, 'i.skill.coc.firearms-handgun');
    const rifle = skillBy(coc, 'i.skill.coc.firearms-rifle-shotgun');
    check('cocFormulaSkillBases', dodge?.system?.base === 27 && own?.system?.base === 60
      && brawl?.system?.base === 25 && handgun?.system?.base === 20 && rifle?.system?.base === 25,
      { dodge: dodge?.system?.base, own: own?.system?.base, brawl: brawl?.system?.base, handgun: handgun?.system?.base, rifle: rifle?.system?.base });
    check('cocSkillTotalsEqualBaseWithoutCategories', !!dodge && !!own && dodge.system.total === 27
      && own.system.total === 60 && Object.keys(coc.system.skillcategory ?? {}).length === 0,
      { dodge: dodge?.system?.total, own: own?.system?.total, categories: Object.keys(coc.system.skillcategory ?? {}) });

    check('cocDerivedAttributes', coc.system.health.max === 10 && coc.system.power.max === 8
      && coc.system.health.value === 10 && coc.system.build === 0
      && (coc.system.dmgBonus?.full === '0' || coc.system.dmgBonus?.full === '+0')
      && coc.system.mov === 8,
      { hp: coc.system.health, mp: coc.system.power, build: coc.system.build, db: coc.system.dmgBonus, mov: coc.system.mov });
    check('cocSanAndLuck', coc.system.sanity.starting === 40 && coc.system.sanity.value === 40
      && coc.system.sanity.max === 99 && Number.isFinite(Number(coc.system.luck.max))
      && coc.system.luck.max >= 15 && coc.system.luck.max <= 90
      && coc.system.luck.max % 5 === 0 && coc.system.luck.value === coc.system.luck.max,
      { san: coc.system.sanity, luck: coc.system.luck });
    check('cocChaIsAppAndEduEnabled', coc.system.stats.cha.total === 45
      && coc.system.stats.app === undefined && coc.system.stats.edu.total === 60
      && coc.system.stats.edu.visible === true
      && Number.isFinite(Number(coc.system.stats.cha.total)),
      { cha: coc.system.stats.cha, app: coc.system.stats.app, edu: coc.system.stats.edu });

    const before = game.messages.size;
    game.brp.BRPCheck._trigger({
      rollType: 'SK', cardType: 'NO', skillId: handgun.id, actor: coc, token: null, shiftKey: true
    });
    const card = await waitFor(() => [...game.messages.values()].slice(before)
      .find((m) => m.flags?.brp?.chatCard?.[0]?.particId === coc.id));
    const target = Number(card?.flags?.brp?.chatCard?.[0]?.targetScore);
    check('cocNativeTargetMatchesSkillTotal', target === 20 && target === handgun.system.total,
      { target, total: handgun.system.total });
    if (card) await card.delete();

    await handgun.update({ 'system.xp': 7 });
    await coc.prepareData();
    check('cocSpecialismsGrowIndependently', handgun.system.total === 27
      && rifle.system.total === 25 && Number(rifle.system.xp) === 0,
      { handgun: handgun.system.total, rifle: rifle.system.total, rifleXp: rifle.system.xp });

    const lvl = async (rollVal, targetScore) => Number(await game.brp.BRPCheck.successLevel({ rollVal, targetScore, cardType: 'NO' }));
    check('coc7AliasNoOctopusFallback', game.brp.rules.activeId() === 'coc'
      && coc.system.health.max === 10 && coc.system.power.max === 8 && coc.system.mov === 8
      && await lvl(96, 40) === 0 && await lvl(31, 60) === 2,
      { activeId: game.brp.rules.activeId(), hp: coc.system.health.max, mp: coc.system.power.max, mov: coc.system.mov, low96: await lvl(96, 40) });
    check('cocNativeSuccessLevels', await lvl(1, 60) === 4 && await lvl(12, 60) === 3
      && await lvl(30, 60) === 2 && await lvl(31, 60) === 2 && await lvl(61, 60) === 1
      && await lvl(96, 40) === 0 && await lvl(100, 60) === 0
      && game.brp.BRPCheck.successBand({ rollVal: 30, targetScore: 60 }).band === 'hard',
      { p01: await lvl(1, 60), p12: await lvl(12, 60), p30: await lvl(30, 60), p31: await lvl(31, 60), p61: await lvl(61, 60), low96: await lvl(96, 40), high100: await lvl(100, 60) });
    check('cocGrowthDelegation', game.brp.rules.active().growth.formula({ xpFormula: '1D6' }) === '1D10'
      && game.brp.rules.active().growth.bonus({ system: { xpBonus: 99 } }) === 0
      && game.brp.rules.active().growth.check({ roll: 21, targetScore: 20 }) === true,
      { formula: game.brp.rules.active().growth.formula({ xpFormula: '1D6' }), bonus: game.brp.rules.active().growth.bonus({ system: { xpBonus: 99 } }) });

    const mythos = skillBy(coc, 'i.skill.coc.cthulhu-mythos');
    await mythos.update({ 'system.base': 23 });
    await coc.prepareData();
    check('cocSanCapTracksMythos', coc.system.sanity.max === 76 && coc.system.sanity.value <= 76,
      { max: coc.system.sanity.max, value: coc.system.sanity.value, starting: coc.system.sanity.starting });

    // CoC core skills have no skill categories, so the native combat table must not
    // fold a missing category bonus into the weapon row (previously rendered as NaN).
    const cocUnarmed = [...coc.items].find((itm) => itm.flags?.brp?.unarmed === true);
    await coc.sheet.render(true);
    const cocCombatHtml = coc.sheet.element?.innerHTML ?? '';
    const cocWeaponScore = Number(cocUnarmed?.system?.skillScore);
    check('cocNativeWeaponRowNumericWithoutCategories',
      !!cocUnarmed && Number.isFinite(cocWeaponScore)
      && cocWeaponScore === [...coc.items].find((itm) => itm.flags?.brp?.brpidFlag?.id === 'i.skill.coc.fighting-brawl')?.system.total
      && !/NaN/.test(cocCombatHtml) && !/undefined/.test(cocCombatHtml),
      { skillScore: cocUnarmed?.system?.skillScore, skillName: cocUnarmed?.system?.skillName,
        nan: /NaN/.test(cocCombatHtml), undefined: /undefined/.test(cocCombatHtml) });

    cocNpc = await Actor.create({ name: 'Regression CoC NPC', type: 'npc', system: { stats: cocStats } }, { renderSheet: false });
    check('cocNpcNoStarter', [...cocNpc.items].filter((itm) => itm.type === 'skill').length === 0
      && ![...cocNpc.items].some((itm) => itm.flags?.brp?.unarmed === true),
      { skills: [...cocNpc.items].filter((itm) => itm.type === 'skill').length });

    await game.settings.set('brp', 'ruleset', 'octopus');
    octo = await Actor.create({
      name: 'Regression Octopus After CoC', type: 'character', system: { stats: cocStats }
    }, { renderSheet: false });
    const octoSkills = [...octo.items].filter((itm) => itm.type === 'skill');
    const octoCats = [...octo.items].filter((itm) => itm.type === 'skillcat');
    check('octopusStarterNotPollutedByCoC', game.brp.rules.activeId() === 'octopus'
      && octoSkills.length === 57 && octoCats.length === 6
      && !!skillBy(octo, 'i.skill.brawl')
      && !octoSkills.some((itm) => String(itm.flags?.brp?.brpidFlag?.id).startsWith('i.skill.coc.')),
      { activeId: game.brp.rules.activeId(), skills: octoSkills.length, cats: octoCats.length, brawl: !!skillBy(octo, 'i.skill.brawl') });

    // --- M2: the coc-professions pack loads through the real compendium path and
    // its documents are usable as creation sources (facts + resolvable skills).
    const profPack = [...game.packs.values()].find((p) => p.metadata?.name === 'coc-professions');
    const profIndex = profPack ? await profPack.getIndex() : null;
    const profEntries = Array.isArray(profIndex) ? profIndex : [...(profIndex?.values?.() ?? [])];
    const profDocs = profEntries.length
      ? await Promise.all(profEntries.map((entry) => profPack.getDocument(entry._id)))
      : [];
    check('cocProfessionPackLoads', !!profPack && profPack.metadata.type === 'Item'
      && profPack.metadata.system === 'brp' && profDocs.length === 38
      && profDocs.every((doc) => doc.type === 'profession'
        && doc.flags?.brp?.contentSource === 'coc'
        && /^i\.profession\.coc\.[a-z0-9]+(?:-[a-z0-9]+)*$/.test(doc.flags?.brp?.brpidFlag?.id)),
      { found: !!profPack, type: profPack?.metadata?.type, docs: profDocs.length });

    check('cocProfessionDocsCarryCreditAndFormulaNotWealth', profDocs.every((doc) => {
      const coc = doc.flags?.brp?.coc ?? {};
      const formulas = coc.pointFormulas ?? [coc.pointFormula];
      return coc.slug && Number.isInteger(coc.creditMin) && Number.isInteger(coc.creditMax)
        && coc.creditMin <= coc.creditMax
        && typeof coc.pointFormula === 'string' && coc.pointFormula.length > 0
        // Either/or occupations list every option; pointFormula stays the first.
        && Array.isArray(formulas) && formulas.length >= 1
        && formulas.every((formula) => typeof formula === 'string' && formula.length > 0)
        && formulas[0] === coc.pointFormula
        && doc.system.minWealth === 0 && doc.system.maxWealth === 0
        && coc.wealthNotApplicable === true;
    }), profDocs.map((doc) => [doc.name, doc.flags?.brp?.coc?.pointFormula, doc.flags?.brp?.coc?.creditMin, doc.flags?.brp?.coc?.creditMax]));

    check('cocProfessionSkillRefsResolveInWorld', (() => {
      const broken = [];
      for (const doc of profDocs) {
        const refs = [...(doc.system.skills ?? []), ...(doc.system.groups ?? []).flatMap((group) => group.skills ?? [])];
        if (!refs.length) broken.push(`${doc.name}: no skills`);
        for (const ref of refs) {
          const found = game.system.api.brpid.fromBRPIDBest({ brpid: ref.brpid })[0];
          if (!found || found.type !== 'skill') broken.push(`${doc.name}→${ref.brpid}`);
        }
      }
      return broken.length ? broken : true;
    })());

    // M5 either/or formula: the pack document exposes both options in order and
    // still carries the single-formula field for older readers.
    check('cocProfessionEitherOrFormulaInWorld', (() => {
      const detective = profDocs.find((doc) => doc.flags?.brp?.coc?.slug === 'police-detective');
      const librarian = profDocs.find((doc) => doc.flags?.brp?.coc?.slug === 'librarian');
      if (!detective || !librarian) return { detective: !!detective, librarian: !!librarian };
      const d = detective.flags.brp.coc;
      const l = librarian.flags.brp.coc;
      return Array.isArray(d.pointFormulas)
        && d.pointFormulas.length === 2
        && d.pointFormulas[0] === 'EDU*2+DEX*2' && d.pointFormulas[1] === 'EDU*2+STR*2'
        && d.pointFormula === d.pointFormulas[0]
        && !d.pointFormulas.some((formula) => formula.includes('MAX'))
        && !Array.isArray(l.pointFormulas)
        && l.pointFormula === 'EDU*4';
    })(), profDocs.filter((doc) => ['police-detective', 'librarian']
      .includes(doc.flags?.brp?.coc?.slug))
      .map((doc) => [doc.flags.brp.coc.slug, doc.flags.brp.coc.pointFormula, doc.flags.brp.coc.pointFormulas]));
  } finally {
    for (const actor of [coc, cocBare, cocNpc, octo]) { if (actor) { try { await actor.delete(); } catch { /* shim only */ } } }
    await game.settings.set('brp', 'ruleset', prevRuleset);
    await game.settings.set('brp', 'starterSkills', prevStarter);
  }
}

// --- 10) CoC M3 native combat and wound chain ---
// Every die here is a real Roll. Where a rule requires a fresh roll (tie,
// dive for cover) the check asserts the reroll request instead of accepting a
// winner picked from dice already on the table.
{
  const prevRuleset = game.settings.get('brp', 'ruleset');
  // The M1 block restores starter skills to the world default, which is off.
  // M3/M4 need real skill items on every fresh actor, so pin it here.
  const prevStarter = game.settings.get('brp', 'starterSkills');
  const skillBy = (actor, brpid) => [...actor.items].find((itm) => itm.type === 'skill' && itm.flags?.brp?.brpidFlag?.id === brpid);
  const unarmedOf = (actor) => [...actor.items].find((itm) => itm.flags?.brp?.unarmed === true);
  const bandRank = (band) => game.brp.rules.active().combat.bandRank(band);
  const baseStats = {
    str: { base: 80 }, con: { base: 50 }, siz: { base: 50 }, int: { base: 50 },
    pow: { base: 40 }, dex: { base: 55 }, cha: { base: 45 }, edu: { base: 60 },
  };
  let attacker = null, victim = null, weak = null, dodger = null, wounded = null, patient = null, brawler = null;
  try {
    await game.settings.set('brp', 'ruleset', 'coc7');
    await game.settings.set('brp', 'starterSkills', true);

    attacker = await Actor.create({ name: 'M3 Attacker', type: 'character', system: { stats: baseStats } }, { renderSheet: false });
    victim = await Actor.create({ name: 'M3 Victim', type: 'character', system: { stats: { ...baseStats, dex: { base: 5 }, str: { base: 40 } } } }, { renderSheet: false });
    weak = await Actor.create({ name: 'M3 Weak', type: 'character', system: { stats: baseStats } }, { renderSheet: false });
    dodger = await Actor.create({ name: 'M3 Dodger', type: 'character', system: { stats: { ...baseStats, dex: { base: 90 } } } }, { renderSheet: false });
    wounded = await Actor.create({ name: 'M3 Wounded', type: 'character', system: { stats: baseStats } }, { renderSheet: false });
    patient = await Actor.create({ name: 'M3 Patient', type: 'character', system: { stats: baseStats } }, { renderSheet: false });

    await skillBy(attacker, 'i.skill.coc.fighting-brawl').update({ 'system.xp': 60 });
    await attacker.prepareData();
    await skillBy(weak, 'i.skill.coc.fighting-brawl').update({ 'system.base': 1 });
    await weak.prepareData();
    await skillBy(dodger, 'i.skill.coc.dodge').update({ 'system.xp': 200 });
    await dodger.prepareData();
    await skillBy(patient, 'i.skill.coc.first-aid').update({ 'system.xp': 80 });
    await patient.prepareData();

    const attack = await game.brp.coc.attack({
      actor: attacker, itemId: unarmedOf(attacker).id, targetId: victim.id, targetType: 'actor', bonusDice: 1,
    });
    check('cocM3AttackCardCreated', typeof attack.messageId === 'string' && !attack.error,
      { attack });
    let msg = attack.messageId ? await game.messages.get(attack.messageId) : null;
    const entry = msg?.flags?.brp?.chatCard?.[0];
    check('cocM3AttackCarriesRealPoolAndBand', !!entry
      && msg.flags.brp.cardType === 'CB'
      && entry.rollFormula === '3D10'
      && Array.isArray(entry.diceDetail?.faces) && entry.diceDetail.faces.length === 3
      && entry.diceDetail.candidates.length === 2
      && entry.diceDetail.chosenTens === entry.diceDetail.candidates.find((cand) => cand.value === Number(entry.rollVal))?.tens
      && Number(entry.rollVal) === Math.min(...entry.diceDetail.candidates.map((cand) => cand.value))
      && ['critical', 'extreme', 'hard', 'regular', 'fail', 'fumble'].includes(entry.band)
      && Number(entry.bandRank) === bandRank(entry.band)
      && entry.taskSuccess === (bandRank(entry.band) >= 2)
      && entry.requiredBand === 'regular'
      && Array.isArray(msg.rolls) && msg.rolls.length === 1
      && msg.rolls[0].dice[0].values.length === 3,
      entry ? { formula: entry.rollFormula, detail: entry.diceDetail, band: entry.band, task: entry.taskSuccess, rolls: msg.rolls?.length } : { missing: true });
    check('cocM3AttackUsesLiveBrawlTotalAndUnarmedProfile', !!entry
      && Number(entry.targetScore) === 85
      && Number(entry.targetScore) === skillBy(attacker, 'i.skill.coc.fighting-brawl').system.total
      && entry.weaponProfile?.unarmed === true
      && entry.weaponProfile?.dbMode === 'full'
      && entry.weaponProfile?.impaling === false
      && entry.opposed?.role === 'attacker',
      entry ? { targetScore: entry.targetScore, brawl: skillBy(attacker, 'i.skill.coc.fighting-brawl').system.total, profile: entry.weaponProfile } : null);

    const chCardId = await game.brp.BRPCheck._trigger({
      rollType: 'CH', cardType: 'NO', characteristic: 'str', actor: attacker, token: null, shiftKey: true,
    });
    const chCard = await game.messages.get(chCardId);
    const chEntry = chCard?.flags?.brp?.chatCard?.[0];
    const hardCardId = await game.brp.BRPCheck._trigger({
      rollType: 'SK', cardType: 'NO', skillId: skillBy(attacker, 'i.skill.coc.fighting-brawl').id,
      actor: attacker, token: null, shiftKey: true, diff: 'hard',
    });
    const hardCard = await game.messages.get(hardCardId);
    const hardEntry = hardCard?.flags?.brp?.chatCard?.[0];
    check('cocM3CharacteristicAndDifficultyAreNotMultiplied', !!chEntry && !!hardEntry
      && Number(chEntry.targetScore) === 80
      && chEntry.targetScore === chEntry.rawScore
      && chEntry.requiredBand === 'regular'
      && Number(hardEntry.targetScore) === 85
      && hardEntry.targetScore === skillBy(attacker, 'i.skill.coc.fighting-brawl').system.total
      && hardEntry.requiredBand === 'hard'
      && Number(hardEntry.minimumRank) === 3
      && hardEntry.taskSuccess === (Number(hardEntry.bandRank) >= 3),
      { chTarget: chEntry?.targetScore, chRequired: chEntry?.requiredBand, hardTarget: hardEntry?.targetScore,
        hardRequired: hardEntry?.requiredBand, hardTask: hardEntry?.taskSuccess });
    if (chCard) { await chCard.delete(); }
    if (hardCard) { await hardCard.delete(); }

    check('cocM3UnarmedCarriesExplicitMarker', unarmedOf(attacker).system.special === 'none'
      && unarmedOf(attacker).flags?.brp?.coc?.weapon?.dbMode === 'full'
      && unarmedOf(attacker).flags?.brp?.coc?.weapon?.impaling === false,
      { special: unarmedOf(attacker).system.special, marker: unarmedOf(attacker).flags?.brp?.coc?.weapon });

    const defend = await game.brp.coc.defend({ messageId: attack.messageId, actor: victim, choice: 'dodge' });
    msg = await game.messages.get(attack.messageId);
    const defenderEntry = msg?.flags?.brp?.chatCard?.[1];
    check('cocM3DefendJoinsSameCardWithItsOwnRoll', !defend.error
      && msg.flags.brp.chatCard.length === 2
      && Array.isArray(msg.rolls) && msg.rolls.length === 2
      && defenderEntry.opposed?.role === 'defender'
      && defenderEntry.opposed?.choice === 'dodge'
      && Number(defenderEntry.targetScore) === skillBy(victim, 'i.skill.coc.dodge').system.total
      && defenderEntry.rollFormula === '1D100'
      && defenderEntry.roll?.dice?.[0]?.faces === 100,
      defenderEntry ? { choice: defenderEntry.opposed, target: defenderEntry.targetScore, rolls: msg.rolls?.length } : { defend });

    const firstResolve = await game.brp.coc.resolve({ messageId: attack.messageId });
    msg = await game.messages.get(attack.messageId);
    check('cocM3ResolveClosesAndRecordsOutcome', msg.flags.brp.state === 'closed'
      && ['attacker', 'defender', null].includes(firstResolve.winner)
      && msg.flags.brp.chatCard.every((card) => card.opposedOutcome)
      && msg.flags.brp.coc?.outcome?.winner === firstResolve.winner,
      { winner: firstResolve.winner, outcome: msg.flags.brp.coc?.outcome });

    // A guaranteed attacker hit: brawl 85 vs dodge 2, repeated real rolls until
    // the attacker wins, then assert the damage and the wound record.
    let hit = null;
    for (let attempt = 0; attempt < 12 && !hit; attempt++) {
      const before = victim.system.health.value;
      const attackRoll = await game.brp.coc.attack({
        actor: attacker, itemId: unarmedOf(attacker).id, targetId: victim.id, targetType: 'actor',
      });
      await game.brp.coc.defend({ messageId: attackRoll.messageId, actor: victim, choice: 'dodge' });
      const resolved = await game.brp.coc.resolve({ messageId: attackRoll.messageId });
      if (resolved.winner === 'attacker') {
        const hitMsg = await game.messages.get(attackRoll.messageId);
        hit = { resolved, msg: hitMsg, before, attempts: attempt + 1 };
      } else {
        await (await game.messages.get(attackRoll.messageId)).delete();
      }
    }
    const expectedFormula = hit
      ? (hit.resolved.tier === 'extreme' ? '7' : '1D3+1D4')
      : null;
    check('cocM3DamageIsRealAndWritesHealthOnly', !!hit
      && hit.resolved.damage >= 1
      && hit.resolved.formula === expectedFormula
      && hit.msg.flags.brp.chatCard[0].damageFormula === hit.resolved.formula
      && hit.msg.flags.brp.chatCard[1].damage?.total === hit.resolved.damage
      && Number(hit.msg.flags.brp.chatCard[1].wounds?.hpValue) === Number(victim.system.health.value)
      && victim.system.health.value < hit.before
      && victim.items.filter((itm) => itm.type === 'wound').length === 0
      && Number(victim.system.health.daily) === 0
      && victim.flags.brp.coc?.wounds?.initialised === true
      && Array.isArray(hit.msg.rolls) && hit.msg.rolls.length >= 3,
      hit ? { tier: hit.resolved.tier, formula: hit.resolved.formula, damage: hit.resolved.damage, before: hit.before,
        after: victim.system.health.value, wounds: victim.flags.brp.coc?.wounds, rolls: hit.msg.rolls?.length } : { hit: false });

    // Keep the target alive for the extreme-damage probes (the hit loop above
    // may have left it dying; a fresh track keeps the assertions about damage
    // totals, not death bookkeeping).
    await victim.update({
      'system.health.value': victim.system.health.max,
      'flags.brp.coc.wounds': {
        initialised: true, hpValue: victim.system.health.max, hpMax: victim.system.health.max,
        majorWound: false, dying: false, dead: false, unconscious: false,
      },
    });

    // Extreme blunt damage from real rolls: max weapon + max DB as a fixed
    // value (no maximize call). Repeat real attacks until an extreme hit lands.
    let extremeBlunt = null;
    for (let attempt = 0; attempt < 24 && !extremeBlunt; attempt++) {
      const attackRoll = await game.brp.coc.attack({ actor: attacker, itemId: unarmedOf(attacker).id, targetId: victim.id, targetType: 'actor' });
      const attackMsg = await game.messages.get(attackRoll.messageId);
      if (attackMsg.flags.brp.chatCard[0].band !== 'extreme') { await attackMsg.delete(); continue; }
      await game.brp.coc.defend({ messageId: attackRoll.messageId, actor: victim, choice: 'dodge' });
      const resolved = await game.brp.coc.resolve({ messageId: attackRoll.messageId });
      if (resolved.winner === 'attacker') { extremeBlunt = resolved; }
      else { await (await game.messages.get(attackRoll.messageId)).delete(); }
    }
    check('cocM3ExtremeBluntIsMaxWeaponPlusMaxDb', !!extremeBlunt
      && extremeBlunt.tier === 'extreme'
      && extremeBlunt.formula === '7'
      && extremeBlunt.damage === 7,
      extremeBlunt ? { tier: extremeBlunt.tier, formula: extremeBlunt.formula, damage: extremeBlunt.damage } : { found: false });

    // Impaling extreme: max weapon + DB + another weapon die.
    const knife = await Item.create({
      name: 'M3 Knife', type: 'weapon',
      system: { weaponType: 'melee', skill1: 'i.skill.coc.fighting-brawl', skill2: 'none', dmg1: '1D6', db: 'full', special: 'impale', att: 1, hands: '1H', range1: 'S' },
    }, { parent: attacker, renderSheet: false });
    let extremeImpale = null;
    for (let attempt = 0; attempt < 24 && !extremeImpale; attempt++) {
      const attackRoll = await game.brp.coc.attack({ actor: attacker, itemId: knife.id, targetId: victim.id, targetType: 'actor' });
      const attackMsg = await game.messages.get(attackRoll.messageId);
      if (attackMsg.flags.brp.chatCard[0].band !== 'extreme') { await attackMsg.delete(); continue; }
      await game.brp.coc.defend({ messageId: attackRoll.messageId, actor: victim, choice: 'dodge' });
      const resolved = await game.brp.coc.resolve({ messageId: attackRoll.messageId });
      if (resolved.winner === 'attacker') { extremeImpale = resolved; }
      else { await (await game.messages.get(attackRoll.messageId)).delete(); }
    }
    check('cocM3ExtremeImpaleAddsAnotherWeaponDie', !!extremeImpale
      && extremeImpale.tier === 'extreme'
      && extremeImpale.formula === '1D4+1D6+6'
      && extremeImpale.damage >= 8 && extremeImpale.damage <= 16,
      extremeImpale ? { tier: extremeImpale.tier, formula: extremeImpale.formula, damage: extremeImpale.damage } : { found: false });

    // Dodge win: no damage, no fabricated wound.
    let dodgeWin = null;
    for (let attempt = 0; attempt < 30 && !dodgeWin; attempt++) {
      const before = dodger.system.health.value;
      const attackRoll = await game.brp.coc.attack({
        actor: weak, itemId: unarmedOf(weak).id, targetId: dodger.id, targetType: 'actor',
      });
      await game.brp.coc.defend({ messageId: attackRoll.messageId, actor: dodger, choice: 'dodge' });
      const resolved = await game.brp.coc.resolve({ messageId: attackRoll.messageId });
      if (resolved.winner === 'defender') {
        dodgeWin = { resolved, before, after: dodger.system.health.value, attempts: attempt + 1 };
      } else {
        await (await game.messages.get(attackRoll.messageId)).delete();
        await dodger.update({ 'system.health.value': dodger.system.health.max, 'flags.brp.coc.wounds': { initialised: true, hpValue: dodger.system.health.max, hpMax: dodger.system.health.max, majorWound: false, dying: false, dead: false, unconscious: false } });
      }
    }
    check('cocM3DodgeWinDealsNoDamage', !!dodgeWin
      && dodgeWin.resolved.damage === 0 && dodgeWin.after === dodgeWin.before
      && !dodger.flags?.brp?.coc?.wounds?.lastDamage,
      dodgeWin ?? { found: false });

    // Firearms: no fight-back, cover allowed, machine modifiers from the facts
    // the caller supplies (2 shots -> penalty, point blank -> bonus).
    const gun = await Item.create({
      name: 'M3 Handgun', type: 'weapon',
      system: { weaponType: 'firearm', skill1: 'i.skill.coc.firearms-handgun', skill2: 'none', dmg1: '1D10', db: 'none', special: 'none', att: 2, hands: '1H', range1: '10', mal: 96 },
    }, { parent: attacker, renderSheet: false });
    const gunAttack = await game.brp.coc.attack({
      actor: attacker, itemId: gun.id, targetId: dodger.id, targetType: 'actor', shots: 2, distanceFeet: 5,
    });
    const gunMsg = await game.messages.get(gunAttack.messageId);
    const gunEntry = gunMsg?.flags?.brp?.chatCard?.[0];
    check('cocM3FirearmProfileAndDiceModifiers', !!gunEntry
      && gunEntry.weaponProfile?.ranged === true
      && gunEntry.weaponProfile?.dbMode === 'none'
      && gunEntry.weaponProfile?.impaling === false
      && gunEntry.diceDetail?.bonus === 0 && gunEntry.diceDetail?.penalty === 0
      && gunEntry.rollFormula === '1D100',
      gunEntry ? { profile: gunEntry.weaponProfile, detail: gunEntry.diceDetail, shots: gunAttack.bonusDice, penalty: gunAttack.penaltyDice } : null);
    const fightback = await game.brp.coc.defend({
      messageId: gunAttack.messageId, actor: dodger, choice: 'fightback', itemId: unarmedOf(dodger)?.id,
    });
    check('cocM3FirearmCannotBeFoughtBack', fightback.error === 'defense-not-allowed'
      && Array.isArray(fightback.allowed) && fightback.allowed.join() === 'cover',
      fightback);
    let cover = null;
    for (let attempt = 0; attempt < 10 && !cover; attempt++) {
      const rolling = attempt === 0
        ? gunAttack.messageId
        : (await game.brp.coc.attack({ actor: attacker, itemId: gun.id, targetId: dodger.id, targetType: 'actor' })).messageId;
      const joining = await game.brp.coc.defend({ messageId: rolling, actor: dodger, choice: 'cover' });
      if (!joining.error) {
        const resolved = await game.brp.coc.resolve({ messageId: rolling });
        if (resolved.reroll) { cover = { resolved, messageId: rolling }; }
        else { await (await game.messages.get(rolling)).delete(); }
      }
    }
    const coverFlags = cover ? (await game.messages.get(cover.messageId))?.flags?.brp?.coc?.reroll : null;
    check('cocM3CoverAsksForFreshPenalizedAttack', !!cover
      && cover.resolved.reroll === true
      && cover.resolved.mode === 'attacker'
      && cover.resolved.penaltyDice === 1
      && coverFlags?.penaltyDice === 1
      && coverFlags?.defenderForfeitsNextAttack === true,
      cover ? { resolved: { mode: cover.resolved.mode, penaltyDice: cover.resolved.penaltyDice }, flags: coverFlags } : { found: false });

    // Fighting back with a better weapon skill: the defender can win, but the
    // damage stays regular even when their roll is extreme.
    brawler = await Actor.create({
      name: 'M3 Brawler', type: 'character',
      system: { stats: { ...baseStats, siz: { base: 80 } } },
    }, { renderSheet: false });
    await skillBy(brawler, 'i.skill.coc.fighting-brawl').update({ 'system.xp': 200 });
    await brawler.prepareData();
    let fightbackWin = null;
    for (let attempt = 0; attempt < 20 && !fightbackWin; attempt++) {
      const before = weak.system.health.value;
      const attackRoll = await game.brp.coc.attack({
        actor: weak, itemId: unarmedOf(weak).id, targetId: brawler.id, targetType: 'actor',
      });
      await game.brp.coc.defend({
        messageId: attackRoll.messageId, actor: brawler, choice: 'fightback', itemId: unarmedOf(brawler).id,
      });
      const resolved = await game.brp.coc.resolve({ messageId: attackRoll.messageId });
      if (resolved.winner === 'defender') {
        fightbackWin = { resolved, before, after: weak.system.health.value, message: await game.messages.get(attackRoll.messageId) };
      } else {
        await (await game.messages.get(attackRoll.messageId)).delete();
      }
    }
    check('cocM3FightbackDealsRegularDamageOnly', !!fightbackWin
      && fightbackWin.resolved.tier === 'regular'
      && fightbackWin.resolved.formula === '1D3+1D4'
      && fightbackWin.after < fightbackWin.before
      && fightbackWin.message.flags.brp.chatCard.find((card) => card.opposed?.role === 'defender')?.tier === 'regular',
      fightbackWin ? { tier: fightbackWin.resolved.tier, formula: fightbackWin.resolved.formula, before: fightbackWin.before, after: fightbackWin.after } : { found: false });

    // A maneuver that wins deals no damage; a Build deficit of three is refused
    // before any dice are rolled.
    const ineffective = await game.brp.coc.attack({
      actor: attacker, itemId: unarmedOf(attacker).id, targetId: victim.id, maneuver: { defenderBuild: 9 },
    });
    check('cocM3ManeuverRejectsThreeBuildDeficit', ineffective.error === 'maneuver-ineffective'
      && ineffective.maneuver?.effective === false,
      ineffective);
    let maneuverWin = null;
    for (let attempt = 0; attempt < 12 && !maneuverWin; attempt++) {
      const attackRoll = await game.brp.coc.attack({
        actor: attacker, itemId: unarmedOf(attacker).id, targetId: victim.id, maneuver: { defenderBuild: 2 },
      });
      const attackMsg = await game.messages.get(attackRoll.messageId);
      if (attackMsg.flags.brp.chatCard[0].opposed?.maneuver !== true
        || attackMsg.flags.brp.chatCard[0].diceDetail?.penalty !== 1) {
        await attackMsg.delete();
        continue;
      }
      const victimHp = victim.system.health.value;
      await game.brp.coc.defend({ messageId: attackRoll.messageId, actor: victim, choice: 'dodge' });
      const resolved = await game.brp.coc.resolve({ messageId: attackRoll.messageId });
      if (resolved.winner === 'attacker') {
        maneuverWin = { resolved, victimHp, after: victim.system.health.value };
      } else {
        await (await game.messages.get(attackRoll.messageId)).delete();
      }
    }
    check('cocM3ManeuverWinDealsNoDamage', !!maneuverWin
      && maneuverWin.resolved.maneuver === true
      && maneuverWin.resolved.damage === 0
      && maneuverWin.after === maneuverWin.victimHp,
      maneuverWin ?? { found: false });

    // Thrown/missile DB is the halved die, not the full one.
    const bow = await Item.create({
      name: 'M3 Bow', type: 'weapon',
      system: { weaponType: 'missile', skill1: 'i.skill.coc.firearms-rifle-shotgun', skill2: 'none', dmg1: '1D6', db: '', special: 'none', att: 1, hands: '2H', range1: '20' },
    }, { parent: attacker, renderSheet: false });
    let bowHit = null;
    for (let attempt = 0; attempt < 20 && !bowHit; attempt++) {
      const attackRoll = await game.brp.coc.attack({ actor: attacker, itemId: bow.id, targetId: victim.id, targetType: 'actor' });
      const attackMsg = await game.messages.get(attackRoll.messageId);
      if (attackMsg.flags.brp.chatCard[0].weaponProfile?.dbMode !== 'half') {
        await attackMsg.delete();
        continue;
      }
      await game.brp.coc.defend({ messageId: attackRoll.messageId, actor: victim, choice: 'dodge' });
      const resolved = await game.brp.coc.resolve({ messageId: attackRoll.messageId });
      if (resolved.winner === 'attacker') {
        bowHit = resolved;
      } else {
        await (await game.messages.get(attackRoll.messageId)).delete();
      }
    }
    check('cocM3MissileUsesHalfDb', !!bowHit
      && bowHit.formula === (bowHit.tier === 'extreme' ? '8' : '1D6+1D2'),
      bowHit ? { tier: bowHit.tier, formula: bowHit.formula } : { found: false });

    // Generic opposed tie: equal bands and equal skill ask for a fresh pair of
    // rolls; the re-roll compares the new d100 faces (lower wins) and never
    // reuses the tied dice.
    let tie = null;
    const opA = await Actor.create({ name: 'M3 OP A', type: 'character', system: { stats: baseStats } }, { renderSheet: false });
    const opB = await Actor.create({ name: 'M3 OP B', type: 'character', system: { stats: baseStats } }, { renderSheet: false });
    for (let attempt = 0; attempt < 24 && !tie; attempt++) {
      const first = await game.brp.BRPCheck._trigger({
        rollType: 'SK', cardType: 'OP', skillId: skillBy(opA, 'i.skill.coc.language-own').id,
        actor: opA, token: null, shiftKey: true,
      });
      await game.brp.BRPCheck._trigger({
        rollType: 'SK', cardType: 'OP', skillId: skillBy(opB, 'i.skill.coc.language-own').id,
        actor: opB, token: null, shiftKey: true,
      });
      const opMessage = await game.messages.get(first);
      if (!opMessage || opMessage.flags.brp.chatCard.length < 2) { continue; }
      const resolved = await game.brp.coc.resolve({ messageId: first });
      if (resolved.reroll === true) {
        const before = opMessage.flags.brp.chatCard.map((card) => Number(card.rollVal));
        const rerolled = await game.brp.coc.reroll({ messageId: first });
        const afterMsg = await game.messages.get(first);
        const after = afterMsg.flags.brp.chatCard.map((card) => Number(card.rollVal));
        if (rerolled.reroll || after[0] === after[1]) { await afterMsg.delete(); continue; }
        tie = { resolved, rerolled, before, after, state: afterMsg.flags.brp.state,
          rolls: afterMsg.rolls?.length, winner: rerolled.winner,
          lower: after[0] < after[1] ? 'attacker' : 'defender' };
      } else {
        await opMessage.delete();
      }
    }
    check('cocM3OpposedTieRerollsFreshDice', !!tie
      && tie.resolved.mode === 'both'
      && tie.after.length === 2
      && tie.state === 'closed'
      && Number(tie.rolls) >= 4
      && (tie.winner === 'attacker' || tie.winner === 'defender')
      && tie.winner === (tie.after[0] < tie.after[1] ? 'attacker' : 'defender'),
      tie ?? { found: false });
    for (const opActor of [opA, opB]) { try { await opActor.delete(); } catch { /* shim only */ } }

    // Both sides failing the required band is a failure for both, not a
    // skill-value win.
    let bothFailed = null;
    const failA = await Actor.create({ name: 'M3 Fail A', type: 'character', system: { stats: baseStats } }, { renderSheet: false });
    const failB = await Actor.create({ name: 'M3 Fail B', type: 'character', system: { stats: baseStats } }, { renderSheet: false });
    await skillBy(failA, 'i.skill.coc.language-own').update({ 'system.base': 1 });
    await skillBy(failB, 'i.skill.coc.language-own').update({ 'system.base': 1 });
    await failA.prepareData(); await failB.prepareData();
    for (let attempt = 0; attempt < 10 && !bothFailed; attempt++) {
      const first = await game.brp.BRPCheck._trigger({
        rollType: 'SK', cardType: 'OP', skillId: skillBy(failA, 'i.skill.coc.language-own').id,
        actor: failA, token: null, shiftKey: true,
      });
      await game.brp.BRPCheck._trigger({
        rollType: 'SK', cardType: 'OP', skillId: skillBy(failB, 'i.skill.coc.language-own').id,
        actor: failB, token: null, shiftKey: true,
      });
      const opMessage = await game.messages.get(first);
      if (!opMessage || opMessage.flags.brp.chatCard.length < 2) { continue; }
      const failed = opMessage.flags.brp.chatCard.every((card) => card.taskSuccess === false);
      const resolved = await game.brp.coc.resolve({ messageId: first });
      if (failed) { bothFailed = { resolved, state: (await game.messages.get(first)).flags.brp.state }; }
      else { await opMessage.delete(); }
    }
    check('cocM3OpposedBothFailedHasNoWinner', !!bothFailed
      && bothFailed.resolved.winner === null
      && bothFailed.resolved.outcome?.reason === 'both-failed'
      && bothFailed.state === 'closed',
      bothFailed ?? { found: false });
    for (const failActor of [failA, failB]) { try { await failActor.delete(); } catch { /* shim only */ } }

    // Deterministic wound transitions.
    const hpMax = wounded.system.health.max;
    await wounded.update({
      'system.health.value': Math.floor(hpMax / 2),
      'flags.brp.coc.wounds': { initialised: true, hpValue: Math.floor(hpMax / 2), hpMax, majorWound: false, dying: false, dead: false, unconscious: false },
    });
    const damage = await game.brp.coc.damage({ actorId: wounded.id, damage: Math.ceil(hpMax / 2) });
    check('cocM3MajorWoundAndDying', damage.applied === true
      && damage.majorWound === true && damage.dying === true
      && wounded.system.health.value === 0 && wounded.system.unconscious === true
      && wounded.system.dead === false
      && wounded.flags.brp.coc.wounds.majorWound === true
      && wounded.flags.brp.coc.wounds.dying === true
      && wounded.flags.brp.coc.wounds.dead === false
      && damage.conCheck && damage.conCheck.rollVal >= 1 && damage.conCheck.rollVal <= 100,
      { damage: { hp: damage.hpAfter, major: damage.majorWound, dying: damage.dying, con: damage.conCheck?.rollVal, passed: damage.conCheck?.passed },
        flags: wounded.flags.brp.coc.wounds, hp: wounded.system.health.value });

    await wounded.sheet.render(true);
    const woundHtml = wounded.sheet.element?.innerHTML ?? '';
    check('cocM3SheetReflectsWoundState', wounded.system.dead === false
      && wounded.system.unconscious === true && wounded.system.dying === true && wounded.system.majorWound === true
      && wounded.system.cocWounds === true
      && woundHtml.includes('fa-heart-pulse') && woundHtml.includes('fa-crutches')
      && !woundHtml.includes('NaN'),
      { dead: wounded.system.dead, unconscious: wounded.system.unconscious, dying: wounded.system.dying,
        major: wounded.system.majorWound, icons: [woundHtml.includes('fa-heart-pulse'), woundHtml.includes('fa-crutches')] });

    const dyingRound = await game.brp.coc.dyingRound({ actorId: wounded.id });
    check('cocM3DyingRoundRollsCon', dyingRound.applied === true
      && dyingRound.conCheck.rollVal >= 1 && dyingRound.conCheck.rollVal <= 100
      && dyingRound.dead === !dyingRound.conCheck.passed
      && (wounded.flags.brp.coc.wounds.dead === true) === dyingRound.dead,
      { skipped: dyingRound.skipped, dead: dyingRound.dead, con: dyingRound.conCheck?.rollVal, passed: dyingRound.conCheck?.passed });

    const alivePatient = dyingRound.dead ? await Actor.create({ name: 'M3 Patient B', type: 'character', system: { stats: baseStats } }, { renderSheet: false }) : wounded;
    if (dyingRound.dead) {
      await alivePatient.update({
        'system.health.value': 0,
        'flags.brp.coc.wounds': { initialised: true, hpValue: 0, hpMax: alivePatient.system.health.max, majorWound: true, dying: true, dead: false, unconscious: true, stabilized: false },
      });
    }
    const aid = await game.brp.coc.firstAid({ actorId: alivePatient.id, band: 'regular', rank: 2 });
    check('cocM3FirstAidStabilizesDying', aid.applied === true
      && alivePatient.system.health.value === 1
      && alivePatient.flags.brp.coc.wounds.dying === false
      && alivePatient.flags.brp.coc.wounds.stabilized === true,
      { hp: alivePatient.system.health.value, flags: alivePatient.flags.brp.coc.wounds });
    const medicine = await game.brp.coc.medicine({ actorId: alivePatient.id, band: 'regular', rank: 2 });
    check('cocM3MedicineHealsOneD3', medicine.applied === true
      && medicine.effect.formula === '1D3'
      && medicine.healing.applied >= 1 && medicine.healing.applied <= 3
      && alivePatient.flags.brp.coc.wounds.majorWound === true,
      { formula: medicine.effect.formula, applied: medicine.healing?.applied, flags: alivePatient.flags.brp.coc.wounds });
    const weekly = await game.brp.coc.weeklyHeal({ actorId: alivePatient.id, band: 'extreme', rank: 4 });
    check('cocM3WeeklyExtremeClearsMajorWound', weekly.applied === true
      && weekly.effect.formula === '2D3'
      && weekly.effect.clearsMajorWound === true
      && alivePatient.flags.brp.coc.wounds.majorWound === false,
      { applied: weekly.healing?.applied, flags: alivePatient.flags.brp.coc.wounds });
    // Keep one point of headroom so the daily +1 is observable even if the
    // weekly roll filled the track.
    if (alivePatient.system.health.value >= alivePatient.system.health.max) {
      const max = alivePatient.system.health.max;
      await alivePatient.update({
        'system.health.value': Math.max(0, max - 1),
        'flags.brp.coc.wounds': { ...(alivePatient.flags.brp.coc?.wounds ?? {}), initialised: true, hpValue: Math.max(0, max - 1), hpMax: max },
      });
    }
    const natural = await game.brp.coc.naturalHeal({ actorId: alivePatient.id });
    check('cocM3NaturalHealOnePerDay', natural.applied === true && natural.healing.applied === 1,
      { applied: natural.healing?.applied, hp: alivePatient.system.health.value });

    const instant = await game.brp.coc.damage({ actorId: alivePatient.id, damage: 999 });
    check('cocM3InstantDeath', instant.applied === true && instant.instantDeath === true
      && alivePatient.system.health.value === 0
      && alivePatient.system.dead === true
      && alivePatient.flags.brp.coc.wounds.dead === true,
      { hp: alivePatient.system.health.value, dead: alivePatient.system.dead, flags: alivePatient.flags.brp.coc.wounds });

    const zeroNoMajor = await Actor.create({ name: 'M3 Zero', type: 'character', system: { stats: baseStats } }, { renderSheet: false });
    await zeroNoMajor.update({
      'system.health.value': 3,
      'flags.brp.coc.wounds': { initialised: true, hpValue: 3, hpMax: zeroNoMajor.system.health.max, majorWound: false, dying: false, dead: false, unconscious: false },
    });
    const plainZero = await game.brp.coc.damage({ actorId: zeroNoMajor.id, damage: 3 });
    check('cocM3ZeroHpWithoutMajorIsUnconsciousOnly', plainZero.applied === true
      && plainZero.majorWound === false && plainZero.dying === false
      && zeroNoMajor.system.health.value === 0
      && zeroNoMajor.system.unconscious === true && zeroNoMajor.system.dead === false,
      { hp: zeroNoMajor.system.health.value, flags: zeroNoMajor.flags.brp.coc.wounds, dead: zeroNoMajor.system.dead });
    await zeroNoMajor.delete();

    // Native First Aid skill roll: the successful roll itself treats the patient.
    await patient.update({
      'system.health.value': 4,
      'flags.brp.coc.wounds': { initialised: true, hpValue: 4, hpMax: patient.system.health.max, majorWound: false, dying: false, dead: false, unconscious: false },
    });
    let treatment = null;
    for (let attempt = 0; attempt < 10 && !treatment?.applied; attempt++) {
      await game.brp.BRPCheck._trigger({
        rollType: 'SK', cardType: 'NO', skillId: skillBy(patient, 'i.skill.coc.first-aid').id,
        actor: patient, token: null, shiftKey: true,
      });
      const card = [...game.messages.values()]
        .filter((message) => message.flags?.brp?.cardType === 'NO' && message.flags?.brp?.chatCard?.[0]?.particId === patient.id
          && message.flags?.brp?.chatCard?.[0]?.cocTreatment)
        .at(-1);
      treatment = card?.flags?.brp?.chatCard?.[0]?.cocTreatment ?? null;
      for (const message of [...game.messages.values()]) {
        if (message.flags?.brp?.cardType === 'NO' && message.flags?.brp?.chatCard?.[0]?.particId === patient.id) { await message.delete(); }
      }
    }
    check('cocM3FirstAidSkillAppliesTreatment', !!treatment?.applied
      && treatment.skill === 'first-aid'
      && patient.system.health.value === 5
      && patient.flags.brp.coc.wounds.firstAid?.healed === 1,
      { treatment, hp: patient.system.health.value, flags: patient.flags.brp.coc.wounds });

    // Two different attackers must never be grafted onto one open card. The
    // octopus resolver reuses any open CB message; the CoC path gates reuse on
    // the initiating actor so the second strike opens its own card.
    await victim.update({
      'system.health.value': victim.system.health.max,
      'flags.brp.coc.wounds': { initialised: true, hpValue: victim.system.health.max, hpMax: victim.system.health.max, majorWound: false, dying: false, dead: false, unconscious: false },
    });
    const firstStrike = await game.brp.coc.attack({ actor: attacker, itemId: unarmedOf(attacker).id, targetId: victim.id, targetType: 'actor' });    const secondStrike = await game.brp.coc.attack({ actor: weak, itemId: unarmedOf(weak).id, targetId: victim.id, targetType: 'actor' });
    const firstMessage = await game.messages.get(firstStrike.messageId);
    check('cocM3SecondAttackerOpensItsOwnCard', !!firstStrike.messageId && !!secondStrike.messageId
      && secondStrike.messageId !== firstStrike.messageId
      && firstMessage?.flags?.brp?.chatCard?.length === 1
      && firstMessage.flags.brp.chatCard[0].particId === attacker.id,
      { first: firstStrike.messageId, second: secondStrike.messageId,
        entries: firstMessage?.flags?.brp?.chatCard?.map((card) => card.particId) });

    // A target that simply does not defend: the attack still resolves, on its
    // own band, and the damage lands on the declared target.
    await victim.update({
      'system.health.value': victim.system.health.max,
      'flags.brp.coc.wounds': { initialised: true, hpValue: victim.system.health.max, hpMax: victim.system.health.max, majorWound: false, dying: false, dead: false, unconscious: false },
    });
    let unopposed = null;
    for (let attempt = 0; attempt < 20 && !unopposed; attempt++) {
      const roll = await game.brp.coc.attack({ actor: attacker, itemId: unarmedOf(attacker).id, targetId: victim.id, targetType: 'actor' });
      const message = await game.messages.get(roll.messageId);
      const entry = message?.flags?.brp?.chatCard?.[0];
      if (!entry || Number(entry.bandRank) < 2) { await message.delete(); continue; }
      const before = victim.system.health.value;
      const resolved = await game.brp.coc.resolve({ messageId: roll.messageId });
      const after = await game.messages.get(roll.messageId);
      if (resolved.winner === 'attacker' && resolved.choice === 'none') {
        unopposed = { resolved, before, hpAfter: victim.system.health.value, entries: after.flags.brp.chatCard.length, state: after.flags.brp.state };
      } else {
        await after.delete();
      }
    }
    check('cocM3UnopposedAttackResolvesAndDamagesTarget', !!unopposed
      && unopposed.resolved.reason === 'unopposed'
      && unopposed.resolved.damage >= 1
      && unopposed.hpAfter < unopposed.before
      && unopposed.entries === 1
      && unopposed.state === 'closed',
      unopposed ? { winner: unopposed.resolved.winner, reason: unopposed.resolved.reason, damage: unopposed.resolved.damage,
        before: unopposed.before, after: unopposed.hpAfter, entries: unopposed.entries } : { found: false });
    for (const message of [...game.messages.values()]) {
      if (message.flags?.brp?.cardType === 'CB' && message.flags?.brp?.state !== 'closed') { await message.delete(); }
    }

    // Octopus keeps its own damage arithmetic and never enters the CoC chain.
    await game.settings.set('brp', 'ruleset', 'octopus');
    const octopusActive = game.brp.rules.active();
    const cocAttackOutside = await game.brp.coc.attack({ actor: attacker, itemId: unarmedOf(attacker).id });
    check('cocM3OctopusStaysOnBrpPath', octopusActive.id === 'octopus'
      && octopusActive.combat === undefined
      && cocAttackOutside.error === 'ruleset-not-coc'
      && game.brp.BRPCheck.resultLabel({ resultLevel: 2, band: 'regular' }) === game.i18n.localize('BRP.resultLevel.2'),
      { id: octopusActive.id, combat: typeof octopusActive.combat, attackError: cocAttackOutside.error });
  } finally {
    for (const actor of [attacker, victim, weak, dodger, wounded, patient, brawler]) {
      if (actor) { try { await actor.delete(); } catch { /* shim only */ } }
    }
    try { await game.settings.set('brp', 'ruleset', prevRuleset); } catch { /* shim only */ }
    try { await game.settings.set('brp', 'starterSkills', prevStarter); } catch { /* shim only */ }
  }
}

// --- 11) CoC M4 native SAN / madness / Luck / growth / clock chain ---
// Every die is a real Roll; the deterministic helper only fixes the face values
// of dice calls (Math.random inside the shim's Roll engine), never a result or a
// chat card. Cards are built by the native BRPCheck path and settled by the
// active-GM writer.
{
  const prevRuleset = game.settings.get('brp', 'ruleset');
  const prevStarter = game.settings.get('brp', 'starterSkills');
  const prevAutoXP = game.settings.get('brp', 'autoXP');
  const prevDevelopment = game.settings.get('brp', 'development');
  const prevWorld = game.settings.get('brp', 'worldTime');
  const prevSeq = game.settings.get('brp', 'cocDaySeq');
  const prevSession = game.settings.get('brp', 'cocSessionSeq');
  const prevWorldTime = game.time?.worldTime ?? 0;
  const realRandom = Math.random;
  const diceQueue = [];
  const face = (value, faces) => (value - 1) / faces;
  const queueDice = (...values) => { diceQueue.length = 0; diceQueue.push(...values); };
  Math.random = () => {
    const stack = String(new Error().stack ?? '');
    if (/shim[\\/]roll\.mjs/.test(stack)) {
      return diceQueue.length ? diceQueue.shift() : realRandom();
    }
    return realRandom();
  };
  const snap = (message) => (message ? foundry.utils.deepClone(message.flags?.brp ?? {}) : null);
  const cardFrom = (before) => [...game.messages.values()].slice(before)
    .find((message) => message.flags?.brp?.chatCard?.[0]?.particId && message.flags?.brp?.chatCard?.length) ?? null;
  const statuses = (actor) => [...(actor?.effects ?? [])]
    .map((effect) => [...(effect.statuses ?? [])]).flat();
  const tempEffect = (actor) => [...(actor?.effects ?? [])].find((effect) => effect.statuses?.has?.('tempInsane')) ?? null;
  const activeTempEffect = (actor) => [...(actor?.effects ?? [])]
    .find((effect) => effect.statuses?.has?.('tempInsane') && effect.disabled !== true) ?? null;
  const indefiniteEffect = (actor) => [...(actor?.effects ?? [])].find((effect) => effect.statuses?.has?.('indefiniteInsane')) ?? null;
  const permaEffect = (actor) => [...(actor?.effects ?? [])].find((effect) => effect.statuses?.has?.('permaInsane')) ?? null;
  const cocStats = {
    str: { base: 60 }, con: { base: 50 }, siz: { base: 50 }, int: { base: 90 },
    pow: { base: 40 }, dex: { base: 55 }, cha: { base: 45 }, edu: { base: 60 },
  };
  const newCoc = async (name, stats = cocStats) => {
    const actor = await Actor.create({ name, type: 'character', system: { age: 30, stats } }, { renderSheet: false });
    await actor.initSanity();
    return actor;
  };
  const setDay = async (actor, san, dayId = 'day-m4.1', dailyLoss = 0) => actor.update({
    'system.sanity.value': san,
    'system.sanity.dayId': dayId,
    'system.sanity.dayStartSan': san,
    'system.sanity.dayStartSource': 'keeper-new-day',
    'system.sanity.dailyLoss': dailyLoss,
  });
  const deleteCardsFor = async (actor) => {
    for (const message of [...game.messages.values()]) {
      if (message.flags?.brp?.chatCard?.[0]?.particId === actor.id) { await message.delete(); }
    }
  };
  const actors = [];
  try {
    await game.settings.set('brp', 'ruleset', 'coc');
    await game.settings.set('brp', 'starterSkills', true);
    await game.settings.set('brp', 'autoXP', '0');
    // Isolate the clock assertions from earlier M3 probes.
    try { await game.settings.set('brp', 'worldTime', 0); } catch { /* shim only */ }
    try { game.time.worldTime = 0; } catch { /* shim only */ }

    // 1) The SAN card rolls against the current SAN; the paired loss is a real
    // 1D6, and a 5-point loss with a successful INT opens a real 1D10h episode.
    queueDice(face(6, 6));
    const lossSix = await game.brp.BRPCheck._rollSanLoss('1D6');
    queueDice(face(1, 6));
    const lossOne = await game.brp.BRPCheck._rollSanLoss('1D6');
    check('cocM4PairedLossIsARealRoll', lossSix === 6 && lossOne === 1,
      { lossSix, lossOne });
    const sanCardActor = await newCoc('M4 SAN Card');
    actors.push(sanCardActor);
    await setDay(sanCardActor, 37);
    let before = game.messages.size;
    queueDice(face(90, 100), face(5, 6), face(81, 100), face(3, 10), face(2, 10), face(4, 10));
    await game.brp.BRPCheck._trigger({ rollType: 'SN', cardType: 'NO', shiftKey: true, actor: sanCardActor, token: null });
    const sanCard = await waitFor(() => {
      const message = [...game.messages.values()].slice(before)
        .find((entry) => entry.flags?.brp?.chatCard?.[0]?.particId === sanCardActor.id);
      return message;
    });
    const sanSnap = snap(sanCard);
    const sanEntry = sanSnap?.chatCard?.[0] ?? null;
    check('cocM4SanCardTargetsCurrentSanAndRealLoss', !!sanCard && sanEntry?.targetScore === 37
      && sanEntry.rollVal === 90 && sanEntry.sanLoss === 5 && sanEntry.sanAfter === 32
      && sanCard.rolls?.[0]?.total === 90
      && game.messages.get(sanCard.id)?.flags?.brp?.chatCard?.[0]?.sanLoss === 5,
      { target: sanEntry?.targetScore, roll: sanEntry?.rollVal, loss: sanEntry?.sanLoss, after: sanEntry?.sanAfter,
        rolls: sanCard?.rolls?.map((roll) => roll.total) });
    check('cocM4SanCardSingleLossEpisode', sanEntry?.sanity?.singleLoss === 5
      && sanEntry?.sanity?.dailyLoss === 5 && sanEntry?.sanity?.temporary?.active === true
      && sanEntry?.sanity?.temporary?.hours === 3 && sanEntry?.sanity?.temporary?.rounds?.value === 4
      && sanEntry?.sanity?.intCheck?.passed === true
      && sanSnap?.madness?.ended === false
      && sanSnap?.madness?.manifestation?.key === 'psychosomatic-disability'
      && !String(sanSnap?.madness?.manifestation?.name ?? '').startsWith('BRP.')
      && sanEntry?.sanity?.statuses?.tempInsane === true,
      { sanity: sanEntry?.sanity, madness: sanSnap?.madness });
    const sanFresh = game.actors.get(sanCardActor.id);
    const sanEff = tempEffect(sanFresh);
    check('cocM4SanCardPersistsStateAndEffect', sanFresh.system.sanity.value === 32
      && sanFresh.system.sanity.dailyLoss === 5 && sanFresh.system.sanity.singleLoss === 5
      && sanFresh.system.sanity.dayStartSan === 37 && sanFresh.system.sanity.dayId === 'day-m4.1'
      && sanFresh.system.sanity.insanity.temporary?.active === true
      && !!sanEff && sanEff.duration.seconds === 3 * 3600
      && sanEff.flags?.brp?.coc?.insanity?.kind === 'temporary'
      && sanEff.flags?.brp?.coc?.insanity?.bout === 'psychosomatic-disability',
      { san: sanFresh.system.sanity, effect: sanEff ? { duration: sanEff.duration, flags: sanEff.flags } : null });

    // 2) A failed INT roll represses the episode: the loss is still applied,
    // but no temporary effect and no episode dice are produced.
    const intFail = await newCoc('M4 INT Fail', { ...cocStats, int: { base: 30 } });
    actors.push(intFail);
    await setDay(intFail, 40);
    before = game.messages.size;
    queueDice(face(90, 100), face(6, 6), face(100, 100));
    await game.brp.BRPCheck._trigger({ rollType: 'SN', cardType: 'NO', shiftKey: true, actor: intFail, token: null });
    const failCard = await waitFor(() => [...game.messages.values()].slice(before)
      .find((entry) => entry.flags?.brp?.chatCard?.[0]?.particId === intFail.id));
    const failSnap = snap(failCard);
    check('cocM4IntFailureRepressesEpisode', failSnap?.chatCard?.[0]?.sanLoss === 6
      && failSnap?.chatCard?.[0]?.sanity?.intCheck?.passed === false
      && failSnap?.chatCard?.[0]?.sanity?.temporary === null
      && failSnap?.madness === null && !tempEffect(intFail)
      && intFail.system.sanity.value === 34 && intFail.system.sanity.dailyLoss === 6,
      { card: failSnap?.chatCard?.[0]?.sanity, effects: statuses(intFail), san: intFail.system.sanity.value });

    // 3) A loss below 5 never calls for an INT check and never opens an episode.
    const smallLoss = await newCoc('M4 Small Loss');
    actors.push(smallLoss);
    await setDay(smallLoss, 40);
    before = game.messages.size;
    queueDice(face(90, 100), face(4, 6));
    await game.brp.BRPCheck._trigger({ rollType: 'SN', cardType: 'NO', shiftKey: true, actor: smallLoss, token: null });
    const smallCard = await waitFor(() => [...game.messages.values()].slice(before)
      .find((entry) => entry.flags?.brp?.chatCard?.[0]?.particId === smallLoss.id));
    const smallSnap = snap(smallCard);
    check('cocM4LossBelowThresholdNoEpisode', smallSnap?.chatCard?.[0]?.sanLoss === 4
      && smallSnap?.chatCard?.[0]?.sanity?.temporary === null
      && smallSnap?.chatCard?.[0]?.sanity?.intCheck === null
      && smallSnap?.madness === null && !tempEffect(smallLoss)
      && smallLoss.system.sanity.value === 36 && smallLoss.system.sanity.dailyLoss === 4,
      { sanity: smallSnap?.chatCard?.[0]?.sanity, effects: statuses(smallLoss) });

    // 4) The per-game-day threshold is one fifth of the day-start SAN and is
    // independent of the single-loss trigger. Two 4-point losses reach 8/40.
    const daily = await newCoc('M4 Daily Indefinite');
    actors.push(daily);
    await setDay(daily, 40);
    const firstLoss = await game.brp.sanity.settle({ actor: daily, loss: 4, reason: 'm4-daily-1' });
    check('cocM4DailyLossAccumulatesWithoutSingleTrigger', firstLoss.sanAfter === 36
      && firstLoss.dailyLoss === 4 && firstLoss.indefinite === null
      && firstLoss.temporary === null && !indefiniteEffect(daily),
      { san: firstLoss.sanAfter, daily: firstLoss.dailyLoss, indefinite: firstLoss.indefinite });
    const secondLoss = await game.brp.sanity.settle({ actor: daily, loss: 4, reason: 'm4-daily-2' });
    check('cocM4DailyThresholdCreatesIndefinite', secondLoss.sanAfter === 32
      && secondLoss.dailyLoss === 8 && secondLoss.indefinite?.active === true
      && secondLoss.indefinite?.threshold === 8 && secondLoss.indefinite?.basis === 'day-start'
      && secondLoss.temporary === null && !!indefiniteEffect(daily)
      && indefiniteEffect(daily).flags?.brp?.coc?.insanity?.kind === 'indefinite',
      { san: secondLoss.sanAfter, daily: secondLoss.dailyLoss, indefinite: secondLoss.indefinite,
        effects: statuses(daily) });

    // 5) Temporary and indefinite coexist; ending the temporary episode keeps
    // the indefinite state and the persistent material (phobia/mania).
    const coexist = await newCoc('M4 Coexist');
    actors.push(coexist);
    await setDay(coexist, 40);
    queueDice(face(81, 100), face(9, 10), face(9, 10), face(9, 10));
    const tempSettle = await game.brp.sanity.settle({ actor: coexist, loss: 5, reason: 'm4-coexist-1' });
    await game.brp.sanity.settle({ actor: coexist, loss: 3, reason: 'm4-coexist-2' });
    const both = game.actors.get(coexist.id);
    check('cocM4TemporaryAndIndefiniteCoexist', tempSettle.temporary?.active === true
      && both.system.sanity.insanity.temporary?.active === true
      && both.system.sanity.insanity.indefinite?.active === true
      && !!tempEffect(both) && !!indefiniteEffect(both)
      && statuses(both).includes('tempInsane') && statuses(both).includes('indefiniteInsane'),
      { insanity: both.system.sanity.insanity, effects: statuses(both) });
    const ended = await game.brp.sanity.endTemporary({ actor: both, reason: 'keeper-ended' });
    const afterEnd = game.actors.get(coexist.id);
    check('cocM4EndTemporaryKeepsIndefiniteAndTraits', ended.ended === true
      && ended.retained.includes('phobia') && ended.retained.includes('mania')
      && afterEnd.system.sanity.insanity.temporary?.active === false
      && afterEnd.system.sanity.insanity.temporary?.endReason === 'keeper-ended'
      && afterEnd.system.sanity.insanity.indefinite?.active === true
      && afterEnd.system.sanity.insanity.permanent === false
      && !tempEffect(afterEnd) && !!indefiniteEffect(afterEnd),
      { ended, insanity: afterEnd.system.sanity.insanity, effects: statuses(afterEnd) });

    // 6) SAN zero is permanent and terminal; only an explicit keeper decision
    // clears it, and a permanent investigator cannot be settled again.
    const perma = await newCoc('M4 Permanent');
    actors.push(perma);
    await setDay(perma, 3);
    const permaSettle = await game.brp.sanity.settle({ actor: perma, loss: 9, reason: 'm4-perma' });
    const permaFresh = game.actors.get(perma.id);
    check('cocM4ZeroSanIsPermanentTerminal', permaSettle.permanent === true
      && permaSettle.sanAfter === 0 && permaSettle.temporary === null
      && permaSettle.indefinite === null
      && permaFresh.system.sanity.insanity.permanent === true
      && permaFresh.system.sanity.insanity.indefinite === null
      && !!permaEffect(permaFresh) && !indefiniteEffect(permaFresh) && !tempEffect(permaFresh),
      { result: permaSettle, insanity: permaFresh.system.sanity.insanity, effects: statuses(permaFresh) });
    // An indefinite state that already existed is not erased by the terminal
    // zero-SAN state; the two statuses coexist.
    const permaCo = await newCoc('M4 Permanent Coexist');
    actors.push(permaCo);
    await setDay(permaCo, 3);
    await permaCo.update({ 'system.sanity.insanity': {
      temporary: null,
      indefinite: { active: true, since: 0, threshold: 1, basis: 'day-start', basisValue: 3, dayId: 'day-m4.1', recovery: 'keeper-review', recoveredAt: null },
      permanent: false, lastUpdatedAt: 0,
    } });
    const coSettle = await game.brp.sanity.settle({ actor: permaCo, loss: 5, reason: 'm4-perma-coexist' });
    const coFresh = game.actors.get(permaCo.id);
    check('cocM4PermanentKeepsExistingIndefinite', coSettle.permanent === true
      && coFresh.system.sanity.insanity.permanent === true
      && coFresh.system.sanity.insanity.indefinite?.active === true
      && !!permaEffect(coFresh) && !!indefiniteEffect(coFresh),
      { result: coSettle, insanity: coFresh.system.sanity.insanity, effects: statuses(coFresh) });

    const refused = await game.brp.sanity.settle({ actor: permaFresh, loss: 1, reason: 'm4-after-perma' });
    const clearNoReason = await game.brp.sanity.clearPermanent({ actor: permaFresh });
    const cleared = await game.brp.sanity.clearPermanent({ actor: permaFresh, reason: 'keeper-story' });
    const permaAfter = game.actors.get(perma.id);
    check('cocM4PermanentRefusesSettlementAndKeeperClears', refused.applied === false
      && refused.reason === 'permanent-insanity' && permaAfter.system.sanity.value === 0
      && clearNoReason.error === 'reason-required'
      && cleared.cleared === true && permaAfter.system.sanity.insanity.permanent === false
      && !permaEffect(permaAfter),
      { refused, clearNoReason, cleared, insanity: permaAfter.system.sanity.insanity });

    // 7) Ownership and the single writer: a player queues, the GM applies once;
    // a non-owner origin is refused; concurrent settlements serialize.
    const relay = await newCoc('M4 Relay');
    actors.push(relay);
    await relay.update({ ownership: { 'player-m4': 3 } });
    await setDay(relay, 40);
    const realUser = game.user;
    const realUsers = game.users;
    const realEmit = game.socket.emit;
    const emitted = [];
    game.socket.emit = (channel, payload) => { emitted.push(payload); };
    game.user = { id: 'player-m4', isGM: false, name: 'M4 Player' };
    game.users = {
      activeGM: { id: 'spike-gm', isGM: true },
      get: (id) => (id === 'spike-gm' ? { id: 'spike-gm', isGM: true }
        : id === 'player-m4' ? { id: 'player-m4', isGM: false } : null),
    };
    const queued = await game.brp.BRPSanity.settle({ actor: relay, loss: 6, reason: 'm4-relay', dayId: 'day-player-forged' });
    game.user = realUser;
    game.socket.emit = realEmit;
    check('cocM4PlayerQueuesWithoutLocalWrite', queued.queued === true
      && emitted.length === 1 && emitted[0].type === 'cocSanSettle'
      && emitted[0].value.origin === 'player-m4' && emitted[0].value.loss === 6
      && emitted[0].value.dayId === null
      && relay.system.sanity.value === 40 && !tempEffect(relay),
      { queued, emitted, san: relay.system.sanity.value, effects: statuses(relay) });
    queueDice(face(81, 100), face(1, 10), face(1, 10), face(1, 10));
    const relayed = await game.brp.BRPSystemSocket.cocSanSettle(emitted[0].value);
    game.users = realUsers;
    check('cocM4WriterAppliesRelayedSettlement', relayed.applied === true
      && relayed.sanAfter === 34
      && game.actors.get(relay.id).system.sanity.value === 34,
      { relayed, san: game.actors.get(relay.id).system.sanity.value });
    // A different player is not an owner.
    relay.testUserPermission = (user, permission) => user?.id === 'player-m4' && permission === 'OWNER';
    const beforeIntruder = game.actors.get(relay.id).system.sanity.value;
    game.users = {
      activeGM: { id: 'spike-gm', isGM: true },
      get: (id) => (id === 'spike-gm' ? { id: 'spike-gm', isGM: true }
        : id === 'player-other' ? { id: 'player-other', isGM: false } : null),
    };
    const intruder = await game.brp.BRPSanity.settleNow({ actor: relay, loss: 5, reason: 'm4-intruder', origin: 'player-other' });
    game.users = realUsers;
    check('cocM4NonOwnerOriginRefused', intruder.error === 'not-authorised'
      && game.actors.get(relay.id).system.sanity.value === beforeIntruder,
      { intruder, san: game.actors.get(relay.id).system.sanity.value });
    // Two simultaneous settlements must not both read the same pre-loss SAN.
    await relay.update({ 'system.sanity.value': 40, 'system.sanity.dailyLoss': 0, 'system.sanity.insanity': { temporary: null, indefinite: null, permanent: false, lastUpdatedAt: 0 } });
    const realUpdate = relay.update.bind(relay);
    let delayed = true;
    relay.update = async (data, options) => {
      if (delayed) { delayed = false; await new Promise((resolve) => setTimeout(resolve, 60)); }
      return realUpdate(data, options);
    };
    const [c1, c2] = await Promise.all([
      game.brp.BRPSanity.settleNow({ actor: relay, loss: 2, reason: 'm4-c1' }),
      game.brp.BRPSanity.settleNow({ actor: relay, loss: 3, reason: 'm4-c2' }),
    ]);
    relay.update = realUpdate;
    const relayAfter = game.actors.get(relay.id);
    check('cocM4ConcurrentSettlementsSerialize', c1.sanBefore === 40 && c2.sanBefore === 38
      && c1.sanAfter === 38 && c2.sanAfter === 35
      && relayAfter.system.sanity.value === 35 && relayAfter.system.sanity.dailyLoss === 5,
      { c1: { before: c1.sanBefore, after: c1.sanAfter }, c2: { before: c2.sanBefore, after: c2.sanAfter },
        final: relayAfter.system.sanity.value, daily: relayAfter.system.sanity.dailyLoss });

    // 8) Luck is refused on the SAN card, a natural fumble and a natural 01;
    // a normal skill card offers it, a Luck-adjusted 01 is Extreme, and a
    // Luck-bought success clears an existing development tick.
    const luckActor = await newCoc('M4 Luck');
    actors.push(luckActor);
    await luckActor.update({ 'system.luck.value': 50, 'system.luck.max': 60 });
    await setDay(luckActor, 40);
    const dodge = [...luckActor.items].find((item) => item.type === 'skill'
      && item.flags?.brp?.brpidFlag?.id === 'i.skill.coc.dodge');
    await dodge.update({ 'system.base': 50 });
    await luckActor.prepareData();
    before = game.messages.size;
    queueDice(face(90, 100), face(1, 6));
    await game.brp.BRPCheck._trigger({ rollType: 'SN', cardType: 'NO', shiftKey: true, actor: luckActor, token: null });
    const snCard = await waitFor(() => [...game.messages.values()].slice(before)
      .find((entry) => entry.flags?.brp?.chatCard?.[0]?.particId === luckActor.id));
    const snLuck = snap(snCard)?.chatCard?.[0]?.luck;
    before = game.messages.size;
    queueDice(face(100, 100));
    await game.brp.BRPCheck._trigger({ rollType: 'SK', cardType: 'NO', shiftKey: true, actor: luckActor, token: null, skillId: dodge.id });
    const fumbleCard = await waitFor(() => [...game.messages.values()].slice(before)
      .find((entry) => entry.flags?.brp?.chatCard?.[0]?.particId === luckActor.id));
    const fumbleSnap = snap(fumbleCard);
    before = game.messages.size;
    queueDice(face(1, 100));
    await game.brp.BRPCheck._trigger({ rollType: 'SK', cardType: 'NO', shiftKey: true, actor: luckActor, token: null, skillId: dodge.id });
    const critCard = await waitFor(() => [...game.messages.values()].slice(before)
      .find((entry) => entry.flags?.brp?.chatCard?.[0]?.particId === luckActor.id));
    const critSnap = snap(critCard);
    before = game.messages.size;
    queueDice(face(60, 100));
    await game.brp.BRPCheck._trigger({ rollType: 'SK', cardType: 'NO', shiftKey: true, actor: luckActor, token: null, skillId: dodge.id });
    const failSkillCard = await waitFor(() => [...game.messages.values()].slice(before)
      .find((entry) => entry.flags?.brp?.chatCard?.[0]?.particId === luckActor.id));
    const failSkillSnap = snap(failSkillCard);
    const luckTemplate = game.brp.BRPLuck.CHECK_TEMPLATE;
    const cardLuckFor = (rollType, cardType = 'NO', extra = {}) => game.brp.BRPLuck.cardLuck(luckActor, luckTemplate, { rollType, cardType, ...extra });
    check('cocM4LuckUiGatesRefuseSanFumbleAndCritical', snLuck === null
      && fumbleSnap?.chatCard?.[0]?.luck === null && fumbleSnap?.chatCard?.[0]?.resultLevel === 0
      && critSnap?.chatCard?.[0]?.luck === null && critSnap?.chatCard?.[0]?.resultLevel === 4
      && failSkillSnap?.chatCard?.[0]?.luck?.value === 50
      && failSkillSnap?.chatCard?.[0]?.targetScore === 50
      && cardLuckFor('DM') === null && cardLuckFor('CM') === null
      && cardLuckFor('SN') === null && cardLuckFor('SK', 'NO', { pushed: true }) === null
      && cardLuckFor('SK', 'NO', { rollVal: 100 }) === null
      && cardLuckFor('SK', 'NO', { rollVal: 1 }) === null
      && cardLuckFor('CH', 'NO', { rollVal: 50 }) !== null,
      { snLuck, fumble: fumbleSnap?.chatCard?.[0]?.luck, fumbleLevel: fumbleSnap?.chatCard?.[0]?.resultLevel,
        critLuck: critSnap?.chatCard?.[0]?.luck, critLevel: critSnap?.chatCard?.[0]?.resultLevel,
        failLuck: failSkillSnap?.chatCard?.[0]?.luck, target: failSkillSnap?.chatCard?.[0]?.targetScore,
        dm: cardLuckFor('DM'), cm: cardLuckFor('CM'), pushed: cardLuckFor('SK', 'NO', { pushed: true }) });
    // Direct settlement gate: a fumble entry with a forged budget is still refused.
    const fumbleForced = await game.brp.BRPLuck.applyLuck(luckActor, { ...fumbleSnap.chatCard[0], luck: { value: 50 } }, 10, 'NO', { rollType: 'SK' });
    check('cocM4LuckSettlementGateRefusesFumble', fumbleForced.allowed === false
      && fumbleForced.luck.spent === 0 && fumbleForced.luck.value === 50
      && fumbleForced.roll.rollVal === 100 && fumbleForced.roll.resultLevel === 0,
      { fumbleForced });
    // Spend on the failing skill card: 60 -> 50, regular, and the pre-ticked
    // development box is cleared because the success was bought with Luck.
    await dodge.update({ 'system.improve': true });
    await luckActor.prepareData();
    const spendBefore = game.actors.get(luckActor.id).system.luck.value;
    await game.brp.BRPLuck.spendFromCard({ targetChatId: failSkillCard.id, amount: 10, index: 0, origin: game.user.id, originGM: true });
    const spendCardSnap = snap(game.messages.get(failSkillCard.id));
    const luckAfterSpend = game.actors.get(luckActor.id);
    check('cocM4LuckSpendReRatesAndClearsTick', spendBefore === 50
      && spendCardSnap?.chatCard?.[0]?.rollVal === 50
      && spendCardSnap?.chatCard?.[0]?.resultLevel === 2
      && spendCardSnap?.chatCard?.[0]?.band === 'regular'
      && spendCardSnap?.chatCard?.[0]?.luckSpent === 10
      && luckAfterSpend.system.luck.value === 40
      && luckAfterSpend.items.get(dodge.id).system.improve === false,
      { before: spendBefore, entry: spendCardSnap?.chatCard?.[0], luck: luckAfterSpend.system.luck.value,
        improve: luckAfterSpend.items.get(dodge.id).system.improve });
    // Reaching 01 by spending Luck is Extreme, never Critical.
    await luckActor.prepareData();
    before = game.messages.size;
    queueDice(face(11, 100));
    await game.brp.BRPCheck._trigger({ rollType: 'SK', cardType: 'NO', shiftKey: true, actor: luckActor, token: null, skillId: dodge.id });
    const adjustCard = await waitFor(() => [...game.messages.values()].slice(before)
      .find((entry) => entry.flags?.brp?.chatCard?.[0]?.particId === luckActor.id));
    await game.brp.BRPLuck.spendFromCard({ targetChatId: adjustCard.id, amount: 10, index: 0, origin: game.user.id, originGM: true });
    const adjustSnap = snap(game.messages.get(adjustCard.id));
    check('cocM4LuckAdjustedOneIsExtreme', adjustSnap?.chatCard?.[0]?.rollVal === 1
      && adjustSnap?.chatCard?.[0]?.band === 'extreme'
      && adjustSnap?.chatCard?.[0]?.resultLevel === 3
      && adjustSnap?.chatCard?.[0]?.criticalSource === null,
      { entry: adjustSnap?.chatCard?.[0] });

    // 9) Luck recovery is an explicit keeper action with a real 1D100 and the
    // two published branches; a player cannot trigger it.
    const recovery = await newCoc('M4 Luck Recovery');
    actors.push(recovery);
    await recovery.update({ 'system.luck.value': 40, 'system.luck.max': 60 });
    const luckBeforeRender = game.actors.get(recovery.id).system.luck.value;
    await recovery.sheet.render(true);
    check('cocM4LuckRecoveryNeverRunsOnRender', game.actors.get(recovery.id).system.luck.value === luckBeforeRender,
      { before: luckBeforeRender, after: game.actors.get(recovery.id).system.luck.value });
    queueDice(face(80, 100), face(5, 10), face(5, 10));
    const successRecovery = await game.brp.sanity.luckRecovery({ actor: recovery });
    check('cocM4LuckRecoverySuccessBranch', successRecovery.roll === 80
      && JSON.stringify(successRecovery.dice) === JSON.stringify([5, 5])
      && successRecovery.formula === '2D10+10'
      && successRecovery.luck.after === 60
      && successRecovery.session >= 1
      && Number(game.settings.get('brp', 'cocSessionSeq')) === successRecovery.session
      && game.actors.get(recovery.id).system.luck.value === 60
      && game.actors.get(recovery.id).system.luck.cap === 99,
      successRecovery);
    queueDice(face(20, 100), face(3, 10));
    const failureRecovery = await game.brp.sanity.luckRecovery({ actor: recovery });
    check('cocM4LuckRecoveryFailureBranch', failureRecovery.roll === 20
      && failureRecovery.formula === '1D10+5'
      && failureRecovery.luck.after === 68
      && game.actors.get(recovery.id).system.luck.value === 68,
      failureRecovery);
    await recovery.update({ 'system.luck.value': 95, 'system.luck.max': 99 });
    queueDice(face(100, 100), face(10, 10), face(10, 10));
    const cappedRecovery = await game.brp.sanity.luckRecovery({ actor: recovery });
    check('cocM4LuckRecoveryCapsAt99', cappedRecovery.luck.after === 99
      && cappedRecovery.luck.capped === true && cappedRecovery.luck.overflow === 26
      && game.actors.get(recovery.id).system.luck.value === 99,
      cappedRecovery);
    game.user = { id: 'player-m4', isGM: false, name: 'M4 Player' };
    const playerRecovery = await game.brp.sanity.luckRecovery({ actor: recovery });
    game.user = realUser;
    check('cocM4LuckRecoveryIsKeeperOnly', playerRecovery.error === 'not-active-gm',
      playerRecovery);

    // 10) Growth: only a successful, unbought skill roll ticks; settlement is
    // 1D100 strictly over the value and adds 1D10; no fixed tier/POW growth.
    await game.settings.set('brp', 'autoXP', '1');
    const growth = await newCoc('M4 Growth');
    actors.push(growth);
    await setDay(growth, 40);
    const growthSkill = [...growth.items].find((item) => item.type === 'skill'
      && item.flags?.brp?.brpidFlag?.id === 'i.skill.coc.dodge');
    await growthSkill.update({ 'system.base': 50 });
    await growth.prepareData();
    before = game.messages.size;
    queueDice(face(20, 100));
    await game.brp.BRPCheck._trigger({ rollType: 'SK', cardType: 'NO', shiftKey: true, actor: growth, token: null, skillId: growthSkill.id });
    const growthSuccessCard = await waitFor(() => [...game.messages.values()].slice(before)
      .find((entry) => entry.flags?.brp?.chatCard?.[0]?.particId === growth.id));
    const growthSuccessData = snap(growthSuccessCard);
    growthSuccessData.state = 'closed';
    await game.brp.BRPCheck.tickXP(growthSuccessData);
    check('cocM4GrowthTicksSuccessfulSkill', game.actors.get(growth.id).items.get(growthSkill.id).system.improve === true,
      { improve: game.actors.get(growth.id).items.get(growthSkill.id).system.improve });
    before = game.messages.size;
    queueDice(face(60, 100));
    await game.brp.BRPCheck._trigger({ rollType: 'SK', cardType: 'NO', shiftKey: true, actor: growth, token: null, skillId: growthSkill.id });
    const growthFailCard = await waitFor(() => [...game.messages.values()].slice(before)
      .find((entry) => entry.flags?.brp?.chatCard?.[0]?.particId === growth.id));
    const growthFailData = snap(growthFailCard);
    growthFailData.state = 'closed';
    await growthSkill.update({ 'system.improve': false });
    await game.brp.BRPCheck.tickXP(growthFailData);
    check('cocM4GrowthDoesNotTickFailure', game.actors.get(growth.id).items.get(growthSkill.id).system.improve === false,
      { improve: game.actors.get(growth.id).items.get(growthSkill.id).system.improve });
    // The BRP "tick on failure" option (autoXP=2) must not tick a CoC failure.
    await game.settings.set('brp', 'autoXP', '2');
    before = game.messages.size;
    queueDice(face(60, 100));
    await game.brp.BRPCheck._trigger({ rollType: 'SK', cardType: 'NO', shiftKey: true, actor: growth, token: null, skillId: growthSkill.id });
    const tickFailCard = await waitFor(() => [...game.messages.values()].slice(before)
      .find((entry) => entry.flags?.brp?.chatCard?.[0]?.particId === growth.id));
    const tickFailData = snap(tickFailCard);
    tickFailData.state = 'closed';
    await growthSkill.update({ 'system.improve': false });
    await growth.prepareData();
    await game.brp.BRPCheck.tickXP(tickFailData);
    check('cocM4AutoXpTwoDoesNotTickFailure', game.actors.get(growth.id).items.get(growthSkill.id).system.improve === false,
      { improve: game.actors.get(growth.id).items.get(growthSkill.id).system.improve });
    await game.settings.set('brp', 'autoXP', '1');
    // Settlement uses the real 1D100/1D10 and strict-over comparison.
    await growthSkill.update({ 'system.improve': true, 'system.xp': 0 });
    await growth.prepareData();
    const xpBefore = Number(game.actors.get(growth.id).items.get(growthSkill.id).system.xp);
    queueDice(face(51, 100), face(7, 10));
    const xpGain = await game.brp.BRPCharDev.xpCheck(growth, null, growthSkill.id, 'fixed', false);
    await growth.prepareData();
    const xpAfterItem = game.actors.get(growth.id).items.get(growthSkill.id);
    check('cocM4GrowthSettlementStrictOverAndOneD10', xpGain?.level === 1
      && xpGain?.improvVal === 7 && xpGain?.rollResult === 51
      && Number(xpAfterItem.system.xp) === xpBefore + 7
      && xpAfterItem.system.improve === false,
      { xpGain, xpBefore, xpAfter: xpAfterItem.system.xp, improve: xpAfterItem.system.improve });
    await growthSkill.update({ 'system.improve': true });
    await growth.prepareData();
    const xpEqualBefore = Number(game.actors.get(growth.id).items.get(growthSkill.id).system.xp);
    queueDice(face(50, 100));
    const xpEqual = await game.brp.BRPCharDev.xpCheck(growth, null, growthSkill.id, 'formula', false);
    await growth.prepareData();
    check('cocM4GrowthSettlementEqualDoesNotGain', xpEqual?.level === 0
      && xpEqual?.improvVal === 0
      && Number(game.actors.get(growth.id).items.get(growthSkill.id).system.xp) === xpEqualBefore,
      { xpEqual, before: xpEqualBefore, after: game.actors.get(growth.id).items.get(growthSkill.id).system.xp });
    const powImprove = await game.brp.BRPCharDev.powImprov(growth, null, 'formula');
    check('cocM4NoPowGrowth', powImprove?.error === 'no-pow-improvement', powImprove);
    const mythos = [...growth.items].find((item) => item.type === 'skill'
      && item.flags?.brp?.brpidFlag?.id === 'i.skill.coc.cthulhu-mythos');
    await mythos.update({ 'system.base': 20 });
    await growth.prepareData();
    before = game.messages.size;
    queueDice(face(20, 100));
    await game.brp.BRPCheck._trigger({ rollType: 'SK', cardType: 'NO', shiftKey: true, actor: growth, token: null, skillId: mythos.id });
    const mythosCard = await waitFor(() => [...game.messages.values()].slice(before)
      .find((entry) => entry.flags?.brp?.chatCard?.[0]?.particId === growth.id));
    const mythosData = snap(mythosCard);
    mythosData.state = 'closed';
    await game.brp.BRPCheck.tickXP(mythosData);
    check('cocM4MythosNeverTicks', game.actors.get(growth.id).items.get(mythos.id).system.improve !== true,
      { improve: game.actors.get(growth.id).items.get(mythos.id).system.improve, noXP: mythos.system.noXP });
    // CoC dev UI has no fixed tier and no POW improvement control.
    await game.settings.set('brp', 'development', true);
    await growth.update({ 'system.lock': false });
    await growth.sheet.render(true);
    const growthContext = await growth.sheet._prepareContext({ parts: ['header', 'tabs', 'skills', 'combat', 'items', 'dev', 'statistics'] });
    const growthHtml = growth.sheet.element?.innerHTML ?? '';
    check('cocM4DevelopmentUiSplitsFromOctopus', growthContext.growthFixed === false
      && growthContext.growthPow === false
      && !growthHtml.includes('data-roll="fixed"')
      && !growthHtml.includes('data-action="powImprove"')
      && growthHtml.includes('data-roll="formula"'),
      { growthFixed: growthContext.growthFixed, growthPow: growthContext.growthPow,
        fixed: growthHtml.includes('data-roll="fixed"'), pow: growthHtml.includes('data-action="powImprove"') });
    await game.settings.set('brp', 'ruleset', 'octopus');
    await growth.sheet.render(true);
    const octopusContext = await growth.sheet._prepareContext({ parts: ['header', 'tabs', 'skills', 'combat', 'items', 'dev', 'statistics'] });
    const octopusHtml = growth.sheet.element?.innerHTML ?? '';
    check('cocM4OctopusDevelopmentUiUnchanged', octopusContext.growthFixed === true
      && octopusContext.growthPow === true && octopusHtml.includes('data-roll="fixed"'),
      { growthFixed: octopusContext.growthFixed, growthPow: octopusContext.growthPow,
        fixed: octopusHtml.includes('data-roll="fixed"') });
    await game.settings.set('brp', 'ruleset', 'coc');

    // 11) The persisted world clock survives a zeroed platform clock, drives
    // the 1D10h expiry, and the keeper can advance hours/days/new day.
    const clock = await newCoc('M4 Clock');
    actors.push(clock);
    await setDay(clock, 40);
    before = game.messages.size;
    queueDice(face(90, 100), face(5, 6), face(81, 100), face(2, 10), face(3, 10), face(4, 10));
    await game.brp.BRPCheck._trigger({ rollType: 'SN', cardType: 'NO', shiftKey: true, actor: clock, token: null });
    const clockCard = await waitFor(() => [...game.messages.values()].slice(before)
      .find((entry) => entry.flags?.brp?.chatCard?.[0]?.particId === clock.id));
    const clockEffect = tempEffect(game.actors.get(clock.id));
    const clockBefore = game.brp.BRPWorldTime.now();
    const storedBefore = Number(game.settings.get('brp', 'worldTime')) || 0;
    check('cocM4ClockEpisodeHasPersistedStart', !!clockEffect
      && Number(clockEffect.flags?.brp?.coc?.insanity?.startTime) === clockBefore
      && Number(clockEffect.flags?.brp?.coc?.insanity?.expiresAt) === clockBefore + 2 * 3600,
      { now: clockBefore, effect: clockEffect?.flags?.brp?.coc?.insanity });
    const moved = await game.brp.sanity.advanceTime({ hours: 2 });
    const clockAfter = game.brp.BRPWorldTime.now();
    const storedAfter = Number(game.settings.get('brp', 'worldTime')) || 0;
    const clockFresh = game.actors.get(clock.id);
    const clockCardSnap = snap(game.messages.get(clockCard.id));
    check('cocM4KeeperAdvancePersistsClockAndExpires', moved.error === undefined
      && clockAfter >= clockBefore + 2 * 3600
      && storedAfter >= storedBefore + 2 * 3600
      && clockFresh.system.sanity.insanity.temporary?.active === false
      && clockFresh.system.sanity.insanity.temporary?.endReason === 'hours-elapsed-keeper-confirmed'
      && !tempEffect(clockFresh) && clockCardSnap?.madness?.ended === true,
      { moved, before: clockBefore, after: clockAfter, storedBefore, storedAfter,
        temporary: clockFresh.system.sanity.insanity.temporary, card: clockCardSnap?.madness });
    // Load restore: the platform clock is zeroed, the stored value wins.
    const stored = Number(game.settings.get('brp', 'worldTime')) || 0;
    try { game.time.worldTime = 0; } catch { /* shim only */ }
    const hydrated = await game.brp.BRPWorldTime.hydrate();
    check('cocM4ClockHydratesAfterReload', hydrated.hydrated === true
      && game.brp.BRPWorldTime.now() === stored
      && game.brp.BRPWorldTime.stored() === stored,
      { hydrated, stored, now: game.brp.BRPWorldTime.now() });
    // A real platform-clock advance fires updateWorldTime and is mirrored into
    // the persisted setting (the hook body is the same one a live world uses).
    const hookBefore = Number(game.settings.get('brp', 'worldTime')) || 0;
    await game.time.advance(3600);
    const hookPersisted = await waitFor(() => (Number(game.settings.get('brp', 'worldTime')) || 0) >= hookBefore + 3600, 2000);
    const hookAfter = Number(game.settings.get('brp', 'worldTime')) || 0;
    check('cocM4UpdateWorldTimeHookPersists', !!hookPersisted && hookAfter >= hookBefore + 3600,
      { hookBefore, hookAfter, live: game.time.worldTime });
    // New day rebases dayStartSan and clears dailyLoss; day id changes.
    const oldDay = clockFresh.system.sanity.dayId;
    const newDay = await game.brp.sanity.newDay({ actor: clockFresh });
    const newDayActor = game.actors.get(clock.id);
    check('cocM4KeeperNewDayRebasesThreshold', newDay.started === true
      && newDay.dayId !== oldDay && newDayActor.system.sanity.dayId === newDay.dayId
      && newDayActor.system.sanity.dayStartSan === newDayActor.system.sanity.value
      && newDayActor.system.sanity.dailyLoss === 0,
      { oldDay, newDay, dayId: newDayActor.system.sanity.dayId,
        dayStart: newDayActor.system.sanity.dayStartSan, value: newDayActor.system.sanity.value });
    const daysBefore = game.brp.BRPWorldTime.dayIndex();
    const dayMoved = await game.brp.sanity.advanceTime({ days: 1 });
    check('cocM4KeeperAdvanceDay', dayMoved.crossedDay === true
      && game.brp.BRPWorldTime.dayIndex() === daysBefore + 1,
      { dayMoved, before: daysBefore, after: game.brp.BRPWorldTime.dayIndex() });
    // SAN "new day" button context/action exists only for CoC GMs.
    await clockFresh.sheet.render(true);
    const headerHtml = clockFresh.sheet.element?.innerHTML ?? '';
    check('cocM4KeeperClockUiHooks', headerHtml.includes('data-action="sanityResetDaily"')
      && headerHtml.includes('data-action="cocAdvanceHour"')
      && headerHtml.includes('data-action="cocAdvanceDay"')
      && headerHtml.includes('data-action="luckRecovery"'),
      { reset: headerHtml.includes('data-action="sanityResetDaily"'),
        hour: headerHtml.includes('data-action="cocAdvanceHour"'),
        day: headerHtml.includes('data-action="cocAdvanceDay"'),
        luck: headerHtml.includes('data-action="luckRecovery"') });

    // 12) Effect lifecycle: disabling or deleting the status closes both the
    // persisted temporary state and the card, exactly like an elapsed clock.
    const lifecycle = await newCoc('M4 Lifecycle');
    actors.push(lifecycle);
    await setDay(lifecycle, 40);
    before = game.messages.size;
    queueDice(face(90, 100), face(5, 6), face(81, 100), face(2, 10), face(2, 10), face(2, 10));
    await game.brp.BRPCheck._trigger({ rollType: 'SN', cardType: 'NO', shiftKey: true, actor: lifecycle, token: null });
    const disableCard = await waitFor(() => [...game.messages.values()].slice(before)
      .find((entry) => entry.flags?.brp?.chatCard?.[0]?.particId === lifecycle.id));
    const disableEffect = tempEffect(game.actors.get(lifecycle.id));
    await disableEffect.update({ disabled: true });
    const disableEnded = await waitFor(() => game.messages.get(disableCard.id)?.flags?.brp?.madness?.ended === true, 3000);
    const disableActor = game.actors.get(lifecycle.id);
    check('cocM4DisableEffectEndsEpisodeAndCard', !!disableEnded
      && disableActor.system.sanity.insanity.temporary?.active === false
      && disableActor.system.sanity.insanity.temporary?.endReason === 'effect-disabled'
      && !activeTempEffect(disableActor)
      && tempEffect(disableActor)?.disabled === true,
      { ended: disableEnded, temporary: disableActor.system.sanity.insanity.temporary, effects: statuses(disableActor) });
    before = game.messages.size;
    queueDice(face(90, 100), face(5, 6), face(81, 100), face(2, 10), face(2, 10), face(2, 10));
    await game.brp.BRPCheck._trigger({ rollType: 'SN', cardType: 'NO', shiftKey: true, actor: lifecycle, token: null });
    const deleteCard = await waitFor(() => [...game.messages.values()].slice(before)
      .find((entry) => entry.flags?.brp?.chatCard?.[0]?.particId === lifecycle.id));
    const deleteEffect = tempEffect(game.actors.get(lifecycle.id));
    await deleteEffect.delete();
    const deleteEnded = await waitFor(() => game.messages.get(deleteCard.id)?.flags?.brp?.madness?.ended === true, 3000);
    const deleteActor = game.actors.get(lifecycle.id);
    check('cocM4DeleteEffectEndsEpisodeAndCard', !!deleteEnded
      && deleteActor.system.sanity.insanity.temporary?.active === false
      && deleteActor.system.sanity.insanity.temporary?.endReason === 'effect-deleted'
      && !tempEffect(deleteActor),
      { ended: deleteEnded, temporary: deleteActor.system.sanity.insanity.temporary, effects: statuses(deleteActor) });

    // 13) completeIntCheck never invents an episode from a failed roll or a
    // sub-threshold single loss; a passing roll on a real 5+ loss does open one.
    const intPath = await newCoc('M4 INT Path');
    actors.push(intPath);
    await setDay(intPath, 40);
    await intPath.update({ 'system.sanity.singleLoss': 6, 'system.sanity.value': 34 });
    const failedInt = await game.brp.sanity.intCheck({ actor: intPath, roll: 100 });
    check('cocM4CompleteIntCheckFailureDoesNothing', failedInt.applied === true
      && failedInt.temporary === null && !tempEffect(intPath),
      { failedInt, effects: statuses(intPath) });
    queueDice(face(2, 10), face(2, 10), face(2, 10));
    const passedInt = await game.brp.sanity.intCheck({ actor: intPath, roll: 10 });
    check('cocM4CompleteIntCheckPassOpensEpisode', passedInt.applied === true
      && passedInt.temporary?.active === true && !!tempEffect(intPath)
      && passedInt.temporary?.bout?.index === 2,
      { passedInt, effects: statuses(intPath) });
    await intPath.update({ 'system.sanity.singleLoss': 0, 'system.sanity.insanity': { temporary: null, indefinite: null, permanent: false, lastUpdatedAt: 0 } });
    for (const effect of [...intPath.effects]) { await effect.delete(); }
    const subThresholdInt = await game.brp.sanity.intCheck({ actor: intPath, roll: 10 });
    check('cocM4CompleteIntCheckRequiresRealSingleLoss', subThresholdInt.applied === false
      && subThresholdInt.reason === 'loss-below-threshold' && !tempEffect(intPath),
      { subThresholdInt, effects: statuses(intPath) });
  } finally {
    Math.random = realRandom;
    try { await game.settings.set('brp', 'ruleset', prevRuleset); } catch { /* shim only */ }
    try { await game.settings.set('brp', 'starterSkills', prevStarter); } catch { /* shim only */ }
    try { await game.settings.set('brp', 'autoXP', prevAutoXP); } catch { /* shim only */ }
    try { await game.settings.set('brp', 'development', prevDevelopment); } catch { /* shim only */ }
    try { await game.settings.set('brp', 'worldTime', prevWorld); } catch { /* shim only */ }
    try { await game.settings.set('brp', 'cocDaySeq', prevSeq); } catch { /* shim only */ }
    try { await game.settings.set('brp', 'cocSessionSeq', prevSession); } catch { /* shim only */ }
    try { game.time.worldTime = prevWorldTime; } catch { /* shim only */ }
    for (const actor of actors) {
      if (!actor) { continue; }
      try { await deleteCardsFor(actor); } catch { /* shim only */ }
      try { await actor.delete(); } catch { /* shim only */ }
    }
  }
}

if (out.errors.length) {
  throw new Error(`regression checks failed: ${out.errors.join(' | ')}`);
}
return out;
