/**
 * Finest Checkouts — Profile Storage
 * Shared helpers for reading/writing profiles via chrome.storage.local
 */

const Storage = {
  async get(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  },

  async set(data) {
    return new Promise(resolve => chrome.storage.local.set(data, resolve));
  },

  async remove(keys) {
    return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
  },

  async getProfiles() {
    const data = await this.get('profiles');
    return data.profiles || {};
  },

  async getActiveProfile() {
    const data = await this.get(['profiles', 'activeProfile']);
    const profiles = data.profiles || {};
    const key = data.activeProfile;
    return key && profiles[key] ? profiles[key] : null;
  },

  async saveProfile(key, profile) {
    const profiles = await this.getProfiles();
    profiles[key] = profile;
    await this.set({ profiles });
  },

  async deleteProfile(key) {
    const profiles = await this.getProfiles();
    delete profiles[key];
    await this.set({ profiles });
  },

  async setActiveProfile(key) {
    await this.set({ activeProfile: key });
  },

  async getSettings() {
    const data = await this.get('settings');
    return data.settings || {};
  },

  async saveSetting(key, value) {
    const settings = await this.getSettings();
    settings[key] = value;
    await this.set({ settings });
  }
};

// Profile schema — all fields a checkout form may need
const PROFILE_FIELDS = [
  'profileName',
  'fName', 'lName',
  'email', 'phone',
  'address', 'address2',
  'city', 'state', 'zip', 'country',
  // Billing (if different)
  'bSameAsShipping',
  'bfName', 'blName',
  'bAddress', 'bAddress2',
  'bCity', 'bState', 'bZip', 'bCountry',
  // Payment
  'CC', 'expiry', 'cvv', 'nameOnCard',
];

if (typeof module !== 'undefined') module.exports = { Storage, PROFILE_FIELDS };
