(function () {
  var container = document.getElementById('tag-filter');
  var toggleBtn = document.getElementById('tag-filter-toggle');
  var noteEls = Array.prototype.slice.call(document.querySelectorAll('#notes .note'));

  var notes = noteEls.map(function (el) {
    var tags = [];
    try { tags = JSON.parse(el.getAttribute('data-tags') || '[]'); } catch (e) { tags = []; }
    return { el: el, tags: tags };
  });

  var counts = {};
  notes.forEach(function (n) {
    n.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
  });
  var allTags = Object.keys(counts).sort(function (a, b) {
    return (counts[b] - counts[a]) || a.localeCompare(b);
  });

  var selected = new Set();

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderButtons() {
    var html = '<button class="tag-chip' + (selected.size === 0 ? ' active' : '') + '" data-tag="__all__">全部</button>';
    allTags.forEach(function (t) {
      var cls = selected.has(t) ? 'tag-chip active' : 'tag-chip';
      html += '<button class="' + cls + '" data-tag="' + esc(t) + '">' + esc(t) +
        ' <span class="count">' + counts[t] + '</span></button>';
    });
    container.innerHTML = html;
  }

  function apply() {
    var keys = Array.from(selected);
    notes.forEach(function (n) {
      var show = keys.length === 0 || keys.every(function (t) { return n.tags.indexOf(t) !== -1; });
      n.el.style.display = show ? '' : 'none';
    });
  }

  function toggle(tag) {
    if (tag === '__all__') {
      selected.clear();
    } else if (selected.has(tag)) {
      selected.delete(tag);
    } else {
      selected.add(tag);
    }
    renderButtons();
    apply();
  }

  container.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (btn) toggle(btn.getAttribute('data-tag'));
  });

  var collapsed = true;
  var rowHeight = 0;

  function applyCollapse() {
    container.style.maxHeight = collapsed
      ? rowHeight + 'px'
      : container.scrollHeight + 'px';
    toggleBtn.textContent = collapsed ? '展开全部标签' : '收起';
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
  }

  function refresh() {
    if (!toggleBtn) return;
    var chip = container.querySelector('.tag-chip');
    rowHeight = chip ? chip.offsetHeight : 0;
    var full = container.scrollHeight;
    if (full <= rowHeight + 1) {
      toggleBtn.hidden = true;
      container.style.maxHeight = '';
      collapsed = true;
    } else {
      toggleBtn.hidden = false;
      applyCollapse();
    }
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      collapsed = !collapsed;
      applyCollapse();
    });
    window.addEventListener('resize', refresh);
  }

  var q = new URLSearchParams(window.location.search).get('tag');
  if (q !== null && counts[q] !== undefined) selected.add(q);

  renderButtons();
  apply();
  refresh();
})();
