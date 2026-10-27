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

Canvas text uses web/fonts/fusion-pixel-12px.woff2 (Fusion Pixel 12px Monospaced SC,
SIL OFL). app.js rasterises and thresholds the 12 px master, then caches 24 and 48 px
cells as exact 2×/4× integer pixel grids (width, height and baseline per size). The
quote template exposes a 12/24/48 px body-size selector. Do not switch the canvas back
to system fonts: anti-aliased Chinese loses strokes at this resolution.

## Browser support

- Android Chrome / Edge: yes
- desktop Chrome / Edge: yes
- iPhone Safari: no Web Bluetooth (use Bluefy or a native app)
- Firefox: no Web Bluetooth

## Files

- index.html — layout, orientation switch
- style.css — responsive UI
- app.js — pixel-font rendering, 1-bit packing, CRC32, GATT client
- fonts/fusion-pixel-12px.woff2 — pixel font
- fonts/OFL.txt — font license

The bitmap is 122×250, MSB-first, stride 16, exactly 4,000 bytes, 1 = black.
Landscape is rotated into this same buffer before sending.
