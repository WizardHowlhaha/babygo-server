'use strict';
const config = require('../config');
const crypto = require('crypto');

// ============================================================
// 媒体上传服务 —— 预留接口 (桩实现)
// 生产: 返回对象存储(OSS/COS/S3)的临时上传凭证, 客户端直传, 不经过本服务器
// 现状: 未申请对象存储, 返回占位凭证 + 说明, 便于前端先跑通交互
// ============================================================

async function createUploadToken(userId, fileType) {
  const key = `uploads/${userId}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  if (config.oss.enabled) {
    const err = new Error('对象存储配置已填写，但签名适配器尚未实现');
    err.code = 'OSS_PROVIDER_NOT_IMPLEMENTED';
    err.status = 501;
    throw err;
  }
  return {
    configured: false,
    message: '对象存储尚未配置，当前不能上传媒体文件。',
    objectKey: key,
    uploadUrl: null,
    publicUrl: null,
    fileType,
  };
}

module.exports = { createUploadToken, available: () => false };
