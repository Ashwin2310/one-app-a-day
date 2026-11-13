'use strict';

/* ================= constants ================= */
const STORAGE_KEY = 'pursepace.v1';
const MAX_AMOUNT = 1000000;
const MAX_NOTE = 60;
const MAX_CYCLE_DAYS = 366;
const MAX_BILLS = 50;
const MAX_EXPENSES = 5000;
const TOAST_MS = 6000;
const CURRENCIES = ['$', '€', '£', '₹', '¥'];
const CATS = [
  { id: 'Food', color: '#d9773c', words: ['lunch', 'dinner', 'breakfast', 'coffee', 'cafe', 'pizza', 'burger', 'restaurant', 'takeaway', 'takeout', 'snack', 'meal', 'brunch', 'tea', 'bar', 'drinks'] },
  { id: 'Groceries', color: '#1f7a54', words: ['grocer', 'supermarket', 'market', 'shop run', 'weekly shop', 'veg', 'milk', 'bread'] },
  { id: 'Transport', color: '#3b6ea8', words: ['bus', 'train', 'taxi', 'cab', 'fuel', 'petrol', 'gas', 'parking', 'metro', 'subway', 'fare', 'ride', 'tram'] },
  { id: 'Fun', color: '#a8508f', words: ['cinema', 'movie', 'concert', 'game', 'ticket', 'museum', 'show', 'party', 'book', 'gig'] },
  { id: 'Shopping', color: '#c9851a', words: ['shoes', 'clothes', 'shirt', 'jacket', 'gift', 'headphones', 'phone case', 'amazon', 'order'] },
  { id: 'Health', color: '#2f9a9a', words: ['pharmacy', 'doctor', 'gym', 'medicine', 'dentist', 'vitamin', 'haircut'] },
  { id: 'Home', color: '#7a6a4f', words: ['cleaning', 'laundry', 'repair', 'furniture', 'plant', 'bulb', 'hardware'] },
  { id: 'Other', color: '#8a8f8c', words: [] }
];
const CAT_IDS = CATS.map((c) => c.id);
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ================= date helpers ================= */
const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parts = (iso) => iso.split('-').map(Number);
const dayNumber = (iso) => { const [y, m, d] = parts(iso); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const diffDays = (a, b) => dayNumber(b) - dayNumber(a);
const addDays = (iso, n) => { const [y, m, d] = parts(iso); return toISO(new Date(y, m - 1, d + n)); };
const isValidISO = (s) => typeof s === 'string' && ISO_RE.test(s) && addDays(s, 0) === s;
const todayISO = () => toISO(new Date());
const fmtDate = (iso) => { const [y, m, d] = parts(iso); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
const fmtWeekday = (iso) => { const [y, m, d] = parts(iso); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };

/* ================= small utilities ================= */
const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const $ = (id) => document.getElementById(id);

function el(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const kid of [].concat(kids)) if (kid != null) node.append(kid);
  return node;
}

function svg(tag, attrs = {}, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  return node;
}

function money(n, currency, decimals = 2) {
  const abs = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${n < -0.004 ? '-' : ''}${currency}${abs}`;
}

/* ================= state: sample, validation, storage ================= */
function sampleState(today) {
  const start = addDays(today, -12);
  const rows = [
    [12, 38.2, 'weekly shop', 'Groceries'], [12, 6.5, 'coffee and pastry', 'Food'],
    [11, 14, 'lunch', 'Food'], [11, 2.9, 'bus', 'Transport'],
    [10, 52, 'dinner with friends', 'Food'],
    [8, 23.4, 'groceries', 'Groceries'], [8, 12, 'cinema', 'Fun'],
    [7, 64.99, 'running shoes', 'Shopping'], [7, 9.5, 'lunch', 'Food'],
    [6, 18, 'pharmacy', 'Health'],
    [5, 41.3, 'groceries', 'Groceries'], [5, 5, 'coffee', 'Food'],
    [4, 27, 'taxi home', 'Transport'], [4, 16, 'lunch', 'Food'],
    [3, 12.5, 'lunch', 'Food'],
    [2, 35, 'concert ticket', 'Fun'], [2, 8.2, 'snacks', 'Food'],
    [1, 21.6, 'groceries', 'Groceries'], [1, 4.5, 'coffee', 'Food'],
    [0, 4.5, 'coffee', 'Food']
  ];
  return {
    v: 1,
    currency: '$',
    cycle: { start, payday: addDays(start, 30), income: 3400, savings: 400 },
    bills: [
      ['Rent', 1250], ['Utilities', 140], ['Phone', 45], ['Internet', 60], ['Transit pass', 95], ['Streaming', 22]
    ].map(([name, amount], i) => ({ id: `b${i}`, name, amount })),
    expenses: rows.map(([ago, amount, note, cat], i) => ({ id: `s${i}`, date: addDays(today, -ago), amount, note, cat }))
  };
}

const validAmount = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= MAX_AMOUNT * 100;

/** Returns a clean copy of raw state, or null when it is not usable. */
function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object' || !raw.cycle || typeof raw.cycle !== 'object') return null;
  const { start, payday, income, savings } = raw.cycle;
  if (!isValidISO(start) || !isValidISO(payday)) return null;
  const length = diffDays(start, payday);
  if (length < 1 || length > MAX_CYCLE_DAYS) return null;
  if (!validAmount(income) || !validAmount(savings)) return null;
  if (!Array.isArray(raw.bills) || !Array.isArray(raw.expenses)) return null;
  const bills = raw.bills.slice(0, MAX_BILLS)
    .filter((b) => b && typeof b.name === 'string' && validAmount(b.amount))
    .map((b) => ({ id: String(b.id || newId()), name: b.name.trim().slice(0, 40) || 'Bill', amount: round2(b.amount) }));
  const expenses = raw.expenses.slice(0, MAX_EXPENSES)
    .filter((e) => e && isValidISO(e.date) && validAmount(e.amount) && e.amount > 0 && e.amount <= MAX_AMOUNT)
    .map((e) => ({
      id: String(e.id || newId()),
      date: e.date,
      amount: round2(e.amount),
      note: String(e.note == null ? '' : e.note).trim().slice(0, MAX_NOTE),
      cat: CAT_IDS.includes(e.cat) ? e.cat : 'Other'
    }));
  return {
    v: 1,
    currency: CURRENCIES.includes(raw.currency) ? raw.currency : '$',
    cycle: { start, payday, income: round2(income), savings: round2(savings) },
    bills,
    expenses
  };
}

function loadState() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text) {
      const clean = sanitizeState(JSON.parse(text));
      if (clean) return clean;
    }
  } catch (err) {
    console.warn('Pursepace: could not read saved data, loading sample.', err);
  }
  return sampleState(todayISO());
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn('Pursepace: could not save.', err);
    return false;
  }
}

/* ================= pure state updates ================= */
const addExpense = (state, expense) => ({ ...state, expenses: [...state.expenses, expense] });
const removeExpense = (state, id) => ({ ...state, expenses: state.expenses.filter((e) => e.id !== id) });
const applyPlan = (state, plan) => ({ ...state, currency: plan.currency, cycle: plan.cycle, bills: plan.bills });
function newCycle(state, today) {
  const length = diffDays(state.cycle.start, state.cycle.payday);
  return { ...state, cycle: { ...state.cycle, start: today, payday: addDays(today, length) }, expenses: [] };
}

/* ================= derived numbers ================= */
const billsTotal = (bills) => bills.reduce((sum, b) => sum + b.amount, 0);
const flexibleOf = (cycle, bills) => round2(cycle.income - billsTotal(bills) - cycle.savings);

function dayStatus(spent, allowance) {
  if (spent === 0) return 'zero';
  if (spent <= allowance + 0.005) return 'under';
  return spent <= allowance * 1.25 ? 'near' : 'over';
}

function compute(state, today) {
  const { start, payday } = state.cycle;
  const n = diffDays(start, payday);
  const tIdx = clamp(diffDays(start, today), 0, n - 1);
  const flexible = flexibleOf(state.cycle, state.bills);
  const perDay = new Array(n).fill(0);
  const inCycle = state.expenses.filter((e) => {
    const i = diffDays(start, e.date);
    return i >= 0 && i <= tIdx;
  });
  inCycle.forEach((e) => { perDay[diffDays(start, e.date)] += e.amount; });

  const totalSpent = round2(perDay.reduce((a, b) => a + b, 0));
  const remaining = round2(flexible - totalSpent);
  const daysLeft = n - tIdx;
  const futureAllowance = daysLeft > 1 ? remaining / (daysLeft - 1) : 0;

  let cum = 0;
  const days = perDay.map((spent, i) => {
    const future = i > tIdx;
    const allowance = future ? futureAllowance : (flexible - cum) / (n - i);
    if (!future) cum += spent;
    return {
      i, date: addDays(start, i), spent: round2(spent), allowance, future,
      isToday: i === tIdx, cumAfter: cum,
      status: future ? 'future' : dayStatus(spent, allowance)
    };
  });

  const todayDay = days[tIdx];
  const left = round2(todayDay.allowance - todayDay.spent);
  let streak = 0;
  if (left >= -0.005) {
    for (let i = tIdx - 1; i >= 0 && days[i].status !== 'near' && days[i].status !== 'over'; i -= 1) streak += 1;
  }
  const nowX = tIdx + 0.5;
  const pace = totalSpent / nowX;
  const projectedEnd = round2(remaining - pace * (n - nowX));
  const dryX = pace > 0 && projectedEnd < 0 && remaining > 0 ? nowX + remaining / pace : null;

  return {
    n, tIdx, flexible, days, today: todayDay, left, totalSpent, remaining, daysLeft,
    futureAllowance, streak, nowX, pace, projectedEnd, dryX, inCycle,
    baseline: flexible / n,
    effectiveToday: addDays(start, tIdx),
    pastPayday: diffDays(payday, today) >= 0
  };
}

function whatIf(calc, price) {
  if (!(price > 0)) return { kind: 'none' };
  if (price <= calc.left + 0.005) return { kind: 'fits', leftAfter: round2(calc.left - price) };
  if (price <= calc.remaining + 0.005 && calc.daysLeft > 1) {
    const newDaily = (calc.remaining - price) / (calc.daysLeft - 1);
    return { kind: 'borrows', newDaily, perDayCost: calc.futureAllowance - newDaily, days: calc.daysLeft - 1 };
  }
  return { kind: 'exceeds', shortBy: round2(price - Math.max(0, calc.remaining)) };
}

function guessCategory(note) {
  const lower = note.toLowerCase();
  const hit = CATS.find((c) => c.words.some((w) => lower.includes(w)));
  return hit ? hit.id : 'Other';
}

/** "12.50 lunch yesterday" -> { amount, note, dayShift } or { error }. */
function parseQuick(text) {
  const trimmed = text.trim();
  if (!trimmed) return { error: 'empty' };
  const match = trimmed.match(/\d+(?:[.,]\d{1,2})?/);
  if (!match) return { error: 'Add an amount, for example "12.50 lunch".' };
  const amount = round2(parseFloat(match[0].replace(',', '.')));
  if (!(amount > 0)) return { error: 'The amount must be more than zero.' };
  if (amount > MAX_AMOUNT) return { error: 'That amount is too large to log.' };
  const rest = (trimmed.slice(0, match.index) + ' ' + trimmed.slice(match.index + match[0].length))
    .replace(/[$€£₹¥]/g, ' ');
  const dayShift = /\byesterday\b/i.test(rest) ? -1 : 0;
  const note = rest.replace(/\b(yesterday|today)\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);
  return { amount, note, dayShift };
}

/* ================= app state ================= */
let state = loadState();
let undoState = null;
let ui = { whatIf: 120, selectedDay: null, quickDateTouched: false };
let toastTimer = null;
let billDraft = [];

function commit(next, message, undoable = true) {
  undoState = undoable ? state : null;
  state = next;
  const saved = saveState(state);
  render();
  showToast(saved ? message : `${message} (could not save to this browser)`, undoable);
}

/* ================= rendering ================= */
function render() {
  const calc = compute(state, todayISO());
  renderHeader(calc);
  renderHero(calc);
  renderQuickDefaults(calc);
  renderChart(calc);
  renderWhatIf(calc);
  renderCats(calc);
  renderStrip(calc);
  renderLog(calc);
}

function renderHeader(calc) {
  const { start, payday } = state.cycle;
  $('cycleLabel').textContent = `${fmtDate(start)} → ${fmtDate(payday)} · day ${calc.tIdx + 1} of ${calc.n}`;
  $('banner').hidden = !calc.pastPayday;
  $('bannerText').textContent = `Payday (${fmtDate(payday)}) has arrived. Start a fresh cycle to keep pacing.`;
}

function renderHero(calc) {
  const c = state.currency;
  const over = calc.left < -0.005;
  const amount = $('safeAmount');
  amount.textContent = money(Math.abs(calc.left) < 0.005 ? 0 : calc.left, c);
  amount.classList.toggle('over', over);
  $('heroTitle').textContent = over ? 'Over today’s allowance' : 'Safe to spend today';

  const ratio = calc.today.allowance > 0 ? calc.today.spent / calc.today.allowance : (calc.today.spent > 0 ? 2 : 0);
  const fill = $('meterFill');
  fill.style.width = `${clamp(ratio * 100, 0, 100)}%`;
  fill.className = ratio > 1 ? 'over' : ratio > 0.8 ? 'warn' : '';
  $('meter').setAttribute('aria-label', `${Math.round(ratio * 100)} percent of today's allowance spent`);

  const bonus = calc.today.allowance - calc.baseline;
  const base = `${money(calc.today.spent, c)} spent of today’s ${money(Math.max(0, calc.today.allowance), c)} allowance.`;
  let extra = '';
  if (over && calc.daysLeft > 1) extra = ` Tomorrow drops to ${money(calc.futureAllowance, c)} a day.`;
  else if (bonus > 0.5) extra = ` That is ${money(bonus, c)} more than your even pace, earned by underspending.`;
  else if (bonus < -0.5) extra = ` That is ${money(-bonus, c)} below your even pace while you catch up.`;
  $('safeNote').textContent = base + extra;

  $('statDays').textContent = String(calc.daysLeft);
  $('statStreak').textContent = `${calc.streak} ${calc.streak === 1 ? 'day' : 'days'}`;
  $('statLeft').textContent = money(calc.remaining, c, 0);
}

function renderQuickDefaults(calc) {
  const dateInput = $('quickDate');
  dateInput.min = state.cycle.start;
  dateInput.max = calc.effectiveToday;
  if (!ui.quickDateTouched || !dateInput.value || dateInput.value > dateInput.max || dateInput.value < dateInput.min) {
    dateInput.value = calc.effectiveToday;
  }
  $('quickText').placeholder = `12.50 lunch`;
  updateQuickHint();
}

function resolveQuick() {
  const parsed = parseQuick($('quickText').value);
  if (parsed.error) return parsed;
  const calc = compute(state, todayISO());
  const picked = $('quickDate').value;
  const baseDate = isValidISO(picked) ? picked : calc.effectiveToday;
  const shifted = parsed.dayShift ? addDays(calc.effectiveToday, parsed.dayShift) : baseDate;
  const date = shifted < state.cycle.start ? state.cycle.start : (shifted > calc.effectiveToday ? calc.effectiveToday : shifted);
  const chosen = $('quickCat').value;
  const cat = chosen === 'Auto' ? guessCategory(parsed.note) : chosen;
  return { amount: parsed.amount, note: parsed.note || cat, cat, date, effectiveToday: calc.effectiveToday };
}

function dateWord(date, effectiveToday) {
  const gap = diffDays(date, effectiveToday);
  return gap === 0 ? 'today' : gap === 1 ? 'yesterday' : fmtDate(date);
}

function updateQuickHint(showErrors = false) {
  const hint = $('quickHint');
  const res = resolveQuick();
  hint.classList.remove('err');
  if (res.error === 'empty') {
    hint.textContent = showErrors ? 'Type an amount and what it was for.' : 'Try “8.40 coffee” or “35 taxi yesterday”.';
    hint.classList.toggle('err', showErrors);
  } else if (res.error) {
    hint.textContent = res.error;
    hint.classList.toggle('err', showErrors);
  } else {
    hint.textContent = `→ ${money(res.amount, state.currency)} · ${res.cat} · ${dateWord(res.date, res.effectiveToday)}`;
  }
}

/* ---------- chart ---------- */
function renderChart(calc) {
  const wrap = $('chartWrap');
  const W = Math.max(280, Math.round(wrap.clientWidth || 520));
  const H = Math.round(clamp(W * 0.56, 210, 320));
  const m = { l: 46, r: 18, t: 20, b: 28 };
  const c = state.currency;
  const yMax = Math.max(calc.flexible, 1);
  const yMin = Math.min(0, calc.projectedEnd, calc.remaining);
  const x = (v) => m.l + (v / calc.n) * (W - m.l - m.r);
  const y = (v) => m.t + ((yMax - v) / (yMax - yMin)) * (H - m.t - m.b);
  const good = calc.projectedEnd >= 0;
  const tone = good ? 'good' : 'bad';

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': chartSummary(calc) });
  [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
    const v = yMax * f;
    root.append(svg('line', { class: f === 0 ? 'c-zero' : 'c-grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    root.append(svg('text', { class: 'c-label', x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, money(v, c, 0)));
  });

  root.append(svg('line', { class: 'c-pace', x1: x(0), y1: y(yMax), x2: x(calc.n), y2: y(0) }));

  const pts = [[0, calc.flexible]];
  calc.days.filter((d) => d.i < calc.tIdx).forEach((d) => pts.push([d.i + 1, calc.flexible - d.cumAfter]));
  pts.push([calc.nowX, calc.remaining]);
  const line = pts.map(([px, py]) => `${x(px).toFixed(1)},${y(py).toFixed(1)}`).join(' ');
  root.append(svg('polygon', { class: 'c-area', points: `${x(0)},${y(0)} ${line} ${x(calc.nowX).toFixed(1)},${y(0)}` }));
  root.append(svg('polyline', { class: 'c-actual', points: line }));

  root.append(svg('line', { class: `c-proj ${tone}`, x1: x(calc.nowX), y1: y(calc.remaining), x2: x(calc.n), y2: y(calc.projectedEnd) }));
  root.append(svg('line', { class: 'c-today', x1: x(calc.nowX), x2: x(calc.nowX), y1: m.t - 6, y2: H - m.b }));
  root.append(svg('circle', { class: 'c-dot', cx: x(calc.nowX), cy: y(calc.remaining), r: 5 }));
  root.append(svg('circle', { class: `c-end ${tone}`, cx: x(calc.n), cy: y(calc.projectedEnd), r: 5 }));

  const todayAnchor = calc.nowX / calc.n > 0.85 ? 'end' : calc.nowX / calc.n < 0.12 ? 'start' : 'middle';
  root.append(svg('text', { class: 'c-strong', x: x(calc.nowX), y: m.t - 9, 'text-anchor': todayAnchor }, 'today'));
  const below = y(calc.projectedEnd) + 20 <= H - m.b - 4;
  const endY = below ? y(calc.projectedEnd) + 20 : y(calc.projectedEnd) - 12;
  root.append(svg('text', { class: `c-strong ${tone}`, x: W - m.r - (below ? 10 : 0), y: endY, 'text-anchor': 'end' },
    `${good ? '+' : ''}${money(calc.projectedEnd, c, 0)}`));
  if (calc.dryX != null) {
    root.append(svg('circle', { class: 'c-end bad', cx: x(calc.dryX), cy: y(0), r: 4 }));
  }
  root.append(svg('text', { class: 'c-label', x: m.l, y: H - 8 }, fmtDate(state.cycle.start)));
  root.append(svg('text', { class: 'c-label', x: W - m.r, y: H - 8, 'text-anchor': 'end' }, `payday ${fmtDate(state.cycle.payday)}`));

  wrap.replaceChildren(root);
  renderForecast(calc);
}

function chartSummary(calc) {
  const c = state.currency;
  return `Runway chart. ${money(calc.remaining, c)} of ${money(calc.flexible, c)} left on day ${calc.tIdx + 1} of ${calc.n}. Projected ${money(calc.projectedEnd, c)} on payday.`;
}

function renderForecast(calc) {
  const c = state.currency;
  const box = $('forecast');
  const tone = calc.projectedEnd >= 0 ? 'good' : 'bad';
  $('paceEven').textContent = `${money(calc.baseline, c)}/day`;
  $('paceYours').textContent = `${money(calc.pace, c)}/day`;
  $('paceYours').className = calc.pace <= calc.baseline + 0.005 ? 'good' : 'bad';
  $('paceEnd').textContent = money(calc.projectedEnd, c, 0);
  $('paceEnd').className = tone;
  const strong = (text, tone) => el('strong', { class: tone, text });
  if (calc.totalSpent === 0) {
    box.replaceChildren(`Nothing logged yet. Your even pace is ${money(calc.baseline, c)} a day.`);
  } else if (calc.projectedEnd >= 0) {
    box.replaceChildren(
      `Averaging ${money(calc.pace, c)} a day, you reach payday with `,
      strong(`${money(calc.projectedEnd, c)} to spare`, 'good'),
      '. Keep it up, or move some to savings.'
    );
  } else {
    const dryDate = calc.dryX != null ? addDays(state.cycle.start, Math.min(calc.n - 1, Math.floor(calc.dryX))) : calc.effectiveToday;
    const daysAhead = Math.max(1, calc.n - calc.nowX);
    const trim = Math.max(0, calc.pace - Math.max(0, calc.remaining) / daysAhead);
    box.replaceChildren(
      `Averaging ${money(calc.pace, c)} a day, the money `,
      strong(`runs dry around ${fmtDate(dryDate)}`, 'bad'),
      `. Trim about ${money(trim, c)} a day to make it to payday.`
    );
  }
}

/* ---------- what-if ---------- */
function renderWhatIf(calc) {
  const c = state.currency;
  const range = $('whatRange');
  const max = Math.max(50, Math.ceil(Math.max(calc.remaining, 0) * 0.6 / 10) * 10);
  range.max = String(max);
  range.value = String(clamp(ui.whatIf, 0, max));
  const amountInput = $('whatAmount');
  if (document.activeElement !== amountInput) amountInput.value = String(ui.whatIf);

  const res = whatIf(calc, ui.whatIf);
  const verdict = $('whatVerdict');
  const detail = $('whatDetail');
  const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
  const worth = calc.baseline > 0 ? ` It equals ${(ui.whatIf / calc.baseline).toFixed(1)} days of spending money.` : '';
  $('whatLog').disabled = res.kind === 'none';
  if (res.kind === 'none') {
    verdict.className = 'verdict';
    verdict.textContent = 'Enter a price to check';
    detail.textContent = 'See what a purchase does to the rest of your cycle before you make it.';
  } else if (res.kind === 'fits') {
    verdict.className = 'verdict good';
    verdict.textContent = 'Yes, it fits in today';
    detail.textContent = `You would still have ${money(res.leftAfter, c)} left today, and tomorrow is untouched.${worth}`;
  } else if (res.kind === 'borrows') {
    verdict.className = 'verdict warn';
    verdict.textContent = 'Yes, but it borrows from later days';
    detail.textContent = `Your allowance becomes ${money(res.newDaily, c)} a day, which is ${money(res.perDayCost, c)} less each day for ${days(res.days)}.${worth}`;
  } else {
    verdict.className = 'verdict bad';
    verdict.textContent = 'No, not this cycle';
    detail.textContent = `It is ${money(res.shortBy, c)} more than everything you have left until payday. Wait, or dip into savings on purpose.`;
  }
}

/* ---------- categories ---------- */
function renderCats(calc) {
  const totals = calc.inCycle.reduce((acc, e) => ({ ...acc, [e.cat]: (acc[e.cat] || 0) + e.amount }), {});
  const rows = CATS.filter((cat) => totals[cat.id] > 0).sort((a, b) => totals[b.id] - totals[a.id]);
  const box = $('cats');
  if (!rows.length) {
    box.replaceChildren(el('p', { class: 'empty', text: 'No spending logged in this cycle yet.' }));
    return;
  }
  const top = totals[rows[0].id];
  box.replaceChildren(...rows.map((cat) => {
    const bar = el('span');
    bar.style.width = `${Math.max(3, (totals[cat.id] / top) * 100)}%`;
    bar.style.background = cat.color;
    const share = Math.round((totals[cat.id] / calc.totalSpent) * 100);
    return el('div', { class: 'cat-row' }, [
      el('span', { text: cat.id }),
      el('div', { class: 'cat-bar' }, bar),
      el('span', { class: 'cat-amt', text: `${money(totals[cat.id], state.currency, 0)} · ${share}%` })
    ]);
  }));
}

/* ---------- day strip ---------- */
function describeDay(day) {
  const c = state.currency;
  const label = fmtWeekday(day.date);
  if (day.future) return `${label}: about ${money(Math.max(0, day.allowance), c)} to spend if today stays as it is.`;
  const gap = day.allowance - day.spent;
  const tail = day.spent === 0 ? 'A no-spend day.' : gap >= 0 ? `${money(gap, c)} under, rolled forward.` : `${money(-gap, c)} over, spread across later days.`;
  return `${label}: spent ${money(day.spent, c)} of a ${money(Math.max(0, day.allowance), c)} allowance. ${tail}`;
}

function renderStrip(calc) {
  const selected = ui.selectedDay != null && ui.selectedDay < calc.n ? ui.selectedDay : calc.tIdx;
  $('strip').replaceChildren(...calc.days.map((day) => el('button', {
    type: 'button',
    class: `day ${day.status}${day.isToday ? ' today' : ''}${day.i === selected ? ' sel' : ''}`,
    'aria-label': describeDay(day),
    'aria-pressed': String(day.i === selected),
    text: String(parts(day.date)[2]),
    onclick: () => { ui = { ...ui, selectedDay: day.i }; renderStrip(compute(state, todayISO())); }
  })));
  $('dayDetail').textContent = describeDay(calc.days[selected]);
}

/* ---------- log ---------- */
function renderLog(calc) {
  const c = state.currency;
  const box = $('log');
  if (!calc.inCycle.length) {
    box.replaceChildren(el('p', { class: 'empty', text: 'Nothing here yet. Log your first purchase above.' }));
    return;
  }
  const colorOf = (id) => (CATS.find((cat) => cat.id === id) || CATS[CATS.length - 1]).color;
  const dates = [...new Set(calc.inCycle.map((e) => e.date))].sort().reverse();
  box.replaceChildren(...dates.map((date) => {
    const day = calc.days[diffDays(state.cycle.start, date)];
    const over = day.status === 'near' || day.status === 'over';
    const word = dateWord(date, calc.effectiveToday);
    const title = word === fmtDate(date) ? fmtWeekday(date) : `${word[0].toUpperCase()}${word.slice(1)}, ${fmtDate(date)}`;
    const rows = calc.inCycle.filter((e) => e.date === date).map((e) => {
      const dot = el('span', { class: 'dot' });
      dot.style.background = colorOf(e.cat);
      return el('div', { class: 'log-row' }, [
        dot,
        el('span', { class: 'log-note', text: e.note }),
        el('span', { class: 'log-cat', text: e.cat }),
        el('span', { class: 'log-amt', text: money(e.amount, c) }),
        el('button', {
          type: 'button', class: 'del', text: '×', 'aria-label': `Delete ${e.note}, ${money(e.amount, c)}`,
          onclick: () => commit(removeExpense(state, e.id), `Deleted ${money(e.amount, c)} ${e.note}`)
        })
      ]);
    });
    return el('div', { class: 'log-group' }, [
      el('div', { class: 'log-head' }, [
        el('span', { text: title }),
        el('span', { class: over ? 'hot' : 'ok', text: `${money(day.spent, c)} of ${money(Math.max(0, day.allowance), c)}` })
      ]),
      ...rows
    ]);
  }));
}

/* ---------- toast ---------- */
function showToast(message, withUndo = false) {
  $('toastText').textContent = message;
  $('toastUndo').hidden = !(withUndo && undoState);
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, TOAST_MS);
}

/* ================= plan dialog ================= */
function readPlanForm() {
  return {
    currency: $('pCurrency').value,
    cycle: {
      start: $('pStart').value,
      payday: $('pPayday').value,
      income: round2(parseFloat($('pIncome').value)),
      savings: round2(parseFloat($('pSavings').value))
    },
    bills: billDraft
      .filter((b) => b.name.trim() || b.amount)
      .map((b) => ({ id: b.id, name: b.name.trim().slice(0, 40) || 'Bill', amount: round2(parseFloat(b.amount) || 0) }))
  };
}

function planProblem(plan) {
  const { start, payday, income, savings } = plan.cycle;
  if (!Number.isFinite(income) || income < 0 || income > MAX_AMOUNT * 100) return 'Enter your income for this cycle.';
  if (!Number.isFinite(savings) || savings < 0) return 'Savings must be zero or more.';
  if (!isValidISO(start) || !isValidISO(payday)) return 'Pick both a start date and a payday.';
  const length = diffDays(start, payday);
  if (length < 1) return 'Payday must be after the cycle start.';
  if (length > MAX_CYCLE_DAYS) return 'A cycle can be at most 366 days.';
  if (plan.bills.some((b) => b.amount < 0 || b.amount > MAX_AMOUNT * 100)) return 'Bill amounts must be zero or more.';
  if (flexibleOf(plan.cycle, plan.bills) <= 0) return 'Bills and savings use up all of the income. Lower one of them.';
  return '';
}

function updatePlanSummary() {
  const plan = readPlanForm();
  const problem = planProblem(plan);
  const summary = $('planSummary');
  if (problem) {
    summary.textContent = `Bills total ${money(billsTotal(plan.bills), plan.currency)}.`;
    return problem;
  }
  const flexible = flexibleOf(plan.cycle, plan.bills);
  const length = diffDays(plan.cycle.start, plan.cycle.payday);
  summary.textContent = `Bills ${money(billsTotal(plan.bills), plan.currency)} · flexible money ${money(flexible, plan.currency)} · ${money(flexible / length, plan.currency)} a day over ${length} days.`;
  return '';
}

function renderBillRows() {
  $('billRows').replaceChildren(...billDraft.map((bill, index) => {
    const update = (patch) => {
      billDraft = billDraft.map((b) => (b.id === bill.id ? { ...b, ...patch } : b));
      updatePlanSummary();
    };
    const name = el('input', { type: 'text', maxlength: '40', 'aria-label': `Bill ${index + 1} name`, placeholder: 'Bill name' });
    name.value = bill.name;
    name.addEventListener('input', () => update({ name: name.value }));
    const amount = el('input', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', 'aria-label': `Bill ${index + 1} amount`, placeholder: '0' });
    amount.value = bill.amount;
    amount.addEventListener('input', () => update({ amount: amount.value }));
    const remove = el('button', {
      type: 'button', class: 'del', text: '×', 'aria-label': `Remove bill ${bill.name || index + 1}`,
      onclick: () => { billDraft = billDraft.filter((b) => b.id !== bill.id); renderBillRows(); updatePlanSummary(); }
    });
    return el('div', { class: 'bill-row' }, [name, amount, remove]);
  }));
}

function disarm() {
  ['newCycle', 'loadSample'].forEach((id) => {
    const button = $(id);
    button.classList.remove('armed');
    button.textContent = button.dataset.label;
  });
}

function openPlan() {
  $('pIncome').value = state.cycle.income;
  $('pSavings').value = state.cycle.savings;
  $('pStart').value = state.cycle.start;
  $('pPayday').value = state.cycle.payday;
  $('pCurrency').value = state.currency;
  billDraft = state.bills.map((b) => ({ ...b, amount: String(b.amount) }));
  renderBillRows();
  updatePlanSummary();
  $('planError').textContent = '';
  disarm();
  $('planDialog').showModal();
}

function closePlan() {
  if ($('planDialog').open) $('planDialog').close();
}

/** First click arms the button, second click within the dialog runs the action. */
function confirmClick(button, action) {
  if (button.classList.contains('armed')) {
    disarm();
    action();
    return;
  }
  disarm();
  button.classList.add('armed');
  button.textContent = 'Click again to confirm';
}

function exportData() {
  try {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `pursepace-${todayISO()}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Exported your data as JSON');
  } catch (err) {
    console.warn('Pursepace: export failed.', err);
    showToast('Export is not available in this browser');
  }
}

function importData(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('That file is too large to be a Pursepace export'); return; }
  const reader = new FileReader();
  reader.onerror = () => showToast('Could not read that file');
  reader.onload = () => {
    let clean = null;
    try {
      clean = sanitizeState(JSON.parse(String(reader.result)));
    } catch (err) {
      console.warn('Pursepace: import was not valid JSON.', err);
    }
    if (!clean) { showToast('That file is not a valid Pursepace export'); return; }
    closePlan();
    commit(clean, 'Imported your data');
  };
  reader.readAsText(file);
}

/* ================= events ================= */
function bindEvents() {
  $('quickCat').replaceChildren(...['Auto', ...CAT_IDS].map((id) => el('option', { value: id, text: id })));
  $('pCurrency').replaceChildren(...CURRENCIES.map((cur) => el('option', { value: cur, text: cur })));
  ['newCycle', 'loadSample'].forEach((id) => { $(id).dataset.label = $(id).textContent; });

  $('quickText').addEventListener('input', () => updateQuickHint());
  $('quickCat').addEventListener('change', () => updateQuickHint());
  $('quickDate').addEventListener('change', () => { ui = { ...ui, quickDateTouched: true }; updateQuickHint(); });
  $('quickForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const res = resolveQuick();
    if (res.error) { updateQuickHint(true); $('quickText').focus(); return; }
    $('quickText').value = '';
    ui = { ...ui, quickDateTouched: false };
    commit(
      addExpense(state, { id: newId(), date: res.date, amount: res.amount, note: res.note, cat: res.cat }),
      `Logged ${money(res.amount, state.currency)} ${res.note}`
    );
    $('quickText').focus();
  });

  const setWhatIf = (value) => {
    const n = Number.isFinite(value) ? clamp(round2(value), 0, MAX_AMOUNT) : 0;
    ui = { ...ui, whatIf: n };
    renderWhatIf(compute(state, todayISO()));
  };
  $('whatRange').addEventListener('input', (event) => { $('whatAmount').value = event.target.value; setWhatIf(parseFloat(event.target.value)); });
  $('whatAmount').addEventListener('input', (event) => setWhatIf(parseFloat(event.target.value)));
  $('whatLog').addEventListener('click', () => {
    if (!(ui.whatIf > 0)) return;
    const calc = compute(state, todayISO());
    commit(
      addExpense(state, { id: newId(), date: calc.effectiveToday, amount: ui.whatIf, note: 'Planned purchase', cat: 'Shopping' }),
      `Logged ${money(ui.whatIf, state.currency)} purchase`
    );
  });

  $('toastUndo').addEventListener('click', () => {
    if (!undoState) return;
    const previous = undoState;
    commit(previous, 'Undone', false);
  });

  $('openPlan').addEventListener('click', openPlan);
  $('closePlan').addEventListener('click', closePlan);
  $('planDialog').addEventListener('click', (event) => { if (event.target === $('planDialog')) closePlan(); });
  $('addBill').addEventListener('click', () => {
    if (billDraft.length >= MAX_BILLS) return;
    billDraft = [...billDraft, { id: newId(), name: '', amount: '' }];
    renderBillRows();
    const inputs = $('billRows').querySelectorAll('input[type="text"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
  ['pIncome', 'pSavings', 'pStart', 'pPayday', 'pCurrency'].forEach((id) => $(id).addEventListener('input', updatePlanSummary));
  $('planForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const plan = readPlanForm();
    const problem = planProblem(plan);
    $('planError').textContent = problem;
    if (problem) return;
    closePlan();
    commit(applyPlan(state, plan), 'Plan saved');
  });

  const startNewCycle = () => { closePlan(); commit(newCycle(state, todayISO()), 'New cycle started'); };
  $('newCycle').addEventListener('click', (event) => confirmClick(event.currentTarget, startNewCycle));
  $('bannerAction').addEventListener('click', startNewCycle);
  $('loadSample').addEventListener('click', (event) => confirmClick(event.currentTarget, () => {
    closePlan();
    commit(sampleState(todayISO()), 'Sample data loaded');
  }));
  $('exportData').addEventListener('click', exportData);
  $('importFile').addEventListener('change', (event) => { importData(event.target.files[0]); event.target.value = ''; });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderChart(compute(state, todayISO())), 120);
  });
}

bindEvents();
render();
