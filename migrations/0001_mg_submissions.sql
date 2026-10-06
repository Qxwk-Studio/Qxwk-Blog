-- Qxwk-Blog 投稿功能建表
-- 执行：npx.cmd wrangler d1 execute qxwk-data --remote --file=migrations/0001_mg_submissions.sql
-- （本地调试用 --local；线上结构与数据变更由用户自行执行）
--
-- 本仓库现在没有登录体系，投稿与用户完全解耦，故另起 mg_ 前缀的独立表。

CREATE TABLE IF NOT EXISTS mg_submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  author      TEXT    NOT NULL,
  contact     TEXT    NOT NULL DEFAULT '',
  category    TEXT    NOT NULL DEFAULT '',
  body        TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  review_note TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL,                    -- UTC 'YYYY-MM-DD HH:MM:SS'
  reviewed_at TEXT,                                -- 未审时为 NULL
  ip_hash     TEXT    NOT NULL DEFAULT ''          -- 提交方 IP 的 SHA-256，仅用于排查，不存明文
);

-- 审核页按状态筛选 + 倒序列表
CREATE INDEX IF NOT EXISTS idx_mg_submissions_status_id ON mg_submissions (status, id DESC);

-- 投稿限流：key = 维度 + 窗口 + IP 哈希（如 submit:10m:<hash>），固定窗口计数
CREATE TABLE IF NOT EXISTS mg_rate_limit (
  key        TEXT    PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL   -- unix 秒，过期即重置计数
);
