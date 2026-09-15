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
  const card = document.getElementById('login-card');
  const errorBox = document.getElementById('login-error');
  const errorText = document.getElementById('login-error-text');
  const btnLabel = btn.textContent;
  let loading = false;

  function setLoading(on){
    loading = on;
    btn.disabled = on;
    btn.innerHTML = on
      ? '<span class="spinner" aria-hidden="true"></span> Connexion en cours…'
      : btnLabel;
  }

  function hideError(){
    errorBox.classList.remove('show');
  }

  function showError(message){
    errorText.textContent = message;
    errorBox.classList.add('show');

    card.classList.remove('shake');
    // force le reflow pour pouvoir rejouer l'animation sur des erreurs successives
    void card.offsetWidth;
    card.classList.add('shake');
  }

  usernameEl.addEventListener('input', hideError);
  passwordEl.addEventListener('input', hideError);

  async function go(){
    if (loading) return;

    const username = (usernameEl.value || '').trim();
    const password = (passwordEl.value || '').trim();
    if (!username || !password) { showError('Merci de saisir utilisateur et mot de passe.'); return; }

    hideError();
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
      const message = e.message === 'Invalid credentials'
        ? 'Identifiant ou mot de passe incorrect.'
        : (e.message || 'Connexion impossible.');
      showError(message);
      passwordEl.focus();
    }
  }

  btn.addEventListener('click', go);
  document.addEventListener('keydown', (e)=>{ if(e.key==='Enter') go(); });
})();
