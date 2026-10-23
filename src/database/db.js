const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { DB_PATH } = require('../config/env');
const logger = require('../utils/logger');

// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Open SQLite connection
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    logger.error('Failed to open SQLite database', err.message);
  } else {
    logger.success(`SQLite database connected at ${DB_PATH}`);
  }
});

// Configure SQLite PRAGMAs for concurrency and data integrity
db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON;');
  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA synchronous = NORMAL;');
  db.run('PRAGMA cache_size = -64000;');
});

/**
 * Promisified database helpers
 */
const dbHelpers = {
  db,

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  },

  exec(sql) {
    return new Promise((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },

  async initSchema() {
    try {
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await dbHelpers.exec(schemaSql);
      logger.success('Database schema initialized successfully with WAL mode & foreign keys enabled.');
    } catch (error) {
      logger.error('Failed to initialize database schema', error.message);
      throw error;
    }
  }
};

module.exports = dbHelpers;
