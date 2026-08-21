'use strict';
// 端到端冒烟测试: 需先启动数据库(npm run db:up)和服务(npm start),再运行 npm run smoke
// 覆盖: 健康检查 / 密码注册登录 / 发动态 / 动态流 / 点赞 / 评论 / 发活动 / 附近发现 / SMS桩 / 微信桩
const BASE = process.env.SMOKE_BASE || 'http://localhost:3000';
const rnd = Math.floor(Math.random() * 1e6);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' -> ' + JSON.stringify(extra) : ''}`); }
}
async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* ignore */ }
  return { status: res.status, json };
}

(async () => {
  console.log(`\n== BabyGo 后端冒烟测试 @ ${BASE} ==\n`);

  // 健康检查
  const health = await api('GET', '/health');
  ok('GET /health 200', health.status === 200, health.json);
  ok('health.db == up (数据库已连接)', health.json && health.json.db === 'up', health.json);
  console.log(`  features: ${JSON.stringify(health.json && health.json.features)}`);

  // 密码注册
  const phoneA = `139${String(rnd).padStart(8, '0')}`.slice(0, 11);
  const codeA = await api('POST', '/api/auth/sms/send', { phone: phoneA, purpose: 'register' });
  const reg = await api('POST', '/api/auth/register', {
    nickname: `测试宝妈${rnd}`,
    password: 'Babygo123',
    phone: phoneA,
    code: codeA.json && codeA.json.data && codeA.json.data.devCode,
  });
  ok('POST /api/auth/register 成功', reg.status === 201 && reg.json.ok, reg.json);
  const tokenA = reg.json && reg.json.data && reg.json.data.token;
  const userA = reg.json && reg.json.data && reg.json.data.user;
  ok('注册返回 token 且不含 password_hash', Boolean(tokenA) && userA && !('password_hash' in userA), userA);

  // 登录
  const login = await api('POST', '/api/auth/login', { phone: phoneA, password: 'Babygo123' });
  ok('POST /api/auth/login 成功', login.status === 200 && login.json.ok, login.json);

  // GET /me
  const me = await api('GET', '/api/auth/me', null, tokenA);
  ok('GET /api/auth/me 需鉴权且返回本人', me.status === 200 && me.json.ok, me.json);
  ok('未带 token 访问 /me 返回 401', (await api('GET', '/api/auth/me')).status === 401);

  // 第二个用户(用于点赞/评论/好友)
  const phoneB = `138${String((rnd + 1) % 1e8).padStart(8, '0')}`.slice(0, 11);
  const codeB = await api('POST', '/api/auth/sms/send', { phone: phoneB, purpose: 'register' });
  const regB = await api('POST', '/api/auth/register', {
    nickname: `测试奶爸${rnd}`,
    password: 'Babygo123',
    phone: phoneB,
    code: codeB.json && codeB.json.data && codeB.json.data.devCode,
  });
  const tokenB = regB.json && regB.json.data && regB.json.data.token;
  const userB = regB.json && regB.json.data && regB.json.data.user;

  // 发动态
  const post = await api('POST', '/api/posts', { content: '今天带娃去公园玩沙子啦', media: [] }, tokenA);
  ok('POST /api/posts 发布动态', post.status === 200 && post.json.ok, post.json);
  const postId = post.json && post.json.data && post.json.data.id;

  // 内容安全拦截(含手机号应被拒)
  const badPost = await api('POST', '/api/posts', { content: '加我微信 13812345678', media: [] }, tokenA);
  ok('含联系方式的动态被拦截(400)', badPost.status === 400, badPost.json);

  // 动态流
  const feed = await api('GET', '/api/posts/feed?limit=20', null, tokenB);
  ok('GET /api/posts/feed 能看到他人动态', feed.status === 200 && feed.json.data.items.some((p) => p.id === postId), feed.json && feed.json.data && feed.json.data.items.length);
  const myPosts = await api('GET', '/api/posts/mine?limit=20', null, tokenA);
  ok(
    'GET /api/posts/mine 只返回当前账号动态',
    myPosts.status === 200 &&
      myPosts.json.data.items.some((p) => p.id === postId) &&
      myPosts.json.data.items.every((p) => p.author.id === userA.id),
    myPosts.json
  );

  // 点赞
  const like = await api('POST', `/api/posts/${postId}/like`, { like: true }, tokenB);
  ok('POST 点赞成功且 likeCount=1', like.status === 200 && like.json.data.likeCount === 1, like.json);
  const like2 = await api('POST', `/api/posts/${postId}/like`, { like: true }, tokenB);
  ok('重复点赞幂等(仍为1)', like2.json && like2.json.data.likeCount === 1, like2.json);

  // 评论
  const comment = await api('POST', `/api/posts/${postId}/comments`, { content: '好可爱呀' }, tokenB);
  ok('POST 评论成功', comment.status === 200 && comment.json.ok, comment.json);
  const comments = await api('GET', `/api/posts/${postId}/comments`, null, tokenA);
  ok('GET 评论列表含刚发的评论', comments.json && comments.json.data.items.length >= 1, comments.json);

  // 发活动(带定位)
  const startsAt = new Date(Date.now() + 3600 * 1000).toISOString();
  const plan = await api('POST', '/api/plans', {
    title: '萌宠互动', activityKind: 'pet', summary: '带宝宝和温顺小狗互动', startsAt,
    durationMinutes: 90, participantLimit: null,
    approximatePlace: '朝阳公园附近', privateMeetingPoint: '南门肯德基门口',
    sharedToys: ['篮球', '泡泡机'], sharedPets: ['狗'],
    latitude: 39.9388, longitude: 116.4774, visibility: 0,
  }, tokenA);
  ok('POST /api/plans 发布活动', plan.status === 200 && plan.json.ok, plan.json);
  const planId = plan.json && plan.json.data && plan.json.data.id;
  ok('活动主可见私密集合点', plan.json && plan.json.data && plan.json.data.privateMeetingPoint === '南门肯德基门口');
  ok('活动支持不限人数', plan.json && plan.json.data && plan.json.data.participantLimit === null);
  ok(
    '活动保留类型与共享清单',
    plan.json && plan.json.data
      && plan.json.data.activityKind === 'pet'
      && plan.json.data.sharedToys.includes('篮球')
      && plan.json.data.sharedPets.includes('狗'),
    plan.json && plan.json.data
  );

  // 附近发现(B 用户在附近)
  const nearby = await api('GET', '/api/plans/nearby?lat=39.9390&lng=116.4770&radius=5000', null, tokenB);
  const found = nearby.json && nearby.json.data.items.find((p) => p.id === planId);
  ok('GET /api/plans/nearby 能发现附近活动', Boolean(found), nearby.json && nearby.json.data && nearby.json.data.items.length);
  ok('非成员看不到私密集合点(null)', found && found.privateMeetingPoint === null, found);
  ok('附近活动带 distanceMeters', found && typeof found.distanceMeters === 'number', found);

  // 申请加入
  const apply = await api('POST', `/api/plans/${planId}/apply`, {}, tokenB);
  ok('POST 申请加入活动(status=1)', apply.status === 200 && apply.json.data.memberStatus === 1, apply.json);

  // 活动主审核通过
  const review = await api('POST', `/api/plans/${planId}/review`, { userId: userB.id, approve: true }, tokenA);
  ok('POST 活动主审核通过', review.status === 200 && review.json.ok, review.json);

  // 通过后 B 应能看到私密集合点
  const detail = await api('GET', `/api/plans/${planId}`, null, tokenB);
  ok('成员通过后可见私密集合点', detail.json && detail.json.data.plan.privateMeetingPoint === '南门肯德基门口', detail.json && detail.json.data && detail.json.data.plan);

  // 好友请求
  const fr = await api('POST', '/api/friends/requests', { userId: userB.id }, tokenA);
  ok('POST 发送好友请求', fr.status === 200 && fr.json.ok, fr.json);
  const reqList = await api('GET', '/api/friends/requests', null, tokenB);
  const reqId = reqList.json && reqList.json.data.items[0] && reqList.json.data.items[0].requestId;
  ok('B 收到好友请求', Boolean(reqId), reqList.json);
  const resp = await api('POST', `/api/friends/requests/${reqId}/respond`, { accept: true }, tokenB);
  ok('B 同意好友请求', resp.status === 200 && resp.json.ok, resp.json);
  const friends = await api('GET', '/api/friends', null, tokenA);
  ok('A 的好友列表含 B', friends.json && friends.json.data.items.some((u) => u.id === userB.id), friends.json);

  // 动态可见性矩阵
  const onlyMePost = await api('POST', '/api/posts', {
    content: '这是一条仅自己可见的动态',
    media: [],
    visibility: 2,
    visibleUserIds: [],
  }, tokenA);
  const onlyMePostId = onlyMePost.json && onlyMePost.json.data && onlyMePost.json.data.id;
  ok('POST 发布仅自己可见动态', onlyMePost.status === 200 && onlyMePost.json.data.visibility === 2, onlyMePost.json);
  const feedAfterOnlyMe = await api('GET', '/api/posts/feed?limit=50', null, tokenB);
  ok(
    '仅自己可见动态不出现在好友动态流',
    !feedAfterOnlyMe.json.data.items.some((item) => item.id === onlyMePostId),
    feedAfterOnlyMe.json
  );
  const forbiddenOnlyMeLike = await api('POST', `/api/posts/${onlyMePostId}/like`, { like: true }, tokenB);
  ok('好友不能点赞仅自己可见动态', forbiddenOnlyMeLike.status === 403, forbiddenOnlyMeLike.json);

  // 隐私设置: 隐藏宝宝年龄、关闭附近发现、拒绝陌生人好友申请
  const baby = await api('POST', '/api/babies', {
    nickname: '小测试',
    birthday: '2024-01-01',
    gender: 2,
    interests: ['绘本'],
  }, tokenA);
  ok('POST 创建宝宝资料', baby.status === 200 && baby.json.ok, baby.json);
  const privacy = await api('PATCH', '/api/auth/privacy', {
    showBabyAge: false,
    allowNearbyDiscovery: false,
    allowFriendRequests: false,
  }, tokenA);
  ok(
    'PATCH 隐私设置保存成功',
    privacy.status === 200 &&
      privacy.json.data.privacy.showBabyAge === false &&
      privacy.json.data.privacy.allowNearbyDiscovery === false &&
      privacy.json.data.privacy.allowFriendRequests === false,
    privacy.json
  );
  const disabledNearby = await api(
    'GET',
    '/api/plans/nearby?lat=39.9390&lng=116.4770&radius=5000',
    null,
    tokenA
  );
  ok('关闭附近发现后服务端拒绝附近查询', disabledNearby.status === 403, disabledNearby.json);
  const hiddenBaby = await api('GET', `/api/babies?userId=${userA.id}`, null, tokenB);
  ok(
    '好友查看宝宝资料时年龄已隐藏',
    hiddenBaby.status === 200 &&
      hiddenBaby.json.data.items.some((item) => item.id === baby.json.data.id && item.birthday === null),
    hiddenBaby.json
  );

  const phoneC = `136${String((rnd + 3) % 1e8).padStart(8, '0')}`.slice(0, 11);
  const codeC = await api('POST', '/api/auth/sms/send', { phone: phoneC, purpose: 'register' });
  const regC = await api('POST', '/api/auth/register', {
    nickname: `测试用户${rnd}`,
    password: 'Babygo123',
    phone: phoneC,
    code: codeC.json && codeC.json.data && codeC.json.data.devCode,
  });
  const tokenC = regC.json && regC.json.data && regC.json.data.token;
  const userC = regC.json && regC.json.data && regC.json.data.user;

  const selectedPost = await api('POST', '/api/posts', {
    content: '这是一条指定好友可见的动态',
    media: [],
    visibility: 3,
    visibleUserIds: [userB.id],
  }, tokenA);
  const selectedPostId = selectedPost.json && selectedPost.json.data && selectedPost.json.data.id;
  ok(
    'POST 发布指定好友可见动态',
    selectedPost.status === 200 &&
      selectedPost.json.data.visibility === 3 &&
      selectedPost.json.data.visibleUserIds.includes(userB.id),
    selectedPost.json
  );
  const selectedFeedB = await api('GET', '/api/posts/feed?limit=50', null, tokenB);
  ok(
    '被指定好友可以看到动态',
    selectedFeedB.json.data.items.some((item) => item.id === selectedPostId),
    selectedFeedB.json
  );
  const selectedFeedC = await api('GET', '/api/posts/feed?limit=50', null, tokenC);
  ok(
    '未指定用户看不到动态',
    !selectedFeedC.json.data.items.some((item) => item.id === selectedPostId),
    selectedFeedC.json
  );
  const forbiddenSelectedComment = await api(
    'POST',
    `/api/posts/${selectedPostId}/comments`,
    { content: '不应成功' },
    tokenC
  );
  ok('未指定用户不能评论动态', forbiddenSelectedComment.status === 403, forbiddenSelectedComment.json);

  const changeAudience = await api('PATCH', `/api/posts/${selectedPostId}/visibility`, {
    visibility: 2,
    visibleUserIds: [],
  }, tokenA);
  ok(
    'PATCH 动态可见范围修改为仅自己',
    changeAudience.status === 200 && changeAudience.json.data.visibility === 2,
    changeAudience.json
  );
  const selectedFeedBAfterChange = await api('GET', '/api/posts/feed?limit=50', null, tokenB);
  ok(
    '权限修改后原指定好友立即不可见',
    !selectedFeedBAfterChange.json.data.items.some((item) => item.id === selectedPostId),
    selectedFeedBAfterChange.json
  );

  const deleteSelectedPost = await api('DELETE', `/api/posts/${selectedPostId}`, null, tokenA);
  ok('DELETE 删除自己的动态', deleteSelectedPost.status === 200 && deleteSelectedPost.json.ok, deleteSelectedPost.json);
  const myPostsAfterDelete = await api('GET', '/api/posts/mine?limit=50', null, tokenA);
  ok(
    '删除后动态不再出现在我的动态',
    !myPostsAfterDelete.json.data.items.some((item) => item.id === selectedPostId),
    myPostsAfterDelete.json
  );

  const blockedRequest = await api('POST', '/api/friends/requests', { userId: userA.id }, tokenC);
  ok('关闭陌生人申请后服务端拒绝请求', blockedRequest.status === 403, blockedRequest.json);

  // SMS 桩
  const smsPhone = `137${String((rnd + 2) % 1e8).padStart(8, '0')}`.slice(0, 11);
  const sms = await api('POST', '/api/auth/sms/send', { phone: smsPhone, purpose: 'login' });
  ok('POST /api/auth/sms/send 桩返回(含 devCode)', sms.status === 200 && sms.json.ok, sms.json);
  ok('SMS 桩返回固定验证码 123456', sms.json && sms.json.data && sms.json.data.devCode === '123456', sms.json && sms.json.data);

  // 微信桩(未配置应 501)
  const wx = await api('POST', '/api/auth/wechat', { code: 'fake_code' });
  ok('POST /api/auth/wechat 未配置返回 501', wx.status === 501, wx.json);

  // 媒体上传凭证桩
  const upl = await api('POST', '/api/media/upload-token', { fileType: 'image' }, tokenA);
  ok('POST /api/media/upload-token 桩返回(configured:false)', upl.status === 200 && upl.json.data.configured === false, upl.json);

  console.log(`\n== 结果: ${pass} 通过, ${fail} 失败 ==\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('SMOKE ERROR:', e); process.exit(1); });
