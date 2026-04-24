# Déploiement Render

Utilise ces réglages dans Render :

- Type : Web Service
- Root Directory : `2026/backend`
- Build Command : `npm install`
- Start Command : `npm start`

Le frontend est servi depuis `public/`.
L'API est disponible sur `/api`.

Variables d'environnement recommandées sur Render :

```env
JWT_SECRET=remplace-moi-par-un-secret-long
DB_PATH=./db/database.sqlite
```

Ne mets pas `PORT` sur Render : Render le fournit automatiquement.
