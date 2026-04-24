// auth.js — JWT + user en localStorage

const getAppPath = (page = '') => {
  const base = location.pathname.replace(/[^/]*$/, '');
  return `${base}${page}`;
};

const Auth = {
  async login(username, password) {
    const data = await window.apiFetch("/auth/login", {
      method: "POST",
      body: { username, password }, // apiFetch stringify automatiquement
    });

    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    return data.user;
  },

  getToken() {
    return localStorage.getItem("token");
  },

  getUser() {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  },

  logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    location.href = getAppPath('login.html');
  },

  // Protection des pages.
  // - accepte un role unique ("manager") ou une liste (["manager","compta"])
  // - retourne le username si l'accès est autorisé (utile pour l'affichage)
  guard(allowedRoles = []) {
    const user = this.getUser();
    const roles = Array.isArray(allowedRoles)
      ? allowedRoles
      : (allowedRoles ? [allowedRoles] : []);

    if (!user) {
      // On stocke uniquement le nom de fichier (ex: manager.html)
      sessionStorage.setItem("AFTER_LOGIN_TARGET", location.pathname.split("/").pop());
      location.href = getAppPath('login.html');
      return null;
    }

    // Le manager peut accéder à tout.
    const isAllowed = user.role === "manager" || roles.length === 0 || roles.includes(user.role);
    if (!isAllowed) {
      alert("Accès interdit");
      location.href = getAppPath('login.html');
      return null;
    }

    return user.username || user.name || null;
  },
};

window.Auth = Auth;
