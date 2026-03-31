require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Simple file-based key store (swap for a DB later if needed) ──
const KEYS_FILE = path.join(__dirname, 'keys.json');

function loadKeys() {
  if (!fs.existsSync(KEYS_FILE)) fs.writeFileSync(KEYS_FILE, '{}');
  return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
}

function saveKeys(keys) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}

// ── Key format: FINEST-XXXX-XXXX-XXXX ──
function generateKey() {
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `FINEST-${seg()}-${seg()}-${seg()}`;
}

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
// POST /validate
// Body: { key: "FINEST-XXXX-XXXX-XXXX" }
// Returns: { valid: true/false, message: "..." }
// ─────────────────────────────────────────────
app.post('/validate', (req, res) => {
  const { key } = req.body;

  if (!key || typeof key !== 'string') {
    return res.json({ valid: false, message: 'No key provided.' });
  }

  const keys    = loadKeys();
  const record  = keys[key.trim().toUpperCase()];

  if (!record) {
    return res.json({ valid: false, message: 'Invalid license key.' });
  }

  if (record.status !== 'active') {
    return res.json({ valid: false, message: 'License is inactive.' });
  }

  // Update last seen
  record.lastSeen = new Date().toISOString();
  saveKeys(keys);

  return res.json({ valid: true, message: 'License valid.', plan: record.plan || 'member' });
});

// ─────────────────────────────────────────────
// POST /whop-webhook
// Called by Whop when a payment succeeds
// Generates a key and stores it
// ─────────────────────────────────────────────
app.post('/whop-webhook', (req, res) => {
  const secret = process.env.WHOP_WEBHOOK_SECRET;

  // Verify Whop signature
  if (secret) {
    const sig       = req.headers['x-whop-signature'] || '';
    const body      = JSON.stringify(req.body);
    const expected  = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    if (sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const event = req.body;

  // Only handle successful membership payments
  if (event.action !== 'membership.went_valid') {
    return res.json({ received: true });
  }

  const keys    = loadKeys();
  const newKey  = generateKey();
  const email   = event.data?.email || 'unknown';
  const userId  = event.data?.user_id || event.data?.id || 'unknown';

  keys[newKey] = {
    status    : 'active',
    email     : email,
    userId    : userId,
    plan      : 'member',
    createdAt : new Date().toISOString(),
    lastSeen  : null,
  };

  saveKeys(keys);

  console.log(`[Whop] New key generated for ${email}: ${newKey}`);

  // In production you'd email this key to the user here
  // For now it's logged and stored — you can view it via /admin/keys
  return res.json({ received: true, key: newKey });
});

// ─────────────────────────────────────────────
// POST /generate
// Manual key generation (protected by admin secret)
// Body: { secret: "...", email: "...", plan: "member" }
// ─────────────────────────────────────────────
app.post('/generate', (req, res) => {
  const { secret, email, plan } = req.body;

  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const keys   = loadKeys();
  const newKey = generateKey();

  keys[newKey] = {
    status    : 'active',
    email     : email || 'manual',
    plan      : plan  || 'member',
    createdAt : new Date().toISOString(),
    lastSeen  : null,
  };

  saveKeys(keys);
  console.log(`[Manual] Key generated for ${email}: ${newKey}`);

  return res.json({ key: newKey });
});

// ─────────────────────────────────────────────
// POST /revoke
// Deactivate a key
// Body: { secret: "...", key: "FINEST-XXXX-XXXX-XXXX" }
// ─────────────────────────────────────────────
app.post('/revoke', (req, res) => {
  const { secret, key } = req.body;

  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const keys   = loadKeys();
  const record = keys[key?.toUpperCase()];

  if (!record) return res.json({ error: 'Key not found' });

  record.status = 'inactive';
  saveKeys(keys);

  return res.json({ revoked: true });
});

// ─────────────────────────────────────────────
// GET /admin/keys
// View all keys (protected)
// ─────────────────────────────────────────────
app.get('/admin/keys', (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return res.json(loadKeys());
});

// Health check
app.get('/', (req, res) => res.json({ status: 'Finest License Server running' }));

app.listen(PORT, () => console.log(`Finest License Server on port ${PORT}`));
