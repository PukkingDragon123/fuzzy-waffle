// Flippin' Waffles — DOM HUD overlay
window.FW = window.FW || {};

FW.HUD = (() => {
  const $ = (id) => document.getElementById(id);
  const el = {};
  ['ticket', 'stats', 'compass', 'timer', 'meter', 'waffles', 'drift', 'tooltip', 'popups', 'hint', 'panel', 'title', 'fade', 'minimap'].forEach((k) => (el[k] = $(k)));
  const show = (k, v = true) => el[k].classList.toggle('hidden', !v);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

  function ticket(order, progress) {
    // progress: { index, made: [{ok:boolean}], counts:{flour,sugar,egg,milk}, toppings:Set }
    if (!order) { show('ticket', false); return; }
    show('ticket');
    let h = `<div class="from">Order for ${esc(order.customer.name)}</div><div class="dest">→ ${esc(order.dest.name)}</div>`;
    order.waffles.forEach((w, i) => {
      const r = w.recipe;
      const cls = i < progress.index ? 'done' : i === progress.index ? 'active' : '';
      h += `<div class="waffle ${cls}"><div class="name">${i + 1}. ${esc(r.name)}${i < progress.index ? (progress.made[i] && progress.made[i].quality >= 0.75 ? ' ✔' : ' ✔︎~') : ''}</div>`;
      if (i === progress.index && progress.counts) {
        for (const k of ['flour', 'sugar', 'egg', 'milk']) {
          const have = progress.counts[k], need = r.batter[k];
          const c = have === need ? 'ok' : have > need ? 'bad' : '';
          h += `<div class="row"><span>${esc(FW.Orders.ING[k].name)}</span><span class="${c}">${have}/${need}</span></div>`;
        }
        const tops = r.toppings.map((t) => `<span class="${progress.toppings && progress.toppings.has(t) ? 'have' : ''}">${esc(FW.Models.TOPPINGS[t].name)}</span>`);
        const wrong = progress.toppings ? [...progress.toppings].filter((t) => !r.toppings.includes(t)).map((t) => `<span class="wrong">${esc(FW.Models.TOPPINGS[t].name)}</span>`) : [];
        h += `<div class="tops">Top: ${tops.concat(wrong).join(', ')}</div>`;
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
  // --- minimap: world radar with roads, destination, home, bears and tokens ---
  let mmCtx = null, mmBase = null, mmSize = 0;
  function minimapInit(map) { mmBase = map.canvas; mmSize = map.size; mmCtx = el.minimap.getContext('2d'); el.minimap.width = el.minimap.height = mmSize; }
  function minimap(v, data) {
    show('minimap', v);
    if (!v || !mmCtx || !mmBase) return;
    const S = mmSize, g = mmCtx;
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, 7); g.clip();
    g.drawImage(mmBase, 0, 0);
    const dot = (p, r, fill, ring) => {
      g.beginPath(); g.arc(p[0], p[1], r, 0, 7); g.fillStyle = fill; g.fill();
      if (ring) { g.lineWidth = 2; g.strokeStyle = ring; g.stroke(); }
    };
    for (const t of data.tokens) dot(t, 1.6, '#f7c544');
    for (const b of data.bears) dot(b, 2.2, '#7a5334');
    dot(data.home, 3.4, '#e5564a', '#fff3dc');
    if (data.dest) dot(data.dest, 4.2, '#f7c544', '#3d2c1e');
    // player arrow
    const [px, py] = data.player;
    g.save(); g.translate(px, py); g.rotate(-data.yaw);
    g.beginPath(); g.moveTo(0, -6); g.lineTo(4.4, 5); g.lineTo(0, 2.6); g.lineTo(-4.4, 5); g.closePath();
    g.fillStyle = '#fffdf6'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = '#3d2c1e'; g.stroke();
    g.restore();
    g.restore();
  }
  function hideAll() { ['ticket', 'compass', 'timer', 'meter', 'waffles', 'drift', 'tooltip', 'hint', 'panel', 'title', 'minimap'].forEach((k) => show(k, false)); }
  return { el, show, esc, stars, ticket, stats, compass, timer, meter, waffles, drift, tooltip, popup, hint, panel, closePanel, title, fade, hideAll, minimapInit, minimap };
})();
