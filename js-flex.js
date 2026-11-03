/* js-flex.js -- flex layout compiler for AirPage cards.
 *
 * The device runtime has no layout engine (see docs/device-js-api.md), so
 * layouts are resolved here, in the editor/rp, and compiled down to the flat
 * draw-call sequence the firmware executes.  The declarative part is a small
 * flexbox subset -- the same one the old browser-only js-paper.js had, trimmed
 * to what a 1 bpp / 2 bpp panel can actually show.
 *
 *   var tree = T5Flex.ui.column({ padding: 8, gap: 6 }, [
 *     T5Flex.ui.text('pi-status', { scale: 2 }),
 *     T5Flex.ui.divider(),
 *     T5Flex.ui.text('52 C', { scale: 3 })
 *   ]);
 *   var src = T5Flex.compile(tree, { w: 122, h: 250, measure: paper.textWidth });
 *
 * compile() returns ES5 source: paper.clear / fillRect / text / commit only.
 */
(function (global) {
  'use strict';

  function num(v) {
    if (v === undefined || v === null || v === '' || v === 'auto') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function pad(v) {
    if (v === undefined || v === null || v === '') return { t: 0, r: 0, b: 0, l: 0, x: 0, y: 0 };
    if (Array.isArray(v)) {
      var n = v.map(function (x) { return Number(x) || 0; });
      if (n.length === 1) return { t: n[0], r: n[0], b: n[0], l: n[0], x: n[0] * 2, y: n[0] * 2 };
      if (n.length === 2) return { t: n[0], r: n[1], b: n[0], l: n[1], x: n[1] * 2, y: n[0] * 2 };
      return { t: n[0] || 0, r: n[1] || 0, b: n[2] || 0, l: n[3] || 0,
        x: (n[1] || 0) + (n[3] || 0), y: (n[0] || 0) + (n[2] || 0) };
    }
    if (typeof v === 'object') {
      var t = Number(v.top !== undefined ? v.top : v.t) || 0;
      var r = Number(v.right !== undefined ? v.right : v.r) || 0;
      var b = Number(v.bottom !== undefined ? v.bottom : v.b) || 0;
      var l = Number(v.left !== undefined ? v.left : v.l) || 0;
      return { t: t, r: r, b: b, l: l, x: l + r, y: t + b };
    }
    var k = Number(v) || 0;
    return { t: k, r: k, b: k, l: k, x: k * 2, y: k * 2 };
  }

  function alignOf(v, fallback) {
    var s = String(v === undefined || v === null ? fallback : v).toLowerCase();
    if (s === 'flex-end' || s === 'right' || s === 'bottom') return 'end';
    if (s === 'center' || s === 'middle') return 'center';
    if (s === 'stretch') return 'stretch';
    return 'start';
  }

  function justifyOf(v) {
    var s = String(v === undefined || v === null ? 'start' : v).toLowerCase();
    if (s === 'flex-end' || s === 'end' || s === 'right') return 'end';
    if (s === 'center') return 'center';
    if (s === 'space-between' || s === 'between') return 'between';
    if (s === 'space-around' || s === 'around') return 'around';
    if (s === 'space-evenly' || s === 'evenly') return 'evenly';
    return 'start';
  }

  /* ---- node constructors ------------------------------------------------- */

  function view(direction, style, children) {
    if (Array.isArray(style) || style === undefined || style === null) {
      children = style;
      style = {};
    }
    return { type: 'view', dir: direction, style: style || {},
      children: normalize(children) };
  }

  function normalize(v) {
    var out = [];
    (function add(item) {
      if (item === null || item === undefined || item === false) return;
      if (Array.isArray(item)) { item.forEach(add); return; }
      if (typeof item === 'string' || typeof item === 'number') {
        out.push({ type: 'text', value: String(item), style: {}, children: [] });
        return;
      }
      if (item && item.type) { out.push(item); return; }
      if (item && item.text !== undefined) {
        out.push({ type: 'text', value: String(item.text), style: item, children: [] });
      }
    })(v);
    return out;
  }

  function text(value, style) {
    if (typeof style === 'string') style = { font: style };
    else if (typeof style === 'number') style = { scale: style };
    return { type: 'text', value: String(value === undefined || value === null ? '' : value),
      style: style || {}, children: [] };
  }

  function spacer(style) {
    if (typeof style === 'number') style = { grow: style };
    var s = { grow: 1 };
    if (style) for (var k in style) s[k] = style[k];
    return { type: 'spacer', style: s, children: [] };
  }

  function divider(style) {
    if (typeof style === 'number') style = { weight: style };
    var s = { weight: 1, level: 0 };
    if (style) for (var k in style) s[k] = style[k];
    return { type: 'divider', style: s, children: [] };
  }

  var ui = {
    column: function (style, children) { return view('column', style, children); },
    row: function (style, children) { return view('row', style, children); },
    view: function (style, children) { return view('column', style, children); },
    text: text,
    spacer: spacer,
    divider: divider
  };

  /* ---- measurement ------------------------------------------------------- */

  function measureText(node, availW, measure) {
    var st = node.style;
    var scale = Math.max(1, Math.min(3, Math.round(Number(st.scale) || 1)));
    var str = node.value;
    var lines = [];
    if (st.wrap === false) {
      lines = [str];
    } else {
      var maxW = availW === null || availW === undefined ? Infinity : availW;
      var words = String(str).split(/(\s+)/);
      var line = '';
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        var test = line + w;
        if (line && measure(test, scale) > maxW) {
          lines.push(line);
          line = w.replace(/^\s+/, '');
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      if (!lines.length) lines = [''];
    }
    var maxLines = st.maxLines === undefined ? 0 : (Number(st.maxLines) || 0);
    if (maxLines > 0 && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length > 1 && measure(last + '…', scale) > (availW || Infinity)) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = last;
    }
    var w = 0;
    for (var j = 0; j < lines.length; j++) {
      var lw = measure(lines[j], scale);
      if (lw > w) w = lw;
    }
    var lh = (Number(st.lineHeight) || 13) * scale;
    return { lines: lines, scale: scale, w: w, h: lh * lines.length, lineH: lh };
  }

  function measure(node, availW, availH, measure_) {
    if (!node) return { w: 0, h: 0 };
    var st = node.style || {};
    var margin = pad(st.margin);
    var w = num(st.width);
    var h = num(st.height);
    if (node.type === 'text') {
      var t = measureText(node, w === null ? (availW === null ? null : availW - margin.x) : w, measure_);
      return { w: w === null ? t.w + margin.x : w, h: h === null ? t.h + margin.y : h, text: t };
    }
    if (node.type === 'spacer' || node.type === 'divider') {
      return { w: w === null ? margin.x : w, h: h === null ? (node.type === 'divider' ? (Number(st.weight) || 1) : 0) + margin.y : h };
    }
    if (node.type !== 'view') return { w: 0, h: 0 };
    var p = pad(st.padding);
    var isRow = node.dir === 'row';
    var gap = Number(st.gap) || 0;
    var innerW = w === null ? (availW === null ? null : availW - margin.x - p.x) : w - p.x;
    var innerH = h === null ? (availH === null ? null : availH - margin.y - p.y) : h - p.y;
    var main = 0, cross = 0, count = 0;
    for (var i = 0; i < node.children.length; i++) {
      var c = node.children[i];
      var m = measure(c, isRow ? null : innerW, isRow ? innerH : null, measure_);
      c._m = m;
      if (isRow) { main += m.w; cross = Math.max(cross, m.h); }
      else { main += m.h; cross = Math.max(cross, m.w); }
      count++;
    }
    if (count > 1) main += gap * (count - 1);
    var outW = w === null ? (isRow ? main + p.x + margin.x : cross + p.x + margin.x) : w;
    var outH = h === null ? (isRow ? cross + p.y + margin.y : main + p.y + margin.y) : h;
    return { w: outW, h: outH, main: main, cross: cross };
  }

  /* ---- layout + ops ------------------------------------------------------ */

  function layout(tree, box, ctx) {
    var ops = [];
    walk(tree, box.x, box.y, box.w, box.h, null, ctx, ops);
    return ops;
  }

  function walk(node, x, y, w, h, parentDir, ctx, ops) {
    var st = node.style || {};
    var margin = pad(st.margin);
    var bx = x + margin.l;
    var by = y + margin.t;
    var bw = w - margin.x;
    var bh = h - margin.y;
    var level = st.level;
    if (level === undefined) level = st.fill !== undefined ? st.fill : null;
    if (level === undefined || level === null) level = null;

    if (node.type === 'text') {
      var t = measureText(node, bw, ctx.measure);
      var lvl = level === null ? 0 : (level | 0);
      var top = by;
      var va = String(st.valign || 'top').toLowerCase();
      if (va === 'middle' || va === 'center') top = by + (bh - t.h) / 2;
      else if (va === 'bottom' || va === 'end') top = by + bh - t.h;
      var align = String(st.align || 'left').toLowerCase();
      for (var i = 0; i < t.lines.length; i++) {
        var lx = bx;
        var lw = ctx.measure(t.lines[i], t.scale);
        if (align === 'center' || align === 'middle') lx = bx + (bw - lw) / 2;
        else if (align === 'right' || align === 'end') lx = bx + bw - lw;
        ops.push(['text', Math.round(lx), Math.round(top + i * t.lineH), t.lines[i], t.scale, lvl]);
      }
      return;
    }

    if (node.type === 'divider') {
      var weight = Math.max(1, Number(st.weight) || 1);
      var dl = level === null ? 0 : (level | 0);
      ops.push(['fill', Math.round(bx), Math.round(by), Math.round(bw), weight, dl]);
      return;
    }

    if (node.type === 'spacer') {
      if (level !== null) ops.push(['fill', Math.round(bx), Math.round(by), Math.round(bw), Math.round(bh), level | 0]);
      return;
    }

    /* view */
    if (level !== null)
      ops.push(['fill', Math.round(bx), Math.round(by), Math.round(bw), Math.round(bh), level | 0]);

    var p = pad(st.padding);
    var isRow = node.dir === 'row';
    var gap = Number(st.gap) || 0;
    var innerX = bx + p.l;
    var innerY = by + p.t;
    var innerW = bw - p.x;
    var innerH = bh - p.y;
    var kids = node.children || [];
    var i2, c, m;

    var growSum = 0;
    var fixedMain = 0;
    for (i2 = 0; i2 < kids.length; i2++) {
      c = kids[i2];
      m = c._m || measure(c, isRow ? null : innerW, isRow ? innerH : null, ctx.measure);
      c._m = m;
      var cs = c.style || {};
      var cm = pad(cs.margin);
      var grow = Math.max(0, Number(cs.grow) || (Number(cs.flex) || 0));
      c._grow = grow;
      growSum += grow;
      fixedMain += isRow ? m.w - cm.x : m.h - cm.y;
    }
    if (kids.length > 1) fixedMain += gap * (kids.length - 1);

    var availMain = (isRow ? innerW : innerH) - fixedMain;
    if (availMain < 0) availMain = 0;
    var justify = justifyOf(st.justify);
    var freeMain = availMain;
    var extraGap = 0;
    var lead = 0;
    if (growSum === 0) {
      if (justify === 'end') lead = freeMain;
      else if (justify === 'center') lead = freeMain / 2;
      else if (justify === 'between' && kids.length > 1) extraGap = freeMain / (kids.length - 1);
      else if (justify === 'around' && kids.length > 0) {
        extraGap = freeMain / kids.length;
        lead = extraGap / 2;
      } else if (justify === 'evenly' && kids.length > 0) {
        extraGap = freeMain / (kids.length + 1);
        lead = extraGap;
      }
    }

    var cursor = (isRow ? innerX : innerY) + lead;
    var align = alignOf(st.align, 'stretch');
    for (i2 = 0; i2 < kids.length; i2++) {
      c = kids[i2];
      m = c._m;
      var cst = c.style || {};
      var cm2 = pad(cst.margin);
      var growThis = c._grow || 0;
      var share = growSum > 0 ? Math.floor(availMain * growThis / growSum) : 0;
      var cw = isRow ? (num(cst.width) !== null ? num(cst.width) - cm2.x : m.w - cm2.x) + share
                     : (num(cst.width) !== null ? num(cst.width) - cm2.x : innerW - cm2.x);
      var ch = isRow ? (num(cst.height) !== null ? num(cst.height) - cm2.y : innerH - cm2.y)
                     : (num(cst.height) !== null ? num(cst.height) - cm2.y : m.h - cm2.y) + share;
      if (cw < 0) cw = 0;
      if (ch < 0) ch = 0;
      var cx = isRow ? cursor : innerX;
      var cy = isRow ? innerY : cursor;
      var a = alignOf(cst.alignSelf !== undefined ? cst.alignSelf : st.align, 'stretch');
      if (isRow) {
        if (a === 'center') cy = innerY + (innerH - ch) / 2;
        else if (a === 'end') cy = innerY + innerH - ch;
        else if (a !== 'stretch' && num(cst.height) !== null) { /* start */ }
      } else {
        if (a === 'center') cx = innerX + (innerW - cw) / 2;
        else if (a === 'end') cx = innerX + innerW - cw;
      }
      walk(c, Math.round(cx), Math.round(cy), Math.round(cw), Math.round(ch), node.dir, ctx, ops);
      cursor += (isRow ? cw + cm2.x : ch + cm2.y) + gap + extraGap;
    }
  }

  /* ---- compile ----------------------------------------------------------- */

  function esc(s) {
    var out = '"';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '"' || c === '\\') out += '\\' + c;
      else if (c === '\n') out += '\\n';
      else out += c;
    }
    return out + '"';
  }

  function compile(tree, opts) {
    opts = opts || {};
    var measure = opts.measure;
    if (typeof measure !== 'function') throw new Error('compile() needs measure(text, scale)');
    var w = opts.w || 122, h = opts.h || 250;
    var native = !!opts.native;
    var level = opts.level === undefined ? 3 : opts.level;
    var ops = layout(tree, { x: 0, y: 0, w: w, h: h },
      { measure: function (s, sc) { return measure(String(s), sc || 1); } });

    var lines = [];
    if (native) lines.push('//@canvas ' + w + 'x' + h);
    lines.push('paper.clear({level: ' + level + '});');
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op[0] === 'fill') {
        lines.push('paper.fillRect(' + op[1] + ',' + op[2] + ',' + op[3] + ',' + op[4] +
          ',{level: ' + op[5] + '});');
      } else if (op[0] === 'text') {
        lines.push('paper.text(' + op[1] + ',' + op[2] + ',' + esc(op[3]) +
          ',{scale: ' + op[4] + ', level: ' + op[5] + '});');
      }
    }
    lines.push('paper.commit();');
    return { source: lines.join('\n') + '\n', ops: ops };
  }

  global.T5Flex = {
    ui: ui,
    view: view,
    text: text,
    spacer: spacer,
    divider: divider,
    layout: layout,
    compile: compile,
    pad: pad
  };
})(typeof window !== 'undefined' ? window : globalThis);
