// Regression probe for the unreleased post-d5d4a22 fixes:
//   1) NPC/combat: CB card resolve must not throw when the entry has no skillId
//      (NPC weapons never get weapon skills); auto-XP off must not tick XP;
//      native NPC HP path is updateVitals/manual HP, not character wounds.
//   2) Luck: racing spends serialize; the real chat-button path writes flags and
//      re-renders content; all clients route chat actions to Foundry's activeGM.
//   3) SAN: keeper "new day" clears dailyLoss; deleting/disabling/expiring the
//      tempInsane effect ends the episode card instead of leaving it open.
//   4) Base-pack UUID determinism lives in tools/tests/base-pack-determinism.mjs.
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

if (out.errors.length) {
  throw new Error(`regression checks failed: ${out.errors.join(' | ')}`);
}
return out;
