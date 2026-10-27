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

To use a different HTTPS static host, upload index.html, style.css, app.js and the
fonts/ directory. No server code, build step, or cloud API is needed. Then set
EDITOR_URL in src/main.cpp to that URL and rebuild; the device QR points at it.

The QR uses version 4 / ECC low, so keep the URL short (roughly 78 bytes). A longer
URL needs a larger QR version and a smaller module scale in showQrScreen().

## Orientation

- Portrait: 122×250, sent as-is.
- Landscape: 250×122, laid out horizontally and rotated 90° clockwise into the
  portrait transport buffer. Rotate the device clockwise to view it.

## Pixel font

Canvas text supports 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32 px:

- 8/10/12 px: three independent Fusion Pixel designs
  (fusion-pixel-8px.woff2, -10px, -12px; SIL OFL), rasterised and thresholded
  to 1-bit.
- 14/16 px Chinese: native WenQuanYi Bitmap Song atlases (wqy14.png/json,
  wqy16.png/json), rasterised from the 13px and 12pt PCF strikes.
- 18–32 px Chinese: web/fonts/song24.png + song24.json, generated from the
  ISCAS/GUO BIAO 24×24 Song bitmap (gb24st.bdf). 24 px is the native design;
  other sizes render the same 24 px glyph at the requested size.
- 48 px Chinese: exact 2×24 Song for the large number/label slots.
- Latin/numbers above 12 px fall back to the integer-scaled 12 px master because
  the Song and WenQuanYi atlases are CJK-only.

The quote template exposes the full 8–32 px body-size selector. Do not switch the
canvas back to system fonts: anti-aliased Chinese loses strokes at this resolution.

WenQuanYi Bitmap Song is GPLv2 with the font embedding exception; see
fonts/WQY-COPYING, WQY-AUTHORS and WQY-SOURCE.txt. Fusion Pixel is SIL OFL; ISCAS
Song is under its permissive license.

## Browser support

- Android Chrome / Edge: yes
- desktop Chrome / Edge: yes
- iPhone Safari: no Web Bluetooth (use Bluefy or a native app)
- Firefox: no Web Bluetooth

## Files

- index.html — layout, orientation switch
- style.css — responsive UI
- app.js — pixel-font rendering, 1-bit packing, CRC32, GATT client
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
- fonts/song24.png — 24 px Song glyph atlas
- fonts/song24.json — atlas index and Unicode map
- fonts/ISCAS.txt — ISCAS Song license

The bitmap is 122×250, MSB-first, stride 16, exactly 4,000 bytes, 1 = black.
Landscape is rotated into this same buffer before sending.
