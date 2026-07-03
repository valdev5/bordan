// Accès réservé compta
const CURRENT_USER = Auth.guard('compta');
if (!CURRENT_USER) { /* redirigé par guard */ }
document.getElementById('whoami').textContent = `Connecté : ${CURRENT_USER}`;
document.getElementById('btn-logout').addEventListener('click', (e)=>{ 
  e.preventDefault(); 
  Auth.logout(); 
});

function renderCompta(){
  const wrap = document.getElementById('compta-list');
  const empty = document.getElementById('compta-empty');
  const archWrap = document.getElementById('arch-list');
  const archEmpty = document.getElementById('arch-empty');

  wrap.innerHTML = '';
  archWrap.innerHTML = '';

  const all = Store.load(Store.KEY_BONS);

  // À facturer assignés à moi, non archivés
  const mine = all.filter(b => b.status==='facturer' && b.compta===CURRENT_USER && !b.archived);
  // Archivés assignés à moi
  const archived = all.filter(b => b.compta===CURRENT_USER && b.archived);

  // ---- Liste "À facturer"
  if (!mine.length){ empty.style.display=''; } else { empty.style.display='none'; }

  mine.forEach(b=>{
    const totalH = b.hours ? Object.values(b.hours).flat().reduce((s,h)=>s+(parseFloat(h.h)||0),0) : 0;
    const teamTxt = (b.team||[]).join(', ') || '—';

    const div=document.createElement('div');
    div.className='work-card';
    div.innerHTML=`
      <h3>${b.client||'Client ?'}</h3>
      <div class="work-meta">
        <span class="badge">Devis n° ${b.num_devis||'-'}</span>
        <span class="badge">Chef: ${b.admin||'—'}</span>
        <span class="badge">Équipe: ${teamTxt}</span>
        <span class="badge">⏱ ${totalH} h</span>
      </div>
      <p class="small">${(b.objet||'').slice(0,160)}</p>

      <div class="actions">
        <button class="btn primary" data-view>Voir / Imprimer</button>
        <button class="btn success" data-archive>📦 Archiver</button>
      </div>
    `;

    // Voir / Imprimer
    div.querySelector('[data-view]').addEventListener('click', ()=>openPrintView(b));

    // Archiver
    div.querySelector('[data-archive]').addEventListener('click', ()=>{
      const allB = Store.load(Store.KEY_BONS);
      const idx = allB.findIndex(x=>x.id===b.id);
      if(idx<0){ alert('Bon introuvable.'); return; }
      const copy = {...allB[idx], archived:true, archived_at: new Date().toISOString().slice(0,10)};
      allB[idx]=copy; Store.save(Store.KEY_BONS, allB);
      renderCompta();
    });

    wrap.appendChild(div);
  });

  // ---- Liste "Archivés"
  if (!archived.length){ archEmpty.style.display=''; } else { archEmpty.style.display='none'; }

  archived.forEach(b=>{
    const totalH = b.hours ? Object.values(b.hours).flat().reduce((s,h)=>s+(parseFloat(h.h)||0),0) : 0;
    const div=document.createElement('div');
    div.className='work-card';
    div.innerHTML=`
      <h3>${b.client||'Client ?'}</h3>
      <div class="work-meta">
        <span class="badge">Devis n° ${b.num_devis||'-'}</span>
        <span class="badge">Archivé le ${b.archived_at||'-'}</span>
        <span class="badge">⏱ ${totalH} h</span>
      </div>
      <p class="small">${(b.objet||'').slice(0,160)}</p>

      <div class="actions">
        <button class="btn" data-view>Voir / Imprimer</button>
        <button class="btn" data-restore>↩ Restaurer</button>
        <button class="btn danger" data-purge>🗑 Supprimer définitivement</button>
      </div>
    `;

    div.querySelector('[data-view]').addEventListener('click', ()=>openPrintView(b));

    div.querySelector('[data-restore]').addEventListener('click', ()=>{
      const allB = Store.load(Store.KEY_BONS);
      const idx = allB.findIndex(x=>x.id===b.id);
      if(idx<0){ alert('Bon introuvable.'); return; }
      const copy = {...allB[idx], archived:false, archived_at:''};
      allB[idx]=copy; Store.save(Store.KEY_BONS, allB);
      renderCompta();
    });

    div.querySelector('[data-purge]').addEventListener('click', ()=>{
      if(!confirm('Supprimer définitivement ce bon archivé ?')) return;
      const allB = Store.load(Store.KEY_BONS).filter(x=>x.id!==b.id);
      Store.save(Store.KEY_BONS, allB);
      renderCompta();
    });

    archWrap.appendChild(div);
  });
}

function openPrintView(b){
  // On récupère aussi le devis lié (par numéro)
  const devis = (Store.load(Store.KEY_DEVIS) || []).find(d => d.num === b.num_devis);

  const popup = window.open('', '_blank', 'width=900,height=700');
  const heuresRows = Object.entries(b.hours||{})
    .map(([nom,arr]) => arr.map(h => `
      <tr>
        <td>${nom}</td>
        <td>${h.date||''}</td>
        <td>${h.h||''}</td>
        <td>${(h.note||'').replace(/</g,'&lt;')}</td>
      </tr>
    `).join('')).join('');

  const devisRows = devis && devis.raw
    ? Object.entries(devis.raw).map(([k,v])=>{
        const label = k.replace('devis.','').replace(/_/g,' ');
        return `<tr><td>${label}</td><td>${v||''}</td></tr>`;
      }).join('')
    : '<tr><td colspan="2" class="muted">Aucun devis lié trouvé.</td></tr>';

  const teamTxt = (b.team||[]).join(', ') || '—';
  const totalH = b.hours ? Object.values(b.hours).flat().reduce((s,h)=>s+(parseFloat(h.h)||0),0) : 0;

  popup.document.write(`
    <html><head>
      <title>À facturer — ${b.client||''} (Devis ${b.num_devis||''})</title>
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

      <h1>Bon à facturer</h1>
      <div class="muted">Destinataire compta : ${b.compta||'—'}</div>

      <div class="block">
        <h2>Bon de travail</h2>
        <div><strong>Client :</strong> ${b.client||''}</div>
        <div><strong>Objet :</strong> ${b.objet||''}</div>
        <div><strong>Devis n° :</strong> ${b.num_devis||''}</div>
        <div><strong>Chef :</strong> ${b.admin||'—'}</div>
        <div><strong>Équipe :</strong> ${teamTxt}</div>
        <div><strong>Total heures :</strong> ${totalH} h</div>
      </div>

      <div class="block">
        <h2>Détail des heures</h2>
        <table>
          <thead><tr><th>Intervenant</th><th>Date</th><th>Heures</th><th>Note</th></tr></thead>
          <tbody>${heuresRows || '<tr><td colspan="4" class="muted">Aucune heure saisie</td></tr>'}</tbody>
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

renderCompta();
setInterval(renderCompta, 5000);
