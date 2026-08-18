'use strict';
const config = require('../config');

// ============================================================
// 微信登录服务 —— 预留接口 (桩实现)
// 现状: 尚未申请微信开放平台应用, config.wechat.enabled === false
// 接入后: exchangeCode 内用 code + appid + appsecret 调
//   https://api.weixin.qq.com/sns/oauth2/access_token 换取 openid/unionid,
//   再调 sns/userinfo 拿昵称头像
// ============================================================

async function exchangeCode(code) {
  if (!config.wechat.enabled) {
    const err = new Error('微信登录尚未配置，请使用手机号或账号密码登录');
    err.code = 'WECHAT_NOT_CONFIGURED';
    err.status = 501;
    throw err;
  }
  const err = new Error('微信配置已填写，但 OAuth 适配器尚未实现');
  err.code = 'WECHAT_PROVIDER_NOT_IMPLEMENTED';
  err.status = 501;
  throw err;
}

module.exports = { exchangeCode, configured: () => config.wechat.enabled, available: () => false };
