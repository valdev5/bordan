/*************************************************
 * worker.js - Espace Intervenant
 * - Affiche les infos cles du bon
 * - Chat intervenant <-> encadrant
 * - Ajout d'heures robuste
 * - Statut personnel
 **************************************************/

const CURRENT_USER = window.Auth?.guard ? Auth.guard('worker') : null;
if (!CURRENT_USER) {
  Auth?.logout?.();
}

const whoami = document.getElementById('whoami');
if (whoami) {
  whoami.textContent = `Connecte : ${CURRENT_USER || '-'}`;
}

document.getElementById('btn-logout')?.addEventListener('click', (event) => {
  event.preventDefault();
  Auth.logout();
});

window.$ = window.$ || ((selector, root = document) => root.querySelector(selector));
window.$$ = window.$$ || ((selector, root = document) => Array.from(root.querySelectorAll(selector)));
const today = () => new Date().toISOString().slice(0, 10);

function isManager(user) {
  return Auth && typeof Auth.isManager === 'function' ? Auth.isManager(user) : false;
}

function escapeHtmlWorker(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getMyBons() {
  const all = Store.load(Store.KEY_BONS) || [];
  return isManager(CURRENT_USER)
    ? all
    : all.filter((bon) => (bon.team || []).includes(CURRENT_USER));
}

function tsOfWorker(message) {
  if (!message) {
    return 0;
  }
  if (typeof message.ts === 'number') {
    return message.ts;
  }
  const timestamp = Date.parse(message.date || '');
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function countUnreadForWorker(bon, who) {
  const seenTs = bon.chatSeen?.[who] || 0;
  const messages = Array.isArray(bon.chat) ? bon.chat : [];
  return messages.filter((message) => (message.from || '') !== who && tsOfWorker(message) > seenTs).length;
}

function markChatSeenWorker(bon, who) {
  const allBons = Store.load(Store.KEY_BONS);
  const index = allBons.findIndex((entry) => entry.id === bon.id);
  if (index < 0) {
    return;
  }
  const updated = { ...allBons[index] };
  updated.chatSeen = updated.chatSeen || {};
  updated.chatSeen[who] = Date.now();
  allBons[index] = updated;
  Store.save(Store.KEY_BONS, allBons);
}

function telLink(number) {
  return number
    ? `<a href="tel:${number.replace(/\s+/g, '')}" class="link">${number}</a>`
    : '-';
}

// cityLine (code postal + ville) evite les adresses ambigues sur Google Maps
// quand la meme rue existe dans plusieurs communes
function mapLink(address, cityLine = '') {
  const full = [address, cityLine].filter(Boolean).join(', ');
  if (!full) {
    return '-';
  }

  const query = encodeURIComponent(full);
  return `<a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${query}" class="link">${full}</a> <a target="_blank" rel="noopener" href="https://waze.com/ul?q=${query}&navigate=yes" class="link small" style="margin-left:6px; white-space:nowrap">(Waze)</a>`;
}

function short(text, max = 300) {
  return (text || '').length > max ? `${text.slice(0, max - 1)}...` : text || '';
}

/* Planning de la semaine */
let planningWeekOffset = 0;

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekDays(offset) {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() + diffToMonday + offset * 7);

  const days = [];
  for (let i = 0; i < 5; i += 1) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

// Toutes les dates de RDV d'un bon (RDV initial + RDV supplementaires),
// choisies par l'encadrant, avec leur heure quand elle existe
function getRdvEntries(bon) {
  const raw = bon.raw || {};
  const entries = [];

  if (raw['bon.rdv']) {
    entries.push({ date: raw['bon.rdv'], heure: raw['bon.rdv_heure'] || '' });
  }

  (Array.isArray(bon.rdv_plus) ? bon.rdv_plus : []).forEach((rdv) => {
    if (rdv.date) {
      entries.push({ date: rdv.date, heure: rdv.heure || '' });
    }
  });

  return entries;
}

// Badge "Aujourd'hui" / "Demain" selon les RDV du bon (initial + supplementaires)
function rdvUrgencyBadgeHtml(bon) {
  const entries = getRdvEntries(bon);
  if (!entries.length) {
    return '';
  }

  const todayIso = isoDate(new Date());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowIso = isoDate(tomorrowDate);

  const todayEntry = entries.find((entry) => entry.date === todayIso);
  const tomorrowEntry = !todayEntry ? entries.find((entry) => entry.date === tomorrowIso) : null;

  const match = todayEntry
    ? { label: "Aujourd'hui", cls: 'badge-today', entry: todayEntry }
    : tomorrowEntry
      ? { label: 'Demain', cls: 'badge-tomorrow', entry: tomorrowEntry }
      : null;

  if (!match) {
    return '';
  }

  const heureText = match.entry.heure ? ` · ${escapeHtmlWorker(match.entry.heure)}` : '';
  return `<span class="badge ${match.cls}">🕐 ${match.label}${heureText}</span>`;
}

function renderPlanning() {
  const grid = document.getElementById('planning-grid');
  const rangeLabel = document.getElementById('planning-range');
  if (!grid) {
    return;
  }

  const mine = getMyBons();

  const days = getWeekDays(planningWeekOffset);
  const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
  const todayIso = isoDate(new Date());

  if (rangeLabel) {
    const fmt = (d) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    rangeLabel.textContent = planningWeekOffset === 0
      ? `Cette semaine · ${fmt(days[0])} – ${fmt(days[4])}`
      : `${fmt(days[0])} – ${fmt(days[4])}`;
  }

  grid.innerHTML = days
    .map((d, index) => {
      const iso = isoDate(d);
      const isToday = iso === todayIso;

      const items = [];
      mine.forEach((bon) => {
        getRdvEntries(bon).forEach((entry) => {
          if (entry.date === iso) {
            items.push({ bon, entry });
          }
        });
      });
      items.sort((a, b) => (a.entry.heure || '').localeCompare(b.entry.heure || ''));

      const itemsHtml = items.length
        ? items
            .map(
              ({ bon, entry }) => `
                <div class="planning-item" data-bon-id="${bon.id}">
                  <strong>${escapeHtmlWorker(bon.client || 'Client ?')}</strong>
                  ${entry.heure ? `<div class="small muted">${escapeHtmlWorker(entry.heure)}</div>` : ''}
                </div>
              `,
            )
            .join('')
        : '<div class="planning-empty">—</div>';

      return `
        <div class="planning-day">
          <div class="planning-day-head${isToday ? ' today' : ''}">${dayNames[index]} ${d.getDate()}</div>
          ${itemsHtml}
        </div>
      `;
    })
    .join('');

  grid.querySelectorAll('.planning-item').forEach((el) => {
    el.addEventListener('click', () => {
      const target = document.querySelector(`.work-card[data-bon-id="${el.dataset.bonId}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

document.getElementById('planning-prev')?.addEventListener('click', () => {
  planningWeekOffset -= 1;
  renderPlanning();
});

document.getElementById('planning-next')?.addEventListener('click', () => {
  planningWeekOffset += 1;
  renderPlanning();
});

function toFloatQuarter(value) {
  if (!value) {
    return 0;
  }

  const normalized = String(value).trim().toLowerCase().replace(',', '.');
  const hoursMatch = normalized.match(/^(\d+(?:\.\d+)?)h(\d{1,2})?$/);

  if (hoursMatch) {
    const hours = parseFloat(hoursMatch[1] || '0');
    const minutes = parseFloat(hoursMatch[2] || '0');
    return Math.round((hours + minutes / 60) * 4) / 4;
  }

  const parsed = parseFloat(normalized);
  if (Number.isNaN(parsed)) {
    return Number.NaN;
  }

  return Math.round(parsed * 4) / 4;
}

function renderWork() {
  const wrap = document.getElementById('work-list');
  const empty = document.getElementById('work-empty');
  if (!wrap || !empty) {
    return;
  }

  // La synchro periodique reconstruit toute la liste : on sauvegarde le champ
  // en cours de saisie (message ou heures) pour ne pas l effacer sous les yeux
  // de l utilisateur.
  const PRESERVED_FIELD_CLASSES = ['chat-input', 'wdate', 'whours', 'wnote'];
  // Les champs date ne supportent pas selectionStart/End (ca leve une exception)
  const SELECTABLE_TYPES = new Set(['text', 'search', 'tel', 'url', 'password', 'textarea']);
  const activeElement = document.activeElement;
  let pendingField = null;
  if (activeElement && wrap.contains(activeElement)) {
    const preservedClass = PRESERVED_FIELD_CLASSES.find((cls) => activeElement.classList.contains(cls));
    if (preservedClass) {
      const supportsSelection = SELECTABLE_TYPES.has(activeElement.type);
      pendingField = {
        bonId: activeElement.closest('.work-card')?.dataset.bonId,
        className: preservedClass,
        value: activeElement.value,
        selectionStart: supportsSelection ? activeElement.selectionStart : null,
        selectionEnd: supportsSelection ? activeElement.selectionEnd : null,
      };
    }
  }

  // Une modification de ligne d'heures en cours (bouton "Modifier" clique) ne
  // doit pas non plus etre perdue au rafraichissement, meme si aucun champ
  // n'a le focus a cet instant precis.
  const pendingEdits = Array.from(wrap.querySelectorAll('.work-card[data-editing-key]')).map((card) => ({
    bonId: card.dataset.bonId,
    editingKey: card.dataset.editingKey,
  }));

  wrap.innerHTML = '';

  const all = Store.load(Store.KEY_BONS) || [];
  const mine = isManager(CURRENT_USER)
    ? all
    : all.filter((bon) => (bon.team || []).includes(CURRENT_USER));

  if (!mine.length) {
    empty.style.display = '';
    renderPlanning();
    return;
  }

  empty.style.display = 'none';

  mine.forEach((bon) => {
    const raw = bon.raw || {};
    const encadrants = Array.from(
      new Set(
        [
          ...(Array.isArray(bon.encadrants) ? bon.encadrants : []),
          ...String(raw['bon.encadrants'] || '').split('|'),
          bon.encadrant || raw['bon.encadrant'] || '',
        ]
          .map((value) => String(value || '').trim())
          .filter(Boolean),
      ),
    );

    const encadrant = encadrants.join(', ');
    const admin = bon.admin || raw['bon.admin'] || '';
    const client = bon.client || raw['bon.client_nom'] || 'Client ?';
    const telClient = raw['bon.client_tel'] || '';
    const adrClient = raw['bon.client_adresse'] || '';
    const villeClient = [raw['bon.client_code_postal'], raw['bon.client_ville']].filter(Boolean).join(' ');

    const adrDiff = (raw['bon.adresse_chantier_diff'] || 'non') === 'oui';
    const adrChant = raw['bon.adresse_chantier'] || '';
    const villeChant = [raw['bon.chantier_code_postal'], raw['bon.chantier_ville']].filter(Boolean).join(' ');
    const locNom = raw['bon.nom_locataire'] || '';
    const locTel = raw['bon.tel_locataire'] || '';
    const remChant = raw['bon.remarques_chantier'] || '';

    const rdv = raw['bon.rdv'] || '';
    const rdvHour = raw['bon.rdv_heure'] || '';
    const rdvPlus = Array.isArray(bon.rdv_plus) ? bon.rdv_plus : [];

    const objet = raw['bon.objet'] || bon.objet || '';
    const tSupp = raw['bon.travaux_supp'] || '';
    const chat = Array.isArray(bon.chat) ? bon.chat : [];

    const userStatus = (bon.progress && bon.progress[CURRENT_USER]) || 'Commencement';
    const myHoursArr = bon.hours?.[CURRENT_USER] || [];
    const myTotal = myHoursArr.reduce((sum, hour) => sum + (parseFloat(hour.h) || 0), 0);

    const card = document.createElement('div');
    card.className = 'work-card';
    card.dataset.bonId = bon.id;
    card.innerHTML = `
      <h3>${client}</h3>

      <div class="work-meta">
        <span class="badge">Devis no ${bon.num_devis || '-'}</span>
        <span class="badge">${bon.status === 'facturer' ? 'A facturer' : 'En cours'}</span>
        ${admin ? `<span class="badge">Gestionnaire: ${admin}</span>` : ''}
        ${encadrant ? `<span class="badge">Encadrant: ${encadrant}</span>` : ''}
      </div>

      <div class="grid-2" style="margin:8px 0">
        <div>
          <div class="small muted">Telephone client</div>
          <div>${telLink(telClient)}</div>
        </div>
        <div>
          <div class="small muted">Adresse facturation</div>
          <div>${mapLink(adrClient, villeClient)}</div>
        </div>
      </div>

      <div class="box" style="margin:6px 0">
        <div class="small muted">Adresse chantier ${adrDiff ? '(differente)' : ''}</div>
        <div>${mapLink(adrDiff ? adrChant : adrClient, adrDiff ? villeChant : villeClient)}</div>
        <div class="small" style="margin-top:4px">
          ${locNom ? `Locataire: <strong>${locNom}</strong> · ` : ''}
          ${locTel ? `Tel: <a href="tel:${locTel.replace(/\s+/g, '')}" class="link">${locTel}</a>` : ''}
        </div>
        ${remChant ? `<div class="small muted" style="margin-top:4px">Remarques: ${remChant}</div>` : ''}
      </div>

      <div class="grid-2" style="margin:6px 0">
        <div>
          <div class="small muted">RDV initial</div>
          <div>${rdv || '-'} ${rdvHour ? `a ${rdvHour}` : ''}</div>
        </div>
        <div>
          <div class="small muted">Autres RDV</div>
          <div class="small">
            ${rdvPlus.length ? rdvPlus.map((entry) => `${entry.date || '-'} ${entry.heure ? `· ${entry.heure}` : ''}`).join('<br>') : '-'}
          </div>
        </div>
      </div>

      <div class="box">
        <div class="small muted">Travaux a realiser</div>
        <div>${short(objet)}</div>
        ${tSupp ? `<div class="small muted" style="margin-top:4px">Travaux sup.: ${tSupp}</div>` : ''}
      </div>

      <div class="chat">
        <div class="small muted" style="margin-bottom:4px">Messages importants</div>
        <div class="chat-log">${
          chat.length
            ? chat
                .slice(-6)
                .map(
                  (message) => `
                    <div class="chat-line">
                      <strong>${message.from || '?'}</strong>
                      <span class="small muted">${message.date || new Date(message.ts || Date.now()).toLocaleString()}</span><br>${message.text || ''}
                    </div>
                  `,
                )
                .join('')
            : '<div class="small muted">Aucun message.</div>'
        }</div>
        <div class="chat-form">
          <input type="text" class="chat-input" placeholder="Envoyer un message a l encadrant...">
          <button class="btn chat-send">Envoyer</button>
        </div>
      </div>

      <div class="gallery-block" style="margin-top:10px">
        <div class="small muted" style="margin-bottom:4px">Photos chantier</div>
        <div class="gallery" data-gallery></div>
        <div class="small muted" data-gallery-empty style="display:none">Aucune photo.</div>
        <div style="margin-top:6px">
          <input type="file" accept="image/*" capture="environment" multiple class="photo-input" style="display:none">
          <button type="button" class="btn photo-add">Ajouter une photo</button>
        </div>
      </div>

      <div class="work-form">
        <div><label>Date</label><input type="date" class="wdate" value="${today()}"></div>
        <div><label>Heures</label><input type="text" class="whours" placeholder="ex: 1.5, 1,25, 1h30"></div>
        <div><label>Commentaire</label><textarea class="wnote" placeholder="Ce qui a ete fait"></textarea></div>
        <div style="display:flex; gap:8px">
          <button class="btn primary wsave">Ajouter mes heures</button>
          <button type="button" class="btn outline wcancel" style="display:none">Annuler la modification</button>
        </div>
      </div>

      <div style="margin-top:10px; display:grid; grid-template-columns:200px 1fr; gap:8px; align-items:center;">
        <label>Statut d avancement (moi)</label>
        <select class="wprogress">
          <option ${userStatus === 'Commencement' ? 'selected' : ''}>Commencement</option>
          <option ${userStatus === 'Bien avance' ? 'selected' : ''}>Bien avance</option>
          <option ${userStatus === 'Presque termine' ? 'selected' : ''}>Presque termine</option>
          <option ${userStatus === 'Termine' ? 'selected' : ''}>Termine</option>
        </select>
      </div>

      <div class="sig-block" style="margin-top:10px">
        ${bon.signature
          ? window.renderSignatureStatusHtml(bon.signature)
          : '<button type="button" class="btn success sig-open" style="width:100%">Terminer le chantier</button>'}
      </div>

      <div class="small" style="margin-top:8px">Mes dernieres lignes:</div>
      <div class="small" data-wlog>-</div>
      <div class="small muted" style="margin-top:4px">Total cumule: <strong data-wtotal>${(Math.round(myTotal * 100) / 100).toFixed(2)} h</strong></div>
    `;

    const logBox = card.querySelector('[data-wlog]');
    const totalBox = card.querySelector('[data-wtotal]');
    const dateField = card.querySelector('.wdate');
    const hoursField = card.querySelector('.whours');
    const noteField = card.querySelector('.wnote');
    const saveButton = card.querySelector('.wsave');
    const cancelButton = card.querySelector('.wcancel');

    // L etat "en cours de modification" est stocke sur le DOM (dataset) plutot
    // qu en variable de fermeture : la synchro periodique reconstruit la carte
    // toutes les 5s, une simple variable locale serait perdue au rafraichissement.
    function keyOf(entry, absoluteIndex) {
      return entry.id || `idx:${absoluteIndex}`;
    }

    function findEntry(entries, key) {
      if (String(key).startsWith('idx:')) {
        return entries[Number(key.slice(4))];
      }
      return entries.find((entry) => entry.id === key);
    }

    function startEdit(entry, key) {
      card.dataset.editingKey = key;
      dateField.value = entry.date || today();
      hoursField.value = entry.h != null ? String(entry.h) : '';
      noteField.value = entry.note || '';
      saveButton.textContent = 'Enregistrer la modification';
      cancelButton.style.display = '';
      dateField.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    function cancelEdit() {
      delete card.dataset.editingKey;
      dateField.value = today();
      hoursField.value = '';
      noteField.value = '';
      saveButton.textContent = 'Ajouter mes heures';
      cancelButton.style.display = 'none';
    }

    cancelButton.addEventListener('click', cancelEdit);

    function refreshLog() {
      const fresh = Store.load(Store.KEY_BONS).find((entry) => entry.id === bon.id);
      const entries = fresh?.hours?.[CURRENT_USER] || [];
      const lastEntries = entries
        .map((entry, absoluteIndex) => ({ entry, key: keyOf(entry, absoluteIndex) }))
        .slice(-5);

      logBox.innerHTML = lastEntries.length
        ? lastEntries
            .map(
              ({ entry, key }) => `
                <div class="wlog-line" style="display:flex; align-items:center; gap:6px; margin-bottom:2px">
                  <span>${entry.date || '?'} - ${entry.h || '0'}h ${entry.note ? `· ${entry.note}` : ''}</span>
                  <button type="button" class="btn outline wedit" data-key="${key}" style="padding:2px 8px; font-size:11px">Modifier</button>
                </div>
              `,
            )
            .join('')
        : '-';

      logBox.querySelectorAll('.wedit').forEach((button) => {
        button.addEventListener('click', () => {
          const entry = findEntry(entries, button.dataset.key);
          if (entry) {
            startEdit(entry, button.dataset.key);
          }
        });
      });

      const sum = entries.reduce((acc, entry) => acc + (parseFloat(entry.h) || 0), 0);
      totalBox.textContent = `${(Math.round(sum * 100) / 100).toFixed(2)} h`;
    }

    refreshLog();

    card.querySelector('.chat-send').addEventListener('click', () => {
      const input = card.querySelector('.chat-input');
      const text = (input.value || '').trim();
      if (!text) {
        return;
      }

      const allBons = Store.load(Store.KEY_BONS);
      const index = allBons.findIndex((entry) => entry.id === bon.id);
      if (index < 0) {
        alert('Bon introuvable.');
        return;
      }

      const copy = { ...allBons[index] };
      copy.chat = Array.isArray(copy.chat) ? copy.chat : [];
      const now = Date.now();
      copy.chat.push({
        from: CURRENT_USER,
        text,
        ts: now,
        date: new Date(now).toLocaleString(),
      });

      allBons[index] = copy;
      Store.save(Store.KEY_BONS, allBons);

      const chatLog = card.querySelector('.chat-log');
      chatLog.insertAdjacentHTML(
        'beforeend',
        `<div class="chat-line"><strong>${CURRENT_USER}</strong> <span class="small muted">${new Date(now).toLocaleString()}</span><br>${text}</div>`,
      );

      input.value = '';
    });

    function renderGallery() {
      const freshBon = Store.load(Store.KEY_BONS).find((entry) => entry.id === bon.id) || bon;
      const photos = Array.isArray(freshBon.photos) ? freshBon.photos : [];
      const galleryBox = card.querySelector('[data-gallery]');
      const emptyBox = card.querySelector('[data-gallery-empty]');

      emptyBox.style.display = photos.length ? 'none' : '';
      galleryBox.innerHTML = photos
        .map((photo) => `<img src="${photo.dataUrl}" alt="Photo chantier" class="gallery-thumb" data-id="${photo.id}">`)
        .join('');

      galleryBox.querySelectorAll('.gallery-thumb').forEach((img) => {
        img.addEventListener('click', () => window.openLightbox(img.src));
      });
    }

    renderGallery();

    card.querySelector('.photo-add').addEventListener('click', () => {
      card.querySelector('.photo-input').click();
    });

    card.querySelector('.photo-input').addEventListener('change', async (event) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (!files.length) {
        return;
      }

      for (const file of files) {
        try {
          const dataUrl = await window.compressImageFile(file);
          const allBons = Store.load(Store.KEY_BONS);
          const index = allBons.findIndex((entry) => entry.id === bon.id);
          if (index < 0) {
            continue;
          }

          const copy = { ...allBons[index] };
          copy.photos = Array.isArray(copy.photos) ? copy.photos : [];
          copy.photos.push({
            id: window.uid(),
            from: CURRENT_USER,
            ts: Date.now(),
            date: new Date().toLocaleString(),
            dataUrl,
          });
          allBons[index] = copy;
          Store.save(Store.KEY_BONS, allBons);
        } catch (error) {
          console.warn(error);
          alert("Erreur lors de l'ajout d'une photo.");
        }
      }

      renderGallery();
    });

    saveButton.addEventListener('click', () => {
      const date = dateField.value;
      const rawHours = hoursField.value;
      const note = noteField.value.trim();

      if (!date) {
        alert('La date est obligatoire.');
        return;
      }

      const decimalHours = toFloatQuarter(rawHours);
      if (Number.isNaN(decimalHours) || decimalHours <= 0) {
        alert('Nombre d heures invalide. Exemple : 1.5, 1,25 ou 1h30');
        return;
      }

      const allBons = Store.load(Store.KEY_BONS);
      const index = allBons.findIndex((entry) => entry.id === bon.id);
      if (index < 0) {
        alert('Bon introuvable.');
        return;
      }

      const editingKey = card.dataset.editingKey || null;
      const copy = { ...allBons[index] };
      copy.hours = copy.hours || {};
      copy.hours[CURRENT_USER] = copy.hours[CURRENT_USER] || [];

      if (editingKey) {
        const entry = findEntry(copy.hours[CURRENT_USER], editingKey);
        if (!entry) {
          alert('Cette ligne n existe plus.');
          cancelEdit();
          return;
        }
        entry.date = date;
        entry.h = decimalHours;
        entry.note = note;
      } else {
        copy.hours[CURRENT_USER].push({ id: window.uid(), date, h: decimalHours, note });
      }

      allBons[index] = copy;
      Store.save(Store.KEY_BONS, allBons);

      const wasEditing = !!editingKey;
      cancelEdit();
      refreshLog();
      alert(wasEditing ? 'Ligne modifiee.' : 'Heures enregistrees.');
    });

    card.querySelector('.wprogress').addEventListener('change', (event) => {
      const value = event.target.value;
      const allBons = Store.load(Store.KEY_BONS);
      const index = allBons.findIndex((entry) => entry.id === bon.id);
      if (index < 0) {
        alert('Bon introuvable.');
        return;
      }

      const copy = { ...allBons[index] };
      copy.progress = copy.progress || {};
      copy.progress[CURRENT_USER] = value;
      if (value === 'Termine') {
        copy.status = 'facturer';
      }

      allBons[index] = copy;
      Store.save(Store.KEY_BONS, allBons);

      alert(
        value === 'Termine'
          ? 'Statut mis a jour. Le bon passe en "A facturer".'
          : 'Statut mis a jour.',
      );

      renderWork();
    });

    const sigOpenButton = card.querySelector('.sig-open');
    if (sigOpenButton) {
      sigOpenButton.addEventListener('click', async () => {
        const result = await window.openSignatureFlow();
        if (!result) {
          return;
        }

        const allBons = Store.load(Store.KEY_BONS);
        const index = allBons.findIndex((entry) => entry.id === bon.id);
        if (index < 0) {
          alert('Bon introuvable.');
          return;
        }

        const copy = { ...allBons[index] };
        copy.signature = {
          present: result.present,
          dataUrl: result.present ? result.dataUrl : null,
          from: CURRENT_USER,
          ts: Date.now(),
          date: new Date().toLocaleString(),
        };
        copy.progress = copy.progress || {};
        copy.progress[CURRENT_USER] = 'Termine';
        copy.status = 'facturer';

        allBons[index] = copy;
        Store.save(Store.KEY_BONS, allBons);

        renderWork();
      });
    }

    wrap.appendChild(card);
  });

  pendingEdits.forEach(({ bonId, editingKey }) => {
    const restoredCard = wrap.querySelector(`[data-bon-id="${bonId}"]`);
    if (!restoredCard) {
      return;
    }
    restoredCard.dataset.editingKey = editingKey;
    const restoredSave = restoredCard.querySelector('.wsave');
    const restoredCancel = restoredCard.querySelector('.wcancel');
    if (restoredSave) {
      restoredSave.textContent = 'Enregistrer la modification';
    }
    if (restoredCancel) {
      restoredCancel.style.display = '';
    }

    // Repeuple date/heures/commentaire avec la ligne en cours de modification,
    // au cas ou le champ actif (restaure plus bas) ne couvre pas les 3 champs.
    const editedBon = all.find((entry) => String(entry.id) === bonId);
    const entries = editedBon?.hours?.[CURRENT_USER] || [];
    const editedEntry = String(editingKey).startsWith('idx:')
      ? entries[Number(editingKey.slice(4))]
      : entries.find((entry) => entry.id === editingKey);
    if (editedEntry) {
      const dateField = restoredCard.querySelector('.wdate');
      const hoursField = restoredCard.querySelector('.whours');
      const noteField = restoredCard.querySelector('.wnote');
      if (dateField) {
        dateField.value = editedEntry.date || today();
      }
      if (hoursField) {
        hoursField.value = editedEntry.h != null ? String(editedEntry.h) : '';
      }
      if (noteField) {
        noteField.value = editedEntry.note || '';
      }
    }
  });

  if (pendingField) {
    const restoredCard = wrap.querySelector(`[data-bon-id="${pendingField.bonId}"]`);
    const restoredField = restoredCard?.querySelector(`.${pendingField.className}`);
    if (restoredField) {
      restoredField.value = pendingField.value;
      restoredField.focus();
      if (pendingField.selectionStart !== null) {
        restoredField.setSelectionRange(pendingField.selectionStart, pendingField.selectionEnd);
      }
    }
  }

  renderPlanning();
}

/* Onglets */
function showWorkerTab(name) {
  document.querySelectorAll('.tabs .tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === name);
  });
  document.querySelectorAll('main .view').forEach((view) => {
    view.classList.toggle('show', view.id === `tab-${name}`);
  });

  if (name === 'messagerie') {
    refreshMessagerie();
  }
}

document.querySelectorAll('.tabs .tab').forEach((tab) => {
  tab.addEventListener('click', (event) => {
    event.preventDefault();
    showWorkerTab(tab.dataset.tab);
  });
});

/* Messagerie (un fil par chantier) */
let messagerieActiveBonId = null;
let messagerieSearchTerm = '';

function messagerieInitials(client) {
  return String(client || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function messagerieSortedRows() {
  const who = cleanTextWorker(CURRENT_USER);
  const term = messagerieSearchTerm.trim().toLowerCase();

  return getMyBons()
    .map((bon) => {
      const chat = Array.isArray(bon.chat) ? bon.chat : [];
      return { bon, last: chat[chat.length - 1] || null, unread: countUnreadForWorker(bon, who) };
    })
    .filter(({ bon }) => {
      if (!term) {
        return true;
      }
      return (
        (bon.client || '').toLowerCase().includes(term) ||
        (bon.num_devis || '').toLowerCase().includes(term)
      );
    })
    .sort((a, b) => tsOfWorker(b.last) - tsOfWorker(a.last));
}

function renderMessagerieThreads() {
  const list = document.getElementById('msg-threads');
  if (!list) {
    return;
  }

  const rows = messagerieSortedRows();

  if (!rows.length) {
    list.innerHTML = '<div class="small muted" style="padding:14px">Aucun chantier.</div>';
    return;
  }

  list.innerHTML = rows
    .map(({ bon, last, unread }) => {
      const preview = last
        ? `${escapeHtmlWorker(last.from || '')} : ${escapeHtmlWorker((last.text || '').slice(0, 60))}`
        : 'Aucun message';
      return `
        <div class="thread ${String(bon.id) === String(messagerieActiveBonId) ? 'active' : ''} ${unread ? 'unread' : ''}" data-bon-id="${bon.id}">
          <div class="thread-avatar">${escapeHtmlWorker(messagerieInitials(bon.client))}</div>
          <div class="thread-body">
            <div class="thread-top">
              <div class="thread-client">${escapeHtmlWorker(bon.client || 'Client ?')}</div>
              <div class="thread-time">${escapeHtmlWorker(last?.date || '')}</div>
            </div>
            <div class="thread-preview">${preview}</div>
            <div class="thread-badges" style="display:flex; gap:5px; flex-wrap:wrap; margin-top:4px">
              ${rdvUrgencyBadgeHtml(bon)}
              ${unread ? `<span class="badge badge-neon thread-badge">🔔 ${unread} nouveau${unread > 1 ? 'x' : ''}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  list.querySelectorAll('.thread').forEach((el) => {
    el.addEventListener('click', () => openMessagerieThread(el.dataset.bonId));
  });
}

function deleteMessagerieConversation(bonId) {
  if (!confirm('Supprimer tous les messages de cette conversation ? Cette action est irreversible.')) {
    return;
  }

  const allBons = Store.load(Store.KEY_BONS);
  const index = allBons.findIndex((entry) => String(entry.id) === String(bonId));
  if (index < 0) {
    return;
  }

  const updated = { ...allBons[index], chat: [], chatSeen: {} };
  allBons[index] = updated;
  Store.save(Store.KEY_BONS, allBons);

  renderMessagerieThreads();
  renderMessagerieConversation(updated);
}

function renderMessagerieConversation(bon) {
  const title = document.getElementById('msg-conv-title');
  const sub = document.getElementById('msg-conv-sub');
  const body = document.getElementById('msg-conv-body');
  const openLink = document.getElementById('msg-conv-open');
  const deleteButton = document.getElementById('msg-conv-delete');
  if (!title || !sub || !body) {
    return;
  }

  const freshBon = Store.load(Store.KEY_BONS).find((entry) => String(entry.id) === String(bon.id)) || bon;
  const chat = Array.isArray(freshBon.chat) ? freshBon.chat : [];
  const who = cleanTextWorker(CURRENT_USER);

  title.textContent = freshBon.client || 'Client ?';
  sub.textContent = `${freshBon.num_devis || '-'}`;

  if (deleteButton) {
    deleteButton.style.display = chat.length ? '' : 'none';
    deleteButton.onclick = () => deleteMessagerieConversation(freshBon.id);
  }

  body.innerHTML = chat.length
    ? chat
        .map((message) => {
          const me = (message.from || '') === who;
          return `
            <div class="bubble-row ${me ? 'me' : ''}">
              <div class="bubble">${me ? '' : `<strong>${escapeHtmlWorker(message.from || '?')}</strong> — `}${escapeHtmlWorker(message.text || '')}</div>
              <div class="bubble-meta">${escapeHtmlWorker(message.date || '')}</div>
            </div>
          `;
        })
        .join('')
    : '<div class="small muted">Aucun message.</div>';

  body.scrollTop = body.scrollHeight;

  if (openLink) {
    openLink.onclick = (event) => {
      event.preventDefault();
      showWorkerTab('travail');
      const target = document.querySelector(`.work-card[data-bon-id="${freshBon.id}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  }
}

function openMessagerieThread(bonId) {
  const bon = getMyBons().find((entry) => String(entry.id) === String(bonId));
  if (!bon) {
    return;
  }

  messagerieActiveBonId = bon.id;
  markChatSeenWorker(bon, cleanTextWorker(CURRENT_USER) || CURRENT_USER);
  renderMessagerieThreads();
  renderMessagerieConversation(bon);
}

function cleanTextWorker(value) {
  return String(value ?? '').trim();
}

function sendMessagerieMessage() {
  const input = document.getElementById('msg-compose-input');
  if (!input || !messagerieActiveBonId) {
    return;
  }

  const text = cleanTextWorker(input.value);
  if (!text) {
    return;
  }

  const who = cleanTextWorker(CURRENT_USER) || CURRENT_USER;
  const allBons = Store.load(Store.KEY_BONS);
  const index = allBons.findIndex((entry) => String(entry.id) === String(messagerieActiveBonId));
  if (index < 0) {
    alert('Bon introuvable.');
    return;
  }

  const updated = { ...allBons[index] };
  updated.chat = Array.isArray(updated.chat) ? updated.chat : [];

  const now = Date.now();
  updated.chat.push({ from: who, text, ts: now, date: new Date(now).toLocaleString() });
  updated.chatSeen = updated.chatSeen || {};
  updated.chatSeen[who] = now;
  allBons[index] = updated;
  Store.save(Store.KEY_BONS, allBons);

  input.value = '';
  renderMessagerieThreads();
  renderMessagerieConversation(updated);
}

document.getElementById('msg-compose-send')?.addEventListener('click', sendMessagerieMessage);
document.getElementById('msg-compose-input')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    sendMessagerieMessage();
  }
});

document.getElementById('msg-search')?.addEventListener('input', (event) => {
  messagerieSearchTerm = event.target.value;
  renderMessagerieThreads();
});

function refreshMessagerie() {
  renderMessagerieThreads();

  if (messagerieActiveBonId) {
    const bon = getMyBons().find((entry) => String(entry.id) === String(messagerieActiveBonId));
    if (bon) {
      renderMessagerieConversation(bon);
      return;
    }
  }

  const first = messagerieSortedRows()[0]?.bon;
  if (first) {
    openMessagerieThread(first.id);
  }
}

function updateMessagerieTabBadge() {
  const badge = document.getElementById('messagerie-tab-badge');
  if (!badge) {
    return;
  }

  const who = cleanTextWorker(CURRENT_USER);
  const total = getMyBons().reduce((sum, bon) => sum + countUnreadForWorker(bon, who), 0);

  if (total > 0) {
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

window.addEventListener('shared-store-changed', () => {
  renderWork();
  if (document.getElementById('tab-messagerie')?.classList.contains('show')) {
    refreshMessagerie();
  }
  updateMessagerieTabBadge();
});

Store.syncFromServer?.()
  .then(() => {
    renderWork();
  })
  .catch((error) => {
    console.warn('Impossible de synchroniser les bons partages', error);
    renderWork();
  });

setInterval(() => {
  Store.syncFromServer?.()
    .then(() => {
      renderWork();
    })
    .catch((error) => {
      console.warn('Impossible d actualiser les bons partages', error);
    });
}, 6000);
