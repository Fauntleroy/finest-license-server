/**
 * Finest Checkouts — License
 * Validates license keys against the Finest license server.
 */

const LICENSE_SERVER = 'https://finest-license-server-production.up.railway.app';

const License = {
  async getStoredKey() {
    return new Promise(resolve => {
      chrome.storage.local.get('licenseKey', (d) => resolve(d.licenseKey || null));
    });
  },

  async storeKey(key) {
    return new Promise(resolve => {
      chrome.storage.local.set({ licenseKey: key, licenseValid: true }, resolve);
    });
  },

  async clearKey() {
    return new Promise(resolve => {
      chrome.storage.local.remove(['licenseKey', 'licenseValid'], resolve);
    });
  },

  async isValid() {
    return new Promise(resolve => {
      chrome.storage.local.get(['licenseKey', 'licenseValid'], (d) => {
        resolve(!!(d.licenseKey && d.licenseValid));
      });
    });
  },

  // Validate with server — call this on first entry and periodically
  async validate(key) {
    try {
      const res = await fetch(`${LICENSE_SERVER}/validate`, {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify({ key: key.trim().toUpperCase() }),
      });

      if (!res.ok) return { valid: false, message: 'Server error. Try again.' };

      const data = await res.json();
      return data;
    } catch (err) {
      // If server unreachable but key is stored, allow cached access
      const stored = await this.isValid();
      if (stored) return { valid: true, message: 'Offline — using cached license.' };
      return { valid: false, message: 'Cannot reach license server.' };
    }
  },
};
