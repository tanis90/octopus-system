const out = { checks: {}, errors: [] };
const check = (name, ok, detail) => {
  out.checks[name] = ok ? true : { ok: false, detail };
  if (!ok) out.errors.push(`${name}: ${JSON.stringify(detail)}`);
};

for (const type of ['character', 'npc', 'vehicle']) {
  const actor = await Actor.create({ name: `Window Controls ${type}`, type }, { renderSheet: false });
  try {
    await actor.sheet.render(true);
    const sheet = actor.sheet;
    const header = sheet.element?.querySelector('.window-header');
    const rightControls = [...(header?.querySelectorAll('.window-controls > .header-control, :scope > .header-control') ?? [])]
      .filter((element) => !element.classList.contains('brp-mode-toggle') && !element.hidden);
    const detail = {
      minimizable: sheet.options.window?.minimizable,
      rightControls: rightControls.map((element) => ({ action: element.dataset.action, classes: element.className })),
      minimize: !!header?.querySelector('.control-minimize'),
      copyUuid: !!header?.querySelector('[data-action="copyUuid"]'),
      brpid: !!header?.querySelector('[data-action="editBRPid"]'),
      modeToggles: header?.querySelectorAll('[data-brp-mode-toggle]').length ?? 0,
    };
    check(`${type}CloseOnly`, rightControls.length === 1 && rightControls[0]?.dataset.action === 'close', detail);
    check(`${type}NoUtilityControls`, sheet.options.window?.minimizable === false
      && !detail.minimize && !detail.copyUuid && !detail.brpid, detail);
    check(`${type}ModeToggle`, type === 'vehicle' ? detail.modeToggles === 0 : detail.modeToggles === 1, detail);
    if (type === 'character') {
      const CocSheet = sheet.constructor;
      const NonCocFrameSheet = class extends CocSheet {};
      NonCocFrameSheet.DEFAULT_OPTIONS = foundry.utils.mergeObject(CocSheet.DEFAULT_OPTIONS, {
        window: { minimizable: true },
      }, { inplace: false });
      const nonCoc = new NonCocFrameSheet({ document: actor });
      nonCoc.options.classes = ['non-coc-frame'];
      try {
        await nonCoc.render(true);
        const nonCocHeader = nonCoc.element?.querySelector('.window-header');
        const nonCocDetail = {
          minimizable: nonCoc.options.window?.minimizable,
          minimize: !!nonCocHeader?.querySelector('.control-minimize'),
          copyUuid: !!nonCocHeader?.querySelector('[data-action="copyUuid"]'),
          brpid: !!nonCocHeader?.querySelector('[data-action="editBRPid"]'),
        };
        check('nonCocFrameUtilitiesUnchanged', nonCocDetail.minimizable === true
          && nonCocDetail.minimize && nonCocDetail.copyUuid && nonCocDetail.brpid, nonCocDetail);
      } finally {
        try { await nonCoc.close(); } catch { /* shim only */ }
      }
    }
  } finally {
    try { await actor.sheet.close(); } catch { /* shim only */ }
    await actor.delete();
  }
}

if (out.errors.length) throw new Error(out.errors.join(' | '));
return out;
