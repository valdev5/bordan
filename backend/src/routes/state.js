const express = require('express');

const { db } = require('../db/conn');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('./helpers');
const { sendPushToUsernames } = require('../push');

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

function getTombstonedIds(kind) {
  return new Promise((resolve, reject) => {
    db.all('SELECT item_id FROM deleted_ids WHERE kind = ?', [kind], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(new Set((rows || []).map((row) => row.item_id)));
    });
  });
}

function addTombstone(kind, itemId) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR IGNORE INTO deleted_ids (kind, item_id) VALUES (?, ?)',
      [kind, String(itemId)],
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

function getRolesForUsernames(usernames) {
  return new Promise((resolve) => {
    if (!usernames.length) {
      resolve({});
      return;
    }
    const placeholders = usernames.map(() => '?').join(',');
    db.all(`SELECT username, role FROM users WHERE username IN (${placeholders})`, usernames, (err, rows) => {
      if (err || !rows) {
        resolve({});
        return;
      }
      const map = {};
      rows.forEach((row) => { map[row.username] = row.role; });
      resolve(map);
    });
  });
}

const ROLE_LANDING_PAGE = {
  manager: '/manager.html',
  worker: '/worker.html',
  compta: '/compta.html',
};

async function notifyNewChatMessages(oldBons, newBons) {
  const oldById = new Map(oldBons.map((bon) => [bon.id, bon]));
  const notifications = []; // { recipients: [...], payload }

  for (const bon of newBons) {
    const oldChat = Array.isArray(oldById.get(bon.id)?.chat) ? oldById.get(bon.id).chat : [];
    const newChat = Array.isArray(bon.chat) ? bon.chat : [];
    if (newChat.length <= oldChat.length) continue;

    const addedMessages = newChat.slice(oldChat.length);
    const participants = [...new Set([...(bon.team || []), ...(bon.encadrants || [])])];

    addedMessages.forEach((msg) => {
      const recipients = participants.filter((name) => name && name !== msg.from);
      if (!recipients.length) return;
      notifications.push({
        recipients,
        payload: {
          title: `Message — ${bon.client || 'Chantier'}`,
          body: `${msg.from || 'Quelqu\'un'} : ${String(msg.text || '').slice(0, 120)}`,
          tag: `bon-chat-${bon.id}`,
        },
      });
    });
  }

  if (!notifications.length) return;

  const allRecipients = [...new Set(notifications.flatMap((n) => n.recipients))];
  const roles = await getRolesForUsernames(allRecipients);

  await Promise.all(
    notifications.map(({ recipients, payload }) => {
      // regroupe par page de destination pour un lien pertinent par role
      const byPage = new Map();
      recipients.forEach((name) => {
        const page = ROLE_LANDING_PAGE[roles[name]] || '/';
        if (!byPage.has(page)) byPage.set(page, []);
        byPage.get(page).push(name);
      });

      return Promise.all(
        [...byPage.entries()].map(([url, names]) =>
          sendPushToUsernames(names, { ...payload, url }).catch(() => {}),
        ),
      );
    }),
  );
}

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
    const previousValue = key === 'bons' ? await loadStateValue(STATE_KEYS.bons) : null;

    // Empeche un client dont le cache local est perime de faire revivre un
    // element supprime entre-temps par quelqu'un d'autre (ecrasement lors
    // d'une sauvegarde globale du tableau).
    const tombstoned = await getTombstonedIds(key);
    const cleanedValue = tombstoned.size
      ? value.filter((item) => !tombstoned.has(String(item.id)))
      : value;

    await saveStateValue(STATE_KEYS[key], cleanedValue);
    audit(req.user.sub, 'UPSERT_SHARED_STATE', 'STATE', null, { key, count: cleanedValue.length });

    if (key === 'bons' && previousValue) {
      notifyNewChatMessages(previousValue, cleanedValue).catch((err) => {
        console.warn('Push notification (chat) failed', err);
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'DB error' });
  }
});

// DELETE /api/state/:key/:id - suppression explicite d'un element, avec
// tombstone pour empecher qu'un client perime le ressuscite plus tard
router.delete('/:key/:id', requireAuth, async (req, res) => {
  const key = String(req.params.key || '').trim();
  if (!Object.prototype.hasOwnProperty.call(STATE_KEYS, key)) {
    return res.status(400).json({ error: 'Invalid state key' });
  }

  const id = String(req.params.id || '').trim();
  if (!id) {
    return res.status(400).json({ error: 'id required' });
  }

  try {
    const current = await loadStateValue(STATE_KEYS[key]);
    const next = current.filter((item) => String(item.id) !== id);

    await addTombstone(key, id);
    await saveStateValue(STATE_KEYS[key], next);
    audit(req.user.sub, 'DELETE_SHARED_STATE_ITEM', 'STATE', null, { key, id });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'DB error' });
  }
});

module.exports = router;
