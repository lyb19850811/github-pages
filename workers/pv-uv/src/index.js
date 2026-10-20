// Cloudflare Worker：PV/UV 统计
// 依赖 D1 数据库（binding 名：DB）
//
// 接口：
//   POST /track          body: { path }        → 记录一次访问，返回 { pv, uv }
//   GET  /stats?path=xx                         → 返回 { pv, uv }
//
// 统计口径：
//   PV = 该 path 的访问总次数
//   UV = 该 path 当天去重后的独立 IP 数（同一天同 IP 算 1 个）

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 北京时间日期（站点面向中文用户，UTC+8）
function beijingDay() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function getStats(db, path) {
  const pv = await db
    .prepare('SELECT COUNT(*) AS c FROM visits WHERE path = ?')
    .bind(path)
    .first();
  const uv = await db
    .prepare('SELECT COUNT(DISTINCT ip) AS c FROM visits WHERE path = ? AND day = ?')
    .bind(path, beijingDay())
    .first();
  return { pv: pv.c, uv: uv.c };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // 真实访客 IP（Workers 原生提供）
    const ip =
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('X-Forwarded-For') ||
      'unknown';

    // 上报一次访问
    if (url.pathname === '/track' && request.method === 'POST') {
      try {
        const body = await request.json();
        const path = (body && body.path) || '/';
        await env.DB.prepare(
          'INSERT INTO visits (path, ip, day, ts) VALUES (?, ?, ?, ?)'
        )
          .bind(path, ip, beijingDay(), Date.now())
          .run();
        return json(await getStats(env.DB, path));
      } catch (e) {
        return json({ error: 'bad request' }, 400);
      }
    }

    // 读取统计
    if (url.pathname === '/stats' && request.method === 'GET') {
      const path = url.searchParams.get('path') || '/';
      return json(await getStats(env.DB, path));
    }

    return json({ error: 'not found' }, 404);
  },
};
