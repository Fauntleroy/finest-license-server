(async () => {
  try {
    const { activeScripts } = await chrome.storage.local.get('activeScripts');
    if (activeScripts?.aio) { eval(activeScripts.aio); return; }
  } catch {}

/**
 * Finest Checkouts — AIO Generic Autofill
 * Fills standard checkout fields with a small natural delay between each.
 */

(function () {
  'use strict';

  if (window.__finestAIO) return;
  window.__finestAIO = true;

  // ─── One-shot version ping (rate-limited to 1/hour per browser) ────────────
  // Tells the server which extension version this user is currently running so
  // the admin dashboard can show who's up to date. Safe to run on every page —
  // throttled via chrome.storage so we don't spam the server.
  (async () => {
    try {
      const d = await chrome.storage.local.get(['licenseKey', 'versionReportedAt', 'versionReportedAs']);
      if (!d.licenseKey) return;
      const ver = chrome.runtime.getManifest().version;
      const ONE_HOUR = 60 * 60 * 1000;
      const reportedRecently = d.versionReportedAs === ver && d.versionReportedAt && (Date.now() - d.versionReportedAt) < ONE_HOUR;
      if (reportedRecently) return;
      await fetch('https://finest-license-server-production.up.railway.app/version-report', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ key: d.licenseKey, version: ver }),
      });
      await chrome.storage.local.set({ versionReportedAt: Date.now(), versionReportedAs: ver });
    } catch {}
  })();

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

  // Resolve country — "US"/"USA" → "United States"
  function resolveCountry(val) {
    if (!val) return 'United States';
    const v = val.toUpperCase().trim();
    if (v === 'US' || v === 'USA') return 'United States';
    return val;
  }


  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const naturalDelay = () => delay(20 + Math.random() * 30); // 20–50ms per field

  const FIELD_MAP = [
    { keys: ['firstname', 'first_name', 'fname', 'first-name', 'given-name'],  field: 'fName' },
    { keys: ['lastname',  'last_name',  'lname', 'last-name',  'family-name'], field: 'lName' },
    { keys: ['fullname',  'full_name',  'full-name'],                           field: '_fullName' },
    { keys: ['email'],                                                           field: 'email' },
    { keys: ['phone', 'telephone', 'mobile', 'tel'],                           field: 'phone' },
    { keys: ['address1', 'address_1', 'addr1', 'street', 'address-line1'],     field: 'address' },
    { keys: ['address2', 'address_2', 'addr2', 'apt', 'suite', 'address-line2'], field: 'address2' },
    { keys: ['city', 'address-level2'],                                         field: 'city' },
    { keys: ['province', 'state', 'region', 'address-level1'],                 field: 'state' },
    { keys: ['zip', 'postal', 'postcode', 'post_code', 'postal-code'],         field: 'zip' },
    { keys: ['country'],                                                         field: 'country' },
    { keys: ['cvv', 'cvc', 'cvv2', 'cvnumber', 'security code', 'security', 'csc'], field: 'cvv' },
    { keys: ['cardnumber', 'card_number', 'cc-number', 'ccnumber', 'number'],      field: 'CC' },
    { keys: ['expiry', 'expiration', 'exp-date', 'cc-exp'],                        field: 'expiry' },
    { keys: ['exp-month', 'expmonth', 'cc-exp-month'],                             field: '_expMonth' },
    { keys: ['exp-year',  'expyear',  'cc-exp-year'],                              field: '_expYear' },
    { keys: ['nameoncard', 'name_on_card', 'name on card', 'cardholder', 'cc-name', 'ccname'], field: 'nameOnCard' },
  ];

  function setNativeValue(el, value) {
    const proto = el.tagName === 'SELECT'
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setSelect(el, value) {
    if (!el || !value) return;
    const v = value.toLowerCase().trim();
    for (const opt of el.options) {
      if (opt.value.toLowerCase() === v || opt.text.toLowerCase().includes(v)) {
        setNativeValue(el, opt.value);
        return;
      }
    }
  }

  function matchesKey(el, keys) {
    const id          = (el.id                            || '').toLowerCase();
    const name        = (el.name                          || '').toLowerCase();
    const placeholder = (el.placeholder                   || '').toLowerCase();
    const ariaLabel   = (el.getAttribute('aria-label')   || '').toLowerCase();
    const label       = (el.getAttribute('data-label')   || '').toLowerCase();
    const autocomplete= (el.getAttribute('autocomplete') || '').toLowerCase();
    return keys.some(k =>
      id.includes(k)          ||
      name.includes(k)        ||
      placeholder.includes(k) ||
      ariaLabel.includes(k)   ||
      label.includes(k)       ||
      autocomplete.includes(k)
    );
  }

  async function fillForm(profile) {
    if (!profile) return;

    const derived = {
      _fullName: `${profile.fName || ''} ${profile.lName || ''}`.trim(),
      _expMonth: (profile.expiry || '').split('/')[0]?.trim(),
      _expYear:  (profile.expiry || '').split('/')[1]?.trim(),
    };

    const inputs = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), select, textarea'
    );

    for (const el of inputs) {
      for (const { keys, field } of FIELD_MAP) {
        if (!matchesKey(el, keys)) continue;
        let value = profile[field] ?? derived[field];
        // Resolve state abbreviation and country to full names
        if (field === 'state')   value = resolveState(value);
        if (field === 'country') value = resolveCountry(value);
        if (!value) continue;

        el.focus();
        if (el.tagName === 'SELECT') setSelect(el, value);
        else setNativeValue(el, value);
        el.blur();

        await naturalDelay();
        break;
      }
    }
  }

  async function isLicensed() {
    const d = await chrome.storage.local.get(['licenseKey', 'licenseValid']);
    return !!(d.licenseKey && d.licenseValid);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'FILL_FORM' && msg.profile) {
      (async () => {
        if (!(await isLicensed())) { sendResponse({ ok: false, error: 'unlicensed' }); return; }
        await fillForm(msg.profile);
        sendResponse({ ok: true });
      })();
      return true;
    }
  });

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

  async function maybeAutoFill() {
    if (!(await isLicensed())) return;
    const data = await chrome.storage.local.get(['settings', 'profiles', 'activeProfile']);
    if (!data.settings?.autoFill) return;
    const profile = data.profiles?.[data.activeProfile] ?? null;
    if (!profile) return;
    // Only auto-fill on pages that look like checkout pages
    const url = window.location.href.toLowerCase();
    const isCheckout = url.includes('checkout') || url.includes('cart') || url.includes('payment') || url.includes('billing') || url.includes('order');
    if (!isCheckout) return;
    // Back off if a dedicated script is already handling this page
    if (window.__finestSupreme || window.__finestShopify || window.__finestFNL || window.__finestPCI) return;
    // Wait for form fields to render (handles React/SPA checkouts like Nike)
    await waitFor('input[autocomplete], input[name], input[id]', 8000);
    await fillForm(profile);
  }

  maybeAutoFill();
})();

})(); // end auto-update wrapper
