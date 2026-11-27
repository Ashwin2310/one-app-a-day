'use strict';

/* ---------- constants ---------- */
const STORE_KEY = 'brewlapse.v1';
const HOUR = 3600000;
const MIN = 60000;
const STEP = 5 * MIN;
const DAY_START_H = 5;          // a "day" runs 05:00 -> 05:00
const KA = 5;                   // absorption rate per hour (peak ~44 min)
const NIGHT_H = 8;              // hours after bedtime checked for last call
const RELEVANT_H = 48;          // older doses are negligible
const DEFAULT_SETTINGS = Object.freeze({bedtime: '23:00', halfLife: 5, threshold: 50, limit: 400});
const PRESETS = Object.freeze([
  {id: 'espresso', name: 'Espresso', mg: 63, color: '#C98B4A', ink: '#15100D', tag: 'Es'},
  {id: 'filter', name: 'Filter coffee', mg: 95, color: '#E8B67A', ink: '#15100D', tag: 'Fc'},
  {id: 'latte', name: 'Latte (double)', mg: 126, color: '#F3D3A8', ink: '#15100D', tag: 'La'},
  {id: 'coldbrew', name: 'Cold brew', mg: 155, color: '#8C5A34', ink: '#F5EEE7', tag: 'Cb'},
  {id: 'blacktea', name: 'Black tea', mg: 47, color: '#D9825B', ink: '#15100D', tag: 'Bt'},
  {id: 'greentea', name: 'Green tea', mg: 28, color: '#9CCB7A', ink: '#15100D', tag: 'Gt'},
  {id: 'cola', name: 'Cola', mg: 34, color: '#B35C44', ink: '#F5EEE7', tag: 'Co'},
  {id: 'energy', name: 'Energy drink', mg: 80, color: '#F2C14E', ink: '#15100D', tag: 'En'},
  {id: 'choc', name: 'Dark choc 50 g', mg: 25, color: '#7A4B33', ink: '#F5EEE7', tag: 'Ch'}
]);
const CUSTOM_STYLE = Object.freeze({color: '#7FD1B9', ink: '#15100D'});
const SAMPLE_WEEK = Object.freeze([
  [['07:30', 'filter'], ['10:40', 'espresso'], ['15:50', 'coldbrew']],
  [['08:10', 'latte'], ['13:30', 'blacktea']],
  [['07:20', 'filter'], ['11:00', 'filter'], ['14:15', 'espresso'], ['17:30', 'cola']],
  [['08:30', 'latte'], ['12:45', 'greentea'], ['16:20', 'energy']],
  [['07:45', 'filter'], ['10:30', 'espresso']],
  [['09:30', 'latte'], ['14:00', 'espresso'], ['20:30', 'choc']]
]);

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const uid = () => Date.now().toString(36) + Math.floor(performance.now() * 1000).toString(36).slice(-4) + Math.random().toString(36).slice(2, 6);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ---------- time helpers ---------- */
const fmt = (ts) => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
function dayKey(ts) {
  const d = new Date(ts - DAY_START_H * HOUR);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function parseKey(key) { const [y, m, d] = key.split('-').map(Number); return {y, m, d}; }
function dayStart(key) { const {y, m, d} = parseKey(key); return new Date(y, m - 1, d, DAY_START_H, 0).getTime(); }
function timeOnDay(key, hhmm) {
  const [h, mm] = hhmm.split(':').map(Number);
  const {y, m, d} = parseKey(key);
  return new Date(y, m - 1, h < DAY_START_H ? d + 1 : d, h, mm).getTime();
}
function shiftKey(key, days) { const {y, m, d} = parseKey(key); return dayKey(new Date(y, m - 1, d + days, 12).getTime()); }
function dayLabel(key, long) {
  const {y, m, d} = parseKey(key);
  const opts = long ? {weekday: 'short', day: 'numeric', month: 'short'} : {weekday: 'short'};
  return new Date(y, m - 1, d, 12).toLocaleDateString(undefined, opts);
}

/* ---------- pharmacokinetic model ---------- */
const keOf = (s) => Math.LN2 / s.halfLife;
function doseAt(mg, dtH, ke) {
  if (dtH <= 0) return 0;
  return mg * KA / (KA - ke) * (Math.exp(-ke * dtH) - Math.exp(-KA * dtH));
}
function levelAt(drinks, t, ke) {
  return drinks.reduce((sum, dr) => sum + doseAt(dr.mg, (t - dr.ts) / HOUR, ke), 0);
}
function nearby(drinks, from, to) { return drinks.filter((d) => d.ts <= to && d.ts >= from - RELEVANT_H * HOUR); }
function nightPeak(drinks, bed, ke) {
  let peak = 0;
  for (let t = bed; t <= bed + NIGHT_H * HOUR; t += 2 * STEP) peak = Math.max(peak, levelAt(drinks, t, ke));
  return peak;
}
function sleepSafeTime(drinks, from, s) {
  const ke = keOf(s);
  const pool = nearby(drinks, from, from + 36 * HOUR);
  const first = Math.ceil(from / STEP) * STEP;
  let lastAbove = null;
  for (let t = first; t <= first + 36 * HOUR; t += STEP) if (levelAt(pool, t, ke) > s.threshold) lastAbove = t;
  return lastAbove === null ? from : lastAbove + STEP;
}
function lastCall(drinks, mg, now, bed, s) {
  if (now >= bed) return {ts: null, reason: 'past'};
  const ke = keOf(s);
  const pool = nearby(drinks, now, bed + NIGHT_H * HOUR);
  let best = null;
  const start = Math.ceil(now / STEP) * STEP;
  for (let t = start; t <= bed; t += STEP) {
    if (nightPeak([...pool, {mg, ts: t}], bed, ke) <= s.threshold) best = t;
  }
  return best === null ? {ts: null, reason: 'none'} : {ts: best, reason: best >= bed - STEP ? 'any' : 'ok'};
}

/* ---------- state ---------- */
function sampleDrinks(now) {
  const today = dayKey(now);
  const past = SAMPLE_WEEK.flatMap((day, i) => day.map(([hhmm, pid]) => {
    const p = PRESETS.find((x) => x.id === pid);
    return {id: uid(), name: p.name, mg: p.mg, pid, ts: timeOnDay(shiftKey(today, i - SAMPLE_WEEK.length), hhmm)};
  }));
  const start = dayStart(today);
  const rel = [[6.5, 'filter'], [3.8, 'espresso'], [1.3, 'greentea']]
    .map(([h, pid]) => ({pid, ts: Math.round((now - h * HOUR) / STEP) * STEP}))
    .filter((d) => d.ts >= start + HOUR);
  const todayPlan = rel.length >= 2 ? rel : [['07:40', 'filter'], ['10:20', 'espresso'], ['13:10', 'greentea']]
    .map(([hhmm, pid]) => ({pid, ts: timeOnDay(today, hhmm)}));
  const todays = todayPlan.map(({pid, ts}) => {
    const p = PRESETS.find((x) => x.id === pid);
    return {id: uid(), name: p.name, mg: p.mg, pid, ts};
  });
  return [...past, ...todays];
}
function validDrink(d) {
  return d && typeof d.name === 'string' && Number.isFinite(d.mg) && d.mg > 0 && d.mg <= 1000 && Number.isFinite(d.ts);
}
function validCustom(c) {
  return c && typeof c.id === 'string' && typeof c.name === 'string' && Number.isFinite(c.mg) && c.mg > 0 && c.mg <= 1000;
}
function loadState() {
  const fresh = {settings: {...DEFAULT_SETTINGS}, drinks: sampleDrinks(Date.now()), customs: [], pick: 'espresso'};
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fresh;
    const p = JSON.parse(raw);
    const s = {...DEFAULT_SETTINGS, ...(p.settings || {})};
    return {
      settings: sanitizeSettings(s),
      drinks: Array.isArray(p.drinks) ? p.drinks.filter(validDrink) : [],
      customs: Array.isArray(p.customs) ? p.customs.filter(validCustom) : [],
      pick: typeof p.pick === 'string' ? p.pick : 'espresso'
    };
  } catch (err) {
    console.warn('Brewlapse: stored data unreadable, starting fresh', err);
    return fresh;
  }
}
function sanitizeSettings(s) {
  return {
    bedtime: /^\d{2}:\d{2}$/.test(s.bedtime) ? s.bedtime : DEFAULT_SETTINGS.bedtime,
    halfLife: clamp(Number(s.halfLife) || DEFAULT_SETTINGS.halfLife, 2, 10),
    threshold: clamp(Number(s.threshold) || DEFAULT_SETTINGS.threshold, 5, 200),
    limit: clamp(Number(s.limit) || DEFAULT_SETTINGS.limit, 50, 1000)
  };
}

let state = loadState();
let view = null;          // null = today, otherwise a day key
let scrubT = null;
let ghost = null;         // {mg, ts}
let undoSnap = null;
let toastTimer = 0;

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (err) { console.warn('Brewlapse: could not save', err); }
}
function setState(patch) { state = {...state, ...patch}; save(); render(); }

/* ---------- derived ---------- */
const allDrinkTypes = () => [...PRESETS, ...state.customs.map((c) => ({...c, ...CUSTOM_STYLE, tag: c.name.slice(0, 2), custom: true}))];
const typeOf = (d) => allDrinkTypes().find((p) => p.id === d.pid) || {color: CUSTOM_STYLE.color};
const viewKey = () => view || dayKey(Date.now());
const isToday = () => viewKey() === dayKey(Date.now());
const bedOf = (key) => timeOnDay(key, state.settings.bedtime);
const drinksOn = (key) => state.drinks.filter((d) => dayKey(d.ts) === key).sort((a, b) => a.ts - b.ts);
function dayStats(key) {
  const list = drinksOn(key);
  const total = list.reduce((s, d) => s + d.mg, 0);
  const bedLevel = levelAt(nearby(state.drinks, bedOf(key), bedOf(key)), bedOf(key), keOf(state.settings));
  return {key, list, total, bedLevel};
}
function whenTs() {
  const v = $('whenInput').value;
  if (v) return timeOnDay(viewKey(), v);
  return isToday() ? Math.round(Date.now() / MIN) * MIN : timeOnDay(viewKey(), '12:00');
}

/* ---------- small DOM helpers ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const mgTxt = (v) => Math.round(v) + ' mg';
function setText(id, text) { $(id).textContent = text; }
function setMood(el, mood) { el.classList.toggle('good', mood === 'good'); el.classList.toggle('bad', mood === 'bad'); }

/* ---------- chart ---------- */
let geo = null;

function chartFrame() {
  const w = Math.max(280, Math.round($('chart').clientWidth || 900));
  const h = Math.round(clamp(w * 0.36, 210, 320));
  return {w, h, L: 38, R: 10, T: 16, B: 26};
}
function pathOf(points) { return points.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(''); }
function curvePoints(pool, from, to, ke) {
  const pts = [];
  for (let t = from; t <= to; t += STEP) pts.push([geo.X(t), geo.Y(levelAt(pool, t, ke))]);
  return pts;
}

function renderChart() {
  const key = viewKey();
  const start = dayStart(key);
  const end = start + 24 * HOUR;
  const now = Date.now();
  const bed = bedOf(key);
  const s = state.settings;
  const ke = keOf(s);
  const pool = nearby(state.drinks, start, end);
  let maxL = 0;
  for (let t = start; t <= end; t += STEP) maxL = Math.max(maxL, levelAt(pool, t, ke));
  const ymax = Math.max(200, Math.ceil((maxL * 1.2) / 100) * 100);
  const f = chartFrame();
  const X = (t) => f.L + ((t - start) / (24 * HOUR)) * (f.w - f.L - f.R);
  const Y = (v) => f.T + (1 - Math.min(v, ymax) / ymax) * (f.h - f.T - f.B);
  geo = {...f, X, Y, start, end, pool, ke, ymax, bed};

  const parts = [];
  parts.push('<defs><linearGradient id="bl-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E8B67A" stop-opacity="0.42"/><stop offset="1" stop-color="#E8B67A" stop-opacity="0.02"/></linearGradient></defs>');
  if (bed < end) parts.push(`<rect class="nightband" x="${X(bed)}" y="${f.T}" width="${X(end) - X(bed)}" height="${f.h - f.T - f.B}"/>`);
  for (let i = 0; i <= 4; i++) {
    const v = (ymax / 4) * i;
    parts.push(`<line class="grid" x1="${f.L}" x2="${f.w - f.R}" y1="${Y(v)}" y2="${Y(v)}"/>`);
    parts.push(`<text class="axis" x="${f.L - 6}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`);
  }
  const every = f.w < 560 ? 6 : 3;
  for (let hr = 0; hr <= 24; hr += every) {
    const t = start + hr * HOUR;
    parts.push(`<text class="axis" x="${X(t)}" y="${f.h - 6}" text-anchor="${hr === 0 ? 'start' : hr === 24 ? 'end' : 'middle'}">${fmt(t)}</text>`);
  }
  const pts = curvePoints(pool, start, end, ke);
  parts.push(`<path d="${pathOf(pts)}L${X(end)} ${Y(0)}L${X(start)} ${Y(0)}Z" fill="url(#bl-fill)"/>`);
  const showNow = isToday() && now > start && now < end;
  const cut = showNow ? Math.floor((now - start) / STEP) + 1 : pts.length;
  parts.push(`<path class="curve" d="${pathOf(pts.slice(0, cut))}"/>`);
  if (showNow) parts.push(`<path class="curve future" d="${pathOf(pts.slice(cut - 1))}"/>`);
  parts.push(`<line class="thr" x1="${f.L}" x2="${f.w - f.R}" y1="${Y(s.threshold)}" y2="${Y(s.threshold)}"/>`);
  parts.push(`<text class="thrlabel" x="${f.w - f.R - 6}" y="${Y(s.threshold) - 6}" text-anchor="end">sleep line ${s.threshold} mg</text>`);
  if (bed < end) {
    parts.push(`<line class="bed" x1="${X(bed)}" x2="${X(bed)}" y1="${f.T}" y2="${f.h - f.B}"/>`);
    const right = X(bed) > f.w - 70;
    parts.push(`<text class="bedlabel" x="${X(bed) + (right ? -5 : 5)}" y="${f.T + 12}" text-anchor="${right ? 'end' : 'start'}">☾ bed ${s.bedtime}</text>`);
  }
  drinksOn(key).forEach((d) => {
    const plan = d.ts > now;
    parts.push(`<circle class="drink${plan ? ' plan' : ''}" style="stroke:${typeOf(d).color}" cx="${X(d.ts)}" cy="${Y(levelAt(pool, d.ts, ke))}" r="5"><title>${esc(d.name)} ${fmt(d.ts)}, ${d.mg} mg${plan ? ' (planned)' : ''}</title></circle>`);
  });
  if (showNow) {
    const ny = Y(levelAt(pool, now, ke));
    parts.push(`<line class="now" x1="${X(now)}" x2="${X(now)}" y1="${f.T}" y2="${f.h - f.B}" opacity="0.35"/>`);
    parts.push(`<circle class="pulse" cx="${X(now)}" cy="${ny}" r="5"/><circle class="nowdot" cx="${X(now)}" cy="${ny}" r="5.5"/>`);
  }
  parts.push('<path class="ghost" id="ghostPath" d=""/>');
  parts.push(`<line class="cursor" id="cursorLine" x1="0" x2="0" y1="${f.T}" y2="${f.h - f.B}"/><circle class="cursordot" id="cursorDot" r="4" cx="0" cy="0"/>`);
  $('chart').innerHTML = `<svg viewBox="0 0 ${f.w} ${f.h}" width="${f.w}" height="${f.h}" aria-hidden="true" focusable="false">${parts.join('')}</svg>`;
  drawGhost();
  drawCursor();
}

function drawGhost() {
  const path = $('ghostPath');
  if (!path || !geo) return;
  if (!ghost || ghost.ts > geo.end) { path.setAttribute('d', ''); path.classList.remove('on'); return; }
  const pool = [...geo.pool, ghost];
  const from = Math.max(geo.start, Math.floor(ghost.ts / STEP) * STEP);
  path.setAttribute('d', pathOf(curvePoints(pool, from, geo.end, geo.ke)));
  path.classList.add('on');
}

function drawCursor() {
  const chart = $('chart');
  if (scrubT === null || !geo) {
    chart.classList.remove('scrub');
    setText('readout', 'Drag across the chart to scrub');
    return;
  }
  const v = levelAt(geo.pool, scrubT, geo.ke);
  const x = geo.X(scrubT);
  const line = $('cursorLine');
  const dot = $('cursorDot');
  line.setAttribute('x1', x); line.setAttribute('x2', x);
  dot.setAttribute('cx', x); dot.setAttribute('cy', geo.Y(v));
  chart.classList.add('scrub');
  const tag = v > state.settings.threshold ? 'above sleep line' : 'sleep-safe';
  setText('readout', `${fmt(scrubT)} · ${mgTxt(v)} · ${tag}`);
}

function scrubFromPointer(ev) {
  if (!geo) return;
  const rect = $('chart').getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * geo.w;
  const frac = clamp((x - geo.L) / (geo.w - geo.L - geo.R), 0, 1);
  scrubT = Math.round((geo.start + frac * 24 * HOUR) / STEP) * STEP;
  drawCursor();
}

/* ---------- stats ---------- */
function renderStats() {
  const key = viewKey();
  const today = isToday();
  const now = Date.now();
  const s = state.settings;
  const ke = keOf(s);
  const bed = bedOf(key);
  const start = dayStart(key);
  const pool = nearby(state.drinks, start, start + 36 * HOUR);
  const st = dayStats(key);

  let peak = 0; let peakT = start;
  for (let t = start; t <= start + 24 * HOUR; t += STEP) {
    const v = levelAt(pool, t, ke);
    if (v > peak) { peak = v; peakT = t; }
  }
  setText('nowLabel', today ? 'In you now' : 'At bedtime');
  setText('nowMg', Math.round(today ? levelAt(pool, now, ke) : st.bedLevel));
  setText('nowSub', peak > 0.5 ? `Peak ${mgTxt(peak)} at ${fmt(peakT)}` : 'Caffeine-free day');

  const from = today ? now : start;
  const safe = sleepSafeTime(state.drinks, from, s);
  const night = nightPeak(pool, bed, ke);
  const safeCard = $('safeTime').closest('.stat');
  setText('safeTime', today && safe <= from ? 'now' : (safe - start >= 24 * HOUR ? fmt(safe) + ' +1d' : fmt(safe)));
  setText('safeSub', `Up to ${mgTxt(night)} after ${s.bedtime}`);
  setMood(safeCard, night <= s.threshold ? 'good' : 'bad');

  renderLastCall(today, now, bed);

  setText('totalLabel', today ? 'Today' : dayLabel(key, true));
  setText('totalMg', st.total);
  setText('limitMg', s.limit);
  const fill = $('meterFill');
  fill.style.width = Math.min(100, (st.total / s.limit) * 100) + '%';
  fill.classList.toggle('over', st.total > s.limit);
  const n = st.list.length;
  setText('totalSub', st.total > s.limit
    ? `${n} drink${n === 1 ? '' : 's'} · ${st.total - s.limit} mg over`
    : `${n} drink${n === 1 ? '' : 's'} · ${s.limit - st.total} mg left`);
}

function renderLastCall(today, now, bed) {
  const card = $('lastCallCard');
  const sel = $('lastCallPick');
  const types = allDrinkTypes();
  const opts = types.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if (sel.dataset.sig !== opts) { sel.innerHTML = opts; sel.dataset.sig = opts; }
  const pick = types.find((p) => p.id === state.pick) || types[1];
  sel.value = pick.id;
  if (!today) {
    setText('lastCall', '—'); setText('lastCallSub', 'Shown for today only'); setMood(card, null);
    return;
  }
  const lc = lastCall(state.drinks, pick.mg, now, bed, state.settings);
  const thr = state.settings.threshold;
  const copy = {
    ok: [fmt(lc.ts), `Then you sleep under ${thr} mg`, 'good'],
    any: ['Any time', `Even at bedtime you stay under ${thr} mg`, 'good'],
    none: ['Skip it', `Even now it keeps you over ${thr} mg tonight`, 'bad'],
    past: ['Skip it', 'It is past your bedtime', 'bad']
  }[lc.reason];
  setText('lastCall', copy[0]); setText('lastCallSub', copy[1]); setMood(card, copy[2]);
}

/* ---------- drinks shelf ---------- */
function renderChips() {
  const types = allDrinkTypes();
  const sig = types.map((t) => t.id + t.mg).join('|');
  const box = $('chips');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.innerHTML = types.map((t) => {
    const chip = `<button type="button" class="chip" data-id="${esc(t.id)}" aria-label="Log ${esc(t.name)}, ${t.mg} milligrams">`
      + `<span class="dot" style="background:${t.color};color:${t.ink}">${esc(t.tag)}</span><b>${esc(t.name)}</b><em>${t.mg} mg</em></button>`;
    if (!t.custom) return chip;
    return `<span class="chipwrap">${chip}<button type="button" class="rm" data-rm="${esc(t.id)}" aria-label="Remove custom drink ${esc(t.name)}">×</button></span>`;
  }).join('');
}

function renderPreview() {
  const box = $('preview');
  if (!ghost) {
    box.innerHTML = isToday() ? 'Hover or focus a drink to preview its effect on tonight.' : `Adding drinks to ${esc(dayLabel(viewKey(), true))}.`;
    return;
  }
  const key = viewKey();
  const s = state.settings;
  const ke = keOf(s);
  const bed = bedOf(key);
  const pool = nearby(state.drinks, dayStart(key), bed + NIGHT_H * HOUR);
  const before = nightPeak(pool, bed, ke);
  const after = nightPeak([...pool, ghost], bed, ke);
  const from = isToday() ? Date.now() : dayStart(key);
  const safe0 = sleepSafeTime(state.drinks, from, s);
  const safe1 = sleepSafeTime([...state.drinks, ghost], from, s);
  const cls = after > s.threshold ? 'warnc' : 'goodc';
  const moved = safe1 > safe0 ? `Sleep-safe moves ${fmt(safe0)} → <strong>${fmt(safe1)}</strong>.` : 'Sleep-safe time unchanged.';
  box.innerHTML = `<strong>${esc(ghost.name)}</strong> at ${fmt(ghost.ts)}: up to <strong class="${cls}">${mgTxt(after)}</strong> after bed (+${Math.round(after - before)}). ${moved}`;
}

function showGhost(id) {
  const t = allDrinkTypes().find((p) => p.id === id);
  ghost = t ? {name: t.name, mg: t.mg, ts: whenTs()} : null;
  drawGhost();
  renderPreview();
}
function hideGhost() { ghost = null; drawGhost(); renderPreview(); }

/* ---------- log ---------- */
function renderLog() {
  const list = drinksOn(viewKey());
  const now = Date.now();
  setText('logTitle', isToday() ? "Today's log" : `Log for ${dayLabel(viewKey(), true)}`);
  setText('logCount', list.length ? `${list.length} · ${list.reduce((s, d) => s + d.mg, 0)} mg` : '');
  $('logEmpty').hidden = list.length > 0;
  $('log').innerHTML = list.map((d) => {
    const plan = d.ts > now;
    return `<li class="${plan ? 'plan' : ''}"><span class="dot" style="background:${typeOf(d).color}"></span>`
      + `<span class="name">${esc(d.name)}<small>${d.mg} mg${plan ? ' · planned' : ''}</small></span>`
      + `<input type="time" value="${fmt(d.ts)}" data-time="${esc(d.id)}" aria-label="Time of ${esc(d.name)}">`
      + `<button type="button" class="del" data-del="${esc(d.id)}" aria-label="Delete ${esc(d.name)} at ${fmt(d.ts)}">×</button></li>`;
  }).join('');
}

/* ---------- week ---------- */
function renderWeek() {
  const todayKey = dayKey(Date.now());
  const s = state.settings;
  const days = Array.from({length: 7}, (_, i) => dayStats(shiftKey(todayKey, i - 6)));
  const top = Math.max(s.limit, ...days.map((d) => d.total));
  $('week').innerHTML = days.map((d) => {
    const pressed = d.key === viewKey();
    const col = d.bedLevel <= s.threshold ? 'var(--mint)' : d.bedLevel <= s.threshold * 2 ? 'var(--amber)' : 'var(--coral)';
    const label = d.key === todayKey ? 'Today' : dayLabel(d.key);
    return `<button type="button" class="day" data-day="${d.key}" aria-pressed="${pressed}" aria-label="${esc(dayLabel(d.key, true))}: ${d.total} mg, ${Math.round(d.bedLevel)} mg at bedtime">`
      + `<span class="bar"><span class="${d.total > s.limit ? 'over' : ''}" style="height:${(d.total / top) * 100}%"></span></span>`
      + `<span class="bd" style="background:${d.total ? col : 'var(--line)'}"></span>`
      + `<span class="lbl">${esc(d.key === todayKey ? label : label.slice(0, 3))}</span><span class="mg">${d.total}</span></button>`;
  }).join('');
  renderInsight(days);
}

function renderInsight(days) {
  const s = state.settings;
  const active = days.filter((d) => d.total > 0);
  if (!active.length) { $('insight').textContent = 'Log a few days to see your patterns here.'; return; }
  const avg = Math.round(active.reduce((a, d) => a + d.total, 0) / active.length);
  const late = active.filter((d) => d.bedLevel > s.threshold).length;
  const lastMins = active.map((d) => (d.list[d.list.length - 1].ts - dayStart(d.key)) / MIN);
  const avgLast = dayStart(days[6].key) + (lastMins.reduce((a, b) => a + b, 0) / lastMins.length) * MIN;
  const nights = late === 0 ? 'every night under the sleep line' : `<strong>${late} of ${active.length}</strong> nights above ${s.threshold} mg at bedtime`;
  $('insight').innerHTML = `You averaged <strong>${avg} mg</strong> a day, with ${nights}. Your last drink was usually around <strong>${fmt(avgLast)}</strong>.`;
}

/* ---------- top-level render ---------- */
function render() {
  const today = isToday();
  $('viewing').hidden = today;
  if (!today) setText('viewingText', `Viewing ${dayLabel(viewKey(), true)}.`);
  $('whenHint').textContent = today
    ? 'Leave the time empty to log it right now. Hover a drink to preview it.'
    : 'Pick a time, or the drink is added at 12:00 on this day.';
  renderChips();
  renderStats();
  renderChart();
  renderLog();
  renderWeek();
  renderPreview();
}

/* ---------- actions ---------- */
function toast(text, undoable) {
  setText('toastText', text);
  $('undoBtn').hidden = !undoable;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; undoSnap = null; }, 5000);
}
function addDrink(id) {
  const t = allDrinkTypes().find((p) => p.id === id);
  if (!t) return;
  const drink = {id: uid(), name: t.name, mg: t.mg, pid: t.id, ts: whenTs()};
  undoSnap = state.drinks;
  ghost = null;
  setState({drinks: [...state.drinks, drink]});
  toast(`Logged ${t.name} at ${fmt(drink.ts)} · ${t.mg} mg`, true);
}
function deleteDrink(id) {
  const d = state.drinks.find((x) => x.id === id);
  if (!d) return;
  undoSnap = state.drinks;
  setState({drinks: state.drinks.filter((x) => x.id !== id)});
  toast(`Removed ${d.name}`, true);
}
function retime(id, value) {
  if (!/^\d{2}:\d{2}$/.test(value)) return;
  const d = state.drinks.find((x) => x.id === id);
  if (!d) return;
  const ts = timeOnDay(dayKey(d.ts), value);
  setState({drinks: state.drinks.map((x) => (x.id === id ? {...x, ts} : x))});
}
function saveCustom(ev) {
  ev.preventDefault();
  const name = $('customName').value.trim();
  const mg = Number($('customMg').value);
  const err = !name ? 'Give the drink a name.' : !Number.isFinite(mg) || mg < 1 || mg > 1000 ? 'Caffeine must be between 1 and 1000 mg.' : '';
  setText('customErr', err);
  if (err) return;
  const custom = {id: 'c-' + uid(), name, mg: Math.round(mg)};
  setState({customs: [...state.customs, custom]});
  $('customForm').reset();
  toast(`Saved ${name} to your shelf`, false);
}
function exportCsv() {
  const rows = [...state.drinks].sort((a, b) => a.ts - b.ts).map((d) => {
    const dt = new Date(d.ts);
    const date = dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
    return [date, fmt(d.ts), '"' + d.name.replace(/"/g, '""') + '"', d.mg].join(',');
  });
  const blob = new Blob([['date,time,drink,caffeine_mg', ...rows].join('\n')], {type: 'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'brewlapse-log.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${rows.length} drinks`, false);
}

/* ---------- settings drawer ---------- */
function openSettings() {
  const s = state.settings;
  $('setBed').value = s.bedtime;
  $('setHl').value = s.halfLife;
  $('hlOut').textContent = s.halfLife.toFixed(1) + ' h';
  $('setThr').value = s.threshold;
  $('setLim').value = s.limit;
  $('settings').hidden = false;
  $('scrim').hidden = false;
  $('settingsBtn').setAttribute('aria-expanded', 'true');
  $('setBed').focus();
}
function closeSettings() {
  if ($('settings').hidden) return;
  $('settings').hidden = true;
  $('scrim').hidden = true;
  $('settingsBtn').setAttribute('aria-expanded', 'false');
  $('settingsBtn').focus();
}
function applySettings() {
  const next = sanitizeSettings({
    bedtime: $('setBed').value || state.settings.bedtime,
    halfLife: $('setHl').value,
    threshold: $('setThr').value,
    limit: $('setLim').value
  });
  $('hlOut').textContent = next.halfLife.toFixed(1) + ' h';
  setState({settings: next});
}

/* ---------- wiring ---------- */
function bind() {
  const chips = $('chips');
  chips.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { setState({customs: state.customs.filter((c) => c.id !== rm.dataset.rm)}); return; }
    const chip = e.target.closest('.chip');
    if (chip) addDrink(chip.dataset.id);
  });
  chips.addEventListener('pointerover', (e) => {
    const chip = e.target.closest('.chip');
    if (chip && e.pointerType === 'mouse') showGhost(chip.dataset.id);
  });
  chips.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return;
    const to = e.relatedTarget;
    if (!(to instanceof Element) || !to.closest('.chip')) hideGhost();
  });
  chips.addEventListener('focusin', (e) => { const c = e.target.closest('.chip'); if (c) showGhost(c.dataset.id); });
  chips.addEventListener('focusout', hideGhost);

  $('whenNow').addEventListener('click', () => { $('whenInput').value = ''; $('whenInput').focus(); });
  $('customForm').addEventListener('submit', saveCustom);
  $('lastCallPick').addEventListener('change', (e) => setState({pick: e.target.value}));

  $('log').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) deleteDrink(b.dataset.del); });
  $('log').addEventListener('change', (e) => { if (e.target.dataset.time) retime(e.target.dataset.time, e.target.value); });

  $('week').addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    view = b.dataset.day === dayKey(Date.now()) ? null : b.dataset.day;
    scrubT = null;
    render();
  });
  $('backToday').addEventListener('click', () => { view = null; scrubT = null; render(); });

  const chart = $('chart');
  chart.addEventListener('pointerdown', scrubFromPointer);
  chart.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) scrubFromPointer(e); });
  chart.addEventListener('pointerleave', () => { if (document.activeElement !== chart) { scrubT = null; drawCursor(); } });
  chart.addEventListener('focus', () => {
    if (scrubT === null && geo) scrubT = isToday() ? Math.round(Date.now() / STEP) * STEP : geo.start + 12 * HOUR;
    drawCursor();
  });
  chart.addEventListener('blur', () => { scrubT = null; drawCursor(); });
  chart.addEventListener('keydown', (e) => {
    if (!geo) return;
    const moves = {ArrowLeft: -1, ArrowRight: 1};
    if (e.key in moves) scrubT = clamp((scrubT ?? geo.start) + moves[e.key] * (e.shiftKey ? HOUR : STEP), geo.start, geo.end);
    else if (e.key === 'Home') scrubT = geo.start;
    else if (e.key === 'End') scrubT = geo.end;
    else return;
    e.preventDefault();
    drawCursor();
  });

  $('settingsBtn').addEventListener('click', openSettings);
  $('closeSettings').addEventListener('click', closeSettings);
  $('scrim').addEventListener('click', closeSettings);
  $('setHl').addEventListener('input', applySettings);
  ['setBed', 'setThr', 'setLim'].forEach((id) => $(id).addEventListener('change', applySettings));
  $('sampleBtn').addEventListener('click', () => {
    if (!confirm('Replace your log with a sample week?')) return;
    view = null;
    setState({drinks: sampleDrinks(Date.now())});
    toast('Sample week loaded', false);
  });
  $('resetBtn').addEventListener('click', () => {
    if (!confirm('Delete every drink, custom drink and setting?')) return;
    view = null;
    setState({settings: {...DEFAULT_SETTINGS}, drinks: [], customs: [], pick: 'espresso'});
    openSettings();
    toast('All data cleared', false);
  });
  $('exportBtn').addEventListener('click', exportCsv);
  $('undoBtn').addEventListener('click', () => {
    if (!undoSnap) return;
    setState({drinks: undoSnap});
    undoSnap = null;
    $('toast').hidden = true;
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

  let raf = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(renderChart); });
  setInterval(() => { if (isToday() || view === dayKey(Date.now())) render(); }, MIN);
}

bind();
render();
save();
