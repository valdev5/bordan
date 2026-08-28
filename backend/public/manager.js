/*************************************************
 * manager.js - Espace Chefs
 * - Retour auto au tableau apres enregistrement
 * - Creation auto du BT si devis accepte + acompte
 * - Filtrage par chef via #show-all
 * - Chips intervenants
 * - Messagerie chantier cote encadrant
 **************************************************/

/* Helpers DOM */
window.$ = window.$ || ((selector, root = document) => root.querySelector(selector));
window.$$ = window.$$ || ((selector, root = document) => Array.from(root.querySelectorAll(selector)));
const today = () => (window.today ? window.today() : new Date().toISOString().slice(0, 10));

/* Auth */
const CURRENT_USER = window.Auth?.guard ? Auth.guard('manager') : null;

if (!CURRENT_USER) {
  Auth?.logout?.();
}

const whoami = $('#whoami');
if (whoami) {
  whoami.textContent = `Connecte : ${CURRENT_USER || '-'}`;
}

$('#btn-logout')?.addEventListener('click', (event) => {
  event.preventDefault();
  Auth?.logout?.();
});

$('#btn-reset-user-password')?.addEventListener('click', async () => {
  const username = prompt('Nom du compte dont il faut réinitialiser le mot de passe :');
  if (!username) return;

  const newPassword = prompt(`Nouveau mot de passe pour "${username}" (au moins 4 caractères) :`);
  if (!newPassword) return;

  try {
    await window.apiFetch(`/auth/users/${encodeURIComponent(username.trim())}/password`, {
      method: 'PATCH',
      body: { newPassword },
    });
    alert(`Mot de passe de "${username}" réinitialisé. Communiquez-lui le nouveau mot de passe.`);
  } catch (error) {
    alert(error.message || 'Impossible de réinitialiser ce mot de passe.');
  }
});

$('#btn-change-user-role')?.addEventListener('click', async () => {
  const username = prompt('Nom du compte dont il faut changer le rôle :');
  if (!username) return;

  const role = (prompt('Nouveau rôle : manager, worker ou compta ?') || '').trim().toLowerCase();
  if (!['manager', 'worker', 'compta'].includes(role)) {
    alert('Rôle invalide. Tapez exactement : manager, worker ou compta.');
    return;
  }

  try {
    await window.apiFetch(`/auth/users/${encodeURIComponent(username.trim())}/role`, {
      method: 'PATCH',
      body: { role },
    });
    alert(`Rôle de "${username}" changé en "${role}". Il faut qu'il se reconnecte pour que ça prenne effet.`);
  } catch (error) {
    alert(error.message || 'Impossible de changer ce rôle.');
  }
});

const whoShort = $('#whoami-short');
if (whoShort) {
  whoShort.textContent = CURRENT_USER || '-';
}

/* Store fallback */
if (!window.Store) {
  window.Store = (() => {
    const KEY_DEVIS = 'DEVIS';
    const KEY_BONS = 'BONS';

    const load = (key) => {
      try {
        return JSON.parse(localStorage.getItem(key) || '[]');
      } catch {
        return [];
      }
    };

    const save = (key, value) => {
      localStorage.setItem(key, JSON.stringify(value));
    };

    const upsertByField = (list, item, field, idForReplace) => {
      const index = idForReplace
        ? list.findIndex((entry) => entry.id === idForReplace)
        : list.findIndex((entry) => entry[field] === item[field]);

      item.id = item.id || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

      if (index >= 0) {
        list[index] = item;
      } else {
        list.push(item);
      }

      return list;
    };

    return { KEY_DEVIS, KEY_BONS, load, save, upsertByField };
  })();
}

/* State */
const SHOW_ALL_KEY = 'SHOW_ALL_FOR_MANAGER';
let showAll = localStorage.getItem(SHOW_ALL_KEY) === '1';
let showUnassignedOnly = false;

function hasNoResponsable(item) {
  const encadrants = Array.isArray(item.encadrants) ? item.encadrants.filter(Boolean) : [];
  return !encadrants.length && !cleanText(item.encadrant || '');
}
let boardSearchTerm = '';
let currentDevisId = null;
let currentBonId = null;
let currentBonNum = null;

const heuresBody = $('#heures-body');
const rdvPlusBody = $('#rdv-plus-body');
const cityCache = new Map();

/* Generic helpers */
function cleanText(value) {
  return String(value ?? '').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Echappe le texte en surlignant la portion qui correspond au terme recherche
function highlightMatch(value, term) {
  const raw = String(value ?? '');
  if (!term) {
    return escapeHtml(raw);
  }

  const idx = raw.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) {
    return escapeHtml(raw);
  }

  const before = raw.slice(0, idx);
  const match = raw.slice(idx, idx + term.length);
  const after = raw.slice(idx + term.length);
  return `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`;
}

function matchesBoardSearch(client, num) {
  if (!boardSearchTerm) {
    return true;
  }
  const term = boardSearchTerm.toLowerCase();
  return String(client || '').toLowerCase().includes(term) || String(num || '').toLowerCase().includes(term);
}

function formatChatText(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function serializeNamedFields(prefix) {
  const entries = [];

  $$(`[name^="${prefix}."]`).forEach((field) => {
    if (field.type === 'radio') {
      if (field.checked) {
        entries.push([field.name, field.value]);
      }
      return;
    }

    entries.push([
      field.name,
      field.type === 'checkbox' ? (field.checked ? 'oui' : 'non') : field.value,
    ]);
  });

  return Object.fromEntries(entries);
}

function setFieldValue(name, value) {
  const fields = $$(`[name="${name}"]`);
  if (!fields.length) {
    return;
  }

  if (fields[0].type === 'radio') {
    fields.forEach((field) => {
      field.checked = field.value === String(value ?? '');
    });
    return;
  }

  const field = fields[0];

  if (field.type === 'checkbox') {
    field.checked = value === 'oui' || value === true || value === '1';
    return;
  }

  if (
    field.tagName === 'SELECT' &&
    value &&
    !Array.from(field.options).some((option) => option.value === value)
  ) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    field.appendChild(option);
  }

  field.value = value ?? '';
}

function applyRawValues(raw = {}) {
  Object.entries(raw).forEach(([name, value]) => {
    setFieldValue(name, value);
  });
}

function normalizeList(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => cleanText(value))
        .filter(Boolean),
    ),
  );
}

function getCheckedValues(selector) {
  return normalizeList($$(selector).filter((field) => field.checked).map((field) => field.value));
}

function setCheckedValues(selector, values) {
  const selected = new Set(normalizeList(values));
  $$(selector).forEach((field) => {
    field.checked = selected.has(field.value);
  });
}

function getSelectedEncadrants() {
  return getCheckedValues('.enc-team');
}

function setSelectedEncadrants(values) {
  setCheckedValues('.enc-team', values);
}

function getSelectedDevisEncadrants() {
  return getCheckedValues('.devis-enc-team');
}

function setSelectedDevisEncadrants(values) {
  setCheckedValues('.devis-enc-team', values);
}

function makeDirectBTNum(list = Store.load(Store.KEY_BONS) || []) {
  const base = today().replaceAll('-', '');
  const count = list.filter((bon) => String(bon.num_devis || '').startsWith(`BT-${base}`)).length;
  return `BT-${base}-${String(count + 1).padStart(3, '0')}`;
}

function makeDevisNum(list = Store.load(Store.KEY_DEVIS) || []) {
  const base = today().replaceAll('-', '');
  const count = list.filter((devis) => String(devis.num || '').startsWith(`DV-${base}`)).length;
  return `DV-${base}-${String(count + 1).padStart(3, '0')}`;
}

function getEncadrantsForItem(item = {}) {
  const raw = item.raw || {};
  const direct = Array.isArray(item.encadrants) ? item.encadrants : [];
  const rawMany = cleanText(raw['bon.encadrants'] || raw['devis.encadrants'])
    .split('|')
    .map((value) => cleanText(value))
    .filter(Boolean);
  const single = [item.encadrant, raw['bon.encadrant'], raw['devis.encadrant']];

  return normalizeList([...direct, ...rawMany, ...single]);
}

function getPreferredEncadrants(item = {}) {
  const encadrants = getEncadrantsForItem(item);
  return encadrants.length ? encadrants : [item.encadrant || CURRENT_USER].filter(Boolean);
}

// Visibilite supplementaire : certains encadrants voient aussi les fiches
// d'un autre encadrant (ex: Karine seconde Laurent).
const EXTRA_CHEF_VISIBILITY = {
  karine: ['laurent'],
};

function belongsToChef(item) {
  const chef = cleanText(CURRENT_USER);
  if (!chef) {
    return true;
  }

  const chefLower = chef.toLowerCase();
  const namesToMatch = [chefLower, ...(EXTRA_CHEF_VISIBILITY[chefLower] || [])];

  const encadrants = getEncadrantsForItem(item);
  if (encadrants.some((name) => namesToMatch.includes(name.toLowerCase()))) {
    return true;
  }

  const team = Array.isArray(item.team) ? item.team : [];
  return team.some((name) => namesToMatch.includes(cleanText(name).toLowerCase()));
}

function removeDevisByNum(num) {
  if (!num) {
    return;
  }

  const allDevis = Store.load(Store.KEY_DEVIS);
  Store.save(
    Store.KEY_DEVIS,
    allDevis.filter((devis) => devis.num !== num),
  );
}

function displayPeopleChips(item) {
  const encadrants = getEncadrantsForItem(item);
  const team = normalizeList(Array.isArray(item.team) ? item.team : []);
  const chips = [];

  encadrants.forEach((name) => {
    chips.push(`<span class="chip chip--lead" title="Encadrant">${escapeHtml(name)}</span>`);
  });

  const encadrantsLower = new Set(encadrants.map((name) => name.toLowerCase()));
  team
    .filter((name) => !encadrantsLower.has(name.toLowerCase()))
    .forEach((name) => {
      chips.push(`<span class="chip" title="Affectation">${escapeHtml(name)}</span>`);
    });

  return chips.length ? `<div class="chips-inline">${chips.join('')}</div>` : '';
}

function syncDevisRawFlags(devis) {
  devis.raw = {
    ...(devis.raw || {}),
    'devis.signe': devis.signe || 'non',
    'devis.acompte': devis.acompte || 'non',
    'devis.refuse': devis.refuse || 'non',
  };

  return devis;
}

function formatPrintDate(value) {
  const text = cleanText(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}

function formatPrintText(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

/* Historique client (devis / bon) */
const DEVIS_PIPELINE_LABELS = {
  'd-attente-appel': "Attente d'appel / RDV",
  'd-rdv-pris': 'RDV pris',
  'd-a-saisir': 'À saisir',
  'd-attente-retour': 'Saisi / attente retour',
  'd-accepte': 'Accepté',
  'd-refuse': 'Refusé',
};

const BON_PIPELINE_LABELS = {
  'b-pret': 'Prêt / en attente',
  'b-affect': 'RDV pris + affectation',
  'b-encours': 'Chantier en cours',
  'b-facturer': 'À facturer',
  'b-archive': 'Archivé',
};

function getClientHistory(clientName, excludeType, excludeId) {
  const term = cleanText(clientName).toLowerCase();
  if (term.length < 2) {
    return [];
  }

  const devisEntries = Store.load(Store.KEY_DEVIS)
    .filter((devis) => cleanText(devis.client || devis.raw?.['devis.nom']).toLowerCase().includes(term))
    .filter((devis) => !(excludeType === 'devis' && String(devis.id) === String(excludeId)))
    .map((devis) => {
      const pipeline = getDevisPipeline(devis);
      const raw = devis.raw || {};
      return {
        type: 'devis',
        label: `${devis.num || '-'} — ${devis.objet || 'Devis'}`,
        date: raw['devis.date_demande'] || '',
        status: DEVIS_PIPELINE_LABELS[pipeline] || pipeline,
        done: pipeline === 'd-accepte' || pipeline === 'd-refuse',
        tel: raw['devis.tel'] || '',
        adresse: raw['devis.adresse'] || '',
        codePostal: raw['devis.code_postal'] || '',
        ville: raw['devis.ville'] || '',
        numClient: raw['devis.num_client'] || '',
      };
    });

  const bonEntries = Store.load(Store.KEY_BONS)
    .filter((bon) => cleanText(bon.client || bon.raw?.['bon.client_nom']).toLowerCase().includes(term))
    .filter((bon) => !(excludeType === 'bon' && String(bon.id) === String(excludeId)))
    .map((bon) => {
      const pipeline = bon.archived ? 'b-archive' : getBonPipe(bon);
      const raw = bon.raw || {};
      return {
        type: 'bon',
        label: `${bon.num_devis || '-'} — ${bon.objet || 'Bon de travail'}`,
        date: raw['bon.date_devis'] || raw['bon.rdv'] || '',
        status: BON_PIPELINE_LABELS[pipeline] || pipeline,
        done: pipeline === 'b-facturer' || pipeline === 'b-archive',
        tel: raw['bon.client_tel'] || '',
        adresse: raw['bon.client_adresse'] || '',
        codePostal: raw['bon.client_code_postal'] || '',
        ville: raw['bon.client_ville'] || '',
        numClient: raw['bon.client_num'] || '',
      };
    });

  return [...devisEntries, ...bonEntries].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function renderClientHistory(clientName, prefix, excludeType, excludeId) {
  const box = $(`#${prefix}-history-box`);
  const nameEl = $(`#${prefix}-history-client-name`);
  const countEl = $(`#${prefix}-history-count`);
  const timelineEl = $(`#${prefix}-history-timeline`);
  if (!box || !nameEl || !countEl || !timelineEl) {
    return;
  }

  const entries = getClientHistory(clientName, excludeType, excludeId);
  if (!entries.length) {
    box.classList.remove('show');
    return;
  }

  box.classList.add('show');
  nameEl.textContent = cleanText(clientName);
  countEl.textContent = `${entries.length} précédent${entries.length > 1 ? 's' : ''}`;

  timelineEl.innerHTML = entries
    .map(
      (entry, index) => `
        <div class="tl-item ${entry.done ? 'done' : ''}" data-index="${index}" title="Cliquer pour reprendre adresse / telephone de ce client">
          <div class="tl-top">
            <div class="tl-title">${escapeHtml(entry.label)}</div>
            <div class="tl-date">${escapeHtml(formatPrintDate(entry.date)) || '-'}</div>
          </div>
          <div class="tl-meta">${entry.type === 'bon' ? 'Bon de travail' : 'Devis'}</div>
          <span class="tl-status">${escapeHtml(entry.status)}</span>
        </div>
      `,
    )
    .join('');

  timelineEl.querySelectorAll('.tl-item').forEach((el) => {
    el.addEventListener('click', () => {
      applyClientHistoryEntry(entries[Number(el.dataset.index)], prefix);
    });
  });
}

const CLIENT_HISTORY_FIELD_MAP = {
  devis: {
    tel: 'devis.tel',
    adresse: 'devis.adresse',
    codePostal: 'devis.code_postal',
    ville: 'devis.ville',
    numClient: 'devis.num_client',
  },
  bon: {
    tel: 'bon.client_tel',
    adresse: 'bon.client_adresse',
    codePostal: 'bon.client_code_postal',
    ville: 'bon.client_ville',
    numClient: 'bon.client_num',
  },
};

// Reprend uniquement les coordonnees du client (adresse, telephone, n°) sur
// un ancien devis/bon, sans toucher aux champs propres au nouveau chantier
function applyClientHistoryEntry(entry, prefix) {
  const map = CLIENT_HISTORY_FIELD_MAP[prefix];
  if (!entry || !map) {
    return;
  }

  setFieldValue(map.numClient, entry.numClient);
  setFieldValue(map.tel, entry.tel);
  setFieldValue(map.adresse, entry.adresse);
  setFieldValue(map.codePostal, entry.codePostal);
  setFieldValue(map.ville, entry.ville);
}

function buildPrintRows(rows = []) {
  return rows
    .filter(([, value]) => cleanText(value))
    .map(
      ([label, value]) => `
        <tr>
          <th>${escapeHtml(label)}</th>
          <td>${formatPrintText(value)}</td>
        </tr>
      `,
    )
    .join('');
}

function buildPrintTable(headers = [], rows = []) {
  const safeRows = rows.filter(
    (row) => Array.isArray(row) && row.some((cell) => cleanText(cell)),
  );

  if (!safeRows.length) {
    return '<div class="small muted">Aucune donnee.</div>';
  }

  return `
    <table class="print-table">
      <thead>
        <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${safeRows
          .map(
            (row) => `
              <tr>${row.map((cell) => `<td>${formatPrintText(cell)}</td>`).join('')}</tr>
            `,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function openPrintWindow(title, bodyHtml) {
  const popup = window.open('', '_blank', 'width=960,height=780');

  if (!popup) {
    alert('Autorisez les popups pour imprimer le document.');
    return;
  }

  popup.document.write(`
    <!DOCTYPE html>
    <html lang="fr">
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(title)}</title>
        <style>
          body{font-family:Arial,sans-serif;margin:24px;color:#111827}
          h1,h2{margin:0 0 10px}
          h1{font-size:28px}
          h2{font-size:18px;margin-top:24px}
          .muted{color:#6b7280}
          .print-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px}
          .print-block{margin-top:18px}
          .print-meta{font-size:14px}
          .print-table{width:100%;border-collapse:collapse;margin-top:8px}
          .print-table th,.print-table td{border:1px solid #d1d5db;padding:8px;vertical-align:top;text-align:left}
          .print-table th{background:#f3f4f6;width:32%}
          .print-lines{margin-top:8px}
          .print-line{border-bottom:1px solid #9ca3af;min-height:24px;padding:2px 1px}
          .toolbar{margin-bottom:16px;text-align:right}
          .toolbar button{padding:10px 14px;border:0;background:#111827;color:#fff;border-radius:8px;cursor:pointer}
          .small{font-size:13px}
          @media print{
            body{margin:12mm}
            .toolbar{display:none}
          }
        </style>
      </head>
      <body>
        <div class="toolbar">
          <button onclick="window.print()">Imprimer</button>
        </div>
        ${bodyHtml}
      </body>
    </html>
  `);
  popup.document.close();

  setTimeout(() => {
    try {
      popup.focus();
      popup.print();
    } catch (error) {
      console.warn('Impossible de lancer l impression automatiquement', error);
    }
  }, 250);
}

function buildDevisPrintHtml(item) {
  const raw = item.raw || {};
  const encadrants = getPreferredEncadrants(item);
  const chantierRows =
    raw['devis.adresse_chantier_diff'] === 'oui'
      ? buildPrintRows([
          ['Adresse chantier', raw['devis.adresse_chantier']],
          ['Code postal chantier', raw['devis.chantier_code_postal']],
          ['Ville chantier', raw['devis.chantier_ville']],
          ['Nom locataire', raw['devis.nom_locataire']],
          ['Telephone locataire', raw['devis.tel_locataire']],
          ['Remarques chantier', raw['devis.remarques_chantier']],
        ])
      : '';
  const statut = [
    item.signe === 'oui' ? 'Devis signe' : '',
    item.acompte === 'oui' ? 'Acompte recu' : '',
    item.refuse === 'oui' ? 'Refuse' : '',
  ]
    .filter(Boolean)
    .join(' - ');

  return `
    <div class="print-head">
      <div>
        <h1>Devis</h1>
        <div class="print-meta muted">Numero ${escapeHtml(item.num || '-')}</div>
      </div>
      <div class="print-meta">
        <div><strong>Date :</strong> ${formatPrintText(formatPrintDate(raw['devis.date_demande'])) || '-'}</div>
        <div><strong>Indice :</strong> ${formatPrintText(raw['devis.indice']) || '-'}</div>
      </div>
    </div>

    <div class="print-block">
      <h2>Client</h2>
      <table class="print-table">
        <tbody>
          ${buildPrintRows([
            ['Nom', raw['devis.nom']],
            ['Numero client', raw['devis.num_client']],
            ['Telephone', raw['devis.tel']],
            ['Adresse', raw['devis.adresse']],
            ['Code postal', raw['devis.code_postal']],
            ['Ville', raw['devis.ville']],
          ])}
        </tbody>
      </table>
    </div>

    <div class="print-block">
      <h2>Demande</h2>
      <table class="print-table">
        <tbody>
          ${buildPrintRows([
            ['Objet', raw['devis.objet_demande'] || item.objet],
            ['Notes avant RDV', raw['devis.notes_avant_rdv']],
            ['Encadrants', encadrants.join(', ')],
            ['Statut', statut],
          ])}
        </tbody>
      </table>
    </div>

    ${
      chantierRows
        ? `
          <div class="print-block">
            <h2>Chantier</h2>
            <table class="print-table">
              <tbody>${chantierRows}</tbody>
            </table>
          </div>
        `
        : ''
    }
  `;
}

function buildBonPrintHtml(item) {
  const raw = item.raw || {};
  const encadrants = getPreferredEncadrants(item);
  const team = normalizeList(item.team || []);
  const chantierRows =
    raw['bon.adresse_chantier_diff'] === 'oui'
      ? buildPrintRows([
          ['Adresse chantier', raw['bon.adresse_chantier']],
          ['Code postal chantier', raw['bon.chantier_code_postal']],
          ['Ville chantier', raw['bon.chantier_ville']],
          ['Nom locataire', raw['bon.nom_locataire']],
          ['Telephone locataire', raw['bon.tel_locataire']],
          ['Remarques chantier', raw['bon.remarques_chantier']],
        ])
      : '';
  const rdvRows = [];

  if (cleanText(raw['bon.rdv']) || cleanText(raw['bon.rdv_heure'])) {
    rdvRows.push(['Initial', formatPrintDate(raw['bon.rdv']), raw['bon.rdv_heure'] || '']);
  }

  (item.rdv_plus || []).forEach((rdv, index) => {
    rdvRows.push([`Supplementaire ${index + 1}`, formatPrintDate(rdv.date), rdv.heure || '']);
  });

  const hoursRows = (item.lignes || []).map((row) => {
    const [dateDebut, heureDebut, dateFin, heureFin, commentaire] = normalizeHeuresRow(row);
    return [formatPrintDate(dateDebut), heureDebut, formatPrintDate(dateFin), heureFin, commentaire];
  });

  // Toujours au moins 4 lignes imprimees, meme vides, pour ecrire a la main sur le papier
  const detailsLines = cleanText(raw['bon.details']) ? String(raw['bon.details']).split('\n') : [];
  while (detailsLines.length < 4) {
    detailsLines.push('');
  }

  const title = String(item.num_devis || '').startsWith('BT-') ? 'BT depannage' : 'Bon de travail';

  return `
    <div class="print-head">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="print-meta muted">Numero ${escapeHtml(item.num_devis || '-')}</div>
      </div>
      <div class="print-meta">
        <div><strong>Date :</strong> ${formatPrintText(formatPrintDate(raw['bon.date_devis'])) || '-'}</div>
        <div><strong>Acompte :</strong> ${formatPrintText(raw['bon.acompte']) || '-'}</div>
      </div>
    </div>

    <div class="print-block">
      <h2>Client</h2>
      <table class="print-table">
        <tbody>
          ${buildPrintRows([
            ['Nom', raw['bon.client_nom'] || item.client],
            ['Numero client', raw['bon.client_num']],
            ['Telephone', raw['bon.client_tel']],
            ['Adresse', raw['bon.client_adresse']],
            ['Code postal', raw['bon.client_code_postal']],
            ['Ville', raw['bon.client_ville']],
          ])}
        </tbody>
      </table>
    </div>

    <div class="print-block">
      <h2>Intervention</h2>
      <table class="print-table">
        <tbody>
          ${buildPrintRows([
            ['Objet', raw['bon.objet'] || item.objet],
            ['Equipe affectee', team.join(', ')],
            ['Encadrants', encadrants.join(', ')],
            ['Compta', item.admin || raw['bon.admin']],
            ['Commande materiel', raw['bon.cmd_materiel']],
            ['Reception materiel', raw['bon.recep_materiel']],
            ['Notes avant RDV', raw['bon.notes_avant_rdv']],
          ])}
        </tbody>
      </table>
    </div>

    ${
      chantierRows
        ? `
          <div class="print-block">
            <h2>Chantier</h2>
            <table class="print-table">
              <tbody>${chantierRows}</tbody>
            </table>
          </div>
        `
        : ''
    }

    <div class="print-block">
      <h2>Détails</h2>
      <div class="print-lines">
        ${detailsLines.map((line) => `<div class="print-line">${escapeHtml(line)}</div>`).join('')}
      </div>
    </div>

    <div class="print-block">
      <h2>Rendez-vous</h2>
      ${buildPrintTable(['Type', 'Date', 'Heure'], rdvRows)}
    </div>

    <div class="print-block">
      <h2>Feuille d heures</h2>
      ${buildPrintTable(
        ['Date debut', 'Heure debut', 'Date fin', 'Heure fin', 'Commentaire'],
        hoursRows,
      )}
    </div>

    <div class="print-block">
      <h2>Signature client</h2>
      ${
        item.signature?.present && item.signature?.dataUrl
          ? `<img src="${item.signature.dataUrl}" alt="Signature client" style="max-width:260px; background:#fff; border-radius:6px; padding:4px">
             <div class="muted" style="margin-top:4px">Signe le ${escapeHtml(item.signature.date || '')}</div>`
          : `<div class="muted">Signature client : non recueillie${item.signature?.date ? ` (chantier termine le ${escapeHtml(item.signature.date)})` : ''}</div>`
      }
    </div>
  `;
}

function printDevisItem(item) {
  openPrintWindow(`Devis ${item.num || ''}`, buildDevisPrintHtml(item));
}

function printBonItem(item) {
  const label = String(item.num_devis || '').startsWith('BT-') ? 'BT depannage' : 'Bon de travail';
  openPrintWindow(`${label} ${item.num_devis || ''}`, buildBonPrintHtml(item));
}

function buildCurrentDevisForPrint() {
  const raw = serializeNamedFields('devis');
  const encadrants = getSelectedDevisEncadrants();

  return {
    num: cleanText(raw['devis.num_devis']),
    client: cleanText(raw['devis.nom']),
    objet: cleanText(raw['devis.objet_demande'] || raw['devis.objet']),
    signe: raw['devis.signe'] || 'non',
    acompte: raw['devis.acompte'] || 'non',
    refuse: raw['devis.refuse'] || 'non',
    encadrants,
    encadrant: encadrants[0] || '',
    raw: {
      ...raw,
      'devis.encadrants': encadrants.join('|'),
      'devis.encadrant': encadrants[0] || '',
    },
  };
}

function buildCurrentBonForPrint() {
  const raw = serializeNamedFields('bon');
  const team = getCheckedValues('.aff-team');
  const bonAdmin = $('#bon-admin');
  const encadrants = getSelectedEncadrants();

  return {
    num_devis: cleanText(raw['bon.num_devis']) || makeDirectBTNum(),
    client: cleanText(raw['bon.client_nom']),
    objet: cleanText(raw['bon.objet']),
    lignes: collectHeuresRows(),
    rdv_plus: collectRdvRows(),
    team,
    admin: cleanText(bonAdmin?.value),
    encadrants,
    encadrant: encadrants[0] || '',
    raw: {
      ...raw,
      'bon.admin': cleanText(bonAdmin?.value),
      'bon.encadrants': encadrants.join('|'),
      'bon.encadrant': encadrants[0] || '',
    },
  };
}

function buildCurrentDirectBonForPrint() {
  const raw = serializeNamedFields('direct');
  const encadrants = getCheckedValues('.direct-enc-team');
  const team = getCheckedValues('.direct-aff-team');
  const num = cleanText(raw['direct.num_bt']) || makeDirectBTNum();
  const urgence = cleanText(raw['direct.urgence']) || 'normal';
  const objetBase = cleanText(raw['direct.objet']);
  const objet = cleanText(`[DEPANNAGE ${urgence}] ${objetBase}`);

  return {
    num_devis: num,
    client: cleanText(raw['direct.client_nom']),
    objet,
    lignes: [],
    rdv_plus: [],
    team,
    admin: '',
    encadrants,
    encadrant: encadrants[0] || CURRENT_USER || '',
    raw: {
      'bon.num_devis': num,
      'bon.date_devis': raw['direct.date'] || today(),
      'bon.client_nom': raw['direct.client_nom'] || '',
      'bon.client_tel': raw['direct.client_tel'] || '',
      'bon.client_adresse': raw['direct.client_adresse'] || '',
      'bon.client_code_postal': raw['direct.client_code_postal'] || '',
      'bon.client_ville': raw['direct.client_ville'] || '',
      'bon.objet': objet,
      'bon.adresse_chantier_diff': raw['direct.adresse_chantier_diff'] || 'non',
      'bon.adresse_chantier': raw['direct.adresse_chantier'] || '',
      'bon.chantier_code_postal': raw['direct.chantier_code_postal'] || '',
      'bon.chantier_ville': raw['direct.chantier_ville'] || '',
      'bon.nom_locataire': raw['direct.nom_locataire'] || '',
      'bon.tel_locataire': raw['direct.tel_locataire'] || '',
      'bon.remarques_chantier': raw['direct.remarques_chantier'] || '',
      'bon.encadrants': encadrants.join('|'),
      'bon.encadrant': encadrants[0] || CURRENT_USER || '',
    },
  };
}

function ensurePrintButtons() {
  const targets = [
    ['save-devis', 'print-devis', 'Imprimer', () => printDevisItem(buildCurrentDevisForPrint())],
    ['save-bon', 'print-bon', 'Imprimer', () => printBonItem(buildCurrentBonForPrint())],
    [
      'save-bon-direct',
      'print-bon-direct',
      'Imprimer',
      () => printBonItem(buildCurrentDirectBonForPrint()),
    ],
  ];

  targets.forEach(([saveId, printId, label, handler]) => {
    const saveButton = document.getElementById(saveId);
    if (!saveButton || document.getElementById(printId)) {
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.id = printId;
    button.className = 'btn outline';
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      handler();
    });

    saveButton.parentElement?.insertBefore(button, saveButton);
  });
}

/* Planning manager (toute l'equipe) */
const PLANNING_ROSTER = [
  { name: 'Alexy', team: 'Charbo' },
  { name: 'Thomas', team: 'Charbo' },
  { name: 'Augustin', team: 'Charbo' },
  { name: 'Pierre-Clément', team: 'Charbo' },
  { name: 'Valentin', team: 'Charbo' },
  { name: 'Benoit', team: 'Charbo' },
  { name: 'Naiki', team: 'Charbo' },
  { name: 'Burak', team: 'Charbo' },
  { name: 'Bertrand', team: 'Charbo' },
  { name: 'Maxence', team: 'Charbo' },
  { name: 'Olivier', team: 'Charbo' },
  { name: 'Edgar', team: 'Charbo' },
  { name: 'Denis', team: 'Tarare' },
  { name: 'Bachir', team: 'Tarare' },
  { name: 'Fabrice', team: 'Tarare' },
  { name: 'Mazlum', team: 'Tarare' },
  { name: 'Omer', team: 'Tarare' },
  { name: 'Lucas', team: 'Tarare' },
  { name: 'Thierry', team: 'Tarare' },
  { name: 'Anthony', team: 'Tarare' },
  { name: 'Gérard', team: 'Tarare' },
  { name: 'Julien', team: 'Tarare' },
  { name: 'Philippe', team: 'Tarare' },
  { name: 'Cheik', team: 'Tarare' },
  { name: 'Ahmed', team: 'Tarare' },
  { name: 'Yoseane', team: 'Tarare' },
  { name: 'Chris', team: 'Tarare' },
  { name: 'Wakary', team: 'Tarare' },
  { name: 'ThomasV', team: 'Tarare' },
  { name: 'Christophe', team: 'Tarare' },
];

let planningMgrWeekOffset = 0;
let planningMgrTeamFilter = 'all';

function planningIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Badge "Aujourd'hui" / "Demain" selon les RDV du bon (initial + supplementaires)
function rdvUrgencyBadgeHtml(bon) {
  const entries = planningGetRdvEntries(bon);
  if (!entries.length) {
    return '';
  }

  const todayIso = planningIsoDate(new Date());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowIso = planningIsoDate(tomorrowDate);

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

  const heureText = match.entry.heure ? ` · ${escapeHtml(match.entry.heure)}` : '';
  return `<span class="badge ${match.cls}">🕐 ${match.label}${heureText}</span>`;
}

function planningGetWeekDays(offset) {
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

// Dates de RDV d'un bon (RDV initial + RDV supplementaires), choisies par l'encadrant
function planningGetRdvEntries(bon) {
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

// Detecte si un membre de l'equipe affectee a deja une mission (sur un autre
// bon) le meme jour qu'une des dates de RDV du bon en cours d'enregistrement
function findAssignmentConflicts(item, allBons) {
  const team = Array.isArray(item.team) ? item.team : [];
  const myDates = new Set(planningGetRdvEntries(item).map((entry) => entry.date));

  if (!team.length || !myDates.size) {
    return [];
  }

  const conflicts = [];

  allBons.forEach((other) => {
    if (item.id != null && String(other.id) === String(item.id)) {
      return;
    }

    const otherTeam = Array.isArray(other.team) ? other.team : [];
    const otherDates = planningGetRdvEntries(other).map((entry) => entry.date);

    team.forEach((person) => {
      if (!otherTeam.includes(person)) {
        return;
      }
      otherDates.forEach((date) => {
        if (myDates.has(date)) {
          conflicts.push({ person, date, client: other.client || 'Client ?' });
        }
      });
    });
  });

  return conflicts;
}

function renderPlanningManager() {
  const head = $('#planning-mgr-head');
  const body = $('#planning-mgr-body');
  const rangeLabel = $('#planning-mgr-range');
  if (!head || !body) {
    return;
  }

  const days = planningGetWeekDays(planningMgrWeekOffset);
  const dayLabels = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
  const todayIso = planningIsoDate(new Date());

  if (rangeLabel) {
    const fmt = (d) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    rangeLabel.textContent = planningMgrWeekOffset === 0
      ? `Cette semaine · ${fmt(days[0])} – ${fmt(days[4])}`
      : `${fmt(days[0])} – ${fmt(days[4])}`;
  }

  head.innerHTML = `
    <th class="person-col">Intervenant</th>
    ${days.map((d, i) => `<th>${dayLabels[i]} ${d.getDate()}</th>`).join('')}
  `;

  const allBons = Store.load(Store.KEY_BONS) || [];
  const people = PLANNING_ROSTER.filter(
    (person) => planningMgrTeamFilter === 'all' || person.team === planningMgrTeamFilter,
  );

  body.innerHTML = people
    .map((person) => {
      const cells = days
        .map((d) => {
          const iso = planningIsoDate(d);
          const items = [];

          allBons.forEach((bon) => {
            if (!(bon.team || []).includes(person.name)) {
              return;
            }
            planningGetRdvEntries(bon).forEach((entry) => {
              if (entry.date === iso) {
                items.push({ bon, entry });
              }
            });
          });
          items.sort((a, b) => (a.entry.heure || '').localeCompare(b.entry.heure || ''));

          if (!items.length) {
            return '<td><div class="planning-day-cell"><span class="planning-empty">—</span></div></td>';
          }

          const conflict = items.length > 1;
          const chips = items
            .map(
              ({ bon, entry }) => `
                <div class="mission-chip${conflict ? ' conflict' : ''}" data-bon-id="${bon.id}">
                  ${entry.heure ? `<span class="heure">${escapeHtml(entry.heure)}</span>` : ''}${escapeHtml(bon.client || 'Client ?')}
                </div>
              `,
            )
            .join('');

          return `<td><div class="planning-day-cell">${chips}${conflict ? '<span class="conflict-tag">2 missions</span>' : ''}</div></td>`;
        })
        .join('');

      return `
        <tr>
          <td class="person-cell">
            <div class="person-name">${escapeHtml(person.name)}</div>
            <div class="person-team">${escapeHtml(person.team)}</div>
          </td>
          ${cells}
        </tr>
      `;
    })
    .join('');

  body.querySelectorAll('.mission-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const bon = allBons.find((entry) => String(entry.id) === chip.dataset.bonId);
      if (!bon) {
        return;
      }
      openBon(bon);
    });
  });
}

$('#planning-mgr-prev')?.addEventListener('click', () => {
  planningMgrWeekOffset -= 1;
  renderPlanningManager();
});

$('#planning-mgr-next')?.addEventListener('click', () => {
  planningMgrWeekOffset += 1;
  renderPlanningManager();
});

$$('#planning-mgr-team-toggle .team-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('#planning-mgr-team-toggle .team-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    planningMgrTeamFilter = btn.dataset.team;
    renderPlanningManager();
  });
});

/* Messagerie (un fil par chantier) */
let messagerieActiveBonId = null;
let messagerieSearchTerm = '';

function messagerieBons() {
  const all = Store.load(Store.KEY_BONS) || [];
  return showAll ? all : all.filter(belongsToChef);
}

// Pastille de notification sur l'onglet Messagerie, mise a jour independamment
// de l'onglet actuellement affiche
function updateMessagerieTabBadge() {
  const badge = $('#messagerie-tab-badge');
  if (!badge) {
    return;
  }

  const who = cleanText(CURRENT_USER);
  const total = messagerieBons().reduce((sum, bon) => sum + countUnreadFor(bon, who), 0);

  if (total > 0) {
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

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
  const who = cleanText(CURRENT_USER);
  const term = messagerieSearchTerm.trim().toLowerCase();

  return messagerieBons()
    .map((bon) => {
      const chat = Array.isArray(bon.chat) ? bon.chat : [];
      return { bon, last: chat[chat.length - 1] || null, unread: countUnreadFor(bon, who) };
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
    .sort((a, b) => tsOf(b.last) - tsOf(a.last));
}

function renderMessagerieThreads() {
  const list = $('#msg-threads');
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
        ? `${escapeHtml(last.from || '')} : ${escapeHtml((last.text || '').slice(0, 60))}`
        : 'Aucun message';
      return `
        <div class="thread ${String(bon.id) === String(messagerieActiveBonId) ? 'active' : ''} ${unread ? 'unread' : ''}" data-bon-id="${bon.id}">
          <div class="thread-avatar">${escapeHtml(messagerieInitials(bon.client))}</div>
          <div class="thread-body">
            <div class="thread-top">
              <div class="thread-client">${escapeHtml(bon.client || 'Client ?')}</div>
              <div class="thread-time">${escapeHtml(last?.date || '')}</div>
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
  const title = $('#msg-conv-title');
  const sub = $('#msg-conv-sub');
  const body = $('#msg-conv-body');
  const openLink = $('#msg-conv-open');
  const deleteButton = $('#msg-conv-delete');
  if (!title || !sub || !body) {
    return;
  }

  const freshBon = Store.load(Store.KEY_BONS).find((entry) => String(entry.id) === String(bon.id)) || bon;
  const chat = Array.isArray(freshBon.chat) ? freshBon.chat : [];
  const who = cleanText(CURRENT_USER);

  title.textContent = freshBon.client || 'Client ?';
  sub.textContent = `${freshBon.num_devis || '-'}${freshBon.encadrant ? ` · Encadrant ${freshBon.encadrant}` : ''}`;

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
              <div class="bubble">${me ? '' : `<strong>${escapeHtml(message.from || '?')}</strong> — `}${formatChatText(message.text || '')}</div>
              <div class="bubble-meta">${escapeHtml(message.date || '')}</div>
            </div>
          `;
        })
        .join('')
    : '<div class="small muted">Aucun message.</div>';

  body.scrollTop = body.scrollHeight;

  if (openLink) {
    openLink.onclick = (event) => {
      event.preventDefault();
      openBon(freshBon);
    };
  }
}

function openMessagerieThread(bonId) {
  const bon = messagerieBons().find((entry) => String(entry.id) === String(bonId));
  if (!bon) {
    return;
  }

  messagerieActiveBonId = bon.id;
  markChatSeen(bon, cleanText(CURRENT_USER) || 'Encadrant');
  renderMessagerieThreads();
  renderMessagerieConversation(bon);
}

function sendMessagerieMessage() {
  const input = $('#msg-compose-input');
  if (!input || !messagerieActiveBonId) {
    return;
  }

  const text = cleanText(input.value);
  if (!text) {
    return;
  }

  const who = cleanText(CURRENT_USER) || 'Encadrant';
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

$('#msg-compose-send')?.addEventListener('click', sendMessagerieMessage);
$('#msg-compose-input')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    sendMessagerieMessage();
  }
});

$('#msg-search')?.addEventListener('input', (event) => {
  messagerieSearchTerm = event.target.value;
  renderMessagerieThreads();
});

function refreshMessagerie() {
  renderMessagerieThreads();

  if (messagerieActiveBonId) {
    const bon = messagerieBons().find((entry) => String(entry.id) === String(messagerieActiveBonId));
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

/* Tabs */
function showTab(name) {
  const tabs = $$('.tabs .tab');
  const views = $$('main .view');

  tabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === name);
  });

  views.forEach((view) => {
    view.classList.toggle('show', view.id === `tab-${name}`);
  });

  if (name === 'board') {
    try {
      renderBoard();
    } catch (error) {
      console.warn('renderBoard a echoue', error);
    }
  }

  if (name === 'planning') {
    try {
      renderPlanningManager();
    } catch (error) {
      console.warn('renderPlanningManager a echoue', error);
    }
  }

  if (name === 'messagerie') {
    try {
      refreshMessagerie();
    } catch (error) {
      console.warn('refreshMessagerie a echoue', error);
    }
  }

  if (name === 'devis') {
    setTimeout(initDevisDefaults, 0);
  }

  if (name === 'bon-direct') {
    setTimeout(initBonDirect, 0);
  }
}

(function initTabs() {
  $$('.tabs .tab').forEach((tab) => {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      showTab(tab.dataset.tab);
    });
  });

  showTab('board');
})();

/* Filtre par chef */
const showAllToggle = $('#show-all');
if (showAllToggle) {
  showAllToggle.checked = showAll;
  showAllToggle.onchange = () => {
    showAll = !!showAllToggle.checked;
    localStorage.setItem(SHOW_ALL_KEY, showAll ? '1' : '0');
    renderBoard();
  };
}

const showUnassignedToggle = $('#show-unassigned');
if (showUnassignedToggle) {
  showUnassignedToggle.onchange = () => {
    showUnassignedOnly = !!showUnassignedToggle.checked;
    renderBoard();
  };
}

$('#board-search')?.addEventListener('input', (event) => {
  boardSearchTerm = event.target.value.trim();
  renderBoard();
});

$('[name="devis.nom"]')?.addEventListener('input', (event) => {
  renderClientHistory(event.target.value, 'devis', 'devis', currentDevisId);
});

$('[name="bon.client_nom"]')?.addEventListener('input', (event) => {
  renderClientHistory(event.target.value, 'bon', 'bon', currentBonId);
});

/* Bon rows */
const HEURES_ROW_TYPES = ['date', 'time', 'date', 'time', 'text'];

// Compat : les anciennes lignes avaient 6 colonnes (avec un champ "Heures" inutilise en position 4)
function normalizeHeuresRow(values = []) {
  if (values.length >= 6) {
    return [values[0], values[1], values[2], values[3], values[5]];
  }
  return HEURES_ROW_TYPES.map((_, index) => values[index] || '');
}

function addHeuresRow(values = []) {
  if (!heuresBody) {
    return;
  }

  const normalized = normalizeHeuresRow(values);
  const row = document.createElement('tr');

  HEURES_ROW_TYPES.forEach((type, index) => {
    const cell = document.createElement('td');
    const input = document.createElement('input');
    input.type = type;
    input.value = normalized[index] || '';
    input.style.width = '100%';
    input.style.border = '0';
    cell.appendChild(input);
    row.appendChild(cell);
  });

  const deleteCell = document.createElement('td');
  const deleteButton = document.createElement('button');
  deleteButton.textContent = 'x';
  deleteButton.className = 'btn danger';
  deleteButton.onclick = () => row.remove();
  deleteCell.appendChild(deleteButton);
  row.appendChild(deleteCell);
  heuresBody.appendChild(row);
}

function resetHeuresRows(minRows = 0) {
  if (!heuresBody) {
    return;
  }

  heuresBody.innerHTML = '';
  for (let index = 0; index < minRows; index += 1) {
    addHeuresRow();
  }
}

function loadHeuresRows(rows = []) {
  resetHeuresRows(0);
  rows.forEach((row) => addHeuresRow(row));

  if (!heuresBody?.children.length) {
    resetHeuresRows(3);
  }
}

function collectHeuresRows() {
  return [...(heuresBody?.querySelectorAll('tr') || [])].map((row) =>
    [...row.querySelectorAll('input')].map((input) => input.value),
  );
}

function addRDV(date = '', heure = '') {
  if (!rdvPlusBody) {
    return;
  }

  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input type="date" value="${escapeHtml(date)}"></td>
    <td><input type="time" value="${escapeHtml(heure)}"></td>
    <td><button class="btn danger" type="button">x</button></td>
  `;

  row.querySelector('button').onclick = () => row.remove();
  rdvPlusBody.appendChild(row);
}

function resetRdvRows() {
  if (rdvPlusBody) {
    rdvPlusBody.innerHTML = '';
  }
}

function loadRdvRows(rows = []) {
  resetRdvRows();
  rows.forEach((row) => addRDV(row.date, row.heure));
}

function collectRdvRows() {
  return [...(rdvPlusBody?.querySelectorAll('tr') || [])].map((row) => {
    const [date, heure] = [...row.querySelectorAll('input')].map((input) => input.value);
    return { date, heure };
  });
}

$('#add-row')?.addEventListener('click', (event) => {
  event.preventDefault();
  addHeuresRow();
});

$('#add-rdv')?.addEventListener('click', (event) => {
  event.preventDefault();
  addRDV();
});

if (heuresBody && !heuresBody.children.length) {
  resetHeuresRows(3);
}

/* Defaults */
function initDevisDefaults() {
  const dateField = $('#ddate');
  if (dateField && !dateField.value) {
    dateField.value = today();
  }

  const numField = $('#dnum');
  if (numField && !numField.value) {
    numField.value = makeDevisNum();
  }
}

function initBonDirect() {
  const numField = $('[name="direct.num_bt"]');
  const dateField = $('[name="direct.date"]');

  if (numField && !numField.value) {
    numField.value = makeDirectBTNum();
  }

  if (dateField && !dateField.value) {
    dateField.value = today();
  }

  $$('.direct-enc-team').forEach((field) => {
    field.checked = field.value === CURRENT_USER;
  });
}

document.readyState !== 'loading'
  ? initDevisDefaults()
  : document.addEventListener('DOMContentLoaded', initDevisDefaults);

document.readyState !== 'loading'
  ? resetDevisGalleryEmpty()
  : document.addEventListener('DOMContentLoaded', resetDevisGalleryEmpty);

setTimeout(() => {
  if (!getSelectedEncadrants().length && CURRENT_USER) {
    setSelectedEncadrants([CURRENT_USER]);
  }
}, 0);

/* Form helpers */
function openDevis(item) {
  applyRawValues(item.raw || {});
  setSelectedDevisEncadrants(getPreferredEncadrants(item));

  const devisAdmin = $('#devis-admin');
  if (devisAdmin) {
    devisAdmin.value = item.raw?.['devis.admin'] || item.admin || '';
  }

  const blocChantier = $('#bloc-chantier');
  if (blocChantier) {
    blocChantier.style.display = item.raw?.['devis.adresse_chantier_diff'] === 'oui' ? '' : 'none';
  }

  currentDevisId = item.id;
  initDevisGallery(item);
  showTab('devis');
  initDevisDefaults();
  renderClientHistory(item.client || item.raw?.['devis.nom'] || '', 'devis', 'devis', item.id);
}

function openBon(item) {
  applyRawValues(item.raw || {});
  loadHeuresRows(item.lignes || []);
  loadRdvRows(item.rdv_plus || []);
  setCheckedValues('.aff-team', item.team || []);
  setSelectedEncadrants(getPreferredEncadrants(item));

  const bonAdmin = $('#bon-admin');
  if (bonAdmin) {
    bonAdmin.value = item.raw?.['bon.admin'] || item.admin || '';
  }

  const bBlocChantier = $('#b-bloc-chantier');
  if (bBlocChantier) {
    bBlocChantier.style.display = item.raw?.['bon.adresse_chantier_diff'] === 'oui' ? '' : 'none';
  }

  currentBonId = item.id;
  currentBonNum = item.num_devis;

  showTab('bon');
  initManagerChat(item);
  initManagerGallery(item);
  renderManagerSignature(item);
  markChatSeen(item, cleanText(CURRENT_USER));
  renderClientHistory(item.client || item.raw?.['bon.client_nom'] || '', 'bon', 'bon', item.id);
  renderBoard();
}

function prepareNewBonForm() {
  currentBonId = null;
  currentBonNum = null;

  $('#bon-history-box')?.classList.remove('show');

  $$('[name^="bon."]').forEach((field) => {
    if (field.type === 'checkbox' || field.type === 'radio') {
      field.checked = false;
    } else {
      field.value = '';
    }
  });

  const bonAdmin = $('#bon-admin');
  if (bonAdmin) {
    bonAdmin.value = '';
  }

  setFieldValue('bon.num_devis', makeDirectBTNum());
  setFieldValue('bon.date_devis', today());
  setCheckedValues('.aff-team', []);
  setSelectedEncadrants([CURRENT_USER].filter(Boolean));
  resetHeuresRows(3);
  resetRdvRows();
  resetManagerChatAndGallery();
}

// Un bon pas encore enregistre n'a pas d'id : la conversation et les photos
// de l'ancien bon ouvert ne doivent pas rester affichees ni actives.
function resetManagerChatAndGallery() {
  const chatLog = $('#mgr-chat-log');
  const chatInput = $('#mgr-chat-input');
  const chatSend = $('#mgr-chat-send');

  if (chatLog) {
    chatLog.innerHTML = '<div class="small muted">Enregistrez le bon pour activer les messages.</div>';
  }
  if (chatInput) {
    chatInput.value = '';
  }
  if (chatSend) {
    chatSend.onclick = null;
    chatSend.disabled = true;
  }

  const gallery = $('#mgr-gallery');
  const galleryEmpty = $('#mgr-gallery-empty');
  const photoInput = $('#mgr-photo-input');
  const photoAdd = $('#mgr-photo-add');

  if (gallery) {
    gallery.innerHTML = '';
  }
  if (galleryEmpty) {
    galleryEmpty.textContent = 'Enregistrez le bon pour activer les photos.';
    galleryEmpty.style.display = '';
  }
  if (photoInput) {
    photoInput.value = '';
    photoInput.onchange = null;
  }
  if (photoAdd) {
    photoAdd.onclick = null;
    photoAdd.disabled = true;
  }
}

function resetDirectBonForm() {
  $$('[name^="direct."]').forEach((field) => {
    if (field.type === 'checkbox' || field.type === 'radio') {
      field.checked = false;
    } else {
      field.value = '';
    }
  });

  setCheckedValues('.direct-aff-team', []);

  const dirBlocChantier = $('#dir-bloc-chantier');
  if (dirBlocChantier) {
    dirBlocChantier.style.display = 'none';
  }

  initBonDirect();
}

document.readyState !== 'loading'
  ? ensurePrintButtons()
  : document.addEventListener('DOMContentLoaded', ensurePrintButtons);

/* Chat */
function tsOf(message) {
  if (!message) {
    return 0;
  }

  if (typeof message.ts === 'number') {
    return message.ts;
  }

  const timestamp = Date.parse(message.date || '');
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function markChatSeen(bon, who) {
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

function countUnreadFor(bon, who) {
  const seenTs = bon.chatSeen?.[who] || 0;
  const messages = Array.isArray(bon.chat) ? bon.chat : [];
  return messages.filter((message) => (message.from || '') !== who && tsOf(message) > seenTs).length;
}

function initManagerChat(bon) {
  const log = $('#mgr-chat-log');
  const input = $('#mgr-chat-input');
  const sendButton = $('#mgr-chat-send');

  if (!log || !input || !sendButton) {
    return;
  }

  sendButton.disabled = false;

  const who = cleanText(CURRENT_USER) || 'Encadrant';

  function renderLog() {
    const freshBon = Store.load(Store.KEY_BONS).find((entry) => entry.id === bon.id) || bon;
    const chat = Array.isArray(freshBon.chat) ? freshBon.chat : [];
    const lastMessages = chat.slice(-30);

    log.innerHTML =
      lastMessages
        .map(
          (message) => `
            <div class="chat-line">
              <strong>${escapeHtml(message.from || '?')}</strong>
              <span class="small muted">${escapeHtml(
                message.date || new Date(message.ts || Date.now()).toLocaleString(),
              )}</span><br>
              ${formatChatText(message.text || '')}
            </div>
          `,
        )
        .join('') || '<div class="small muted">Aucun message.</div>';
  }

  renderLog();
  markChatSeen(bon, who);

  sendButton.onclick = () => {
    const text = cleanText(input.value);
    if (!text) {
      return;
    }

    const allBons = Store.load(Store.KEY_BONS);
    const index = allBons.findIndex((entry) => entry.id === bon.id);

    if (index < 0) {
      alert('Bon introuvable.');
      return;
    }

    const updated = { ...allBons[index] };
    updated.chat = Array.isArray(updated.chat) ? updated.chat : [];

    const now = Date.now();
    updated.chat.push({
      from: who,
      text,
      ts: now,
      date: new Date(now).toLocaleString(),
    });

    updated.chatSeen = updated.chatSeen || {};
    updated.chatSeen[who] = now;
    allBons[index] = updated;
    Store.save(Store.KEY_BONS, allBons);

    input.value = '';
    renderLog();
    renderBoard();
  };
}

/* Galerie photos */
function initManagerGallery(bon) {
  const grid = $('#mgr-gallery');
  const empty = $('#mgr-gallery-empty');
  const input = $('#mgr-photo-input');
  const addButton = $('#mgr-photo-add');

  if (!grid || !empty || !input || !addButton) {
    return;
  }

  addButton.disabled = false;
  empty.textContent = 'Aucune photo.';

  const who = cleanText(CURRENT_USER) || 'Encadrant';

  function renderGallery() {
    const freshBon = Store.load(Store.KEY_BONS).find((entry) => entry.id === bon.id) || bon;
    const photos = Array.isArray(freshBon.photos) ? freshBon.photos : [];

    empty.style.display = photos.length ? 'none' : '';
    grid.innerHTML = photos
      .map(
        (photo) => `
          <div class="gallery-item" data-id="${photo.id}">
            <img src="${photo.dataUrl}" alt="Photo chantier" class="gallery-thumb">
            <button type="button" class="gallery-remove" title="Supprimer">&times;</button>
          </div>
        `,
      )
      .join('');

    grid.querySelectorAll('.gallery-thumb').forEach((img) => {
      img.addEventListener('click', () => window.openLightbox(img.src));
    });

    grid.querySelectorAll('.gallery-remove').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.closest('.gallery-item')?.dataset.id;
        if (!id || !confirm('Supprimer cette photo ?')) {
          return;
        }

        const allBons = Store.load(Store.KEY_BONS);
        const index = allBons.findIndex((entry) => entry.id === bon.id);
        if (index < 0) {
          return;
        }

        const updated = { ...allBons[index] };
        updated.photos = (updated.photos || []).filter((photo) => photo.id !== id);
        allBons[index] = updated;
        Store.save(Store.KEY_BONS, allBons);
        renderGallery();
      });
    });
  }

  renderGallery();

  addButton.onclick = () => input.click();

  input.onchange = async () => {
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) {
      return;
    }

    addButton.disabled = true;
    addButton.textContent = 'Ajout en cours...';

    try {
      for (const file of files) {
        const dataUrl = await window.compressImageFile(file);

        const allBons = Store.load(Store.KEY_BONS);
        const index = allBons.findIndex((entry) => entry.id === bon.id);
        if (index < 0) {
          continue;
        }

        const updated = { ...allBons[index] };
        updated.photos = Array.isArray(updated.photos) ? updated.photos : [];
        updated.photos.push({
          id: window.uid(),
          from: who,
          ts: Date.now(),
          date: new Date().toLocaleString(),
          dataUrl,
        });
        allBons[index] = updated;
        Store.save(Store.KEY_BONS, allBons);
      }
    } catch (error) {
      console.warn(error);
      alert("Erreur lors de l'ajout d'une photo.");
    } finally {
      addButton.disabled = false;
      addButton.textContent = 'Ajouter des photos';
      renderGallery();
    }
  };
}

// Signature client (lecture seule cote manager, saisie uniquement par
// l'intervenant a la fin du chantier).
function renderManagerSignature(bon) {
  const box = $('#mgr-signature-box');
  if (!box) {
    return;
  }

  const fresh = Store.load(Store.KEY_BONS).find((entry) => entry.id === bon.id) || bon;
  box.innerHTML = fresh.signature
    ? window.renderSignatureStatusHtml(fresh.signature)
    : "Chantier pas encore termine par l'intervenant.";
}

// Un devis pas encore enregistre n'a pas d'id : les photos doivent rester
// desactivees tant qu'il n'a pas ete sauvegarde une premiere fois.
function resetDevisGalleryEmpty() {
  const grid = $('#dev-gallery');
  const empty = $('#dev-gallery-empty');
  const addButton = $('#dev-photo-add');

  if (grid) grid.innerHTML = '';
  if (empty) {
    empty.textContent = 'Enregistrez le devis pour activer les photos.';
    empty.style.display = '';
  }
  if (addButton) addButton.disabled = true;
}

function initDevisGallery(devis) {
  const grid = $('#dev-gallery');
  const empty = $('#dev-gallery-empty');
  const input = $('#dev-photo-input');
  const addButton = $('#dev-photo-add');

  if (!grid || !empty || !input || !addButton) {
    return;
  }

  addButton.disabled = false;
  empty.textContent = 'Aucune photo.';

  const who = cleanText(CURRENT_USER) || 'Encadrant';

  function renderGallery() {
    const freshDevis = Store.load(Store.KEY_DEVIS).find((entry) => entry.id === devis.id) || devis;
    const photos = Array.isArray(freshDevis.photos) ? freshDevis.photos : [];

    empty.style.display = photos.length ? 'none' : '';
    grid.innerHTML = photos
      .map(
        (photo) => `
          <div class="gallery-item" data-id="${photo.id}">
            <img src="${photo.dataUrl}" alt="Photo devis" class="gallery-thumb">
            <button type="button" class="gallery-remove" title="Supprimer">&times;</button>
          </div>
        `,
      )
      .join('');

    grid.querySelectorAll('.gallery-thumb').forEach((img) => {
      img.addEventListener('click', () => window.openLightbox(img.src));
    });

    grid.querySelectorAll('.gallery-remove').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.closest('.gallery-item')?.dataset.id;
        if (!id || !confirm('Supprimer cette photo ?')) {
          return;
        }

        const allDevis = Store.load(Store.KEY_DEVIS);
        const index = allDevis.findIndex((entry) => entry.id === devis.id);
        if (index < 0) {
          return;
        }

        const updated = { ...allDevis[index] };
        updated.photos = (updated.photos || []).filter((photo) => photo.id !== id);
        allDevis[index] = updated;
        Store.save(Store.KEY_DEVIS, allDevis);
        renderGallery();
      });
    });
  }

  renderGallery();

  addButton.onclick = () => input.click();

  input.onchange = async () => {
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) {
      return;
    }

    addButton.disabled = true;
    addButton.textContent = 'Ajout en cours...';

    try {
      for (const file of files) {
        const dataUrl = await window.compressImageFile(file);

        const allDevis = Store.load(Store.KEY_DEVIS);
        const index = allDevis.findIndex((entry) => entry.id === devis.id);
        if (index < 0) {
          continue;
        }

        const updated = { ...allDevis[index] };
        updated.photos = Array.isArray(updated.photos) ? updated.photos : [];
        updated.photos.push({
          id: window.uid(),
          from: who,
          ts: Date.now(),
          date: new Date().toLocaleString(),
          dataUrl,
        });
        allDevis[index] = updated;
        Store.save(Store.KEY_DEVIS, allDevis);
      }
    } catch (error) {
      console.warn(error);
      alert("Erreur lors de l'ajout d'une photo.");
    } finally {
      addButton.disabled = false;
      addButton.textContent = 'Ajouter des photos';
      renderGallery();
    }
  };
}

/* Auto creation BT depuis devis */
function autoCreateOrUpdateBonFromDevis(devis) {
  const raw = devis.raw || {};
  const list = Store.load(Store.KEY_BONS);
  const existing = list.find((bon) => bon.num_devis === devis.num);
  const encadrants = normalizeList([
    ...(existing?.encadrants || []),
    ...(devis.encadrants || []),
    devis.encadrant,
    existing?.encadrant,
  ]);
  const objet = raw['devis.objet_demande'] || raw['devis.objet'] || '';

  const bon = {
    id: existing?.id,
    type: 'bon',
    num_devis: devis.num || '',
    client: devis.client || raw['devis.nom'] || '',
    objet,
    pipe: existing?.pipe || 'b-pret',
    status: existing?.status || 'bons',
    team: existing?.team || [],
    admin: existing?.admin || '',
    encadrants,
    encadrant: encadrants[0] || '',
    chat: existing?.chat || [],
    chatSeen: existing?.chatSeen || {},
    raw: {
      ...(existing?.raw || {}),
      'bon.num_devis': devis.num || '',
      'bon.date_devis': raw['devis.date_demande'] || '',
      'bon.acompte': devis.acompte === 'oui' ? 'Oui' : 'Non',
      'bon.client_nom': raw['devis.nom'] || '',
      'bon.client_num': raw['devis.num_client'] || '',
      'bon.client_adresse': raw['devis.adresse'] || '',
      'bon.client_code_postal': raw['devis.code_postal'] || '',
      'bon.client_ville': raw['devis.ville'] || '',
      'bon.client_tel': raw['devis.tel'] || '',
      'bon.adresse_chantier_diff': raw['devis.adresse_chantier_diff'] || 'non',
      'bon.adresse_chantier': raw['devis.adresse_chantier'] || '',
      'bon.chantier_code_postal': raw['devis.chantier_code_postal'] || '',
      'bon.chantier_ville': raw['devis.chantier_ville'] || '',
      'bon.nom_locataire': raw['devis.nom_locataire'] || '',
      'bon.tel_locataire': raw['devis.tel_locataire'] || '',
      'bon.remarques_chantier': raw['devis.remarques_chantier'] || '',
      'bon.objet': objet,
      'bon.notes_avant_rdv': raw['devis.notes_avant_rdv'] || '',
      'bon.encadrants': encadrants.join('|'),
      'bon.encadrant': encadrants[0] || '',
    },
  };

  Store.save(Store.KEY_BONS, Store.upsertByField(list, bon, 'num_devis', existing?.id));
  removeDevisByNum(devis.num);
}

/* Devis */
$('#save-devis')?.addEventListener('click', async () => {
  const raw = serializeNamedFields('devis');
  const list = Store.load(Store.KEY_DEVIS);
  const current = list.find((devis) => devis.num === raw['devis.num_devis']);
  const encadrants = getSelectedDevisEncadrants();
  const devisAdmin = $('#devis-admin');
  const admin = cleanText(devisAdmin?.value || current?.admin);

  const item = {
    id: currentDevisId || undefined,
    type: 'devis',
    num: cleanText(raw['devis.num_devis']),
    client: cleanText(raw['devis.nom']),
    objet: cleanText(raw['devis.objet_demande'] || raw['devis.objet']),
    signe: raw['devis.signe'] || 'non',
    acompte: raw['devis.acompte'] || 'non',
    refuse: raw['devis.refuse'] || 'non',
    urgence: raw['devis.urgence'] || 'normal',
    admin,
    encadrants,
    encadrant: encadrants[0] || cleanText(raw['devis.encadrant']),
    pipeline: current?.pipeline || 'd-attente-appel',
    raw: {
      ...raw,
      'devis.encadrants': encadrants.join('|'),
      'devis.encadrant': encadrants[0] || '',
      'devis.admin': admin,
    },
  };

  if (!item.num) {
    alert('Le numero de devis est requis.');
    return;
  }

  const exists = list.some((devis) => devis.num === item.num && devis.id !== currentDevisId);
  if (exists) {
    alert('Un devis avec ce numero existe deja.');
    return;
  }

  Store.save(Store.KEY_DEVIS, Store.upsertByField(list, item, 'num', currentDevisId));

  if (item.signe === 'oui' && item.acompte === 'oui' && item.refuse !== 'oui') {
    autoCreateOrUpdateBonFromDevis(item);
  }

  currentDevisId = null;
  try {
    await Store.flush?.();
  } catch (error) {
    console.warn('Impossible de pousser le devis vers le stockage partage', error);
  }
  alert('Devis enregistre.');
  window.location.reload();
});

$('#load-devis')?.addEventListener('click', () => {
  const num = prompt('No de devis a charger ?');
  if (!num) {
    return;
  }

  const found = Store.load(Store.KEY_DEVIS).find((devis) => devis.num === num);
  if (!found) {
    alert('Devis introuvable.');
    return;
  }

  openDevis(found);
});

/* Bon */
$('#save-bon')?.addEventListener('click', () => {
  const raw = serializeNamedFields('bon');
  const list = Store.load(Store.KEY_BONS);

  if (!raw['bon.num_devis']) {
    raw['bon.num_devis'] = makeDirectBTNum(list);
  }

  const current = currentBonId
    ? list.find((bon) => bon.id === currentBonId)
    : list.find((bon) => bon.num_devis === raw['bon.num_devis']);
  const team = getCheckedValues('.aff-team');
  const bonAdmin = $('#bon-admin');
  const admin = cleanText(bonAdmin?.value || current?.admin);
  const encadrants = normalizeList([
    ...getSelectedEncadrants(),
    ...(current?.encadrants || []),
    ...(current?.encadrant ? [current.encadrant] : []),
  ]);

  const item = {
    ...(current || {}),
    id: currentBonId || current?.id || undefined,
    type: 'bon',
    num_devis: cleanText(raw['bon.num_devis']),
    client: cleanText(raw['bon.client_nom']),
    objet: cleanText(raw['bon.objet']),
    lignes: collectHeuresRows(),
    rdv_plus: collectRdvRows(),
    pipe: current?.pipe || 'b-pret',
    status: current?.status || (current?.pipe === 'b-facturer' ? 'facturer' : 'bons'),
    team: team.length ? team : normalizeList(current?.team || []),
    admin,
    encadrants,
    encadrant: encadrants[0] || current?.encadrant || '',
    raw: {
      ...raw,
      'bon.admin': admin,
      'bon.encadrants': encadrants.join('|'),
      'bon.encadrant': encadrants[0] || '',
    },
  };

  const conflicts = findAssignmentConflicts(item, list);
  if (conflicts.length) {
    const lines = conflicts
      .map((c) => `- ${c.person} le ${formatPrintDate(c.date)} (deja sur "${c.client}")`)
      .join('\n');
    const proceed = confirm(
      `Conflit d'affectation detecte :\n${lines}\n\nEnregistrer quand meme ?`,
    );
    if (!proceed) {
      return;
    }
  }

  Store.save(Store.KEY_BONS, Store.upsertByField(list, item, 'num_devis', currentBonId));

  alert('Bon enregistre.');
  prepareNewBonForm();
  showTab('board');
});

$('#load-bon')?.addEventListener('click', () => {
  const num = prompt('No de devis rattache au bon ?');
  if (!num) {
    return;
  }

  const found = Store.load(Store.KEY_BONS).find((bon) => bon.num_devis === num);
  if (!found) {
    alert('Bon introuvable.');
    return;
  }

  openBon(found);
});

$('#new-bon-direct-tab')?.addEventListener('click', (event) => {
  event.preventDefault();
  prepareNewBonForm();
  showTab('bon');
});

$('#save-bon-direct')?.addEventListener('click', () => {
  const raw = serializeNamedFields('direct');
  const encadrants = getCheckedValues('.direct-enc-team');
  const team = getCheckedValues('.direct-aff-team');
  const num = cleanText(raw['direct.num_bt']) || makeDirectBTNum();
  const urgence = cleanText(raw['direct.urgence']) || 'normal';
  const objetBase = cleanText(raw['direct.objet']);
  const objet = cleanText(`[DEPANNAGE ${urgence}] ${objetBase}`);

  const item = {
    id: undefined,
    type: 'bon',
    num_devis: num,
    client: cleanText(raw['direct.client_nom']),
    objet,
    pipe: 'b-pret',
    status: 'bons',
    team,
    admin: '',
    encadrants,
    encadrant: encadrants[0] || CURRENT_USER || '',
    lignes: [],
    rdv_plus: [],
    raw: {
      'bon.num_devis': num,
      'bon.date_devis': raw['direct.date'] || today(),
      'bon.client_nom': raw['direct.client_nom'] || '',
      'bon.client_tel': raw['direct.client_tel'] || '',
      'bon.client_adresse': raw['direct.client_adresse'] || '',
      'bon.client_code_postal': raw['direct.client_code_postal'] || '',
      'bon.client_ville': raw['direct.client_ville'] || '',
      'bon.objet': objet,
      'bon.adresse_chantier_diff': raw['direct.adresse_chantier_diff'] || 'non',
      'bon.adresse_chantier': raw['direct.adresse_chantier'] || '',
      'bon.chantier_code_postal': raw['direct.chantier_code_postal'] || '',
      'bon.chantier_ville': raw['direct.chantier_ville'] || '',
      'bon.nom_locataire': raw['direct.nom_locataire'] || '',
      'bon.tel_locataire': raw['direct.tel_locataire'] || '',
      'bon.remarques_chantier': raw['direct.remarques_chantier'] || '',
      'bon.encadrants': encadrants.join('|'),
      'bon.encadrant': encadrants[0] || CURRENT_USER || '',
    },
  };

  if (!item.client) {
    alert('Nom client obligatoire.');
    return;
  }

  const list = Store.load(Store.KEY_BONS) || [];
  Store.save(Store.KEY_BONS, Store.upsertByField(list, item, 'num_devis'));

  alert('BT depannage cree.');
  resetDirectBonForm();
  showTab('board');
});

/* Board */
function getBoardColumns() {
  return {
    'd-attente-appel': $('#d-attente-appel'),
    'd-rdv-pris': $('#d-rdv-pris'),
    'd-a-saisir': $('#d-a-saisir'),
    'd-attente-retour': $('#d-attente-retour'),
    'd-accepte': $('#d-accepte'),
    'd-refuse': $('#d-refuse'),
    'b-pret': $('#b-pret'),
    'b-affect': $('#b-affect'),
    'b-encours': $('#b-encours'),
    'b-facturer': $('#b-facturer'),
    'b-archive': $('#b-archive'),
  };
}

function getDevisPipeline(devis) {
  if (devis.pipeline) {
    return devis.pipeline;
  }

  if (devis.refuse === 'oui') {
    return 'd-refuse';
  }

  if (devis.signe === 'oui' && devis.acompte === 'oui') {
    return 'd-accepte';
  }

  return devis.raw?.['devis.rdv_date'] ? 'd-rdv-pris' : 'd-attente-appel';
}

function getBonPipe(bon) {
  return bon.pipe || (bon.status === 'facturer' ? 'b-facturer' : 'b-pret');
}

function renderBoard() {
  const columns = getBoardColumns();
  Object.values(columns)
    .filter(Boolean)
    .forEach((column) => {
      column.innerHTML = '';
    });

  let boardTotalCount = 0;
  let boardMatchCount = 0;

  const devisList = Store.load(Store.KEY_DEVIS).map((devis) => ({
    ...devis,
    pipeline: getDevisPipeline(devis),
  }));
  Store.save(Store.KEY_DEVIS, devisList, { skipRemote: true });

  let visibleDevis = showAll || showUnassignedOnly ? devisList : devisList.filter(belongsToChef);
  if (showUnassignedOnly) {
    visibleDevis = visibleDevis.filter(hasNoResponsable);
  }

  // Les devis urgents remontent en premier dans leur colonne (tri stable :
  // a urgence egale, l'ordre d'origine est conserve).
  const urgenceRank = (devis) => (devis.urgence === 'tres urgent' ? 0 : devis.urgence === 'urgent' ? 1 : 2);
  visibleDevis = [...visibleDevis].sort((a, b) => urgenceRank(a) - urgenceRank(b));

  visibleDevis.forEach((devis) => {
    const column = columns[devis.pipeline];
    if (!column) {
      return;
    }

    boardTotalCount += 1;
    if (!matchesBoardSearch(devis.client, devis.num)) {
      return;
    }
    boardMatchCount += 1;

    const urgenceClass = devis.urgence === 'tres urgent' ? ' urgence-tres-urgent' : devis.urgence === 'urgent' ? ' urgence-urgent' : '';
    const urgenceBadge = devis.urgence === 'tres urgent'
      ? '<span class="badge urgence-badge-tres">🔴 Très urgent</span>'
      : devis.urgence === 'urgent'
        ? '<span class="badge urgence-badge-urgent">🟠 Urgent</span>'
        : '';

    const card = document.createElement('div');
    card.className = `card${urgenceClass}`;
    card.innerHTML = `
      <div class="line1">
        <strong>${highlightMatch(devis.client || 'Client ?', boardSearchTerm)}</strong>
        <span class="small">Devis no ${highlightMatch(devis.num || '-', boardSearchTerm)}</span>
      </div>
      ${urgenceBadge}
      ${displayPeopleChips(devis)}
      <div class="small" style="margin:4px 0">${escapeHtml(devis.objet || '')}</div>
      <div class="row" style="margin-top:8px">
        <label>Etape</label>
        <select class="pipe">
          <option value="d-attente-appel">Attente d'appel / RDV</option>
          <option value="d-rdv-pris">RDV pris</option>
          <option value="d-a-saisir">A saisir</option>
          <option value="d-attente-retour">Saisi / attente retour</option>
          <option value="d-accepte">Accepte</option>
          <option value="d-refuse">Refuse</option>
        </select>
      </div>
      <div class="grid-3 small" style="margin-top:6px">
        <label><input type="checkbox" class="chk-signe" ${devis.signe === 'oui' ? 'checked' : ''}> signe</label>
        <label><input type="checkbox" class="chk-acompte" ${devis.acompte === 'oui' ? 'checked' : ''}> acompte</label>
      </div>
      <div class="actions" style="margin-top:6px">
        <button class="btn primary open">Ouvrir</button>
        <button class="btn outline print">Imprimer</button>
        <button class="btn danger delete">Supprimer</button>
      </div>
    `;

    const pipeSelect = card.querySelector('.pipe');
    pipeSelect.value = devis.pipeline;
    pipeSelect.onchange = () => {
      devis.pipeline = pipeSelect.value;
      const updated = devisList.map((entry) => (entry.id === devis.id ? devis : entry));
      Store.save(Store.KEY_DEVIS, updated);

      if (devis.pipeline === 'd-accepte' && devis.acompte === 'oui') {
        autoCreateOrUpdateBonFromDevis(devis);
      }

      renderBoard();
    };

    card.querySelector('.chk-signe').onchange = (event) => {
      devis.signe = event.target.checked ? 'oui' : 'non';
      syncDevisRawFlags(devis);
      Store.save(Store.KEY_DEVIS, devisList);
    };

    card.querySelector('.chk-acompte').onchange = (event) => {
      devis.acompte = event.target.checked ? 'oui' : 'non';
      syncDevisRawFlags(devis);
      Store.save(Store.KEY_DEVIS, devisList);

      if (devis.pipeline === 'd-accepte' && devis.acompte === 'oui') {
        autoCreateOrUpdateBonFromDevis(devis);
        renderBoard();
      }
    };

    card.querySelector('.open').onclick = () => {
      openDevis(devis);
    };

    card.querySelector('.print').onclick = () => {
      printDevisItem(devis);
    };

    card.querySelector('.delete').onclick = async () => {
      if (confirm(`Supprimer le devis no ${devis.num || ''} ?`)) {
        await Store.deleteItem(Store.KEY_DEVIS, devis.id);
        renderBoard();
      }
    };

    column.appendChild(card);
  });

  const bonsList = Store.load(Store.KEY_BONS).map((bon) => ({
    ...bon,
    pipe: getBonPipe(bon),
  }));
 Store.save(Store.KEY_BONS, bonsList, { skipRemote: true });

  let visibleBons = showAll || showUnassignedOnly ? bonsList : bonsList.filter(belongsToChef);
  if (showUnassignedOnly) {
    visibleBons = visibleBons.filter(hasNoResponsable);
  }
  visibleBons.forEach((bon) => {
    const column = columns[bon.archived ? 'b-archive' : bon.pipe];
    if (!column) {
      return;
    }

    boardTotalCount += 1;
    if (!matchesBoardSearch(bon.client, bon.num_devis)) {
      return;
    }
    boardMatchCount += 1;

    const unread = countUnreadFor(bon, cleanText(CURRENT_USER));
    const unreadBadge =
      unread > 0
        ? `<span class="badge badge-neon" title="Messages non lus"><span class="badge-neon-icon">🔔</span>${unread} nouveau${unread > 1 ? 'x' : ''}</span>`
        : '';
    const rdvBadge = rdvUrgencyBadgeHtml(bon);

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="line1">
        <strong>${highlightMatch(bon.client || 'Client ?', boardSearchTerm)}</strong>
        <span class="small">${String(bon.num_devis || '').startsWith('BT-') ? 'BT no' : 'Devis no'} ${highlightMatch(bon.num_devis || '-', boardSearchTerm)}</span>
      </div>
      ${displayPeopleChips(bon)}
      <div class="small" style="margin:4px 0">${escapeHtml((bon.objet || '').slice(0, 100))}</div>
      <div class="badge-row" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px">${rdvBadge}${unreadBadge}</div>
      <div class="row" style="margin-top:6px">
        <label>Etape</label>
        <select class="pipe">
          <option value="b-pret">BT pret / en attente</option>
          <option value="b-affect">RDV pris + affectation</option>
          <option value="b-encours">Chantier en cours</option>
          <option value="b-facturer">A facturer</option>
        </select>
      </div>
      <div class="actions" style="margin-top:6px">
        <button class="btn primary open">Ouvrir</button>
        <button class="btn outline print">Imprimer</button>
        <button class="btn danger delete">Supprimer</button>
      </div>
    `;

    const pipeSelect = card.querySelector('.pipe');
    pipeSelect.value = bon.pipe;
    pipeSelect.onchange = () => {
      bon.pipe = pipeSelect.value;
      if (bon.pipe === 'b-facturer') {
        bon.status = 'facturer';
      }

      const updated = bonsList.map((entry) => (entry.id === bon.id ? bon : entry));
      Store.save(Store.KEY_BONS, updated);
      renderBoard();
    };

    card.querySelector('.open').onclick = () => {
      openBon(bon);
    };

    card.querySelector('.print').onclick = () => {
      printBonItem(bon);
    };

    card.querySelector('.delete').onclick = async () => {
      if (confirm(`Supprimer le bon (devis no ${bon.num_devis || ''}) ?`)) {
        await Store.deleteItem(Store.KEY_BONS, bon.id);
        renderBoard();
      }
    };

    column.appendChild(card);
  });

  const countLabel = $('#board-search-count');
  if (countLabel) {
    countLabel.textContent = boardSearchTerm
      ? `${boardMatchCount} resultat${boardMatchCount > 1 ? 's' : ''} sur ${boardTotalCount}`
      : '';
  }
}

/* Code postal -> ville */
async function fetchCitiesByPostalCode(code) {
  if (cityCache.has(code)) {
    return cityCache.get(code);
  }

  const response = await fetch(
    `https://geo.api.gouv.fr/communes?codePostal=${code}&fields=nom&format=json`,
  );
  const data = await response.json();
  const cities = Array.isArray(data)
    ? data.map((entry) => cleanText(entry?.nom)).filter(Boolean)
    : [];

  cityCache.set(code, cities);
  return cities;
}

function applyCityCandidates(field, cities) {
  if (field.tagName === 'SELECT') {
    const currentValue = field.value;
    field.innerHTML = '<option value="">Choisir une ville</option>';

    cities.forEach((city) => {
      const option = document.createElement('option');
      option.value = city;
      option.textContent = city;
      field.appendChild(option);
    });

    if (cities.includes(currentValue)) {
      field.value = currentValue;
    } else if (cities.length === 1) {
      field.value = cities[0];
    }

    return;
  }

  field.value = cities.length === 1 ? cities[0] : cities.join(', ');
}

function attachPostalLookup(postalFieldName, cityFieldName) {
  const postalField = document.querySelector(`[name="${postalFieldName}"]`);
  const cityField = document.querySelector(`[name="${cityFieldName}"]`);

  if (!postalField || !cityField) {
    return;
  }

  postalField.addEventListener('blur', async () => {
    const code = cleanText(postalField.value);
    if (!/^\d{5}$/.test(code)) {
      return;
    }

    try {
      const cities = await fetchCitiesByPostalCode(code);
      if (!cities.length) {
        return;
      }

      applyCityCandidates(cityField, cities);
    } catch (error) {
      console.warn('Ville introuvable pour ce code postal', error);
    }
  });
}

[
  ['devis.code_postal', 'devis.ville'],
  ['devis.chantier_code_postal', 'devis.chantier_ville'],
  ['bon.client_code_postal', 'bon.client_ville'],
  ['bon.chantier_code_postal', 'bon.chantier_ville'],
  ['direct.client_code_postal', 'direct.client_ville'],
].forEach(([postalFieldName, cityFieldName]) => {
  attachPostalLookup(postalFieldName, cityFieldName);
});

window.addEventListener('shared-store-changed', () => {
  if ($('#tab-board')?.classList.contains('show')) {
    renderBoard();
  }
  if ($('#tab-planning')?.classList.contains('show')) {
    renderPlanningManager();
  }
  if ($('#tab-messagerie')?.classList.contains('show')) {
    refreshMessagerie();
  }
  updateMessagerieTabBadge();
});

Store.syncFromServer?.()
  .then(() => {
    renderBoard();
    updateMessagerieTabBadge();
  })
  .catch((error) => {
    console.warn('Impossible de synchroniser les donnees partagees', error);
    renderBoard();
  });

setInterval(() => {
  Store.syncFromServer?.()
    .then(() => {
      if ($('#tab-board')?.classList.contains('show')) {
        renderBoard();
      }
    })
    .catch((error) => {
      console.warn('Impossible d actualiser les donnees partagees', error);
    });
}, 5000);
