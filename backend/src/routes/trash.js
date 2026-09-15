const express = require('express');

const { db } = require('../db/conn');
const { requireAuth, requireRole } = require('../middleware/auth');
const { audit, loadStateValue, saveStateValue } = require('./helpers');

const router = express.Router();

const STATE_KEYS = {
  devis: 'devis',
  bons: 'bons',
};

function displayLabel(kind, item) {
  if (!item) {
    return '';
  }
  if (kind === 'devis') {
    return item.client || item.raw?.['devis.nom'] || '';
  }
  return item.client || item.raw?.['bon.client_nom'] || '';
}

function displayNum(kind, item) {
  if (!item) {
    return '';
  }
  return kind === 'devis' ? (item.num || '') : (item.num_devis || '');
}

// GET /api/trash - manager uniquement : derniers elements supprimes
// (devis/bons), avec de quoi les identifier et les restaurer.
router.get('/', requireAuth, requireRole('manager'), (req, res) => {
  db.all(
    'SELECT id, kind, item_id, item_json, deleted_by, deleted_at FROM trash ORDER BY id DESC LIMIT 200',
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'DB error' });
      }

      const items = (rows || []).map((row) => {
        let item = null;
        try {
          item = JSON.parse(row.item_json);
        } catch {
          item = null;
        }
        return {
          id: row.id,
          kind: row.kind,
          client: displayLabel(row.kind, item),
          num: displayNum(row.kind, item),
          deletedBy: row.deleted_by || '',
          deletedAt: row.deleted_at,
        };
      });

      return res.json(items);
    },
  );
});

// POST /api/trash/:id/restore - manager uniquement : remet l'element dans
// son tableau d'origine (fusion par id, comme une sauvegarde normale) et
// leve le tombstone pour que la restauration ne soit pas aussitot annulee.
router.post('/:id/restore', requireAuth, requireRole('manager'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  db.get('SELECT * FROM trash WHERE id = ?', [id], async (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'DB error' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Element introuvable dans la corbeille' });
    }
    if (!Object.prototype.hasOwnProperty.call(STATE_KEYS, row.kind)) {
      return res.status(400).json({ error: 'Type invalide' });
    }

    let item;
    try {
      item = JSON.parse(row.item_json);
    } catch {
      return res.status(500).json({ error: 'Donnee corrompue' });
    }

    try {
      const current = await loadStateValue(STATE_KEYS[row.kind]);
      const withoutDup = current.filter((entry) => String(entry.id) !== String(item.id));
      await saveStateValue(STATE_KEYS[row.kind], [...withoutDup, item]);

      await new Promise((resolve, reject) => {
        db.run(
          'DELETE FROM deleted_ids WHERE kind = ? AND item_id = ?',
          [row.kind, row.item_id],
          (delErr) => (delErr ? reject(delErr) : resolve()),
        );
      });

      await new Promise((resolve, reject) => {
        db.run('DELETE FROM trash WHERE id = ?', [id], (delErr) => (delErr ? reject(delErr) : resolve()));
      });

      audit(req.user.sub, 'RESTORE_TRASH_ITEM', 'STATE', null, { kind: row.kind, itemId: row.item_id });

      return res.json({ ok: true });
    } catch (restoreErr) {
      return res.status(500).json({ error: 'DB error' });
    }
  });
});

module.exports = router;
