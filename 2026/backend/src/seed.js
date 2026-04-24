require('dotenv').config();

const bcrypt = require('bcrypt');
const { initDb } = require('./db/init');
const { db, dbPath } = require('./db/conn');

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD || 'nova2026';

const users = [
  // managers
  { username: 'Laurent', role: 'manager' },
  { username: 'Cédric M', role: 'manager' },
  { username: 'Cédric A', role: 'manager' },
  { username: 'Vivien', role: 'manager' },

  // workers
  { username: 'Alexis', role: 'worker' },
  { username: 'Thomas', role: 'worker' },
  { username: 'Augustin', role: 'worker' },
  { username: 'Pierre', role: 'worker' },
  { username: 'Clément', role: 'worker' },

  // compta
  { username: 'Sophie', role: 'compta' },
  { username: 'Catherine', role: 'compta' },
  { username: 'Karine', role: 'compta' }
];

async function run() {
  initDb();
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 12);

  await new Promise((resolve) => {
    db.serialize(() => {
      const stmt = db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)');
      for (const u of users) {
        stmt.run([u.username, hash, u.role]);
      }
      stmt.finalize(() => resolve());
    });
  });

  console.log(`Seed done. DB: ${dbPath}`);
  console.log(`Default password for all seeded users: ${DEFAULT_PASSWORD}`);
  db.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
