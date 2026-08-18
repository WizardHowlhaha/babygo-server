'use strict';
const express = require('express');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const mediaService = require('../services/mediaService');

const router = express.Router();

// 申请上传凭证: POST /media/upload-token  body { fileType: "image" | "video" }
// 生产环境返回对象存储直传签名; 未配置时返回占位凭证(configured:false)
router.post('/upload-token', requireAuth, asyncHandler(async (req, res) => {
  const fileType = req.body.fileType === 'video' ? 'video' : 'image';
  let token;
  try {
    token = await mediaService.createUploadToken(req.userId, fileType);
  } catch (error) {
    if (error?.code === 'OSS_PROVIDER_NOT_IMPLEMENTED') {
      throw new ApiError(error.status || 501, error.message, error.code);
    }
    throw error;
  }
  res.json({ ok: true, data: token });
}));

module.exports = router;
