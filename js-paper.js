/* js-paper.js — browser-side 1-bit drawing API for T5 AirPage JS Lab.
 *
 * This is intentionally small and monochrome: the panel is 122x250, 1 bpp,
 * 1 = black.  It is not QuickJS and it is not the PaperColor 6-colour API;
 * it is the subset needed to draw a frame and preview exactly what the T5
 * will receive.
 */
(function (global) {
  'use strict';

  const BLACK = 0;
  const WHITE = 1;
  const COLORS = {
    black: BLACK, white: WHITE,
    // PaperColor compatibility; all non-white inks become black on T5.
    yellow: 2, red: 3, blue: 5, green: 6
  };

  const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 48];

  /* Browser-facing font stacks.  In the editor the native AirPage glyph
   * pipeline is installed as a backend; the stacks below are the fallback
   * for standalone use and for mono/kai, which have no native bitmap. */
  const FONT_STACKS = {
    sans:  { label: '黑体', stack: '"T5Sans","PingFang SC","Noto Sans SC","Helvetica Neue",Arial,sans-serif' },
    serif: { label: '宋体', stack: '"T5Serif","Songti SC","Noto Serif SC","Times New Roman",serif' },
    song:  { label: '宋体（兼容）', stack: '"T5Serif","Songti SC","Noto Serif SC","Times New Roman",serif' },
    pixel: { label: '像素 8/10/12', stack: '"T5Pixel8","T5Pixel10","T5Pixel","T5Sans",sans-serif' },
    mono:  { label: '等宽', stack: '"SF Mono","Menlo","Monaco","Cascadia Code",monospace' },
    kai:   { label: '楷体', stack: '"Kaiti SC","STKaiti","T5Serif","Noto Serif SC",serif' }
  };
  const FONT_ALIASES = {
    system: 'sans', sans: 'sans', serif: 'serif', song: 'song',
    pixel: 'pixel', mono: 'mono', kai: 'kai'
  };
  const FONTS = {};
  Object.keys(FONT_STACKS).forEach(function (name) {
    FONTS[name] = {
      name: name,
      label: FONT_STACKS[name].label,
      sizes: name === 'pixel' ? [8, 10, 12] : FONT_SIZES.slice()
    };
  });

  let typeBackend = null;

  function setTypeBackend(backend) {
    typeBackend = (backend && typeof backend.draw === 'function' &&
      typeof backend.measure === 'function') ? backend : null;
  }

  function fontFamily(name) {
    const key = String(name === undefined || name === null ? '' : name).toLowerCase();
    return FONT_ALIASES[key] || 'sans';
  }

  function pixelSize(px) {
    return px <= 8 ? 8 : px <= 10 ? 10 : 12;
  }

  function fontSpec(name, px, weight) {
    const fam = fontFamily(name);
    const size = fam === 'pixel'
      ? pixelSize(Math.max(1, Math.round(px)))
      : Math.max(1, Math.round(px));
    const prefix = Number(weight) >= 600 ? '700 ' : '';
    if (fam === 'pixel') {
      const face = size === 8 ? 'T5Pixel8' : size === 10 ? 'T5Pixel10' : 'T5Pixel';
      return prefix + size + 'px "' + face + '","T5Sans",sans-serif';
    }
    return prefix + size + 'px ' + FONT_STACKS[fam].stack;
  }

  function makeFont(input, family, weight) {
    let size = 12, fam = 'sans', wt = 400;
    if (input && typeof input === 'object') {
      const nested = (input.font && typeof input.font === 'object') ? input.font : null;
      size = input.size !== undefined ? input.size
        : (input.fontSize !== undefined ? input.fontSize
        : (input.scale !== undefined ? input.scale
        : (nested && nested.size !== undefined ? nested.size : size)));
      fam = nested ? nested.family : (input.font || input.family || fam);
      wt = input.weight !== undefined ? input.weight
        : (nested && nested.weight !== undefined ? nested.weight : wt);
    } else if (typeof input === 'number') {
      size = input;
    } else if (typeof input === 'string') {
      fam = input;
    }
    if (family !== undefined && family !== null) fam = family;
    if (weight !== undefined && weight !== null) wt = weight;
    fam = fontFamily(fam);
    size = Math.max(1, Math.round(Number(size) || 12));
    if (fam === 'pixel') size = pixelSize(size);
    wt = Number(wt) || 400;
    return {
      size: size,
      family: fam,
      name: fam,
      weight: wt,
      label: FONT_STACKS[fam].label,
      css: fontSpec(fam, size, wt),
      lineHeight: Math.max(1, Math.round(size * 1.4))
    };
  }

  function canNative(font) {
    if (!typeBackend || font.family === 'mono' || font.family === 'kai') return false;
    try {
      return typeBackend.supports ? typeBackend.supports(font.family) !== false : true;
    } catch (e) {
      return false;
    }
  }

  function createPaper(width, height) {
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    const bits = new Uint8Array(w * h); // 0 = paper/white, 1 = ink/black
    let fillStyle = BLACK;
    let strokeStyle = BLACK;
    let path = [];
    let pathClosed = false;

    const textCanvas = document.createElement('canvas');
    textCanvas.width = w;
    textCanvas.height = h;
    const textCtx = textCanvas.getContext('2d', { willReadFrequently: true });

    function inkBit(ink) {
      if (typeof ink === 'string') {
        const s = ink.trim().toLowerCase();
        if (s === 'white' || s === '#fff' || s === '#ffffff' || s === 'rgb(255,255,255)') return 0;
        return 1;
      }
      return Number(ink) === WHITE ? 0 : 1;
    }

    function inBounds(x, y) {
      return x >= 0 && y >= 0 && x < w && y < h;
    }

    function setPixel(x, y, ink) {
      x = Math.round(x); y = Math.round(y);
      if (!inBounds(x, y)) return;
      bits[y * w + x] = inkBit(ink);
    }

    function getPixel(x, y) {
      x = Math.round(x); y = Math.round(y);
      if (!inBounds(x, y)) return WHITE;
      return bits[y * w + x] ? BLACK : WHITE;
    }

    function clear(ink) {
      bits.fill(inkBit(ink === undefined ? WHITE : ink));
    }

    function drawLine(x0, y0, x1, y1, ink) {
      x0 = Math.round(x0); y0 = Math.round(y0);
      x1 = Math.round(x1); y1 = Math.round(y1);
      const b = inkBit(ink === undefined ? strokeStyle : ink);
      const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
      const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        if (inBounds(x0, y0)) bits[y0 * w + x0] = b;
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }

    function drawRect(x, y, rw, rh, ink) {
      const c = ink === undefined ? strokeStyle : ink;
      rw = Math.round(rw); rh = Math.round(rh);
      if (rw <= 0 || rh <= 0) return;
      drawLine(x, y, x + rw - 1, y, c);
      drawLine(x, y + rh - 1, x + rw - 1, y + rh - 1, c);
      drawLine(x, y, x, y + rh - 1, c);
      drawLine(x + rw - 1, y, x + rw - 1, y + rh - 1, c);
    }

    function fillRect(x, y, rw, rh, ink) {
      const b = inkBit(ink === undefined ? fillStyle : ink);
      const x0 = Math.max(0, Math.round(x));
      const y0 = Math.max(0, Math.round(y));
      const x1 = Math.min(w, Math.round(x + rw));
      const y1 = Math.min(h, Math.round(y + rh));
      for (let yy = y0; yy < y1; yy++) {
        const row = yy * w;
        bits.fill(b, row + x0, row + x1);
      }
    }

    function clearRect(x, y, rw, rh) {
      fillRect(x, y, rw, rh, WHITE);
    }

    function drawCircle(cx, cy, r, ink) {
      const c = ink === undefined ? strokeStyle : ink;
      let x = Math.round(r), y = 0, err = 1 - x;
      while (x >= y) {
        setPixel(cx + x, cy + y, c); setPixel(cx + y, cy + x, c);
        setPixel(cx - y, cy + x, c); setPixel(cx - x, cy + y, c);
        setPixel(cx - x, cy - y, c); setPixel(cx - y, cy - x, c);
        setPixel(cx + y, cy - x, c); setPixel(cx + x, cy - y, c);
        y++;
        if (err < 0) err += 2 * y + 1;
        else { x--; err += 2 * (y - x) + 1; }
      }
    }

    function fillCircle(cx, cy, r, ink) {
      const b = inkBit(ink === undefined ? fillStyle : ink);
      const rr = Math.max(0, Math.round(r));
      for (let dy = -rr; dy <= rr; dy++) {
        const dx = Math.floor(Math.sqrt(rr * rr - dy * dy));
        const yy = Math.round(cy + dy);
        if (yy < 0 || yy >= h) continue;
        const x0 = Math.max(0, Math.round(cx - dx));
        const x1 = Math.min(w, Math.round(cx + dx + 1));
        if (x1 > x0) bits.fill(b, yy * w + x0, yy * w + x1);
      }
    }

    function beginPath() { path = []; pathClosed = false; }
    function moveTo(x, y) { path.push([Math.round(x), Math.round(y)]); }
    function lineTo(x, y) {
      if (path.length === 0) path.push([Math.round(x), Math.round(y)]);
      else path.push([Math.round(x), Math.round(y)]);
    }
    function closePath() {
      if (path.length > 0) {
        path.push([path[0][0], path[0][1]]);
        pathClosed = true;
      }
    }
    function arc(cx, cy, r, a0, a1, ccw) {
      const span = (a1 - a0);
      const segs = Math.max(8, Math.min(360, Math.ceil(Math.abs(span) * Math.max(1, r) / 2)));
      const start = path.length ? path[path.length - 1] : [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r];
      if (!path.length) path.push([Math.round(start[0]), Math.round(start[1])]);
      for (let i = 1; i <= segs; i++) {
        const a = a0 + span * i / segs;
        path.push([Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)]);
      }
      if (ccw) path.reverse();
    }
    function stroke() {
      if (path.length < 2) return;
      for (let i = 1; i < path.length; i++) {
        drawLine(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1], strokeStyle);
      }
    }
    function fill() {
      if (path.length < 3) return;
      const pts = path;
      let minY = Infinity, maxY = -Infinity;
      for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
      const y0 = Math.max(0, Math.ceil(minY));
      const y1 = Math.min(h - 1, Math.floor(maxY));
      const b = inkBit(fillStyle);
      for (let y = y0; y <= y1; y++) {
        const xs = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], c = pts[(i + 1) % pts.length];
          if ((a[1] <= y && c[1] > y) || (c[1] <= y && a[1] > y)) {
            xs.push(a[0] + (y - a[1]) * (c[0] - a[0]) / (c[1] - a[1]));
          }
        }
        xs.sort((p, q) => p - q);
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const xa = Math.max(0, Math.ceil(xs[i]));
          const xb = Math.min(w - 1, Math.floor(xs[i + 1]));
          if (xb >= xa) bits.fill(b, y * w + xa, y * w + xb + 1);
        }
      }
    }

    let currentFont = makeFont(12, 'sans');

    function fontOf(input) {
      if (input === undefined || input === null) return currentFont;
      if (typeof input === 'number') return makeFont(input, currentFont.family, currentFont.weight);
      if (typeof input === 'string') return makeFont(currentFont.size, input, currentFont.weight);
      if (input && typeof input === 'object') {
        const nested = (input.font && typeof input.font === 'object') ? input.font : null;
        const size = input.size !== undefined ? input.size
          : (input.fontSize !== undefined ? input.fontSize
          : (input.scale !== undefined ? input.scale
          : (nested && nested.size !== undefined ? nested.size : currentFont.size)));
        const fam = nested ? nested.family
          : (input.font || input.family || input.name || currentFont.family);
        const wt = input.weight !== undefined ? input.weight
          : (nested && nested.weight !== undefined ? nested.weight : currentFont.weight);
        return makeFont(size, fam, wt);
      }
      return currentFont;
    }

    function measureLine(value, font) {
      const s = String(value === undefined || value === null ? '' : value);
      if (canNative(font)) {
        try {
          const m = typeBackend.measure(s, font.size, font.family);
          if (m) {
            const asc = Math.ceil(m.ascender !== undefined ? m.ascender : (m.baseline !== undefined ? m.baseline : font.size * 0.8));
            const dsc = Math.ceil(m.descender !== undefined ? m.descender : font.size * 0.2);
            const height = Math.ceil(m.height !== undefined ? m.height : asc + dsc);
            return {
              width: Math.ceil(m.width || 0), height: Math.max(1, height),
              ascender: Math.max(1, asc), descender: Math.max(0, dsc), baseline: Math.max(1, asc)
            };
          }
        } catch (e) { /* fall through to Canvas */ }
      }
      textCtx.save();
      textCtx.font = font.css;
      const m = textCtx.measureText(s);
      textCtx.restore();
      let asc = (m.fontBoundingBoxAscent !== undefined) ? Math.ceil(m.fontBoundingBoxAscent) : Math.ceil(font.size * 0.8);
      let dsc = (m.fontBoundingBoxDescent !== undefined) ? Math.ceil(m.fontBoundingBoxDescent) : Math.ceil(font.size * 0.2);
      if (!isFinite(asc) || asc <= 0) asc = Math.ceil(font.size * 0.8);
      if (!isFinite(dsc) || dsc < 0) dsc = Math.ceil(font.size * 0.2);
      return {
        width: Math.ceil(m.width || 0), height: Math.max(1, asc + dsc),
        ascender: asc, descender: dsc, baseline: asc
      };
    }

    function lineHeightOf(opts, font) {
      const v = Number(opts && opts.lineHeight);
      if (v > 0) return Math.max(1, Math.round(v <= 4 ? font.size * v : v));
      return Math.max(1, Math.round(font.size * 1.4));
    }

    function splitLines(value, maxWidth, font) {
      const out = [];
      const raw = String(value === undefined || value === null ? '' : value).split('\n');
      for (const para of raw) {
        if (!para) { out.push(''); continue; }
        if (!(maxWidth > 0)) { out.push(para); continue; }
        let line = '';
        for (const ch of Array.from(para)) {
          const test = line + ch;
          if (line && measureLine(test, font).width > maxWidth) {
            out.push(line);
            line = ch;
          } else {
            line = test;
          }
        }
        out.push(line);
      }
      return out.length ? out : [''];
    }

    function ellipsisLine(line, maxWidth, font, mark) {
      mark = mark || '…';
      if (!(maxWidth > 0) || measureLine(line, font).width <= maxWidth) return line;
      let s = String(line);
      while (s && measureLine(s + mark, font).width > maxWidth) s = s.slice(0, -1);
      return s ? s + mark : '';
    }

    function truncateLine(line, maxWidth, font, mark) {
      mark = mark || '…';
      if (!(maxWidth > 0)) return String(line) + mark;
      let s = String(line);
      while (s && measureLine(s + mark, font).width > maxWidth) s = s.slice(0, -1);
      return s ? s + mark : (measureLine(mark, font).width <= maxWidth ? mark : '');
    }

    function limitLines(lines, maxLines, maxWidth, font, ellipsis) {
      if (!(maxLines > 0) || lines.length <= maxLines) return lines;
      const out = lines.slice(0, maxLines);
      if (ellipsis !== false) out[out.length - 1] = truncateLine(out[out.length - 1], maxWidth, font);
      return out;
    }

    function metricsOf(lines, font, lh) {
      let width = 0, asc = 0, desc = 0;
      for (const line of lines) {
        const m = measureLine(line, font);
        if (m.width > width) width = m.width;
        if (m.ascender > asc) asc = m.ascender;
        if (m.descender > desc) desc = m.descender;
      }
      return {
        width: width, height: Math.max(1, lines.length * lh), lineHeight: lh,
        ascender: asc, descender: desc, baseline: asc
      };
    }

    function drawOneLine(value, x, top, ink, font, align) {
      const m = measureLine(value, font);
      let dx = x;
      if (align === 'center') dx = x - m.width / 2;
      else if (align === 'right') dx = x - m.width;
      textCtx.clearRect(0, 0, w, h);
      let painted = false;
      if (canNative(font)) {
        try {
          textCtx.save();
          typeBackend.draw(textCtx, value, Math.round(dx), Math.round(top), font.size, font.family);
          textCtx.restore();
          painted = true;
        } catch (e) {
          try { textCtx.restore(); } catch (e2) {}
        }
      }
      if (!painted) {
        textCtx.save();
        textCtx.font = font.css;
        textCtx.textAlign = 'left';
        textCtx.textBaseline = 'top';
        textCtx.fillStyle = '#000';
        textCtx.fillText(value, Math.round(dx), Math.round(top));
        textCtx.restore();
      }
      const data = textCtx.getImageData(0, 0, w, h).data;
      const b = inkBit(ink);
      for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] > 96) bits[i] = b;
    }

    function topOf(y, height, baseline, ascender) {
      const b = String(baseline || 'top').toLowerCase();
      if (b === 'middle' || b === 'center') return y - height / 2;
      if (b === 'bottom') return y - height;
      if (b === 'alphabetic' || b === 'baseline') return y - ascender;
      return y;
    }

    function renderText(value, x, y, opts) {
      opts = opts || {};
      const font = fontOf(opts);
      const align = opts.align || 'left';
      const maxWidth = Number(opts.width !== undefined ? opts.width : opts.maxWidth) || 0;
      let lines = splitLines(value, maxWidth, font);
      const maxLines = Number(opts.maxLines) > 0 ? Math.floor(Number(opts.maxLines)) : 0;
      lines = limitLines(lines, maxLines, maxWidth, font, opts.ellipsis);
      const lh = lineHeightOf(opts, font);
      const m = metricsOf(lines, font, lh);
      const top = topOf(Number(y) || 0, m.height, opts.baseline, m.ascender);
      const ink = opts.ink === undefined ? BLACK : opts.ink;
      for (let i = 0; i < lines.length; i++) {
        drawOneLine(lines[i], Number(x) || 0, top + i * lh, ink, font, align);
      }
      m.lines = lines;
      m.font = font;
      return m;
    }

    function measure(value, opts) {
      opts = opts || {};
      const font = fontOf(opts);
      const maxWidth = Number(opts.width !== undefined ? opts.width : opts.maxWidth) || 0;
      let lines = splitLines(value, maxWidth, font);
      const maxLines = Number(opts.maxLines) > 0 ? Math.floor(Number(opts.maxLines)) : 0;
      lines = limitLines(lines, maxLines, maxWidth, font, opts.ellipsis);
      const lh = lineHeightOf(opts, font);
      const m = metricsOf(lines, font, lh);
      m.lines = lines;
      m.font = font;
      return m;
    }

    function drawTextEx(x, y, value, ink, fontSize, fontName) {
      if (fontSize && typeof fontSize === 'object') {
        const o = {};
        for (const k in fontSize) o[k] = fontSize[k];
        if (o.ink === undefined) o.ink = ink;
        if (!o.baseline) o.baseline = 'top';
        return renderText(value, x, y, o);
      }
      return renderText(value, x, y, {
        size: fontSize === undefined ? 12 : fontSize,
        font: fontName || 'sans',
        ink: ink,
        baseline: 'top'
      });
    }

    function drawText(x, y, value, ink, scale) {
      const s = Number(scale) || 1;
      return drawTextEx(x, y, value, ink, Math.max(1, Math.round(12 * s)), 'sans');
    }

    function text(a, b, c, d, e) {
      if (typeof a === 'string') return renderText(a, b, c, d);
      if (a && typeof a === 'object') {
        return renderText(a.text === undefined ? '' : a.text,
          a.x === undefined ? 0 : a.x, a.y === undefined ? 0 : a.y, a);
      }
      return drawText(a, b, c, d, e);
    }

    function measureText(value, fontName, fontSize) {
      if (fontName && typeof fontName === 'object') return measure(value, fontName);
      if (typeof fontName === 'number') return measure(value, { size: fontName, font: fontSize });
      return measure(value, {
        font: fontName || 'sans',
        size: fontSize === undefined ? 12 : fontSize
      });
    }

    function wrapText(value, maxWidth, opts) {
      if (typeof opts === 'number') opts = { size: opts };
      else if (typeof opts === 'string') opts = { font: opts };
      else if (!opts) opts = {};
      return splitLines(value, Math.max(0, Number(maxWidth) || 0), fontOf(opts));
    }

    function fitText(value, maxWidth, opts) {
      if (typeof opts === 'number') opts = { size: opts };
      else if (typeof opts === 'string') opts = { font: opts };
      else if (!opts) opts = {};
      const font = fontOf(opts);
      let s = String(value === undefined || value === null ? '' : value);
      if (measureLine(s, font).width <= maxWidth) return s;
      const mark = opts.ellipsisText || '…';
      while (s && measureLine(s + mark, font).width > maxWidth) s = s.slice(0, -1);
      return s ? s + mark : '';
    }

    function textBox(value, x, y, bw, bh, opts) {
      opts = opts || {};
      const font = fontOf(opts);
      const bwv = Math.max(1, Number(bw) || 0);
      const bhv = Math.max(1, Number(bh) || 0);
      const lh = lineHeightOf(opts, font);
      const maxLines = Math.max(1, Math.floor(bhv / lh));
      let lines = splitLines(value, bwv, font);
      lines = limitLines(lines, maxLines, bwv, font, opts.ellipsis);
      const m = metricsOf(lines, font, lh);
      let top = Number(y) || 0;
      const valign = String(opts.valign || 'top').toLowerCase();
      if (valign === 'middle' || valign === 'center') top += (bhv - m.height) / 2;
      else if (valign === 'bottom') top += bhv - m.height;
      const ink = opts.ink === undefined ? BLACK : opts.ink;
      for (let i = 0; i < lines.length; i++) {
        drawOneLine(lines[i], Number(x) || 0, top + i * lh, ink, font, opts.align || 'left');
      }
      m.lines = lines;
      m.font = font;
      m.top = top;
      return m;
    }

    function drawTextBox(x, y, bw, bh, value, ink, opts) {
      const o = {};
      if (opts) for (const k in opts) o[k] = opts[k];
      o.ink = ink;
      if (o.lineHeight !== undefined) {
        const n = Number(o.lineHeight);
        if (n > 4) o.lineHeight = n / 100;
      }
      return textBox(value, x, y, bw, bh, o);
    }

    function font(sizeOrOptions, family) {
      return makeFont(sizeOrOptions, family);
    }

    function setFont(sizeOrOptions, family) {
      currentFont = makeFont(sizeOrOptions, family);
      return currentFont;
    }

    function commit() { /* the app packs the buffer after the script returns */ }
    function log(msg) { if (global.console) console.log('[paper]', msg); }

    const api = {
      size: { width: w, height: h },
      colors: COLORS,
      width: w,
      height: h,
      clear: clear,
      setPixel: setPixel,
      getPixel: getPixel,
      drawLine: drawLine,
      line: drawLine,
      drawRect: drawRect,
      rect: drawRect,
      fillRect: fillRect,
      clearRect: clearRect,
      strokeRect: drawRect,
      drawCircle: drawCircle,
      circle: drawCircle,
      fillCircle: fillCircle,
      beginPath: beginPath,
      closePath: closePath,
      moveTo: moveTo,
      lineTo: lineTo,
      arc: arc,
      stroke: stroke,
      fill: fill,
      drawText: drawText,
      drawTextEx: drawTextEx,
      text: text,
      measure: measure,
      measureText: measureText,
      wrapText: wrapText,
      fitText: fitText,
      textBox: textBox,
      drawTextBox: drawTextBox,
      font: font,
      setFont: setFont,
      getFont: function () { return currentFont; },
      fonts: FONTS,
      fontSizes: FONT_SIZES,
      commit: commit,
      log: log,
      getBits: function () { return bits; },
      renderTo: function (canvas) {
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        const id = ctx.createImageData(w, h);
        for (let i = 0; i < bits.length; i++) {
          const v = bits[i] ? 0 : 255;
          id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
          id.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(id, 0, 0);
      },
      // timers are deliberately no-ops: one JS run produces one static frame
      setTimeout: function () { return 0; },
      setInterval: function () { return 0; },
      clearTimeout: function () {},
      clearInterval: function () {},
      store: function (k, v) { try { localStorage.setItem('t5js:' + k, JSON.stringify(v)); } catch (e) {} },
      load: function (k) { try { const v = localStorage.getItem('t5js:' + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
    };
    Object.defineProperty(api, 'currentFont', {
      get: function () { return currentFont; }
    });
    Object.defineProperty(api, 'nativeText', {
      get: function () { return !!typeBackend; }
    });
    Object.defineProperty(api, 'fillStyle', {
      get: function () { return fillStyle; },
      set: function (v) { fillStyle = v; }
    });
    Object.defineProperty(api, 'strokeStyle', {
      get: function () { return strokeStyle; },
      set: function (v) { strokeStyle = v; }
    });
    api.clear(WHITE);
    return api;
  }

  const samples = {
    poster: {
      name: '文字海报 · JS',
      code: `var C = paper.colors;
var W = paper.size.width, H = paper.size.height;
var land = W > H;
var m = land ? 8 : 7;
var q = "把时间浪费在美好的事物上。";
var size = land ? 18 : 22;
var boxW = W - 2 * m - 16;
var lines = [];
var line = "";
for (var i = 0; i < q.length; i++) {
  var ch = q.charAt(i);
  if (line && paper.measureText(line + ch, "song", size).width > boxW) {
    lines.push(line);
    line = ch;
  } else {
    line += ch;
  }
}
if (line) lines.push(line);
var lh = Math.round(size * 1.45);
var footerY = H - (land ? 22 : 38);
var bodyTop = land ? 34 : 52;
var blockH = lines.length * lh;
var y0 = bodyTop + Math.max(0, (footerY - 8 - bodyTop - blockH) / 2);
paper.clear(C.white);
paper.drawRect(m, m, W - 2 * m, H - 2 * m, C.black);
paper.drawTextEx(m + 4, m + 2, "“", C.black, land ? 28 : 24, "serif");
for (var j = 0; j < lines.length; j++) {
  paper.drawTextEx(m + 8, y0 + j * lh, lines[j], C.black, size, "song");
}
paper.drawLine(m + 8, footerY - 8, m + 34, footerY - 8, C.black);
paper.drawTextEx(m + 8, footerY - 6, "— AirPage", C.black, 9, "song");
paper.commit();`
    },
    year: {
      name: '年度进度 · JS',
      code: `var C = paper.colors;
var W = paper.size.width, H = paper.size.height;
var land = W > H;
var now = new Date();
var y = now.getFullYear();
var start = new Date(y, 0, 1);
var end = new Date(y + 1, 0, 1);
var pct = Math.max(0, Math.min(1, (now - start) / (end - start)));
var days = Math.max(0, Math.ceil((end - now) / 86400000));
var p = Math.floor(pct * 100);
var m = land ? 9 : 10;
paper.clear(C.white);
paper.drawTextEx(m, 8, "YEAR " + y, C.black, 10, "mono");
var ptxt = p + "%";
var psize = land ? 44 : 52;
while (psize > 24 && paper.measureText(ptxt, "mono", psize).width > W - 2 * m) psize -= 4;
paper.drawTextEx(m, land ? 26 : 42, ptxt, C.black, psize, "mono");
paper.drawTextEx(m, land ? 82 : 106, "今年已过", C.black, 10, "sans");
var by = land ? 94 : 152;
var bw = W - 2 * m, bh = 8;
paper.drawRect(m, by, bw, bh, C.black);
paper.fillRect(m + 2, by + 2, Math.max(0, (bw - 4) * pct), bh - 4, C.black);
paper.drawTextEx(m, by + 12, "还剩 " + days + " 天", C.black, 10, "sans");
if (!land) {
  for (var i = 1; i < 12; i++) {
    var x = m + bw * i / 12;
    paper.drawLine(x, 190, x, i % 3 === 0 ? 198 : 194, C.black);
  }
  paper.drawTextEx(m, 208, "JFMAMJJASOND", C.black, 8, "mono");
}
paper.commit();`
    },
    week: {
      name: '每周计划 · JS',
      code: `var C = paper.colors;
var W = paper.size.width, H = paper.size.height;
var land = W > H;
var m = 8;
var days = ["一", "二", "三", "四", "五", "六", "日"];
var tasks = ["晨间计划", "深度工作", "运动 30 分钟", "阅读 20 页", "复盘", "留白", "休息"];
var now = new Date();
var mon = new Date(now.getFullYear(), now.getMonth(), now.getDate());
mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
var sun = new Date(mon);
sun.setDate(mon.getDate() + 6);
function p2(n) { return (n < 10 ? "0" : "") + n; }
var range = p2(mon.getMonth() + 1) + "." + p2(mon.getDate()) + "—" + p2(sun.getMonth() + 1) + "." + p2(sun.getDate());
function right(t, y, size, font) {
  var tw = paper.measureText(t, font, size).width;
  paper.drawTextEx(W - m - tw, y, t, C.black, size, font);
}
function fit(t, max, size, font) {
  if (paper.measureText(t, font, size).width <= max) return t;
  while (t.length > 1 && paper.measureText(t + "…", font, size).width > max) t = t.slice(0, -1);
  return t + "…";
}
paper.clear(C.white);
paper.drawTextEx(m, 8, "WEEK", C.black, land ? 16 : 20, "sans");
right(range, land ? 10 : 34, 9, "mono");
var lineY = land ? 32 : 48;
paper.drawLine(m, lineY, W - m, lineY, C.black);
if (land) {
  paper.drawLine(124, 36, 124, H - 10, C.black);
  for (var i = 0; i < 7; i++) {
    var col = i < 4 ? 0 : 1;
    var row = i < 4 ? i : i - 4;
    var x = col ? 130 : m;
    var y = 40 + row * 20;
    var box = 7;
    paper.drawRect(x, y + 1, box, box, C.black);
    paper.drawTextEx(x + box + 4, y, days[i], C.black, 9, "sans");
    var tx = x + box + 17;
    paper.drawTextEx(tx, y, fit(tasks[i], (col ? W - m : 120) - tx, 9, "song"), C.black, 9, "song");
  }
} else {
  var top = 54;
  var bottom = H - 8;
  var rh = (bottom - top) / 7;
  var box = 9;
  for (var i = 0; i < 7; i++) {
    var y = top + i * rh;
    paper.drawRect(m, y + 2, box, box, C.black);
    paper.drawTextEx(m + box + 5, y + 1, days[i], C.black, 12, "sans");
    var tx = m + box + 18;
    paper.drawTextEx(tx, y + 1, fit(tasks[i], W - m - tx, 12, "song"), C.black, 12, "song");
    if (i < 6) {
      var sy = Math.round(y + rh) - 1;
      paper.drawLine(m, sy, W - m, sy, C.black);
    }
  }
}
paper.commit();`
    },
    todo: {
      name: '待办清单 · JS',
      code: `var C = paper.colors;
var W = paper.size.width, H = paper.size.height;
var land = W > H;
var m = 8;
var items = [
  ["回复邮件", true],
  ["整理桌面", false],
  ["读 20 页书", false],
  ["散步 30 分钟", true],
  ["写日记", false],
  ["早点睡", false]
];
var done = 0;
for (var d = 0; d < items.length; d++) if (items[d][1]) done++;
function p2(n) { return (n < 10 ? "0" : "") + n; }
var now = new Date();
var date = now.getFullYear() + "-" + p2(now.getMonth() + 1) + "-" + p2(now.getDate());
function right(t, y, size, font) {
  var tw = paper.measureText(t, font, size).width;
  paper.drawTextEx(W - m - tw, y, t, C.black, size, font);
}
function fit(t, max, size, font) {
  if (paper.measureText(t, font, size).width <= max) return t;
  while (t.length > 1 && paper.measureText(t + "…", font, size).width > max) t = t.slice(0, -1);
  return t + "…";
}
paper.clear(C.white);
paper.drawTextEx(m, 8, "TO DO", C.black, land ? 18 : 20, "sans");
if (land) right(date, 10, 9, "mono");
else paper.drawTextEx(m, 34, date, C.black, 9, "mono");
paper.drawLine(m, land ? 32 : 48, W - m, land ? 32 : 48, C.black);
if (land) {
  for (var i = 0; i < 6; i++) {
    var col = i < 3 ? 0 : 1;
    var row = i < 3 ? i : i - 3;
    var x = col ? 128 : m;
    var y = 38 + row * 24;
    var box = 8;
    paper.drawRect(x, y, box, box, C.black);
    if (items[i][1]) {
      paper.drawLine(x + 2, y + 4, x + 4, y + 7, C.black);
      paper.drawLine(x + 4, y + 7, x + 8, y + 2, C.black);
    }
    var max = (col ? W - x : 120 - x) - 14;
    paper.drawTextEx(x + 12, y, fit(items[i][0], max, 9, "song"), C.black, 9, "song");
  }
} else {
  for (var i = 0; i < 6; i++) {
    var y = 56 + i * 30;
    paper.drawRect(10, y, 10, 10, C.black);
    if (items[i][1]) {
      paper.drawLine(12, y + 5, 14, y + 8, C.black);
      paper.drawLine(14, y + 8, 19, y + 2, C.black);
    }
    paper.drawTextEx(26, y, fit(items[i][0], W - 34, 12, "song"), C.black, 12, "song");
    if (i < 5) paper.drawLine(10, y + 27, W - 10, y + 27, C.black);
  }
}
paper.commit();`
    },
    countdown: {
      name: '倒计时 · JS',
      code: `var C = paper.colors;
var W = paper.size.width, H = paper.size.height;
var land = W > H;
var target = new Date(2027, 0, 1);
var now = new Date();
var ms = target - now;
var done = ms <= 0;
if (done) ms = 0;
var days = Math.floor(ms / 86400000);
var hours = Math.floor((ms % 86400000) / 3600000);
function p2(n) { return (n < 10 ? "0" : "") + n; }
var date = target.getFullYear() + "-" + p2(target.getMonth() + 1) + "-" + p2(target.getDate());
function center(t, y, size, font) {
  var tw = paper.measureText(t, font, size).width;
  paper.drawTextEx((W - tw) / 2, y, t, C.black, size, font);
}
paper.clear(C.white);
if (land) {
  paper.drawTextEx(8, 8, "COUNTDOWN", C.black, 10, "sans");
  paper.drawTextEx(8, 20, "NEW YEAR", C.black, 12, "song");
  paper.drawTextEx(8, 36, done ? "0" : String(days), C.black, 40, "mono");
  paper.drawTextEx(8, 88, "DAYS", C.black, 10, "sans");
  paper.drawLine(120, 14, 120, H - 12, C.black);
  paper.drawTextEx(132, 34, date, C.black, 10, "mono");
  paper.drawTextEx(132, 56, done ? "已到达" : hours + " 小时后", C.black, 10, "sans");
  paper.drawTextEx(132, 80, "把等待变成期待", C.black, 10, "song");
} else {
  center("COUNTDOWN", 16, 10, "sans");
  center("NEW YEAR", 32, 12, "song");
  center(done ? "0" : String(days), 70, 56, "mono");
  center("DAYS", 144, 10, "sans");
  paper.drawLine(24, 158, W - 24, 158, C.black);
  center(date, 174, 10, "mono");
  center(done ? "已到达" : hours + " 小时后", 194, 10, "sans");
  center("把等待变成期待", 214, 10, "song");
}
paper.commit();`
    },
    moon: {
      name: '月相 · JS',
      code: `var C = paper.colors;
var W = paper.size.width, H = paper.size.height;
var land = W > H;
var known = Date.UTC(2000, 0, 6, 18, 14);
var syn = 29.53058867 * 86400000;
var now = new Date();
var p = ((now.getTime() - known) % syn) / syn;
if (p < 0) p += 1;
var cx = land ? 56 : W / 2;
var cy = land ? 64 : 108;
var r = land ? 34 : 42;
var sunX = Math.sin(p * Math.PI * 2);
var sunZ = -Math.cos(p * Math.PI * 2);
paper.clear(C.white);
paper.drawTextEx(8, 8, "MOON PHASE", C.black, 10, "sans");
for (var y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
  for (var x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    var nx = (x + 0.5 - cx) / r;
    var ny = (y + 0.5 - cy) / r;
    var rr = nx * nx + ny * ny;
    if (rr > 1) continue;
    var nz = Math.sqrt(1 - rr);
    if (nx * sunX + nz * sunZ > 0) paper.setPixel(x, y, C.black);
  }
}
paper.drawCircle(cx, cy, r, C.black);
var label = (p < 0.03 || p > 0.97) ? "新月" : (p < 0.47 ? "上弦" : (p < 0.53 ? "满月" : "下弦"));
function p2(n) { return (n < 10 ? "0" : "") + n; }
var date = now.getFullYear() + "-" + p2(now.getMonth() + 1) + "-" + p2(now.getDate());
if (land) {
  paper.drawTextEx(104, 36, label, C.black, 24, "song");
  paper.drawTextEx(104, 62, date, C.black, 10, "mono");
  paper.drawTextEx(104, 86, "抬头看看月亮", C.black, 10, "song");
} else {
  function center(t, y, size, font) {
    var tw = paper.measureText(t, font, size).width;
    paper.drawTextEx((W - tw) / 2, y, t, C.black, size, font);
  }
  center(label, 174, 24, "song");
  center(date, 198, 10, "mono");
  center("抬头看看月亮", 220, 10, "song");
}
paper.commit();`
    },
    test: {
      name: '测试图 · JS',
      code: `var C = paper.colors;
var W = paper.size.width, H = paper.size.height;
var land = W > H;
function center(t, y, size, font) {
  var tw = paper.measureText(t, font, size).width;
  paper.drawTextEx((W - tw) / 2, y, t, C.black, size, font);
}
paper.clear(C.white);
paper.drawRect(1, 1, W - 2, H - 2, C.black);
paper.drawRect(2, 2, W - 4, H - 4, C.black);
for (var i = 0; i <= 10; i++) {
  var x = 6 + i * (W - 12) / 10;
  var y = 6 + i * (H - 12) / 10;
  paper.drawLine(x, 4, x, H - 4, C.black);
  paper.drawLine(4, y, W - 4, y, C.black);
}
var bh = land ? 48 : 56;
var by = Math.round(H / 2) - (land ? 24 : 28);
paper.fillRect(8, by, W - 16, bh, C.white);
paper.drawRect(8, by, W - 16, bh, C.black);
center("TOP", 8, 10, "sans");
center("BOTTOM", H - 18, 10, "sans");
center("T5 " + W + "x" + H, H / 2 - 8, land ? 16 : 9, "sans");
center("1-bit BLE test", H / 2 + (land ? 14 : 12), 9, "mono");
paper.commit();`
    },
    hello: {
      name: '基础图形',
      code: `var C = paper.colors;
var W = paper.size.width, H = paper.size.height;
var land = W > H;
paper.clear(C.white);
paper.fillRect(0, 0, W, 6, C.black);
var titleFont = paper.font(land ? 18 : 20, "sans");
paper.text("T5 AirPage", 8, land ? 14 : 18, { font: titleFont });
paper.text("JS canvas", 8, land ? 38 : 44, { size: 10, font: "sans" });
var lineY = land ? 52 : 60;
paper.drawLine(8, lineY, W - 8, lineY, C.black);
var cy = land ? 72 : 98;
var r = land ? 10 : 18;
paper.fillCircle(30, cy, r, C.black);
paper.drawCircle(74, cy, r, C.black);
var by = land ? H - 30 : H - 44;
var bh = land ? 22 : 30;
paper.drawRect(8, by, W - 16, bh, C.black);
if (land) {
  paper.text("122 × 250 · 1-bit", 14, by + 6, { size: 8, font: "mono" });
} else {
  paper.text("122 × 250", 14, by + 3, { size: 9, font: "mono" });
  paper.text("1-bit", 14, by + 15, { size: 8, font: "mono" });
}
paper.commit();`
    },
    clock: {
      name: '当前时间',
      code: `var C = paper.colors;
var W = paper.size.width, H = paper.size.height;
var land = W > H;
var now = new Date();
function p2(n) { return (n < 10 ? "0" : "") + n; }
var hhmm = p2(now.getHours()) + ":" + p2(now.getMinutes());
var date = now.getFullYear() + "-" + p2(now.getMonth() + 1) + "-" + p2(now.getDate());
paper.clear(C.white);
paper.drawTextEx(8, 8, "LOCAL TIME", C.black, 10, "sans");
paper.drawLine(8, 24, W - 8, 24, C.black);
if (land) {
  paper.drawTextEx(8, 34, hhmm, C.black, 40, "mono");
  paper.drawTextEx(8, 92, date, C.black, 10, "mono");
  paper.drawTextEx(8, 108, "静态快照 · Run 更新", C.black, 9, "sans");
} else {
  paper.drawTextEx(8, 48, hhmm, C.black, 32, "mono");
  paper.drawTextEx(8, 100, date, C.black, 10, "mono");
  paper.drawTextEx(8, 122, "静态快照 · Run 更新", C.black, 9, "sans");
}
paper.commit();`
    },
    pattern: {
      name: '点阵图案',
      code: `var C = paper.colors;
var W = paper.size.width, H = paper.size.height;
paper.clear(C.white);
for (var y = 0; y < H; y += 8) {
  for (var x = 0; x < W; x += 8) {
    if (((x / 8) + (y / 8)) % 2 === 0) paper.fillRect(x, y, 4, 4, C.black);
  }
}
paper.fillRect(0, 0, W, 6, C.black);
paper.drawTextEx(8, H - 24, "1-bit pattern", C.black, 11, "mono");
paper.commit();`
    }
  };

  global.T5Paper = {
    create: createPaper,
    samples: samples,
    fontSizes: FONT_SIZES,
    fonts: FONTS,
    setTypeBackend: setTypeBackend,
    BLACK: BLACK,
    WHITE: WHITE,
    colors: COLORS
  };
})(window);
