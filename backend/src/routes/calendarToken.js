const express = require('express');
const crypto = require('crypto');

const { db } = require('../db/conn');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function getOrCreateToken(username) {
  return new Promise((resolve, reject) => {
    db.get('SELECT token FROM calendar_tokens WHERE username = ?', [username], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      if (row?.token) {
        resolve(row.token);
        return;
      }

      const token = crypto.randomBytes(24).toString('hex');
      db.run(
        'INSERT INTO calendar_tokens (username, token) VALUES (?, ?)',
        [username, token],
        (insertErr) => {
          if (insertErr) {
            reject(insertErr);
            return;
          }
          resolve(token);
        },
      );
    });
  });
}

router.get('/token', requireAuth, async (req, res) => {
  try {
    const token = await getOrCreateToken(req.user.username);
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

module.exports = router;
