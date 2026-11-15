'use strict';

/* ---------- constants ---------- */
const STORE_KEY = 'kerfwise.v1';
const LIMITS = {maxQty: 200, maxItems: 1200, maxDim: 100000, maxKerf: 25, maxLabel: 40, maxRows: 150};
const SEARCH_MS = 650;
const FRAME_MS = 10;
const DEBOUNCE_MS = 220;
const TOAST_MS = 2200;
const EPS = 1e-6;
const MIN_USABLE = 1;
const FIT_RULES = 4;
const SPLIT_RULES = 5;
const OFFCUT_LABEL_SHARE = 0.03;
const FONT_DIVISOR = 40;
const CHAR_W = 0.58;
const MM2_PER_M2 = 1e6;
const HUES = [16, 172, 44, 205, 330, 95, 262, 140, 356, 228, 62, 292];

const SAMPLES = {
  kitchen: {
    stock: {l: '2440', w: '1220', kerf: '3', trim: '0', price: '62'},
    parts: [
      ['Side panel', 720, 560, 6, true], ['Bottom', 564, 560, 3, true], ['Shelf', 564, 540, 3, true],
      ['Back panel', 720, 600, 3, true], ['Stretcher', 564, 100, 8, true], ['Door', 716, 296, 6, false],
      ['Drawer front', 596, 140, 4, false], ['Toe kick', 1800, 100, 1, true],
    ],
  },
  bookshelf: {
    stock: {l: '2440', w: '1220', kerf: '3', trim: '5', price: '54'},
    parts: [
      ['Side', 1800, 300, 2, false], ['Shelf', 764, 300, 5, true], ['Top', 800, 320, 1, true],
      ['Back', 1800, 800, 1, false], ['Plinth', 764, 80, 2, true],
    ],
  },
  workbench: {
    stock: {l: '2440', w: '1220', kerf: '3.2', trim: '0', price: '48'},
    parts: [
      ['Top layer', 1800, 700, 2, true], ['Leg panel', 860, 500, 4, true], ['Lower shelf', 1600, 600, 1, true],
      ['Apron', 1600, 120, 2, true], ['Drawer side', 500, 150, 8, true], ['Drawer front', 450, 150, 4, false],
      ['Drawer bottom', 500, 426, 4, true],
    ],
  },
};
const DEFAULT_SAMPLE = 'kitchen';

/* ---------- small helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = (n) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));
const hue = (pi) => `hsl(${HUES[pi % HUES.length]} 62% ${pi % (HUES.length * 2) < HUES.length ? 76 : 86}%)`;

function num(v) {
  const s = String(v == null ? '' : v).trim().replace(',', '.');
  if (s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
const numOr0 = (v) => (String(v == null ? '' : v).trim() === '' ? 0 : num(v));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleState(key) {
  const s = SAMPLES[key];
  return {
    stock: {...s.stock},
    parts: s.parts.map(([label, l, w, qty, rot]) => ({label, l: String(l), w: String(w), qty: String(qty), rot})),
  };
}

/* ---------- state ---------- */
function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!raw || typeof raw !== 'object' || !raw.stock || !Array.isArray(raw.parts)) return null;
    const str = (v) => String(v == null ? '' : v).slice(0, LIMITS.maxLabel);
    return {
      stock: {l: str(raw.stock.l), w: str(raw.stock.w), kerf: str(raw.stock.kerf), trim: str(raw.stock.trim), price: str(raw.stock.price)},
      parts: raw.parts.slice(0, LIMITS.maxRows).filter((p) => p && typeof p === 'object')
        .map((p) => ({label: str(p.label), l: str(p.l), w: str(p.w), qty: str(p.qty), rot: p.rot !== false})),
    };
  } catch (err) {
    return null;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (err) {
    toast('Could not save on this device (storage is blocked or full).');
  }
}

let state = loadState() || sampleState(DEFAULT_SAMPLE);
let result = null;
let selected = 0;
let step = -1;
let runId = 0;
let seed = 7;
let lastBest = null;
let debounceTimer = 0;
let toastTimer = 0;

/* ---------- job building and validation ---------- */
function buildJob() {
  const st = state.stock;
  const l = num(st.l), w = num(st.w), kerf = numOr0(st.kerf), trim = numOr0(st.trim), price = numOr0(st.price);
  const stockBad = {
    l: !(l > 0 && l <= LIMITS.maxDim),
    w: !(w > 0 && w <= LIMITS.maxDim),
    kerf: !(kerf >= 0 && kerf <= LIMITS.maxKerf),
    trim: !(trim >= 0 && trim * 2 < Math.min(l, w)),
    price: !(price >= 0),
  };
  const stockOk = !Object.values(stockBad).some(Boolean);
  const S = {l, w, kerf, trim, price, uw: l - 2 * trim, uh: w - 2 * trim};
  const items = [], unfit = [], rowBad = [], labels = [];
  let capped = false, pieces = 0;
  state.parts.forEach((p, pi) => {
    const pl = num(p.l), pw = num(p.w), q = num(p.qty);
    const bad = {
      l: !(pl > 0 && pl <= LIMITS.maxDim),
      w: !(pw > 0 && pw <= LIMITS.maxDim),
      qty: !(Number.isInteger(q) && q >= 0 && q <= LIMITS.maxQty),
    };
    labels.push(p.label.trim() || `Part ${pi + 1}`);
    rowBad.push(bad);
    if (bad.l || bad.w || bad.qty || !stockOk) return;
    pieces += q;
    const fits = (pl <= S.uw + EPS && pw <= S.uh + EPS) || (p.rot && pw <= S.uw + EPS && pl <= S.uh + EPS);
    if (!fits) {
      if (q > 0) unfit.push(pi);
      return;
    }
    for (let n = 0; n < q; n++) {
      if (items.length >= LIMITS.maxItems) { capped = true; break; }
      items.push({pi, w: pl, h: pw, rot: p.rot});
    }
  });
  const skipped = rowBad.filter((b) => b.l || b.w || b.qty).length;
  return {S, stockOk, stockBad, items, unfit, rowBad, labels, capped, skipped, pieces, sig: JSON.stringify(state)};
}

/* ---------- guillotine packer ---------- */
function fitScore(rule, f, iw, ih) {
  if (rule === 0) return f.w * f.h - iw * ih;
  if (rule === 1) return Math.min(f.w - iw, f.h - ih);
  if (rule === 2) return Math.max(f.w - iw, f.h - ih);
  return f.y * 1e7 + f.x;
}

function splitHorizontally(rule, f, dw, dh) {
  if (rule === 0) return dw < dh;
  if (rule === 1) return dw >= dh;
  if (rule === 2) return f.w > f.h;
  if (rule === 3) return f.w <= f.h;
  return f.w * dh >= f.h * dw;
}

function placeIn(bin, item, fit, split, k) {
  let best = null;
  const tryOrient = (w, h, rotated) => {
    const iw = w + k, ih = h + k;
    for (let i = 0; i < bin.free.length; i++) {
      const f = bin.free[i];
      if (iw > f.w + EPS || ih > f.h + EPS) continue;
      const sc = fitScore(fit, f, iw, ih);
      if (!best || sc < best.sc) best = {sc, i, w, h, rotated};
    }
  };
  tryOrient(item.w, item.h, false);
  if (item.rot && item.w !== item.h) tryOrient(item.h, item.w, true);
  if (!best) return false;

  const f = bin.free[best.i];
  const {w, h} = best;
  const dw = Math.max(0, f.w - w - k), dh = Math.max(0, f.h - h - k);
  const pw = f.w - k, ph = f.h - k;
  const horizontal = splitHorizontally(split, f, dw, dh);
  const fresh = [];
  if (horizontal) {
    fresh.push({x: f.x + w + k, y: f.y, w: dw, h: h + k}, {x: f.x, y: f.y + h + k, w: f.w, h: dh});
    if (dh > EPS) bin.cuts.push({o: 'h', pos: f.y + h, a: f.x, b: f.x + pw, pw, ph, set: h, pi: item.pi});
    if (dw > EPS) bin.cuts.push({o: 'v', pos: f.x + w, a: f.y, b: f.y + h, pw, ph: h, set: w, pi: item.pi});
  } else {
    fresh.push({x: f.x + w + k, y: f.y, w: dw, h: f.h}, {x: f.x, y: f.y + h + k, w: w + k, h: dh});
    if (dw > EPS) bin.cuts.push({o: 'v', pos: f.x + w, a: f.y, b: f.y + ph, pw, ph, set: w, pi: item.pi});
    if (dh > EPS) bin.cuts.push({o: 'h', pos: f.y + h, a: f.x, b: f.x + w, pw: w, ph, set: h, pi: item.pi});
  }
  bin.free.splice(best.i, 1);
  for (const r of fresh) if (r.w - k >= MIN_USABLE && r.h - k >= MIN_USABLE) bin.free.push(r);
  bin.parts.push({pi: item.pi, x: f.x, y: f.y, w, h, rotated: best.rotated});
  return true;
}

function pack(items, order, fit, split, S) {
  const k = S.kerf;
  const bins = [];
  for (const idx of order) {
    const item = items[idx];
    let done = false;
    for (let b = 0; b < bins.length && !done; b++) done = placeIn(bins[b], item, fit, split, k);
    if (!done) {
      const bin = {free: [{x: 0, y: 0, w: S.uw + k, h: S.uh + k}], parts: [], cuts: []};
      placeIn(bin, item, fit, split, k);
      bins.push(bin);
    }
  }
  return bins;
}

function score(bins, k) {
  let big = 0, cuts = 0;
  for (const b of bins) {
    cuts += b.cuts.length;
    for (const f of b.free) big = Math.max(big, (f.w - k) * (f.h - k));
  }
  return {sheets: bins.length, big, cuts};
}

/** Negative when a is the better layout. */
function cmp(a, b) {
  if (a.sheets !== b.sheets) return a.sheets - b.sheets;
  if (Math.abs(a.big - b.big) > 1) return b.big - a.big;
  return a.cuts - b.cuts;
}

function baseOrders(items) {
  const idx = items.map((_, i) => i);
  const by = (key) => [...idx].sort((a, b) => key(items[b]) - key(items[a]) || a - b);
  return [
    by((it) => it.w * it.h), by((it) => Math.max(it.w, it.h)), by((it) => Math.min(it.w, it.h)),
    by((it) => it.w + it.h), by((it) => it.w), by((it) => it.h),
  ];
}

/* ---------- search ---------- */
function startSolve() {
  const id = ++runId;
  const job = buildJob();
  applyValidity(job);
  renderCount(job);
  if (!job.stockOk || !job.items.length) {
    result = emptyResult(job);
    selected = 0; step = -1;
    renderAll(true);
    return;
  }
  const {items, S} = job;
  const combos = [];
  for (const order of baseOrders(items)) {
    for (let f = 0; f < FIT_RULES; f++) for (let s = 0; s < SPLIT_RULES; s++) combos.push({order, fit: f, split: s});
  }
  const rng = mulberry32(seed);
  let best = lastBest && lastBest.sig === job.sig ? lastBest.best : null;
  let ci = 0, tried = 0, dirty = true;
  const t0 = performance.now();
  step = -1;

  const frame = () => {
    if (id !== runId) return;
    const sliceStart = performance.now();
    do {
      let cand;
      if (ci < combos.length) cand = combos[ci++];
      else cand = mutate(best, rng, items.length);
      const bins = pack(items, cand.order, cand.fit, cand.split, S);
      const sc = score(bins, S.kerf);
      tried++;
      if (!best || cmp(sc, best.sc) <= 0) {
        if (!best || cmp(sc, best.sc) < 0) dirty = true;
        best = {order: cand.order, fit: cand.fit, split: cand.split, bins, sc};
      }
    } while (performance.now() - sliceStart < FRAME_MS);
    const elapsed = performance.now() - t0;
    const done = elapsed >= SEARCH_MS;
    if (dirty || done) {
      result = finalize(best, job, tried, elapsed, done);
      if (selected >= result.sheets.length) selected = 0;
    } else {
      result = {...result, tried, elapsed, done};
    }
    renderAll(dirty || done);
    dirty = false;
    if (done) lastBest = {sig: job.sig, best};
    else requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function mutate(best, rng, n) {
  const order = best.order.slice();
  const swaps = 1 + Math.floor(rng() * 3);
  for (let s = 0; s < swaps && n > 1; s++) {
    const i = Math.floor(rng() * n), j = Math.floor(rng() * n);
    const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
  }
  const keep = rng() < 0.5;
  return {
    order,
    fit: keep ? best.fit : Math.floor(rng() * FIT_RULES),
    split: keep ? best.split : Math.floor(rng() * SPLIT_RULES),
  };
}

function emptyResult(job) {
  return {job, sheets: [], tried: 0, elapsed: 0, done: true, empty: true};
}

function finalize(best, job, tried, elapsed, done) {
  const {S, labels} = job;
  const k = S.kerf;
  const sheetArea = S.l * S.w;
  const sheets = best.bins.map((bin) => {
    const parts = bin.parts.map((p) => ({...p, label: labels[p.pi]}));
    const used = parts.reduce((a, p) => a + p.w * p.h, 0);
    const offcuts = bin.free.map((f) => ({x: f.x, y: f.y, w: f.w - k, h: f.h - k})).sort((a, b) => b.w * b.h - a.w * a.h);
    return {parts, used, offcuts, cuts: bin.cuts.map((c) => ({...c, label: labels[c.pi]})), share: used / sheetArea};
  });
  const partsArea = sheets.reduce((a, s) => a + s.used, 0);
  const lower = Math.max(1, Math.ceil(partsArea / (S.uw * S.uh) - 1e-9));
  let bigOff = null;
  sheets.forEach((s, si) => {
    const o = s.offcuts[0];
    if (o && (!bigOff || o.w * o.h > bigOff.w * bigOff.h)) bigOff = {...o, sheet: si + 1};
  });
  return {
    job, sheets, tried, elapsed, done, empty: false, lower, bigOff, partsArea,
    yield: partsArea / (sheetArea * sheets.length),
    waste: sheetArea * sheets.length - partsArea,
    cost: S.price * sheets.length,
    cuts: sheets.reduce((a, s) => a + s.cuts.length, 0),
  };
}

/* ---------- rendering: inputs ---------- */
function renderStock() {
  for (const key of ['l', 'w', 'kerf', 'trim', 'price']) $(`s-${key}`).value = state.stock[key];
}

function renderParts() {
  const box = $('parts');
  if (!state.parts.length) {
    box.innerHTML = '<p class="empty-parts">No parts yet. Add one, paste a list or load a sample.</p>';
    return;
  }
  box.innerHTML = state.parts.map((p, i) => {
    const n = i + 1;
    return `<div class="prow" data-i="${i}">
      <input class="label" data-f="label" maxlength="${LIMITS.maxLabel}" value="${esc(p.label)}" aria-label="Part ${n} label" style="--swatch:${hue(i)}" autocomplete="off">
      <input data-f="l" inputmode="decimal" value="${esc(p.l)}" aria-label="Part ${n} length in mm" autocomplete="off">
      <input data-f="w" inputmode="decimal" value="${esc(p.w)}" aria-label="Part ${n} width in mm" autocomplete="off">
      <input data-f="qty" inputmode="numeric" value="${esc(p.qty)}" aria-label="Part ${n} quantity" autocomplete="off">
      <input type="checkbox" data-f="rot" ${p.rot ? 'checked' : ''} aria-label="Part ${n} may be rotated" title="Allow rotation (untick to lock the grain)">
      <button type="button" class="del" data-del="${i}" aria-label="Delete part ${n}" title="Delete">×</button>
    </div>`;
  }).join('');
}

function applyValidity(job) {
  for (const key of ['l', 'w', 'kerf', 'trim', 'price']) {
    $(`s-${key}`).setAttribute('aria-invalid', job.stockBad[key] ? 'true' : 'false');
  }
  document.querySelectorAll('#parts .prow').forEach((row) => {
    const bad = job.rowBad[Number(row.dataset.i)] || {};
    for (const f of ['l', 'w', 'qty']) row.querySelector(`[data-f="${f}"]`).classList.toggle('bad', Boolean(bad[f]));
  });
}

function renderCount(job) {
  $('piece-count').textContent = job.stockOk ? `${job.pieces} piece${job.pieces === 1 ? '' : 's'}` : '';
}

/* ---------- rendering: results ---------- */
function stat(k, v, s, hero) {
  return `<div class="stat${hero ? ' hero' : ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
}

function renderStats() {
  const r = result;
  if (r.empty) {
    $('stats').innerHTML = stat('Sheets', '–', 'nothing to cut yet', true) + stat('Yield', '–', '&nbsp;') +
      stat('Waste', '–', '&nbsp;') + stat('Material cost', '–', '&nbsp;') + stat('Largest offcut', '–', '&nbsp;');
    return;
  }
  const n = r.sheets.length;
  const proof = n === r.lower
    ? '<span class="badge">minimum possible</span>'
    : `area alone needs ${r.lower}`;
  const off = r.bigOff && r.bigOff.w >= MIN_USABLE
    ? stat('Largest offcut', `<span class="sm">${Math.floor(r.bigOff.w)}<small> × </small>${Math.floor(r.bigOff.h)}</span>`, `mm, on sheet ${r.bigOff.sheet}`)
    : stat('Largest offcut', '–', 'no usable offcut');
  $('stats').innerHTML =
    stat('Sheets', String(n), proof, true) +
    stat('Yield', `${(r.yield * 100).toFixed(1)}<small>%</small>`, `${r.cuts} saw cuts`) +
    stat('Waste', `${(r.waste / MM2_PER_M2).toFixed(2)}<small> m²</small>`, `of ${(r.job.S.l * r.job.S.w * n / MM2_PER_M2).toFixed(2)} m² bought`) +
    stat('Material cost', r.cost.toFixed(2), `${n} × ${r.job.S.price.toFixed(2)}`) +
    off;
}

function renderStatus() {
  const r = result;
  const bar = $('bar');
  bar.parentElement.classList.toggle('done', r.done);
  bar.style.width = `${r.empty ? 0 : Math.min(100, (r.elapsed / SEARCH_MS) * 100)}%`;
  let text = '';
  if (!r.empty) {
    const tried = r.tried.toLocaleString('en-US');
    text = r.done
      ? `Best of ${tried} layouts found in ${(r.elapsed / 1000).toFixed(2)} s. Press “Optimise again” to search further.`
      : `Trying layouts… ${tried} so far, best uses ${r.sheets.length} sheet${r.sheets.length === 1 ? '' : 's'}.`;
  }
  if ($('status').textContent !== text && (r.done || r.empty)) $('status').textContent = text;
  else if (!r.done) $('status').textContent = text;
}

function renderNotices() {
  const {job} = result;
  const out = [];
  if (!job.stockOk) out.push('<div class="notice err"><b>Check the stock sheet.</b> Length and width must be above zero, kerf between 0 and 25, and the edge trim must leave some sheet.</div>');
  if (job.skipped) out.push(`<div class="notice err"><b>${job.skipped} row${job.skipped === 1 ? '' : 's'} skipped.</b> Fix the outlined fields: sizes must be numbers above zero and quantity a whole number up to ${LIMITS.maxQty}.</div>`);
  if (job.unfit.length) {
    const names = job.unfit.map((pi) => `${esc(job.labels[pi])} (${esc(state.parts[pi].l)} × ${esc(state.parts[pi].w)})`).join(', ');
    out.push(`<div class="notice"><b>Does not fit on the sheet:</b> ${names}. These were left out of the plan.</div>`);
  }
  if (job.capped) out.push(`<div class="notice">Only the first ${LIMITS.maxItems} pieces are planned to keep things fast.</div>`);
  $('notices').innerHTML = out.join('');
}

function textFor(r, line1, line2, fs, cls) {
  const need = line1.length * fs * CHAR_W + fs * 0.6;
  const vertical = r.h > r.w && need > r.w;
  const along = vertical ? r.h : r.w, cross = vertical ? r.w : r.h;
  const maxChars = Math.floor((along - fs * 0.6) / (fs * CHAR_W));
  if (maxChars < 2 || cross < fs * 1.3) return '';
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const tr = vertical ? ` transform="rotate(-90 ${cx} ${cy})"` : '';
  const t1 = line1.length > maxChars ? `${line1.slice(0, Math.max(1, maxChars - 1))}…` : line1;
  const two = line2 && cross >= fs * 2.7 && line2.length <= maxChars;
  if (!two) return `<text class="${cls}" x="${cx}" y="${cy + fs * 0.35}" font-size="${fs}"${tr}>${esc(t1)}</text>`;
  return `<text class="${cls}" x="${cx}" y="${cy - fs * 0.2}" font-size="${fs}"${tr}>${esc(t1)}</text>` +
    `<text class="d" x="${cx}" y="${cy + fs * 0.95}" font-size="${fs * 0.82}"${tr}>${esc(line2)}</text>`;
}

function sheetSvg(sheet, si, S) {
  const fs = Math.max(S.l, S.w) / FONT_DIVISOR;
  const k = S.kerf;
  let g = '';
  for (const o of sheet.offcuts) {
    g += `<rect class="off" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}"></rect>`;
    if (o.w * o.h >= OFFCUT_LABEL_SHARE * S.uw * S.uh) g += textFor(o, `${fmt(o.w)} × ${fmt(o.h)}`, '', fs * 0.82, 'o');
  }
  for (const p of sheet.parts) {
    const dims = `${fmt(p.w)} × ${fmt(p.h)}`;
    g += `<g class="part" data-pi="${p.pi}"><title>${esc(p.label)}: ${dims} mm${p.rotated ? ' (rotated)' : ''}</title>` +
      `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${hue(p.pi)}"></rect>` +
      textFor(p, p.label, dims, fs, 'n') + '</g>';
  }
  if (si === selected) {
    sheet.cuts.forEach((c, i) => {
      const at = c.pos + k / 2;
      const cls = i < step ? 'cut done' : i === step ? 'cut on' : 'cut';
      g += c.o === 'h'
        ? `<line class="${cls}" x1="${c.a}" x2="${c.b}" y1="${at}" y2="${at}"></line>`
        : `<line class="${cls}" x1="${at}" x2="${at}" y1="${c.a}" y2="${c.b}"></line>`;
    });
  }
  const trimBox = S.trim > 0 ? `<rect class="usable" x="${S.trim}" y="${S.trim}" width="${S.uw}" height="${S.uh}"></rect>` : '';
  return `<svg viewBox="0 0 ${S.l} ${S.w}" role="img" aria-label="Sheet ${si + 1}: ${sheet.parts.length} parts">` +
    `<rect class="board" width="${S.l}" height="${S.w}"></rect>${trimBox}` +
    `<g transform="translate(${S.trim} ${S.trim})">${g}</g></svg>`;
}

function renderSheets() {
  const box = $('sheets');
  const r = result;
  if (r.empty) {
    box.innerHTML = r.job.stockOk
      ? '<div class="empty"><b>Nothing to cut yet</b>Add parts on the left, paste a list or load a sample project.</div>'
      : '<div class="empty"><b>Stock sheet needs fixing</b>Correct the outlined fields to see a cutting plan.</div>';
    return;
  }
  box.innerHTML = r.sheets.map((s, si) =>
    `<button type="button" class="sheet" data-sheet="${si}" aria-pressed="${si === selected}">
      <span class="cap"><b>Sheet ${si + 1}</b><span>${s.parts.length} parts · ${(s.share * 100).toFixed(0)}% used</span></span>
      ${sheetSvg(s, si, r.job.S)}
    </button>`).join('');
}

function stepText(c) {
  const piece = `<b>${fmt(c.pw)} × ${fmt(c.ph)}</b>`;
  const action = c.o === 'h'
    ? `Rip the ${piece} piece to <b>${fmt(c.set)}</b> wide`
    : `Cross-cut the ${piece} piece at <b>${fmt(c.set)}</b>`;
  return `${action} <i>for ${esc(c.label)}</i>`;
}

function renderSteps() {
  const r = result;
  const card = $('steps-card');
  card.hidden = r.empty;
  if (r.empty) return;
  const sheet = r.sheets[selected];
  const n = sheet.cuts.length;
  $('steps-title').textContent = `Cut sequence · Sheet ${selected + 1}`;
  $('steps').innerHTML = n
    ? sheet.cuts.map((c, i) => `<li data-step="${i}"><button type="button" data-step="${i}"><span class="num">${i + 1}</span><span>${stepText(c)}</span></button></li>`).join('')
    : '<li>No cuts needed: the part is the whole sheet.</li>';
  updateStep(false);
}

/** Reflects the active step without rebuilding the diagrams. */
function updateStep(scroll) {
  if (!result || result.empty) return;
  const n = result.sheets[selected].cuts.length;
  const mark = (el, i, base) => { el.setAttribute('class', `${base}${i < step ? ' done' : i === step ? ' on' : ''}`.trim()); };
  document.querySelectorAll(`#sheets .sheet[data-sheet="${selected}"] line`).forEach((el, i) => mark(el, i, 'cut'));
  document.querySelectorAll('#steps li[data-step]').forEach((el, i) => {
    mark(el, i, '');
    el.firstElementChild.setAttribute('aria-current', i === step ? 'step' : 'false');
    if (scroll && i === step) el.scrollIntoView({block: 'nearest'});
  });
  $('step-pos').textContent = n ? (step < 0 ? `${n} cuts` : `Cut ${step + 1} of ${n}`) : 'No cuts';
  $('prev').disabled = step < 0;
  $('next').disabled = step >= n - 1;
}

function renderAll(full) {
  renderStatus();
  if (!full) return;
  renderStats();
  renderNotices();
  renderSheets();
  renderSteps();
  const has = !result.empty;
  for (const id of ['csv', 'copy', 'print']) $(id).disabled = !has;
}

function highlight(pi) {
  const box = $('sheets');
  box.classList.toggle('dim', pi >= 0);
  box.querySelectorAll('.part').forEach((el) => el.classList.toggle('hl', Number(el.dataset.pi) === pi));
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), TOAST_MS);
}

/* ---------- export ---------- */
function csvCell(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv() {
  const rows = [['Sheet', 'Part', 'Length', 'Width', 'X', 'Y', 'Rotated']];
  result.sheets.forEach((s, si) => s.parts.forEach((p) =>
    rows.push([si + 1, p.label, fmt(p.w), fmt(p.h), fmt(p.x + result.job.S.trim), fmt(p.y + result.job.S.trim), p.rotated ? 'yes' : 'no'])));
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

function buildText() {
  const {S} = result.job;
  const lines = [
    `Kerfwise cut plan: ${result.sheets.length} sheet(s) of ${fmt(S.l)} × ${fmt(S.w)} mm, kerf ${fmt(S.kerf)} mm, yield ${(result.yield * 100).toFixed(1)}%`,
  ];
  result.sheets.forEach((s, si) => {
    lines.push('', `Sheet ${si + 1} (${(s.share * 100).toFixed(0)}% used)`);
    const groups = new Map();
    for (const p of s.parts) {
      const key = `${p.label} ${fmt(p.w)} × ${fmt(p.h)}`;
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    for (const [key, count] of groups) lines.push(`  ${count} × ${key}`);
    s.cuts.forEach((c, i) => lines.push(`  cut ${i + 1}: ${c.o === 'h' ? 'rip' : 'cross-cut'} ${fmt(c.pw)} × ${fmt(c.ph)} at ${fmt(c.set)} (${c.label})`));
  });
  return lines.join('\n');
}

function downloadCsv() {
  const url = URL.createObjectURL(new Blob([buildCsv()], {type: 'text/csv'}));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'kerfwise-cut-plan.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('CSV downloaded.');
}

function copyText() {
  const text = buildText();
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    ta.remove();
    toast(ok ? 'Cut list copied.' : 'Copy was blocked by the browser.');
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => toast('Cut list copied.'), fallback);
  } else {
    fallback();
  }
}

/* ---------- editing ---------- */
function changed(structural) {
  if (structural) renderParts();
  saveState();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(startSolve, structural ? 0 : DEBOUNCE_MS);
}

function parseBulk(text) {
  const parts = [];
  let bad = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(/\s*[,;\t]\s*/);
    const [label, l, w, q] = cells;
    const qty = cells.length > 3 && q !== '' ? num(q) : 1;
    if (cells.length < 3 || !(num(l) > 0) || !(num(w) > 0) || !Number.isInteger(qty) || qty < 1 || qty > LIMITS.maxQty) { bad++; continue; }
    parts.push({label: label.slice(0, LIMITS.maxLabel), l: String(num(l)), w: String(num(w)), qty: String(qty), rot: true});
  }
  return {parts, bad};
}

function bindEvents() {
  for (const key of ['l', 'w', 'kerf', 'trim', 'price']) {
    $(`s-${key}`).addEventListener('input', (e) => {
      state = {...state, stock: {...state.stock, [key]: e.target.value}};
      changed(false);
    });
  }
  const box = $('parts');
  box.addEventListener('input', (e) => {
    const row = e.target.closest('.prow');
    const field = e.target.dataset.f;
    if (!row || !field) return;
    const i = Number(row.dataset.i);
    const value = field === 'rot' ? e.target.checked : e.target.value;
    state = {...state, parts: state.parts.map((p, n) => (n === i ? {...p, [field]: value} : p))};
    changed(false);
  });
  box.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const i = Number(del.dataset.del);
    state = {...state, parts: state.parts.filter((_, n) => n !== i)};
    changed(true);
  });
  const rowIndex = (e) => { const row = e.target.closest('.prow'); return row ? Number(row.dataset.i) : -1; };
  box.addEventListener('mouseover', (e) => highlight(rowIndex(e)));
  box.addEventListener('mouseleave', () => highlight(-1));
  box.addEventListener('focusin', (e) => highlight(rowIndex(e)));
  box.addEventListener('focusout', () => highlight(-1));

  $('add').addEventListener('click', () => {
    if (state.parts.length >= LIMITS.maxRows) { toast(`Up to ${LIMITS.maxRows} rows.`); return; }
    state = {...state, parts: [...state.parts, {label: '', l: '', w: '', qty: '1', rot: true}]};
    changed(true);
    const rows = box.querySelectorAll('.prow');
    rows[rows.length - 1].querySelector('.label').focus();
  });
  $('reset').addEventListener('click', () => {
    state = sampleState(DEFAULT_SAMPLE);
    try { localStorage.removeItem(STORE_KEY); } catch (err) { /* storage unavailable: nothing to clear */ }
    renderStock(); renderParts();
    clearTimeout(debounceTimer);
    startSolve();
    toast('Sample job restored.');
  });
  $('sample').addEventListener('change', (e) => {
    if (!SAMPLES[e.target.value]) return;
    state = sampleState(e.target.value);
    e.target.value = '';
    renderStock();
    changed(true);
  });
  $('bulk-add').addEventListener('click', () => {
    const {parts, bad} = parseBulk($('bulk-text').value);
    const room = LIMITS.maxRows - state.parts.length;
    const add = parts.slice(0, Math.max(0, room));
    if (add.length) {
      state = {...state, parts: [...state.parts, ...add]};
      $('bulk-text').value = '';
      changed(true);
    }
    const lost = bad + (parts.length - add.length);
    toast(`${add.length} part${add.length === 1 ? '' : 's'} added${lost ? `, ${lost} line${lost === 1 ? '' : 's'} skipped` : ''}.`);
  });

  $('optimise').addEventListener('click', () => { seed += 1; clearTimeout(debounceTimer); startSolve(); });
  $('csv').addEventListener('click', downloadCsv);
  $('copy').addEventListener('click', copyText);
  $('print').addEventListener('click', () => window.print());

  $('sheets').addEventListener('click', (e) => {
    const el = e.target.closest('[data-sheet]');
    if (!el || !result || result.empty) return;
    const si = Number(el.dataset.sheet);
    if (si === selected) return;
    selected = si; step = -1;
    renderSheets(); renderSteps();
    const again = document.querySelector(`#sheets [data-sheet="${si}"]`);
    if (again) again.focus();
  });
  $('steps').addEventListener('click', (e) => {
    const el = e.target.closest('button[data-step]');
    if (!el) return;
    step = Number(el.dataset.step);
    updateStep(false);
  });
  $('next').addEventListener('click', () => { step += 1; updateStep(true); });
  $('prev').addEventListener('click', () => { step -= 1; updateStep(true); });
}

/* ---------- boot ---------- */
renderStock();
renderParts();
bindEvents();
startSolve();
