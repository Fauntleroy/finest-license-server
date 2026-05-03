/**
 * Finest Checkouts â€” Adyen Secured Fields Filler
 * Runs inside checkoutshopper-live-us.adyen.com iframes
 * Fills card number, expiry, CVV fields for Adyen-powered checkouts
 */

(function () {
  'use strict';

  if (window.__finestAdyen) return;
  window.__finestAdyen = true;

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // Simple native fill â€” matches the approach that was working via aio.js
  // Uses generic Events (not InputEvent) which Adyen's field handler accepts
  function nativeFill(el, value) {
    if (!el || value == null) return;
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    el.focus();
    if (proto && proto.set) proto.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }

  const SEL = {
    CC:     '[data-fieldtype="encryptedCardNumber"], [autocomplete="cc-number"]',
    expiry: '[data-fieldtype="encryptedExpiryDate"], [autocomplete="cc-exp"]',
    cvv:    '[data-fieldtype="encryptedSecurityCode"], [autocomplete="cc-csc"]',
  };

  function waitFor(selector, timeout = 8000) {
    return new Promise(resolve => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) { obs.disconnect(); resolve(found); }
      });
      obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
    });
  }

  function fill(profile) {
    if (!profile) return;
    // In Adyen's per-field iframes, each frame has exactly one field â€”
    // use querySelector directly (no timeout waste waiting for absent fields)
    const ccEl  = document.querySelector(SEL.CC);
    const expEl = document.querySelector(SEL.expiry);
    const cvvEl = document.querySelector(SEL.cvv);
    if (ccEl)  nativeFill(ccEl,  profile.CC?.replace(/\s/g, ''));
    if (expEl) nativeFill(expEl, profile.expiry);
    if (cvvEl) nativeFill(cvvEl, profile.cvv);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'FILL_FORM' && msg.profile) {
      fill(msg.profile).then(() => sendResponse({ ok: true }));
      return true;
    }
  });

  async function autoFillWhenReady() {
    const data = await chrome.storage.local.get(['settings', 'profiles', 'activeProfile']);
    if (!data.settings?.autoFill) return;
    const profile = data.profiles?.[data.activeProfile] ?? null;
    if (!profile) return;
    await waitFor(`${SEL.CC}, ${SEL.expiry}, ${SEL.cvv}`, 8000);
    await delay(600);
    await fill(profile);
  }

  autoFillWhenReady();

})();
