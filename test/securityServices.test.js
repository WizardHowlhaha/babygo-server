'use strict';
process.env.ALLOW_INSECURE_DEV_AUTH = 'true';
process.env.LOG_LEVEL = 'silent';
process.env.LOG_FILE = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const sms = require('../src/services/smsService');
const media = require('../src/services/mediaService');
const { signToken, verifyToken } = require('../src/utils/jwt');

test('JWT binds subject, issuer, audience, and token version', () => {
  const token = signToken('123', 7);
  const payload = verifyToken(token);
  assert.equal(payload.uid, '123');
  assert.equal(payload.sub, '123');
  assert.equal(payload.ver, 7);
  assert.equal(payload.iss, 'babygo-server');
  assert.deepEqual(payload.aud, 'babygo-app');
});

test('development SMS codes are purpose-scoped and one-time', async () => {
  const phone = '13800138000';
  const result = await sms.sendCode(phone, 'register');
  assert.equal(result.devCode, '123456');
  assert.equal(sms.verifyCode(phone, result.devCode, 'login'), false);
  assert.equal(sms.verifyCode(phone, result.devCode, 'register'), true);
  assert.equal(sms.verifyCode(phone, result.devCode, 'register'), false);
});

test('unconfigured media service never returns a fake upload URL', async () => {
  const token = await media.createUploadToken('123', 'image');
  assert.equal(token.configured, false);
  assert.equal(token.uploadUrl, null);
  assert.equal(token.publicUrl, null);
});
