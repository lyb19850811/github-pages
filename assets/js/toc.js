/* 语雀式文章目录（TOC）——共享实现
   树形构建、子级折叠、整体折叠、面板隐藏、平滑滚动、滚动高亮。
   供「研究笔记」（桌面端固定右缘）与「每日AI资讯」（三栏右侧 sticky）复用。
   仅依赖：一个 #toc 容器、一个 .content 正文容器、正文内 h2/h3 标题，
   以及可选的 #toc-fab（移动端悬浮按钮）与 #toc-tab（桌面端右缘触发条）。 */
(function (global) {
  'use strict';

  var MOBILE_QUERY = '(max-width: 768px)';

  function isMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  // opts:
  //   toc      — 目录容器（必填）
  //   content  — 正文容器，索引其中 h2/h3（必填）
  //   fab      — 移动端悬浮按钮（可选）
  //   tab      — 桌面端右缘触发条（可选，仅研究笔记使用）
  //   closable — 是否显示「隐藏」按钮（默认 true；三栏布局桌面端传 false）
  // 返回 { destroy }；标题不足 2 个时隐藏目录并返回 null。
  function build(opts) {
    var toc = opts.toc;
    var content = opts.content;
    if (!toc || !content) return null;

    var fab = opts.fab || null;
    var tab = opts.tab || null;
    var closable = opts.closable !== false;

    var headings = Array.prototype.slice.call(content.querySelectorAll('h2, h3'));
    if (headings.length < 2) {
      toc.innerHTML = '';
      toc.style.display = 'none';
      if (fab) fab.style.display = 'none';
      return null;
    }
    toc.style.display = '';

    // 构建树：h2 为父，h3 为子
    var roots = [];
    var current = null;
    headings.forEach(function (h) {
      if (h.tagName.toLowerCase() === 'h2') {
        current = { h: h, children: [] };
        roots.push(current);
      } else if (current) {
        current.children.push({ h: h, children: [] });
      } else {
        roots.push({ h: h, children: [] });
      }
    });

    var idCounter = 0;
    function ensureId(h) {
      if (!h.id) {
        h.id = 'sec-' + (++idCounter) + '-' + Math.random().toString(36).slice(2, 6);
      }
      return h.id;
    }

    function renderNode(node, isChild) {
      var id = ensureId(node.h);
      var hasChildren = node.children.length > 0;
      var out = '<li class="toc-node' + (isChild ? ' toc-child' : '') + (hasChildren ? ' collapsed' : '') + '">';
      out += '<div class="toc-row">';
      if (hasChildren) {
        out += '<button type="button" class="toc-arrow" aria-expanded="false" aria-label="展开">▸</button>';
      } else {
        out += '<span class="toc-arrow toc-arrow-empty"></span>';
      }
      out += '<a class="toc-link" href="#' + id + '">' + node.h.textContent + '</a>';
      out += '</div>';
      if (hasChildren) {
        out += '<ul class="toc-children">';
        node.children.forEach(function (c) { out += renderNode(c, true); });
        out += '</ul>';
      }
      out += '</li>';
      return out;
    }

    var html = '<div class="toc-header">'
      + '<span class="toc-title">目录</span>'
      + '<span class="toc-actions">'
      + '<button type="button" class="toc-toggle-all" aria-label="展开全部">展开</button>';
    if (closable) {
      html += '<button type="button" class="toc-close" aria-label="隐藏目录">隐藏</button>';
    }
    html += '</span></div><ul class="toc-tree">';
    roots.forEach(function (r) { html += renderNode(r, false); });
    html += '</ul>';
    toc.innerHTML = html;

    var links = Array.prototype.slice.call(toc.querySelectorAll('a.toc-link'));
    var arrows = Array.prototype.slice.call(toc.querySelectorAll('button.toc-arrow'));
    var toggleAll = toc.querySelector('.toc-toggle-all');
    var closeBtn = toc.querySelector('.toc-close');

    function setAll(collapsed) {
      Array.prototype.slice.call(toc.querySelectorAll('li.toc-node')).forEach(function (li) {
        var arrow = li.querySelector('.toc-row > button.toc-arrow');
        if (!arrow) return;
        if (collapsed) {
          li.classList.add('collapsed');
          arrow.setAttribute('aria-expanded', 'false');
          arrow.textContent = '▸';
        } else {
          li.classList.remove('collapsed');
          arrow.setAttribute('aria-expanded', 'true');
          arrow.textContent = '▾';
        }
      });
      if (toggleAll) {
        toggleAll.textContent = collapsed ? '展开' : '折叠';
        toggleAll.setAttribute('aria-label', collapsed ? '展开全部' : '折叠全部');
      }
    }

    // 子级折叠：点击箭头展开/收起
    arrows.forEach(function (arrow) {
      arrow.addEventListener('click', function () {
        var li = arrow.closest('li.toc-node');
        var collapsed = li.classList.toggle('collapsed');
        arrow.setAttribute('aria-expanded', String(!collapsed));
        arrow.textContent = collapsed ? '▸' : '▾';
      });
    });

    // 全部折叠 / 全部展开（单按钮切换）
    if (toggleAll) {
      toggleAll.addEventListener('click', function () {
        var hasExpandable = toc.querySelector('li.toc-node > .toc-row > button.toc-arrow');
        var anyExpanded = toc.querySelector('li.toc-node:not(.collapsed) > .toc-row > button.toc-arrow');
        if (!hasExpandable) return;
        setAll(Boolean(anyExpanded));
      });
    }

    // 隐藏按钮：移动端关浮层，桌面端收起目录
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        if (isMobile()) {
          document.body.classList.remove('toc-open');
        } else {
          document.body.classList.add('toc-hidden');
        }
      });
    }

    // 挂在外层元素上的监听器（fab / document / tab / toc 悬停），需在 destroy 时移除，
    // 避免三栏阅读器反复切换时泄漏。
    var outerHandlers = { fabClick: null, docClick: null, enters: [] };

    if (fab) {
      outerHandlers.fabClick = function () {
        if (isMobile()) {
          document.body.classList.add('toc-open');
        } else {
          document.body.classList.remove('toc-hidden');
        }
      };
      fab.addEventListener('click', outerHandlers.fabClick);

      outerHandlers.docClick = function (e) {
        if (document.body.classList.contains('toc-open') && !toc.contains(e.target) && e.target !== fab) {
          document.body.classList.remove('toc-open');
        }
      };
      document.addEventListener('click', outerHandlers.docClick);
    }

    [tab, toc].forEach(function (el) {
      if (!el) return;
      var fn = function () {
        if (!isMobile()) document.body.classList.remove('toc-hidden');
      };
      el.addEventListener('mouseenter', fn);
      outerHandlers.enters.push({ el: el, fn: fn });
    });

    // 点击目录项：平滑滚动 + 移动端关浮层
    links.forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var target = document.getElementById(a.getAttribute('href').slice(1));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        document.body.classList.remove('toc-open');
      });
    });

    // 章节高亮：滚动监听 + 位置区间
    var threshold = 100;
    var prevCurrent = null;
    function highlight() {
      var active = headings[0];
      for (var i = 0; i < headings.length; i++) {
        if (headings[i].getBoundingClientRect().top <= threshold) {
          active = headings[i];
        }
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        active = headings[headings.length - 1];
      }
      links.forEach(function (l) {
        var on = l.getAttribute('href') === '#' + active.id;
        l.classList.toggle('active', on);
        if (on) {
          var collapsedParent = l.closest('li.toc-node.collapsed');
          if (collapsedParent) {
            collapsedParent.classList.remove('collapsed');
            var pArrow = collapsedParent.querySelector('.toc-row .toc-arrow');
            if (pArrow) {
              pArrow.setAttribute('aria-expanded', 'true');
              pArrow.textContent = '▾';
            }
          }
        }
      });
      // 仅在高亮项变化时，让目录滚动到高亮项
      if (active !== prevCurrent) {
        prevCurrent = active;
        var activeLink = toc.querySelector('a.toc-link.active');
        if (activeLink) {
          activeLink.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    }
    window.addEventListener('scroll', highlight, { passive: true });
    highlight();

    return {
      destroy: function () {
        window.removeEventListener('scroll', highlight);
        if (outerHandlers.fabClick && fab) fab.removeEventListener('click', outerHandlers.fabClick);
        if (outerHandlers.docClick) document.removeEventListener('click', outerHandlers.docClick);
        outerHandlers.enters.forEach(function (x) {
          x.el.removeEventListener('mouseenter', x.fn);
        });
        toc.innerHTML = '';
      }
    };
  }

  global.Toc = { build: build, isMobile: isMobile };
})(window);
