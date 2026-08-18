'use strict';
const { Pool } = require('pg');
const config = require('./config');
const logger = require('./utils/logger');

// 全局连接池: 整个进程共享, 自动复用连接
const pool = new Pool({ connectionString: config.databaseUrl });

pool.on('error', (err) => {
  logger.error('db.pool.error', { error: err });
});

// 简单查询封装
async function query(text, params) {
  return pool.query(text, params);
}

// 事务封装: 传入一个 async(client)=>{} 回调, 自动 BEGIN/COMMIT/ROLLBACK
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function closePool() {
  await pool.end();
}

module.exports = { pool, query, withTransaction, closePool };
