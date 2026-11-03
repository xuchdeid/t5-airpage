/* device-paper.js -- browser simulator for the AirPage device JS API (v2).
 *
 * Mirrors src/js_runtime.c exactly: a packed 2 bpp canvas (4 px/byte, MSB
 * first, 0 = black .. 3 = white), the device's 12 px glyph atlas, and the same
 * FNV-1a hash over the packed buffer.  Preview and panel therefore agree down
 * to the byte, including the padding bits at the end of every row.
 */
(function (global) {
  'use strict';

  var DEFAULT_W = 122;
  var DEFAULT_H = 250;
  var MAX_W = 480, MAX_H = 800;
  var SCRIPT_MAX = 4096;
  /* Two faces: 12 px for the 122x250 canvas (T5, legacy scripts) and 24 px
     for the native 480x800 canvas (Sticky, compiler output).
     The host page decides where they live: the editor serves them next to
     itself ('fonts/'), rp serves them from /t5/atlas/. */
  var ATLAS_BASE = (typeof window !== 'undefined' && window.T5_ATLAS_BASE) || 'fonts/';
  var FACES = {
    small: { png: ATLAS_BASE + 'device12.png', json: ATLAS_BASE + 'device12.json' },
    large: { png: ATLAS_BASE + 'device24.png', json: ATLAS_BASE + 'device24.json' }
  };

  var faces = { small: null, large: null };
  var loadPromise = null;

  function faceFor(w, h) { return (w >= 400 || h >= 600) ? 'large' : 'small'; }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('atlas image load failed: ' + src)); };
      image.src = src;
    });
  }

  function buildAtlas(meta, pixels, width) {
    var stride = (meta.cellW + 7) >> 3;
    var perGlyph = stride * meta.cellH;
    var coverage = new Uint8Array(meta.glyphs * perGlyph);
    var cols = meta.cols;
    for (var gid = 0; gid < meta.glyphs; gid++) {
      var ox = (gid % cols) * meta.cellW;
      var oy = Math.floor(gid / cols) * meta.cellH;
      var base = gid * perGlyph;
      for (var y = 0; y < meta.cellH; y++) {
        for (var x = 0; x < meta.cellW; x++) {
          var p = ((oy + y) * width + (ox + x)) * 4;
          if (pixels[p] < 128) coverage[base + y * stride + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
    }
    return {
      cellW: meta.cellW, cellH: meta.cellH, baseline: meta.baseline,
      lineHeight: meta.lineHeight, cols: meta.cols, rows: meta.rows,
      glyphs: meta.glyphs, stride: stride, perGlyph: perGlyph,
      coverage: coverage, map: meta.map
    };
  }

  function loadFace(name) {
    var cfg = FACES[name];
    return Promise.all([
      loadImage(cfg.png),
      fetch(cfg.json).then(function (r) {
        if (!r.ok) throw new Error('atlas meta HTTP ' + r.status);
        return r.json();
      })
    ]).then(function (parts) {
      var image = parts[0], meta = parts[1];
      var canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0);
      faces[name] = buildAtlas(meta,
        ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width);
      return faces[name];
    });
  }

  function loadAtlas() {
    if (loadPromise) return loadPromise;
    loadPromise = loadFace('small').then(function () {
      return loadFace('large').catch(function () { return null; });
    });
    return loadPromise;
  }

  /* Node/CI path: hand in an atlas built from the generated C arrays. */
  function setAtlas(meta, coverage, name) {
    var face = {
      cellW: meta.cellW, cellH: meta.cellH, baseline: meta.baseline,
      lineHeight: meta.lineHeight, cols: meta.cols || 1, rows: meta.rows || 1,
      glyphs: meta.glyphs, stride: (meta.cellW + 7) >> 3,
      perGlyph: ((meta.cellW + 7) >> 3) * meta.cellH,
      coverage: coverage, map: meta.map
    };
    faces[name || 'small'] = face;
    loadPromise = Promise.resolve(face);
    return face;
  }

  function ready() { return !!faces.small; }

  function glyphFor(at, cp) {
    var entry = at.map[String(cp)];
    if (entry) return { gid: entry[0], advance: entry[1] };
    return { gid: 0, advance: at.cellW };
  }

  function toInt32(v) { return Number(v) | 0; }

  /* "//@canvas 480x800" on the first line asks for a canvas other than 122x250. */
  function parseCanvas(source) {
    var src = String(source || '');
    if (src.slice(0, 10) !== '//@canvas ') return { w: DEFAULT_W, h: DEFAULT_H };
    var m = /^\/\/@canvas\s+(\d+)x(\d+)/.exec(src);
    if (!m) return { w: DEFAULT_W, h: DEFAULT_H };
    var w = +m[1], h = +m[2];
    if (w <= 0 || h <= 0 || w > MAX_W || h > MAX_H) return { w: DEFAULT_W, h: DEFAULT_H };
    return { w: w, h: h };
  }

  function levelOf(arg, legacyDefaultBlack) {
    if (arg === undefined || arg === null) return legacyDefaultBlack ? 0 : 3;
    if (typeof arg === 'object') {
      var lv = Number(arg.level);
      if (isFinite(lv)) return Math.max(0, Math.min(3, lv | 0));
      return legacyDefaultBlack ? 0 : 3;
    }
    var black = toInt32(arg);
    return black ? 0 : 3;
  }

  function Paper(cw, ch, screen, data) {
    this.w = cw;
    this.h = ch;
    this.stride = (cw * 2 + 7) >> 3;
    this.bytes = new Uint8Array(this.stride * ch);
    this.bytes.fill(0xFF);
    this.hash = 0;
    this.calls = 0;
    this.screen = screen || { w: cw, h: ch, bpp: 1, scale: 1 };
    this.data = data;
    this.face = faces[faceFor(cw, ch)] || faces.small;
    if (!this.face) throw new Error('device font atlas not loaded');
    this.faceName = faceFor(cw, ch);
  }

  Paper.prototype.width = function () { return this.w; };
  Paper.prototype.height = function () { return this.h; };

  Paper.prototype._get = function (x, y) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return 3;
    return (this.bytes[y * this.stride + (x >> 2)] >> (6 - ((x & 3) * 2))) & 3;
  };

  Paper.prototype._set = function (x, y, level) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    var i = y * this.stride + (x >> 2);
    var shift = 6 - ((x & 3) * 2);
    this.bytes[i] = (this.bytes[i] & ~(3 << shift)) | ((level & 3) << shift);
  };

  Paper.prototype.clear = function (arg) {
    if (++this.calls > 2000) throw new Error('draw budget exceeded');
    this.bytes.fill(levelOf(arg, false) * 0x55);
    return undefined;
  };

  Paper.prototype.setPixel = function (x, y, arg) {
    if (++this.calls > 2000) throw new Error('draw budget exceeded');
    this._set(toInt32(x), toInt32(y), arguments.length > 2 ? levelOf(arg, true) : 0);
    return undefined;
  };

  Paper.prototype.fillRect = function (x, y, w, h, arg) {
    if (++this.calls > 2000) throw new Error('draw budget exceeded');
    var px = toInt32(x), py = toInt32(y), pw = toInt32(w), ph = toInt32(h);
    var level = arguments.length > 4 ? levelOf(arg, true) : 0;
    if (pw <= 0 || ph <= 0) return undefined;
    var x0 = px < 0 ? 0 : px, y0 = py < 0 ? 0 : py;
    var x1 = px + pw, y1 = py + ph;
    if (x1 > this.w) x1 = this.w;
    if (y1 > this.h) y1 = this.h;
    for (var yy = y0; yy < y1; yy++)
      for (var xx = x0; xx < x1; xx++)
        this._set(xx, yy, level);
    return undefined;
  };

  Paper.prototype._glyph = function (x, y, gid, level, scale) {
    var at = this.face;
    if (gid < 0 || gid >= at.glyphs) gid = 0;
    var base = gid * at.perGlyph;
    for (var row = 0; row < at.cellH; row++) {
      var src = base + row * at.stride;
      for (var col = 0; col < at.cellW; col++) {
        if (!(at.coverage[src + (col >> 3)] & (0x80 >> (col & 7)))) continue;
        for (var dy = 0; dy < scale; dy++) {
          for (var dx = 0; dx < scale; dx++) {
            this._set(x + col * scale + dx, y + row * scale + dy, level);
          }
        }
      }
    }
  };

  Paper.prototype._text = function (x, y, text, level, scale) {
    var startX = x;
    var chars = Array.from(String(text));
    for (var i = 0; i < chars.length; i++) {
      var cp = chars[i].codePointAt(0);
      if (cp === 0x0A) { x = startX; y += this.face.lineHeight * scale; continue; }
      if (cp === 0x0D) continue;
      var g = glyphFor(this.face, cp);
      this._glyph(x, y, g.gid, level, scale);
      x += g.advance * scale;
    }
    return undefined;
  };

  Paper.prototype.text = function (x, y, text, scaleArg, black) {
    if (++this.calls > 2000) throw new Error('draw budget exceeded');
    if (arguments.length < 3) throw new TypeError('paper.text(x,y,text,scale,black)');
    var scale = 1, level = 0;
    if (arguments.length > 3) {
      if (scaleArg && typeof scaleArg === 'object') {
        var s = Number(scaleArg.scale);
        if (isFinite(s) && s >= 1 && s <= 3) scale = s | 0;
        level = levelOf(scaleArg, true);
      } else {
        var n = toInt32(scaleArg);
        if (n >= 1 && n <= 3) scale = n;
        if (arguments.length > 4) level = levelOf(black, true);
      }
    }
    this._text(toInt32(x), toInt32(y), text, level, scale);
    return undefined;
  };

  Paper.prototype.textWidth = function (text, scaleArg) {
    var at = this.face;
    if (!at) return 0;
    var scale = 1;
    if (arguments.length > 1) {
      var n = toInt32(scaleArg);
      if (n >= 1 && n <= 3) scale = n;
    }
    var chars = Array.from(String(text));
    var line = 0, max = 0;
    for (var i = 0; i < chars.length; i++) {
      var cp = chars[i].codePointAt(0);
      if (cp === 0x0A) { if (line > max) max = line; line = 0; }
      else if (cp !== 0x0D) line += glyphFor(at, cp).advance;
    }
    if (line > max) max = line;
    return max * scale;
  };

  Paper.prototype.lineHeight = function (scaleArg) {
    if (!this.face) return 0;
    var scale = 1;
    if (arguments.length > 0) {
      var n = toInt32(scaleArg);
      if (n >= 1 && n <= 3) scale = n;
    }
    return this.face.lineHeight * scale;
  };

  Paper.prototype.commit = function () {
    var h = 2166136261;
    for (var i = 0; i < this.bytes.length; i++) {
      h ^= this.bytes[i];
      h = Math.imul(h, 16777619) >>> 0;
    }
    this.hash = h >>> 0;
    return this.hash;
  };

  Paper.prototype.getPacked = function () { return this.bytes; };

  /* One bit per pixel for the canvas preview: 1 = ink (level < 2). */
  Paper.prototype.getBits = function () {
    var out = new Uint8Array(this.w * this.h);
    for (var y = 0; y < this.h; y++) {
      for (var x = 0; x < this.w; x++) {
        out[y * this.w + x] = this._get(x, y) < 2 ? 1 : 0;
      }
    }
    return out;
  };

  Paper.prototype.getLevels = function () {
    var out = new Uint8Array(this.w * this.h);
    for (var y = 0; y < this.h; y++)
      for (var x = 0; x < this.w; x++)
        out[y * this.w + x] = this._get(x, y);
    return out;
  };

  function screenFor(canvas) {
    var panelW = canvas.panelW || canvas.w;
    var panelH = canvas.panelH || canvas.h;
    var bpp = canvas.bpp || (panelW > 200 ? 2 : 1);
    var scale = Math.max(1, Math.round(panelW / canvas.w));
    return { w: panelW, h: panelH, bpp: bpp, scale: scale };
  }

  function create(opts) {
    opts = opts || {};
    var canvas = opts.canvas || parseCanvas(opts.source);
    var screen = opts.screen || screenFor({
      w: canvas.w, h: canvas.h,
      panelW: opts.panelW, panelH: opts.panelH, bpp: opts.bpp
    });
    return new Paper(canvas.w, canvas.h, screen, opts.data);
  }

  /* ---- source validation ------------------------------------------------ */
  function maskCode(src) {
    var out = [];
    var i = 0, n = src.length;
    var bs = String.fromCharCode(92), nl = String.fromCharCode(10);
    while (i < n) {
      var c = src.charAt(i), d = src.charAt(i + 1);
      if (c === '"' || c === "'") {
        out.push(c);
        i += 1;
        while (i < n) {
          var ch = src.charAt(i);
          if (ch === bs) { i += 2; }
          else if (ch === c) { out.push(c); i += 1; break; }
          else if (src.charAt(i) === nl) { break; }
          else { out.push(' '); i += 1; }
        }
      } else if (c === '/' && d === '/') {
        i += 2;
        while (i < n && src.charAt(i) !== nl) i += 1;
        out.push(' ');
      } else if (c === '/' && d === '*') {
        i += 2;
        while (i < n && !(src.charAt(i) === '*' && src.charAt(i + 1) === '/')) i += 1;
        if (i < n) i += 2;
        out.push(' ');
      } else {
        out.push(c);
        i += 1;
      }
    }
    return out.join('');
  }

  function sourceIssue(code) {
    var raw = String(code || '');
    if (raw.indexOf(String.fromCharCode(96)) >= 0) return '设备不支持模板字符串';
    var src = maskCode(raw);
    if (!src.trim()) return '脚本为空';
    if (raw.length > SCRIPT_MAX) return '脚本超过 ' + SCRIPT_MAX + ' 字节';
    if (/(^|[^A-Za-z0-9_])(const|let|class)([^A-Za-z0-9_]|$)/.test(src)) return '设备只接受 ES5：请用 var/function，不要用 const/let/class';
    if (/=>/.test(src)) return '设备只接受 ES5：不要用箭头函数 =>';
    if (/\b(async|await)\b/.test(src)) return '设备不支持 async/await';
    if (/\b(function\s*\*)/.test(src)) return '设备不支持 generator';
    if (/\?\./.test(src)) return '设备不支持可选链 ?.';
    if (/\?\?/.test(src)) return '设备不支持空值合并 ??';
    if (/\b(window|document|navigator|localStorage|fetch|XMLHttpRequest|WebSocket)\b/.test(src)) {
      return '设备没有浏览器全局对象（window/document/fetch/localStorage 等）';
    }
    if (raw.indexOf("paper.text('") >= 0 || raw.indexOf('paper.text("') >= 0) {
      return '设备 paper.text 参数顺序是 (x, y, text, scale, level)';
    }
    var allowed = {
      clear: 1, setPixel: 1, fillRect: 1, text: 1, textWidth: 1,
      lineHeight: 1, width: 1, height: 1, commit: 1, data: 1, screen: 1
    };
    var re = /paper[.]([A-Za-z_$][A-Za-z0-9_$]*)/g;
    var m;
    while ((m = re.exec(src))) {
      if (!allowed[m[1]]) return '设备不支持 paper.' + m[1] + '；可用 API：clear / setPixel / fillRect / text / textWidth / lineHeight / width / height / commit / data / screen';
    }
    return '';
  }

  function lines(arr) { return arr.join(String.fromCharCode(10)); }

  var samples = {
    poster: {
      name: '文字海报',
      code: lines([
        'var W = paper.width(), H = paper.height();',
        'var M = 6;',
        'var q = "知是行之始，行是知之成。";',
        'function wrap(s, max) {',
        '  var out = [], line = "";',
        '  for (var i = 0; i < s.length; i++) {',
        '    var t = line + s.charAt(i);',
        '    if (line && paper.textWidth(t, 1) > max) { out.push(line); line = s.charAt(i); }',
        '    else line = t;',
        '  }',
        '  if (line) out.push(line);',
        '  return out;',
        '}',
        'paper.clear(0);',
        'paper.fillRect(0, 0, W, 22, 1);',
        'paper.text(M, 3, "每日一句", 1, 0);',
        'var ls = wrap(q, W - 2 * M);',
        'var y = 36;',
        'for (var j = 0; j < ls.length; j++) { paper.text(M, y, ls[j], 1, 1); y += paper.lineHeight(1); }',
        'paper.fillRect(M, 78, W - 2 * M, 1, 1);',
        'paper.text(M, 88, "王阳明", 1, 1);',
        'paper.text(M, 108, "知行合一", 1, 1);',
        'paper.fillRect(M, 128, 40, 40, 1);',
        'paper.fillRect(M + 3, 131, 34, 34, 0);',
        'paper.fillRect(M + 8, 136, 24, 24, 1);',
        'paper.text(W - 48, 132, "AIR", 1, 1);',
        'paper.text(W - 48, 148, "PAGE", 1, 1);',
        'paper.fillRect(M, 184, W - 2 * M, 1, 1);',
        'paper.text(M, 194, "12 PX", 1, 1);',
        'paper.text(M, 210, "E-INK", 1, 1);',
        'paper.text(M, H - 16, "2026", 1, 1);',
        'paper.commit();'
      ])
    },
    hello: {
      name: '基础卡片',
      code: lines([
        'var W = paper.width(), H = paper.height();',
        'var M = 6;',
        'paper.clear(0);',
        'paper.fillRect(0, 0, W, 22, 1);',
        'paper.text(M, 3, "AirPage", 1, 0);',
        'paper.fillRect(M, 30, W - 2 * M, 1, 1);',
        'paper.text(M, 38, "设备端 JS", 1, 1);',
        'paper.text(M, 54, "122 x 250 / 1-bit", 1, 1);',
        'paper.fillRect(M, 76, W - 2 * M, 1, 1);',
        'paper.text(M, 86, "paper.text(x,y,s)", 1, 1);',
        'paper.text(M, 102, "paper.fillRect()", 1, 1);',
        'paper.text(M, 118, "paper.commit()", 1, 1);',
        'paper.text(M, H - 20, "READY", 1, 1);',
        'paper.commit();'
      ])
    },
    gray: {
      name: '四灰阶（原生画布）',
      code: lines([
        '//@canvas 480x800',
        'var W = paper.width(), H = paper.height();',
        'paper.clear({level: 3});',
        'paper.fillRect(0, 0, W, H/4, {level: 0});',
        'paper.fillRect(0, H/4, W, H/4, {level: 1});',
        'paper.fillRect(0, H/2, W, H/4, {level: 2});',
        'paper.text(20, 20, "4 LEVELS", {scale: 2, level: 3});',
        'paper.text(20, H/4 + 40, "LEVEL 1", {scale: 2, level: 3});',
        'paper.text(20, H/2 + 40, "LEVEL 2", {scale: 2, level: 0});',
        'paper.commit();'
      ])
    }
  };

  global.T5Paper = {
    load: loadAtlas,
    ready: ready,
    setAtlas: setAtlas,
    create: create,
    parseCanvas: parseCanvas,
    sourceIssue: sourceIssue,
    samples: samples,
    lines: lines,
    SCRIPT_MAX: SCRIPT_MAX,
    DEFAULT_W: DEFAULT_W,
    DEFAULT_H: DEFAULT_H,
    MAX_W: MAX_W,
    MAX_H: MAX_H,
    Paper: Paper
  };
})(typeof window !== 'undefined' ? window : globalThis);
