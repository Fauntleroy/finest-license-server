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

// Check on install/update and on every browser startup
chrome.runtime.onInstalled.addListener(checkForUpdates);
chrome.runtime.onStartup.addListener(checkForUpdates);

// Recurring hourly check via alarm (service workers can be terminated between events)
chrome.alarms.create('updateCheck', { delayInMinutes: 30, periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === 'updateCheck') checkForUpdates();
});
