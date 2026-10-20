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
})();
