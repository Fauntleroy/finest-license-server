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

// Second-step "are you absolutely sure" body.
const ABSOLUTELY_SURE_HTML = `
  <p>Last chance, Timmy.</p>
  <div class="modal-bigtext">NO TAKEBACKS</div>
  <p>Click <strong>100% yes</strong> and Auto-Checkout is armed.</p>
  <p>The next Supreme checkout page you load gets bought without asking again. Cart looking weird? Close this and fix it first.</p>
`;

// Auto-checkout enable warning. The .modal-bigtext element renders header-style.
const AUTOCHECKOUT_WARNING_HTML = `
  <p>Do you even skate, bro?</p>
  <p>Flip this on and the next Supreme checkout page you hit is getting</p>
  <div class="modal-bigtext">PURCHASED IMMEDIATELY</div>
  <p>No &ldquo;review cart,&rdquo; no second chance, no little safety hug.</p>
  <p>Real card. Real charge. Real Timmy behavior.</p>
  <ul>
    <li>Wrong size in cart? That&rsquo;s on you.</li>
    <li>Left it on from yesterday? That&rsquo;s on you.</li>
    <li>Wife sees the card statement? That&rsquo;s on you, Timmy.</li>
  </ul>
  <p>Auto-Checkout shuts itself OFF after every completed order, so it will not keep firing like a maniac. But when you turn it on, you better mean it.</p>
  <p>Use it for drop time and restock purposes only or be prepared to explain why you bought a rainbow BB Simon x Hot Topic glitter camp cap for $278 at 8:14 AM on a Friday.</p>
`;

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

  // Show waitlist + autocheckout sections only when at least one profile exists
  const waitlistEl = document.getElementById('waitlist-section');
  const autoEl     = document.getElementById('autocheckout-section');
  const bannerEl   = document.getElementById('beta-banner');
  if (waitlistEl) waitlistEl.style.display = keys.length === 0 ? 'none' : '';
  if (autoEl)     autoEl.style.display     = keys.length === 0 ? 'none' : '';
  if (bannerEl)   bannerEl.style.display   = keys.length === 0 ? 'none' : '';

  if (keys.length === 0) {
    empty.classList.add('visible');
    return;
  }
  empty.classList.remove('visible');

  // Sync the dashboard Auto-Checkout toggle with the active profile
  syncAutoCheckoutToggle();

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
const BOOL_FIELDS = ['autoCheckout'];

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
  for (const f of BOOL_FIELDS) {
    const el = document.getElementById(`f-${f}`);
    if (el) el.checked = !!p[f];
  }

  // Format CC on load
  const ccEl = document.getElementById('f-CC');
  if (ccEl.value) ccEl.value = formatCC(ccEl.value);

  // Show the warning banner whenever the toggle is currently on
  document.getElementById('autocheckout-warning').style.display =
    document.getElementById('f-autoCheckout').checked ? '' : 'none';

  showView('editor');
}

function readForm() {
  const p = {};
  for (const f of FIELDS) {
    const el = document.getElementById(`f-${f}`);
    if (el) p[f] = el.value.trim();
  }
  for (const f of BOOL_FIELDS) {
    const el = document.getElementById(`f-${f}`);
    if (el) p[f] = el.checked;
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
  document.getElementById('s-autoFill').checked         = !!settings.autoFill;
  document.getElementById('s-waitlistAutoBook').checked = !!settings.waitlistAutoBook;
  document.getElementById('s-waitlistStore').value      = settings.waitlistStore || '';
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
function showDashboardGate() {
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
                background:#080808;color:#f0e6c8;font-family:monospace;padding:32px">
      <div style="max-width:420px;text-align:center">
        <div style="font-family:Syne,sans-serif;font-size:18px;font-weight:800;letter-spacing:0.1em;color:#c9a84c;margin-bottom:8px">FINEST CHECKOUTS</div>
        <div style="color:#7a6f56;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:32px">License Required</div>
        <p style="font-size:13px;line-height:1.6;margin-bottom:24px">
          This dashboard is locked. Open the Finest Checkouts popup (click the extension icon in your browser toolbar) and enter your license key to activate.
        </p>
        <p style="font-size:11px;color:#7a6f56;margin-bottom:16px">
          Already activated? Your license may have expired or been revoked.
          Re-enter your key in the popup to re-activate.
        </p>
        <p style="font-size:11px;color:#7a6f56;margin-bottom:24px">
          Lost your key? <a href="https://finest-license-server-production.up.railway.app/recover" target="_blank" style="color:#c9a84c;text-decoration:none">Recover it →</a>
        </p>
        <p style="font-size:10px;color:#3a3530">
          <a href="https://finest-license-server-production.up.railway.app/privacy" target="_blank" style="color:#3a3530">Privacy Policy</a>
          &nbsp;·&nbsp;
          <a href="https://finest-license-server-production.up.railway.app/terms" target="_blank" style="color:#3a3530">Terms of Service</a>
        </p>
      </div>
    </div>`;
}

async function init() {
  // License gate — block dashboard entirely if no valid license cached.
  // background.js re-validates with the server every hour and updates licenseValid.
  if (!(await License.isValid())) {
    showDashboardGate();
    return;
  }

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

  // Auto-checkout — show big funny warning when enabling, allow easy disable
  document.getElementById('f-autoCheckout').addEventListener('change', async (e) => {
    const warning = document.getElementById('autocheckout-warning');
    if (e.target.checked) {
      const ok = await confirmAutoCheckoutEnable();
      if (!ok) { e.target.checked = false; warning.style.display = 'none'; return; }
      warning.style.display = '';
    } else {
      warning.style.display = 'none';
    }
  });

  // ── Custom confirm modal (replaces native confirm() for image + style) ────
  function areYouSure(html) {
    return new Promise((resolve) => {
      const modal  = document.getElementById('ays-modal');
      const body   = document.getElementById('ays-body');
      const okBtn  = document.getElementById('ays-ok');
      const cxBtn  = document.getElementById('ays-cancel');
      body.innerHTML = html;
      modal.hidden = false;
      const cleanup = (val) => {
        modal.hidden = true;
        okBtn.removeEventListener('click', onOk);
        cxBtn.removeEventListener('click', onCx);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onOk  = () => cleanup(true);
      const onCx  = () => cleanup(false);
      const onKey = (ev) => {
        if (ev.key === 'Escape') cleanup(false);
        if (ev.key === 'Enter')  cleanup(true);
      };
      okBtn.addEventListener('click', onOk);
      cxBtn.addEventListener('click', onCx);
      document.addEventListener('keydown', onKey);
      okBtn.focus();
    });
  }

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
  document.getElementById('s-waitlistAutoBook').addEventListener('change', async (e) => {
    await saveSetting('waitlistAutoBook', e.target.checked);
    // Clear the stopped flag when toggling — fresh start each time
    await chrome.storage.local.set({ waitwhileStopped: false });
  });
  document.getElementById('s-waitlistStore').addEventListener('change', (e) =>
    saveSetting('waitlistStore', e.target.value));

  // ── Dashboard-level Auto-Checkout toggle (binds to the ACTIVE profile) ──
  document.getElementById('d-autoCheckout').addEventListener('change', async (e) => {
    if (!activeProfile || !profiles[activeProfile]) {
      e.target.checked = false;
      toast('Pick an active profile first');
      return;
    }
    if (e.target.checked) {
      const ok = await confirmAutoCheckoutEnable();
      if (!ok) { e.target.checked = false; return; }
    }
    profiles[activeProfile].autoCheckout = e.target.checked;
    await S.set({ profiles });
    syncAutoCheckoutToggle();
  });

  // Import / Export
  document.getElementById('btn-export').addEventListener('click', exportProfiles);
  document.getElementById('btn-import').addEventListener('click', () =>
    document.getElementById('file-import').click());
  document.getElementById('file-import').addEventListener('change', (e) => {
    if (e.target.files[0]) importProfiles(e.target.files[0]);
    e.target.value = '';
  });
}

// ── Sync the dashboard Auto-Checkout toggle with the currently active profile
function syncAutoCheckoutToggle() {
  const toggle = document.getElementById('d-autoCheckout');
  const nameEl = document.getElementById('autocheckout-active-name');
  if (!toggle) return;
  if (!activeProfile || !profiles[activeProfile]) {
    toggle.checked = false;
    if (nameEl) nameEl.textContent = 'No active profile.';
    return;
  }
  const p = profiles[activeProfile];
  toggle.checked = !!p.autoCheckout;
  if (nameEl) nameEl.textContent = `Active profile: ${p.profileName || activeProfile}`;
}

// Custom confirm modal — supports title, body HTML, and button labels.
function areYouSureDash(opts) {
  const { html = '', title = 'ARE YOU SURE ABOUT THAT?', okText = 'OK', cancelText = 'Cancel' } = opts || {};
  return new Promise((resolve) => {
    const modal  = document.getElementById('ays-modal');
    const titleEl= document.getElementById('ays-title');
    const body   = document.getElementById('ays-body');
    const okBtn  = document.getElementById('ays-ok');
    const cxBtn  = document.getElementById('ays-cancel');
    titleEl.textContent = title;
    body.innerHTML = html;
    okBtn.textContent = okText;
    cxBtn.textContent = cancelText;
    modal.hidden = false;
    const cleanup = (val) => {
      modal.hidden = true;
      okBtn.removeEventListener('click', onOk);
      cxBtn.removeEventListener('click', onCx);
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onOk  = () => cleanup(true);
    const onCx  = () => cleanup(false);
    const onKey = (ev) => {
      if (ev.key === 'Escape') cleanup(false);
      if (ev.key === 'Enter')  cleanup(true);
    };
    okBtn.addEventListener('click', onOk);
    cxBtn.addEventListener('click', onCx);
    document.addEventListener('keydown', onKey);
    okBtn.focus();
  });
}

// Two-step confirmation used everywhere we arm Auto-Checkout
async function confirmAutoCheckoutEnable() {
  const ok1 = await areYouSureDash({
    title: 'ARE YOU SURE ABOUT THAT?',
    html:  AUTOCHECKOUT_WARNING_HTML,
    okText: 'Yeah I skate',
  });
  if (!ok1) return false;
  const ok2 = await areYouSureDash({
    title: 'ARE YOU ABSOLUTELY SURE?',
    html:  ABSOLUTELY_SURE_HTML,
    okText: '100% yes, let it rip',
  });
  return ok2;
}

document.addEventListener('DOMContentLoaded', init);
