(function (root) {
  'use strict';
  var PW = 595.28, PH = 841.89, MARGIN = 24;

  function enc(s) { var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; }
  function num(n) { return (Math.round(n * 100) / 100).toString(); }
  function pdfString(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); out += (c < 32 || c > 126 || c === 40 || c === 41 || c === 92) ? (c > 126 || c < 32 ? '?' : '\\' + s[i]) : s[i]; }
    return '(' + out + ')';
  }

  function fromJpegBytes(jpeg, w, h, opts) {
    opts = opts || {};
    var title = opts.title || 'TFN Declaration (NAT 3092)';
    var s = Math.min((PW - 2 * MARGIN) / w, (PH - 2 * MARGIN) / h);
    var dw = w * s, dh = h * s, x = (PW - dw) / 2, y = (PH - dh) / 2;
    var content = 'q\n' + num(dw) + ' 0 0 ' + num(dh) + ' ' + num(x) + ' ' + num(y) + ' cm\n/Im0 Do\nQ\n';
    var chunks = [], offsets = [], pos = 0;
    function push(u8) { chunks.push(u8); pos += u8.length; }
    function pushS(s2) { push(enc(s2)); }
    function obj(n, body) { offsets[n] = pos; pushS(n + ' 0 obj\n' + body + '\nendobj\n'); }
    push(enc('%PDF-1.4\n%'));
    push(new Uint8Array([0xE2, 0xE3, 0xCF, 0xD3, 10]));
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /XObject << /Im0 5 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 4 0 R >>');
    obj(4, '<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream');
    offsets[5] = pos;
    pushS('5 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n');
    push(jpeg);
    pushS('\nendstream\nendobj\n');
    obj(6, '<< /Title ' + pdfString(title) + ' /Producer (Zendocs) /Creator (Zendocs) >>');
    var xref = pos;
    var t = 'xref\n0 7\n0000000000 65535 f \n';
    for (var i = 1; i <= 6; i++) t += ('0000000000' + offsets[i]).slice(-10) + ' 00000 n \n';
    t += 'trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    pushS(t);
    var out = new Uint8Array(pos), p = 0;
    chunks.forEach(function (c) { out.set(c, p); p += c.length; });
    return out;
  }

  function b64ToBytes(b64) {
    if (typeof atob === 'function') { var bin = atob(b64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  function fromCanvas(canvas, opts) {
    opts = opts || {};
    var q = opts.quality > 0 ? opts.quality : 0.92;
    var url = canvas.toDataURL('image/jpeg', q);
    var m = /^data:image\/jpeg;base64,(.*)$/.exec(url);
    if (!m) throw new Error('JPEG export not supported');
    return fromJpegBytes(b64ToBytes(m[1]), canvas.width, canvas.height, opts);
  }

  function download(bytes, filename) {
    var blob = new Blob([bytes], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename || 'document.pdf'; a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  }

  var api = { fromJpegBytes: fromJpegBytes, fromCanvas: fromCanvas, download: download };
  root.ZD = root.ZD || {}; root.ZD.pdf = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
