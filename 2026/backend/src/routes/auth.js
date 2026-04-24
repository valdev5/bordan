const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { db } = require('../db/conn');
const { getSecret } = require('../middleware/auth');
const { audit } = require('./helpers');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  db.get('SELECT id, username, password_hash, role FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const payload = { sub: user.id, username: user.username, role: user.role };
    const token = jwt.sign(payload, getSecret(), { expiresIn: '8h' });

    audit(user.id, 'LOGIN', 'USER', user.id);

    return res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role }
    });
  });
});

// POST /api/auth/logout (optional: audit)
router.post('/logout', (req, res) => {
  // Frontend clears token; this endpoint is only to log.
  const { user_id } = req.body || {};
  if (user_id) audit(user_id, 'LOGOUT', 'USER', user_id);
  return res.json({ ok: true });
});

module.exports = router;
