# AirPage BLE editor

Static Web Bluetooth / LAN client for the T5 V2.3 (122×250) and Seeed Sticky
(480×800 portrait logical page, 122×250 content at 2x).

## Local test

~~~bash
cd web
python3 -m http.server 8000
# open http://localhost:8000
~~~

Web Bluetooth requires a secure context. localhost is accepted on the same
machine; a phone must use HTTPS. The cert.pem/key.pem files are only for a local
self-signed test and are ignored by git.

## WiFi transport (branch wifi-mqtt)

Besides Web Bluetooth, the editor can push over the LAN. The device runs a small
HTTP API and prints a QR code containing its address and a 16-char id:

    http://<device-ip>/?id=<16 chars>&w=122&h=250&mode=1bit

That id is both identity and secret (same shape AirPage's editor expects,
`^[A-Za-z0-9_-]{16}$`). The editor takes it from `?host=&id=` on its own URL, or
from the WiFi panel (scan / paste). Requests carry it as the `X-T5-Id` header.

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /api/ping` | no | scan probe: `{"magic":"T5AP","device":…}` |
| `GET /api/info` | id | panel, RSSI, heap, current frame hash |
| `POST /api/image` | id | multipart field `image`, exactly 4000 bytes |
| `POST /api/script` | id | multipart field `script`, <= 4096 bytes |
| `POST /api/run` | id | rerun the stored source |
| `GET /api/screen?v=net\|image\|qr` | id | switch what the panel shows |

Two things that will bite:

- **https pages can reach the LAN in current Chrome, but not everywhere.**
  Measured on Chrome 156: a page on `https://…` fetched `http://192.168.31.118`
  successfully (Chrome's Local Network Access replaced the old blanket
  mixed-content rule; the device answers the preflight with
  `Access-Control-Allow-Private-Network: true`). Safari and older Firefox still
  block it, so the safe recipe stays: serve the editor over plain http on the
  LAN — `python3 -m http.server 8010 --bind 0.0.0.0 --directory web`, then open
  `http://<your-lan-ip>:8010/`.
- **Uploads are multipart**, because the device's WebServer only exposes binary
  bodies through the multipart parser (a raw body is also NUL-trimmed).

Scanning is a probe, not mDNS: a page cannot do mDNS or UDP, so it fetches
`/api/ping` across the /24 it is served from, 24 at a time, 700 ms timeout.

## Deploy

Published copy: <https://xuchdeid.github.io/t5-airpage/> (GitHub Pages, repository
xuchdeid/t5-airpage, branch main). Push this directory's files, including fonts/,
to that repository to update it.

To use a different HTTPS static host, upload index.html, style.css, app.js,
quotes.js, device-paper.js and the fonts/ directory. No server code, build step, or cloud API is needed. Then set
EDITOR_URL in src/main.cpp to that URL and rebuild; the device QR points at it.

The QR uses version 4 / ECC low, so keep the URL short (roughly 78 bytes). A longer
URL needs a larger QR version and a smaller module scale in showQrScreen().

## Device profiles

The toolbar has **T5 2.13"** and **Sticky 3.97"** buttons. A connected device
whose name starts with `STK` switches automatically to Sticky; a name starting
with `T5` switches back. The choice is remembered in `localStorage`, and
`?board=sticky` / `?board=t5` selects it directly.

The transport is still the same 4,000-byte 122×250 1-bit frame. Sticky's preview
is its real 480×800 portrait page: the 122×250 frame is drawn at 2x and centred
(244×500 at 118,150), exactly like the firmware. Sticky is portrait-only; the
landscape button is disabled. "Download PNG" exports the 480×800 page for
Sticky, while send/script operations still use the 4,000-byte payload.

## Orientation

- Portrait: 122×250, sent as-is.
- Landscape: 250×122, laid out horizontally and rotated 90° clockwise into the
  portrait transport buffer. Rotate the device clockwise to view it.
- JS 画布 is always portrait 122×250; its landscape button is disabled.

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
- JS 画布: the firmware 12 px atlas (device12.png/json) only; the device
  ignores the scale argument and has no font families.

The built-in 每日一句 card auto-fits 10–24 px. JS 画布 is fixed to the device
12 px atlas, so its preview and the panel match exactly. Do not switch the
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

## JS 画布（设备模拟器）

The browser and the T5 now run the same API. JS 画布 loads the firmware's
exported 12 px atlas and draws into a fixed 122×250 1-bit framebuffer with
stride 16. The preview is packed exactly like the image transport; the same
source can be sent as a bitmap, or pushed as source and run by the T5.

The editor has one source and one Run button. The separate ES5 panel is gone.
连接后 push uses control 0x10/0x12; 运行已存 uses 0x13.

API (nothing else exists on the device):

    paper.width()                 // 122
    paper.height()                // 250
    paper.clear(black)            // default 0 = white
    paper.setPixel(x, y, black)   // default black 1; clipped
    paper.fillRect(x, y, w, h, black)
    paper.text(x, y, text, scale, black)
    paper.textWidth(text, scale)
    paper.lineHeight(scale)       // 13
    paper.commit()                // returns FNV-1a hash

paper.text puts the 12×13 px glyph cell at (x, y). Newlines advance by 13 and
reset x to the text call's start. scale is accepted but ignored. Missing
codepoints use the tofu glyph and advance 12 px.

Samples use only this API and are self-contained ES5:

- 基础卡片; 文字海报; 年度进度; 每周计划; 待办; 月相; 测试图; 点阵图案.

The editor rejects const/let/class, arrow functions, template strings,
async/await, generators, optional chaining, nullish coalescing, browser globals, old paper.*
helpers and text-first paper.text. Script limit is 4096 UTF-8 bytes.

The atlas is the 31,345-glyph Fusion Pixel 12 px cmap, not a quote-only subset.
Most common Chinese now renders without tofu, but a codepoint absent from that
font still uses the tofu glyph. JS 画布 is always portrait; the landscape button
is disabled.

Examples:

    var W = paper.width(), H = paper.height();
    paper.clear(0);
    paper.fillRect(0, 0, W, 38, 1);
    paper.text(4, 1, "每日一句", 1, 0);
    paper.text(4, 92, "知是行之", 1, 1);
    paper.commit();

The exact same source can be Run in the browser, sent as a 4,000-byte bitmap,
or pushed to the T5. A successful push leaves the previous source/image intact
on failure (error 11 or 12).

## Browser support

- Android Chrome / Edge: yes
- desktop Chrome / Edge: yes
- iPhone Safari: no Web Bluetooth (use Bluefy or a native app)
- Firefox: no Web Bluetooth

## Files

- index.html — layout, orientation switch
- style.css — responsive UI
- app.js — built-in photo/daily rendering, 1-bit packing, CRC32, GATT image/script client
- quotes.js — local quote corpus for 每日一句
- device-paper.js — device API simulator and all JS samples
- fonts/device12.png + device12.json — exported firmware 12 px atlas
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
