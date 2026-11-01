const sheet = document.getElementById('sheet');
const sheetBody = document.getElementById('sheet-body');
const toast = document.getElementById('toast');
const storageKey = 'coc-paper-sheet-design/v1';
let toastTimer;

function readState() {
  try {
    return { ...window.COC_DESIGN_DEFAULTS, ...JSON.parse(localStorage.getItem(storageKey) || '{}') };
  } catch {
    return { ...window.COC_DESIGN_DEFAULTS };
  }
}
const state = readState();
const params = new URLSearchParams(location.search);
if (['classic', 'compact', 'contrast'].includes(params.get('variant'))) state.variant = params.get('variant');
if (params.get('sidebar') === 'collapsed') state.sidebar = false;

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = `设计稿交互：${message}`;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 1800);
}

function persist(key) {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* file preview may disable storage */ }
  window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: state[key] } }, '*');
}

function applyVariant(value, notify = false) {
  state.variant = ['classic', 'compact', 'contrast'].includes(value) ? value : 'classic';
  document.body.dataset.variant = state.variant;
  document.querySelectorAll('[data-variant-button]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.variantButton === state.variant));
  });
  if (notify) persist('variant');
}

function applySidebar(expanded, notify = false) {
  state.sidebar = expanded;
  sheetBody.classList.toggle('sidebar-collapsed', !expanded);
  const button = document.getElementById('favorites-toggle');
  button.setAttribute('aria-expanded', String(expanded));
  button.setAttribute('aria-label', expanded ? '收起收藏栏' : '展开收藏栏');
  button.textContent = expanded ? '−' : '+';
  if (notify) persist('sidebar');
}

function activateTab(id, focus = false) {
  const tab = document.querySelector(`[data-tab="${id}"]`);
  if (!tab) return;
  document.querySelectorAll('[data-tab]').forEach((button) => {
    const active = button === tab;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    const active = panel.dataset.panel === id;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
  document.body.dataset.activeTab = id;
  document.querySelector('.content').scrollTop = 0;
  if (focus) tab.focus();
}

window.addEventListener('message', (event) => {
  if (event.data?.type === '__activate_edit_mode') document.querySelector('.design-tweaks').hidden = false;
  if (event.data?.type === '__deactivate_edit_mode') document.querySelector('.design-tweaks').hidden = true;
});
window.parent.postMessage({ type: '__edit_mode_available' }, '*');

document.querySelectorAll('[data-variant-button]').forEach((button) => {
  button.addEventListener('click', () => applyVariant(button.dataset.variantButton, true));
});
document.getElementById('favorites-toggle').addEventListener('click', () => applySidebar(!state.sidebar, true));
document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => activateTab(button.dataset.tab));
  button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('[data-tab]')];
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const index = (tabs.indexOf(button) + direction + tabs.length) % tabs.length;
    activateTab(tabs[index].dataset.tab, true);
  });
});

document.getElementById('edit-toggle').addEventListener('click', (event) => {
  const editing = sheet.classList.toggle('is-editing');
  event.currentTarget.setAttribute('aria-pressed', String(editing));
  event.currentTarget.textContent = editing ? '使用' : '编辑';
});
document.getElementById('window-close').addEventListener('click', () => {
  sheet.hidden = true;
  document.getElementById('reopen-sheet').hidden = false;
});
document.getElementById('reopen-sheet').addEventListener('click', (event) => {
  sheet.hidden = false;
  event.currentTarget.hidden = true;
});

document.querySelectorAll('.condition').forEach((button) => {
  button.addEventListener('click', () => button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true')));
});
document.querySelectorAll('[data-growth]').forEach((button) => {
  button.addEventListener('click', () => {
    const marked = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(marked));
    button.textContent = marked ? '×' : '';
  });
});
document.querySelectorAll('[data-favorite]').forEach((button) => {
  button.addEventListener('click', () => {
    const favored = button.textContent !== '★';
    button.textContent = favored ? '★' : '☆';
    showToast(favored ? '加入收藏' : '移出收藏');
  });
});
document.querySelectorAll('.group-toggle').forEach((button) => {
  button.addEventListener('click', () => {
    const collapsed = button.closest('.group-row').classList.toggle('collapsed');
    button.setAttribute('aria-expanded', String(!collapsed));
    button.querySelector('strong').textContent = `${collapsed ? '›' : '⌄'} 射击`;
  });
});

const skillSearch = document.getElementById('skill-search');
const uncommon = document.getElementById('show-uncommon');
function filterSkills() {
  const query = skillSearch.value.trim().toLocaleLowerCase('zh-CN');
  document.querySelectorAll('#skill-rows [data-name]').forEach((row) => {
    const matches = row.dataset.name.toLocaleLowerCase('zh-CN').includes(query);
    const visibleUncommon = uncommon.checked || row.dataset.uncommon !== 'true';
    row.hidden = !matches || !visibleUncommon;
  });
  document.querySelectorAll('.group-row').forEach((group) => {
    const specialties = [...group.parentElement.querySelectorAll('[data-specialty-row]')];
    group.hidden = !specialties.some((row) => !row.hidden);
  });
}
skillSearch.addEventListener('input', filterSkills);
uncommon.addEventListener('change', filterSkills);

document.querySelectorAll('[data-sort]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-sort]').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
    const tbody = document.getElementById('skill-rows');
    const rows = [...tbody.querySelectorAll(':scope > [data-skill-row]')];
    const anchor = tbody.querySelector('[data-group]');
    rows.sort((a, b) => button.dataset.sort === 'name'
      ? a.dataset.name.localeCompare(b.dataset.name, 'zh-CN')
      : Number(b.dataset.value) - Number(a.dataset.value));
    rows.forEach((row) => tbody.insertBefore(row, anchor));
  });
});

const keySummary = document.getElementById('key-summary');
function updateKeySummary() {
  const keys = [...document.querySelectorAll('[data-bio]')]
    .filter((card) => card.querySelector('[data-key]').getAttribute('aria-pressed') === 'true')
    .map((card) => card.dataset.bio);
  keySummary.textContent = `关键链接：${keys.length ? keys.join('、') : '无'}`;
}
document.querySelectorAll('[data-key]').forEach((button) => {
  button.addEventListener('click', () => {
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
    updateKeySummary();
  });
});
document.querySelectorAll('[data-effect]').forEach((button) => {
  button.addEventListener('click', () => {
    const enabled = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(enabled));
    button.closest('.effect-row').classList.toggle('disabled', !enabled);
  });
});
document.querySelectorAll('[data-mythos]').forEach((button) => {
  button.addEventListener('click', () => button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true')));
});
document.querySelectorAll('[data-demo]').forEach((button) => {
  button.addEventListener('click', () => showToast(button.dataset.demo));
});

applyVariant(state.variant);
applySidebar(state.sidebar !== false);
activateTab(params.get('tab') || 'skills');
filterSkills();
updateKeySummary();
