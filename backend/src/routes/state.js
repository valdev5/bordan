const express = require('express');

const { db } = require('../db/conn');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('./helpers');

const router = express.Router();

const STATE_KEYS = {
  devis: 'devis',
  bons: 'bons',
};

function loadStateValue(key) {
  return new Promise((resolve, reject) => {
    db.get('SELECT value_json FROM shared_state WHERE key = ?', [key], (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      if (!row?.value_json) {
        resolve([]);
        return;
      }

      try {
        const parsed = JSON.parse(row.value_json);
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch {
        resolve([]);
      }
    });
  });
}

function saveStateValue(key, value) {
  return new Promise((resolve, reject) => {
    db.run(
      `
        INSERT INTO shared_state (key, value_json, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = datetime('now')
      `,
      [key, JSON.stringify(value)],
      (err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve();
      },
    );
  });
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const [devis, bons] = await Promise.all([
      loadStateValue(STATE_KEYS.devis),
      loadStateValue(STATE_KEYS.bons),
    ]);

    res.json({ devis, bons });
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

router.put('/:key', requireAuth, async (req, res) => {
  const key = String(req.params.key || '').trim();
  if (!Object.prototype.hasOwnProperty.call(STATE_KEYS, key)) {
    return res.status(400).json({ error: 'Invalid state key' });
  }

  const value = req.body?.value;
  if (!Array.isArray(value)) {
    return res.status(400).json({ error: 'value must be an array' });
  }

  try {
    await saveStateValue(STATE_KEYS[key], value);
    audit(req.user.sub, 'UPSERT_SHARED_STATE', 'STATE', null, { key, count: value.length });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'DB error' });
  }
});

module.exports = router;
