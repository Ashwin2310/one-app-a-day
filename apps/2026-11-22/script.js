'use strict';

/* ===================== constants ===================== */
const STORE_KEY = 'dueweave.v1';
const MIN = 60000;
const HOUR = 60 * MIN;
const HORIZON_DAYS = 21;
const TIMELINE_DAYS = 5;
const DEFAULT_MINUTES = 30;
const MAX_TITLE = 120;
const REPAIR_LIMIT = 60;
const HOUR_PX = 44;
const TIGHT_MIN = 60;
const IMPORTANCE = { 1: 'Low', 2: 'Normal', 3: 'High' };
const IMPORTANCE_W = { 1: 0.6, 2: 1, 3: 1.6 };
const TAG_COLORS = ['#5BE3B0', '#7CC4FF', '#FFB547', '#F78FD0', '#A497FF', '#9BE26B'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_WORDS = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6
};
const EXAMPLES = [
  'Reply to landlord 15m #home',
  'Quarterly report 3h !high by fri #work',
  'Read chapter 4 1h by tomorrow 9pm #study'
];

/* ===================== small helpers ===================== */
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function atHour(date, hour, minute = 0) {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function startOfDay(date) { return atHour(date, 0); }
function sameDay(a, b) { return startOfDay(a).getTime() === startOfDay(b).getTime(); }
function roundUp(date, stepMin) {
  const step = stepMin * MIN;
  return new Date(Math.ceil(date.getTime() / step) * step);
}
function fmtDur(min) {
  const m = Math.round(Math.abs(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h}h ${r}m`;
  return h ? `${h}h` : `${r}m`;
}
function fmtSpan(min) {
  const m = Math.abs(min);
  if (m < 24 * 60) return fmtDur(m);
  const d = Math.floor(m / (24 * 60));
  const h = Math.floor((m - d * 24 * 60) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
}
function fmtTime(d) { return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; }
function fmtDay(d, now) {
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, addDays(now, 1))) return 'Tomorrow';
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`;
}
function fmtWhen(d, now) { return `${fmtDay(d, now)} ${fmtTime(d)}`; }
function tagColor(tag) {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

/* ===================== state & storage ===================== */
const DEFAULT_SETTINGS = Object.freeze({ dayStart: 9, dayEnd: 17, weekends: false });
let state = null;
const ui = { openWhy: new Set(), fresh: null, editing: null, toastTimer: null };

function workDays(now, settings, count) {
  const days = [];
  for (let d = 0; days.length < count && d < 60; d += 1) {
    const day = addDays(startOfDay(now), d);
    const dow = day.getDay();
    if (!settings.weekends && (dow === 0 || dow === 6)) continue;
    if (atHour(day, settings.dayEnd) <= now) continue;
    days.push(day);
  }
  return days;
}

function sampleTasks(now) {
  const days = workDays(now, DEFAULT_SETTINGS, 8);
  const at = (k, h) => atHour(days[k], h).toISOString();
  const ago = (n) => addDays(now, -n).toISOString();
  const rows = [
    ['Invoice export for Acme', 300, 3, at(1, 12), 'client', 1],
    ["Review Sam's pull request", 30, 2, null, 'work', 2],
    ['Prep client demo slides', 120, 3, at(2, 10), 'client', 1],
    ['Fix flaky login test', 90, 2, at(1, 17), 'work', 3],
    ['Draft Q4 roadmap', 240, 2, at(3, 17), 'work', 4],
    ['Renew car insurance', 30, 3, at(4, 12), 'home', 6],
    ['Plan team offsite agenda', 60, 2, at(4, 15), 'work', 2],
    ['Book dentist appointment', 15, 1, null, 'home', 9],
    ['Write blog post on caching', 180, 1, at(6, 17), 'writing', 5],
    ['Inbox zero and replies', 45, 1, null, 'admin', 1]
  ];
  return rows.map(([title, minutes, importance, due, tag, age]) => ({
    id: uid(), title, minutes, importance, due, tag, done: false, doneAt: null, createdAt: ago(age)
  }));
}

function sanitizeTask(t) {
  if (!t || typeof t !== 'object' || typeof t.title !== 'string') return null;
  const due = t.due && !Number.isNaN(Date.parse(t.due)) ? new Date(t.due).toISOString() : null;
  return {
    id: typeof t.id === 'string' ? t.id : uid(),
    title: t.title.slice(0, MAX_TITLE) || 'Untitled task',
    minutes: clamp(Math.round(Number(t.minutes) || DEFAULT_MINUTES), 5, 1440),
    importance: [1, 2, 3].includes(t.importance) ? t.importance : 2,
    due,
    tag: typeof t.tag === 'string' && t.tag ? t.tag.slice(0, 24).toLowerCase() : null,
    done: Boolean(t.done),
    doneAt: t.doneAt && !Number.isNaN(Date.parse(t.doneAt)) ? t.doneAt : null,
    createdAt: t.createdAt && !Number.isNaN(Date.parse(t.createdAt)) ? t.createdAt : new Date().toISOString()
  };
}

function sanitizeSettings(s) {
  const dayStart = clamp(Math.round(Number(s && s.dayStart)), 0, 23);
  const dayEnd = clamp(Math.round(Number(s && s.dayEnd)), 1, 24);
  if (Number.isNaN(dayStart) || Number.isNaN(dayEnd) || dayEnd <= dayStart) return { ...DEFAULT_SETTINGS };
  return { dayStart, dayEnd, weekends: Boolean(s.weekends) };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.tasks)) {
        return {
          tasks: data.tasks.map(sanitizeTask).filter(Boolean),
          settings: sanitizeSettings(data.settings),
          filter: typeof data.filter === 'string' ? data.filter : 'all'
        };
      }
    }
  } catch (err) {
    console.warn('Dueweave: saved data unreadable, loading samples.', err);
  }
  return { tasks: sampleTasks(new Date()), settings: { ...DEFAULT_SETTINGS }, filter: 'all' };
}

function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (err) {
    showToast('Could not save: browser storage is full or blocked.');
  }
}

function setState(patch) {
  state = { ...state, ...patch };
  saveState();
  render();
}
function updateTask(id, patch) {
  setState({ tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
}

/* ===================== quick-add parser ===================== */
function parseDuration(w, next) {
  let m = w.match(/^(\d+)h(\d+)m?$/);
  if (m) return { minutes: Number(m[1]) * 60 + Number(m[2]), used: 1 };
  m = w.match(/^(\d+(?:\.\d+)?)(h|hr|hrs|hour|hours)$/);
  if (m) return { minutes: Math.round(Number(m[1]) * 60), used: 1 };
  m = w.match(/^(\d+)(m|min|mins|minute|minutes)$/);
  if (m) return { minutes: Number(m[1]), used: 1 };
  if (/^\d+(?:\.\d+)?$/.test(w) && next) {
    if (/^(h|hr|hrs|hour|hours)$/.test(next)) return { minutes: Math.round(Number(w) * 60), used: 2 };
    if (/^(m|min|mins|minute|minutes)$/.test(next)) return { minutes: Math.round(Number(w)), used: 2 };
  }
  return null;
}

function parseClock(w) {
  if (w === 'noon') return { h: 12, m: 0 };
  if (w === 'midnight') return { h: 23, m: 59 };
  let m = w.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3] === 'pm') h += 12;
    const min = Number(m[2] || 0);
    return h < 24 && min < 60 ? { h, m: min } : null;
  }
  m = w.match(/^(\d{1,2}):(\d{2})$/);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return { h: Number(m[1]), m: Number(m[2]) };
  return null;
}

function monthIndex(w) {
  const i = MONTHS.indexOf(w.slice(0, 3));
  return w.length >= 3 && i >= 0 && MONTHS[i] === w.slice(0, 3) ? i : -1;
}

function parseDate(words, i, now) {
  const w = words[i];
  const next = words[i + 1] || '';
  const today = startOfDay(now);
  if (w === 'today' || w === 'tonight' || w === 'eod') return { date: today, used: 1, eod: w === 'eod' };
  if (['tomorrow', 'tmrw', 'tmr', 'tom'].includes(w)) return { date: addDays(today, 1), used: 1 };
  if (w in WEEKDAY_WORDS) {
    const diff = (WEEKDAY_WORDS[w] - today.getDay() + 7) % 7;
    return { date: addDays(today, diff), used: 1 };
  }
  if (w === 'next' && next in WEEKDAY_WORDS) {
    const diff = (WEEKDAY_WORDS[next] - today.getDay() + 7) % 7 || 7;
    return { date: addDays(today, diff), used: 2 };
  }
  if (w === 'in') {
    const m = next.match(/^(\d+)(d|w)$/);
    if (m) return { date: addDays(today, Number(m[1]) * (m[2] === 'w' ? 7 : 1)), used: 2 };
    const unit = words[i + 2] || '';
    if (/^\d+$/.test(next) && /^(day|days|week|weeks)$/.test(unit)) {
      return { date: addDays(today, Number(next) * (unit.startsWith('w') ? 7 : 1)), used: 3 };
    }
  }
  const mi = monthIndex(w);
  if (mi >= 0 && /^\d{1,2}(st|nd|rd|th)?$/.test(next)) return monthDay(mi, parseInt(next, 10), today, 2);
  const mj = monthIndex(next);
  if (mj >= 0 && /^\d{1,2}(st|nd|rd|th)?$/.test(w)) return monthDay(mj, parseInt(w, 10), today, 2);
  return null;
}

function monthDay(month, day, today, used) {
  if (day < 1 || day > 31) return null;
  let d = new Date(today.getFullYear(), month, day);
  if (d < today) d = new Date(today.getFullYear() + 1, month, day);
  return { date: d, used };
}

function parseQuickAdd(text, now, settings) {
  const raw = text.trim().split(/\s+/).filter(Boolean);
  const words = raw.map((w) => w.toLowerCase().replace(/[,;]$/, ''));
  const out = { title: '', minutes: null, importance: 2, due: null, tag: null, hasTime: false };
  const titleParts = [];
  let date = null;
  let clock = null;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    const tag = w.match(/^#([\p{L}\p{N}_-]{1,24})$/u);
    if (tag) { out.tag = tag[1]; continue; }
    if (/^!+$/.test(w) || ['!high', '!h', '!urgent', '!important'].includes(w)) { out.importance = 3; continue; }
    if (['!low', '!l', '!later'].includes(w)) { out.importance = 1; continue; }
    if (['!normal', '!n', '!med'].includes(w)) { out.importance = 2; continue; }
    const dur = out.minutes === null ? parseDuration(w, words[i + 1]) : null;
    if (dur) { out.minutes = dur.minutes; i += dur.used - 1; continue; }
    if (['by', 'due', 'on', 'at', 'before'].includes(w) && i + 1 < words.length &&
        (parseDate(words, i + 1, now) || parseClock(words[i + 1]))) continue;
    const dt = !date ? parseDate(words, i, now) : null;
    if (dt) { date = dt; i += dt.used - 1; continue; }
    const ck = !clock ? parseClock(w) : null;
    if (ck) { clock = ck; continue; }
    titleParts.push(raw[i]);
  }
  out.title = titleParts.join(' ').replace(/^[\s\-–:]+|[\s\-–:,]+$/g, '').slice(0, MAX_TITLE);
  if (date || clock) {
    out.hasTime = Boolean(clock);
    const base = date ? date.date : startOfDay(now);
    let due = clock ? atHour(base, clock.h, clock.m) : atHour(base, settings.dayEnd);
    if (!date && due <= now) due = addDays(due, 1);
    out.due = due;
  }
  return out;
}

/* ===================== planner ===================== */
function buildSlots(now, settings, days) {
  const slots = [];
  const from = roundUp(now, 5);
  for (let d = 0; d < days; d += 1) {
    const day = addDays(startOfDay(now), d);
    const dow = day.getDay();
    if (!settings.weekends && (dow === 0 || dow === 6)) continue;
    const end = atHour(day, settings.dayEnd);
    const start = new Date(Math.max(atHour(day, settings.dayStart).getTime(), from.getTime()));
    if (end > start) slots.push({ start, end });
  }
  return slots;
}

function freeMinutesBetween(slots, a, b) {
  return slots.reduce((sum, s) => {
    const overlap = Math.min(s.end.getTime(), b.getTime()) - Math.max(s.start.getTime(), a.getTime());
    return sum + Math.max(0, overlap) / MIN;
  }, 0);
}

function computeSlack(tasks, slots, now) {
  const dated = tasks.filter((t) => t.due).sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
  const slack = new Map();
  let cumulative = 0;
  dated.forEach((t) => {
    cumulative += t.minutes;
    slack.set(t.id, freeMinutesBetween(slots, now, new Date(t.due)) - cumulative);
  });
  return slack;
}

function scoreTask(task, slack, now) {
  const reasons = [];
  const weight = IMPORTANCE_W[task.importance];
  if (task.importance === 3) reasons.push({ text: 'High importance', tone: 'up' });
  if (task.importance === 1) reasons.push({ text: 'Low importance', tone: 'down' });
  let urgency = 0.1;
  if (task.due) {
    const hrs = slack / 60;
    urgency = hrs < 0 ? 2.6 + Math.min(1, -hrs / 8) * 0.4 : 2.4 / (1 + hrs / 3);
    const left = (Date.parse(task.due) - now.getTime()) / MIN;
    reasons.push({ text: left < 0 ? `Overdue by ${fmtSpan(left)}` : `Due in ${fmtSpan(left)}`, tone: left < 0 ? 'bad' : 'info' });
    reasons.push({
      text: hrs < 0 ? `Slack ${fmtDur(slack)} short: not enough free hours` : `Slack ${fmtDur(slack)} of free time to spare`,
      tone: hrs < 0 ? 'bad' : hrs < 2 ? 'warn' : 'info'
    });
  } else {
    reasons.push({ text: 'No deadline', tone: 'down' });
  }
  const days = Math.max(0, (now.getTime() - Date.parse(task.createdAt)) / (24 * HOUR));
  const age = Math.min(0.4, days * 0.04);
  if (days >= 3) reasons.push({ text: `Waiting ${Math.floor(days)} days`, tone: 'up' });
  const quick = task.minutes <= 30 ? 1.25 : task.minutes <= 60 ? 1.1 : 1;
  if (quick > 1) reasons.push({ text: `Quick win (${fmtDur(task.minutes)})`, tone: 'up' });
  return { score: weight * (0.4 + urgency + age) * quick, reasons };
}

function placeTasks(order, slots) {
  const chunks = [];
  const finish = new Map();
  let idx = 0;
  let cursor = slots.length ? slots[0].start.getTime() : 0;
  order.forEach((task) => {
    let rem = task.minutes;
    while (rem > 0 && idx < slots.length) {
      const avail = (slots[idx].end.getTime() - cursor) / MIN;
      if (avail <= 0) {
        idx += 1;
        cursor = idx < slots.length ? slots[idx].start.getTime() : cursor;
        continue;
      }
      const take = Math.min(rem, avail);
      chunks.push({ id: task.id, start: new Date(cursor), end: new Date(cursor + take * MIN) });
      cursor += take * MIN;
      rem -= take;
    }
    finish.set(task.id, rem > 0 ? null : new Date(cursor));
  });
  return { chunks, finish };
}

function isLate(task, finish) {
  if (!task.due) return false;
  const f = finish.get(task.id);
  return !f || f.getTime() > Date.parse(task.due);
}

function repairOrder(order, slots, slack) {
  let current = order;
  const moved = new Set();
  for (let iter = 0; iter < REPAIR_LIMIT; iter += 1) {
    const { finish } = placeTasks(current, slots);
    const late = current
      .filter((t) => isLate(t, finish) && slack.get(t.id) >= 0)
      .sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
    let changed = false;
    for (const task of late) {
      const pos = current.indexOf(task);
      const target = current.findIndex((o, k) => k < pos && (!o.due || Date.parse(o.due) > Date.parse(task.due)));
      if (target >= 0) {
        const without = current.filter((o) => o !== task);
        current = [...without.slice(0, target), task, ...without.slice(target)];
        moved.add(task.id);
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return { order: current, moved };
}

function riskOf(task, finish, slack) {
  const f = finish.get(task.id);
  if (!task.due) return f ? { level: 'free', label: 'No deadline' } : { level: 'late', label: 'Not scheduled in 3 weeks' };
  if (!f) return { level: 'late', label: 'Not scheduled in 3 weeks' };
  const margin = (Date.parse(task.due) - f.getTime()) / MIN;
  if (margin < 0) return { level: 'late', label: `Late by ${fmtDur(margin)}` };
  if (margin < TIGHT_MIN || slack.get(task.id) < TIGHT_MIN) return { level: 'tight', label: `Tight: ${fmtDur(margin)} spare` };
  return { level: 'ok', label: 'On track' };
}

function planWeek(tasks, settings, now) {
  const open = tasks.filter((t) => !t.done);
  const slots = buildSlots(now, settings, HORIZON_DAYS);
  const slack = computeSlack(open, slots, now);
  const scored = new Map(open.map((t) => [t.id, scoreTask(t, slack.get(t.id), now)]));
  const byScore = [...open].sort((a, b) => scored.get(b.id).score - scored.get(a.id).score);
  const { order, moved } = repairOrder(byScore, slots, slack);
  const { chunks, finish } = placeTasks(order, slots);
  const maxScore = Math.max(1e-6, ...[...scored.values()].map((s) => s.score));
  const ranked = order.map((t) => ({
    task: t,
    score: scored.get(t.id).score,
    pct: Math.round((scored.get(t.id).score / maxScore) * 100),
    reasons: moved.has(t.id)
      ? [{ text: 'Pulled forward so it meets its deadline', tone: 'up' }, ...scored.get(t.id).reasons]
      : scored.get(t.id).reasons,
    risk: riskOf(t, finish, slack),
    finish: finish.get(t.id),
    slack: slack.get(t.id)
  }));
  return { ranked, chunks, slots };
}

/* ===================== rendering ===================== */
let plan = null;

function tagHtml(tag) {
  return tag ? `<span class="tag" style="--c:${tagColor(tag)}">#${esc(tag)}</span>` : '';
}
function badgeHtml(risk) {
  return `<span class="badge ${risk.level}">${esc(risk.label)}</span>`;
}

function renderStats(now) {
  const open = state.tasks.filter((t) => !t.done);
  const planned = plan.chunks.reduce((s, c) => s + (c.end - c.start) / MIN, 0);
  const late = plan.ranked.filter((r) => r.risk.level === 'late').length;
  const tight = plan.ranked.filter((r) => r.risk.level === 'tight').length;
  $('stats').innerHTML = `${open.length} task${open.length === 1 ? '' : 's'} · ${fmtDur(planned)} planned` +
    (late ? ` · <b class="t-late">${late} late</b>` : '') + (tight ? ` · <b class="t-tight">${tight} tight</b>` : '');
  $('hoursBtn').textContent = `Hours ${state.settings.dayStart}–${state.settings.dayEnd}${state.settings.weekends ? ' · 7d' : ''}`;
  return now;
}

function renderUpNext(now) {
  const el = $('upnext');
  const first = plan.chunks[0];
  if (!first) {
    el.className = 'upnext empty';
    el.innerHTML = '<p class="eyebrow">Up next</p><p class="up-title">Nothing planned. Add a task below and Dueweave will fit it into your hours.</p>';
    return;
  }
  const r = plan.ranked.find((x) => x.task.id === first.id);
  const isNow = first.start <= now;
  el.className = `upnext risk-${r.risk.level}`;
  const why = r.reasons.slice(0, 3).map((x) => esc(x.text)).join(' · ');
  el.innerHTML = `
    <div class="up-main">
      <p class="eyebrow">${isNow ? 'Right now' : 'Up next'}</p>
      <p class="up-title">${esc(r.task.title)}</p>
      <p class="up-meta"><span class="mono">${fmtDay(first.start, now)} ${fmtTime(first.start)}–${fmtTime(first.end)}</span>
        ${badgeHtml(r.risk)} ${tagHtml(r.task.tag)}</p>
      <p class="up-why">Why first: ${why}</p>
    </div>
    <div class="up-actions">
      <button type="button" class="btn primary" data-act="done" data-id="${r.task.id}">Mark done</button>
      <button type="button" class="btn" data-act="edit" data-id="${r.task.id}">Edit</button>
    </div>`;
}

function renderBanner() {
  const el = $('banner');
  const short = plan.ranked.filter((r) => r.task.due && r.slack < 0);
  const late = plan.ranked.filter((r) => r.risk.level === 'late');
  if (!plan.ranked.length) { el.className = 'banner'; el.textContent = ''; return; }
  if (short.length) {
    const worst = short.reduce((a, b) => (a.slack < b.slack ? a : b));
    el.className = 'banner show bad';
    el.textContent = `Overbooked: "${worst.task.title}" needs ${fmtDur(worst.slack)} more than your free hours before its deadline. Trim scope, move the deadline or add hours.`;
  } else if (late.length) {
    el.className = 'banner show warn';
    el.textContent = `${late.length} task${late.length === 1 ? '' : 's'} can't be fitted in the next three weeks of working hours.`;
  } else if (plan.ranked.some((r) => r.task.due)) {
    el.className = 'banner show good';
    el.textContent = 'All deadlines on track. Every dated task finishes before it is due.';
  } else {
    el.className = 'banner';
    el.textContent = '';
  }
}

function renderFilters() {
  const tags = [...new Set(state.tasks.filter((t) => !t.done && t.tag).map((t) => t.tag))].sort();
  const filter = tags.includes(state.filter) ? state.filter : 'all';
  const btn = (val, label, color) => `<button type="button" class="filter${filter === val ? ' on' : ''}" data-filter="${esc(val)}"
    aria-pressed="${filter === val}"${color ? ` style="--c:${color}"` : ''}>${esc(label)}</button>`;
  $('filters').innerHTML = btn('all', 'All') + tags.map((t) => btn(t, `#${t}`, tagColor(t))).join('');
  return filter;
}

function taskRow(r, i, now) {
  const t = r.task;
  const due = t.due ? `<span>Due ${esc(fmtWhen(new Date(t.due), now))}</span>` : '';
  const ends = r.finish ? `<span class="muted">done by ${esc(fmtWhen(r.finish, now))}</span>` : '';
  const reasons = r.reasons.map((x) => `<li class="r-${x.tone}">${esc(x.text)}</li>`).join('');
  return `<li class="task risk-${r.risk.level}${ui.fresh === t.id ? ' fresh' : ''}" data-id="${t.id}">
    <span class="rank mono" aria-hidden="true">${i + 1}</span>
    <input type="checkbox" class="tick" data-act="done" data-id="${t.id}" aria-label="Mark ${esc(t.title)} done">
    <div class="t-body">
      <button type="button" class="t-title" data-act="edit" data-id="${t.id}">${esc(t.title)}</button>
      <div class="meta"><span class="mono">${fmtDur(t.minutes)}</span>${due}${tagHtml(t.tag)}${badgeHtml(r.risk)}${ends}</div>
      <div class="scorebar" role="img" aria-label="Priority score ${r.pct} of 100"><i style="width:${r.pct}%"></i></div>
      <details class="why" data-id="${t.id}"${ui.openWhy.has(t.id) ? ' open' : ''}>
        <summary>Why this rank?</summary>
        <ul>${reasons}<li class="r-info">Score ${r.score.toFixed(2)} (${r.pct} relative to the top task)</li></ul>
      </details>
    </div>
  </li>`;
}

function renderList(now, filter) {
  const rows = plan.ranked.map((r, i) => ({ r, i })).filter(({ r }) => filter === 'all' || r.task.tag === filter);
  if (!plan.ranked.length) {
    $('tasks').innerHTML = `<li class="empty-state"><p>No open tasks. Try one of these:</p>
      ${EXAMPLES.map((e) => `<button type="button" class="example" data-example="${esc(e)}">${esc(e)}</button>`).join('')}</li>`;
  } else {
    $('tasks').innerHTML = rows.map(({ r, i }) => taskRow(r, i, now)).join('') ||
      '<li class="empty-state"><p>No open tasks with this tag.</p></li>';
  }
  const done = state.tasks.filter((t) => t.done).sort((a, b) => Date.parse(b.doneAt || 0) - Date.parse(a.doneAt || 0));
  $('doneBox').hidden = !done.length;
  $('doneSummary').textContent = `Done (${done.length})`;
  $('doneList').innerHTML = done.slice(0, 30).map((t) => `<li><span class="struck">${esc(t.title)}</span>
    <button type="button" class="link" data-act="restore" data-id="${t.id}">Restore</button></li>`).join('');
}

function timelineDays(now) {
  return workDays(now, state.settings, TIMELINE_DAYS);
}

function renderTimeline(now, filter) {
  const { dayStart, dayEnd } = state.settings;
  const span = dayEnd - dayStart;
  const byId = new Map(plan.ranked.map((r) => [r.task.id, r]));
  const hours = Array.from({ length: span + 1 }, (_, k) => dayStart + k);
  const axis = `<div class="axis" aria-hidden="true"><div class="col-head"></div><div class="col-body" style="--h:${span * HOUR_PX}px">
    ${hours.map((h) => `<span style="--top:${(h - dayStart) * HOUR_PX}px">${h}:00</span>`).join('')}</div></div>`;
  const cols = timelineDays(now).map((day) => {
    const s = atHour(day, dayStart);
    const e = atHour(day, dayEnd);
    const chunks = plan.chunks.filter((c) => c.start >= s && c.end <= e);
    const used = chunks.reduce((sum, c) => sum + (c.end - c.start) / MIN, 0);
    const load = Math.round((used / (span * 60)) * 100);
    const past = sameDay(day, now) && now > s ? Math.min(span, (now - s) / HOUR) : 0;
    const blocks = chunks.map((c) => {
      const r = byId.get(c.id);
      const dim = filter !== 'all' && r.task.tag !== filter ? ' dim' : '';
      const top = ((c.start - s) / HOUR) * HOUR_PX;
      const h = ((c.end - c.start) / HOUR) * HOUR_PX;
      const color = r.task.tag ? tagColor(r.task.tag) : '#93A59F';
      return `<button type="button" class="block risk-${r.risk.level}${h < 30 ? ' small' : h < 52 ? ' mid' : ''}${dim}" data-act="edit" data-id="${c.id}"
        style="--top:${top}px;--bh:${h}px;--c:${color}" title="${esc(r.task.title)}">
        <span class="b-time mono">${fmtTime(c.start)}–${fmtTime(c.end)}</span><span class="b-title">${esc(r.task.title)}</span></button>`;
    }).join('');
    const nowLine = past > 0 && past < span ? `<i class="now-line" style="--top:${past * HOUR_PX}px" aria-hidden="true"></i>` : '';
    return `<div class="day" role="group" aria-label="${esc(fmtDay(day, now))}, ${load}% booked">
      <div class="col-head"><b>${esc(fmtDay(day, now))}</b><span class="load"><i style="width:${Math.min(100, load)}%"></i></span><small>${load}% booked</small></div>
      <div class="col-body" style="--h:${span * HOUR_PX}px">
        ${past ? `<i class="past" style="--bh:${past * HOUR_PX}px" aria-hidden="true"></i>` : ''}${nowLine}
        ${blocks || '<span class="free-slot">Free</span>'}
      </div></div>`;
  }).join('');
  $('timeline').innerHTML = axis + cols;
}

function render() {
  const now = new Date();
  plan = planWeek(state.tasks, state.settings, now);
  renderStats(now);
  renderUpNext(now);
  renderBanner();
  const filter = renderFilters();
  renderList(now, filter);
  renderTimeline(now, filter);
  ui.fresh = null;
}

/* ===================== quick add ===================== */
function renderChips() {
  const text = $('quickInput').value;
  const el = $('chips');
  if (!text.trim()) {
    el.innerHTML = '<span class="hint">Durations <b>90m</b> <b>2h</b> · deadlines <b>by fri 3pm</b> <b>tomorrow</b> <b>in 3d</b> <b>dec 5</b> · <b>!high</b> <b>!low</b> · <b>#tag</b></span>';
    return;
  }
  const now = new Date();
  const p = parseQuickAdd(text, now, state.settings);
  const chips = [
    `<span class="chip title">${esc(p.title || 'Untitled task')}</span>`,
    p.minutes ? `<span class="chip">${fmtDur(p.minutes)}</span>` : `<span class="chip soft">${fmtDur(DEFAULT_MINUTES)} (default)</span>`,
    p.due ? `<span class="chip">due ${esc(fmtWhen(p.due, now))}</span>` : '<span class="chip soft">no deadline</span>',
    `<span class="chip imp-${p.importance}">${IMPORTANCE[p.importance].toLowerCase()} importance</span>`,
    p.tag ? `<span class="chip" style="--c:${tagColor(p.tag)}">#${esc(p.tag)}</span>` : ''
  ];
  el.innerHTML = chips.join('');
}

function addFromText(text) {
  if (!text.trim()) return false;
  const now = new Date();
  const p = parseQuickAdd(text, now, state.settings);
  const task = sanitizeTask({
    id: uid(), title: p.title || 'Untitled task', minutes: p.minutes || DEFAULT_MINUTES, importance: p.importance,
    due: p.due ? p.due.toISOString() : null, tag: p.tag, done: false, doneAt: null, createdAt: now.toISOString()
  });
  ui.fresh = task.id;
  setState({ tasks: [...state.tasks, task] });
  const rank = plan.ranked.findIndex((r) => r.task.id === task.id) + 1;
  showToast(`Added "${task.title}" at rank ${rank}.`);
  return true;
}

function onQuickSubmit(e) {
  e.preventDefault();
  const input = $('quickInput');
  if (!addFromText(input.value)) {
    input.classList.remove('shake');
    void input.offsetWidth;
    input.classList.add('shake');
    $('chips').innerHTML = '<span class="hint warn">Type a task first, for example "Call bank 20m by 4pm".</span>';
    input.focus();
    return;
  }
  input.value = '';
  renderChips();
}

/* ===================== toast ===================== */
function showToast(msg, undo) {
  const el = $('toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" class="link" id="undoBtn">Undo</button>' : ''}`;
  el.classList.add('show');
  clearTimeout(ui.toastTimer);
  ui.toastTimer = setTimeout(() => el.classList.remove('show'), undo ? 6000 : 3000);
  if (undo) {
    $('undoBtn').addEventListener('click', () => {
      undo();
      el.classList.remove('show');
    }, { once: true });
  }
}

/* ===================== actions ===================== */
function completeTask(id) {
  const before = state.tasks;
  const task = before.find((t) => t.id === id);
  if (!task) return;
  updateTask(id, { done: true, doneAt: new Date().toISOString() });
  showToast(`Marked "${task.title}" done.`, () => setState({ tasks: before }));
}

function deleteTask(id) {
  const before = state.tasks;
  const task = before.find((t) => t.id === id);
  if (!task) return;
  setState({ tasks: before.filter((t) => t.id !== id) });
  showToast(`Deleted "${task.title}".`, () => setState({ tasks: before }));
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openEdit(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  ui.editing = id;
  $('fTitle').value = task.title;
  $('fMinutes').value = task.minutes;
  $('fImportance').value = String(task.importance);
  $('fDue').value = toLocalInput(task.due);
  $('fTag').value = task.tag || '';
  $('editDialog').showModal();
  $('fTitle').focus();
}

function saveEdit(e) {
  e.preventDefault();
  const form = $('editForm');
  if (!form.reportValidity()) return;
  const due = $('fDue').value ? new Date($('fDue').value) : null;
  const patch = sanitizeTask({
    ...state.tasks.find((t) => t.id === ui.editing),
    title: $('fTitle').value.trim() || 'Untitled task',
    minutes: Number($('fMinutes').value),
    importance: Number($('fImportance').value),
    due: due && !Number.isNaN(due.getTime()) ? due.toISOString() : null,
    tag: $('fTag').value.trim().replace(/^#/, '').replace(/\s+/g, '-')
  });
  $('editDialog').close();
  if (patch) updateTask(ui.editing, patch);
}

function copyPlan() {
  const now = new Date();
  const byId = new Map(plan.ranked.map((r) => [r.task.id, r]));
  const lines = ['Dueweave plan'];
  timelineDays(now).forEach((day) => {
    const chunks = plan.chunks.filter((c) => sameDay(c.start, day));
    if (!chunks.length) return;
    lines.push('', fmtDay(day, now));
    chunks.forEach((c) => {
      const r = byId.get(c.id);
      const flag = r.risk.level === 'late' || r.risk.level === 'tight' ? `  [${r.risk.label}]` : '';
      lines.push(`  ${fmtTime(c.start)}-${fmtTime(c.end)}  ${r.task.title}${flag}`);
    });
  });
  const text = lines.join('\n');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'sr-only';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    showToast(ok ? 'Plan copied to clipboard.' : 'Copy failed: your browser blocked clipboard access.');
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => showToast('Plan copied to clipboard.'), fallback);
  } else {
    fallback();
  }
}

/* ===================== settings ===================== */
function fillHourSelects() {
  const opts = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => from + k)
    .map((h) => `<option value="${h}">${h}:00</option>`).join('');
  $('dayStart').innerHTML = opts(0, 23);
  $('dayEnd').innerHTML = opts(1, 24);
  $('dayStart').value = String(state.settings.dayStart);
  $('dayEnd').value = String(state.settings.dayEnd);
  $('weekends').checked = state.settings.weekends;
}

function onSettingsChange(e) {
  let dayStart = Number($('dayStart').value);
  let dayEnd = Number($('dayEnd').value);
  if (dayEnd <= dayStart) {
    if (e.target.id === 'dayStart') dayEnd = Math.min(24, dayStart + 1);
    else dayStart = Math.max(0, dayEnd - 1);
  }
  setState({ settings: { dayStart, dayEnd, weekends: $('weekends').checked } });
  fillHourSelects();
}

/* ===================== events ===================== */
function onClick(e) {
  const ex = e.target.closest('[data-example]');
  if (ex) { addFromText(ex.dataset.example); return; }
  const filter = e.target.closest('[data-filter]');
  if (filter) { setState({ filter: filter.dataset.filter }); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id } = el.dataset;
  if (act === 'done') completeTask(id);
  else if (act === 'edit') openEdit(id);
  else if (act === 'restore') updateTask(id, { done: false, doneAt: null });
}

function closePops(except) {
  document.querySelectorAll('details.pop[open]').forEach((d) => { if (d !== except) d.open = false; });
}

function bind() {
  document.addEventListener('click', onClick);
  document.addEventListener('click', (e) => closePops(e.target.closest('details.pop')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePops(null); });
  $('tasks').addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.matches || !d.matches('details.why')) return;
    if (d.open) ui.openWhy.add(d.dataset.id); else ui.openWhy.delete(d.dataset.id);
  }, true);
  $('quickForm').addEventListener('submit', onQuickSubmit);
  $('quickInput').addEventListener('input', renderChips);
  $('editForm').addEventListener('submit', saveEdit);
  $('cancelBtn').addEventListener('click', () => $('editDialog').close());
  $('deleteBtn').addEventListener('click', () => { $('editDialog').close(); deleteTask(ui.editing); });
  $('copyBtn').addEventListener('click', copyPlan);
  ['dayStart', 'dayEnd', 'weekends'].forEach((id) => $(id).addEventListener('change', onSettingsChange));
  $('sampleBtn').addEventListener('click', () => {
    closePops(null);
    const before = state.tasks;
    setState({ tasks: sampleTasks(new Date()), filter: 'all' });
    showToast('Sample tasks loaded.', () => setState({ tasks: before }));
  });
  $('clearBtn').addEventListener('click', () => {
    closePops(null);
    if (!state.tasks.length || !window.confirm('Delete every task? You can undo right after.')) return;
    const before = state.tasks;
    setState({ tasks: [], filter: 'all' });
    showToast('All tasks cleared.', () => setState({ tasks: before }));
  });
  setInterval(render, MIN);
}

function init() {
  state = loadState();
  fillHourSelects();
  bind();
  render();
  renderChips();
  saveState();
}

init();
