(async () => {
  try {
    const { activeScripts } = await chrome.storage.local.get('activeScripts');
    if (activeScripts?.supremeShop) { eval(activeScripts.supremeShop); return; }
  } catch {}

/**
 * Finest Checkouts — Supreme Shop Page
 * Targets supremenewyork.com/shop/*
 * Injects a "Quick Fill" indicator and handles the add-to-cart flow awareness.
 */

(function () {
  'use strict';

  if (window.__finestSupremeShop) return;
  window.__finestSupremeShop = true;

  async function run() {
    const data = await chrome.storage.local.get(['profiles', 'activeProfile', 'settings']);
    const settings = data.settings || {};
    const profiles = data.profiles || {};
    const key = data.activeProfile;
    const profile = key && profiles[key] ? profiles[key] : null;

    if (!profile) return;

    // Inject a small status badge so the user knows the extension is active
    const badge = document.createElement('div');
    badge.id = 'finest-badge';
    badge.textContent = `Finest: ${profile.profileName || key}`;
    badge.style.cssText = `
      position: fixed;
      bottom: 16px;
      right: 16px;
      background: #c8102e;
      color: #fff;
      font-family: monospace;
      font-size: 11px;
      padding: 6px 10px;
      border-radius: 4px;
      z-index: 999999;
      pointer-events: none;
      opacity: 0.9;
    `;
    document.body.appendChild(badge);
  }

  if (document.readyState !== 'loading') run();
  else document.addEventListener('DOMContentLoaded', run, { once: true });
})();

})(); // end auto-update wrapper
