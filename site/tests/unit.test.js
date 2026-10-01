'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../lib/validate.js');
const R = require('../lib/rules.js');

const NOW = new Date(2025, 5, 15); // 15 June 2025, fixed for determinism

// ---------- TFN ----------
test('tfn: ATO example 123 456 782 is valid, with or without spaces', () => {
  assert.equal(V.tfn('123456782').ok, true);
  assert.equal(V.tfn('123 456 782').ok, true);
  assert.equal(V.tfn(' 123-456-782 ').ok, true);
});
test('tfn: wrong check digit, empty, letters, length', () => {
  const bad = V.tfn('123456783');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /doesn't look right/);
  assert.equal(V.tfn('').ok, false);
  assert.equal(V.tfn('   ').ok, false);
  assert.match(V.tfn('12345678A').error, /numbers/);
  assert.match(V.tfn('1234567').error, /too short/);
  assert.match(V.tfn('1234567820').error, /too long/);
  assert.equal(V.tfn(undefined).ok, false);
});
test('tfn: 8-digit legacy numbers use legacy weights', () => {
  // find a valid 8-digit number by construction
  const w = [10, 7, 8, 4, 6, 3, 5, 2, 1];
  let found = null;
  for (let n = 10000000; n < 10000200 && !found; n++) {
    const s = String(n);
    let sum = 0;
    for (let i = 0; i < 8; i++) sum += Number(s[i]) * w[i];
    if (sum % 11 === 0) found = s;
  }
  assert.ok(found);
  assert.equal(V.tfn(found).ok, true);
  const last = (Number(found[7]) + 1) % 10;
  assert.equal(V.tfn(found.slice(0, 7) + last).ok, false);
});

// ---------- ABN ----------
test('abn: ATO ABN 51 824 753 556 valid; variants invalid', () => {
  assert.equal(V.abn('51824753556').ok, true);
  assert.equal(V.abn('51 824 753 556').ok, true);
  assert.equal(V.abn('51 824 753 557').ok, false);
  assert.equal(V.abn('61 824 753 556').ok, false);
  assert.match(V.abn('5182475355').error, /too short/);
  assert.match(V.abn('518247535560').error, /too long/);
  assert.match(V.abn('5182475355X').error, /numbers/);
  assert.equal(V.abn('').ok, false);
  assert.equal(V.abn('00000000000').ok, false);
});

// ---------- email ----------
test('email', () => {
  for (const e of ['a@b.com', 'first.last+tag@example.com.au', "o'brien@mail.co"]) assert.equal(V.email(e).ok, true, e);
  for (const e of ['', 'abc', 'a@b', 'a@@b.com', 'a b@c.com', '@b.com', 'a@.com', 'a..b@c.com', 'a@b.c', 'a@-b.com']) {
    assert.equal(V.email(e).ok, false, e);
  }
  assert.match(V.email('abc').error, /@/);
});

// ---------- postcode / state ----------
test('postcode', () => {
  for (const p of ['2000', '0800', '0200', '9999', ' 3000 ']) assert.equal(V.postcode(p).ok, true, p);
  for (const p of ['', '200', '0199', '12345', 'ABCD', '20 0']) assert.equal(V.postcode(p).ok, false, p);
});
test('state', () => {
  for (const s of V.STATES) assert.equal(V.state(s).ok, true);
  assert.equal(V.state('nsw').ok, true);
  assert.equal(V.state(' vic ').ok, true);
  for (const s of ['', 'NZ', 'NSWW', 'N']) assert.equal(V.state(s).ok, false, s);
});

// ---------- dates ----------
test('date: real calendar dates incl. leap years', () => {
  assert.equal(V.date('29022024').ok, true);
  assert.equal(V.date('29022023').ok, false);
  assert.match(V.date('29022023').error, /leap year/);
  assert.equal(V.date('29022000').ok, true);   // divisible by 400
  assert.equal(V.date('29021900').ok, false);  // divisible by 100 not 400
  assert.equal(V.date('31042024').ok, false);
  assert.equal(V.date('31012024').ok, true);
  assert.equal(V.date('00012024').ok, false);
  assert.equal(V.date('15132024').ok, false);
  assert.equal(V.date('15002024').ok, false);
  assert.equal(V.date('15 06 2024').ok, true);
  assert.equal(V.date('15/06/2024').ok, true);
  assert.equal(V.date('').ok, false);
  assert.equal(V.date('1506').ok, false);
  assert.equal(V.date('150620245').ok, false);
  assert.equal(V.date('ab062024').ok, false);
});
test('dateOfBirth: future, age limits, young warning', () => {
  assert.equal(V.dateOfBirth('01011990', NOW).ok, true);
  assert.equal(V.dateOfBirth('01011990', NOW).warn, undefined);
  const fut = V.dateOfBirth('16062025', NOW);
  assert.equal(fut.ok, false);
  assert.match(fut.error, /future/);
  assert.equal(V.dateOfBirth('01012030', NOW).ok, false);
  assert.equal(V.dateOfBirth('15062025', NOW).ok, true);      // born today
  assert.ok(V.dateOfBirth('15062025', NOW).warn);             // under 15 warning
  assert.ok(V.dateOfBirth('01012015', NOW).warn);
  assert.equal(V.dateOfBirth('15062010', NOW).warn, undefined); // exactly 15
  assert.equal(V.dateOfBirth('15061905', NOW).ok, true);      // exactly 120
  assert.equal(V.dateOfBirth('14061904', NOW).ok, false);     // 121
  assert.equal(V.dateOfBirth('29022023', NOW).ok, false);     // invalid calendar
  assert.equal(V.dateOfBirth('29022024', NOW).ok, true);
  assert.equal(V.dateOfBirth('', NOW).ok, false);
  assert.equal(V.dateOfBirth('01011990').ok, true);           // defaults to real today
});

// ---------- phone ----------
test('phone', () => {
  for (const p of ['0412 345 678', '(02) 9999 8888', '02 9999 8888', '+61 412 345 678', '61412345678'.replace(/^/, '+'),
    '99998888', '1300 123 456', '1800 123 456', '13 12 34', '0061 2 9999 8888']) {
    assert.equal(V.phone(p).ok, true, p);
  }
  for (const p of ['', '123', '0112345678', '04123456789', 'phone me', '0412-345-67x', '+44 20 7946 0958']) {
    assert.equal(V.phone(p).ok, false, p);
  }
});

// ---------- name ----------
test('name', () => {
  for (const n of ['SMITH', "O'BRIEN", 'Mary-Jane', 'Anne Marie', 'José', "D’Arcy"]) assert.equal(V.name(n).ok, true, n);
  for (const n of ['', '  ', 'J0HN', '-Smith', 'Smith!', 'a@b', 'X'.repeat(61)]) assert.equal(V.name(n).ok, false, n);
  assert.match(V.name('J0HN').error, /numbers/);
});

// ---------- run ----------
test('run dispatches by validator name', () => {
  assert.equal(V.run('tfn', '123456782').ok, true);
  assert.equal(V.run('abn', '51824753556').ok, true);
  assert.equal(V.run('none', 'anything').ok, true);
  assert.equal(V.run('bogus', 'x').ok, true);
  assert.equal(V.run('dateOfBirth', '01011990', { today: NOW }).ok, true);
  assert.equal(V.run('dateOfBirth', '16062025', { today: NOW }).ok, false);
  assert.equal(V.run('state', 'XX').ok, false);
});
test('every failure has a plain-English error string and no warn', () => {
  for (const [fn, bad] of [['tfn', '1'], ['abn', '1'], ['email', 'x'], ['postcode', '1'], ['state', 'x'], ['date', '1'], ['phone', '1'], ['name', '1']]) {
    const r = V[fn](bad);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 10);
  }
});

// ---------- rules ----------
const path = require('node:path');
const fieldsJson = require(path.join(__dirname, '..', 'src', 'fields.json'));
const fixture = fieldsJson; // fields.json is the source of truth

function goodA(over) {
  return Object.assign({
    tfn: '123 456 782', surname: 'CITIZEN', given_name: 'JANE', addr1: '1 SMITH ST',
    suburb: 'SYDNEY', state: 'NSW', postcode: '2000', dob: '01011990',
    basis: 'fulltime', residency: 'resident', tax_free: 'yes', help_debt: 'no',
    sig_a: 'data:image/png;base64,AAAA', date_a: '15062025'
  }, over || {});
}
function goodB(over) {
  return Object.assign({
    abn: '51 824 753 556', biz_name1: 'ACME PTY LTD', biz_addr1: '2 KING ST', biz_suburb: 'MELBOURNE',
    biz_state: 'VIC', biz_postcode: '3000', contact: 'BOB BOSS', biz_phone: '03 9999 8888',
    sig_b: 'data:image/png;base64,BBBB', date_b: '16062025'
  }, over || {});
}
const opts = { section: 'A', today: NOW };

test('rules: fully valid section A is complete', () => {
  const r = R.validateAll(goodA(), fixture, opts);
  assert.deepEqual(r.errors, {});
  assert.equal(r.complete, true);
});
test('rules: empty form flags every required section A field, and nothing in B', () => {
  const r = R.validateAll({}, fixture, opts);
  assert.equal(r.complete, false);
  for (const id of ['surname', 'given_name', 'addr1', 'suburb', 'state', 'postcode', 'dob',
    'basis', 'residency', 'tax_free', 'help_debt', 'sig_a', 'date_a']) {
    assert.ok(r.errors[id], 'expected error for ' + id);
  }
  assert.ok(r.warnings.tfn, 'empty TFN is a warning, not an error');
  for (const id of ['tfn', 'title', 'other_names', 'addr2', 'prev_name', 'email', 'abn', 'biz_name1']) {
    assert.equal(r.errors[id], undefined, id);
  }
});
test('rules: Q1 TFN or exactly one exemption (warnings only, never blocking)', () => {
  // exemption alone satisfies Q1
  for (const ex of R.EXEMPT_IDS) {
    const r = R.validateAll(goodA({ tfn: '', [ex]: 'yes' }), fixture, opts);
    assert.equal(r.warnings.tfn, undefined, ex);
    assert.equal(r.complete, true, ex);
  }
  // false checkbox doesn't count
  const none = R.validateAll(goodA({ tfn: '', tfn_applied: '' }), fixture, opts);
  assert.ok(none.warnings.tfn);
  assert.equal(none.complete, true);
  // two exemptions -> mutually exclusive
  const two = R.validateAll(goodA({ tfn: '', tfn_applied: 'yes', tfn_pension: 'yes' }), fixture, opts);
  assert.ok(two.warnings.tfn_applied && two.warnings.tfn_pension);
  assert.equal(two.complete, true);
  // TFN + exemption -> conflict
  const both = R.validateAll(goodA({ tfn_under18: 'yes' }), fixture, opts);
  assert.ok(both.warnings.tfn);
  assert.ok(both.warnings.tfn_under18);
  assert.equal(both.complete, true);
  // bad TFN
  const badTfn = R.validateAll(goodA({ tfn: '123456783' }), fixture, opts);
  assert.match(badTfn.warnings.tfn, /doesn't look right/);
  assert.equal(badTfn.errors.tfn, undefined);
  assert.equal(badTfn.complete, true);
});
test('rules: isRequired', () => {
  assert.equal(R.isRequired('tfn', {}), true);
  assert.equal(R.isRequired('tfn', { tfn_applied: 'yes' }), false);
  assert.equal(R.isRequired('tfn_pension', {}), false);
  assert.equal(R.isRequired('surname', {}), true);
  assert.equal(R.isRequired('title', {}), false);
  assert.equal(R.isRequired('email', {}), false);
  assert.equal(R.isRequired('addr2', {}), false);
  assert.equal(R.isRequired('dob', {}), true);
  assert.equal(R.isRequired('sig_a', {}), true);
  // Section B optional until started
  assert.equal(R.isRequired('biz_name1', {}), false);
  assert.equal(R.isRequired('biz_name1', { biz_suburb: 'X' }), true);
  assert.equal(R.isRequired('biz_name1', {}, { completeB: true }), true);
  assert.equal(R.isRequired('abn', {}, { completeB: true }), true);
  assert.equal(R.isRequired('abn', { abn_applied: 'yes' }, { completeB: true }), false);
  assert.equal(R.isRequired('branch', {}, { completeB: true }), false);
  assert.equal(R.isRequired('payee_ceased', {}, { completeB: true }), false);
});
test('rules: optional fields are validated only when filled', () => {
  assert.ok(R.validateAll(goodA({ email: 'nope' }), fixture, opts).errors.email);
  assert.equal(R.validateAll(goodA({ email: 'a@b.com' }), fixture, opts).errors.email, undefined);
  assert.ok(R.validateAll(goodA({ other_names: 'B0B' }), fixture, opts).errors.other_names);
  assert.ok(R.validateAll(goodA({ prev_name: '123' }), fixture, opts).errors.prev_name);
  assert.equal(R.validateAll(goodA({ title: '' }), fixture, opts).errors.title, undefined);
});
test('rules: address, dob, dates', () => {
  assert.ok(R.validateAll(goodA({ postcode: '12' }), fixture, opts).errors.postcode);
  assert.ok(R.validateAll(goodA({ state: 'XX' }), fixture, opts).errors.state);
  assert.ok(R.validateAll(goodA({ dob: '01012090' }), fixture, opts).errors.dob);   // future
  assert.ok(R.validateAll(goodA({ dob: '29022023' }), fixture, opts).errors.dob);   // not a real day
  assert.equal(R.validateAll(goodA({ dob: '29022024' }), fixture, opts).errors.dob, undefined);
  assert.ok(R.validateAll(goodA({ date_a: '31042025' }), fixture, opts).errors.date_a);
  assert.ok(R.validateAll(goodA({ sig_a: '' }), fixture, opts).errors.sig_a);
  const young = R.validateAll(goodA({ dob: '01012015' }), fixture, opts);
  assert.equal(young.complete, true);
  assert.ok(young.warnings.dob);
});
test('rules: choice answers must be real options and are required', () => {
  assert.ok(R.validateAll(goodA({ basis: undefined }), fixture, opts).errors.basis);
  assert.ok(R.validateAll(goodA({ help_debt: 'maybe' }), fixture, opts).errors.help_debt);
  assert.ok(R.validateAll(goodA({ tax_free: '' }), fixture, opts).errors.tax_free);
});
test('rules: foreign resident / WHM claiming threshold is a warning, not a block', () => {
  for (const res of ['foreign', 'whm']) {
    const r = R.validateAll(goodA({ residency: res, tax_free: 'yes' }), fixture, opts);
    assert.equal(r.complete, true);
    assert.ok(r.warnings.tax_free, res);
    const r2 = R.validateAll(goodA({ residency: res, tax_free: 'no' }), fixture, opts);
    assert.equal(r2.warnings.tax_free, undefined);
  }
  assert.equal(R.validateAll(goodA(), fixture, opts).warnings.tax_free, undefined);
});
test('rules: section A only ignores section B entirely', () => {
  const r = R.validateAll(goodA({ biz_name1: '', abn: 'garbage' }), fixture, { section: 'A', today: NOW });
  assert.equal(r.errors.abn, undefined);
  assert.equal(r.complete, true);
});
test('rules: section AB with B left blank is still complete (optional)', () => {
  const r = R.validateAll(goodA(), fixture, { section: 'AB', today: NOW });
  assert.equal(r.complete, true);
  assert.deepEqual(r.errors, {});
});
test('rules: section AB with B completed', () => {
  const ok = R.validateAll(goodA(goodB()), fixture, { section: 'AB', today: NOW });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.complete, true);
});
test('rules: section AB opted in (completeB) but empty flags B requireds', () => {
  const r = R.validateAll(goodA(), fixture, { section: 'AB', completeB: true, today: NOW });
  assert.equal(r.complete, false);
  for (const id of ['abn', 'biz_name1', 'biz_addr1', 'biz_suburb', 'biz_state', 'biz_postcode',
    'contact', 'biz_phone', 'sig_b', 'date_b']) assert.ok(r.errors[id], id);
  assert.equal(r.errors.branch, undefined);
  assert.equal(r.errors.biz_email, undefined);
});
test('rules: section AB partially filled B is validated', () => {
  const r = R.validateAll(goodA({ biz_name1: 'ACME' }), fixture, { section: 'AB', today: NOW });
  assert.equal(r.complete, false);
  assert.ok(r.errors.abn);
  assert.ok(r.errors.sig_b);
  // ABN applied tick replaces ABN
  const r2 = R.validateAll(goodA(goodB({ abn: '', abn_applied: 'yes' })), fixture, { section: 'AB', today: NOW });
  assert.deepEqual(r2.errors, {});
  // invalid ABN / phone / email
  const r3 = R.validateAll(goodA(goodB({ abn: '51 824 753 557', biz_phone: '123', biz_email: 'x' })), fixture, { section: 'AB', today: NOW });
  assert.ok(r3.errors.abn && r3.errors.biz_phone && r3.errors.biz_email);
});
test('rules: works without fieldsJson and ignores ids missing from fieldsJson', () => {
  assert.equal(R.validateAll(goodA(), null, opts).complete, true);
  const small = { fields: [{ id: 'surname', type: 'boxes' }] };
  const r = R.validateAll({}, small, opts);
  assert.deepEqual(Object.keys(r.errors), ['surname']);
});
test('rules: fieldsJson validator overrides defaults', () => {
  const fj = { fields: [{ id: 'surname', type: 'boxes', validator: 'none' }] };
  assert.equal(R.validateAll({ surname: '123' }, fj, opts).errors.surname, undefined);
});
test('rules: loads via UMD global registration', () => {
  assert.ok(globalThis.ZD.validate.tfn);
  assert.ok(globalThis.ZD.rules.validateAll);
});

// ---------- fields.json consistency ----------
test('fields.json: every id the rules reference exists (nothing silently skipped)', () => {
  const ids = new Set(fieldsJson.fields.map((f) => f.id));
  const referenced = R.A_FIELDS.concat(R.B_FIELDS, ['biz_name2', 'biz_name3']);
  const absent = referenced.filter((id) => !ids.has(id));
  assert.deepEqual(absent, []);
  assert.deepEqual(R.validateAll({}, fieldsJson, { section: 'AB', today: NOW }).missing, []);
  // and the reverse: every real field is known to the rules
  const known = new Set(referenced);
  assert.deepEqual(fieldsJson.fields.map((f) => f.id).filter((id) => !known.has(id)), []);
});
test('fields.json: every validator name is supported by validate.js', () => {
  for (const f of fieldsJson.fields) {
    if (!f.validator) continue;
    assert.ok(f.validator === 'none' || typeof V[f.validator] === 'function', f.id + ' uses ' + f.validator);
  }
});
test('fields.json: option values and widths match the rules', () => {
  const by = Object.fromEntries(fieldsJson.fields.map((f) => [f.id, f]));
  const vals = (id) => by[id].options.map((o) => o.value);
  assert.deepEqual(vals('residency'), ['resident', 'foreign', 'whm']);
  assert.deepEqual(vals('tax_free'), ['yes', 'no']);
  assert.deepEqual(vals('abn_applied'), ['yes', 'no']);
  for (const id of ['tfn_applied', 'tfn_under18', 'tfn_pension', 'payee_ceased']) assert.deepEqual(vals(id), ['yes']);
  assert.equal(by.biz_phone.boxes.length, 10);
  assert.equal(by.dob.boxes.length, 8);
});
test('rules: a field missing from fieldsJson is reported in result.missing', () => {
  const r = R.validateAll({}, { fields: [{ id: 'surname', type: 'boxes' }] }, opts);
  assert.ok(r.missing.includes('tfn'));
});
test('rules: goodA values pass with real whm/foreign warnings', () => {
  for (const res of ['foreign', 'whm']) {
    assert.ok(R.validateAll(goodA({ residency: res, tax_free: 'yes' }), fixture, opts).warnings.tax_free);
  }
});

// ---------- QA regressions: text that does not fit the printed boxes is an error, never truncated ----------
test('rules: over-long address/email/name is a clear error (no silent truncation)', () => {
  const FJ = require('../src/fields.json');
  const base = {
    tfn: '123456782', surname: 'SMITH', given_name: 'ANNA', addr1: '1 A ST', suburb: 'SYDNEY', state: 'NSW',
    postcode: '2000', dob: '15051990', basis: 'fulltime', residency: 'resident', tax_free: 'no', help_debt: 'no',
    sig_a: 'Anna Smith', date_a: '30092026'
  };
  assert.equal(R.validateAll(base, FJ, { section: 'A', today: NOW }).complete, true);
  const long = R.validateAll(Object.assign({}, base, { addr1: '12 LONG STREET NAME ROAD' }), FJ, { section: 'A', today: NOW });
  assert.match(long.errors.addr1, /24 characters but the form only has 19 boxes \(5 too many\)/);
  assert.match(long.errors.addr1, /second address line/);
  const em = R.validateAll(Object.assign({}, base, { email: 'a'.repeat(40) + '@x.com' }), FJ, { section: 'A', today: NOW });
  assert.match(em.errors.email, /only has 38 boxes/);
  assert.match(em.errors.email, /optional/);
  const ok19 = R.validateAll(Object.assign({}, base, { addr1: '1234567890123456789' }), FJ, { section: 'A', today: NOW });
  assert.equal(ok19.errors.addr1, undefined);
  // digit fields: formatting spaces do not count against the boxes
  assert.equal(R.validateAll(Object.assign({}, base, { tfn: '123 456 782' }), FJ, { section: 'A', today: NOW }).errors.tfn, undefined);
  assert.equal(typeof R.tooLongMsg, 'function');
});
