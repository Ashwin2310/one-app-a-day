'use strict';

/* ---------- constants ---------- */
const STORAGE_KEY = 'ridgeprint:v1';
const LONG_SIDE_NODES = 180;
const NOISE_REF = 1000;
const MAX_DABS = 2000;
const DAB_GAIN = 0.12;
const SIMPLIFY_TOL = 0.45;
const MIN_RING_CELLS = 2.2;
const ELEV_MAX_M = 2400;
const CSS_WARN_KB = 300;
const ASPECTS = { '16:9': [1600, 900], '1:1': [1200, 1200], '4:5': [1200, 1500], '9:16': [1080, 1920] };
const INDEX_OPTIONS = [[0, 'Off'], [4, '4'], [5, '5'], [10, '10']];
const TOOLS = [['raise', 'Raise'], ['carve', 'Carve'], ['look', 'Look']];
const PALETTES = {
  survey: { name: 'Survey', paper: '#f2ead8', ink: '#7a5a2f', low: '#efe4cb', high: '#b98a4e' },
  blueprint: { name: 'Blueprint', paper: '#0e2a4a', ink: '#cfe3ff', low: '#0b2340', high: '#3f7cc0' },
  nightglow: { name: 'Nightglow', paper: '#0a0e16', ink: '#73f0c4', low: '#070a12', high: '#1f6f73' },
  ember: { name: 'Ember', paper: '#24103f', ink: '#ffd7b0', low: '#24103f', high: '#ff9a5c' },
  moss: { name: 'Moss', paper: '#16241a', ink: '#c6e59a', low: '#13201a', high: '#7fa35a' },
  ink: { name: 'Ink', paper: '#fbfbf8', ink: '#141414', low: '#ffffff', high: '#8f8f8f' }
};
const DEFAULTS = Object.freeze({
  seed: 4217, scale: 0.62, detail: 5, ridge: 0.35, sharp: 1.15,
  levels: 22, weight: 1.2, index: 5, fill: false, smooth: true,
  palette: 'survey', colors: { ...PALETTES.survey }, aspect: '16:9',
  tool: 'raise', size: 0.1, strength: 0.5, strokes: [], drift: false
});
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- state ---------- */
let state = loadInitialState();
let grid = null;
let base = null;
let sculpt = null;
let field = null;
let levelsData = [];
let dirty = { field: true, contours: true };
let frameQueued = false;
let driftT = 0;
let activeStroke = null;
let kbBrush = { x: 0.5, y: 0.5, visible: false };

const $ = (id) => document.getElementById(id);
const canvas = $('map');
const ctx = canvas.getContext('2d');

/* ---------- persistence ---------- */
function cloneState(s) {
  return { ...s, colors: { ...s.colors }, strokes: s.strokes.map((g) => g.map((d) => ({ ...d }))) };
}

function sanitize(raw) {
  const s = cloneState(DEFAULTS);
  if (!raw || typeof raw !== 'object') return s;
  const num = (k, lo, hi) => {
    const v = Number(raw[k]);
    if (Number.isFinite(v)) s[k] = Math.min(hi, Math.max(lo, v));
  };
  num('seed', 0, 999999); num('scale', 0.15, 1.6); num('detail', 1, 6); num('ridge', 0, 1); num('sharp', 0.5, 2.5);
  num('levels', 4, 48); num('weight', 0.4, 4); num('size', 0.03, 0.3); num('strength', 0.05, 1);
  s.seed = Math.round(s.seed); s.detail = Math.round(s.detail); s.levels = Math.round(s.levels);
  if (INDEX_OPTIONS.some(([v]) => v === raw.index)) s.index = raw.index;
  ['fill', 'smooth', 'drift'].forEach((k) => { if (typeof raw[k] === 'boolean') s[k] = raw[k]; });
  if (PALETTES[raw.palette] || raw.palette === 'custom') s.palette = raw.palette;
  if (ASPECTS[raw.aspect]) s.aspect = raw.aspect;
  if (TOOLS.some(([v]) => v === raw.tool)) s.tool = raw.tool;
  const hex = /^#[0-9a-f]{6}$/i;
  if (raw.colors && typeof raw.colors === 'object') {
    ['paper', 'ink', 'low', 'high'].forEach((k) => { if (hex.test(raw.colors[k])) s.colors[k] = raw.colors[k]; });
  }
  if (Array.isArray(raw.strokes)) s.strokes = decodeStrokes(raw.strokes);
  return s;
}

function encodeStrokes(strokes) {
  return strokes.map((g) => g.map((d) => [d.x, d.y, d.r, d.a].map((v) => Math.round(v * 1000))));
}

function decodeStrokes(list) {
  let count = 0;
  const out = [];
  for (const g of list) {
    if (!Array.isArray(g)) continue;
    const dabs = g.filter((d) => Array.isArray(d) && d.length === 4 && d.every(Number.isFinite))
      .map(([x, y, r, a]) => ({ x: x / 1000, y: y / 1000, r: Math.max(0.01, r / 1000), a: a / 1000 }));
    count += dabs.length;
    if (count > MAX_DABS) break;
    if (dabs.length) out.push(dabs);
  }
  return out;
}

function serialize(s) {
  const { tool, drift, ...rest } = s;
  return JSON.stringify({ ...rest, tool, strokes: encodeStrokes(s.strokes) });
}

function loadInitialState() {
  const fromHash = readHash();
  if (fromHash) return fromHash;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch (err) {
    console.warn('Ridgeprint: ignoring saved design', err);
  }
  return cloneState(DEFAULTS);
}

function readHash() {
  const m = location.hash.match(/^#d=(.+)$/);
  if (!m) return null;
  try {
    const json = decodeURIComponent(escape(atob(decodeURIComponent(m[1]))));
    return sanitize(JSON.parse(json));
  } catch (err) {
    console.warn('Ridgeprint: share link could not be read', err);
    return null;
  }
}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, serialize(state)); } catch (err) { console.warn('Ridgeprint: could not save', err); }
  }, 300);
}

function shareUrl() {
  const code = btoa(unescape(encodeURIComponent(serialize(state))));
  return location.href.split('#')[0] + '#d=' + encodeURIComponent(code);
}

/* ---------- noise ---------- */
function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed + 1, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function terrain(x, y) {
  let px = x / (state.scale * NOISE_REF) + driftT, py = y / (state.scale * NOISE_REF);
  let amp = 1, total = 0, smooth = 0, ridged = 0;
  for (let o = 0; o < state.detail; o++) {
    const n = valueNoise(px, py, state.seed + o * 101);
    smooth += n * amp;
    const r = 1 - Math.abs(2 * n - 1);
    ridged += r * r * amp;
    total += amp;
    amp *= 0.5;
    const nx = px * 1.6 - py * 1.2, ny = px * 1.2 + py * 1.6;
    px = nx + 17.3; py = ny - 9.1;
  }
  return (smooth + (ridged - smooth) * state.ridge) / total;
}

/* ---------- height field ---------- */
function setupGrid() {
  const [W, H] = ASPECTS[state.aspect];
  const s = Math.max(W, H) / (LONG_SIDE_NODES - 1);
  const NX = Math.ceil(W / s) + 1, NY = Math.ceil(H / s) + 1;
  grid = { W, H, s, NX, NY, PX: NX + 2, PY: NY + 2 };
  const n = grid.PX * grid.PY;
  base = new Float32Array(n);
  sculpt = new Float32Array(n);
  field = new Float32Array(n);
  rebuildSculpt();
}

function buildBase() {
  const { PX, PY, s } = grid;
  let lo = Infinity, hi = -Infinity;
  for (let j = 1; j < PY - 1; j++) {
    for (let i = 1; i < PX - 1; i++) {
      const v = terrain((i - 1) * s, (j - 1) * s);
      base[j * PX + i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const span = hi - lo || 1;
  for (let j = 1; j < PY - 1; j++) {
    for (let i = 1; i < PX - 1; i++) {
      const k = j * PX + i;
      base[k] = Math.pow((base[k] - lo) / span, state.sharp) * 0.96 + 0.02;
    }
  }
}

function applyDab(target, dab) {
  const { PX, PY, s, W, H } = grid;
  const R = dab.r * Math.min(W, H), sigma = R / 2, cut = R * 1.5;
  const cx = dab.x * W, cy = dab.y * H;
  const i0 = Math.max(1, Math.floor((cx - cut) / s) + 1), i1 = Math.min(PX - 2, Math.ceil((cx + cut) / s) + 1);
  const j0 = Math.max(1, Math.floor((cy - cut) / s) + 1), j1 = Math.min(PY - 2, Math.ceil((cy + cut) / s) + 1);
  const inv = 1 / (2 * sigma * sigma);
  for (let j = j0; j <= j1; j++) {
    const dy = (j - 1) * s - cy;
    for (let i = i0; i <= i1; i++) {
      const dx = (i - 1) * s - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 < cut * cut) target[j * PX + i] += dab.a * Math.exp(-d2 * inv);
    }
  }
}

function rebuildSculpt() {
  sculpt.fill(0);
  state.strokes.forEach((g) => g.forEach((d) => applyDab(sculpt, d)));
}

function composeField() {
  const { PX, PY } = grid;
  for (let j = 0; j < PY; j++) {
    for (let i = 0; i < PX; i++) {
      const k = j * PX + i;
      const edge = i === 0 || j === 0 || i === PX - 1 || j === PY - 1;
      field[k] = edge ? -1 : Math.min(1, Math.max(0, base[k] + sculpt[k]));
    }
  }
}

function sampleField(nx, ny) {
  const { PX, s, W, H } = grid;
  const gx = (nx * W) / s + 1, gy = (ny * H) / s + 1;
  const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
  const at = (a, b) => Math.max(0, field[b * PX + a]);
  const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
  const bot = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
  return top + (bot - top) * fy;
}

/* ---------- marching squares ---------- */
// Edges of a cell: 0 top, 1 right, 2 bottom, 3 left. Saddles (5, 10) are resolved by the cell-centre average.
const CASES = [[], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], null, [[0, 2]], [[0, 3]],
  [[0, 3]], [[0, 2]], null, [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], []];

function edgeKey(i, j, e, PX) {
  if (e === 0) return (j * PX + i) * 2;
  if (e === 2) return ((j + 1) * PX + i) * 2;
  if (e === 3) return (j * PX + i) * 2 + 1;
  return (j * PX + i + 1) * 2 + 1;
}

function edgePoint(key, L) {
  const { PX, s } = grid;
  const node = key >> 1, i = node % PX, j = (node - i) / PX;
  const v0 = field[node];
  const v1 = key & 1 ? field[node + PX] : field[node + 1];
  const t = v1 === v0 ? 0.5 : (L - v0) / (v1 - v0);
  return key & 1 ? [(i - 1) * s, (j - 1 + t) * s] : [(i - 1 + t) * s, (j - 1) * s];
}

function cellSegments(idx, a, b, c, d, L) {
  if (idx === 5) return (a + b + c + d) / 4 >= L ? [[0, 3], [2, 1]] : [[0, 1], [3, 2]];
  if (idx === 10) return (a + b + c + d) / 4 >= L ? [[0, 1], [3, 2]] : [[0, 3], [2, 1]];
  return CASES[idx];
}

function traceLevel(L) {
  const { PX, PY } = grid;
  const adj = new Map();
  const link = (p, q) => {
    const lp = adj.get(p);
    if (lp) lp.push(q); else adj.set(p, [q]);
  };
  for (let j = 0; j < PY - 1; j++) {
    for (let i = 0; i < PX - 1; i++) {
      const k = j * PX + i;
      const a = field[k], b = field[k + 1], c = field[k + PX + 1], d = field[k + PX];
      const idx = (a >= L) << 3 | (b >= L) << 2 | (c >= L) << 1 | (d >= L);
      if (idx === 0 || idx === 15) continue;
      for (const [e0, e1] of cellSegments(idx, a, b, c, d, L)) {
        const p = edgeKey(i, j, e0, PX), q = edgeKey(i, j, e1, PX);
        link(p, q); link(q, p);
      }
    }
  }
  return stitch(adj, L);
}

function stitch(adj, L) {
  const seen = new Set();
  const rings = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const keys = [];
    let prev = -1, cur = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      keys.push(cur);
      const nb = adj.get(cur) || [];
      const next = nb[0] !== prev ? nb[0] : nb[1];
      prev = cur;
      cur = next;
    }
    if (keys.length >= 4) rings.push(keys.map((k) => edgePoint(k, L)));
  }
  return rings;
}

/* ---------- smoothing ---------- */
function decimate(pts, minD) {
  const out = [pts[0]];
  const m2 = minD * minD;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = out[out.length - 1];
    const dx = pts[i][0] - x, dy = pts[i][1] - y;
    if (dx * dx + dy * dy >= m2) out.push(pts[i]);
  }
  return out.length >= 3 ? out : pts;
}

function chaikin(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    out.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
  }
  return out;
}

function rdp(pts, tol) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  let worst = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= tol) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, at + 1), tol).slice(0, -1), ...rdp(pts.slice(at), tol)];
}

function simplifyRing(pts, tol) {
  let far = 0, best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > best) { best = d; far = i; }
  }
  const a = rdp(pts.slice(0, far + 1), tol), b = rdp([...pts.slice(far), pts[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function bigEnough(ring) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  ring.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
  return Math.max(x1 - x0, y1 - y0) >= grid.s * MIN_RING_CELLS;
}

function shapeRing(ring) {
  const shaped = state.smooth ? chaikin(chaikin(decimate(ring, grid.s * 0.55))) : ring;
  return simplifyRing(shaped, SIMPLIFY_TOL);
}

function buildContours() {
  levelsData = [];
  for (let k = 1; k <= state.levels; k++) {
    const L = k / (state.levels + 1);
    const rings = traceLevel(L).filter(bigEnough).map(shapeRing).filter((r) => r.length >= 3);
    const path = new Path2D();
    rings.forEach((r) => {
      path.moveTo(r[0][0], r[0][1]);
      for (let i = 1; i < r.length; i++) path.lineTo(r[i][0], r[i][1]);
      path.closePath();
    });
    levelsData.push({ k, rings, path });
  }
}

/* ---------- drawing ---------- */
function mixHex(h1, h2, t) {
  const p = (h, o) => parseInt(h.slice(o, o + 2), 16);
  const c = [1, 3, 5].map((o) => Math.round(p(h1, o) + (p(h2, o) - p(h1, o)) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function styleFor(k) {
  const isIndex = state.index > 0 && k % state.index === 0;
  const alpha = state.fill ? (isIndex ? 0.9 : 0.5) : (isIndex ? 1 : 0.78);
  return { width: state.weight * (isIndex ? 2.2 : 1), alpha };
}

function bandColor(k) {
  return mixHex(state.colors.low, state.colors.high, k / state.levels);
}

function draw(target, scale) {
  const c = target.getContext('2d');
  c.setTransform(scale, 0, 0, scale, 0, 0);
  c.globalAlpha = 1;
  c.fillStyle = state.fill ? bandColor(0) : state.colors.paper;
  c.fillRect(0, 0, grid.W, grid.H);
  if (state.fill) {
    levelsData.forEach(({ k, path }) => { c.fillStyle = bandColor(k); c.fill(path, 'evenodd'); });
  }
  c.strokeStyle = state.colors.ink;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  levelsData.forEach(({ k, path }) => {
    const st = styleFor(k);
    c.globalAlpha = st.alpha;
    c.lineWidth = st.width;
    c.stroke(path);
  });
  c.globalAlpha = 1;
}

function render() {
  frameQueued = false;
  if (dirty.field) { buildBase(); dirty.contours = true; dirty.field = false; }
  if (dirty.contours) { composeField(); buildContours(); dirty.contours = false; updateStats(); }
  draw(canvas, canvas.width / grid.W);
  if (state.drift && !reducedMotion) {
    driftT += 0.0025;
    dirty.field = true;
    queue();
  }
}

function queue(level) {
  if (level === 'field') dirty.field = true;
  if (level === 'contours') dirty.contours = true;
  if (!frameQueued) { frameQueued = true; requestAnimationFrame(render); }
}

function updateStats() {
  const paths = levelsData.reduce((n, l) => n + l.rings.length, 0);
  const pts = levelsData.reduce((n, l) => n + l.rings.reduce((m, r) => m + r.length, 0), 0);
  const fmt = pts > 9999 ? (pts / 1000).toFixed(1) + 'k' : String(pts);
  $('stats').textContent = `${state.levels} levels · ${paths} paths · ${fmt} pts`;
}

function sizeFrame() {
  const [W, H] = ASPECTS[state.aspect];
  const stage = document.querySelector('.stage');
  const stacked = window.innerWidth <= 920;
  const maxH = Math.max(300, stacked ? window.innerHeight * 0.72 : window.innerHeight - 170);
  const width = Math.floor(Math.min(stage.clientWidth, (maxH * W) / H));
  const height = Math.round((width * H) / W);
  const frame = $('frame');
  frame.style.width = width + 'px';
  frame.style.height = height + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  queue();
}

/* ---------- sculpting ---------- */
function dabCount() {
  return state.strokes.reduce((n, g) => n + g.length, 0);
}

function pointerToNorm(ev) {
  const r = canvas.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
}

function addDab(p) {
  if (dabCount() >= MAX_DABS) {
    toast(`Sculpt limit reached (${MAX_DABS} dabs). Undo or Flatten to keep painting.`);
    activeStroke = null;
    return false;
  }
  const sign = state.tool === 'carve' ? -1 : 1;
  const dab = { x: p.x, y: p.y, r: state.size, a: sign * state.strength * DAB_GAIN };
  activeStroke.push(dab);
  applyDab(sculpt, dab);
  queue('contours');
  return true;
}

function beginStroke(p) {
  activeStroke = [];
  state.strokes = [...state.strokes, activeStroke];
  addDab(p);
}

function endStroke() {
  if (activeStroke && !activeStroke.length) state.strokes = state.strokes.filter((g) => g !== activeStroke);
  activeStroke = null;
  syncButtons();
  save();
}

function placeRing(p) {
  const ring = $('ring');
  const r = canvas.getBoundingClientRect();
  const d = state.size * Math.min(r.width, r.height) * 2;
  ring.style.width = ring.style.height = d + 'px';
  ring.style.left = p.x * r.width + 'px';
  ring.style.top = p.y * r.height + 'px';
  ring.classList.toggle('on', state.tool !== 'look');
  ring.classList.toggle('carve', state.tool === 'carve');
}

function showElevation(p) {
  const h = sampleField(Math.min(1, Math.max(0, p.x)), Math.min(1, Math.max(0, p.y)));
  const contour = Math.floor(h * (state.levels + 1));
  $('elev').textContent = `Elev ${Math.round(h * ELEV_MAX_M).toLocaleString('en-US')} m · contour ${contour}`;
}

function onPointerDown(ev) {
  if (state.tool === 'look' || ev.button > 0) return;
  ev.preventDefault();
  canvas.setPointerCapture(ev.pointerId);
  const p = pointerToNorm(ev);
  beginStroke(p);
  activeStroke && (activeStroke.last = p);
}

function onPointerMove(ev) {
  const p = pointerToNorm(ev);
  placeRing(p);
  showElevation(p);
  if (!activeStroke) return;
  const last = activeStroke.last;
  const step = state.size * 0.18;
  const dist = Math.hypot(p.x - last.x, (p.y - last.y) * grid.H / grid.W);
  if (dist < step) return;
  const n = Math.min(12, Math.floor(dist / step));
  for (let i = 1; i <= n && activeStroke; i++) {
    const t = i / n;
    addDab({ x: last.x + (p.x - last.x) * t, y: last.y + (p.y - last.y) * t });
  }
  if (activeStroke) activeStroke.last = p;
}

function onPointerUp() {
  if (activeStroke) delete activeStroke.last;
  endStroke();
}

function onCanvasKey(ev) {
  const key = ev.key.toLowerCase();
  const tools = { r: 'raise', c: 'carve', l: 'look' };
  if (tools[key] && !ev.metaKey && !ev.ctrlKey) { setTool(tools[key]); return; }
  const moves = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (moves[key]) {
    ev.preventDefault();
    const [dx, dy] = moves[key];
    kbBrush = { x: Math.min(1, Math.max(0, kbBrush.x + dx * 0.03)), y: Math.min(1, Math.max(0, kbBrush.y + dy * 0.03)), visible: true };
    placeRing(kbBrush);
    showElevation(kbBrush);
  } else if (key === 'enter' || key === ' ') {
    ev.preventDefault();
    if (state.tool === 'look') { toast('Pick Raise or Carve (R / C) to sculpt.'); return; }
    beginStroke(kbBrush);
    for (let i = 0; i < 3 && activeStroke; i++) addDab(kbBrush);
    endStroke();
    placeRing(kbBrush);
  }
}

function undo() {
  if (!state.strokes.length) { toast('Nothing to undo.'); return; }
  state.strokes = state.strokes.slice(0, -1);
  rebuildSculpt();
  queue('contours');
  syncButtons();
  save();
}

/* ---------- exports ---------- */
const r1 = (v) => Math.round(v * 10) / 10;

function ringsToD(rings) {
  return rings.map((r) => 'M' + r.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(' ') + 'Z').join('');
}

function toSVG() {
  const { W, H } = grid;
  const bg = state.fill ? bandColor(0) : state.colors.paper;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    `<rect width="${W}" height="${H}" fill="${bg}"/>`];
  if (state.fill) {
    out.push('<g id="bands" fill-rule="evenodd">');
    levelsData.forEach(({ k, rings }) => { if (rings.length) out.push(`<path id="band-${k}" fill="${bandColor(k)}" d="${ringsToD(rings)}"/>`); });
    out.push('</g>');
  }
  out.push(`<g id="contours" fill="none" stroke="${state.colors.ink}" stroke-linejoin="round" stroke-linecap="round">`);
  levelsData.forEach(({ k, rings }) => {
    if (!rings.length) return;
    const st = styleFor(k);
    out.push(`<path id="contour-${k}" stroke-width="${r1(st.width)}" stroke-opacity="${st.alpha}" d="${ringsToD(rings)}"/>`);
  });
  out.push('</g></svg>');
  return out.join('\n');
}

function fileBase() {
  return `ridgeprint-${state.seed}-${state.aspect.replace(':', 'x')}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportSvg() {
  const svg = toSVG();
  const paths = levelsData.filter((l) => l.rings.length).length;
  download(new Blob([svg], { type: 'image/svg+xml' }), fileBase() + '.svg');
  toast(`SVG saved: ${paths} layered paths, ${Math.round(svg.length / 1024)} KB`);
}

function exportPng() {
  const off = document.createElement('canvas');
  off.width = grid.W * 2;
  off.height = grid.H * 2;
  draw(off, 2);
  off.toBlob((blob) => {
    if (!blob) { toast('PNG export failed in this browser.'); return; }
    download(blob, fileBase() + '@2x.png');
    toast(`PNG saved: ${off.width} × ${off.height}`);
  }, 'image/png');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) console.warn('Ridgeprint: clipboard unavailable', err);
    return ok;
  }
}

async function copyCss() {
  const svg = toSVG().replace(/\n/g, '').replace(/"/g, "'").replace(/[%#()<>?[\\\]^`{|}]/g, encodeURIComponent);
  const css = `background-color: ${state.fill ? bandColor(0) : state.colors.paper};\nbackground-image: url("data:image/svg+xml,${svg}");\nbackground-size: cover;\nbackground-position: center;`;
  const kb = Math.round(css.length / 1024);
  const ok = await copyText(css);
  if (!ok) { toast('Could not reach the clipboard. Try Export SVG instead.'); return; }
  toast(kb > CSS_WARN_KB ? `CSS copied (${kb} KB: large, try fewer levels or Smooth off)` : `CSS background copied (${kb} KB)`);
}

async function copyLink() {
  const url = shareUrl();
  history.replaceState(null, '', url);
  const ok = await copyText(url);
  toast(ok ? 'Share link copied: it rebuilds this exact design.' : 'Link is in the address bar; copy it from there.');
}

/* ---------- UI ---------- */
let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

const SLIDERS = {
  scale: ['field', (v) => v.toFixed(2)], detail: ['field', (v) => `${v} oct`], ridge: ['field', (v) => `${Math.round(v * 100)}%`],
  sharp: ['field', (v) => v.toFixed(2)], levels: ['contours', String], weight: ['draw', (v) => `${v.toFixed(1)} px`],
  size: ['draw', (v) => `${Math.round(v * 100)}%`], strength: ['draw', (v) => `${Math.round(v * 100)}%`]
};

function buildSeg(id, options, key, onPick) {
  const seg = $(id);
  seg.innerHTML = '';
  options.forEach(([value, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.value = String(value);
    b.textContent = label;
    b.addEventListener('click', () => onPick(value));
    seg.appendChild(b);
  });
  seg.addEventListener('keydown', (ev) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
    ev.preventDefault();
    const i = options.findIndex(([v]) => v === state[key]);
    const n = (i + (ev.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    onPick(options[n][0]);
    seg.querySelector(`[data-value="${options[n][0]}"]`).focus();
  });
}

function buildSwatches() {
  const box = $('swatches');
  Object.entries(PALETTES).forEach(([id, p]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.setAttribute('role', 'radio');
    b.dataset.value = id;
    b.innerHTML = `<span class="chip"></span><span class="name">${p.name}</span>`;
    b.querySelector('.chip').style.background = `linear-gradient(135deg, ${p.paper} 0 45%, ${p.ink} 45% 60%, ${p.high} 60%)`;
    b.addEventListener('click', () => setPalette(id));
    box.appendChild(b);
  });
}

function setPalette(id) {
  const { name, ...colors } = PALETTES[id];
  state = { ...state, palette: id, colors };
  syncControls();
  commit('draw');
}

function setTool(tool) {
  state = { ...state, tool };
  canvas.classList.toggle('look', tool === 'look');
  $('ring').classList.toggle('on', false);
  syncControls();
  save();
}

function setAspect(aspect) {
  state = { ...state, aspect };
  setupGrid();
  syncControls();
  sizeFrame();
  commit('field');
}

function commit(level) {
  queue(level);
  save();
}

function syncSeg(id, value) {
  $(id).querySelectorAll('button').forEach((b) => {
    const on = b.dataset.value === String(value);
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  const btns = $(id).querySelectorAll('button');
  if (btns.length && ![...btns].some((b) => b.tabIndex === 0)) btns[0].tabIndex = 0;
}

function syncButtons() {
  $('undo').disabled = !state.strokes.length;
  $('flatten').disabled = !state.strokes.length;
}

function syncControls() {
  $('seed').value = state.seed;
  Object.entries(SLIDERS).forEach(([k, [, fmt]]) => {
    $(k).value = state[k];
    $(k + 'Out').textContent = fmt(state[k]);
  });
  $('fill').checked = state.fill;
  $('smooth').checked = state.smooth;
  $('drift').checked = state.drift && !reducedMotion;
  $('cPaper').value = state.colors.paper;
  $('cInk').value = state.colors.ink;
  $('cLow').value = state.colors.low;
  $('cHigh').value = state.colors.high;
  syncSeg('indexSeg', state.index);
  syncSeg('toolSeg', state.tool);
  syncSeg('aspectSeg', state.aspect);
  syncSeg('swatches', state.palette);
  canvas.classList.toggle('look', state.tool === 'look');
  syncButtons();
}

function bindControls() {
  Object.entries(SLIDERS).forEach(([k, [level, fmt]]) => {
    $(k).addEventListener('input', (ev) => {
      state = { ...state, [k]: Number(ev.target.value) };
      $(k + 'Out').textContent = fmt(state[k]);
      commit(level);
    });
  });
  $('seed').addEventListener('change', (ev) => {
    const v = Number(ev.target.value);
    if (!Number.isInteger(v) || v < 0 || v > 999999) { ev.target.value = state.seed; toast('Seed must be a whole number from 0 to 999999.'); return; }
    state = { ...state, seed: v };
    commit('field');
  });
  $('shuffle').addEventListener('click', () => {
    state = { ...state, seed: Math.floor(Math.random() * 1000000) };
    $('seed').value = state.seed;
    commit('field');
  });
  ['fill', 'smooth'].forEach((k) => $(k).addEventListener('change', (ev) => {
    state = { ...state, [k]: ev.target.checked };
    commit(k === 'smooth' ? 'contours' : 'draw');
  }));
  $('drift').addEventListener('change', (ev) => {
    state = { ...state, drift: ev.target.checked };
    queue('field');
  });
  [['cPaper', 'paper'], ['cInk', 'ink'], ['cLow', 'low'], ['cHigh', 'high']].forEach(([id, key]) => {
    $(id).addEventListener('input', (ev) => {
      state = { ...state, palette: 'custom', colors: { ...state.colors, [key]: ev.target.value } };
      syncSeg('swatches', 'custom');
      commit('draw');
    });
  });
  bindActions();
}

function bindActions() {
  $('undo').addEventListener('click', undo);
  $('flatten').addEventListener('click', () => {
    state = { ...state, strokes: [] };
    rebuildSculpt();
    syncButtons();
    commit('contours');
    toast('Sculpting cleared.');
  });
  $('reset').addEventListener('click', () => {
    state = { ...cloneState(DEFAULTS), seed: state.seed, aspect: state.aspect };
    setupGrid();
    syncControls();
    commit('field');
    toast('Design reset (seed kept).');
  });
  $('exportSvg').addEventListener('click', exportSvg);
  $('exportPng').addEventListener('click', exportPng);
  $('copyCss').addEventListener('click', copyCss);
  $('copyLink').addEventListener('click', copyLink);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', () => { if (!activeStroke) $('ring').classList.remove('on'); });
  canvas.addEventListener('keydown', onCanvasKey);
  canvas.addEventListener('blur', () => $('ring').classList.remove('on'));
  document.addEventListener('keydown', (ev) => {
    const typing = ev.target instanceof HTMLInputElement && ['number', 'text'].includes(ev.target.type);
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z' && !typing) { ev.preventDefault(); undo(); }
  });
  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(sizeFrame, 100); });
}

function init() {
  buildSeg('indexSeg', INDEX_OPTIONS, 'index', (v) => { state = { ...state, index: v }; syncSeg('indexSeg', v); commit('draw'); });
  buildSeg('toolSeg', TOOLS, 'tool', setTool);
  buildSeg('aspectSeg', Object.keys(ASPECTS).map((a) => [a, a]), 'aspect', setAspect);
  buildSwatches();
  if (reducedMotion) {
    $('drift').disabled = true;
    $('drift').parentElement.title = 'Disabled because your system prefers reduced motion';
  }
  setupGrid();
  syncControls();
  bindControls();
  sizeFrame();
}

init();
