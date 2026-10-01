/* App shell wiring. Talks to the core only through window.ZDEditor (may load later). */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var LS_FOCUS = 'zd-focus-mode', LS_TIP = 'zd-tip-dismissed';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function ed() { return window.ZDEditor || null; }
  function call(name) {
    var E = ed(); if (!E || typeof E[name] !== 'function') return undefined;
    try { return E[name].apply(E, Array.prototype.slice.call(arguments, 1)); } catch (e) { return undefined; }
  }

  var toastTimer;
  function toast(msg) {
    var t = $('#zd-toast'); if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  /* ---- guided fill switch ---- */
  var guided = lsGet(LS_FOCUS) !== '0';
  function paintGuided() {
    $$('[data-act="guided"]').forEach(function (b) { b.setAttribute('aria-checked', guided ? 'true' : 'false'); });
  }
  function setGuided(v, fromCore) {
    guided = !!v; lsSet(LS_FOCUS, guided ? '1' : '0'); paintGuided();
    if (!fromCore) call('setGuided', guided);
  }

  /* ---- undo / redo state ---- */
  function refreshHistory() {
    var u = !!call('canUndo'), r = !!call('canRedo');
    $$('[data-act="undo"]').forEach(function (b) { b.disabled = !u; });
    $$('[data-act="redo"]').forEach(function (b) { b.disabled = !r; });
  }

  /* ---- share (only when the core can hand us the PDF and the browser can share files) ---- */
  function getPdfFile() {
    var E = ed();
    var fn = E && (E.getPdf || E.pdfBlob);
    if (typeof fn !== 'function') return null;
    return Promise.resolve(fn.call(E)).then(function (b) {
      if (!b) return null;
      return b instanceof File ? b : new File([b], 'Form-N3092.pdf', { type: 'application/pdf' });
    });
  }
  function shareSupported() {
    var E = ed();
    if (!E || !(E.getPdf || E.pdfBlob) || !navigator.share || !navigator.canShare) return false;
    try { return navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] }); } catch (e) { return false; }
  }
  function refreshShare() { $$('[data-act="share"]').forEach(function (b) { b.hidden = !shareSupported(); }); }

  /* ---- menus ---- */
  function closeMenus(except) {
    $$('.zd-menu').forEach(function (m) {
      if (m === except) return;
      m.hidden = true;
      var t = $('[aria-controls="' + m.id + '"]'); if (t) t.setAttribute('aria-expanded', 'false');
    });
  }
  function toggleMenu(btn) {
    var m = document.getElementById(btn.getAttribute('aria-controls'));
    var open = m.hidden;
    closeMenus(open ? m : null);
    m.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { var f = $('button', m); if (f) f.focus(); }
  }
  function closeHelp() {
    var p = $('#zd-help-panel'); if (p) p.hidden = true;
    var h = $('#zd-help'); if (h) h.setAttribute('aria-expanded', 'false');
  }

  function signStepIndex() {
    var steps = null;
    try {
      var d = window.ZD_FIELDS || JSON.parse($('#fields-json').textContent);
      steps = d && d.steps;
    } catch (e) {}
    if (!steps) return -1;
    for (var i = 0; i < steps.length; i++) {
      var ids = steps[i].fieldIds || steps[i].fields || [];
      if (ids.indexOf('sig_a') >= 0) return i;
    }
    return -1;
  }

  function startOver() {
    var dlg = $('#zd-confirm');
    var run = function () {
      call('reset');
      try { if (window.ZD && ZD.store && ZD.store.wipeAll) ZD.store.wipeAll(); } catch (e) {}
      toast('Cleared. Your answers were deleted from this device.');
      refreshHistory();
    };
    if (dlg && typeof dlg.showModal === 'function') {
      dlg.returnValue = '';
      dlg.addEventListener('close', function once() {
        dlg.removeEventListener('close', once);
        if (dlg.returnValue === 'ok') run();
      });
      dlg.showModal();
    } else if (window.confirm('Delete everything you have typed from this device?')) run();
  }

  var actions = {
    undo: function () { call('undo'); refreshHistory(); },
    redo: function () { call('redo'); refreshHistory(); },
    download: function () { call('download'); },
    print: function () { call('print'); },
    share: function () {
      var p = getPdfFile(); if (!p) return;
      p.then(function (f) {
        if (f && navigator.canShare({ files: [f] })) return navigator.share({ files: [f], title: 'Form - N3092' });
      }).catch(function () {});
    },
    done: function () {
      var E = ed();
      if (E && typeof E.finish === 'function') call('finish'); else call('download');
    },
    guided: function () { setGuided(!guided); },
    thumbs: function (btn) {
      var s = $('#zd-sidebar'); var show = s.style.display === 'none';
      s.style.display = show ? '' : 'none';
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    },
    thumb1: function () { call('close'); var c = $('#zd-canvas'); if (c) c.scrollTo ? c.scrollTo({ top: 0 }) : (c.scrollTop = 0); },
    sign: function () {
      var i = signStepIndex(); call('open', i >= 0 ? i : 0);
    },
    more: function (btn) { toggleMenu(btn); },
    startover: function () { closeMenus(); startOver(); }
  };

  function init() {
    paintGuided();
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (b && !b.disabled && actions[b.getAttribute('data-act')]) {
        var act = b.getAttribute('data-act');
        if (act !== 'more') closeMenus();
        actions[act](b);
        return;
      }
      if (!e.target.closest('.zd-menu-wrap')) closeMenus();
      if (!e.target.closest('.zd-help-wrap')) closeHelp();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var anyMenu = $$('.zd-menu').some(function (m) { return !m.hidden; });
      var help = $('#zd-help-panel') && !$('#zd-help-panel').hidden;
      if (anyMenu || help) {
        var t = anyMenu ? $('.zd-tool[aria-expanded=true], .zd-bb[aria-expanded=true]') : $('#zd-help');
        closeMenus(); closeHelp(); if (t) t.focus();
        e.stopPropagation();
      }
    }, true);

    var help = $('#zd-help');
    help.addEventListener('click', function () {
      var p = $('#zd-help-panel'); var open = p.hidden;
      p.hidden = !open; help.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    var tip = $('#zd-tip');
    if (lsGet(LS_TIP) === '1') tip.hidden = true;
    $('#zd-tip-x').addEventListener('click', function () { tip.hidden = true; lsSet(LS_TIP, '1'); help.focus(); });

    /* attach to the core, whenever it appears */
    var attached = false, tries = 0;
    function attach() {
      var E = ed();
      if (!E) { if (tries++ < 100) setTimeout(attach, 100); return; }
      if (!attached) {
        attached = true;
        try {
          E.on('change', refreshHistory);
          E.on('step', refreshHistory);
          E.on('guided', function () { var g = call('isGuided'); if (typeof g === 'boolean') { guided = g; lsSet(LS_FOCUS, g ? '1' : '0'); paintGuided(); } });
        } catch (e) {}
        call('setGuided', guided);
      }
      refreshHistory(); refreshShare();
    }
    attach();
    document.addEventListener('zd-ready', attach);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
