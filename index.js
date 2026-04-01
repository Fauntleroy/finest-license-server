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
const EXTENSION_DOWNLOAD_URL= process.env.EXTENSION_DOWNLOAD_URL || ''; // set in Railway to your zip URL

// Roles that grant access (role names, lowercase — edit via DISCORD_QUALIFYING_ROLES env var)
const QUALIFYING_ROLES = (process.env.DISCORD_QUALIFYING_ROLES || 'Brick Boy Squad,Cook God,Server Booster')
  .split(',').map(r => r.trim().toLowerCase());

// ── Key store (file-based — swap for DB if you scale) ─────────────────────────
const KEYS_FILE = path.join(__dirname, 'keys.json');

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
app.use(express.json());

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
    const sig      = req.headers['x-whop-signature'] || '';
    const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
    if (sig !== expected) return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;

  // New paid member — issue key
  if (event.action === 'membership.went_valid') {
    const keys    = loadKeys();
    const newKey  = generateKey();
    const email   = event.data?.email   || 'unknown';
    const userId  = event.data?.user_id || event.data?.id || 'unknown';

    keys[newKey] = {
      status:    'active',
      email,
      userId,
      source:    'whop',
      plan:      'member',
      createdAt: new Date().toISOString(),
      lastSeen:  null,
    };
    saveKeys(keys);
    console.log(`[Whop] Key issued for ${email}: ${newKey}`);
    return res.json({ received: true, key: newKey });
  }

  // Membership cancelled / payment failed — revoke key
  if (event.action === 'membership.went_invalid') {
    const userId = event.data?.user_id || event.data?.id;
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
  keys[newKey] = {
    status:    'active',
    email:     email || 'manual',
    source:    'manual',
    plan:      plan  || 'member',
    createdAt: new Date().toISOString(),
    lastSeen:  null,
  };
  saveKeys(keys);
  console.log(`[Manual] Key for ${email}: ${newKey}`);
  return res.json({ key: newKey });
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

app.listen(PORT, () => console.log(`Finest License Server running on port ${PORT}`));
