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

  // 目录（TOC）：复用 toc.js 共享实现
  var tocEl = document.getElementById('toc');
  if (tocEl && window.Toc) {
    window.Toc.build({
      toc: tocEl,
      content: document.querySelector('.content'),
      fab: document.getElementById('toc-fab'),
      tab: document.getElementById('toc-tab'),
      closable: true
    });
  }

  // PV/UV 统计：上报一次访问并从后端读取展示
  var PVUV_ENDPOINT = 'https://pv-uv-tracker.lyb19850811.workers.dev';
  var pvuvEl = document.getElementById('pv-uv');
  if (pvuvEl) {
    fetch(PVUV_ENDPOINT + '/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: window.location.pathname })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        pvuvEl.textContent = '👁 ' + d.pv + ' 阅读 · ' + d.uv + ' 访客';
      })
      .catch(function () {
        pvuvEl.style.display = 'none';
      });
  }

  // 图片点击放大（lightbox）
  var content = document.querySelector('.content');
  if (content) {
    var imgs = content.querySelectorAll('img');
    if (imgs.length) {
      var overlay = document.createElement('div');
      overlay.className = 'img-lightbox';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', '图片放大');
      var lbImg = document.createElement('img');
      var lbClose = document.createElement('button');
      lbClose.className = 'lb-close';
      lbClose.setAttribute('aria-label', '关闭');
      lbClose.textContent = '\u00d7';
      overlay.appendChild(lbImg);
      overlay.appendChild(lbClose);
      overlay.style.display = 'none';
      document.body.appendChild(overlay);

      function open(src, alt) {
        lbImg.src = src;
        lbImg.alt = alt || '';
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
      }
      function close() {
        overlay.style.display = 'none';
        lbImg.removeAttribute('src');
        document.body.style.overflow = '';
      }
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target === lbClose) close();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && overlay.style.display === 'flex') close();
      });

      imgs.forEach(function (img) {
        img.classList.add('zoomable');
        img.setAttribute('tabindex', '0');
        img.setAttribute('role', 'button');
        img.addEventListener('click', function () {
          open(img.getAttribute('src'), img.getAttribute('alt'));
        });
        img.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open(img.getAttribute('src'), img.getAttribute('alt'));
          }
        });
      });
    }
  }
})();
