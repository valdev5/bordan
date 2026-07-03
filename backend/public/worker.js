/*************************************************
 * worker.js — Espace Intervenant
 * - Affiche infos clés du Bon: adresses, téléphones, RDV, tâches
 * - Chat (intervenant <-> encadrant) avec timestamp
 * - Ajout d'heures robuste (quart d’heure, virgule/point, 1h30)
 * - Statut personnel (Terminé => À facturer)
 **************************************************/

const CURRENT_USER = (window.Auth && Auth.guard) ? Auth.guard('worker') : null;
if (!CURRENT_USER) { Auth?.logout?.(); }
document.getElementById('whoami').textContent = `Connecté : ${CURRENT_USER || '—'}`;
document.getElementById('btn-logout').addEventListener('click', (e)=>{ e.preventDefault(); Auth.logout(); });

window.$  = window.$  || ((s, r=document) => r.querySelector(s));
window.$$ = window.$$ || ((s, r=document) => Array.from(r.querySelectorAll(s)));
const today = () => new Date().toISOString().slice(0,10);

if (!window.Store){
  window.Store = (() => {
    const KEY_DEVIS='DEVIS', KEY_BONS='BONS';
    const load = k => { try{return JSON.parse(localStorage.getItem(k)||'[]');}catch{return[];} };
    const save = (k,v)=> localStorage.setItem(k, JSON.stringify(v));
    return {KEY_DEVIS, KEY_BONS, load, save};
  })();
}

function isManager(u){ return Auth && typeof Auth.isManager==='function' ? Auth.isManager(u) : false; }
function telLink(num){ return num ? `<a href="tel:${num.replace(/\s+/g,'')}" class="link">${num}</a>` : '—'; }
function mapLink(addr){ return addr ? `<a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}" class="link">${addr}</a>` : '—'; }
function short(text, n=300){ return (text||'').length>n ? (text.slice(0,n-1)+'…') : (text||''); }

function toFloatQuarter(s){
  if (!s) return 0;
  let str = String(s).trim().toLowerCase().replace(',', '.');
  const hMatch = str.match(/^(\d+(?:\.\d+)?)h(\d{1,2})?$/);
  if (hMatch){
    const h = parseFloat(hMatch[1]||'0');
    const m = parseFloat(hMatch[2]||'0');
    return Math.round((h + m/60) * 4) / 4;
  }
  const v = parseFloat(str);
  if (isNaN(v)) return NaN;
  return Math.round(v * 4) / 4;
}

function renderWork(){
  const wrap = document.getElementById('work-list');
  const empty = document.getElementById('work-empty');
  if (!wrap || !empty) return;

  wrap.innerHTML = '';

  const all = Store.load(Store.KEY_BONS) || [];
  const mine = isManager(CURRENT_USER) ? all : all.filter(b => (b.team||[]).includes(CURRENT_USER));

  if (!mine.length){ empty.style.display=''; return; }
  empty.style.display='none';

  mine.forEach(b=>{
    const raw = b.raw || {};
    const encadrants = Array.from(new Set([...(Array.isArray(b.encadrants) ? b.encadrants : []), ...String(raw['bon.encadrants'] || '').split('|'), b.encadrant || raw['bon.encadrant'] || ''].map(v => String(v||'').trim()).filter(Boolean)));
    const encadrant = encadrants.join(', ');
    const admin = b.admin || raw['bon.admin'] || '';
    const client = b.client || raw['bon.client_nom'] || 'Client ?';
    const telClient = raw['bon.client_tel'] || '';
    const adrClient = raw['bon.client_adresse'] || '';

    const adrDiff = (raw['bon.adresse_chantier_diff']||'non') === 'oui';
    const adrChant = raw['bon.adresse_chantier'] || '';
    const locNom   = raw['bon.nom_locataire'] || '';
    const locTel   = raw['bon.tel_locataire'] || '';
    const remChant = raw['bon.remarques_chantier'] || '';

    const rdv = raw['bon.rdv'] || '';
    const rdvH= raw['bon.rdv_heure'] || '';
    const rdvPlus = Array.isArray(b.rdv_plus) ? b.rdv_plus : [];

    const objet = raw['bon.objet'] || b.objet || '';
    const tSupp = raw['bon.travaux_supp'] || '';
    const chat = Array.isArray(b.chat) ? b.chat : [];

    const userStatus = (b.progress && b.progress[CURRENT_USER]) || 'Commencement';
    const myHoursArr = (b.hours && b.hours[CURRENT_USER]) ? b.hours[CURRENT_USER] : [];
    const myTotal = myHoursArr.reduce((acc,h) => acc + (parseFloat(h.h)||0), 0);

    const div=document.createElement('div');
    div.className='work-card';
    div.innerHTML=`
      <h3>${client}</h3>

      <div class="work-meta">
        <span class="badge">Devis n° ${b.num_devis||'-'}</span>
        <span class="badge">${b.status==='facturer'?'À facturer':'En cours'}</span>
        ${admin?`<span class="badge">Gestionnaire: ${admin}</span>`:''}
        ${encadrant?`<span class="badge">Encadrant: ${encadrant}</span>`:''}
      </div>

      <div class="grid-2" style="margin:8px 0">
        <div>
          <div class="small muted">Téléphone client</div>
          <div>${telLink(telClient)}</div>
        </div>
        <div>
          <div class="small muted">Adresse facturation</div>
          <div>${mapLink(adrClient)}</div>
        </div>
      </div>

      <div class="box" style="margin:6px 0">
        <div class="small muted">Adresse chantier ${adrDiff?'(différente)':''}</div>
        <div>${mapLink(adrDiff ? adrChant : adrClient)}</div>
        <div class="small" style="margin-top:4px">
          ${locNom ? `Locataire: <strong>${locNom}</strong> · `:''}
          ${locTel ? `Tel: <a href="tel:${locTel.replace(/\s+/g,'')}" class="link">${locTel}</a>` : ''}
        </div>
        ${remChant ? `<div class="small muted" style="margin-top:4px">Remarques: ${remChant}</div>` : ''}
      </div>

      <div class="grid-2" style="margin:6px 0">
        <div>
          <div class="small muted">RDV initial</div>
          <div>${rdv?rdv:'—'} ${rdvH?('à '+rdvH):''}</div>
        </div>
        <div>
          <div class="small muted">Autres RDV</div>
          <div class="small">
            ${rdvPlus.length ? rdvPlus.map(r => `${r.date||'—'} ${r.heure?('· '+r.heure):''}`).join('<br>') : '—'}
          </div>
        </div>
      </div>

      <div class="box">
        <div class="small muted">Travaux à réaliser</div>
        <div>${short(objet)}</div>
        ${tSupp ? `<div class="small muted" style="margin-top:4px">Travaux sup.: ${tSupp}</div>` : ''}
      </div>

      <div class="chat">
        <div class="small muted" style="margin-bottom:4px">Messages importants</div>
        <div class="chat-log">${
          chat.length ? chat.slice(-6).map(m => `
            <div class="chat-line"><strong>${m.from||'?'}</strong>
              <span class="small muted">${m.date || new Date(m.ts || Date.now()).toLocaleString()}</span><br>${m.text||''}
            </div>
          `).join('') : '<div class="small muted">Aucun message.</div>'
        }</div>
        <div class="chat-form">
          <input type="text" class="chat-input" placeholder="Envoyer un message à l’encadrant…">
          <button class="btn chat-send">Envoyer</button>
        </div>
      </div>

      <div class="work-form">
        <div><label>Date</label><input type="date" class="wdate" value="${today()}"></div>
        <div><label>Heures</label><input type="text" class="whours" placeholder="ex: 1.5, 1,25, 1h30"></div>
        <div><label>Commentaire</label><textarea class="wnote" placeholder="Ce qui a été fait"></textarea></div>
        <button class="btn primary wsave">Ajouter mes heures</button>
      </div>

      <div style="margin-top:10px; display:grid; grid-template-columns:200px 1fr; gap:8px; align-items:center;">
        <label>Statut d’avancement (moi)</label>
        <select class="wprogress">
          <option ${userStatus==='Commencement'?'selected':''}>Commencement</option>
          <option ${userStatus==='Bien avancé'?'selected':''}>Bien avancé</option>
          <option ${userStatus==='Presque terminé'?'selected':''}>Presque terminé</option>
          <option ${userStatus==='Terminé'?'selected':''}>Terminé</option>
        </select>
      </div>

      <div class="small" style="margin-top:8px">Mes dernières lignes:</div>
      <div class="small" data-wlog>—</div>
      <div class="small muted" style="margin-top:4px">Total cumulé: <strong data-wtotal>${(Math.round(myTotal*100)/100).toFixed(2)} h</strong></div>
    `;

    const logBox = div.querySelector('[data-wlog]');
    const totalBox = div.querySelector('[data-wtotal]');
    function refreshLog(){
      const fresh = Store.load(Store.KEY_BONS).find(x=>x.id===b.id);
      const arr = fresh?.hours?.[CURRENT_USER] || [];
      const last = arr.slice(-5);
      logBox.innerHTML = last.length
        ? last.map(h=>`${h.date||'?'} — ${h.h||'0'}h ${h.note?('· '+h.note):''}`).join('<br>')
        : '—';
      const sum = arr.reduce((acc, h)=> acc + (parseFloat(h.h)||0), 0);
      totalBox.textContent = `${(Math.round(sum*100)/100).toFixed(2)} h`;
    }
    refreshLog();

    // Chat send
    div.querySelector('.chat-send').addEventListener('click', ()=>{
      const input = div.querySelector('.chat-input');
      const text = (input.value||'').trim();
      if(!text) return;
      const allB = Store.load(Store.KEY_BONS);
      const idx  = allB.findIndex(x=>x.id===b.id);
      if(idx<0){ alert('Bon introuvable.'); return; }
      const copy = {...allB[idx]};
      copy.chat = Array.isArray(copy.chat) ? copy.chat : [];
      const now = Date.now();
      copy.chat.push({from: CURRENT_USER, text, ts: now, date: new Date(now).toLocaleString()});
      allB[idx]=copy; Store.save(Store.KEY_BONS, allB);
      // ui
      const chatLog = div.querySelector('.chat-log');
      chatLog.insertAdjacentHTML('beforeend',
        `<div class="chat-line"><strong>${CURRENT_USER}</strong> <span class="small muted">${new Date(now).toLocaleString()}</span><br>${text}</div>`
      );
      input.value='';
    });

    // Save hours
    div.querySelector('.wsave').addEventListener('click', ()=>{
      const date = div.querySelector('.wdate').value;
      const rawH = div.querySelector('.whours').value;
      const note = div.querySelector('.wnote').value.trim();
      if(!date){ alert('La date est obligatoire.'); return; }
      const hDec = toFloatQuarter(rawH);
      if(isNaN(hDec) || hDec<=0){ alert('Nombre d’heures invalide. Exemple : 1.5, 1,25 ou 1h30'); return; }
      const allB = Store.load(Store.KEY_BONS);
      const idx  = allB.findIndex(x=>x.id===b.id);
      if(idx<0){ alert('Bon introuvable.'); return; }
      const copy = {...allB[idx]};
      copy.hours = copy.hours || {};
      copy.hours[CURRENT_USER] = copy.hours[CURRENT_USER] || [];
      copy.hours[CURRENT_USER].push({date, h: hDec, note});
      allB[idx]=copy; Store.save(Store.KEY_BONS, allB);
      refreshLog();
      div.querySelector('.wdate').value = today();
      div.querySelector('.whours').value = '';
      div.querySelector('.wnote').value = '';
      alert('Heures enregistrées.');
    });

    // Progress
    div.querySelector('.wprogress').addEventListener('change', (e)=>{
      const val = e.target.value;
      const allB = Store.load(Store.KEY_BONS);
      const idx  = allB.findIndex(x=>x.id===b.id);
      if(idx<0){ alert('Bon introuvable.'); return; }
      const copy = {...allB[idx]};
      copy.progress = copy.progress || {};
      copy.progress[CURRENT_USER] = val;
      if (val === 'Terminé') copy.status = 'facturer';
      allB[idx] = copy; Store.save(Store.KEY_BONS, allB);
      alert(val === 'Terminé' ? 'Statut mis à jour. Le bon passe en « À facturer ».' : 'Statut mis à jour.');
      renderWork();
    });

    wrap.appendChild(div);
  });
}

renderWork();
setInterval(renderWork, 6000); // refresh périodique
