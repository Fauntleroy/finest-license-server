/**
 * Finest Checkouts — Background Service Worker
 * Silently checks for script updates, downloads them, and badges the icon
 * when a new version is ready. No files on disk ever change after install.
 */

'use strict';

const SERVER = 'https://finest-license-server-production.up.railway.app';

async function checkForUpdates() {
  try {
    const res = await fetch(`${SERVER}/version`);
    if (!res.ok) return;
    const { version, scripts } = await res.json();
    if (!version || !scripts) return;

    // What version is the user currently running?
    const { installedVersion } = await chrome.storage.local.get('installedVersion');
    const current = installedVersion || chrome.runtime.getManifest().version;
    if (version === current) return;

    // Already staged this exact version — don't re-download
    const { pendingVersion } = await chrome.storage.local.get('pendingVersion');
    if (pendingVersion === version) return;

    // Download every script file listed in the version manifest
    const downloaded = {};
    for (const [key, url] of Object.entries(scripts)) {
      try {
        const r = await fetch(url);
        if (r.ok) downloaded[key] = await r.text();
      } catch {}
    }
    if (!Object.keys(downloaded).length) return;

    await chrome.storage.local.set({ pendingScripts: downloaded, pendingVersion: version });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#c9a84c' });
  } catch {}
}

// ─── License validation ─────────────────────────────────────────────────────
// Re-checks the stored licence with the server every hour. If revoked, sets
// licenseValid=false so content scripts stop filling. Server unreachable leaves
// the cached state alone (don't punish legit users during Railway outages).
async function validateLicense() {
  try {
    const { licenseKey } = await chrome.storage.local.get('licenseKey');
    if (!licenseKey) return;
    const res = await fetch(`${SERVER}/validate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        key:     licenseKey.trim().toUpperCase(),
        version: chrome.runtime.getManifest().version,
      }),
    });
    if (!res.ok) return; // server error → leave cache alone
    const data = await res.json();
    await chrome.storage.local.set({ licenseValid: !!data.valid });
  } catch {
    // Network/Railway down → leave cached state alone
  }
}

// Check on install/update and on every browser startup
chrome.runtime.onInstalled.addListener(() => { checkForUpdates(); validateLicense(); });
chrome.runtime.onStartup.addListener(()  => { checkForUpdates(); validateLicense(); });

// Recurring checks via alarms
chrome.alarms.create('updateCheck',  { delayInMinutes: 30, periodInMinutes: 60 });
chrome.alarms.create('licenseCheck', { delayInMinutes: 5,  periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === 'updateCheck')  checkForUpdates();
  if (name === 'licenseCheck') validateLicense();
});
