// login.js — connexion par mot de passe

(function(){
  // Sur telephone, on montre toute la devanture (comme sur PC) plutot que
  // de recadrer sur le centre : on bascule le SVG en mode "meet" cale en bas.
  const scene = document.querySelector('.fx-scene');
  if (scene){
    const mq = window.matchMedia('(max-width:480px)');
    const applySceneFit = () => {
      scene.setAttribute('preserveAspectRatio', mq.matches ? 'xMidYMax meet' : 'xMidYMid slice');
    };
    applySceneFit();
    mq.addEventListener ? mq.addEventListener('change', applySceneFit) : mq.addListener(applySceneFit);
  }

  const btn = document.getElementById('btn-login');
  const usernameEl = document.getElementById('username');
  const passwordEl = document.getElementById('password');
  const btnLabel = btn.textContent;
  let loading = false;

  function setLoading(on){
    loading = on;
    btn.disabled = on;
    btn.innerHTML = on
      ? '<span class="spinner" aria-hidden="true"></span> Connexion en cours…'
      : btnLabel;
  }

  async function go(){
    if (loading) return;

    const username = (usernameEl.value || '').trim();
    const password = (passwordEl.value || '').trim();
    if (!username || !password) { alert('Merci de saisir utilisateur + mot de passe'); return; }

    setLoading(true);
    try {
      const u = await Auth.login(username, password);

      const fallback =
        u.role === 'manager' ? 'manager.html' :
        u.role === 'worker'  ? 'worker.html'  :
        u.role === 'compta'  ? 'compta.html'  : 'login.html';

      const dest = sessionStorage.getItem('AFTER_LOGIN_TARGET') || fallback;
      sessionStorage.removeItem('AFTER_LOGIN_TARGET');
      location.href = dest;
    } catch(e){
      setLoading(false);
      alert(e.message || 'Connexion impossible');
    }
  }

  btn.addEventListener('click', go);
  document.addEventListener('keydown', (e)=>{ if(e.key==='Enter') go(); });
})();
