# Zendocs – NAT 3092 TFN declaration (static site)

Pure static output in `dist/`: `index.html` (landing), `fill.html` (editor), `_headers`, `robots.txt`. Each HTML file is fully self-contained (inline CSS/JS/image, `fields.json` embedded), so it also works by double-clicking from disk. No backend, no analytics, no third-party requests; TFN/DOB/address never leave the browser (only optional localStorage draft, 24-hour expiry (TFN, DOB, email and signature are never stored), wiped by "Start over").

## Build and test
```
python3 build.py                 # sources in src/ + lib/ -> dist/ (fails on any external URL/script/link)
node --test tests/*.test.js      # unit tests (the bare `tests/` form fails on newer Node)
python3 -m venv .venv && .venv/bin/pip install playwright   # once
.venv/bin/python tests/smoke.py  # headless: no console errors, no external requests, CTA -> fill.html
```
`npm test` runs build + unit + smoke (smoke needs playwright on `python3`).

## Deploy (publish directory = `dist`, build command optional: `python3 build.py`)
- **Cloudflare Pages**: connect repo (or `npx wrangler pages deploy dist`). `_headers` is honoured.
- **Netlify**: `netlify deploy --prod --dir=dist`, or Git with publish dir `dist`. `_headers` honoured.
- **Vercel**: `vercel --prod`, output directory `dist`, framework "Other". `_headers` is NOT read, but `build.py` also writes `vercel.json` (repo root) with identical headers; commit it.
- **S3 + CloudFront**: `aws s3 sync dist s3://BUCKET --delete`; attach a CloudFront Response Headers Policy with the `_headers` values (CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy); invalidate `/*` after deploy.
- **GitHub Pages**: cannot set headers. `build.py` injects an equivalent `<meta http-equiv="Content-Security-Policy">` into both pages (no `frame-ancestors`, which only works as a header), so CSP still applies. Serve `dist/` via Actions or a `gh-pages` branch.

## Load
Two static files: `fill.html` ~710 KB raw (~490 KB gzipped; the form image is base64 PNG and barely compresses), `index.html` ~145 KB and zero server work; 10k DAU is trivial for any CDN. HTML is cached 5 min with must-revalidate, so a deploy propagates fast.

## Rollback
Re-deploy the previous commit/build (Cloudflare/Netlify/Vercel: promote the previous deployment in the dashboard; S3: re-sync the prior tag and invalidate).

## Security and privacy posture
- **Headers and CSP come from `build.py`** (single source: writes `dist/_headers` and `vercel.json`). Never hand-edit them: the CSP pins the inline app script by sha256, so any edit to the JS changes the hash. Always deploy the freshly built `dist/` and `_headers` together.
- CSP: `default-src 'none'`; `script-src` = that one hash (landing: `'none'`); `connect-src 'none'`, `form-action 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `upgrade-insecure-requests`. Injected script cannot run and nothing can be sent off-device. `style-src 'unsafe-inline'` remains (inline `style=` attributes). Every page also carries the same policy as `<meta>` (minus header-only directives) for hosts that cannot set headers (GitHub Pages).
- Also set: `Referrer-Policy: no-referrer`, `nosniff`, `X-Frame-Options: DENY`, HSTS (2y, preload: submit the domain at hstspreload.org only when sure all subdomains are HTTPS), COOP/CORP `same-origin`, Permissions-Policy denying device APIs. HTML is cached 5 min (`must-revalidate`) so a bad deploy is fixed fast; robots.txt uses CDN defaults.
- Keep hosting analytics / log enrichment / "Web Analytics" / bot-injection scripts OFF. Do not put a CDN rewrite that injects scripts in front of this site (CSP would block it, and the hash would be bypassed only by a header change).
- Stored data: a draft is kept in this browser's localStorage only (key `zd.nat3092.v1`, 30 day expiry). "Start over" / "Delete draft" wipes storage and in-memory state. Anyone with access to that browser profile can read the draft, including the TFN, DOB and signature; see the draft-retention note in the security review before raising the expiry.
- Legal posture: independent tool, not affiliated with or endorsed by the ATO; it does not lodge anything. The user gives the completed declaration to their payer (employer), who keeps it. We collect no personal information, so there is nothing to disclose, breach-notify or delete server-side; still publish a short privacy statement saying so (Privacy Act 1988 / APPs apply to entities that collect; a no-collection app should state that plainly, and that browser storage is on the user's own device).
- Supply chain: zero runtime dependencies (no npm packages, no CDN, no fonts). Build needs only Python stdlib (Pillow optional, used to shrink images). `python3 build.py` is deterministic for identical inputs and Pillow version; CI should run `python3 build.py && git diff --exit-code dist/`.
