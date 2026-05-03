/**
 * Finest Checkouts â€” Shopify Checkout Autofill
 */

(function () {
  'use strict';

  if (window.__finestShopify) return;
  window.__finestShopify = true;

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

  // Resolve state abbrev to full name so "CA" never matches "Canada"
  function resolveState(val) {
    if (!val) return '';
    return STATE_MAP[val.toUpperCase()] || val;
  }

  // Resolve country â€” "US"/"USA" â†’ "United States"
  function resolveCountry(val) {
    if (!val) return 'United States';
    const v = val.toUpperCase().trim();
    if (v === 'US' || v === 'USA') return 'United States';
    return val;
  }


  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const naturalDelay = () => delay(20 + Math.random() * 30);

  function reactSet(el, value) {
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

  async function focusFill(el, value) {
    if (!el || !value) return;
    el.focus();
    reactSet(el, value);
    el.blur();
    await naturalDelay();
  }

  function selectOption(el, value) {
    if (!el || !value) return;
    const v = value.toLowerCase().trim();
    for (const opt of el.options) {
      if (opt.value.toLowerCase() === v || opt.text.toLowerCase().includes(v)) {
        reactSet(el, opt.value);
        return;
      }
    }
  }

  function waitFor(selector, timeout = 8000) {
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

  // Shipping selectors
  const SEL = {
    email:    '[name="checkout[email]"], #checkout_email, [data-testid="email-input"] input',
    fName:    '#checkout_shipping_address_first_name, [name*="first_name"]',
    lName:    '#checkout_shipping_address_last_name,  [name*="last_name"]',
    address:  '#checkout_shipping_address_address1,   [name*="address1"]',
    address2: '#checkout_shipping_address_address2,   [name*="address2"]',
    city:     '#checkout_shipping_address_city,       [name*="city"]',
    country:  '#checkout_shipping_address_country,    [name*="country"]',
    state:    '#checkout_shipping_address_province,   [name*="province"]',
    zip:      '#checkout_shipping_address_zip,        [name*="zip"]',
    phone:    '#checkout_shipping_address_phone,      [name*="phone"]',
  };

  // Payment selectors â€” matches by name, id, placeholder, or aria-label
  const PAY = {
    ccNum:  '[name*="number"],[id*="number"],[placeholder*="card number"],[placeholder*="Card number"],[aria-label*="card number"]',
    ccExp:  '[name*="expir"],[id*="expir"],[placeholder*="expiration"],[placeholder*="Expiration"],[placeholder*="MM/YY"],[placeholder*="MM / YY"]',
    ccCvv:  '[name*="cvv"],[name*="cvc"],[name*="security"],[id*="cvv"],[id*="security"],[placeholder*="security code"],[placeholder*="Security code"],[placeholder*="CVV"],[placeholder*="CVC"]',
    ccName: '[name*="name_on"],[name*="cardholder"],[id*="name_on"],[placeholder*="name on card"],[placeholder*="Name on card"],[placeholder*="Cardholder"]',
  };

  function qFirst(sel) {
    for (const s of sel.split(',').map(x => x.trim())) {
      try {
        const el = document.querySelector(s);
        if (el) return el;
      } catch(e) {}
    }
    return null;
  }

  const q = (s) => document.querySelector(s);

  async function fillContact(profile) {
    await waitFor(SEL.email.split(',')[0].trim());
    await delay(150);

    await focusFill(q(SEL.email),    profile.email);
    await focusFill(q(SEL.fName),    profile.fName);
    await focusFill(q(SEL.lName),    profile.lName);
    await focusFill(q(SEL.address),  profile.address);
    await focusFill(q(SEL.address2), profile.address2 || '');
    await focusFill(q(SEL.city),     profile.city);
    await focusFill(q(SEL.zip),      profile.zip);
    await focusFill(q(SEL.phone),    profile.phone);

    // Country first â€” Shopify repopulates state after country change
    const countryEl = q(SEL.country);
    if (countryEl) {
      selectOption(countryEl, resolveCountry(profile.country));
      await delay(200);
    }

    const stateEl = q(SEL.state);
    if (stateEl) {
      selectOption(stateEl, resolveState(profile.state));
      await naturalDelay();
    }

    // Payment
    const [expMonth, expYear] = (profile.expiry || '/').split('/').map(s => s.trim());

    await focusFill(qFirst(PAY.ccNum),  profile.CC?.replace(/\s/g, ''));

    // Expiry â€” fill combined OR split, never both
    const expCombined = qFirst(PAY.ccExp);
    if (expCombined) {
      await focusFill(expCombined, profile.expiry);
    } else {
      const expMonthEl = document.querySelector('[name*="month"],[placeholder*="MM"]');
      const expYearEl  = document.querySelector('[name*="year"],[placeholder*="YY"]');
      if (expMonthEl) await focusFill(expMonthEl, expMonth);
      if (expYearEl)  await focusFill(expYearEl,  expYear);
    }

    await focusFill(qFirst(PAY.ccCvv),  profile.cvv);
    await focusFill(qFirst(PAY.ccName), profile.nameOnCard || `${profile.fName} ${profile.lName}`.trim());
  }

  async function run() {
    const data = await chrome.storage.local.get(['settings', 'profiles', 'activeProfile']);
    if (!data.settings?.autoFill) return;
    const profile = data.profiles?.[data.activeProfile] ?? null;
    if (!profile) return;
    await delay(200);
    await fillContact(profile);
  }

  run();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'FILL_FORM' && msg.profile) {
      fillContact(msg.profile).then(() => sendResponse({ ok: true }));
      return true;
    }
  });
})();
