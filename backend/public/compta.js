// Acces reserve compta
const CURRENT_USER = Auth.guard('compta');
if (!CURRENT_USER) {
  // redirection geree par guard
}

document.getElementById('whoami').textContent = `Connecte : ${CURRENT_USER}`;
document.getElementById('btn-logout').addEventListener('click', (event) => {
  event.preventDefault();
  Auth.logout();
});

function cleanText(value) {
  return String(value ?? '').trim();
}

function showComptaTab(name) {
  document.querySelectorAll('.tab[data-compta-tab]').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.comptaTab === name);
  });
  document.querySelectorAll('.view[id^="tab-compta-"]').forEach((view) => {
    view.classList.toggle('show', view.id === `tab-compta-${name}`);
  });
}

document.querySelectorAll('.tab[data-compta-tab]').forEach((tab) => {
  tab.addEventListener('click', () => showComptaTab(tab.dataset.comptaTab));
});

function updateComptaTabBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = count;
  el.style.display = count > 0 ? '' : 'none';
}

/* Devis (formulaire identique a celui du manager) */
let currentComptaDevisId = null;

function $c(sel, root = document) { return root.querySelector(sel); }
function $$c(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function serializeNamedFields(prefix) {
  const entries = [];
  $$c(`[name^="${prefix}."]`).forEach((field) => {
    if (field.type === 'radio') {
      if (field.checked) entries.push([field.name, field.value]);
      return;
    }
    entries.push([field.name, field.type === 'checkbox' ? (field.checked ? 'oui' : 'non') : field.value]);
  });
  return Object.fromEntries(entries);
}

function setFieldValueCompta(name, value) {
  const fields = $$c(`[name="${name}"]`);
  if (!fields.length) return;

  if (fields[0].type === 'radio') {
    fields.forEach((field) => { field.checked = field.value === String(value ?? ''); });
    return;
  }

  const field = fields[0];
  if (field.type === 'checkbox') {
    field.checked = value === 'oui' || value === true || value === '1';
    return;
  }

  if (field.tagName === 'SELECT' && value && !Array.from(field.options).some((o) => o.value === value)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    field.appendChild(option);
  }

  field.value = value ?? '';
}

function applyRawValuesCompta(raw = {}) {
  Object.entries(raw).forEach(([name, value]) => setFieldValueCompta(name, value));
}

function normalizeListCompta(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((v) => cleanText(v)).filter(Boolean)));
}

function getSelectedDevisEncadrantsCompta() {
  return normalizeListCompta($$c('.devis-enc-team').filter((f) => f.checked).map((f) => f.value));
}

function setSelectedDevisEncadrantsCompta(values) {
  const selected = new Set(normalizeListCompta(values));
  $$c('.devis-enc-team').forEach((f) => { f.checked = selected.has(f.value); });
}

function makeDevisNumCompta(list = Store.load(Store.KEY_DEVIS) || []) {
  const base = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const count = list.filter((devis) => String(devis.num || '').startsWith(`DV-${base}`)).length;
  return `DV-${base}-${String(count + 1).padStart(3, '0')}`;
}

function initComptaDevisDefaults() {
  const numField = document.getElementById('cdnum');
  const dateField = document.getElementById('cddate');
  if (numField && !numField.value) numField.value = makeDevisNumCompta();
  if (dateField && !dateField.value) dateField.value = new Date().toISOString().slice(0, 10);
}

initComptaDevisDefaults();

function resetComptaDevisForm() {
  currentComptaDevisId = null;
  $$c('#tab-compta-nouveau [name^="devis."]').forEach((field) => {
    if (field.type === 'checkbox' || field.type === 'radio') field.checked = false;
    else field.value = '';
  });
  document.getElementById('cd-admin').value = '';
  setSelectedDevisEncadrantsCompta([]);
  document.getElementById('cd-bloc-chantier').style.display = 'none';
  initComptaDevisDefaults();
}

document.getElementById('save-devis-compta').addEventListener('click', async () => {
  const raw = serializeNamedFields('devis');
  const list = Store.load(Store.KEY_DEVIS);
  const current = list.find((devis) => devis.num === raw['devis.num_devis']);
  const encadrants = getSelectedDevisEncadrantsCompta();
  const admin = cleanText(document.getElementById('cd-admin').value || current?.admin);

  const item = {
    id: currentComptaDevisId || undefined,
    type: 'devis',
    num: cleanText(raw['devis.num_devis']),
    client: cleanText(raw['devis.nom']),
    objet: cleanText(raw['devis.objet_demande'] || raw['devis.objet']),
    signe: raw['devis.signe'] || 'non',
    acompte: raw['devis.acompte'] || 'non',
    refuse: raw['devis.refuse'] || 'non',
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
    alert('Le numéro de devis est requis.');
    return;
  }
  if (!item.client) {
    alert('Le nom du client est requis.');
    return;
  }

  const exists = list.some((devis) => devis.num === item.num && devis.id !== currentComptaDevisId);
  if (exists) {
    alert('Un devis avec ce numéro existe déjà.');
    return;
  }

  Store.save(Store.KEY_DEVIS, Store.upsertByField(list, item, 'num', currentComptaDevisId));

  try {
    await Store.flush?.();
  } catch (error) {
    console.warn('Impossible de pousser le devis vers le stockage partagé', error);
  }

  alert('Devis enregistré.');
  resetComptaDevisForm();
});

document.getElementById('load-devis-compta').addEventListener('click', () => {
  const num = prompt('N° de devis à charger ?');
  if (!num) return;

  const found = Store.load(Store.KEY_DEVIS).find((devis) => devis.num === num);
  if (!found) {
    alert('Devis introuvable.');
    return;
  }

  applyRawValuesCompta(found.raw || {});
  setSelectedDevisEncadrantsCompta(found.encadrants?.length ? found.encadrants : (found.encadrant ? [found.encadrant] : []));
  document.getElementById('cd-admin').value = found.raw?.['devis.admin'] || found.admin || '';
  document.getElementById('cd-bloc-chantier').style.display = found.raw?.['devis.adresse_chantier_diff'] === 'oui' ? '' : 'none';
  currentComptaDevisId = found.id;
  showComptaTab('nouveau');
});

function renderCompta() {
  const wrap = document.getElementById('compta-list');
  const empty = document.getElementById('compta-empty');
  const archWrap = document.getElementById('arch-list');
  const archEmpty = document.getElementById('arch-empty');

  wrap.innerHTML = '';
  archWrap.innerHTML = '';

  const all = Store.load(Store.KEY_BONS);

  const mine = all.filter((bon) => bon.status === 'facturer' && bon.admin === CURRENT_USER && !bon.archived);
  const archived = all.filter((bon) => bon.admin === CURRENT_USER && bon.archived);

  const totalHoursAll = mine.reduce((sum, bon) => {
    const h = bon.hours
      ? Object.values(bon.hours).flat().reduce((s, hour) => s + (parseFloat(hour.h) || 0), 0)
      : 0;
    return sum + h;
  }, 0);
  document.getElementById('recap-count').textContent = `${mine.length} bon${mine.length > 1 ? 's' : ''} en attente`;
  document.getElementById('recap-hours').textContent = `${totalHoursAll} h au total`;
  updateComptaTabBadge('tab-badge-facturer', mine.length);

  empty.style.display = mine.length ? 'none' : '';

  mine.forEach((bon) => {
    const totalHours = bon.hours
      ? Object.values(bon.hours).flat().reduce((sum, hour) => sum + (parseFloat(hour.h) || 0), 0)
      : 0;
    const teamText = (bon.team || []).join(', ') || '-';
    const isDepannage = String(bon.num_devis || '').startsWith('BT-');

    const card = document.createElement('div');
    card.className = 'work-card';
    card.innerHTML = `
      <h3>${bon.client || 'Client ?'}</h3>
      <div class="work-meta">
        <span class="badge">${isDepannage ? 'BT dépannage' : 'Bon de travail'}</span>
        <span class="badge">Devis no ${bon.num_devis || '-'}</span>
        <span class="badge">Chef: ${bon.encadrant || '-'}</span>
        <span class="badge">Equipe: ${teamText}</span>
        <span class="badge">${totalHours} h</span>
      </div>
      <p class="small">${(bon.objet || '').slice(0, 160)}</p>

      <div class="actions">
        <button class="btn primary" data-view>Voir / Imprimer</button>
        <button class="btn success" data-archive>Archiver</button>
      </div>
    `;

    card.querySelector('[data-view]').addEventListener('click', () => openPrintView(bon));

    card.querySelector('[data-archive]').addEventListener('click', () => {
      const allBons = Store.load(Store.KEY_BONS);
      const index = allBons.findIndex((entry) => entry.id === bon.id);
      if (index < 0) {
        alert('Bon introuvable.');
        return;
      }

      const copy = {
        ...allBons[index],
        archived: true,
        archived_at: new Date().toISOString().slice(0, 10),
      };

      allBons[index] = copy;
      Store.save(Store.KEY_BONS, allBons);
      renderCompta();
    });

    wrap.appendChild(card);
  });

  archEmpty.style.display = archived.length ? 'none' : '';

  archived.forEach((bon) => {
    const totalHours = bon.hours
      ? Object.values(bon.hours).flat().reduce((sum, hour) => sum + (parseFloat(hour.h) || 0), 0)
      : 0;

    const card = document.createElement('div');
    card.className = 'work-card';
    card.innerHTML = `
      <h3>${bon.client || 'Client ?'}</h3>
      <div class="work-meta">
        <span class="badge">Devis no ${bon.num_devis || '-'}</span>
        <span class="badge">Archive le ${bon.archived_at || '-'}</span>
        <span class="badge">${totalHours} h</span>
      </div>
      <p class="small">${(bon.objet || '').slice(0, 160)}</p>

      <div class="actions">
        <button class="btn" data-view>Voir / Imprimer</button>
        <button class="btn" data-restore>Restaurer</button>
        <button class="btn danger" data-purge>Supprimer definitivement</button>
      </div>
    `;

    card.querySelector('[data-view]').addEventListener('click', () => openPrintView(bon));

    card.querySelector('[data-restore]').addEventListener('click', () => {
      const allBons = Store.load(Store.KEY_BONS);
      const index = allBons.findIndex((entry) => entry.id === bon.id);
      if (index < 0) {
        alert('Bon introuvable.');
        return;
      }

      const copy = { ...allBons[index], archived: false, archived_at: '' };
      allBons[index] = copy;
      Store.save(Store.KEY_BONS, allBons);
      renderCompta();
    });

    card.querySelector('[data-purge]').addEventListener('click', async () => {
      if (!confirm('Supprimer definitivement ce bon archive ?')) {
        return;
      }

      await Store.deleteItem(Store.KEY_BONS, bon.id);
      renderCompta();
    });

    archWrap.appendChild(card);
  });
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Genere un classeur Excel (format SpreadsheetML 2003) sans dependance externe :
// un simple fichier XML qu'Excel ouvre nativement avec les vraies colonnes,
// contrairement au CSV qui pose parfois des soucis d'encodage/separateur.
function buildExcelWorkbook(sheetName, header, rows) {
  const cell = (value) => {
    const isNumber = typeof value === 'number' && Number.isFinite(value);
    return isNumber
      ? `<Cell><Data ss:Type="Number">${value}</Data></Cell>`
      : `<Cell><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`;
  };

  const headerRow = `<Row>${header.map((h) => `<Cell ss:StyleID="header"><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`).join('')}</Row>`;
  const dataRows = rows.map((row) => `<Row>${row.map(cell).join('')}</Row>`).join('');

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="header"><Font ss:Bold="1"/></Style>
  </Styles>
  <Worksheet ss:Name="${xmlEscape(sheetName)}">
    <Table>
      ${headerRow}
      ${dataRows}
    </Table>
  </Worksheet>
</Workbook>`;
}

function downloadExcel(filename, xml) {
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportComptaExcel() {
  const all = Store.load(Store.KEY_BONS);
  const mine = all.filter((bon) => bon.status === 'facturer' && bon.admin === CURRENT_USER && !bon.archived);

  if (!mine.length) {
    alert('Aucun bon à exporter.');
    return;
  }

  const header = ['Type', 'Client', 'Devis n°', 'Chef', 'Équipe', 'Total heures', 'Objet'];
  const rows = mine.map((bon) => {
    const totalHours = bon.hours
      ? Object.values(bon.hours).flat().reduce((sum, hour) => sum + (parseFloat(hour.h) || 0), 0)
      : 0;
    return [
      String(bon.num_devis || '').startsWith('BT-') ? 'BT dépannage' : 'Bon de travail',
      bon.client || '',
      bon.num_devis || '',
      bon.encadrant || '',
      (bon.team || []).join(' / '),
      totalHours,
      bon.objet || '',
    ];
  });

  const xml = buildExcelWorkbook('A facturer', header, rows);
  downloadExcel(`a-facturer_${new Date().toISOString().slice(0, 10)}.xls`, xml);
}

document.getElementById('btn-export-csv').addEventListener('click', exportComptaExcel);

function openPrintView(bon) {
  const devis = (Store.load(Store.KEY_DEVIS) || []).find((entry) => entry.num === bon.num_devis);
  const popup = window.open('', '_blank', 'width=900,height=700');

  const hoursRows = Object.entries(bon.hours || {})
    .map(([name, entries]) =>
      entries
        .map(
          (hour) => `
            <tr>
              <td>${name}</td>
              <td>${hour.date || ''}</td>
              <td>${hour.h || ''}</td>
              <td>${(hour.note || '').replace(/</g, '&lt;')}</td>
            </tr>
          `,
        )
        .join(''),
    )
    .join('');

  const devisRows =
    devis && devis.raw
      ? Object.entries(devis.raw)
          .map(([key, value]) => {
            const label = key.replace('devis.', '').replace(/_/g, ' ');
            return `<tr><td>${label}</td><td>${value || ''}</td></tr>`;
          })
          .join('')
      : '<tr><td colspan="2" class="muted">Aucun devis lie trouve.</td></tr>';

  const teamText = (bon.team || []).join(', ') || '-';
  const totalHours = bon.hours
    ? Object.values(bon.hours).flat().reduce((sum, hour) => sum + (parseFloat(hour.h) || 0), 0)
    : 0;

  popup.document.write(`
    <html><head>
      <title>A facturer - ${bon.client || ''} (Devis ${bon.num_devis || ''})</title>
      <style>
        body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; padding:20px; color:#111;}
        h1,h2{margin:0 0 8px;}
        .muted{color:#666}
        .block{margin:14px 0;}
        table{width:100%;border-collapse:collapse;margin-top:6px}
        th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:13px}
        @media print {.noprint{display:none}}
      </style>
    </head><body>
      <div class="noprint" style="text-align:right;margin-bottom:10px">
        <button onclick="window.print()">Imprimer</button>
      </div>

      <h1>${String(bon.num_devis || '').startsWith('BT-') ? 'BT depannage a facturer' : 'Bon a facturer'}</h1>
      <div class="muted">Destinataire compta : ${bon.admin || '-'}</div>

      <div class="block">
        <h2>Bon de travail</h2>
        <div><strong>Client :</strong> ${bon.client || ''}</div>
        <div><strong>Objet :</strong> ${bon.objet || ''}</div>
        <div><strong>Devis no :</strong> ${bon.num_devis || ''}</div>
        <div><strong>Chef :</strong> ${bon.encadrant || '-'}</div>
        <div><strong>Equipe :</strong> ${teamText}</div>
        <div><strong>Total heures :</strong> ${totalHours} h</div>
      </div>

      <div class="block">
        <h2>Detail des heures</h2>
        <table>
          <thead><tr><th>Intervenant</th><th>Date</th><th>Heures</th><th>Note</th></tr></thead>
          <tbody>${hoursRows || '<tr><td colspan="4" class="muted">Aucune heure saisie</td></tr>'}</tbody>
        </table>
      </div>

      <div class="block">
        <h2>Devis original</h2>
        <table>
          <thead><tr><th>Champ</th><th>Valeur</th></tr></thead>
          <tbody>${devisRows}</tbody>
        </table>
      </div>
    </body></html>
  `);
}

function renderDevisCompta() {
  const wrap = document.getElementById('devis-list');
  const empty = document.getElementById('devis-empty');
  wrap.innerHTML = '';

  const all = Store.load(Store.KEY_DEVIS);
  const mine = all.filter((devis) => devis.admin === CURRENT_USER && devis.refuse !== 'oui');

  document.getElementById('devis-recap-count').textContent =
    `${mine.length} devis${mine.length > 1 ? '' : ''} en attente`;
  updateComptaTabBadge('tab-badge-devis', mine.length);

  empty.style.display = mine.length ? 'none' : '';

  mine.forEach((devis) => {
    const raw = devis.raw || {};
    const card = document.createElement('div');
    card.className = 'work-card';
    card.innerHTML = `
      <h3>${devis.client || 'Client ?'}</h3>
      <div class="work-meta">
        <span class="badge">Devis no ${devis.num || '-'}</span>
        <span class="badge">Encadrant: ${devis.encadrant || '-'}</span>
        <span class="badge">${devis.signe === 'oui' ? 'Signé' : 'Non signé'}</span>
        <span class="badge">${devis.acompte === 'oui' ? 'Acompte reçu' : 'Sans acompte'}</span>
      </div>
      <p class="small">${(devis.objet || '').slice(0, 160)}</p>

      <div class="actions">
        <button class="btn primary" data-view>Voir</button>
        <button class="btn success" data-done>Marquer traité</button>
      </div>
    `;

    card.querySelector('[data-view]').addEventListener('click', () => openDevisPrintView(devis));

    card.querySelector('[data-done]').addEventListener('click', () => {
      const allDevis = Store.load(Store.KEY_DEVIS);
      const index = allDevis.findIndex((entry) => entry.id === devis.id);
      if (index < 0) {
        alert('Devis introuvable.');
        return;
      }

      allDevis[index] = { ...allDevis[index], admin: '', raw: { ...(allDevis[index].raw || {}), 'devis.admin': '' } };
      Store.save(Store.KEY_DEVIS, allDevis);
      renderDevisCompta();
    });

    wrap.appendChild(card);
  });
}

function openDevisPrintView(devis) {
  const popup = window.open('', '_blank', 'width=900,height=700');
  const raw = devis.raw || {};

  const rows = Object.entries(raw)
    .map(([key, value]) => {
      const label = key.replace('devis.', '').replace(/_/g, ' ');
      return `<tr><td>${label}</td><td>${value || ''}</td></tr>`;
    })
    .join('');

  popup.document.write(`
    <html><head>
      <title>Devis - ${devis.client || ''} (${devis.num || ''})</title>
      <style>
        body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; padding:20px; color:#111;}
        h1,h2{margin:0 0 8px;}
        .muted{color:#666}
        .block{margin:14px 0;}
        table{width:100%;border-collapse:collapse;margin-top:6px}
        th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:13px}
        @media print {.noprint{display:none}}
      </style>
    </head><body>
      <div class="noprint" style="text-align:right;margin-bottom:10px">
        <button onclick="window.print()">Imprimer</button>
      </div>

      <h1>Devis</h1>
      <div class="muted">Destinataire compta : ${devis.admin || '-'}</div>

      <div class="block">
        <div><strong>Client :</strong> ${devis.client || ''}</div>
        <div><strong>Objet :</strong> ${devis.objet || ''}</div>
        <div><strong>Devis no :</strong> ${devis.num || ''}</div>
        <div><strong>Encadrant :</strong> ${devis.encadrant || '-'}</div>
      </div>

      <div class="block">
        <h2>Détails du devis</h2>
        <table>
          <thead><tr><th>Champ</th><th>Valeur</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </body></html>
  `);
}

function renderAll() {
  renderCompta();
  renderDevisCompta();
}

window.addEventListener('shared-store-changed', renderAll);

Store.syncFromServer?.()
  .then(() => {
    renderAll();
  })
  .catch((error) => {
    console.warn('Impossible de synchroniser les bons partages', error);
    renderAll();
  });

setInterval(() => {
  Store.syncFromServer?.()
    .then(() => {
      renderAll();
    })
    .catch((error) => {
      console.warn('Impossible d actualiser les bons partages', error);
    });
}, 5000);
