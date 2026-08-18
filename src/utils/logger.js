'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: Number.POSITIVE_INFINITY };
const configuredLevel = LEVELS[config.log.level] ?? LEVELS.info;
let fileStream = null;

if (config.log.file) {
  const logPath = path.resolve(config.log.file);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fileStream = fs.createWriteStream(logPath, { flags: 'a' });
  fileStream.on('error', (error) => {
    process.stderr.write(`${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'log.file.failed',
      message: error.message,
    })}\n`);
  });
}

function serializeError(error) {
  if (!(error instanceof Error)) return undefined;
  const value = { name: error.name, message: error.message };
  if (config.env !== 'production' && error.stack) value.stack = error.stack;
  return value;
}

function write(level, event, fields = {}) {
  if ((LEVELS[level] ?? LEVELS.info) < configuredLevel) return;

  const record = {
    timestamp: new Date().toISOString(),
    level,
    service: 'babygo-server',
    environment: config.env,
    event,
    ...fields,
  };
  if (record.error instanceof Error) record.error = serializeError(record.error);

  const line = `${JSON.stringify(record)}\n`;
  const output = level === 'error' ? process.stderr : process.stdout;
  output.write(line);
  if (fileStream) fileStream.write(line);
}

async function close() {
  if (!fileStream) return;
  const stream = fileStream;
  fileStream = null;
  await new Promise((resolve) => stream.end(resolve));
}

module.exports = {
  debug: (event, fields) => write('debug', event, fields),
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
  close,
};
