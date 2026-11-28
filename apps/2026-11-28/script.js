'use strict';

/* ============================================================
   Hearthsplit: envy-free rent division
   1. Hungarian algorithm -> room assignment with maximum total bid
   2. Difference constraints + Bellman-Ford -> envy-free prices
   3. Even shift so prices sum to the rent (maximin surplus)
   ============================================================ */

const STORE_KEY = 'hearthsplit:v1';
const MIN_PEOPLE = 2;
const MAX_PEOPLE = 8;
const MAX_VALUE = 10000000;
const EPS = 0.02;
const COLORS = ['#F2994A', '#56CCF2', '#BB6BD9', '#6FCF97', '#F2C94C', '#EB5757', '#9AA5FF', '#FF8FB1'];
const PLAN_W = 600;
const PLAN_H = 380;
const PLAN_GAP = 6;
const SVG_NS = 'http://www.w3.org/2000/svg';

const SAMPLE = Object.freeze({
  rent: 3200,
  currency: '£',
  people: ['Priya', 'Tom', 'Ade', 'Mei'],
  rooms: [
    {name: 'Loft', area: 24},
    {name: 'Garden', area: 16},
    {name: 'Ensuite', area: 14},
    {name: 'Box room', area: 8}
  ],
  bids: [
    [1300, 800, 800, 300],
    [1150, 950, 800, 300],
    [1100, 700, 1000, 400],
    [1100, 850, 800, 450]
  ]
});

/* ---------------- small helpers ---------------- */

const clone = (o) => JSON.parse(JSON.stringify(o));
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const clampValue = (n) => Math.min(MAX_VALUE, Math.max(0, n));
const $ = (id) => document.getElementById(id);

function parseAmount(raw) {
  const text = String(raw).trim();
  if (text === '') return {value: 0, valid: false};
  const n = Number(text);
  if (!Number.isFinite(n)) return {value: 0, valid: false};
  return {value: clampValue(n), valid: n >= 0 && n <= MAX_VALUE};
}

function fmtNumber(n) {
  const r = Math.round(n * 100) / 100;
  const whole = Math.abs(r - Math.round(r)) < 0.005;
  return Math.abs(r).toLocaleString('en-GB', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2
  });
}

function money(n, cur) {
  const r = Math.round(n * 100) / 100;
  return (r < 0 ? '−' : '') + cur + fmtNumber(r);
}

function signed(n, cur) {
  const r = Math.round(n * 100) / 100;
  if (Math.abs(r) < 0.005) return cur + '0';
  return (r > 0 ? '+' : '−') + cur + fmtNumber(r);
}

/** Round values to cents so they add up exactly to total (largest remainder). */
function roundToTotal(values, total) {
  const cents = values.map((v) => v * 100);
  const floors = cents.map(Math.floor);
  let left = Math.round(total * 100) - sum(floors);
  const order = cents.map((c, i) => ({i, r: c - Math.floor(c)})).sort((a, b) => b.r - a.r || a.i - b.i);
  const out = floors.slice();
  for (let k = 0; left > 0 && k < order.length * 2; k += 1) {
    out[order[k % order.length].i] += 1;
    left -= 1;
  }
  return out.map((c) => c / 100);
}

function evenSplit(total, n) {
  return roundToTotal(Array(n).fill(total / n), total);
}

function fitRow(row, rent) {
  const s = sum(row);
  if (s <= 0) return evenSplit(rent, row.length).map(Math.round);
  const scaled = row.map((v) => (v * rent) / s);
  const rounded = scaled.map(Math.floor);
  const rest = Math.round(rent) - sum(rounded);
  const top = scaled.indexOf(Math.max(...scaled));
  return rounded.map((v, i) => (i === top ? v + rest : v));
}

const rowIsFit = (row, rent) => Math.abs(sum(row) - rent) < 0.5;

/* ---------------- algorithms ---------------- */

/** Hungarian algorithm with potentials (min cost). Returns colOf[row]. */
function hungarian(cost) {
  const n = cost.length;
  const u = Array(n + 1).fill(0);
  const v = Array(n + 1).fill(0);
  const p = Array(n + 1).fill(0);
  const way = Array(n + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(n + 1).fill(Infinity);
    const used = Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else { minv[j] -= delta; }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const colOf = Array(n).fill(0);
  for (let j = 1; j <= n; j += 1) colOf[p[j] - 1] = j - 1;
  return colOf;
}

/**
 * Envy-free prices for a fixed assignment.
 * d_i <= d_j + (b_i(own_i) - b_i(own_j))  and  d_i <= b_i(own_i).
 * Bellman-Ford gives the largest feasible d; shift evenly to sum to rent.
 * Returns price per person (for that person's room).
 */
function envyFreePrices(bids, roomOf, rent) {
  const n = bids.length;
  const own = (i) => bids[i][roomOf[i]];
  const d = bids.map((_, i) => own(i));
  for (let iter = 0; iter <= n; iter += 1) {
    let changed = false;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue;
        const w = own(i) - bids[i][roomOf[j]];
        if (d[j] + w < d[i] - 1e-9) { d[i] = d[j] + w; changed = true; }
      }
    }
    if (!changed) {
      const shift = (sum(d) - rent) / n;
      return d.map((x) => x - shift);
    }
  }
  throw new Error('No envy-free prices exist for this assignment (negative cycle).');
}

/** cell[i][j]: how much better off person i is with own deal than with room j at its price. */
function envyMatrix(bids, roomOf, priceOfRoom) {
  return bids.map((row, i) => {
    const mine = row[roomOf[i]] - priceOfRoom[roomOf[i]];
    return row.map((b, j) => mine - (b - priceOfRoom[j]));
  });
}

const enviousSet = (matrix) => matrix.map((row) => row.some((c) => c < -EPS));

function solve(s) {
  const n = s.people.length;
  if (!(s.rent > 0)) return {error: 'rent'};
  const roomOf = hungarian(s.bids.map((row) => row.map((b) => -b)));
  const perPerson = envyFreePrices(s.bids, roomOf, s.rent);
  const rounded = roundToTotal(perPerson, s.rent);
  const priceOfRoom = Array(n).fill(0);
  roomOf.forEach((r, i) => { priceOfRoom[r] = rounded[i]; });
  const matrix = envyMatrix(s.bids, roomOf, priceOfRoom);
  const totalArea = sum(s.rooms.map((r) => r.area));
  const areaPrices = totalArea > 0
    ? roundToTotal(s.rooms.map((r) => (s.rent * r.area) / totalArea), s.rent)
    : evenSplit(s.rent, n);
  const equalPrices = evenSplit(s.rent, n);
  const surplus = s.bids.map((row, i) => row[roomOf[i]] - priceOfRoom[roomOf[i]]);
  return {
    roomOf,
    priceOfRoom,
    matrix,
    envious: enviousSet(matrix),
    surplus,
    welfare: sum(s.bids.map((row, i) => row[roomOf[i]])),
    compare: {
      equal: {prices: equalPrices, envious: enviousSet(envyMatrix(s.bids, roomOf, equalPrices))},
      area: {prices: areaPrices, envious: enviousSet(envyMatrix(s.bids, roomOf, areaPrices))}
    }
  };
}

/* ---------------- state ---------------- */

function fromSample() {
  return {
    rent: SAMPLE.rent,
    currency: SAMPLE.currency,
    people: SAMPLE.people.map((name, i) => ({id: 'p' + i, name})),
    rooms: SAMPLE.rooms.map((r, i) => ({id: 'r' + i, name: r.name, area: r.area})),
    bids: clone(SAMPLE.bids),
    nextId: SAMPLE.people.length
  };
}

function isValidState(s) {
  if (!s || typeof s !== 'object') return false;
  const n = Array.isArray(s.people) ? s.people.length : 0;
  return n >= MIN_PEOPLE && n <= MAX_PEOPLE &&
    Array.isArray(s.rooms) && s.rooms.length === n &&
    Array.isArray(s.bids) && s.bids.length === n &&
    s.bids.every((row) => Array.isArray(row) && row.length === n && row.every(Number.isFinite)) &&
    Number.isFinite(s.rent) && typeof s.currency === 'string';
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return isValidState(parsed) ? parsed : fromSample();
  } catch (err) {
    console.warn('Hearthsplit: could not read saved household', err);
    return fromSample();
  }
}

function saveState(s) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch (err) {
    console.warn('Hearthsplit: could not save household', err);
  }
}

let state = loadState();
const invalidCells = new Set();

function setState(next, {structure = false} = {}) {
  state = next;
  saveState(state);
  if (structure) renderSetup();
  else refreshLabels();
  refreshSums();
  renderResults();
}

/* ---------------- DOM helpers ---------------- */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v === true ? '' : v);
  });
  children.forEach((c) => node.append(c));
  return node;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

const colorOf = (i) => COLORS[i % COLORS.length];
const dot = (i) => el('span', {class: 'dot', style: 'background:' + colorOf(i), 'aria-hidden': 'true'});
const who = (i) => el('span', {class: 'who'}, [dot(i), el('span', {'data-person': i, text: state.people[i].name || 'Person ' + (i + 1)})]);
const personName = (i) => state.people[i].name.trim() || 'Person ' + (i + 1);
const roomName = (j) => state.rooms[j].name.trim() || 'Room ' + (j + 1);

/* ---------------- setup panel ---------------- */

function renderHouse() {
  const list = $('houseList');
  const n = state.people.length;
  list.replaceChildren(...state.people.map((p, i) => el('div', {class: 'house-row'}, [
    el('div', {class: 'name-wrap'}, [dot(i), el('input', {
      type: 'text', value: p.name, maxlength: 24, 'data-kind': 'person', 'data-i': i,
      'aria-label': 'Housemate ' + (i + 1) + ' name', autocomplete: 'off'
    })]),
    el('input', {
      type: 'text', value: state.rooms[i].name, maxlength: 24, 'data-kind': 'room', 'data-i': i,
      'aria-label': 'Room ' + (i + 1) + ' name', autocomplete: 'off'
    }),
    el('input', {
      type: 'number', class: 'area', min: 0, step: 1, inputmode: 'decimal', value: state.rooms[i].area,
      'data-kind': 'area', 'data-i': i, 'aria-label': 'Room ' + (i + 1) + ' area in square metres'
    }),
    el('button', {
      type: 'button', class: 'icon-btn', 'data-remove': i, text: '×', disabled: n <= MIN_PEOPLE,
      'aria-label': 'Remove ' + personName(i) + ' and ' + roomName(i)
    })
  ])));
  $('addBtn').disabled = n >= MAX_PEOPLE;
}

function renderBids() {
  const n = state.people.length;
  const head = el('tr', {}, [
    el('th', {scope: 'col', text: 'Person'}),
    ...state.rooms.map((_, j) => el('th', {scope: 'col', class: 'room-head', 'data-room': j, text: roomName(j)})),
    el('th', {scope: 'col', text: 'Σ'}),
    el('th', {scope: 'col'}, [el('span', {class: 'visually-hidden', text: 'Fit'})])
  ]);
  const rows = state.bids.map((row, i) => el('tr', {}, [
    el('th', {scope: 'row'}, [who(i)]),
    ...row.map((b, j) => el('td', {}, [el('input', {
      type: 'number', min: 0, step: 10, inputmode: 'numeric', value: b,
      class: invalidCells.has(i + ':' + j) ? 'invalid' : '',
      'data-kind': 'bid', 'data-i': i, 'data-j': j,
      'aria-label': personName(i) + ' bid for ' + roomName(j)
    })])),
    el('td', {}, [el('span', {class: 'sum-chip', 'data-sum': i})]),
    el('td', {}, [el('button', {
      type: 'button', class: 'btn btn-soft fit-btn', 'data-fit': i, text: 'Fit',
      'aria-label': 'Scale ' + personName(i) + ' bids to add up to the rent'
    })])
  ]));
  $('bidsTable').replaceChildren(el('thead', {}, [head]), el('tbody', {}, rows));
  return n;
}

function renderSetup() {
  $('rent').value = state.rent;
  $('currency').value = state.currency;
  renderHouse();
  renderBids();
}

function refreshLabels() {
  document.querySelectorAll('[data-person]').forEach((node) => {
    node.textContent = personName(Number(node.dataset.person));
  });
  document.querySelectorAll('#bidsTable [data-room]').forEach((node) => {
    node.textContent = roomName(Number(node.dataset.room));
  });
}

function refreshSums() {
  state.bids.forEach((row, i) => {
    const chip = document.querySelector('[data-sum="' + i + '"]');
    const fit = document.querySelector('[data-fit="' + i + '"]');
    if (!chip || !fit) return;
    const ok = rowIsFit(row, state.rent);
    chip.textContent = (ok ? '✓ ' : '') + money(sum(row), state.currency);
    chip.classList.toggle('off', !ok);
    fit.hidden = ok;
  });
  $('fitAllBtn').disabled = state.bids.every((row) => rowIsFit(row, state.rent));
}

/* ---------------- floor plan ---------------- */

/** Recursive area-balanced binary split of a rectangle. */
function tile(items, x, y, w, h) {
  if (items.length === 1) return [{...items[0], x, y, w, h}];
  const total = sum(items.map((it) => it.weight));
  let best = 1;
  let bestDiff = Infinity;
  let acc = 0;
  for (let k = 1; k < items.length; k += 1) {
    acc += items[k - 1].weight;
    const diff = Math.abs(acc - total / 2);
    if (diff < bestDiff) { bestDiff = diff; best = k; }
  }
  const a = items.slice(0, best);
  const b = items.slice(best);
  const frac = sum(a.map((it) => it.weight)) / total;
  if (w >= h) {
    const wa = w * frac;
    return [...tile(a, x, y, wa, h), ...tile(b, x + wa, y, w - wa, h)];
  }
  const ha = h * frac;
  return [...tile(a, x, y, w, ha), ...tile(b, x, y + ha, w, h - ha)];
}

const planNodes = new Map();

function roomNode(id) {
  if (planNodes.has(id)) return planNodes.get(id);
  const g = svg('g');
  const node = {
    g,
    rect: svg('rect', {class: 'room-rect', rx: 6}),
    door: svg('path', {class: 'room-door'}),
    label: svg('text', {class: 'room-label', 'text-anchor': 'middle'}),
    person: svg('text', {class: 'room-person', 'text-anchor': 'middle'}),
    price: svg('text', {class: 'room-price', 'text-anchor': 'middle'})
  };
  g.append(node.rect, node.door, node.label, node.person, node.price);
  planNodes.set(id, node);
  return node;
}

function placeRoom(node, cell, owner, price) {
  const x = cell.x + PLAN_GAP / 2;
  const y = cell.y + PLAN_GAP / 2;
  const w = Math.max(4, cell.w - PLAN_GAP);
  const h = Math.max(4, cell.h - PLAN_GAP);
  const color = owner === null ? '#3A3029' : colorOf(owner);
  Object.entries({x, y, width: w, height: h, fill: color + '38', stroke: color, 'stroke-width': 2})
    .forEach(([k, v]) => node.rect.setAttribute(k, v));
  const r = Math.min(22, w / 4, h / 4);
  node.door.setAttribute('d', `M${x + 8} ${y + h - 2} a${r} ${r} 0 0 1 ${r} ${-r}`);
  const fs = Math.max(10, Math.min(30, Math.min(w / 5.4, h / 4)));
  const cx = x + w / 2;
  const cy = y + h / 2;
  const compact = h < fs * 3.6;
  setText(node.label, roomName(cell.j).toUpperCase(), cx, compact ? cy - fs * 0.15 : cy - fs * 1.05, fs * 0.5);
  setText(node.person, owner === null ? '' : personName(owner), cx, compact ? -999 : cy + fs * 0.05, fs * 0.72);
  setText(node.price, price, cx, compact ? cy + fs * 0.85 : cy + fs * 1.15, fs);
}

function setText(node, text, x, y, size) {
  node.textContent = text;
  node.setAttribute('x', x);
  node.setAttribute('y', y);
  node.setAttribute('font-size', size.toFixed(1));
}

function renderPlan(sol) {
  const plan = $('plan');
  const ownerOfRoom = Array(state.rooms.length).fill(null);
  if (sol) sol.roomOf.forEach((r, i) => { ownerOfRoom[r] = i; });
  const items = state.rooms
    .map((room, j) => ({j, id: room.id, weight: Math.max(1, room.area)}))
    .sort((a, b) => b.weight - a.weight || a.j - b.j);
  const cells = tile(items, 4, 4, PLAN_W - 8, PLAN_H - 8);
  const live = new Set(cells.map((c) => c.id));
  [...planNodes.keys()].filter((id) => !live.has(id)).forEach((id) => {
    planNodes.get(id).g.remove();
    planNodes.delete(id);
  });
  cells.forEach((cell) => {
    const node = roomNode(cell.id);
    if (!node.g.isConnected) plan.append(node.g);
    const price = sol ? money(sol.priceOfRoom[cell.j], state.currency) : '—';
    placeRoom(node, cell, ownerOfRoom[cell.j], price);
  });
}

/* ---------------- result cards ---------------- */

let lastEnvyCount = null;

function renderBadge(sol) {
  const badge = $('envyBadge');
  const count = sol ? sol.envious.filter(Boolean).length : null;
  badge.classList.toggle('is-idle', count === null);
  badge.classList.toggle('is-bad', count !== null && count > 0);
  badge.textContent = count === null ? 'Waiting for rent'
    : count === 0 ? '0 people envious' : count + (count === 1 ? ' person' : ' people') + ' envious';
  if (lastEnvyCount !== null && count !== lastEnvyCount) {
    badge.classList.remove('pulse');
    void badge.offsetWidth;
    badge.classList.add('pulse');
  }
  lastEnvyCount = count;
}

function priceCell(price, isEnvious, best) {
  const td = el('td', {class: best ? 'win' : ''}, [document.createTextNode(money(price, state.currency))]);
  if (isEnvious) td.append(el('span', {class: 'envy-flag', title: 'Would rather swap', text: '⚠'}));
  return td;
}

function countCell(flags) {
  const c = flags.filter(Boolean).length;
  return el('td', {class: c ? 'count-bad' : 'count-ok', text: c + ' envious'});
}

function renderCompare(sol) {
  const table = $('compareTable');
  if (!sol) { table.replaceChildren(); return; }
  const {equal, area} = sol.compare;
  const head = el('tr', {}, ['Person', 'Room', 'Equal', 'By area', 'Hearthsplit'].map((t, k) =>
    el('th', {scope: 'col', class: k === 4 ? 'hs' : '', text: t})));
  const rows = state.people.map((_, i) => {
    const r = sol.roomOf[i];
    return el('tr', {}, [
      el('td', {}, [who(i)]),
      el('td', {text: roomName(r)}),
      priceCell(equal.prices[r], equal.envious[i], false),
      priceCell(area.prices[r], area.envious[i], false),
      priceCell(sol.priceOfRoom[r], sol.envious[i], true)
    ]);
  });
  const foot = el('tr', {}, [el('td', {text: 'Would swap'}), el('td'),
    countCell(equal.envious), countCell(area.envious), countCell(sol.envious)]);
  table.replaceChildren(el('thead', {}, [head]), el('tbody', {}, rows), el('tfoot', {}, [foot]));
}

function envyCell(sol, i, j) {
  const v = sol.matrix[i][j];
  const own = sol.roomOf[i] === j;
  const cls = own ? 'own' : v < -EPS ? 'neg' : v < 0.5 ? 'zero' : 'pos';
  const text = own ? 'own' : signed(v, state.currency);
  return el('td', {class: 'cell ' + cls, tabindex: 0, 'data-i': i, 'data-j': j, text,
    'aria-label': envyNote(sol, i, j)});
}

function envyNote(sol, i, j) {
  const cur = state.currency;
  const mine = sol.roomOf[i];
  const p = sol.priceOfRoom;
  const bid = state.bids[i];
  if (mine === j) {
    return `${personName(i)} values ${roomName(j)} at ${money(bid[j], cur)} and pays ${money(p[j], cur)}: ` +
      `${signed(bid[j] - p[j], cur)} of surplus.`;
  }
  const v = sol.matrix[i][j];
  const verdict = v < -EPS ? 'would rather swap' : v < 0.5 ? 'is exactly indifferent' : 'prefers their own deal';
  return `${personName(i)} values ${roomName(j)} at ${money(bid[j], cur)}; at ${money(p[j], cur)} that deal ` +
    `leaves ${signed(bid[j] - p[j], cur)}, versus ${signed(bid[mine] - p[mine], cur)} in ${roomName(mine)}. ` +
    `So ${personName(i)} ${verdict} (${signed(v, cur)}).`;
}

function renderEnvy(sol) {
  const table = $('envyTable');
  if (!sol) { table.replaceChildren(); return; }
  const head = el('tr', {}, [el('th', {scope: 'col', text: 'Person ↓ / room →'}),
    ...state.rooms.map((_, j) => el('th', {scope: 'col'}, [
      document.createTextNode(roomName(j)), el('br'),
      el('span', {class: 'hint', text: money(sol.priceOfRoom[j], state.currency)})
    ]))]);
  const rows = state.people.map((_, i) => el('tr', {}, [
    el('th', {scope: 'row'}, [who(i)]),
    ...state.rooms.map((__, j) => envyCell(sol, i, j))
  ]));
  table.replaceChildren(el('thead', {}, [head]), el('tbody', {}, rows));
}

function renderReceipts(sol) {
  const box = $('receipts');
  if (!sol) { box.replaceChildren(); return; }
  const cur = state.currency;
  box.replaceChildren(...state.people.map((_, i) => {
    const r = sol.roomOf[i];
    const price = sol.priceOfRoom[r];
    const pays = price >= 0
      ? el('p', {class: 'pays'}, [document.createTextNode(money(price, cur)), el('small', {text: ' / month'})])
      : el('p', {class: 'pays'}, [el('small', {text: 'receives '}), document.createTextNode(money(-price, cur))]);
    return el('div', {class: 'receipt', style: '--c:' + colorOf(i)}, [
      el('h3', {text: personName(i)}),
      el('p', {class: 'room', text: roomName(r) + ' · ' + fmtNumber(state.rooms[r].area) + ' m²'}),
      pays,
      el('p', {class: 'detail'}, [
        document.createTextNode('Valued it at ' + money(state.bids[i][r], cur) + ', so '),
        el('b', {text: signed(sol.surplus[i], cur)}),
        document.createTextNode((sol.surplus[i] < 0 ? ' versus their bid' : ' ahead') + (sol.envious[i] ? '.' : '. Envies nobody.'))
      ])
    ]);
  }));
}

function renderBanner(sol) {
  const banner = $('banner');
  const off = state.bids.filter((row) => !rowIsFit(row, state.rent)).length;
  let text = '';
  let bad = false;
  if (!sol) { text = 'Enter the total rent to solve the split.'; bad = true; }
  else if (off) {
    text = `${off} bid row${off === 1 ? ' does' : 's do'} not add up to the rent. ` +
      'The split still works, but press Fit so everyone is comparing like with like.';
  } else if (sol.priceOfRoom.some((p) => p < 0)) {
    text = 'These bids are extreme enough that one room has a negative price: that person receives money from the others.';
  }
  banner.hidden = !text;
  banner.textContent = text;
  banner.classList.toggle('is-bad', bad);
}

function renderFoot(sol) {
  const foot = $('planFoot');
  if (!sol) { foot.textContent = ''; return; }
  const cur = state.currency;
  const minS = Math.min(...sol.surplus);
  foot.replaceChildren(
    document.createTextNode('Winning bids total '), el('strong', {text: money(sol.welfare, cur)}),
    document.createTextNode(' against a rent of '), el('strong', {text: money(state.rent, cur)}),
    document.createTextNode('. Prices add up exactly, and everyone ends at least '),
    el('strong', {text: money(minS, cur)}), document.createTextNode(' better off than their own valuation.')
  );
}

function renderResults() {
  let sol = null;
  try {
    const res = solve(state);
    sol = res.error ? null : res;
  } catch (err) {
    console.error(err);
    $('banner').hidden = false;
    $('banner').textContent = 'Could not compute prices: ' + err.message;
    return;
  }
  renderPlan(sol);
  renderBadge(sol);
  renderCompare(sol);
  renderEnvy(sol);
  renderReceipts(sol);
  renderBanner(sol);
  renderFoot(sol);
  lastSolution = sol;
}

let lastSolution = null;

/* ---------------- actions ---------------- */

function withRow(bids, i, row) {
  return bids.map((r, k) => (k === i ? row : r));
}

function updateBid(i, j, raw, input) {
  const {value, valid} = parseAmount(raw);
  const key = i + ':' + j;
  if (valid) invalidCells.delete(key); else invalidCells.add(key);
  input.classList.toggle('invalid', !valid);
  const row = state.bids[i].map((b, k) => (k === j ? value : b));
  setState({...state, bids: withRow(state.bids, i, row)});
}

function updateHouse(kind, i, raw, input) {
  if (kind === 'person') {
    setState({...state, people: state.people.map((p, k) => (k === i ? {...p, name: raw} : p))});
    return;
  }
  if (kind === 'room') {
    setState({...state, rooms: state.rooms.map((r, k) => (k === i ? {...r, name: raw} : r))});
    return;
  }
  const {value, valid} = parseAmount(raw);
  input.classList.toggle('invalid', !valid);
  setState({...state, rooms: state.rooms.map((r, k) => (k === i ? {...r, area: value} : r))});
}

function writeBidInputs(i) {
  state.bids[i].forEach((b, j) => {
    const input = document.querySelector(`#bidsTable input[data-i="${i}"][data-j="${j}"]`);
    if (input) { input.value = b; input.classList.remove('invalid'); }
    invalidCells.delete(i + ':' + j);
  });
}

function fitOne(i) {
  setState({...state, bids: withRow(state.bids, i, fitRow(state.bids[i], state.rent))});
  writeBidInputs(i);
}

function fitAll() {
  setState({...state, bids: state.bids.map((row) => fitRow(row, state.rent))});
  state.bids.forEach((_, i) => writeBidInputs(i));
  toast('Every row now adds up to ' + money(state.rent, state.currency));
}

function addPerson() {
  const n = state.people.length;
  if (n >= MAX_PEOPLE) return;
  const id = state.nextId;
  const share = Math.round(state.rent / (n + 1));
  const newRow = evenSplit(state.rent, n + 1).map(Math.round);
  newRow[0] += Math.round(state.rent) - sum(newRow);
  setState({
    ...state,
    people: [...state.people, {id: 'p' + id, name: 'Housemate ' + (n + 1)}],
    rooms: [...state.rooms, {id: 'r' + id, name: 'Room ' + (n + 1), area: 10}],
    bids: [...state.bids.map((row) => [...row, share]), newRow],
    nextId: id + 1
  }, {structure: true});
  invalidCells.clear();
  const input = document.querySelector(`#houseList input[data-kind="person"][data-i="${n}"]`);
  if (input) { input.focus(); input.select(); }
  toast('Added a housemate and a room. Press Fit on rows that no longer add up.');
}

function removePerson(i) {
  if (state.people.length <= MIN_PEOPLE) return;
  const keep = (_, k) => k !== i;
  invalidCells.clear();
  setState({
    ...state,
    people: state.people.filter(keep),
    rooms: state.rooms.filter(keep),
    bids: state.bids.filter(keep).map((row) => row.filter(keep))
  }, {structure: true});
}

function agreementText(sol) {
  const cur = state.currency;
  const lines = state.people.map((_, i) => {
    const r = sol.roomOf[i];
    const p = sol.priceOfRoom[r];
    return `• ${personName(i)}: ${roomName(r)}, ${p >= 0 ? 'pays ' + money(p, cur) : 'receives ' + money(-p, cur)}`;
  });
  return [
    `Rent split for ${money(state.rent, cur)} a month (worked out with Hearthsplit)`,
    ...lines,
    '',
    `Nobody would rather swap: each person's room at its price is worth at least as much to them as any other.`,
    `Everyone is at least ${money(Math.min(...sol.surplus), cur)} better off than their own valuation.`
  ].join('\n');
}

async function copyAgreement() {
  if (!lastSolution) { toast('Enter the rent first'); return; }
  const text = agreementText(lastSolution);
  try {
    await navigator.clipboard.writeText(text);
    toast('Agreement copied. Paste it in the group chat.');
  } catch (err) {
    const area = el('textarea', {style: 'position:fixed;opacity:0;top:0;left:0'});
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand && document.execCommand('copy');
    area.remove();
    toast(ok ? 'Agreement copied. Paste it in the group chat.' : 'Copy blocked by the browser.');
  }
}

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------------- wiring ---------------- */

function onInput(e) {
  const t = e.target;
  const kind = t.dataset && t.dataset.kind;
  if (!kind) return;
  const i = Number(t.dataset.i);
  if (kind === 'bid') updateBid(i, Number(t.dataset.j), t.value, t);
  else updateHouse(kind, i, t.value, t);
}

function bind() {
  $('houseList').addEventListener('input', onInput);
  $('bidsTable').addEventListener('input', onInput);
  $('houseList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (btn) removePerson(Number(btn.dataset.remove));
  });
  $('bidsTable').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fit]');
    if (btn) fitOne(Number(btn.dataset.fit));
  });
  $('rent').addEventListener('input', (e) => {
    const {value, valid} = parseAmount(e.target.value);
    e.target.classList.toggle('invalid', !valid);
    setState({...state, rent: value});
  });
  $('currency').addEventListener('input', (e) => setState({...state, currency: e.target.value.trim().slice(0, 3)}));
  $('addBtn').addEventListener('click', addPerson);
  $('fitAllBtn').addEventListener('click', fitAll);
  $('copyBtn').addEventListener('click', copyAgreement);
  $('resetBtn').addEventListener('click', () => {
    if (!window.confirm('Replace your household with the sample flat?')) return;
    invalidCells.clear();
    setState(fromSample(), {structure: true});
    toast('Sample flat restored');
  });
  const note = (e) => {
    const cell = e.target.closest && e.target.closest('#envyTable td.cell');
    if (cell) $('cellNote').textContent = cell.getAttribute('aria-label');
  };
  $('envyTable').addEventListener('mouseover', note);
  $('envyTable').addEventListener('focusin', note);
}

renderSetup();
refreshSums();
renderResults();
bind();
