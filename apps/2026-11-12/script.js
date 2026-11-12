'use strict';

/* ============================================================
   Hazeloom: mesh gradient studio
   Field render: inverse-distance weights, blended in OKLab.
   ============================================================ */

const STORAGE_KEY = 'hazeloom.v1';
const FIELD_W = 260;
const MIN_POINTS = 2;
const MAX_POINTS = 10;
const GRAIN_TILE = 192;
const DRIFT = 0.045;
const HEX_RE = /^#[0-9a-f]{6}$/i;

const RATIOS = [
  { id: '16:9', label: 'Hero 16:9', w: 16, h: 9 },
  { id: '1:1', label: 'Square 1:1', w: 1, h: 1 },
  { id: '4:5', label: 'Portrait 4:5', w: 4, h: 5 },
  { id: '9:16', label: 'Story 9:16', w: 9, h: 16 }
];

const LAYOUTS = {
  4: [[0.15, 0.2, 0.65], [0.85, 0.25, 0.6], [0.25, 0.85, 0.6], [0.8, 0.8, 0.65]],
  5: [[0.12, 0.18, 0.55], [0.78, 0.14, 0.6], [0.52, 0.55, 0.5], [0.18, 0.85, 0.6], [0.88, 0.82, 0.55]],
  6: [[0.1, 0.15, 0.5], [0.5, 0.08, 0.5], [0.9, 0.2, 0.5], [0.2, 0.75, 0.55], [0.6, 0.6, 0.45], [0.92, 0.9, 0.5]]
};

const PRESETS = [
  { name: 'Aurora', colors: ['#0b1d4f', '#22d3a6', '#7c5cff', '#13b5ea', '#ff5fa2'], softness: 1.8, swirl: 0.06, grain: 0.12 },
  { name: 'Peach Fuzz', colors: ['#ffbe98', '#ff8a7a', '#ffe1c4', '#f7a072', '#fff0e3'], softness: 1.6, swirl: 0.03, grain: 0.1 },
  { name: 'Lagoon', colors: ['#00b4d8', '#0077b6', '#90e0ef', '#023e8a'], softness: 1.7, swirl: 0.08, grain: 0.08 },
  { name: 'Ember', colors: ['#ff4d00', '#ffb000', '#7a0b2e', '#ff7a3d', '#2a0a1a'], softness: 1.9, swirl: 0.1, grain: 0.18 },
  { name: 'Lavender Haze', colors: ['#c3b1e1', '#9d8df1', '#f2c6de', '#b8e0ff', '#e8dcff'], softness: 1.4, swirl: 0.02, grain: 0.08 },
  { name: 'Citrus', colors: ['#f9f871', '#ffc75f', '#7ee081', '#ff9671'], softness: 1.7, swirl: 0.05, grain: 0.1 },
  { name: 'Midnight', colors: ['#0f0c29', '#302b63', '#ff3cac', '#24243e', '#6a4cff', '#0b3d91'], softness: 2.0, swirl: 0.07, grain: 0.16 },
  { name: 'Sorbet', colors: ['#ff9a9e', '#fad0c4', '#a1c4fd', '#c2e9fb', '#fbc2eb'], softness: 1.5, swirl: 0.04, grain: 0.06 },
  { name: 'Forest', colors: ['#0b3d2e', '#2d6a4f', '#95d5b2', '#d8f3dc', '#1b4332'], softness: 1.8, swirl: 0.09, grain: 0.14 },
  { name: 'Neon', colors: ['#ff00a8', '#00f0ff', '#7000ff', '#1a0033', '#00ff94', '#ffe600'], softness: 2.2, swirl: 0.12, grain: 0.1 },
  { name: 'Dune', colors: ['#e9c46a', '#f4a261', '#e76f51', '#264653', '#fefae0'], softness: 1.9, swirl: 0.05, grain: 0.2 },
  { name: 'Glacier', colors: ['#e0fbfc', '#98c1d9', '#3d5a80', '#c2dfe3'], softness: 1.6, swirl: 0.04, grain: 0.07 }
];

/* ---------- Small utilities ---------- */

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
let idCounter = 0;
const newId = () => `p${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- Colour science (sRGB <-> OKLab) ---------- */

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const LIN_LUT = new Float32Array(256).map((_, i) => toLinear(i / 255));
const GAMMA_LUT_SIZE = 4096;
const GAMMA_LUT = new Uint8ClampedArray(GAMMA_LUT_SIZE + 1)
  .map((_, i) => Math.round(toGamma(i / GAMMA_LUT_SIZE) * 255));

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function linearToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
}

function hexToOklab(hex) {
  const [r, g, b] = hexToRgb(hex);
  return linearToOklab(LIN_LUT[r], LIN_LUT[g], LIN_LUT[b]);
}

function linToByte(c) {
  return GAMMA_LUT[Math.round(clamp(c, 0, 1) * GAMMA_LUT_SIZE)];
}

function oklabToHex([L, a, b]) {
  return rgbToHex(oklabToLinear(L, a, b).map(linToByte));
}

function inGamut(lin) {
  return lin.every((c) => c >= -0.0005 && c <= 1.0005);
}

/** OKLCH -> hex, reducing chroma until the colour fits in sRGB. */
function oklchToHex(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  let c = C;
  while (c > 0 && !inGamut(oklabToLinear(L, c * Math.cos(h), c * Math.sin(h)))) c -= 0.005;
  return oklabToHex([L, Math.max(c, 0) * Math.cos(h), Math.max(c, 0) * Math.sin(h)]);
}

function hexToOklch(hex) {
  const [L, a, b] = hexToOklab(hex);
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

const luminance = (r8, g8, b8) => 0.2126 * LIN_LUT[r8] + 0.7152 * LIN_LUT[g8] + 0.0722 * LIN_LUT[b8];
const contrastRatio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

/* ---------- State (immutable updates) ---------- */

const update = (obj, patch) => ({ ...obj, ...patch });

function presetState(preset, base) {
  const layout = LAYOUTS[preset.colors.length];
  const points = preset.colors.map((color, i) => ({
    id: newId(), x: layout[i][0], y: layout[i][1], spread: layout[i][2], color
  }));
  return update(base, {
    points, softness: preset.softness, swirl: preset.swirl, grain: preset.grain,
    preset: preset.name, selectedId: points[0].id
  });
}

const DEFAULT_BASE = { ratio: '16:9', headline: true, seed: 7, preset: 'Aurora' };
const defaultState = () => presetState(PRESETS[0], DEFAULT_BASE);

function validPoint(p) {
  return p && typeof p.id === 'string' && HEX_RE.test(p.color) &&
    [p.x, p.y, p.spread].every((n) => typeof n === 'number' && Number.isFinite(n));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const ok = Array.isArray(s.points) && s.points.length >= MIN_POINTS &&
      s.points.length <= MAX_POINTS && s.points.every(validPoint) &&
      RATIOS.some((r) => r.id === s.ratio);
    if (!ok) return defaultState();
    return {
      points: s.points.map((p) => ({
        id: p.id, color: p.color.toLowerCase(),
        x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1), spread: clamp(p.spread, 0.1, 1)
      })),
      softness: clamp(Number(s.softness) || 1.8, 0.6, 3),
      swirl: clamp(Number(s.swirl) || 0, 0, 0.25),
      grain: clamp(Number(s.grain) || 0, 0, 0.35),
      ratio: s.ratio,
      headline: Boolean(s.headline),
      seed: Number.isInteger(s.seed) ? s.seed : 7,
      preset: typeof s.preset === 'string' ? s.preset : null,
      selectedId: s.points[0].id
    };
  } catch (err) {
    console.warn('Hazeloom: could not restore saved design, using default.', err);
    return defaultState();
  }
}

function saveState(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (err) {
    console.warn('Hazeloom: could not save design.', err);
  }
}

/* ---------- Field rendering ---------- */

/** Points as they appear at time t (drift applies only while animating). */
function effectivePoints(points, t, animating) {
  if (!animating) return points;
  return points.map((p, i) => ({
    ...p,
    x: clamp(p.x + DRIFT * Math.sin(t * (0.35 + i * 0.07) + i * 1.7), 0, 1),
    y: clamp(p.y + DRIFT * Math.cos(t * (0.29 + i * 0.05) + i * 2.3), 0, 1)
  }));
}

function renderField(state, points, fw, fh, t) {
  const img = new ImageData(fw, fh);
  const data = img.data;
  const ar = fw / fh;
  const spreadScale = Math.max(ar, 1);
  const exponent = 3.6 - state.softness;
  const swirl = state.swirl;
  const phase = (state.seed % 97) * 0.37;
  const n = points.length;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const inv = new Float32Array(n);
  const labs = points.map((p) => hexToOklab(p.color));
  points.forEach((p, i) => {
    px[i] = p.x * ar;
    py[i] = p.y;
    const s = p.spread * spreadScale;
    inv[i] = 1 / (s * s);
  });
  const w = new Float32Array(n);
  let o = 0;
  for (let j = 0; j < fh; j++) {
    const v0 = (j + 0.5) / fh;
    for (let i = 0; i < fw; i++) {
      const u0 = (i + 0.5) / fw;
      const u = (u0 + swirl * Math.sin(v0 * 6.5 + phase + t * 0.6)) * ar;
      const v = v0 + swirl * Math.cos(u0 * 5.5 + phase * 1.3 + t * 0.45);
      let total = 0;
      for (let k = 0; k < n; k++) {
        const dx = u - px[k];
        const dy = v - py[k];
        const wk = 1 / Math.pow((dx * dx + dy * dy) * inv[k] + 0.015, exponent);
        w[k] = wk;
        total += wk;
      }
      let L = 0, A = 0, B = 0;
      for (let k = 0; k < n; k++) {
        const f = w[k] / total;
        L += labs[k][0] * f;
        A += labs[k][1] * f;
        B += labs[k][2] * f;
      }
      const lin = oklabToLinear(L, A, B);
      data[o] = linToByte(lin[0]);
      data[o + 1] = linToByte(lin[1]);
      data[o + 2] = linToByte(lin[2]);
      data[o + 3] = 255;
      o += 4;
    }
  }
  return img;
}

function makeGrainTile(seed) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = GRAIN_TILE;
  const ctx = tile.getContext('2d');
  const img = ctx.createImageData(GRAIN_TILE, GRAIN_TILE);
  const rand = mulberry32(seed * 7919 + 1);
  for (let i = 0; i < img.data.length; i += 4) {
    const g = Math.round(rand() * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tile;
}

/** Draws field + grain into ctx at width w, height h. Returns the field ImageData. */
function compose(ctx, state, points, w, h, t, fieldW, grainTile) {
  const fw = fieldW;
  const fh = Math.max(2, Math.round(fieldW * (h / w)));
  const field = renderField(state, points, fw, fh, t);
  const buf = document.createElement('canvas');
  buf.width = fw;
  buf.height = fh;
  buf.getContext('2d').putImageData(field, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(buf, 0, 0, w, h);
  if (state.grain > 0) {
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = state.grain;
    ctx.fillStyle = ctx.createPattern(grainTile, 'repeat');
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
  return field;
}

/* ---------- Export builders ---------- */

function averageColor(points) {
  const sum = points.reduce((acc, p) => {
    const lab = hexToOklab(p.color);
    return [acc[0] + lab[0], acc[1] + lab[1], acc[2] + lab[2]];
  }, [0, 0, 0]);
  return oklabToHex(sum.map((v) => v / points.length));
}

const stopPercent = (spread) => Math.round(clamp(spread * 85, 18, 95));

function buildCSS(state) {
  const layers = state.points.map((p) =>
    `    radial-gradient(at ${Math.round(p.x * 100)}% ${Math.round(p.y * 100)}%, ${p.color} 0px, transparent ${stopPercent(p.spread)}%)`);
  return [
    '/* Hazeloom mesh gradient: layered approximation (PNG export is pixel-exact) */',
    '.mesh {',
    `  background-color: ${averageColor(state.points)};`,
    '  background-image:',
    `${layers.join(',\n')};`,
    '}'
  ].join('\n');
}

function buildSVG(state, width, height) {
  const corner = (x, y) => Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
  const defs = state.points.map((p, i) => {
    const cx = p.x * width;
    const cy = p.y * height;
    const r = corner(cx, cy) * (stopPercent(p.spread) / 100);
    return `<radialGradient id="g${i}" gradientUnits="userSpaceOnUse" cx="${round(cx, 1)}" cy="${round(cy, 1)}" r="${round(r, 1)}">` +
      `<stop offset="0" stop-color="${p.color}"/><stop offset="1" stop-color="${p.color}" stop-opacity="0"/></radialGradient>`;
  });
  const rects = state.points.map((_, i) => `<rect width="100%" height="100%" fill="url(#g${i})"/>`).reverse();
  const grain = state.grain > 0
    ? `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${state.seed}"/><feColorMatrix type="saturate" values="0"/></filter>` : '';
  const grainRect = state.grain > 0
    ? `<rect width="100%" height="100%" filter="url(#grain)" opacity="${state.grain}" style="mix-blend-mode:overlay"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs>${defs.join('')}${grain}</defs>` +
    `<rect width="100%" height="100%" fill="${averageColor(state.points)}"/>${rects.join('')}${grainRect}</svg>`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ---------- Palette generation ---------- */

const SCHEMES = [[0, 30, 60, -30, 200], [0, 120, 240, 60, 180], [0, 180, 30, 210, -20], [0, 150, 210, 20, 330]];

function randomDesign(state, seed) {
  const rand = mulberry32(seed);
  const count = 4 + Math.floor(rand() * 3);
  const baseHue = rand() * 360;
  const scheme = SCHEMES[Math.floor(rand() * SCHEMES.length)];
  const darkAnchor = rand() < 0.4;
  const colors = Array.from({ length: count }, (_, i) => {
    const hue = baseHue + scheme[i % scheme.length] + (rand() - 0.5) * 20;
    const L = darkAnchor && i === 0 ? 0.22 + rand() * 0.1 : 0.62 + rand() * 0.26;
    return oklchToHex(L, 0.09 + rand() * 0.12, (hue + 360) % 360);
  });
  const layout = LAYOUTS[count];
  const points = colors.map((color, i) => ({
    id: newId(), color,
    x: clamp(layout[i][0] + (rand() - 0.5) * 0.2, 0.03, 0.97),
    y: clamp(layout[i][1] + (rand() - 0.5) * 0.2, 0.03, 0.97),
    spread: clamp(layout[i][2] + (rand() - 0.5) * 0.2, 0.3, 0.9)
  }));
  return update(state, {
    points, seed, preset: null, selectedId: points[0].id,
    softness: round(1.3 + rand() * 1.0, 2),
    swirl: round(rand() * 0.12, 3),
    grain: round(0.05 + rand() * 0.15, 2)
  });
}

function harmoniousColor(points, rand) {
  const ref = hexToOklch(points[Math.floor(rand() * points.length)].color);
  const hue = (ref.h + (rand() < 0.5 ? -1 : 1) * (30 + rand() * 30) + 360) % 360;
  return oklchToHex(clamp(ref.L + (rand() - 0.5) * 0.2, 0.3, 0.92), clamp(ref.C + 0.03, 0.06, 0.2), hue);
}

/* ---------- App (DOM wiring) ---------- */

const el = {
  stage: $('stage'), canvas: $('canvas'), handles: $('handles'), headline: $('headline'),
  badge: $('contrastBadge'), presets: $('presets'), ratios: $('ratios'), swatches: $('swatches'),
  pointCount: $('pointCount'), addBtn: $('addBtn'), deleteBtn: $('deleteBtn'),
  pointColor: $('pointColor'), pointHex: $('pointHex'), pointSpread: $('pointSpread'), spreadVal: $('spreadVal'),
  softness: $('softness'), softVal: $('softVal'), swirl: $('swirl'), swirlVal: $('swirlVal'),
  grain: $('grain'), grainVal: $('grainVal'), headlineToggle: $('headlineToggle'),
  copyCss: $('copyCss'), downloadSvg: $('downloadSvg'), downloadPng: $('downloadPng'),
  pngWidth: $('pngWidth'), cssOut: $('cssOut'), toast: $('toast'),
  animateBtn: $('animateBtn'), resetBtn: $('resetBtn'), shuffleBtn: $('shuffleBtn')
};

const ctx = el.canvas.getContext('2d');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let state = loadState();
let grainTile = makeGrainTile(state.seed);
let animating = false;
let time = 0;
let lastFrame = 0;
let frameQueued = false;
let lastField = null;
let frameCount = 0;
let toastTimer = 0;
let saveTimer = 0;

const currentRatio = () => RATIOS.find((r) => r.id === state.ratio) || RATIOS[0];
const selectedPoint = () => state.points.find((p) => p.id === state.selectedId) || state.points[0];

function setState(patch, { save = true } = {}) {
  const prevSeed = state.seed;
  state = update(state, patch);
  if (state.seed !== prevSeed) grainTile = makeGrainTile(state.seed);
  if (save) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveState(state), 250);
  }
  syncUI();
  requestFrame();
}

function updatePoint(id, patch) {
  setState({ points: state.points.map((p) => (p.id === id ? update(p, patch) : p)) });
}

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1800);
}

/* ----- Canvas sizing & drawing ----- */

function resizeCanvas() {
  const rect = el.stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(2, Math.round(rect.width * dpr));
  const h = Math.max(2, Math.round(rect.height * dpr));
  if (el.canvas.width !== w || el.canvas.height !== h) {
    el.canvas.width = w;
    el.canvas.height = h;
  }
  requestFrame();
}

function requestFrame() {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(draw);
}

function draw(now) {
  frameQueued = false;
  if (animating) {
    time += lastFrame ? Math.min(now - lastFrame, 50) / 1000 : 0;
    lastFrame = now;
  }
  const pts = effectivePoints(state.points, time, animating);
  const fieldW = Math.min(FIELD_W, el.canvas.width);
  lastField = compose(ctx, state, pts, el.canvas.width, el.canvas.height, animating ? time : 0, fieldW, grainTile);
  positionHandles(pts);
  if (!animating || frameCount++ % 12 === 0) updateContrast();
  if (animating) requestFrame();
}

function positionHandles(pts) {
  pts.forEach((p) => {
    const h = el.handles.querySelector(`[data-id="${p.id}"]`);
    if (!h) return;
    h.style.left = `${p.x * 100}%`;
    h.style.top = `${p.y * 100}%`;
  });
}

/* ----- Contrast check ----- */

function updateContrast() {
  if (!state.headline || !lastField) {
    el.badge.textContent = '';
    return;
  }
  const stageRect = el.stage.getBoundingClientRect();
  const box = el.headline.getBoundingClientRect();
  if (!stageRect.width || !box.width) return;
  const { width: fw, height: fh, data } = lastField;
  const x0 = clamp(Math.floor(((box.left - stageRect.left) / stageRect.width) * fw), 0, fw - 1);
  const x1 = clamp(Math.ceil(((box.right - stageRect.left) / stageRect.width) * fw), x0 + 1, fw);
  const y0 = clamp(Math.floor(((box.top - stageRect.top) / stageRect.height) * fh), 0, fh - 1);
  const y1 = clamp(Math.ceil(((box.bottom - stageRect.top) / stageRect.height) * fh), y0 + 1, fh);
  const lums = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * fw + x) * 4;
      lums.push(luminance(data[o], data[o + 1], data[o + 2]));
    }
  }
  const sorted = [...lums].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const whiteWorst = contrastRatio(1, pick(0.9));
  const darkLum = luminance(15, 16, 32);
  const darkWorst = contrastRatio(darkLum, pick(0.1));
  const useWhite = whiteWorst >= darkWorst;
  const ratio = useWhite ? whiteWorst : darkWorst;
  el.headline.style.color = useWhite ? '#ffffff' : '#0f1020';
  const level = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA Large' : 'Low';
  const cls = ratio >= 3 ? 'pass' : 'fail';
  el.badge.innerHTML = `<span class="${cls}">${level}</span> ${ratio.toFixed(1)}:1 · ${useWhite ? 'white' : 'dark'} text`;
}

/* ----- UI sync ----- */

function buildStaticUI() {
  PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.preset = p.name;
    const dot = document.createElement('span');
    dot.className = 'chip-dot';
    dot.style.background = `linear-gradient(135deg, ${p.colors.slice(0, 3).join(', ')})`;
    b.append(dot, document.createTextNode(p.name));
    b.addEventListener('click', () => {
      setState(update(presetState(p, state), {}));
      rebuildHandles();
      toast(`${p.name} loaded`);
    });
    el.presets.append(b);
  });
  RATIOS.forEach((r) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip text-only';
    b.dataset.ratio = r.id;
    b.textContent = r.label;
    b.addEventListener('click', () => setState({ ratio: r.id }));
    el.ratios.append(b);
  });
}

function rebuildHandles() {
  const ids = new Set(state.points.map((p) => p.id));
  [...el.handles.children].forEach((h) => { if (!ids.has(h.dataset.id)) h.remove(); });
  state.points.forEach((p, i) => {
    let h = el.handles.querySelector(`[data-id="${p.id}"]`);
    if (!h) {
      h = document.createElement('button');
      h.type = 'button';
      h.className = 'handle';
      h.dataset.id = p.id;
      attachHandleEvents(h);
      el.handles.append(h);
    }
    h.style.background = p.color;
    h.setAttribute('aria-label', `Colour point ${i + 1}, ${p.color}, at ${Math.round(p.x * 100)}% by ${Math.round(p.y * 100)}%`);
    h.classList.toggle('selected', p.id === state.selectedId);
  });
  positionHandles(effectivePoints(state.points, time, animating));
}

function rebuildSwatches() {
  el.swatches.replaceChildren(...state.points.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = p.color;
    b.setAttribute('aria-label', `Select point ${i + 1} (${p.color})`);
    b.setAttribute('aria-pressed', String(p.id === state.selectedId));
    b.addEventListener('click', () => setState({ selectedId: p.id }, { save: false }));
    return b;
  }));
}

function syncUI() {
  const sel = selectedPoint();
  const ratio = currentRatio();
  el.stage.style.aspectRatio = `${ratio.w} / ${ratio.h}`;
  el.stage.classList.toggle('tall', ratio.h >= ratio.w);
  el.presets.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.preset === state.preset)));
  el.ratios.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.ratio === state.ratio)));
  el.pointCount.textContent = `${state.points.length}/${MAX_POINTS}`;
  el.addBtn.disabled = state.points.length >= MAX_POINTS;
  el.deleteBtn.disabled = state.points.length <= MIN_POINTS;
  if (document.activeElement !== el.pointColor) el.pointColor.value = sel.color;
  el.pointHex.textContent = sel.color;
  el.pointSpread.value = sel.spread;
  el.spreadVal.textContent = sel.spread.toFixed(2);
  el.softness.value = state.softness;
  el.softVal.textContent = state.softness.toFixed(2);
  el.swirl.value = state.swirl;
  el.swirlVal.textContent = state.swirl.toFixed(3);
  el.grain.value = state.grain;
  el.grainVal.textContent = `${Math.round(state.grain * 100)}%`;
  el.headlineToggle.checked = state.headline;
  el.headline.hidden = !state.headline;
  el.cssOut.textContent = buildCSS(state);
  rebuildHandles();
  rebuildSwatches();
  resizeCanvasSoon();
}

let resizeQueued = false;
function resizeCanvasSoon() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => { resizeQueued = false; resizeCanvas(); });
}

/* ----- Pointer & keyboard on handles ----- */

function stagePosition(evt) {
  const r = el.stage.getBoundingClientRect();
  return { x: clamp((evt.clientX - r.left) / r.width, 0, 1), y: clamp((evt.clientY - r.top) / r.height, 0, 1) };
}

function attachHandleEvents(h) {
  h.addEventListener('pointerdown', (evt) => {
    evt.preventDefault();
    h.setPointerCapture(evt.pointerId);
    h.classList.add('dragging');
    h.focus({ preventScroll: true });
    setState({ selectedId: h.dataset.id }, { save: false });
  });
  h.addEventListener('pointermove', (evt) => {
    if (!h.hasPointerCapture(evt.pointerId)) return;
    updatePoint(h.dataset.id, stagePosition(evt));
  });
  const end = (evt) => {
    if (h.hasPointerCapture(evt.pointerId)) h.releasePointerCapture(evt.pointerId);
    h.classList.remove('dragging');
  };
  h.addEventListener('pointerup', end);
  h.addEventListener('pointercancel', end);
  h.addEventListener('focus', () => {
    if (state.selectedId !== h.dataset.id) setState({ selectedId: h.dataset.id }, { save: false });
  });
  h.addEventListener('keydown', (evt) => handleKey(evt, h.dataset.id));
}

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function handleKey(evt, id) {
  if (ARROWS[evt.key]) {
    evt.preventDefault();
    const step = evt.shiftKey ? 0.05 : 0.01;
    const p = state.points.find((q) => q.id === id);
    const [dx, dy] = ARROWS[evt.key];
    updatePoint(id, { x: clamp(p.x + dx * step, 0, 1), y: clamp(p.y + dy * step, 0, 1) });
  } else if (evt.key === 'Delete' || evt.key === 'Backspace') {
    evt.preventDefault();
    deletePoint(id);
  }
}

/* ----- Actions ----- */

function addPoint(pos) {
  if (state.points.length >= MAX_POINTS) {
    toast(`Maximum of ${MAX_POINTS} points`);
    return;
  }
  const rand = mulberry32(Date.now() & 0xffffffff);
  const where = pos || { x: 0.2 + rand() * 0.6, y: 0.2 + rand() * 0.6 };
  const point = { id: newId(), x: where.x, y: where.y, spread: 0.5, color: harmoniousColor(state.points, rand) };
  setState({ points: [...state.points, point], selectedId: point.id, preset: null });
  toast('Point added');
  const h = el.handles.querySelector(`[data-id="${point.id}"]`);
  if (h) h.focus({ preventScroll: true });
}

function deletePoint(id) {
  if (state.points.length <= MIN_POINTS) {
    toast(`A mesh needs at least ${MIN_POINTS} points`);
    return;
  }
  const idx = state.points.findIndex((p) => p.id === id);
  const points = state.points.filter((p) => p.id !== id);
  const next = points[Math.min(idx, points.length - 1)];
  setState({ points, selectedId: next.id, preset: null });
  const h = el.handles.querySelector(`[data-id="${next.id}"]`);
  if (h) h.focus({ preventScroll: true });
}

function setAnimating(on) {
  animating = on;
  lastFrame = 0;
  el.animateBtn.setAttribute('aria-pressed', String(on));
  el.animateBtn.textContent = on ? 'Pause' : 'Animate';
  requestFrame();
}

async function copyCSS() {
  const css = buildCSS(state);
  try {
    await navigator.clipboard.writeText(css);
    toast('CSS copied to clipboard');
  } catch (err) {
    const range = document.createRange();
    range.selectNodeContents(el.cssOut);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    toast('Clipboard blocked: CSS selected, press Ctrl/Cmd+C');
    console.warn('Hazeloom: clipboard write failed.', err);
  }
}

function exportSize() {
  const r = currentRatio();
  const width = clamp(Number(el.pngWidth.value) || 1920, 320, 3840);
  return { width, height: Math.round((width * r.h) / r.w) };
}

function fileStem() {
  return `hazeloom-${(state.preset || 'mesh').toLowerCase().replace(/\s+/g, '-')}-${state.ratio.replace(':', 'x')}`;
}

function downloadSVG() {
  const { width, height } = exportSize();
  downloadBlob(new Blob([buildSVG(state, width, height)], { type: 'image/svg+xml' }), `${fileStem()}.svg`);
  toast('SVG downloaded');
}

function downloadPNG() {
  const { width, height } = exportSize();
  el.downloadPng.disabled = true;
  toast('Rendering PNG…');
  setTimeout(() => {
    try {
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      const pts = effectivePoints(state.points, time, animating);
      compose(out.getContext('2d'), state, pts, width, height, animating ? time : 0, Math.round(width / 3), grainTile);
      out.toBlob((blob) => {
        el.downloadPng.disabled = false;
        if (!blob) {
          toast('PNG export failed, try a smaller size');
          return;
        }
        downloadBlob(blob, `${fileStem()}-${width}.png`);
        toast(`PNG downloaded (${width}×${height})`);
      }, 'image/png');
    } catch (err) {
      el.downloadPng.disabled = false;
      console.warn('Hazeloom: PNG export failed.', err);
      toast('PNG export failed, try a smaller size');
    }
  }, 30);
}

function bindControls() {
  el.pointColor.addEventListener('input', () => {
    const v = el.pointColor.value.toLowerCase();
    if (HEX_RE.test(v)) updatePoint(selectedPoint().id, { color: v });
  });
  el.pointSpread.addEventListener('input', () => updatePoint(selectedPoint().id, { spread: clamp(Number(el.pointSpread.value), 0.1, 1) }));
  el.softness.addEventListener('input', () => setState({ softness: clamp(Number(el.softness.value), 0.6, 3) }));
  el.swirl.addEventListener('input', () => setState({ swirl: clamp(Number(el.swirl.value), 0, 0.25) }));
  el.grain.addEventListener('input', () => setState({ grain: clamp(Number(el.grain.value), 0, 0.35) }));
  el.headlineToggle.addEventListener('change', () => setState({ headline: el.headlineToggle.checked }));
  el.addBtn.addEventListener('click', () => addPoint());
  el.deleteBtn.addEventListener('click', () => deletePoint(selectedPoint().id));
  el.canvas.addEventListener('dblclick', (evt) => addPoint(stagePosition(evt)));
  el.shuffleBtn.addEventListener('click', () => {
    setState(randomDesign(state, (Math.random() * 1e9) >>> 0));
    toast('Fresh palette');
  });
  el.resetBtn.addEventListener('click', () => {
    setState(presetState(PRESETS[0], update(state, { ratio: '16:9', headline: true })));
    toast('Reset to Aurora');
  });
  el.animateBtn.addEventListener('click', () => setAnimating(!animating));
  el.copyCss.addEventListener('click', copyCSS);
  el.downloadSvg.addEventListener('click', downloadSVG);
  el.downloadPng.addEventListener('click', downloadPNG);
  new ResizeObserver(resizeCanvas).observe(el.stage);
}

function init() {
  buildStaticUI();
  bindControls();
  syncUI();
  if (reducedMotion) el.animateBtn.title = 'Animation is off by default because reduced motion is on';
}

init();
