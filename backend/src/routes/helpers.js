const { db } = require('../db/conn');

function audit(userId, action, entityType = null, entityId = null, meta = null) {
  db.run(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, meta_json)
     VALUES (?, ?, ?, ?, ?)`
    ,
    [userId || null, action, entityType, entityId, meta ? JSON.stringify(meta) : null]
  );
}

module.exports = { audit };
