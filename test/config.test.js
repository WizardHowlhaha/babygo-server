'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildConfig,
  validateConfig,
  DEFAULT_JWT_SECRET,
} = require('../src/config');

test('production rejects default or weak JWT secrets', () => {
  assert.throws(
    () => validateConfig(buildConfig({ NODE_ENV: 'production', JWT_SECRET: DEFAULT_JWT_SECRET })),
    /JWT_SECRET/
  );
  assert.throws(
    () => validateConfig(buildConfig({ NODE_ENV: 'production', JWT_SECRET: 'too-short' })),
    /JWT_SECRET/
  );
});

test('production rejects insecure development authentication', () => {
  assert.throws(
    () => validateConfig(buildConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(32),
      DATABASE_URL: 'postgres://production',
      ALLOW_INSECURE_DEV_AUTH: 'true',
    })),
    /ALLOW_INSECURE_DEV_AUTH/
  );
});

test('third-party capability is enabled only when all credentials exist', () => {
  const partial = buildConfig({
    NODE_ENV: 'test',
    SMS_PROVIDER: 'provider',
    SMS_ACCESS_KEY: 'access-key',
    OSS_PROVIDER: 's3',
    OSS_BUCKET: 'bucket',
  });
  assert.equal(partial.sms.configured, false);
  assert.equal(partial.oss.enabled, false);

  const complete = buildConfig({
    NODE_ENV: 'test',
    SMS_PROVIDER: 'provider',
    SMS_ACCESS_KEY: 'access-key',
    SMS_SECRET_KEY: 'secret-key',
    SMS_SIGN_NAME: 'BabyGo',
    SMS_TEMPLATE_CODE: 'template',
    OSS_PROVIDER: 's3',
    OSS_BUCKET: 'bucket',
    OSS_REGION: 'region',
    OSS_ACCESS_KEY: 'access-key',
    OSS_SECRET_KEY: 'secret-key',
    OSS_PUBLIC_BASE_URL: 'https://media.example.com',
  });
  assert.equal(complete.sms.configured, true);
  assert.equal(complete.oss.enabled, true);
});

test('production requires an explicit database URL', () => {
  assert.throws(
    () => validateConfig(buildConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(32),
    })),
    /DATABASE_URL/
  );
});
