/**
 * Finest Checkouts — Popup
 * License gate + fast profile switching + one-click fill.
 */

const S = {
  get: (k) => new Promise(r => chrome.storage.local.get(k, r)),
  set: (d) => new Promise(r => chrome.storage.local.set(d, r)),
};

function esc(v) {
  return String(v || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function lastFour(cc) {
  return String(cc || '').replace(/\s/g, '').slice(-4) || '????';
}
function cardType(cc) {
  const n = String(cc || '').replace(/\s/g, '');
  if (n.startsWith('4'))  return 'Visa';
  if (/^5[1-5]/.test(n)) return 'MC';
  if (/^3[47]/.test(n))  return 'Amex';
  return 'Card';
}

// ── LICENSE GATE ──────────────────────────────────────────────────────────────
function showLicenseGate(body) {
  body.innerHTML = `
    <div class="license-gate">
      <div class="license-diamond"></div>
      <div class="license-title">FINEST CHECKOUTS</div>
      <div class="license-sub">Enter your license key to activate.</div>

      <div class="license-input-wrap">
        <input
          class="license-input"
          id="license-key-input"
          type="text"
          placeholder="FINEST-XXXX-XXXX-XXXX"
          maxlength="22"
          spellcheck="false"
          autocomplete="off"
        />
      </div>

      <div class="license-error" id="license-error"></div>

      <button class="btn-activate" id="btn-activate">Activate</button>

      <div class="license-link">
        Don't have a key? <a href="https://whop.com/finest-tools" target="_blank">Get access →</a>
      </div>
    </div>
  `;

  const input  = document.getElementById('license-key-input');
  const btn    = document.getElementById('btn-activate');
  const errEl  = document.getElementById('license-error');

  // Auto-format as they type
  input.addEventListener('input', () => {
    let val = input.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    // Insert dashes at positions 6, 10, 14 (after FINEST, then every 4)
    if (val.startsWith('FINEST')) {
      let rest = val.slice(6);
      let parts = rest.match(/.{1,4}/g) || [];
      input.value = 'FINEST' + (parts.length ? '-' + parts.join('-') : '');
    } else {
      input.value = val;
    }
  });

  btn.addEventListener('click', async () => {
    const key = input.value.trim().toUpperCase();
    if (!key) {
      errEl.textContent = 'Please enter your license key.';
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Checking…';
    errEl.textContent = '';
    input.classList.remove('error', 'success');

    const result = await License.validate(key);

    if (result.valid) {
      await License.storeKey(key);
      input.classList.add('success');
      btn.textContent = 'Activated ✓';
      setTimeout(() => init(), 800);
    } else {
      input.classList.add('error');
      errEl.textContent = result.message || 'Invalid key.';
      btn.disabled    = false;
      btn.textContent = 'Activate';
    }
  });

  // Allow Enter key
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btn.click();
  });
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
async function showApp(body) {
  const data     = await S.get(['profiles', 'activeProfile', 'settings']);
  const profiles = data.profiles      || {};
  const settings = data.settings      || {};
  const keys     = Object.keys(profiles);

  if (keys.length === 0) {
    body.innerHTML = `
      <div class="empty">
        <p>No profiles yet.</p>
        <button class="btn-primary full" id="btn-open-dash">Open Dashboard</button>
      </div>`;
    body.querySelector('#btn-open-dash').addEventListener('click', () =>
      chrome.runtime.openOptionsPage());
    return;
  }

  let activeKey = data.activeProfile || keys[0];
  if (!profiles[activeKey]) activeKey = keys[0];

  function profileCard(key, isActive) {
    const p = profiles[key];
    return `
      <div class="profile-row ${isActive ? 'is-active' : ''}" data-key="${esc(key)}">
        <div class="profile-row-info">
          <div class="profile-row-name">${esc(p.profileName || key)}</div>
          <div class="profile-row-meta">${esc(p.fName)} ${esc(p.lName)} · ${cardType(p.CC)} ••${lastFour(p.CC)}</div>
        </div>
        ${isActive
          ? '<span class="active-pip"></span>'
          : `<button class="btn-select" data-key="${esc(key)}">Use</button>`
        }
      </div>`;
  }

  body.innerHTML = `
    <div class="profiles-list" id="profiles-list">
      ${keys.map(k => profileCard(k, k === activeKey)).join('')}
    </div>
    <div class="fill-bar">
      <button class="btn-fill" id="btn-fill">
        Fill Form
        <span class="fill-profile-name" id="fill-label">${esc(profiles[activeKey]?.profileName || activeKey)}</span>
      </button>
    </div>
    <div class="bottom-bar">
      <label class="toggle-row">
        <span class="toggle-label">Auto-fill on load</span>
        <label class="toggle">
          <input type="checkbox" id="s-autoFill" ${settings.autoFill ? 'checked' : ''}>
          <span class="toggle-track"></span>
        </label>
      </label>
    </div>
  `;

  // Profile switch
  body.querySelectorAll('.btn-select').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      activeKey = btn.dataset.key;
      await S.set({ activeProfile: activeKey });
      document.getElementById('profiles-list').innerHTML =
        keys.map(k => profileCard(k, k === activeKey)).join('');
      document.getElementById('fill-label').textContent =
        profiles[activeKey]?.profileName || activeKey;
      // Re-attach
      body.querySelectorAll('.btn-select').forEach(b =>
        b.addEventListener('click', async () => {
          await S.set({ activeProfile: b.dataset.key });
          init();
        })
      );
    });
  });

  // Fill button
  const fillBtn = document.getElementById('btn-fill');
  fillBtn.addEventListener('click', async () => {
    const profile = profiles[activeKey];
    if (!profile) return;

    fillBtn.textContent = 'Filling…';
    fillBtn.disabled = true;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let ok = false;
    if (tab?.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'FILL_FORM', profile });
        ok = true;
      } catch {}
    }

    fillBtn.textContent = ok ? 'Done ✓' : 'No form found';
    fillBtn.disabled = false;
    if (ok) setTimeout(() => window.close(), 800);
    else setTimeout(() => {
      fillBtn.innerHTML = `Fill Form <span class="fill-profile-name">${esc(profile.profileName || activeKey)}</span>`;
    }, 1500);
  });

  // Auto-fill toggle
  document.getElementById('s-autoFill').addEventListener('change', async (e) => {
    const d = await S.get('settings');
    const s = d.settings || {};
    s.autoFill = e.target.checked;
    await S.set({ settings: s });
  });

  // Show autofill hint on first open if autofill is off
  maybeShowAutoFillHint(settings);
}

// ── AUTOFILL HINT ─────────────────────────────────────────────────────────────
async function maybeShowAutoFillHint(settings) {
  if (settings.autoFillHintSeen) return;
  if (settings.autoFill) return; // already on, no need to remind

  const hint = document.createElement('div');
  hint.className = 'autofill-hint';
  hint.innerHTML = `
    <span>💡 Auto-fill is off by default — enable it below to fill forms automatically.</span>
    <button class="hint-close" id="hint-close">✕</button>
  `;
  document.body.insertBefore(hint, document.getElementById('popup-body'));

  document.getElementById('hint-close').addEventListener('click', async () => {
    hint.remove();
    const d = await S.get('settings');
    const s = d.settings || {};
    s.autoFillHintSeen = true;
    await S.set({ settings: s });
  });

  // Auto-dismiss after 8 seconds
  setTimeout(async () => {
    if (hint.parentNode) {
      hint.remove();
      const d = await S.get('settings');
      const s = d.settings || {};
      s.autoFillHintSeen = true;
      await S.set({ settings: s });
    }
  }, 8000);
}

// ── UPDATE CHECK ──────────────────────────────────────────────────────────────
async function checkForUpdate() {
  try {
    // Background worker pre-downloads scripts — check storage first
    const stored = await S.get(['pendingVersion', 'pendingScripts']);
    if (stored.pendingVersion && stored.pendingScripts) {
      showUpdateBanner(stored.pendingVersion, stored.pendingScripts);
      return;
    }
    // Fallback: hit server directly (background worker may not have run yet)
    const SERVER = 'https://finest-license-server-production.up.railway.app';
    const res    = await fetch(`${SERVER}/version`);
    if (!res.ok) return;
    const { version, downloadUrl } = await res.json();
    const { installedVersion } = await S.get('installedVersion');
    const current = installedVersion || chrome.runtime.getManifest().version;
    if (version && version !== current) {
      showUpdateBanner(version, null, downloadUrl);
    }
  } catch {}
}

function showUpdateBanner(version, scripts, downloadUrl) {
  const banner = document.createElement('div');
  banner.className = 'update-banner';

  if (scripts) {
    // Scripts already staged — one-click apply + reload
    banner.innerHTML = `
      <span>v${esc(version)} ready to install</span>
      <button id="btn-apply-update">Apply Now ↻</button>
    `;
    document.body.insertBefore(banner, document.getElementById('popup-body'));
    document.getElementById('btn-apply-update').addEventListener('click', async () => {
      const btn = document.getElementById('btn-apply-update');
      btn.textContent = 'Restarting…';
      btn.disabled = true;
      await S.set({ activeScripts: scripts, installedVersion: version });
      await chrome.storage.local.remove(['pendingScripts', 'pendingVersion']);
      chrome.action.setBadgeText({ text: '' });
      chrome.runtime.reload();
    });
  } else if (downloadUrl) {
    // Scripts not yet downloaded — fall back to download link
    banner.innerHTML = `
      <span>v${esc(version)} available</span>
      <a href="${downloadUrl}" target="_blank">Download →</a>
    `;
    document.body.insertBefore(banner, document.getElementById('popup-body'));
  }
}

// ── ENTRY POINT ───────────────────────────────────────────────────────────────
async function init() {
  const body = document.getElementById('popup-body');

  // Check if already activated
  const valid = await License.isValid();

  if (!valid) {
    showLicenseGate(body);
  } else {
    // Re-validate with server every ~24h in background (non-blocking)
    License.getStoredKey().then(async key => {
      if (key) {
        const result = await License.validate(key);
        if (!result.valid) {
          await License.clearKey();
          showLicenseGate(body);
        }
      }
    });
    showApp(body);
  }
  // Non-blocking update check
  checkForUpdate();
}

document.getElementById('btn-settings').addEventListener('click', () =>
  chrome.runtime.openOptionsPage());

document.addEventListener('DOMContentLoaded', init);
