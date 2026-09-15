const express = require('express');

const { db } = require('../db/conn');
const { requireAuth } = require('../middleware/auth');
const { audit, loadStateValue, saveStateValue } = require('./helpers');
const { sendPushToUsernames } = require('../push');

const router = express.Router();

const STATE_KEYS = {
  devis: 'devis',
  bons: 'bons',
};

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

// Garde une copie complete de l'element supprime (corbeille) : sans ca, une
// fois le tombstone pose et l'element retire de shared_state, sa donnee est
// perdue pour de bon des que tous les postes ont synchronise.
function addToTrash(kind, itemId, item, deletedBy) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO trash (kind, item_id, item_json, deleted_by) VALUES (?, ?, ?, ?)',
      [kind, String(itemId), JSON.stringify(item), deletedBy || null],
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

function getAssignedNames(item, key) {
  const names = key === 'devis'
    ? (item.encadrants || [])
    : [...(item.team || []), ...(item.encadrants || [])];
  return new Set(names.filter(Boolean));
}

// Previent un intervenant/encadrant des qu'il est nouvellement affecte a un
// devis ou un bon (comparaison avec l'etat precedent, item par item) - pas
// de spam si l'affectation etait deja la avant cette sauvegarde.
async function notifyNewAssignments(previousValue, mergedValue, key, actingUsername) {
  const notifications = [];
  const oldById = new Map(previousValue.map((item) => [String(item.id), item]));

  for (const item of mergedValue) {
    const oldItem = oldById.get(String(item.id));
    const oldNames = oldItem ? getAssignedNames(oldItem, key) : new Set();
    const newNames = getAssignedNames(item, key);

    const addedNames = [...newNames].filter((name) => name !== actingUsername && !oldNames.has(name));
    if (!addedNames.length) continue;

    const label = key === 'devis' ? 'Devis' : 'Bon de travail';
    const num = key === 'devis' ? item.num : item.num_devis;
    notifications.push({
      recipients: addedNames,
      payload: {
        title: `Nouvelle affectation — ${item.client || 'Client ?'}`,
        body: [item.objet, num ? `${label} ${num}` : label].filter(Boolean).join(' · '),
        tag: `${key}-assign-${item.id}`,
      },
    });
  }

  if (!notifications.length) return;

  const allRecipients = [...new Set(notifications.flatMap((n) => n.recipients))];
  const roles = await getRolesForUsernames(allRecipients);

  await Promise.all(
    notifications.map(({ recipients, payload }) => {
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
    const previousValue = await loadStateValue(STATE_KEYS[key]);

    // Empeche un client dont le cache local est perime de faire revivre un
    // element supprime entre-temps par quelqu'un d'autre.
    const tombstoned = await getTombstonedIds(key);

    // Fusionne par id au lieu d'ecraser toute la liste : un client dont le
    // cache local est en retard (n'a pas encore vu un element ajoute par un
    // autre poste) ne doit jamais pouvoir le faire disparaitre en sauvegardant
    // sa propre vue partielle. La suppression passe exclusivement par
    // DELETE /state/:key/:id, qui pose un tombstone.
    const byId = new Map(previousValue.map((item) => [String(item?.id), item]));
    value.forEach((item) => {
      if (item?.id == null) return;
      const id = String(item.id);
      if (tombstoned.has(id)) return;
      byId.set(id, item);
    });
    const mergedValue = Array.from(byId.values());

    await saveStateValue(STATE_KEYS[key], mergedValue);
    audit(req.user.sub, 'UPSERT_SHARED_STATE', 'STATE', null, { key, count: mergedValue.length });

    if (key === 'bons') {
      notifyNewChatMessages(previousValue, mergedValue).catch((err) => {
        console.warn('Push notification (chat) failed', err);
      });
    }

    notifyNewAssignments(previousValue, mergedValue, key, req.user.username).catch((err) => {
      console.warn('Push notification (affectation) failed', err);
    });

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
    const removed = current.find((item) => String(item.id) === id);
    const next = current.filter((item) => String(item.id) !== id);

    if (removed) {
      await addToTrash(key, id, removed, req.user.username);
    }
    await addTombstone(key, id);
    await saveStateValue(STATE_KEYS[key], next);
    audit(req.user.sub, 'DELETE_SHARED_STATE_ITEM', 'STATE', null, { key, id });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'DB error' });
  }
});

module.exports = router;
