// Flippin' Waffles — the phone. Almost every readout in the game lives on this
// screen instead of floating over the world: the order in the kitchen, the
// navigation on the handlebars.
window.FW = window.FW || {};

FW.Phone = class {
  constructor(opts = {}) {
    const V = FW.Models;
    const W = 0.086, H = 0.172, T = 0.009;   // a phone, in metres
    this.group = new THREE.Group();
    const body = V.build([
      V.p(V.roundedBox(W, H, T, 0.012), '#2a2c31', 0, 0, 0, { mat: 'shiny' }),
      V.p(V.roundedBox(W * 0.99, H * 0.995, T * 0.6, 0.011), '#3a3d44', 0, 0, 0.001, { mat: 'shiny' }),
      V.p(V.roundedBox(0.016, 0.0035, 0.004, 0.0015), '#15161a', 0, H * 0.44, T * 0.51),
      V.p(V.roundedBox(0.004, 0.026, 0.003, 0.0015), '#4a4d55', W * 0.52, 0.02, 0),
    ]);
    this.group.add(body);
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = 620;
    this.canvas = cv; this.ctx = cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 0.9, H * 0.9),
      new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false })
    );
    screen.position.z = T * 0.52;
    this.group.add(screen);
    // a little glow so the screen reads at night and in shadow
    const glow = new THREE.PointLight('#bcd8ff', opts.glow ?? 0.25, 0.5, 2);
    glow.position.z = 0.05; this.group.add(glow);
    this.group.scale.setScalar(opts.scale || 1);
    this.mode = 'order';
    this.acc = 0;
    this.clock = 7 * 60 + 40;
    this.draw();
  }
  get object() { return this.group; }

  // ---------- canvas helpers ----------
  rr(x, y, w, h, r, fill, stroke) {
    const g = this.ctx;
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); }
  }
  text(t, x, y, size, col, align = 'left', weight = '600') {
    const g = this.ctx;
    g.fillStyle = col; g.textAlign = align; g.textBaseline = 'middle';
    g.font = `${weight} ${size}px "Roboto Condensed", system-ui, sans-serif`;
    g.fillText(t, x, y);
  }
  statusBar() {
    const g = this.ctx, W = 320;
    const hh = Math.floor(this.clock / 60), mm = Math.floor(this.clock % 60);
    this.text(`${hh}:${String(mm).padStart(2, '0')}`, 16, 22, 17, '#e8ecf2');
    // signal + battery
    for (let i = 0; i < 4; i++) { g.fillStyle = i < 3 ? '#e8ecf2' : '#5a6068'; g.fillRect(240 + i * 7, 26 - i * 4, 5, 4 + i * 4); }
    this.rr(276, 15, 28, 14, 4, '#5a6068');
    this.rr(278, 17, 19, 10, 3, '#9be08a');
    g.fillStyle = '#5a6068'; g.fillRect(305, 19, 3, 6);
  }
  // ---------- screens ----------
  draw() {
    const g = this.ctx, W = 320, H = 620;
    const d = (FW.HUD && FW.HUD.data) || {};
    g.clearRect(0, 0, W, H);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#151922'); bg.addColorStop(1, '#1d2430');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    this.statusBar();
    if (this.mode === 'nav') this.drawNav(d); else this.drawOrder(d);
    this.tex.needsUpdate = true;
  }
  drawOrder(d) {
    const g = this.ctx, W = 320;
    this.text('WAFFLE ORDERS', 16, 62, 20, '#f0c862', 'left', '700');
    this.rr(16, 78, W - 32, 3, 2, '#3a4250');
    const o = d.order, pr = d.progress || {};
    if (!o || !o.waffles) { this.text('No orders', 16, 120, 18, '#8a93a0'); return; }
    // customer card
    this.rr(16, 92, W - 32, 74, 12, '#232b38', '#333d4c');
    this.text(o.customer.name, 30, 118, 21, '#e8ecf2', 'left', '700');
    this.text('deliver to', 30, 142, 14, '#7d8794');
    this.text(o.dest.short || o.dest.name, 100, 142, 16, '#7fd1c0', 'left', '700');
    let y = 186;
    o.waffles.forEach((w, i) => {
      const r = w.recipe, done = i < (pr.index || 0), active = i === (pr.index || 0);
      const h = active ? 118 : 44;
      this.rr(16, y, W - 32, h, 12, active ? '#26303f' : '#1c232e', active ? '#f0c862' : '#2d3644');
      this.text(`${i + 1}. ${r.name}`, 30, y + 24, 18, done ? '#6f7a86' : '#e8ecf2', 'left', '700');
      if (done) this.text('✓', W - 34, y + 24, 20, '#7ed37a', 'right', '700');
      if (active && pr.counts) {
        let cx = 30;
        for (const k of ['flour', 'sugar', 'egg', 'milk']) {
          const need = r.batter[k]; if (!need) continue;
          const have = pr.counts[k] || 0, ok = have === need, over = have > need;
          const label = `${FW.Orders.ING[k].name} ${have}/${need}`;
          g.font = '600 14px "Roboto Condensed", system-ui, sans-serif';
          const w2 = g.measureText(label).width + 20;
          if (cx + w2 > W - 30) { cx = 30; }
          this.rr(cx, y + 40, w2, 24, 12, ok ? '#1f3a26' : over ? '#3a2020' : '#2b3442', ok ? '#5fbf62' : over ? '#c96a62' : '#3d4756');
          this.text(label, cx + 10, y + 52, 14, ok ? '#9be08a' : over ? '#ffa89f' : '#aab4c0');
          cx += w2 + 6;
        }
        let tx = 30;
        for (const t of r.toppings) {
          const has = pr.toppings && pr.toppings.has(t);
          const label = FW.Models.TOPPINGS[t].name;
          g.font = '600 14px "Roboto Condensed", system-ui, sans-serif';
          const w2 = g.measureText(label).width + 26;
          this.rr(tx, y + 74, w2, 24, 12, has ? '#1f3a26' : '#2b3442', has ? '#5fbf62' : '#3d4756');
          g.fillStyle = FW.Models.TOPPINGS[t].color;
          g.beginPath(); g.arc(tx + 12, y + 86, 5, 0, 7); g.fill();
          this.text(label, tx + 22, y + 86, 14, has ? '#9be08a' : '#aab4c0');
          tx += w2 + 6;
        }
      }
      y += h + 10;
    });
    // footer: time left and how filthy the kitchen is
    const fy = 560;
    if (d.timer) {
      this.text('TIME', 16, fy, 13, '#7d8794');
      this.rr(58, fy - 7, 180, 14, 7, '#2b3442');
      this.rr(58, fy - 7, 180 * Math.max(0, Math.min(1, d.timer.frac)), 14, 7, d.timer.frac < 0.25 ? '#d96a5f' : '#7fd1c0');
      this.text(d.timer.text, W - 16, fy, 15, '#e8ecf2', 'right', '700');
    }
    if (d.mess) {
      this.text(`${d.mess} mess${d.mess > 1 ? 'es' : ''} to wipe`, 16, fy + 30, 15, d.mess > 4 ? '#ffa89f' : '#e0b36a');
    } else this.text('kitchen clean', 16, fy + 30, 15, '#7ed37a');
  }
  drawNav(d) {
    const g = this.ctx, W = 320;
    const n = d.nav;
    if (!n) { this.text('No route', 16, 90, 18, '#8a93a0'); return; }
    // turn arrow
    g.save();
    g.translate(58, 108); g.rotate(n.angle + Math.PI / 2);
    g.fillStyle = '#4f9ae8';
    g.beginPath(); g.moveTo(0, -26); g.lineTo(19, 8); g.lineTo(6, 8); g.lineTo(6, 26); g.lineTo(-6, 26); g.lineTo(-6, 8); g.lineTo(-19, 8); g.closePath(); g.fill();
    g.restore();
    this.text(n.dist >= 1000 ? (n.dist / 1000).toFixed(1) + ' km' : Math.round(n.dist) + ' m', 96, 92, 30, '#ffffff', 'left', '700');
    this.text(n.name, 96, 122, 18, '#9fb0c2');
    this.text(n.eta, 96, 146, 15, '#7fd1c0');
    // map
    this.rr(16, 172, W - 32, 240, 14, '#0e1520', '#2d3644');
    const mm = d.map;
    if (mm && mm.base) {
      g.save();
      g.beginPath(); if (g.roundRect) g.roundRect(18, 174, W - 36, 236, 12); else g.rect(18, 174, W - 36, 236);
      g.clip();
      const s = mm.size, k = 1.55, px = mm.player[0], py = mm.player[1];
      g.translate(W / 2, 292); g.scale(k, k); g.translate(-px, -py);
      g.globalAlpha = 0.92; g.drawImage(mm.base, 0, 0); g.globalAlpha = 1;
      if (mm.route && mm.route.length > 1) {
        g.strokeStyle = '#4f9ae8'; g.lineWidth = 3.2 / k; g.lineJoin = 'round'; g.lineCap = 'round';
        g.beginPath(); mm.route.forEach((p, i) => { i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.stroke();
      }
      if (mm.dest) { g.fillStyle = '#4f9ae8'; g.beginPath(); g.arc(mm.dest[0], mm.dest[1], 4 / k, 0, 7); g.fill(); }
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(px, py, 3.4 / k, 0, 7); g.fill();
      g.restore();
      // heading pip, always upright at the centre
      g.save(); g.translate(W / 2, 292); g.rotate(-mm.yaw);
      g.fillStyle = '#4f9ae8'; g.strokeStyle = '#ffffff'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
    // stats row
    const sy = 448;
    this.rr(16, sy, 138, 62, 12, '#232b38', '#333d4c');
    this.text('SPEED', 30, sy + 18, 12, '#7d8794');
    this.text(`${Math.round(d.speed || 0)}`, 30, sy + 42, 26, '#e8ecf2', 'left', '700');
    this.text('km/h', 82, sy + 46, 13, '#7d8794');
    this.rr(166, sy, 138, 62, 12, '#232b38', '#333d4c');
    this.text('WAFFLES', 180, sy + 18, 12, '#7d8794');
    const total = d.waffles ? d.waffles.total : 0, gone = d.waffles ? d.waffles.gone : 0;
    for (let i = 0; i < total; i++) {
      g.fillStyle = i < total - gone ? '#e8a94a' : '#4a4f57';
      this.rr(180 + i * 22, sy + 30, 17, 17, 4, i < total - gone ? '#e8a94a' : '#3a3f47');
    }
    // boost / style
    const by = 522;
    this.rr(16, by, W - 32, 54, 12, '#232b38', '#333d4c');
    this.text('STYLE', 30, by + 18, 12, '#7d8794');
    this.text(`${Math.floor(d.style || 0)}`, 30, by + 38, 20, '#f0c862', 'left', '700');
    this.text('COINS', 130, by + 18, 12, '#7d8794');
    this.text(`${d.coins || 0}`, 130, by + 38, 20, '#f0c862', 'left', '700');
    if (d.timer) {
      this.text('ETA', 230, by + 18, 12, '#7d8794');
      this.text(d.timer.text, 230, by + 38, 20, d.timer.frac < 0.25 ? '#ffa89f' : '#e8ecf2', 'left', '700');
    }
    if (d.drift && d.drift.stage) {
      const cols = ['', '#7fd1c0', '#f0872a', '#c9a0f0'];
      for (let i = 0; i < 3; i++) { g.fillStyle = i < d.drift.stage ? cols[d.drift.stage] : '#333d4c'; g.beginPath(); g.arc(W - 34 - i * 18, by + 28, 6, 0, 7); g.fill(); }
    }
  }
  update(dt) {
    this.acc += dt;
    this.clock += dt * 0.6;
    if (this.acc > 0.14) { this.acc = 0; this.draw(); }
  }
};
