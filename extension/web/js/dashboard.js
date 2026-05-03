/**
 * Finest Checkouts — Dashboard Logic
 */

// ─── Storage helpers ───────────────────────────────────────────────────────────
const S = {
  get: (k) => new Promise(r => chrome.storage.local.get(k, r)),
  set: (d) => new Promise(r => chrome.storage.local.set(d, r)),
};

// ─── State ────────────────────────────────────────────────────────────────────
let profiles      = {};
let activeProfile = null;
let editingKey    = null;   // null = new profile

// ─── Toast ───────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ─── View routing ─────────────────────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${id}`).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === id);
  });
}

// ─── Profile list ─────────────────────────────────────────────────────────────
function renderProfiles() {
  const grid  = document.getElementById('profile-grid');
  const empty = document.getElementById('empty-profiles');
  const keys  = Object.keys(profiles);

  grid.innerHTML = '';

  if (keys.length === 0) {
    empty.classList.add('visible');
    return;
  }
  empty.classList.remove('visible');

  for (const key of keys) {
    const p = profiles[key];
    const card = document.createElement('div');
    card.className = 'profile-card' + (key === activeProfile ? ' active-profile' : '');
    card.innerHTML = `
      <div class="card-name">${esc(p.profileName || key)}</div>
      <div class="card-meta">
        ${esc(p.fName)} ${esc(p.lName)}<br>
        ${esc(p.email)}<br>
        ${esc(p.city)}, ${esc(p.state)} ${esc(p.zip)}
      </div>
      <div class="card-cc">•••• •••• •••• ${lastFour(p.CC)}</div>
      <div class="card-actions">
        <button class="card-btn activate" data-key="${esc(key)}">Set Active</button>
        <button class="card-btn edit"     data-key="${esc(key)}">Edit</button>
      </div>
    `;
    grid.appendChild(card);
  }

  grid.querySelectorAll('.card-btn.activate').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); setActive(btn.dataset.key); }));
  grid.querySelectorAll('.card-btn.edit').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); openEditor(btn.dataset.key); }));
}

function esc(v) { return String(v || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function lastFour(cc) { return String(cc || '').replace(/\s/g, '').slice(-4) || '????'; }

// ─── Set active ───────────────────────────────────────────────────────────────
async function setActive(key) {
  activeProfile = key;
  await S.set({ activeProfile: key });
  toast(`Active: ${profiles[key]?.profileName || key}`);
  renderProfiles();
}

// ─── Editor ───────────────────────────────────────────────────────────────────
const FIELDS = ['profileName','fName','lName','email','phone','address','address2',
                'city','state','zip','country','CC','expiry','cvv','nameOnCard'];

function openEditor(key = null) {
  editingKey = key;
  const p = key ? profiles[key] : {};

  document.getElementById('editor-title').textContent = key
    ? (p.profileName || key)
    : 'New Profile';
  document.getElementById('btn-delete-profile').style.display = key ? '' : 'none';

  for (const f of FIELDS) {
    const el = document.getElementById(`f-${f}`);
    if (el) el.value = p[f] || '';
  }

  // Format CC on load
  const ccEl = document.getElementById('f-CC');
  if (ccEl.value) ccEl.value = formatCC(ccEl.value);

  showView('editor');
}

function readForm() {
  const p = {};
  for (const f of FIELDS) {
    const el = document.getElementById(`f-${f}`);
    if (el) p[f] = el.value.trim();
  }
  // Store CC without spaces internally, but display with spaces
  p.CC = p.CC.replace(/\s/g, '');
  return p;
}

async function saveProfile() {
  const p = readForm();
  if (!p.profileName) { toast('Profile name is required'); return; }

  // Key = profileName slugified, or existing key
  const key = editingKey || slugify(p.profileName);
  profiles[key] = p;

  if (!activeProfile) activeProfile = key;

  await S.set({ profiles, activeProfile });
  toast('Saved');
  showView('profiles');
  renderProfiles();
}

async function deleteProfile() {
  if (!editingKey) return;
  if (!confirm(`Delete "${profiles[editingKey]?.profileName || editingKey}"?`)) return;

  delete profiles[editingKey];
  if (activeProfile === editingKey) {
    activeProfile = Object.keys(profiles)[0] || null;
  }
  await S.set({ profiles, activeProfile });
  toast('Deleted');
  showView('profiles');
  renderProfiles();
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || Date.now().toString();
}

// ─── CC formatting ────────────────────────────────────────────────────────────
function formatCC(v) {
  return v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const data = await S.get('settings');
  const settings = data.settings || {};
  document.getElementById('s-autoFill').checked = !!settings.autoFill;
}

async function saveSetting(key, value) {
  const data = await S.get('settings');
  const settings = data.settings || {};
  settings[key] = value;
  await S.set({ settings });
}

// ─── Import / Export ──────────────────────────────────────────────────────────
function exportProfiles() {
  const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'finest-profiles.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importProfiles(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      // Merge imported over existing
      profiles = { ...profiles, ...imported };
      await S.set({ profiles });
      renderProfiles();
      toast(`Imported ${Object.keys(imported).length} profile(s)`);
    } catch {
      toast('Invalid JSON file');
    }
  };
  reader.readAsText(file);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const data = await S.get(['profiles', 'activeProfile']);
  profiles      = data.profiles      || {};
  activeProfile = data.activeProfile || null;

  renderProfiles();
  await loadSettings();

  // Nav
  document.querySelectorAll('.nav-item').forEach(btn =>
    btn.addEventListener('click', () => showView(btn.dataset.view)));

  // New profile
  document.getElementById('btn-new-profile').addEventListener('click', () => openEditor());
  document.getElementById('btn-new-profile-empty').addEventListener('click', () => openEditor());

  // Editor
  document.getElementById('btn-back').addEventListener('click', () => {
    showView('profiles'); renderProfiles();
  });
  document.getElementById('btn-save-profile').addEventListener('click', saveProfile);
  document.getElementById('btn-delete-profile').addEventListener('click', deleteProfile);

  // CC auto-format — track cursor by digit count so spaces don't shift it
  document.getElementById('f-CC').addEventListener('input', (e) => {
    const input = e.target;
    const digitsBeforeCursor = input.value.slice(0, input.selectionStart).replace(/\D/g, '').length;
    input.value = formatCC(input.value);
    // Find the position after digitsBeforeCursor digits in the formatted value
    let count = 0, pos = input.value.length;
    for (let i = 0; i < input.value.length; i++) {
      if (/\d/.test(input.value[i])) count++;
      if (count === digitsBeforeCursor) { pos = i + 1; break; }
    }
    input.setSelectionRange(pos, pos);
  });

  // Settings
  document.getElementById('s-autoFill').addEventListener('change', (e) =>
    saveSetting('autoFill', e.target.checked));

  // Import / Export
  document.getElementById('btn-export').addEventListener('click', exportProfiles);
  document.getElementById('btn-import').addEventListener('click', () =>
    document.getElementById('file-import').click());
  document.getElementById('file-import').addEventListener('change', (e) => {
    if (e.target.files[0]) importProfiles(e.target.files[0]);
    e.target.value = '';
  });
}

document.addEventListener('DOMContentLoaded', init);
