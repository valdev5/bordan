const express = require('express');

const { db } = require('../db/conn');
const { requireAuth } = require('../middleware/auth');
const { VAPID_PUBLIC_KEY } = require('../push');

const router = express.Router();

router.get('/public-key', requireAuth, (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

router.post('/subscribe', requireAuth, (req, res) => {
  const sub = req.body?.subscription;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }

  db.run(
    `
      INSERT INTO push_subscriptions (username, endpoint, p256dh, auth)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        username = excluded.username,
        p256dh = excluded.p256dh,
        auth = excluded.auth
    `,
    [req.user.username, endpoint, p256dh, auth],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'DB error' });
      }
      return res.json({ ok: true });
    },
  );
});

router.post('/unsubscribe', requireAuth, (req, res) => {
  const endpoint = req.body?.endpoint;
  if (!endpoint) {
    return res.status(400).json({ error: 'endpoint required' });
  }

  db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint], (err) => {
    if (err) {
      return res.status(500).json({ error: 'DB error' });
    }
    return res.json({ ok: true });
  });
});

module.exports = router;
