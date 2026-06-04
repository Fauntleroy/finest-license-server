(async () => {
  try {
    const { activeScripts } = await chrome.storage.local.get('activeScripts');
    if (activeScripts?.waitwhile) { eval(activeScripts.waitwhile); return; }
  } catch {}

/**
 * Finest Checkouts — Waitwhile Auto-Booking
 * Full hands-free Supreme waitlist registration with auto-retry.
 *
 * Flow:
 *   1. /accounts/[business]        → click preferred store
 *   2. /locations/[store]          → click earliest time slot
 *   3. /locations/[store]/details  → fill form + click "Schedule booking"
 *   4. /locations/[store]/closed   → STOP (registration over)
 *   5. /visits/* or /status        → STOP (booked successfully)
 *   On any error → navigate back to /accounts/supremenewyork and retry.
 */

(function () {
  'use strict';

  if (window.__finestWaitwhile) return;
  window.__finestWaitwhile = true;

  const SUPREME_ACCOUNT_URL = 'https://waitwhile.com/accounts/supremenewyork?ww-ref=directory';

  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const naturalDelay = () => delay(80 + Math.random() * 120);

  async function waitUntil(predicate, timeout = 15000, pollMs = 200) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = predicate();
      if (result) return result;
      await delay(pollMs);
    }
    return null;
  }

  function nativeSet(el, value) {
    if (!el) return;
    const proto = el.tagName === 'SELECT'
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function fillField(el, value) {
    if (!el || !value) return;
    el.focus();
    nativeSet(el, value);
    el.blur();
    await naturalDelay();
  }

  // ─── Persistent overlay with Stop button ───────────────────────────────────
  function setOverlay(message, color) {
    let div = document.getElementById('finest-wwpp-overlay');
    if (!div) {
      div = document.createElement('div');
      div.id = 'finest-wwpp-overlay';
      div.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 999999;
        background: #080808; padding: 12px 16px;
        border-radius: 6px;
        font-family: monospace; font-size: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        display: flex; align-items: center; gap: 10px;
        max-width: 360px;
      `;
      document.body.appendChild(div);
    }
    const c = color || '#c9a84c';
    div.style.color = c;
    div.style.border = '1px solid ' + c;
    div.innerHTML = `
      <span style="flex:1">⚡ Finest: ${message}</span>
      <button id="finest-wwpp-stop"
        style="background:#2a0a0a;border:1px solid #c06060;color:#c06060;
               padding:4px 10px;border-radius:3px;cursor:pointer;
               font-family:monospace;font-size:11px;white-space:nowrap">Stop</button>
    `;
    document.getElementById('finest-wwpp-stop').onclick = async () => {
      await chrome.storage.local.set({ waitwhileStopped: true });
      div.innerHTML = '<span style="color:#888">⚡ Finest: Stopped. Toggle setting off/on to resume.</span>';
    };
  }

  function clearOverlay() {
    const div = document.getElementById('finest-wwpp-overlay');
    if (div) div.remove();
  }

  // ─── Detection helpers ──────────────────────────────────────────────────────

  // Looks for any visible error/warning text from Waitwhile's known patterns
  function hasError() {
    const errorText = document.body.innerText.toLowerCase();
    return errorText.includes('selected time is full')
        || errorText.includes('no available slots')
        || errorText.includes('no available spots')
        || errorText.includes('location too busy')
        || errorText.includes('gave up after')
        || errorText.includes('waitlist is full')
        || errorText.includes('try again later');
  }

  function isSuccessPath(path) {
    return path.includes('/visits/')
        || path.includes('/status')
        || path.includes('/confirmation');
  }

  // ─── Restart back to account picker ─────────────────────────────────────────
  async function restart(reason) {
    setOverlay(`${reason} — retrying...`, '#e8b04c');
    await delay(800 + Math.random() * 400);
    if (await isStopped()) return;
    location.href = SUPREME_ACCOUNT_URL;
  }

  async function isStopped() {
    const d = await chrome.storage.local.get('waitwhileStopped');
    return !!d.waitwhileStopped;
  }

  // ─── Page handlers ──────────────────────────────────────────────────────────

  // /accounts/[business] — click the configured preferred store
  async function handleAccountPage(store) {
    setOverlay(`Looking for ${store}...`);
    const link = await waitUntil(
      () => document.querySelector(`a[href*="/locations/${store}"]`),
      10000
    );
    if (!link) {
      await restart('Store not found');
      return;
    }
    await naturalDelay();
    link.click();
  }

  // /locations/[store] — click first (earliest) available time slot
  async function handleLocationPage() {
    setOverlay('Looking for time slots...');
    const TIME_RE = /^\d{1,2}:\d{2}\s*(AM|PM)$/i;

    const slot = await waitUntil(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(b => TIME_RE.test(b.textContent.trim()) && !b.disabled);
    }, 8000);

    if (!slot) {
      await restart('No slots');
      return;
    }
    setOverlay(`Grabbing ${slot.textContent.trim()}...`);
    await naturalDelay();
    slot.click();

    // Confirm we moved on — if we stay on the location page with no progress
    // for 5s, the click probably failed (slot filled). Retry.
    await delay(5000);
    if (location.pathname.startsWith('/locations/') && !location.pathname.includes('/details')) {
      if (hasError()) {
        await restart('Slot filled');
      }
    }
  }

  // /locations/[store]/details — fill name/email/phone + submit
  async function handleDetailsPage(profile) {
    setOverlay('Filling details...');

    // Wait for form fields to be present AND enabled
    const firstName = await waitUntil(() => {
      const el = document.querySelector('#form_firstName, [name="form_firstName"]');
      return (el && !el.disabled) ? el : null;
    }, 15000);

    if (!firstName) {
      await restart('Form did not load');
      return;
    }

    await fillField(firstName, profile.fName);
    await fillField(document.querySelector('#form_lastName, [name="form_lastName"]'), profile.lName);
    await fillField(document.querySelector('#form_phone,    [name="form_phone"]'),    profile.phone);
    await fillField(document.querySelector('#form_email,    [name="form_email"]'),    profile.email);

    await delay(200);
    const submitBtn = await waitUntil(() => {
      return Array.from(document.querySelectorAll('button')).find(b => {
        const t = b.textContent.trim().toLowerCase();
        return (t.includes('schedule booking') || t.includes('join the line')) && !b.disabled;
      });
    }, 5000);

    if (!submitBtn) {
      await restart('Submit button never enabled');
      return;
    }

    setOverlay('Submitting booking...');
    await naturalDelay();
    submitBtn.click();

    // Watch for outcome over the next 10s — success path or error message
    const outcome = await waitUntil(() => {
      if (isSuccessPath(location.pathname)) return 'success';
      if (hasError()) return 'error';
      return null;
    }, 10000);

    if (outcome === 'success') {
      setOverlay('Booking confirmed! ✓', '#7ec98a');
    } else if (outcome === 'error') {
      await restart('Booking rejected');
    } else {
      // Timed out without clear outcome — restart to be safe
      await restart('No response');
    }
  }

  function handleClosedPage() {
    setOverlay('Registration closed for this store. You got fucked. Better luck next drop.', '#c06060');
    // STOP — set stopped flag so we don't keep navigating
    chrome.storage.local.set({ waitwhileStopped: true });
  }

  function handleSuccessPage() {
    setOverlay('Booking confirmed! ✓', '#7ec98a');
    chrome.storage.local.set({ waitwhileStopped: true });
  }

  // ─── Router ─────────────────────────────────────────────────────────────────
  async function route() {
    const data = await chrome.storage.local.get(['settings', 'profiles', 'activeProfile', 'waitwhileStopped']);
    if (!data.settings?.waitlistAutoBook) { clearOverlay(); return; }
    if (data.waitwhileStopped) return; // user hit Stop or we hit closed/success
    const profile = data.profiles?.[data.activeProfile];
    if (!profile) { setOverlay('No active profile set', '#c06060'); return; }
    const store = data.settings.waitlistStore;
    if (!store) { setOverlay('No preferred store selected', '#c06060'); return; }

    const path = location.pathname;

    if (path.includes('/closed')) {
      handleClosedPage();
    } else if (isSuccessPath(path)) {
      handleSuccessPage();
    } else if (path.startsWith('/accounts/')) {
      await handleAccountPage(store);
    } else if (path.includes('/details')) {
      await handleDetailsPage(profile);
    } else if (path.startsWith('/locations/')) {
      await handleLocationPage();
    }
  }

  route();

  // SPA navigation watcher
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      route();
    }
  }, 400);
})();

})(); // end auto-update wrapper
