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
  var content = document.querySelector('.content');
  if (toc && content) {
    var headings = content.querySelectorAll('h2, h3');
    if (headings.length > 1) {
      var html = '<details class="toc-details" open><summary>目录</summary><ol class="toc-list">';
      var counter = 0;
      headings.forEach(function (h) {
        if (!h.id) {
          h.id = 'sec-' + (++counter) + '-' + Math.random().toString(36).slice(2, 6);
        }
        var cls = h.tagName.toLowerCase() === 'h3' ? ' class="toc-h3"' : '';
        html += '<li' + cls + '><a href="#' + h.id + '">' + h.textContent + '</a></li>';
      });
      html += '</ol></details>';
      toc.innerHTML = html;

      // 章节高亮
      if ('IntersectionObserver' in window) {
        var links = toc.querySelectorAll('a');
        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              var id = entry.target.id;
              links.forEach(function (l) {
                l.classList.toggle('active', l.getAttribute('href') === '#' + id);
              });
            }
          });
        }, { rootMargin: '0px 0px -70% 0px' });
        headings.forEach(function (h) { observer.observe(h); });
      }
    } else {
      toc.hidden = true;
    }
  }
})();
