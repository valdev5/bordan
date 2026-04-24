// Utilitaires communs (stockage & helpers)
const Store = (() => {
  const KEY_DEVIS = 'app:devis:list';
  const KEY_BONS  = 'app:bons:list';

  const load = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
  const save = (key, val) => localStorage.setItem(key, JSON.stringify(val));
  const removeById = (list, id) => list.filter(x => x.id !== id);

  function upsertByField(list, item, field, forcedId=null){
    const idx = item[field] ? list.findIndex(it => it[field] === item[field]) : -1;
    const id  = forcedId ?? (idx > -1 ? list[idx].id : Date.now());
    const nextItem = { ...item, id };
    if (idx > -1) return [...list.slice(0, idx), nextItem, ...list.slice(idx+1)];
    return [...list, nextItem];
  }

  return { KEY_DEVIS, KEY_BONS, load, save, removeById, upsertByField };
})();

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
// --- À AJOUTER en bas de app-common.js ---
window.today = window.today || (() => new Date().toISOString().slice(0,10));
window.uid   = window.uid   || (() => Math.random().toString(36).slice(2,8) + '-' + Date.now().toString(36));

