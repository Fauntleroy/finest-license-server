(async () => {
  try {
    const { activeScripts } = await chrome.storage.local.get('activeScripts');
    if (activeScripts?.supremePci) { eval(activeScripts.supremePci); return; }
  } catch {}

/**
 * Finest Checkouts — Shopify PCI Frame Filler
 * Runs inside checkout.pci.shopifyinc.com iframes
 * Fills card number, expiry, CVV fields
 */

(function () {
  'use strict';

  if (window.__finestPCI) return;
  window.__finestPCI = true;

  function reactFill(el, value) {
    if (!el || value == null) return;
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    el.focus();
    if (proto && proto.set) proto.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new InputEvent('input',  { bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a', code: 'KeyA' }));
    el.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true, cancelable: true, key: 'a', code: 'KeyA' }));
    el.blur();
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  // Simulate a paste — copy-paste is accepted by the CC field so we replicate it
  function pasteFill(el, value) {
    if (!el || value == null) return;
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', value);
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    // Also set via native setter + input as fallback in case paste handler doesn't update DOM
    if (proto && proto.set) proto.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertFromPaste' }));
    el.blur();
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  // Determine which field this iframe is for based on URL
  const url = window.location.href;

  const SEL = {
    CC:         '#number, [name="number"], [autocomplete="cc-number"], [placeholder*="Card number" i], [placeholder*="card no" i], [data-testid*="number"]',
    expiry:     '#expiry, [name="expiry"], [autocomplete="cc-exp"], [placeholder*="MM" i], [placeholder*="expir" i], [data-testid*="expiry"]',
    cvv:        '#verification_value, [name="verification_value"], [autocomplete="cc-csc"], [name="cvv"], [placeholder*="CVV" i], [placeholder*="CVC" i], [placeholder*="security code" i], [data-testid*="verification"], [data-testid*="cvv"]',
    nameOnCard: '[autocomplete="cc-name"], [name="name_on_card"], [name="name"], [placeholder*="name on card" i], [placeholder*="cardholder" i], [data-testid*="name"]',
  };

  function getField() {
    if (url.includes('number'))  return { selector: SEL.CC,         key: 'CC' };
    if (url.includes('expiry'))  return { selector: SEL.expiry,     key: 'expiry' };
    if (url.includes('verification_value') || url.includes('cvv')) return { selector: SEL.cvv, key: 'cvv' };
    if (url.includes('name'))    return { selector: SEL.nameOnCard, key: 'nameOnCard' };
    // fallback — try all
    return null;
  }

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

  async function fill(profile) {
    if (!profile) return;

    const fieldInfo = getField();

    if (fieldInfo) {
      const el = await waitFor(fieldInfo.selector);
      if (el) {
        let value = profile[fieldInfo.key];
        if (fieldInfo.key === 'CC') {
          pasteFill(el, value?.replace(/\s/g, ''));
        } else {
          reactFill(el, value);
        }
      }
    } else {
      // Try to fill all CC fields if we can't determine from URL
      const ccEl   = await waitFor(SEL.CC,         2000);
      const expEl  = await waitFor(SEL.expiry,     2000);
      const cvvEl  = await waitFor(SEL.cvv,        2000);
      const nameEl = await waitFor(SEL.nameOnCard, 2000);
      if (ccEl)   pasteFill(ccEl,   profile.CC?.replace(/\s/g, ''));
      if (expEl)  reactFill(expEl,  profile.expiry);
      if (cvvEl)  reactFill(cvvEl,  profile.cvv);
      if (nameEl) reactFill(nameEl, profile.nameOnCard || `${profile.fName} ${profile.lName}`.trim());
    }
  }

  // Listen for fill message from parent page
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'FILL_FORM' && msg.profile) {
      fill(msg.profile).then(() => sendResponse({ ok: true }));
      return true;
    }
  });

  // Auto-fill if enabled
  async function maybeAutoFill() {
    const data = await chrome.storage.local.get(['settings', 'profiles', 'activeProfile']);
    if (!data.settings?.autoFill) return;
    const profile = data.profiles?.[data.activeProfile] ?? null;
    if (profile) await fill(profile);
  }

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // Wait for the field to actually appear in the DOM then auto-fill
  async function autoFillWhenReady() {
    const data = await chrome.storage.local.get(['settings', 'profiles', 'activeProfile']);
    if (!data.settings?.autoFill) return;
    const profile = data.profiles?.[data.activeProfile] ?? null;
    if (!profile) return;
    // Wait for whichever field this iframe contains
    const fieldInfo = getField();
    const selector = fieldInfo
      ? fieldInfo.selector
      : `${SEL.CC}, ${SEL.expiry}, ${SEL.cvv}, ${SEL.nameOnCard}`;
    await waitFor(selector, 8000);
    // Small settle delay so we don't grab focus mid-click when checkout page loads
    await delay(600);
    await fill(profile);
  }

  autoFillWhenReady();

})();

})(); // end auto-update wrapper
