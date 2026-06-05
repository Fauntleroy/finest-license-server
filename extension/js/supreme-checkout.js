(async () => {
  try {
    const { activeScripts } = await chrome.storage.local.get('activeScripts');
    if (activeScripts?.supremeCheckout) { eval(activeScripts.supremeCheckout); return; }
  } catch {}

/**
 * Finest Checkouts — Supreme Checkout Autofill
 * Targets us.supreme.com new checkout (Shopify-based)
 * Fields identified by autocomplete attribute
 */

(function () {
  'use strict';

  if (window.__finestSupreme) return;
  window.__finestSupreme = true;

  // US state abbreviation → full name
  // Prevents "CA" being matched to "Canada" in country dropdowns
  const STATE_MAP = {
    'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California',
    'CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia',
    'HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa',
    'KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland',
    'MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri',
    'MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey',
    'NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio',
    'OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina',
    'SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont',
    'VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming',
    'DC':'District of Columbia',
  };


  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const naturalDelay = () => delay(20 + Math.random() * 30);

  // ─── React-safe setter ────────────────────────────────────────────────────
  function reactSet(el, value) {
    if (!el || value == null) return;
    const proto = el.tagName === 'SELECT'
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    // React 18 listens to input + keydown on this checkout — fire those only.
    // Do NOT fire blur/focus here; focusFill handles focus lifecycle natively.
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a', code: 'KeyA' }));
    el.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true, cancelable: true, key: 'a', code: 'KeyA' }));
  }

  async function focusFill(el, value) {
    if (!el || value == null) return;
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    el.focus();
    reactSet(el, value);
    await new Promise(r => setTimeout(r, 30));
    el.blur();
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await naturalDelay();
  }

  function selectOption(el, value) {
    if (!el || !value || !el.options) return;
    const v = value.toLowerCase().trim();
    for (const opt of el.options) {
      if (opt.value.toLowerCase() === v || opt.text.toLowerCase().includes(v)) {
        reactSet(el, opt.value);
        return true;
      }
    }
    return false;
  }

  // ─── Wait for element ─────────────────────────────────────────────────────
  function waitFor(selector, timeout = 10000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) { obs.disconnect(); resolve(found); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
    });
  }

  // ─── Get by autocomplete attribute (Supreme's new checkout uses these) ────
  const ac = (val) => document.querySelector(`[autocomplete="${val}"]`);
  const pl = (val) => document.querySelector(`[placeholder="${val}"]`);
  const nm = (val) => document.querySelector(`[name="${val}"]`);

  // Try multiple selectors, return first match
  function find(...selectors) {
    for (const s of selectors) {
      try {
        const el = document.querySelector(s);
        if (el) return el;
      } catch(e) {}
    }
    return null;
  }

  async function fillSupreme(profile) {
    const [expMonth, expYear] = (profile.expiry || '/').split('/').map(s => s.trim());
    const fullName = `${profile.fName || ''} ${profile.lName || ''}`.trim();

    // ── Contact ──────────────────────────────────────────────────────────────
    await focusFill(
      find('[autocomplete="email"]', '[autocomplete="shipping email"]', 'input[type="email"]', '[name="email"]', '#email'),
      profile.email
    );
    await focusFill(
      find('[autocomplete="given-name"]', '[autocomplete="shipping given-name"]', '[name="firstName"]', '[name="first_name"]', '[placeholder="First name"]'),
      profile.fName
    );
    await focusFill(
      find('[autocomplete="family-name"]', '[autocomplete="shipping family-name"]', '[name="lastName"]', '[name="last_name"]', '[placeholder="Last name"]'),
      profile.lName
    );

    // ── Address ──────────────────────────────────────────────────────────────
    await focusFill(
      find('[autocomplete="shipping address-line1"]', '[name="address1"]', '[placeholder="Address"]'),
      profile.address
    );
    await focusFill(
      find('[autocomplete="shipping address-line2"]', '[name="address2"]', '[placeholder="Apartment, suite, etc."]'),
      profile.address2 || ''
    );
    await focusFill(
      find('[autocomplete="shipping address-level2"]', '[name="city"]', '[placeholder="City"]'),
      profile.city
    );
    await focusFill(
      find('[autocomplete="shipping postal-code"]', '[name="postalCode"]', '[name="zip"]', '[placeholder="Postal code"]'),
      profile.zip
    );
    await focusFill(
      find('[autocomplete="shipping tel"]', '[name="phone"]', '[placeholder="Phone"]'),
      profile.phone
    );

    // Country — only set if explicitly provided and not already correct
    // Never derive country from state abbreviation (CA = California, not Canada)
    const countryEl = find('[autocomplete="shipping country"]', '[name="countryCode"]', '[name="country"]');
    if (countryEl) {
      const countryVal = profile.country || 'United States';
      // Normalize: if profile says "US" or "USA" treat as United States
      const countryNorm = countryVal.toUpperCase();
      const resolvedCountry = (countryNorm === 'US' || countryNorm === 'USA') ? 'United States' : countryVal;
      selectOption(countryEl, resolvedCountry);
      await delay(300);
    }

    // State — use full name lookup so "CA" → "California", never "Canada"
    const stateEl = find('[autocomplete="shipping address-level1"]', '[name="zone"]', '[name="province"]', '[name="state"]');
    if (stateEl) {
      const stateVal = STATE_MAP[profile.state?.toUpperCase()] || profile.state || '';
      if (stateEl.tagName === 'SELECT') selectOption(stateEl, stateVal);
      else await focusFill(stateEl, stateVal);
      await naturalDelay();
    }

    // ── Payment ───────────────────────────────────────────────────────────────
    // CC number/expiry/CVV are in the Shopify PCI iframe — handled by supreme-pci.js
    // Name on card can appear on the main page in some checkout layouts
    const nameOnCardEl = find('[autocomplete="cc-name"]', '[name="name_on_card"]', '[placeholder*="name on card" i]', '[placeholder*="cardholder" i]');
    if (nameOnCardEl) {
      await focusFill(nameOnCardEl, profile.nameOnCard || `${profile.fName} ${profile.lName}`.trim());
    }
  }

  // ─── Auto-checkout (per-profile opt-in) ───────────────────────────────────
  // Profile must have autoCheckout: true. After fillSupreme + a settle delay,
  // wait for the PCI iframe(s) to finish filling, then click the pay button.
  // After a successful submit, auto-disables the toggle so it doesn't fire on
  // a second checkout in the same session.
  async function maybeAutoSubmit(profile, profileKey) {
    if (!profile?.autoCheckout) return;

    // Give the PCI iframes ~2.5s to finish filling card/expiry/CVV
    await delay(2500);

    // Find the pay button. Primary: Supreme's stable #checkout-pay-button id.
    // Fallbacks for any layout variants.
    const findPayBtn = () => {
      const byId = document.querySelector('#checkout-pay-button');
      if (byId && !byId.disabled && byId.offsetParent !== null) return byId;

      const byAria = document.querySelector('[aria-label="process payment"]');
      if (byAria && !byAria.disabled && byAria.offsetParent !== null) return byAria;

      const byEvent = document.querySelector('[data-event-name="pay_button_inline"]');
      if (byEvent && !byEvent.disabled && byEvent.offsetParent !== null) return byEvent;

      // Last-resort text match
      return Array.from(document.querySelectorAll('button')).find(b => {
        const t = b.textContent.trim().toLowerCase();
        return !b.disabled && b.offsetParent !== null && (
          t === 'pay now' || t === 'place order' || t === 'complete order' ||
          t.includes('pay now') || t.includes('place order')
        );
      });
    };

    // Wait up to 10s for the button to be present + enabled
    const start = Date.now();
    let btn = null;
    while (Date.now() - start < 10000) {
      btn = findPayBtn();
      if (btn) break;
      await delay(250);
    }

    if (!btn) {
      console.log('[Finest] Auto-checkout: pay button not found within 10s.');
      return;
    }

    // Small natural delay so we don't fire on the same animation frame as the fill
    await delay(150 + Math.random() * 200);
    btn.click();
    console.log('[Finest] Auto-checkout: pay button clicked.');

    // Safety: disable autoCheckout immediately so any subsequent checkout in
    // this session won't auto-submit until the user explicitly re-enables it.
    await disableAutoCheckoutAfterPurchase(profileKey);

    // Watch for the order confirmation page and show a popup overlay if we land
    // there. If not, the order may have failed — we already disabled, so the
    // user can decide what to do.
    watchForConfirmation();
  }

  async function disableAutoCheckoutAfterPurchase(profileKey) {
    try {
      const { profiles, activeProfile } = await chrome.storage.local.get(['profiles', 'activeProfile']);
      const key = profileKey || activeProfile;
      if (!profiles || !key || !profiles[key]) return;
      profiles[key].autoCheckout = false;
      await chrome.storage.local.set({ profiles });
      console.log('[Finest] Auto-checkout disabled for profile:', key);
    } catch (e) {
      console.warn('[Finest] Could not disable autoCheckout:', e);
    }
  }

  function watchForConfirmation() {
    const SUCCESS_RE = /\/(thank[_-]?you|order[_-]?confirmation|orders\/\w+|checkout\/[a-z0-9]+\/post-purchase)/i;
    let lastUrl = location.href;

    function isSuccessUrl() { return SUCCESS_RE.test(location.pathname); }

    if (isSuccessUrl()) { showPurchaseOverlay(); return; }

    const poll = setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (isSuccessUrl()) {
          clearInterval(poll);
          showPurchaseOverlay();
        }
      }
    }, 400);

    // Stop watching after 60s either way
    setTimeout(() => clearInterval(poll), 60000);
  }

  function showPurchaseOverlay() {
    if (document.getElementById('finest-purchase-overlay')) return;
    const div = document.createElement('div');
    div.id = 'finest-purchase-overlay';
    div.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 999999;
      background: #080808; color: #c9a84c;
      padding: 14px 18px; border: 1px solid #7a5e1e; border-radius: 6px;
      font-family: monospace; font-size: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      max-width: 320px; line-height: 1.5;
    `;
    div.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px">⚡ Finest — Purchase Submitted</div>
      <div style="color:#c8bfaa;font-size:11px;margin-bottom:8px">
        Auto-checkout has been turned <strong style="color:#7ec98a">OFF</strong> on this profile so you don't accidentally double-buy.
      </div>
      <div style="color:#7a6f56;font-size:10px">
        Re-enable from Dashboard → Profile → Auto-Checkout if you want it on for another order.
      </div>
    `;
    document.body.appendChild(div);
    // Auto-dismiss after 30s
    setTimeout(() => div.remove(), 30000);
  }

  // ─── Run ──────────────────────────────────────────────────────────────────
  async function isLicensed() {
    const d = await chrome.storage.local.get(['licenseKey', 'licenseValid']);
    return !!(d.licenseKey && d.licenseValid);
  }

  async function run() {
    if (!(await isLicensed())) return;
    const data = await chrome.storage.local.get(['settings', 'profiles', 'activeProfile']);
    if (!data.settings?.autoFill) return;
    const profile = data.profiles?.[data.activeProfile] ?? null;
    if (!profile) return;
    // Wait for email field then small settle delay before filling
    await waitFor('[autocomplete="email"], [autocomplete="shipping email"], input[type="email"], [name="email"], #email');
    await delay(300);
    await fillSupreme(profile);
    await maybeAutoSubmit(profile, data.activeProfile);
  }

  run();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'FILL_FORM' && msg.profile) {
      (async () => {
        if (!(await isLicensed())) { sendResponse({ ok: false, error: 'unlicensed' }); return; }
        await fillSupreme(msg.profile);
        await maybeAutoSubmit(msg.profile);
        sendResponse({ ok: true });
      })();
      return true;
    }
  });
})();

})(); // end auto-update wrapper
