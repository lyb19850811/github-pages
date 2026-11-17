// 留言板 SPA（原生 JS，无框架、无构建）。
//
// 后端接口契约见本目录 README.md。
// API_BASE 为空串 = 与前端同源：SPA 和 /api/ 都托管在同一台 ECS 上。
// 若前端托管在别处（如 GitHub Pages），改成后端的绝对地址（结尾不带斜杠），
// 且后端必须 HTTPS，否则会被浏览器按混合内容拦截。

const API_BASE = '';

const PAGE_SIZE = 20;

const state = {
  total: 0,
  loaded: 0,
  loading: false,
  submitting: false,
};

const els = {
  conn: document.getElementById('conn'),
  form: document.getElementById('form'),
  author: document.getElementById('author'),
  content: document.getElementById('content'),
  hint: document.getElementById('hint'),
  submit: document.getElementById('submit'),
  list: document.getElementById('list'),
  more: document.getElementById('more'),
};

function setConn(text, status) {
  els.conn.textContent = text;
  els.conn.className = 'conn' + (status ? ' ' + status : '');
}

function setHint(text, isError = false) {
  els.hint.textContent = text;
  els.hint.className = 'hint' + (isError ? ' error' : '');
}

// 只有带 body 的请求才加 Content-Type，避免 GET 触发 CORS 预检。
async function request(path, options = {}) {
  const opts = { ...options };
  if (opts.body) {
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  }
  const res = await fetch(API_BASE + path, opts);
  let data = null;
  try { data = await res.json(); } catch (_) { /* 非 JSON 响应体 */ }
  if (!res.ok) {
    const detail = data && data.error ? `：${data.error}` : '';
    throw new Error(`HTTP ${res.status}${detail}`);
  }
  return data;
}

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
  if (diff < MIN) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// 全部用 textContent 渲染，用户输入不会注入 HTML（防 XSS）。
function renderMessage(m) {
  const el = document.createElement('article');
  el.className = 'msg';

  const head = document.createElement('div');
  head.className = 'msg-head';
  const author = document.createElement('span');
  author.className = 'msg-author';
  author.textContent = (m.author && m.author.trim()) || '匿名';
  const time = document.createElement('time');
  time.className = 'msg-time';
  time.dateTime = m.created_at || '';
  time.textContent = formatTime(m.created_at);
  head.append(author, time);

  const content = document.createElement('p');
  content.className = 'msg-content';
  content.textContent = m.content || '';

  el.append(head, content);
  return el;
}

function renderEmpty() {
  const p = document.createElement('p');
  p.className = 'state';
  p.textContent = '还没有留言，来抢沙发吧。';
  els.list.append(p);
}

function renderError(err) {
  const div = document.createElement('div');
  div.className = 'state';
  const span = document.createElement('span');
  span.className = 'err';
  span.textContent = `加载失败：${err.message}`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '重试';
  btn.addEventListener('click', () => loadMessages(true));
  div.append(span, btn);
  els.list.append(div);
}

async function loadMessages(reset = false) {
  if (state.loading) return;
  state.loading = true;
  els.more.disabled = true;

  if (reset) {
    state.total = 0;
    state.loaded = 0;
    els.list.replaceChildren();
  }

  try {
    const data = await request(`/api/messages?limit=${PAGE_SIZE}&offset=${state.loaded}`);
    const msgs = Array.isArray(data && data.messages) ? data.messages : [];
    state.total = typeof data.total === 'number' ? data.total : msgs.length;

    const frag = document.createDocumentFragment();
    msgs.forEach((m) => frag.append(renderMessage(m)));
    els.list.append(frag);

    state.loaded += msgs.length;

    if (state.loaded === 0) renderEmpty();
    els.more.hidden = state.loaded >= state.total;
    els.more.textContent = `加载更多（还有 ${Math.max(0, state.total - state.loaded)} 条）`;
  } catch (err) {
    renderError(err);
    els.more.hidden = true;
  } finally {
    state.loading = false;
    els.more.disabled = false;
  }
}

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const author = els.author.value.trim();
  const content = els.content.value.trim();

  if (!content) {
    setHint('留言内容不能为空。', true);
    els.content.focus();
    return;
  }

  if (state.submitting) return;
  state.submitting = true;
  els.submit.disabled = true;
  setHint('发布中…');

  try {
    await request('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ author, content }),
    });
    els.content.value = '';
    setHint('发布成功。');
    await loadMessages(true);
  } catch (err) {
    setHint(`发布失败：${err.message}`, true);
  } finally {
    state.submitting = false;
    els.submit.disabled = false;
  }
});

els.more.addEventListener('click', () => loadMessages(false));

// 输入时清空提示
[els.author, els.content].forEach((el) => {
  el.addEventListener('input', () => setHint(''));
});

// 启动：先探测后端连通性，再拉取列表
(async function init() {
  try {
    await request('/api/health');
    setConn('已连接', 'ok');
  } catch {
    setConn('后端不可用', 'down');
  }
  await loadMessages();
})();
