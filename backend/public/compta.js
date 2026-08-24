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

function makePhoneDevisNum(list = Store.load(Store.KEY_DEVIS) || []) {
  const base = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const count = list.filter((devis) => String(devis.num || '').startsWith(`DV-${base}`)).length;
  return `DV-${base}-${String(count + 1).padStart(3, '0')}`;
}

function initPhoneDevisForm() {
  const numField = document.getElementById('pd-num');
  const dateField = document.getElementById('pd-date');
  if (numField) numField.value = makePhoneDevisNum();
  if (dateField) dateField.value = new Date().toISOString().slice(0, 10);
}

initPhoneDevisForm();

document.getElementById('save-phone-devis').addEventListener('click', async () => {
  const nom = cleanText(document.getElementById('pd-nom').value);
  if (!nom) {
    alert('Le nom du client est requis.');
    return;
  }

  const num = cleanText(document.getElementById('pd-num').value) || makePhoneDevisNum();
  const list = Store.load(Store.KEY_DEVIS);

  if (list.some((devis) => devis.num === num)) {
    alert('Un devis avec ce numéro existe déjà.');
    return;
  }

  const encadrants = Array.from(document.querySelectorAll('.pd-enc-team:checked')).map((el) => el.value);
  const objet = cleanText(document.getElementById('pd-objet').value);
  const dateField = cleanText(document.getElementById('pd-date').value);

  const item = {
    type: 'devis',
    num,
    client: nom,
    objet,
    signe: 'non',
    acompte: 'non',
    refuse: 'non',
    admin: '',
    encadrants,
    encadrant: encadrants[0] || '',
    pipeline: 'd-attente-appel',
    raw: {
      'devis.num_devis': num,
      'devis.date_demande': dateField,
      'devis.nom': nom,
      'devis.num_client': cleanText(document.getElementById('pd-numclient').value),
      'devis.adresse': cleanText(document.getElementById('pd-adresse').value),
      'devis.code_postal': cleanText(document.getElementById('pd-cp').value),
      'devis.ville': cleanText(document.getElementById('pd-ville').value),
      'devis.tel': cleanText(document.getElementById('pd-tel').value),
      'devis.objet_demande': objet,
      'devis.notes_avant_rdv': cleanText(document.getElementById('pd-notes').value),
      'devis.signe': 'non',
      'devis.acompte': 'non',
      'devis.refuse': 'non',
      'devis.encadrants': encadrants.join('|'),
      'devis.encadrant': encadrants[0] || '',
      'devis.admin': '',
      'devis.cree_par': CURRENT_USER,
    },
  };

  Store.save(Store.KEY_DEVIS, Store.upsertByField(list, item, 'num'));

  try {
    await Store.flush?.();
  } catch (error) {
    console.warn('Impossible de pousser le devis vers le stockage partage', error);
  }

  alert('Devis enregistré. Les encadrants assignés le retrouveront dans leur espace.');

  ['pd-numclient', 'pd-nom', 'pd-tel', 'pd-adresse', 'pd-cp', 'pd-ville', 'pd-objet', 'pd-notes']
    .forEach((id) => { document.getElementById(id).value = ''; });
  document.querySelectorAll('.pd-enc-team').forEach((el) => { el.checked = false; });
  initPhoneDevisForm();
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

    card.querySelector('[data-purge]').addEventListener('click', () => {
      if (!confirm('Supprimer definitivement ce bon archive ?')) {
        return;
      }

      const allBons = Store.load(Store.KEY_BONS).filter((entry) => entry.id !== bon.id);
      Store.save(Store.KEY_BONS, allBons);
      renderCompta();
    });

    archWrap.appendChild(card);
  });
}

function csvEscape(value) {
  const str = String(value ?? '');
  return /[;"\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function exportComptaCsv() {
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

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `a-facturer_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

document.getElementById('btn-export-csv').addEventListener('click', exportComptaCsv);

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
