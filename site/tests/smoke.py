#!/usr/bin/env python3
"""Headless smoke test. Needs: pip install playwright (chromium from `playwright install chromium`
or the cached ~/Library/Caches/ms-playwright). Run: python3 tests/smoke.py
Checks dist/index.html + dist/fill.html over file:// and http://127.0.0.1:
no console/page errors, no requests beyond the origin (data:/blob: ok), CTA landing -> fill."""
import http.server, os, socketserver, sys, threading
from urllib.parse import urlparse
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit("playwright missing: python3 -m venv .venv && .venv/bin/pip install playwright && .venv/bin/python tests/smoke.py")

DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist")
fails = []

def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

class Q(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=DIST, **k)
    def log_message(s, *a): pass

srv = socketserver.TCPServer(("127.0.0.1", 0), Q); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

def visit(browser, url, label):
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    page = ctx.new_page()
    errs, reqs = [], []
    page.on("console", lambda m: m.type == "error" and errs.append(m.text))
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("request", lambda r: reqs.append(r.url))
    page.goto(url, wait_until="load"); page.wait_for_timeout(500)
    check(not errs, "%s: no console/page errors %s" % (label, errs[:3]))
    origin = urlparse(url)
    ext = [u for u in reqs if not u.startswith(("data:", "blob:")) and
           (urlparse(u).scheme != origin.scheme or urlparse(u).netloc != origin.netloc)]
    check(not ext, "%s: no external requests %s" % (label, ext[:3]))
    return ctx, page


def editor_regressions(browser, base):
    """Behaviour regressions found in QA (desktop, guided card)."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}); page = ctx.new_page()
    errs = []; page.on("console", lambda m: m.type == "error" and errs.append(m.text)); page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(base + "fill.html"); page.wait_for_selector(".zde-hot", state="attached"); page.wait_for_timeout(300)
    # 1. a second pen stroke must not erase the first
    page.evaluate("ZDEditor.open(10)"); page.wait_for_timeout(800)
    page.click(".zde-ov .zde-segm >> text=Draw")
    bb = page.locator(".zde-ov .zde-pad-cv").bounding_box()
    def stroke(x0, y0):
        page.mouse.move(x0, y0); page.mouse.down()
        for t in range(1, 10): page.mouse.move(x0 + t * 8, y0 + (t % 3) * 10)
        page.mouse.up(); page.wait_for_timeout(150)
    stroke(bb["x"] + 20, bb["y"] + 30); one = page.evaluate("ZDEditor.values().sig_a")
    stroke(bb["x"] + 160, bb["y"] + 30); two = page.evaluate("ZDEditor.values().sig_a")
    w = lambda u: page.evaluate("u => new Promise(r => { const i = new Image(); i.onload = () => r(i.width); i.src = u })", u)
    check(w(two) > w(one) + 40, "signature: second stroke adds to the first (%s -> %s px)" % (w(one), w(two)))
    # 2. over-long paste is cut off AND blocks Next until corrected
    page.evaluate("ZDEditor.open(3)"); page.wait_for_timeout(800)
    page.evaluate("""() => { const i = document.querySelector('.zde-card input.zde-in'); i.focus(); const dt = new DataTransfer(); dt.setData('text', 'A'.repeat(25)); i.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true})) }""")
    page.click(".zde-next"); page.wait_for_timeout(300)
    check(page.inner_text(".zde-count").startswith("4 /") and page.locator(".zde-err").count() == 1, "over-long entry blocks Next with an error")
    page.keyboard.press("Backspace"); page.click(".zde-next"); page.wait_for_timeout(500)
    check(page.inner_text(".zde-count").startswith("5 /"), "correcting the entry lets Next through")
    # 3. typing into a full TFN overwrites instead of silently dropping the last digit
    page.evaluate("ZDEditor.open(0)"); page.wait_for_timeout(800)
    page.keyboard.type("123456782")
    page.evaluate("document.querySelector('.zde-card input.zde-in').setSelectionRange(2, 2)")
    page.keyboard.type("9")
    check(page.evaluate("ZDEditor.values().tfn") == "129456782", "typing into a filled field overwrites the next box")
    # 4. sensitive answers never reach localStorage
    page.wait_for_timeout(600)
    ls = page.evaluate("JSON.stringify(localStorage)")
    check("129456782" not in ls and '\\"tfn\\"' not in ls, "TFN is not persisted")
    check(not errs, "editor regressions: no console errors %s" % errs[:2])
    ctx.close()

with sync_playwright() as p:
    b = p.chromium.launch()
    for base in ("file://" + os.path.abspath(DIST) + "/", "http://127.0.0.1:%d/" % port):
        kind = base.split(":")[0]
        for name in ("index.html", "fill.html"):
            ctx, page = visit(b, base + name, "%s %s" % (kind, name))
            if name == "fill.html":
                check(page.evaluate("!!(window.ZD && ZD.validate && ZD.rules && ZD.render && ZD.pdf && ZD.store)"), "%s fill.html: ZD libs loaded" % kind)
                check(page.evaluate("!!document.querySelector('canvas')"), "%s fill.html: canvas present" % kind)
                check(page.evaluate("!!(document.querySelector('#zd-canvas') && document.querySelector('.zd-header') && document.querySelector('.zd-bottombar'))"), "%s fill.html: shell DOM present" % kind)
                check(page.evaluate("getComputedStyle(document.querySelector('.zd-bottombar')).display!=='none' && getComputedStyle(document.querySelector('.zd-sidebar')).display==='none'"), "%s fill.html: mobile layout @390px" % kind)
                check(page.evaluate("document.fonts.check('600 14px Inter')"), "%s fill.html: Inter embedded" % kind)
                check(page.evaluate("document.querySelector('[data-act=guided]').getAttribute('role')==='switch'"), "%s fill.html: guided switch" % kind)
                check(page.evaluate("document.querySelector('.zde-ov .zde-count') && document.querySelector('.zde-ov .zde-count').textContent.startsWith('1 /')"), "%s fill.html: question 1 opens on arrival" % kind)
                page.evaluate("ZDEditor.close()"); page.wait_for_timeout(450)
                page.click(".zd-guided-m [data-act=guided]")
                check(page.evaluate("localStorage.getItem('zd-focus-mode')")=='0', "%s fill.html: guided toggle persists" % kind)
                page.evaluate("localStorage.clear()")
                page.set_viewport_size({"width": 1440, "height": 900})
                check(page.evaluate("getComputedStyle(document.querySelector('.zd-sidebar')).display!=='none' && document.querySelector('.zd-header').offsetHeight===60 && document.querySelector('.zd-toolbar').offsetHeight===52"), "%s fill.html: desktop layout @1440px" % kind)
                check(page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "%s fill.html: no horizontal scroll @390px" % kind)
            else:
                check(page.evaluate("document.fonts.check('600 14px Inter')"), "%s index.html: Inter embedded" % kind)
                check(page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "%s index.html: no horizontal scroll @390px" % kind)
            ctx.close()
        ctx, page = visit(b, base + "index.html", "%s CTA" % kind)
        cta = page.locator("a[href$='fill.html']").first
        check(cta.count() > 0, "%s: CTA link to fill.html exists" % kind)
        if cta.count():
            cta.click(); page.wait_for_load_state("load"); page.wait_for_timeout(400)
            check(page.url.endswith("fill.html"), "%s: CTA navigates to fill.html (%s)" % (kind, page.url))
        ctx.close()
    editor_regressions(b, "http://127.0.0.1:%d/" % port)
    b.close()
srv.shutdown()
print("\n%d failure(s)" % len(fails)); sys.exit(1 if fails else 0)
