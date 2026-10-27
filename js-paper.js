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

  const FONT_FAMILIES = {
    system: '"T5Sans","PingFang SC","Noto Sans SC","Helvetica Neue",Arial,sans-serif',
    sans:   '"T5Sans","PingFang SC","Noto Sans SC","Helvetica Neue",Arial,sans-serif',
    serif:  '"T5Serif","Songti SC","Noto Serif SC","Times New Roman",serif',
    song:   '"T5Serif","Songti SC","Noto Serif SC","Times New Roman",serif',
    kai:    '"Kaiti SC","STKaiti","T5Serif","Noto Serif SC",serif',
    mono:   '"SF Mono","Menlo","Monaco","Cascadia Code",monospace'
  };

  function fontSpec(name, px) {
    const family = FONT_FAMILIES[name] || FONT_FAMILIES.sans;
    return Math.max(1, Math.round(px)) + 'px ' + family;
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

    function measureText(text, fontName, fontSize) {
      const px = (fontSize === undefined || fontSize === null) ? 12 : Number(fontSize);
      textCtx.save();
      textCtx.font = fontSpec(fontName || 'sans', px);
      const m = textCtx.measureText(String(text === undefined ? '' : text));
      textCtx.restore();
      const asc = (m.fontBoundingBoxAscent !== undefined)
        ? Math.ceil(m.fontBoundingBoxAscent) : Math.ceil(px * 0.8);
      const dsc = (m.fontBoundingBoxDescent !== undefined)
        ? Math.ceil(m.fontBoundingBoxDescent) : Math.ceil(px * 0.2);
      return {
        width: Math.ceil(m.width || 0),
        height: asc + dsc,
        ascender: asc,
        descender: dsc,
        baseline: asc
      };
    }

    function drawTextEx(x, y, text, ink, fontSize, fontName) {
      text = String(text === undefined || text === null ? '' : text);
      if (!text) return;
      const px = Math.max(1, Math.round(Number(fontSize) || 12));
      const name = fontName || 'sans';
      textCtx.clearRect(0, 0, w, h);
      textCtx.save();
      textCtx.font = fontSpec(name, px);
      textCtx.textAlign = 'left';
      textCtx.textBaseline = 'top';
      textCtx.fillStyle = '#000';
      textCtx.fillText(text, Math.round(x), Math.round(y));
      textCtx.restore();
      const data = textCtx.getImageData(0, 0, w, h).data;
      const b = inkBit(ink);
      for (let i = 0; i < w * h; i++) {
        if (data[i * 4 + 3] > 96) bits[i] = b;
      }
    }

    function drawText(x, y, text, ink, scale) {
      const s = Number(scale) || 1;
      drawTextEx(x, y, text, ink, Math.max(1, Math.round(12 * s)), 'sans');
    }

    function drawTextBox(x, y, bw, bh, text, ink, opts) {
      opts = opts || {};
      const fontName = opts.font || 'sans';
      const fontSize = Number(opts.size || opts.scale || 12);
      const lineHeight = Math.max(fontSize, Math.round(fontSize * (Number(opts.lineHeight) > 0 ? Number(opts.lineHeight) / 100 : 1.25)));
      const align = opts.align || 'left';
      const words = String(text).split('\n');
      let lines = [];
      for (const raw of words) {
        if (!raw) { lines.push(''); continue; }
        let line = '';
        for (const ch of raw) {
          const test = line + ch;
          if (line && measureText(test, fontName, fontSize).width > bw) {
            lines.push(line);
            line = ch;
          } else {
            line = test;
          }
        }
        if (line) lines.push(line);
      }
      const maxLines = Math.max(1, Math.floor(bh / lineHeight));
      lines = lines.slice(0, maxLines);
      lines.forEach((line, i) => {
        let lx = x;
        if (align === 'center') lx = x + (bw - measureText(line, fontName, fontSize).width) / 2;
        if (align === 'right') lx = x + bw - measureText(line, fontName, fontSize).width;
        drawTextEx(lx, y + i * lineHeight, line, ink, fontSize, fontName);
      });
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
      text: drawText,
      drawTextEx: drawTextEx,
      measureText: measureText,
      drawTextBox: drawTextBox,
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
    hello: {
      name: 'Hello · 基本图形',
      code: [
        'var C = paper.colors;',
        'var W = paper.size.width, H = paper.size.height;',
        'paper.clear(C.white);',
        'paper.fillRect(0, 0, W, 8, C.black);',
        'paper.drawTextEx(8, 22, "T5 AirPage", C.black, 20, "sans");',
        'paper.drawTextEx(8, 48, "JS Lab", C.black, 12, "sans");',
        'paper.drawLine(8, 70, W - 8, 70, C.black);',
        'paper.fillCircle(30, 104, 18, C.black);',
        'paper.drawCircle(74, 104, 18, C.black);',
        'paper.drawRect(8, 138, W - 16, 34, C.black);',
        'paper.drawTextEx(14, 148, "122 × 250 · 1-bit", C.black, 11, "sans");',
        'paper.commit();'
      ].join('\n')
    },
    poster: {
      name: '文字海报 · 中文',
      code: [
        'var C = paper.colors;',
        'var W = paper.size.width, H = paper.size.height;',
        'paper.clear(C.white);',
        'paper.drawRect(5, 5, W - 10, H - 10, C.black);',
        'paper.drawTextEx(10, 22, "“", C.black, 22, "serif");',
        'paper.drawTextEx(12, 58, "慢一点，", C.black, 20, "song");',
        'paper.drawTextEx(12, 86, "也是一种", C.black, 20, "song");',
        'paper.drawTextEx(12, 114, "前进。", C.black, 20, "song");',
        'paper.drawLine(12, H - 42, 38, H - 42, C.black);',
        'paper.drawTextEx(12, H - 30, "—— 给今天", C.black, 11, "song");',
        'paper.commit();'
      ].join('\n')
    },
    clock: {
      name: '时钟 · 当前时间',
      code: [
        'var C = paper.colors;',
        'var W = paper.size.width, H = paper.size.height;',
        'var now = new Date();',
        'function p2(n) { return (n < 10 ? "0" : "") + n; }',
        'paper.clear(C.white);',
        'paper.drawTextEx(8, 12, "T5", C.black, 12, "sans");',
        'paper.drawLine(8, 30, W - 8, 30, C.black);',
        'paper.drawTextEx(8, 54, p2(now.getHours()) + ":" + p2(now.getMinutes()), C.black, 40, "mono");',
        'paper.drawTextEx(8, 112, now.getFullYear() + "-" + p2(now.getMonth() + 1) + "-" + p2(now.getDate()), C.black, 12, "mono");',
        'paper.drawTextEx(8, 136, "静态快照 · 点击 Run 更新", C.black, 11, "sans");',
        'paper.commit();'
      ].join('\n')
    },
    pattern: {
      name: '点阵 · 图案',
      code: [
        'var C = paper.colors;',
        'var W = paper.size.width, H = paper.size.height;',
        'paper.clear(C.white);',
        'for (var y = 0; y < H; y += 8) {',
        '  for (var x = 0; x < W; x += 8) {',
        '    if (((x / 8) + (y / 8)) % 2 === 0) paper.fillRect(x, y, 4, 4, C.black);',
        '  }',
        '}',
        'paper.fillRect(0, 0, W, 6, C.black);',
        'paper.drawTextEx(8, H - 24, "1-bit pattern", C.black, 11, "mono");',
        'paper.commit();'
      ].join('\n')
    }
  };

  global.T5Paper = {
    create: createPaper,
    samples: samples,
    BLACK: BLACK,
    WHITE: WHITE,
    colors: COLORS
  };
})(window);
