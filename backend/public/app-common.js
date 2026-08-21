// Utilitaires communs (stockage partage + helpers)
const Store = (() => {
  const KEY_DEVIS = 'app:devis:list';
  const KEY_BONS = 'app:bons:list';
  const SERVER_KEYS = {
    [KEY_DEVIS]: 'devis',
    [KEY_BONS]: 'bons',
  };

  const dirtyKeys = new Set();
  const pendingTimers = new Map();
  let syncPromise = null;

  const load = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
      return [];
    }
  };

  const writeLocal = (key, value) => {
    localStorage.setItem(key, JSON.stringify(Array.isArray(value) ? value : []));
  };

  const emitChange = () => {
    window.dispatchEvent(new CustomEvent('shared-store-changed'));
  };

  function removeById(list, id) {
    return list.filter((item) => item.id !== id);
  }

  function upsertByField(list, item, field, forcedId = null) {
    const idx = item[field] ? list.findIndex((entry) => entry[field] === item[field]) : -1;
    const id = forcedId ?? (idx > -1 ? list[idx].id : Date.now());
    const nextItem = { ...item, id };

    if (idx > -1) {
      return [...list.slice(0, idx), nextItem, ...list.slice(idx + 1)];
    }

    return [...list, nextItem];
  }

  async function pushKey(key) {
    const serverKey = SERVER_KEYS[key];
    const hasToken = !!localStorage.getItem('token');

    if (!serverKey || !window.apiFetch || !hasToken) {
      dirtyKeys.delete(key);
      return false;
    }

    await apiFetch(`/state/${serverKey}`, {
      method: 'PUT',
      body: { value: load(key) },
    });

    dirtyKeys.delete(key);
    emitChange();
    return true;
  }

  function schedulePush(key) {
    const currentTimer = pendingTimers.get(key);
    if (currentTimer) {
      clearTimeout(currentTimer);
    }

    const nextTimer = setTimeout(() => {
      pendingTimers.delete(key);
      pushKey(key).catch((error) => {
        console.warn(`Echec de synchro pour ${key}`, error);
      });
    }, 250);

    pendingTimers.set(key, nextTimer);
  }

  function save(key, value, options = {}) {
    writeLocal(key, value);

    if (!options.skipRemote) {
      dirtyKeys.add(key);
      schedulePush(key);
      emitChange();
    }

    return value;
  }

  async function syncFromServer() {
    const hasToken = !!localStorage.getItem('token');
    if (!window.apiFetch || !hasToken) {
      return {
        devis: load(KEY_DEVIS),
        bons: load(KEY_BONS),
      };
    }

    if (syncPromise) {
      return syncPromise;
    }

    syncPromise = (async () => {
      const data = await apiFetch('/state');
      const localDevis = load(KEY_DEVIS);
      const localBons = load(KEY_BONS);
      const serverDevis = Array.isArray(data.devis) ? data.devis : [];
      const serverBons = Array.isArray(data.bons) ? data.bons : [];

      if (!dirtyKeys.has(KEY_DEVIS)) {
        if (!serverDevis.length && localDevis.length) {
          dirtyKeys.add(KEY_DEVIS);
          await pushKey(KEY_DEVIS);
        } else {
          writeLocal(KEY_DEVIS, serverDevis);
        }
      }

      if (!dirtyKeys.has(KEY_BONS)) {
        if (!serverBons.length && localBons.length) {
          dirtyKeys.add(KEY_BONS);
          await pushKey(KEY_BONS);
        } else {
          writeLocal(KEY_BONS, serverBons);
        }
      }

      emitChange();

      return {
        devis: load(KEY_DEVIS),
        bons: load(KEY_BONS),
      };
    })();

    try {
      return await syncPromise;
    } finally {
      syncPromise = null;
    }
  }

  async function flush() {
    const keys = Array.from(dirtyKeys);

    keys.forEach((key) => {
      const timer = pendingTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        pendingTimers.delete(key);
      }
    });

    for (const key of keys) {
      await pushKey(key);
    }
  }

  return {
    KEY_DEVIS,
    KEY_BONS,
    load,
    save,
    flush,
    syncFromServer,
    removeById,
    upsertByField,
  };
})();

window.Store = Store;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
window.today = window.today || (() => new Date().toISOString().slice(0, 10));
window.uid = window.uid || (() => Math.random().toString(36).slice(2, 8) + '-' + Date.now().toString(36));
