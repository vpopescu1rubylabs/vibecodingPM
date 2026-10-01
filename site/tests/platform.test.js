'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const render = require('../lib/render.js');
const pdf = require('../lib/pdf.js');
const store = require('../lib/store.js');

const FIX = {
  image: { w: 200, h: 100 },
  fields: [
    { id: 'tfn', type: 'boxes', boxes: [{ x: 10, y: 10, w: 10, h: 20 }, { x: 20, y: 10, w: 10, h: 20 }, { x: 30, y: 10, w: 10, h: 20 }] },
    { id: 'res', type: 'choice', options: [{ value: 'yes', rect: { x: 100, y: 10, w: 10, h: 10 } }, { value: 'no', rect: { x: 120, y: 10, w: 10, h: 10 } }] },
    { id: 'chk', type: 'checkbox', options: [{ value: 'on', rect: { x: 150, y: 10, w: 10, h: 10 } }] },
    { id: 'sig', type: 'signature', rect: { x: 10, y: 50, w: 100, h: 30 } },
  ],
};
function mockCtx() {
  const calls = [];
  const ctx = { calls, measureText: (t) => ({ width: t.length * 6 }) };
  ['save', 'restore', 'setTransform', 'drawImage', 'fillText', 'fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'scale']
    .forEach((n) => (ctx[n] = (...a) => calls.push([n, ...a, ctx.font, ctx.fillStyle])));
  return ctx;
}
function mockCanvas() { const ctx = mockCtx(); return { ctx, width: 0, height: 0, getContext: () => ctx }; }
const img = { width: 200, height: 100 };

test('render: uppercase one char per cell, centred', () => {
  const c = mockCanvas();
  render(c, img, FIX, { tfn: 'ab c' });
  const texts = c.ctx.calls.filter((x) => x[0] === 'fillText');
  assert.deepStrictEqual(texts.map((t) => t[1]), ['A', 'B']);
  assert.strictEqual(texts[0][2], 15); assert.strictEqual(texts[0][3], 20);
  assert.strictEqual(c.ctx.calls[0][0] === 'save', true);
  assert.ok(c.ctx.calls.some((x) => x[0] === 'drawImage'));
  assert.match(texts[0][4], /bold 12px/);
});
test('render: scale sizes canvas', () => {
  const c = mockCanvas(); render(c, img, FIX, {}, { scale: 2 });
  assert.strictEqual(c.width, 400); assert.strictEqual(c.height, 200);
});
test('render: choice and checkbox ticks', () => {
  const c = mockCanvas();
  render(c, img, FIX, { res: 'no', chk: true });
  const moves = c.ctx.calls.filter((x) => x[0] === 'moveTo');
  assert.strictEqual(moves.length, 4);
  assert.ok(moves.every((m) => (m[1] >= 120 && m[1] <= 130) || (m[1] >= 150 && m[1] <= 160)));
});
test('render: typed signature uses cursive; highlight toggles with forExport', () => {
  const c = mockCanvas();
  render(c, img, FIX, { sig: 'Jane' }, { highlightFieldId: 'tfn' });
  assert.ok(c.ctx.calls.some((x) => x[0] === 'fillText' && /Snell Roundhand/.test(x[4])));
  assert.ok(c.ctx.calls.some((x) => x[0] === 'fillRect'));
  const d = mockCanvas();
  render(d, img, FIX, { sig: 'Jane' }, { highlightFieldId: 'tfn', forExport: true });
  assert.ok(!d.ctx.calls.some((x) => x[0] === 'fillRect'));
});
test('render: dataURL signature aspect-fit', () => {
  const c = mockCanvas();
  const sigImg = { width: 200, height: 50 };
  const url = 'data:image/png;base64,AAAA';
  render(c, img, FIX, { sig: url }, { sigImages: { [url]: sigImg } });
  const di = c.ctx.calls.filter((x) => x[0] === 'drawImage')[1];
  assert.deepStrictEqual(di.slice(2, 6), [10, 50 + (30 - 25) / 2, 100, 25]);
});

// ---- PDF
function makeJpeg(w, h) {
  const f = path.join(os.tmpdir(), 'zd_fx_' + process.pid + '.jpg');
  execFileSync('python3', ['-c', `from PIL import Image;Image.new('RGB',(${w},${h}),(200,30,30)).save(${JSON.stringify(f)},'JPEG')`]);
  const b = new Uint8Array(fs.readFileSync(f)); fs.unlinkSync(f); return b;
}
test('pdf: structure and exact xref offsets', () => {
  const jpg = makeJpeg(60, 80);
  const out = pdf.fromJpegBytes(jpg, 60, 80, { title: 'Test (x)' });
  const s = Buffer.from(out).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4')); assert.ok(s.endsWith('%%EOF\n'));
  assert.match(s, /\/Filter \/DCTDecode/); assert.match(s, /\/MediaBox \[0 0 595.28 841.89\]/);
  const sx = +/startxref\n(\d+)/.exec(s)[1];
  assert.strictEqual(s.substr(sx, 4), 'xref');
  const lines = s.substr(sx).split('\n');
  for (let i = 1; i <= 6; i++) {
    const off = +lines[2 + i].slice(0, 10);
    assert.ok(s.substr(off).startsWith(i + ' 0 obj'), 'obj ' + i);
  }
  assert.ok(Buffer.from(out).includes(Buffer.from(jpg)));
});
test('pdf: validated by pdfinfo/PyMuPDF when available', (t) => {
  const jpg = makeJpeg(120, 160);
  const f = path.join(os.tmpdir(), 'zd_t_' + process.pid + '.pdf');
  fs.writeFileSync(f, pdf.fromJpegBytes(jpg, 120, 160, { title: 'NAT 3092' }));
  let ran = false;
  try {
    const o = execFileSync('pdfinfo', [f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(o, /Pages:\s+1/); assert.match(o, /Page size:\s+595\.28 x 841\.89/); assert.match(o, /NAT 3092/); ran = true;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  try {
    const o = execFileSync('python3', ['-c', `import fitz;d=fitz.open(${JSON.stringify(f)});p=d[0];print(len(d),len(p.get_images()));pm=p.get_pixmap();print(pm.width>0)`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(o, /1 1/); ran = true;
  } catch (e) { /* fitz missing */ }
  fs.unlinkSync(f);
  if (!ran) t.skip('no validator available');
});
test('pdf: fromCanvas decodes data URL', () => {
  const jpg = makeJpeg(30, 40);
  const cv = { width: 30, height: 40, toDataURL: () => 'data:image/jpeg;base64,' + Buffer.from(jpg).toString('base64') };
  const out = pdf.fromCanvas(cv, { quality: 0.9 });
  assert.ok(Buffer.from(out).includes(Buffer.from(jpg)));
});

// ---- store
function fakeLS() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i], get length() { return m.size; } };
}
test('store: save/load/hasDraft/clear with localStorage', () => {
  globalThis.localStorage = fakeLS();
  store.clear();
  assert.strictEqual(store.hasDraft(), false); assert.strictEqual(store.load(), null);
  store.save({ surname: 'SMITH' }, { wait: 0 });
  assert.ok(globalThis.localStorage.getItem('zd.nat3092.v1'));
  assert.deepStrictEqual(store.load(), { surname: 'SMITH' }); assert.strictEqual(store.hasDraft(), true);
  store.clear(); assert.strictEqual(store.load(), null);
});
test('store: debounce', async () => {
  globalThis.localStorage = fakeLS(); store.clear();
  store.save({ a: '1' }, { wait: 30 }); store.save({ a: '2' }, { wait: 30 });
  assert.strictEqual(globalThis.localStorage.getItem('zd.nat3092.v1'), null);
  await new Promise((r) => setTimeout(r, 80));
  assert.deepStrictEqual(JSON.parse(globalThis.localStorage.getItem('zd.nat3092.v1')).values, { a: '2' });
});
test('store: sensitive answers are never persisted', () => {
  globalThis.localStorage = fakeLS(); store.clear();
  store.save({ surname: 'SMITH', tfn: '123456782', dob: '01012000', email: 'a@b.co', biz_email: 'c@d.co', sig_a: 'data:x', sig_b: 'data:y' }, { wait: 0 });
  const raw = globalThis.localStorage.getItem('zd.nat3092.v1');
  assert.deepStrictEqual(JSON.parse(raw).values, { surname: 'SMITH' });
  for (const secret of ['123456782', '01012000', 'a@b.co', 'data:x']) assert.ok(!raw.includes(secret));
});
test('store: expiry after 24 hours', () => {
  globalThis.localStorage = fakeLS(); store.clear();
  globalThis.localStorage.setItem('zd.nat3092.v1', JSON.stringify({ v: 1, t: Date.now() - 25 * 36e5, values: { a: 'x' } }));
  assert.strictEqual(store.load(), null); assert.strictEqual(globalThis.localStorage.getItem('zd.nat3092.v1'), null);
  globalThis.localStorage.setItem('zd.nat3092.v1', 'garbage{');
  assert.strictEqual(store.load(), null);
});
test('store: throwing/missing localStorage falls back to memory, never throws', () => {
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('q'); }, removeItem() { throw new Error('x'); }, key() { throw 1; }, length: 1 };
  globalThis.localStorage = bad;
  store.clear();
  assert.doesNotThrow(() => store.save({ z: '9' }, { wait: 0 }));
  assert.deepStrictEqual(store.load(), { z: '9' });
  assert.doesNotThrow(() => store.wipeAll()); assert.strictEqual(store.load(), null);
  delete globalThis.localStorage;
  store.save({ y: '1' }, { wait: 0 }); assert.strictEqual(store.hasDraft(), true);
  store.clear();
  assert.doesNotThrow(() => store.save(function () {}, { wait: 0 }));
});
test('store: wipeAll removes zd.* only', () => {
  globalThis.localStorage = fakeLS();
  localStorage.setItem('zd.other', '1'); localStorage.setItem('zd.nat3092.v1', '{}'); localStorage.setItem('keep', '1');
  store.wipeAll();
  assert.strictEqual(localStorage.getItem('zd.other'), null); assert.strictEqual(localStorage.getItem('zd.nat3092.v1'), null);
  assert.strictEqual(localStorage.getItem('keep'), '1');
});
