/* dc-lite — محرّك صغير لتشغيل صفحات موقع النهرين بدون أي مكتبة خارجية */
(function () {
  'use strict';
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;
  var EVENTS = { onclick: 'click', oninput: 'input', onchange: 'change', ondragover: 'dragover', ondragleave: 'dragleave', ondrop: 'drop', onanimationend: 'animationend', onsubmit: 'submit', onkeydown: 'keydown' };

  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    if (/^'.*'$/.test(path)) return path.slice(1, -1);
    var parts = path.split('.');
    var v = scope[parts[0]];
    for (var i = 1; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  function interp(str, scope) {
    return str.replace(HOLE, function (_, p) { var v = lookup(p, scope); return v == null ? '' : String(v); });
  }

  function renderNodes(nodes, scope, out) {
    for (var i = 0; i < nodes.length; i++) renderNode(nodes[i], scope, out);
    return out;
  }
  function renderNode(node, scope, out) {
    if (node.nodeType === 3) { out.push(document.createTextNode(interp(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    if (node.localName === 'template' && node.hasAttribute('data-for')) {
      var list = lookup(node.getAttribute('data-for'), scope) || [];
      var as = node.getAttribute('data-as') || 'item';
      for (var k = 0; k < list.length; k++) {
        var sc = Object.create(scope); sc[as] = list[k]; sc.$index = k;
        renderNodes(node.content.childNodes, sc, out);
      }
      return;
    }
    if (node.localName === 'template' && node.hasAttribute('data-if')) {
      if (lookup(node.getAttribute('data-if'), scope)) renderNodes(node.content.childNodes, scope, out);
      return;
    }
    var el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(node.namespaceURI, node.localName) : document.createElement(node.localName);
    el.__h = null; el.__p = null;
    for (var a = 0; a < node.attributes.length; a++) {
      var at = node.attributes[a], name = at.name, val = at.value;
      if (name.indexOf('hint-') === 0) continue;
      var whole = WHOLE.exec(val);
      if (EVENTS[name]) {
        if (whole) { var fn = lookup(whole[1], scope); if (typeof fn === 'function') { (el.__h || (el.__h = {}))[EVENTS[name]] = fn; } }
        continue;
      }
      if (whole && (name === 'value' || name === 'checked')) { (el.__p || (el.__p = {}))[name] = lookup(whole[1], scope); continue; }
      if (whole) {
        var raw = lookup(whole[1], scope);
        if (raw === false || raw == null) { if (name === 'disabled' || raw == null) continue; }
        if (raw === true) { el.setAttribute(name, name === 'disabled' ? '' : 'true'); continue; }
        if (raw === false) { el.setAttribute(name, 'false'); continue; }
        el.setAttribute(name, String(raw));
      } else {
        el.setAttribute(name, val.indexOf('{{') !== -1 ? interp(val, scope) : val);
      }
    }
    if (el.localName === 'video') el.muted = true;
    var kids = renderNodes(node.childNodes, scope, []);
    for (var c = 0; c < kids.length; c++) el.appendChild(kids[c]);
    out.push(el);
  }

  function applyProps(el, p) {
    if (!p) return;
    if ('checked' in p) el.checked = !!p.checked;
    if ('value' in p) { var v = p.value == null ? '' : String(p.value); if (el.value !== v) el.value = v; }
  }
  function morph(old, nu) {
    if (old.nodeType !== nu.nodeType || old.nodeName !== nu.nodeName || old.namespaceURI !== nu.namespaceURI) {
      old.parentNode.replaceChild(nu, old); applyTree(nu); return;
    }
    if (old.nodeType === 3) { if (old.nodeValue !== nu.nodeValue) old.nodeValue = nu.nodeValue; return; }
    if (old.nodeType !== 1) return;
    var i, at;
    for (i = 0; i < nu.attributes.length; i++) { at = nu.attributes[i]; if (old.getAttribute(at.name) !== at.value) old.setAttribute(at.name, at.value); }
    for (i = old.attributes.length - 1; i >= 0; i--) { at = old.attributes[i]; if (!nu.hasAttribute(at.name)) old.removeAttribute(at.name); }
    old.__h = nu.__h;
    var oc = old.childNodes, nc = nu.childNodes;
    var nList = Array.prototype.slice.call(nc);
    for (i = 0; i < nList.length; i++) {
      if (i < oc.length) morph(oc[i], nList[i]);
      else { old.appendChild(nList[i]); applyTree(nList[i]); }
    }
    while (oc.length > nList.length) old.removeChild(old.lastChild);
    applyProps(old, nu.__p);
  }
  function applyTree(el) {
    if (el.nodeType !== 1) return;
    for (var i = 0; i < el.childNodes.length; i++) applyTree(el.childNodes[i]);
    applyProps(el, el.__p);
  }

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch, cb) {
    var p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    var next = {}; var k;
    for (k in this.state) next[k] = this.state[k];
    for (k in p) next[k] = p[k];
    this.state = next;
    if (cb) (this.__cbs || (this.__cbs = [])).push(cb);
    if (this.__schedule) this.__schedule();
  };
  DCLogic.prototype.forceUpdate = function () { if (this.__schedule) this.__schedule(); };
  window.DCLogic = DCLogic;

  function toTemplate(src) {
    return src
      .replace(/<sc-for\b([^>]*)>/g, function (_, a) {
        var l = /list="\{\{\s*([^}]+?)\s*\}\}"/.exec(a), as = /as="([^"]+)"/.exec(a);
        return '<template data-for="' + (l ? l[1] : '') + '" data-as="' + (as ? as[1] : 'item') + '">';
      })
      .replace(/<\/sc-for>/g, '</template>')
      .replace(/<sc-if\b([^>]*)>/g, function (_, a) { var v = /value="\{\{\s*([^}]+?)\s*\}\}"/.exec(a); return '<template data-if="' + (v ? v[1] : 'false') + '">'; })
      .replace(/<\/sc-if>/g, '</template>');
  }

  function boot() {
    var tplEl = document.getElementById('dc-template');
    var codeEl = document.getElementById('dc-logic');
    var app = document.getElementById('app');
    if (!tplEl || !codeEl || !app) return;
    var t = document.createElement('template');
    t.innerHTML = toTemplate(tplEl.textContent);
    var defs = {};
    try { defs = JSON.parse(codeEl.getAttribute('data-props') || '{}'); } catch (e) {}
    var props = {};
    Object.keys(defs).forEach(function (k) { if (k.charAt(0) !== '$' && defs[k] && 'default' in defs[k]) props[k] = defs[k].default; });
    var Component = new Function('DCLogic', codeEl.textContent + '\n;return Component;')(DCLogic);
    var comp = new Component(props);
    var queued = false;
    function render() {
      queued = false;
      var vals = comp.renderVals();
      var nodes = renderNodes(t.content.childNodes, vals, []);
      var frag = document.createElement('div');
      for (var i = 0; i < nodes.length; i++) if (nodes[i].nodeType === 1 || nodes[i].nodeValue.trim()) frag.appendChild(nodes[i]);
      if (!app.firstChild) { while (frag.firstChild) { var n = frag.firstChild; app.appendChild(n); applyTree(n); } }
      else morph(app, (function () { var w = document.createElement('div'); w.id = 'app'; while (frag.firstChild) w.appendChild(frag.firstChild); return w; })());
      var root = app.firstElementChild;
      if (root) { if (root.getAttribute('lang')) document.documentElement.lang = root.getAttribute('lang'); if (root.getAttribute('dir')) document.documentElement.dir = root.getAttribute('dir'); }
      var cbs = comp.__cbs; comp.__cbs = null;
      if (cbs) cbs.forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
    }
    comp.__schedule = function () { if (!queued) { queued = true; Promise.resolve().then(render); } };
    Object.keys(EVENTS).forEach(function (k) {
      var type = EVENTS[k];
      app.addEventListener(type, function (e) {
        var el = e.target;
        while (el && el !== app) { if (el.__h && el.__h[type]) { el.__h[type].call(comp, e); if (e.cancelBubble) break; } el = el.parentNode; }
      }, type === 'animationend' ? false : false);
    });
    render();
    if (comp.componentDidMount) comp.componentDidMount();
    window.addEventListener('pagehide', function () { if (comp.componentWillUnmount) comp.componentWillUnmount(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
