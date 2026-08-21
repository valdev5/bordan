const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { db } = require('../db/conn');
const { getSecret, requireAuth, requireRole } = require('../middleware/auth');
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

// POST /api/auth/users (manager only) - cree un compte (worker/manager/compta)
router.post('/users', requireAuth, requireRole('manager'), (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const role = String(req.body?.role || '').trim();

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  if (!['manager', 'worker', 'compta'].includes(role)) {
    return res.status(400).json({ error: 'role must be manager, worker or compta' });
  }

  db.get('SELECT id FROM users WHERE username = ?', [username], async (err, existing) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (existing) return res.status(409).json({ error: 'Ce nom d\'utilisateur existe deja' });

    const hash = await bcrypt.hash(password, 12);
    db.run(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username, hash, role],
      function (err2) {
        if (err2) return res.status(500).json({ error: 'DB error' });
        audit(req.user.sub, 'CREATE_USER', 'USER', this.lastID, { username, role });
        return res.json({ id: this.lastID, username, role });
      },
    );
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
