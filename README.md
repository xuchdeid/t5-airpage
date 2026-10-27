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
- 24 px and above font menu: Noto Serif SC, Noto Sans SC, or the ISCAS 24 px
  bitmap (native at 24, scaled at 26/28/30/32).
- 24 px Song: web/fonts/song24.png + song24.json remains only as a fallback for
  rare glyphs outside the Noto subset.

The quote template exposes the full 8–32 px body-size selector. Do not switch the
canvas back to system fonts: anti-aliased Chinese loses strokes at this resolution.

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
the 122×250 1-bit panel. It is intentionally independent of QuickJS:

~~~js
var C = paper.colors;
paper.clear(C.white);
paper.drawTextEx(8, 22, 'Hello', C.black, 20, 'sans');
paper.strokeRect(5, 5, 112, 240, C.black);
paper.commit();
~~~

- Coordinates follow the current orientation: 122×250 portrait, 250×122
  landscape.
- `paper.drawText` uses a 12 px base multiplied by `scale`; `drawTextEx`
  takes an explicit pixel size and font name (`sans`, `serif`, `song`, `kai`,
  `mono`).
- Text is drawn through Canvas, thresholded to 1-bit, and is not the same
  rasteriser as the device bitmap fonts.
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
- app.js — pixel-font rendering, 1-bit packing, CRC32, GATT client
- quotes.js — local quote corpus for 每日一句
- js-paper.js — browser-side 1-bit `paper.*` API used by JS 画布
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
