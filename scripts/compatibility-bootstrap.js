/* Keep this entry point ES5-readable so an unsupported engine can show help. */
(function () {
  'use strict';
  var panel = null, pending = null, missing = [], syntaxReady = false;
  var api = { supported: false, missing: missing, protocol: location.protocol };
  window.argCompatibility = api;
  window.argCompatibilityBlocked = false;

  function on(target, name, handler) {
    if (target.addEventListener) target.addEventListener(name, handler, false);
    else if (target.attachEvent) target.attachEvent('on' + name, handler);
  }
  function contains(node) {
    while (node) { if (node === panel) return true; node = node.parentNode; }
    return false;
  }
  function mount() {
    if (!pending || !document.body) return;
    if (!panel) {
      panel = document.createElement('div'); panel.id = 'arg-compatibility-panel';
      panel.setAttribute('role', 'alertdialog'); panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-labelledby', 'arg-compatibility-title'); panel.tabIndex = -1;
      panel.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;background:#101722;color:#fff;overflow:auto;padding:28px;box-sizing:border-box;font:16px/1.8 Microsoft YaHei,Arial,sans-serif;';
      document.body.appendChild(panel);
    }
    while (panel.firstChild) panel.removeChild(panel.firstChild);
    var content = document.createElement('div'); content.style.cssText = 'max-width:640px;margin:10vh auto 30px;';
    var title = document.createElement('h1'); title.id = 'arg-compatibility-title'; title.style.cssText = 'font-size:24px;margin:0 0 18px;'; title.appendChild(document.createTextNode(pending.title));
    var message = document.createElement('p'); message.appendChild(document.createTextNode(pending.message));
    content.appendChild(title); content.appendChild(message);
    if (pending.detail) {
      var detail = document.createElement('p'); detail.style.cssText = 'white-space:pre-wrap;word-break:break-word;color:#c1cfdf;';
      detail.appendChild(document.createTextNode(pending.detail)); content.appendChild(detail);
    }
    for (var i = 0; i < pending.actions.length; i++) {
      (function (action) {
        var button = document.createElement(action.href ? 'a' : 'button');
        if (action.href) button.href = action.href;
        else { button.type = 'button'; button.onclick = function () { action.run(); }; }
        button.appendChild(document.createTextNode(action.label));
        button.style.cssText = 'display:inline-block;margin:10px 12px 0 0;padding:9px 20px;border:1px solid #a7bed5;border-radius:4px;background:#f3f7fb;color:#17324d;font:inherit;text-decoration:none;cursor:pointer;';
        content.appendChild(button);
      })(pending.actions[i]);
    }
    panel.appendChild(content);
    try { panel.focus(); } catch (_) {}
  }
  function showProblem(title, message, detail, actions) {
    pending = { title: title, message: message, detail: detail || '', actions: actions || [{ label: '重新载入', run: function () { location.reload(); } }] };
    if (!pending.actions.length) pending.actions.push({ label: '重新载入', run: function () { location.reload(); } });
    mount();
  }
  api.contains = contains; api.showProblem = showProblem;
  on(document, 'DOMContentLoaded', mount); on(window, 'load', mount);

  // The game calls replaceChildren on Elements only. Keep other optional APIs optional.
  if (window.Element && !Element.prototype.replaceChildren) {
    var replaceChildren = function () {
      var doc = this.ownerDocument || document, fragment = doc.createDocumentFragment();
      for (var i = 0; i < arguments.length; i++) {
        var item = arguments[i];
        fragment.appendChild(item && typeof item.nodeType === 'number' ? item : doc.createTextNode(String(item)));
      }
      while (this.firstChild) this.removeChild(this.firstChild);
      this.appendChild(fragment);
    };
    try { Object.defineProperty(Element.prototype, 'replaceChildren', { configurable: true, writable: true, value: replaceChildren }); }
    catch (_) { Element.prototype.replaceChildren = replaceChildren; }
  }

  // Probe grammar in its own script: an old parser must not prevent this ES5 file
  // from displaying help. This uses normal script loading, not eval/Function.
  var probe = null, probeError = function (event) { if (event.preventDefault) event.preventDefault(); };
  try {
    probe = document.createElement('script');
    var ownScript = document.currentScript;
    if (ownScript && ownScript.getAttribute('nonce')) probe.setAttribute('nonce', ownScript.getAttribute('nonce'));
    if (window.addEventListener) window.addEventListener('error', probeError);
    probe.text = 'window.__argSyntaxProbePassed=(function(){const a={x:1};let {x}={...a};let [b]=[a?.x??0];class C{};async function f(){await 1;}for(const n of [b]){if(n!==x)return false;}return ((...v)=>v[0])(`${b}`)==="1";})();';
    (document.head || document.documentElement).appendChild(probe);
    syntaxReady = window.__argSyntaxProbePassed === true;
  } catch (_) { syntaxReady = false; }
  finally {
    if (probe && probe.parentNode) probe.parentNode.removeChild(probe);
    if (window.removeEventListener) window.removeEventListener('error', probeError);
    try { delete window.__argSyntaxProbePassed; } catch (_) { window.__argSyntaxProbePassed = false; }
  }
  if (!syntaxReady) missing.push('modern JavaScript');
  var checks = [
    ['Promise', window.Promise], ['Map', window.Map], ['Set', window.Set], ['Proxy', window.Proxy],
    ['fetch', window.fetch], ['AbortController', window.AbortController], ['URL', window.URL],
    ['Blob', window.Blob], ['TextEncoder', window.TextEncoder], ['TextDecoder', window.TextDecoder],
    ['MutationObserver', window.MutationObserver], ['queueMicrotask', window.queueMicrotask],
    ['requestAnimationFrame', window.requestAnimationFrame], ['Array.from', Array.from],
    ['Array.includes', Array.prototype.includes], ['Array.find', Array.prototype.find],
    ['Object.assign', Object.assign], ['Object.entries', Object.entries], ['Object.values', Object.values],
    ['Number.isFinite', Number.isFinite], ['Number.isInteger', Number.isInteger], ['Number.isSafeInteger', Number.isSafeInteger],
    ['String.normalize', String.prototype.normalize], ['String.includes', String.prototype.includes],
    ['String.startsWith', String.prototype.startsWith], ['String.endsWith', String.prototype.endsWith], ['String.padStart', String.prototype.padStart]
  ];
  for (var c = 0; c < checks.length; c++) if (typeof checks[c][1] !== 'function') missing.push(checks[c][0]);
  if (!window.Element || !Element.prototype.closest || !Element.prototype.append || !Element.prototype.remove || !Element.prototype.replaceChildren) missing.push('DOM element methods');
  if (!window.URL || !URL.createObjectURL || !URL.revokeObjectURL) missing.push('object URLs');
  api.supported = missing.length === 0 && location.protocol !== 'file:';
  if (api.supported) return;
  window.argCompatibilityBlocked = true;
  if (location.protocol === 'file:') {
    showProblem('请通过网页地址打开游戏', '直接双击本地 HTML 文件时，浏览器可能阻止读取游戏中的其他页面。请通过 HTTP 或 HTTPS 地址打开完整发布目录。', '本地预览：在解压后的发布目录运行 python -m http.server 8000，再访问 http://localhost:8000/。', [
      { label: '打开本地预览', href: 'http://localhost:8000/' },
      { label: '重新检测', run: function () { location.reload(); } }
    ]);
  } else {
    showProblem('当前浏览器暂时无法运行游戏', '请更新电脑上的 Chrome、Edge、Firefox 或 Safari，再重新打开游戏。如果浏览器已更新，请检查是否禁止了此页面运行脚本。', '', [
      { label: '重新检测', run: function () { location.reload(); } }
    ]);
  }
  // Keep the help actions usable even if later game modules fail to initialize.
  if (document.addEventListener) {
    var block = function (event) { if (!contains(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); } };
    var events = ['click', 'dblclick', 'keydown', 'keyup', 'pointerdown', 'mousedown'];
    for (var e = 0; e < events.length; e++) document.addEventListener(events[e], block, true);
  }
})();
