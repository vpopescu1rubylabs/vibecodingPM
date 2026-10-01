#!/usr/bin/env python3
"""Build self-contained dist/index.html (landing) and dist/fill.html (editor).
python3 stdlib only (PIL optional: used to downscale the landing hero image).
Usage: python3 build.py"""
import base64, hashlib, io, json, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC, LIB, DIST = (os.path.join(ROOT, d) for d in ("src", "lib", "dist"))
LIBS = ["validate", "rules", "render", "pdf", "store"]  # SPEC order; editor.js last
IMG = "nat3092.png"

def csp_for(html):
    """Per-page CSP. Inline <script> is allowed only by sha256 hash (no 'unsafe-inline' for scripts);
    a page with no executable inline script gets script-src 'none'. Styles keep 'unsafe-inline'
    (inline style= attributes are set by editor.js; style injection cannot run code or exfiltrate under
    default-src/connect-src/img-src restrictions)."""
    hashes = []
    for m in re.finditer(r"<script\b([^>]*)>(.*?)</script>", html, flags=re.I | re.S):
        if re.search(r"type=[\"']?application/(json|ld\+json)", m.group(1), re.I) or not m.group(2).strip():
            continue  # data blocks are never executed
        hashes.append("'sha256-%s'" % base64.b64encode(hashlib.sha256(m.group(2).encode("utf-8")).digest()).decode())
    return ("default-src 'none'; script-src %s; style-src 'unsafe-inline'; font-src data:; img-src data: blob:; "
            "connect-src 'none'; base-uri 'none'; form-action 'none'" % (" ".join(hashes) or "'none'"))

HEADER_ONLY_CSP = "; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests"  # not valid in <meta>
SECURITY_HEADERS = [
    ("Referrer-Policy", "no-referrer"),
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Permissions-Policy", "accelerometer=(), ambient-light-sensor=(), autoplay=(), bluetooth=(), camera=(), display-capture=(), "
        "geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), "
        "serial=(), usb=(), xr-spatial-tracking=(), browsing-topics=(), interest-cohort=()"),
    ("Cross-Origin-Opener-Policy", "same-origin"),
    ("Cross-Origin-Resource-Policy", "same-origin"),
    ("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload"),
]
HTML_CACHE = "public, max-age=300, must-revalidate"
PAGES = {"index.html": ["/", "/index.html"], "fill.html": ["/fill", "/fill.html"]}

missing, warnings = [], []

def read(path, required=True, label=None):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError:
        if required:
            missing.append(label or os.path.relpath(path, ROOT))
        return None

def b64uri(data, mime):
    return "data:%s;base64,%s" % (mime, base64.b64encode(data).decode())

def image_uris():
    p = os.path.join(SRC, IMG)
    with open(p, "rb") as f:
        raw = f.read()
    full = raw
    hero = raw
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        # editor: lossless re-encode, optimized (same pixels)
        b = io.BytesIO(); im.save(b, "PNG", optimize=True)
        if len(b.getvalue()) < len(full): full = b.getvalue()
        h = im.resize((640, round(im.height * 640 / im.width)), getattr(Image,'Resampling',Image).LANCZOS)
        b = io.BytesIO(); h.save(b, "PNG", optimize=True)
        pal = h.quantize(colors=64, method=0)
        b2 = io.BytesIO(); pal.save(b2, "PNG", optimize=True)
        hero = b2.getvalue() if len(b2.getvalue()) < len(b.getvalue()) else b.getvalue()
    except ImportError:
        warnings.append("PIL missing: embedding original PNG for both pages")
    return b64uri(full, "image/png"), b64uri(hero, "image/png")

def esc_script(s):
    return re.sub(r"</(script)", r"<\\/\1", s, flags=re.I)

def esc_style(s):
    return re.sub(r"</(style)", r"<\\/\1", s, flags=re.I)

def sub_img(text, uri):
    return text.replace(IMG, uri) if text else text

FONTS = [("inter-latin.woff2", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"),
         ("inter-latin-ext.woff2", "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF")]

def font_css():
    """Inter (variable, 100-900) embedded as base64 so no page depends on a system font or the network."""
    out = ""
    for fn, rng in FONTS:
        p = os.path.join(SRC, "fonts", fn)
        try:
            with open(p, "rb") as f: data = f.read()
        except OSError:
            missing.append("src/fonts/" + fn); continue
        out += ("@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;"
                "src:url(%s) format('woff2');unicode-range:%s}\n" % (b64uri(data, "font/woff2"), rng))
    return out

def inline_css(html, css_files, img_uri):
    """Replace <link rel=stylesheet> tags with inline <style>; append css if no link found."""
    css = font_css()
    for name in css_files:
        c = read(os.path.join(SRC, name))
        if c: css += "/* %s */\n%s\n" % (name, c)
    css = sub_img(css, img_uri)
    block = "<style>\n%s</style>" % esc_style(css)
    state = {"first": True}
    def repl(m):
        if state["first"]:
            state["first"] = False
            return block
        return ""
    new, n = re.subn(r'<link\b[^>]*rel=["\']?stylesheet["\']?[^>]*>', repl, html, flags=re.I)
    if n == 0:
        new = re.sub(r"</head>", lambda m: block + "\n</head>", html, count=1, flags=re.I) if css else html
    return new

def inject_csp(html):
    meta = '<meta http-equiv="Content-Security-Policy" content="%s">' % csp_for(html)
    html = re.sub(r'<meta[^>]+http-equiv=["\']?Content-Security-Policy["\']?[^>]*>', "", html, flags=re.I)
    if re.search(r"<head[^>]*>", html, re.I):
        return re.sub(r"(<head[^>]*>)", lambda m: m.group(1) + "\n" + meta, html, count=1, flags=re.I)
    return meta + html

def build_landing(img_hero):
    html = read(os.path.join(SRC, "index.html"))
    if html is None: return None
    html = inline_css(html, ["landing.css"], img_hero)
    html = sub_img(html, img_hero)
    html = re.sub(r'(href=["\'])(?:\./)?(?:dist/)?(?:editor\.html|fill\.html)', r"\1fill.html", html)
    # landing may contain its own scripts; leave inline ones, strip external
    return inject_csp(html)

def build_editor(img_full):
    html = read(os.path.join(SRC, "editor.html"))
    if html is None: return None
    html = inline_css(html, ["shell.css", "editor.css"], img_full)
    html = sub_img(html, img_full)
    fj = read(os.path.join(SRC, "fields.json"))
    jsn = None
    if fj is not None:
        try:
            data = json.loads(fj)
            if isinstance(data.get("image"), dict): data["image"]["src"] = img_full
            jsn = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
        except ValueError as e:
            missing.append("src/fields.json (invalid JSON: %s)" % e)
    jtag = ('<script type="application/json" id="fields-json">%s</script>' % esc_script(jsn)) if jsn else ""
    # drop existing fields-json placeholder & all external script tags
    html = re.sub(r'<script\b[^>]*id=["\']fields-json["\'][^>]*>.*?</script>', "", html, flags=re.I | re.S)
    js = ""
    for n in LIBS:
        c = read(os.path.join(LIB, n + ".js"), label="lib/%s.js" % n)
        if c: js += "/* lib/%s.js */\n%s\n;\n" % (n, c)
    ed = read(os.path.join(SRC, "editor.js"))
    if ed: js += "/* editor.js */\n%s\n" % sub_img(ed, img_full)
    sh = read(os.path.join(SRC, "shell.js"))
    if sh: js += "/* shell.js */\n%s\n" % sh
    bundle = jtag + "\n<script>\n%s</script>" % esc_script(js)
    srcs = list(re.finditer(r'<script\b[^>]*\bsrc=[^>]*>\s*</script>', html, flags=re.I))
    if srcs:
        first = srcs[0].span()
        rest = html[first[1]:]
        rest = re.sub(r'<script\b[^>]*\bsrc=[^>]*>\s*</script>', "", rest, flags=re.I)
        html = html[:first[0]] + bundle + rest
    else:
        html = re.sub(r"</body>", lambda m: bundle + "\n</body>", html, count=1, flags=re.I) if re.search(r"</body>", html, re.I) else html + bundle
    return inject_csp(html)

def sanity(files):
    """Fail on external URLs / external resource refs."""
    bad = []
    allow_ns = re.compile(r"^https?://(www\.w3\.org/(1999|2000)/\w+|www\.w3\.org/XML/1998/namespace)")
    allow_ato = re.compile(r"^https://(www\.)?ato\.gov\.au(/|$)")
    srcs = {}
    for d, exts in ((SRC, (".html", ".css", ".js")), (LIB, (".js",))):
        if os.path.isdir(d):
            for n in sorted(os.listdir(d)):
                if n.endswith(exts): srcs[os.path.join(d, n)] = read(os.path.join(d, n))
    for p, t in srcs.items():
        for m in re.finditer(r"https?://[^\s\"'<>)\\]+", t or ""):
            u = m.group(0)
            if allow_ns.match(u): continue
            ctx = t[max(0, m.start() - 12):m.start()]
            if allow_ato.match(u) and re.search(r'href=\s*["\']?$', ctx, re.I):
                continue  # plain anchor link to ato.gov.au
            bad.append("%s: %s" % (os.path.relpath(p, ROOT), u))
    for name, html in files.items():
        if re.search(r"<script\b[^>]*\bsrc=", html, re.I): bad.append("%s: external <script src>" % name)
        for m in re.finditer(r"<link\b[^>]*>", html, re.I):
            if re.search(r"href=", m.group(0), re.I) and not re.search(r"rel=[\"']?(icon|canonical)", m.group(0), re.I) or re.search(r'href=["\']?https?:', m.group(0), re.I):
                bad.append("%s: external <link> %s" % (name, m.group(0)[:80]))
        if re.search(r"\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b", html):
            warnings.append("%s mentions network API (review manually)" % name)
        if re.search(r"@import|url\(\s*['\"]?https?:", html, re.I): bad.append("%s: css @import/remote url" % name)
    return bad

def write_headers(out):
    """Emit dist/_headers (Cloudflare Pages/Netlify) and vercel.json from ONE source so CSP hashes never drift.
    Security headers go on every path; Cache-Control only on the HTML routes (robots.txt keeps CDN defaults,
    avoiding duplicate Cache-Control merging)."""
    csp = {n: csp_for(h) + HEADER_ONLY_CSP for n, h in out.items() if h}
    lines = ["# generated by build.py - do not edit", "/*"] + ["  %s: %s" % kv for kv in SECURITY_HEADERS]
    vercel = []
    for n, paths in PAGES.items():
        if n not in csp: continue
        for p in paths:
            lines += ["", p, "  Content-Security-Policy: " + csp[n], "  Cache-Control: " + HTML_CACHE]
            vercel.append({"source": p, "headers": [{"key": "Content-Security-Policy", "value": csp[n]},
                                                    {"key": "Cache-Control", "value": HTML_CACHE}]})
    with open(os.path.join(DIST, "_headers"), "w") as f: f.write("\n".join(lines) + "\n")
    vercel.insert(0, {"source": "/(.*)", "headers": [{"key": k, "value": v} for k, v in SECURITY_HEADERS]})
    with open(os.path.join(ROOT, "vercel.json"), "w") as f:
        json.dump({"cleanUrls": True, "headers": vercel}, f, indent=2); f.write("\n")
    with open(os.path.join(DIST, "robots.txt"), "w") as f: f.write("User-agent: *\nAllow: /\n")

def main():
    os.makedirs(DIST, exist_ok=True)
    if not os.path.exists(os.path.join(SRC, IMG)):
        print("FATAL: src/%s missing" % IMG); return 2
    img_full, img_hero = image_uris()
    bad = sanity({})
    out = {"index.html": build_landing(img_hero), "fill.html": build_editor(img_full)}
    bad += sanity({k: v for k, v in out.items() if v})
    if bad:
        print("BUILD FAILED: external references found:\n  " + "\n  ".join(bad)); return 1
    for name, html in out.items():
        if html is None: continue
        with open(os.path.join(DIST, name), "w", encoding="utf-8") as f: f.write(html)
        print("wrote dist/%s (%.0f KB)" % (name, len(html.encode()) / 1024))
    write_headers(out)
    for w in warnings: print("warn:", w)
    if missing:
        print("INCOMPLETE (missing inputs): " + ", ".join(sorted(set(missing)))); return 3
    print("OK")
    return 0

if __name__ == "__main__":
    sys.exit(main())
