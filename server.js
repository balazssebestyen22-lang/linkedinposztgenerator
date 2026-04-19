const express = require('express');
const path = require('path');
const app = express();

app.use(express.json({ limit: '2mb' }));

// ── In-memory rate limiter ────────────────────────────────────────────────
const rateLimits = new Map();
const DAILY_LIMIT = 20; // ~10 A+B generálás naponta

function checkRate(ip) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${ip}:${today}`;
  const count = (rateLimits.get(key) || 0) + 1;
  rateLimits.set(key, count);
  // Régi bejegyzések törlése alkalmanként
  if (Math.random() < 0.02) {
    for (const k of rateLimits.keys()) {
      if (!k.endsWith(today)) rateLimits.delete(k);
    }
  }
  return count;
}

// ── Proxy endpoint ────────────────────────────────────────────────────────
app.post('/api/proxy', async (req, res) => {
  const ip = ((req.headers['x-forwarded-for'] || '') + '').split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';

  const count = checkRate(ip);
  const remaining = Math.max(0, DAILY_LIMIT - count);
  res.setHeader('X-RateLimit-Remaining', String(remaining));

  if (count > DAILY_LIMIT) {
    return res.status(429).json({
      error: { message: `Elérted a napi limitet (kb. 10 generálás/nap). Holnap folytathatod! 🙏` }
    });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: { message: 'Szerverhiba: ' + err.message } });
  }
});

// ── Statikus fájlok ───────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Debug ─────────────────────────────────────────────────────────────────
app.get('/debug', (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY || '';
  res.json({
    keySet: !!key,
    keyPrefix: key ? key.slice(0, 10) + '...' : 'NINCS BEÁLLÍTVA'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LinkedIn Generátor fut: http://localhost:${PORT}`));
