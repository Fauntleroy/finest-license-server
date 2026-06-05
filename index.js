require('dotenv').config();
const express                                      = require('express');
const cors                                         = require('cors');
const crypto                                       = require('crypto');
const fs                                           = require('fs');
const path                                         = require('path');
const cron                                         = require('node-cron');
const { Client, GatewayIntentBits, Events }        = require('discord.js');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Config ────────────────────────────────────────────────────────────────────
const SERVER_URL            = (process.env.SERVER_URL || 'https://finest-license-server-production.up.railway.app').replace(/\/$/, '');
const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID     || '1488706930993008872';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'Mxf2vBKG9yFF9FOGvMTLyhuqES6p12NM';
const DISCORD_BOT_TOKEN     = process.env.DISCORD_BOT_TOKEN?.replace(/\s+/g, '') || null;
const DISCORD_SERVER_ID     = process.env.DISCORD_SERVER_ID    || '756211694547501117';
const EXTENSION_DOWNLOAD_URL= process.env.EXTENSION_DOWNLOAD_URL || '';
const RESEND_API_KEY        = process.env.RESEND_API_KEY         || '';
const FROM_EMAIL            = process.env.FROM_EMAIL             || 'Finest Checkouts <onboarding@resend.dev>';
const WHOP_API_KEY          = process.env.WHOP_API_KEY           || '';

// Roles that grant access (role names, lowercase — edit via DISCORD_QUALIFYING_ROLES env var)
const QUALIFYING_ROLES = (process.env.DISCORD_QUALIFYING_ROLES || 'YouTube Member: Brick Boy Squad,YouTube Member: Cook God,Server Booster,Grandfathered')
  .split(',').map(r => r.trim().toLowerCase());

// ── Key store (file-based — swap for DB if you scale) ─────────────────────────
const KEYS_FILE = process.env.KEYS_FILE || path.join(__dirname, 'keys.json');

function loadKeys() {
  if (!fs.existsSync(KEYS_FILE)) fs.writeFileSync(KEYS_FILE, '{}');
  return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
}

function saveKeys(keys) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}

function generateKey() {
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `FINEST-${seg()}-${seg()}-${seg()}`;
}

// ── OAuth state store (in-memory, 10 min TTL, CSRF protection) ───────────────
const oauthStates = new Map();

function createState() {
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, Date.now());
  setTimeout(() => oauthStates.delete(state), 10 * 60 * 1000);
  return state;
}

function validateState(state) {
  if (!state || !oauthStates.has(state)) return false;
  oauthStates.delete(state);
  return true;
}

// ── Discord API helpers ───────────────────────────────────────────────────────
async function discordFetch(endpoint, token) {
  const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
    headers: {
      'Authorization': token.startsWith('Bot ') ? token : `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.status);
    throw new Error(`Discord ${endpoint} → ${res.status}: ${txt}`);
  }
  return res.json();
}

async function getDiscordUser(accessToken) {
  return discordFetch('/users/@me', accessToken);
}

async function getGuildMember(userId) {
  if (!DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN not configured');
  return discordFetch(`/guilds/${DISCORD_SERVER_ID}/members/${userId}`, `Bot ${DISCORD_BOT_TOKEN}`);
}

async function getGuildRoles() {
  if (!DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN not configured');
  return discordFetch(`/guilds/${DISCORD_SERVER_ID}/roles`, `Bot ${DISCORD_BOT_TOKEN}`);
}

const MEMBER_ROLE_NAME = process.env.MEMBER_ROLE_NAME || '✅Out GOAT';

async function assignMemberRole(userId) {
  if (!DISCORD_BOT_TOKEN || !userId) return;
  try {
    const roles = await getGuildRoles();
    const role  = roles.find(r => r.name === MEMBER_ROLE_NAME);
    if (!role) { console.warn(`[Bot] Role "${MEMBER_ROLE_NAME}" not found`); return; }
    await fetch(`https://discord.com/api/v10/guilds/${DISCORD_SERVER_ID}/members/${userId}/roles/${role.id}`, {
      method:  'PUT',
      headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    });
    console.log(`[Bot] Assigned "${MEMBER_ROLE_NAME}" to userId ${userId}`);
  } catch (err) {
    console.error('[Bot] Failed to assign role:', err.message);
  }
}

async function checkMemberQualifies(userId) {
  try {
    const [member, allRoles] = await Promise.all([getGuildMember(userId), getGuildRoles()]);
    const roleMap = {};
    for (const role of allRoles) roleMap[role.id] = role.name.toLowerCase();

    for (const roleId of member.roles) {
      const roleName = roleMap[roleId];
      if (roleName && QUALIFYING_ROLES.includes(roleName)) {
        return { qualifies: true, roleName };
      }
    }
    return { qualifies: false };
  } catch (err) {
    // 10007 = Unknown Member (not in server)
    if (err.message.includes('10007')) return { qualifies: false, notInServer: true };
    throw err;
  }
}

async function exchangeDiscordCode(code) {
  const params = new URLSearchParams({
    client_id:     DISCORD_CLIENT_ID,
    client_secret: DISCORD_CLIENT_SECRET,
    grant_type:    'authorization_code',
    code,
    redirect_uri:  `${SERVER_URL}/auth/discord/callback`,
  });
  const res = await fetch('https://discord.com/api/v10/oauth2/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.status);
    throw new Error(`Discord token exchange failed: ${txt}`);
  }
  return res.json();
}

// ── Email via Resend ──────────────────────────────────────────────────────────
// Returns true on success, false on failure (so callers can mark the key for retry).
async function sendKeyEmail(toEmail, key) {
  if (!RESEND_API_KEY) { console.warn('[Email] RESEND_API_KEY not set — skipping'); return false; }

  const downloadSection = EXTENSION_DOWNLOAD_URL
    ? `<p style="margin:16px 0"><a href="${EXTENSION_DOWNLOAD_URL}" style="background:#c9a84c;color:#080808;padding:12px 24px;border-radius:5px;text-decoration:none;font-weight:700;font-family:monospace">Download Extension</a></p>
       <p style="color:#888;font-size:13px;margin-top:8px">After downloading: unzip → open chrome://extensions → enable Developer Mode → Load unpacked → select the folder → enter your key in the popup.</p>`
    : `<p style="color:#888;font-size:13px">Download link coming soon — your key is ready to use once you have the extension.</p>`;

  const html = `
    <div style="background:#080808;padding:40px 32px;max-width:480px;margin:0 auto;font-family:monospace">
      <div style="color:#c9a84c;font-size:20px;font-weight:700;letter-spacing:0.1em;margin-bottom:8px">FINEST CHECKOUTS</div>
      <div style="color:#6a6050;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:28px">License Key</div>
      <p style="color:#f0e6c8;font-size:14px;margin-bottom:20px">Thanks for subscribing! Here's your license key:</p>
      <div style="background:#181818;border:1px solid #7a5e1e;border-radius:6px;padding:16px 20px;margin-bottom:20px">
        <span style="color:#c9a84c;font-size:18px;letter-spacing:0.12em">${key}</span>
      </div>
      <p style="color:#f0e6c8;font-size:13px;margin-bottom:16px">Enter this key in the extension popup to activate.</p>
      ${downloadSection}
      <hr style="border:none;border-top:1px solid #252525;margin:28px 0"/>
      <p style="color:#3a3530;font-size:11px">Questions? Reply to this email.<br/>Finest Tools — Only the finest.</p>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: [toEmail], subject: 'Your Finest Checkouts License Key', html }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[Email] Resend error:', err);
      return false;
    }
    console.log(`[Email] Key sent to ${toEmail}`);
    return true;
  } catch (err) {
    console.error('[Email] Failed to send:', err.message);
    return false;
  }
}

// ── Email retry queue ─────────────────────────────────────────────────────────
// Marks email status on the key record so failed emails can be retried later
// (on startup, on cron, or manually from the admin panel).
async function sendKeyEmailTracked(toEmail, key) {
  const ok = await sendKeyEmail(toEmail, key);
  const keys = loadKeys();
  if (keys[key]) {
    keys[key].emailSent           = ok;
    keys[key].emailLastAttempt    = new Date().toISOString();
    keys[key].emailAttempts       = (keys[key].emailAttempts || 0) + 1;
    if (ok) keys[key].emailSentAt = new Date().toISOString();
    saveKeys(keys);
  }
  return ok;
}

async function retryPendingEmails() {
  const keys    = loadKeys();
  const pending = Object.entries(keys).filter(
    ([, r]) => r.status === 'active' && r.email && r.email !== 'unknown' && r.email !== 'manual' && r.email.includes('@') && r.emailSent === false
  );
  if (!pending.length) return { retried: 0, sent: 0, failed: 0 };
  console.log(`[Email Retry] Found ${pending.length} pending email(s) — retrying`);
  let sent = 0, failed = 0;
  for (const [key, record] of pending) {
    const ok = await sendKeyEmailTracked(record.email, key);
    if (ok) sent++; else failed++;
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`[Email Retry] Done — sent: ${sent}, failed: ${failed}`);
  return { retried: pending.length, sent, failed };
}

// ── Portal HTML ───────────────────────────────────────────────────────────────
function portalHTML({ key = null, returning = false, error = null } = {}) {
  const downloadURL = EXTENSION_DOWNLOAD_URL;

  const content = key ? `
    <div class="result-box success">
      <div class="result-icon">✓</div>
      <div class="result-title">${returning ? 'Welcome back.' : 'Access granted.'}</div>
      <div class="result-sub">${returning ? 'Here is your existing key.' : 'Your license key has been generated.'}</div>
      <div class="key-block">
        <span id="key-text">${key}</span>
        <button class="copy-btn" onclick="copyKey()">Copy</button>
      </div>
      ${downloadURL ? `
      <a class="btn-download" href="${downloadURL}" download>
        <span>Download Extension</span>
        <span class="btn-arrow">↓</span>
      </a>
      <div class="install-steps">
        <div class="steps-title">How to install</div>
        <ol>
          <li>Download and unzip the file above</li>
          <li>Open Chrome → go to <strong>chrome://extensions</strong></li>
          <li>Enable <strong>Developer Mode</strong> (top right toggle)</li>
          <li>Click <strong>Load unpacked</strong> → select the unzipped folder</li>
          <li>Click the extension icon → enter your key to activate</li>
        </ol>
      </div>` : `<div class="result-sub" style="margin-top:12px;color:#c06060">Download link not yet configured — contact support with your key.</div>`}
    </div>` : error ? `
    <div class="result-box error">
      <div class="result-icon">✕</div>
      <div class="result-title">Access denied</div>
      <div class="result-sub">${error}</div>
      <a class="btn-discord" href="/auth/discord">Try again</a>
    </div>` : `
    <div class="intro">
      <div class="diamond"></div>
      <div class="intro-title">FINEST CHECKOUTS</div>
      <div class="intro-sub">Verify your membership to get your license key and download link.</div>
    </div>
    <div class="access-list">
      <div class="access-item">✓ YouTube — Brick Boy Squad or Cook God member</div>
      <div class="access-item">✓ Discord — Server Booster</div>
      <div class="access-item">✓ Purchased on Whop</div>
    </div>
    <div class="btn-group">
      <a class="btn-discord" href="/auth/discord">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.001.022.015.04.034.05a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
        Verify with Discord
      </a>
    </div>
    <div class="already-have">Already have a key? Enter it in the extension popup.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Finest Checkouts — Get Access</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  :root{
    --bg:#080808;--bg1:#101010;--bg2:#181818;--bg3:#202020;
    --border:#252525;--text:#f0e6c8;--dim:#6a6050;
    --gold:#c9a84c;--gold-hi:#e4be6a;--gold-dim:#7a5e1e;
    --green:#3a7a4a;--red:#8b3a3a;
  }
  body{background:var(--bg);color:var(--text);font-family:'DM Mono',monospace;
    min-height:100vh;display:flex;flex-direction:column;align-items:center;
    justify-content:center;padding:40px 20px;}
  .card{background:var(--bg1);border:1px solid var(--border);border-radius:10px;
    padding:36px 32px;width:100%;max-width:460px;display:flex;flex-direction:column;gap:24px;}
  .header{text-align:center;margin-bottom:4px;}
  .header-sub{font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:var(--dim);margin-bottom:20px;}

  .diamond{width:40px;height:40px;background:linear-gradient(135deg,#fdf5c0,#c4973e,#f0d060,#9a7228,#e8c060);
    transform:rotate(45deg);border-radius:4px;margin:0 auto 20px;flex-shrink:0;
    box-shadow:0 0 20px rgba(196,151,62,0.35);}
  .intro{text-align:center;}
  .intro-title{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;
    letter-spacing:0.12em;color:var(--gold);margin-bottom:10px;}
  .intro-sub{font-size:11px;color:var(--dim);line-height:1.6;max-width:320px;margin:0 auto;}

  .access-list{display:flex;flex-direction:column;gap:8px;}
  .access-item{font-size:11px;color:var(--dim);padding:10px 14px;background:var(--bg2);
    border-radius:5px;border:1px solid var(--border);}

  .btn-group{display:flex;flex-direction:column;gap:10px;}
  .btn-discord{display:flex;align-items:center;justify-content:center;gap:10px;
    background:#5865F2;color:#fff;font-family:'DM Mono',monospace;font-size:13px;
    font-weight:500;letter-spacing:0.06em;padding:13px 20px;border-radius:6px;
    text-decoration:none;transition:background 0.15s;}
  .btn-discord:hover{background:#4752c4;}

  .already-have{font-size:10px;color:var(--dim);text-align:center;}

  /* Result states */
  .result-box{display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center;}
  .result-box.success .result-icon{font-size:28px;color:#7ec98a;}
  .result-box.error   .result-icon{font-size:28px;color:#c06060;}
  .result-title{font-family:'Syne',sans-serif;font-size:16px;font-weight:800;
    letter-spacing:0.08em;color:var(--gold);}
  .result-sub{font-size:11px;color:var(--dim);line-height:1.5;}

  .key-block{display:flex;align-items:center;gap:10px;background:var(--bg2);
    border:1px solid var(--gold-dim);border-radius:6px;padding:12px 16px;width:100%;}
  #key-text{font-family:'DM Mono',monospace;font-size:14px;letter-spacing:0.1em;
    color:var(--gold);flex:1;word-break:break-all;}
  .copy-btn{background:var(--bg3);border:1px solid var(--border);color:var(--dim);
    font-family:'DM Mono',monospace;font-size:10px;padding:5px 12px;border-radius:4px;
    cursor:pointer;flex-shrink:0;transition:color 0.15s,border-color 0.15s;}
  .copy-btn:hover{color:var(--gold);border-color:var(--gold-dim);}

  .btn-download{display:flex;align-items:center;justify-content:center;gap:10px;
    background:var(--gold);color:#080808;font-family:'Syne',sans-serif;font-size:13px;
    font-weight:800;letter-spacing:0.06em;padding:13px 20px;border-radius:6px;
    text-decoration:none;width:100%;transition:background 0.15s;}
  .btn-download:hover{background:var(--gold-hi);}
  .btn-arrow{font-size:16px;}

  .install-steps{background:var(--bg2);border:1px solid var(--border);border-radius:6px;
    padding:16px 18px;width:100%;text-align:left;}
  .steps-title{font-size:10px;letter-spacing:0.14em;text-transform:uppercase;
    color:var(--gold);margin-bottom:12px;}
  .install-steps ol{padding-left:18px;display:flex;flex-direction:column;gap:7px;}
  .install-steps li{font-size:11px;color:var(--dim);line-height:1.5;}
  .install-steps strong{color:var(--text);}
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <div class="header-sub">Finest Checkouts — Member Access</div>
  </div>
  ${content}
</div>
<script>
function copyKey() {
  const key = document.getElementById('key-text')?.textContent;
  if (!key) return;
  navigator.clipboard.writeText(key).then(() => {
    const btn = document.querySelector('.copy-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 2000); }
  });
}
</script>
</body>
</html>`;
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());

// ── Static script files (extension auto-update) ───────────────────────────────
app.use('/scripts', express.static(path.join(__dirname, 'scripts')));

// Capture raw body for Whop webhook signature verification before JSON parsing
app.use((req, res, next) => {
  if (req.path === '/whop-webhook') {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      req.rawBody = raw;
      try { req.body = JSON.parse(raw); } catch { req.body = {}; }
      next();
    });
  } else {
    express.json()(req, res, next);
  }
});

// ── Verification Portal ───────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const key       = req.query.key       ? decodeURIComponent(req.query.key)   : null;
  const error     = req.query.error     ? decodeURIComponent(req.query.error) : null;
  const returning = !!req.query.returning;
  res.send(portalHTML({ key, error, returning }));
});

// ── Discord OAuth — Step 1: redirect to Discord ───────────────────────────────
app.get('/auth/discord', (req, res) => {
  const state  = createState();
  const params = new URLSearchParams({
    client_id:     DISCORD_CLIENT_ID,
    redirect_uri:  `${SERVER_URL}/auth/discord/callback`,
    response_type: 'code',
    scope:         'identify',
    state,
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

// ── Discord OAuth — Step 2: handle callback ───────────────────────────────────
app.get('/auth/discord/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/?error=${encodeURIComponent('Discord authorization was cancelled.')}`);
  }
  if (!validateState(state)) {
    return res.redirect(`/?error=${encodeURIComponent('Session expired — please try again.')}`);
  }
  if (!code) {
    return res.redirect(`/?error=${encodeURIComponent('No authorization code received.')}`);
  }

  try {
    const tokenData = await exchangeDiscordCode(code);
    const user      = await getDiscordUser(tokenData.access_token);

    if (!DISCORD_BOT_TOKEN) {
      return res.redirect(`/?error=${encodeURIComponent('Server misconfiguration — bot token not set. Contact support.')}`);
    }

    const { qualifies, roleName, notInServer } = await checkMemberQualifies(user.id);

    if (!qualifies) {
      const msg = notInServer
        ? "You're not in the server. Join first then try again."
        : "Your Discord account doesn't have a qualifying role (Brick Boy Squad, Cook God, or Server Booster).";
      return res.redirect(`/?error=${encodeURIComponent(msg)}`);
    }

    // Check if this Discord user already has an active key — return existing key
    const keys    = loadKeys();
    const existing = Object.entries(keys).find(([, r]) => r.discordUserId === user.id && r.status === 'active');
    if (existing) {
      console.log(`[Discord] Returning existing key for ${user.username} (${user.id})`);
      return res.redirect(`/?key=${encodeURIComponent(existing[0])}&returning=1`);
    }

    // Issue new key
    const newKey  = generateKey();
    const today   = new Date();
    keys[newKey]  = {
      status:        'active',
      email:         user.username,
      discordUserId: user.id,
      discordTag:    user.discriminator ? `${user.username}#${user.discriminator}` : user.username,
      source:        'discord',
      plan:          roleName,
      renewalDay:    today.getDate(),
      createdAt:     today.toISOString(),
      lastChecked:   today.toISOString(),
      lastSeen:      null,
    };
    saveKeys(keys);
    console.log(`[Discord] New key for ${user.username} (${user.id}) via "${roleName}": ${newKey}`);
    assignMemberRole(user.id);
    return res.redirect(`/?key=${encodeURIComponent(newKey)}`);

  } catch (err) {
    console.error('[Discord OAuth]', err.message);
    return res.redirect(`/?error=${encodeURIComponent('Something went wrong — please try again.')}`);
  }
});

// ─────────────────────────────────────────────
// POST /validate
// ─────────────────────────────────────────────
app.post('/validate', (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== 'string') {
    return res.json({ valid: false, message: 'No key provided.' });
  }
  const keys   = loadKeys();
  const record = keys[key.trim().toUpperCase()];

  if (!record)                       return res.json({ valid: false, message: 'Invalid license key.' });
  if (record.status !== 'active')    return res.json({ valid: false, message: 'License is inactive.' });

  record.lastSeen = new Date().toISOString();
  saveKeys(keys);
  return res.json({ valid: true, message: 'License valid.', plan: record.plan || 'member' });
});

// ─────────────────────────────────────────────
// POST /whop-webhook
// ─────────────────────────────────────────────
app.post('/whop-webhook', (req, res) => {
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (secret) {
    // Whop uses Svix for webhook delivery
    // Signed content = "{webhook-id}.{webhook-timestamp}.{rawBody}"
    // Secret may be base64-encoded with "whsec_" prefix
    const msgId     = req.headers['webhook-id']        || '';
    const timestamp = req.headers['webhook-timestamp'] || '';
    const sigHeader = req.headers['webhook-signature'] || '';

    if (!sigHeader) {
      console.warn('[Whop] No webhook-signature header — rejecting');
      return res.status(401).json({ error: 'Missing signature' });
    }

    const signedContent = `${msgId}.${timestamp}.${req.rawBody || ''}`;
    // Whop/Svix signs with the full secret string as UTF-8 bytes (including any prefix)
    const computed = crypto.createHmac('sha256', Buffer.from(secret)).update(signedContent).digest('base64');
    const valid    = sigHeader.split(' ').some(s => s === `v1,${computed}`);

    if (!valid) {
      console.warn('[Whop] Signature invalid');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const event = req.body;
  console.log('[Whop] Event type:', event.type, '| email:', event.data?.user?.email, '| user_id:', event.data?.user?.id);

  // New paid member — issue key
  if (event.type === 'membership.activated') {
    const keys    = loadKeys();
    const newKey  = generateKey();
    const email   = event.data?.user?.email || 'unknown';
    const userId  = event.data?.user?.id    || event.data?.id || 'unknown';

    keys[newKey] = {
      status:    'active',
      email,
      userId,
      source:    'whop',
      plan:      'member',
      createdAt: new Date().toISOString(),
      lastSeen:  null,
      emailSent: false,
    };
    saveKeys(keys);
    console.log(`[Whop] Key issued for ${email}: ${newKey}`);
    if (email && email !== 'unknown') sendKeyEmailTracked(email, newKey);
    // Whop buyers don't have a Discord ID at purchase time — role assigned if they later verify via portal
    return res.json({ received: true, key: newKey });
  }

  // Membership cancelled / payment failed — revoke key
  if (event.type === 'membership.deactivated') {
    const userId = event.data?.user?.id || event.data?.id;
    if (userId) {
      const keys = loadKeys();
      let changed = false;
      for (const [key, record] of Object.entries(keys)) {
        if (record.userId === userId && record.source === 'whop' && record.status === 'active') {
          record.status      = 'inactive';
          record.revokedAt   = new Date().toISOString();
          record.revokedReason = 'whop_membership_invalid';
          changed = true;
          console.log(`[Whop] Revoked key ${key} for userId ${userId}`);
        }
      }
      if (changed) saveKeys(keys);
    }
    return res.json({ received: true });
  }

  return res.json({ received: true });
});

// ─────────────────────────────────────────────
// POST /generate  (manual, admin-protected)
// ─────────────────────────────────────────────
app.post('/generate', (req, res) => {
  const { secret, email, plan } = req.body;
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });

  const keys   = loadKeys();
  const newKey = generateKey();
  const isRealEmail = email && email !== 'manual' && email.includes('@');
  keys[newKey] = {
    status:    'active',
    email:     email || 'manual',
    source:    'manual',
    plan:      plan  || 'member',
    createdAt: new Date().toISOString(),
    lastSeen:  null,
    ...(isRealEmail && { emailSent: false }),
  };
  saveKeys(keys);
  console.log(`[Manual] Key for ${email}: ${newKey}`);
  if (isRealEmail) sendKeyEmailTracked(email, newKey);
  return res.json({ key: newKey });
});

// ─────────────────────────────────────────────
// POST /admin/retry-emails — manually retry pending failed emails
// ─────────────────────────────────────────────
app.post('/admin/retry-emails', async (req, res) => {
  if (req.body.secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  const result = await retryPendingEmails();
  return res.json(result);
});

// ─────────────────────────────────────────────
// Whop API helpers — reconcile lost purchases
// ─────────────────────────────────────────────
// Fetches every active membership Whop knows about (paginated).
// Used when Railway was down past Whop's webhook retry window — Whop has
// the customer, we don't, and this catches that gap.
async function fetchAllWhopMemberships() {
  if (!WHOP_API_KEY) throw new Error('WHOP_API_KEY not set');
  const all = [];
  let page = 1;
  for (;;) {
    const r = await fetch(`https://api.whop.com/api/v5/memberships?page=${page}&per=50&valid=true`, {
      headers: { 'Authorization': `Bearer ${WHOP_API_KEY}`, 'Accept': 'application/json' },
    });
    if (!r.ok) throw new Error(`Whop API ${r.status}: ${await r.text()}`);
    const j = await r.json();
    const data = j.data || j.memberships || [];
    if (!data.length) break;
    all.push(...data);
    const total = j.pagination?.total_page || j.total_page || page;
    if (page >= total) break;
    page++;
    await new Promise(r => setTimeout(r, 200));
  }
  return all;
}

// ─────────────────────────────────────────────
// POST /admin/reconcile-whop — backfill keys for missed Whop purchases
// ─────────────────────────────────────────────
app.post('/admin/reconcile-whop', async (req, res) => {
  if (req.body.secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  if (!WHOP_API_KEY) return res.status(500).json({ error: 'WHOP_API_KEY not set in Railway' });

  let memberships;
  try { memberships = await fetchAllWhopMemberships(); }
  catch (err) { return res.status(502).json({ error: err.message }); }

  const keys = loadKeys();
  // Index existing keys by Whop user_id for fast lookup
  const knownUserIds = new Set(
    Object.values(keys)
      .filter(r => r.source === 'whop' && r.userId)
      .map(r => r.userId)
  );

  let created = 0, skipped = 0, emailed = 0, emailFailed = 0;
  const createdList = [];

  for (const m of memberships) {
    const userId = m.user_id || m.user?.id;
    const email  = m.user?.email || m.email;
    const status = m.status || (m.valid ? 'active' : 'inactive');
    if (!userId || status !== 'active') { skipped++; continue; }
    if (knownUserIds.has(userId))       { skipped++; continue; }

    const newKey = generateKey();
    keys[newKey] = {
      status:    'active',
      email:     email || 'unknown',
      userId,
      source:    'whop',
      plan:      'member',
      createdAt: m.created_at ? new Date(m.created_at * 1000).toISOString() : new Date().toISOString(),
      lastSeen:  null,
      emailSent: false,
      reconciled: true,
    };
    created++;
    createdList.push({ key: newKey, email, userId });
    console.log(`[Reconcile] Created missing key for ${email} (${userId}): ${newKey}`);
  }

  if (created > 0) saveKeys(keys);

  // Send emails for any new keys with valid email addresses
  for (const { key, email } of createdList) {
    if (!email || email === 'unknown' || !email.includes('@')) continue;
    const ok = await sendKeyEmailTracked(email, key);
    if (ok) emailed++; else emailFailed++;
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`[Reconcile] Done — created: ${created}, emailed: ${emailed}, emailFailed: ${emailFailed}, skipped: ${skipped}`);
  return res.json({ totalFromWhop: memberships.length, created, emailed, emailFailed, skipped });
});

// ─────────────────────────────────────────────
// POST /admin/edit-key — update email (and optionally plan) on a key
// ─────────────────────────────────────────────
app.post('/admin/edit-key', (req, res) => {
  const { secret, key, email, plan } = req.body;
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  const keys = loadKeys();
  const record = keys[key?.toUpperCase()];
  if (!record) return res.json({ error: 'Key not found' });
  if (email !== undefined) record.email = email;
  if (plan  !== undefined) record.plan  = plan;
  saveKeys(keys);
  console.log(`[Admin] Edited ${key.toUpperCase()} — email: ${record.email}`);
  return res.json({ ok: true, email: record.email, plan: record.plan });
});

// ─────────────────────────────────────────────
// POST /admin/resend-key — re-send the licence email to the on-file address
// ─────────────────────────────────────────────
app.post('/admin/resend-key', async (req, res) => {
  const { secret, key } = req.body;
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  const keys = loadKeys();
  const upperKey = key?.toUpperCase();
  const record = keys[upperKey];
  if (!record) return res.json({ error: 'Key not found' });
  if (!record.email || !record.email.includes('@')) {
    return res.json({ error: `Key has no valid email on file (current: "${record.email}")` });
  }
  const ok = await sendKeyEmailTracked(record.email, upperKey);
  console.log(`[Admin] Resent ${upperKey} to ${record.email} — ${ok ? 'OK' : 'FAILED'}`);
  return res.json({ ok, email: record.email });
});

// ─────────────────────────────────────────────
// POST /recover — user-facing lost-key recovery (public)
// Looks up active keys matching the given email and re-sends the licence email.
// Rate-limited to prevent abuse: 1 request per email per 5 min.
// ─────────────────────────────────────────────
const recoveryAttempts = new Map(); // email → last attempt timestamp
app.post('/recover', async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return res.json({ error: 'Please enter a valid email address.' });
  }

  // Simple rate limit: one request per email per 5 minutes
  const lastTry = recoveryAttempts.get(email);
  if (lastTry && Date.now() - lastTry < 5 * 60 * 1000) {
    return res.json({ ok: true, message: 'If a licence exists for that email, we just sent it. Check your inbox (and spam folder).' });
  }
  recoveryAttempts.set(email, Date.now());

  const keys = loadKeys();
  // Find active keys belonging to this email
  const matches = Object.entries(keys).filter(
    ([, r]) => r.status === 'active' && r.email && r.email.toLowerCase() === email
  );

  // Always return the same generic message — don't reveal whether the email exists
  const genericResponse = { ok: true, message: 'If a licence exists for that email, we just sent it. Check your inbox (and spam folder).' };

  if (!matches.length) {
    console.log(`[Recover] No active keys for ${email}`);
    return res.json(genericResponse);
  }

  // Re-send each active key (usually just one, but loop in case)
  for (const [key] of matches) {
    await sendKeyEmailTracked(email, key);
    console.log(`[Recover] Resent ${key} to ${email}`);
  }
  return res.json(genericResponse);
});

// ─────────────────────────────────────────────
// GET /recover — user-facing page
// ─────────────────────────────────────────────
app.get('/recover', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Recover Your Finest Checkouts Licence</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{background:#080808;color:#f0e6c8;font-family:monospace;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
    .card{max-width:420px;width:100%;text-align:center;}
    .brand{color:#c9a84c;font-size:18px;font-weight:800;letter-spacing:0.1em;margin-bottom:8px;}
    .sub{color:#7a6f56;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:28px;}
    p{font-size:13px;line-height:1.6;margin-bottom:24px;color:#c8bfaa;}
    input{background:#181818;border:1px solid #252525;border-radius:5px;color:#f0e6c8;font-family:monospace;font-size:13px;padding:12px 14px;width:100%;outline:none;margin-bottom:12px;text-align:center;}
    input:focus{border-color:#7a5e1e;}
    button{background:#c9a84c;border:none;border-radius:5px;color:#080808;font-family:monospace;font-size:13px;font-weight:700;padding:12px 24px;width:100%;cursor:pointer;letter-spacing:0.04em;}
    button:hover:not(:disabled){background:#e4be6a;}
    button:disabled{background:#252525;color:#555;cursor:default;}
    .msg{font-size:12px;margin-top:16px;min-height:18px;color:#7ec98a;}
    .err{color:#c06060;}
  </style></head>
  <body>
    <div class="card">
      <div class="brand">FINEST CHECKOUTS</div>
      <div class="sub">Recover Licence</div>
      <p>Lost your licence key? Enter the email you used to purchase and we'll re-send it.</p>
      <form id="f">
        <input id="e" type="email" placeholder="your@email.com" required autofocus/>
        <button type="submit" id="b">Send My Key</button>
      </form>
      <div class="msg" id="m"></div>
    </div>
    <script>
      const f = document.getElementById('f');
      const b = document.getElementById('b');
      const m = document.getElementById('m');
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        b.disabled = true; b.textContent = 'Sending...';
        m.textContent = ''; m.classList.remove('err');
        try {
          const r = await fetch('/recover', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email: document.getElementById('e').value }) });
          const d = await r.json();
          if (d.error) { m.textContent = d.error; m.classList.add('err'); }
          else { m.textContent = d.message; }
        } catch (err) {
          m.textContent = 'Something went wrong. Please try again.'; m.classList.add('err');
        } finally {
          b.disabled = false; b.textContent = 'Send My Key';
        }
      };
    </script>
  </body></html>`);
});

// ─────────────────────────────────────────────
// POST /broadcast  (admin — send update email to all users)
// ─────────────────────────────────────────────
app.post('/broadcast', async (req, res) => {
  const { secret } = req.body;
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY not set' });

  const keys    = loadKeys();
  const version = process.env.CURRENT_VERSION || '2.2.3';
  const downloadUrl = EXTENSION_DOWNLOAD_URL || '#';

  const html = `
    <div style="background:#080808;padding:40px 32px;max-width:520px;margin:0 auto;font-family:monospace">
      <div style="color:#c9a84c;font-size:20px;font-weight:700;letter-spacing:0.1em;margin-bottom:8px">FINEST CHECKOUTS</div>
      <div style="color:#6a6050;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:28px">v${version} — In-Store + Online Upgrades</div>

      <p style="color:#f0e6c8;font-size:15px;font-weight:700;margin-bottom:12px">Two big things this drop.</p>

      <p style="color:#c8bfaa;font-size:13px;margin-bottom:24px">Click <strong style="color:#c9a84c">Apply Now</strong> in the popup to get everything — no re-downloading needed.</p>

      <div style="background:#181818;border-left:3px solid #c9a84c;padding:16px 20px;margin-bottom:18px">
        <p style="color:#c9a84c;font-size:13px;font-weight:700;letter-spacing:0.08em;margin:0 0 12px">🏪 NEW: IN-STORE WAITLIST AUTO-BOOKING</p>
        <p style="color:#f0e6c8;font-size:13px;line-height:1.6;margin:0 0 8px">Drop morning, skip the manual scramble. Finest now auto-books your Supreme in-store appointment on Waitwhile the second registration opens.</p>
        <ul style="color:#c8bfaa;font-size:12px;margin:8px 0 0;padding-left:18px;line-height:1.7">
          <li>Picks your preferred store automatically</li>
          <li>Grabs the earliest available slot</li>
          <li>Fills name, email, phone and hits submit</li>
          <li>Auto-retries if a slot gets sniped — keeps going until you're in or the line closes</li>
          <li>Supreme Brooklyn, Chicago, Manhattan, San Francisco, LA &amp; Miami</li>
        </ul>
        <p style="color:#7a6f56;font-size:11px;margin:12px 0 0;font-style:italic">Toggle on in Dashboard → Settings → Waitlist Auto-Booking. Pick your store and let it rip Tuesday morning.</p>
      </div>

      <div style="background:#181818;border-left:3px solid #c9a84c;padding:16px 20px;margin-bottom:24px">
        <p style="color:#c9a84c;font-size:13px;font-weight:700;letter-spacing:0.08em;margin:0 0 12px">⚡ CHECKOUT IMPROVEMENTS</p>
        <p style="color:#f0e6c8;font-size:13px;line-height:1.6;margin:0">Better fills, fewer hangs, and improved support across the sites you actually buy on:</p>
        <ul style="color:#c8bfaa;font-size:12px;margin:8px 0 0;padding-left:18px;line-height:1.7">
          <li><strong>Finish Line &amp; JD Sports</strong> — faster card/CVV fill on first visit</li>
          <li><strong>Supreme (online)</strong> — dropdown crash fix on the new checkout</li>
          <li><strong>Shopify-powered stores</strong> — Kith, BAPE, Stussy, Palace, Awake, Brain Dead, Pleasures, Carrots, Madhappy, Aimé Leon Dore, Bodega, Concepts, Extra Butter, Union LA, and thousands more</li>
          <li><strong>SPA checkouts</strong> — Nike, JD now wait properly for fields to render before filling</li>
        </ul>
      </div>

      <div style="background:#1a1400;border:1px solid #7a5e1e;border-radius:6px;padding:14px 18px;margin-bottom:20px">
        <p style="color:#c9a84c;font-size:12px;font-weight:700;letter-spacing:0.08em;margin:0 0 8px">⚠ RUNNING v2.1 OR EARLIER? READ THIS</p>
        <p style="color:#e8c878;font-size:12px;line-height:1.6;margin:0">
          One-time re-install required. v2.1 didn't have the auto-update system, so you'll need to download the new zip below and load it fresh. After this, future updates (like the next checkout improvement or supported site) apply with a single <strong>Apply Now</strong> click in the popup — no more re-installs.
        </p>
      </div>

      <p style="margin:24px 0 8px">
        <a href="${downloadUrl}" style="background:#c9a84c;color:#080808;padding:12px 28px;border-radius:5px;text-decoration:none;font-weight:700;font-family:monospace;font-size:14px">Download v${version}</a>
      </p>
      <p style="color:#7a6f56;font-size:11px;margin:8px 0 24px">
        On v2.2.0+? Just click <strong style="color:#c9a84c">Apply Now</strong> in the popup. Re-download only if you're switching computers, installing fresh, or want the in-store waitlist feature.
      </p>

      <div style="background:#181818;border-radius:6px;padding:16px 20px;margin-bottom:24px">
        <p style="color:#c9a84c;font-size:12px;font-weight:700;letter-spacing:0.08em;margin:0 0 12px">📦 INSTALL INSTRUCTIONS</p>
        <ol style="color:#c8bfaa;font-size:12px;margin:0;padding-left:20px;line-height:1.9">
          <li>Click <strong style="color:#f0e6c8">Download v${version}</strong> above to grab the zip</li>
          <li>Unzip the file to a folder you'll remember (Desktop is fine)</li>
          <li>Open Chrome and go to <strong style="color:#f0e6c8">chrome://extensions</strong></li>
          <li>If you have an old version installed, click <strong style="color:#f0e6c8">Remove</strong> on it first</li>
          <li>Toggle <strong style="color:#f0e6c8">Developer Mode</strong> ON (top-right corner)</li>
          <li>Click <strong style="color:#f0e6c8">Load Unpacked</strong> (top-left)</li>
          <li>Select the unzipped folder you saved in step 2</li>
          <li>Click the Finest extension icon → enter your licence key → done</li>
        </ol>
        <p style="color:#7a6f56;font-size:11px;margin:12px 0 0;font-style:italic">Your profiles are stored in Chrome, not in the extension files — re-installing won't erase them. They'll come right back once you enter your key.</p>
      </div>

      <p style="color:#7a6f56;font-size:11px;margin:0">
        Lost your licence key? <a href="https://finest-license-server-production.up.railway.app/recover" style="color:#c9a84c;text-decoration:underline">Recover it here</a>.
      </p>

      <hr style="border:none;border-top:1px solid #1e1e1e;margin:28px 0"/>
      <p style="color:#3a3530;font-size:11px">Questions? Reply to this email.<br/>Finest Checkouts — Only the finest.</p>
    </div>`;

  const emails = [...new Set(
    Object.values(keys)
      .map(r => r.email)
      .filter(e => e && e !== 'manual' && e !== 'unknown' && e.includes('@'))
  )];

  let sent = 0, failed = 0;
  for (const email of emails) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject: `Finest Checkouts v${version} — In-store waitlist auto-booking + checkout upgrades`, html }),
      });
      if (r.ok) { sent++; console.log(`[Broadcast] Sent to ${email}`); }
      else { failed++; console.error(`[Broadcast] Failed ${email}:`, await r.text()); }
    } catch (err) {
      failed++;
      console.error(`[Broadcast] Error ${email}:`, err.message);
    }
    // Small delay to stay within Resend rate limits
    await new Promise(r => setTimeout(r, 100));
  }

  return res.json({ sent, failed, total: emails.length });
});

// ─────────────────────────────────────────────
// POST /revoke
// ─────────────────────────────────────────────
app.post('/revoke', (req, res) => {
  const { secret, key } = req.body;
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });

  const keys   = loadKeys();
  const record = keys[key?.toUpperCase()];
  if (!record) return res.json({ error: 'Key not found' });

  record.status      = 'inactive';
  record.revokedAt   = new Date().toISOString();
  record.revokedReason = 'manual';
  saveKeys(keys);
  return res.json({ revoked: true });
});

// ─────────────────────────────────────────────
// GET /admin/keys
// ─────────────────────────────────────────────
app.get('/admin/keys', (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  return res.json(loadKeys());
});

// ─────────────────────────────────────────────
// POST /admin/delete
// ─────────────────────────────────────────────
app.post('/admin/delete', (req, res) => {
  const { secret, key } = req.body;
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  const keys = loadKeys();
  if (!keys[key?.toUpperCase()]) return res.json({ error: 'Key not found' });
  delete keys[key.toUpperCase()];
  saveKeys(keys);
  console.log(`[Admin] Deleted key ${key.toUpperCase()}`);
  return res.json({ deleted: true });
});

// ─────────────────────────────────────────────
// GET /admin
// ─────────────────────────────────────────────
app.get('/admin', (req, res) => {
  const secret = req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) {
    return res.send(`<!DOCTYPE html><html><head><title>Admin Login</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{background:#080808;color:#f0e6c8;font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;}
      form{background:#101010;border:1px solid #252525;border-radius:8px;padding:32px;width:320px;display:flex;flex-direction:column;gap:14px;}
      h2{color:#c9a84c;font-size:14px;letter-spacing:0.1em;}
      input{background:#181818;border:1px solid #252525;border-radius:5px;color:#f0e6c8;font-family:monospace;font-size:13px;padding:10px 12px;width:100%;outline:none;}
      input:focus{border-color:#7a5e1e;}
      button{background:#c9a84c;border:none;border-radius:5px;color:#080808;font-family:monospace;font-size:13px;font-weight:700;padding:11px;cursor:pointer;}
      button:hover{background:#e4be6a;}
    </style></head><body>
    <form method="GET" action="/admin">
      <h2>FINEST ADMIN</h2>
      <input type="password" name="secret" placeholder="Admin secret" required autofocus/>
      <button type="submit">Login</button>
    </form></body></html>`);
  }

  const keys = loadKeys();
  const active   = Object.entries(keys).filter(([,r]) => r.status === 'active');
  const inactive = Object.entries(keys).filter(([,r]) => r.status !== 'active');
  const pendingEmails = Object.entries(keys).filter(
    ([,r]) => r.status === 'active' && r.email && r.email.includes('@') && r.emailSent === false
  );

  function row(key, record, isActive) {
    const source = record.source || '—';
    const email  = record.email || record.discordTag || '—';
    const date   = record.createdAt ? new Date(record.createdAt).toLocaleDateString() : '—';
    const lastSeen = record.lastSeen ? new Date(record.lastSeen).toLocaleString() : '—';
    const revoked = record.revokedReason || '—';
    const hasEmail = record.email && record.email.includes('@');
    return `
      <tr>
        <td class="key-cell">${key}</td>
        <td><span class="email-cell" data-key="${key}">${email}</span></td>
        <td>${source}</td>
        <td>${date}</td>
        ${!isActive ? `<td>${revoked}</td>` : `<td>${lastSeen}</td>`}
        <td>
          <button class="btn-edit" onclick="editEmail('${key}')" title="Edit email on file">Edit</button>
          ${isActive && hasEmail ? `<button class="btn-email" onclick="resendKey('${key}')" title="Re-send licence email">📧 Send</button>` : ''}
          ${isActive ? `<button class="btn-revoke" onclick="revokeKey('${key}')">Revoke</button>` : ''}
          <button class="btn-delete" onclick="deleteKey('${key}')">Delete</button>
        </td>
      </tr>`;
  }

  res.send(`<!DOCTYPE html><html><head><title>Finest Admin</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{background:#080808;color:#f0e6c8;font-family:monospace;font-size:12px;padding:24px;}
    h1{color:#c9a84c;font-size:16px;letter-spacing:0.1em;margin-bottom:20px;}
    .tabs{display:flex;gap:2px;margin-bottom:16px;}
    .tab{padding:8px 18px;background:#101010;border:1px solid #252525;border-radius:5px 5px 0 0;cursor:pointer;color:#6a6050;}
    .tab.active{background:#181818;border-bottom-color:#181818;color:#c9a84c;}
    .panel{display:none;background:#181818;border:1px solid #252525;border-radius:0 5px 5px 5px;padding:16px;}
    .panel.active{display:block;}
    table{width:100%;border-collapse:collapse;}
    th{text-align:left;color:#6a6050;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;padding:6px 10px;border-bottom:1px solid #252525;}
    td{padding:8px 10px;border-bottom:1px solid #151515;vertical-align:middle;}
    .key-cell{color:#c9a84c;letter-spacing:0.06em;}
    tr:hover td{background:#1e1e1e;}
    .btn-revoke{background:#3a2a0a;border:1px solid #7a5e1e;color:#c9a84c;font-family:monospace;font-size:10px;padding:3px 10px;border-radius:4px;cursor:pointer;margin-right:4px;}
    .btn-revoke:hover{background:#5a3e10;}
    .btn-delete{background:#2a0a0a;border:1px solid #7a1e1e;color:#c06060;font-family:monospace;font-size:10px;padding:3px 10px;border-radius:4px;cursor:pointer;}
    .btn-delete:hover{background:#4a1010;}
    .btn-edit{background:#181818;border:1px solid #444;color:#888;font-family:monospace;font-size:10px;padding:3px 10px;border-radius:4px;cursor:pointer;margin-right:4px;}
    .btn-edit:hover{background:#252525;color:#c8bfaa;border-color:#666;}
    .btn-email{background:#0a1a2a;border:1px solid #2a5a7a;color:#7eb8e0;font-family:monospace;font-size:10px;padding:3px 10px;border-radius:4px;cursor:pointer;margin-right:4px;}
    .btn-email:hover{background:#15324a;}
    .gen-form{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;}
    .gen-form input{background:#101010;border:1px solid #252525;border-radius:4px;color:#f0e6c8;font-family:monospace;font-size:12px;padding:7px 10px;outline:none;}
    .gen-form input:focus{border-color:#7a5e1e;}
    .btn-gen{background:#c9a84c;border:none;border-radius:4px;color:#080808;font-family:monospace;font-size:12px;font-weight:700;padding:7px 16px;cursor:pointer;}
    .btn-gen:hover{background:#e4be6a;}
    .count{color:#6a6050;font-size:11px;margin-bottom:10px;}
    .toast{position:fixed;bottom:20px;right:20px;background:#181818;border:1px solid #7a5e1e;color:#c9a84c;padding:10px 16px;border-radius:6px;font-size:12px;display:none;}
    .alert{background:#2a0a0a;border:1px solid #c06060;border-radius:5px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;}
    .alert-text{color:#e89898;font-size:12px;}
    .alert-text strong{color:#f0c0c0;}
    .btn-retry{background:#c06060;border:none;border-radius:4px;color:#080808;font-family:monospace;font-size:11px;font-weight:700;padding:7px 14px;cursor:pointer;white-space:nowrap;}
    .btn-retry:hover{background:#e08080;}
  </style></head>
  <body>
  <h1>FINEST ADMIN</h1>

  ${pendingEmails.length ? `
  <div class="alert">
    <div class="alert-text">
      <strong>⚠ ${pendingEmails.length} licence ${pendingEmails.length === 1 ? 'email' : 'emails'} failed to send.</strong>
      Purchases went through but recipients haven't received their keys. Resend will retry automatically every 10 min — or click below to retry now.
    </div>
    <button class="btn-retry" onclick="retryEmails()">↻ Retry Now</button>
  </div>` : ''}

  <div class="gen-form">
    <input id="gen-email" placeholder="Email or note" style="width:200px"/>
    <input id="gen-plan" placeholder="Plan (member)" style="width:130px"/>
    <button class="btn-gen" onclick="generateKey()">+ Generate Key</button>
    <button class="btn-gen" style="background:#3a5a7a;color:#f0e6c8" onclick="reconcileWhop()" title="Pull all active Whop memberships and create keys for any we're missing">↻ Reconcile Whop</button>
  </div>

  <div class="tabs">
    <div class="tab active" onclick="switchTab('active')">Active (${active.length})</div>
    <div class="tab" onclick="switchTab('inactive')">Inactive (${inactive.length})</div>
  </div>

  <div id="panel-active" class="panel active">
    <table>
      <thead><tr><th>Key</th><th>Email / User</th><th>Source</th><th>Created</th><th>Last Seen</th><th>Actions</th></tr></thead>
      <tbody>${active.map(([k,r]) => row(k,r,true)).join('')}</tbody>
    </table>
  </div>

  <div id="panel-inactive" class="panel">
    <table>
      <thead><tr><th>Key</th><th>Email / User</th><th>Source</th><th>Created</th><th>Reason</th><th>Actions</th></tr></thead>
      <tbody>${inactive.map(([k,r]) => row(k,r,false)).join('')}</tbody>
    </table>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const SECRET = '${secret}';

    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', (i===0&&tab==='active')||(i===1&&tab==='inactive')));
      document.getElementById('panel-active').classList.toggle('active', tab==='active');
      document.getElementById('panel-inactive').classList.toggle('active', tab==='inactive');
    }

    function toast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg; t.style.display = 'block';
      setTimeout(() => t.style.display = 'none', 2500);
    }

    async function deleteKey(key) {
      if (!confirm('Delete ' + key + '?')) return;
      const r = await fetch('/admin/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({secret:SECRET, key}) });
      const d = await r.json();
      if (d.deleted) { toast('Deleted ' + key); location.reload(); }
      else toast('Error: ' + (d.error || 'unknown'));
    }

    async function editEmail(key) {
      const current = document.querySelector('.email-cell[data-key="' + key + '"]')?.textContent || '';
      const next = prompt('Edit email for ' + key + ':', current === '—' ? '' : current);
      if (next === null) return; // cancelled
      const trimmed = next.trim();
      const r = await fetch('/admin/edit-key', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({secret:SECRET, key, email: trimmed}) });
      const d = await r.json();
      if (d.ok) { toast('Updated ' + key); location.reload(); }
      else toast('Error: ' + (d.error || 'unknown'));
    }

    async function resendKey(key) {
      if (!confirm('Resend licence email for ' + key + ' to the address on file?')) return;
      toast('Sending...');
      const r = await fetch('/admin/resend-key', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({secret:SECRET, key}) });
      const d = await r.json();
      if (d.ok) toast('Sent to ' + d.email);
      else toast('Error: ' + (d.error || 'send failed'));
    }

    async function revokeKey(key) {
      if (!confirm('Revoke ' + key + '?')) return;
      const r = await fetch('/revoke', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({secret:SECRET, key}) });
      const d = await r.json();
      if (d.revoked) { toast('Revoked ' + key); location.reload(); }
      else toast('Error: ' + (d.error || 'unknown'));
    }

    async function retryEmails() {
      toast('Retrying pending emails...');
      const r = await fetch('/admin/retry-emails', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({secret:SECRET}) });
      const d = await r.json();
      toast('Sent: ' + d.sent + ' / Failed: ' + d.failed);
      setTimeout(() => location.reload(), 1500);
    }

    async function reconcileWhop() {
      if (!confirm('Pull active memberships from Whop and create keys for any we are missing?')) return;
      toast('Checking Whop... this may take a minute');
      const r = await fetch('/admin/reconcile-whop', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({secret:SECRET}) });
      const d = await r.json();
      if (d.error) { toast('Error: ' + d.error); return; }
      toast('Whop: ' + d.totalFromWhop + ' / Created: ' + d.created + ' / Emailed: ' + d.emailed);
      setTimeout(() => location.reload(), 2500);
    }

    async function generateKey() {
      const email = document.getElementById('gen-email').value || 'manual';
      const plan  = document.getElementById('gen-plan').value  || 'member';
      const r = await fetch('/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({secret:SECRET, email, plan}) });
      const d = await r.json();
      if (d.key) { toast('Generated: ' + d.key); location.reload(); }
      else toast('Error: ' + (d.error || 'unknown'));
    }
  </script>
  </body></html>`);
});

// ─────────────────────────────────────────────
// POST /admin/assign-roles
// Assigns Checkout Goat role to all active Discord keys
// ─────────────────────────────────────────────
app.post('/admin/assign-roles', async (req, res) => {
  if (req.body.secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  const keys = loadKeys();
  let assigned = 0, skipped = 0, failed = 0;
  for (const [key, record] of Object.entries(keys)) {
    if (record.status !== 'active' || !record.discordUserId) { skipped++; continue; }
    try {
      await assignMemberRole(record.discordUserId);
      assigned++;
      await new Promise(r => setTimeout(r, 300)); // avoid rate limits
    } catch {
      failed++;
    }
  }
  console.log(`[Admin] assign-roles: ${assigned} assigned, ${skipped} skipped, ${failed} failed`);
  return res.json({ assigned, skipped, failed });
});

// ─────────────────────────────────────────────
// GET /version
// ─────────────────────────────────────────────
app.get('/version', (req, res) => {
  res.json({
    version:     process.env.CURRENT_VERSION || '2.2.3',
    downloadUrl: EXTENSION_DOWNLOAD_URL || null,
    scripts: {
      fnl:             `${SERVER_URL}/scripts/fnl.js`,
      fnlPci:          `${SERVER_URL}/scripts/fnl-pci.js`,
      aio:             `${SERVER_URL}/scripts/aio.js`,
      shopify:         `${SERVER_URL}/scripts/shopify.js`,
      supremeCheckout: `${SERVER_URL}/scripts/supreme-checkout.js`,
      supremeShop:     `${SERVER_URL}/scripts/supreme-shop.js`,
      adyenPci:        `${SERVER_URL}/scripts/adyen-pci.js`,
      supremePci:      `${SERVER_URL}/scripts/supreme-pci.js`,
      waitwhile:       `${SERVER_URL}/scripts/waitwhile.js`,
    },
  });
});

// ─────────────────────────────────────────────
// GET /health
// ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Discord Bot — real-time role & leave event listener ──────────────────────
// Connects to Discord gateway via WebSocket. Discord pushes events instantly
// when someone loses a role or leaves the server — no polling needed.

function revokeByDiscordUser(userId, reason) {
  const keys   = loadKeys();
  let changed  = false;
  for (const [key, record] of Object.entries(keys)) {
    if (record.discordUserId === userId && record.status === 'active') {
      record.status        = 'inactive';
      record.revokedAt     = new Date().toISOString();
      record.revokedReason = reason;
      changed = true;
      console.log(`[Bot] Revoked ${key} — userId ${userId} — reason: ${reason}`);
    }
  }
  if (changed) saveKeys(keys);
}

const discordBot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// Fires when a member's roles change
discordBot.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
  if (newMember.guild.id !== DISCORD_SERVER_ID) return;

  // Find roles that were just removed
  const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
  if (removedRoles.size === 0) return;

  // Only care if a qualifying role was removed
  const lostQualifying = removedRoles.some(r => QUALIFYING_ROLES.includes(r.name.toLowerCase()));
  if (!lostQualifying) return;

  // Keep access if they still hold another qualifying role
  const stillQualifies = newMember.roles.cache.some(r => QUALIFYING_ROLES.includes(r.name.toLowerCase()));
  if (stillQualifies) return;

  revokeByDiscordUser(newMember.user.id, 'discord_role_lost');
});

// Fires when a member leaves or is kicked/banned
discordBot.on(Events.GuildMemberRemove, (member) => {
  if (member.guild.id !== DISCORD_SERVER_ID) return;
  revokeByDiscordUser(member.user.id, 'left_server');
});

discordBot.once(Events.ClientReady, c => {
  console.log(`[Bot] Connected as ${c.user.tag} — listening for role and leave events`);
});

discordBot.on('error', err => console.error('[Bot] Error:', err.message));

if (DISCORD_BOT_TOKEN) {
  discordBot.login(DISCORD_BOT_TOKEN).catch(err => console.error('[Bot] Login failed:', err.message));
} else {
  console.warn('[Bot] DISCORD_BOT_TOKEN not set — real-time revocation disabled');
}

// ── Weekly safety-net cron ────────────────────────────────────────────────────
// Runs Sunday 10 AM UTC. Catches anything the bot missed during downtime.
// Makes one API call per active Discord key — typically a tiny number.
cron.schedule('0 10 * * 0', async () => {
  console.log('[Cron] Weekly safety-net check starting');
  const keys  = loadKeys();
  let changed = false;

  for (const [key, record] of Object.entries(keys)) {
    if (record.status !== 'active' || record.source !== 'discord') continue;
    if (!record.discordUserId) continue;
    try {
      const { qualifies } = await checkMemberQualifies(record.discordUserId);
      record.lastChecked  = new Date().toISOString();
      if (!qualifies) {
        record.status        = 'inactive';
        record.revokedAt     = new Date().toISOString();
        record.revokedReason = 'discord_role_lost_cron';
        changed = true;
        console.log(`[Cron] Revoked ${key} — ${record.discordTag}`);
      }
      await new Promise(r => setTimeout(r, 500)); // avoid rate limits
    } catch (err) {
      console.error(`[Cron] Error checking ${key}:`, err.message);
    }
  }
  if (changed) saveKeys(keys);
  console.log('[Cron] Weekly check done');
});

// ── Email retry cron — every 10 minutes ───────────────────────────────────────
// Retries any keys with emailSent=false (e.g. emails that failed during
// Resend outage). Cheap no-op when nothing is pending.
cron.schedule('*/10 * * * *', () => { retryPendingEmails().catch(() => {}); });

app.listen(PORT, () => {
  console.log(`Finest License Server running on port ${PORT}`);
  // On startup, retry any emails that failed previously (e.g. during downtime).
  // Runs once after a short delay so Resend connectivity is settled.
  setTimeout(() => { retryPendingEmails().catch(() => {}); }, 5000);
});
