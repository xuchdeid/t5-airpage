# AirPage BLE editor

Static Web Bluetooth client for the T5 V2.3 (122×250 1-bit panel).

## Local test

~~~bash
cd web
python3 -m http.server 8000
# open http://localhost:8000
~~~

Web Bluetooth requires a secure context. localhost is accepted on the same
machine; a phone must use HTTPS. The cert.pem/key.pem files are only for a local
self-signed test and are ignored by git.

## Deploy

Published copy: <https://xuchdeid.github.io/t5-airpage/> (GitHub Pages, repository
xuchdeid/t5-airpage, branch main). Push this directory's files, including fonts/,
to that repository to update it.

To use a different HTTPS static host, upload index.html, style.css, app.js,
quotes.js, js-paper.js and the fonts/ directory. No server code, build step, or cloud API is needed. Then set
EDITOR_URL in src/main.cpp to that URL and rebuild; the device QR points at it.

The QR uses version 4 / ECC low, so keep the URL short (roughly 78 bytes). A longer
URL needs a larger QR version and a smaller module scale in showQrScreen().

## Orientation

- Portrait: 122×250, sent as-is.
- Landscape: 250×122, laid out horizontally and rotated 90° clockwise into the
  portrait transport buffer. Rotate the device clockwise to view it.

## Pixel font

Canvas text supports 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32 px
(plus 48 px for the fixed year/countdown number slots):

- 8/10/12 px: three independent Fusion Pixel designs
  (fusion-pixel-8px.woff2, -10px, -12px; SIL OFL), rasterised and thresholded
  to 1-bit.
- 14/16 px Chinese: native WenQuanYi Bitmap Song atlases (wqy14.png/json,
  wqy16.png/json), rasterised from the 13px and 12pt PCF strikes.
- 18/20/22/24/26/28/30/32/48 px Chinese: web/fonts/noto-serif-sc.woff2, a
  GB2312 subset of Noto Serif SC, rendered and thresholded separately at each
  target size. This includes 24 and 48; neither is a bitmap scaled up or down.
- Latin/numbers 18 px and above: also Noto Serif at the target size. Below 18 px
  they fall back to the integer-scaled 12 px master.
- JS Canvas fonts: `sans`, `serif` and `song` use the native glyph pipeline
  in the editor; `pixel` is pinned to the Fusion 8/10/12 faces. Standalone
  `js-paper.js` falls back to Noto Serif/Sans.
- 24 px Song: web/fonts/song24.png + song24.json remains only as a fallback for
  rare glyphs outside the Noto subset.

The built-in 每日一句 card auto-fits 10–24 px; the JS 文字海报 sample uses 22 px in
portrait and 18 px in landscape. Do not switch the canvas back to system fonts:
anti-aliased Chinese loses strokes at this resolution.

WenQuanYi Bitmap Song is GPLv2 with the font embedding exception; see
fonts/WQY-COPYING, WQY-AUTHORS and WQY-SOURCE.txt. Noto Serif SC is SIL OFL; see
fonts/NOTO-OFL.txt and NOTO-SOURCE.txt. Fusion Pixel is SIL OFL; ISCAS Song is
under its permissive license.

## 每日一句

每日一句 is a local daily-quote card. The 77-entry corpus is in quotes.js; no
request is made when it renders.

- The date is hashed to a starting index, so the same date is stable.
- 上一句 / 换一句 adjust an offset in memory.
- 今天 resets to the browser's local date and index 0.
- The date picker lets you preview other days.
- The card auto-fits a native size from 10 to 24 px; long quotes do not clip.
- Portrait is 122×250 and landscape is 250×122, like the other templates.

## JS 画布

JS 画布 adds a code editor and a browser-side `paper.*` implementation for
the 122×250 1-bit panel. The sidebar has only 照片, 每日一句 and JS 画布; every other
card is a JS sample:

- 文字海报 — quote, frame, byline
- 年度进度 — year percentage and days left
- 每周计划 — seven rows; two columns in landscape
- 待办 — checkboxes; two columns in landscape
- 倒计时 — days/hours to a target date
- 月相 — approximate illuminated moon and phase
- 测试图 — grid, border, TOP/BOTTOM
- 弹性布局 — column/row/gap/padding 排版示例
- 基础图形 / 当前时间 / 点阵图案 — API examples

Selecting a use case loads its source into the editor. It is intentionally
independent of QuickJS:

~~~js
var C = paper.colors;
paper.clear(C.white);
paper.text('Hello', 8, 22, { size: 20, font: 'sans' });
paper.strokeRect(5, 5, 112, 240, C.black);
paper.commit();
~~~

- Coordinates follow the current orientation: 122×250 portrait, 250×122
  landscape.
- `paper.font(size, family)` returns a font descriptor; `setFont` makes it the
  default. Families: `sans`, `serif`, `song`, `pixel` (8/10/12 only), `mono`,
  `kai`. `paper.fonts` and `paper.fontSizes` expose the catalogue.
- `paper.text(text, x, y, options)` supports `size`, `font`, `ink`, `align`,
  `baseline`, `width` (wrap), `lineHeight`, `maxLines` and `ellipsis`.
  `measure`, `wrapText`, `fitText` and `textBox` use the same options.
- In the editor, `sans`/`serif`/`song` use the native AirPage glyph pipeline
  (Fusion 8/10/12, WQY 14/16, Noto/Song 18+); standalone `js-paper.js` falls
  back to Canvas/Noto. `mono`/`kai` always use Canvas.
- `drawText`, `drawTextEx`, `measureText` and `drawTextBox` remain as
  backward-compatible wrappers.

### Layout

`paper.ui` builds a small declarative tree; `paper.render` measures it and
draws it. It is a flexbox subset, not a CSS engine:

~~~js
var ui = paper.ui;
paper.clear(paper.colors.white);
paper.render(
  ui.column({ padding: 8, gap: 6 }, [
    ui.row({ justify: "between", align: "center" }, [
      ui.text("T5 AirPage", { size: 16, font: "sans", weight: 700 }),
      ui.text("BLE", { size: 8, font: "mono", padding: [1, 3], border: 1 })
    ]),
    ui.divider(),
    ui.text("不再手算坐标，文字会自动测量和换行。", {
      size: 12, font: "serif", grow: 1
    }),
    ui.spacer(),
    ui.text("122 × 250", { size: 8, font: "mono" })
  ])
);
~~~

- `ui.column` / `ui.row`: children are laid out on the main axis; `gap`
  separates them, `justify` moves the group, `align` aligns the cross axis.
- `ui.text`: auto width/height; `width`, `height`, `maxLines`, `ellipsis`,
  `align` and `valign` constrain it. Text uses the same font options as
  `paper.text`.
- `ui.spacer`: grows into the free main-axis space. `ui.divider`: one-pixel rule.
- `padding` / `margin`: number or `[vertical, horizontal]` / `[t, r, b, l]`.
- `grow` / `shrink` / `basis`: flex sizing; `alignSelf` overrides the
  container cross alignment.
- `fill` (or `background`), `border` and `borderColor` paint the box.
- `paper.render(tree)` fills the current 122×250 (or 250×122) canvas,
  returns the layout tree, and stores it as `paper.lastLayout`. Call
  `paper.clear` first; low-level drawing calls remain available for anything
  the layout does not cover.
- `paper.commit()` is a no-op in the simulator; the editor packs the buffer
  after the script returns.
- Timers are no-ops. Each Run is one static frame.
- Scripts run with `new Function` in the page, not in a sandbox. Treat the
  editor as a local developer tool.

The browser preview is exactly the 4,000-byte bitmap that is sent over BLE;
the script itself is not uploaded to the T5 in this phase.

## Browser support

- Android Chrome / Edge: yes
- desktop Chrome / Edge: yes
- iPhone Safari: no Web Bluetooth (use Bluefy or a native app)
- Firefox: no Web Bluetooth

## Files

- index.html — layout, orientation switch
- style.css — responsive UI
- app.js — built-in photo/daily rendering, 1-bit packing, CRC32, GATT client
- quotes.js — local quote corpus for 每日一句
- js-paper.js — browser-side 1-bit `paper.*` API and all JS card samples
- fonts/fusion-pixel-8px.woff2 — 8 px pixel font
- fonts/fusion-pixel-10px.woff2 — 10 px pixel font
- fonts/fusion-pixel-12px.woff2 — 12 px pixel font
- fonts/OFL.txt — Fusion Pixel license
- fonts/wqy14.png — native 14 px WenQuanYi Song atlas
- fonts/wqy16.png — native 16 px WenQuanYi Song atlas
- fonts/WQY-COPYING — WenQuanYi GPLv2 + embedding exception
- fonts/WQY-AUTHORS — WenQuanYi authors
- fonts/WQY-README — upstream font README
- fonts/WQY-SOURCE.txt — source/version note
- fonts/song24.png — native 24 px Song glyph atlas
- fonts/song24.json — atlas index and Unicode map
- fonts/ISCAS.txt — ISCAS Song license
- fonts/noto-serif-sc.woff2 — Noto Serif SC subset for 18–48 px detail
- fonts/noto-sans-sc.woff2 — Noto Sans SC subset, 24 px font option
- fonts/NOTO-OFL.txt — Noto license
- fonts/NOTO-SOURCE.txt — Noto subset source note

The bitmap is 122×250, MSB-first, stride 16, exactly 4,000 bytes, 1 = black.
Landscape is rotated into this same buffer before sending.
