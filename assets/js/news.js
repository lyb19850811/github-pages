/* 每日AI资讯三栏阅读器：左侧列表切换 → 中部内容 → 右侧目录（复用 toc.js）。 */
(function () {
  'use strict';

  var items = Array.prototype.slice.call(document.querySelectorAll('.news-list-item'));
  var panes = Array.prototype.slice.call(document.querySelectorAll('.news-pane'));
  if (!items.length || !panes.length) return;

  var toc = document.getElementById('toc');
  var fab = document.getElementById('toc-fab');
  var tocApi = null;

  var slugByPane = {};
  panes.forEach(function (p) {
    slugByPane[p.getAttribute('data-slug')] = p;
  });

  function activate(slug) {
    var target = slugByPane[slug];
    if (!target) return;

    panes.forEach(function (p) { p.hidden = p !== target; });
    items.forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-slug') === slug);
    });

    var dateEl = document.getElementById('news-date');
    if (dateEl) dateEl.textContent = slug;

    if (tocApi) { tocApi.destroy(); tocApi = null; }
    if (toc && window.Toc) {
      tocApi = window.Toc.build({
        toc: toc,
        content: target.querySelector('.content'),
        fab: fab,
        tab: document.getElementById('toc-tab'),
        closable: true
      });
    }
  }

  items.forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var slug = a.getAttribute('data-slug');
      activate(slug);
      if (history.replaceState) history.replaceState(null, '', '#' + slug);
      window.scrollTo(0, 0);
    });
  });

  // 初始选中：优先 URL hash，否则最新（列表第一条）
  var initial = (window.location.hash || '').replace('#', '');
  if (!slugByPane[initial]) initial = items[0].getAttribute('data-slug');
  activate(initial);

  // 左侧资讯列表：可隐藏 / 悬停恢复（默认隐藏态由 body 初始 class 提供）
  var listClose = document.getElementById('news-list-close');
  var listTab = document.getElementById('news-list-tab');
  if (listClose) {
    listClose.addEventListener('click', function () {
      document.body.classList.add('news-list-hidden');
    });
  }
  if (listTab) {
    listTab.addEventListener('mouseenter', function () {
      document.body.classList.remove('news-list-hidden');
    });
  }
})();
