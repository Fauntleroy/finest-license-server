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
  // Detect Shopify queue / waiting-room / throttle pages. We must NOT fire
  // auto-checkout on these — repeated submit attempts + failures on queue
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

    // Top-frame guard — supreme-checkout.js runs in all_frames. Any nested
    // frame that also matches the checkout URL pattern would fire its own
    // maybeAutoSubmit; only the top window should attempt to submit.
    if (window.top !== window) {
      console.log('[Finest] Auto-checkout: skipped (running in sub-frame)');
      return;
    }

    // Silent bail on queue/waiting pages — no overlay noise
    if (!isCheckoutPage()) {
      console.log('[Finest] Auto-checkout: skipped (queue / waiting room / non-checkout page)');
      return;
    }

    setStatusOverlay('Auto-checkout armed. Waiting for payment fields to settle...', '#c9a84c');

    const isBtnReady = (btn) => {
      if (!btn) return false;
      if (btn.disabled) return false;
      if (btn.getAttribute('aria-disabled') === 'true') return false;
      if (btn.offsetParent === null) return false;
      return true;
    };

    const findAnyPayBtn = () =>
      document.querySelector('#checkout-pay-button')
      || document.querySelector('[aria-label="process payment"]')
      || document.querySelector('[data-event-name="pay_button_inline"]');

    // Some Supreme checkouts leave the pay button always-enabled and validate
    // at click time. Button-state alone is not a reliable "ready" signal — we
    // must also confirm that the form fields we're supposed to have filled
    // actually contain values.
    const isFormFilled = () => {
      const email = document.querySelector('[autocomplete="email"], [autocomplete="shipping email"], input[type="email"]');
      const fname = document.querySelector('[autocomplete="shipping given-name"], [autocomplete="given-name"], #form_firstName, [name="firstName"], [name="first_name"]');
      const addr  = document.querySelector('[autocomplete="shipping address-line1"], [name="address1"], [placeholder="Address"]');
      const hasVal = (el) => el && typeof el.value === 'string' && el.value.trim().length > 1;
      return hasVal(email) && hasVal(fname) && hasVal(addr);
    };

    // STAGE 1: wait up to 20s for the pay button to exist AND be enabled
    setStatusOverlay('Waiting for pay button to become active...', '#c9a84c');
    const stage1Start = Date.now();
    while (Date.now() - stage1Start < 20000) {
      const btn = findAnyPayBtn();
      if (isBtnReady(btn)) break;
      await delay(250);
    }

    // STAGE 2: stability check — form fields must be populated AND button
    // must stay enabled for 2s continuously. Shopify's React validation runs
    // async; the button can briefly flicker enabled while validation is still
    // cycling, and on some checkouts the button is never disabled at all,
    // so we gate on the form actually containing values.
    setStatusOverlay('Verifying payment form is stable...', '#c9a84c');
    const STABLE_MS = 2000;
    let stableStart = null;
    const stage2Start = Date.now();
    while (Date.now() - stage2Start < 20000) {
      const btn = findAnyPayBtn();
      const ready = isBtnReady(btn) && isFormFilled();
      if (ready) {
        if (stableStart === null) stableStart = Date.now();
        if (Date.now() - stableStart >= STABLE_MS) break;
      } else {
        stableStart = null; // reset — either button flickered or fields empty
      }
      await delay(150);
    }

    // Final gate: bail loudly if the form still isn't filled after all that
    if (!isFormFilled()) {
      setStatusOverlay('❌ Form fields not filled — refusing to click. Complete manually.', '#c06060');
      console.log('[Finest] Auto-checkout: form not filled after stability wait.');
      return;
    }

    const findPayBtn = () => {
      const byId = document.querySelector('#checkout-pay-button');
      if (isBtnReady(byId)) return { el: byId, by: '#checkout-pay-button' };

      const byAria = document.querySelector('[aria-label="process payment"]');
      if (isBtnReady(byAria)) return { el: byAria, by: '[aria-label="process payment"]' };

      const byEvent = document.querySelector('[data-event-name="pay_button_inline"]');
      if (isBtnReady(byEvent)) return { el: byEvent, by: '[data-event-name="pay_button_inline"]' };

      const textBtn = Array.from(document.querySelectorAll('button')).find(b => {
        const t = b.textContent.trim().toLowerCase();
        return isBtnReady(b) && (
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
      setStatusOverlay('❌ Pay button not found within 10s. Click manually to complete.', '#c06060');
      console.log('[Finest] Auto-checkout: pay button not found within 10s.');
      return;
    }

    setStatusOverlay(`Pay button ready (${found.by}). Clicking in 300ms...`, '#e8b04c');
    await delay(200 + Math.random() * 250);

    // Sanity: verify button is still in DOM and clickable right before clicking
    const stillValid = document.contains(found.el) && !found.el.disabled;
    if (!stillValid) {
      setStatusOverlay('⚠ Button became invalid before click. Try manually.', '#c06060');
      return;
    }

    // Robust click: dispatch a full pointer/mouse event sequence so React's
    // synthetic event system picks it up, then call .click(), then fall back to
    // submitting the parent form directly if React handlers swallowed the click.
    fireRealClick(found.el);
    setStatusOverlay('✅ Pay button clicked. Watching for response...', '#7ec98a');
    console.log('[Finest] Auto-checkout: pay button clicked via', found.by);

    await disableAutoCheckoutAfterPurchase(profileKey);
    watchForConfirmation();
  }

  // Multi-method click: maximizes the chance Shopify's React handlers fire.
  // Tries DOM events, native .click(), form.requestSubmit, and finally —
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

    // Focus + Enter key (many checkouts submit on Enter when the pay button
    // or an input inside the form has focus)
    try {
      el.focus();
      const keyOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
      el.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
      el.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
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
        if (!btn) { console.warn('[Finest:main] pay button not found in main world'); return; }

        // Build a real MouseEvent to pass through — some Shopify handlers
        // expect event.nativeEvent to exist.
        const rect = btn.getBoundingClientRect();
        const mkNative = () => new MouseEvent('click', {
          bubbles: true, cancelable: true, view: window,
          clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2,
          button: 0, buttons: 0,
        });
        const mkSynth = (type, target) => {
          const nv = mkNative();
          return {
            type, target, currentTarget: target, nativeEvent: nv,
            bubbles: true, cancelable: true, defaultPrevented: false,
            preventDefault: () => { try { nv.preventDefault(); } catch {} },
            stopPropagation: () => { try { nv.stopPropagation(); } catch {} },
            persist: () => {}, isTrusted: false,
          };
        };

        const HANDLERS_BTN = ['onClick', 'onClickCapture', 'onMouseDown', 'onPointerDown', 'onTap'];
        const HANDLERS_FORM = ['onSubmit', 'onSubmitCapture'];

        const propsKey = Object.keys(btn).find(k => k.startsWith('__reactProps'));
        const fiberKey = Object.keys(btn).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));

        let fired = 0;

        if (propsKey && btn[propsKey]) {
          for (const name of HANDLERS_BTN) {
            const h = btn[propsKey][name];
            if (typeof h === 'function') {
              try { h(mkSynth('click', btn)); fired++; console.log('[Finest:main] fired', name); } catch (e) { console.warn('[Finest:main]', name, 'threw:', e); }
            }
          }
        }

        // Walk up the fiber tree for parent form/button handlers. React
        // component trees are often 20-40 deep on Shopify checkouts.
        if (fiberKey && btn[fiberKey]) {
          let f = btn[fiberKey].return;
          let hops = 0;
          while (f && hops < 40) {
            const ps = f.memoizedProps || f.pendingProps;
            if (ps) {
              for (const name of HANDLERS_FORM) {
                if (typeof ps[name] === 'function') {
                  try { ps[name](mkSynth('submit', f.stateNode || btn)); fired++; console.log('[Finest:main] fired parent', name, 'at hop', hops); } catch (e) { console.warn('[Finest:main] parent', name, 'threw:', e); }
                }
              }
              for (const name of HANDLERS_BTN) {
                if (typeof ps[name] === 'function' && f.stateNode !== btn) {
                  try { ps[name](mkSynth('click', f.stateNode || btn)); fired++; console.log('[Finest:main] fired parent', name, 'at hop', hops); } catch (e) {}
                }
              }
            }
            f = f.return; hops++;
          }
        }

        // Last resort: call the native HTMLButtonElement.click prototype
        try {
          HTMLButtonElement.prototype.click.call(btn);
          console.log('[Finest:main] prototype click invoked');
        } catch (e) { console.warn('[Finest:main] prototype click failed:', e); }

        console.log('[Finest:main] total handlers fired:', fired);
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
    div.innerHTML = `<div style="font-weight:700;margin-bottom:4px">⚡ Finest Auto-Checkout</div><div style="color:#c8bfaa;font-size:11px">${message}</div>`;
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
      <div style="font-weight:700;margin-bottom:6px">✅ Finest — Purchase Submitted</div>
      <div style="color:#c8bfaa;font-size:11px;margin-bottom:8px">
        Auto-checkout has been turned <strong style="color:#7ec98a">OFF</strong> on this profile so you don't accidentally double-buy.
      </div>
      <div style="color:#7a6f56;font-size:10px">
        Re-enable from Dashboard → Profile → Auto-Checkout if you want it on for another order.
      </div>
    `;
    // Auto-dismiss after 30s
    setTimeout(() => { if (div?.parentNode) div.remove(); }, 30000);
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

    // Queue / throttle / waiting-room gate — don't even try to fill until
    // we're on the real checkout page. Filling on the queue page is wasteful
    // and can leave partial state that confuses the fill logic on transition.
    // The SPA observer will re-invoke run() once we transition off the queue.
    if (!isCheckoutPage()) {
      console.log('[Finest] Fill: skipped (queue / waiting room / non-checkout page)');
      return;
    }

    // Wait for a LATE-rendering field (address or firstName). Supreme's React
    // checkout renders progressively — email appears first, then the rest of
    // the form. If we only wait for email, we start filling before name/address
    // exist and silently skip them.
    await waitFor(
      '[autocomplete="shipping address-line1"], [name="address1"], #form_firstName, ' +
      '[autocomplete="given-name"], [autocomplete="shipping given-name"], [name="firstName"], [name="first_name"]',
      15000
    );
    await delay(400);
    await fillSupreme(profile);

    // Verify address actually got filled — if not, wait and retry once
    const addressEl = find(
      '[autocomplete="shipping address-line1"]', '[name="address1"]', '[placeholder="Address"]'
    );
    if (addressEl && !addressEl.value && profile.address) {
      console.log('[Finest] Address empty after first pass — retrying in 800ms');
      await delay(800);
      await fillSupreme(profile);
    }

    await maybeAutoSubmit(profile, data.activeProfile);
  }

  run();

  // SPA transition watcher: Shopify's queue → checkout on Supreme is often an
  // in-page navigation that does NOT re-inject content scripts. Watch for the
  // checkout form to appear (or URL to change to a non-throttle checkout URL)
  // and re-run fill + auto-checkout when it does.
  let lastUrl = location.href;
  let lastRunAt = 0; // 0 so first re-run isn't debounced
  let filling = false;
  const FORM_SELECTOR =
    '#form_firstName, [name="form_firstName"], [autocomplete="shipping address-line1"], [name="address1"]';

  async function maybeReRun(reason) {
    if (filling) { console.log('[Finest] maybeReRun bail (filling):', reason); return; }
    if (Date.now() - lastRunAt < 1500) { console.log('[Finest] maybeReRun bail (debounce):', reason); return; }
    if (window.top !== window) { console.log('[Finest] maybeReRun bail (sub-frame):', reason); return; }
    const email = document.querySelector('[autocomplete="email"], [autocomplete="shipping email"], input[type="email"]');
    const emailFilled = email && typeof email.value === 'string' && email.value.trim().length > 1;
    if (emailFilled) { console.log('[Finest] maybeReRun bail (email already filled):', reason); return; }
    // Do NOT bail on missing form here — run() has its own waitFor and will
    // wait for the form to appear. Bailing here misses the queue→checkout
    // transition where URL flips before the new form renders.
    filling = true;
    lastRunAt = Date.now();
    console.log('[Finest] SPA re-run triggered:', reason);
    try { await run(); } catch (e) { console.warn('[Finest] SPA re-run threw:', e); }
    finally { filling = false; console.log('[Finest] SPA re-run complete:', reason); }
  }

  // Observer watches documentElement (survives body replacement) for URL/form
  // changes. Additionally poll URL every 500ms as a fallback in case Shopify
  // updates the URL without triggering an observable mutation.
  const spaObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      console.log('[Finest] URL changed (observer):', lastUrl, '->', location.href);
      lastUrl = location.href;
      maybeReRun('url-change-observer');
      return;
    }
    if (document.querySelector(FORM_SELECTOR)) {
      maybeReRun('form-appeared');
    }
  });
  const startObserver = () => {
    const root = document.documentElement;
    if (!root) { setTimeout(startObserver, 100); return; }
    spaObserver.observe(root, { childList: true, subtree: true });
  };
  startObserver();

  // Fallback URL poll — catches SPA nav that doesn't mutate the DOM tree
  // rooted at documentElement in a way the observer can detect.
  setInterval(() => {
    if (location.href !== lastUrl) {
      console.log('[Finest] URL changed (poll):', lastUrl, '->', location.href);
      lastUrl = location.href;
      maybeReRun('url-change-poll');
    }
  }, 500);

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
