# Zendocs – NAT 3092 TFN Declaration: Architecture Contract (CTO)

Goal: production-ready, **zero-backend** web app. Fill the ATO Tax File Number declaration (NAT 3092, page 1) in the browser, sign, download PDF / print. Must survive 10,000 DAU on a static host/CDN and handle sensitive data (TFN, DOB, address) **entirely client-side: no network calls with user data, no analytics, no third-party scripts/fonts at runtime**.

Root: `site/`. Source image: `src/nat3092.png` (1024x1449 px, the form). Original landing copy/design: `tools/original-landing-template.html` (Inter font, brand blue #1f75db, green #3fc374, grey #f0f2f3, text #0d0d0d/#5d5d5d).

## Deliverables / ownership (each agent writes ONLY its own files)
| Owner | Files |
|---|---|
| form-analyst | `src/fields.json`, `tools/detect_boxes.py`, `tools/overlay_debug.png` (debug render proving coords), `docs/form-rules.md` |
| rules-engineer | `lib/validate.js`, `lib/rules.js`, `tests/unit.test.js` (node --test, no deps) |
| platform-engineer | `lib/render.js`, `lib/pdf.js`, `lib/store.js`, `tests/platform.test.js` |
| editor-engineer | `src/editor.html`, `src/editor.css`, `src/editor.js` |
| landing-engineer | `src/index.html` (plain HTML+CSS, NO dc-runtime/React), `src/landing.css` |
| devops | `build.py` (inlines everything -> `dist/index.html`, `dist/fill.html`, each fully self-contained, image base64 inlined or hashed asset), `dist/_headers`, `dist/robots.txt`, `README.md` (deploy steps), `package.json` scripts |

All JS is plain ES2019 in the browser, no bundler, no frameworks, no CDN. Libs are UMD-ish: `(function(root){ ... root.ZD = root.ZD||{}; root.ZD.validate = {...}; if(typeof module!=='undefined') module.exports = ...})(typeof window!=='undefined'?window:globalThis)` so they run in both Node tests and browser.

## Data contract: `src/fields.json`
```json
{ "image": {"src":"nat3092.png","w":1024,"h":1449},
  "steps": [ {"id":"A1","section":"A","title":"Your tax file number","fieldIds":["tfn","tfn_alt"],"help":"..."} ],
  "fields": [ {
    "id":"tfn", "q":"A1", "label":"Tax file number (TFN)",
    "type":"boxes|choice|checkbox|date|signature",
    "charset":"digits|alpha|alnum|email|address|any",   // boxes only; alpha = letters space - ' ; uppercased (BLOCK LETTERS)
    "boxes":[{"x":236,"y":160,"w":24,"h":30}, ...],      // boxes/date: one rect per character cell, image px, reading order
    "groups":[3,3,3],                                     // optional display grouping (TFN 3-3-3)
    "options":[{"value":"yes","label":"Yes","rect":{"x":..,"y":..,"w":..,"h":..}}],  // choice/checkbox: rect of the tick circle/box
    "rect":{"x":..,"y":..,"w":..,"h":..},                // signature: sign area
    "validator":"tfn|abn|email|postcode|state|dateOfBirth|date|name|phone|none",
    "placeholder":"...", "help":"...", "section":"A|B"
  } ] }
```
Section A (payee) = Qs 1-10 + declaration sig/date. Section B (payer) = Qs 1-7 + declaration sig/date. Steps must order fields so the UI asks ONE question at a time, in form order. Dates are 8 cells DDMMYYYY. Email rows: Q5 has TWO rows of 24-ish cells (continues on second row): model as one `boxes` field with all cells in reading order (row1 then row2).

## `lib/validate.js` -> `ZD.validate`
`tfn(str)` (9 digits, weights 1,4,3,7,5,8,6,9,10 sum%11==0; also accept 8-digit legacy with weights 10,7,8,4,6,3,5,2,1 ), `abn(str)` (11 digits, subtract 1 from first digit, weights 10,1,3,5,7,9,11,13,15,17,19, sum%89==0), `email`, `postcode` (AU 4 digits 0200-9999), `state` (NSW VIC QLD SA WA TAS NT ACT), `date(ddmmyyyy)` real calendar date, `dateOfBirth` (past, age 0..120 ; flag <15 or so as warning), `phone`(AU 10 digits / 8), `name`. All return `{ok:boolean, error?:string, warn?:string}` with plain-English messages. `ZD.validate.run(validatorName, value)`.

## `lib/rules.js` -> `ZD.rules`
`isRequired(fieldId, values)` and `validateAll(values, fieldsJson, {section:'A'|'AB'})` -> `{errors:{fieldId:msg}, warnings:{}, complete:boolean}`; conditional logic from the ATO form (Q1: TFN OR exactly one of the three "OR" boxes; Q2 title optional, surname+first name required; Q3 address lines/suburb/state/postcode required; Q4 optional; Q5 email optional; Q6 DOB required; Q7 & Q8 & Q9 & Q10 exactly one option; signature + date required; Section B optional unless the user opts into completing it; Q9 must be "No" guidance for foreign resident / working holiday maker — warn not block). `values` shape: `{fieldId: string}` for boxes/date/signature(dataURL), `{fieldId: optionValue}` for choice, `{fieldId: true|false}` for checkbox.

## `lib/render.js` -> `ZD.render`
`render(canvas, image, fieldsJson, values, {scale, highlightFieldId, forExport})` draws the form image then text (monospace-ish, BLOCK CAPITALS centred one char per cell, dark blue-black ink #111a4a), ticks/X in choice boxes, signature (dataURL image drawn into rect, or typed name in a cursive stack). Must be pixel-deterministic (no DOM dependency beyond canvas).

## `lib/pdf.js` -> `ZD.pdf`
`fromCanvas(canvas, {quality}) -> Uint8Array` : dependency-free single-page A4 PDF embedding a JPEG (DCTDecode) – correct xref offsets, opens in Acrobat/Preview/Chrome. `download(bytes, filename)` via Blob. Must pass `qpdf --check`/`pdfinfo` if available.

## `lib/store.js` -> `ZD.store`
localStorage autosave (`save(values)`, `load()`, `clear()`), versioned key `zd.nat3092.v1`, 30-day expiry, try/catch everything (private mode), debounced, never throws, in-memory fallback. `hasDraft()`.

## Editor UX (`src/editor.*`)
Wizard, one question per screen, big live preview of the real form with the current field highlighted and zoomed; mobile-first (360px+), keyboard-first (Enter = next, each box char auto-advances, Backspace goes back, paste of a whole TFN/ABN/email fills boxes); a progress bar, Back/Next, inline validation errors in plain English, review screen listing all answers with "Edit" links and a final summary check, sign step (type name -> cursive, or draw with finger/mouse; clear button), then Download PDF / Print / Start over (wipes data). Resume banner if draft exists. "Your data never leaves this device" notice. WCAG 2.1 AA: labels, focus rings, aria-live errors, contrast, reduced-motion. Section B is offered as optional ("Payer section – your employer can complete this").
Scripts are included in this order: validate.js, rules.js, render.js, pdf.js, store.js, then editor.js (editor reads `fields.json` inlined as `<script type="application/json" id="fields-json">`; build.py inlines it).

## Definition of done
`python3 build.py` produces working `dist/index.html` and `dist/fill.html` (landing CTA links go to `fill.html`). `node --test tests/` passes. No external requests (verify in browser network log).
