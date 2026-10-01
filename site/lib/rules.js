/* Zendocs – conditional required logic for NAT 3092. Runs in Node and browser. */
(function (root) {
  'use strict';

  var V = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./validate.js')
    : (root.ZD && root.ZD.validate);

  var EXEMPT = ['tfn_applied', 'tfn_under18', 'tfn_pension'];
  var CHECKBOXES = EXEMPT.concat(['payee_ceased']);
  function isOn(v) { return v === true || v === 'yes'; }
  // Validators forced regardless of fields.json (dob needs the age rules; business names are free text).
  var FORCE_VALIDATOR = { dob: 'dateOfBirth', biz_name1: 'none', biz_name2: 'none', biz_name3: 'none', other_names: 'name', prev_name: 'name' };
  var CHOICES = ['basis', 'residency', 'tax_free', 'help_debt'];

  // Built-in defaults, used when fieldsJson lacks a field or a validator.
  var DEFAULT_VALIDATOR = {
    tfn: 'tfn', title: 'name', surname: 'name', given_name: 'name', other_names: 'name',
    addr1: 'none', addr2: 'none', suburb: 'name', state: 'state', postcode: 'postcode',
    prev_name: 'name', email: 'email', dob: 'dateOfBirth', date_a: 'date',
    abn: 'abn', branch: 'none', biz_name1: 'none', biz_name2: 'none', biz_name3: 'none', biz_addr1: 'none', biz_addr2: 'none',
    biz_suburb: 'name', biz_state: 'state', biz_postcode: 'postcode', biz_email: 'email',
    contact: 'name', biz_phone: 'phone', date_b: 'date'
  };
  var LABELS = {
    tfn: 'your tax file number', surname: 'your surname', given_name: 'your first name',
    addr1: 'your address', suburb: 'your suburb, town or locality', state: 'your state or territory',
    postcode: 'your postcode', dob: 'your date of birth', basis: 'how you are paid',
    residency: 'your residency status', tax_free: 'whether to claim the tax-free threshold',
    help_debt: 'whether you have a study or training loan', sig_a: 'your signature',
    date_a: "today's date", abn: "the payer's ABN", biz_name1: "the payer's business name",
    biz_addr1: "the payer's address", biz_suburb: "the payer's suburb", biz_state: "the payer's state",
    biz_postcode: "the payer's postcode", contact: 'a contact name', biz_phone: 'a contact phone number',
    sig_b: "the payer's signature", date_b: "the payer's date"
  };

  var A_REQUIRED = ['surname', 'given_name', 'addr1', 'suburb', 'state', 'postcode', 'dob']
    .concat(CHOICES, ['sig_a', 'date_a']);
  var B_REQUIRED = ['biz_name1', 'biz_addr1', 'biz_suburb', 'biz_state', 'biz_postcode',
    'contact', 'biz_phone', 'sig_b', 'date_b'];
  var B_ALL = ['abn', 'branch', 'abn_applied', 'biz_name1', 'biz_name2', 'biz_name3', 'biz_addr1', 'biz_addr2', 'biz_suburb',
    'biz_state', 'biz_postcode', 'biz_email', 'contact', 'biz_phone', 'payee_ceased',
    'sig_b', 'date_b'];
  var A_ALL = ['tfn'].concat(EXEMPT, ['title', 'surname', 'given_name', 'other_names', 'addr1',
    'addr2', 'suburb', 'state', 'postcode', 'prev_name', 'email', 'dob'], CHOICES,
    ['sig_a', 'date_a']);

  function has(v) {
    if (v === undefined || v === null || v === false) return false;
    if (typeof v === 'string') return v.trim() !== '';
    return true;
  }
  function get(values, id) { return values ? values[id] : undefined; }
  function exemptCount(values) {
    var n = 0;
    for (var i = 0; i < EXEMPT.length; i++) if (isOn(get(values, EXEMPT[i]))) n++;
    return n;
  }
  function sectionBStarted(values, opts) {
    if (opts && opts.completeB) return true;
    for (var i = 0; i < B_ALL.length; i++) if (has(get(values, B_ALL[i]))) return true;
    return false;
  }

  function isRequired(fieldId, values, opts) {
    if (fieldId === 'tfn') return exemptCount(values) === 0;
    if (EXEMPT.indexOf(fieldId) >= 0) return false;
    if (A_REQUIRED.indexOf(fieldId) >= 0) return true;
    if (fieldId === 'abn') return sectionBStarted(values, opts) && get(values, 'abn_applied') !== 'yes';
    if (B_REQUIRED.indexOf(fieldId) >= 0) return sectionBStarted(values, opts);
    return false;
  }

  function emptyMsg(id, type) {
    var what = LABELS[id] || 'this';
    if (type === 'choice' || CHOICES.indexOf(id) >= 0) return 'Please choose an answer for ' + what + '.';
    if (/^sig_/.test(id)) return 'Please sign to confirm ' + (id === 'sig_b' ? 'the payer declaration' : 'your declaration') + '.';
    return 'Please enter ' + what + '.';
  }

  // Clear message when text will not fit the printed boxes (we never truncate silently).
  function tooLongMsg(f, len) {
    var n = f && f.boxes ? f.boxes.length : 0, over = len - n;
    var head = 'That is ' + len + ' characters but the form only has ' + n + ' boxes (' + over + ' too many). ';
    if (f && f.charset === 'email') return head + 'Use a shorter email address, or leave this blank – it is optional.';
    if (f && /addr/.test(f.id)) return head + 'Shorten it (for example St, Rd, Pde) or continue the address on the second address line.';
    return head + 'Please shorten it (for example use an abbreviation).';
  }

  function validateAll(values, fieldsJson, opts) {
    values = values || {};
    opts = opts || {};
    var section = opts.section === 'AB' ? 'AB' : 'A';
    var today = opts.today;
    var errors = {}, warnings = {};
    var byId = {};
    if (fieldsJson && fieldsJson.fields) {
      for (var i = 0; i < fieldsJson.fields.length; i++) byId[fieldsJson.fields[i].id] = fieldsJson.fields[i];
    }
    function known(id) { return !fieldsJson || !fieldsJson.fields || !!byId[id]; }
    function validatorFor(id) {
      var f = byId[id];
      if (FORCE_VALIDATOR[id]) return FORCE_VALIDATOR[id];
      return (f && f.validator) || DEFAULT_VALIDATOR[id] || 'none';
    }
    function typeOf(id) {
      var f = byId[id];
      if (f && f.type) return f.type;
      if (CHECKBOXES.indexOf(id) >= 0) return 'checkbox';
      if (CHOICES.indexOf(id) >= 0 || id === 'abn_applied' || id === 'title') return 'choice';
      if (/^sig_/.test(id)) return 'signature';
      return 'boxes';
    }
    function checkValue(id) {
      var v = get(values, id), t = typeOf(id);
      if (t === 'checkbox' || t === 'signature') return;
      if (t === 'choice') {
        var f = byId[id];
        if (f && f.options && f.options.length) {
          var okOpt = f.options.some(function (o) { return o.value === v; });
          if (!okOpt) errors[id] = 'That answer is not one of the choices – please pick again.';
        }
        return;
      }
      var f0 = byId[id];
      if (f0 && f0.boxes && typeof v === 'string') {
        var len = f0.charset === 'digits' ? v.replace(/[\s\-.]/g, '').length : v.length;
        if (len > f0.boxes.length) { errors[id] = tooLongMsg(f0, len); return; }
      }
      var vn = validatorFor(id);
      // Dates of birth and dates are validated through the same registry.
      var r = V.run(vn, v, { today: today });
      if (!r.ok) errors[id] = r.error;
      else if (r.warn) warnings[id] = r.warn;
    }
    function requireAndCheck(id) {
      if (!known(id)) return;
      if (!has(get(values, id))) {
        if (isRequired(id, values, opts)) errors[id] = emptyMsg(id, typeOf(id));
        return;
      }
      checkValue(id);
    }

    // Section A
    var nEx = exemptCount(values);
    if (nEx > 1) {
      EXEMPT.forEach(function (id) {
        if (isOn(get(values, id)) && known(id)) errors[id] = 'Choose only one reason for not giving a TFN.';
      });
    }
    if (has(get(values, 'tfn')) && nEx >= 1 && known('tfn')) {
      errors.tfn = 'Either give your TFN or tick one of the reasons for not giving it – not both.';
      EXEMPT.forEach(function (id) {
        if (isOn(get(values, id)) && known(id) && !errors[id]) errors[id] = 'You entered a TFN, so untick this reason (or clear the TFN).';
      });
    } else if (!has(get(values, 'tfn')) && nEx === 0) {
      if (known('tfn')) errors.tfn = 'Enter your TFN, or tick one of the reasons for not giving it.';
    } else if (has(get(values, 'tfn'))) {
      checkValue('tfn');
    }
    ['title', 'surname', 'given_name', 'other_names', 'addr1', 'addr2', 'suburb', 'state',
      'postcode', 'prev_name', 'email', 'dob'].concat(CHOICES, ['sig_a', 'date_a'])
      .forEach(requireAndCheck);

    // Guidance warnings (never block)
    var res = get(values, 'residency'), tft = get(values, 'tax_free');
    if (has(res) && res === 'foreign' || res === 'whm') {
      if (tft === 'yes' && !errors.tax_free) {
        warnings.tax_free = 'Foreign residents and working holiday makers usually cannot claim the tax-free threshold. Most people in your situation answer No – check with the ATO if unsure.';
      }
    }
    if (has(get(values, 'date_a')) && !errors.date_a) {
      var pd = String(values.date_a).replace(/\D/g, '');
      var t = today instanceof Date ? today : new Date();
      var tn = t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate();
      if (pd.length === 8 && Number(pd.slice(4) + pd.slice(2, 4) + pd.slice(0, 2)) > tn) {
        warnings.date_a = "That date is in the future. Usually you'd use today's date.";
      }
    }

    // Section B
    if (section === 'AB') {
      var started = sectionBStarted(values, opts);
      if (started) {
        if (!has(get(values, 'abn')) && get(values, 'abn_applied') !== 'yes') {
          if (known('abn')) errors.abn = "Enter the payer's ABN, or tick that they have applied for one.";
        } else if (has(get(values, 'abn')) && known('abn')) {
          checkValue('abn');
        }
        ['branch', 'abn_applied', 'payee_ceased', 'biz_name1', 'biz_name2', 'biz_name3', 'biz_addr1', 'biz_addr2', 'biz_suburb', 'biz_state', 'biz_postcode',
          'biz_email', 'contact', 'biz_phone', 'sig_b', 'date_b'].forEach(requireAndCheck);
      }
    }

    // Ids the rules know about that fieldsJson lacks (these are silently skipped above).
    var missing = [];
    if (fieldsJson && fieldsJson.fields) {
      (section === 'AB' ? A_ALL.concat(B_ALL, ['biz_name2', 'biz_name3']) : A_ALL).forEach(function (id) {
        if (!byId[id]) missing.push(id);
      });
    }
    return { errors: errors, warnings: warnings, complete: Object.keys(errors).length === 0, missing: missing };
  }

  var api = {
    isRequired: isRequired, tooLongMsg: tooLongMsg, validateAll: validateAll, sectionBStarted: sectionBStarted,
    EXEMPT_IDS: EXEMPT, A_FIELDS: A_ALL, B_FIELDS: B_ALL
  };
  root.ZD = root.ZD || {};
  root.ZD.rules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
