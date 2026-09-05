// Flippin' Waffles — DOM HUD overlay
window.FW = window.FW || {};

FW.HUD = (() => {
  const $ = (id) => document.getElementById(id);
  const el = {};
  ['ticket', 'stats', 'compass', 'timer', 'meter', 'waffles', 'drift', 'tooltip', 'popups', 'hint', 'panel', 'title', 'fade', 'minimap', 'mess', 'touch'].forEach((k) => (el[k] = $(k)));
  const show = (k, v = true) => el[k].classList.toggle('hidden', !v);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

  function ticket(order, progress) {
    if (!order) { show('ticket', false); return; }
    show('ticket');
    let h = `<div class="from">Order · ${esc(order.customer.name)}</div><div class="dest">${esc(order.dest.name)}</div>`;
    order.waffles.forEach((w, i) => {
      const r = w.recipe;
      const cls = i < progress.index ? 'done' : i === progress.index ? 'active' : '';
      const done = i < progress.index;
      h += `<div class="waffle ${cls}"><div class="name">${i + 1}. ${esc(r.name)}${done ? ' <span class="tick">✔</span>' : ''}</div>`;
      if (i === progress.index && progress.counts) {
        h += '<div class="chips">';
        for (const k of ['flour', 'sugar', 'egg', 'milk']) {
          const need = r.batter[k]; if (!need) continue;
          const have = progress.counts[k] || 0;
          const st = have === need ? 'ok' : have > need ? 'over' : '';
          h += `<span class="chip ${st}"><i class="sw ${k}"></i>${esc(FW.Orders.ING[k].name)} <b>${have}/${need}</b></span>`;
        }
        for (const k of ['flour', 'sugar', 'egg', 'milk']) {
          const need = r.batter[k], have = progress.counts[k] || 0;
          if (!need && have) h += `<span class="chip over"><i class="sw ${k}"></i>${esc(FW.Orders.ING[k].name)} <b>${have}/0</b></span>`;
        }
        h += '</div><div class="chips">';
        for (const t of r.toppings) h += `<span class="chip top ${progress.toppings && progress.toppings.has(t) ? 'ok' : ''}"><i class="sw" style="background:${FW.Models.TOPPINGS[t].color}"></i>${esc(FW.Models.TOPPINGS[t].name)}</span>`;
        if (progress.toppings) for (const t of progress.toppings) if (!r.toppings.includes(t)) h += `<span class="chip over"><i class="sw" style="background:${FW.Models.TOPPINGS[t].color}"></i>${esc(FW.Models.TOPPINGS[t].name)}</span>`;
        h += '</div>';
      } else {
        h += `<div class="tops">${esc(r.hint)}</div>`;
      }
      h += '</div>';
    });
    el.ticket.innerHTML = h;
  }
  function stats(s) {
    show('stats');
    el.stats.innerHTML = `<div class="row"><b>Day</b><span>${s.day}</span></div><div class="row"><b>Coins</b><span>🪙 ${s.coins}</span></div><div class="row"><b>Rep</b><span class="stars">${stars(s.rep)}</span></div><div class="row"><b>Delivered</b><span>${s.delivered}</span></div>`;
  }
  function compass(v, angle, dist, label) {
    show('compass', v); if (!v) return;
    el.compass.querySelector('.arrow').style.transform = `rotate(${angle}rad)`;
    el.compass.querySelector('.label').textContent = `${label} · ${Math.round(dist)} m`;
  }
  function timer(v, frac, text) {
    show('timer', v); if (!v) return;
    el.timer.querySelector('.fill').style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    el.timer.querySelector('.text').textContent = text;
    el.timer.classList.toggle('low', frac < 0.25);
  }
  function meter(v, title, value, zone, sub) {
    show('meter', v); if (!v) return;
    el.meter.querySelector('.title').textContent = title;
    const z = el.meter.querySelector('.zone'); z.style.left = `${zone[0]}%`; z.style.width = `${zone[1] - zone[0]}%`;
    el.meter.querySelector('.fill').style.width = `${Math.min(100, value)}%`;
    el.meter.querySelector('.needle').style.left = `calc(${Math.min(100, value)}% - 2px)`;
    el.meter.querySelector('.sub').textContent = sub || '';
  }
  function waffles(v, total, gone) {
    show('waffles', v); if (!v) return;
    let h = ''; for (let i = 0; i < total; i++) h += `<div class="w ${i < gone ? 'gone' : ''}"></div>`;
    el.waffles.innerHTML = h;
  }
  function drift(v, speedKmh, stage, boosting, tricksText) {
    show('drift', v); if (!v) return;
    el.drift.querySelector('.speed').innerHTML = `${Math.round(speedKmh)}<small> km/h</small>`;
    const c = el.drift.querySelector('.charge'); c.className = 'charge' + (stage ? ' s' + stage : '');
    el.drift.classList.toggle('boost', !!boosting);
    el.drift.querySelector('.tricks').textContent = tricksText || '';
  }
  function tooltip(text, x, y) {
    show('tooltip', !!text); if (!text) return;
    el.tooltip.textContent = text; el.tooltip.style.left = `${Math.min(x, window.innerWidth - 220)}px`; el.tooltip.style.top = `${Math.min(y, window.innerHeight - 50)}px`;
  }
  function popup(text, cls = '') {
    const d = document.createElement('div'); d.className = 'pop ' + cls; d.textContent = text;
    el.popups.appendChild(d); setTimeout(() => d.remove(), 1400);
  }
  function hint(html) { show('hint', !!html); if (html) el.hint.innerHTML = html; }
  function panel(html, buttons = []) {
    // buttons: [{label, cls, onClick}]
    show('panel');
    const inner = el.panel.querySelector('.inner');
    inner.innerHTML = html + '<div class="btns"></div>';
    const bt = inner.querySelector('.btns');
    buttons.forEach((b) => { const btn = document.createElement('button'); btn.className = 'btn ' + (b.cls || ''); btn.textContent = b.label; btn.onclick = (e) => { e.stopPropagation(); if (FW.Audio.ready) FW.Audio.sfx.pop(); b.onClick(); }; bt.appendChild(btn); });
  }
  function closePanel() { show('panel', false); }
  function title(v, saveText) { show('title', v); if (v && saveText !== undefined) el.title.querySelector('.save').textContent = saveText; }
  function fade(to, dur = 0.5) { return new Promise((res) => { el.fade.style.transition = `opacity ${dur}s`; el.fade.style.opacity = to; setTimeout(res, dur * 1000); }); }
  // --- minimap: drawn like a map app — landcover, roads, a route, labels ---
  let mmCtx = null, mmBase = null, mmSize = 0, mmLabels = [];
  function minimapInit(map) {
    mmBase = map.canvas; mmSize = map.size; mmLabels = map.labels || [];
    el.minimap.width = el.minimap.height = mmSize;
    mmCtx = el.minimap.getContext('2d');
  }
  function minimap(v, data) {
    show('minimap', v);
    if (!v || !mmCtx || !mmBase) return;
    const S = mmSize, g = mmCtx;
    g.clearRect(0, 0, S, S);
    g.drawImage(mmBase, 0, 0);
    g.lineCap = 'round'; g.lineJoin = 'round';
    // the route, in navigation blue
    if (data.route && data.route.length > 1) {
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 7;
      g.beginPath(); data.route.forEach((p, i) => { i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.stroke();
      g.strokeStyle = '#2f7fe0'; g.lineWidth = 4.2;
      g.beginPath(); data.route.forEach((p, i) => { i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.stroke();
    }
    const pin = (p, r, fill, ring) => {
      g.beginPath(); g.arc(p[0], p[1], r, 0, 7); g.fillStyle = fill; g.fill();
      if (ring) { g.lineWidth = 2; g.strokeStyle = ring; g.stroke(); }
    };
    for (const t of data.tokens) pin(t, 1.7, '#e8a32a');
    for (const b of data.bears) pin(b, 2.6, '#5b4028', '#fff');
    for (const c of data.cars) pin(c, 1.9, '#5a6270');
    // place labels
    g.font = '600 9px "Roboto Condensed", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const l of mmLabels) {
      g.lineWidth = 2.6; g.strokeStyle = 'rgba(255,255,255,.92)';
      g.strokeText(l.text, l.at[0], l.at[1] - 6);
      g.fillStyle = l.home ? '#b4453c' : '#4a5240';
      g.fillText(l.text, l.at[0], l.at[1] - 6);
    }
    pin(data.home, 3.2, '#e5564a', '#fff');
    if (data.dest) {
      // destination pin, teardrop style
      const [x, y] = data.dest;
      g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x - 4.4, y - 5); g.lineTo(x + 4.4, y - 5); g.closePath();
      g.fillStyle = '#2f7fe0'; g.fill();
      pin([x, y - 7.5], 4.6, '#2f7fe0', '#ffffff');
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, y - 7.5, 1.7, 0, 7); g.fill();
    }
    // the player: a heading cone plus a blue dot, the way a map app shows you
    const [px, py] = data.player;
    g.save(); g.translate(px, py); g.rotate(-data.yaw);
    const grd = g.createLinearGradient(0, 0, 0, -16);
    grd.addColorStop(0, 'rgba(47,127,224,.55)'); grd.addColorStop(1, 'rgba(47,127,224,0)');
    g.beginPath(); g.moveTo(0, 0); g.lineTo(-7, -16); g.lineTo(7, -16); g.closePath(); g.fillStyle = grd; g.fill();
    g.restore();
    pin([px, py], 4.2, '#2f7fe0', '#ffffff');
    // north arrow
    g.save();
    g.translate(S - 15, 15);
    g.beginPath(); g.moveTo(0, -8); g.lineTo(4, 4); g.lineTo(0, 1); g.lineTo(-4, 4); g.closePath();
    g.fillStyle = '#c0392b'; g.fill();
    g.font = '700 8px "Roboto Condensed", system-ui, sans-serif'; g.fillStyle = '#4a5240'; g.textAlign = 'center';
    g.fillText('N', 0, 11);
    g.restore();
  }
  // navigation banner: destination, distance and a turn arrow
  function nav(v, o) {
    show('compass', v);
    if (!v) return;
    el.compass.querySelector('.arrow').style.transform = `rotate(${o.angle}rad)`;
    el.compass.querySelector('.dest').textContent = o.name;
    el.compass.querySelector('.dist').textContent = o.dist >= 1000 ? (o.dist / 1000).toFixed(1) + ' km' : Math.round(o.dist) + ' m';
    el.compass.querySelector('.eta').textContent = o.eta;
  }
  function mess(n) {
    show('mess', n > 0);
    if (n > 0) { el.mess.querySelector('.n').textContent = n; el.mess.classList.toggle('lots', n >= 6); }
  }
  // --- on-screen wheel and pedals, for touch ---
  let touchReady = false;
  function touchControls(v) {
    show('touch', v);
    if (touchReady || !v) return;
    touchReady = true;
    const I = FW.Input, wheel = document.getElementById('wheel'), rim = wheel.querySelector('.rim');
    let dragId = null, startX = 0, angle = 0;
    const setAngle = (a) => { angle = Math.max(-1, Math.min(1, a)); rim.style.transform = `rotate(${angle * 42}deg)`; I.virtual.steer = angle; };
    wheel.addEventListener('pointerdown', (e) => { dragId = e.pointerId; startX = e.clientX - angle * 120; wheel.setPointerCapture(e.pointerId); e.preventDefault(); });
    wheel.addEventListener('pointermove', (e) => { if (e.pointerId !== dragId) return; setAngle((e.clientX - startX) / 120); });
    const release = (e) => { if (e.pointerId !== dragId) return; dragId = null; setAngle(0); };
    wheel.addEventListener('pointerup', release);
    wheel.addEventListener('pointercancel', release);
    for (const b of document.querySelectorAll('#pedals .pedal, #tbtns .tbtn')) {
      const act = b.dataset.act;
      const on = (e) => { e.preventDefault(); b.classList.add('on');
        if (act === 'up') I.virtual.throttle = 1; else if (act === 'down') I.virtual.throttle = -1; else I.setHeld(act, true); };
      const off = (e) => { e.preventDefault(); b.classList.remove('on');
        if (act === 'up' || act === 'down') I.virtual.throttle = 0; else I.setHeld(act, false); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
    }
  }
  const isTouch = () => window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

  function hideAll() { ['ticket', 'compass', 'timer', 'meter', 'waffles', 'drift', 'tooltip', 'hint', 'panel', 'title', 'minimap', 'mess', 'touch'].forEach((k) => show(k, false)); }
  return { el, show, esc, stars, ticket, stats, compass, nav, timer, meter, waffles, drift, tooltip, popup, hint, panel, closePanel, title, fade, hideAll, minimapInit, minimap, mess, touchControls, isTouch };
})();
