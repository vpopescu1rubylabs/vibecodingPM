/* Zendocs – field validators. Runs in Node and browser. No dependencies. */
(function (root) {
  'use strict';

  function ok() { return { ok: true }; }
  function bad(msg) { return { ok: false, error: msg }; }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function isBlank(v) { return str(v).trim() === ''; }
  // Remove spaces, dashes and dots people type between digit groups.
  function compact(v) { return str(v).replace(/[\s\-. ]/g, ''); }
  function weightedSum(digits, weights) {
    var s = 0;
    for (var i = 0; i < weights.length; i++) s += Number(digits.charAt(i)) * weights[i];
    return s;
  }

  var TFN9 = [1, 4, 3, 7, 5, 8, 6, 9, 10];
  var TFN8 = [10, 7, 8, 4, 6, 3, 5, 2, 1];
  var ABN_W = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

  function tfn(value) {
    if (isBlank(value)) return bad('Please enter your tax file number.');
    var d = compact(value);
    if (/[^0-9]/.test(d)) return bad('A TFN only contains numbers – remove any letters or symbols.');
    if (d.length === 8) {
      return weightedSum(d, TFN8.slice(0, 8)) % 11 === 0 ? ok() : bad("That TFN doesn't look right – check each digit.");
    }
    if (d.length < 8) return bad('That TFN is too short. A TFN has 9 digits (some older ones have 8).');
    if (d.length > 9) return bad('That TFN is too long. A TFN has 9 digits.');
    return weightedSum(d, TFN9) % 11 === 0 ? ok() : bad("That TFN doesn't look right – check each digit.");
  }

  function abn(value) {
    if (isBlank(value)) return bad('Please enter the ABN.');
    var d = compact(value);
    if (/[^0-9]/.test(d)) return bad('An ABN only contains numbers – remove any letters or symbols.');
    if (d.length < 11) return bad('That ABN is too short. An ABN has 11 digits.');
    if (d.length > 11) return bad('That ABN is too long. An ABN has 11 digits.');
    var adj = String(Number(d.charAt(0)) - 1) + d.slice(1);
    if (d.charAt(0) === '0') return bad("That ABN doesn't look right – check each digit.");
    return weightedSum(adj, ABN_W) % 89 === 0 ? ok() : bad("That ABN doesn't look right – check each digit.");
  }

  function email(value) {
    if (isBlank(value)) return bad('Please enter an email address.');
    var v = str(value).trim();
    if (/\s/.test(v)) return bad("Email addresses can't contain spaces.");
    if (v.length > 254) return bad('That email address is too long.');
    if (v.indexOf('@') < 0) return bad("That email address is missing the '@' symbol.");
    var m = /^([^@]+)@([^@]+)$/.exec(v);
    if (!m) return bad("That email address doesn't look right – it should have one '@'.");
    var local = m[1], domain = m[2];
    if (local.length > 64 || /^\.|\.$|\.\./.test(local) || !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~\-]+$/.test(local)) {
      return bad("The part before the '@' doesn't look right.");
    }
    if (domain.indexOf('.') < 0) return bad("The part after the '@' needs a dot, like name@example.com.");
    if (!/^[A-Za-z0-9]([A-Za-z0-9\-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9\-]*[A-Za-z0-9])?)+$/.test(domain)) {
      return bad("The part after the '@' doesn't look right.");
    }
    if (!/[A-Za-z]{2,}$/.test(domain)) return bad("The ending of that email address (like .com or .com.au) doesn't look right.");
    return ok();
  }

  function postcode(value) {
    if (isBlank(value)) return bad('Please enter your postcode.');
    var d = str(value).replace(/\s/g, '');
    if (!/^[0-9]+$/.test(d)) return bad('A postcode only contains numbers.');
    if (d.length !== 4) return bad('An Australian postcode has 4 digits.');
    var n = Number(d);
    if (n < 200 || n > 9999) return bad("That postcode doesn't look like an Australian one.");
    return ok();
  }

  var STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];
  function state(value) {
    if (isBlank(value)) return bad('Please enter your state or territory.');
    var v = str(value).replace(/\s/g, '').toUpperCase();
    return STATES.indexOf(v) >= 0 ? ok() : bad('Use one of NSW, VIC, QLD, SA, WA, TAS, NT or ACT.');
  }

  function parseDate(value) {
    var d = str(value).replace(/[\s\/\-.]/g, '');
    if (!/^[0-9]{8}$/.test(d)) return null;
    return { d: Number(d.slice(0, 2)), m: Number(d.slice(2, 4)), y: Number(d.slice(4)) };
  }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysIn(m, y) { return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }

  function date(value) {
    if (isBlank(value)) return bad('Please enter a date.');
    var d = str(value).replace(/[\s\/\-.]/g, '');
    if (/[^0-9]/.test(d)) return bad('Dates only contain numbers, as DD MM YYYY.');
    if (d.length < 8) return bad('Please enter the full date as DD MM YYYY (8 digits).');
    if (d.length > 8) return bad('That date has too many digits – use DD MM YYYY.');
    var p = parseDate(d);
    if (p.m < 1 || p.m > 12) return bad("That month isn't right – it should be between 01 and 12.");
    if (p.y < 1000) return bad("That year doesn't look right.");
    if (p.d < 1 || p.d > daysIn(p.m, p.y)) {
      if (p.m === 2 && p.d === 29) return bad(p.y + " wasn't a leap year, so there's no 29 February.");
      return bad("That day doesn't exist in that month.");
    }
    return ok();
  }

  function todayParts(today) {
    var t = today instanceof Date ? today : new Date();
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
  }
  function cmp(a, b) { // compare {y,m,d}
    return a.y !== b.y ? a.y - b.y : a.m !== b.m ? a.m - b.m : a.d - b.d;
  }

  function dateOfBirth(value, today) {
    var r = date(value);
    if (!r.ok) return r;
    var p = parseDate(value), t = todayParts(today);
    if (cmp(p, t) > 0) return bad("Your date of birth can't be in the future.");
    var age = t.y - p.y - ((t.m < p.m || (t.m === p.m && t.d < p.d)) ? 1 : 0);
    if (age > 120) return bad("That date of birth would make you over 120 – check the year.");
    if (age < 15) return { ok: true, warn: 'That makes you under 15. Double-check the year is right.' };
    return ok();
  }

  function phone(value) {
    if (isBlank(value)) return bad('Please enter a phone number.');
    var v = str(value).trim();
    if (/[^0-9\s()+\-.]/.test(v)) return bad('A phone number only contains numbers, spaces and brackets.');
    var d = v.replace(/[\s()\-.]/g, '');
    if (/^\+61/.test(d)) d = '0' + d.slice(3);
    else if (/^0061/.test(d)) d = '0' + d.slice(4);
    if (/\+/.test(d)) return bad("That phone number doesn't look right.");
    if (d.length === 8 && /^[2-9]/.test(d)) return ok(); // local number without area code
    if (d.length === 6 && /^13/.test(d)) return ok();    // 13 xx xx
    if (d.length === 10) {
      if (/^0[2-478]/.test(d) || /^1[38]00/.test(d)) return ok();
      return bad("That doesn't look like an Australian phone number – it should start with 02, 03, 04, 07 or 08.");
    }
    if (d.length < 8) return bad('That phone number is too short.');
    return bad('An Australian phone number has 10 digits including the area code (or 8 without it).');
  }

  function name(value) {
    if (isBlank(value)) return bad('Please enter a name.');
    var v = str(value).trim();
    if (v.length > 60) return bad('That name is too long.');
    if (!/^[\p{L}][\p{L} '’\-]*$/u.test(v)) {
      if (/[0-9]/.test(v)) return bad("Names can't contain numbers.");
      return bad('Names can only contain letters, spaces, hyphens (-) and apostrophes (\').');
    }
    return ok();
  }

  function none() { return ok(); }

  var table = { tfn: tfn, abn: abn, email: email, postcode: postcode, state: state,
    date: date, dateOfBirth: dateOfBirth, phone: phone, name: name, none: none };

  function run(validatorName, value, opts) {
    var fn = table[validatorName || 'none'];
    if (typeof fn !== 'function' || validatorName === 'run') return ok();
    return fn(value, opts && opts.today);
  }

  var api = { tfn: tfn, abn: abn, email: email, postcode: postcode, state: state,
    date: date, dateOfBirth: dateOfBirth, phone: phone, name: name, run: run,
    STATES: STATES, isLeapYear: isLeap };

  root.ZD = root.ZD || {};
  root.ZD.validate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
