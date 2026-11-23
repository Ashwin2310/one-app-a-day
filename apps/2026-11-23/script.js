'use strict';

/* ---------- Constants ---------- */
const DAYS = 28;
const SLOTS = DAYS * 2;
const SHIFT_NAMES = ['Day', 'Night'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STORE_KEY = 'rotamint.v1';
const ITERATIONS = 60000;
const CHUNK = 800;
const T_START = 300;
const T_END = 0.4;
const MAX_STREAK = 5;
const MAX_PEOPLE = 20;
const PENALTY = { empty: 1000, dup: 1000, unavail: 800, leave: 1000, double: 700, turn: 400, cap: 250, streak: 40, fair: 6 };
const HARD = ['empty', 'dup', 'unavail', 'leave', 'double', 'turn', 'cap'];
const MAX_REPORT_LINES = 7;

const START = mondayOf(new Date());
const DAY_ISO = Array.from({ length: DAYS }, (_, d) => isoDate(dateOf(d)));

function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function dateOf(day) {
  const x = new Date(START);
  x.setDate(x.getDate() + day);
  return x;
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shortDate(day) {
  const d = dateOf(day);
  return `${WEEKDAYS[day % 7]} ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
}
function isoToShort(iso) {
  const i = DAY_ISO.indexOf(iso);
  if (i >= 0) return shortDate(i);
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en', { day: 'numeric', month: 'short' });
}

/* ---------- Seeded PRNG ---------- */
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

/* ---------- State ---------- */
const ALL = [true, true, true, true, true, true, true];
function samplePeople() {
  return [
    { name: 'Maya', hue: 168, cap: 4, avail: [true, true, true, true, true, true, false], leave: [] },
    { name: 'Ana', hue: 28, cap: 4, avail: ALL.slice(), leave: [] },
    { name: 'Raj', hue: 210, cap: 4, avail: ALL.slice(), leave: [DAY_ISO[9], DAY_ISO[10]] },
    { name: 'Sam', hue: 330, cap: 4, avail: [true, true, true, true, false, true, true], leave: [] },
    { name: 'Lena', hue: 262, cap: 5, avail: [true, true, true, true, true, false, false], leave: [] },
    { name: 'Theo', hue: 48, cap: 3, avail: ALL.slice(), leave: [] },
    { name: 'Iris', hue: 120, cap: 4, avail: ALL.slice(), leave: [DAY_ISO[20]] },
    { name: 'Kofi', hue: 0, cap: 5, avail: ALL.slice(), leave: [] },
  ];
}
function freshState() {
  return { people: samplePeople(), perShift: 2, seed: 7, grid: [], pins: [], stale: false };
}
function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}
function cleanPerson(p, i) {
  const avail = Array.isArray(p.avail) && p.avail.length === 7 ? p.avail.map(Boolean) : ALL.slice();
  const leave = Array.isArray(p.leave) ? [...new Set(p.leave.filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)))].sort() : [];
  const name = String(p.name || '').trim().slice(0, 24) || `Person ${i + 1}`;
  return { name, hue: clampInt(p.hue, 0, 359, (i * 137) % 360), cap: clampInt(p.cap, 1, 7, 4), avail, leave };
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!raw || !Array.isArray(raw.people)) return null;
    return {
      people: raw.people.slice(0, MAX_PEOPLE).map(cleanPerson),
      perShift: clampInt(raw.perShift, 1, 3, 2),
      seed: clampInt(raw.seed, 1, 99999, 7),
      grid: Array.isArray(raw.grid) ? raw.grid : [],
      pins: Array.isArray(raw.pins) ? raw.pins.filter(k => typeof k === 'string') : [],
      stale: Boolean(raw.stale),
    };
  } catch (err) {
    console.warn('Rotamint: saved data ignored', err);
    return null;
  }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Rotamint: could not save', err);
  }
}

let state = load() || freshState();
let lastRun = { history: [], iter: 0, T: null };
let running = null;

const pinKey = (s, k) => `${s}:${k}`;
function pinSet() { return new Set(state.pins); }

/** Make the grid match the current slot count, people count and pins. */
function normaliseGrid() {
  const n = state.people.length;
  const per = state.perShift;
  state.grid = Array.from({ length: SLOTS }, (_, s) => {
    const cell = Array.isArray(state.grid[s]) ? state.grid[s] : [];
    return Array.from({ length: per }, (_, k) => {
      const p = cell[k];
      return Number.isInteger(p) && p >= 0 && p < n ? p : -1;
    });
  });
  state.pins = state.pins.filter(key => {
    const [s, k] = key.split(':').map(Number);
    return s < SLOTS && k < per && state.grid[s] && state.grid[s][k] >= 0;
  });
}

/* ---------- Cost function ---------- */
function buildCtx(people) {
  const n = people.length;
  const avail = new Uint8Array(n * 7);
  const leave = new Uint8Array(n * DAYS);
  const cap = new Int16Array(n);
  people.forEach((p, i) => {
    p.avail.forEach((ok, w) => { avail[i * 7 + w] = ok ? 1 : 0; });
    cap[i] = p.cap;
    p.leave.forEach(iso => {
      const d = DAY_ISO.indexOf(iso);
      if (d >= 0) leave[i * DAYS + d] = 1;
    });
  });
  return {
    n, avail, leave, cap, work: new Uint8Array(Math.max(1, n) * DAYS),
    totals: new Int16Array(n), nights: new Int16Array(n), weekends: new Int16Array(n),
  };
}

function sumSquaredSpread(arr) {
  if (!arr.length) return 0;
  let mean = 0;
  for (const v of arr) mean += v;
  mean /= arr.length;
  let s = 0;
  for (const v of arr) s += (v - mean) * (v - mean);
  return s;
}

/**
 * Scores a rota. Lower is better. With `people` it also returns a detailed
 * breakdown (tallies, per-person counts and readable issues) for the UI.
 */
function evaluate(grid, ctx, people) {
  const { n, avail, leave, cap, work, totals, nights, weekends } = ctx;
  const detail = Boolean(people);
  const issues = [];
  const t = { empty: 0, dup: 0, unavail: 0, leave: 0, double: 0, turn: 0, cap: 0, streak: 0 };
  const note = (kind, text) => { if (detail) issues.push({ kind, text }); };
  work.fill(0);

  for (let s = 0; s < grid.length; s++) {
    const d = s >> 1;
    const sh = s & 1;
    const cell = grid[s];
    for (let k = 0; k < cell.length; k++) {
      const p = cell[k];
      if (p < 0 || p >= n) { t.empty++; if (detail) note('empty', `${shortDate(d)} ${SHIFT_NAMES[sh]} has an empty spot`); continue; }
      let dup = false;
      for (let j = 0; j < k; j++) if (cell[j] === p) dup = true;
      if (dup) { t.dup++; if (detail) note('dup', `${people[p].name} fills two spots on ${shortDate(d)} ${SHIFT_NAMES[sh]}`); continue; }
      if (!avail[p * 7 + (d % 7)]) { t.unavail++; if (detail) note('unavail', `${people[p].name} doesn't work ${WEEKDAYS[d % 7]}s but has ${shortDate(d)} ${SHIFT_NAMES[sh]}`); }
      if (leave[p * DAYS + d]) { t.leave++; if (detail) note('leave', `${people[p].name} is on time off ${shortDate(d)}`); }
      work[p * DAYS + d] |= sh ? 2 : 1;
    }
  }

  for (let p = 0; p < n; p++) {
    let total = 0; let night = 0; let wknd = 0; let streak = 0; let week = 0;
    for (let d = 0; d < DAYS; d++) {
      const w = work[p * DAYS + d];
      const shifts = (w & 1) + (w >> 1);
      if (w === 3) { t.double++; if (detail) note('double', `${people[p].name} works Day and Night on ${shortDate(d)}`); }
      if ((w & 2) && d + 1 < DAYS && (work[p * DAYS + d + 1] & 1)) {
        t.turn++;
        if (detail) note('turn', `${people[p].name} goes from Night ${shortDate(d)} straight to Day`);
      }
      streak = w ? streak + 1 : 0;
      if (streak > MAX_STREAK) { t.streak++; if (detail && streak === MAX_STREAK + 1) note('streak', `${people[p].name} works more than ${MAX_STREAK} days in a row from ${shortDate(d - MAX_STREAK)}`); }
      total += shifts; night += w >> 1; week += shifts;
      if (d % 7 >= 5) wknd += shifts;
      if (d % 7 === 6) {
        if (week > cap[p]) { t.cap += week - cap[p]; if (detail) note('cap', `${people[p].name} has ${week} shifts in week ${(d + 1) / 7} (max ${cap[p]})`); }
        week = 0;
      }
    }
    totals[p] = total; nights[p] = night; weekends[p] = wknd;
  }

  const fair = sumSquaredSpread(totals) + sumSquaredSpread(nights) + sumSquaredSpread(weekends);
  let cost = PENALTY.fair * fair;
  for (const key of Object.keys(t)) cost += PENALTY[key] * t[key];
  if (!detail) return cost;
  return { cost: Math.round(cost), tally: t, issues, totals: [...totals], nights: [...nights], weekends: [...weekends] };
}

/* ---------- Simulated annealing ---------- */
function cloneGrid(grid) { return grid.map(cell => cell.slice()); }

function makeSolver() {
  normaliseGrid();
  const ctx = buildCtx(state.people);
  const rng = mulberry32(state.seed * 2654435761);
  const pins = pinSet();
  const free = [];
  const grid = state.grid.map((cell, s) => cell.map((p, k) => {
    if (pins.has(pinKey(s, k))) return p;
    free.push([s, k]);
    return Math.floor(rng() * ctx.n);
  }));
  const cur = evaluate(grid, ctx);
  return {
    grid, ctx, rng, free, cur, best: cur, bestGrid: cloneGrid(grid),
    T: T_START, alpha: Math.pow(T_END / T_START, 1 / ITERATIONS), iter: 0, history: [[cur, cur, 0]],
  };
}

function accept(sv, next) {
  const delta = next - sv.cur;
  if (delta <= 0 || sv.rng() < Math.exp(-delta / sv.T)) { sv.cur = next; return true; }
  return false;
}

/** Runs up to `count` annealing moves: reassign one spot, or swap two. */
function step(sv, count) {
  const { grid, free, rng, ctx } = sv;
  const n = ctx.n;
  for (let i = 0; i < count && sv.iter < ITERATIONS; i++, sv.iter++) {
    sv.T *= sv.alpha;
    if (!free.length || n === 0) continue;
    const [s, k] = free[Math.floor(rng() * free.length)];
    const old = grid[s][k];
    if (free.length < 2 || rng() < 0.5) {
      let p = Math.floor(rng() * n);
      if (p === old) p = (p + 1) % n;
      grid[s][k] = p;
      if (!accept(sv, evaluate(grid, ctx))) grid[s][k] = old;
    } else {
      const [s2, k2] = free[Math.floor(rng() * free.length)];
      const other = grid[s2][k2];
      if (other === old) continue;
      grid[s][k] = other; grid[s2][k2] = old;
      if (!accept(sv, evaluate(grid, ctx))) { grid[s][k] = old; grid[s2][k2] = other; }
    }
    if (sv.cur < sv.best) { sv.best = sv.cur; sv.bestGrid = cloneGrid(grid); }
  }
  sv.history.push([sv.cur, sv.best, sv.iter]);
}

function finishSolve(sv) {
  state.grid = sv.bestGrid;
  state.stale = false;
  lastRun = { history: sv.history, iter: sv.iter, T: sv.T };
  running = null;
  save();
  renderAll();
}

function solve(animate) {
  if (!state.people.length) { renderAll(); return; }
  const sv = makeSolver();
  if (!animate) {
    while (sv.iter < ITERATIONS) step(sv, CHUNK * 5);
    finishSolve(sv);
    return;
  }
  running = sv;
  const tick = () => {
    if (running !== sv) return;
    step(sv, CHUNK);
    lastRun = { history: sv.history, iter: sv.iter, T: sv.T };
    renderLive(sv.grid);
    if (sv.iter < ITERATIONS) requestAnimationFrame(tick);
    else finishSolve(sv);
  };
  renderLive(sv.grid);
  requestAnimationFrame(tick);
}

function markStale() {
  running = null;
  state.stale = true;
  save();
}

/* ---------- DOM helpers ---------- */
const $ = id => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function button(cls, text, act) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (act) b.dataset.act = act;
  return b;
}
let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- Rota grid ---------- */
let tracePid = null;

function chip(p, s, k, pins) {
  if (p < 0) {
    const empty = button('chip empty', '—');
    empty.disabled = true;
    empty.setAttribute('aria-label', 'Empty spot');
    return empty;
  }
  const person = state.people[p];
  const day = s >> 1;
  const pinned = pins.has(pinKey(s, k));
  const bad = !person.avail[day % 7] || person.leave.includes(DAY_ISO[day]);
  const c = button(`chip${pinned ? ' pinned' : ''}${bad ? ' bad' : ''}`, undefined, 'pin');
  c.append(el('span', 'full', person.name), el('span', 'short', person.name.slice(0, 3)));
  c.style.setProperty('--h', person.hue);
  Object.assign(c.dataset, { slot: s, k, pid: p });
  c.setAttribute('aria-pressed', String(pinned));
  const label = `${person.name}, ${shortDate(day)} ${SHIFT_NAMES[s & 1]}${pinned ? ', pinned' : ''}. Click to ${pinned ? 'unpin' : 'pin'}.`;
  c.setAttribute('aria-label', label);
  c.title = label;
  return c;
}

function weekBlock(w, grid, pins) {
  const week = el('div', 'week');
  week.append(el('div', 'week-title', `Week ${w + 1} · ${shortDate(w * 7)} – ${shortDate(w * 7 + 6)}`), el('div'));
  for (let i = 0; i < 7; i++) {
    const head = el('div', `dayhead${i >= 5 ? ' wknd' : ''}`, WEEKDAYS[i]);
    head.append(el('b', '', String(dateOf(w * 7 + i).getDate())));
    week.append(head);
  }
  for (let sh = 0; sh < 2; sh++) {
    week.append(el('div', `rowlabel${sh ? ' night' : ''}`, SHIFT_NAMES[sh]));
    for (let i = 0; i < 7; i++) {
      const s = (w * 7 + i) * 2 + sh;
      const cell = el('div', `cell${i >= 5 ? ' wknd' : ''}${sh ? ' nightcell' : ''}`);
      grid[s].forEach((p, k) => cell.append(chip(p, s, k, pins)));
      week.append(cell);
    }
  }
  return week;
}

function renderRota(grid) {
  const pins = pinSet();
  const blocks = [0, 1, 2, 3].map(w => weekBlock(w, grid, pins));
  $('rota').replaceChildren(...blocks);
  $('range').textContent = `${shortDate(0)} – ${shortDate(DAYS - 1)}`;
  applyTrace();
}

function applyTrace() {
  const rota = $('rota');
  rota.classList.toggle('tracing', tracePid !== null);
  rota.querySelectorAll('.chip[data-pid]').forEach(c => {
    c.classList.toggle('on', Number(c.dataset.pid) === tracePid);
  });
}
function setTrace(pid) {
  if (pid === tracePid) return;
  tracePid = pid;
  applyTrace();
}

/* ---------- Score, curve, fairness, report ---------- */
function hardCount(result) { return HARD.reduce((sum, key) => sum + result.tally[key], 0); }

function renderScore(result) {
  const badge = $('badge');
  const hard = hardCount(result);
  let text = `${hard} conflict${hard === 1 ? '' : 's'}`;
  let cls = hard ? 'badge bad' : 'badge';
  if (!state.people.length) { text = 'Add people to start'; cls = 'badge warn'; }
  else if (running) { text = 'Solving…'; cls = 'badge warn'; }
  else if (state.stale) { text = `${text} · re-solve`; cls = hard ? 'badge bad' : 'badge warn'; }
  badge.textContent = text;
  badge.className = cls;
  $('cost').textContent = result.cost.toLocaleString('en');
  $('temp').textContent = running ? running.T.toFixed(1) : (lastRun.T !== null ? 'cooled' : '–');
  $('iters').textContent = lastRun.iter.toLocaleString('en');
  drawCurve();
}

function drawCurve() {
  const c = $('curve');
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || 260;
  const h = c.clientHeight || 120;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = '#1E2740';
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, (h * i) / 4); g.lineTo(w, (h * i) / 4); g.stroke(); }
  const hist = lastRun.history;
  if (hist.length < 2) {
    g.fillStyle = '#8B97B5';
    g.font = '12px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('Press Re-solve to watch it cool', w / 2, h / 2 + 4);
    return;
  }
  const top = Math.log1p(Math.max(...hist.map(p => p[0])));
  const x = it => (it / ITERATIONS) * w;
  const y = v => h - 6 - (Math.log1p(v) / top) * (h - 14);
  g.lineWidth = 1.2;
  g.strokeStyle = '#4B5878';
  g.beginPath();
  hist.forEach((p, i) => (i ? g.lineTo(x(p[2]), y(p[0])) : g.moveTo(x(p[2]), y(p[0]))));
  g.stroke();
  const fill = g.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, 'rgba(94, 234, 212, .35)');
  fill.addColorStop(1, 'rgba(94, 234, 212, 0)');
  g.beginPath();
  hist.forEach((p, i) => (i ? g.lineTo(x(p[2]), y(p[1])) : g.moveTo(x(p[2]), y(p[1]))));
  g.lineWidth = 2;
  g.strokeStyle = '#5EEAD4';
  g.stroke();
  g.lineTo(x(hist[hist.length - 1][2]), h);
  g.lineTo(0, h);
  g.fillStyle = fill;
  g.fill();
}

function barRow(value, max, cls) {
  const row = el('div', 'bar');
  const track = el('div', 'track');
  const fillEl = el('div', `fill ${cls}`);
  fillEl.style.width = `${max ? (value / max) * 100 : 0}%`;
  track.append(fillEl);
  row.append(track, el('span', '', String(value)));
  return row;
}

function renderFair(result) {
  const max = Math.max(1, ...result.totals);
  const rows = state.people.map((p, i) => {
    const row = el('div', 'frow');
    const name = el('div', 'fname', p.name);
    name.style.setProperty('--h', p.hue);
    const bars = el('div', 'bars');
    bars.append(barRow(result.totals[i], max, 's'), barRow(result.nights[i], max, 'n'), barRow(result.weekends[i], max, 'w'));
    row.append(name, bars);
    row.addEventListener('mouseenter', () => setTrace(i));
    row.addEventListener('mouseleave', () => setTrace(null));
    return row;
  });
  $('fair').replaceChildren(...rows);
}

function spread(arr) {
  if (!arr.length) return '0';
  const lo = Math.min(...arr);
  const hi = Math.max(...arr);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

function reportItems(result) {
  const items = [];
  const n = state.people.length;
  if (!n) return [['bad', 'Add at least one person to build a rota.']];
  if (n < state.perShift) items.push(['warn', `Only ${n} ${n === 1 ? 'person' : 'people'} for ${state.perShift} per shift, so some spots repeat a person.`]);
  const demand = 14 * state.perShift;
  const capacity = state.people.reduce((sum, p) => sum + p.cap, 0);
  if (capacity < demand) items.push(['warn', `Each week needs ${demand} shifts but the weekly caps only allow ${capacity}. Raise caps or add people.`]);
  if (state.stale) items.push(['warn', 'Inputs changed since the last solve. Press Re-solve.']);
  const hard = result.issues.filter(i => HARD.includes(i.kind));
  hard.slice(0, MAX_REPORT_LINES).forEach(i => items.push(['bad', i.text]));
  if (hard.length > MAX_REPORT_LINES) items.push(['bad', `…and ${hard.length - MAX_REPORT_LINES} more conflicts.`]);
  if (!hard.length) items.push(['ok', 'Every hard rule holds: availability, time off, one shift a day, no night-to-day turnarounds, weekly caps.']);
  const soft = result.issues.filter(i => i.kind === 'streak');
  soft.slice(0, 3).forEach(i => items.push(['warn', i.text]));
  items.push(['info', `Per person: shifts ${spread(result.totals)} · nights ${spread(result.nights)} · weekend shifts ${spread(result.weekends)}`]);
  const pins = state.pins.length;
  if (pins) items.push(['info', `${pins} pinned spot${pins === 1 ? '' : 's'} kept in place on every solve.`]);
  return items;
}

function renderReport(result) {
  $('report').replaceChildren(...reportItems(result).map(([cls, text]) => el('li', cls, text)));
}

/* ---------- Team ---------- */
function personCard(p, i) {
  const card = el('article', 'card');
  card.dataset.i = i;
  card.style.setProperty('--h', p.hue);
  const name = el('input', 'name');
  Object.assign(name, { value: p.name, maxLength: 24 });
  name.dataset.act = 'name';
  name.setAttribute('aria-label', `Name of person ${i + 1}`);
  const capLabel = el('label', 'cap', 'Max/wk');
  const cap = el('input');
  Object.assign(cap, { type: 'number', min: 1, max: 7, value: p.cap });
  cap.dataset.act = 'cap';
  cap.setAttribute('aria-label', `${p.name}: most shifts per week`);
  capLabel.append(cap);
  const remove = button('remove', '×', 'remove');
  remove.setAttribute('aria-label', `Remove ${p.name}`);
  const top = el('div', 'card-top');
  top.append(name, capLabel, remove);

  const days = el('div', 'days');
  days.setAttribute('role', 'group');
  days.setAttribute('aria-label', `${p.name}: days available`);
  WEEKDAYS.forEach((w, wi) => {
    const b = button('day', w.slice(0, 2), 'day');
    b.dataset.w = wi;
    b.setAttribute('aria-pressed', String(p.avail[wi]));
    b.setAttribute('aria-label', w);
    days.append(b);
  });

  const leave = el('div', 'leave');
  const date = el('input');
  Object.assign(date, { type: 'date', min: DAY_ISO[0], max: DAY_ISO[DAYS - 1] });
  date.setAttribute('aria-label', `Time off date for ${p.name}`);
  leave.append(date, button('leave-add', 'Add off', 'leave-add'));
  const list = el('div', 'leave-list');
  p.leave.forEach(iso => {
    const b = button('off', `${isoToShort(iso)} ×`, 'leave-remove');
    b.dataset.iso = iso;
    b.setAttribute('aria-label', `Remove time off on ${isoToShort(iso)}`);
    list.append(b);
  });
  card.append(top, days, leave, list);
  return card;
}

function renderTeam(focusSelector) {
  $('people').replaceChildren(...state.people.map(personCard));
  $('add').disabled = state.people.length >= MAX_PEOPLE;
  if (focusSelector) {
    const target = $('people').querySelector(focusSelector);
    if (target) target.focus();
  }
}

/* ---------- Render ---------- */
function currentResult(grid) {
  return evaluate(grid, buildCtx(state.people), state.people);
}

function renderAll(opts = {}) {
  normaliseGrid();
  const result = currentResult(state.grid);
  $('perShift').value = String(state.perShift);
  $('seed').value = String(state.seed);
  $('solve').disabled = !state.people.length;
  $('solve').classList.toggle('pulse', state.stale);
  renderRota(state.grid);
  renderScore(result);
  renderFair(result);
  renderReport(result);
  if (opts.team !== false) renderTeam(opts.focus);
}

function renderLive(grid) {
  const result = currentResult(grid);
  $('solve').disabled = true;
  $('solve').classList.remove('pulse');
  renderRota(grid);
  renderScore(result);
  renderFair(result);
  renderReport(result);
}

/* ---------- Team events ---------- */
function afterEdit(stale) {
  if (stale) markStale(); else save();
  renderAll({ team: false });
}

function removePerson(i) {
  state.people = state.people.filter((_, j) => j !== i);
  state.grid = state.grid.map(cell => cell.map(p => (p === i ? -1 : p > i ? p - 1 : p)));
  setTrace(null);
}

function onTeamClick(e) {
  const target = e.target.closest('[data-act]');
  const card = e.target.closest('.card');
  if (!target || !card) return;
  const i = Number(card.dataset.i);
  const person = state.people[i];
  const act = target.dataset.act;
  if (act === 'day') {
    const w = Number(target.dataset.w);
    person.avail = person.avail.map((v, j) => (j === w ? !v : v));
    target.setAttribute('aria-pressed', String(person.avail[w]));
    afterEdit(true);
  } else if (act === 'remove') {
    removePerson(i);
    markStale();
    renderAll({ focus: '#add' });
    $('add').focus();
  } else if (act === 'leave-add') {
    const iso = card.querySelector('input[type="date"]').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) { toast('Pick a date first'); return; }
    if (person.leave.includes(iso)) { toast('That day is already off'); return; }
    person.leave = [...person.leave, iso].sort();
    markStale();
    renderAll({ focus: `.card[data-i="${i}"] .leave-add` });
  } else if (act === 'leave-remove') {
    person.leave = person.leave.filter(d => d !== target.dataset.iso);
    markStale();
    renderAll({ focus: `.card[data-i="${i}"] .leave-add` });
  }
}

function onTeamInput(e) {
  const card = e.target.closest('.card');
  if (!card) return;
  const i = Number(card.dataset.i);
  if (e.target.dataset.act === 'name') {
    state.people[i].name = e.target.value.trim().slice(0, 24) || `Person ${i + 1}`;
    afterEdit(false);
  } else if (e.target.dataset.act === 'cap' && e.target.value !== '') {
    state.people[i].cap = clampInt(e.target.value, 1, 7, 4);
    afterEdit(true);
  }
}

function addPerson() {
  if (state.people.length >= MAX_PEOPLE) { toast(`Up to ${MAX_PEOPLE} people`); return; }
  const last = state.people[state.people.length - 1];
  const hue = last ? (last.hue + 137) % 360 : 168;
  const n = state.people.length;
  state.people = [...state.people, { name: `Person ${n + 1}`, hue, cap: 4, avail: ALL.slice(), leave: [] }];
  markStale();
  renderAll({ focus: `.card[data-i="${n}"] .name` });
  const input = $('people').querySelector(`.card[data-i="${n}"] .name`);
  if (input) input.select();
}

/* ---------- Export ---------- */
function rotaRows() {
  return Array.from({ length: SLOTS }, (_, s) => {
    const d = s >> 1;
    const names = state.grid[s].filter(p => p >= 0).map(p => state.people[p].name);
    return { iso: DAY_ISO[d], weekday: WEEKDAYS[d % 7], shift: SHIFT_NAMES[s & 1], names };
  });
}
function csvField(v) {
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return `"${String(safe).replace(/"/g, '""')}"`;
}
function exportCsv() {
  const lines = [['Date', 'Weekday', 'Shift', 'People'].map(csvField).join(',')];
  rotaRows().forEach(r => lines.push([r.iso, r.weekday, r.shift, r.names.join('; ')].map(csvField).join(',')));
  const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  Object.assign(a, { href: url, download: `rotamint-${DAY_ISO[0]}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Rota exported as CSV');
}
function rotaText() {
  const rows = rotaRows();
  const out = ['Rotamint rota'];
  for (let d = 0; d < DAYS; d++) {
    if (d % 7 === 0) out.push('', `Week ${d / 7 + 1}`);
    const [day, night] = [rows[d * 2], rows[d * 2 + 1]];
    out.push(`${shortDate(d).padEnd(11)}  Day: ${day.names.join(', ') || '-'}  |  Night: ${night.names.join(', ') || '-'}`);
  }
  return out.join('\n');
}
function copyText() {
  const text = rotaText();
  const fallback = () => {
    const area = el('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    toast(ok ? 'Rota copied as text' : 'Copy failed: your browser blocked it');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Rota copied as text'), fallback);
  } else {
    fallback();
  }
}

/* ---------- Wiring ---------- */
function onRotaClick(e) {
  const c = e.target.closest('.chip[data-pid]');
  if (!c || running) return;
  const key = pinKey(c.dataset.slot, c.dataset.k);
  state.pins = state.pins.includes(key) ? state.pins.filter(k => k !== key) : [...state.pins, key];
  save();
  renderAll({ team: false });
  const again = $('rota').querySelector(`.chip[data-slot="${c.dataset.slot}"][data-k="${c.dataset.k}"]`);
  if (again) again.focus();
}

function traceFrom(e) {
  const c = e.target.closest('[data-pid]');
  const card = e.target.closest('.card');
  if (c) setTrace(Number(c.dataset.pid));
  else if (card) setTrace(Number(card.dataset.i));
}

function wire() {
  $('solve').addEventListener('click', () => solve(true));
  $('perShift').addEventListener('change', e => {
    state.perShift = clampInt(e.target.value, 1, 3, 2);
    normaliseGrid();
    solve(true);
  });
  $('seed').addEventListener('change', e => {
    state.seed = clampInt(e.target.value, 1, 99999, 7);
    markStale();
    renderAll({ team: false });
  });
  $('csv').addEventListener('click', exportCsv);
  $('copy').addEventListener('click', copyText);
  $('reset').addEventListener('click', () => {
    running = null;
    state = freshState();
    tracePid = null;
    solve(false);
    toast('Sample team restored');
  });
  $('add').addEventListener('click', addPerson);
  const rota = $('rota');
  rota.addEventListener('click', onRotaClick);
  rota.addEventListener('mouseover', traceFrom);
  rota.addEventListener('focusin', traceFrom);
  rota.addEventListener('mouseleave', () => setTrace(null));
  rota.addEventListener('focusout', () => setTrace(null));
  const people = $('people');
  people.addEventListener('click', onTeamClick);
  people.addEventListener('input', onTeamInput);
  people.addEventListener('change', e => { if (e.target.dataset.act === 'cap') e.target.value = state.people[Number(e.target.closest('.card').dataset.i)].cap; });
  people.addEventListener('mouseover', traceFrom);
  people.addEventListener('mouseleave', () => setTrace(null));
  window.addEventListener('resize', drawCurve);
}

function init() {
  wire();
  normaliseGrid();
  const unsolved = state.grid.every(cell => cell.every(p => p < 0));
  if (state.people.length && unsolved) solve(false);
  else renderAll();
}

init();
