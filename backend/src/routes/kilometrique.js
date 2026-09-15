const express = require('express');
const { db } = require('../db/conn');
const { requireAuth, requireRole } = require('../middleware/auth');
const { audit } = require('./helpers');

const router = express.Router();

function formatRow(row) {
  let trajets = [];
  try {
    const parsed = JSON.parse(row.trajets_json || '[]');
    trajets = Array.isArray(parsed) ? parsed : [];
  } catch {
    trajets = [];
  }
  return {
    id: row.id,
    username: row.username,
    mois: row.mois,
    trajets,
    total: row.total_km,
    statut: row.statut,
    envoyeLe: row.envoye_le,
    archiveLe: row.archive_le,
  };
}

// GET /api/kilometrique - worker: ses propres feuilles ; manager/compta : toutes
router.get('/', requireAuth, (req, res) => {
  if (req.user.role === 'manager' || req.user.role === 'compta') {
    db.all('SELECT * FROM km_sheets ORDER BY mois DESC, username ASC', [], (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      return res.json(rows.map(formatRow));
    });
  } else {
    db.all('SELECT * FROM km_sheets WHERE user_id = ? ORDER BY mois DESC', [req.user.sub], (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      return res.json(rows.map(formatRow));
    });
  }
});

// PUT /api/kilometrique/:mois (n'importe quel compte connecte) - cree/met a
// jour SA PROPRE feuille du mois (upsert, un renvoi desarchive)
router.put('/:mois', requireAuth, (req, res) => {
  const mois = String(req.params.mois || '').trim();
  if (!/^\d{4}-\d{2}$/.test(mois)) {
    return res.status(400).json({ error: 'mois invalide (format AAAA-MM)' });
  }

  const trajets = Array.isArray(req.body?.trajets) ? req.body.trajets : null;
  if (!trajets || !trajets.length) {
    return res.status(400).json({ error: 'trajets doit etre un tableau non vide' });
  }

  const total = trajets.reduce((sum, t) => sum + (Number(t.oneWay) || 0) * 2, 0);
  const trajetsJson = JSON.stringify(trajets);

  db.run(
    `INSERT INTO km_sheets (user_id, username, mois, trajets_json, total_km, statut, envoye_le, archive_le)
     VALUES (?, ?, ?, ?, ?, 'envoyee', datetime('now'), NULL)
     ON CONFLICT(user_id, mois) DO UPDATE SET
       trajets_json = excluded.trajets_json,
       total_km = excluded.total_km,
       statut = 'envoyee',
       envoye_le = datetime('now'),
       archive_le = NULL`,
    [req.user.sub, req.user.username, mois, trajetsJson, total],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      audit(req.user.sub, 'SEND_KM_SHEET', 'KM_SHEET', null, { mois, count: trajets.length, total });
      db.get('SELECT * FROM km_sheets WHERE user_id = ? AND mois = ?', [req.user.sub, mois], (err2, row) => {
        if (err2 || !row) return res.json({ ok: true });
        return res.json(formatRow(row));
      });
    }
  );
});

// PATCH /api/kilometrique/:id/archiver (manager ou compta) - archive / desarchive
router.patch('/:id/archiver', requireAuth, requireRole('manager', 'compta'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const archive = req.body?.archive !== false;

  db.run(
    'UPDATE km_sheets SET statut = ?, archive_le = ? WHERE id = ?',
    [archive ? 'archivee' : 'envoyee', archive ? new Date().toISOString() : null, id],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
      audit(req.user.sub, archive ? 'ARCHIVE_KM_SHEET' : 'UNARCHIVE_KM_SHEET', 'KM_SHEET', id);
      return res.json({ ok: true });
    }
  );
});

module.exports = router;
