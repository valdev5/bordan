const { db } = require('../db/conn');

function audit(userId, action, entityType = null, entityId = null, meta = null) {
  db.run(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, meta_json)
     VALUES (?, ?, ?, ?, ?)`
    ,
    [userId || null, action, entityType, entityId, meta ? JSON.stringify(meta) : null]
  );
}

// Partage entre state.js (lecture/ecriture de l'etat partage) et trash.js
// (restauration d'un element supprime dans son tableau d'origine).
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

module.exports = { audit, loadStateValue, saveStateValue };
