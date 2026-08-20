/**
 * Finest Checkouts â€” Supreme Checkout Autofill
 * Targets us.supreme.com new checkout (Shopify-based)
 * Fields identified by autocomplete attribute
 */

(function () {
  'use strict';

  if (window.__finestSupreme) return;
  window.__finestSupreme = true;

  // US state abbreviation â†’ full name
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

  // â”€â”€â”€ React-safe setter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function reactSet(el, value) {
    if (!el || value == null) return;
    const proto = el.tagName === 'SELECT'
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    // React 18 listens to input + keydown on this checkout â€” fire those only.
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

  // â”€â”€â”€ Wait for element â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€â”€ Get by autocomplete attribute (Supreme's new checkout uses these) â”€â”€â”€â”€
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

    // â”€â”€ Contact â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ Address â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // Country â€” only set if explicitly provided and not already correct
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

    // State â€” use full name lookup so "CA" â†’ "California", never "Canada"
    const stateEl = find('[autocomplete="shipping address-level1"]', '[name="zone"]', '[name="province"]', '[name="state"]');
    if (stateEl) {
      const stateVal = STATE_MAP[profile.state?.toUpperCase()] || profile.state || '';
      if (stateEl.tagName === 'SELECT') selectOption(stateEl, stateVal);
      else await focusFill(stateEl, stateVal);
      await naturalDelay();
    }

    // â”€â”€ Payment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // CC number/expiry/CVV are in the Shopify PCI iframe â€” handled by supreme-pci.js
    // Name on card can appear on the main page in some checkout layouts
    const nameOnCardEl = find('[autocomplete="cc-name"]', '[name="name_on_card"]', '[placeholder*="name on card" i]', '[placeholder*="cardholder" i]');
    if (nameOnCardEl) {
      await focusFill(nameOnCardEl, profile.nameOnCard || `${profile.fName} ${profile.lName}`.trim());
    }
  }

  // â”€â”€â”€ Auto-checkout (per-profile opt-in) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Profile must have autoCheckout: true. After fillSupreme + a settle delay,
  // wait for the PCI iframe(s) to finish filling, then click the pay button.
  // After a successful submit, auto-disables the toggle so it doesn't fire on
  // a second checkout in the same session.
  // Detect Shopify queue / waiting-room / throttle pages. We must NOT fire
  // auto-checkout on these â€” repeated submit attempts + failures on queue
  // pages contribute to fraud-detection scoring and can get the user's IP
  // throttled by Cloudflare / Shopify.
  function isCheckoutPage() {
    const path = location.pathname.toLowerCase();
    if (path.includes('queue') || path.includes('throttle') || path.includes('waiting')) return false;

    // Body-text sniff for queue-style messaging
    const body = (document.body?.innerText || '').toLowerCase();
    const queueSignals = [
      "you're in line", "you are in line", "waiting room", "been placed in line",
      "high traffic", "in the queue", "your place in line", "waiting to enter",
    ];
    if (queueSignals.some(s => body.includes(s))) return false;

    // Positive signal: standard Supreme/Shopify checkout form present
    const hasCheckoutForm = !!document.querySelector(
      '#form_firstName, [name="form_firstName"], [autocomplete="shipping address-line1"], [name="address1"], #checkout-pay-button, [aria-label="process payment"]'
    );
    return hasCheckoutForm;
  }

  async function maybeAutoSubmit(profile, profileKey) {
    if (!profile?.autoCheckout) return;

    // Silent bail on queue/waiting pages â€” no overlay noise
    if (!isCheckoutPage()) {
      console.log('[Finest] Auto-checkout: skipped (queue / waiting room / non-checkout page)');
      return;
    }

    setStatusOverlay('Auto-checkout armed. Waiting for payment fields to settle...', '#c9a84c');
    // Wait for fill to actually complete â€” poll for either the email field
    // having a value OR the pay button becoming enabled (either signals the
    // form is populated and Shopify has validated).
    const fillStart = Date.now();
    while (Date.now() - fillStart < 5000) {
      const email = document.querySelector('[autocomplete="email"], [autocomplete="shipping email"], input[type="email"]');
      const payBtn = document.querySelector('#checkout-pay-button, [aria-label="process payment"]');
      const emailFilled = email && email.value && email.value.length > 3;
      const btnEnabled  = payBtn && !payBtn.disabled;
      if (emailFilled || btnEnabled) break;
      await delay(200);
    }
    // Small extra settle so the PCI iframe can also finish
    await delay(1000);

    const findPayBtn = () => {
      const byId = document.querySelector('#checkout-pay-button');
      if (byId && !byId.disabled && byId.offsetParent !== null) return { el: byId, by: '#checkout-pay-button' };

      const byAria = document.querySelector('[aria-label="process payment"]');
      if (byAria && !byAria.disabled && byAria.offsetParent !== null) return { el: byAria, by: '[aria-label="process payment"]' };

      const byEvent = document.querySelector('[data-event-name="pay_button_inline"]');
      if (byEvent && !byEvent.disabled && byEvent.offsetParent !== null) return { el: byEvent, by: '[data-event-name="pay_button_inline"]' };

      const textBtn = Array.from(document.querySelectorAll('button')).find(b => {
        const t = b.textContent.trim().toLowerCase();
        return !b.disabled && b.offsetParent !== null && (
          t === 'pay now' || t === 'place order' || t === 'complete order' ||
          t.includes('pay now') || t.includes('place order')
        );
      });
      return textBtn ? { el: textBtn, by: 'text match' } : null;
    };

    setStatusOverlay('Looking for pay button...', '#c9a84c');
    const start = Date.now();
    let found = null;
    while (Date.now() - start < 10000) {
      found = findPayBtn();
      if (found) break;
      await delay(250);
    }

    if (!found) {
      setStatusOverlay('âŒ Pay button not found within 10s. Click manually to complete.', '#c06060');
      console.log('[Finest] Auto-checkout: pay button not found within 10s.');
      return;
    }

    setStatusOverlay(`Pay button found via ${found.by}. Clicking in 200ms...`, '#e8b04c');
    await delay(150 + Math.random() * 200);

    // Sanity: verify button is still in DOM and clickable right before clicking
    const stillValid = document.contains(found.el) && !found.el.disabled;
    if (!stillValid) {
      setStatusOverlay('âš  Button became invalid before click. Try manually.', '#c06060');
      return;
    }

    // Robust click: dispatch a full pointer/mouse event sequence so React's
    // synthetic event system picks it up, then call .click(), then fall back to
    // submitting the parent form directly if React handlers swallowed the click.
    fireRealClick(found.el);
    setStatusOverlay('âœ… Pay button clicked. Watching for response...', '#7ec98a');
    console.log('[Finest] Auto-checkout: pay button clicked via', found.by);

    await disableAutoCheckoutAfterPurchase(profileKey);
    watchForConfirmation();
  }

  // Multi-method click: maximizes the chance Shopify's React handlers fire.
  // Tries DOM events, native .click(), form.requestSubmit, and finally â€”
  // injects a script into the page's MAIN world to call React's onClick directly.
  function fireRealClick(el) {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch {}

    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, buttons: 1, view: window,
    };

    // Pointer + mouse event sequence
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true }));
      el.dispatchEvent(new PointerEvent('pointerup',   { ...opts, pointerType: 'mouse', isPrimary: true, buttons: 0 }));
    } catch {}
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup',   { ...opts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click',     { ...opts, buttons: 0 }));

    try { el.click(); } catch {}

    try {
      const form = el.closest('form');
      if (form && typeof form.requestSubmit === 'function') form.requestSubmit(el);
    } catch {}

    // NUCLEAR FALLBACK: inject a script that runs in the page's main world.
    // From there it can find React's fiber properties and call onClick directly,
    // bypassing any isTrusted check in the synthetic event path.
    try {
      const s = document.createElement('script');
      s.textContent = `(() => {
        const btn = document.querySelector('#checkout-pay-button')
          || document.querySelector('[aria-label="process payment"]')
          || document.querySelector('[data-event-name="pay_button_inline"]');
        if (!btn) return;
        // Find React's internal props key â€” it changes per React version
        const propsKey = Object.keys(btn).find(k => k.startsWith('__reactProps'));
        const fiberKey = Object.keys(btn).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
        if (propsKey && btn[propsKey]) {
          const p = btn[propsKey];
          // Try the common handler names
          const handler = p.onClick || p.onTap || p.onSubmit;
          if (typeof handler === 'function') {
            try { handler({ preventDefault: () => {}, stopPropagation: () => {}, currentTarget: btn, target: btn, type: 'click' }); } catch (e) { console.warn('[Finest:main] handler threw:', e); }
          }
        }
        // Also walk up the fiber tree for parent onSubmit (form-level handler)
        if (fiberKey && btn[fiberKey]) {
          let f = btn[fiberKey].return;
          let hops = 0;
          while (f && hops < 8) {
            const ps = f.memoizedProps || f.pendingProps;
            if (ps && typeof ps.onSubmit === 'function') {
              try { ps.onSubmit({ preventDefault: () => {}, stopPropagation: () => {}, currentTarget: f.stateNode, target: btn, type: 'submit' }); break; } catch (e) {}
            }
            f = f.return; hops++;
          }
        }
      })();`;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) {
      console.warn('[Finest] React handler injection failed:', e);
    }
  }

  // Persistent on-page status overlay so the user can see auto-checkout progress
  function setStatusOverlay(message, color) {
    let div = document.getElementById('finest-checkout-status');
    if (!div) {
      div = document.createElement('div');
      div.id = 'finest-checkout-status';
      div.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 999999;
        background: #080808; padding: 12px 16px;
        border-radius: 6px; font-family: monospace; font-size: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        max-width: 320px; line-height: 1.5;
        transition: border-color 0.2s, color 0.2s;
      `;
      document.body.appendChild(div);
    }
    const c = color || '#c9a84c';
    div.style.border = '1px solid ' + c;
    div.style.color = c;
    div.innerHTML = `<div style="font-weight:700;margin-bottom:4px">âš¡ Finest Auto-Checkout</div><div style="color:#c8bfaa;font-size:11px">${message}</div>`;
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
    // Reuse the status overlay element if it exists, otherwise create
    let div = document.getElementById('finest-checkout-status');
    if (!div) {
      div = document.createElement('div');
      div.id = 'finest-checkout-status';
      div.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 999999;
        background: #080808; padding: 14px 18px; border-radius: 6px;
        font-family: monospace; font-size: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        max-width: 320px; line-height: 1.5;
      `;
      document.body.appendChild(div);
    }
    div.style.border = '1px solid #7ec98a';
    div.style.color = '#7ec98a';
    div.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px">âœ… Finest â€” Purchase Submitted</div>
      <div style="color:#c8bfaa;font-size:11px;margin-bottom:8px">
        Auto-checkout has been turned <strong style="color:#7ec98a">OFF</strong> on this profile so you don't accidentally double-buy.
      </div>
      <div style="color:#7a6f56;font-size:10px">
        Re-enable from Dashboard â†’ Profile â†’ Auto-Checkout if you want it on for another order.
      </div>
    `;
    // Auto-dismiss after 30s
    setTimeout(() => { if (div?.parentNode) div.remove(); }, 30000);
  }

  // â”€â”€â”€ Run â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

