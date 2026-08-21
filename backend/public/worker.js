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

function telLink(number) {
  return number
    ? `<a href="tel:${number.replace(/\s+/g, '')}" class="link">${number}</a>`
    : '-';
}

function mapLink(address) {
  return address
    ? `<a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}" class="link">${address}</a>`
    : '-';
}

function short(text, max = 300) {
  return (text || '').length > max ? `${text.slice(0, max - 1)}...` : text || '';
}

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

  wrap.innerHTML = '';

  const all = Store.load(Store.KEY_BONS) || [];
  const mine = isManager(CURRENT_USER)
    ? all
    : all.filter((bon) => (bon.team || []).includes(CURRENT_USER));

  if (!mine.length) {
    empty.style.display = '';
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

    const adrDiff = (raw['bon.adresse_chantier_diff'] || 'non') === 'oui';
    const adrChant = raw['bon.adresse_chantier'] || '';
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
          <div>${mapLink(adrClient)}</div>
        </div>
      </div>

      <div class="box" style="margin:6px 0">
        <div class="small muted">Adresse chantier ${adrDiff ? '(differente)' : ''}</div>
        <div>${mapLink(adrDiff ? adrChant : adrClient)}</div>
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
        <button class="btn primary wsave">Ajouter mes heures</button>
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

      <div class="small" style="margin-top:8px">Mes dernieres lignes:</div>
      <div class="small" data-wlog>-</div>
      <div class="small muted" style="margin-top:4px">Total cumule: <strong data-wtotal>${(Math.round(myTotal * 100) / 100).toFixed(2)} h</strong></div>
    `;

    const logBox = card.querySelector('[data-wlog]');
    const totalBox = card.querySelector('[data-wtotal]');

    function refreshLog() {
      const fresh = Store.load(Store.KEY_BONS).find((entry) => entry.id === bon.id);
      const entries = fresh?.hours?.[CURRENT_USER] || [];
      const lastEntries = entries.slice(-5);

      logBox.innerHTML = lastEntries.length
        ? lastEntries
            .map((entry) => `${entry.date || '?'} - ${entry.h || '0'}h ${entry.note ? `· ${entry.note}` : ''}`)
            .join('<br>')
        : '-';

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

    card.querySelector('.wsave').addEventListener('click', () => {
      const date = card.querySelector('.wdate').value;
      const rawHours = card.querySelector('.whours').value;
      const note = card.querySelector('.wnote').value.trim();

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

      const copy = { ...allBons[index] };
      copy.hours = copy.hours || {};
      copy.hours[CURRENT_USER] = copy.hours[CURRENT_USER] || [];
      copy.hours[CURRENT_USER].push({ date, h: decimalHours, note });

      allBons[index] = copy;
      Store.save(Store.KEY_BONS, allBons);

      refreshLog();
      card.querySelector('.wdate').value = today();
      card.querySelector('.whours').value = '';
      card.querySelector('.wnote').value = '';
      alert('Heures enregistrees.');
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

    wrap.appendChild(card);
  });
}

window.addEventListener('shared-store-changed', renderWork);

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
