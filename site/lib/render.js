(function (root) {
  'use strict';
  var INK = '#111a4a';
  var MONO = '"Courier New",Menlo,Consolas,monospace';
  var CURSIVE = "'Snell Roundhand','Segoe Script','Brush Script MT','Lucida Handwriting',cursive";
  var sigCache = {};

  function isDataUrl(s) { return typeof s === 'string' && /^data:image\//.test(s); }

  function getSigImage(dataUrl, opts) {
    if (opts && opts.sigImages && opts.sigImages[dataUrl]) return opts.sigImages[dataUrl];
    var c = sigCache[dataUrl];
    if (c) return c.ready ? c.img : null;
    if (typeof Image === 'undefined') return null;
    var img = new Image();
    c = sigCache[dataUrl] = { img: img, ready: false };
    img.onload = function () { c.ready = true; if (opts && typeof opts.onUpdate === 'function') { try { opts.onUpdate(); } catch (e) {} } };
    img.onerror = function () { c.ready = false; };
    img.src = dataUrl;
    return null;
  }

  function drawBoxes(ctx, f, val) {
    var text = String(val == null ? '' : val).toUpperCase();
    if (!text || !f.boxes) return;
    var chars = Array.from(text.replace(/[\r\n]+/g, ' '));
    for (var i = 0; i < f.boxes.length && i < chars.length; i++) {
      var ch = chars[i];
      if (ch === ' ') continue;
      var b = f.boxes[i];
      var size = Math.max(6, Math.round(b.h * 0.62));
      ctx.font = 'bold ' + size + 'px ' + MONO;
      var w = ctx.measureText ? ctx.measureText(ch).width : size * 0.6;
      var maxW = b.w * 0.92;
      if (w > maxW && w > 0) {
        ctx.font = 'bold ' + Math.max(5, Math.floor(size * maxW / w)) + 'px ' + MONO;
      }
      ctx.fillText(ch, b.x + b.w / 2, b.y + b.h / 2);
    }
  }

  function drawTick(ctx, r) {
    var pad = Math.min(r.w, r.h) * 0.2;
    ctx.save();
    ctx.lineWidth = Math.max(2, Math.min(r.w, r.h) * 0.16);
    ctx.lineCap = 'round';
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(r.x + pad, r.y + pad); ctx.lineTo(r.x + r.w - pad, r.y + r.h - pad);
    ctx.moveTo(r.x + r.w - pad, r.y + pad); ctx.lineTo(r.x + pad, r.y + r.h - pad);
    ctx.stroke();
    ctx.restore();
  }

  function drawSignature(ctx, f, val, opts) {
    var r = f.rect; if (!r || !val) return;
    if (isDataUrl(val)) {
      var img = getSigImage(val, opts);
      if (!img) return;
      var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      if (!iw || !ih) return;
      var s = Math.min(r.w / iw, r.h / ih);
      var dw = iw * s, dh = ih * s;
      ctx.drawImage(img, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
    } else {
      var size = Math.max(10, Math.round(r.h * 0.6));
      ctx.save();
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = 'italic ' + size + 'px ' + CURSIVE;
      var t = String(val), w = ctx.measureText ? ctx.measureText(t).width : size * t.length * 0.5;
      var off = r.w * 0.16, avail = r.w - off - r.w * 0.02; // keep clear of the 'sign' badge at the left
      if (w > avail && w > 0) ctx.font = 'italic ' + Math.max(8, Math.floor(size * avail / w)) + 'px ' + CURSIVE;
      ctx.fillText(t, r.x + off, r.y + r.h / 2);
      ctx.restore();
    }
  }

  function fieldRect(f) {
    if (f.rect) return f.rect;
    var bs = f.boxes; if (bs && bs.length) {
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      bs.forEach(function (b) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    var os = f.options; if (os && os.length) {
      var a = 1e9, b2 = 1e9, c = -1e9, d = -1e9;
      os.forEach(function (o) { var r = o.rect; a = Math.min(a, r.x); b2 = Math.min(b2, r.y); c = Math.max(c, r.x + r.w); d = Math.max(d, r.y + r.h); });
      return { x: a, y: b2, w: c - a, h: d - b2 };
    }
    return null;
  }

  function render(canvas, image, fieldsJson, values, opts) {
    opts = opts || {}; values = values || {};
    var W = (fieldsJson.image && fieldsJson.image.w) || image.width;
    var H = (fieldsJson.image && fieldsJson.image.h) || image.height;
    var scale = opts.scale > 0 ? opts.scale : 1;
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    var ctx = canvas.getContext('2d');
    ctx.save();
    if (ctx.setTransform) ctx.setTransform(scale, 0, 0, scale, 0, 0); else ctx.scale(scale, scale);
    ctx.drawImage(image, 0, 0, W, H);
    // source scan has a stray dark-blue 'sign' badge fragment inside the Section B signature box; repaint it with the box fill
    if (W === 1024 && H === 1449) {
      ctx.fillStyle = 'rgb(204,215,255)'; ctx.fillRect(526, 1169, 94, 19);
      ctx.fillStyle = '#fff'; ctx.fillRect(519, 1169, 6, 19);
      ctx.fillStyle = 'rgb(47,43,44)'; ctx.fillRect(525, 1169, 1, 19);
    }
    ctx.fillStyle = INK; ctx.strokeStyle = INK;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    (fieldsJson.fields || []).forEach(function (f) {
      var v = values[f.id];
      if (v == null || v === '' || v === false) return;
      ctx.save();
      ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      try {
        if (f.type === 'boxes' || f.type === 'date') drawBoxes(ctx, f, v);
        else if (f.type === 'choice') {
          (f.options || []).forEach(function (o) { if (o.value === v) drawTick(ctx, o.rect); });
        } else if (f.type === 'checkbox') {
          if (v === true && f.options && f.options[0]) drawTick(ctx, f.options[0].rect);
        } else if (f.type === 'signature') drawSignature(ctx, f, v, opts);
      } catch (e) { /* never break rendering */ }
      ctx.restore();
    });
    if (!opts.forExport && opts.highlightFieldId) {
      var hf = (fieldsJson.fields || []).filter(function (f) { return f.id === opts.highlightFieldId; })[0];
      var r = hf && fieldRect(hf);
      if (r) {
        var p = 4;
        ctx.fillStyle = 'rgba(31,117,219,0.18)';
        ctx.fillRect(r.x - p, r.y - p, r.w + 2 * p, r.h + 2 * p);
        ctx.strokeStyle = 'rgba(31,117,219,0.9)'; ctx.lineWidth = 2;
        ctx.strokeRect(r.x - p, r.y - p, r.w + 2 * p, r.h + 2 * p);
      }
    }
    ctx.restore();
    return canvas;
  }

  var api = { render: render, fieldRect: fieldRect, INK: INK, CURSIVE: CURSIVE };
  root.ZD = root.ZD || {};
  root.ZD.render = render;
  Object.keys(api).forEach(function (k) { if (k !== 'render') render[k] = api[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = api.render, module.exports.render = render, Object.keys(api).forEach(function (k) { module.exports[k] = api[k]; });
})(typeof window !== 'undefined' ? window : globalThis);
