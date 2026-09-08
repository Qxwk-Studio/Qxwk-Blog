-- 青翔博客统一建库（与 CityFootprint 共享同一 D1 数据库）
-- 前端/后端由 Qxwk-Blog Worker 提供，复用通行证登录鉴权（Bearer token）
-- users/cf_visits 初始建表见 CityFootprint 的 0001_init.sql（共享同一 D1）
-- 审稿权限使用 users.is_admin 判定

-- ============ 投稿：未阔月刊投稿 ============
CREATE TABLE IF NOT EXISTS bg_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,             -- 投稿人（映射到本地 users）
  title TEXT NOT NULL,                  -- 标题
  category TEXT NOT NULL DEFAULT '',    -- 分类（可空）
  body TEXT NOT NULL,                   -- 正文
  contact TEXT,                         -- 联系方式（可选）
  status TEXT NOT NULL DEFAULT 'pending', -- pending / approved / rejected
  reviewer_id INTEGER,                  -- 审稿管理员（users.id）
  review_note TEXT,                     -- 审稿意见
  created_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT,                     -- 审稿时间
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_bg_submissions_user ON bg_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_bg_submissions_status ON bg_submissions(status);

-- ============ 博客：青翔博客动态 ============
-- 点赞不做用户级去重（无点赞表）：同一刷新周期内前端置灰防止二次点赞，刷新后可再次点赞
CREATE TABLE IF NOT EXISTS bg_blogs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,   -- bid（博客 id，前端展示为纯数字）
  user_id     INTEGER NOT NULL,                    -- 作者（映射到本地 users）
  content     TEXT NOT NULL,                       -- 正文
  featured    INTEGER NOT NULL DEFAULT 0,          -- 1 = 入选未阔月刊
  is_deleted  INTEGER NOT NULL DEFAULT 0,          -- 1 = 已删除（软删除，保留互动数据）
  likes_count INTEGER NOT NULL DEFAULT 0,          -- 点赞数（每次点赞 +1）
  created_at  TEXT DEFAULT (datetime('now')),      -- 创建时间（UTC，前端转本地）
  updated_at  TEXT,                                -- 编辑时间
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_bg_blogs_user    ON bg_blogs(user_id);
CREATE INDEX IF NOT EXISTS idx_bg_blogs_created ON bg_blogs(created_at DESC);
