'use strict';
const fs = require('fs/promises');
const path = require('path');
const { pool, withTransaction, closePool } = require('../db');
const logger = require('../utils/logger');

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function runMigrations() {
  const migrationsDir = path.resolve(__dirname, '../../db/migrations');
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('babygo-schema-migrations', 0))");
    await ensureMigrationTable(client);
    for (const file of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE version = $1',
        [file]
      );
      if (rows[0]) continue;
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [file]
      );
      logger.info('db.migration.applied', { version: file });
    }
  });
}

if (require.main === module) {
  runMigrations()
    .then(async () => {
      await closePool();
      logger.info('db.migrations.completed');
    })
    .catch(async (error) => {
      logger.error('db.migrations.failed', { error });
      try { await pool.end(); } catch (closeError) { /* process is already failing */ }
      process.exitCode = 1;
    });
}

module.exports = { runMigrations };
