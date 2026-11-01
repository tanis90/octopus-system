const sheet = document.getElementById('sheet');
const toast = document.getElementById('toast');
const cardKind = document.body.dataset.card || 'npc';
const storageKey = `coc-paper-${cardKind}-design/v1`;
let toastTimer;

function readState() {
  try { return { ...window.COC_DESIGN_DEFAULTS, ...JSON.parse(localStorage.getItem(storageKey) || '{}') }; }
  catch { return { ...window.COC_DESIGN_DEFAULTS }; }
}
const state = readState();
const params = new URLSearchParams(location.search);
if (['classic', 'compact', 'contrast'].includes(params.get('variant'))) state.variant = params.get('variant');

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = `设计稿交互：${message}`;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 1800);
}
function persist(key) {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* preview storage is optional */ }
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
function activateTab(id, focus = false) {
  const tabs = [...document.querySelectorAll('[data-tab]')];
  const tab = tabs.find((button) => button.dataset.tab === id);
  if (!tab) return;
  tabs.forEach((button) => {
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
  const content = document.querySelector('.content');
  if (content) content.scrollTop = 0;
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

const editToggle = document.getElementById('edit-toggle');
if (editToggle) {
  editToggle.addEventListener('click', () => {
    const editing = sheet.classList.toggle('is-editing');
    editToggle.setAttribute('aria-pressed', String(editing));
    editToggle.textContent = editing ? '使用' : '编辑';
    if (!editing) {
      sheet.classList.remove('show-formula');
      document.getElementById('formula-toggle')?.setAttribute('aria-pressed', 'false');
    }
  });
}
const formulaToggle = document.getElementById('formula-toggle');
if (formulaToggle) {
  formulaToggle.addEventListener('click', () => {
    const formula = sheet.classList.toggle('show-formula');
    formulaToggle.setAttribute('aria-pressed', String(formula));
  });
}
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

const skillSearch = document.getElementById('skill-search');
if (skillSearch) {
  skillSearch.addEventListener('input', () => {
    const query = skillSearch.value.trim().toLocaleLowerCase('zh-CN');
    document.querySelectorAll('#skill-rows [data-name]').forEach((row) => {
      row.hidden = !row.dataset.name.toLocaleLowerCase('zh-CN').includes(query);
    });
  });
}
document.querySelectorAll('[data-sort]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-sort]').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
    if (button.dataset.sort === 'custom') {
      showToast('自定义排序：编辑态拖拽技能行');
      return;
    }
    const tbody = document.getElementById('skill-rows');
    if (!tbody) return;
    const rows = [...tbody.querySelectorAll(':scope > [data-skill-row]')];
    rows.sort((a, b) => button.dataset.sort === 'name'
      ? a.dataset.name.localeCompare(b.dataset.name, 'zh-CN')
      : Number(b.dataset.value) - Number(a.dataset.value));
    rows.forEach((row) => tbody.appendChild(row));
  });
});
document.querySelectorAll('[data-effect]').forEach((button) => {
  button.addEventListener('click', () => {
    const enabled = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(enabled));
    button.closest('.effect-row').classList.toggle('disabled', !enabled);
  });
});
document.querySelectorAll('[data-demo]').forEach((button) => {
  button.addEventListener('click', () => showToast(button.dataset.demo));
});

applyVariant(state.variant);
activateTab(params.get('tab') || document.body.dataset.activeTab || 'combat');
