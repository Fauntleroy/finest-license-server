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
    if (!el || !value) return;
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

  // â”€â”€â”€ Run â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function run() {
    const data = await chrome.storage.local.get(['settings', 'profiles', 'activeProfile']);
    if (!data.settings?.autoFill) return;
    const profile = data.profiles?.[data.activeProfile] ?? null;
    if (!profile) return;
    // Wait for email field then small settle delay before filling
    await waitFor('[autocomplete="email"], [autocomplete="shipping email"], input[type="email"], [name="email"], #email');
    await delay(300);
    await fillSupreme(profile);
  }

  run();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'FILL_FORM' && msg.profile) {
      fillSupreme(msg.profile).then(() => sendResponse({ ok: true }));
      return true;
    }
  });
})();
