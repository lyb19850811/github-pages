// Cloudflare Worker：留言板 API
// 依赖 D1 数据库（binding 名：DB）
//
// 接口（与 guestbook/ 前端契约一致）：
//   GET  /api/health                        → {"status":"ok"}
//   GET  /api/messages?limit=20&offset=0     → {"total": N, "messages": [...]}
//   POST /api/messages  body: {author, content} → 201 {"message": {...}}
//
// 校验（与前端一致）：
//   author  可选，去空格后 ≤ 40 字符；空值由前端显示「匿名」
//   content 必填，去空格后 1–1000 字符
// 校验失败统一返回 400 {"error": "..."}。

const CORS = {
  'Access-Control-Allow-Origin': 'https://lyb19850811.github.io',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

function badRequest(msg) {
  return json({ error: msg }, 400);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 预检请求（POST 带 application/json 会先发 OPTIONS）
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ status: 'ok' });
    }

    if (url.pathname === '/api/messages' && request.method === 'GET') {
      const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

      const { results } = await env.DB.prepare(
        'SELECT id, author, content, created_at FROM messages ORDER BY rowid DESC LIMIT ? OFFSET ?'
      ).bind(limit, offset).all();
      const { c: total } = await env.DB.prepare('SELECT COUNT(*) AS c FROM messages').first();

      return json({ total, messages: results });
    }

    if (url.pathname === '/api/messages' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest('无效的 JSON');
      }

      const author = typeof body.author === 'string' ? body.author.trim() : '';
      const content = typeof body.content === 'string' ? body.content.trim() : '';

      if (!content) return badRequest('留言内容不能为空');
      if (content.length > 1000) return badRequest('留言内容不能超过 1000 字');
      if (author.length > 40) return badRequest('昵称不能超过 40 字');

      const msg = {
        id: crypto.randomUUID(),
        author,
        content,
        created_at: new Date().toISOString(),
      };
      await env.DB.prepare(
        'INSERT INTO messages (id, author, content, created_at) VALUES (?, ?, ?, ?)'
      ).bind(msg.id, msg.author, msg.content, msg.created_at).run();

      return json({ message: msg }, 201);
    }

    return json({ error: 'not found' }, 404);
  },
};
