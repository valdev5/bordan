const fs = require('fs');
const path = require('path');

const { db, dbPath } = require('./db/conn');
const { loadStateValue } = require('./routes/helpers');

const BACKUP_DIR = path.join(path.dirname(dbPath), 'backups');
const RETENTION_DAYS = 14;

// Instantane quotidien de devis + bons sur disque (independant de la
// synchro partagee), pour pouvoir revenir a un jour precis en cas de gros
// probleme. Purge aussi les vieilles entrees de la corbeille au passage.
async function runBackup() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const [devis, bons] = await Promise.all([
      loadStateValue('devis'),
      loadStateValue('bons'),
    ]);

    const stamp = new Date().toISOString().slice(0, 10);
    const file = path.join(BACKUP_DIR, `backup-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify({ devis, bons, createdAt: new Date().toISOString() }));

    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(BACKUP_DIR)) {
      const full = path.join(BACKUP_DIR, name);
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
      }
    }

    db.run("DELETE FROM trash WHERE deleted_at < datetime('now', ?)", [`-${RETENTION_DAYS} days`]);

    console.log(`Sauvegarde quotidienne ecrite : ${file}`);
  } catch (error) {
    console.warn('Echec de la sauvegarde quotidienne', error);
  }
}

function startDailyBackup() {
  runBackup();
  setInterval(runBackup, 24 * 60 * 60 * 1000);
}

module.exports = { startDailyBackup, runBackup, BACKUP_DIR };
