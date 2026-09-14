const express = require('express');
const { db } = require('../db/conn');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/audit?limit=100  (manager only)
router.get('/', requireAuth, requireRole('manager'), (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  db.all(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.meta_json, a.created_at,
            u.username AS username, u.role AS role
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC
     LIMIT ?`,
    [limit],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      return res.json(rows);
    }
  );
});

// GET /api/audit/login-count - n'importe quel compte connecte : nombre
// total de connexions enregistrees (pour le petit compteur discret dans
// l'entete, pas besoin d'etre manager pour ca).
router.get('/login-count', requireAuth, (req, res) => {
  db.get("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'LOGIN'", [], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    return res.json({ count: row?.count || 0 });
  });
});

module.exports = router;
