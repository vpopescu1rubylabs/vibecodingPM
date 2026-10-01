/* Zendocs editor: "Guided fill" page editor for the NAT 3092 TFN declaration.
   The form is a fixed 1024x1449 page with fields positioned on it. Clicking a question zooms it to a card.
   Everything runs locally. No network requests, no eval, user text only via textContent / .value.
   Public API: window.ZDEditor (see bottom). */
(function () {
  'use strict';
  var ZD = window.ZD || {};
  var PW = 1024, PH = 1449;
  var INK = '#111a4a';
  var MONO = "'Roboto Mono',ui-monospace,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";
  var DL_HINT = "Delete the downloaded file after you've sent it to your employer; send it by a secure channel, not plain email.";
  var NOTICE = 'Answers are saved on this device for 24 hours. Your TFN, date of birth, email and signature are never saved.';
  var REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var MAXK = 2.0;   // raster zoom cap. TODO(vector): lift to 2.4 once renderCardArtwork draws a vector redraw.

  var FJ = null, IMG = null, FIELD = {}, STEPS = [], BANDS = [];
  var values = {};
  var guided = true;
  var cur = -1;                 // open step index, -1 = none
  var scale = 1;                // page scale on the canvas
  var views = {};               // fieldId -> [view]
  var notes = {};               // fieldId -> transient message (dropped chars, overflow)
  var errs = {}, warns = {};    // current card messages
  var listeners = {};
  var canvasEl, sizer, pageEl, fieldLayer, hotLayer, hots = [];
  var ov = null;                // open overlay record
  var reviewEl = null, toastEl = null, toastTimer = null;
  var noticeShown = false, buildingCard = false, cardK = 0;
  var overflow = {};            // fieldId -> true while a too-long entry was cut off and not yet corrected
  var ready = false, pending = [];

  /* ---------- helpers ---------- */
  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.setAttribute('style', v);
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) e.appendChild(x); });
      else e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }
  function px(o, props) { Object.keys(props).forEach(function (k) { o.style[k] = props[k] + 'px'; }); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function hasVal(v) { return v !== undefined && v !== null && v !== '' && v !== false; }
  function isDataUrl(s) { return typeof s === 'string' && /^data:image\//.test(s); }
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return function () { listeners[evt] = listeners[evt].filter(function (f) { return f !== fn; }); }; }
  function emit(evt, a) { (listeners[evt] || []).slice().forEach(function (fn) { try { fn(a); } catch (e) { /* listener errors never break the editor */ } }); }
  function isMobile() { return window.innerWidth < 768; }
  function stripTrail(s) { return String(s || '').replace(/\s+$/, ''); }

  /* ---------- boot ---------- */
  function loadFields() {
    var node = document.getElementById('fields-json');
    var txt = node && node.textContent.trim();
    if (txt) { try { return Promise.resolve(JSON.parse(txt)); } catch (e) { /* fall through */ } }
    if (window.ZD_FIELDS) return Promise.resolve(window.ZD_FIELDS);
    return Promise.reject(new Error('fields'));
  }
  function loadImage(src) {
    return new Promise(function (res, rej) {
      var tries = [window.ZD_IMAGE_SRC, src, '../src/' + src].filter(Boolean), i = 0;
      (function nextTry() {
        if (i >= tries.length) return rej(new Error('image'));
        var im = new Image();
        im.onload = function () { res(im); };
        im.onerror = nextTry;
        im.src = tries[i++];
      })();
    });
  }
  function whenDom(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }

  whenDom(function () {
    loadFields().then(function (fj) {
      FJ = fj;
      FJ.fields.forEach(function (f) { FIELD[f.id] = f; });
      STEPS = FJ.steps;
      return loadImage(FJ.image.src);
    }).then(function (im) { IMG = im; init(); }).catch(function () {
      var c = document.getElementById('zd-canvas');
      if (c) c.appendChild(h('p', { class: 'zde-fail', role: 'alert', text: 'Could not load the form. Please reload the page. Nothing has been sent anywhere.' }));
    });
  });

  function init() {
    canvasEl = document.getElementById('zd-canvas');
    if (!canvasEl) { canvasEl = h('div', { id: 'zd-canvas' }); document.body.appendChild(canvasEl); }
    try { guided = localStorage.getItem('zd-focus-mode') !== '0'; } catch (e) { guided = true; }
    try { var saved = ZD.store && ZD.store.load && ZD.store.load(); if (saved) values = saved; } catch (e) { values = {}; }
    computeBands();
    hist = [snap()]; hi = 0;
    buildPage();
    layoutPage();
    if (window.ResizeObserver) new ResizeObserver(layoutPage).observe(canvasEl);
    var lastW = window.innerWidth, lastH = window.innerHeight;
    window.addEventListener('resize', function () {
      layoutPage();
      var w = window.innerWidth, hh = window.innerHeight;
      if (w === lastW && hh === lastH) return;
      lastW = w; lastH = hh;
      if (ov) relayout();   // rotation, window resize, on-screen keyboard
    });
    document.addEventListener('keydown', onKey, true);
    applyGuided();
    ready = true;
    pending.splice(0).forEach(function (fn) { fn(); });
    emit('change');
  }

  /* ---------- question bands (page space) ---------- */
  var COL = { L: [12, 498], R: [516, 498] };
  // Measured vertical extents (page px) of each question block; x always spans the whole column.
  var BAND_Y = {
    A1: ['L', 158, 322], A2: ['L', 326, 503], A3: ['L', 507, 697], A4: ['L', 701, 781],
    A5: ['R', 135, 240], A6: ['R', 244, 294], A7: ['R', 299, 361], A8: ['R', 366, 423], A9: ['R', 428, 542],
    A10: ['R', 547, 638], A11: ['R', 644, 745],
    B1: ['L', 851, 914], B2: ['L', 918, 958], B3: ['L', 962, 1113], B4: ['L', 1118, 1322],
    B5: ['R', 842, 944], B6: ['R', 948, 1046], B7: ['R', 1049, 1101], B8: ['R', 1105, 1198]
  };
  function fieldBounds(f) {
    var rs = (f.boxes || []).concat((f.options || []).map(function (o) { return o.rect; }), f.rect ? [f.rect] : []);
    if (!rs.length) return null;
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    rs.forEach(function (r) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function computeBands() {
    BANDS = STEPS.map(function (st) {
      var o = BAND_Y[st.id], bs = st.fieldIds.map(function (id) { return fieldBounds(FIELD[id]); }).filter(Boolean);
      var ux0 = Math.min.apply(0, bs.map(function (r) { return r.x; })), uy0 = Math.min.apply(0, bs.map(function (r) { return r.y; }));
      var ux1 = Math.max.apply(0, bs.map(function (r) { return r.x + r.w; })), uy1 = Math.max.apply(0, bs.map(function (r) { return r.y + r.h; }));
      var col = o ? o[0] : ((ux0 + ux1) / 2 < 512 ? 'L' : 'R');
      var y0 = o ? o[1] : uy0 - 26, y1 = o ? o[2] : uy1 + 8;
      // never let a measured band cut off a field: grow it to include every field of the step
      y0 = Math.min(y0, uy0 - 6); y1 = Math.max(y1, uy1 + 6);
      var wide = ux0 < 512 && ux1 > 512;   // a field spanning both columns -> full width
      var x0 = wide ? 12 : COL[col][0], w = wide ? 1002 : COL[col][1];
      return { x: x0, y: y0, w: w, h: y1 - y0, col: col };
    });
  }
  function stepMeta(i) {
    var st = STEPS[i], m = /^([AB])(\d+)$/.exec(st.id) || [];
    var n = Number(m[2] || 0), decl = (st.section === 'A' && n === 11) || (st.section === 'B' && n === 8);
    return { section: st.section, num: n, decl: decl, label: 'Section ' + st.section + ' · ' + (decl ? 'Declaration' : 'Question ' + n) };
  }
  function stepOfField(id) { for (var i = 0; i < STEPS.length; i++) if (STEPS[i].fieldIds.indexOf(id) >= 0) return i; return -1; }

  /* ---------- values, history ---------- */
  var hist = [], hi = 0, histTimer = null;
  function snap() { return JSON.stringify(values); }
  function flushHist() {
    if (histTimer) { clearTimeout(histTimer); histTimer = null; }
    var s = snap();
    if (s === hist[hi]) return;
    hist.length = hi + 1; hist.push(s); hi++;
    if (hist.length > 60) { hist.shift(); hi--; }
  }
  function persist() { try { if (ZD.store && ZD.store.save) ZD.store.save(values); } catch (e) {} }
  function setValue(id, v, opts) {
    opts = opts || {};
    if (v === '' || v === false || v == null) delete values[id]; else values[id] = v;
    persist();
    refreshField(id, opts.src);
    if (histTimer) clearTimeout(histTimer);
    if (opts.immediate) flushHist(); else histTimer = setTimeout(function () { flushHist(); emit('change'); }, 700);
    emit('change');
    if (ov) updateNextLabel();
  }
  function refreshField(id, except) { (views[id] || []).forEach(function (v) { if (v !== except) v.refresh(); else if (v.refreshSelf) v.refreshSelf(); }); }
  function refreshAll() { Object.keys(views).forEach(function (id) { refreshField(id); }); if (ov) updateNextLabel(); }
  function restore(s) { values = JSON.parse(s); overflow = {}; persist(); refreshAll(); errs = {}; warns = {}; if (ov) paintMsgs(); }
  function undo() { flushHist(); if (hi <= 0) return false; hi--; restore(hist[hi]); emit('change'); return true; }
  function redo() { flushHist(); if (hi >= hist.length - 1) return false; hi++; restore(hist[hi]); emit('change'); return true; }
  function canUndo() { return hi > 0 || snap() !== hist[hi]; }
  function canRedo() { return hi < hist.length - 1 && snap() === hist[hi]; }
  function reset() {
    if (histTimer) { clearTimeout(histTimer); histTimer = null; }
    values = {}; notes = {}; errs = {}; warns = {}; overflow = {};
    hist = [snap()]; hi = 0;
    try { ZD.store && ZD.store.clear && ZD.store.clear(); } catch (e) {}
    refreshAll(); if (ov) paintMsgs();
    emit('change');
  }

  /* ---------- typed characters: fold to what the printed form can show ---------- */
  var LIGS = { 'ß': 'SS', 'æ': 'AE', 'œ': 'OE', 'ø': 'O', 'đ': 'D', 'ł': 'L', 'þ': 'TH', 'ı': 'I' };
  function foldChar(ch) {
    if (/[‘’ʼ´`]/.test(ch)) return "'";
    if (/[‐-―−]/.test(ch)) return '-';
    if (/[  - 　\t]/.test(ch)) return ' ';
    if (/[​-‍﻿]/.test(ch)) return '';
    if (ch.charCodeAt(0) < 128) return ch;
    var lo = ch.toLowerCase();
    if (LIGS[lo]) return LIGS[lo];
    var d = ch.normalize ? ch.normalize('NFD').replace(/[̀-ͯ]/g, '') : ch;
    return /^[\x20-\x7e]+$/.test(d) ? d : null;
  }
  function charsetOf(f) { return f.charset || (f.type === 'date' ? 'digits' : 'any'); }
  function clean(f, raw) {
    var cs = charsetOf(f), out = '', drop = [];
    Array.from(String(raw == null ? '' : raw).replace(/[\r\n]+/g, ' ')).forEach(function (c0) {
      var c = cs === 'digits' ? c0 : foldChar(c0);
      if (c === null) { drop.push(c0); return; }
      Array.from(c).forEach(function (ch) {
        if (ch === ' ') {
          if (cs !== 'digits' && cs !== 'email' && out !== '' && out.slice(-1) !== ' ') out += ' ';
          return;
        }
        var ok = cs === 'digits' ? /[0-9]/.test(ch)
          : cs === 'alpha' ? /[A-Za-z'\-]/.test(ch)
          : cs === 'alnum' ? /[A-Za-z0-9]/.test(ch)
          : cs === 'email' ? /[\x21-\x7e]/.test(ch)
          : /[\x21-\x7e]/.test(ch);
        if (ok) out += cs === 'email' ? ch.toLowerCase() : ch.toUpperCase();
        else if (!(cs === 'digits' && /[\-.\/]/.test(ch))) drop.push(ch);
      });
    });
    return { v: out, dropped: drop };
  }
  function droppedMsg(f, drop) {
    var u = drop.filter(function (c, i, a) { return a.indexOf(c) === i; }).slice(0, 6).join(' ');
    if (charsetOf(f) === 'digits') return 'Only numbers go in these boxes – ' + u + ' was left out.';
    if (charsetOf(f) === 'alpha') return 'Left out ' + u + ' – these boxes take letters, spaces, hyphens and apostrophes (accents are simplified, so é becomes E).';
    return 'Left out ' + u + ' – that character can’t be printed on the form.';
  }

  /* ---------- field views ---------- */
  function register(id, v) { (views[id] = views[id] || []).push(v); return v; }
  function unregister(list) { list.forEach(function (v) { var a = views[v.id]; if (a) { var k = a.indexOf(v); if (k >= 0) a.splice(k, 1); } }); }
  function setNote(id, msg) { if (msg) notes[id] = msg; else delete notes[id]; if (ov) paintMsgs(); else if (msg) toast(msg, 5000); }

  function makeView(f) {
    if (f.type === 'boxes' || f.type === 'date') return boxesView(f);
    if (f.type === 'choice') return choiceView(f);
    if (f.type === 'checkbox') return checkView(f);
    if (f.type === 'signature') return sigView(f);
    return null;
  }

  function boxesView(f) {
    var bs = f.boxes, n = bs.length, b = fieldBounds(f), cs = charsetOf(f);
    var wrap = h('div', { class: 'zde-f zde-boxes', 'data-fid': f.id });
    px(wrap, { left: b.x, top: b.y, width: b.w, height: b.h });
    var glyphs = bs.map(function (c) {
      var g = h('span', { class: 'zde-g', 'aria-hidden': 'true' });
      px(g, { left: c.x - b.x, top: c.y - b.y, width: c.w, height: c.h, fontSize: Math.round(c.h * 0.62), lineHeight: c.h });
      wrap.appendChild(g); return g;
    });
    var caret = h('span', { class: 'zde-caret', 'aria-hidden': 'true' });
    wrap.appendChild(caret);
    var inp = h('input', {
      class: 'zde-in', type: 'text', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
      autocapitalize: cs === 'email' ? 'off' : 'characters',
      inputmode: cs === 'digits' ? 'numeric' : (cs === 'email' ? 'email' : 'text'),
      'aria-label': f.label + ' (' + n + ' boxes)', 'data-fid': f.id, enterkeyhint: 'next'
    });
    wrap.appendChild(inp);
    var view = { id: f.id, el: wrap, input: inp, card: buildingCard };

    function paintGlyphs() {
      var s = values[f.id] || '';
      for (var i = 0; i < n; i++) { var c = s.charAt(i); glyphs[i].textContent = c === ' ' ? '' : c; }
    }
    function paintCaret() {
      if (document.activeElement !== inp) { caret.style.display = 'none'; wrap.classList.remove('zde-focus'); return; }
      wrap.classList.add('zde-focus');
      var pos = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
      var i = Math.min(pos, n - 1), c = bs[i];
      caret.style.display = 'block';
      px(caret, { left: c.x - b.x, top: c.y - b.y, width: c.w, height: c.h });
    }
    view.refresh = function () {
      var v = values[f.id] || '';
      if (stripTrail(inp.value) !== v) inp.value = v;
      paintGlyphs(); paintCaret();
      inp.setAttribute('aria-invalid', view.card && errs[f.id] ? 'true' : 'false');
    };
    view.refreshSelf = function () { paintGlyphs(); paintCaret(); inp.setAttribute('aria-invalid', view.card && errs[f.id] ? 'true' : 'false'); };

    function handle(ev) {
      var raw = inp.value, caretPos = inp.selectionStart == null ? raw.length : inp.selectionStart;
      var r = clean(f, raw), cp = clean(f, raw.slice(0, caretPos)).v.length, v = r.v, over = false;
      if (v.length > n) {
        var extra = v.length - n;
        if (ev && ev.inputType === 'insertText' && cp < v.length) v = v.slice(0, cp) + v.slice(cp + extra);   // typing into a filled box overwrites, like a printed form
        else { v = v.slice(0, n); over = true; }
      }
      cp = Math.min(cp, v.length);
      inp.value = v;
      try { inp.setSelectionRange(cp, cp); } catch (e) {}
      if (over) overflow[f.id] = true; else delete overflow[f.id];
      if (over) setNote(f.id, 'Only ' + n + ' characters fit in these boxes – the rest was left off. ' + (cs === 'email' ? 'Use a shorter address, or leave it blank (optional).' : 'Please shorten it, for example with an abbreviation.'));
      else if (r.dropped.length) setNote(f.id, droppedMsg(f, r.dropped));
      else if (notes[f.id]) setNote(f.id, '');
      setValue(f.id, stripTrail(v), { src: view });
      if (errs[f.id]) liveRecheck();
      paintGlyphs(); paintCaret();
      var typed = ev && ev.inputType && ev.inputType.indexOf('insert') === 0;
      if (typed && v.length === n && cp === n) focusSibling(inp, 1, false);
    }
    inp.addEventListener('input', function (ev) { if (ev.isComposing) return; handle(ev); });
    inp.addEventListener('compositionend', function () { handle(null); });
    ['focus', 'blur', 'keyup', 'select', 'mouseup'].forEach(function (t) { inp.addEventListener(t, paintCaret); });
    inp.addEventListener('focus', function () { setTimeout(paintCaret, 0); });
    inp.addEventListener('click', function (e) {   // place the caret in the cell that was clicked
      var r = inp.getBoundingClientRect(); if (!r.width) return;
      var k = r.width / b.w, lx = (e.clientX - r.left) / k + b.x, ly = (e.clientY - r.top) / k + b.y, best = 0, bd = 1e9;
      bs.forEach(function (c, i) { var dx = lx - (c.x + c.w / 2), dy = ly - (c.y + c.h / 2), d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } });
      var p = Math.min(best, inp.value.length);
      try { inp.setSelectionRange(p, p); } catch (er) {}
      paintCaret();
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' && inp.value === '' ) { e.preventDefault(); focusSibling(inp, -1, true); }
    });
    inp.addEventListener('paste', function (e) {   // whole TFN / ABN / email in one go
      var t = e.clipboardData && e.clipboardData.getData('text');
      if (t == null) return;
      e.preventDefault();
      var s = inp.selectionStart || 0, en = inp.selectionEnd == null ? s : inp.selectionEnd;
      inp.value = inp.value.slice(0, s) + t + inp.value.slice(en);
      var np = s + clean(f, t).v.length;
      try { inp.setSelectionRange(np, np); } catch (er) {}
      handle({ inputType: 'insertFromPaste' });
    });
    view.refresh();
    return view;
  }

  function scopeInputs(from) {
    var scope = from.closest('.zde-scope') || document;
    return Array.prototype.slice.call(scope.querySelectorAll('input.zde-in, input.zde-sig-in')).filter(function (i) { return i.offsetParent !== null || i === from; });
  }
  function focusSibling(from, dir, toEnd) {
    var list = scopeInputs(from), k = list.indexOf(from), t = list[k + dir];
    if (!t) return false;
    try { t.focus({ preventScroll: true }); if (toEnd) t.setSelectionRange(t.value.length, t.value.length); else t.setSelectionRange(0, 0); } catch (e) {}
    return true;
  }

  // Tap targets: inside a zoom card a 21px radio shrinks with the card, so grow its hit area to ~44 CSS px
  // without letting it reach the neighbouring option.
  function hitRect(f, r) {
    var w = r.w + 6, h2 = r.h + 6, x = r.x - 3, y = r.y - 3;
    if (!buildingCard || !cardK) return { x: x, y: y, w: w, h: h2 };
    var S = Math.min(70, 44 / cardK), cx = r.x + r.w / 2, cy = r.y + r.h / 2, hw = Math.max(S, w) / 2, hh = Math.max(S, h2) / 2;
    var si = stepOfField(f.id), ids = si >= 0 ? STEPS[si].fieldIds : [];
    ids.forEach(function (id) {
      var g = FIELD[id]; if (!g || !g.options) return;
      g.options.forEach(function (o2) {
        var q = o2.rect; if (q === r) return;
        var dx = Math.abs(q.x + q.w / 2 - cx), dy = Math.abs(q.y + q.h / 2 - cy);
        if (dy < 2 * hh && dx < 2 * hw) { if (dx >= dy) hw = Math.min(hw, Math.max(dx / 2 - 0.5, 6)); else hh = Math.min(hh, Math.max(dy / 2 - 0.5, 6)); }
      });
    });
    return { x: cx - hw, y: cy - hh, w: 2 * hw, h: 2 * hh };
  }
  var EXEMPT = ['tfn_applied', 'tfn_under18', 'tfn_pension'];
  function choiceView(f) {
    var wrap = h('div', { class: 'zde-f zde-choice', role: 'radiogroup', 'aria-label': f.label, 'data-fid': f.id });
    var btns = f.options.map(function (o) {
      var r = o.rect, bt = h('button', { type: 'button', class: 'zde-opt', role: 'radio', 'aria-checked': 'false', 'aria-label': o.label, 'data-val': o.value });
      var hr = hitRect(f, r);
      px(bt, { left: hr.x, top: hr.y, width: hr.w, height: hr.h });
      bt.appendChild(h('span', { class: 'zde-dot', 'aria-hidden': 'true' }));
      bt.addEventListener('click', function () {
        var was = values[f.id] === o.value;
        setValue(f.id, was ? '' : o.value, { immediate: true });
        if (errs[f.id]) liveRecheck();
      });
      bt.addEventListener('keydown', function (e) {
        var k = btns.indexOf(bt), d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0);
        if (d) { e.preventDefault(); e.stopPropagation(); var t = btns[(k + d + btns.length) % btns.length]; t.focus({ preventScroll: true }); }
      });
      wrap.appendChild(bt); return bt;
    });
    var view = { id: f.id, el: wrap, card: buildingCard };
    view.refresh = view.refreshSelf = function () {
      var v = values[f.id];
      btns.forEach(function (bt, i) {
        var on_ = f.options[i].value === v;
        bt.setAttribute('aria-checked', on_ ? 'true' : 'false');
        bt.tabIndex = on_ || (!hasVal(v) && i === 0) ? 0 : -1;
      });
      wrap.setAttribute('aria-invalid', view.card && errs[f.id] ? 'true' : 'false');
    };
    view.refresh();
    return view;
  }

  function checkView(f) {
    var o = f.options[0], r = o.rect;
    var wrap = h('div', { class: 'zde-f zde-check', 'data-fid': f.id });
    var bt = h('button', { type: 'button', class: 'zde-chk', role: 'checkbox', 'aria-checked': 'false', 'aria-label': f.label });
    var hr = hitRect(f, r);
    px(bt, { left: hr.x, top: hr.y, width: hr.w, height: hr.h });
    var s = Math.max(8, Math.min(r.w, r.h) - 8);
    bt.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true" focusable="false" style="width:' + s + 'px;height:' + s + 'px"><path d="M1.5 1.5 8.5 8.5M8.5 1.5 1.5 8.5" fill="none" stroke="' + INK + '" stroke-width="1.5" stroke-linecap="round"/></svg>';
    bt.addEventListener('click', function () {
      var on_ = values[f.id] !== true;
      if (on_ && EXEMPT.indexOf(f.id) >= 0) EXEMPT.forEach(function (id) { if (id !== f.id && values[id]) setValue(id, false, { immediate: true }); });
      setValue(f.id, on_, { immediate: true });
      if (errs[f.id] || EXEMPT.indexOf(f.id) >= 0) liveRecheck();
    });
    wrap.appendChild(bt);
    var view = { id: f.id, el: wrap, card: buildingCard };
    view.refresh = view.refreshSelf = function () { bt.setAttribute('aria-checked', values[f.id] === true ? 'true' : 'false'); };
    view.refresh();
    return view;
  }

  var measureCtx = null;
  function fitFont(text, r) {
    var size = Math.max(10, Math.round(r.h * 0.6)), avail = r.w * 0.82, cursive = (ZD.render && ZD.render.CURSIVE) || 'cursive';
    if (!text) return size;
    try {
      measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
      measureCtx.font = 'italic ' + size + 'px ' + cursive;
      var w = measureCtx.measureText(text).width;
      if (w > avail && w > 0) size = Math.max(8, Math.floor(size * avail / w));
    } catch (e) { size = Math.max(8, Math.min(size, Math.floor(avail / (text.length * 0.5)))); }
    return size;
  }
  function sigView(f) {
    var r = f.rect, cursive = (ZD.render && ZD.render.CURSIVE) || 'cursive', inCard = buildingCard;
    var wrap = h('div', { class: 'zde-f zde-sig', 'data-fid': f.id });
    px(wrap, { left: r.x, top: r.y, width: r.w, height: r.h });
    var img = h('img', { class: 'zde-sig-img', alt: 'Your drawn signature', draggable: 'false' });
    var inp = h('input', { class: 'zde-sig-in', type: 'text', maxlength: '60', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': f.label + ' (type your name)', 'data-fid': f.id });
    inp.style.fontFamily = cursive; inp.style.paddingLeft = Math.round(r.w * 0.16) + 'px'; inp.style.height = r.h + 'px';
    // in a zoom card the pad and the Type/Draw/Clear buttons live below the card at full size (finger friendly)
    var CW = inCard ? 900 : r.w * 3, CH = inCard ? 300 : r.h * 3, LW = inCard ? 7 : 5;
    var cv = h('canvas', { class: inCard ? 'zde-pad-cv' : 'zde-sig-cv', role: 'img', 'aria-label': 'Signature pad. Draw with your finger or mouse.', width: String(CW), height: String(CH) });
    var bType = h('button', { type: 'button', class: inCard ? 'zde-btn zde-secondary zde-segm' : 'zde-seg', 'aria-pressed': 'true', text: 'Type' });
    var bDraw = h('button', { type: 'button', class: inCard ? 'zde-btn zde-secondary zde-segm' : 'zde-seg', 'aria-pressed': 'false', text: 'Draw' });
    var bClear = h('button', { type: 'button', class: inCard ? 'zde-btn zde-secondary zde-segm zde-clearm' : 'zde-seg zde-clear', text: 'Clear' });
    var tog = h('div', { class: inCard ? 'zde-sigctl' : 'zde-sigtog', role: 'group', 'aria-label': 'Signature method' }, bType, bDraw, bClear);
    var padWrap = null;
    wrap.appendChild(img); wrap.appendChild(inp);
    var view = { id: f.id, el: wrap, input: inp, card: inCard };
    if (inCard) {
      padWrap = h('div', { class: 'zde-padwrap' }, cv);
      padWrap.hidden = true;
      view.controls = tog; view.pad = padWrap;
    } else { wrap.appendChild(cv); wrap.appendChild(tog); }
    var mode = isDataUrl(values[f.id]) ? 'draw' : 'type';

    function paintMode() {
      bType.setAttribute('aria-pressed', mode === 'type' ? 'true' : 'false');
      bDraw.setAttribute('aria-pressed', mode === 'draw' ? 'true' : 'false');
      wrap.classList.toggle('zde-draw', mode === 'draw');
      if (padWrap) padWrap.hidden = mode !== 'draw';
      bClear.style.display = hasVal(values[f.id]) ? '' : 'none';
      if (inCard && ov && ov.L && ov.views && ov.views.indexOf(view) >= 0) fitStack(ov.L);
    }
    function fit() { inp.style.fontSize = fitFont(inp.value, r) + 'px'; }
    var ctx = cv.getContext('2d'), drawing = false, last = null, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, started = false, saved = null;
    function resetPad() { ctx.clearRect(0, 0, cv.width, cv.height); started = false; minX = minY = 1e9; maxX = maxY = -1; }
    ctx.lineWidth = LW; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = INK; ctx.fillStyle = INK;
    function paintImg() {   // the saved picture shows between strokes; while drawing, the live strokes on the pad show instead
      var d = isDataUrl(values[f.id]);
      if (d && img.getAttribute('src') !== values[f.id]) img.src = values[f.id];
      if (!d) img.removeAttribute('src');
      img.style.display = d && (inCard || !drawing) ? 'block' : 'none';
      cv.style.opacity = !inCard && d && !drawing ? '0' : '';
    }
    view.refresh = function () {
      var v = values[f.id];
      if (isDataUrl(v)) { inp.value = ''; if (mode === 'type' && document.activeElement !== inp) mode = 'draw'; }
      else if (stripTrail(inp.value) !== (v || '')) inp.value = v || '';
      if (!isDataUrl(v) || v !== saved) resetPad();   // changed from outside (undo, clear, start over): the pad restarts
      paintImg(); fit(); paintMode();
      inp.setAttribute('aria-invalid', view.card && errs[f.id] ? 'true' : 'false');
    };
    view.refreshSelf = function () { paintMode(); paintImg(); inp.setAttribute('aria-invalid', view.card && errs[f.id] ? 'true' : 'false'); };
    inp.addEventListener('input', function () {
      var t = inp.value.replace(/[\r\n]+/g, ' ').replace(/^\s+/, '');
      if (t !== inp.value) inp.value = t;
      fit();
      setValue(f.id, stripTrail(t), { src: view });
      if (errs[f.id]) liveRecheck();
    });
    bType.addEventListener('click', function () { mode = 'type'; paintMode(); inp.focus({ preventScroll: true }); });
    bDraw.addEventListener('click', function () { mode = 'draw'; paintMode(); });
    bClear.addEventListener('click', function () { setValue(f.id, '', { immediate: true }); inp.value = ''; resetPad(); saved = null; if (errs[f.id]) liveRecheck(); if (mode === 'type') inp.focus({ preventScroll: true }); else bDraw.focus({ preventScroll: true }); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Backspace' && inp.value === '') { e.preventDefault(); focusSibling(inp, -1, true); } });
    inp.addEventListener('focus', function () { mode = 'type'; paintMode(); });

    // drawing pad: strokes accumulate until Clear; the cropped picture of all strokes is what is saved
    function pt(e) { var b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) * cv.width / b.width, y: (e.clientY - b.top) * cv.height / b.height }; }
    function bound(p) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    cv.addEventListener('pointerdown', function (e) {
      e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      if (!started) { if (hasVal(values[f.id])) setValue(f.id, '', { immediate: true }); resetPad(); started = true; }
      drawing = true; paintImg(); last = pt(e); ctx.beginPath(); ctx.arc(last.x, last.y, LW / 2, 0, 7); ctx.fill(); bound(last);
    });
    cv.addEventListener('pointermove', function (e) {
      if (!drawing) return; e.preventDefault();
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      (evs.length ? evs : [e]).forEach(function (ev) { var p = pt(ev); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; bound(p); });
    });
    function end() {
      if (!drawing) return; drawing = false;
      var pad = 8, x0 = Math.max(0, minX - pad), y0 = Math.max(0, minY - pad), x1 = Math.min(cv.width, maxX + pad), y1 = Math.min(cv.height, maxY + pad);
      var w = Math.max(4, Math.round(x1 - x0)), hh = Math.max(4, Math.round(y1 - y0)), o = document.createElement('canvas');
      o.width = w; o.height = hh; o.getContext('2d').drawImage(cv, x0, y0, w, hh, 0, 0, w, hh);
      saved = o.toDataURL('image/png');
      setValue(f.id, saved, { immediate: true, src: view }); if (errs[f.id]) liveRecheck();
    }
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    view.refresh();
    return view;
  }

  /* ---------- page ---------- */
  function buildPage() {
    sizer = h('div', { class: 'zde-sizer', id: 'zde-root' });
    pageEl = h('div', { class: 'zde-page' });
    var art = IMG.cloneNode(); art.className = 'zde-art'; art.alt = 'Tax file number declaration form (NAT 3092), page 1'; art.draggable = false;
    art.style.width = PW + 'px'; art.style.height = PH + 'px';
    pageEl.appendChild(art);
    fieldLayer = h('div', { class: 'zde-fields' });
    FJ.fields.forEach(function (f) { var v = makeView(f); if (v) { register(f.id, v); fieldLayer.appendChild(v.el); } });
    hotLayer = h('div', { class: 'zde-hots' });
    BANDS.forEach(function (b, i) {
      var m = stepMeta(i);
      var bt = h('button', { type: 'button', class: 'zde-hot', 'aria-label': m.label + ': ' + STEPS[i].title, title: STEPS[i].title });
      px(bt, { left: b.x, top: b.y, width: b.w, height: b.h });
      bt.addEventListener('click', function () { open(i); });
      hotLayer.appendChild(bt); hots.push(bt);
    });
    pageEl.appendChild(fieldLayer); pageEl.appendChild(hotLayer);
    sizer.appendChild(pageEl);
    canvasEl.appendChild(sizer);
    // typing on the page: undo/redo keys act on the form, not the browser's per-input history
    fieldLayer.addEventListener('keydown', pageKey);
  }
  function layoutPage() {
    if (!sizer) return;
    var cw = canvasEl.clientWidth || window.innerWidth;
    scale = clamp((cw - 40) / PW, 0.2, 1);
    sizer.style.width = Math.round(PW * scale) + 'px';
    sizer.style.height = Math.round(PH * scale) + 'px';
    pageEl.style.transform = 'scale(' + scale + ')';
  }
  function applyGuided() {
    document.documentElement.classList.toggle('zde-guided', guided);
    if (fieldLayer) { fieldLayer.inert = guided; if (guided) fieldLayer.setAttribute('aria-hidden', 'true'); else fieldLayer.removeAttribute('aria-hidden'); }
    if (hotLayer) hotLayer.style.display = guided ? '' : 'none';
  }
  function setGuided(b) {
    b = !!b; if (b === guided) return;
    guided = b;
    if (!guided && ov) closeOverlay(true);
    if (!guided && reviewEl) closeReview();
    applyGuided();
    emit('guided', guided);
  }
  function pageKey(e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      var k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) redo(); else undo(); }
      else if (k === 'y') { e.preventDefault(); e.stopPropagation(); redo(); }
      return;
    }
    if (e.key === 'Enter' && e.target.closest && e.target.closest('input.zde-in, input.zde-sig-in')) {
      e.preventDefault();
      if (!focusSibling(e.target, 1, false)) e.target.blur();
    }
  }

  /* ---------- card artwork (raster; vector upgrade hook) ---------- */
  // TODO(vector): replace the raster crop with a data-driven vector redraw of the band (texts, rects, rules)
  // generated from fields.json, so text stays crisp when k can exceed ~2.
  function renderCardArtwork(canvas, band, k) {
    var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    var cw = Math.round(band.w * k), ch = Math.round(band.h * k);
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    var c = canvas.getContext('2d');
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height);
    c.drawImage(IMG, band.x, band.y, band.w, band.h, 0, 0, canvas.width, canvas.height);
    // the source scan has a stray dark 'sign' fragment in the Section B signature box; repaint like ZD.render does
    var r = { x: 519, y: 1169, w: 107, h: 19 };
    if (band.y + band.h > r.y && band.y < r.y + r.h) {
      var sx = canvas.width / band.w, sy = canvas.height / band.h, ox = band.x, oy = band.y;
      c.fillStyle = 'rgb(204,215,255)'; c.fillRect((526 - ox) * sx, (1169 - oy) * sy, 94 * sx, 19 * sy);
      c.fillStyle = '#fff'; c.fillRect((519 - ox) * sx, (1169 - oy) * sy, 6 * sx, 19 * sy);
      c.fillStyle = 'rgb(47,43,44)'; c.fillRect((525 - ox) * sx, (1169 - oy) * sy, 1 * sx, 19 * sy);
    }
  }

  /* ---------- overlay / zoom card ---------- */
  function onKey(e) {
    if (reviewEl) { if (e.key === 'Escape') { e.preventDefault(); closeReview(); } return; }
    if (!ov) return;
    var t = e.target, inField = t && t.closest && t.closest('input.zde-in, input.zde-sig-in');
    if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[zy]$/i.test(e.key) && inField) {
      e.preventDefault(); e.stopPropagation();
      if (e.key.toLowerCase() === 'y' || e.shiftKey) redo(); else undo();
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') { trapTab(e); return; }
    var inOpt = t && t.closest && t.closest('.zde-opt, .zde-chk, .zde-seg');
    if (e.key === 'Enter') {
      if (inField) { e.preventDefault(); if (!focusSibling(t, 1, false)) next(); }
      else if (inOpt) { e.preventDefault(); next(); }
      else if (t === document.body || (t.closest && t.closest('.zde-ov') && !t.closest('button'))) { e.preventDefault(); next(); }
      return;
    }
    if (!inField && !(t && t.closest && t.closest('.zde-opt')) && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault(); if (e.key === 'ArrowRight') next(); else back();
    }
  }
  function trapTab(e) {
    var root = ov.el, f = Array.prototype.slice.call(root.querySelectorAll('button:not([disabled]):not([tabindex="-1"]), input:not([disabled])')).filter(function (x) { return x.offsetParent !== null && x.style.display !== 'none'; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function hotRect(i) { return hots[i].getBoundingClientRect(); }
  function centerBand(i, smooth) {
    var b = BANDS[i], top = sizer.offsetTop + (b.y + b.h / 2) * scale - canvasEl.clientHeight / 2;
    top = Math.max(0, top);
    try { canvasEl.scrollTo({ top: top, behavior: smooth && !REDUCED ? 'smooth' : 'auto' }); } catch (e) { canvasEl.scrollTop = top; }
  }
  function hotVisible(i) {
    var r = hotRect(i), c = canvasEl.getBoundingClientRect();
    return r.top >= c.top - 2 && r.bottom <= c.bottom + 2 && r.width > 0;
  }

  function layoutFor(i) {
    var b = BANDS[i], vw = window.innerWidth, vh = window.innerHeight;
    var hasSig = STEPS[i].fieldIds.some(function (id) { return FIELD[id] && FIELD[id].type === 'signature'; });
    var extra = hasSig ? 200 : 0;   // the drawing pad and Type/Draw/Clear buttons sit under the card
    var avW = isMobile() ? vw - 24 : Math.min(vw - 160, 1000), avH = Math.max(120, vh - 134 - 96 - extra);
    var k = clamp(Math.min(avW / b.w, avH / b.h), 0.5, MAXK);
    var cw = Math.round(b.w * k), ch = Math.round(b.h * k);
    var top = Math.max(84, (vh - (ch + 134 + extra)) / 2 + 58);
    return { k: k, w: cw, h: ch, left: Math.round((vw - cw) / 2), top: Math.round(top) };
  }

  function open(i) {
    if (!ready) { pending.push(function () { open(i); }); return; }
    i = clamp(Number(i) || 0, 0, STEPS.length - 1);
    if (!guided) {   // no cards when guided fill is off: just bring the question into view and focus it
      centerBand(i, true);
      var first = views[STEPS[i].fieldIds[0]]; var inpt = first && first[0] && first[0].input;
      if (inpt) { try { inpt.focus({ preventScroll: true }); } catch (e) {} }
      return;
    }
    if (reviewEl) closeReview(true);
    showStep(i, { fromClick: true });
  }

  function showStep(i, opts) {
    opts = opts || {};
    var old = ov, wasOpen = !!old;
    var instant = !!opts.instant || REDUCED;
    if (!wasOpen) {
      var back_ = h('div', { class: 'zde-backdrop' });
      back_.addEventListener('click', function () { close(); });
      var el = h('div', { class: 'zde-ov', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'zde-title' }, back_);
      document.body.appendChild(el);
      ov = { el: el, backdrop: back_, restore: document.activeElement };
      canvasEl.inert = true;
      requestAnimationFrame(function () { back_.classList.add('zde-on'); });
    } else {
      var oldStack = old.stack; oldStack.classList.add('zde-out');
      unregister(old.views); old.views = [];
      setTimeout(function () { if (oldStack.parentNode) oldStack.parentNode.removeChild(oldStack); }, 160);
    }
    errs = {}; warns = {};
    var wasCur = cur; cur = i;
    // page behind: centre the question (instantly when a card is already open, so the FLIP source is right)
    var vis = hotVisible(i);
    if (!vis || wasOpen || opts.instant) centerBand(i, false);
    var smoothAfter = vis && !wasOpen && !opts.instant;

    var b = BANDS[i], L = layoutFor(i), m = stepMeta(i), st = STEPS[i];
    var stack = h('div', { class: 'zde-stack' });
    px(stack, { left: L.left, top: L.top, width: L.w, height: L.h });
    var card = h('div', { class: 'zde-card zde-scope' });
    px(card, { width: L.w, height: L.h });
    var art = h('canvas', { class: 'zde-cardart', 'aria-hidden': 'true' });
    card.appendChild(art);
    renderCardArtwork(art, b, L.k);
    var inner = h('div', { class: 'zde-inner' });
    inner.style.transform = 'translate(' + (-b.x * L.k) + 'px,' + (-b.y * L.k) + 'px) scale(' + L.k + ')';
    var vlist = [];
    buildingCard = true; cardK = L.k;
    st.fieldIds.forEach(function (id) { var v = makeView(FIELD[id]); if (v) { register(id, v); vlist.push(v); inner.appendChild(v.el); } });
    buildingCard = false;
    card.appendChild(inner);
    stack.appendChild(card);

    var head = h('div', { class: 'zde-head' },
      h('div', { class: 'zde-label', text: m.label }),
      h('h2', { class: 'zde-title', id: 'zde-title', text: st.title }),
      st.help ? h('p', { class: 'zde-help', text: st.help }) : null);
    var msgs = h('div', { class: 'zde-msgs', role: 'alert', 'aria-live': 'polite', 'aria-atomic': 'true' });
    var btnBack = h('button', { type: 'button', class: 'zde-btn zde-back', text: 'Back', onclick: function () { back(); } });
    var count = h('span', { class: 'zde-count', text: (i + 1) + ' / ' + STEPS.length, 'aria-label': 'Question ' + (i + 1) + ' of ' + STEPS.length });
    var btnNext = h('button', { type: 'button', class: 'zde-btn zde-next', onclick: function () { next(); } });
    btnBack.disabled = i === 0;
    var bar = h('div', { class: 'zde-bar' }, btnBack, count, btnNext);
    var under = h('div', { class: 'zde-under' }, msgs);
    vlist.forEach(function (v) { if (v.pad) under.appendChild(v.pad); if (v.controls) under.appendChild(v.controls); });
    under.appendChild(bar);
    if (m.section === 'A' && m.decl) {
      under.appendChild(h('button', { type: 'button', class: 'zde-link', text: 'Skip the payer section and review', onclick: function () { finish(); } }));
    }
    if (!noticeShown) { under.appendChild(h('p', { class: 'zde-notice', text: NOTICE })); noticeShown = true; }
    stack.appendChild(head); stack.appendChild(under);
    ov.el.appendChild(stack);
    ov.k = L.k; ov.L = L;
    ov.stack = stack; ov.card = card; ov.views = vlist; ov.msgs = msgs; ov.btnNext = btnNext; ov.head = head; ov.under = under;
    updateNextLabel();
    paintMsgs();
    fitStack(L);

    // FLIP: start the card over the hotspot, then release it
    var fromRect = hotRect(i), cr = card.getBoundingClientRect();
    if (!instant && fromRect.width > 0) {
      card.style.transformOrigin = '0 0';
      card.style.transition = 'none';
      card.style.transform = 'translate(' + (fromRect.left - cr.left) + 'px,' + (fromRect.top - cr.top) + 'px) scale(' + (fromRect.width / cr.width) + ',' + (fromRect.height / cr.height) + ')';
      head.style.opacity = '0'; under.style.opacity = '0';
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        if (ov && ov.card !== card) return;
        card.style.transition = ''; card.classList.add('zde-open'); card.style.transform = 'none';
        head.style.opacity = ''; under.style.opacity = '';
      }); });
    } else { card.classList.add('zde-open'); head.style.opacity = ''; under.style.opacity = ''; }
    if (smoothAfter) centerBand(i, true);
    emit('step', i);
    focusFirst(instant ? 0 : 400, opts.keepFocus);
  }

  // keep the whole card + its buttons on screen (short viewports, on-screen keyboard)
  function fitStack(L) {
    if (!ov) return;
    var vh = window.innerHeight;
    ov.el.classList.remove('zde-compact');
    var need = ov.head.offsetHeight + L.h + ov.under.offsetHeight + 16;
    if (need > vh) ov.el.classList.add('zde-compact');
    var headH = ov.head.offsetHeight, underH = ov.under.offsetHeight;
    var top = Math.min(L.top, vh - 8 - underH - L.h);
    top = Math.max(top, headH + 6);
    ov.stack.style.top = Math.round(top) + 'px';
  }
  function relayout() {
    if (!ov || cur < 0) return;
    var L = layoutFor(cur), old = ov.k;
    if (!old || Math.abs(L.k - old) / old > 0.04) {
      var a = document.activeElement, fid = a && a.getAttribute && a.getAttribute('data-fid');
      showStep(cur, { instant: true, keepFocus: fid });
      return;
    }
    ov.stack.style.left = L.left + 'px';
    ov.stack.style.width = L.w + 'px'; ov.card.style.width = L.w + 'px'; ov.card.style.height = L.h + 'px'; ov.stack.style.height = L.h + 'px';
    ov.L = L; fitStack(L);
  }

  function focusFirst(delay, keep) {
    var myCard = ov && ov.card, tries = 0;
    setTimeout(function attempt() {
      if (!ov || ov.card !== myCard) return;
      var el = keep && myCard.querySelector('[data-fid="' + keep + '"] input, input[data-fid="' + keep + '"]');
      el = el || myCard.querySelector('input.zde-in, input.zde-sig-in') || myCard.querySelector('.zde-opt[tabindex="0"], .zde-chk');
      if (el) { try { el.focus({ preventScroll: true }); } catch (e) {} if (document.activeElement === el) return; }
      if (++tries < 10) setTimeout(attempt, 50);
    }, delay);
  }

  function closeOverlay(immediate) {
    if (!ov) return;
    var o = ov; ov = null; var idx = cur; cur = -1;
    unregister(o.views || []);
    canvasEl.inert = false;
    errs = {}; warns = {};
    flushHist();
    if (o.restore && o.restore.focus && document.contains(o.restore) && !immediate) { try { o.restore.focus({ preventScroll: true }); } catch (e) {} }
    var done = function () { if (o.el.parentNode) o.el.parentNode.removeChild(o.el); };
    if (immediate || REDUCED || !o.card) { done(); }
    else {
      var card = o.card, r = idx >= 0 && hots[idx] ? hotRect(idx) : null, cr = card.getBoundingClientRect();
      o.backdrop.classList.remove('zde-on');
      o.head.style.opacity = '0'; o.under.style.opacity = '0';
      if (r && r.width > 0) {
        card.style.transformOrigin = '0 0';
        card.style.transform = 'translate(' + (r.left - cr.left) + 'px,' + (r.top - cr.top) + 'px) scale(' + (r.width / cr.width) + ',' + (r.height / cr.height) + ')';
      } else card.style.opacity = '0';
      setTimeout(done, 380);
    }
    emit('step', -1);
  }
  function close() { closeOverlay(false); }

  function updateNextLabel() {
    if (!ov) return;
    var last = cur === STEPS.length - 1, skip = isOptionalEmpty(cur);
    ov.btnNext.textContent = last ? 'Finish' : (skip ? 'Skip' : 'Next');
    ov.btnNext.classList.toggle('zde-skip', skip && !last);
  }
  function isOptionalEmpty(i) {
    var st = STEPS[i], R = ZD.rules, opt = { section: 'AB' };
    return st.fieldIds.every(function (id) {
      if (hasVal(values[id])) return false;
      return !(R && R.isRequired && R.isRequired(id, values, opt));
    });
  }

  /* ---------- validation ---------- */
  function validateAll() {
    var res;
    try { res = ZD.rules.validateAll(values, FJ, { section: 'AB' }); } catch (e) { res = { errors: {}, warnings: {}, complete: true }; }
    // an entry that was cut off to fit the boxes must be corrected, never printed silently truncated
    Object.keys(overflow).forEach(function (id) {
      if (!res.errors[id] && FIELD[id] && FIELD[id].boxes) res.errors[id] = 'What you typed was too long and was cut off after ' + FIELD[id].boxes.length + ' characters. Shorten it (for example with an abbreviation) so it prints correctly.';
    });
    return res;
  }
  function validateStep(i) {
    var res = validateAll(), e = {}, w = {};
    STEPS[i].fieldIds.forEach(function (id) { if (res.errors[id]) e[id] = res.errors[id]; if (res.warnings && res.warnings[id]) w[id] = res.warnings[id]; });
    return { errors: e, warnings: w };
  }
  function liveRecheck() { if (!ov) return; var r = validateStep(cur); errs = r.errors; warns = r.warnings; paintMsgs(); }
  function paintMsgs() {
    if (!ov) return;
    var box = ov.msgs; box.textContent = '';
    var ids = STEPS[cur].fieldIds, any = false;
    function add(cls, msg) { box.appendChild(h('p', { class: 'zde-msg ' + cls, text: msg })); any = true; }
    ids.forEach(function (id) { if (errs[id]) add('zde-err', errs[id]); });
    ids.forEach(function (id) { if (notes[id] && !errs[id]) add('zde-note', notes[id]); });
    ids.forEach(function (id) { if (warns[id] && !errs[id]) add('zde-warn', warns[id]); });
    box.classList.toggle('zde-has', any);
    ov.views.forEach(function (v) { if (v.refreshSelf) v.refreshSelf(); });
    if (ov.L) fitStack(ov.L);
  }

  function next() {
    if (!ready) { pending.push(next); return; }
    if (!ov) { if (guided) open(0); return; }
    var r = validateStep(cur);
    errs = r.errors; warns = r.warnings; paintMsgs();
    var bad = STEPS[cur].fieldIds.filter(function (id) { return errs[id]; })[0];
    if (bad) {
      var vs = views[bad] || [], v = vs[vs.length - 1];
      var el = v && (v.input || v.el.querySelector('button'));
      if (el) { try { el.focus({ preventScroll: true }); } catch (e) {} }
      return false;
    }
    flushHist();
    if (cur >= STEPS.length - 1) { finish(); return true; }
    showStep(cur + 1);
    return true;
  }
  function back() {
    if (!ov) return;
    if (cur > 0) { flushHist(); showStep(cur - 1); }
  }

  /* ---------- review / finish ---------- */
  function toast(msg, ms) {
    if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
    clearTimeout(toastTimer);
    toastEl = h('div', { class: 'zde-toast', role: 'status', 'aria-live': 'polite', text: msg });
    document.body.appendChild(toastEl);
    toastTimer = setTimeout(function () { if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl); }, ms || 6000);
  }
  function finish() {
    if (!ready) return;
    if (ov) closeOverlay(true);
    openReview();
  }
  function closeReview(silent) {
    if (!reviewEl) return;
    var el = reviewEl; reviewEl = null;
    if (el.parentNode) el.parentNode.removeChild(el);
    if (canvasEl) canvasEl.inert = false;
  }
  function openReview() {
    if (reviewEl) closeReview(true);
    var res = validateAll(), ids = Object.keys(res.errors), warnIds = Object.keys(res.warnings || {});
    var complete = ids.length === 0;
    var bStarted = ZD.rules && ZD.rules.sectionBStarted ? ZD.rules.sectionBStarted(values) : false;
    var back_ = h('div', { class: 'zde-backdrop zde-on' });
    back_.addEventListener('click', closeReview);
    var panel = h('div', { class: 'zde-panel' });
    var el = h('div', { class: 'zde-ov zde-review', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'zde-rv-title' }, back_, panel);
    panel.appendChild(h('h2', { id: 'zde-rv-title', class: 'zde-rv-title', text: complete ? 'Your declaration is ready' : 'A few things need fixing' }));
    var status = h('p', { class: 'zde-rv-status', role: 'status', 'aria-live': 'polite' });
    if (complete) {
      panel.appendChild(h('p', { class: 'zde-rv-sub', text: bStarted ? 'Sections A and B are complete.' : 'Section A is complete. Section B (the payer section) is optional – your employer can complete it.' }));
    } else {
      panel.appendChild(h('p', { class: 'zde-rv-sub', text: 'Select an item to jump to that question.' }));
      var ul = h('ul', { class: 'zde-rv-list' });
      var seen = {};
      ids.forEach(function (id) {
        var si = stepOfField(id); if (si < 0) return;
        var m = stepMeta(si);
        var li = h('li', null, h('button', { type: 'button', class: 'zde-rv-item', onclick: function () { closeReview(true); if (guided) open(si); else { centerBand(si, true); setTimeout(function () { var v = views[id] && views[id][0]; var e2 = v && (v.input || v.el.querySelector('button')); if (e2) e2.focus({ preventScroll: true }); }, 60); } } },
          h('span', { class: 'zde-rv-q', text: m.label }), h('span', { class: 'zde-rv-m', text: res.errors[id] })));
        ul.appendChild(li); seen[id] = 1;
      });
      panel.appendChild(ul);
    }
    if (warnIds.length) {
      panel.appendChild(h('p', { class: 'zde-rv-wh', text: 'Worth a second look' }));
      var wl = h('ul', { class: 'zde-rv-list zde-rv-warn' });
      warnIds.forEach(function (id) { wl.appendChild(h('li', { text: res.warnings[id] })); });
      panel.appendChild(wl);
    }
    var dl = h('button', { type: 'button', class: 'zde-btn zde-primary', text: 'Download PDF', 'aria-disabled': complete ? null : 'true', onclick: function () { if (!complete) return; doExport('pdf', status); } });
    var pr = h('button', { type: 'button', class: 'zde-btn zde-secondary', text: 'Print', 'aria-disabled': complete ? null : 'true', onclick: function () { if (!complete) return; doExport('print', status); } });
    var bk = h('button', { type: 'button', class: 'zde-btn zde-ghost', text: complete ? 'Back to the form' : 'Close', onclick: function () { closeReview(); } });
    panel.appendChild(h('div', { class: 'zde-rv-actions' }, dl, pr, bk));
    panel.appendChild(status);
    document.body.appendChild(el);
    canvasEl.inert = true;
    reviewEl = el;
    setTimeout(function () { var f = panel.querySelector('.zde-rv-item') || dl; try { f.focus({ preventScroll: true }); } catch (e) {} }, 30);
    return complete;
  }

  /* ---------- export ---------- */
  function renderFinal() {
    return new Promise(function (resolve) {
      var c = document.createElement('canvas'), imgs = {}, pendingN = 0, fired = false;
      function fin() { if (fired) return; fired = true; ZD.render(c, IMG, FJ, values, { scale: 2, forExport: true, sigImages: imgs, onUpdate: function () {} }); resolve(c); }
      Object.keys(values).forEach(function (k) {
        var v = values[k];
        if (FIELD[k] && FIELD[k].type === 'signature' && isDataUrl(v) && !imgs[v]) {
          pendingN++;
          var im = new Image();
          im.onload = im.onerror = function () { imgs[v] = im; if (--pendingN === 0) fin(); };
          im.src = v;
        }
      });
      if (!pendingN) fin(); else setTimeout(fin, 4000);
    });
  }
  function doExport(kind, statusEl) {
    var say = function (msg, bad) { if (statusEl) { statusEl.className = 'zde-rv-status' + (bad ? ' zde-bad' : ''); statusEl.textContent = msg; } else toast(msg, 12000); };
    if (kind === 'pdf') {
      say('Preparing your PDF…');
      return renderFinal().then(function (c) {
        try {
          var bytes = ZD.pdf.fromCanvas(c, { quality: 0.92 });
          ZD.pdf.download(bytes, 'TFN-declaration-NAT3092.pdf');
          say(DL_HINT); return true;
        } catch (e) { say('Sorry, the PDF could not be created. Try Print instead.', true); return false; }
      });
    }
    say('Opening print…');
    return renderFinal().then(function (c) {
      return new Promise(function (resolve) {
        var url = c.toDataURL('image/jpeg', 0.92);
        var old = document.getElementById('zde-print-frame'); if (old) old.remove();
        var fr = h('iframe', { id: 'zde-print-frame', title: 'Print', 'aria-hidden': 'true', style: 'position:fixed;right:0;bottom:0;width:0;height:0;border:0' });
        document.body.appendChild(fr);
        var d = fr.contentWindow.document;
        d.open();
        d.write('<!doctype html><html><head><title>TFN declaration</title><style>@page{size:A4;margin:0}html,body{margin:0;padding:0}img{display:block;width:210mm;height:297mm;object-fit:contain}</style></head><body><img alt="Completed TFN declaration"></body></html>');
        d.close();
        var im = d.querySelector('img');
        im.onload = function () { setTimeout(function () { try { fr.contentWindow.focus(); fr.contentWindow.print(); say(''); resolve(true); } catch (e) { say('Printing is not available here. Download the PDF instead.', true); resolve(false); } }, 100); };
        im.src = url;
      });
    });
  }
  function gate(kind) {
    if (!ready) return Promise.resolve(false);
    var res = validateAll();
    if (Object.keys(res.errors).length) { if (ov) closeOverlay(true); openReview(); return Promise.resolve(false); }
    return doExport(kind, reviewEl ? reviewEl.querySelector('.zde-rv-status') : null);
  }

  /* ---------- public API ---------- */
  function copy(o) { var r = {}; Object.keys(o).forEach(function (k) { r[k] = o[k]; }); return r; }
  window.ZDEditor = {
    open: open, close: function () { close(); }, next: next, back: back,
    setGuided: function (b) { if (!ready) { pending.push(function () { setGuided(b); }); return; } setGuided(b); },
    isGuided: function () { return guided; },
    download: function () { return gate('pdf'); },
    print: function () { return gate('print'); },
    review: function () { if (ready) finish(); },
    undo: undo, redo: redo, canUndo: canUndo, canRedo: canRedo,
    reset: reset,
    stepCount: function () { return STEPS.length || 19; },
    values: function () { return copy(values); },
    on: on,
    // test/inspection helpers (read-only)
    _bands: function () { return BANDS.map(copy); }, _scale: function () { return scale; }
  };
})();
