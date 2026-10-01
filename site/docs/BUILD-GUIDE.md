# Build guide: "Guided fill" form editor (Form NAT 3092)

Paste this whole file into Claude Code as the brief. Reference implementation: `Zendocs Editor.dc.html` (logic class at the bottom, from `const STEPS`). Reference page: `assets/page1-desktop.png` (1024 × 1449).

## 1. What it is

A document editor for a fixed-layout PDF form. The form page sits on a grey canvas. Clicking a question **zooms that question to the centre of the screen** as a card, over a dimmed backdrop. The user fills only that question, presses **Next**, and the next question zooms in. The form stays visible behind. A **Guided fill** switch turns this off, so people can type straight onto the full page.

Do **not** build a normal HTML form. The form is a fixed page with fields positioned on it.

## 2. Stack suggestion

React + TypeScript (Vite). No UI library needed. Use CSS transforms for the zoom. Fonts: Inter (app UI), Roboto + Roboto Condensed (form text), Roboto Mono (letter boxes), Caveat (signature).

## 3. Core idea: one coordinate space

Everything is placed in **page space: 1024 × 1449 px**. The page is drawn once at 1024 wide. Scale it with `transform: scale(k)`. Never position in screen pixels.

Layers inside the page container (`position: relative; width: 1024px; height: 1449px`):

1. **Page artwork.** Raster `page1-desktop.png` for the normal view. For the zoomed card, use a **vector redraw** (see 7). Scaling the PNG up 2× looks blurry.
2. **Field layer.** Absolutely positioned inputs, one per field.
3. **Hotspot layer.** One transparent button per question (see 4).

## 4. Data model

```ts
type Step = { sec: 'Section A'|'Section B'; q: string; title: string;
              col: 'L'|'R'; y0: number; y1: number };   // question band in page space
// x range: col L = 12..510, col R = 512..1014
type Field =
 | { t:'comb'; id; label; x; y; w; h; n; num?: boolean; lower?: boolean }  // n letter boxes
 | { t:'radio'; id; group; val; label; x; y; w:21; h:28 }
 | { t:'check'; id; label; x; y; w; h }
 | { t:'sign';  id; label; x; y; w; h };
const FIELDS: Field[][] = [ /* one array per Step, same order */ ];
values: Record<string, string|boolean>   // radios store value under `group`
```

19 steps: Section A questions 1–10 + declaration, Section B questions 1–7 + declaration. `STEPS` and `FIELDS` are in the reference file; copy them verbatim. They hold every measured coordinate.

Hotspot for step *i*: a transparent absolutely-positioned button at `x0..x1, y0..y1`. Hover tint `rgba(31,117,219,.06)`, 8px radius.

## 5. The zoom

Given the step band `(x0,y0,w,h)` with 4px padding:

```
avW = min(viewportW - 160, 1000)          // mobile: viewportW - 24
avH = viewportH - 134 - 96                // 134 = header + title, 96 = bottom bar
k   = clamp(min(avW/w, avH/h), 0.5, 2.4)
card = w*k × h*k, centred horizontally; top = max(84, (vh-(h*k+134))/2 + 58)
inner layer transform: translate(-x0*k, -y0*k) scale(k)   // transform-origin 0 0
card: overflow hidden, radius 12, shadow 0 24px 64px rgba(0,0,0,.35)
```

**Open animation (FLIP).** Measure the hotspot's `getBoundingClientRect()`. Render the card first with `transform: translate(dx,dy) scale(sx,sy)` so it overlays the hotspot (`phase='from'`). Two `requestAnimationFrame`s later switch to `transform:none` (`phase='open'`) with `transition: .38s cubic-bezier(.2,.8,.2,1)`. Close is the reverse; unmount after 380ms.

While `phase==='from'`, show the raster crop (`background-image` + `background-size: 1024*k` + position). Once open, fade in the vector layer (`opacity .22s`). The raster-to-vector swap is the crisp-text trick.

Backdrop: `rgba(13,13,13,.55)` + `backdrop-filter: blur(2px)`. Click backdrop to close.

Chrome around the card:
- Above: small label `Section A · Question 3` (13px/500), then the title (18px/600, white, `text-wrap: balance`).
- Below: pill bar with **Back**, `n / 19`, **Next** (last = **Finish**). Back is disabled at step 0.
- Behind the card, scroll the page canvas so the active question is vertically centred (`scrollTo` smooth).

## 6. Fields: letter-box inputs (the fiddly bit)

The form has printed boxes (`n` per field). Draw them as artwork. Overlay **one `<input>`** per field. Do not render n inputs.

```
pitch = w / n;  charW = 10.2          // Roboto Mono 17px/500
input: width = w + 2*pitch (hide overflow via wrapper of width w), 
       padding-left = (pitch - charW)/2 + 0.6, letter-spacing = pitch - charW,
       background transparent, border 0, line-height = h
wrapper: position absolute at (x,y), width w, height h, overflow hidden
text-transform: uppercase (unless lower), maxLength = n
```

This makes each character land in its own printed box. Rules:
- `num` fields: strip non-digits (`replace(/\D/g,'')`), `inputMode="numeric"`.
- E-mail lines: lowercase, `inputMode="email"`.
- When length reaches `n`, focus the next field (`data-fi = index in step`).
- Backspace on an empty field focuses the previous one.
- Focus style: `background: rgba(31,117,219,.12)`.

**Radios** (21×28 hit area, 10px dot, `role="radio"`): one pick per `group`; clicking the selected one clears it. Space toggles.
**Check**: shows an X (stroke 2.4) not a tick. `role="checkbox"`.
**Signature**: Caveat 600. Font size shrinks with length so it never overflows: `fs = clamp(10, h*0.82, (w-52)/(len*0.46))`; left padding 42px so it clears the "sign" tag; keep it above the "You MUST SIGN here" label (`height = h - 14`).

**Text must always fit its box.** Cap by `maxLength`; for signatures use the shrink rule above.

## 7. Vector redraw of the form (for crisp zoom)

Build a data-driven drawing in page space: arrays of `texts`, `rects` (the blue letter boxes `#ccd7ff` with `1.5px #3c4471` border, radios, checkbox, sign tags), and `rules` (the 1.2px black dividers; vertical column rule at x=512). Every text has `{x, y, size, weight, italic, align}` and is vertically centred on `y`. Text is Roboto Condensed 12.5–14px, question numbers bold. Generate boxes straight from `FIELDS` so artwork and inputs can never drift apart. Reference: the `VEC` block in the reference file. Copy all label strings from it.

Mobile reuses the same page at `scale((viewportW - 40) / 1024)`.

## 8. Keyboard

- Enter or ArrowRight (when not typing) goes Next; Esc closes; ArrowLeft goes Back.
- Auto-focus the first field after the open animation (retry up to 10 × 50ms until the element exists; `preventScroll: true`).

## 9. Guided fill toggle

Switch labelled **Guided fill** (top-right of the toolbar; centred in the mobile top bar). `role="switch"`, track blue `#1f75db` on / `#c9c9c9` off, 32×18 with a 14px knob. Persist in `localStorage['zd-focus-mode']` (`'1'`/`'0'`), default on. Turning it off closes any open card, disables hotspots and makes the field layer live directly on the page (`pointer-events: auto`). When on, the on-page field layer is inert (`pointer-events: none`) so clicks open the zoom.

## 10. Persistence

Save `values` to `localStorage['zd-n3092-values']` on every change. Restore on mount.

## 11. Shell around it (match the reference screenshots)

- Header 60px: logo + "zendocs" left; doc-name pill (240×38, 1px `#e6e6e6`), download/share/print icon buttons, blue **Done** pill (101×38, `#1f75db`).
- Toolbar 52px, bottom border `#e6e6e6`: Thumbnails, undo/redo, Page Layout, Sign, Add Image, More Tools. Text 14px/500, `#5d5d5d`.
- Left sidebar 163px: three 40×34 icon buttons, then page thumbnails (86×121, selected = 2px `#6da5e8` border, badge `#e3eefb`).
- Canvas background `#f0f2f3`; pages 1024 wide, radius 6, soft shadow.
- Bottom-right Help pill (96×42, blue border) and dismissible AI-assistant bubble (278px wide).
- Below 768px: mobile layout, a single column of pages, top bar with undo/redo + download/share/print, bottom bar with Sign / Add Image / More Tools / **Done**.
- Tokens: blue `#1f75db`, ink `#0d0d0d`, secondary `#5d5d5d`, borders `#e6e6e6`, canvas `#f0f2f3`.

## 12. Build order

1. Page canvas + `STEPS`/`FIELDS` data (copy from reference).
2. Field layer; verify letter boxes line up at 1× with the artwork (fix pitch/padding first).
3. Toggle off mode, typing on the full page, persistence.
4. Hotspots + zoom card (static, no animation), Back/Next.
5. FLIP animation, raster-to-vector swap, backdrop.
6. Vector redraw generated from data.
7. Keyboard, auto-advance, signature fit.
8. Shell, thumbnails, mobile.

## 13. Acceptance checks

- Typing 19 characters in Surname fills all 19 boxes and nothing spills.
- TFN `123 456 789` auto-advances across three fields.
- A 26-character signature stays inside its box and clear of the "MUST SIGN" label.
- Zoomed text is sharp at 2.4× on a retina display.
- Guided fill off: no card ever appears; typing works on the page.
- Reload keeps all answers and the toggle state.
- Question 8 etc. allow one radio per group and clear on re-click.

## 14. Known approximations

Field and label coordinates were measured from the screenshot, so a few sit 1–2px off the original. The vector form uses Roboto Condensed as a stand-in for the original typeface. Page 2 has no fields. Toolbar icons are hand-drawn approximations.
