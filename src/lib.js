// 工具与通行证 SSO 验证（Worker 版）
// 本站不再持有密码 / 会话，认证统一由通行证 account.qxwkstudio.top 处理
// 业务路由拿 Bearer token 去问通行证 /api/me，按 nickname 映射到本地用户

// 通行证地址（本地 dev 改 http://localhost:8787）
const PASSPORT_URL = 'https://account.qxwkstudio.top';

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function error(message, status = 400) {
  return json({ error: message }, status);
}

// 用 Bearer token 去通行证 /api/me 验证，返回 {userId, nickname, color, avatar} 或 null
async function getPassportUser(request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  try {
    const r = await fetch(`${PASSPORT_URL}/api/me`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u || !u.userId) return null;
    return { userId: u.userId, nickname: u.nickname, color: u.color, avatar: u.avatar };
  } catch {
    return null;
  }
}

// 通行证用户 -> 本地 CF 用户：首次自动建（颜色同步通行证），返回 {id, nickname, color, isAdmin, avatar} 或 null
async function resolveViewer(DB, request) {
  const p = await getPassportUser(request);
  if (!p) return null;
  // 昵称缺失/空时用稳定 fallback，避免 NULL 昵称行被反复新建导致 user 计数暴增
  // （users.nickname 的唯一约束允许多个 NULL）
  const nickname = (p.nickname && String(p.nickname).trim()) || 'user_' + p.userId;
  // 优先看本地是否已有该用户；否则仅当真正新用户才 INSERT。
  // 不能用 `INSERT ... ON CONFLICT DO UPDATE` 做"幂等"：它即使走 UPDATE 分支也会消耗
  // AUTOINCREMENT 序列，登录页并发多个接口就会让 sqlite_sequence 虚增（users 行数却不变）。
  let u = await DB.prepare('SELECT id, nickname, color, is_admin FROM users WHERE nickname = ?')
    .bind(nickname).first();
  if (!u) {
    // INSERT OR IGNORE：兜住并发首插竞争；冲突被忽略时不会消耗自增序列
    await DB.prepare('INSERT OR IGNORE INTO users (nickname, color) VALUES (?, ?)')
      .bind(nickname, p.color).run();
    u = await DB.prepare('SELECT id, nickname, color, is_admin FROM users WHERE nickname = ?')
      .bind(nickname).first();
    if (!u) return null; // 极端并发下仍失败，放弃本次映射
  } else if (u.color !== p.color) {
    // color 同步用 UPDATE，不消耗自增序列
    await DB.prepare('UPDATE users SET color = ? WHERE id = ?').bind(p.color, u.id).run();
    u.color = p.color;
  }
  return u ? { id: u.id, nickname: u.nickname, color: u.color, isAdmin: !!u.is_admin, avatar: p.avatar } : null;
}

// 从 Authorization 解析本地用户 id（业务路由用，无 token / 验证失败返回 null）
export async function getUserId(DB, request) {
  const v = await resolveViewer(DB, request);
  return v ? v.id : null;
}

export { resolveViewer };
