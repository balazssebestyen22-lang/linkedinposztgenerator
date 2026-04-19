const { kv } = require('@vercel/kv');

const DAILY_LIMIT = 20; // ~10 teljes A+B generálás naponta

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // IP azonosítás
  const ip = ((req.headers['x-forwarded-for'] || '') + '').split(',')[0].trim() || 'unknown';
  const today = new Date().toISOString().slice(0, 10);
  const key = `rl:${ip}:${today}`;

  // Rate limiting
  let count = 1;
  try {
    count = await kv.incr(key);
    if (count === 1) await kv.expire(key, 90000); // ~25 óra
  } catch (_) {
    // Ha a KV nem elérhető, engedjük át (fail open)
  }

  const remaining = Math.max(0, DAILY_LIMIT - count);
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Limit', String(DAILY_LIMIT));

  if (count > DAILY_LIMIT) {
    return res.status(429).json({
      error: { message: `Elérted a napi limitet (kb. 10 generálás/nap). Holnap folytathatod! 🙏` }
    });
  }

  // Proxy az Anthropic API felé
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
};
