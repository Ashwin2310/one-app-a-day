'use strict';

/* ================= Constants ================= */
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const STORE_KEY = 'huestair:v1';
const MAX_EXTRAS = 6;
const CORE = ['brand', 'accent', 'neutral', 'success', 'warning', 'danger'];
const HARMONY = {complement: 180, split: 150, triadic: 120, analogous: 40};
const SEMANTIC = {
  success: {l: 0.63, c: 0.16, h: 152},
  warning: {l: 0.79, c: 0.165, h: 78},
  danger: {l: 0.61, c: 0.205, h: 25}
};
const DEFAULTS = Object.freeze({
  brand: '#5b5bd6', harmony: 'analogous', curve: 'even', lightest: 0.975, darkest: 0.2,
  chroma: 1, drift: 6, tint: 0.012, pin: true, theme: 'light', matrixRamp: 'brand',
  format: 'hex', tab: 'css', extras: [], selected: {ramp: 'brand', i: 6}
});
const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/* ================= Colour maths (OKLab, Björn Ottosson) ================= */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function normHex(input) {
  const m = HEX_RE.exec(String(input).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  return '#' + h.toLowerCase();
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

function rgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
}

function rgbToOklch(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = C < 1e-4 ? 0 : (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
  return {l: L, c: C, h: H};
}

function oklchToLinear(l, c, h) {
  const rad = h * Math.PI / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);
  const l_ = Math.pow(l + 0.3963377774 * A + 0.2158037573 * B, 3);
  const m_ = Math.pow(l - 0.1055613458 * A - 0.0638541728 * B, 3);
  const s_ = Math.pow(l - 0.0894841775 * A - 1.291485548 * B, 3);
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_
  ];
}

const inGamut = (lin) => lin.every((v) => v >= -0.0005 && v <= 1.0005);

/* Largest chroma that fits in sRGB at this lightness and hue (binary search). */
function toGamut(l, c, h) {
  if (inGamut(oklchToLinear(l, c, h))) return c;
  let lo = 0;
  let hi = c;
  for (let k = 0; k < 22; k++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear(l, mid, h))) lo = mid; else hi = mid;
  }
  return lo;
}

const oklchToHex = (l, c, h) => rgbToHex(oklchToLinear(l, c, h).map((v) => fromLinear(clamp(v, 0, 1))));

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const grade = (r) => (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'A+' : '');
const fmtOklch = (s) => `oklch(${(s.l * 100).toFixed(1)}% ${s.c.toFixed(3)} ${s.h.toFixed(1)})`;

/* ================= Palette generation ================= */
function lightnessTargets(curve, top, bottom) {
  const n = STEPS.length - 1;
  return STEPS.map((_, i) => {
    const t = i / n;
    if (curve === 'even') {
      const yTop = Math.pow(top, 3) + 0.05;
      const yBot = Math.pow(bottom, 3) + 0.05;
      const y = yTop * Math.pow(yBot / yTop, t) - 0.05;
      return Math.cbrt(Math.max(0, y));
    }
    const f = curve === 'eased' ? 0.5 * t + 0.5 * (3 * t * t - 2 * t * t * t) : t;
    return top + (bottom - top) * f;
  });
}

function nearestIndex(targets, l) {
  return targets.reduce((best, v, i) => (Math.abs(v - l) < Math.abs(targets[best] - l) ? i : best), 0);
}

/* def: {key, name, l, c, h, exactHex?, flat?} */
function buildRamp(def, opts) {
  const targets = lightnessTargets(opts.curve, opts.lightest, opts.darkest);
  const k = nearestIndex(targets, def.l);
  const tk = k / (STEPS.length - 1);
  const span = Math.max(tk, 1 - tk) || 1;
  const steps = targets.map((l, i) => {
    const t = i / (STEPS.length - 1);
    const d = t - tk;
    const side = d < 0 ? tk : 1 - tk;
    const u = side > 0 ? d / side : 0;
    const bell = def.flat ? 1 - 0.55 * u * u : 1 - 0.78 * u * u;
    const want = Math.max(0, def.c * (def.flat ? 1 : opts.chroma) * bell);
    const h = (def.h + opts.drift * (tk - t) / span + 360) % 360;
    const c = toGamut(l, want, h);
    return {step: STEPS[i], l, c, h, hex: oklchToHex(l, c, h), mapped: want - c > 0.012 && c < want * 0.85, isBase: false};
  });
  if (opts.pin && def.exactHex) {
    const base = rgbToOklch(hexToRgb(def.exactHex));
    steps[k] = {...base, step: STEPS[k], hex: def.exactHex, mapped: false, isBase: true};
  }
  return {key: def.key, name: def.name, role: def.role, steps};
}

/* Lightness where this hue reaches its most vivid sRGB colour. */
function cuspL(h) {
  let best = 0.6;
  let bestC = 0;
  for (let l = 0.3; l <= 0.95; l += 0.025) {
    const c = toGamut(l, 0.4, h);
    if (c > bestC) { bestC = c; best = l; }
  }
  return best;
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16) || 'custom';
}

function extraKeys(extras) {
  const used = new Set(CORE);
  return extras.map((x) => {
    const base = slug(x.name);
    let key = base;
    let n = 2;
    while (used.has(key)) key = `${base}-${n++}`;
    used.add(key);
    return key;
  });
}

function deriveRamps(s) {
  const b = rgbToOklch(hexToRgb(s.brand));
  const opts = {curve: s.curve, lightest: s.lightest, darkest: s.darkest, chroma: s.chroma, drift: s.drift, pin: s.pin};
  const accentC = Math.max(b.c, 0.11);
  const accentH = (b.h + HARMONY[s.harmony]) % 360;
  const accentL = clamp(0.4 * b.l + 0.6 * cuspL(accentH), 0.45, 0.8);
  const defs = [
    {key: 'brand', name: 'Brand', role: 'base', ...b, exactHex: s.brand},
    {key: 'accent', name: 'Accent', role: s.harmony, l: accentL, c: accentC, h: accentH},
    {key: 'neutral', name: 'Neutral', role: 'tinted', l: 0.55, c: Math.min(s.tint, b.c), h: b.h, flat: true},
    ...Object.entries(SEMANTIC).map(([key, v]) => ({key, name: key[0].toUpperCase() + key.slice(1), role: 'semantic', ...v}))
  ];
  const keys = extraKeys(s.extras);
  const extras = s.extras.map((x, i) => ({key: keys[i], name: x.name, role: 'custom', ...rgbToOklch(hexToRgb(x.hex)), exactHex: x.hex}));
  return [...defs, ...extras].map((d) => buildRamp(d, opts));
}

/* ================= State ================= */
let state = loadState();
let palette = [];

function sanitize(raw) {
  const s = {...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {})};
  const num = (v, lo, hi, d) => (Number.isFinite(+v) ? clamp(+v, lo, hi) : d);
  const out = {
    brand: normHex(s.brand) || DEFAULTS.brand,
    harmony: HARMONY[s.harmony] !== undefined ? s.harmony : DEFAULTS.harmony,
    curve: ['linear', 'eased', 'even'].includes(s.curve) ? s.curve : DEFAULTS.curve,
    lightest: num(s.lightest, 0.85, 0.995, DEFAULTS.lightest),
    darkest: num(s.darkest, 0.1, 0.45, DEFAULTS.darkest),
    chroma: num(s.chroma, 0.3, 1.4, 1),
    drift: num(s.drift, -20, 20, DEFAULTS.drift),
    tint: num(s.tint, 0, 0.04, DEFAULTS.tint),
    pin: s.pin !== false && s.pin !== '0',
    theme: s.theme === 'dark' ? 'dark' : 'light',
    matrixRamp: typeof s.matrixRamp === 'string' ? s.matrixRamp : 'brand',
    format: s.format === 'oklch' ? 'oklch' : 'hex',
    tab: ['css', 'tailwind', 'tokens', 'svg'].includes(s.tab) ? s.tab : 'css',
    extras: (Array.isArray(s.extras) ? s.extras : []).slice(0, MAX_EXTRAS)
      .map((x) => ({name: String((x && x.name) || 'custom').slice(0, 16), hex: normHex(x && x.hex) || '#888888'})),
    selected: s.selected && typeof s.selected.ramp === 'string'
      ? {ramp: s.selected.ramp, i: clamp(parseInt(s.selected.i, 10) || 0, 0, STEPS.length - 1)}
      : {...DEFAULTS.selected}
  };
  if (out.lightest - out.darkest < 0.2) out.darkest = Math.max(0.1, out.lightest - 0.2);
  return out;
}

function fromHash() {
  if (location.hash.length < 3) return null;
  try {
    const p = new URLSearchParams(location.hash.slice(1));
    if (!p.get('b')) return null;
    const extras = (p.get('x') || '').split(',').filter(Boolean).map((pair) => {
      const [name, hex] = pair.split(':');
      return {name: decodeURIComponent(name || ''), hex: '#' + (hex || '')};
    });
    return {brand: '#' + p.get('b'), harmony: p.get('h'), curve: p.get('cv'), lightest: p.get('lt'),
      darkest: p.get('dk'), chroma: p.get('c'), drift: p.get('d'), tint: p.get('t'), pin: p.get('p'), extras};
  } catch (err) {
    console.warn('Ignoring malformed share link', err);
    return null;
  }
}

function loadState() {
  const hashed = fromHash();
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  } catch (err) {
    console.warn('Ignoring unreadable saved palette', err);
  }
  return sanitize(hashed ? {...(stored || {}), ...hashed} : stored);
}

function shareHash(s) {
  const p = new URLSearchParams({
    b: s.brand.slice(1), h: s.harmony, cv: s.curve, lt: s.lightest, dk: s.darkest,
    c: s.chroma, d: s.drift, t: s.tint, p: s.pin ? '1' : '0'
  });
  if (s.extras.length) p.set('x', s.extras.map((x) => `${encodeURIComponent(x.name)}:${x.hex.slice(1)}`).join(','));
  return '#' + p.toString();
}

let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Could not save palette', err);
    }
    history.replaceState(null, '', shareHash(state));
  }, 200);
}

function setState(patch) {
  state = sanitize({...state, ...patch});
  render();
  persist();
}

/* ================= DOM helpers ================= */
const $ = (id) => document.getElementById(id);
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === 'text') node.textContent = v;
    else if (k === 'style') Object.assign(node.style, v);
    else node.setAttribute(k, v);
  });
  (children || []).forEach((c) => node.append(c));
  return node;
}
const readable = (hex) => (contrast(hex, '#ffffff') >= contrast(hex, '#0b0c10') ? '#ffffff' : '#0b0c10');
const findRamp = (key) => palette.find((r) => r.key === key) || palette[0];
const shade = (key, step) => findRamp(key).steps[STEPS.indexOf(step)].hex;

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1700);
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${label}`);
  } catch (err) {
    const ta = el('textarea', {'aria-hidden': 'true', class: 'offscreen'});
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    ta.remove();
    toast(ok ? `Copied ${label}` : 'Copy blocked by the browser. Select the text and copy it manually.');
  }
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const a = el('a', {href: url, download: name});
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Downloaded ${name}`);
}

/* ================= Renderers ================= */
function renderControls() {
  const hexInput = $('brandHex');
  if (document.activeElement !== hexInput) hexInput.value = state.brand.toUpperCase();
  $('brandPicker').value = state.brand;
  $('harmony').value = state.harmony;
  const sliders = {lightest: (v) => (v * 100).toFixed(1) + '%', darkest: (v) => (v * 100).toFixed(1) + '%',
    chroma: (v) => '×' + v.toFixed(2), drift: (v) => (v > 0 ? '+' : '') + v + '°', tint: (v) => v.toFixed(3)};
  Object.entries(sliders).forEach(([id, f]) => {
    $(id).value = state[id];
    $(id + 'Out').textContent = f(state[id]);
  });
  $('pin').checked = state.pin;
  setSeg('curveSeg', state.curve);
  setSeg('themeSeg', state.theme);
  setSeg('fmtSeg', state.format);
  const targets = lightnessTargets(state.curve, state.lightest, state.darkest);
  const ratios = targets.slice(1).map((l, i) => (Math.pow(targets[i], 3) + 0.05) / (Math.pow(l, 3) + 0.05));
  const lo = Math.min(...ratios);
  const hi = Math.max(...ratios);
  $('neighbour').textContent = hi - lo < 0.005
    ? `Neighbour contrast: ${lo.toFixed(2)} : 1 between every step.`
    : `Neighbour contrast varies from ${lo.toFixed(2)} to ${hi.toFixed(2)} : 1.`;
}

function setSeg(id, value) {
  $(id).querySelectorAll('[data-v]').forEach((b) => {
    const on = b.dataset.v === value;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
}

function renderExtras() {
  const list = $('extras');
  list.replaceChildren();
  if (!state.extras.length) list.append(el('li', {class: 'empty', text: 'No custom ramps yet. Add one for a second brand or a chart colour.'}));
  state.extras.forEach((x, i) => {
    const name = el('input', {type: 'text', value: x.name, maxlength: '16', 'aria-label': `Ramp ${i + 1} name`, 'data-i': i, 'data-f': 'name'});
    const pick = el('input', {type: 'color', value: x.hex, 'aria-label': `Ramp ${i + 1} colour`, 'data-i': i, 'data-f': 'hex'});
    const del = el('button', {type: 'button', class: 'btn small ghost', 'aria-label': `Remove ramp ${x.name}`, 'data-del': i, text: '✕'});
    list.append(el('li', {}, [pick, name, del]));
  });
  $('addRamp').disabled = state.extras.length >= MAX_EXTRAS;
}

function renderRamps() {
  const wrap = $('ramps');
  const hadFocus = wrap.contains(document.activeElement);
  $('stepsHead').replaceChildren(el('span'), ...STEPS.map((s) => el('span', {text: s})));
  const sel = state.selected;
  wrap.replaceChildren(...palette.map((ramp, r) => el('div', {class: 'ramp', role: 'row'}, [
    el('div', {class: 'ramp-name', role: 'rowheader'}, [el('b', {text: ramp.name}), el('small', {text: ramp.role})]),
    ...ramp.steps.map((s, i) => {
      const on = ramp.key === sel.ramp && i === sel.i;
      const btn = el('button', {
        type: 'button', role: 'gridcell', class: 'swatch' + (on ? ' on' : ''), 'data-r': r, 'data-i': i,
        tabindex: on ? '0' : '-1', 'aria-selected': String(on),
        'aria-label': `${ramp.name} ${s.step} ${s.hex}${s.isBase ? ', exact brand colour' : ''}${s.mapped ? ', gamut mapped' : ''}`,
        style: {background: s.hex, color: readable(s.hex)}
      }, [el('span', {class: 'st', text: s.step}), el('span', {class: 'hx', text: s.hex.slice(1).toUpperCase()})]);
      if (s.isBase) btn.append(el('span', {class: 'mark base', title: 'Exact brand colour', text: '◆'}));
      if (s.mapped) btn.append(el('span', {class: 'mark mapped', title: 'Chroma reduced to fit sRGB'}));
      return btn;
    })
  ])));
  if (hadFocus) {
    const cur = wrap.querySelector('.swatch.on');
    if (cur) cur.focus();
  }
}

function badge(ratio) {
  const g = grade(ratio);
  return el('span', {class: 'badge ' + (g ? 'ok' : 'no'), text: g || 'Fail'});
}

function renderInspector() {
  const ramp = findRamp(state.selected.ramp);
  const s = ramp.steps[state.selected.i];
  const [r, g, b] = hexToRgb(s.hex).map((v) => Math.round(v * 255));
  const onW = contrast(s.hex, '#ffffff');
  const onB = contrast(s.hex, '#000000');
  const box = $('inspector');
  box.replaceChildren(
    el('div', {class: 'chip', style: {background: s.hex}}),
    el('div', {class: 'insp-main'}, [
      el('strong', {text: `${ramp.key}-${s.step}`}),
      el('code', {text: s.hex.toUpperCase()}),
      el('code', {text: fmtOklch(s)}),
      el('code', {text: `rgb(${r} ${g} ${b})`})
    ]),
    el('div', {class: 'insp-ratios'}, [
      el('span', {class: 'pair'}, [el('i', {class: 'dot w'}), document.createTextNode(`${onW.toFixed(2)} : 1 `), badge(onW)]),
      el('span', {class: 'pair'}, [el('i', {class: 'dot k'}), document.createTextNode(`${onB.toFixed(2)} : 1 `), badge(onB)])
    ]),
    el('div', {class: 'insp-actions'}, [
      el('button', {type: 'button', class: 'btn small', 'data-copy': s.hex.toUpperCase(), text: 'Copy hex'}),
      el('button', {type: 'button', class: 'btn small ghost', 'data-copy': fmtOklch(s), text: 'Copy OKLCH'})
    ])
  );
  if (s.isBase || s.mapped) {
    box.querySelector('.insp-main').append(el('em', {text: s.isBase ? 'Exact brand colour' : 'Chroma reduced to fit sRGB'}));
  }
}

function renderChart() {
  const W = 520;
  const H = 260;
  const P = {l: 40, r: 40, t: 28, b: 30};
  const x = (i) => P.l + (i / (STEPS.length - 1)) * (W - P.l - P.r);
  const yL = (l) => P.t + (1 - l) * (H - P.t - P.b);
  const CMAX = 0.3;
  const yC = (c) => P.t + (1 - c / CMAX) * (H - P.t - P.b);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = $('chart');
  const make = (tag, a) => {
    const n = document.createElementNS(ns, tag);
    Object.entries(a).forEach(([k, v]) => (k === 'text' ? (n.textContent = v) : n.setAttribute(k, v)));
    return n;
  };
  const kids = [];
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    kids.push(make('line', {x1: P.l, x2: W - P.r, y1: yL(v), y2: yL(v), class: 'grid'}));
    kids.push(make('text', {x: P.l - 8, y: yL(v) + 4, 'text-anchor': 'end', class: 'axis', text: Math.round(v * 100)}));
    kids.push(make('text', {x: W - P.r + 8, y: yL(v) + 4, class: 'axis', text: (v * CMAX).toFixed(2)}));
  });
  STEPS.forEach((s, i) => kids.push(make('text', {x: x(i), y: H - 10, 'text-anchor': 'middle', class: 'axis', text: s})));
  kids.push(make('text', {x: 6, y: 12, class: 'axis strong', text: 'L %'}));
  kids.push(make('text', {x: W - 6, y: 12, 'text-anchor': 'end', class: 'axis strong', text: 'C'}));
  palette.forEach((ramp) => {
    const stroke = ramp.steps[5].hex;
    const d = ramp.steps.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yC(s.c).toFixed(1)}`).join(' ');
    kids.push(make('path', {d, class: 'cline', stroke}));
    ramp.steps.forEach((s, i) => kids.push(make('circle', {cx: x(i), cy: yC(s.c), r: 3, fill: s.hex, class: 'cdot'})));
  });
  const brand = findRamp('brand');
  const dl = brand.steps.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yL(s.l).toFixed(1)}`).join(' ');
  kids.push(make('path', {d: dl, class: 'lline'}));
  brand.steps.forEach((s, i) => kids.push(make('circle', {cx: x(i), cy: yL(s.l), r: 4, class: 'ldot'})));
  svg.replaceChildren(...kids);
  $('chartLegend').replaceChildren(el('span', {class: 'lg-l', text: 'Lightness'}), el('span', {class: 'lg-c', text: 'Chroma per ramp'}));
}

function renderMatrix() {
  const sel = $('matrixRamp');
  if (!palette.some((r) => r.key === state.matrixRamp)) state = {...state, matrixRamp: 'brand'};
  sel.replaceChildren(...palette.map((r) => el('option', {value: r.key, text: r.name})));
  sel.value = state.matrixRamp;
  const ramp = findRamp(state.matrixRamp);
  const head = el('tr', {}, [el('th', {scope: 'col', class: 'corner', text: 'text \\ bg'}),
    ...ramp.steps.map((s) => el('th', {scope: 'col', style: {background: s.hex, color: readable(s.hex)}, text: s.step}))]);
  const rows = ramp.steps.map((fg) => el('tr', {}, [
    el('th', {scope: 'row', style: {background: fg.hex, color: readable(fg.hex)}, text: fg.step}),
    ...ramp.steps.map((bg) => {
      if (bg === fg) return el('td', {class: 'diag', style: {background: bg.hex}, 'aria-label': 'same colour'});
      const r = contrast(fg.hex, bg.hex);
      const g = grade(r);
      return el('td', {style: {background: bg.hex, color: fg.hex}, class: g ? 'pass' : 'fail',
        'aria-label': `${fg.step} on ${bg.step}: ${r.toFixed(2)} to 1 ${g || 'fail'}`}, [
        el('span', {class: 'aa', text: 'Aa'}), el('span', {class: 'rt', text: r.toFixed(1)}), el('span', {class: 'gd', text: g})
      ]);
    })
  ]));
  $('matrix').replaceChildren(el('thead', {}, [head]), el('tbody', {}, rows));
}

function bestOn(bgHex, keys) {
  return keys.reduce((best, h) => (contrast(bgHex, h) > contrast(bgHex, best) ? h : best), keys[0]);
}

function renderPreview() {
  const dark = state.theme === 'dark';
  const n = (s) => shade('neutral', s);
  const p = (k, s) => shade(k, s);
  const primary = p('brand', dark ? 400 : 600);
  const accent = p('accent', dark ? 400 : 500);
  const vars = {
    '--pv-bg': n(dark ? 950 : 100), '--pv-surface': n(dark ? 900 : 50), '--pv-border': n(dark ? 800 : 200),
    '--pv-text': n(dark ? 50 : 900), '--pv-muted': n(dark ? 400 : 600), '--pv-input': n(dark ? 950 : 50),
    '--pv-input-border': n(dark ? 700 : 300), '--pv-primary': primary,
    '--pv-primary-text': bestOn(primary, [p('brand', 50), p('brand', 950)]),
    '--pv-secondary': n(dark ? 800 : 200), '--pv-secondary-text': n(dark ? 100 : 800),
    '--pv-accent': accent, '--pv-accent-text': bestOn(accent, [p('accent', 50), p('accent', 950)]),
    '--pv-badge': p('brand', dark ? 900 : 100), '--pv-badge-text': p('brand', dark ? 200 : 800),
    '--pv-avatar': p('accent', dark ? 800 : 200), '--pv-avatar-text': p('accent', dark ? 100 : 900)
  };
  ['success', 'warning', 'danger'].forEach((k) => {
    vars[`--pv-${k}-bg`] = p(k, dark ? 950 : 50);
    vars[`--pv-${k}-border`] = p(k, dark ? 800 : 300);
    vars[`--pv-${k}-text`] = p(k, dark ? 200 : 900);
  });
  const box = $('preview');
  const all = palette.flatMap((r) => r.steps);
  const mapped = all.filter((x) => x.mapped).length;
  const btn = contrast(primary, vars['--pv-primary-text']);
  $('pvSuccess').textContent = `Primary button text is ${btn.toFixed(2)} : 1${grade(btn) ? ' (' + grade(btn) + ')' : ''}.`;
  $('pvWarning').textContent = `${mapped} of ${all.length} shades had their chroma reduced to fit sRGB.`;
  Object.entries(vars).forEach(([k, v]) => box.style.setProperty(k, v));
}

function renderChrome() {
  const root = document.documentElement.style;
  const b4 = shade('brand', 400);
  root.setProperty('--brand', b4);
  root.setProperty('--brand-soft', shade('brand', 800));
  root.setProperty('--on-brand', bestOn(b4, [shade('brand', 50), shade('brand', 950)]));
  document.querySelectorAll('.logo i').forEach((node, i) => (node.style.background = shade('brand', STEPS[2 + i * 2])));
}

/* ================= Export ================= */
const value = (s) => (state.format === 'oklch' ? fmtOklch(s) : s.hex);

function exportText(kind) {
  if (kind === 'css') {
    const body = palette.map((r) => r.steps.map((s) => `  --${r.key}-${s.step}: ${value(s)};`).join('\n')).join('\n\n');
    return `/* Huestair palette: ${state.curve} curve, brand ${state.brand} */\n:root {\n${body}\n}\n`;
  }
  if (kind === 'tailwind') {
    const body = palette.map((r) => `        '${r.key}': {\n${r.steps.map((s) => `          ${s.step}: '${value(s)}',`).join('\n')}\n        },`).join('\n');
    return `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n${body}\n      },\n    },\n  },\n};\n`;
  }
  if (kind === 'tokens') {
    const color = Object.fromEntries(palette.map((r) => [r.key, Object.fromEntries(r.steps.map((s) => [String(s.step), {$type: 'color', $value: value(s)}]))]));
    return JSON.stringify({color}, null, 2) + '\n';
  }
  return svgSheet();
}

function svgSheet() {
  const cw = 92;
  const rh = 84;
  const lw = 130;
  const w = lw + cw * STEPS.length + 24;
  const h = 40 + rh * palette.length + 16;
  const font = "font-family='system-ui, -apple-system, Segoe UI, Roboto, sans-serif'";
  const rows = palette.map((r, ri) => {
    const y = 40 + ri * rh;
    const cells = r.steps.map((s, i) => {
      const x = lw + i * cw;
      const t = readable(s.hex);
      return `  <rect x='${x}' y='${y}' width='${cw - 4}' height='${rh - 8}' rx='8' fill='${s.hex}'/>\n` +
        `  <text x='${x + 10}' y='${y + 24}' fill='${t}' font-size='13' font-weight='700' ${font}>${s.step}</text>\n` +
        `  <text x='${x + 10}' y='${y + rh - 20}' fill='${t}' font-size='11' ${font}>${s.hex.toUpperCase()}</text>`;
    }).join('\n');
    return `  <text x='16' y='${y + rh / 2}' fill='#15171d' font-size='15' font-weight='700' ${font}>${r.name}</text>\n${cells}`;
  }).join('\n');
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>\n` +
    `  <rect width='100%' height='100%' fill='#ffffff'/>\n` +
    `  <text x='16' y='26' fill='#15171d' font-size='16' font-weight='800' ${font}>Huestair palette · brand ${state.brand.toUpperCase()}</text>\n${rows}\n</svg>\n`;
}

const EXPORT_FILES = {
  css: ['huestair-palette.css', 'text/css'], tailwind: ['tailwind.colors.js', 'text/javascript'],
  tokens: ['huestair-tokens.json', 'application/json'], svg: ['huestair-palette.svg', 'image/svg+xml']
};

function renderExport() {
  $('exportTabs').querySelectorAll('[data-v]').forEach((b) => {
    const on = b.dataset.v === state.tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $('exportCode').value = exportText(state.tab);
}

/* ================= Main render ================= */
function render() {
  palette = deriveRamps(state);
  if (!palette.some((r) => r.key === state.selected.ramp)) state = {...state, selected: {ramp: 'brand', i: 6}};
  renderControls();
  renderExtras();
  renderRamps();
  renderInspector();
  renderChart();
  renderMatrix();
  renderPreview();
  renderChrome();
  if ($('exportDlg').open) renderExport();
}

/* ================= Events ================= */
function bindSeg(id, key) {
  const seg = $(id);
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (b) setState({[key]: b.dataset.v});
  });
  seg.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const opts = [...seg.querySelectorAll('[data-v]')];
    const cur = opts.findIndex((b) => b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-selected') === 'true');
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
    const next = opts[(cur + dir + opts.length) % opts.length];
    setState({[key]: next.dataset.v});
    next.focus();
  });
}

function moveSelection(dr, di) {
  const r = clamp(palette.findIndex((x) => x.key === state.selected.ramp) + dr, 0, palette.length - 1);
  const i = clamp(state.selected.i + di, 0, STEPS.length - 1);
  setState({selected: {ramp: palette[r].key, i}});
  $('ramps').querySelector('.swatch.on').focus();
}

function randomBrand() {
  const h = Math.random() * 360;
  const l = 0.5 + Math.random() * 0.18;
  const c = toGamut(l, 0.12 + Math.random() * 0.1, h);
  const harmonies = Object.keys(HARMONY);
  return {brand: oklchToHex(l, c, h), harmony: harmonies[Math.floor(Math.random() * harmonies.length)],
    drift: Math.round(Math.random() * 16 - 4), tint: +(0.006 + Math.random() * 0.016).toFixed(3)};
}

function bind() {
  $('brandHex').addEventListener('input', (e) => {
    const hex = normHex(e.target.value);
    e.target.setAttribute('aria-invalid', String(!hex));
    $('hexMsg').textContent = hex ? '' : 'Enter a 3 or 6 digit hex like #5B5BD6.';
    if (hex) setState({brand: hex});
  });
  $('brandHex').addEventListener('blur', (e) => {
    e.target.value = state.brand.toUpperCase();
    e.target.setAttribute('aria-invalid', 'false');
    $('hexMsg').textContent = '';
  });
  $('brandPicker').addEventListener('input', (e) => setState({brand: e.target.value}));
  $('harmony').addEventListener('change', (e) => setState({harmony: e.target.value}));
  ['lightest', 'darkest', 'chroma', 'drift', 'tint'].forEach((id) => {
    $(id).addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      const patch = {[id]: v};
      if (id === 'lightest' && v - state.darkest < 0.2) patch.darkest = Math.max(0.1, v - 0.2);
      if (id === 'darkest' && state.lightest - v < 0.2) patch.darkest = state.lightest - 0.2;
      setState(patch);
    });
  });
  $('pin').addEventListener('change', (e) => setState({pin: e.target.checked}));
  bindSeg('curveSeg', 'curve');
  bindSeg('themeSeg', 'theme');
  bindSeg('fmtSeg', 'format');
  bindSeg('exportTabs', 'tab');

  $('ramps').addEventListener('click', (e) => {
    const b = e.target.closest('.swatch');
    if (!b) return;
    setState({selected: {ramp: palette[+b.dataset.r].key, i: +b.dataset.i}});
    $('ramps').querySelector('.swatch.on').focus();
  });
  $('ramps').addEventListener('dblclick', (e) => {
    if (e.target.closest('.swatch')) copySelected();
  });
  $('ramps').addEventListener('keydown', (e) => {
    const moves = {ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0], Home: [0, -99], End: [0, 99]};
    if (moves[e.key]) {
      e.preventDefault();
      moveSelection(...moves[e.key]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const b = e.target.closest('.swatch');
      if (b) state = sanitize({...state, selected: {ramp: palette[+b.dataset.r].key, i: +b.dataset.i}});
      copySelected();
      render();
    }
  });
  $('inspector').addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (b) copyText(b.dataset.copy, b.dataset.copy);
  });
  $('matrixRamp').addEventListener('change', (e) => setState({matrixRamp: e.target.value}));

  $('extras').addEventListener('input', (e) => {
    const i = e.target.dataset.i;
    if (i === undefined) return;
    const f = e.target.dataset.f;
    const extras = state.extras.map((x, k) => (k === +i ? {...x, [f]: e.target.value} : x));
    state = sanitize({...state, extras});
    palette = deriveRamps(state);
    renderRamps();
    renderInspector();
    renderChart();
    renderMatrix();
    persist();
  });
  $('extras').addEventListener('change', () => render());
  $('extras').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    setState({extras: state.extras.filter((_, k) => k !== +b.dataset.del)});
    $('addRamp').focus();
  });
  $('addRamp').addEventListener('click', () => {
    const h = (rgbToOklch(hexToRgb(state.brand)).h + 60 + state.extras.length * 47) % 360;
    const hex = oklchToHex(0.62, toGamut(0.62, 0.15, h), h);
    setState({extras: [...state.extras, {name: `custom ${state.extras.length + 1}`, hex}]});
    const inputs = $('extras').querySelectorAll('input[type="text"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
  $('reset').addEventListener('click', () => {
    try {
      localStorage.removeItem(STORE_KEY);
    } catch (err) {
      console.warn('Could not clear saved palette', err);
    }
    state = sanitize({...DEFAULTS});
    render();
    persist();
    toast('Palette reset to defaults');
  });
  $('surprise').addEventListener('click', () => setState(randomBrand()));
  $('share').addEventListener('click', () => copyText(location.href.split('#')[0] + shareHash(state), 'share link'));

  const dlg = $('exportDlg');
  $('openExport').addEventListener('click', () => {
    renderExport();
    dlg.showModal();
  });
  $('closeExport').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  $('copyExport').addEventListener('click', () => copyText($('exportCode').value, `${state.tab.toUpperCase()} export`));
  $('downloadExport').addEventListener('click', () => {
    const [name, type] = EXPORT_FILES[state.tab];
    download(name, $('exportCode').value, type);
  });
}

function copySelected() {
  const s = findRamp(state.selected.ramp).steps[state.selected.i];
  copyText(s.hex.toUpperCase(), `${state.selected.ramp}-${s.step} ${s.hex.toUpperCase()}`);
}

bind();
render();
