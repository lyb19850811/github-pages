(function () {
  // 复制链接
  var copyBtn = document.getElementById('copy-link');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var url = window.location.href;
      function done() {
        copyBtn.textContent = '已复制';
        setTimeout(function () { copyBtn.textContent = '复制链接'; }, 1500);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        done();
      }
    });
  }

  // 返回顶部
  var backTop = document.querySelector('.js-back-to-top');
  if (backTop) {
    backTop.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // 目录（TOC）
  var toc = document.getElementById('toc');
  var fab = document.getElementById('toc-fab');
  var content = document.querySelector('.content');
  if (toc && content) {
    var headings = Array.prototype.slice.call(content.querySelectorAll('h2, h3'));
    if (headings.length > 1) {
      var isMobile = function () {
        return window.matchMedia('(max-width: 768px)').matches;
      };

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
        // 默认折叠：含子级的节点初始即为 collapsed 状态
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
          node.children.forEach(function (c) {
            out += renderNode(c, true);
          });
          out += '</ul>';
        }
        out += '</li>';
        return out;
      }

      var html = '<div class="toc-header">'
        + '<span class="toc-title">目录</span>'
        + '<span class="toc-actions">'
        + '<button type="button" class="toc-toggle-all" aria-label="展开全部">展开</button>'
        + '<button type="button" class="toc-close" aria-label="隐藏目录">隐藏</button>'
        + '</span>'
        + '</div><ul class="toc-tree">';
      roots.forEach(function (r) { html += renderNode(r, false); });
      html += '</ul>';
      toc.innerHTML = html;

      var links = Array.prototype.slice.call(toc.querySelectorAll('a.toc-link'));
      var arrows = Array.prototype.slice.call(toc.querySelectorAll('button.toc-arrow'));
      var toggleAll = toc.querySelector('.toc-toggle-all');

      // 设置所有可折叠节点的展开/折叠状态
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
          // 仅统计有子级的可折叠节点，判断是否存在展开项
          var hasExpandable = toc.querySelector('li.toc-node > .toc-row > button.toc-arrow');
          var anyExpanded = toc.querySelector('li.toc-node:not(.collapsed) > .toc-row > button.toc-arrow');
          if (!hasExpandable) return;
          setAll(Boolean(anyExpanded));
        });
      }

      // 隐藏按钮：移动端关浮层，桌面端收起目录
      var closeBtn = toc.querySelector('.toc-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', function () {
          if (isMobile()) {
            document.body.classList.remove('toc-open');
          } else {
            document.body.classList.add('toc-hidden');
          }
        });
      }

      // 悬浮按钮：移动端开浮层，桌面端展开目录
      if (fab) {
        fab.addEventListener('click', function () {
          if (isMobile()) {
            document.body.classList.add('toc-open');
          } else {
            document.body.classList.remove('toc-hidden');
          }
        });
        document.addEventListener('click', function (e) {
          if (document.body.classList.contains('toc-open') && !toc.contains(e.target) && e.target !== fab) {
            document.body.classList.remove('toc-open');
          }
        });
      }

      // 桌面端：光标移到右边缘触发区时展开目录
      var tocTab = document.getElementById('toc-tab');
      var hoverTargets = [tocTab, toc];
      hoverTargets.forEach(function (el) {
        if (!el) return;
        el.addEventListener('mouseenter', function () {
          if (!isMobile()) document.body.classList.remove('toc-hidden');
        });
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
    } else {
      toc.remove();
      if (fab) fab.remove();
    }
  }
})();
