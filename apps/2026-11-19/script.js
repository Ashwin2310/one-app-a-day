'use strict';
(function () {
  const KEY = 'shortloop.v1';
  const MAX_STOPS = 60;
  const KM_W = 8;
  const KM_H = 6;
  const SPEEDS = { walk: 5, bike: 15, car: 25 };
  const HIT_R = 16;
  const OR_MAX = 3;
  const SAMPLE = [
    ['Home', 0.5, 0.52], ['Pharmacy', 0.86, 0.2], ['Post office', 0.12, 0.78], ['Hardware', 0.78, 0.82],
    ['Bakery', 0.2, 0.22], ['Dry cleaner', 0.62, 0.3], ['Library', 0.35, 0.88], ['Gym', 0.9, 0.55], ['Friend', 0.08, 0.5],
  ];

  const $ = (id) => document.getElementById(id);
  const canvas = $('map');
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let state = { stops: [], route: [], baseline: [], metric: 'line', travel: 'car', round: true, optimized: false };
  let nextId = 1;
  let solver = null;
  let drag = null;
  let size = { w: 600, h: 450 };
  let toastTimer = 0;

  const byId = (id) => state.stops.find((s) => s.id === id);
  const km = (s) => ({ x: s.x * KM_W, y: s.y * KM_H });

  function dist(a, b) {
    const p = km(a);
    const q = km(b);
    return state.metric === 'grid' ? Math.abs(p.x - q.x) + Math.abs(p.y - q.y) : Math.hypot(p.x - q.x, p.y - q.y);
  }

  function length(order) {
    let total = 0;
    for (let i = 0; i + 1 < order.length; i++) total += dist(byId(order[i]), byId(order[i + 1]));
    if (state.round && order.length > 2) total += dist(byId(order[order.length - 1]), byId(order[0]));
    return total;
  }

  function nearest(order) {
    if (order.length < 3) return order.slice();
    const left = order.slice(1);
    const out = [order[0]];
    while (left.length) {
      const last = byId(out[out.length - 1]);
      let best = 0;
      for (let i = 1; i < left.length; i++) if (dist(last, byId(left[i])) < dist(last, byId(left[best]))) best = i;
      out.push(left.splice(best, 1)[0]);
    }
    return out;
  }

  function* search(start) {
    let cur = nearest(start);
    let curLen = length(cur);
    yield { order: cur, fixed: 0 };
    let fixed = 0;
    let improved = true;
    while (improved) {
      improved = false;
      const n = cur.length;
      for (let i = 1; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          const cand = [...cur.slice(0, i), ...cur.slice(i, j + 1).reverse(), ...cur.slice(j + 1)];
          const l = length(cand);
          if (l < curLen - 1e-9) { cur = cand; curLen = l; fixed++; improved = true; yield { order: cur, fixed }; }
        }
        yield null;
      }
      for (let len = 1; len <= OR_MAX; len++) {
        for (let i = 1; i + len <= cur.length; i++) {
          const seg = cur.slice(i, i + len);
          const rest = [...cur.slice(0, i), ...cur.slice(i + len)];
          for (let k = 1; k <= rest.length; k++) {
            if (k === i) continue;
            for (const s of [seg, seg.slice().reverse()]) {
              const cand = [...rest.slice(0, k), ...s, ...rest.slice(k)];
              const l = length(cand);
              if (l < curLen - 1e-9) { cur = cand; curLen = l; fixed++; improved = true; yield { order: cur, fixed }; break; }
            }
          }
        }
        yield null;
      }
    }
    return { order: cur, fixed, done: true };
  }

  function stepSolver() {
    if (!solver) return;
    const budget = Number($('speed').value) * 6;
    for (let i = 0; i < budget; i++) {
      const r = solver.gen.next();
      if (r.done) { finishSolve(r.value); return; }
      if (r.value) { state.route = r.value.order; solver.fixed = r.value.fixed; solver.dirty = true; if (!reduce) break; }
    }
    $('status').textContent = 'Optimizing… ' + solver.fixed + ' improvements applied';
    if (solver.dirty) { solver.dirty = false; renderStats(); }
  }

  function finishSolve(v) {
    state.optimized = true;
    state.route = v.order;
    $('status').textContent = 'Local optimum reached, ' + v.fixed + ' improving moves applied';
    solver = null;
    $('btn-opt').textContent = 'Optimize';
    renderAll();
    save();
  }

  function startSolve() {
    if (solver) { solver = null; $('btn-opt').textContent = 'Optimize'; return; }
    if (state.stops.length < 3) { toast('Add at least 3 stops to optimize'); return; }
    solver = { gen: search(state.route), fixed: 0, dirty: false };
    $('btn-opt').textContent = 'Stop';
  }

  function rotateTo(order, id) {
    const i = order.indexOf(id);
    return i < 0 ? order : [...order.slice(i), ...order.slice(0, i)];
  }

  function addStop(name, x, y) {
    if (state.stops.length >= MAX_STOPS) { toast('Maximum of ' + MAX_STOPS + ' stops'); return; }
    const id = nextId++;
    const stop = { id, name: name || 'Stop ' + id, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    state = { ...state, stops: [...state.stops, stop], route: [...state.route, id], baseline: [...state.baseline, id] };
    state.optimized = false;
    afterChange();
  }

  function removeStop(id) {
    const keep = (a) => a.filter((v) => v !== id);
    state = { ...state, stops: state.stops.filter((s) => s.id !== id), route: keep(state.route), baseline: keep(state.baseline) };
    afterChange();
  }

  function setStart(id) {
    state = { ...state, route: rotateTo(state.route, id), baseline: rotateTo(state.baseline, id) };
    solver = null;
    afterChange();
  }

  function afterChange() {
    solver = null;
    $('btn-opt').textContent = 'Optimize';
    $('status').textContent = state.stops.length > 2 ? 'Route changed. Press Optimize.' : '';
    renderAll();
    save();
  }

  function loadSample() {
    state = { ...state, stops: [], route: [], baseline: [], optimized: false };
    nextId = 1;
    const ids = SAMPLE.map(([name, x, y]) => { const id = nextId++; state.stops.push({ id, name, x, y }); return id; });
    const scrambled = [ids[0], ...[5, 3, 1, 7, 2, 6, 4, 8].map((i) => ids[i])];
    state.route = scrambled;
    state.baseline = scrambled.slice();
    solver = null;
    $('status').textContent = 'Sample city: press Optimize';
    renderAll();
    save();
  }

  function addRandom() {
    for (let i = 0; i < 5; i++) addStop('', 0.05 + Math.random() * 0.9, 0.08 + Math.random() * 0.84);
  }

  function clearAll() {
    state = { ...state, stops: [], route: [], baseline: [], optimized: false };
    nextId = 1;
    afterChange();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ ...state, nextId })); } catch (e) { /* storage unavailable */ }
  }

  function restore() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (raw && Array.isArray(raw.stops) && raw.stops.length) {
        state = { stops: raw.stops, route: raw.route, baseline: raw.baseline, metric: raw.metric === 'grid' ? 'grid' : 'line',
          travel: SPEEDS[raw.travel] ? raw.travel : 'car', round: raw.round !== false, optimized: !!raw.optimized };
        nextId = raw.nextId || raw.stops.length + 1;
        return true;
      }
    } catch (e) { /* ignore corrupt data */ }
    return false;
  }

  function fmtTime(d) {
    const m = Math.round((d / SPEEDS[state.travel]) * 60);
    return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min';
  }

  function renderStats() {
    const cur = length(state.route);
    const base = length(state.baseline);
    const saved = base > 0 ? Math.max(0, ((base - cur) / base) * 100) : 0;
    $('s-dist').textContent = cur.toFixed(1) + ' km';
    $('s-saved').textContent = Math.round(saved) + '%';
    $('s-time').textContent = fmtTime(cur);
  }

  function renderList() {
    const ol = $('list');
    ol.textContent = '';
    state.route.forEach((id, i) => {
      const s = byId(id);
      const li = document.createElement('li');
      const n = document.createElement('span');
      n.className = 'n' + (i === 0 ? ' s' : '');
      n.textContent = i + 1;
      const input = document.createElement('input');
      input.value = s.name;
      input.setAttribute('aria-label', 'Name of stop ' + (i + 1));
      input.addEventListener('input', () => { s.name = input.value; save(); });
      li.append(n, input);
      if (i > 0) li.append(mini('Start', 'Make ' + s.name + ' the start', () => setStart(id)));
      li.append(mini('✕', 'Remove ' + s.name, () => removeStop(id)));
      ol.append(li);
    });
  }

  function mini(text, label, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', fn);
    return b;
  }

  function renderAll() {
    $('empty').hidden = state.stops.length > 0;
    $('btn-opt').disabled = state.stops.length < 3;
    document.querySelectorAll('input[name=metric]').forEach((r) => { r.checked = r.value === state.metric; });
    document.querySelectorAll('input[name=travel]').forEach((r) => { r.checked = r.value === state.travel; });
    $('round').checked = state.round;
    renderStats();
    renderList();
  }

  function pt(s) { return { x: s.x * size.w, y: s.y * size.h }; }

  function drawRoute(order, color, width, dash, offset) {
    if (order.length < 2) return;
    ctx.beginPath();
    const pts = order.map((id) => pt(byId(id)));
    if (state.round && pts.length > 2) pts.push(pts[0]);
    pts.forEach((p, i) => {
      if (i === 0) { ctx.moveTo(p.x, p.y); return; }
      if (state.metric === 'grid') ctx.lineTo(p.x, pts[i - 1].y);
      ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.lineDashOffset = offset;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function draw(time) {
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.strokeStyle = '#1d2845';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= size.w; x += size.w / 16) { ctx.moveTo(x, 0); ctx.lineTo(x, size.h); }
    for (let y = 0; y <= size.h; y += size.h / 12) { ctx.moveTo(0, y); ctx.lineTo(size.w, y); }
    ctx.stroke();
    const same = state.route.join() === state.baseline.join();
    if (same) drawRoute(state.route, '#ff6b81', 3, [], 0);
    else {
      drawRoute(state.baseline, 'rgba(255,107,129,.55)', 2, [6, 6], 0);
      ctx.shadowColor = '#38e8c6';
      ctx.shadowBlur = 10;
      drawRoute(state.route, '#38e8c6', 3.5, reduce ? [] : [14, 8], reduce ? 0 : -time / 40);
      ctx.shadowBlur = 0;
    }
    state.route.forEach((id, i) => {
      const p = pt(byId(id));
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === 0 ? 11 : 8, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#ffd166' : '#e8ecf8';
      ctx.fill();
      ctx.strokeStyle = '#0b1020';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#0b1020';
      ctx.font = '700 ' + (i === 0 ? 11 : 10) + 'px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(i + 1, p.x, p.y + 0.5);
      if (size.w > 420) {
        ctx.font = '12px system-ui,sans-serif';
        ctx.fillStyle = '#c7d0ee';
        ctx.fillText(byId(id).name, p.x, p.y - 16);
      }
    });
  }

  function frame(time) {
    stepSolver();
    draw(time);
    requestAnimationFrame(frame);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    size = { w: r.width, h: r.height };
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function hit(e) {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const s = [...state.stops].reverse().find((o) => Math.hypot(o.x * size.w - x, o.y * size.h - y) < HIT_R);
    return { x: x / size.w, y: y / size.h, stop: s };
  }

  canvas.addEventListener('pointerdown', (e) => {
    const h = hit(e);
    canvas.setPointerCapture(e.pointerId);
    drag = { id: h.stop ? h.stop.id : null, moved: false, sx: e.clientX, sy: e.clientY };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
    if (drag.id && drag.moved) {
      const h = hit(e);
      state.stops = state.stops.map((s) => (s.id === drag.id ? { ...s, x: Math.min(1, Math.max(0, h.x)), y: Math.min(1, Math.max(0, h.y)) } : s));
      renderStats();
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.id && d.moved) { save(); return; }
    if (!d.id && !d.moved) { const h = hit(e); addStop('', h.x, h.y); }
  });
  canvas.addEventListener('dblclick', (e) => { const h = hit(e); if (h.stop) removeStop(h.stop.id); });

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
  }

  function itinerary() {
    const lines = state.route.map((id, i) => (i + 1) + '. ' + byId(id).name + (i === 0 ? ' (start)' : ''));
    if (state.round && state.route.length > 2) lines.push((state.route.length + 1) + '. Back to ' + byId(state.route[0]).name);
    lines.push('Total: ' + length(state.route).toFixed(1) + ' km, about ' + fmtTime(length(state.route)));
    return lines.join('\n');
  }

  function copy() {
    if (!state.route.length) { toast('Nothing to copy yet'); return; }
    const text = itinerary();
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.append(ta);
      ta.select();
      try { document.execCommand('copy'); toast('Itinerary copied'); } catch (e) { toast('Copy failed'); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('Itinerary copied'), fallback);
    } else fallback();
  }

  $('btn-opt').addEventListener('click', startSolve);
  $('btn-sample').addEventListener('click', loadSample);
  $('btn-random').addEventListener('click', addRandom);
  $('btn-clear').addEventListener('click', clearAll);
  $('btn-copy').addEventListener('click', copy);
  $('round').addEventListener('change', (e) => { state.round = e.target.checked; afterChange(); });
  document.querySelectorAll('input[name=metric]').forEach((r) => r.addEventListener('change', () => { state.metric = r.value; afterChange(); }));
  document.querySelectorAll('input[name=travel]').forEach((r) => r.addEventListener('change', () => { state.travel = r.value; renderStats(); save(); }));
  window.addEventListener('resize', resize);

  resize();
  if (!restore()) loadSample(); else renderAll();
  requestAnimationFrame(frame);
})();
