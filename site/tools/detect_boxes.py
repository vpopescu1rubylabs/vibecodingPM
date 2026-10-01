#!/usr/bin/env python3
"""Detect blue cell fills in nat3092.png via colour mask + connected components.
Prints components; used to build src/fields.json (see build_fields.py logic in fields.json)."""
import sys, json
import numpy as np
from PIL import Image
from collections import deque

def load(path):
    return np.array(Image.open(path).convert('RGB')).astype(int)

def blue_mask(im):
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    return (b - r > 25) & (b > 200) & (r > 120) & (r < 235)

def components(mask, min_area=60):
    h, w = mask.shape
    seen = np.zeros_like(mask, bool)
    out = []
    for y in range(h):
        for x in range(w):
            if mask[y, x] and not seen[y, x]:
                q = deque([(y, x)]); seen[y, x] = True
                x0 = x1 = x; y0 = y1 = y; n = 0
                while q:
                    cy, cx = q.popleft(); n += 1
                    x0 = min(x0, cx); x1 = max(x1, cx); y0 = min(y0, cy); y1 = max(y1, cy)
                    for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                        ny, nx = cy+dy, cx+dx
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True; q.append((ny, nx))
                if n >= min_area:
                    out.append({'x': x0, 'y': y0, 'w': x1-x0+1, 'h': y1-y0+1, 'n': n})
    return out

def cluster_rows(comps, tol=6):
    comps = sorted(comps, key=lambda c: (c['y'], c['x']))
    rows = []
    for c in comps:
        for r in rows:
            if abs(r[0]['y'] - c['y']) <= tol:
                r.append(c); break
        else:
            rows.append([c])
    for r in rows: r.sort(key=lambda c: c['x'])
    return sorted(rows, key=lambda r: r[0]['y'])


def merge_circles(comps):
    """Radio circles are split by their dark outline into pieces (h<=15). Union-find merge."""
    pcs = [c for c in comps if c['h'] <= 15 and c['w'] <= 20]
    par = list(range(len(pcs)))
    def f(i):
        while par[i] != i:
            par[i] = par[par[i]]; i = par[i]
        return i
    for i, a in enumerate(pcs):
        for j, b in enumerate(pcs):
            if i < j and a['x'] < b['x']+b['w']+2 and b['x'] < a['x']+a['w']+2 \
               and a['y'] < b['y']+b['h']+5 and b['y'] < a['y']+a['h']+5:
                par[f(i)] = f(j)
    g = {}
    for i, c in enumerate(pcs): g.setdefault(f(i), []).append(c)
    out = []
    for v in g.values():
        x0 = min(c['x'] for c in v); y0 = min(c['y'] for c in v)
        x1 = max(c['x']+c['w'] for c in v); y1 = max(c['y']+c['h'] for c in v)
        out.append({'x': x0, 'y': y0, 'w': x1-x0, 'h': y1-y0})
    return sorted(out, key=lambda c: (c['y'], c['x']))

def detect(path='src/nat3092.png'):
    im = load(path)
    comps = components(blue_mask(im))
    cells = [c for c in comps if c['h'] >= 25 and c['w'] <= 21]        # character cells
    sigs = [c for c in comps if c['w'] > 200]                          # signature areas
    circles = merge_circles(comps)
    return cells, circles, sigs

def rect(c): return {'x': c['x'], 'y': c['y'], 'w': c['w'], 'h': c['h']}


# ---------------------------------------------------------------- field mapping
def build():
    cells, circles, sigs = detect()
    def row(y, x0=0, x1=2000, tol=8):
        r = sorted([c for c in cells if abs(c['y']-y) <= tol and x0 <= c['x'] <= x1], key=lambda c: c['x'])
        return [rect(c) for c in r]
    def circ(x, y, tol=8):
        m = [c for c in circles if abs(c['x']-x) <= tol and abs(c['y']-y) <= tol]
        assert len(m) == 1, (x, y, m)
        return rect(m[0])
    def need(lst, n, name):
        assert len(lst) == n, (name, len(lst), n); return lst
    F = []
    def boxes(id, q, sec, label, bx, cs, validator, ph, help, groups=None, rows=None):
        d = {'id': id, 'q': q, 'section': sec, 'label': label, 'type': 'boxes', 'charset': cs,
             'boxes': bx, 'validator': validator, 'placeholder': ph, 'help': help}
        if groups: d['groups'] = groups
        if rows: d['rows'] = rows
        F.append(d)
    def choice(id, q, sec, label, opts, help, typ='choice', validator='none'):
        F.append({'id': id, 'q': q, 'section': sec, 'label': label, 'type': typ,
                  'options': [{'value': v, 'label': l, 'rect': r} for v, l, r in opts],
                  'validator': validator, 'help': help})
    def date(id, q, sec, label, bx, help):
        F.append({'id': id, 'q': q, 'section': sec, 'label': label, 'type': 'date', 'charset': 'digits',
                  'boxes': need(bx, 8, id), 'groups': [2, 2, 4], 'validator': 'date',
                  'placeholder': 'DD MM YYYY', 'help': help})
    def sig(id, q, sec, label, r, help):
        F.append({'id': id, 'q': q, 'section': sec, 'label': label, 'type': 'signature',
                  'rect': rect(r), 'validator': 'none', 'help': help})

    # ---------- Section A
    tfn = need(row(162, 0, 500), 9, 'tfn')
    boxes('tfn', 'A1', 'A', 'Tax file number (TFN)', tfn, 'digits', 'tfn', '123 456 782',
          'Your 9-digit TFN, as shown on your TFN notice or ATO correspondence. Leave blank only if you tick one of the three options that follow.', [3, 3, 3])
    choice('tfn_applied', 'A1', 'A', 'I have made a separate application/enquiry to the ATO for a new or existing TFN',
           [('yes', 'Tick', circ(479, 204))], 'Tick only if you have applied for, or asked the ATO about, a TFN and do not have it yet.', 'checkbox')
    choice('tfn_under18', 'A1', 'A', 'I am claiming an exemption because I am under 18 years of age and do not earn enough to pay tax',
           [('yes', 'Tick', circ(479, 245))], 'Tick only if you are under 18 and do not earn enough to pay tax.', 'checkbox')
    choice('tfn_pension', 'A1', 'A', 'I am claiming an exemption because I am in receipt of a pension, benefit or allowance',
           [('yes', 'Tick', circ(479, 287))], 'Tick only if you receive a pension, benefit or allowance.', 'checkbox')

    choice('title', 'A2', 'A', 'Title',
           [('mr', 'Mr', circ(260, 330)), ('mrs', 'Mrs', circ(333, 330)), ('miss', 'Miss', circ(406, 330)), ('ms', 'Ms', circ(479, 330))],
           'Optional. Pick the title you use.')
    boxes('surname', 'A2', 'A', 'Surname or family name', need(row(377, 0, 500), 19, 'surname'), 'alpha', 'name', 'SMITH',
          'Write in BLOCK LETTERS, one letter per box.')
    boxes('given_name', 'A2', 'A', 'First given name', need(row(423, 0, 500), 19, 'given'), 'alpha', 'name', 'JANE', 'BLOCK LETTERS.')
    boxes('other_names', 'A2', 'A', 'Other given names', need(row(469, 0, 500), 19, 'other'), 'alpha', 'none', 'MARY', 'Optional. Any other given names.')

    boxes('addr1', 'A3', 'A', 'Home address (line 1)', need(row(535, 0, 500), 19, 'a1'), 'address', 'none', '12 EXAMPLE STREET', 'Your home address in Australia (not a PO Box).')
    boxes('addr2', 'A3', 'A', 'Home address (line 2)', need(row(577, 0, 500), 19, 'a2'), 'address', 'none', '', 'Continue the address here if needed. Optional.')
    boxes('suburb', 'A3', 'A', 'Suburb/town/locality', need(row(621, 0, 500), 19, 'sub'), 'alpha', 'none', 'SYDNEY', 'BLOCK LETTERS.')
    boxes('state', 'A3', 'A', 'State/territory', need(row(665, 0, 100), 3, 'st'), 'alpha', 'state', 'NSW', 'NSW, VIC, QLD, SA, WA, TAS, NT or ACT.')
    boxes('postcode', 'A3', 'A', 'Postcode', need(row(665, 150, 300), 4, 'pc'), 'digits', 'postcode', '2000', '4-digit Australian postcode.')
    boxes('prev_name', 'A4', 'A', 'Previous family name', need(row(746, 0, 500), 19, 'prev'), 'alpha', 'none', 'JONES',
          'Only if you changed your name since you last dealt with the ATO. Otherwise leave blank.')
    e1 = need(row(162, 500), 19, 'email1'); e2 = need(row(206, 500), 19, 'email2')
    boxes('email', 'A5', 'A', 'Primary e-mail address', e1 + e2, 'email', 'email', 'name@example.com',
          'Optional. Continues onto the second row if it is long.', None, [19, 19])
    date('dob', 'A6', 'A', 'Date of birth', row(261, 700), 'Day, month and year.')
    choice('basis', 'A7', 'A', 'On what basis are you paid?',
           [('fulltime', 'Full-time employment', circ(614, 325)), ('parttime', 'Part-time employment', circ(709, 325)),
            ('labour', 'Labour hire', circ(775, 325)), ('super', 'Superannuation or annuity income stream', circ(889, 325)),
            ('casual', 'Casual employment', circ(985, 325))], 'Select only one.')
    choice('residency', 'A8', 'A', 'Are you:',
           [('resident', 'An Australian resident for tax purposes', circ(662, 393)), ('foreign', 'A foreign resident for tax purposes', circ(810, 393)),
            ('whm', 'A working holiday maker', circ(985, 393))], 'Select only one.')
    choice('tax_free', 'A9', 'A', 'Do you want to claim the tax-free threshold from this payer?',
           [('yes', 'Yes', circ(570, 502)), ('no', 'No', circ(633, 502))],
           'Only claim the tax-free threshold from one payer at a time, unless your total income from all sources will be less than the threshold. Answer No if you are a foreign resident or working holiday maker (except a foreign resident receiving an Australian Government pension or allowance).')
    choice('help_debt', 'A10', 'A', 'Do you have a HELP, VSL, FS, SSL or TSL debt?',
           [('yes', 'Yes', circ(570, 604)), ('no', 'No', circ(985, 604))],
           'Higher Education Loan Program, VET Student Loan, Financial Supplement, Student Start-up Loan or Trade Support Loan. If Yes, your payer will withhold extra amounts for compulsory repayment.')
    sig('sig_a', 'A11', 'A', 'Payee signature', sigs[0], 'Declaration: the information you have given is true and correct.')
    date('date_a', 'A11', 'A', 'Date signed (payee)', row(708, 700), 'Date you sign.')

    # ---------- Section B
    abn = need(row(884, 0, 400), 11, 'abn')
    boxes('abn', 'B1', 'B', 'Australian business number (ABN) or withholding payer number', abn, 'digits', 'abn', '51 824 753 556',
          'Your 11-digit ABN or withholding payer number.', [2, 3, 3, 3])
    boxes('branch', 'B1', 'B', 'Branch number (if applicable)', need(row(884, 400, 600), 3, 'br'), 'digits', 'none', '001', 'Only if applicable.')
    choice('abn_applied', 'B2', 'B', "If you don't have an ABN or withholding payer number, have you applied for one?",
           [('yes', 'Yes', circ(413, 927)), ('no', 'No', circ(479, 927))], 'Only answer if you have no ABN or withholding payer number.')
    for i, y in enumerate((1006, 1047, 1089), 1):
        boxes('biz_name%d' % i, 'B3', 'B', 'Legal name or registered business name (line %d)' % i, need(row(y, 0, 500), 19, 'bn%d' % i),
              'any', 'name' if i == 1 else 'none', 'EXAMPLE PTY LTD' if i == 1 else '',
              'Legal name or registered business name (or your individual name if not in business).' if i == 1 else 'Continue the name here if needed.')
    boxes('biz_addr1', 'B4', 'B', 'Business address (line 1)', need(row(1150, 0, 500), 19, 'ba1'), 'address', 'none', '1 BUSINESS ROAD', '')
    boxes('biz_addr2', 'B4', 'B', 'Business address (line 2)', need(row(1194, 0, 500), 19, 'ba2'), 'address', 'none', '', 'Optional.')
    boxes('biz_suburb', 'B4', 'B', 'Suburb/town/locality', need(row(1241, 0, 500), 19, 'bs'), 'alpha', 'none', 'SYDNEY', '')
    boxes('biz_state', 'B4', 'B', 'State/territory', need(row(1284, 0, 100), 3, 'bst'), 'alpha', 'state', 'NSW', '')
    boxes('biz_postcode', 'B4', 'B', 'Postcode', need(row(1284, 150, 300), 4, 'bpc'), 'digits', 'postcode', '2000', '')
    be = need(row(867, 500), 19, 'be1') + need(row(910, 500), 19, 'be2')
    boxes('biz_email', 'B5', 'B', 'Primary e-mail address (payer)', be, 'email', 'email', 'payroll@example.com', 'Optional.', None, [19, 19])
    boxes('contact', 'B6', 'B', 'Contact person', need(row(972, 500), 19, 'contact'), 'alpha', 'name', 'JANE SMITH', 'Who the ATO should contact.')
    boxes('biz_phone', 'B6', 'B', 'Business phone number', need(row(1013, 600), 10, 'phone'), 'digits', 'phone', '0290001234',
          'Include the area code (10 digits).')
    x = [c for c in cells if abs(c['y']-1058) <= 6 and c['x'] > 900]
    assert len(x) == 1
    choice('payee_ceased', 'B7', 'B', 'I no longer make payments to this payee', [('yes', 'X', rect(x[0]))],
           'Print X in this box if you no longer make payments to this payee.', 'checkbox')
    sig('sig_b', 'B8', 'B', 'Payer signature', sigs[1], 'Declaration by payer: the information you have given is true and correct.')
    date('date_b', 'B8', 'B', 'Date signed (payer)', row(1161, 700), 'Date you sign.')

    S = lambda id, sec, title, ids, help: {'id': id, 'section': sec, 'title': title, 'fieldIds': ids, 'help': help}
    steps = [
        S('A1', 'A', 'Your tax file number', ['tfn', 'tfn_applied', 'tfn_under18', 'tfn_pension'], 'Use your TFN, or tick one of the three exceptions if you do not have one yet.'),
        S('A2', 'A', 'Your name', ['title', 'surname', 'given_name', 'other_names'], 'Title is optional. Surname and first given name are needed.'),
        S('A3', 'A', 'Your home address in Australia', ['addr1', 'addr2', 'suburb', 'state', 'postcode'], 'The address where you live.'),
        S('A4', 'A', 'Previous family name', ['prev_name'], 'Only fill this in if you changed your name since you last dealt with the ATO.'),
        S('A5', 'A', 'Your e-mail address', ['email'], 'Optional. Your primary e-mail address.'),
        S('A6', 'A', 'Your date of birth', ['dob'], 'Day, month and year.'),
        S('A7', 'A', 'How are you paid?', ['basis'], 'Select only one.'),
        S('A8', 'A', 'Your tax residency', ['residency'], 'Select only one.'),
        S('A9', 'A', 'Tax-free threshold', ['tax_free'], 'Only claim the tax-free threshold from one payer at a time, unless your total income will be under the threshold.'),
        S('A10', 'A', 'Study and training loans', ['help_debt'], 'HELP, VSL, FS, SSL or TSL debt? Your payer withholds extra to cover repayments.'),
        S('A11', 'A', 'Sign and date your declaration', ['sig_a', 'date_a'], 'You declare that the information is true and correct. There are penalties for deliberately making a false or misleading statement.'),
        S('B1', 'B', 'Payer: ABN or withholding payer number', ['abn', 'branch'], 'Payer section (optional): your employer can complete this.'),
        S('B2', 'B', 'Payer: applied for an ABN?', ['abn_applied'], 'Only if the payer has no ABN or withholding payer number.'),
        S('B3', 'B', 'Payer: business name', ['biz_name1', 'biz_name2', 'biz_name3'], 'Legal name or registered business name (or individual name if not in business).'),
        S('B4', 'B', 'Payer: business address', ['biz_addr1', 'biz_addr2', 'biz_suburb', 'biz_state', 'biz_postcode'], ''),
        S('B5', 'B', 'Payer: e-mail address', ['biz_email'], 'Optional.'),
        S('B6', 'B', 'Payer: contact person', ['contact', 'biz_phone'], 'Who the ATO should contact, and a business phone number.'),
        S('B7', 'B', 'Payer: no longer paying this payee?', ['payee_ceased'], 'Print X only if you no longer make payments to this payee.'),
        S('B8', 'B', 'Payer: sign and date', ['sig_b', 'date_b'], 'Payer declaration that the information is true and correct.'),
    ]
    return {'image': {'src': 'nat3092.png', 'w': 1024, 'h': 1449}, 'steps': steps, 'fields': F}

def overlay(data, out='tools/overlay_debug.png'):
    from PIL import ImageDraw
    img = Image.open('src/nat3092.png').convert('RGB')
    d = ImageDraw.Draw(img)
    cols = [(220, 0, 0), (0, 140, 0), (200, 0, 200), (230, 120, 0)]
    for i, f in enumerate(data['fields']):
        c = cols[i % 4]
        rs = [b for b in f.get('boxes', [])] + [o['rect'] for o in f.get('options', [])] + ([f['rect']] if 'rect' in f else [])
        for r in rs:
            d.rectangle([r['x']-1, r['y']-1, r['x']+r['w'], r['y']+r['h']], outline=c)
        r = rs[0]
        d.text((r['x']+1, r['y']-10), f['id'], fill=c)
    img.save(out)

if __name__ == '__main__':
    data = build()
    json.dump(data, open('src/fields.json', 'w'), indent=1)
    overlay(data)
    n = sum(len(f.get('boxes', [])) + len(f.get('options', [])) + ('rect' in f) for f in data['fields'])
    print('fields', len(data['fields']), 'steps', len(data['steps']), 'rects', n)
