// Base API = même origine que le site (fonctionne en local et sur Render)
window.API_BASE_URL = `${location.origin}/api`;

// fetch helper qui stringify automatiquement si body est un objet
async function apiFetch(path, options = {}) {
  const token = localStorage.getItem("token");

  const headers = {
    ...(options.headers || {}),
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const finalOptions = { ...options, headers };

  if (finalOptions.body && typeof finalOptions.body === "object") {
    finalOptions.body = JSON.stringify(finalOptions.body);
  }

  const res = await fetch(`${window.API_BASE_URL}${path}`, finalOptions);
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && token) {
    // Le jeton stocke n'est plus accepte (expire au bout de 8h, voir
    // routes/auth.js) : sans ca, l'appli continuait de retenter en boucle
    // et d'echouer silencieusement, parfois pendant des jours, sans jamais
    // renvoyer l'utilisateur se reconnecter pour obtenir un jeton valide.
    window.Auth?.logout?.();
  }

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

window.apiFetch = apiFetch;
