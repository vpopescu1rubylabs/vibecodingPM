/* Zendocs editor: one-question-per-step wizard for the NAT 3092 TFN declaration.
   Everything runs locally. No network calls except loading fields.json / the form image in dev. */
(function () {
  'use strict';
  var ZD = window.ZD || {};
  var $ = function (id) { return document.getElementById(id); };
  var FJ = null, IMG = null, FIELD = {}, STEPS = [];
  var values = {};
  var optB = false;
  var idx = 0;               // index into flow()
  var activeFid = null;
  var pvMode = 'zoom';
  var errors = {}, warnings = {};
  var stage = $('stage');
  var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- tiny DOM helper ---------- */
  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
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
  function announce(msg) { var a = $('announcer'); a.textContent = ''; setTimeout(function () { a.textContent = msg; }, 50); }

  /* ---------- boot ---------- */
  function loadFields() {
    var node = $('fields-json');
    var txt = node && node.textContent.trim();
    if (txt) { try { return Promise.resolve(JSON.parse(txt)); } catch (e) { /* fall through */ } }
    // Dev only: a script may set window.ZD_FIELDS. No network requests are ever made for the field data.
    if (window.ZD_FIELDS) return Promise.resolve(window.ZD_FIELDS);
    return Promise.reject(new Error('fields'));
  }
  function loadImage(src) {
    return new Promise(function (res, rej) {
      var tries = [window.ZD_IMAGE_SRC, src, '../src/' + src].filter(Boolean), i = 0;
      (function next() {
        if (i >= tries.length) return rej(new Error('image'));
        var im = new Image();
        im.onload = function () { res(im); };
        im.onerror = next;
        im.src = tries[i++];
      })();
    });
  }

  Promise.all([loadFields()]).then(function (r) {
    FJ = r[0];
    FJ.fields.forEach(function (f) { FIELD[f.id] = f; });
    STEPS = FJ.steps;
    return loadImage(FJ.image.src);
  }).then(function (im) {
    IMG = im;
    init();
  }).catch(function () {
    stage.appendChild(h('div', { class: 'card', role: 'alert' }, h('h2', { text: 'Could not load the form' }),
      h('p', { class: 'help', text: 'Please reload the page. Nothing has been sent anywhere.' })));
  });

  function init() {
    pvMode = matchMedia('(min-width:900px)').matches ? 'full' : 'zoom';
    $('pv-mode').textContent = pvMode === 'full' ? 'Zoom to field' : 'Show whole form';
    $('pv-mode').setAttribute('aria-pressed', pvMode === 'full' ? 'true' : 'false');

    var saved = ZD.store && ZD.store.load && ZD.store.load();
    var has = ZD.store && ZD.store.hasDraft && ZD.store.hasDraft();
    if (has && saved) $('resume-banner').hidden = false;
    $('btn-resume').addEventListener('click', function () {
      values = saved || {};
      optB = sectionBHas();
      $('resume-banner').hidden = true;
      var f = flow(), target = f.length - 1;
      for (var i = 0; i < f.length; i++) {
        if (f[i].t === 'step' && stepProblems(f[i].step).hasErr) { target = i; break; }
      }
      go(target);
      var it = f[target];   // say clearly what still has to be filled in (TFN, date of birth, signature are never saved)
      if (it && it.t === 'step') { var pr = stepProblems(it.step); showProblems(it.step, pr); if (pr.hasErr) announce('Your draft was restored. ' + Object.keys(pr.errors).map(function (k) { return pr.errors[k]; })[0]); }
    });
    var bp = $('resume-banner').querySelector('p');
    if (bp) bp.textContent = 'Welcome back. We found a draft of your name and address saved on this device. For your privacy your TFN, date of birth, email and signature are never saved, so you will need to enter them again.';
    $('btn-discard').addEventListener('click', function () {
      ZD.store && ZD.store.wipeAll && ZD.store.wipeAll();
      values = {}; optB = false; $('resume-banner').hidden = true; renderPreview(); go(0);
    });
    $('btn-back').addEventListener('click', back);
    $('btn-next').addEventListener('click', next);
    $('btn-startover-top').addEventListener('click', confirmStartOver);
    $('pv-toggle').addEventListener('click', function () {
      var open = $('pv-toggle').getAttribute('aria-expanded') !== 'true';
      setPvOpen(open);
    });
    $('pv-mode').addEventListener('click', function () {
      pvMode = pvMode === 'full' ? 'zoom' : 'full';
      $('pv-mode').textContent = pvMode === 'full' ? 'Zoom to field' : 'Show whole form';
      $('pv-mode').setAttribute('aria-pressed', pvMode === 'full' ? 'true' : 'false');
      layoutPreview();
    });
    window.addEventListener('resize', layoutPreview);
    window.addEventListener('popstate', function (e) {
      if (e.state && e.state.tok === TOK && e.state.zd != null && e.state.zd !== idx) go(e.state.zd, { fromPop: true });
    });
    if (window.ResizeObserver) new ResizeObserver(layoutPreview).observe($('pv-viewport'));
    $('dlg-cancel').addEventListener('click', function () { $('dlg-confirm').close(); });
    $('dlg-confirm').addEventListener('close', function () {
      if ($('dlg-confirm').returnValue === 'ok') doStartOver();
    });
    $('pv-stage').style.width = FJ.image.w + 'px';
    $('pv-stage').style.height = FJ.image.h + 'px';
    setPvOpen(true);
    go(0);
  }
  function setPvOpen(open) {
    $('pv-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    $('pv-body').hidden = !open;
    $('pv-mode').hidden = !open;
    if (open) layoutPreview();
  }

  /* ---------- flow ---------- */
  function sectionBHas() {
    return STEPS.some(function (s) {
      return s.section === 'B' && s.fieldIds.some(function (id) { return hasVal(values[id]); });
    });
  }
  function hasVal(v) { return v !== undefined && v !== null && v !== '' && v !== false; }
  function flow() {
    var f = [{ t: 'welcome' }];
    STEPS.filter(function (s) { return s.section === 'A'; }).forEach(function (s) { f.push({ t: 'step', step: s }); });
    f.push({ t: 'boffer' });
    if (optB) STEPS.filter(function (s) { return s.section === 'B'; }).forEach(function (s) { f.push({ t: 'step', step: s }); });
    f.push({ t: 'review' });
    return f;
  }
  function go(i, opts) {
    var f = flow();
    var prevIdx = idx;
    idx = Math.max(0, Math.min(f.length - 1, i));
    lastGo = Date.now();
    try {   // make the browser Back/Forward buttons move between questions instead of leaving the page
      if (!(opts && opts.fromPop)) {
        if (!histInit) { histInit = true; history.replaceState({ zd: idx, tok: TOK }, ''); }
        else if (idx !== prevIdx) history.pushState({ zd: idx, tok: TOK }, '');
      }
    } catch (e) {}
    errors = {}; warnings = {};
    var item = f[idx];
    if (item.t !== 'step') fromReview = false;
    stage.innerHTML = '';
    var nav = $('nav');
    nav.hidden = item.t === 'welcome' || item.t === 'review' || item.t === 'boffer';
    if (item.t === 'boffer') nav.hidden = true;
    var focusEl = null;
    if (item.t === 'welcome') focusEl = renderWelcome();
    else if (item.t === 'boffer') focusEl = renderBOffer();
    else if (item.t === 'review') focusEl = renderReview();
    else focusEl = renderStep(item.step);
    updateProgress();
    var stepFirst = item.t === 'step' ? item.step.fieldIds[0] : null;
    setActive(stepFirst, true);
    if (item.t !== 'step') { activeFid = null; renderPreview(); layoutPreview(); }
    var nxt = flow()[idx + 1];
    $('btn-next').textContent = nxt && (nxt.t === 'review' || nxt.t === 'boffer') ? 'Review' : 'Next';
    if (nxt && nxt.t === 'boffer') $('btn-next').textContent = 'Next';
    if (fromReview) $('btn-next').textContent = 'Save and return to review';
    window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
    if (!(opts && opts.noFocus) && focusEl) setTimeout(function () { try { focusEl.focus({ preventScroll: true }); } catch (e) {} }, 30);
    var title = item.t === 'step' ? item.step.title : (item.t === 'review' ? 'Review your answers' : item.t === 'boffer' ? 'Payer section' : 'Welcome');
    document.title = title + ' · TFN declaration';
  }
  function updateProgress() {
    var f = flow(), total = f.length - 1, pct = Math.round(idx / total * 100);
    var bar = $('progress');
    bar.setAttribute('aria-valuenow', pct);
    bar.setAttribute('aria-valuetext', 'Step ' + (idx + 1) + ' of ' + f.length);
    $('progress-bar').style.width = pct + '%';
  }
  function back() { if (fromReview) { fromReview = false; go(flow().length - 1); return; } if (idx > 0) go(idx - 1); }
  var fromReview = false;   // true after "Edit"/"Fix" on the review screen: Next goes straight back to review
  var lastGo = 0, histInit = false, TOK = String(Math.random());
  function next() {
    // ignore double-clicks / held Enter so a second press can't skip a question or flash errors on the next one
    if (Date.now() - lastGo < 400) return;
    var it = flow()[idx];
    if (it.t === 'step') {
      var p = stepProblems(it.step);
      showProblems(it.step, p);
      if (p.hasErr) {
        var first = it.step.fieldIds.filter(function (id) { return p.errors[id]; })[0];
        var w = stage.querySelector('[data-fid="' + first + '"]');
        var focusable = w && w.querySelector('input,button,canvas');
        if (focusable) focusable.focus();
        announce(p.errors[first]);
        return;
      }
    }
    if (fromReview) { fromReview = false; go(flow().length - 1); return; }
    go(idx + 1);
  }
  function editFromReview(i) { fromReview = true; go(i); }

  /* ---------- validation ---------- */
  function sectionOpt() { return optB ? { section: 'AB', completeB: true } : { section: 'A' }; }
  function stepProblems(step) {
    var out = { errors: {}, warnings: {}, hasErr: false };
    var all = ZD.rules && ZD.rules.validateAll ? ZD.rules.validateAll(values, FJ, sectionOpt()) : { errors: {}, warnings: {} };
    step.fieldIds.forEach(function (id) {
      var f = FIELD[id], v = values[id];
      if (all.errors[id]) out.errors[id] = all.errors[id];
      else if (f.type === 'boxes' && typeof v === 'string' && f.boxes && v.length > f.boxes.length)
        out.errors[id] = tooLong(f, v.length);
      else if (!ZD.rules && f.validator && f.validator !== 'none' && ZD.validate && hasVal(v)) {
        var r = ZD.validate.run(f.validator, v); if (!r.ok) out.errors[id] = r.error;
      }
      if (all.warnings && all.warnings[id]) out.warnings[id] = all.warnings[id];
    });
    out.hasErr = Object.keys(out.errors).length > 0;
    return out;
  }
  function showProblems(step, p) {
    errors = p.errors; warnings = p.warnings;
    step.fieldIds.forEach(function (id) { paintMsg(id); });
  }
  function paintMsg(id) {
    var w = stage.querySelector('[data-fid="' + id + '"]'); if (!w) return;
    var m = w.querySelector('.msg'); if (!m) return;
    m.className = 'msg' + (errors[id] ? ' err' : warnings[id] ? ' warn' : '');
    m.textContent = errors[id] || warnings[id] || '';
    w.classList.toggle('has-err', !!errors[id]);
    w.querySelectorAll('input.txt,.cells input').forEach(function (i) { i.setAttribute('aria-invalid', errors[id] ? 'true' : 'false'); });
  }
  // live check while typing (only once the field has content, to avoid nagging)
  function liveCheck(id) {
    var f = FIELD[id], v = values[id];
    delete errors[id]; delete warnings[id];
    if (f.type === 'boxes' && typeof v === 'string' && f.boxes && v.length > f.boxes.length) {
      errors[id] = tooLong(f, v.length);
    } else if (f.validator && f.validator !== 'none' && ZD.validate && hasVal(v) && shouldLive(f, v)) {
      var r = ZD.validate.run(f.validator, v);
      if (!r.ok) errors[id] = r.error; else if (r.warn) warnings[id] = r.warn;
    }
    if (dropNote[id] && !errors[id] && !warnings[id]) warnings[id] = dropNote[id];
    paintMsg(id);
  }
  function tooLong(f, len) {
    if (ZD.rules && ZD.rules.tooLongMsg) return ZD.rules.tooLongMsg(f, len);
    return 'That is ' + len + ' characters but the form only has ' + f.boxes.length + ' boxes.';
  }
  function shouldLive(f, v) { // only judge once the field looks complete, not mid-typing
    if (f.type === 'date') return String(v).length >= 8;
    if (f.validator === 'email') return false;
    if (f.boxes && f.charset === 'digits') return String(v).length >= f.boxes.length;
    return String(v).length >= 2;
  }

  /* ---------- value mutation ---------- */
  function setValue(id, v) {
    lastGo = 0;   // the user has interacted with this screen: Next is allowed immediately
    if (hasVal(v)) values[id] = v; else delete values[id];
    ZD.store && ZD.store.save && ZD.store.save(values);
    renderPreview();
  }

  /* ---------- screens ---------- */
  function renderWelcome() {
    var h1 = h('h2', { tabindex: '-1', id: 'q-title', text: 'Tax file number declaration' });
    stage.appendChild(h('div', null,
      h('p', { class: 'eyebrow', text: 'ATO form NAT 3092' }), h1,
      h('p', { class: 'lead', text: 'Answer one simple question at a time. We fill in the real ATO form for you, then you sign it and download a PDF.' }),
      h('ul', { class: 'ticks' },
        h('li', { text: 'About 3 minutes. Use your keyboard or your phone.' }),
        h('li', { text: 'Your details never leave this device. Nothing is uploaded or tracked.' }),
        h('li', { text: 'The payer section is optional: your employer can complete it.' })),
      h('div', { class: 'card', role: 'note' }, h('strong', { text: 'Privacy. ' }),
        'Everything you type stays in this browser. Name and address are saved on this device for 24 hours; your TFN, date of birth, email and signature are never saved. You can delete the draft any time with "Start over".'),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { go(1); } }, 'Start'))));
    return h1;
  }
  function renderBOffer() {
    var h1 = h('h2', { tabindex: '-1', text: 'Payer section (optional)' });
    stage.appendChild(h('div', null,
      h('p', { class: 'eyebrow', text: 'Section B' }), h1,
      h('p', { class: 'lead', text: 'This part is for your employer or payer (ABN, business name and address, their signature). They can complete it after you send them the PDF.' }),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { go(flow().length - 1); } }, 'Skip: go to review'),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { optB = true; go(idx + 1); } }, 'Fill it in now')),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'link-btn', onclick: back }, 'Back'))));
    return h1;
  }

  function renderStep(step) {
    var h1 = h('h2', { tabindex: '-1', id: 'q-title', text: step.title });
    var root = h('div', null,
      h('p', { class: 'eyebrow', text: (step.section === 'B' ? 'Payer section · ' : '') + 'Question ' + step.id.replace(/^[AB]/, '') }),
      h1, step.help ? h('p', { class: 'help', text: step.help }) : null);
    var prevType = null;
    step.fieldIds.forEach(function (id, k) {
      var f = FIELD[id];
      if (f.type === 'checkbox' && k > 0 && prevType !== 'checkbox') root.appendChild(h('p', { class: 'help', style: 'margin-top:18px', text: 'Or, if this applies, tick one:' }));
      root.appendChild(renderField(f, step));
      prevType = f.type;
    });
    stage.appendChild(root);
    // focus: first text-ish control, else the title
    var first = root.querySelector('.cells input, input.txt');
    return first && step.fieldIds.length && FIELD[step.fieldIds[0]].type !== 'choice' ? first : h1;
  }

  function isOptional(f) { return ZD.rules && ZD.rules.isRequired ? !ZD.rules.isRequired(f.id, values, sectionOpt()) : false; }

  function renderField(f, step) {
    var msgId = 'msg-' + f.id, lblId = 'lbl-' + f.id;
    var showLabel = !(step.fieldIds.length === 1 && f.type !== 'signature' && f.label === step.title) && f.type !== 'checkbox';
    var w = h('div', { class: 'field', 'data-fid': f.id, role: 'group', 'aria-labelledby': lblId });
    w.addEventListener('focusin', function () { setActive(f.id); });
    var opt = isOptional(f) && f.type !== 'checkbox' && f.type !== 'signature';
    w.appendChild(h('span', { class: 'field-label' + (showLabel ? '' : ' sr-only'), id: lblId }, f.label || f.id, opt ? h('span', { class: 'opt-tag', text: ' (optional)' }) : null));
    if (f.help && showLabel && f.help !== step.help) w.appendChild(h('p', { class: 'help', text: f.help }));
    var body;
    if (f.type === 'boxes') body = f.boxes.length <= 12 ? cellsWidget(f, msgId) : textWidget(f, msgId);
    else if (f.type === 'date') body = cellsWidget(f, msgId);
    else if (f.type === 'choice') body = choiceWidget(f, msgId, opt);
    else if (f.type === 'checkbox') body = checkWidget(f, msgId);
    else if (f.type === 'signature') body = sigWidget(f, msgId);
    w.appendChild(body);
    w.appendChild(h('p', { class: 'msg', id: msgId, 'aria-live': 'polite' }));
    return w;
  }

  /* --- cells (per-box entry) --- */
  // Typed characters are folded to what the printed form can show: accents are removed (É -> E, Ñ -> N),
  // curly quotes/dashes become ' and -. Anything still unsupported is dropped and reported to the user.
  var LIGS = { 'ß': 'SS', 'æ': 'AE', 'œ': 'OE', 'ø': 'O', 'đ': 'D', 'ł': 'L', 'þ': 'TH', 'ı': 'I' };
  function foldChar(ch) {
    if (/[\u2018\u2019\u02bc\u00b4`]/.test(ch)) return "'";
    if (/[\u2010-\u2015\u2212]/.test(ch)) return '-';
    if (/[\u00a0\u2000-\u200a\u3000\t]/.test(ch)) return ' ';
    if (/[\u200b-\u200d\ufeff]/.test(ch)) return '';
    if (ch.charCodeAt(0) < 128) return ch;
    var lo = ch.toLowerCase();
    if (LIGS[lo]) return LIGS[lo];
    var d = ch.normalize ? ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : ch;
    return /^[\x20-\x7e]+$/.test(d) ? d : null;   // null = cannot be represented
  }
  var dropped = [];   // characters removed by the last sanitize() pass
  function sanitizeFor(f) {
    var cs = f.charset || (f.type === 'date' ? 'digits' : 'any');
    return function (ch0) {
      var out = '';
      var folded = cs === 'digits' ? ch0 : foldChar(ch0);
      if (folded === null) { dropped.push(ch0); return ''; }
      Array.from(folded).forEach(function (ch) {
        var ok = cs === 'digits' ? /[0-9]/.test(ch)
          : cs === 'alpha' ? /[A-Za-z '\-]/.test(ch)
          : cs === 'alnum' ? /[A-Za-z0-9]/.test(ch)
          : cs === 'email' ? /[\x21-\x7e]/.test(ch)
          : /[\x20-\x7e]/.test(ch);
        if (ok) out += (cs === 'email' ? ch : ch.toUpperCase());
        else if (!(cs === 'digits' && /[\s\-.\/]/.test(ch)) && ch !== ' ') dropped.push(ch);
      });
      return out;
    };
  }
  var dropNote = {};  // fieldId -> message about characters that were removed
  function noteDropped(id) {
    if (dropped.length) {
      var u = dropped.filter(function (c, i, a) { return a.indexOf(c) === i; }).slice(0, 6).join(' ');
      dropNote[id] = 'Removed ' + u + ' – the form only takes letters, spaces, hyphens and apostrophes here (accents are simplified, e.g. é becomes E).';
      var f = FIELD[id];
      if (f && f.charset === 'digits') dropNote[id] = 'Only numbers go in these boxes – ' + u + ' was removed.';
      else if (f && f.charset !== 'alpha') dropNote[id] = 'Removed ' + u + ' – that character can\'t be printed on the form.';
    } else delete dropNote[id];
    dropped = [];
  }
  function cellsWidget(f, msgId) {
    var n = f.boxes.length, san = sanitizeFor(f), cs = f.charset || 'digits';
    var groups = f.groups && f.groups.reduce(function (a, b) { return a + b; }, 0) === n ? f.groups : [n];
    var inputs = [], cur = String(values[f.id] || '');
    var row = h('div', { class: 'cells' });
    var i0 = 0;
    groups.forEach(function (g, gi) {
      var grp = h('div', { class: 'grp' });
      for (var k = 0; k < g; k++) {
        (function (i) {
          var inp = h('input', {
            type: 'text', maxlength: '', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', autocorrect: 'off',
            inputmode: cs === 'digits' ? 'numeric' : 'text', enterkeyhint: 'next', 'aria-describedby': msgId,
            'aria-label': (f.label || f.id) + ', box ' + (i + 1) + ' of ' + n +
              (f.type === 'date' ? (i < 2 ? ' (day)' : i < 4 ? ' (month)' : ' (year)') : '')
          });
          inp.removeAttribute('maxlength');
          var ch = cur[i]; if (ch && ch !== ' ') { inp.value = ch; inp.classList.add('filled'); }
          inp.addEventListener('focus', function () { inp.select(); inp.setAttribute('data-prev', inp.value); });
          inp.addEventListener('input', function () {
            var raw = inp.value, prev = inp.getAttribute('data-prev') || '';
            // typing into an already-filled box inserts next to the old character: keep only the new one
            if (prev && raw.length > prev.length && raw.indexOf(prev) >= 0) raw = raw.replace(prev, '');
            inp.value = '';
            dropped = [];
            var clean = Array.from(raw).map(san).join('');
            noteDropped(f.id);
            if (!clean && raw.trim() !== '') { return commit(); }
            if (!clean && raw === ' ' && cs !== 'digits') clean = ' ';   // a space skips a box (names), but is ignored between digits
            fill(i, clean || '', false);
          });
          inp.addEventListener('keydown', function (e) {
            if (e.key === 'Backspace' && inp.value === '' && i > 0) {
              e.preventDefault(); inputs[i - 1].value = ''; inputs[i - 1].focus(); commit();
            } else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); inputs[i - 1].focus(); }
            else if (e.key === 'ArrowRight' && i < n - 1) { e.preventDefault(); inputs[i + 1].focus(); }
            else if (e.key === 'Enter') { e.preventDefault(); next(); }
          });
          inp.addEventListener('paste', function (e) {
            var t = (e.clipboardData || window.clipboardData).getData('text') || '';
            e.preventDefault();
            dropped = [];
            var clean = Array.from(t.replace(/[\r\n]+/g, ' ')).map(san).join('');
            noteDropped(f.id);
            if (cs !== 'digits') clean = clean.replace(/^ +| +$/g, '');
            if (clean.length > n) { dropNote[f.id] = 'What you pasted is ' + clean.length + ' characters, but there are only ' + n + ' boxes. Only the first ' + n + ' were used – check them.'; clean = clean.slice(0, n); }
            fill(clean.length > n - i ? 0 : i, clean, true);
          });
          inputs.push(inp); grp.appendChild(inp);
        })(i0++);
      }
      row.appendChild(grp);
      if (f.type === 'date' && gi < groups.length - 1) row.appendChild(h('span', { class: 'sep', 'aria-hidden': 'true', text: '/' }));
    });
    function fill(start, str, isPaste) {
      var p = start;
      Array.from(str).forEach(function (c) { if (p < n) { inputs[p].value = c === ' ' ? '' : c; p++; } });
      commit();
      if (str.length) { var t = Math.min(p, n - 1); inputs[t].focus(); if (isPaste && p >= n) inputs[n - 1].focus(); }
    }
    function commit() {
      inputs.forEach(function (x) { x.classList.toggle('filled', x.value !== ''); x.setAttribute('data-prev', x.value); });
      var compact = cs === 'digits';
      var s = inputs.map(function (x) { return x.value; }).filter(function (c) { return !compact || c !== ''; })
        .map(function (c) { return c === '' ? ' ' : c; }).join('').replace(/\s+$/, '');
      setValue(f.id, s);
      liveCheck(f.id);
    }
    var wrap = h('div', null, row);
    if (f.type === 'date') {
      wrap.appendChild(h('div', { class: 'cells-lab', 'aria-hidden': 'true', style: 'margin-top:4px' }, h('span', { text: 'Day  Month  Year' })));
      if (f.validator === 'date') wrap.appendChild(h('div', { class: 'inline-row', style: 'margin-top:8px' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: function () {
          var d = new Date(), s = ('0' + d.getDate()).slice(-2) + ('0' + (d.getMonth() + 1)).slice(-2) + d.getFullYear();
          fill(0, s, false);
        } }, 'Use today’s date')));
    }
    return wrap;
  }

  /* --- long text as single input mapped to cells --- */
  function textWidget(f, msgId) {
    var n = f.boxes.length, cs = f.charset, upper = cs !== 'email';
    var cnt = h('p', { class: 'counter', id: 'cnt-' + f.id });
    var inp = h('input', {
      class: 'txt', type: cs === 'email' ? 'email' : 'text', id: 'in-' + f.id, autocomplete: cs === 'email' ? 'off' : 'off',
      inputmode: cs === 'email' ? 'email' : 'text', autocapitalize: upper ? 'characters' : 'none', spellcheck: 'false', autocorrect: 'off',
      enterkeyhint: 'next', placeholder: f.placeholder || '', 'aria-describedby': msgId + ' cnt-' + f.id,
      'aria-labelledby': 'lbl-' + f.id, style: upper ? 'text-transform:uppercase' : ''
    });
    inp.value = String(values[f.id] || '');
    function upd() {
      var s = inp.value;
      if (upper) {
        var san = sanitizeFor(f);
        var pos = inp.selectionStart;
        dropped = [];
        var c = Array.from(s).map(san).join('');
        noteDropped(f.id);
        if (c !== s) { inp.value = c; try { inp.setSelectionRange(pos, pos); } catch (e) {} }
        s = c;
      }
      s = s.replace(/^ +/, '');
      if (cs === 'email') s = s.replace(/\s/g, '');
      setValue(f.id, s);
      var over = s.length > n;
      cnt.textContent = over ? 'Too long: ' + s.length + ' of ' + n + ' characters fit on the form.' : 'Fits ' + s.length + '/' + n + ' characters';
      cnt.className = 'counter' + (over ? ' over' : s.length ? ' good' : '');
      liveCheck(f.id);
    }
    inp.addEventListener('input', upd);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); next(); } });
    var wrap = h('div', null, inp, cnt);
    if (cs === 'email') wrap.appendChild(h('p', { class: 'help', style: 'margin-top:4px;font-size:.85rem', text: 'It is written across two rows of boxes on the form.' }));
    setTimeout(function () { var s = inp.value; cnt.textContent = 'Fits ' + s.length + '/' + n + ' characters'; cnt.className = 'counter' + (s.length ? ' good' : ''); }, 0);
    return wrap;
  }

  /* --- choice & checkbox --- */
  function choiceWidget(f, msgId, optional) {
    var many = f.options.length > 3 || f.options.some(function (o) { return o.label.length > 22; });
    var g = h('div', { class: 'opts' + (many ? ' stack' : ''), role: 'radiogroup', 'aria-labelledby': 'lbl-' + f.id });
    f.options.forEach(function (o, i) {
      var inp = h('input', { type: 'radio', name: 'r-' + f.id, value: o.value, 'aria-describedby': msgId });
      if (values[f.id] === o.value) inp.checked = true;
      inp.addEventListener('change', function () { setValue(f.id, o.value); delete errors[f.id]; paintMsg(f.id); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); next(); } });
      g.appendChild(h('label', { class: 'opt' }, inp, h('span', { text: o.label })));
    });
    var wrap = h('div', null, g);
    if (optional) wrap.appendChild(h('div', { style: 'margin-top:6px' }, h('button', { type: 'button', class: 'link-btn', onclick: function () {
      g.querySelectorAll('input').forEach(function (i) { i.checked = false; }); setValue(f.id, ''); } }, 'Clear this answer')));
    return wrap;
  }
  function checkWidget(f, msgId) {
    var inp = h('input', { type: 'checkbox', 'aria-describedby': msgId });
    inp.checked = values[f.id] === true;
    inp.addEventListener('change', function () { setValue(f.id, inp.checked ? true : false); delete errors[f.id]; paintMsg(f.id); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); next(); } });
    return h('div', { class: 'opts stack' }, h('label', { class: 'opt check' }, inp, h('span', { id: 'lbl-' + f.id, text: f.label })));
  }

  /* --- signature --- */
  function sigWidget(f, msgId) {
    var cur = values[f.id] || '';
    var mode = /^data:image\//.test(cur) ? 'draw' : (cur ? 'type' : 'type');
    var box = h('div');
    var tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'How do you want to sign?' });
    var panel = h('div', { role: 'tabpanel' });
    function tab(m, label) {
      var b = h('button', { type: 'button', role: 'tab', 'aria-selected': mode === m ? 'true' : 'false', text: label, onclick: function () {
        if (mode === m) return; mode = m; setValue(f.id, ''); draw(); } });
      return b;
    }
    function draw() {
      tabs.innerHTML = ''; tabs.appendChild(tab('type', 'Type')); tabs.appendChild(tab('draw', 'Draw'));
      panel.innerHTML = '';
      if (mode === 'type') {
        var t = h('input', { class: 'txt sig-typed', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'Type your full name', 'aria-label': 'Type your full name to sign', 'aria-describedby': msgId });
        t.value = /^data:/.test(cur) ? '' : (values[f.id] || '');
        t.addEventListener('input', function () { setValue(f.id, t.value.trim() ? t.value : ''); delete errors[f.id]; paintMsg(f.id); });
        t.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); next(); } });
        panel.appendChild(t);
        panel.appendChild(h('p', { class: 'help', style: 'margin-top:6px', text: 'Your typed name will appear in a handwriting style on the form.' }));
      } else panel.appendChild(drawPad());
    }
    function drawPad() {
      var wrapper = h('div');
      var cv = h('canvas', { class: 'sig-pad', tabindex: '0', role: 'img', 'aria-label': 'Signature pad. Draw with your finger or mouse. Or switch to the Type tab to sign with the keyboard.' });
      var hint = h('p', { class: 'help', style: 'margin-top:6px', text: 'Draw your signature above using your finger or mouse.' });
      var ctx, dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1)), drawing = false, last = null, strokes = 0, minX, minY, maxX, maxY;
      function size() {
        var w = cv.clientWidth || 300, hgt = Math.round(Math.min(220, Math.max(140, w * 0.38)));
        cv.style.height = hgt + 'px'; cv.width = w * dpr; cv.height = hgt * dpr;
        ctx = cv.getContext('2d'); ctx.scale(dpr, dpr); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111a4a';
        minX = minY = 1e9; maxX = maxY = -1; strokes = 0;
        if (/^data:image\//.test(values[f.id] || '')) {
          var im = new Image(); im.onload = function () {
            var s = Math.min((w - 20) / im.width, (hgt - 20) / im.height, 1);
            ctx.drawImage(im, (w - im.width * s) / 2, (hgt - im.height * s) / 2, im.width * s, im.height * s);
          }; im.src = values[f.id];
        }
      }
      function pt(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
      cv.addEventListener('pointerdown', function (e) {
        e.preventDefault(); if (!ctx) size(); try { cv.setPointerCapture(e.pointerId); } catch (x) {} drawing = true; last = pt(e);
        if (strokes === 0 && /^data:/.test(values[f.id] || '')) { /* existing picture stays as background */ }
        ctx.beginPath(); ctx.arc(last.x, last.y, 1.3, 0, 7); ctx.fillStyle = '#111a4a'; ctx.fill(); bound(last);
      });
      cv.addEventListener('pointermove', function (e) {
        if (!drawing || !ctx) return; e.preventDefault();
        var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        (evs.length ? evs : [e]).forEach(function (ev) {
          var p = pt(ev); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; bound(p);
        });
      });
      function bound(p) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
      function end() { if (!drawing) return; drawing = false; strokes++; save(); }
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      function save() {
        // crop to the ink so it fills the small signature box on the form
        var pad = 6, x0 = Math.max(0, (minX - pad) * dpr), y0 = Math.max(0, (minY - pad) * dpr);
        var x1 = Math.min(cv.width, (maxX + pad) * dpr), y1 = Math.min(cv.height, (maxY + pad) * dpr);
        var w = Math.max(4, x1 - x0), hh = Math.max(4, y1 - y0);
        var o = document.createElement('canvas'); o.width = w; o.height = hh;
        o.getContext('2d').drawImage(cv, x0, y0, w, hh, 0, 0, w, hh);
        setValue(f.id, o.toDataURL('image/png')); delete errors[f.id]; paintMsg(f.id);
        // make later strokes keep the cropped bounds of the whole canvas
        minX = Math.min(minX, 1e9);
      }
      var clear = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: function () { setValue(f.id, ''); size(); } }, 'Clear and redraw');
      wrapper.appendChild(cv); wrapper.appendChild(h('div', { class: 'sig-tools' }, hint, clear));
      setTimeout(function () { if (!ctx) size(); }, 0);
      return wrapper;
    }
    draw();
    box.appendChild(tabs); box.appendChild(panel);
    return box;
  }

  /* ---------- review ---------- */
  function displayValue(f) {
    var v = values[f.id];
    if (!hasVal(v)) return null;
    if (f.type === 'choice') { var o = f.options.filter(function (x) { return x.value === v; })[0]; return o ? o.label : String(v); }
    if (f.type === 'checkbox') return 'Ticked';
    if (f.type === 'signature') return /^data:/.test(v) ? 'Signature drawn' : 'Signed as "' + v + '"';
    if (f.type === 'date' && String(v).length === 8) return v.slice(0, 2) + '/' + v.slice(2, 4) + '/' + v.slice(4);
    return String(v);
  }
  function renderReview() {
    var h1 = h('h2', { tabindex: '-1', text: 'Review your answers' });
    var res = ZD.rules && ZD.rules.validateAll ? ZD.rules.validateAll(values, FJ, sectionOpt()) : { errors: {}, warnings: {}, complete: true };
    var errIds = Object.keys(res.errors);
    var root = h('div', null, h('p', { class: 'eyebrow', text: 'Final check' }), h1);
    var flowItems = flow();
    function indexOfStep(step) { for (var i = 0; i < flowItems.length; i++) if (flowItems[i].step === step) return i; return -1; }
    if (errIds.length) {
      var ul = h('ul');
      errIds.forEach(function (id) {
        var st = STEPS.filter(function (s) { return s.fieldIds.indexOf(id) >= 0; })[0];
        var li = h('li', null, res.errors[id] + ' ');
        if (st) li.appendChild(h('a', { href: '#', onclick: function (e) { e.preventDefault(); editFromReview(indexOfStep(st)); } }, 'Fix'));
        ul.appendChild(li);
      });
      root.appendChild(h('div', { class: 'alert alert-err', role: 'alert' }, h('strong', { text: errIds.length + (errIds.length === 1 ? ' thing needs' : ' things need') + ' your attention before you can download:' }), ul));
    } else {
      root.appendChild(h('div', { class: 'alert alert-ok', role: 'status' }, 'Everything required is filled in. Check the answers below, then download your PDF.'));
    }
    Object.keys(res.warnings || {}).forEach(function (id) {
      root.appendChild(h('div', { class: 'alert', style: 'background:var(--amber-l);color:#5c3d00', role: 'status' }, res.warnings[id]));
    });
    var card = h('div', { class: 'card' });
    var sec = null;
    STEPS.forEach(function (s) {
      if (s.section === 'B' && !optB) return;
      if (s.section !== sec) { sec = s.section; card.appendChild(h('p', { class: 'rev-sec', text: sec === 'A' ? 'Your details' : 'Payer section' })); }
      var lines = s.fieldIds.map(function (id) { var f = FIELD[id], d = displayValue(f); return d == null ? null : h('div', { class: 'rev-val' }, (s.fieldIds.length > 1 ? (f.label + ': ') : '') + d); }).filter(Boolean);
      var bad = s.fieldIds.filter(function (id) { return res.errors[id]; });
      card.appendChild(h('div', { class: 'rev-step' },
        h('div', { class: 'rev-main' }, h('div', { class: 'rev-title', text: s.title }),
          lines.length ? lines : h('div', { class: 'rev-val none', text: 'Not answered' }),
          bad.map(function (id) { return h('div', { class: 'rev-err', text: res.errors[id] }); })),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Edit: ' + s.title, onclick: function () { editFromReview(indexOfStep(s)); } }, 'Edit')));
    });
    root.appendChild(card);
    if (!optB) root.appendChild(h('p', { class: 'help' }, 'Payer section skipped. ', h('button', { type: 'button', class: 'link-btn', onclick: function () { optB = true; var f = flow(); for (var i = 0; i < f.length; i++) if (f[i].t === 'step' && f[i].step.section === 'B') { go(i); return; } } }, 'Fill it in now')));
    var complete = errIds.length === 0;
    var st = h('p', { class: 'msg', 'aria-live': 'polite', id: 'export-status' });
    var dl = h('button', { type: 'button', class: 'btn btn-green', id: 'btn-dl', 'aria-disabled': complete ? null : 'true', onclick: function () { if (!complete) return announce('Fix the items above first.'); exportPdf(st); } }, 'Download PDF');
    var pr = h('button', { type: 'button', class: 'btn btn-primary', id: 'btn-print', 'aria-disabled': complete ? null : 'true', onclick: function () { if (!complete) return announce('Fix the items above first.'); printForm(st); } }, 'Print');
    root.appendChild(h('div', { class: 'actions' }, dl, pr));
    root.appendChild(st);
    root.appendChild(h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: back }, 'Back'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: confirmStartOver }, 'Start over and delete my data')));
    root.appendChild(h('p', { class: 'help', style: 'margin-top:14px', text: 'The PDF is made on this device. Print or send it to your employer yourself; we never see it.' }));
    stage.appendChild(root);
    return h1;
  }

  /* ---------- export ---------- */
  function renderFinal(cb) {
    var c = document.createElement('canvas'), imgs = {}, pending = 0, fired = false;
    function finish() {
      if (fired) return; fired = true;
      ZD.render(c, IMG, FJ, values, { scale: 2, forExport: true, sigImages: imgs });
      cb(c);
    }
    // preload drawn signatures so the export never misses them (render loads them async)
    Object.keys(values).forEach(function (k) {
      var v = values[k];
      if (FIELD[k] && FIELD[k].type === 'signature' && /^data:image\//.test(v) && !imgs[v]) {
        pending++;
        var im = new Image();
        im.onload = im.onerror = function () { imgs[v] = im; if (--pending === 0) finish(); };
        im.src = v;
      }
    });
    if (!pending) finish();
    else setTimeout(finish, 4000);
  }
  function exportPdf(statusEl) {
    statusEl.className = 'msg'; statusEl.textContent = 'Preparing your PDF…';
    renderFinal(function (c) {
      try {
        var bytes = ZD.pdf.fromCanvas(c, { quality: 0.92 });
        ZD.pdf.download(bytes, 'TFN-declaration-NAT3092.pdf');
        statusEl.textContent = 'Your PDF was saved to your downloads. It was made on this device. Delete the downloaded file after you have sent it to your employer, and send it by a secure channel, not plain email.';
      } catch (e) { statusEl.className = 'msg err'; statusEl.textContent = 'Sorry, the PDF could not be created. Try Print instead.'; }
    });
  }
  function printForm(statusEl) {
    statusEl.className = 'msg'; statusEl.textContent = 'Opening print…';
    renderFinal(function (c) {
      var url = c.toDataURL('image/jpeg', 0.92);
      var old = document.getElementById('print-frame'); if (old) old.remove();
      var fr = h('iframe', { id: 'print-frame', title: 'Print', 'aria-hidden': 'true', style: 'position:fixed;right:0;bottom:0;width:0;height:0;border:0' });
      document.body.appendChild(fr);
      var d = fr.contentWindow.document;
      d.open();
      d.write('<!doctype html><html><head><title>TFN declaration</title><style>@page{size:A4;margin:0}html,body{margin:0;padding:0}img{display:block;width:210mm;height:297mm;object-fit:contain}</style></head><body><img alt="Completed TFN declaration"></body></html>');
      d.close();
      var im = d.querySelector('img');
      im.onload = function () { setTimeout(function () { try { fr.contentWindow.focus(); fr.contentWindow.print(); statusEl.textContent = ''; } catch (e) { statusEl.className = 'msg err'; statusEl.textContent = 'Printing is not available here. Download the PDF instead.'; } }, 100); };
      im.src = url;
    });
  }

  /* ---------- start over ---------- */
  function confirmStartOver() {
    var d = $('dlg-confirm');
    if (d.showModal) { d.returnValue = ''; d.showModal(); $('dlg-cancel').focus(); }
    else if (window.confirm('Delete everything you typed from this device and start over?')) doStartOver();
  }
  function doStartOver() {
    if (ZD.store) { if (ZD.store.wipeAll) ZD.store.wipeAll(); else if (ZD.store.clear) ZD.store.clear(); }
    values = {}; optB = false; $('resume-banner').hidden = true;
    go(0); announce('Your data was deleted from this device.');
  }

  /* ---------- preview ---------- */
  var pvRaf = 0;
  function setActive(fid, noLayout) {
    if (fid === activeFid && !noLayout) return;
    activeFid = fid || activeFid;
    renderPreview(); layoutPreview();
  }
  function renderPreview() {
    if (!IMG || !ZD.render) return;
    if (pvRaf) return;
    pvRaf = requestAnimationFrame(function () {
      pvRaf = 0;
      ZD.render($('pv-canvas'), IMG, FJ, values, { scale: 2, highlightFieldId: activeFid, onUpdate: renderPreview });
    });
  }
  function fieldBounds(f) {
    if (ZD.render && ZD.render.fieldRect) { var r = ZD.render.fieldRect(f); if (r) return r; }
    var rs = (f.boxes || []).concat((f.options || []).map(function (o) { return o.rect; }), f.rect ? [f.rect] : []);
    if (!rs.length) return null;
    var x0 = Math.min.apply(0, rs.map(function (r) { return r.x; })), y0 = Math.min.apply(0, rs.map(function (r) { return r.y; }));
    var x1 = Math.max.apply(0, rs.map(function (r) { return r.x + r.w; })), y1 = Math.max.apply(0, rs.map(function (r) { return r.y + r.h; }));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function layoutPreview() {
    var vp = $('pv-viewport'), st = $('pv-stage');
    if (!vp || !FJ || $('pv-body').hidden) return;
    var vw = vp.clientWidth, vh = vp.clientHeight, W = FJ.image.w, H = FJ.image.h;
    if (!vw || !vh) return;
    var fit = Math.min(vw / W, vh / H), s = fit, tx, ty;
    var b = activeFid && FIELD[activeFid] ? fieldBounds(FIELD[activeFid]) : null;
    if (pvMode === 'zoom' && b) {
      // zoom on the whole question (all its fields) when they are near each other, otherwise the active field
      var item = flow()[idx], rs = [b];
      if (item && item.t === 'step') {
        var u = item.step.fieldIds.map(function (id) { return fieldBounds(FIELD[id]); }).filter(Boolean);
        var ux0 = Math.min.apply(0, u.map(function (r) { return r.x; })), uy0 = Math.min.apply(0, u.map(function (r) { return r.y; }));
        var ux1 = Math.max.apply(0, u.map(function (r) { return r.x + r.w; })), uy1 = Math.max.apply(0, u.map(function (r) { return r.y + r.h; }));
        if ((ux1 - ux0) <= W * 0.75 && (uy1 - uy0) <= H * 0.3) rs = [{ x: ux0, y: uy0, w: ux1 - ux0, h: uy1 - uy0 }];
      }
      var r = rs[0];
      s = Math.min(vw * 0.92 / (r.w + 24), vh * 0.85 / (r.h + 24), 4);
      s = Math.max(s, vw / W);
      var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      tx = vw / 2 - cx * s; ty = vh / 2 - cy * s;
      tx = Math.min(0, Math.max(vw - W * s, tx)); ty = Math.min(0, Math.max(vh - H * s, ty));
    } else {
      tx = (vw - W * s) / 2; ty = (vh - H * s) / 2;
    }
    st.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) scale(' + s.toFixed(4) + ')';
  }
})();
