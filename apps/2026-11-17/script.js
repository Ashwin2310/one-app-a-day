'use strict';
(function () {
  const KEY = 'emberkeep.v1';
  const COLORS = ['#ff7a3d', '#ffc857', '#7bd88f', '#5ec2e8', '#b59cff', '#ff7eb6'];
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WEEKS = 20;
  const STAT_DAYS = 84;
  const GRACE_WINDOW = 7;
  const MIN_OPPS = 4;

  let state = null;
  let editingId = null;
  let color = COLORS[0];

  const $ = (id) => document.getElementById(id);
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    });
    kids.flat().forEach((k) => k != null && el.append(k));
    return el;
  }

  /* ---------- dates ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const key = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const parse = (s) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); };
  const weekday = (d) => (d.getDay() + 6) % 7;
  const now = () => startOfDay(new Date());
  const diffDays = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 864e5);

  /* ---------- state ---------- */
  function validState(s) {
    return s && Array.isArray(s.habits) && s.log && typeof s.log === 'object' &&
      s.habits.every((x) => x && typeof x.id === 'string' && typeof x.name === 'string' &&
        typeof x.color === 'string' && /^#[0-9a-f]{6}$/i.test(x.color) &&
        Number.isInteger(x.target) && x.target >= 1 && x.target <= 7 &&
        typeof x.created === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.created));
  }
  function sample() {
    let seed = 20261117;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const t0 = now();
    const created = key(addDays(t0, -119));
    const defs = [
      ['Read 20 pages', COLORS[0], 6, 0.9, [0, 0, 0, 0, 0, 0, -0.2]],
      ['Morning run', COLORS[2], 4, 0.65, [0.1, 0, 0.1, 0, 0, 0.2, -0.3]],
      ['Meditate 10 min', COLORS[3], 7, 0.78, [0, 0, 0, -0.1, 0, -0.2, -0.2]],
      ['Write one page', COLORS[4], 5, 0.6, [0.1, 0.1, 0, 0, -0.2, -0.3, 0]],
      ['Lights out by 11', COLORS[1], 5, 0.7, [0, 0, 0, 0, -0.35, -0.3, 0.1]]
    ];
    const habits = []; const log = {};
    defs.forEach(([name, c, target, p, bias], i) => {
      const id = 's' + i; habits.push({ id, name, color: c, target, created });
      log[id] = {};
      for (let d = 119; d >= 0; d--) {
        const day = addDays(t0, -d);
        if (d === 0 && i % 2 === 1) continue;
        const trend = 0.12 * (1 - d / 119);
        if (rnd() < p + bias[weekday(day)] + trend - 0.05) log[id][key(day)] = 1;
      }
    });
    return { habits, log, selected: 's0', sample: true };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); if (validState(s)) return s; }
    } catch (e) { /* fall through to sample data */ }
    return sample();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { notify('Could not save: browser storage is unavailable.'); }
  }
  function set(next) { state = next; save(); render(); }
  const isDone = (id, k) => Boolean(state.log[id] && state.log[id][k]);

  /* ---------- analytics ---------- */
  function streakOf(habit) {
    const t = now(); const start = parse(habit.created);
    const total = diffDays(t, start);
    let run = 0; let best = 0; let lastGrace = null; const graces = new Set();
    for (let i = 0; i <= total; i++) {
      const day = addDays(start, i); const k = key(day);
      if (isDone(habit.id, k)) { run++; best = Math.max(best, run); } else if (i !== total) {
        if (run > 0 && (lastGrace === null || i - lastGrace >= GRACE_WINDOW)) { graces.add(k); lastGrace = i; } else { run = 0; lastGrace = null; }
      }
    }
    return { current: run, best, graces };
  }
  function weekdayStats(habit) {
    const t = now(); const created = parse(habit.created);
    const opp = Array(7).fill(0); const done = Array(7).fill(0);
    for (let i = 0; i < STAT_DAYS; i++) {
      const day = addDays(t, -i); const k = key(day);
      if (day < created || (i === 0 && !isDone(habit.id, k))) continue;
      opp[weekday(day)]++; if (isDone(habit.id, k)) done[weekday(day)]++;
    }
    return opp.map((o, i) => ({ opp: o, rate: o ? done[i] / o : 0 }));
  }
  function rangeRate(habit, from, to) {
    const created = parse(habit.created); let opp = 0; let done = 0;
    for (let i = from; i < to; i++) {
      const day = addDays(now(), -i);
      if (day < created) continue;
      opp++; if (isDone(habit.id, key(day))) done++;
    }
    return opp ? done / opp : null;
  }
  function weekCount(habit) {
    const mon = addDays(now(), -weekday(now()));
    let n = 0; for (let i = 0; i < 7; i++) if (isDone(habit.id, key(addDays(mon, i)))) n++;
    return n;
  }
  function insights(habit, st) {
    const out = []; const ws = weekdayStats(habit);
    const ok = ws.map((w, i) => ({ i, ...w })).filter((w) => w.opp >= MIN_OPPS);
    if (ok.length >= 2) {
      const best = ok.reduce((a, b) => (b.rate > a.rate ? b : a));
      const worst = ok.reduce((a, b) => (b.rate < a.rate ? b : a));
      if (best.i !== worst.i) {
        out.push('Strongest day: ' + DAYS[best.i] + ' (' + Math.round(best.rate * 100) + '%).');
        out.push('Weakest day: ' + DAYS[worst.i] + ' (' + Math.round(worst.rate * 100) + '%). Plan around it.');
      }
    }
    const recent = rangeRate(habit, 0, 28); const before = rangeRate(habit, 28, 56);
    if (recent !== null && before !== null) {
      const d = Math.round((recent - before) * 100);
      out.push(d > 2 ? 'Up ' + d + ' points on the previous four weeks. Keep going.' :
        d < -2 ? 'Down ' + Math.abs(d) + ' points on the previous four weeks. Try a smaller version of the habit.' :
          'Steady compared with the previous four weeks.');
    }
    if (st.graces.size) out.push('Grace days saved your streak ' + st.graces.size + ' time' + (st.graces.size > 1 ? 's' : '') + '.');
    if (!out.length) out.push('Check in for a few more days and insights will appear here.');
    return out;
  }

  /* ---------- actions ---------- */
  function toggle(id, k) {
    const mine = { ...(state.log[id] || {}) };
    if (mine[k]) delete mine[k]; else mine[k] = 1;
    set({ ...state, log: { ...state.log, [id]: mine } });
  }
  function notify(msg) { $('notice').textContent = msg; }
  function removeHabit(id) {
    const habit = state.habits.find((x) => x.id === id);
    if (!habit || !window.confirm('Delete "' + habit.name + '" and its history?')) return;
    const log = { ...state.log }; delete log[id];
    const habits = state.habits.filter((x) => x.id !== id);
    set({ ...state, habits, log, selected: habits[0] ? habits[0].id : null });
  }

  /* ---------- render ---------- */
  function render() {
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focus : null;
    renderToday(); renderDetail();
    $('clearBtn').hidden = !state.sample;
    if (focused) { const el = document.querySelector('[data-focus="' + focused + '"]'); if (el) el.focus(); }
  }
  function renderToday() {
    const t = now(); const k = key(t); const n = state.habits.length;
    const done = state.habits.filter((x) => isDone(x.id, k)).length;
    $('ringNum').textContent = done + '/' + n;
    $('todayDate').textContent = t.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const C = 2 * Math.PI * 50;
    const ring = $('ring'); ring.replaceChildren();
    const ns = 'http://www.w3.org/2000/svg';
    const mk = (cls, off) => { const c = document.createElementNS(ns, 'circle'); c.setAttribute('class', cls); c.setAttribute('cx', 60); c.setAttribute('cy', 60); c.setAttribute('r', 50); c.setAttribute('transform', 'rotate(-90 60 60)'); if (off !== undefined) { c.setAttribute('stroke-dasharray', C); c.setAttribute('stroke-dashoffset', off); } return c; };
    ring.append(mk('bg'), mk('fg', n ? C * (1 - done / n) : C));
    ring.setAttribute('aria-label', done + ' of ' + n + ' habits done today');
    const list = $('todayList'); list.replaceChildren();
    state.habits.forEach((x) => {
      const on = isDone(x.id, k); const st = streakOf(x);
      list.append(h('li', { class: 't-item' + (x.id === state.selected ? ' sel' : ''), style: '--c:' + x.color },
        h('button', { class: 'check', type: 'button', 'aria-pressed': String(on), 'aria-label': 'Mark ' + x.name + ' done today', 'data-focus': 'c' + x.id, onclick: () => toggle(x.id, k), text: on ? '✓' : '' }),
        h('button', { class: 't-name', type: 'button', 'data-focus': 'n' + x.id, onclick: () => set({ ...state, selected: x.id }), text: x.name }),
        h('span', { class: 't-streak', text: st.current + ' day' + (st.current === 1 ? '' : 's') })));
    });
  }
  function renderDetail() {
    const box = $('detail'); box.replaceChildren();
    const x = state.habits.find((y) => y.id === state.selected) || state.habits[0];
    if (!x) { box.append(h('p', { class: 'empty', text: 'No habits yet. Press New habit to light your first ember.' })); return; }
    box.style.setProperty('--c', x.color);
    const st = streakOf(x); const wk = weekCount(x); const rate = rangeRate(x, 0, 28);
    box.append(
      h('div', { class: 'head' }, h('h2', { text: x.name }),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => openDialog(x), text: 'Edit' }),
          h('button', { class: 'btn danger', type: 'button', onclick: () => removeHabit(x.id), text: 'Delete' }))),
      h('div', { class: 'stats' },
        stat(st.current, 'current streak'), stat(st.best, 'best streak'),
        stat(rate === null ? '-' : Math.round(rate * 100) + '%', 'last 28 days'),
        h('div', { class: 'stat' }, h('b', { text: wk + '/' + x.target }), h('span', { text: 'this week' }),
          h('div', { class: 'meter' }, h('i', { style: 'width:' + Math.min(100, wk / x.target * 100) + '%' })))),
      h('h3', { text: 'Last 20 weeks' }), heatmap(x, st),
      h('p', { class: 'legend', text: 'Filled = done. Dashed = forgiven by a grace day. Click a day to change it.' }),
      h('h3', { text: 'Weekday strength' }), bars(x),
      h('h3', { text: 'Insights' }), h('ul', { class: 'insights' }, insights(x, st).map((s) => h('li', { text: s }))));
  }
  const stat = (v, l) => h('div', { class: 'stat' }, h('b', { text: String(v) }), h('span', { text: l }));
  function heatmap(x, st) {
    const t = now(); const start = addDays(t, -weekday(t) - (WEEKS - 1) * 7);
    const created = parse(x.created); const cells = [];
    for (let i = 0; i < WEEKS * 7; i++) {
      const day = addDays(start, i); const k = key(day);
      const future = day > t; const on = isDone(x.id, k);
      const cls = 'cell' + (future ? ' future' : '') + (on ? ' on' : '') + (!on && st.graces.has(k) ? ' grace' : '') + (k === key(t) ? ' today' : '');
      const label = day.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ': ' + (on ? 'done' : 'not done');
      cells.push(h('button', { class: cls, type: 'button', title: label, 'aria-label': label, 'aria-pressed': String(on), disabled: future || day < created, onclick: () => toggle(x.id, k) }));
    }
    return h('div', { class: 'heat-scroll' }, h('div', { class: 'heat' }, cells));
  }
  function bars(x) {
    const ws = weekdayStats(x); const max = Math.max(...ws.filter((w) => w.opp >= MIN_OPPS).map((w) => w.rate), 0);
    return h('div', { class: 'bars' }, ws.map((w, i) => h('div', { class: 'bar' + (w.opp >= MIN_OPPS && w.rate === max && max > 0 ? ' best' : ''), title: DAYS[i] + ': ' + Math.round(w.rate * 100) + '%' },
      h('i', { style: 'height:' + Math.round(w.rate * 100) + '%' }), h('span', { text: DAYS[i] }))));
  }

  /* ---------- dialog ---------- */
  function openDialog(habit) {
    editingId = habit ? habit.id : null;
    $('dlgTitle').textContent = habit ? 'Edit habit' : 'New habit';
    $('fName').value = habit ? habit.name : '';
    $('fTarget').value = habit ? habit.target : 5; $('fTargetOut').textContent = $('fTarget').value;
    color = habit ? habit.color : COLORS[state.habits.length % COLORS.length];
    $('formErr').textContent = ''; drawSwatches(); $('dlg').showModal(); $('fName').focus();
  }
  function drawSwatches() {
    const box = $('swatches'); box.replaceChildren(); box.setAttribute('role', 'radiogroup');
    COLORS.forEach((c) => box.append(h('button', { class: 'sw', type: 'button', role: 'radio', 'aria-checked': String(c === color), 'aria-label': 'Colour ' + c, style: '--c:' + c, onclick: () => { color = c; drawSwatches(); } })));
  }
  function submitForm(e) {
    e.preventDefault();
    const name = $('fName').value.trim();
    if (!name) { $('formErr').textContent = 'Give your habit a name.'; return; }
    if (state.habits.some((x) => x.id !== editingId && x.name.toLowerCase() === name.toLowerCase())) { $('formErr').textContent = 'You already have a habit with that name.'; return; }
    const target = Number($('fTarget').value);
    if (editingId) {
      set({ ...state, habits: state.habits.map((x) => (x.id === editingId ? { ...x, name, target, color } : x)) });
    } else {
      const id = 'h' + Date.now().toString(36);
      set({ ...state, habits: [...state.habits, { id, name, color, target, created: key(now()) }], log: { ...state.log, [id]: {} }, selected: id });
    }
    $('dlg').close(); notify(editingId ? 'Habit updated.' : 'Habit added. Check in today to start your streak.');
  }

  /* ---------- backup ---------- */
  function exportData() {
    const blob = new Blob([JSON.stringify({ ...state, sample: false }, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'emberkeep-' + key(now()) + '.json' });
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    notify('Backup downloaded.');
  }
  function importData(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const s = JSON.parse(String(r.result));
        if (!validState(s)) throw new Error('bad shape');
        set({ habits: s.habits, log: s.log, selected: s.habits[0] ? s.habits[0].id : null, sample: false });
        notify('Backup imported.');
      } catch (err) { notify('That file is not a valid Emberkeep backup. Nothing changed.'); }
    };
    r.onerror = () => notify('Could not read that file.');
    r.readAsText(file);
  }

  /* ---------- wiring ---------- */
  $('newBtn').addEventListener('click', () => openDialog(null));
  $('cancelBtn').addEventListener('click', () => $('dlg').close());
  $('form').addEventListener('submit', submitForm);
  $('fTarget').addEventListener('input', () => { $('fTargetOut').textContent = $('fTarget').value; });
  $('exportBtn').addEventListener('click', exportData);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => { importData(e.target.files[0]); e.target.value = ''; });
  $('clearBtn').addEventListener('click', () => {
    if (window.confirm('Remove the sample habits and start fresh?')) { set({ habits: [], log: {}, selected: null, sample: false }); notify('Sample data cleared.'); }
  });
  state = load();
  render();
})();
