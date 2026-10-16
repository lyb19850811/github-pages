(function () {
  var input = document.getElementById('search-input');
  var results = document.getElementById('search-results');
  if (!input || !results) return;

  var indexUrl = input.getAttribute('data-index') || 'search.json';
  var notes = [];
  var loaded = false;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function load() {
    fetch(indexUrl).then(function (r) { return r.json(); }).then(function (data) {
      notes = Array.isArray(data) ? data : [];
      loaded = true;
      render();
    }).catch(function () {
      results.hidden = false;
      results.innerHTML = '<p class="search-empty">搜索索引加载失败，请稍后重试。</p>';
    });
  }

  function render() {
    var q = input.value.trim().toLowerCase();
    if (!q) {
      results.hidden = true;
      results.innerHTML = '';
      return;
    }
    var words = q.split(/\s+/);
    var hits = notes.filter(function (n) {
      var hay = (n.title + ' ' + (n.summary || '') + ' ' + (n.tags || []).join(' ')).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    });
    if (hits.length === 0) {
      results.hidden = false;
      results.innerHTML = '<p class="search-empty">没有匹配的结果。</p>';
      return;
    }
    var html = '';
    hits.forEach(function (n) {
      var tags = (n.tags || []).map(function (t) {
        return '<span class="tag">' + escapeHtml(t) + '</span>';
      }).join('');
      html += '<article class="search-item">' +
        '<h3><a href="' + escapeHtml(n.url) + '">' + escapeHtml(n.title) + '</a></h3>' +
        '<p class="summary">' + escapeHtml(n.summary || '') + '</p>' +
        '<p class="search-tags">' + tags + '</p>' +
        '</article>';
    });
    results.hidden = false;
    results.innerHTML = html;
  }

  input.addEventListener('input', function () {
    if (!loaded) { load(); } else { render(); }
  });

  var q = new URLSearchParams(window.location.search).get('q');
  if (q) {
    input.value = q;
    load();
  }
})();
