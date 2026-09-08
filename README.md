# 🪁 青翔未阔博客

青翔未阔工作室博客 —— 分为两个平行部分：**青翔博客**（随心记录）与**未阔月刊**（每月一刊）。

全 Worker 一体架构，部署于 Cloudflare Workers，绑定与 [Qxwk-CityFootprint](https://github.com/Qxwk-Studio/Qxwk-CityFootprint) **相同的 D1 数据库**。

---

## ✨ 功能一览

### 🏠 博客首页（`/`）
- **三栏布局**：左「未阔月刊」卡片（进入月刊 / 去投稿）、中「发布框 + 博客流」、右「个人资料卡」
- **博客流** — 发布 / 修改 / 删除 / 点赞 / 分享，倒序展示
  - 未登录：发布引导通行证登录，个人资料卡显示登录入口
  - 已登录：显示账号昵称 / 头像，自己的博客可修改、删除
  - 点赞计数实时更新，刷新周期内置灰防重复
- 导航栏：主题切换（黑夜模式跟随系统 + 手动记忆）、返回首页；子页面仅返回博客首页
- **个人中心 / 登录**（`account.html`）— 由 Qxwk 通行证统一登录，查看投稿状态与退出登录

### 📖 未阔月刊（`/monthly/`）
- **首页**（`index.html`）— 最新一期专题 + 往期月刊 + 系列更新状态
  - 索引读取 `issues.json`（期刊元数据、文章目录、作者），系列更新读取 `series.json`
  - 文章正文存储于 [Qxwk-Files/files-magazine](https://github.com/Qxwk-Studio/Qxwk-Files/tree/main/files-magazine)，按 `年-月` 目录组织
- **投稿**（`submit.html`）— 登录后投稿，提交至本站后端 `/api/submit`
- **审核**（`review.html`）— 管理员审核投稿（`/api/submissions` / `/api/submission/:id` / `PATCH /api/submission/:id`）

---

## 🔌 架构说明

### 全 Worker 一体
一个 Cloudflare Worker 同时处理 `/api/*` 接口和静态资源（`public/`）：

```
Qxwk-Blog/
├── migrations/
│   └── 0001_schema.sql # 建库：投稿表 + 博客表（与 CityFootprint 共享 D1）
├── src/
│   ├── worker.js      # Worker 入口（月刊/博客 API + 静态资源回退）
│   └── lib.js         # SSO 验证与工具（与 CityFootprint 相同）
├── public/            # 静态资源（博客首页 / 个人中心 / 未阔月刊）
├── wrangler.toml      # Worker 配置（绑定 D1 + 静态资源目录）
└── README.md
```

### SSO 登录（复用通行证）
- 登录跳转 `https://account.qxwkstudio.top/authorize.html?redirect=<本站地址>`，`postMessage` 回传 token 存入 `localStorage`（key: `qxwk_mag_token`）
- 后端拿 Bearer token 去通行证 `/api/me` 验证，`resolveViewer()` 按 nickname 映射到本地 `users` 表（首次自动建号，颜色随通行证同步）
- **无需在通行证注册 origin**（apps 表登记仅为账号中心展示站点名，未登记站点照常登录）

### 共享 D1 数据库
- 本站与 [Qxwk-CityFootprint](https://github.com/Qxwk-Studio/Qxwk-CityFootprint) 绑定**同一 D1 数据库**（`qxwk-data`）：博客表 `bg_blogs`、投稿表 `bg_submissions` 与足迹表 `cf_visits`、用户表 `users` 共存，两站共用一套用户体系
- 本站建库位于 `migrations/0001_schema.sql`（投稿表 + 博客表）；`users` / `cf_visits` 初始建表位于 CityFootprint 的 `migrations/0001_init.sql`（同一 D1，由两仓共同维护）

### 博客 API（青翔博客）
| 接口 | 鉴权 | 说明 |
|---|---|---|
| `POST /api/blogs` | 登录 | 发布博客（正文 1-500 字） |
| `GET /api/blogs?before=&limit=` | 公开 | 博客流，倒序游标分页（默认 20 / 最大 50），含 `is_owner`、`likes_count` |
| `POST /api/blogs/:id/like` | 公开 | 点赞 +1，返回最新计数；防重复由前端刷新周期内置灰控制 |
| `PATCH /api/blogs/:id` | 登录+本人 | 修改自己的博客 |
| `DELETE /api/blogs/:id` | 登录+本人 | 软删除自己的博客 |

### 月刊 API（未阔月刊）
| 接口 | 鉴权 | 说明 |
|---|---|---|
| `POST /api/submit` | 登录 | 提交投稿 |
| `GET /api/my-submissions` | 登录 | 自己的投稿及状态 |
| `GET /api/submissions?status=` | 管理员 | 投稿列表（可筛状态） |
| `GET /api/submission/:id` | 管理员 | 投稿详情含正文与审稿意见 |
| `PATCH /api/submission/:id` | 管理员 | 通过 / 驳回 / 改回待审 |

### 域名
- `blog.qxwkstudio.top` — 本站（静态 + API 同源，无需 CORS）

---

## 🚀 本地开发与部署

```bash
# 本地开发（需先本地绑定 D1；本地测试 SSO 时把 lib.js 的 PASSPORT_URL 临时改为 http://localhost:8787）
wrangler dev

# 部署到 Cloudflare Workers
wrangler deploy
```

部署步骤：
1. **应用数据库迁移**：`wrangler d1 migrations apply qxwk-data`；若旧库投稿表名为 `submissions`，先执行 `ALTER TABLE submissions RENAME TO bg_submissions;` 再部署
2. `wrangler deploy` 部署 Worker
3. 确认 D1 绑定指向与 CityFootprint 相同的数据库（见 `wrangler.toml`）
4. Workers 自定义域设置为 `blog.qxwkstudio.top`，DNS 解析到 Cloudflare

---

## 🔗 相关仓库

- [Qxwk-Website](https://github.com/Qxwk-Studio/Qxwk-Website) — 主站（导航/卡片入口指向本站）
- [Qxwk-Account](https://github.com/Qxwk-Studio/Qxwk-Account) — 通行证 SSO
