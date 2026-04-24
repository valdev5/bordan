# Bnova — Auth + Base de données (SQLite)

Ce package est une évolution de ton projet :
- Authentification **utilisateur + mot de passe**
- Rôles **manager / worker / compta**
- Base de données **SQLite** + table de **traces (audit_log)**
- Exemple de "fiches" persistées : **bons** (API `/api/bons`)

> Le reste de ton application front (devis, messagerie, etc.) reste pour l’instant en **localStorage** : on pourra migrer chaque module vers l’API au fur et à mesure.

## Pré-requis
- Node.js 18+ (ou 20+)
- (Optionnel) Python 3 ou VSCode Live Server pour servir le front

## 1) Lancer le backend

```bash
cd backend
cp .env.example .env
npm install
npm run seed
npm run dev
```

- API : `http://localhost:3001/api/health`
- Mot de passe par défaut (seed) : `nova2026`

## 2) Lancer le frontend

Depuis le dossier `frontend` :

### Option A — Python
```bash
cd ../frontend
python -m http.server 8000
```
Puis ouvre : `http://localhost:8000/login.html`

### Option B — VS Code
Utilise l’extension **Live Server** et ouvre `login.html`.

## Utilisateurs (seed)
Les mêmes noms que dans ton ancien select :
- Managers : Laurent, Cédric M, Cédric A, Vivien
- Workers : Alexis, Thomas, Augustin, Pierre, Clément
- Compta : Sophie, Catherine, Karine

## Notes
- En dev, le token JWT est stocké en `localStorage`.
- La route `/api/audit` est accessible **manager uniquement**.

## Étape suivante (si tu veux)
On migre ensuite tes entités existantes vers la BD :
1. Bons (déjà prêt)
2. Devis
3. Feuilles d’heures
4. Messagerie (par chantier)


## Correctifs inclus
- Suppression du `node_modules` du zip pour éviter les erreurs de binaires natifs selon l'OS.
- Redirections frontend corrigées pour fonctionner aussi bien avec `python -m http.server` que Live Server.
- Port backend configurable via `PORT`.
- Route `/api/audit` activée.
