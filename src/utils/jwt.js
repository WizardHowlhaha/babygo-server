'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');

function signToken(userId, tokenVersion = 0) {
  return jwt.sign(
    { uid: String(userId), ver: Number(tokenVersion) },
    config.jwt.secret,
    {
      expiresIn: config.jwt.expiresIn,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      subject: String(userId),
    }
  );
}

function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret, {
    algorithms: ['HS256'],
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

module.exports = { signToken, verifyToken };
