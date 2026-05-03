/**
 * Finest Checkouts â€” Foot Locker / JD Sports Checkout Autofill
 */

(function () {
  'use strict';

  if (window.__finestFNL) return;
  window.__finestFNL = true;

  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const naturalDelay = () => delay(20 + Math.random() * 30);

  function nativeSet(el, value) {
    if (!el) return;
    const proto = el.tagName === 'SELECT'
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  async function focusFill(el, value) {
    if (!el || !value) return;
    el.focus();
    nativeSet(el, value);
    await naturalDelay();
  }

  async function selectOption(el, value) {
    if (!el || !value) return;
    const v = value.toLowerCase().trim();
    for (const opt of el.options) {
      if (opt.value.toLowerCase() === v || opt.text.toLowerCase().includes(v)) {
        el.focus();
        nativeSet(el, opt.value);
        await naturalDelay();
        return;
      }
    }
  }

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

  const SEL = {
    email:    '#email,             [name="email"]',
    fName:    '#firstName,         [name="firstName"]',
    lName:    '#lastName,          [name="lastName"]',
    address:  '#streetAddress1,    [name="address1"],    #address1',
    address2: '#streetAddress2,    [name="address2"],    #address2',
    city:     '#city,              [name="city"]',
    state:    '#stateProvince,     [name="state"],       #state',
    zip:      '#postalCode,        [name="zip"],         #zip',
    phone:    '#phone,             [name="phone"],       [name="phoneNumber"]',
    country:  '[name="country"],   #country',
    ccNum:    '[name="cardNumber"], [data-automation="card-number"] input',
    ccExp:    '#expiry,              [name="expiration"],               [data-automation="expiry"]        input',
    ccCvv:    '#cardValidationNum,  [name="securityCode"],             [data-automation="security-code"] input',
    ccName:   '[name="nameOnCard"], [data-automation="name-on-card"]  input',
  };

  const q = (s) => document.querySelector(s);

  // Fill address/shipping fields (Step 2 on multi-step checkouts like JD Sports)
  async function fillAddressFields(profile) {
    await focusFill(q(SEL.address),  profile.address);
    await focusFill(q(SEL.address2), profile.address2 || '');
    await focusFill(q(SEL.city),     profile.city);
    await focusFill(q(SEL.zip),      profile.zip);
    await focusFill(q(SEL.phone),    profile.phone);

    const countryEl = q(SEL.country);
    if (countryEl) {
      await selectOption(countryEl, profile.country || 'US');
      await delay(75);
    }

    // State options may load asynchronously â€” try immediately, retry on miss
    const stateEl = q(SEL.state);
    if (stateEl) {
      let tries = 0;
      do {
        await selectOption(stateEl, profile.state);
        if (stateEl.value) break;
        await delay(100);
      } while (++tries < 15);
    }
  }

  // Fill just the payment-step fields (expiry + CVV on main page)
  async function fillPaymentFields(profile) {
    const [expMonth, expYear] = (profile.expiry || '/').split('/').map(s => s.trim());
    const expEl = q(SEL.ccExp);
    if (expEl) {
      await focusFill(expEl, profile.expiry);
      // React resets happen synchronously â€” re-check immediately after fill settles
      const expEl2 = q(SEL.ccExp);
      if (expEl2 && !expEl2.value) await focusFill(expEl2, profile.expiry);
    } else {
      await focusFill(q('[name="expirationMonth"]'), expMonth);
      await focusFill(q('[name="expirationYear"]'),  expYear);
    }
    await focusFill(q(SEL.ccCvv), profile.cvv);
  }

  // SPA navigation watcher â€” handles address step fills on JD Sports.
  // Uses setInterval URL polling as the primary signal â€” reliable for Next.js because
  // Next.js pre-captures the native history.pushState reference before content scripts run.
  // Expiry is handled separately by watchForExpiry (DOM-based, fires instantly).
  function watchForSPANav(profile) {
    const addr = SEL.address.split(',')[0].trim();
    let busy = false;
    let lastUrl = location.href;

    function isVisible(el) {
      return el && el.getBoundingClientRect().height > 0;
    }

    const tryFill = async () => {
      if (busy || !isVisible(q(addr))) return;
      busy = true;
      try {
        await delay(100);
        await fillAddressFields(profile);
      } finally {
        busy = false;
      }
    };

    // Belt-and-suspenders: intercept pushState
    const origPush = history.pushState.bind(history);
    history.pushState = function (...args) {
      origPush(...args);
      tryFill();
    };
    window.addEventListener('popstate', tryFill);

    // Primary: poll URL every 250ms â€” reliable regardless of SPA framework
    const poll = setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        tryFill();
      }
    }, 250);

    tryFill();

    setTimeout(() => {
      history.pushState = origPush;
      clearInterval(poll);
    }, 10 * 60 * 1000);
  }

  // Fills expiry (+ CVV fallback) the instant #expiry appears in the DOM â€”
  // same pattern as the iframe scripts: MutationObserver, no URL dependency.
  function watchForExpiry(profile) {
    let busy = false;

    const tryFill = async () => {
      if (busy) return;
      const el = q(SEL.ccExp);
      if (!el || el.value) return; // absent or already filled
      busy = true;
      try {
        await fillPaymentFields(profile);
      } finally {
        busy = false;
      }
    };

    // Fire immediately if already on payment step
    tryFill();

    // Fire on any DOM change â€” catches React inserting #expiry on SPA navigation
    const obs = new MutationObserver(tryFill);
    obs.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => obs.disconnect(), 10 * 60 * 1000);
  }

  async function fillFNL(profile) {
    // 3s timeout: resolves immediately on shipping step, doesn't block 10s on payment step
    await waitFor(SEL.email.split(',')[0].trim(), 3000);
    await delay(50);

    const [expMonth, expYear] = (profile.expiry || '/').split('/').map(s => s.trim());

    await focusFill(q(SEL.email),    profile.email);
    await focusFill(q(SEL.fName),    profile.fName);
    await focusFill(q(SEL.lName),    profile.lName);
    await focusFill(q(SEL.address),  profile.address);
    await focusFill(q(SEL.address2), profile.address2 || '');
    await focusFill(q(SEL.city),     profile.city);
    await focusFill(q(SEL.zip),      profile.zip);
    await focusFill(q(SEL.phone),    profile.phone);

    const countryEl = q(SEL.country);
    if (countryEl) {
      await selectOption(countryEl, profile.country || 'US');
      await delay(75);
    }
    await selectOption(q(SEL.state), profile.state);

    // Payment
    await focusFill(q(SEL.ccNum),  profile.CC?.replace(/\s/g, ''));
    await focusFill(q(SEL.ccName), profile.nameOnCard || `${profile.fName} ${profile.lName}`.trim());

    const expEl = q(SEL.ccExp);
    if (expEl) {
      await focusFill(expEl, profile.expiry);
    } else {
      await focusFill(q('[name="expirationMonth"]'), expMonth);
      await focusFill(q('[name="expirationYear"]'),  expYear);
    }

    await focusFill(q(SEL.ccCvv), profile.cvv);
  }

  async function run() {
    const data = await chrome.storage.local.get(['settings', 'profiles', 'activeProfile']);
    if (!data.settings?.autoFill) return;
    const profile = data.profiles?.[data.activeProfile] ?? null;
    if (!profile) return;
    await fillFNL(profile);
    watchForSPANav(profile);
    watchForExpiry(profile);
  }

  run();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'FILL_FORM' && msg.profile) {
      fillFNL(msg.profile).then(() => sendResponse({ ok: true }));
      return true;
    }
  });
})();
