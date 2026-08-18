'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/index');
const { closePool } = require('../src/db');

let server;
let baseUrl;

test.before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closePool();
});

test('malformed JSON returns a structured 400 response', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"phone":',
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_JSON');
  assert.ok(response.headers.get('x-request-id'));
});

test('array request bodies are rejected before route handling', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '[]',
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_BODY');
});

test('unknown routes use the common response contract', async () => {
  const response = await fetch(`${baseUrl}/does-not-exist`, {
    headers: { 'x-request-id': 'boundary-test' },
  });
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.equal(body.requestId, 'boundary-test');
  assert.equal(response.headers.get('x-request-id'), 'boundary-test');
});
