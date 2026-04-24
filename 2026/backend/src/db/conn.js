const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../db/database.sqlite');
const db = new sqlite3.Database(dbPath);

module.exports = { db, dbPath };
