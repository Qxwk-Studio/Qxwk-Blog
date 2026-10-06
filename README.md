# 🪁 未阔月刊

青翔未阔工作室的未阔月刊（每月一刊）——静态站点 + 一个极薄的投稿接口，部署于 Cloudflare Workers。

---

## ✨ 功能一览

### 📖 月刊首页（`/`）
- **首页**（`index.html`）— 最新一期专题 + 往期月刊 + 系列更新状态
  - 索引读取 `issues.json`（期刊元数据、文章目录、作者），系列更新读取 `series.json`
  - 文章正文（Markdown）与每期封面随站点一起存放在 `public/magazine/<年-月>/` 下，前端同源直取
  - 正文用 `vendor/marked.min.js` 渲染，渲染后再做一次最小消毒（投稿来自外部，必须挡住脚本注入）
  - 分享深链 `/?issue=<期id>&article=<slug>` 自动打开阅读弹窗并定位到该篇
- **导航栏**：主题切换（黑夜模式跟随系统 + 手动记忆）、投稿入口、返回首页

### ✍️ 投稿页（`/submit.html`）
- 无需登录，填标题 / 作者 / 联系方式 / 栏目 / 正文（Markdown），编辑·预览双栏切换
- 前后端同一套长度校验，前端先拦一遍，不合法不发请求
- 图片请单独发给编辑：**投稿表不接收图片**，正文里插图由编辑在合稿时补进 `magazine/<期id>/`

### 🔍 审核页（`/review.html`）
- 不开放注册、不走登录体系，只有一道「审核口令」门：口令存在 `localStorage`（键 `qxwk-mg-review-token`），请求带 `Authorization: Bearer <口令>`
- 口令由 Worker 的 `ADMIN_TOKEN` 密钥校验，后端用定长比较，避免逐位试探
- 四档筛选（待审 / 已通过 / 已驳回 / 全部）、左列表右详情、通过 / 驳回 / 改回待审 + 审稿意见

---

## 🔌 架构说明

```
Qxwk-Blog/
├── public/                 # 静态资源
│   ├── index.html          # 月刊首页（站点根路径 /）
│   ├── submit.html         # 投稿页（无登录）
│   ├── review.html         # 审核页（口令门）
│   ├── issues.json         # 期刊元数据
│   ├── series.json         # 系列更新状态
│   ├── magazine/           # 月刊内容（<年-月>/<文章slug>.md 与 cover.webp）
│   ├── vendor/             # marked.min.js（随站点自带，不依赖 CDN）
│   ├── favicon.webp
│   └── robots.txt
├── src/
│   └── worker.js           # Worker 入口（投稿接口 + 静态资源回退）
├── migrations/
│   └── 0001_mg_submissions.sql   # 投稿表 / 限流表建表语句
├── wrangler.toml           # Worker 配置（静态资源目录 + D1 绑定）
└── README.md
```

### 接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/submit` | 公开 | 提交投稿，body `{title,author,contact,category,body}` |
| GET | `/api/submissions?status=` | 口令 | 列表（不含正文），`status` 可省略表示全部 |
| GET | `/api/submission/<id>` | 口令 | 详情（含正文） |
| PATCH | `/api/submission/<id>` | 口令 | 改状态 / 写审稿意见，body `{status,review_note}` |

- 校验失败 `400 {error}`；未授权 `401 {error:"unauthorized"}`；限流 `429 {error}` + `Retry-After`（秒）
- 长度限制：标题 1-100、作者 1-40、联系方式 ≤120、栏目 ≤40、正文 10-100000、审稿意见 ≤500
- 限流仅依据 `CF-Connecting-IP`（不信可伪造的 `X-Forwarded-For`）：同一 IP 10 分钟 5 次、每天 20 次

### 数据
投稿落在共享库 `qxwk-data` 的两张独立表里（前缀 `mg_` 与站内其它业务区分）：

- `mg_submissions` — 投稿正文与审核状态；`ip_hash` 只存 IP 的 SHA-256，不落明文
- `mg_rate_limit` — 固定窗口限流计数（`INSERT ... ON CONFLICT` 原子自增，窗口过期自动重置）

### 域名
- `blog.qxwkstudio.top` — 本站

---

## 🚀 本地开发与部署

```bash
# 本地开发（先在 .dev.vars 里放 ADMIN_TOKEN=...）
wrangler dev

# 部署到 Cloudflare Workers
wrangler deploy
```

首次部署 / 换环境时需要另外做两件事：

```bash
# 1. 建表（线上结构与数据变更由用户自行执行）
npx wrangler d1 execute qxwk-data --remote --file=migrations/0001_mg_submissions.sql

# 2. 配置审核口令（值由自己定，别进仓库）
npx wrangler secret put ADMIN_TOKEN
```

部署步骤：
1. 执行上面的建表与密钥配置
2. `wrangler deploy` 部署 Worker
3. Workers 自定义域设置为 `blog.qxwkstudio.top`，DNS 解析到 Cloudflare

---

## 📝 增刊流程

1. 新建目录 `public/magazine/<年-月>/`，放入 `cover.webp` 与各篇 `<slug>.md`（正文纯 Markdown，标题与作者写在 `issues.json` 里）
2. 在 `issues.json` 的 `issues` 数组最前面插入本期，填写 `id / number / date / title / cover / summary / articles[]`
3. 需要的话更新 `series.json` 的系列计数与最近一期
4. 提交、部署

---

## 🔗 相关仓库

- [Qxwk-Website](https://github.com/Qxwk-Studio/Qxwk-Website) — 主站（导航/卡片入口指向本站）
