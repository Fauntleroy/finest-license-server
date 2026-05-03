# Finest Checkouts — v2.0 (Manifest V3)

Clean rebuild of the Finest Checkouts, ported to Manifest V3 for compatibility with modern Chrome.

---

## Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `finest-ext` folder

---

## File Structure

```
finest-ext/
├── manifest.json              # MV3 manifest
├── js/
│   ├── storage.js             # Shared storage helpers (reference only)
│   ├── aio.js                 # Generic autofill — fires on all pages
│   ├── shopify.js             # Shopify checkout-specific autofill
│   ├── supreme-checkout.js    # Supreme checkout autofill
│   ├── supreme-shop.js        # Supreme shop page badge
│   └── fnl.js                 # Foot Locker / JD Sports autofill
└── web/
    ├── dashboard.html         # Profile manager (Options page)
    ├── popup.html             # Browser action popup
    ├── css/dashboard.css
    └── js/
        ├── dashboard.js
        └── popup.js
```

---

## Adding a Logo

Drop a `logo.png` into `web/images/` — any size works, Chrome will scale it.

---

## Supported Sites

| Site | Script | Notes |
|------|--------|-------|
| Any Shopify store | `shopify.js` | Targets `/checkouts/*` and `/checkout*` |
| Supreme | `supreme-checkout.js` | Targets `supremenewyork.com/checkout*` |
| Supreme shop page | `supreme-shop.js` | Injects active-profile badge |
| Foot Locker | `fnl.js` | Targets `/store/checkout/*` |
| JD Sports | `fnl.js` | Same script, same path pattern |
| Everything else | `aio.js` | Generic field-ID matching, auto-fill if enabled |

---

## Profile Fields

Each profile stores:

- **Contact**: first name, last name, email, phone
- **Shipping**: address, address2, city, state, zip, country
- **Payment**: card number, expiry (MM/YY), CVV, name on card

Profiles are stored in `chrome.storage.local` and can be exported/imported as JSON from the dashboard.

---

## How Fill Works

**Auto-fill**: If enabled in Settings, content scripts will fire automatically when a supported checkout page loads, using the active profile.

**Manual fill**: Click the extension icon → confirm the active profile → click "Fill Active Tab". This sends a message to the content script on the current tab.

---

## MV3 Changes vs. Original

- `manifest_version: 2` → `manifest_version: 3`
- `browser_action` → `action`
- No jQuery dependency — all vanilla JS
- No obfuscation
- Background page removed (not needed — all logic is in content scripts + popup)
- CSP updated to MV3 format
