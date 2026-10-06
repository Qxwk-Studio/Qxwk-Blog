// Qxwk-Blog · Worker
// 站点 = 静态资源（未阔月刊，public/）+ 投稿接口
// 月刊内容由 public/issues.json / series.json 驱动，文章正文与封面取自 public/magazine/
//
// 接口（详见 README「投稿流程」）：
//   POST   /api/submit                 公开    提交投稿
//   GET    /api/submissions?status=    需口令  列表（不含正文）
//   GET    /api/submission/<id>        需口令  详情（含正文）
//   PATCH  /api/submission/<id>        需口令  改状态 / 写审稿意见
// 口令：Authorization: Bearer <ADMIN_TOKEN>，密钥由 `wrangler secret put ADMIN_TOKEN` 配置
// 其余路径一律交给静态资源，保证 GitHub Pages 那套相对路径部署照旧可用

const LIMITS = {
  title: 100, author: 40, contact: 120, category: 40,
  bodyMin: 10, bodyMax: 100000, note: 500,
};
const STATUSES = ['pending', 'approved', 'rejected'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/submit' && request.method === 'POST') {
        return await handleSubmit(request, env);
      }
      if (path === '/api/submissions' && request.method === 'GET') {
        return await handleList(request, env, url);
      }
      const m = path.match(/^\/api\/submission\/(\d+)$/);
      if (m) {
        if (request.method === 'GET') return await handleGet(request, env, m[1]);
        if (request.method === 'PATCH') return await handlePatch(request, env, m[1]);
      }
      if (path.indexOf('/api/') === 0) return json({ error: 'not found' }, 404);
    } catch (e) {
      // 不把异常细节返回给调用方，只进日志（与站内其它服务保持一致）
      console.error('[qxwk-blog] api error', (e && e.stack) || e);
      return json({ error: 'server error' }, 500);
    }

    return env.ASSETS.fetch(request);
  },
};

// ===== 工具 =====

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}),
  });
}

// 统一转成去首尾空白的字符串；非字符串（数字/布尔/对象）会被 String() 化后再校验长度
function str(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

// created_at / reviewed_at 存 UTC 的 'YYYY-MM-DD HH:MM:SS'，与审核页 fmtTime（补 Z 解析）对齐
function nowStamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// 仅取 CF-Connecting-IP（不信 X-Forwarded-For，可被伪造）
function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || '';
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

// 定长比较，避免口令按字符逐位试探
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authed(request, env) {
  const expect = env.ADMIN_TOKEN || '';
  // 未配置口令时一律拒绝：否则空口令会变成「谁都能进」的后门
  if (!expect) return false;
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  return !!m && safeEqual(m[1].trim(), expect);
}

// 固定窗口限流：返回需等待的秒数，0 表示未超限
// 计数用 INSERT ... ON CONFLICT 原子自增，窗口过期则重置；避免「读-改-写」竞态
async function bumpLimit(env, key, windowSec, limit, now) {
  const row = await env.DB.prepare(
    `INSERT INTO mg_rate_limit (key, count, expires_at) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN mg_rate_limit.expires_at <= ?3 THEN 1 ELSE mg_rate_limit.count + 1 END,
       expires_at = CASE WHEN mg_rate_limit.expires_at <= ?3 THEN ?2 ELSE mg_rate_limit.expires_at END
     RETURNING count, expires_at`
  ).bind(key, now + windowSec, now).first();
  if (row && row.count > limit) return Math.max(1, row.expires_at - now);
  return 0;
}

// ===== 接口实现 =====

async function handleSubmit(request, env) {
  let data;
  try { data = await request.json(); } catch (e) { return json({ error: '请求格式错误' }, 400); }
  if (!data || typeof data !== 'object') return json({ error: '请求格式错误' }, 400);

  const title = str(data.title);
  const author = str(data.author);
  const contact = str(data.contact);
  const category = str(data.category);
  const body = str(data.body);

  if (!title || title.length > LIMITS.title) return json({ error: '标题需为 1-100 个字符' }, 400);
  if (!author || author.length > LIMITS.author) return json({ error: '作者名需为 1-40 个字符' }, 400);
  if (contact.length > LIMITS.contact) return json({ error: '联系方式最多 120 个字符' }, 400);
  if (category.length > LIMITS.category) return json({ error: '栏目/系列最多 40 个字符' }, 400);
  if (body.length < LIMITS.bodyMin) return json({ error: '正文至少需要 10 个字符' }, 400);
  if (body.length > LIMITS.bodyMax) return json({ error: '正文过长（最多 100000 个字符）' }, 400);

  const ipHash = await sha256hex(clientIp(request) || 'unknown');
  const now = Math.floor(Date.now() / 1000);

  // 限流放在写库前，且失败也会计数，避免靠「故意失败重试」刷表
  const wait10m = await bumpLimit(env, 'submit:10m:' + ipHash, 600, 5, now);
  if (wait10m) return json({ error: '提交过于频繁，请稍后再试' }, 429, { 'Retry-After': String(wait10m) });
  const wait1d = await bumpLimit(env, 'submit:1d:' + ipHash, 86400, 20, now);
  if (wait1d) return json({ error: '今日投稿次数已达上限，请明天再试' }, 429, { 'Retry-After': String(wait1d) });

  const r = await env.DB.prepare(
    `INSERT INTO mg_submissions (title, author, contact, category, body, status, created_at, ip_hash)
     VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7)`
  ).bind(title, author, contact, category, body, nowStamp(), ipHash).run();

  return json({ ok: true, id: r.meta ? r.meta.last_row_id : undefined });
}

async function handleList(request, env, url) {
  if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);

  const status = url.searchParams.get('status') || '';
  // 列表不带正文：审核列表只需标题级信息，正文在详情里按需取
  let sql = 'SELECT id, title, author, category, status, contact, created_at, reviewed_at FROM mg_submissions';
  if (STATUSES.indexOf(status) >= 0) sql += ' WHERE status = ?1';
  sql += ' ORDER BY id DESC LIMIT 500';

  const stmt = env.DB.prepare(sql);
  const rs = STATUSES.indexOf(status) >= 0 ? await stmt.bind(status).all() : await stmt.all();
  return json({ submissions: (rs && rs.results) || [] });
}

async function handleGet(request, env, id) {
  if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);

  const row = await env.DB.prepare(
    `SELECT id, title, author, contact, category, body, status, review_note, created_at, reviewed_at
     FROM mg_submissions WHERE id = ?1`
  ).bind(Number(id)).first();
  if (!row) return json({ error: 'not found' }, 404);
  return json({ submission: row });
}

async function handlePatch(request, env, id) {
  if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);

  let data;
  try { data = await request.json(); } catch (e) { return json({ error: '请求格式错误' }, 400); }
  if (!data || typeof data !== 'object') return json({ error: '请求格式错误' }, 400);

  const status = str(data.status);
  if (STATUSES.indexOf(status) < 0) return json({ error: 'status 不合法' }, 400);
  const note = str(data.review_note);
  if (note.length > LIMITS.note) return json({ error: '审稿意见最多 500 个字符' }, 400);

  // 改回待审时清空 reviewed_at，语义上等于「尚未审」
  const reviewed = status === 'pending' ? null : nowStamp();
  const r = await env.DB.prepare(
    'UPDATE mg_submissions SET status = ?1, review_note = ?2, reviewed_at = ?3 WHERE id = ?4'
  ).bind(status, note, reviewed, Number(id)).run();

  const changed = r.meta ? (r.meta.changes != null ? r.meta.changes : r.meta.rows_written) : undefined;
  if (changed === 0) return json({ error: 'not found' }, 404);
  return json({ ok: true });
}
