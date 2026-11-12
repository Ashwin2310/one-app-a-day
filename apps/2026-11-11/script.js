'use strict';

/* ============================================================
   Tablewright: seating plans solved by simulated annealing.
   Config state is replaced immutably; the solver's hot loop uses
   typed arrays that it mutates in place for speed.
   ============================================================ */

const STORAGE_KEY = 'tablewright.v1';
const SVG_NS = 'http://www.w3.org/2000/svg';
const LIMITS = { maxGuests: 300, minTables: 1, maxTables: 40, minSeats: 2, maxSeats: 16, maxName: 40 };
const TYPE = { next: 0, with: 1, apart: 2, group: 3 };
const RULE_LABEL = { next: 'sit next to', with: 'same table as', apart: 'keep apart from' };
const COST = { nextSplit: 100, nextGap: 6, withSplit: 15, apartSame: 100, apartAdj: 150, groupSplit: 2 };
const MAX_COST = [COST.nextSplit, COST.withSplit, COST.apartAdj, COST.groupSplit];
const THOROUGHNESS = { quick: 0.5, balanced: 1, thorough: 3 };
const ANNEAL = { t0: 60, tEnd: 0.05, perGuest: 5000, minSteps: 60000, maxSteps: 900000, durationMs: 1500 };
const GROUP_COLORS = ['#e8b860', '#7fb2ff', '#ff8fa3', '#7fd1a8', '#c39bff', '#ffb27a', '#5fd3d3', '#d6d97a'];
const SEAT_R = 13;
const TOAST_MS = 2800;
const CONFIRM_MS = 3500;

const SAMPLE_GUESTS = [
  ['Bride’s family', ['Divya Nair', 'Arjun Nair', 'Lakshmi Nair', 'Ravi Nair', 'Meera Iyer', 'Karthik Iyer', 'Grandma Saroja', 'Grandpa Mohan', 'Anjali Menon', 'Dev Menon']],
  ['Groom’s family', ['Uncle Victor', 'Aunt Marguerite', 'Tom Hale', 'Ellen Hale', 'Grandma Rose', 'Grandpa Walt', 'Sophie Hale', 'Ben Carter', 'Nina Carter', 'Leo Hale']],
  ['College friends', ['Aisha Khan', 'Omar Khan', 'Jess Park', 'Daniel Park', 'Maya Lopez', 'Sam Ortiz', 'Chloe Wu', 'Ethan Brooks', 'Zoe Martin']],
  ['Bride’s work', ['Hannah Lee', 'Marcus Reed', 'Fatima Ali', 'Kenji Sato', 'Laura Bianchi', 'Paul Becker', 'Ines Duarte']],
  ['Groom’s work', ['Ryan Cole', 'Grace Kim', 'Noah Fischer', 'Olivia Grant', 'Mateo Silva', 'Ava Novak', 'Lucas Weber']],
  ['Neighbours', ['Helen Murphy', 'Frank Murphy', 'Rosa Diaz', 'Ivan Petrov']],
  ['Book club', ['Clara Jensen', 'Ruth Adler', 'Mei Lin']],
];

const SAMPLE_RULES = [
  ['Arjun Nair', 'next', 'Lakshmi Nair'], ['Karthik Iyer', 'next', 'Meera Iyer'],
  ['Grandma Saroja', 'next', 'Grandpa Mohan'], ['Anjali Menon', 'next', 'Dev Menon'],
  ['Tom Hale', 'next', 'Ellen Hale'], ['Grandma Rose', 'next', 'Grandpa Walt'],
  ['Ben Carter', 'next', 'Nina Carter'], ['Aisha Khan', 'next', 'Omar Khan'],
  ['Jess Park', 'next', 'Daniel Park'], ['Helen Murphy', 'next', 'Frank Murphy'],
  ['Grace Kim', 'next', 'Noah Fischer'], ['Maya Lopez', 'next', 'Sam Ortiz'],
  ['Kenji Sato', 'next', 'Laura Bianchi'],
  ['Divya Nair', 'with', 'Zoe Martin'], ['Grandma Saroja', 'with', 'Grandma Rose'],
  ['Sophie Hale', 'with', 'Chloe Wu'], ['Rosa Diaz', 'with', 'Clara Jensen'],
  ['Mei Lin', 'with', 'Ruth Adler'], ['Leo Hale', 'with', 'Ethan Brooks'],
  ['Hannah Lee', 'with', 'Ryan Cole'],
  ['Uncle Victor', 'apart', 'Aunt Marguerite'], ['Marcus Reed', 'apart', 'Paul Becker'],
  ['Ivan Petrov', 'apart', 'Frank Murphy'], ['Lucas Weber', 'apart', 'Olivia Grant'],
];

/* ---------------- State ---------------- */

function sampleState() {
  const guests = SAMPLE_GUESTS.flatMap(([group, names]) => names.map((name) => ({ name, group })));
  const rules = SAMPLE_RULES.map(([a, type, b]) => ({ a, b, type }));
  return { guests, rules, tables: 7, seatsPerTable: 8, seats: [], pins: {}, thoroughness: 'balanced' };
}

const clampInt = (v, lo, hi, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Validates any untrusted state (e.g. from localStorage); returns a clean copy or null. */
function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.guests)) return null;
  const guests = dedupeGuests(raw.guests
    .filter((g) => g && typeof g.name === 'string' && g.name.trim())
    .map((g) => ({ name: g.name.trim().slice(0, LIMITS.maxName), group: String(g.group || 'Guests').trim().slice(0, LIMITS.maxName) || 'Guests' }))
    .slice(0, LIMITS.maxGuests));
  const names = new Set(guests.map((g) => g.name));
  const rules = cleanRules(Array.isArray(raw.rules) ? raw.rules : [], names);
  const seatsPerTable = clampInt(raw.seatsPerTable, LIMITS.minSeats, LIMITS.maxSeats, 8);
  const tables = Math.max(clampInt(raw.tables, LIMITS.minTables, LIMITS.maxTables, 7), Math.ceil(guests.length / seatsPerTable) || 1);
  if (tables > LIMITS.maxTables) return null;
  const total = tables * seatsPerTable;
  const seats = validSeats(raw.seats, guests.length, total) ? raw.seats.slice() : [];
  const pins = seats.length ? cleanPins(raw.pins, guests, seats) : {};
  const thoroughness = THOROUGHNESS[raw.thoroughness] ? raw.thoroughness : 'balanced';
  return { guests, rules, tables, seatsPerTable, seats, pins, thoroughness };
}

function dedupeGuests(list) {
  const seen = new Map();
  return list.map((g) => {
    const count = (seen.get(g.name) || 0) + 1;
    seen.set(g.name, count);
    return count === 1 ? g : { ...g, name: `${g.name} (${count})` };
  });
}

function cleanRules(list, names) {
  const pairs = new Set();
  return list.filter((r) => {
    if (!r || !names.has(r.a) || !names.has(r.b) || r.a === r.b || !(r.type in RULE_LABEL)) return false;
    const key = [r.a, r.b].sort().join('\u0000');
    if (pairs.has(key)) return false;
    pairs.add(key);
    return true;
  }).map((r) => ({ a: r.a, b: r.b, type: r.type }));
}

function validSeats(seats, n, total) {
  if (!Array.isArray(seats) || seats.length !== total) return false;
  const seen = new Set();
  for (const g of seats) {
    if (g === -1) continue;
    if (!Number.isInteger(g) || g < 0 || g >= n || seen.has(g)) return false;
    seen.add(g);
  }
  return seen.size === n;
}

function cleanPins(pins, guests, seats) {
  if (!pins || typeof pins !== 'object') return {};
  return Object.fromEntries(guests
    .map((g, i) => [g.name, seats.indexOf(i)])
    .filter(([name, seat]) => Number.isInteger(pins[name]) && pins[name] === seat));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeState(JSON.parse(raw)) : null;
  } catch (err) {
    console.warn('Tablewright: could not read saved plan', err);
    return null;
  }
}

function saveState(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (err) {
    console.warn('Tablewright: could not save plan', err);
  }
}

/* ---------------- Model and scoring ---------------- */

function buildModel(s) {
  const n = s.guests.length;
  const cap = s.seatsPerTable;
  const total = s.tables * cap;
  const index = new Map(s.guests.map((g, i) => [g.name, i]));
  const ruleRels = s.rules.map((r) => ({ a: index.get(r.a), b: index.get(r.b), type: TYPE[r.type], rule: r }));
  const groupRels = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (s.guests[i].group === s.guests[j].group) groupRels.push({ a: i, b: j, type: TYPE.group, rule: null });
    }
  }
  const relList = [...ruleRels, ...groupRels].map((r, id) => ({ ...r, id }));
  const rels = Array.from({ length: n }, () => []);
  relList.forEach((r) => { rels[r.a].push(r); rels[r.b].push(r); });
  const pinnedSeat = new Uint8Array(total);
  Object.values(s.pins).forEach((seat) => { if (seat >= 0 && seat < total) pinnedSeat[seat] = 1; });
  const maxCost = relList.reduce((sum, r) => sum + MAX_COST[r.type], 0);
  const groups = [...new Set(s.guests.map((g) => g.group))];
  return { n, cap, total, relList, rels, ruleCount: ruleRels.length, pinnedSeat, maxCost, groups };
}

function isAdjacent(sa, sb, cap) {
  const d = Math.abs((sa % cap) - (sb % cap));
  return d === 1 || d === cap - 1;
}

function relCost(type, sa, sb, cap) {
  const same = ((sa / cap) | 0) === ((sb / cap) | 0);
  if (type === TYPE.group) return same ? 0 : COST.groupSplit;
  if (type === TYPE.with) return same ? 0 : COST.withSplit;
  if (type === TYPE.next) {
    if (!same) return COST.nextSplit;
    return isAdjacent(sa, sb, cap) ? 0 : COST.nextGap;
  }
  if (!same) return 0;
  return isAdjacent(sa, sb, cap) ? COST.apartAdj : COST.apartSame;
}

function positionsOf(seats, n) {
  const pos = new Int16Array(n).fill(-1);
  seats.forEach((g, s) => { if (g >= 0) pos[g] = s; });
  return pos;
}

function totalCost(model, pos) {
  return model.relList.reduce((sum, r) => sum + relCost(r.type, pos[r.a], pos[r.b], model.cap), 0);
}

function ruleMet(type, sa, sb, cap) {
  const same = ((sa / cap) | 0) === ((sb / cap) | 0);
  if (type === TYPE.next) return same && isAdjacent(sa, sb, cap);
  if (type === TYPE.with) return same;
  return !same;
}

function isHard(type, sa, sb, cap) {
  const same = ((sa / cap) | 0) === ((sb / cap) | 0);
  return (type === TYPE.next && !same) || (type === TYPE.apart && same);
}

function evaluate(model, seats) {
  if (!model.n) return { cost: 0, harmony: 100, met: 0, total: 0, hard: 0, broken: 0 };
  const pos = positionsOf(seats, model.n);
  const cost = totalCost(model, pos);
  const rules = model.relList.slice(0, model.ruleCount);
  const met = rules.filter((r) => ruleMet(r.type, pos[r.a], pos[r.b], model.cap)).length;
  const hard = rules.filter((r) => isHard(r.type, pos[r.a], pos[r.b], model.cap)).length;
  const harmony = model.maxCost ? Math.round(100 * (1 - cost / model.maxCost)) : 100;
  return { cost, harmony, met, total: rules.length, hard, broken: rules.length - met };
}

/* ---------------- Placement ---------------- */

function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Random arrangement that keeps pinned guests on their pinned seats. */
function randomSeats(s) {
  const total = s.tables * s.seatsPerTable;
  const seats = new Array(total).fill(-1);
  const pinnedGuests = new Set();
  s.guests.forEach((g, i) => {
    const seat = s.pins[g.name];
    if (Number.isInteger(seat) && seat < total) { seats[seat] = i; pinnedGuests.add(i); }
  });
  const freeSeats = shuffled(seats.map((g, i) => (g === -1 ? i : -1)).filter((i) => i >= 0));
  s.guests.forEach((_, i) => { if (!pinnedGuests.has(i)) seats[freeSeats.pop()] = i; });
  return seats;
}

/* ---------------- Simulated annealing ---------------- */

function createSolver(model, seats, multiplier) {
  const { n, cap, total, rels, relList, pinnedSeat } = model;
  const seatGuest = Int16Array.from(seats);
  const pos = positionsOf(seats, n);
  const stamp = new Int32Array(relList.length);
  const free = [];
  for (let s = 0; s < total; s += 1) if (!pinnedSeat[s]) free.push(s);
  const steps = Math.round(Math.min(ANNEAL.maxSteps, Math.max(ANNEAL.minSteps, ANNEAL.perGuest * n)) * multiplier);
  const ratio = ANNEAL.tEnd / ANNEAL.t0;
  let mark = 0;
  let done = 0;
  let cost = totalCost(model, pos);
  let best = cost;
  const bestSeats = seatGuest.slice();

  function localCost(g1, g2) {
    mark += 1;
    let c = 0;
    for (const g of [g1, g2]) {
      if (g < 0) continue;
      for (const r of rels[g]) {
        if (stamp[r.id] === mark) continue;
        stamp[r.id] = mark;
        c += relCost(r.type, pos[r.a], pos[r.b], cap);
      }
    }
    return c;
  }

  function swap(s1, s2) {
    const g1 = seatGuest[s1];
    const g2 = seatGuest[s2];
    seatGuest[s1] = g2;
    seatGuest[s2] = g1;
    if (g1 >= 0) pos[g1] = s2;
    if (g2 >= 0) pos[g2] = s1;
  }

  function tryMove(temp) {
    const s1 = free[(Math.random() * free.length) | 0];
    const s2 = free[(Math.random() * free.length) | 0];
    const g1 = seatGuest[s1];
    const g2 = seatGuest[s2];
    if (s1 === s2 || (g1 < 0 && g2 < 0)) return;
    const before = localCost(g1, g2);
    swap(s1, s2);
    const delta = localCost(g1, g2) - before;
    if (delta <= 0 || Math.random() < Math.exp(-delta / temp)) {
      cost += delta;
      if (cost < best) { best = cost; bestSeats.set(seatGuest); }
    } else {
      swap(s1, s2);
    }
  }

  function run(target) {
    const end = Math.min(steps, target);
    if (free.length < 2) { done = steps; return; }
    for (; done < end; done += 1) tryMove(ANNEAL.t0 * ratio ** (done / steps));
  }

  return {
    steps,
    run,
    get done() { return done; },
    get cost() { return cost; },
    get finished() { return done >= steps; },
    current: () => Array.from(seatGuest),
    best: () => Array.from(bestSeats),
    temperature: () => ANNEAL.t0 * ratio ** (done / steps),
  };
}

/* ---------------- DOM helpers ---------------- */

const $ = (id) => document.getElementById(id);
const els = {
  plan: $('plan'), legend: $('legend'), emptyMsg: $('emptyMsg'), planStatus: $('planStatus'),
  harmony: $('statHarmony'), rules: $('statRules'), hard: $('statHard'), swaps: $('statSwaps'),
  chart: $('chart'), summary: $('summary'), tableList: $('tableList'),
  guestInput: $('guestInput'), guestCount: $('guestCount'), applyGuests: $('applyGuests'),
  ruleForm: $('ruleForm'), ruleA: $('ruleA'), ruleB: $('ruleB'), ruleType: $('ruleType'), ruleList: $('ruleList'),
  tableForm: $('tableForm'), tableCount: $('tableCount'), seatCount: $('seatCount'), capacityHint: $('capacityHint'),
  thoroughness: $('thoroughness'), solveBtn: $('solveBtn'), shuffleBtn: $('shuffleBtn'),
  guestCard: $('guestCard'), cardDot: $('cardDot'), cardName: $('cardName'), cardMeta: $('cardMeta'), cardRules: $('cardRules'),
  pinBtn: $('pinBtn'), deselectBtn: $('deselectBtn'),
  csvBtn: $('csvBtn'), copyBtn: $('copyBtn'), printBtn: $('printBtn'), resetBtn: $('resetBtn'), toast: $('toast'),
};

function svg(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (parent) parent.appendChild(node);
  return node;
}

function html(tag, attrs = {}, text = '') {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (text) node.textContent = text;
  return node;
}

let toastTimer = 0;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), TOAST_MS);
}

const initials = (name) => {
  const parts = name.replace(/\(.*?\)/g, '').trim().split(/\s+/);
  const first = parts[0] || '?';
  return (first[0] + (parts.length > 1 ? parts[parts.length - 1][0] : first[1] || '')).toUpperCase();
};

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- App ---------------- */

let state = loadState() || sampleState();
let model = buildModel(state);
let geo = null;
let selected = -1;
let solveJob = null;
let history = [];
let startStats = null;
let swapsTried = 0;
const nodes = { guests: [], slots: [], links: null };

function commit(next, { save = true } = {}) {
  state = next;
  if (save) saveState(state);
}

function groupColor(name) {
  const i = model.groups.indexOf(name);
  return GROUP_COLORS[(i < 0 ? 0 : i) % GROUP_COLORS.length];
}

/* -- Geometry -- */

function computeGeometry() {
  const cap = state.seatsPerTable;
  const ring = Math.max(66, (cap * (SEAT_R * 2 + 6)) / (2 * Math.PI));
  const tableR = Math.max(30, ring - SEAT_R - 14);
  const cell = Math.ceil(2 * (ring + SEAT_R) + 22);
  const width = els.plan.clientWidth || 800;
  const cols = Math.max(2, Math.min(state.tables, Math.floor(width / (cell * 1.05)) || 2));
  const rows = Math.ceil(state.tables / cols);
  const center = (t) => ({ x: (t % cols) * cell + cell / 2, y: Math.floor(t / cols) * cell + cell / 2 });
  const seatXY = (s) => {
    const c = center(Math.floor(s / cap));
    const angle = -Math.PI / 2 + ((s % cap) * 2 * Math.PI) / cap;
    return { x: c.x + ring * Math.cos(angle), y: c.y + ring * Math.sin(angle) };
  };
  return { cols, rows, cell, tableR, center, seatXY, width: cols * cell, height: rows * cell };
}

/* -- Plan rendering -- */

function buildPlan() {
  geo = computeGeometry();
  els.plan.textContent = '';
  els.emptyMsg.hidden = state.guests.length > 0;
  const root = svg('svg', { viewBox: `0 0 ${geo.width} ${geo.height}`, role: 'group', 'aria-label': 'Floor plan' }, els.plan);
  const defs = svg('defs', {}, root);
  const grad = svg('radialGradient', { id: 'tableGrad', cx: '50%', cy: '40%', r: '65%' }, defs);
  svg('stop', { offset: '0%', 'stop-color': '#2c2a2a' }, grad);
  svg('stop', { offset: '100%', 'stop-color': '#1a1c25' }, grad);
  const tablesLayer = svg('g', {}, root);
  for (let t = 0; t < state.tables; t += 1) {
    const c = geo.center(t);
    svg('circle', { class: 'tbl-top', cx: c.x, cy: c.y, r: geo.tableR }, tablesLayer);
    svg('text', { class: 'tbl-label', x: c.x, y: c.y - 5 }, tablesLayer).textContent = `T${t + 1}`;
    svg('text', { class: 'tbl-sub', x: c.x, y: c.y + 13, id: `tblsub-${t}` }, tablesLayer);
  }
  nodes.slots = buildSlots(root);
  nodes.links = svg('g', { class: 'links' }, root);
  nodes.guests = buildGuests(root);
  renderLegend();
  renderSeats(state.seats);
}

function buildSlots(root) {
  const layer = svg('g', {}, root);
  return Array.from({ length: state.tables * state.seatsPerTable }, (_, s) => {
    const p = geo.seatXY(s);
    const slot = svg('circle', { class: 'seat-slot', cx: p.x, cy: p.y, r: SEAT_R, 'data-seat': s, tabindex: '-1', role: 'button',
      'aria-label': `Empty seat, table ${Math.floor(s / state.seatsPerTable) + 1}` }, layer);
    return slot;
  });
}

function buildGuests(root) {
  const layer = svg('g', {}, root);
  return state.guests.map((g, i) => {
    const node = svg('g', { class: 'guest', 'data-guest': i, tabindex: '0', role: 'button' }, layer);
    svg('circle', { r: SEAT_R, fill: groupColor(g.group) }, node);
    svg('text', {}, node).textContent = initials(g.name);
    svg('title', {}, node).textContent = `${g.name} · ${g.group}`;
    return node;
  });
}

function renderSeats(seats) {
  if (!geo || !seats.length) return;
  const cap = state.seatsPerTable;
  const pinnedNames = new Set(Object.keys(state.pins));
  seats.forEach((g, s) => {
    nodes.slots[s].classList.toggle('target', g === -1 && selected >= 0);
    nodes.slots[s].setAttribute('tabindex', g === -1 && selected >= 0 ? '0' : '-1');
    if (g < 0) return;
    const p = geo.seatXY(s);
    const node = nodes.guests[g];
    node.style.transform = `translate(${p.x}px, ${p.y}px)`;
    const guest = state.guests[g];
    node.setAttribute('aria-label', `${guest.name}, ${guest.group}, table ${Math.floor(s / cap) + 1} seat ${(s % cap) + 1}${pinnedNames.has(guest.name) ? ', pinned' : ''}`);
    node.classList.toggle('selected', g === selected);
    togglePinRing(node, pinnedNames.has(guest.name));
  });
  for (let t = 0; t < state.tables; t += 1) {
    const count = seats.slice(t * cap, (t + 1) * cap).filter((g) => g >= 0).length;
    const sub = document.getElementById(`tblsub-${t}`);
    if (sub) sub.textContent = `${count}/${cap}`;
  }
  renderLinks(seats);
}

function togglePinRing(node, pinned) {
  const ring = node.querySelector('.pin');
  if (pinned && !ring) svg('circle', { class: 'pin', r: SEAT_R + 4 }, node);
  if (!pinned && ring) ring.remove();
}

function renderLinks(seats) {
  const layer = nodes.links;
  layer.textContent = '';
  const pos = positionsOf(seats, model.n);
  model.relList.slice(0, model.ruleCount).forEach((r) => {
    const involved = r.a === selected || r.b === selected;
    const met = ruleMet(r.type, pos[r.a], pos[r.b], model.cap);
    if (met && !involved) return;
    const p1 = geo.seatXY(pos[r.a]);
    const p2 = geo.seatXY(pos[r.b]);
    const cls = `link ${met ? 'good' : 'bad'}${involved ? ' focus' : ''}`;
    svg('line', { class: cls, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }, layer);
  });
  nodes.guests.forEach((node, i) => {
    const related = selected < 0 || i === selected || model.rels[selected].some((r) => r.rule && (r.a === i || r.b === i));
    node.classList.toggle('dim', !related);
  });
}

function renderLegend() {
  els.legend.textContent = '';
  model.groups.forEach((group) => {
    const li = html('li');
    const dot = html('span', { class: 'dot' });
    dot.style.background = groupColor(group);
    li.append(dot, document.createTextNode(group));
    els.legend.appendChild(li);
  });
}

/* -- Stats, chart, table list -- */

function renderStats(seats) {
  const ev = evaluate(model, seats);
  els.harmony.textContent = String(ev.harmony);
  els.rules.textContent = `${ev.met}/${ev.total}`;
  els.hard.textContent = String(ev.hard);
  els.hard.classList.toggle('is-bad', ev.hard > 0);
  els.hard.classList.toggle('is-good', ev.hard === 0 && ev.total > 0);
  els.swaps.textContent = swapsTried >= 1000 ? `${Math.round(swapsTried / 1000)}k` : String(swapsTried);
  return ev;
}

function renderSummary(ev) {
  els.summary.textContent = '';
  if (!startStats) { els.summary.textContent = `${ev.broken} rules broken`; return; }
  const from = html('span', { class: 'from' }, String(startStats.broken));
  const to = html('strong', {}, String(ev.broken));
  els.summary.append('Rules broken ', from, ' → ', to, ` · cost ${Math.round(startStats.cost)} → ${Math.round(ev.cost)}`);
}

function drawChart() {
  const canvas = els.chart;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 140;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  drawGrid(ctx, w, h);
  if (history.length < 2) return;
  const max = Math.max(...history.map((p) => p.cost)) || 1;
  const min = Math.min(...history.map((p) => p.cost));
  const pad = 8;
  const x = (i) => pad + (i / (history.length - 1)) * (w - pad * 2);
  const y = (v) => pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2);
  const fill = ctx.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, 'rgba(232,184,96,0.35)');
  fill.addColorStop(1, 'rgba(232,184,96,0)');
  ctx.beginPath();
  history.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.cost)) : ctx.moveTo(x(i), y(p.cost))));
  ctx.lineTo(x(history.length - 1), h);
  ctx.lineTo(x(0), h);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  history.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.cost)) : ctx.moveTo(x(i), y(p.cost))));
  ctx.strokeStyle = '#e8b860';
  ctx.lineWidth = 2;
  ctx.stroke();
  drawChartLabels(ctx, w, h, max, min);
}

function drawGrid(ctx, w, h) {
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, (h / 4) * i);
    ctx.lineTo(w, (h / 4) * i);
    ctx.stroke();
  }
}

function drawChartLabels(ctx, w, h, max, min) {
  ctx.fillStyle = '#9a9fb0';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`cost ${Math.round(max)}`, 10, 18);
  ctx.fillText(`${Math.round(min)}`, 10, h - 10);
  ctx.textAlign = 'right';
  const last = history[history.length - 1];
  ctx.fillText(`T = ${last.temp.toFixed(2)}`, w - 10, 18);
}

function renderTableList(seats) {
  els.tableList.textContent = '';
  const cap = state.seatsPerTable;
  for (let t = 0; t < state.tables; t += 1) {
    const card = html('article', { class: 'tl-card' });
    const ids = seats.slice(t * cap, (t + 1) * cap).filter((g) => g >= 0);
    card.appendChild(html('h3', {}, `Table ${t + 1} · ${ids.length}/${cap}`));
    if (!ids.length) {
      card.appendChild(html('p', { class: 'empty' }, 'Empty'));
    } else {
      const ol = html('ol');
      ids.forEach((g) => {
        const li = html('li');
        const dot = html('span', { class: 'tl-dot' });
        dot.style.background = groupColor(state.guests[g].group);
        li.append(dot, document.createTextNode(state.guests[g].name));
        ol.appendChild(li);
      });
      card.appendChild(ol);
    }
    els.tableList.appendChild(card);
  }
}

/* -- Editors -- */

function renderEditors() {
  els.guestInput.value = state.guests.map((g) => `${g.name}, ${g.group}`).join('\n');
  els.guestCount.textContent = `${state.guests.length} guest${state.guests.length === 1 ? '' : 's'}`;
  els.tableCount.value = String(state.tables);
  els.seatCount.value = String(state.seatsPerTable);
  els.thoroughness.value = state.thoroughness;
  els.capacityHint.textContent = `${state.tables * state.seatsPerTable} seats for ${state.guests.length} guests.`;
  const sorted = state.guests.map((g) => g.name).sort((a, b) => a.localeCompare(b));
  [els.ruleA, els.ruleB].forEach((sel, k) => {
    const keep = sel.value;
    sel.textContent = '';
    sorted.forEach((name) => sel.appendChild(html('option', { value: name }, name)));
    sel.value = sorted.includes(keep) ? keep : sorted[Math.min(k, sorted.length - 1)] || '';
  });
  renderRuleList();
  els.solveBtn.disabled = !state.guests.length;
}

function renderRuleList() {
  els.ruleList.textContent = '';
  const pos = positionsOf(state.seats, model.n);
  if (!state.rules.length) {
    els.ruleList.appendChild(html('li', {}, 'No rules yet. Add one above.'));
    return;
  }
  model.relList.slice(0, model.ruleCount).forEach((r, i) => {
    const met = state.seats.length ? ruleMet(r.type, pos[r.a], pos[r.b], model.cap) : false;
    const li = html('li');
    li.appendChild(html('span', { class: `status${met ? ' ok' : ''}`, title: met ? 'Satisfied' : 'Broken' }));
    const text = html('span', { class: 'rule-text' });
    text.append(r.rule.a, ' ', html('span', { class: 'rule-type' }, RULE_LABEL[r.rule.type]), ' ', r.rule.b);
    const del = html('button', { type: 'button', 'aria-label': `Remove rule ${r.rule.a} ${RULE_LABEL[r.rule.type]} ${r.rule.b}`, 'data-rule': String(i) }, '×');
    li.append(text, del);
    els.ruleList.appendChild(li);
  });
}

function renderGuestCard() {
  if (selected < 0 || !state.seats.length) { els.guestCard.hidden = true; return; }
  const g = state.guests[selected];
  const pos = positionsOf(state.seats, model.n);
  const seat = pos[selected];
  const cap = state.seatsPerTable;
  els.guestCard.hidden = false;
  els.cardDot.style.background = groupColor(g.group);
  els.cardName.textContent = g.name;
  els.cardMeta.textContent = `${g.group} · Table ${Math.floor(seat / cap) + 1}, seat ${(seat % cap) + 1}`;
  els.cardRules.textContent = '';
  const mine = model.rels[selected].filter((r) => r.rule);
  if (!mine.length) els.cardRules.appendChild(html('li', { class: 'none' }, 'No rules for this guest.'));
  mine.forEach((r) => {
    const other = state.guests[r.a === selected ? r.b : r.a].name;
    const met = ruleMet(r.type, pos[r.a], pos[r.b], cap);
    const li = html('li');
    li.append(html('span', { class: `status${met ? ' ok' : ''}` }), `${met ? '✓' : '✗'} ${RULE_LABEL[r.rule.type]} ${other}`);
    els.cardRules.appendChild(li);
  });
  els.pinBtn.textContent = g.name in state.pins ? 'Unpin' : 'Pin seat';
}

function renderAll() {
  const ev = renderStats(state.seats);
  renderSeats(state.seats);
  renderSummary(ev);
  renderTableList(state.seats);
  renderRuleList();
  renderGuestCard();
  drawChart();
}

/* ---------------- Solving ---------------- */

function startSolve({ shuffle = false } = {}) {
  finishSolve();
  if (!state.guests.length) return;
  if (shuffle || !state.seats.length) commit({ ...state, seats: randomSeats(state) });
  const solver = createSolver(model, state.seats, THOROUGHNESS[state.thoroughness]);
  startStats = evaluate(model, state.seats);
  history = [{ cost: startStats.cost, temp: ANNEAL.t0 }];
  swapsTried = 0;
  solveJob = { solver, start: performance.now(), frame: 0 };
  setSolving(true);
  if (prefersReducedMotion()) { solver.run(solver.steps); finishSolve(); return; }
  solveJob.frame = requestAnimationFrame(solveFrame);
}

function solveFrame(now) {
  if (!solveJob) return;
  const { solver, start } = solveJob;
  const progress = Math.min(1, (now - start) / ANNEAL.durationMs);
  solver.run(Math.ceil(solver.steps * progress));
  swapsTried = solver.done;
  history = [...history, { cost: solver.cost, temp: solver.temperature() }];
  const seats = solver.current();
  renderSeats(seats);
  renderStats(seats);
  drawChart();
  els.planStatus.textContent = `Annealing… ${Math.round(progress * 100)}%`;
  if (solver.finished) { finishSolve(); return; }
  solveJob.frame = requestAnimationFrame(solveFrame);
}

function finishSolve() {
  if (!solveJob) return;
  const { solver, frame } = solveJob;
  cancelAnimationFrame(frame);
  solver.run(solver.steps);
  swapsTried = solver.done;
  solveJob = null;
  const seats = solver.best();
  history = [...history, { cost: evaluate(model, seats).cost, temp: ANNEAL.tEnd }];
  commit({ ...state, seats });
  setSolving(false);
  els.planStatus.textContent = `Solved with ${swapsTried.toLocaleString()} swaps`;
  renderAll();
}

function setSolving(on) {
  els.solveBtn.disabled = on || !state.guests.length;
  els.solveBtn.textContent = on ? 'Solving…' : 'Solve';
}

/* ---------------- Interaction ---------------- */

function selectGuest(g) {
  selected = g;
  renderSeats(state.seats);
  renderGuestCard();
}

function moveSelectedTo(targetSeat) {
  const pos = positionsOf(state.seats, model.n);
  const fromSeat = pos[selected];
  const target = state.seats[targetSeat];
  const pinned = (g) => g >= 0 && state.guests[g].name in state.pins;
  if (pinned(selected)) { toast(`${state.guests[selected].name} is pinned. Unpin to move.`); return; }
  if (pinned(target)) { toast(`${state.guests[target].name} is pinned.`); return; }
  const seats = state.seats.map((g, s) => {
    if (s === fromSeat) return target;
    if (s === targetSeat) return selected;
    return g;
  });
  commit({ ...state, seats });
  els.planStatus.textContent = 'Edited by hand';
  renderAll();
}

function onPlanActivate(target) {
  if (solveJob) finishSolve();
  const guestNode = target.closest('.guest');
  const slot = target.closest('.seat-slot');
  if (guestNode) {
    const g = Number(guestNode.dataset.guest);
    if (selected < 0 || selected === g) { selectGuest(selected === g ? -1 : g); return; }
    const targetSeat = state.seats.indexOf(g);
    moveSelectedTo(targetSeat);
    return;
  }
  if (slot && selected >= 0) moveSelectedTo(Number(slot.dataset.seat));
}

function togglePin() {
  if (selected < 0) return;
  const name = state.guests[selected].name;
  const { [name]: removed, ...rest } = state.pins;
  const pins = removed === undefined ? { ...state.pins, [name]: state.seats.indexOf(selected) } : rest;
  commit({ ...state, pins });
  model = buildModel(state);
  toast(removed === undefined ? `${name} pinned to this seat.` : `${name} unpinned.`);
  renderAll();
}

function parseGuestText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parsed = lines.map((line) => {
    const cut = line.indexOf(',');
    const name = (cut < 0 ? line : line.slice(0, cut)).trim().slice(0, LIMITS.maxName);
    const group = (cut < 0 ? '' : line.slice(cut + 1)).trim().slice(0, LIMITS.maxName) || 'Guests';
    return { name, group };
  }).filter((g) => g.name);
  return { guests: dedupeGuests(parsed.slice(0, LIMITS.maxGuests)), dropped: Math.max(0, parsed.length - LIMITS.maxGuests) };
}

function rebuild(next, message) {
  selected = -1;
  commit({ ...next, seats: [] });
  model = buildModel(state);
  renderEditors();
  buildPlan();
  if (message) toast(message);
  if (state.guests.length) startSolve({ shuffle: true });
  else { history = []; startStats = null; renderAll(); }
}

function applyGuests() {
  const { guests, dropped } = parseGuestText(els.guestInput.value);
  const names = new Set(guests.map((g) => g.name));
  const rules = cleanRules(state.rules, names);
  const needed = Math.ceil(guests.length / state.seatsPerTable);
  if (needed > LIMITS.maxTables) { toast('Too many guests for this table size. Increase seats per table first.'); return; }
  const tables = Math.max(state.tables, needed);
  const notes = [
    dropped ? `${dropped} extra lines ignored (max ${LIMITS.maxGuests}).` : '',
    rules.length < state.rules.length ? `${state.rules.length - rules.length} rules removed.` : '',
    tables > state.tables ? `Added ${tables - state.tables} tables to fit everyone.` : '',
  ].filter(Boolean).join(' ');
  rebuild({ ...state, guests, rules, tables, pins: {} }, notes || `${guests.length} guests loaded.`);
}

function applyTables(event) {
  event.preventDefault();
  const seatsPerTable = clampInt(els.seatCount.value, LIMITS.minSeats, LIMITS.maxSeats, state.seatsPerTable);
  const asked = clampInt(els.tableCount.value, LIMITS.minTables, LIMITS.maxTables, state.tables);
  const needed = Math.ceil(state.guests.length / seatsPerTable);
  if (needed > LIMITS.maxTables) { toast(`${state.guests.length} guests need more than ${LIMITS.maxTables} tables of ${seatsPerTable}.`); return; }
  const tables = Math.max(asked, needed);
  rebuild({ ...state, tables, seatsPerTable, pins: {} }, tables > asked ? `Using ${tables} tables so everyone has a seat.` : `${tables} tables of ${seatsPerTable}.`);
}

function addRule(event) {
  event.preventDefault();
  const rule = { a: els.ruleA.value, b: els.ruleB.value, type: els.ruleType.value };
  if (!rule.a || !rule.b) { toast('Add guests first.'); return; }
  if (rule.a === rule.b) { toast('Pick two different guests.'); return; }
  const key = [rule.a, rule.b].sort().join('\u0000');
  if (state.rules.some((r) => [r.a, r.b].sort().join('\u0000') === key)) { toast('These two already have a rule. Remove it first.'); return; }
  finishSolve();
  commit({ ...state, rules: [...state.rules, rule] });
  model = buildModel(state);
  toast('Rule added. Press Solve to re-seat.');
  renderAll();
}

function removeRule(index) {
  finishSolve();
  commit({ ...state, rules: state.rules.filter((_, i) => i !== index) });
  model = buildModel(state);
  renderAll();
}

/* -- Export -- */

function seatingRows() {
  const cap = state.seatsPerTable;
  return state.seats.map((g, s) => ({ g, s })).filter(({ g }) => g >= 0)
    .map(({ g, s }) => ({ table: Math.floor(s / cap) + 1, seat: (s % cap) + 1, ...state.guests[g] }));
}

const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;

function downloadCsv() {
  if (!state.seats.length) { toast('Nothing to export yet.'); return; }
  const lines = ['Table,Seat,Guest,Group', ...seatingRows().map((r) => [r.table, r.seat, csvCell(r.name), csvCell(r.group)].join(','))];
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const a = html('a', { href: url, download: 'seating-plan.csv' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('CSV downloaded.');
}

function listText() {
  const rows = seatingRows();
  return Array.from({ length: state.tables }, (_, t) => {
    const names = rows.filter((r) => r.table === t + 1).map((r) => r.name);
    return `Table ${t + 1}: ${names.length ? names.join(', ') : '(empty)'}`;
  }).join('\n');
}

async function copyList() {
  const text = listText();
  try {
    await navigator.clipboard.writeText(text);
    toast('Seating list copied.');
  } catch (err) {
    const area = html('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand && document.execCommand('copy');
    area.remove();
    toast(ok ? 'Seating list copied.' : 'Copy failed: your browser blocked clipboard access.');
  }
}

let resetTimer = 0;
function resetSample() {
  if (!els.resetBtn.classList.contains('confirming')) {
    els.resetBtn.classList.add('confirming');
    els.resetBtn.textContent = 'Click again to reset';
    resetTimer = setTimeout(() => { els.resetBtn.classList.remove('confirming'); els.resetBtn.textContent = 'Reset sample'; }, CONFIRM_MS);
    return;
  }
  clearTimeout(resetTimer);
  els.resetBtn.classList.remove('confirming');
  els.resetBtn.textContent = 'Reset sample';
  finishSolve();
  rebuild(sampleState(), 'Sample wedding restored.');
}

/* -- Tabs -- */

function initTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  const activate = (tab) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (step) { e.preventDefault(); activate(tabs[(i + step + tabs.length) % tabs.length]); }
    });
  });
}

function bindEvents() {
  els.plan.addEventListener('click', (e) => onPlanActivate(e.target));
  els.plan.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.guest, .seat-slot')) { e.preventDefault(); onPlanActivate(e.target); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selected >= 0) selectGuest(-1); });
  els.solveBtn.addEventListener('click', () => startSolve());
  els.shuffleBtn.addEventListener('click', () => {
    finishSolve();
    if (!state.guests.length) return;
    commit({ ...state, seats: randomSeats(state) });
    startStats = null;
    history = [];
    swapsTried = 0;
    els.planStatus.textContent = 'Shuffled. Press Solve.';
    renderAll();
  });
  els.thoroughness.addEventListener('change', () => commit({ ...state, thoroughness: THOROUGHNESS[els.thoroughness.value] ? els.thoroughness.value : 'balanced' }));
  els.applyGuests.addEventListener('click', () => { finishSolve(); applyGuests(); });
  els.guestInput.addEventListener('input', () => {
    const n = els.guestInput.value.split(/\r?\n/).filter((l) => l.trim()).length;
    els.guestCount.textContent = `${n} line${n === 1 ? '' : 's'} (press Apply)`;
  });
  els.tableForm.addEventListener('submit', (e) => { finishSolve(); applyTables(e); });
  els.ruleForm.addEventListener('submit', addRule);
  els.ruleList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-rule]');
    if (btn) removeRule(Number(btn.dataset.rule));
  });
  els.pinBtn.addEventListener('click', togglePin);
  els.deselectBtn.addEventListener('click', () => selectGuest(-1));
  els.csvBtn.addEventListener('click', downloadCsv);
  els.copyBtn.addEventListener('click', copyList);
  els.printBtn.addEventListener('click', () => window.print());
  els.resetBtn.addEventListener('click', resetSample);
  let lastCols = 0;
  const ro = new ResizeObserver(() => {
    const cols = computeGeometry().cols;
    if (cols !== lastCols) { lastCols = cols; buildPlan(); }
    drawChart();
  });
  ro.observe(els.plan);
}

function init() {
  initTabs();
  renderEditors();
  buildPlan();
  bindEvents();
  if (state.seats.length) {
    els.planStatus.textContent = 'Restored your saved plan';
    renderAll();
  } else {
    startSolve({ shuffle: true });
  }
}

init();
