/**
 * Finest Checkouts â€” Worldpay / Vantiv eProtect Filler
 * Runs inside request.eprotect.vantivcnp.com iframes
 * Fills card number, expiry, CVV for Finish Line checkout
 */

(function () {
  'use strict';

  if (window.__finestVantiv) return;
  window.__finestVantiv = true;

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // Generic events â€” matches what the eProtect field handlers listen for
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
    CC:     '#accountNumber, [name="accountNumber"]',
    expiry: '#expiry, [name="expiry"], [name="expDate"], [autocomplete="cc-exp"]',
    cvv:    '#cardValidationNum, [name="cardValidationNum"], #cvv, [name="cvv"], [autocomplete="cc-csc"]',
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
    const ccEl  = document.querySelector(SEL.CC);
    const expEl = document.querySelector(SEL.expiry);
    const cvvEl = document.querySelector(SEL.cvv);
    if (ccEl)  nativeFill(ccEl,  profile.CC?.replace(/\s/g, ''));
    if (expEl) nativeFill(expEl, profile.expiry);
    if (cvvEl) nativeFill(cvvEl, profile.cvv);
  }

  // Receives manual fill from popup (tabs.sendMessage broadcasts to all frames)
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'FILL_FORM' && msg.profile) {
      fill(msg.profile);
      sendResponse({ ok: true });
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
    fill(profile);
  }

  autoFillWhenReady();

})();
