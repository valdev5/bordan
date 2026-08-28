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

  async function deleteItem(key, id) {
    const current = load(key);
    const next = current.filter((item) => String(item.id) !== String(id));
    writeLocal(key, next);
    emitChange();

    const serverKey = SERVER_KEYS[key];
    const hasToken = !!localStorage.getItem('token');
    if (serverKey && window.apiFetch && hasToken) {
      await apiFetch(`/state/${serverKey}/${id}`, { method: 'DELETE' });
    }

    return next;
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
    deleteItem,
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

// Compresse une photo (redimensionnement + JPEG) avant stockage, pour garder des bons legers
window.compressImageFile = window.compressImageFile || function compressImageFile(file, options = {}) {
  const maxDim = options.maxDim || 1600;
  const quality = options.quality || 0.72;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Lecture du fichier impossible'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image illisible'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
};

// Affiche une photo en plein ecran, clic (ou touche) pour fermer
window.openLightbox = window.openLightbox || function openLightbox(url) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `<img src="${url}" alt="Photo chantier">`;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
};

// Flux "Terminer le chantier" : demande si le client est present, capture sa
// signature sur un canvas si oui, ou confirme la cloture sans signature si non.
// Resout avec {present:true, dataUrl} | {present:false} | null (annule).
window.openSignatureFlow = window.openSignatureFlow || function openSignatureFlow() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'sig-overlay';
    overlay.innerHTML = `
      <div class="sig-sheet">
        <div class="sig-step" data-step="ask">
          <h4>Terminer le chantier</h4>
          <p class="sig-sub">Le client est-il present pour signer ?</p>
          <div class="sig-choice-row">
            <button type="button" class="btn outline" data-absent>Non, absent</button>
            <button type="button" class="btn primary" data-present>Oui, present</button>
          </div>
          <span class="sig-back" data-cancel>Annuler</span>
        </div>

        <div class="sig-step" data-step="sign" style="display:none">
          <h4>Signature du client</h4>
          <p class="sig-sub">Faites signer directement sur l'ecran.</p>
          <div class="sig-pad-wrap">
            <canvas class="sig-pad"></canvas>
            <div class="sig-placeholder">Signez ici avec le doigt ou la souris</div>
          </div>
          <div class="sig-actions">
            <button type="button" class="btn" data-clear>Effacer</button>
            <button type="button" class="btn success" data-validate disabled>Valider et terminer</button>
          </div>
          <span class="sig-back" data-back-sign>&larr; Retour</span>
        </div>

        <div class="sig-step" data-step="absent" style="display:none">
          <h4>Client absent</h4>
          <div class="sig-absent-box">
            Le chantier sera marque <strong>termine</strong> sans signature. Sur le document remis au client, la mention <strong>&laquo;&nbsp;Signature client : non recueillie&nbsp;&raquo;</strong> apparaitra a la place.
          </div>
          <button type="button" class="btn" data-confirm-absent style="background:#f59e0b;color:#1a1200;border-color:transparent;width:100%">Confirmer sans signature</button>
          <span class="sig-back" data-back-absent>&larr; Retour</span>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const steps = {
      ask: overlay.querySelector('[data-step="ask"]'),
      sign: overlay.querySelector('[data-step="sign"]'),
      absent: overlay.querySelector('[data-step="absent"]'),
    };
    function showStep(name) {
      Object.values(steps).forEach((el) => { el.style.display = 'none'; });
      steps[name].style.display = '';
    }

    const canvas = overlay.querySelector('.sig-pad');
    const ctx = canvas.getContext('2d');
    const placeholder = overlay.querySelector('.sig-placeholder');
    const btnClear = overlay.querySelector('[data-clear]');
    const btnValidate = overlay.querySelector('[data-validate]');
    let drawing = false;
    let hasStroke = false;
    let padReady = false;

    function pos(event) {
      const rect = canvas.getBoundingClientRect();
      const point = event.touches ? event.touches[0] : event;
      return { x: point.clientX - rect.left, y: point.clientY - rect.top };
    }
    function start(event) {
      drawing = true;
      hasStroke = true;
      placeholder.style.display = 'none';
      btnValidate.disabled = false;
      const point = pos(event);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      event.preventDefault();
    }
    function move(event) {
      if (!drawing) return;
      const point = pos(event);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      event.preventDefault();
    }
    function end() { drawing = false; }

    function setupPad() {
      if (padReady) return;
      padReady = true;
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      ctx.scale(ratio, ratio);
      ctx.strokeStyle = '#0b1015';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      canvas.addEventListener('mousedown', start);
      canvas.addEventListener('mousemove', move);
      window.addEventListener('mouseup', end);
      canvas.addEventListener('touchstart', start, { passive: false });
      canvas.addEventListener('touchmove', move, { passive: false });
      canvas.addEventListener('touchend', end);
    }

    function finish(result) {
      window.removeEventListener('mouseup', end);
      overlay.remove();
      resolve(result);
    }

    overlay.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
    overlay.querySelector('[data-present]').addEventListener('click', () => { showStep('sign'); setupPad(); });
    overlay.querySelector('[data-absent]').addEventListener('click', () => showStep('absent'));
    overlay.querySelector('[data-back-sign]').addEventListener('click', () => showStep('ask'));
    overlay.querySelector('[data-back-absent]').addEventListener('click', () => showStep('ask'));
    overlay.querySelector('[data-confirm-absent]').addEventListener('click', () => finish({ present: false }));
    btnClear.addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasStroke = false;
      placeholder.style.display = '';
      btnValidate.disabled = true;
    });
    btnValidate.addEventListener('click', () => {
      if (!hasStroke) return;
      finish({ present: true, dataUrl: canvas.toDataURL('image/png') });
    });
  });
};

// Rend le badge lecture-seule "Chantier termine" (signe ou non) a partir d'un
// objet bon.signature = {present, dataUrl, from, ts, date}. Partage entre
// worker/manager/compta pour un rendu identique partout.
window.renderSignatureStatusHtml = window.renderSignatureStatusHtml || function renderSignatureStatusHtml(signature) {
  if (!signature) return '';
  if (signature.present && signature.dataUrl) {
    return `
      <div class="sig-status signed">
        <img src="${signature.dataUrl}" alt="Signature client">
        <div class="small txt"><strong>Chantier termine</strong>Signe par le client le ${signature.date || ''}</div>
      </div>
    `;
  }
  return `
    <div class="sig-status unsigned">
      <div class="dot"></div>
      <div class="small txt"><strong>Chantier termine</strong>Signature client non recueillie ${signature.date ? `— ${signature.date}` : ''}</div>
    </div>
  `;
};

// Notifications push (nouveaux messages chantier)
window.Push = (() => {
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  function isSupported() {
    // Sur iOS/iPadOS, Notification/PushManager n'existent (et ne fonctionnent)
    // que si l'appli est installee sur l'ecran d'accueil (mode standalone) ;
    // dans Safari normal, meme si les objets existent, ca ne marche pas.
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isIOS && !isStandalone) return false;

    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  async function getExistingSubscription() {
    if (!isSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!reg) return null;
    return reg.pushManager.getSubscription();
  }

  async function status() {
    if (!isSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    const sub = await getExistingSubscription();
    return sub ? 'subscribed' : 'available';
  }

  async function subscribe() {
    if (!isSupported()) throw new Error('Notifications non supportées sur ce navigateur.');

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Permission refusée.');
    }

    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const { publicKey } = await window.apiFetch('/push/public-key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await window.apiFetch('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    return sub;
  }

  async function unsubscribe() {
    const sub = await getExistingSubscription();
    if (!sub) return;
    await window.apiFetch('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }

  return { isSupported, status, subscribe, unsubscribe };
})();

// Cablage generique du bouton "#btn-push" s'il est present sur la page
(async function initPushButton() {
  const btn = document.getElementById('btn-push');
  if (!btn || !window.Push.isSupported()) {
    if (btn) btn.style.display = 'none';
    return;
  }

  async function refreshLabel() {
    const state = await window.Push.status();
    if (state === 'subscribed') {
      btn.textContent = 'Notifications activées';
      btn.disabled = false;
      btn.classList.add('active');
    } else if (state === 'denied') {
      btn.textContent = 'Notifications bloquées';
      btn.disabled = true;
    } else {
      btn.textContent = 'Activer les notifications';
      btn.disabled = false;
      btn.classList.remove('active');
    }
  }

  btn.addEventListener('click', async () => {
    const state = await window.Push.status();
    btn.disabled = true;
    try {
      if (state === 'subscribed') {
        await window.Push.unsubscribe();
      } else {
        await window.Push.subscribe();
      }
    } catch (error) {
      alert(error.message || 'Impossible de gérer les notifications.');
    }
    await refreshLabel();
  });

  refreshLabel();
})();

// Lien calendrier (flux iCal a ajouter dans Google Calendar / Outlook)
(function initCalendarLinkButton() {
  const btn = document.getElementById('btn-calendar-link');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const { token } = await window.apiFetch('/calendar/token');
      const url = `${location.origin}/calendar/${token}.ics`;

      try {
        await navigator.clipboard.writeText(url);
        alert(
          `Lien copié !\n\n${url}\n\nDans Google Calendar : "Ajouter un agenda" → "À partir de l'URL".\nDans Outlook : "Ajouter un calendrier" → "À partir d'Internet".`,
        );
      } catch {
        prompt('Copiez ce lien et ajoutez-le dans Google Calendar ou Outlook :', url);
      }
    } catch (error) {
      alert(error.message || 'Impossible de récupérer le lien calendrier.');
    }
    btn.disabled = false;
  });
})();

// Changer son propre mot de passe
(function initChangePasswordButton() {
  const btn = document.getElementById('btn-change-password');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const currentPassword = prompt('Votre mot de passe actuel :');
    if (!currentPassword) return;

    const newPassword = prompt('Nouveau mot de passe (au moins 4 caractères) :');
    if (!newPassword) return;

    const confirmPassword = prompt('Retapez le nouveau mot de passe :');
    if (newPassword !== confirmPassword) {
      alert('Les deux mots de passe ne correspondent pas. Rien n\'a été changé.');
      return;
    }

    btn.disabled = true;
    try {
      await window.apiFetch('/auth/password', { method: 'PATCH', body: { currentPassword, newPassword } });
      alert('Mot de passe changé avec succès.');
    } catch (error) {
      alert(error.message || 'Impossible de changer le mot de passe.');
    }
    btn.disabled = false;
  });
})();

// Menu deroulant "Options" (installer l'appli / notifications)
(function initOptionsMenu() {
  const trigger = document.getElementById('btn-options');
  const panel = document.getElementById('options-panel');
  if (!trigger || !panel) return;

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    panel.classList.toggle('open');
  });

  document.addEventListener('click', (event) => {
    if (panel.classList.contains('open') && !panel.contains(event.target) && event.target !== trigger) {
      panel.classList.remove('open');
    }
  });

  panel.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => panel.classList.remove('open'));
  });
})();

// Enregistre le service worker en continu (necessaire pour l'installation de
// l'appli, independamment de l'activation des notifications)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Installation de l'appli (PWA) sur l'ecran d'accueil
(function initInstallButton() {
  const btn = document.getElementById('btn-install');
  if (!btn) return;

  let deferredPrompt = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  }

  function refresh() {
    if (isStandalone()) {
      btn.style.display = 'none';
      return;
    }
    if (deferredPrompt || isIOS()) {
      btn.style.display = '';
      btn.textContent = "Installer l'appli";
      return;
    }
    btn.style.display = 'none';
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    refresh();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    refresh();
  });

  btn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      refresh();
      return;
    }

    if (isIOS()) {
      alert('Sur iPhone/iPad : appuyez sur le bouton Partager (carré avec une flèche vers le haut), puis "Sur l\'écran d\'accueil".');
    }
  });

  refresh();
})();
