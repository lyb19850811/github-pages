# 留言板 SPA

纯原生 JS 的单页应用（无框架、无构建），演示「静态 GitHub Pages + 独立 ECS 后端」的最小完整闭环：前端读/写后端 API。

## 目录

- `index.html` — SPA 页面
- `app.js` — 逻辑（fetch + 渲染）
- `style.css` — 样式（自包含，不依赖站点 `style.css`）
- `README.md` — 本文档（后端接口契约）

## 后端接口契约

前端只认这组 REST 接口。后端（另一项目的 ECS 服务）按此实现即可对接。

Base URL：`https://<your-ecs-domain>`（`app.js` 顶部 `API_BASE` 配置，结尾不带斜杠）。

### 1. 健康检查

`GET /api/health`

- 200 → `{"status":"ok"}`
- 用途：页面启动时探测连通性，右上角显示「已连接 / 后端不可用」。

### 2. 列表

`GET /api/messages?limit=20&offset=0`

- `limit`：单页条数（前端固定 20）；`offset`：已加载条数。
- 按 `created_at` 倒序返回（最新在前）：

```json
{
  "total": 42,
  "messages": [
    {
      "id": "msg_01j",
      "author": "访客A",
      "content": "正文",
      "created_at": "2026-11-17T04:05:06Z"
    }
  ]
}
```

- `total` 为总条数（用于「加载更多」判断）；`messages` 只返回当前页。

### 3. 发布

`POST /api/messages`

请求体：

```json
{ "author": "访客A", "content": "正文" }
```

- 201 → `{"message": { ...同列表项结构... }}`
- 校验（前后端一致）：
  - `author`：可选，去空格后 ≤ 40 字符；空值前端默认显示「匿名」。
  - `content`：必填，去空格后 1–1000 字符。
- 校验失败 → 400 `{"error": "人类可读的错误信息"}`。

### 通用错误格式

非 2xx 统一返回 `{"error": "人类可读的错误信息"}`。前端展示为 `HTTP <status>：<error>`。

## 跨域（CORS）

前端跑在 GitHub Pages（`https://lyb19850811.github.io`），后端在 ECS 不同源，必须配置 CORS：

- `Access-Control-Allow-Origin`: `https://lyb19850811.github.io`（或部署时的具体 origin）
- `Access-Control-Allow-Methods`: `GET, POST, OPTIONS`
- `Access-Control-Allow-Headers`: `Content-Type`
- 对 `OPTIONS` 预检返回 2xx（Starlette 的 CORSMiddleware 返回 200），并带上上述 `Allow-*` 头。

> 为什么 GET 不触发预检、POST 会：POST 带 `Content-Type: application/json` 属非简单请求，浏览器先发 `OPTIONS` 预检；GET 无自定义头、无 body，是简单请求，不发预检。后端两种都要能处理。

## 部署

- **前端**：本目录由 Jekyll 当作静态目录原样拷贝到 `_site/guestbook/`，线上即 `https://lyb19850811.github.io/github-pages/guestbook/`。文件不含 Jekyll front matter，可整体搬到任意静态托管。
- **后端**：独立 ECS 服务，实现上述接口；把 `app.js` 顶部的 `API_BASE` 改成实际地址即可。

## 安全

- 前端渲染全部用 `textContent`（非 innerHTML），用户输入不会注入 HTML，防 XSS。
- 后端仍需自行做输入长度校验、限流、必要的垃圾/敏感内容过滤（不在前端职责内）。

## 已知限制

- 用 `limit/offset` 分页：并发新增留言时可能偶发重复/跳过一条。留言板场景可接受；量大后可在 `GET /api/messages` 加 `before=<cursor>` 改游标分页。
