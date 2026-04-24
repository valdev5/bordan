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

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

window.apiFetch = apiFetch;
