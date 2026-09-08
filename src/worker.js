// Qxwk-Blog · Worker
// 一个 Worker 同时处理 /api/* 接口和静态资源（public/），绑定与 CityFootprint 相同的 D1
// 认证由通行证 account.qxwkstudio.top 统一管理（SSO），本站不再持有密码/会话
// 同源服务，无需 CORS
import { json, error, resolveViewer } from './lib.js';

// ---------- API 处理 ----------

// 当前请求用户：通行证验证后映射到本地用户，返回 {userId(未登录=0), isAdmin, nickname, color}
async function getViewer(DB, request) {
  const v = await resolveViewer(DB, request);
  return v
    ? { userId: v.id, isAdmin: v.isAdmin, nickname: v.nickname, color: v.color }
    : { userId: 0, isAdmin: false };
}

// 从正文提取话题（#话题#，尾 # 可省）与提及（@昵称），各去重并限制数量
function extractTopics(content) {
  const set = {};
  const re = /#([^#\s]{1,30})#?/g;
  let m;
  while ((m = re.exec(content))) {
    const t = m[1].trim();
    if (t && !set[t]) set[t] = true;
  }
  return Object.keys(set).slice(0, 10);
}
function extractMentions(content) {
  const set = {};
  const re = /@([\u4e00-\u9fa5A-Za-z0-9_\-]{1,20})/g;
  let m;
  while ((m = re.exec(content))) {
    if (!set[m[1]]) set[m[1]] = true;
  }
  return Object.keys(set).slice(0, 10);
}
function parseJsonArray(s) {
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

// MD5（经典实现，通行证同款，用于派生 WeAvatar 头像链接）
function md5(s) {
  function rotl(x, c) { return (x << c) | (x >>> (32 - c)); }
  const bytes = new TextEncoder().encode(s);
  const K = [0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
    0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
    0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
    0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
    0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
    0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
    0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
    0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391];
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
    4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const n = bytes.length;
  const x = new Array(16 + (((n + 8) >> 6) << 4)).fill(0);
  for (let i = 0; i < n; i++) x[i >> 2] = (x[i >> 2] | (bytes[i] << ((i % 4) * 8))) >>> 0;
  x[n >> 2] = (x[n >> 2] | (0x80 << ((n % 4) * 8))) >>> 0;
  x[(((n + 8) >> 6) << 4) + 14] = (n * 8) >>> 0;
  x[(((n + 8) >> 6) << 4) + 15] = Math.floor(n / 536870912) >>> 0;
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  for (let i = 0; i < x.length; i += 16) {
    const A0 = a, B0 = b, C0 = c, D0 = d;
    for (let j = 0; j < 64; j++) {
      let f, g;
      if (j < 16) { f = (b & c) | (~b & d); g = j; }
      else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16; }
      else if (j < 48) { f = b ^ c ^ d; g = (3 * j + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * j) % 16; }
      const tmp = d; d = c; c = b;
      b = (b + rotl((a + f + K[j] + x[i + g]) | 0, S[j])) | 0;
      a = tmp;
    }
    a = (a + A0) | 0; b = (b + B0) | 0; c = (c + C0) | 0; d = (d + D0) | 0;
  }
  function hex(w) {
    const h = '0123456789abcdef';
    let out = '';
    for (let k = 0; k < 4; k++) out += h.charAt((w >> (k * 8 + 4)) & 0xf) + h.charAt((w >> (k * 8)) & 0xf);
    return out;
  }
  return hex(a) + hex(b) + hex(c) + hex(d);
}

// 头像直接由邮箱派生：仅 QQ 邮箱返回 WeAvatar 链接，其余返回 null（前端回退首字头像）
function avatarFromEmail(email) {
  if (!email) return null;
  if (!/@qq\.com$/i.test(String(email).trim())) return null;
  return 'https://weavatar.com/avatar/' + md5(String(email).trim().toLowerCase()) + '?s=400&d=404';
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const DB = env.DB;

  // GET /api/me（登录：返回本地用户信息，token 经通行证验证）
  if (method === 'GET' && path === '/api/me') {
    const v = await resolveViewer(DB, request);
    if (!v) return error('未登录', 401);
    const u = await DB.prepare('SELECT created_at FROM users WHERE id = ?').bind(v.id).first();
    return json({ userId: v.id, nickname: v.nickname, color: v.color, is_admin: v.isAdmin, created_at: u && u.created_at, avatar: v.avatar });
  }

  // POST /api/submit（登录：提交未阔月刊投稿）
  if (method === 'POST' && path === '/api/submit') {
    const v = await resolveViewer(DB, request);
    if (!v) return error('未登录', 401);
    const body = await request.json().catch(() => ({}));
    const title = String(body.title || '').trim();
    const category = String(body.category || '').trim().slice(0, 30);
    const content = String(body.body || '').trim();
    const contact = String(body.contact || '').trim().slice(0, 100);
    if (!title || title.length > 60) return error('标题需为 1-60 个字符');
    if (!content) return error('正文不能为空');
    if (content.length > 20000) return error('正文过长（最多 20000 字）');
    const r = await DB.prepare(
      'INSERT INTO bg_submissions (user_id, title, category, body, contact) VALUES (?, ?, ?, ?, ?)'
    ).bind(v.id, title, category, content, contact || null).run();
    return json({ id: r.meta.last_row_id, status: 'pending' }, 201);
  }

  // GET /api/my-submissions（登录：自己的投稿及状态）
  if (method === 'GET' && path === '/api/my-submissions') {
    const v = await resolveViewer(DB, request);
    if (!v) return error('未登录', 401);
    const rows = await DB.prepare(
      'SELECT id, title, category, status, body, review_note, created_at, reviewed_at FROM bg_submissions WHERE user_id = ? ORDER BY id DESC'
    ).bind(v.id).all();
    return json({ submissions: rows.results });
  }

  // GET /api/submissions（管理员：投稿列表，不含正文；可按 status 过滤）
  if (method === 'GET' && path === '/api/submissions') {
    const v = await resolveViewer(DB, request);
    if (!v) return error('未登录', 401);
    if (!v.isAdmin) return error('无权访问', 403);
    const status = url.searchParams.get('status');
    const isKnown = status && ['pending', 'approved', 'rejected'].includes(status);
    const base =
      `SELECT s.id, s.title, s.category, s.status, s.contact, s.created_at, s.reviewed_at,
              s.reviewer_id, u.nickname, u.color
       FROM bg_submissions s JOIN users u ON s.user_id = u.id`;
    const rows = isKnown
      ? await DB.prepare(`${base} WHERE s.status = ? ORDER BY s.id DESC`).bind(status).all()
      : await DB.prepare(`${base} ORDER BY s.id DESC`).all();
    return json({ submissions: rows.results });
  }

  // GET /api/submission/:id（管理员：详情含正文与审稿意见）
  const subMatch = path.match(/^\/api\/submission\/(\d+)$/);
  if (method === 'GET' && subMatch) {
    const v = await resolveViewer(DB, request);
    if (!v) return error('未登录', 401);
    if (!v.isAdmin) return error('无权访问', 403);
    const s = await DB.prepare(
      'SELECT s.*, u.nickname, u.color FROM bg_submissions s JOIN users u ON s.user_id = u.id WHERE s.id = ?'
    ).bind(subMatch[1]).first();
    if (!s) return error('投稿不存在', 404);
    return json({ submission: s });
  }

  // PATCH /api/submission/:id（管理员：通过 / 驳回 / 改回待审）
  if (method === 'PATCH' && subMatch) {
    const v = await resolveViewer(DB, request);
    if (!v) return error('未登录', 401);
    if (!v.isAdmin) return error('无权访问', 403);
    const body = await request.json().catch(() => ({}));
    const status = String(body.status || '').trim();
    if (!['pending', 'approved', 'rejected'].includes(status)) return error('状态无效');
    const reviewNote = String(body.review_note || '').trim().slice(0, 1000);
    await DB.prepare(
      'UPDATE bg_submissions SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = datetime("now") WHERE id = ?'
    ).bind(status, v.id, reviewNote || null, subMatch[1]).run();
    return json({ ok: true, status, review_note: reviewNote });
  }

  // ---------- 博客（青翔博客动态） ----------

  // POST /api/blogs（登录：发布博客）
  if (method === 'POST' && path === '/api/blogs') {
    const v = await resolveViewer(DB, request);
    if (!v) return error('未登录', 401);
    const body = await request.json().catch(() => ({}));
    const content = String(body.content || '').trim();
    if (!content) return error('内容不能为空');
    if (content.length > 500) return error('内容过长（最多 500 字）');
    const topics = JSON.stringify(extractTopics(content));
    const mentions = JSON.stringify(extractMentions(content));
    const r = await DB.prepare(
      'INSERT INTO bg_blogs (user_id, content, topics, mentions) VALUES (?, ?, ?, ?)'
    ).bind(v.id, content, topics, mentions).run();
    return json({ id: r.meta.last_row_id }, 201);
  }

  // GET /api/blogs（公开：博客流，倒序游标分页；before 为上一页最小 id，limit 默认 20 最大 50；topic 话题过滤）
  if (method === 'GET' && path === '/api/blogs') {
    const before = Number(url.searchParams.get('before') || 0);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 20), 1), 50);
    const topic = String(url.searchParams.get('topic') || '').trim().slice(0, 30);
    const v = await getViewer(DB, request);
    const select =
      `SELECT b.id, b.user_id, b.content, b.topics, b.mentions, b.featured, b.likes_count, b.created_at, b.updated_at,
              u.nickname, u.color, u.email
       FROM bg_blogs b JOIN users u ON b.user_id = u.id
       WHERE b.is_deleted = 0` +
      (topic ? " AND EXISTS (SELECT 1 FROM json_each(b.topics) WHERE json_each.value = ?)" : '');
    const params = [];
    if (topic) params.push(topic);
    if (before > 0) params.push(before);
    params.push(limit);
    const sql = before > 0
      ? `${select} AND b.id < ? ORDER BY b.id DESC LIMIT ?`
      : `${select} ORDER BY b.id DESC LIMIT ?`;
    const rows = await DB.prepare(sql).bind(...params).all();
    const blogs = rows.results.map((r) => ({
      bid: r.id,
      uid: r.user_id,
      nickname: r.nickname,
      color: r.color,
      avatar: avatarFromEmail(r.email),
      content: r.content,
      topics: parseJsonArray(r.topics),
      mentions: parseJsonArray(r.mentions),
      featured: !!r.featured,
      likes_count: r.likes_count,
      created_at: r.created_at,
      updated_at: r.updated_at,
      is_owner: v.userId > 0 && r.user_id === v.userId,
    }));
    return json({ blogs });
  }

  const blogMatch = path.match(/^\/api\/blogs\/(\d+)$/);
  const likeMatch = path.match(/^\/api\/blogs\/(\d+)\/like$/);

  // GET /api/blogs/:id（公开：单篇详情，供分享深链定位）
  if (method === 'GET' && blogMatch) {
    const v = await getViewer(DB, request);
    const row = await DB.prepare(
      `SELECT b.id, b.user_id, b.content, b.topics, b.mentions, b.featured, b.likes_count, b.created_at, b.updated_at,
              u.nickname, u.color, u.email
       FROM bg_blogs b JOIN users u ON b.user_id = u.id
       WHERE b.id = ? AND b.is_deleted = 0`
    ).bind(Number(blogMatch[1])).first();
    if (!row) return error('博客不存在', 404);
    return json({
      blog: {
        bid: row.id, uid: row.user_id, nickname: row.nickname, color: row.color, avatar: avatarFromEmail(row.email),
        content: row.content, topics: parseJsonArray(row.topics), mentions: parseJsonArray(row.mentions),
        featured: !!row.featured, likes_count: row.likes_count, created_at: row.created_at,
        updated_at: row.updated_at, is_owner: v.userId > 0 && row.user_id === v.userId,
      },
    });
  }

  // GET /api/users/search?q=（公开：模糊查用户昵称，供 @ 提及输入提示）
  if (method === 'GET' && path === '/api/users/search') {
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 20);
    if (!q) return json({ users: [] });
    const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    const rows = await DB.prepare(
      "SELECT id, nickname, color FROM users WHERE nickname LIKE ? ESCAPE '\\' ORDER BY id ASC LIMIT 8"
    ).bind(like).all();
    return json({ users: rows.results });
  }

  // POST /api/blogs/:id/like（公开：点赞 +1；防重复由前端在刷新周期内置灰控制）
  if (method === 'POST' && likeMatch) {
    const r = await DB.prepare('UPDATE bg_blogs SET likes_count = likes_count + 1 WHERE id = ? AND is_deleted = 0')
      .bind(Number(likeMatch[1])).run();
    if (r.meta.changes === 0) return error('博客不存在', 404);
    const row = await DB.prepare('SELECT likes_count FROM bg_blogs WHERE id = ?').bind(Number(likeMatch[1])).first();
    return json({ ok: true, likes_count: row ? row.likes_count : 0 });
  }

  // PATCH /api/blogs/:id（登录：修改自己的博客）
  if (method === 'PATCH' && blogMatch) {
    const v = await resolveViewer(DB, request);
    if (!v) return error('未登录', 401);
    const id = Number(blogMatch[1]);
    const row = await DB.prepare('SELECT user_id FROM bg_blogs WHERE id = ? AND is_deleted = 0').bind(id).first();
    if (!row) return error('博客不存在', 404);
    if (row.user_id !== v.id) return error('无权修改', 403);
    const body = await request.json().catch(() => ({}));
    const content = String(body.content || '').trim();
    if (!content) return error('内容不能为空');
    if (content.length > 500) return error('内容过长（最多 500 字）');
    const topics = JSON.stringify(extractTopics(content));
    const mentions = JSON.stringify(extractMentions(content));
    await DB.prepare(
      'UPDATE bg_blogs SET content = ?, topics = ?, mentions = ?, updated_at = datetime("now") WHERE id = ?'
    ).bind(content, topics, mentions, id).run();
    return json({ ok: true });
  }

  // DELETE /api/blogs/:id（登录：软删除自己的博客）
  if (method === 'DELETE' && blogMatch) {
    const v = await resolveViewer(DB, request);
    if (!v) return error('未登录', 401);
    const id = Number(blogMatch[1]);
    const row = await DB.prepare('SELECT user_id FROM bg_blogs WHERE id = ? AND is_deleted = 0').bind(id).first();
    if (!row) return error('博客不存在', 404);
    if (row.user_id !== v.id) return error('无权删除', 403);
    await DB.prepare('UPDATE bg_blogs SET is_deleted = 1, updated_at = datetime("now") WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return null; // 不是已知 API 路由
}

// ---------- 入口 ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API 路由
    if (url.pathname.startsWith('/api/')) {
      try {
        const result = await handleApi(request, env);
        return result || json({ error: '接口不存在' }, 404);
      } catch (e) {
        return json({ error: '服务器错误: ' + (e && e.message ? e.message : String(e)) }, 500);
      }
    }

    // 无扩展名的路径 302 跳转到 .html（如 /monthly/account -> /monthly/account.html）
    if (url.pathname !== '/' && !/\.[^/]+$/.test(url.pathname)) {
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = redirectUrl.pathname.replace(/\/$/, '') + '.html';
      return Response.redirect(redirectUrl.toString(), 302);
    }

    // 其余：静态资源（public/）
    return env.ASSETS.fetch(request);
  },
};
