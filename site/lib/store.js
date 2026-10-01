(function (root) {
  'use strict';
  var KEY = 'zd.nat3092.v1', TTL = 24 * 3600 * 1000, PREFIX = 'zd.';
  var mem = {}, timer = null, pending = null;

  function ls() { try { var s = root.localStorage; if (s) return s; } catch (e) {} return null; }
  function now() { return Date.now(); }

  function write(values) {
    var raw, persisted = {};
    // Sensitive answers are kept in memory only, never written to localStorage.
    var SENS = { tfn: 1, dob: 1, sig_a: 1, sig_b: 1, email: 1, biz_email: 1 };
    Object.keys(values || {}).forEach(function (k) { if (!SENS[k]) persisted[k] = values[k]; });
    try { raw = JSON.stringify({ v: 1, t: now(), values: persisted }); } catch (e) { return false; }
    mem[KEY] = raw;
    try { var s = ls(); if (s) s.setItem(KEY, raw); } catch (e) {}
    return true;
  }
  function readRaw() {
    try { var s = ls(); if (s) { var r = s.getItem(KEY); if (r != null) return r; } } catch (e) {}
    return mem[KEY] != null ? mem[KEY] : null;
  }
  function parse() {
    var raw = readRaw(); if (raw == null) return null;
    try {
      var d = JSON.parse(raw);
      if (!d || d.v !== 1 || typeof d.t !== 'number' || !d.values || typeof d.values !== 'object') throw 0;
      if (now() - d.t > TTL || d.t - now() > 86400000) throw 0;
      return d;
    } catch (e) { removeKey(); return null; }
  }
  function removeKey() { delete mem[KEY]; try { var s = ls(); if (s) s.removeItem(KEY); } catch (e) {} }

  function save(values, opts) {
    try {
      var wait = opts && opts.wait != null ? opts.wait : 400;
      pending = values;
      if (timer) clearTimeout(timer);
      if (wait <= 0) { flush(); return; }
      timer = setTimeout(flush, wait);
    } catch (e) {}
  }
  function flush() {
    try { if (timer) { clearTimeout(timer); timer = null; } if (pending) { var v = pending; pending = null; write(v); } } catch (e) {}
  }
  function load() { try { flush(); var d = parse(); return d ? d.values : null; } catch (e) { return null; } }
  function hasDraft() {
    try { flush(); var d = parse(); return !!d && Object.keys(d.values).some(function (k) { var v = d.values[k]; return v !== '' && v != null && v !== false; }); } catch (e) { return false; }
  }
  function clear() {
    try { if (timer) { clearTimeout(timer); timer = null; } pending = null; removeKey(); } catch (e) {}
  }
  function wipeAll() {
    clear();
    try { Object.keys(mem).forEach(function (k) { if (k.indexOf(PREFIX) === 0) delete mem[k]; }); } catch (e) {}
    try {
      var s = ls();
      if (s) {
        var keys = [];
        for (var i = 0; i < s.length; i++) { var k = s.key(i); if (k && k.indexOf(PREFIX) === 0) keys.push(k); }
        keys.forEach(function (k) { try { s.removeItem(k); } catch (e) {} });
      }
    } catch (e) {}
    try { var ss = root.sessionStorage; if (ss) { var ks = []; for (var j = 0; j < ss.length; j++) { var kk = ss.key(j); if (kk && kk.indexOf(PREFIX) === 0) ks.push(kk); } ks.forEach(function (k) { ss.removeItem(k); }); } } catch (e) {}
  }

  var api = { save: save, load: load, clear: clear, hasDraft: hasDraft, wipeAll: wipeAll, flush: flush, KEY: KEY, TTL: TTL };
  root.ZD = root.ZD || {}; root.ZD.store = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
