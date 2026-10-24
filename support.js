/* Mini runtime: renders a .dc.html prototype as a standalone web page (Preact). */
(function () {
  var head = document.head || document.getElementsByTagName('head')[0];

  var vp = document.createElement('meta');
  vp.name = 'viewport';
  vp.content = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';
  head.appendChild(vp);

  var theme = document.createElement('meta');
  theme.name = 'theme-color';
  theme.content = '#FFFFFF';
  head.appendChild(theme);

  var css = document.createElement('style');
  css.textContent =
    'x-dc{display:none!important}' +
    'html,body{margin:0;padding:0;background:#E9E8EE;-webkit-tap-highlight-color:transparent}' +
    '#dc-root>div{width:100%!important;max-width:480px;height:100vh!important;height:100dvh!important;margin:0 auto}' +
    '@media (min-width:600px){#dc-root>div{box-shadow:0 0 0 1px rgba(23,22,28,.06),0 20px 60px rgba(23,22,28,.14)}}' +
    '#dc-loading{font:600 15px system-ui,sans-serif;color:#5E5B6B;text-align:center;padding-top:40vh}';
  head.appendChild(css);

  function DCLogic(props) { this.props = props || {}; }
  DCLogic.prototype.setState = function (patch) {
    var prev = this.state || {};
    var p = typeof patch === 'function' ? patch(prev, this.props) : patch;
    this.state = Object.assign({}, prev, p);
    schedule();
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };
  window.DCLogic = DCLogic;

  var HOLE = /\{\{\s*([^}]*?)\s*\}\}/g;
  var SINGLE = /^\s*\{\{\s*([^}]*?)\s*\}\}\s*$/;
  var TEXTISH = { '': 1, text: 1, tel: 1, email: 1, search: 1, number: 1, password: 1, url: 1 };
  var BOOL = { disabled: 1, checked: 1, selected: 1, readonly: 1, required: 1 };

  function lookup(scope, path) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var q = path.match(/^(['"])(.*)\1$/);
    if (q) return q[2];
    var parts = path.split('.');
    var v = scope[parts[0]];
    for (var i = 1; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }
  function interp(str, scope) {
    return str.replace(HOLE, function (_, p) { var v = lookup(scope, p); return v == null ? '' : String(v); });
  }
  function attrVal(str, scope) {
    var m = str.match(SINGLE);
    if (m) return lookup(scope, m[1]);
    return str.indexOf('{{') >= 0 ? interp(str, scope) : str;
  }

  var h, tplRoot, inst, container, pending = false, mounted = false;

  function kids(node, scope, out) {
    for (var c = node.firstChild; c; c = c.nextSibling) build(c, scope, out);
  }
  function build(node, scope, out) {
    if (node.nodeType === 3) {
      var t = node.nodeValue;
      out.push(t.indexOf('{{') >= 0 ? interp(t, scope) : t);
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'helmet' || tag === 'script') return;
    if (tag === 'sc-if') {
      if (attrVal(node.getAttribute('value') || '', scope)) kids(node, scope, out);
      return;
    }
    if (tag === 'sc-for') {
      var list = attrVal(node.getAttribute('list') || '', scope) || [];
      var as = node.getAttribute('as') || 'item';
      for (var i = 0; i < list.length; i++) {
        var sc = Object.create(scope);
        sc[as] = list[i];
        sc.$index = i;
        kids(node, sc, out);
      }
      return;
    }
    var props = {};
    var type = (node.getAttribute('type') || '').toLowerCase();
    for (var a = 0; a < node.attributes.length; a++) {
      var at = node.attributes[a];
      var n = at.name;
      if (n.indexOf('hint-') === 0) continue;
      var val = attrVal(at.value, scope);
      if (n.length > 2 && n.slice(0, 2).toLowerCase() === 'on') {
        if (typeof val !== 'function') continue;
        var ev = n.slice(2).toLowerCase();
        if (ev === 'change' && (tag === 'textarea' || (tag === 'input' && TEXTISH[type]))) ev = 'input';
        props['on' + ev] = val;
        continue;
      }
      if (BOOL[n]) {
        props[n] = at.value === '' || at.value === n ? true : !!val;
        continue;
      }
      if (n === 'value') { props.value = val == null ? '' : val; continue; }
      if (val === false || val == null) continue;
      props[n] = val;
    }
    var children = [];
    if (tag !== 'textarea') kids(node, scope, children);
    out.push(h(tag, props, children));
  }

  function render() {
    var vals = inst.renderVals ? inst.renderVals() || {} : {};
    var out = [];
    kids(tplRoot, vals, out);
    preact.render(h(preact.Fragment, null, out), container);
    if (!mounted) {
      mounted = true;
      if (inst.componentDidMount) inst.componentDidMount();
    }
  }
  function schedule() {
    if (pending || !inst) return;
    pending = true;
    Promise.resolve().then(function () { pending = false; render(); });
  }

  function boot() {
    var x = document.querySelector('x-dc');
    var sEl = document.querySelector('script[data-dc-script]');
    if (!x || !sEl) return;
    var helmet = x.querySelector('helmet');
    if (helmet) {
      Array.prototype.forEach.call(helmet.children, function (el) { head.appendChild(el.cloneNode(true)); });
    }
    var props = {};
    try {
      var dp = JSON.parse(sEl.getAttribute('data-props') || '{}');
      Object.keys(dp).forEach(function (k) { if (k[0] !== '$' && dp[k] && 'default' in dp[k]) props[k] = dp[k].default; });
    } catch (e) { /* no tweaks */ }
    var Comp = new Function('DCLogic', sEl.textContent + '\n;return Component;')(DCLogic);
    tplRoot = x;
    x.parentNode.removeChild(x);
    var loading = document.getElementById('dc-loading');
    if (loading) loading.parentNode.removeChild(loading);
    container = document.createElement('div');
    container.id = 'dc-root';
    document.body.appendChild(container);
    h = preact.h;
    inst = new Comp(props);
    render();
  }

  function whenReady() {
    if (window.preact) { boot(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/preact@10.24.3/dist/preact.umd.js';
    s.onload = boot;
    head.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', whenReady);
  else whenReady();
})();
