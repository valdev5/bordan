/*************************************************
 * manager.js – Espace Chefs (complet)
 * - Retour auto au tableau après Enregistrer (devis/bon)
 * - Création auto du BT si devis Accepté + Acompte = oui (puis suppression du devis)
 * - Filtrage par chef via #show-all
 * - Chips intervenants (encadrant + équipe)
 * - Messagerie chantier côté encadrant (+ badge non lus)
 **************************************************/

/* Helpers DOM */
window.$  = window.$  || ((s, r=document) => r.querySelector(s));
window.$$ = window.$$ || ((s, r=document) => Array.from(r.querySelectorAll(s)));
const today = () => (window.today ? window.today() : new Date().toISOString().slice(0,10));

/* Auth */
const CURRENT_USER = (window.Auth && Auth.guard) ? Auth.guard('manager') : null;
if (!CURRENT_USER) { Auth?.logout?.(); }
$('#whoami') && ($('#whoami').textContent = `Connecté : ${CURRENT_USER || '—'}`);
$('#btn-logout')?.addEventListener('click', e=>{ e.preventDefault(); Auth?.logout?.(); });
const whoShort = $('#whoami-short'); if (whoShort) whoShort.textContent = (CURRENT_USER||'—');
setTimeout(() => { if (!getSelectedEncadrants().length && CURRENT_USER) setSelectedEncadrants([CURRENT_USER]); }, 0);

/* Store fallback */
if (!window.Store){
  window.Store = (() => {
    const KEY_DEVIS='DEVIS', KEY_BONS='BONS';
    const load = k => { try{return JSON.parse(localStorage.getItem(k)||'[]');}catch{return[];} };
    const save = (k,v)=> localStorage.setItem(k, JSON.stringify(v));
    const upsertByField=(list,item,field,idForReplace)=>{
      const i = idForReplace ? list.findIndex(x=>x.id===idForReplace) : list.findIndex(x=>x[field]===item[field]);
      item.id = item.id || (Math.random().toString(36).slice(2)+Date.now().toString(36));
      if(i>=0) list[i]=item; else list.push(item);
      return list;
    };
    return {KEY_DEVIS, KEY_BONS, load, save, upsertByField};
  })();
}

/* Tabs */
(function initTabs(){
  const tabs  = $$('.tabs .tab');
  const views = $$('main .view');
  function showTab(name){
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    views.forEach(v => v.classList.toggle('show', v.id === 'tab-' + name));
    if (name === 'board') { try { renderBoard(); } catch(e){} }
    if (name === 'devis') setTimeout(initDevisDefaults, 0);
  }
  tabs.forEach(t => t.addEventListener('click', e=>{ e.preventDefault(); showTab(t.dataset.tab); }));
  showTab('board');
})();

/* Filtre par chef */
const SHOW_ALL_KEY = 'SHOW_ALL_FOR_MANAGER';
let showAll = localStorage.getItem(SHOW_ALL_KEY) === '1';
const showAllToggle = $('#show-all');
if (showAllToggle){
  showAllToggle.checked = showAll;
  showAllToggle.onchange = ()=>{
    showAll = !!showAllToggle.checked;
    localStorage.setItem(SHOW_ALL_KEY, showAll?'1':'0');
    renderBoard();
  };
}
function belongsToChef(item){
  const chef = (CURRENT_USER||'').trim();
  if (!chef) return true;
  const chefLower = chef.toLowerCase();
  const encadrants = getEncadrantsForItem(item);
  if (encadrants.some(n => n.toLowerCase() === chefLower)) return true;
  const team = Array.isArray(item.team) ? item.team : [];
  if (team.some(n => (n||'').toLowerCase() === chefLower)) return true;
  return false;
}

const MANAGER_NAMES = ['Laurent', 'Cédric M', 'Cédric A', 'Vivien'];

/* State & utils */
let currentDevisId=null, currentBonId=null, currentBonNum=null;
function getVal(n){ return ($(`[name="${n}"]`)?.value || '').trim(); }
function normalizeList(arr){ return Array.from(new Set((Array.isArray(arr) ? arr : []).map(v => String(v||'').trim()).filter(Boolean))); }
function getSelectedEncadrants(){ return normalizeList($$('.enc-team').filter(cb=>cb.checked).map(cb=>cb.value)); }
function setSelectedEncadrants(names){ const set = new Set(normalizeList(names)); $$('.enc-team').forEach(cb => cb.checked = set.has(cb.value)); }
function getEncadrantsForItem(item){
  const raw = item.raw || {};
  const direct = Array.isArray(item.encadrants) ? item.encadrants : [];
  const rawMany = String(raw['bon.encadrants'] || raw['devis.encadrants'] || '').split('|');
  const single = [item.encadrant, raw['bon.encadrant'], raw['devis.encadrant']];
  return normalizeList([...direct, ...rawMany, ...single]);
}

function removeDevisByNum(num){
  if(!num) return;
  const all = Store.load(Store.KEY_DEVIS);
  Store.save(Store.KEY_DEVIS, all.filter(d => d.num !== num));
}

/* Chips intervenants (affichage) */
function displayPeopleChips(item){
  const encadrants = getEncadrantsForItem(item);
  const team = normalizeList(Array.isArray(item.team) ? item.team : []);
  const chips = [];
  encadrants.forEach(name => chips.push(`<span class="chip chip--lead" title="Encadrant">${name}</span>`));
  const encLower = new Set(encadrants.map(n => n.toLowerCase()));
  team.filter(n => !encLower.has(n.toLowerCase())).forEach(n => chips.push(`<span class="chip" title="Affectation">${n}</span>`));
  return chips.length ? `<div class="chips-inline">${chips.join('')}</div>` : '';
}

/* Defaults devis */
function initDevisDefaults(){
  const ddate = $('#ddate'); if (ddate && !ddate.value) ddate.value = today();
  const dnum  = $('#dnum');
  if (dnum && !dnum.value) {
    const base = today().replaceAll('-', '');
    const list = Store.load(Store.KEY_DEVIS) || [];
    const countToday = list.filter(d => (d.num||'').startsWith('DV-'+base)).length;
    dnum.value = `DV-${base}-${String(countToday + 1).padStart(3,'0')}`;
  }
}
document.readyState !== 'loading' ? initDevisDefaults() : document.addEventListener('DOMContentLoaded', initDevisDefaults);

/* ===== Messagerie (helpers encadrant) ===== */
function tsOf(m){
  if (!m) return 0;
  if (typeof m.ts === 'number') return m.ts;
  const t = Date.parse(m.date || '');
  return isNaN(t) ? 0 : t;
}
function markChatSeen(b, who){
  const allB = Store.load(Store.KEY_BONS);
  const idx  = allB.findIndex(x=>x.id===b.id);
  if(idx < 0) return;
  const copy = {...allB[idx]};
  copy.chatSeen = copy.chatSeen || {};
  copy.chatSeen[who] = Date.now();
  allB[idx] = copy;
  Store.save(Store.KEY_BONS, allB);
}
function countUnreadFor(b, who){
  const seenTs = (b.chatSeen && b.chatSeen[who]) ? b.chatSeen[who] : 0;
  const arr = Array.isArray(b.chat) ? b.chat : [];
  return arr.filter(m => (m.from || '') !== who && tsOf(m) > seenTs).length;
}
function initManagerChat(b){
  const log = $('#mgr-chat-log');
  const input = $('#mgr-chat-input');
  const sendBtn = $('#mgr-chat-send');
  if(!log || !input || !sendBtn) return;

  function renderLog(){
    const fresh = Store.load(Store.KEY_BONS).find(x=>x.id===b.id) || b;
    const chat = Array.isArray(fresh.chat) ? fresh.chat : [];
    const last = chat.slice(-30);
    log.innerHTML = last.map(m => `
      <div class="chat-line">
        <strong>${m.from || '?'}</strong>
        <span class="small muted">${m.date || new Date(m.ts || Date.now()).toLocaleString()}</span><br>
        ${m.text || ''}
      </div>
    `).join('') || '<div class="small muted">Aucun message.</div>';
  }

  renderLog();

  const who = (CURRENT_USER || '').trim() || 'Encadrant';
  markChatSeen(b, who);

  sendBtn.onclick = ()=>{
    const text = (input.value || '').trim();
    if (!text) return;
    const allB = Store.load(Store.KEY_BONS);
    const idx  = allB.findIndex(x=>x.id===b.id);
    if (idx < 0) { alert('Bon introuvable.'); return; }
    const copy = {...allB[idx]};
    copy.chat = Array.isArray(copy.chat) ? copy.chat : [];
    const now = Date.now();
    copy.chat.push({ from: who, text, ts: now, date: new Date(now).toLocaleString() });
    copy.chatSeen = copy.chatSeen || {};
    copy.chatSeen[who] = now; // l’expéditeur a vu
    allB[idx] = copy; Store.save(Store.KEY_BONS, allB);
    input.value = '';
    renderLog();
    renderBoard(); // mettre à jour badge non lus
  };
}

/* ===== DEVIS ===== */
$('#save-devis')?.addEventListener('click', ()=>{
  const raw = Object.fromEntries(
    $$('[name^="devis."]').map(el => [el.name, el.type==='checkbox' ? (el.checked?'oui':'non') : el.value])
  );

  let pipeline = 'd-attente-appel';
  const listDevisAll = Store.load(Store.KEY_DEVIS);
  const curr = listDevisAll.find(d=>d.num===raw['devis.num_devis']);
  if (curr?.pipeline) pipeline = curr.pipeline;

  const item = {
    id: currentDevisId || undefined, type:'devis',
    num: getVal('devis.num_devis'),
    client: getVal('devis.nom'),
    objet: getVal('devis.objet_demande') || getVal('devis.objet'),
    signe: getVal('devis.signe')||'non',
    acompte: getVal('devis.acompte')||'non',
    refuse: getVal('devis.refuse')||'non',
    encadrant: getVal('devis.encadrant') || '',
    pipeline,
    raw
  };

  if (!item.num) { alert('Le numéro de devis est requis.'); return; }
  const exists = listDevisAll.some(d => d.num === item.num && d.id !== currentDevisId);
  if (exists) { alert('Un devis avec ce numéro existe déjà.'); return; }

  Store.save(Store.KEY_DEVIS, Store.upsertByField(listDevisAll, item, 'num', currentDevisId));

  if (item.signe==='oui' && item.acompte==='oui' && item.refuse!=='oui') {
    autoCreateOrUpdateBonFromDevis(item);
    removeDevisByNum(item.num);
  }

  currentDevisId = null;
  alert('Devis enregistré.');
  renderBoard();
  document.querySelector('.tabs .tab[data-tab="board"]')?.click();
});

$('#load-devis')?.addEventListener('click', ()=>{
  const num = prompt('N° de devis à charger ?'); if(!num) return;
  const found = Store.load(Store.KEY_DEVIS).find(d=>d.num===num);
  if(!found){ alert('Devis introuvable.'); return; }
  Object.entries(found.raw).forEach(([k,v])=>{
    const el=$(`[name="${k}"]`); if(!el) return;
    if(el.type==='checkbox') el.checked = (v==='oui'); else el.value=v;
  });
  currentDevisId = found.id;
  document.querySelector('.tabs .tab[data-tab="devis"]')?.click();
});

/* ===== BON ===== */
const heuresBody = $('#heures-body');
function addHeuresRow(values=['','','','','','']){
  const tr=document.createElement('tr');
  for(let i=0;i<6;i++){
    const td=document.createElement('td'); const ip=document.createElement('input');
    ip.type=(i%2===0)?'date':'text'; ip.value=values[i]||''; ip.style.width='100%'; ip.style.border='0';
    td.appendChild(ip); tr.appendChild(td);
  }
  const tdDel=document.createElement('td'); const del=document.createElement('button');
  del.textContent='✕'; del.className='btn danger'; del.onclick=()=>tr.remove();
  tdDel.appendChild(del); tr.appendChild(tdDel); heuresBody?.appendChild(tr);
}
$('#add-row')?.addEventListener('click',e=>{e.preventDefault();addHeuresRow();});
if(heuresBody && !heuresBody.children.length){ for(let i=0;i<3;i++) addHeuresRow(); }

const rdvPlusBody = $('#rdv-plus-body');
function addRDV(date='', heure=''){
  if(!rdvPlusBody) return;
  const tr=document.createElement('tr');
  tr.innerHTML = `
    <td><input type="date" value="${date}"></td>
    <td><input type="time" value="${heure}"></td>
    <td><button class="btn danger" type="button">✕</button></td>`;
  tr.querySelector('button').onclick=()=>tr.remove();
  rdvPlusBody.appendChild(tr);
}
$('#add-rdv')?.addEventListener('click', e=>{ e.preventDefault(); addRDV(); });

$('#save-bon')?.addEventListener('click', ()=>{
  const lignes=[...heuresBody?.querySelectorAll('tr')||[]].map(tr=>[...tr.querySelectorAll('input')].map(i=>i.value));
  const rdv_plus=[...rdvPlusBody?.querySelectorAll('tr')||[]].map(tr=>{
    const [d,h]=[...tr.querySelectorAll('input')].map(i=>i.value); return {date:d, heure:h};
  });
  const raw = Object.fromEntries($$('[name^="bon."]').map(el=>[
    el.name, (el.type==='checkbox') ? (el.checked?'oui':'non') : el.value
  ]));

  const listB = Store.load(Store.KEY_BONS);
  const curr = listB.find(b=>b.num_devis===raw['bon.num_devis']);

  const team = normalizeList($$('.aff-team').filter(cb=>cb.checked).map(cb=>cb.value));
  const admin = $('#bon-admin')?.value || curr?.admin || '';
  const encadrants = normalizeList([...(getSelectedEncadrants()), ...(curr?.encadrants || []), ...(curr?.encadrant ? [curr.encadrant] : [])]);

  const item = {
    id: currentBonId || undefined, type:'bon',
    num_devis:getVal('bon.num_devis'),
    client:getVal('bon.client_nom'),
    objet:getVal('bon.objet'),
    lignes,
    rdv_plus,
    pipe: curr?.pipe || 'b-pret',
    status: (curr?.status)|| (curr?.pipe==='b-facturer'?'facturer':'bons'),
    team: team.length?team:normalizeList(curr?.team||[]),
    admin,
    encadrants,
    encadrant: encadrants[0] || curr?.encadrant || '',
    raw: { ...raw, 'bon.encadrants': encadrants.join('|'), 'bon.encadrant': encadrants[0] || '' }
  };

  Store.save(Store.KEY_BONS, Store.upsertByField(listB, item, 'num_devis', currentBonId));

  currentBonId=null; currentBonNum=item.num_devis;
  alert('Bon enregistré.');
  renderBoard();
  document.querySelector('.tabs .tab[data-tab="board"]')?.click();
});

$('#load-bon')?.addEventListener('click', ()=>{
  const num=prompt('N° de devis rattaché au bon ?'); if(!num) return;
  const found = Store.load(Store.KEY_BONS).find(b=>b.num_devis===num);
  if(!found){ alert('Bon introuvable.'); return; }
  Object.entries(found.raw).forEach(([k,v])=>{
    const el=$(`[name="${k}"]`); if(!el) return;
    if(el.type==='checkbox') el.checked=(v==='oui'); else el.value=v;
  });
  heuresBody && (heuresBody.innerHTML=''); (found.lignes||[]).forEach(r=>addHeuresRow(r));
  if(heuresBody && !heuresBody.children.length){ for(let i=0;i<3;i++) addHeuresRow(); }
  rdvPlusBody && (rdvPlusBody.innerHTML=''); (found.rdv_plus||[]).forEach(r=>addRDV(r.date,r.heure));
  $$('.aff-team').forEach(cb=>cb.checked=(found.team||[]).includes(cb.value));
  setSelectedEncadrants(getEncadrantsForItem(found).length ? getEncadrantsForItem(found) : [found.encadrant || CURRENT_USER].filter(Boolean));
  if(found.raw?.['bon.admin']) $('#bon-admin').value=found.raw['bon.admin'];

  currentBonId=found.id; currentBonNum=found.num_devis;
  document.querySelector('.tabs .tab[data-tab="bon"]')?.click();

  // initialiser la messagerie sur l’onglet Bon + marquer "vu"
  initManagerChat(found);
  markChatSeen(found, (CURRENT_USER||'').trim());
  renderBoard(); // refresh badge non lus
});

/* Auto-création BT depuis Devis */
function autoCreateOrUpdateBonFromDevis(d){
  const raw=d.raw||{}; const list=Store.load(Store.KEY_BONS);
  const existing=list.find(b=>b.num_devis===d.num);

  const bon={
    id: existing?.id, type:'bon',
    num_devis:d.num||'',
    client:d.client||raw['devis.nom']||'',
    objet: raw['devis.objet']||raw['devis.objet_demande']||'',
    pipe: existing?.pipe||'b-pret',
    status: existing?.status||'bons',
    team: existing?.team||[],
    admin: existing?.admin||'',
    encadrants: normalizeList([...(existing?.encadrants||[]), ...(d.encadrants||[]), d.encadrant, existing?.encadrant].filter(Boolean)),
    encadrant: (normalizeList([...(existing?.encadrants||[]), ...(d.encadrants||[]), d.encadrant, existing?.encadrant].filter(Boolean))[0]) || '',
    chat: existing?.chat || [],
    chatSeen: existing?.chatSeen || {},
    raw: {
      ...(existing?.raw||{}),
      'bon.num_devis': d.num || '',
      'bon.date_devis': raw['devis.date_demande'] || '',
      'bon.acompte': (d.acompte==='oui')?'1':'',
      'bon.client_nom': raw['devis.nom'] || '',
      'bon.client_num': raw['devis.num_client'] || '',
      'bon.client_adresse': raw['devis.adresse'] || '',
      'bon.client_tel': raw['devis.tel'] || '',
      'bon.adresse_chantier_diff': raw['devis.adresse_chantier_diff'] || 'non',
      'bon.adresse_chantier':      raw['devis.adresse_chantier'] || '',
      'bon.nom_locataire':         raw['devis.nom_locataire'] || '',
      'bon.tel_locataire':         raw['devis.tel_locataire'] || '',
      'bon.remarques_chantier':    raw['devis.remarques_chantier'] || '',
      'bon.encadrants': normalizeList([...(existing?.encadrants||[]), ...(d.encadrants||[]), d.encadrant, existing?.encadrant].filter(Boolean)).join('|'),
      'bon.encadrant': normalizeList([...(existing?.encadrants||[]), ...(d.encadrants||[]), d.encadrant, existing?.encadrant].filter(Boolean))[0] || ''
    }
  };
  Store.save(Store.KEY_BONS, Store.upsertByField(list, bon, 'num_devis', existing?.id));
  removeDevisByNum(d.num); // éviter doublon
}

/* ===== Board ===== */
function renderBoard(){
  const C={
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
    'b-archive': $('#b-archive')
  };
  Object.values(C).filter(Boolean).forEach(el=>el.innerHTML='');

  // Devis
  const devisRaw=Store.load(Store.KEY_DEVIS);
  const devisList=devisRaw.map(d=>({
    ...d,
    pipeline: d.pipeline || (d.refuse==='oui'?'d-refuse':
      (d.signe==='oui' && d.acompte==='oui'?'d-accepte':
        (d.raw?.['devis.rdv_date']?'d-rdv-pris':'d-attente-appel')))
  }));
  Store.save(Store.KEY_DEVIS, devisList);

  const devisListVisible = showAll ? devisList : devisList.filter(belongsToChef);
  devisListVisible.forEach(d=>{
    const col = C[d.pipeline]; if(!col) return;
    const card=document.createElement('div'); card.className='card';
    card.innerHTML=`
      <div class="line1"><strong>${d.client||'Client ?'}</strong><span class="small">Devis n° ${d.num||'-'}</span></div>
      ${displayPeopleChips(d)}
      <div class="small" style="margin:4px 0">${d.objet||''}</div>
      <div class="row" style="margin-top:8px">
        <label>Étape</label>
        <select class="pipe">
          <option value="d-attente-appel">Attente d’appel / RDV</option>
          <option value="d-rdv-pris">RDV pris</option>
          <option value="d-a-saisir">À saisir</option>
          <option value="d-attente-retour">Saisi / attente retour</option>
          <option value="d-accepte">Accepté</option>
          <option value="d-refuse">Refusé</option>
        </select>
      </div>
      <div class="grid-3 small" style="margin-top:6px">
        <label><input type="checkbox" class="chk-signe" ${d.signe==='oui'?'checked':''}> signé</label>
        <label><input type="checkbox" class="chk-acompte" ${d.acompte==='oui'?'checked':''}> acompte</label>
      </div>
      <div class="actions" style="margin-top:6px">
        <button class="btn primary open">Ouvrir</button>
        <button class="btn danger delete">🗑 Supprimer</button>
      </div>`;
    const pipeSel=card.querySelector('.pipe'); pipeSel.value=d.pipeline;
    pipeSel.onchange = () => {
      d.pipeline = pipeSel.value;
      const updated = devisList.map(x => x.id === d.id ? d : x);
      Store.save(Store.KEY_DEVIS, updated);
      if (d.pipeline === 'd-accepte' && d.acompte === 'oui') {
        autoCreateOrUpdateBonFromDevis(d);
        removeDevisByNum(d.num);
        renderBoard(); return;
      }
      renderBoard();
    };
    card.querySelector('.chk-signe').onchange=(e)=>{ d.signe=e.target.checked?'oui':'non'; Store.save(Store.KEY_DEVIS, devisList); };
    card.querySelector('.chk-acompte').onchange=(e)=>{
      d.acompte=e.target.checked?'oui':'non'; Store.save(Store.KEY_DEVIS, devisList);
      if(d.pipeline==='d-accepte' && d.acompte==='oui'){
        autoCreateOrUpdateBonFromDevis(d);
        removeDevisByNum(d.num);
        renderBoard(); return;
      }
    };
    card.querySelector('.open').onclick=()=>{ Object.entries(d.raw||{}).forEach(([k,v])=>{ const el=$(`[name="${k}"]`); if(!el) return; el.type==='checkbox' ? (el.checked=(v==='oui')) : (el.value=v); });
      currentDevisId=d.id; document.querySelector('.tabs .tab[data-tab="devis"]')?.click(); initDevisDefaults(); };
    card.querySelector('.delete').onclick=()=>{ if(confirm(`Supprimer le devis n° ${d.num||''} ?`)){ Store.save(Store.KEY_DEVIS, devisList.filter(x=>x.id!==d.id)); renderBoard(); } };
    col.appendChild(card);
  });

  // Bons
  const bonsList=Store.load(Store.KEY_BONS).map(b=>({...b, pipe: b.pipe || (b.status==='facturer'?'b-facturer':'b-pret')}));
  Store.save(Store.KEY_BONS, bonsList);
  const bonsListVisible = showAll ? bonsList : bonsList.filter(belongsToChef);

  bonsListVisible.forEach(b=>{
    const col = C[b.archived?'b-archive':b.pipe]; if(!col) return;
    const unread = countUnreadFor(b, (CURRENT_USER||'').trim());
    const unreadBadge = unread > 0 ? `<span class="badge" title="Messages non lus">${unread} nouveau${unread>1?'x':''}</span>` : '';

    const card=document.createElement('div'); card.className='card';
    card.innerHTML=`
      <div class="line1"><strong>${b.client||'Client ?'}</strong><span class="small">Devis n° ${b.num_devis||'-'}</span></div>
      ${displayPeopleChips(b)}
      <div class="small" style="margin:4px 0">${(b.objet||'').slice(0,100)}</div>
      <div class="small" style="margin-bottom:6px">${unreadBadge}</div>
      <div class="row" style="margin-top:6px">
        <label>Étape</label>
        <select class="pipe">
          <option value="b-pret">BT prêt / en attente</option>
          <option value="b-affect">RDV pris + Affectation</option>
          <option value="b-encours">Chantier en cours</option>
          <option value="b-facturer">À facturer</option>
        </select>
      </div>
      <div class="actions" style="margin-top:6px">
        <button class="btn primary open">Ouvrir</button>
        <button class="btn danger delete">🗑 Supprimer</button>
      </div>`;
    const sel=card.querySelector('.pipe'); sel.value=b.pipe;
    sel.onchange=()=>{ b.pipe=sel.value; if(b.pipe==='b-facturer') b.status='facturer';
      const updated=bonsList.map(x=>x.id===b.id?b:x); Store.save(Store.KEY_BONS, updated); renderBoard(); };
    card.querySelector('.open').onclick=()=>{
      Object.entries(b.raw||{}).forEach(([k,v])=>{ const el=$(`[name="${k}"]`); if(!el) return; el.type==='checkbox' ? (el.checked=(v==='oui')) : (el.value=v); });
      heuresBody && (heuresBody.innerHTML=''); (b.lignes||[]).forEach(r=>addHeuresRow(r));
      if(heuresBody && !heuresBody.children.length){ for(let i=0;i<3;i++) addHeuresRow(); }
      rdvPlusBody && (rdvPlusBody.innerHTML=''); (b.rdv_plus||[]).forEach(r=>addRDV(r.date,r.heure));
      $$('.aff-team').forEach(cb=>cb.checked=(b.team||[]).includes(cb.value));
      setSelectedEncadrants(getEncadrantsForItem(b).length ? getEncadrantsForItem(b) : [b.encadrant || CURRENT_USER].filter(Boolean));
      if(b.raw?.['bon.admin']) $('#bon-admin').value=b.raw['bon.admin'];
      currentBonId=b.id; currentBonNum=b.num_devis;
      document.querySelector('.tabs .tab[data-tab="bon"]')?.click();

      // Init chat + marquer vu + refresh badge
      initManagerChat(b);
      markChatSeen(b, (CURRENT_USER||'').trim());
      renderBoard();
    };
    card.querySelector('.delete').onclick=()=>{ if(confirm(`Supprimer le bon (devis n° ${b.num_devis||''}) ?`)){
      Store.save(Store.KEY_BONS, bonsList.filter(x=>x.id!==b.id)); renderBoard(); } };
    col.appendChild(card);
  });
}

/* Premier rendu */
renderBoard();
