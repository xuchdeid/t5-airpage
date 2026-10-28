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
quotes.js, device-paper.js and the fonts/ directory. No server code, build step, or cloud API is needed. Then set
EDITOR_URL in src/main.cpp to that URL and rebuild; the device QR points at it.

The QR uses version 4 / ECC low, so keep the URL short (roughly 78 bytes). A longer
URL needs a larger QR version and a smaller module scale in showQrScreen().

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
- JS 画布: the firmware 24 px atlas (device24.png/json) only; the
  device ignores the scale argument and has no font families.

The built-in 每日一句 card auto-fits 10–24 px. JS 画布 is fixed to the device
24 px atlas, so its preview and the panel match exactly. Do not switch the
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
exported 24 px atlas and draws into a fixed 122×250 1-bit framebuffer with
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
    paper.lineHeight(scale)       // 36
    paper.commit()                // returns FNV-1a hash

paper.text puts the 24 px glyph cell at (x, y). Newlines advance by 36 and reset
x to the text call's start. scale is accepted but ignored. Missing codepoints
use the tofu glyph and advance 24 px.

Samples use only this API and are self-contained ES5:

- 基础卡片; 文字海报; 年度进度; 每周计划; 待办; 月相; 测试图; 点阵图案.

The editor rejects const/let/class, arrow functions, template strings,
async/await, generators, optional chaining, nullish coalescing, browser globals, old paper.*
helpers and text-first paper.text. Script limit is 4096 UTF-8 bytes.

The atlas is a 633-glyph subset: the built-in quote corpus, AirPage UI strings
and ASCII. Other Chinese renders as tofu until the firmware atlas is expanded.
JS 画布 is always portrait; the landscape button is disabled.

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
- fonts/device24.png + device24.json — exported firmware 24 px atlas
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
