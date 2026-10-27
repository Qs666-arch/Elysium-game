/* QQ space document lifecycle and recoverable media. Authored story state is untouched. */
(function () {
  'use strict';
  var documentId = 'qzone-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  var attempt = '', targetRoute = '', renderedRoute = '', navigate = null, failed = '', didReady = false;
  var helloTimer = null, helloCount = 0;

  function send(kind, detail) {
    if (window.parent === window) return;
    window.parent.postMessage({ argQzone: kind, documentId: documentId, attempt: attempt || undefined, detail: detail || '' }, '*');
  }
  function announce() {
    if (attempt || window.parent === window || helloCount >= 8) return;
    helloCount++;
    send('hello');
    helloTimer = setTimeout(announce, 750);
  }
  function finish() {
    if (!attempt) return;
    if (failed) { send('error', failed); return; }
    if (!renderedRoute || (targetRoute && renderedRoute !== targetRoute)) return;
    didReady = true;
    send('ready');
  }
  function fail(error) {
    if (didReady || failed) return;
    failed = String(error && error.message || error || 'QQ空间初始化失败');
    finish();
  }
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (event.source !== window.parent || !data || data.argQzone !== 'init' || data.documentId !== documentId) return;
    if (typeof data.attempt !== 'string' || !data.attempt || (attempt && attempt !== data.attempt)) return;
    if (data.target !== '' && data.target !== 'lbb' && data.target !== undefined) return;
    attempt = data.attempt;
    clearTimeout(helloTimer);
    if (data.target === 'lbb') targetRoute = '#/user/lbb';
    if (targetRoute && navigate) navigate(targetRoute);
    finish();
  });
  window.addEventListener('error', function (event) {
    if (typeof ErrorEvent !== 'undefined' && event instanceof ErrorEvent) fail(event.message);
  }, true);
  window.addEventListener('unhandledrejection', function (event) { fail(event.reason); });
  window.argQzoneChild = {
    initialRoute: function () { return targetRoute; },
    bindNavigator: function (callback) { navigate = callback; if (targetRoute) navigate(targetRoute); },
    rendered: function (route) { renderedRoute = route; finish(); },
    fail: fail
  };
  announce();

  var media = new WeakMap(), failures = new Set(), retrySerial = 0, notice = null;
  var retryDelays = [1500, 5000];
  var style = document.createElement('style');
  style.id = 'qz-media-recovery-style';
  style.textContent = '.qz-media-placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;min-height:110px;padding:14px;border:1px dashed #91a1af;background:#edf1f4;color:#344e63;font:12px/1.7 Microsoft YaHei,Arial,sans-serif;text-align:center;box-sizing:border-box;max-width:100%}' +
    '.qz-media-placeholder.qz-media-avatar{display:inline-flex;min-height:0;padding:0;flex-shrink:0;vertical-align:middle;font-size:12px;border-radius:3px}' +
    '.qz-media-placeholder button,.qz-media-notice button{font:inherit;border:1px solid #8a9cae;border-radius:3px;padding:4px 10px;background:#fff;color:#284861;cursor:pointer}' +
    '.qz-media-placeholder button:focus-visible,.qz-media-notice button:focus-visible{outline:2px solid #427ba6;outline-offset:2px}' +
    '.qz-media-notice{position:fixed;right:12px;bottom:12px;z-index:10001;display:flex;align-items:center;gap:10px;max-width:calc(100% - 24px);padding:9px 12px;border:1px solid #8a9cae;border-radius:4px;background:#f4f7fa;color:#344e63;box-shadow:0 3px 12px #0002;font:12px/1.6 Microsoft YaHei,Arial,sans-serif}' +
    'body.dark .qz-media-placeholder{background:#142538;color:#c3d3e0;border-color:#587189}' +
    '.album-lightbox .qz-media-placeholder{min-width:240px;max-width:70vw}';
  document.head.appendChild(style);

  function currentSource(img) { return img.getAttribute('src') || ''; }
  function isMedia(img) {
    return img && img.tagName === 'IMG' && img.hasAttribute('data-qz-media') && !!currentSource(img);
  }
  function isActive(img) {
    if (!img.isConnected) return false;
    for (var node = img.parentElement; node; node = node.parentElement) {
      if (node.hidden || ((node.id === 'views' || node.id === 'app') && !node.classList.contains('show'))) return false;
    }
    return true;
  }
  function updateNotice() {
    failures.forEach(function (record) {
      if (!isActive(record.img)) {
        discard(record); record.img.style.display = record.display;
        record.img.removeAttribute('data-qz-media-failed'); record.failedSource = '';
      }
    });
    if (!failures.size) {
      if (notice) { notice.remove(); notice = null; }
      return;
    }
    if (!document.body) return;
    if (!notice) {
      notice = document.createElement('div'); notice.className = 'qz-media-notice'; notice.setAttribute('role', 'status');
      var label = document.createElement('span'), button = document.createElement('button');
      button.type = 'button'; button.textContent = '重试未加载图片';
      button.addEventListener('click', function () { Array.from(failures).forEach(function (record) { retry(record, true); }); });
      notice.appendChild(label); notice.appendChild(button); document.body.appendChild(notice);
    }
    var message = '有 ' + failures.size + ' 张图片未加载，图片内容尚不可见。';
    if (notice.firstChild.textContent !== message) notice.firstChild.textContent = message;
  }
  function discard(record) {
    clearTimeout(record.timer); record.timer = null;
    if (record.placeholder) { record.placeholder.remove(); record.placeholder = null; }
    failures.delete(record);
  }
  function restore(record) {
    discard(record);
    record.failedSource = '';
    record.retries = 0;
    record.img.style.display = record.display;
    record.img.removeAttribute('data-qz-media-failed');
    updateNotice();
  }
  function ensure(img) {
    if (!isMedia(img)) return null;
    var source = currentSource(img), record = media.get(img);
    if (record && (source === record.source || source === record.expectedSource)) return record;
    if (record) restore(record);
    record = { img: img, source: source, expectedSource: source, display: img.style.display, retries: 0, timer: null, failedSource: '', placeholder: null };
    media.set(img, record);
    return record;
  }
  function statusText(record) {
    if (record.img.getAttribute('data-qz-media') === 'avatar') return '?';
    return record.timer ? '图片未能加载，稍后自动重试。' : '图片未能加载，图片内容尚不可见。';
  }
  function showPlaceholder(record) {
    var img = record.img;
    if (!record.placeholder) {
      var box = document.createElement('span'), text = document.createElement('span');
      box.className = 'qz-media-placeholder'; box.setAttribute('role', 'status');
      text.className = 'qz-media-message'; box.appendChild(text);
      if (img.getAttribute('data-qz-media') === 'avatar') {
        box.classList.add('qz-media-avatar'); box.style.width = (img.width || 24) + 'px'; box.style.height = (img.height || 24) + 'px';
        box.title = '头像未能加载，可用右下角按钮重试。';
        box.addEventListener('click', function () { img.click(); });
      } else if (!img.closest('button')) {
        var button = document.createElement('button'); button.type = 'button'; button.textContent = '重新加载图片';
        button.addEventListener('click', function (event) { event.stopPropagation(); retry(record, true); });
        box.appendChild(button);
      } else box.title = '图片未能加载，可用右下角按钮重试；仍可点开相册。';
      img.insertAdjacentElement('afterend', box); record.placeholder = box;
    }
    record.placeholder.querySelector('.qz-media-message').textContent = statusText(record);
    img.style.display = 'none'; img.setAttribute('data-qz-media-failed', '1');
  }
  function retry(record, manual) {
    if (!isActive(record.img) || media.get(record.img) !== record) { discard(record); updateNotice(); return; }
    clearTimeout(record.timer); record.timer = null;
    if (manual) record.retries = 0;
    var url = new URL(record.source, document.baseURI);
    url.searchParams.set('qz_retry', String(++retrySerial));
    record.expectedSource = url.href;
    record.img.loading = 'eager'; record.img.src = record.expectedSource;
    if (record.placeholder) record.placeholder.querySelector('.qz-media-message').textContent = record.img.getAttribute('data-qz-media') === 'avatar' ? '?' : '正在重新加载图片…';
  }
  function failedImage(img) {
    var record = ensure(img);
    if (!record || !isActive(img) || record.failedSource === currentSource(img)) return;
    record.failedSource = currentSource(img); failures.add(record);
    clearTimeout(record.timer); record.timer = null;
    if (record.retries < retryDelays.length) {
      var delay = retryDelays[record.retries++];
      record.timer = setTimeout(function () { record.timer = null; retry(record, false); }, delay);
    }
    showPlaceholder(record); updateNotice();
  }
  function loadedImage(img) {
    var record = ensure(img);
    if (record && img.naturalWidth > 0) restore(record);
  }
  document.addEventListener('error', function (event) { if (isMedia(event.target)) failedImage(event.target); }, true);
  document.addEventListener('load', function (event) { if (isMedia(event.target)) loadedImage(event.target); }, true);
  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    var images = isMedia(node) ? [node] : [];
    if (node.querySelectorAll) images = images.concat(Array.from(node.querySelectorAll('img[data-qz-media][src]')));
    images.forEach(function (img) {
      if (!isActive(img)) return;
      ensure(img);
      if (img.complete && currentSource(img)) { if (img.naturalWidth) loadedImage(img); else failedImage(img); }
    });
  }
  new MutationObserver(function (changes) {
    changes.forEach(function (change) {
      if (change.type === 'attributes') {
        if (change.attributeName === 'src' || change.target.id === 'app' || change.target.id === 'views' || change.target.classList.contains('album-lightbox')) scan(change.target);
      }
      else Array.from(change.addedNodes).forEach(scan);
    });
    updateNotice();
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'class', 'hidden'] });
  window.addEventListener('pagehide', function () {
    clearTimeout(helloTimer); failures.forEach(function (record) { clearTimeout(record.timer); });
  });
})();
