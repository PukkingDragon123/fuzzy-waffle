// Flippin' Waffles — DOM HUD overlay
window.FW = window.FW || {};

FW.HUD = (() => {
  const $ = (id) => document.getElementById(id);
  const el = {};
  ['ticket', 'stats', 'compass', 'timer', 'meter', 'waffles', 'drift', 'tooltip', 'popups', 'hint', 'panel', 'title', 'fade', 'minimap', 'mess', 'touch'].forEach((k) => (el[k] = $(k)));
  const show = (k, v = true) => el[k].classList.toggle('hidden', !v);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

  // Everything that used to be a floating panel is now just data. The phone in
  // the world reads it and draws the screen.
  const data = { order: null, progress: null, stats: null, nav: null, timer: null, waffles: null, drift: null, map: null, mess: 0, speed: 0, style: 0, coins: 0 };
  function ticket(order, progress) { data.order = order; data.progress = progress; }
  function stats(s) { data.stats = s; }
  function compass() {}
  function nav(v, o) { data.nav = v ? o : null; }
  function timer(v, frac, text) { data.timer = v ? { frac, text } : null; }
  function meter() {}
  function waffles(v, total, gone) { data.waffles = v ? { total, gone } : null; }
  function drift(v, speedKmh, stage, boosting, tricksText) {
    data.drift = v ? { stage, boosting } : null;
    data.speed = v ? speedKmh : 0;
  }
  function mess(n) { data.mess = n; }
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
  // --- map data for the phone screen ---
  let mmBase = null, mmSize = 0, mmLabels = [];
  function minimapInit(map) { mmBase = map.canvas; mmSize = map.size; mmLabels = map.labels || []; }
  function minimap(v, d) {
    data.map = v && mmBase ? { base: mmBase, size: mmSize, labels: mmLabels, player: d.player, yaw: d.yaw, home: d.home, dest: d.dest, route: d.route } : null;
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
  return { el, show, esc, stars, data, ticket, stats, compass, nav, timer, meter, waffles, drift, tooltip, popup, hint, panel, closePanel, title, fade, hideAll, minimapInit, minimap, mess, touchControls, isTouch };
})();
