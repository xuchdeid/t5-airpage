/* device-paper.js -- browser simulator for the T5 device JS API.
 *
 * The firmware runtime exposes one small ES5 API on a fixed 122x250 1-bit
 * framebuffer.  This file implements exactly that API, using the device's
 * exported 12 px glyph atlas.  The preview and the pushed source therefore
 * come from the same drawing model.
 */
(function (global) {
  'use strict';

  var W = 122;
  var H = 250;
  var STRIDE = 16;
  var FONT_PATH = 'fonts/device12.png';
  var META_PATH = 'fonts/device12.json';
  var SCRIPT_MAX = 4096;

  var atlas = null;
  var loadPromise = null;

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('atlas image load failed: ' + src)); };
      image.src = src;
    });
  }

  function loadAtlas() {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all([
      loadImage(FONT_PATH),
      fetch(META_PATH).then(function (r) {
        if (!r.ok) throw new Error('atlas meta HTTP ' + r.status);
        return r.json();
      })
    ]).then(function (parts) {
      var image = parts[0];
      var meta = parts[1];
      var canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0);
      var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
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
            var p = ((oy + y) * canvas.width + (ox + x)) * 4;
            if (data[p] < 128) {
              coverage[base + y * stride + (x >> 3)] |= 0x80 >> (x & 7);
            }
          }
        }
      }
      atlas = {
        cellW: meta.cellW,
        cellH: meta.cellH,
        baseline: meta.baseline,
        lineHeight: meta.lineHeight,
        cols: meta.cols,
        rows: meta.rows,
        glyphs: meta.glyphs,
        stride: stride,
        perGlyph: perGlyph,
        coverage: coverage,
        map: meta.map
      };
      return atlas;
    });
    return loadPromise;
  }

  function ready() { return !!atlas; }

  function glyphFor(cp) {
    var entry = atlas.map[String(cp)];
    if (entry) return { gid: entry[0], advance: entry[1] };
    return { gid: 0, advance: atlas.cellW };
  }

  function toInt32(v) {
    return Number(v) | 0;
  }

  function textString(v) {
    return String(v);
  }

  function Paper() {
    this.bits = new Uint8Array(W * H);
    this.hash = 0;
  }

  Paper.prototype.width = function () { return W; };
  Paper.prototype.height = function () { return H; };

  Paper.prototype.clear = function (black) {
    var v = (arguments.length > 0 && toInt32(black)) ? 1 : 0;
    this.bits.fill(v);
    return undefined;
  };

  Paper.prototype.setPixel = function (x, y, black) {
    var px = arguments.length > 0 ? toInt32(x) : 0;
    var py = arguments.length > 1 ? toInt32(y) : 0;
    var v = arguments.length > 2 ? toInt32(black) : 1;
    if (px < 0 || px >= W || py < 0 || py >= H) return undefined;
    this.bits[py * W + px] = v ? 1 : 0;
    return undefined;
  };

  Paper.prototype.fillRect = function (x, y, w, h, black) {
    var px = arguments.length > 0 ? toInt32(x) : 0;
    var py = arguments.length > 1 ? toInt32(y) : 0;
    var pw = arguments.length > 2 ? toInt32(w) : 0;
    var ph = arguments.length > 3 ? toInt32(h) : 0;
    var v = arguments.length > 4 ? (toInt32(black) ? 1 : 0) : 1;
    if (pw <= 0 || ph <= 0) return undefined;
    var x0 = px < 0 ? 0 : px;
    var y0 = py < 0 ? 0 : py;
    var x1 = px + pw;
    var y1 = py + ph;
    if (x1 > W) x1 = W;
    if (y1 > H) y1 = H;
    for (var yy = y0; yy < y1; yy++) {
      var row = yy * W;
      for (var xx = x0; xx < x1; xx++) this.bits[row + xx] = v;
    }
    return undefined;
  };

  Paper.prototype._drawGlyph = function (x, y, gid, black) {
    if (gid < 0 || gid >= atlas.glyphs) gid = 0;
    var base = gid * atlas.perGlyph;
    for (var row = 0; row < atlas.cellH; row++) {
      var src = base + row * atlas.stride;
      var yy = y + row;
      if (yy < 0 || yy >= H) continue;
      var dst = yy * W;
      for (var col = 0; col < atlas.cellW; col++) {
        if (!(atlas.coverage[src + (col >> 3)] & (0x80 >> (col & 7)))) continue;
        var xx = x + col;
        if (xx < 0 || xx >= W) continue;
        this.bits[dst + xx] = black ? 1 : 0;
      }
    }
  };

  Paper.prototype._drawText = function (x, y, text, black) {
    var startX = x;
    var chars = Array.from(textString(text));
    for (var i = 0; i < chars.length; i++) {
      var cp = chars[i].codePointAt(0);
      if (cp === 0x0A) {
        x = startX;
        y += atlas.lineHeight;
        continue;
      }
      if (cp === 0x0D) continue;
      var g = glyphFor(cp);
      this._drawGlyph(x, y, g.gid, black);
      x += g.advance;
    }
    return undefined;
  };

  Paper.prototype.text = function (x, y, text, scale, black) {
    if (arguments.length < 3) throw new TypeError('paper.text(x,y,text,scale,black)');
    var px = toInt32(x);
    var py = toInt32(y);
    if (arguments.length > 3) toInt32(scale);
    var v = arguments.length > 4 ? (toInt32(black) ? 1 : 0) : 1;
    if (!atlas) throw new Error('device font atlas not loaded');
    this._drawText(px, py, text, v);
    return undefined;
  };

  Paper.prototype.textWidth = function (text, scale) {
    if (arguments.length < 1) return 0;
    if (arguments.length > 1) toInt32(scale);
    if (!atlas) return 0;
    var chars = Array.from(textString(text));
    var line = 0, max = 0;
    for (var i = 0; i < chars.length; i++) {
      var cp = chars[i].codePointAt(0);
      if (cp === 0x0A) {
        if (line > max) max = line;
        line = 0;
      } else if (cp !== 0x0D) {
        line += glyphFor(cp).advance;
      }
    }
    return line > max ? line : max;
  };

  Paper.prototype.lineHeight = function (scale) {
    if (arguments.length > 0) toInt32(scale);
    return atlas ? atlas.lineHeight : 0;
  };

  Paper.prototype.commit = function () {
    var packed = this.getPacked();
    var h = 2166136261;
    for (var i = 0; i < packed.length; i++) {
      h ^= packed[i];
      h = Math.imul(h, 16777619) >>> 0;
    }
    this.hash = h >>> 0;
    return this.hash;
  };

  Paper.prototype.getPacked = function () {
    var out = new Uint8Array(STRIDE * H);
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        if (this.bits[y * W + x]) out[y * STRIDE + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    return out;
  };

  Paper.prototype.getBits = function () { return this.bits; };

  function maskCode(src) {
    var out = [];
    var i = 0;
    var n = src.length;
    var bs = String.fromCharCode(92);
    var nl = String.fromCharCode(10);
    while (i < n) {
      var c = src.charAt(i);
      var d = src.charAt(i + 1);
      if (c === '"' || c === "'") {
        out.push(c);
        i += 1;
        while (i < n) {
          var ch = src.charAt(i);
          if (ch === bs) {
            i += 2;
          } else if (ch === c) {
            out.push(c);
            i += 1;
            break;
          } else if (src.charAt(i) === nl) {
            break;
          } else {
            out.push(' ');
            i += 1;
          }
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
      return '设备 paper.text 参数顺序是 (x, y, text, scale, black)';
    }
    var allowed = {
      clear: 1, setPixel: 1, fillRect: 1, text: 1, textWidth: 1,
      lineHeight: 1, width: 1, height: 1, commit: 1
    };
    var re = /paper[.]([A-Za-z_$][A-Za-z0-9_$]*)/g;
    var m;
    while ((m = re.exec(src))) {
      if (!allowed[m[1]]) return '设备不支持 paper.' + m[1] + '；可用 API：clear / setPixel / fillRect / text / textWidth / lineHeight / width / height / commit';
    }
    return '';
  }

  function lines(arr) { return arr.join('\n'); }

  var samples = {
    poster: {
      name: '文字海报',
      code: lines([
        'var W = paper.width(), H = paper.height();',
        'var M = 6, BLACK = 1, WHITE = 0;',
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
        'paper.clear(WHITE);',
        'paper.fillRect(0, 0, W, 22, BLACK);',
        'paper.text(M, 3, "每日一句", 1, WHITE);',
        'var ls = wrap(q, W - 2 * M);',
        'var y = 36;',
        'for (var j = 0; j < ls.length; j++) { paper.text(M, y, ls[j], 1, BLACK); y += paper.lineHeight(1); }',
        'paper.fillRect(M, 78, W - 2 * M, 1, BLACK);',
        'paper.text(M, 88, "王阳明", 1, BLACK);',
        'paper.text(M, 108, "知行合一", 1, BLACK);',
        'paper.fillRect(M, 128, 40, 40, BLACK);',
        'paper.fillRect(M + 3, 131, 34, 34, WHITE);',
        'paper.fillRect(M + 8, 136, 24, 24, BLACK);',
        'paper.text(W - 48, 132, "AIR", 1, BLACK);',
        'paper.text(W - 48, 148, "PAGE", 1, BLACK);',
        'paper.fillRect(M, 184, W - 2 * M, 1, BLACK);',
        'paper.text(M, 194, "12 PX / 1 BIT", 1, BLACK);',
        'paper.text(M, 210, "E-INK", 1, BLACK);',
        'paper.text(M, H - 16, "2026", 1, BLACK);',
        'paper.commit();'
      ])
    },
    hello: {
      name: '基础卡片',
      code: lines([
        'var W = paper.width(), H = paper.height();',
        'var M = 6, BLACK = 1, WHITE = 0;',
        'paper.clear(WHITE);',
        'paper.fillRect(0, 0, W, 22, BLACK);',
        'paper.text(M, 3, "AirPage", 1, WHITE);',
        'paper.fillRect(M, 30, W - 2 * M, 1, BLACK);',
        'paper.text(M, 38, "你好，", 1, BLACK);',
        'paper.text(M, 54, "这是 T5", 1, BLACK);',
        'paper.text(M, 70, "设备端 JS", 1, BLACK);',
        'paper.fillRect(M, 94, 44, 44, BLACK);',
        'paper.text(M + 7, 101, "12", 1, WHITE);',
        'paper.text(M + 7, 117, "PX", 1, WHITE);',
        'paper.text(M + 54, 98, "一种字号", 1, BLACK);',
        'paper.text(M + 54, 114, "全字库", 1, BLACK);',
        'paper.fillRect(M + 54, 132, 50, 1, BLACK);',
        'paper.text(M + 54, 140, "31K", 1, BLACK);',
        'paper.text(M, 162, "clear / fillRect", 1, BLACK);',
        'paper.text(M, 178, "text / commit", 1, BLACK);',
        'paper.fillRect(M, H - 18, W - 2 * M, 1, BLACK);',
        'paper.text(M, H - 14, "BLE AIRPAGE", 1, BLACK);',
        'paper.commit();'
      ])
    },
    year: {
      name: '年度进度',
      code: lines([
        'var W = paper.width(), H = paper.height();',
        'var M = 6, BLACK = 1, WHITE = 0;',
        'var pct = 0.82;',
        'var p = Math.floor(pct * 100);',
        'paper.clear(WHITE);',
        'paper.fillRect(0, 0, W, 4, BLACK);',
        'paper.text(M, 12, "YEAR 2026", 1, BLACK);',
        'paper.text(M, 32, p + "%", 1, BLACK);',
        'paper.text(M, 50, "OF THE YEAR", 1, BLACK);',
        'var bw = W - 2 * M, by = 76;',
        'paper.fillRect(M, by, bw, 14, BLACK);',
        'paper.fillRect(M + 2, by + 2, Math.floor((bw - 4) * pct), 10, WHITE);',
        'paper.text(M, by + 22, "DONE", 1, BLACK);',
        'paper.text(W - 42, by + 22, "82/100", 1, BLACK);',
        'paper.text(M, 120, "JAN", 1, BLACK);',
        'paper.text(W - 30, 120, "DEC", 1, BLACK);',
        'for (var i = 1; i < 12; i++) {',
        '  var x = M + bw * i / 12;',
        '  paper.fillRect(Math.floor(x), 144, 1, i % 3 === 0 ? 8 : 5, BLACK);',
        '}',
        'paper.fillRect(M, 166, bw, 1, BLACK);',
        'paper.text(M, 178, "PLAN", 1, BLACK);',
        'paper.text(M, 194, "BUILD", 1, BLACK);',
        'paper.text(M, 210, "SHIP", 1, BLACK);',
        'paper.fillRect(M, H - 18, bw, 1, BLACK);',
        'paper.text(M, H - 14, "AIRPAGE", 1, BLACK);',
        'paper.commit();'
      ])
    },
    week: {
      name: '每周计划',
      code: lines([
        'var W = paper.width(), H = paper.height();',
        'var M = 6, BLACK = 1, WHITE = 0;',
        'var days = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];',
        'var work = ["PLAN", "DEEP", "MOVE", "READ", "REST", "PLAY", "OFF"];',
        'paper.clear(WHITE);',
        'paper.fillRect(0, 0, W, 22, BLACK);',
        'paper.text(M, 3, "WEEK", 1, WHITE);',
        'paper.text(W - 30, 3, "30", 1, WHITE);',
        'paper.fillRect(M, 28, W - 2 * M, 1, BLACK);',
        'var top = 38, rh = 26;',
        'for (var i = 0; i < 7; i++) {',
        '  var y = top + i * rh;',
        '  paper.fillRect(M, y + 5, 8, 8, BLACK);',
        '  paper.text(M + 14, y + 4, days[i], 1, BLACK);',
        '  paper.text(M + 52, y + 4, work[i], 1, BLACK);',
        '  paper.fillRect(M, y + rh - 2, W - 2 * M, 1, BLACK);',
        '}',
        'paper.text(M, H - 14, "7 DAYS", 1, BLACK);',
        'paper.commit();'
      ])
    },
    todo: {
      name: '待办清单',
      code: lines([
        'var W = paper.width(), H = paper.height();',
        'var M = 6, BLACK = 1, WHITE = 0;',
        'var items = [["INBOX", 1], ["PLAN", 0], ["WORK", 0], ["WALK", 1], ["READ", 0], ["SLEEP", 0]];',
        'paper.clear(WHITE);',
        'paper.fillRect(0, 0, W, 22, BLACK);',
        'paper.text(M, 3, "TO DO", 1, WHITE);',
        'paper.text(W - 30, 3, "2/6", 1, WHITE);',
        'paper.fillRect(M, 28, W - 2 * M, 1, BLACK);',
        'for (var i = 0; i < items.length; i++) {',
        '  var y = 34 + i * 30;',
        '  paper.fillRect(M, y, 9, 9, BLACK);',
        '  if (items[i][1]) paper.fillRect(M + 2, y + 2, 5, 5, WHITE);',
        '  paper.text(M + 15, y - 2, items[i][0], 1, BLACK);',
        '  paper.fillRect(M, y + 22, W - 2 * M, 1, BLACK);',
        '}',
        'paper.commit();'
      ])
    },
    moon: {
      name: '月相',
      code: lines([
        'var W = paper.width(), H = paper.height();',
        'var M = 6, BLACK = 1, WHITE = 0;',
        'var p = 0.35;',
        'var cx = W / 2, cy = 92, r = 34;',
        'var sunX = Math.sin(p * Math.PI * 2);',
        'var sunZ = -Math.cos(p * Math.PI * 2);',
        'paper.clear(WHITE);',
        'paper.fillRect(0, 0, W, 22, BLACK);',
        'paper.text(M, 3, "MOON", 1, WHITE);',
        'for (var y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {',
        '  for (var x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {',
        '    var nx = (x + 0.5 - cx) / r;',
        '    var ny = (y + 0.5 - cy) / r;',
        '    var rr = nx * nx + ny * ny;',
        '    if (rr > 1) continue;',
        '    var nz = Math.sqrt(1 - rr);',
        '    if (nx * sunX + nz * sunZ > 0) paper.setPixel(x, y, BLACK);',
        '  }',
        '}',
        'paper.text(M, 136, "WAXING", 1, BLACK);',
        'paper.text(M, 152, "CRESCENT", 1, BLACK);',
        'paper.text(M, 176, "ILLUM 35%", 1, BLACK);',
        'paper.fillRect(M, 196, W - 2 * M, 1, BLACK);',
        'paper.text(M, 206, "JUL 2026", 1, BLACK);',
        'paper.text(M, H - 14, "PHASE", 1, BLACK);',
        'paper.commit();'
      ])
    },
    test: {
      name: '测试图',
      code: lines([
        'var W = paper.width(), H = paper.height();',
        'var BLACK = 1, WHITE = 0;',
        'function hline(x1, x2, y) { paper.fillRect(x1, y, x2 - x1 + 1, 1, BLACK); }',
        'function vline(x, y1, y2) { paper.fillRect(x, y1, 1, y2 - y1 + 1, BLACK); }',
        'paper.clear(WHITE);',
        'hline(1, W - 2, 1); hline(1, W - 2, H - 2);',
        'vline(1, 1, H - 2); vline(W - 2, 1, H - 2);',
        'for (var i = 0; i <= 10; i++) {',
        '  var x = 6 + i * (W - 12) / 10;',
        '  var y = 6 + i * (H - 12) / 10;',
        '  vline(Math.floor(x), 4, H - 4);',
        '  hline(4, W - 4, Math.floor(y));',
        '}',
        'paper.fillRect(8, 92, W - 16, 62, WHITE);',
        'hline(8, W - 9, 92); hline(8, W - 9, 153);',
        'vline(8, 92, 153); vline(W - 9, 92, 153);',
        'paper.text(12, 8, "TOP 123", 1, BLACK);',
        'paper.text(12, H - 20, "鑫 汉字", 1, BLACK);',
        'paper.text(16, 104, "T5", 1, BLACK);',
        'paper.text(16, 120, "1-BIT", 1, BLACK);',
        'paper.text(16, 136, "12PX", 1, BLACK);',
        'paper.commit();'
      ])
    },
    pattern: {
      name: '点阵图案',
      code: lines([
        'var W = paper.width(), H = paper.height();',
        'var BLACK = 1, WHITE = 0;',
        'paper.clear(WHITE);',
        'paper.fillRect(0, 0, W, 22, BLACK);',
        'paper.text(6, 3, "PATTERN", 1, WHITE);',
        'for (var i = 0; i < 13; i++) {',
        '  for (var j = 0; j < 24; j++) {',
        '    if ((i + j) % 2 === 0) paper.fillRect(8 + i * 8, 30 + j * 8, 3, 3, BLACK);',
        '  }',
        '}',
        'paper.text(8, H - 18, "8 PX GRID", 1, BLACK);',
        'paper.commit();'
      ])
    }
  };

  global.T5Paper = {
    load: loadAtlas,
    ready: ready,
    create: function () { return new Paper(); },
    samples: samples,
    sourceIssue: sourceIssue,
    W: W,
    H: H,
    SCRIPT_MAX: SCRIPT_MAX
  };
})(window);
