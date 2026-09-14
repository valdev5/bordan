# Déploiement Render

Utilise ces réglages dans Render :

- Type : Web Service
- Root Directory : `2026/backend`
- Build Command : `npm install`
- Start Command : `npm start`

Le frontend est servi depuis `public/`.
L'API est disponible sur `/api`.

**Disque persistant obligatoire** : sans plan payant + disque persistant
Render (onglet "Disks", mount path `/var/data`), la base SQLite est
recree vide a chaque redeploiement/redemarrage. `DB_PATH` doit pointer
vers ce disque, jamais vers un chemin du depot Git.

Variables d'environnement recommandées sur Render :

```env
JWT_SECRET=remplace-moi-par-un-secret-long
DB_PATH=/var/data/database.sqlite
```

Ne mets pas `PORT` sur Render : Render le fournit automatiquement.
