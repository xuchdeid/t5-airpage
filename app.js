'use strict';

/* ---------- protocol constants (must match src/bleimage.cpp) ---------- */
const SERVICE = '5f9b0001-7a6b-4c2d-9e8f-1234567890ab';
const CTRL    = '5f9b0002-7a6b-4c2d-9e8f-1234567890ab';
const DATA    = '5f9b0003-7a6b-4c2d-9e8f-1234567890ab';
const INFO    = '5f9b0004-7a6b-4c2d-9e8f-1234567890ab';
const PANEL_W = 122, PANEL_H = 250, STRIDE = 16;
const IMAGE_BYTES = STRIDE * PANEL_H;
let W = PANEL_W, H = PANEL_H;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function setStatus(text, kind = '') {
  const el = $('#status');
  el.textContent = text;
  el.style.color = kind === 'bad' ? 'var(--bad)' : kind === 'ok' ? 'var(--ok)' : '';
}
function setDot(state) {
  const d = $('#dot');
  d.className = 'dot' + (state === 'on' ? ' on' : state === 'busy' ? ' busy' : '');
}

/* ---------- state ---------- */
const state = {
  template: 'quote',
  orientation: 'portrait',
  photo: null,
  caption: '',
  quote: '把时间浪费在\n美好的事物上。',
  quoteSize: 12,
  author: '—— 约翰·列侬',
  year: new Date().getFullYear(),
  week: ['周一  深度工作', '周二  复盘与计划', '周三  写作', '周四  阅读', '周五  收尾', '周六  出门走走', '周日  留白'].join('\n'),
  todo: ['回复邮件', '整理桌面', '读 20 页书', '散步 30 分钟', '写日记', '早点睡'].join('\n'),
  countdownTitle: '下一次旅行',
  countdownDate: (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0,10); })(),
  moonDate: new Date().toISOString().slice(0,10),
  dither: 'fs'
};

/* ---------- canvases ---------- */
const preview = $('#preview');
const pctx = preview.getContext('2d', { willReadFrequently: true });
const base = document.createElement('canvas');
base.width = W; base.height = H;
let bctx = base.getContext('2d', { willReadFrequently: true });

/* ---------- pixel font ----------
 * A real bitmap path: the 12px Fusion Pixel outline is rasterised once per
 * character, thresholded to 1-bit, and then drawn with nearest-neighbour
 * scaling. No system font, no anti-aliased Chinese in the final image.
 */
const glyphs = new Map();
let glyphCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
let measureCtx = document.createElement('canvas').getContext('2d');
let fontReady = false;

async function loadPixelFont() {
  const face = new FontFace('T5Pixel', 'url("fonts/fusion-pixel-12px.woff2")');
  await face.load();
  document.fonts.add(face);
  await document.fonts.load('12px T5Pixel');
  glyphCtx.font = '12px T5Pixel';
  glyphCtx.textBaseline = 'alphabetic';
  measureCtx.font = '12px T5Pixel';
  fontReady = true;
}

/* 12 / 24 / 48 px bitmap cells. The 12 px master is thresholded once;
 * 24 and 48 are cached as exact 2x / 4x integer pixel grids. This keeps the
 * dot-matrix strokes even, which native 48 px hinting does not. */
const FONT_SIZES = [12, 24, 48];

function baseGlyph12(ch) {
  const key = '12:' + ch;
  let g = glyphs.get(key);
  if (g) return g;

  measureCtx.font = '12px T5Pixel';
  const m = measureCtx.measureText(ch);
  const w = Math.max(1, Math.ceil(m.width));
  const c = document.createElement('canvas');
  c.width = w; c.height = 12;
  const g2 = c.getContext('2d', { willReadFrequently: true });
  g2.clearRect(0, 0, w, 12);
  g2.font = '12px T5Pixel';
  g2.textBaseline = 'alphabetic';
  g2.fillStyle = '#000';
  g2.fillText(ch, 0, 10);

  const src = g2.getImageData(0, 0, w, 12);
  const out = document.createElement('canvas');
  out.width = w; out.height = 12;
  const o = out.getContext('2d');
  const id = o.createImageData(w, 12);
  for (let i = 0; i < w * 12; i++) {
    if (src.data[i * 4 + 3] > 96) {
      id.data[i * 4 + 3] = 255;      // black, fully opaque
    }
  }
  o.putImageData(id, 0, 0);
  g = { canvas: out, w, size: 12, baseline: 10 };
  glyphs.set(key, g);
  return g;
}

function glyph(ch, size = 12) {
  const key = size + ':' + ch;
  let g = glyphs.get(key);
  if (g) return g;
  if (size === 12) return baseGlyph12(ch);

  const b = baseGlyph12(ch);
  const s = Math.max(1, Math.round(size / 12));
  const out = document.createElement('canvas');
  out.width = b.w * s; out.height = 12 * s;
  const o = out.getContext('2d');
  o.imageSmoothingEnabled = false;
  o.drawImage(b.canvas, 0, 0, out.width, out.height);
  g = { canvas: out, w: out.width, size: out.height, baseline: 10 * s };
  glyphs.set(key, g);
  return g;
}

function textWidth(str, size = 12) {
  let w = 0;
  for (const ch of Array.from(String(str))) w += glyph(ch, size).w;
  return w;
}

/* x is the anchor; y is the alphabetic baseline, like ctx.fillText(). */
function text(ctx, str, x, y, size = 12, align = 'left') {
  const total = textWidth(str, size);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  ctx.imageSmoothingEnabled = false;
  for (const ch of Array.from(String(str))) {
    const g = glyph(ch, size);
    if (g.w > 0) {
      ctx.drawImage(g.canvas, Math.round(cx), Math.round(y - g.baseline));
    }
    cx += g.w;
  }
}

function fitText(str, maxWidth, size = 12) {
  let out = '';
  for (const ch of Array.from(String(str))) {
    if (textWidth(out + ch, size) > maxWidth) break;
    out += ch;
  }
  return out;
}

function wrapText(str, maxWidth, size = 12) {
  const out = [];
  for (const para of String(str).split('\n')) {
    let line = '';
    for (const ch of Array.from(para)) {
      const test = line + ch;
      if (line && textWidth(test, size) > maxWidth) { out.push(line); line = ch; }
      else line = test;
    }
    out.push(line);
  }
  return out;
}

/* ---------- drawing helpers ---------- */
function fillWhite(ctx) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); }
function hline(ctx, x1, x2, y) { ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1, y + .5); ctx.lineTo(x2, y + .5); ctx.stroke(); }

/* ---------- templates ---------- */
const templates = {
  photo:   { name: '照片', sub: 'Photo', icon: '▧', draw: drawPhoto },
  quote:   { name: '文字海报', sub: 'Quote', icon: '❝', draw: drawQuote },
  year:    { name: '年度进度', sub: 'Year', icon: '◔', draw: drawYear },
  week:    { name: '每周计划', sub: 'Week', icon: '▤', draw: drawWeek },
  todo:    { name: '待办卡片', sub: 'To-do', icon: '☑', draw: drawTodo },
  countdown:{ name: '倒计时', sub: 'Countdown', icon: '◷', draw: drawCountdown },
  moon:    { name: '月相', sub: 'Moon', icon: '◐', draw: drawMoon },
  test:    { name: '测试图', sub: 'Test', icon: '⌗', draw: drawTest }
};

function drawPhoto(ctx) {
  fillWhite(ctx);
  if (!state.photo) {
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.strokeRect(8, 8, W - 16, H - 16); ctx.setLineDash([]);
    text(ctx, '上传一张照片', W / 2, H / 2 - 4, 12, 'center');
    text(ctx, '自动裁切为 ' + W + '×' + H, W / 2, H / 2 + 18, 12, 'center');
    return;
  }
  const img = state.photo;
  const s = Math.max(W / img.width, H / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.imageSmoothingEnabled = false;

  const cap = state.caption.trim();
  if (cap) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, H - 20, W, 20);
    text(ctx, fitText(cap, W - 12, 12), W / 2, H - 5, 12, 'center');
  }
}

function drawQuote(ctx) {
  fillWhite(ctx);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(5, 5, W - 10, H - 10);
  const body = state.quote.trim() || '写点什么';
  const author = state.author.trim().slice(0, 20);
  const size = [12, 24, 48].includes(Number(state.quoteSize)) ? Number(state.quoteSize) : 12;
  const ascent = Math.round(size * 10 / 12);

  if (state.orientation === 'portrait') {
    text(ctx, '“', 10, 30, 24);
    const lh = Math.round(size * 1.3);
    const maxLines = size === 48 ? 3 : size === 24 ? 5 : 9;
    const lines = wrapText(body, W - 24, size).slice(0, maxLines);
    const top = 44, bottom = H - 32;
    const block = lines.length * lh;
    let y = Math.max(top + ascent, top + (bottom - top - block) / 2 + ascent);
    for (const line of lines) { text(ctx, line, 12, y, size); y += lh; }
    if (author) text(ctx, author, 12, H - 18, 12);
    hline(ctx, 12, 34, H - 28);
  } else {
    text(ctx, '“', 10, 28, 24);
    const lh = Math.round(size * 1.15);
    const maxLines = size === 48 ? 1 : size === 24 ? 1 : 3;
    const lines = wrapText(body, W - 26, size).slice(0, maxLines);
    const top = 44, bottom = H - 24;
    const block = lines.length * lh;
    let y = Math.max(top + ascent, top + (bottom - top - block) / 2 + ascent);
    for (const line of lines) { text(ctx, line, 12, y, size); y += lh; }
    if (author) text(ctx, author, 12, H - 8, 12);
    hline(ctx, 12, 34, H - 18);
  }
}

function drawYear(ctx) {
  const year = Number(state.year) || new Date().getFullYear();
  const now = new Date();
  const start = new Date(year, 0, 1), end = new Date(year + 1, 0, 1);
  const total = end - start;
  const done = Math.min(Math.max(now - start, 0), total);
  const pct = total > 0 ? done / total * 100 : 0;
  const left = Math.max(0, Math.ceil((end - Math.max(now, start)) / 86400000));
  fillWhite(ctx);

  if (state.orientation === 'portrait') {
    text(ctx, 'YEAR PROGRESS', W / 2, 20, 12, 'center');
    text(ctx, Math.floor(pct) + '%', W / 2, 72, 48, 'center');
    text(ctx, String(year), W / 2, 92, 12, 'center');
    const bx = 14, by = 110, bw = W - 28, bh = 10;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = '#000'; ctx.fillRect(bx + 2, by + 2, Math.max(0, (bw - 4) * pct / 100), bh - 4);
    text(ctx, left + ' 天', W / 2, 150, 24, 'center');
    text(ctx, '今年还剩', W / 2, 170, 12, 'center');
    for (let i = 1; i < 12; i++) {
      const x = 14 + (W - 28) * i / 12;
      ctx.beginPath(); ctx.moveTo(x, 190); ctx.lineTo(x, i % 3 === 0 ? 200 : 195); ctx.stroke();
    }
    text(ctx, 'JFMAMJJASOND', W / 2, 216, 12, 'center');
  } else {
    text(ctx, 'YEAR', 12, 22, 24);
    text(ctx, Math.floor(pct) + '%', 12, 72, 48);
    text(ctx, String(year), 12, 92, 12);
    const bx = 120, by = 28, bw = W - 132, bh = 8;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = '#000'; ctx.fillRect(bx + 2, by + 2, Math.max(0, (bw - 4) * pct / 100), bh - 4);
    text(ctx, left + ' 天', bx, 62, 24);
    text(ctx, '今年还剩', bx, 82, 12);
    for (let i = 1; i < 12; i++) {
      const x = bx + bw * i / 12;
      ctx.beginPath(); ctx.moveTo(x, 98); ctx.lineTo(x, i % 3 === 0 ? 106 : 102); ctx.stroke();
    }
    text(ctx, 'JFMAMJJASOND', bx, 118, 12);
  }
}

function weekRows() {
  return state.week.split('\n').slice(0, 7);
}

function drawWeek(ctx) {
  fillWhite(ctx);
  const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const range = fmtShort(monday) + ' — ' + fmtShort(sunday);
  const rows = weekRows();
  const days = ['一','二','三','四','五','六','日'];

  if (state.orientation === 'portrait') {
    text(ctx, 'WEEK', 10, 20, 24);
    text(ctx, range, 10, 36, 12);
    hline(ctx, 10, W - 10, 42);
    const top = 52, rh = 27;
    for (let i = 0; i < 7; i++) {
      const y = top + i * rh;
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(10, y, 9, 9);
      text(ctx, days[i], 24, y + 9, 12);
      const t = fitText((rows[i] || '').replace(/^周[一二三四五六日]\s*/, ''), W - 48, 12);
      text(ctx, t, 38, y + 9, 12);
      if (i < 6) hline(ctx, 10, W - 10, y + rh - 3);
    }
  } else {
    text(ctx, 'WEEK', 10, 22, 24);
    text(ctx, range, W - 10, 22, 12, 'right');
    hline(ctx, 10, W - 10, 28);
    for (let i = 0; i < 7; i++) {
      const col = i < 4 ? 0 : 1;
      const row = i < 4 ? i : i - 4;
      const x = col ? 128 : 10;
      const y = 40 + row * 21;
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(x, y, 8, 8);
      text(ctx, days[i], x + 13, y + 8, 12);
      const t = fitText((rows[i] || '').replace(/^周[一二三四五六日]\s*/, ''), (col ? W - 128 : 118) - 36, 12);
      text(ctx, t, x + 28, y + 8, 12);
      if (row < 3) hline(ctx, x, x + (col ? W - 138 : 108), y + 19);
    }
  }
}

function drawTodo(ctx) {
  fillWhite(ctx);
  const rows = state.todo.split('\n').slice(0, 6);
  const d = new Date();

  if (state.orientation === 'portrait') {
    text(ctx, 'TO DO', 10, 24, 24);
    text(ctx, fmt(d), 10, 40, 12);
    hline(ctx, 10, W - 10, 46);
    for (let i = 0; i < 6; i++) {
      const y = 56 + i * 31;
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(10, y, 11, 11);
      text(ctx, fitText(rows[i] || '', W - 38, 12), 27, y + 11, 12);
      if (i < 5) hline(ctx, 10, W - 10, y + 27);
    }
  } else {
    text(ctx, 'TO DO', 10, 24, 24);
    text(ctx, fmt(d), 10, 40, 12);
    hline(ctx, 10, W - 10, 46);
    for (let i = 0; i < 6; i++) {
      const col = i < 3 ? 0 : 1;
      const row = i < 3 ? i : i - 3;
      const x = col ? 128 : 10;
      const y = 54 + row * 26;
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(x, y, 9, 9);
      text(ctx, fitText(rows[i] || '', (col ? W - 128 : 118) - 20, 12), x + 17, y + 10, 12);
      if (row < 2) hline(ctx, x, x + (col ? W - 138 : 108), y + 23);
    }
  }
}

function drawCountdown(ctx) {
  const target = new Date(state.countdownDate + 'T00:00:00');
  const now = new Date();
  let ms = target - now;
  const done = ms <= 0;
  if (done) ms = 0;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor(ms % 86400000 / 3600000);
  const title = fitText(state.countdownTitle || '倒计时', state.orientation === 'landscape' ? 100 : W - 24, 12);
  fillWhite(ctx);

  if (state.orientation === 'portrait') {
    text(ctx, 'COUNTDOWN', W / 2, 20, 12, 'center');
    text(ctx, title, W / 2, 42, 12, 'center');
    text(ctx, done ? '0' : String(days), W / 2, 92, 48, 'center');
    text(ctx, done ? '已到达' : 'DAYS', W / 2, 110, 12, 'center');
    hline(ctx, 24, W - 24, 126);
    text(ctx, done ? '今天' : hours + ' 小时后', W / 2, 142, 12, 'center');
    text(ctx, state.countdownDate, W / 2, 162, 12, 'center');
    text(ctx, '把等待变成期待', W / 2, 192, 12, 'center');
  } else {
    text(ctx, 'COUNTDOWN', 10, 20, 12);
    text(ctx, title, 10, 40, 12);
    text(ctx, done ? '0' : String(days), 62, 88, 48, 'center');
    text(ctx, done ? '已到达' : 'DAYS', 62, 106, 12, 'center');
    ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.moveTo(118, 18); ctx.lineTo(118, H - 12); ctx.stroke();
    text(ctx, done ? '今天' : hours + ' 小时后', 130, 46, 12);
    text(ctx, state.countdownDate, 130, 68, 12);
    text(ctx, '把等待变成期待', 130, 94, 12);
  }
}

function drawMoon(ctx) {
  const d = new Date(state.moonDate + 'T12:00:00');
  const phase = moonPhase(d);
  fillWhite(ctx);
  const landscape = state.orientation === 'landscape';
  const cx = landscape ? 58 : W / 2;
  const cy = landscape ? 68 : 100;
  const r = landscape ? 38 : 42;

  text(ctx, 'MOON PHASE', landscape ? 10 : W / 2, 18, 12, landscape ? 'left' : 'center');
  const sunX = Math.sin(phase * Math.PI * 2);
  const sunZ = -Math.cos(phase * Math.PI * 2);
  ctx.fillStyle = '#000';
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const nx = (x + 0.5 - cx) / r, ny = (y + 0.5 - cy) / r;
      const rr = nx * nx + ny * ny;
      if (rr > 1) continue;
      const nz = Math.sqrt(1 - rr);
      if (nx * sunX + nz * sunZ > 0) ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

  const label = phase < 0.03 || phase > 0.97 ? '新月' : phase < 0.47 ? '上弦' : phase < 0.53 ? '满月' : '下弦';
  const tx = landscape ? 108 : W / 2;
  const align = landscape ? 'left' : 'center';
  text(ctx, label, tx, landscape ? 58 : 174, 24, align);
  text(ctx, fmt(d), tx, landscape ? 82 : 198, 12, align);
  text(ctx, '抬头看看月亮', tx, landscape ? 106 : 220, 12, align);
}

function drawTest(ctx) {
  fillWhite(ctx);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, H - 2);
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const x = 6 + i * (W - 12) / 10, y = 6 + i * (H - 12) / 10;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  const by = Math.round(H / 2) - 30;
  ctx.fillStyle = '#fff'; ctx.fillRect(8, by, W - 16, 60);
  ctx.strokeStyle = '#000'; ctx.strokeRect(8, by, W - 16, 60);
  text(ctx, 'TOP', W / 2, 15, 12, 'center');
  text(ctx, 'BOTTOM', W / 2, H - 4, 12, 'center');
  text(ctx, 'T5 · ' + W + '×' + H, W / 2, H / 2 + 6, 24, 'center');
  text(ctx, '1-bit BLE test', W / 2, H / 2 + 24, 12, 'center');
  text(ctx, 'L', 6, H / 2, 12);
  text(ctx, 'R', W - 6, H / 2, 12, 'right');
}

/* ---------- rendering ---------- */
function fmt(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmtShort(d) {
  return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function moonPhase(date) {
  const known = Date.UTC(2000, 0, 6, 18, 14);
  const synodic = 29.53058867 * 86400000;
  let p = ((date.getTime() - known) % synodic) / synodic;
  if (p < 0) p += 1;
  return p;
}

let packed = new Uint8Array(IMAGE_BYTES);
let bits = new Uint8Array(W * H);

function render() {
  if (!fontReady) return;
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.imageSmoothingEnabled = false;
  bctx.fillStyle = '#fff'; bctx.fillRect(0, 0, W, H);
  (templates[state.template] || templates.quote).draw(bctx);
  const img = bctx.getImageData(0, 0, W, H);
  const dither = state.template === 'photo' ? state.dither : 'threshold';
  bits = quantize(img, dither);
  packed = pack(bits);
  drawPreview();
}

function quantize(img, mode) {
  const d = img.data;
  const n = W * H;
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    gray[i] = Math.round(0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]);
  }
  const out = new Uint8Array(n);
  if (mode === 'threshold' || mode === 'none') {
    for (let i = 0; i < n; i++) out[i] = gray[i] < 145 ? 1 : 0;
    return out;
  }
  if (mode === 'bayer') {
    const B = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = (B[(y & 3) * 4 + (x & 3)] + 0.5) / 16 * 255;
      out[i] = gray[i] < t ? 1 : 0;
    }
    return out;
  }
  const g = new Float32Array(gray);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const old = g[i];
      const nv = old < 128 ? 0 : 255;
      out[i] = nv === 0 ? 1 : 0;
      const err = old - nv;
      if (x + 1 < W) g[i + 1] += err * 7 / 16;
      if (y + 1 < H) {
        if (x > 0) g[i + W - 1] += err * 3 / 16;
        g[i + W] += err * 5 / 16;
        if (x + 1 < W) g[i + W + 1] += err * 1 / 16;
      }
    }
  }
  return out;
}

function pack(viewBits) {
  const out = new Uint8Array(IMAGE_BYTES);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!viewBits[y * W + x]) continue;
      let px, py;
      if (state.orientation === 'portrait') {
        px = x; py = y;
      } else {
        /* 250x122 landscape -> 122x250 portrait, rotate 90° CW */
        px = y; py = PANEL_H - 1 - x;
      }
      out[py * STRIDE + (px >> 3)] |= 1 << (7 - (px & 7));
    }
  }
  return out;
}

function drawPreview() {
  const id = pctx.createImageData(W, H);
  for (let i = 0; i < bits.length; i++) {
    const v = bits[i] ? 0 : 255;
    const p = i * 4;
    id.data[p] = id.data[p + 1] = id.data[p + 2] = v;
    id.data[p + 3] = 255;
  }
  pctx.putImageData(id, 0, 0);
}

/* ---------- orientation ---------- */
function setOrientation(o) {
  state.orientation = o === 'landscape' ? 'landscape' : 'portrait';
  W = state.orientation === 'landscape' ? PANEL_H : PANEL_W;
  H = state.orientation === 'landscape' ? PANEL_W : PANEL_H;
  base.width = W; base.height = H;
  bctx = base.getContext('2d', { willReadFrequently: true });
  preview.width = W; preview.height = H;
  preview.style.width = (W * 2) + 'px';
  preview.style.aspectRatio = W + ' / ' + H;
  document.querySelector('.paperwrap').classList.toggle('landscape', state.orientation === 'landscape');
  $$('#orient button').forEach(b => b.classList.toggle('active', b.dataset.orient === state.orientation));
  render();
}

/* ---------- controls ---------- */
function tplList() {
  $('#tplList').innerHTML = Object.entries(templates).map(([k, t]) =>
    '<button class="tpl" data-tpl="' + k + '"><span class="ico">' + t.icon + '</span>' +
    '<span><span>' + esc(t.name) + '</span><span class="sub">' + esc(t.sub) + '</span></span></button>'
  ).join('');
  $$('#tplList .tpl').forEach(b => b.onclick = () => {
    state.template = b.dataset.tpl;
    renderControls();
    syncTplButtons();
    render();
  });
}
function syncTplButtons() {
  $$('#tplList .tpl').forEach(b => b.classList.toggle('active', b.dataset.tpl === state.template));
}

function renderControls() {
  const c = $('#controls');
  let h = '';
  if (state.template === 'photo') {
    h += '<div class="row"><label>照片</label><input id="photoFile" type="file" accept="image/*"></div>';
    h += '<div class="row"><label>图注（可选）</label><input id="caption" type="text" maxlength="18" value="' + esc(state.caption) + '"></div>';
    h += '<div class="row"><label>抖动</label><select id="dither"><option value="fs">Floyd–Steinberg（照片）</option><option value="bayer">Bayer（纹理）</option><option value="none">无（高对比）</option></select></div>';
    h += '<p class="tiny">原图只在本机 Canvas 里处理，不上传服务器。</p>';
  } else if (state.template === 'quote') {
    h += '<div class="row"><label>正文</label><textarea id="quote" maxlength="180">' + esc(state.quote) + '</textarea></div>';
    h += '<div class="row"><label>正文字号</label><select id="quoteSize"><option value="12">12 px</option><option value="24">24 px</option><option value="48">48 px</option></select></div>';
    h += '<div class="row"><label>署名</label><input id="author" type="text" maxlength="20" value="' + esc(state.author) + '"></div>';
    h += '<p class="tiny">12 / 24 / 48 px 均为 1-bit 点阵字模。大字号行数更少，横屏 24/48 只排一行。</p>';
  } else if (state.template === 'year') {
    h += '<div class="row"><label>年份</label><input id="year" type="number" min="2000" max="2100" value="' + state.year + '"></div>';
    h += '<p class="tiny">按今天在这一年中的位置计算。</p>';
  } else if (state.template === 'week') {
    h += '<div class="row"><label>七行内容（周一到周日）</label><textarea id="week" rows="8">' + esc(state.week) + '</textarea></div>';
    h += '<p class="tiny">每行一条，星期前缀可省略。横屏自动排成两列。</p>';
  } else if (state.template === 'todo') {
    h += '<div class="row"><label>待办（最多六条）</label><textarea id="todo" rows="7">' + esc(state.todo) + '</textarea></div>';
  } else if (state.template === 'countdown') {
    h += '<div class="row"><label>标题</label><input id="cdTitle" type="text" maxlength="16" value="' + esc(state.countdownTitle) + '"></div>';
    h += '<div class="row"><label>日期</label><input id="cdDate" type="date" value="' + esc(state.countdownDate) + '"></div>';
  } else if (state.template === 'moon') {
    h += '<div class="row"><label>日期</label><input id="moonDate" type="date" value="' + esc(state.moonDate) + '"></div>';
    h += '<p class="tiny">月相为近似计算，适合装饰，不用于天文观测。</p>';
  } else {
    h += '<p class="tiny">测试边框、方向、清晰度和全刷效果。发送后看屏幕上的 TOP / BOTTOM。</p>';
  }
  c.innerHTML = h;

  const bind = (id, key, fn) => {
    const el = $('#' + id); if (!el) return;
    el.addEventListener('input', () => { state[key] = fn ? fn(el.value) : el.value; render(); });
  };
  bind('caption', 'caption');
  bind('quote', 'quote');
  const qs = $('#quoteSize');
  if (qs) { qs.value = String(state.quoteSize); qs.onchange = () => { state.quoteSize = Number(qs.value) || 12; render(); }; }
  bind('author', 'author');
  bind('year', 'year', v => Number(v) || new Date().getFullYear());
  bind('week', 'week');
  bind('todo', 'todo');
  bind('cdTitle', 'countdownTitle');
  bind('cdDate', 'countdownDate');
  bind('moonDate', 'moonDate');
  const d = $('#dither'); if (d) { d.value = state.dither; d.onchange = () => { state.dither = d.value; render(); }; }
  const f = $('#photoFile'); if (f) f.onchange = () => {
    const file = f.files && f.files[0]; if (!file) return;
    const img = new Image();
    img.onload = () => { state.photo = img; render(); setStatus('照片已载入，可以发送'); };
    img.onerror = () => setStatus('图片读取失败', 'bad');
    img.src = URL.createObjectURL(file);
  };
}

/* ---------- bluetooth ---------- */
let btDevice = null, btServer = null, btService = null;
let ctrlChar = null, dataChar = null, infoChar = null;
let doneWaiter = null;

async function connect() {
  if (!navigator.bluetooth) {
    setStatus('当前浏览器不支持 Web Bluetooth；Android Chrome / 桌面 Chrome 可用，iPhone Safari 不支持。', 'bad');
    return;
  }
  if (!window.isSecureContext) {
    setStatus('Web Bluetooth 需要 HTTPS（或 localhost）。请用 HTTPS 打开此页面。', 'bad');
    return;
  }
  const btn = $('#connect');
  btn.disabled = true; setStatus('正在搜索 T5…');
  try {
    btDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE] }],
      optionalServices: [SERVICE]
    });
    btDevice.addEventListener('gattserverdisconnected', onDisconnected);
    btServer = await btDevice.gatt.connect();
    btService = await btServer.getPrimaryService(SERVICE);
    ctrlChar = await btService.getCharacteristic(CTRL);
    dataChar = await btService.getCharacteristic(DATA);
    infoChar = await btService.getCharacteristic(INFO);
    const rawInfo = await infoChar.readValue();
    const info = new Uint8Array(rawInfo.buffer, rawInfo.byteOffset, rawInfo.byteLength);
    if (String.fromCharCode(...info.slice(0, 4)) !== 'T5AP') throw new Error('not a T5 AirPage device ' + [...info].map(b => b.toString(16).padStart(2, '0')).join(''));
    const w = info[6] | info[7] << 8, h = info[8] | info[9] << 8, stride = info[10] | info[11] << 8;
    if (w !== PANEL_W || h !== PANEL_H || stride !== STRIDE) throw new Error('panel mismatch ' + w + 'x' + h);
    await ctrlChar.startNotifications();
    ctrlChar.addEventListener('characteristicvaluechanged', onNotify);
    $('#devname').textContent = btDevice.name || 'T5';
    $('#exit').hidden = false;
    $('#send').disabled = false;
    setDot('on'); setStatus('已连接 ' + (btDevice.name || 'T5') + '，可以发送');
    btn.textContent = '已连接'; btn.disabled = true;
  } catch (e) {
    console.warn(e);
    try { if (btDevice && btDevice.gatt.connected) btDevice.gatt.disconnect(); } catch (_) {}
    setStatus('连接失败：' + (e.message || e), 'bad');
    setDot(''); btn.disabled = false;
  }
}

function onDisconnected() {
  ctrlChar = dataChar = infoChar = null; btService = null; btServer = null;
  $('#send').disabled = true; $('#exit').hidden = true;
  $('#devname').textContent = '未连接'; $('#connect').disabled = false; $('#connect').textContent = '连接 T5';
  setDot(''); setStatus('设备已断开，仍在广播');
}

function onNotify(e) {
  const dv = e.target.value;
  if (dv.byteLength < 8 || dv.getUint8(0) !== 0x80) return;
  const code = dv.getUint8(1);
  const val = dv.getUint32(4, true);
  if (code === 0) { setStatus('设备已准备好，接收中…'); setDot('busy'); }
  else if (code === 1) { setStatus('已接收 ' + val + ' 字节，正在刷新屏幕…'); setDot('busy'); }
  else if (code === 2) {
    setStatus('✓ 已显示在 T5 上', 'ok'); setDot('on'); setProgress(100);
    if (doneWaiter) { const r = doneWaiter; doneWaiter = null; r.resolve(); }
  } else {
    const names = {3:'尺寸/格式错误',4:'CRC 校验失败',5:'数据偏移错误',6:'已取消',7:'状态错误',8:'渲染失败',9:'传输超时'};
    const msg = names[code] || ('错误 ' + code);
    setStatus('发送失败：' + msg, 'bad'); setDot('on');
    if (doneWaiter) { const r = doneWaiter; doneWaiter = null; r.reject(new Error(msg)); }
  }
}

function setProgress(p) { $('#bar').style.width = Math.max(0, Math.min(100, p)) + '%'; }

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function waitDone(ms = 30000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { doneWaiter = null; reject(new Error('等待设备超时')); }, ms);
    doneWaiter = {
      resolve: () => { clearTimeout(t); resolve(); },
      reject: (e) => { clearTimeout(t); reject(e); }
    };
  });
}

async function writeCtrl(bytes) { await ctrlChar.writeValueWithResponse(bytes); }
async function writeData(bytes, withResponse) {
  if (withResponse || !dataChar.writeValueWithoutResponse) await dataChar.writeValueWithResponse(bytes);
  else await dataChar.writeValueWithoutResponse(bytes);
}

async function sendImage() {
  if (!ctrlChar || !dataChar) { setStatus('请先连接 T5', 'bad'); return; }
  const btn = $('#send');
  btn.disabled = true; setDot('busy'); setProgress(0);
  try {
    const crc = crc32(packed);
    async function beginTransfer() {
      const begin = new Uint8Array(14);
      const bv = new DataView(begin.buffer);
      bv.setUint8(0, 0x01); bv.setUint32(1, IMAGE_BYTES, true);
      bv.setUint16(5, PANEL_W, true); bv.setUint16(7, PANEL_H, true);
      bv.setUint32(9, crc, true); bv.setUint8(13, 0x01);
      await writeCtrl(begin);
    }

    let chunk = 100;
    let withResponse = false;
    let attempt = 0;
    for (;;) {
      try {
        await beginTransfer();
        let off = 0;
        setProgress(0);
        while (off < IMAGE_BYTES) {
          const n = Math.min(chunk, IMAGE_BYTES - off);
          const buf = new Uint8Array(2 + n);
          new DataView(buf.buffer).setUint16(0, off, true);
          buf.set(packed.subarray(off, off + n), 2);
          await writeData(buf, withResponse);
          off += n;
          setProgress(off / IMAGE_BYTES * 90);
        }
        break;
      } catch (e) {
        if (attempt++ === 0) {
          chunk = 20; withResponse = true;
          setStatus('MTU 较小，改用 20 字节分片…');
          try { await writeCtrl(new Uint8Array([0x04])); } catch (_) {}
          continue;
        }
        throw e;
      }
    }

    setProgress(95);
    const done = waitDone(30000);
    await writeCtrl(new Uint8Array([0x03]));
    setStatus('已发送，等待设备刷新…');
    await done;
  } catch (e) {
    console.warn(e);
    setStatus('发送失败：' + (e.message || e), 'bad');
  } finally {
    btn.disabled = false;
    setDot(btDevice && btDevice.gatt.connected ? 'on' : '');
  }
}

async function disconnectDevice() {
  try { if (btDevice && btDevice.gatt.connected) btDevice.gatt.disconnect(); }
  catch (e) { setStatus('断开失败：' + e.message, 'bad'); }
}

function downloadPng() {
  const a = document.createElement('a');
  a.download = 't5-airpage-' + state.template + '-' + state.orientation + '.png';
  a.href = preview.toDataURL('image/png');
  a.click();
}

/* ---------- boot ---------- */
async function boot() {
  tplList();
  renderControls();
  syncTplButtons();

  $('#connect').onclick = connect;
  $('#send').onclick = sendImage;
  $('#exit').onclick = disconnectDevice;
  $('#download').onclick = downloadPng;
  $$('#orient button').forEach(b => b.onclick = () => setOrientation(b.dataset.orient));

  const compat = $('#compat');
  if (!navigator.bluetooth) {
    compat.classList.add('bad');
    compat.textContent = '此浏览器没有 Web Bluetooth。Android Chrome / 桌面 Chrome 可用；iPhone Safari 不支持，需要原生 App 或 Bluefy。';
  } else if (!window.isSecureContext) {
    compat.classList.add('bad');
    compat.textContent = '当前不是安全上下文。Web Bluetooth 需要 HTTPS 或 localhost。';
  } else {
    compat.textContent = 'Web Bluetooth 已就绪。设备开机即广播，点“连接 T5”。';
  }
  $('#secure').textContent = window.isSecureContext ? 'secure context' : 'insecure context';

  try {
    await loadPixelFont();
    setOrientation('portrait');
  } catch (e) {
    console.error(e);
    setStatus('点阵字体加载失败：' + (e.message || e), 'bad');
  }

  window.__t5editor = {
    state, templates, render, crc32, W, H, PANEL_W, PANEL_H, STRIDE,
    fontSizes: FONT_SIZES, textWidth, glyph,
    getPacked: () => packed,
    getBits: () => bits,
    setOrientation
  };
}
document.addEventListener('DOMContentLoaded', boot);
