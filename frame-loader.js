/* Managed iframe lifecycles. QQ Space navigates directly; legacy pages retain their own source isolation. */
(function () {
  'use strict';
  var records = new Map(), documents = new Map(), serial = 0, observer = null;
  var api = { timeoutMs: 30000 };
  function token() {
    var unique;
    try { if (window.crypto && typeof crypto.randomUUID === 'function') unique = crypto.randomUUID(); } catch (_) {}
    return 'frame-' + (++serial) + '-' + (unique || Math.random().toString(36).slice(2));
  }
  function styles() {
    if (document.getElementById('arg-frame-loader-style')) return;
    var style = document.createElement('style'); style.id = 'arg-frame-loader-style';
    style.textContent = '.arg-frame-host{position:relative;width:100%;height:100%;min-height:120px}' +
      '.arg-frame-panel{position:absolute;top:0;right:0;bottom:0;left:0;inset:0;z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;box-sizing:border-box;background:#fafafa;color:#444;font:14px/1.7 Microsoft YaHei,Arial,sans-serif;text-align:center}' +
      '.arg-frame-panel[hidden]{display:none}.arg-frame-panel button{padding:7px 20px;border:1px solid #9daebd;border-radius:3px;background:#fff;color:#304d67;font:inherit;cursor:pointer}.arg-frame-panel button:focus-visible{outline:2px solid #3175b8;outline-offset:3px}';
    document.head.appendChild(style);
  }
  function panel(parent, retry) {
    styles();
    var box = document.createElement('div'); box.className = 'arg-frame-panel'; box.setAttribute('role', 'status');
    var message = document.createElement('div'), button = document.createElement('button');
    button.type = 'button'; button.textContent = '重试'; button.addEventListener('click', retry);
    box.append(message, button); parent.appendChild(box);
    return { box: box, message: message, button: button };
  }
  function childBridge(attempt) {
    var source = '(' + function (id) {
      var failed = false, ready = false;
      function send(kind, detail) {
        parent.postMessage({ argFrameLifecycle: kind, attempt: id, detail: detail || '' }, '*');
      }
      function fail(detail) { if (ready || failed) return; failed = true; send('error', String(detail || 'initialization error')); }
      window.addEventListener('error', function (event) {
        // Missing media is not equivalent to JavaScript initialization failure.
        if (event instanceof ErrorEvent) fail(event.message);
      }, true);
      window.addEventListener('unhandledrejection', function (event) {
        fail(event.reason && event.reason.message || event.reason);
      });
      function settle() {
        setTimeout(function () { if (!failed) { ready = true; send('ready'); } }, 0);
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', settle, { once: true });
      else settle();
    }.toString() + ')(' + JSON.stringify(attempt) + ');';
    return '<script>' + source + '</scr' + 'ipt>';
  }
  function instrument(html, attempt) {
    var bridge = childBridge(attempt), head = /<head(?:\s[^>]*)?>/i;
    if (head.test(html)) return html.replace(head, function (match) { return match + bridge; });
    var doctype = /^\s*<!doctype[^>]*>/i;
    if (doctype.test(html)) return html.replace(doctype, function (match) { return match + bridge; });
    return bridge + html;
  }
  function decodeData(source) {
    var comma = source.indexOf(','); if (comma < 0) throw new Error('Malformed embedded document');
    var header = source.slice(0, comma), data = source.slice(comma + 1);
    if (!/^data:text\/html(?:;|$)/i.test(header)) throw new Error('Unsupported iframe data type');
    if (/;base64$/i.test(header)) {
      var binary = atob(data), bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    return decodeURIComponent(data);
  }
  function encodeData(html) {
    var bytes = new TextEncoder().encode(html), pieces = [];
    for (var i = 0; i < bytes.length; i += 32768) pieces.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)));
    return 'data:text/html;charset=utf-8;base64,' + btoa(pieces.join(''));
  }
  function clearAttempt(record) {
    clearTimeout(record.timer); record.timer = null;
    clearTimeout(record.diagnosticTimer); record.diagnosticTimer = null;
    clearTimeout(record.probeTimer); record.probeTimer = null;
    if (record.probeAbort) { record.probeAbort.abort(); record.probeAbort = null; }
    record.probing = false;
    if (record.abort) { record.abort.abort(); record.abort = null; }
    if (record.blob) { URL.revokeObjectURL(record.blob); record.blob = null; }
    record.originalHtml = null;
  }
  function marker(record, ready) {
    if (record.options.marker) record.frame.dataset[record.options.marker] = ready ? '1' : '';
  }
  function current(record, attempt) {
    return records.get(record.frame) === record && record.attempt === attempt && record.frame.isConnected && record.status !== 'disposed';
  }
  function fail(record, attempt, reason) {
    if (!current(record, attempt) || record.status !== 'loading') return;
    if (record.options.mode === 'direct') { failDirect(record, attempt, reason); return; }
    record.status = 'error'; record.error = String(reason || 'load error');
    clearAttempt(record); marker(record, false);
    record.frame.dataset.argFrameState = 'error'; record.frame.src = 'about:blank';
    record.ui.box.hidden = false; record.ui.button.hidden = false;
    if (record.options.errorHtml) record.ui.message.innerHTML = record.options.errorHtml;
    else record.ui.message.textContent = reason === 'timeout' ? '页面加载超时，请重试。' : '页面加载失败，请重试。';
  }
  async function start(record) {
    if (record.options.mode === 'direct') { startDirect(record); return; }
    clearAttempt(record);
    record.attempt = token(); var attempt = record.attempt;
    record.status = 'loading'; record.error = null; marker(record, false);
    record.frame.dataset.argFrameState = 'loading'; record.frame.dataset.argFrameAttempt = attempt;
    record.ui.box.hidden = false; record.ui.message.textContent = '页面加载中…'; record.ui.button.hidden = true;
    record.frame.src = 'about:blank';
    record.timer = setTimeout(function () { fail(record, attempt, 'timeout'); }, record.options.timeoutMs || api.timeoutMs);
    try {
      var opaque = /^data:/i.test(record.source), html;
      if (opaque) html = decodeData(record.source);
      else if (documents.has(record.source)) html = documents.get(record.source);
      else {
        record.abort = new AbortController();
        var response = await fetch(record.source, { signal: record.abort.signal, credentials: 'same-origin', cache: 'no-cache' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        html = await response.text();
      }
      if (!current(record, attempt) || record.status !== 'loading') return;
      record.originalHtml = opaque ? null : html;
      html = instrument(html, attempt);
      if (opaque) record.frame.src = encodeData(html);
      else {
        record.blob = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        record.frame.src = record.blob;
      }
    } catch (error) {
      if (error.name !== 'AbortError') fail(record, attempt, error.message);
    }
  }
  function waitingText(record) {
    if (navigator.onLine === false) return '当前网络已断开，正在尝试读取本地缓存。联网后可以重试。';
    if (record.diagnostic === 'http-404') return '未找到QQ空间页面，请确认发布包中的 embedded 文件夹已完整上传。';
    if (record.diagnostic && record.diagnostic.indexOf('http-') === 0) return '服务器暂时未能提供QQ空间页面，请稍后重试。';
    if (record.diagnostic === 'network') return 'QQ空间的连接尚未完成。请检查网络，或继续等待后重试。';
    return 'QQ空间加载时间较长，页面仍在继续加载。可以继续等待，也可以重试。';
  }
  function showWaiting(record) {
    record.ui.box.hidden = false; record.ui.message.textContent = waitingText(record);
    record.ui.button.hidden = false; record.ui.wait.hidden = false;
  }
  function armDirectTimer(record) {
    clearTimeout(record.timer);
    var attempt = record.attempt;
    record.timer = setTimeout(function () {
      record.timer = null;
      if (!current(record, attempt) || record.status !== 'loading') return;
      record.slow = true; showWaiting(record); diagnoseDirect(record, attempt);
    }, record.options.timeoutMs || api.timeoutMs);
  }
  function diagnoseDirect(record, attempt) {
    // Diagnostics never gate navigation, require fetch support, or cancel a slow page.
    if (!current(record, attempt) || record.status !== 'loading' || record.documentId || record.probing || typeof fetch !== 'function' || typeof AbortController !== 'function') return;
    var url;
    try { url = new URL(record.source, document.baseURI); } catch (_) { return; }
    if (!/^https?:$/.test(url.protocol)) return;
    var controller;
    try { controller = new AbortController(); } catch (_) { return; }
    record.probing = true;
    record.probeAbort = controller;
    var options = { method: 'HEAD', credentials: 'same-origin', cache: 'default' };
    options.signal = controller.signal;
    record.probeTimer = setTimeout(function () { controller.abort(); }, 8000);
    function finish(kind) {
      if (!current(record, attempt) || record.status !== 'loading') return;
      clearTimeout(record.probeTimer); record.probeTimer = null; record.probeAbort = null; record.probing = false;
      if (record.documentId) return;
      if (kind) { record.diagnostic = kind; record.slow = true; showWaiting(record); }
    }
    try {
      fetch(url.href, options).then(function (response) {
        // HEAD is optional on a static host; unsupported diagnostics are not page failures.
        finish(!response.ok && response.status !== 405 && response.status !== 501 ? 'http-' + response.status : null);
      }, function (error) { finish(error && error.name === 'AbortError' ? null : 'network'); });
    } catch (_) { finish('network'); }
  }
  function failDirect(record, attempt, reason) {
    if (!current(record, attempt) || record.status !== 'loading') return;
    record.status = 'error'; record.error = String(reason || 'initialization error');
    clearAttempt(record); marker(record, false); record.frame.dataset.argFrameState = 'error';
    record.ui.box.hidden = false; record.ui.button.hidden = false; record.ui.wait.hidden = true;
    if (reason === 'frame-policy') record.ui.message.textContent = '当前网站的安全设置阻止了QQ空间内嵌页面。请从游戏的独立网址打开后重试。';
    else if (reason === 'bridge-missing') record.ui.message.textContent = 'QQ空间的启动脚本未能加载或执行。请检查发布包是否完整，或重试。';
    else if (reason === 'iframe navigation error') record.ui.message.textContent = navigator.onLine === false ? '网络已断开，QQ空间未能打开。联网后请重试。' : 'QQ空间页面未能打开，请检查网络后重试。';
    else record.ui.message.textContent = 'QQ空间初始化未完成，请重试。';
  }
  function missingDeclaredQzoneBridge(frame) {
    try {
      var child = frame.contentWindow, doc = child.document;
      if (!doc || doc.readyState !== 'complete' || child.location.href === 'about:blank' || child.argQzoneChild) return false;
      var scripts = doc.getElementsByTagName('script');
      for (var i = 0; i < scripts.length; i++) {
        if (/(^|\/)qzone-child\.js(?:[?#]|$)/i.test(scripts[i].getAttribute('src') || '')) return true;
      }
    } catch (_) { /* An opaque sandbox cannot be inspected; retain the message/timeout path. */ }
    return false;
  }
  function replaceDirectFrame(record) {
    var previous = record.frame, next = previous.cloneNode(false);
    // A new browsing context, not a second navigation of the old context, isolates late messages.
    next.removeAttribute('src'); next.removeAttribute('srcdoc');
    previous.removeEventListener('error', record.nativeError);
    previous.removeEventListener('load', record.nativeLoad);
    records.delete(previous); previous.dataset.argFrameState = 'disposed';
    if (record.options.marker) previous.dataset[record.options.marker] = '';
    record.frame = next; records.set(next, record);
    next.addEventListener('error', record.nativeError); next.addEventListener('load', record.nativeLoad);
    previous.parentNode.replaceChild(next, previous);
  }
  function startDirect(record) {
    clearAttempt(record);
    if (record.attempt !== null) replaceDirectFrame(record);
    record.attempt = token(); record.documentId = null; record.status = 'loading'; record.error = null;
    record.slow = false; record.diagnostic = null; marker(record, false);
    record.frame.dataset.argFrameState = 'loading'; record.frame.dataset.argFrameAttempt = record.attempt;
    record.ui.box.hidden = false; record.ui.message.textContent = 'QQ空间加载中…';
    record.ui.button.hidden = true; record.ui.wait.hidden = true;
    if (navigator.onLine === false) showWaiting(record);
    armDirectTimer(record);
    // Keep the source URL stable so that HTML and image responses can use the browser cache.
    // Do not navigate to about:blank before this assignment (WebKit navigation race).
    try { record.frame.src = record.source; }
    catch (error) { failDirect(record, record.attempt, error.message); }
  }
  function ensure(frame, source, options) {
    if (!frame || !source) return null;
    options = options || {};
    var record = records.get(frame);
    if (record && record.source === source && record.options.mode === options.mode) {
      if (record.status === 'error' && options.retryFailed) start(record);
      return record;
    }
    if (record) dispose(frame);
    var host = frame.parentElement;
    if (!host || !host.classList.contains('arg-frame-host')) {
      host = document.createElement('div'); host.className = 'arg-frame-host';
      frame.parentElement.insertBefore(host, frame); host.appendChild(frame);
    }
    record = { frame: frame, source: source, options: options, status: 'idle', attempt: null, timer: null, abort: null, blob: null, error: null };
    record.ui = panel(host, function () { if (record.status === 'error' || record.options.mode === 'direct' && record.status === 'loading') start(record); });
    record.nativeError = function () { fail(record, record.attempt, 'iframe navigation error'); };
    frame.addEventListener('error', record.nativeError);
    if (options.mode === 'direct') {
      var wait = document.createElement('button'); wait.type = 'button'; wait.textContent = '继续等待'; wait.hidden = true;
      wait.addEventListener('click', function () {
        if (record.status !== 'loading') return;
        record.slow = false; record.diagnostic = null;
        record.ui.message.textContent = navigator.onLine === false ? '网络仍未连接，正在等待页面恢复。' : '正在继续等待QQ空间加载…';
        record.ui.wait.hidden = true; armDirectTimer(record);
      });
      record.ui.box.appendChild(wait); record.ui.wait = wait;
      record.nativeLoad = function () {
        if (record.status !== 'loading' || record.documentId) return;
        if (missingDeclaredQzoneBridge(record.frame)) { failDirect(record, record.attempt, 'bridge-missing'); return; }
        // Ignore the iframe's initial empty document. A real error page can be diagnosed early.
        try { if (record.frame.contentWindow.location.href === 'about:blank') return; } catch (_) {}
        clearTimeout(record.diagnosticTimer);
        var attempt = record.attempt;
        record.diagnosticTimer = setTimeout(function () { record.diagnosticTimer = null; diagnoseDirect(record, attempt); }, 350);
      };
      frame.addEventListener('load', record.nativeLoad);
    }
    records.set(frame, record); start(record);
    return record;
  }
  function retry(frame) {
    var record = records.get(frame);
    if (!record || record.status !== 'error' && !(record.options.mode === 'direct' && record.status === 'loading')) return false;
    start(record); return true;
  }
  function dispose(frame) {
    var record = records.get(frame); if (!record) return;
    records.delete(frame); record.status = 'disposed'; record.attempt = null;
    clearAttempt(record); marker(record, false); frame.dataset.argFrameState = 'disposed';
    frame.removeEventListener('error', record.nativeError); record.ui.box.remove();
    if (record.nativeLoad) frame.removeEventListener('load', record.nativeLoad);
    frame.src = 'about:blank';
  }
  function disposeWithin(parent) { parent.querySelectorAll('iframe').forEach(dispose); }
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (data && ['hello', 'ready', 'error'].includes(data.argQzone) && typeof data.documentId === 'string' && data.documentId) {
      records.forEach(function (record) {
        if (record.options.mode !== 'direct' || record.status !== 'loading' || event.source !== record.frame.contentWindow || !current(record, record.attempt)) return;
        if (data.argQzone === 'hello') {
          if (record.documentId && record.documentId !== data.documentId) return;
          record.documentId = data.documentId;
          record.frame.contentWindow.postMessage({ argQzone: 'init', attempt: record.attempt, documentId: record.documentId, target: record.frame.dataset.argSpaceTarget || '' }, event.origin && event.origin !== 'null' ? event.origin : '*');
          return;
        }
        if (data.documentId !== record.documentId || data.attempt !== record.attempt) return;
        if (data.argQzone === 'error') { failDirect(record, record.attempt, data.detail); return; }
        clearAttempt(record); record.status = 'ready'; record.slow = false; record.diagnostic = null;
        record.frame.dataset.argFrameState = 'ready'; marker(record, true); record.ui.box.hidden = true;
        if (record.options.onReady) {
          try { record.options.onReady(record.frame); }
          catch (error) { record.status = 'loading'; failDirect(record, record.attempt, error.message); }
        }
      });
      return;
    }
    if (!data || !['ready', 'error'].includes(data.argFrameLifecycle) || typeof data.attempt !== 'string') return;
    records.forEach(function (record) {
      if (record.options.mode === 'direct') return;
      if (record.status !== 'loading' || event.source !== record.frame.contentWindow || !current(record, data.attempt)) return;
      if (data.argFrameLifecycle === 'error') { fail(record, data.attempt, data.detail); return; }
      clearTimeout(record.timer); record.timer = null; record.abort = null;
      record.status = 'ready'; record.frame.dataset.argFrameState = 'ready'; marker(record, true);
      record.ui.box.hidden = true;
      if (record.options.onReady) {
        try { record.options.onReady(record.frame); }
        catch (error) { record.status = 'loading'; fail(record, data.attempt, error.message); }
      }
      if (record.status === 'ready' && record.originalHtml !== null && !documents.has(record.source)) {
        // Retain only successfully initialized source documents. Each window
        // still receives its own Blob URL, DOM and form state when reopened.
        if (documents.size >= 3) documents.delete(documents.keys().next().value);
        documents.set(record.source, record.originalHtml);
      }
      record.originalHtml = null;
    });
  });
  window.addEventListener('offline', function () {
    records.forEach(function (record) { if (record.options.mode === 'direct' && record.status === 'loading') showWaiting(record); });
  });
  window.addEventListener('online', function () {
    records.forEach(function (record) {
      if (record.options.mode !== 'direct' || record.status !== 'loading') return;
      record.ui.message.textContent = '网络已恢复，正在等待QQ空间加载。若仍未打开，可以重试。';
      record.ui.button.hidden = false; record.ui.wait.hidden = false;
    });
  });
  document.addEventListener('securitypolicyviolation', function (event) {
    if (!/^(frame-src|child-src)$/.test(event.effectiveDirective || event.violatedDirective || '')) return;
    records.forEach(function (record) {
      if (record.options.mode !== 'direct' || record.status !== 'loading') return;
      try { if (event.blockedURI === new URL(record.source, document.baseURI).href) failDirect(record, record.attempt, 'frame-policy'); } catch (_) {}
    });
  });
  function installObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver(function () {
      records.forEach(function (record, frame) { if (!frame.isConnected) dispose(frame); });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installObserver, { once: true });
  else installObserver();
  window.addEventListener('pagehide', function (event) {
    if (event.persisted) return;
    records.forEach(function (record, frame) { dispose(frame); }); documents.clear();
  });

  function windowFailed(appId, failedWindow, error, previousConfig) {
    if (failedWindow) {
      disposeWithin(failedWindow);
      try { if (failedWindow.argBrowserDispose) failedWindow.argBrowserDispose(); } catch (_) {}
      try { if (failedWindow.argDragDispose) failedWindow.argDragDispose(); } catch (_) {}
      failedWindow.remove();
    }
    delete openWindows[appId]; delete windowMeta[appId];
    if (focusedWindowId === appId) focusedWindowId = null;
    var original = previousConfig || { title: appId, icon: '', w: 600, h: 400, x: 100, y: 80 };
    var safe = { title: original.title, icon: original.icon, w: original.w, h: original.h, x: original.x, y: original.y, content: '' };
    var win = createWindowElement(appId, safe); win.argInitializationFailed = true;
    win.dataset.argInitError = String(error && error.message || error || 'initialization failed');
    windowsContainer.appendChild(win); openWindows[appId] = win;
    windowMeta[appId] = { x: safe.x, y: safe.y, width: safe.w, height: safe.h, maximized: false, minimized: false };
    Object.assign(win.style, { left: safe.x + 'px', top: safe.y + 'px', width: safe.w + 'px', height: safe.h + 'px' });
    var ui = panel(win.querySelector('.window-content'), function () { closeWindow(appId); openWindow(appId); });
    ui.message.textContent = '窗口初始化失败，请重试。'; ui.button.hidden = false;
    enableDrag(win, appId); win.addEventListener('mousedown', function () { focusWindow(appId); });
    focusWindow(appId); updateTaskbarButtons();
  }
  api.ensure = ensure; api.retry = retry; api.dispose = dispose; api.disposeWithin = disposeWithin; api.windowFailed = windowFailed;
  api.inspect = function (frame) {
    var record = records.get(frame);
    if (!record) return null;
    var info = { status: record.status, attempt: record.attempt, hasTimer: record.timer !== null, hasBlob: !!record.blob, error: record.error };
    if (record.options.mode === 'direct') { info.mode = 'direct'; info.slow = !!record.slow; info.documentId = record.documentId; info.diagnostic = record.diagnostic; }
    return info;
  };
  api.count = function () { return records.size; };
  window.argFrameLoader = api;
})();
