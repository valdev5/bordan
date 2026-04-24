const express = require('express');
const { db } = require('../db/conn');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('./helpers');

const router = express.Router();

// GET /api/bons
router.get('/', requireAuth, (req, res) => {
  const role = req.user.role;
  if (role === 'worker') {
    db.all('SELECT * FROM bons WHERE assigned_to_user_id = ? ORDER BY id DESC', [req.user.sub], (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      return res.json(rows);
    });
  } else {
    db.all('SELECT * FROM bons ORDER BY id DESC', [], (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      return res.json(rows);
    });
  }
});

// POST /api/bons (manager only)
router.post('/', requireAuth, (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Forbidden' });
  const { title, assigned_to_user_id, status } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });

  db.run(
    'INSERT INTO bons (title, status, assigned_to_user_id, created_by_user_id) VALUES (?, ?, ?, ?)',
    [title, status || 'draft', assigned_to_user_id || null, req.user.sub],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      audit(req.user.sub, 'CREATE_BON', 'BON', this.lastID, { title, assigned_to_user_id: assigned_to_user_id || null, status: status || 'draft' });
      return res.json({ id: this.lastID });
    }
  );
});

// PATCH /api/bons/:id (manager or compta)
router.patch('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  if (!['manager', 'compta'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });

  const allowed = ['title', 'status', 'assigned_to_user_id'];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No fields to update' });

  const fields = Object.keys(patch);
  const setSql = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => patch[f]);

  db.run(
    `UPDATE bons SET ${setSql} WHERE id = ?`,
    [...values, id],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
      audit(req.user.sub, 'UPDATE_BON', 'BON', id, { patch });
      return res.json({ ok: true });
    }
  );
});

module.exports = router;
