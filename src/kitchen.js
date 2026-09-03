// Flippin' Waffles — the cozy kitchen: mixing, whisking, flipping, topping, packing
window.FW = window.FW || {};

FW.Kitchen = class {
  constructor() {
    const U = FW.U;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#f3d9b1');
    this.camera = new THREE.PerspectiveCamera(44, FW.Pixel.size.aspect, 0.1, 60);
    this.camera.position.set(0.15, 2.4, 3.0); this.camera.lookAt(0.15, 0.95, -0.15);
    this.fx = new FW.Particles(this.scene, 300);
    this.ray = new THREE.Raycaster();
    this.interactives = []; this.hover = null; this.tweens = []; this.flying = [];
    this.state = 'idle'; this.order = null; this.index = 0; this.made = []; this.cur = null;
    this.cook = 0; this.whiskMeter = 0; this.t = 0; this.waitTimer = 0;
    this.onDone = null; this.onProgress = null;
    this.buildRoom();
  }
  // ---------------- scene ----------------
  buildRoom() {
    const V = FW.Voxel, B = V.B, P = FW.PAL, M = FW.Pixel.mat, S = this.scene;
    const key = new THREE.DirectionalLight('#fff1dc', 2.6); key.position.set(2.2, 5, 3); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera; sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -4; sc.near = 1; sc.far = 15; key.shadow.bias = -0.001; key.shadow.normalBias = 0.03;
    S.add(key); S.add(key.target);
    S.add(new THREE.HemisphereLight('#ffe8c8', '#8a6a4a', 1.3));
    const lamp = new THREE.PointLight('#ffb060', 6, 7, 2); lamp.position.set(0.15, 2.5, 0.3); S.add(lamp);
    const box = (w, h, d, c, x, y, z, rec = true) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(c)); m.position.set(x, y, z); m.receiveShadow = rec; m.castShadow = true; S.add(m); return m; };
    // floor + planks
    box(9, 0.2, 7, '#b07a4a', 0.15, -0.1, -0.3);
    for (let i = -4; i <= 4; i++) box(0.04, 0.02, 7, '#8a5a33', 0.15 + i * 1, 0.005, -0.3, false);
    // walls
    box(9, 4.2, 0.3, '#f3d9b1', 0.15, 2.1, -2.3);
    box(9, 1.15, 0.34, '#c98f5a', 0.15, 0.575, -2.3); box(9, 0.08, 0.4, '#8a5a33', 0.15, 1.16, -2.3);
    box(0.3, 4.2, 7, '#efd0a4', -4.35, 2.1, -0.3); box(0.3, 4.2, 7, '#efd0a4', 4.65, 2.1, -0.3);
    // window with painted view
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.5), new THREE.MeshBasicMaterial({ map: this.windowTexture() })); win.position.set(-1.7, 2.25, -2.14); S.add(win);
    box(2.3, 0.1, 0.12, P.white, -1.7, 3.05, -2.12); box(2.3, 0.1, 0.12, P.white, -1.7, 1.45, -2.12); box(0.1, 1.7, 0.12, P.white, -2.8, 2.25, -2.12); box(0.1, 1.7, 0.12, P.white, -0.6, 2.25, -2.12); box(0.06, 1.5, 0.08, P.white, -1.7, 2.25, -2.11); box(2.1, 0.06, 0.08, P.white, -1.7, 2.25, -2.11);
    box(0.7, 0.8, 0.02, '#e0574f', -2.55, 2.25, -2.1); box(0.7, 0.8, 0.02, '#e0574f', -0.85, 2.25, -2.1);
    // shelf & jars
    box(2.6, 0.08, 0.4, '#a06a3c', 1.9, 2.05, -2.0);
    [['#f6a5a5', 0.9], ['#a8e6cf', 1.3], ['#f3c34a', 1.7], ['#c89ff0', 2.1], ['#8fd3f4', 2.5], ['#e0574f', 2.9]].forEach(([c, x], i) => { box(0.22, 0.22 + (i % 2) * 0.1, 0.22, c, x, 2.09 + (0.22 + (i % 2) * 0.1) / 2, -2.0); box(0.14, 0.05, 0.14, '#6b4423', x, 2.09 + 0.22 + (i % 2) * 0.1 + 0.025, -2.0); });
    // framed photo, clock
    box(0.7, 0.55, 0.05, '#6b4423', 0.7, 2.75, -2.13); box(0.6, 0.45, 0.02, '#a5d8f3', 0.7, 2.75, -2.1); box(0.3, 0.25, 0.02, '#b9b2a8', 0.78, 2.72, -2.09); box(0.6, 0.12, 0.02, '#7ec850', 0.7, 2.56, -2.09);
    const clock = box(0.4, 0.4, 0.05, P.white, 2.6, 2.9, -2.13); box(0.44, 0.44, 0.04, '#6b4423', 2.6, 2.9, -2.14); this.clockHand = box(0.03, 0.15, 0.02, '#3d2314', 2.6, 2.97, -2.1); this.clockHand.geometry.translate(0, -0.06, 0);
    // string lights
    this.lights = [];
    const lc = ['#ff8fa3', '#f3c34a', '#a8e6cf', '#8fd3f4', '#c89ff0'];
    for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.1), new THREE.MeshBasicMaterial({ color: lc[i % 5] })); m.position.set(-3.6 + i * 0.68, 3.55 - Math.abs(Math.sin(i * 0.55)) * 0.25, -2.1); S.add(m); this.lights.push(m); }
    box(8.2, 0.02, 0.02, '#3d2314', 0.15, 3.6, -2.1, false);
    // counter
    box(4.8, 0.9, 0.95, '#f5e6c8', 0.15, 0.45, 0.0);
    box(4.9, 0.08, 1.05, '#c98f5a', 0.15, 0.94, 0.0);
    for (let i = 0; i < 6; i++) box(0.06, 0.7, 0.04, '#e8cfa8', -2.05 + i * 0.88, 0.45, 0.5, false);
    // plant, radio, stool
    box(0.4, 0.4, 0.4, '#c94a4a', -3.4, 0.2, -1.4); box(0.5, 0.3, 0.5, '#3f7d4e', -3.4, 0.55, -1.4); box(0.3, 0.4, 0.3, '#4f9a5c', -3.45, 0.85, -1.35); box(0.2, 0.3, 0.2, '#58a866', -3.3, 1.1, -1.5);
    box(0.5, 0.3, 0.25, '#e0574f', 3.3, 2.24, -2.0); box(0.18, 0.18, 0.02, '#3d2314', 3.2, 2.24, -1.86); box(0.05, 0.3, 0.02, '#c9c9d0', 3.5, 2.55, -2.0);
    box(0.5, 0.06, 0.5, '#a06a3c', 3.6, 0.55, -1.2); box(0.06, 0.55, 0.06, '#8a5a33', 3.42, 0.27, -1.38); box(0.06, 0.55, 0.06, '#8a5a33', 3.78, 0.27, -1.02); box(0.06, 0.55, 0.06, '#8a5a33', 3.42, 0.27, -1.02); box(0.06, 0.55, 0.06, '#8a5a33', 3.78, 0.27, -1.38);
    // menu board
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ map: FW.Pixel.textTexture('~ menu ~ waffles ~', { w: 512, h: 288, bg: '#3d2314', fg: '#fff4dc', font: 'bold 40px monospace', border: '#8a5a33' }) })); board.position.set(3.3, 2.75, -2.13); S.add(board);
    // duck chef
    this.duck = V.duck({ hat: 'chef' }); this.duck.position.set(-0.42, 0.22, -0.95); this.duck.scale.setScalar(1.12); S.add(this.duck);
    // ---- interactive props (counter top y = 0.98) ----
    const TOP = 0.98, u = 0.02;
    const reg = (obj, action, label) => { obj.traverse((o) => { o.userData.action = action; o.userData.label = label; }); obj.userData.root = true; this.interactives.push(obj); S.add(obj); return obj; };
    const flour = V.mesh([B('#f2ecdf', 0, 0, 0, 12, 15, 8), B('#e8dcc5', 0, 15, 0, 6, 3, 5), B('#c94a4a', 0, 5, 4.2, 8, 5, 0.4), B('#fff4dc', 0, 6.5, 4.5, 5, 2, 0.3)], u); flour.position.set(-1.9, TOP, -0.26); reg(flour, 'flour', 'Flour');
    const sugar = V.mesh([B('#e8f2f7', 0, 0, 0, 8, 10, 8), B('#fbe9f0', 0, 1, 0, 7, 7.5, 7), B('#b46e3f', 0, 10, 0, 9, 2, 9), B('#f6a5a5', 0, 4, 4.1, 5, 3, 0.3)], u); sugar.position.set(-1.5, TOP, -0.28); reg(sugar, 'sugar', 'Sugar');
    const eggs = V.mesh([B('#c58a4e', 0, 0, 0, 12, 5, 9), B('#a06a3c', 0, 4, 0, 12.4, 1, 9.4), B('#fff5e0', -3, 4, -1, 3, 3.5, 3), B('#fff5e0', 0.5, 4, 1, 3, 3.5, 3), B('#fff5e0', 3.5, 4, -1.5, 3, 3.5, 3), B('#fff5e0', -1, 6, 1.5, 2.6, 3, 2.6)], u); eggs.position.set(-1.08, TOP, -0.26); reg(eggs, 'egg', 'Eggs');
    const milk = V.mesh([B('#f2f6ff', 0, 0, 0, 7, 12, 7), B('#4a7fd6', 0, 12, 0, 4, 2, 4), B('#4a7fd6', 0, 4, 3.6, 5, 4, 0.4), B('#ffffff', 0, 5, 3.9, 3, 2, 0.3)], u); milk.position.set(-0.72, TOP, -0.26); reg(milk, 'milk', 'Milk');
    // bowl
    const bowl = new THREE.Group();
    bowl.add(V.mesh([B('#f4e9d8', 0, 0, 0, 15, 1.5, 15), B('#f4e9d8', -7, 1.5, 0, 1.5, 5.5, 15), B('#f4e9d8', 7, 1.5, 0, 1.5, 5.5, 15), B('#f4e9d8', 0, 1.5, -7, 15, 5.5, 1.5), B('#f4e9d8', 0, 1.5, 7, 15, 5.5, 1.5), B('#4a7fd6', 0, 6.4, 0, 15.6, 0.8, 15.6)], u));
    this.batter = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.24), M('#f7e6b8')); this.batter.position.y = 0.04; this.batter.visible = false; bowl.add(this.batter);
    this.whisk = new THREE.Group(); this.whisk.add(V.mesh([B(P.steel, 0, 0, 0, 3, 5, 3), B(P.steel, 0, 5, 0, 1, 6, 1), B('#e0574f', 0, 11, 0, 2, 5, 2)], u)); this.whisk.position.set(0.05, 0.05, 0.02); this.whisk.rotation.z = 0.25; bowl.add(this.whisk);
    bowl.position.set(-1.35, TOP, 0.24); reg(bowl, 'bowl', 'Mixing bowl'); this.bowl = bowl;
    // waffle iron: stand + pivoting body
    const ironG = new THREE.Group(); ironG.position.set(0.15, TOP, -0.02);
    ironG.add(V.mesh([B(P.steel, -13, 0, 0, 2, 7, 4), B(P.steel, 13, 0, 0, 2, 7, 4), B('#3d2314', 0, 0, 0, 26, 1, 12)], u));
    this.ironPivot = new THREE.Group(); this.ironPivot.position.y = 0.12; ironG.add(this.ironPivot);
    this.ironPivot.add(V.mesh([B('#3a3a40', 0, -2, 0, 26, 4, 26), B('#2b2b30', 0, 2, 0, 22, 0.6, 22)], u));
    const grid = []; for (let i = -4; i <= 4; i += 2) { grid.push(B('#55555c', i * 2.2, 2.6, 0, 0.7, 0.4, 20), B('#55555c', 0, 2.6, i * 2.2, 20, 0.4, 0.7)); } this.ironPivot.add(V.mesh(grid, u));
    this.lid = new THREE.Group(); this.lid.position.set(0, 0.06, -0.26);
    this.lid.add(V.mesh([B('#3a3a40', 0, 0, 13, 26, 3, 26), B('#e0574f', 0, 3, 24, 8, 2, 3), B('#3a3a40', 0, 3, 13, 10, 1, 10)], u));
    this.ironLight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.05), new THREE.MeshBasicMaterial({ color: '#552222' })); this.ironLight.position.set(0.18, 0.075, 0.42); this.lid.add(this.ironLight);
    this.lid.rotation.x = -1.9; this.ironPivot.add(this.lid);
    this.ironBatter = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.34), M('#f7e6b8')); this.ironBatter.position.y = 0.075; this.ironBatter.visible = false; this.ironPivot.add(this.ironBatter);
    this.ironWaffle = V.waffle(0.028); this.ironWaffle.position.y = 0.06; this.ironWaffle.visible = false; this.ironPivot.add(this.ironWaffle);
    reg(ironG, 'iron', 'Waffle iron'); this.ironG = ironG;
    // plate & waffle
    const plate = new THREE.Group(); plate.add(V.mesh([B(P.white, 0, 0, 0, 20, 1, 20), B('#4a7fd6', 0, 1, 0, 20.4, 0.4, 20.4), B(P.white, 0, 0.5, 0, 16, 1, 16)], u)); plate.position.set(1.2, TOP, 0.28); S.add(plate);
    this.plateWaffle = V.waffle(0.028); this.plateWaffle.position.set(1.2, TOP + 0.04, 0.28); this.plateWaffle.visible = false; S.add(this.plateWaffle);
    this.toppingMeshes = {};
    // toppings tray
    const keys = Object.keys(V.TOPPINGS);
    keys.forEach((k, i) => {
      const t = V.TOPPINGS[k]; const col = i % 4, row = Math.floor(i / 4);
      const g = new THREE.Group();
      g.add(V.mesh([B('#f4e9d8', 0, 0, 0, 7, 3, 7), B(t.color, 0, 3, 0, 5.4, 1.6, 5.4), B('#c98f5a', 0, 0, 0, 7.4, 0.6, 7.4)], u));
      g.position.set(0.72 + col * 0.33, TOP, -0.34 + row * 0.24); reg(g, 'top:' + k, t.name);
    });
    // delivery box
    const bx = new THREE.Group();
    bx.add(V.mesh([B(P.cream, 0, 0, 0, 18, 1, 18), B(P.cream, -8.5, 1, 0, 1, 9, 18), B(P.cream, 8.5, 1, 0, 1, 9, 18), B(P.cream, 0, 1, -8.5, 18, 9, 1), B(P.cream, 0, 1, 8.5, 18, 9, 1), B(P.red, 0, 4, 9.2, 18.2, 1.4, 0.3)], u));
    this.boxLid = new THREE.Group(); this.boxLid.position.set(0, 0.2, -0.17);
    this.boxLid.add(V.mesh([B(P.cream, 0, 0, 8.5, 18.4, 1, 18.4), B(P.gold, 0, 1, 8.5, 7, 0.8, 7), B(P.brown, 0, 1.8, 8.5, 5, 0.3, 0.6), B(P.brown, 0, 1.8, 8.5, 0.6, 0.3, 5)], u));
    this.boxLid.rotation.x = -2.2; bx.add(this.boxLid);
    bx.position.set(2.1, TOP, 0.12); reg(bx, 'box', 'Delivery box'); this.box = bx;
    this.boxCount = new THREE.Group(); this.boxCount.position.set(2.1, TOP + 0.3, 0.12); S.add(this.boxCount);
    this.ticketPin = null;
  }
  windowTexture() {
    const c = document.createElement('canvas'); c.width = 96; c.height = 64; const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 64); grd.addColorStop(0, '#6fb3e8'); grd.addColorStop(1, '#ffd9b3'); g.fillStyle = grd; g.fillRect(0, 0, 96, 64);
    g.fillStyle = '#fff3c0'; g.fillRect(70, 8, 10, 10);
    g.fillStyle = '#b9b2a8'; g.beginPath(); g.moveTo(20, 40); g.quadraticCurveTo(38, 8, 50, 40); g.fill(); g.fillStyle = '#cfc8bd'; g.fillRect(20, 20, 6, 20);
    g.fillStyle = '#4f9a5c'; g.beginPath(); g.moveTo(0, 64); g.lineTo(0, 44); g.lineTo(30, 36); g.lineTo(60, 44); g.lineTo(96, 38); g.lineTo(96, 64); g.fill();
    g.fillStyle = '#3f7d4e'; for (let i = 0; i < 9; i++) { const x = 4 + i * 11, h = 8 + (i % 3) * 4; g.beginPath(); g.moveTo(x, 50); g.lineTo(x + 4, 50 - h); g.lineTo(x + 8, 50); g.fill(); }
    g.fillStyle = '#7ec850'; g.fillRect(0, 52, 96, 12);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  // ---------------- helpers ----------------
  tween(obj, prop, to, dur, cb, ease) { const src = obj[prop]; const from = new THREE.Vector3(src.x, src.y, src.z); this.tweens.push({ obj, prop, from, to: new THREE.Vector3(to.x ?? from.x, to.y ?? from.y, to.z ?? from.z), t: 0, dur, cb, ease: ease || FW.U.easeInOut }); }
  updateTweens(dt) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i]; tw.t += dt; const p = tw.ease(Math.min(1, tw.t / tw.dur));
      const v = tw.from.clone().lerp(tw.to, p);
      if (tw.prop === 'rotation') tw.obj.rotation.set(v.x, v.y, v.z); else tw.obj[tw.prop].copy(v);
      if (tw.t >= tw.dur) { this.tweens.splice(i, 1); if (tw.cb) tw.cb(); }
    }
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i]; f.t += dt; const p = Math.min(1, f.t / f.dur);
      f.m.position.lerpVectors(f.from, f.to, p); f.m.position.y += Math.sin(p * Math.PI) * 0.35; f.m.rotation.x += dt * 8; f.m.rotation.z += dt * 5;
      if (p >= 1) { this.scene.remove(f.m); this.flying.splice(i, 1); if (f.cb) f.cb(); }
    }
  }
  zoneScore(v, a, b) { if (v >= a && v <= b) return 1 - 0.3 * Math.abs(v - (a + b) / 2) / ((b - a) / 2); const out = v < a ? a - v : v - b; return Math.max(0, 0.7 - (out / 25) * 0.7); }
  setHint(h) { FW.HUD.hint(h); }
  progress() { if (this.onProgress) this.onProgress({ index: this.index, made: this.made, counts: this.cur ? this.cur.counts : null, toppings: this.cur ? this.cur.toppings : null }); }
  duckLookAt(x) { this.duckLookX = x; }

  // ---------------- flow ----------------
  startOrder(order) {
    this.order = order; this.index = 0; this.made = [];
    this.boxCount.clear(); this.boxLid.rotation.x = -2.2;
    this.beginWaffle();
  }
  beginWaffle() {
    this.cur = { counts: { flour: 0, sugar: 0, egg: 0, milk: 0 }, whisk: 0, whisked: false, flip: 0, cook: 0, toppings: new Set(), doneness: 0.5 };
    this.state = 'mixing'; this.cook = 0; this.whiskMeter = 0;
    this.batter.visible = false; this.batter.scale.set(1, 1, 1); this.batter.material.color.set('#f7e6b8');
    this.ironBatter.visible = false; this.ironWaffle.visible = false; this.plateWaffle.visible = false;
    for (const k in this.toppingMeshes) { this.plateWaffle.remove(this.toppingMeshes[k]); } this.toppingMeshes = {};
    this.ironPivot.rotation.x = 0; this.lid.rotation.x = -1.9; this.ironLight.material.color.set('#552222');
    this.whisk.visible = true;
    const r = this.order.waffles[this.index].recipe;
    this.setHint(`Waffle ${this.index + 1}/${this.order.waffles.length}: <b>${FW.HUD.esc(r.name)}</b> — click ingredients into the bowl, then <b>hold the bowl</b> (or Space) to whisk`);
    FW.HUD.meter(false); this.progress();
    FW.Audio.sfx.bell();
  }
  addIngredient(k, fromObj) {
    if (this.state !== 'mixing') return;
    const c = this.cur.counts; if (c[k] >= 5) { FW.HUD.popup('Bowl is full!', 'bad small'); return; }
    c[k]++; FW.Audio.sfx.add();
    const col = FW.Orders.ING[k].color;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), FW.Pixel.mat(col)); m.castShadow = true;
    const from = fromObj.position.clone().add(new THREE.Vector3(0, 0.25, 0.05)); const to = this.bowl.position.clone().add(new THREE.Vector3(0, 0.12, 0));
    m.position.copy(from); this.scene.add(m);
    this.flying.push({ m, from, to, t: 0, dur: 0.45, cb: () => { this.updateBatter(); this.fx.burst(to.x, to.y, to.z, 5, { color: col, speed: 0.6, up: 1, life: 0.4, size: 0.03, extra: { gravity: 4 } }); } });
    this.progress();
  }
  updateBatter() {
    const c = this.cur.counts, total = c.flour + c.sugar + c.egg + c.milk;
    if (!total) { this.batter.visible = false; return; }
    this.batter.visible = true; const h = Math.min(0.09, 0.015 * total); this.batter.scale.set(1, h / 0.02, 1); this.batter.position.y = 0.03 + h / 2;
    const col = new THREE.Color('#f7e6b8'); col.lerp(new THREE.Color('#f7d84a'), Math.min(0.5, c.egg * 0.18)); col.lerp(new THREE.Color('#ffffff'), Math.min(0.4, c.milk * 0.12 + c.flour * 0.05));
    this.batter.material.color.copy(col);
  }
  finishWhisk() {
    const m = this.whiskMeter; let s, txt, cls;
    if (m >= 70 && m <= 100) { s = 1; txt = 'Smooth batter!'; cls = 'gold'; FW.Audio.sfx.ding(); }
    else if (m < 70) { s = 0.5 + 0.5 * (m / 70); txt = 'Lumpy batter...'; cls = 'bad'; }
    else { s = Math.max(0.4, 1 - (m - 100) / 40); txt = 'Overmixed!'; cls = 'bad'; }
    this.cur.whisk = s; this.cur.whisked = true; this.state = 'mixed';
    FW.HUD.popup(txt, cls); FW.HUD.meter(false);
    this.setHint('Batter ready! Click the <b>waffle iron</b> to pour');
    this.fx.burst(this.bowl.position.x, this.bowl.position.y + 0.2, this.bowl.position.z, 8, { color: '#fff6a8', speed: 0.6, up: 1.2, life: 0.6, size: 0.03 });
  }
  pour() {
    if (!this.cur.whisked) { this.cur.whisk = 0.35; FW.HUD.popup('Unmixed batter...', 'bad small'); }
    const total = Object.values(this.cur.counts).reduce((a, b) => a + b, 0);
    if (total === 0) { FW.HUD.popup('The bowl is empty!', 'bad small'); return; }
    this.state = 'pouring'; FW.Audio.sfx.pour();
    this.batter.visible = false; this.whisk.visible = false;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.12), FW.Pixel.mat(this.batter.material.color.getHex()));
    const from = this.bowl.position.clone().add(new THREE.Vector3(0, 0.15, 0)), to = this.ironG.position.clone().add(new THREE.Vector3(0, 0.2, 0));
    m.position.copy(from); this.scene.add(m);
    this.flying.push({ m, from, to, t: 0, dur: 0.5, cb: () => {
      this.ironBatter.visible = true; this.ironBatter.material.color.copy(this.batter.material.color);
      this.tween(this.lid, 'rotation', { x: 0 }, 0.45, () => { this.state = 'cooking1'; this.cook = 0; this.ironLight.material.color.set('#e0574f'); FW.Audio.setSizzle(1); this.setHint('Cooking… <b>flip</b> the iron (click it or press Space) when the meter is in the <b>golden zone</b>!'); });
    } });
  }
  flip() {
    const score = this.zoneScore(this.cook, 55, 80);
    this.cur.flip = score; this.cur.cook1 = this.cook; this.state = 'flipping'; FW.Audio.sfx.flip();
    FW.HUD.popup(score > 0.95 ? 'PERFECT FLIP!' : score > 0.7 ? 'Nice flip!' : this.cook < 55 ? 'Too early...' : 'A bit late!', score > 0.7 ? 'gold' : 'bad');
    FW.HUD.meter(false);
    this.duckHop = 0.4;
    this.tween(this.ironPivot, 'rotation', { x: Math.PI }, 0.55, () => { this.state = 'cooking2'; this.cook = 0; this.setHint('Second side… <b>open</b> the iron (click / Space) in the golden zone!'); }, (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  }
  open() {
    const score = this.zoneScore(this.cook, 50, 80);
    this.cur.cook = score;
    const d = FW.U.clamp(((this.cur.cook1 / 100) + (this.cook / 100)) / 2 * 0.77, 0, 1); this.cur.doneness = d;
    this.state = 'opening'; FW.Audio.setSizzle(0); FW.Audio.sfx.flip();
    FW.HUD.popup(score > 0.95 ? 'GOLDEN!' : score > 0.7 ? 'Looks great!' : this.cook < 50 ? 'Still pale...' : 'Oops, a bit dark', score > 0.7 ? 'gold' : 'bad');
    FW.HUD.meter(false); this.ironLight.material.color.set('#552222');
    this.tween(this.ironPivot, 'rotation', { x: Math.PI * 2 }, 0.5, () => {
      this.ironPivot.rotation.x = 0;
      this.tween(this.lid, 'rotation', { x: -1.9 }, 0.4, () => {
        this.ironBatter.visible = false; this.ironWaffle.visible = true; this.ironWaffle.userData.setDoneness(d);
        this.fx.burst(this.ironG.position.x, this.ironG.position.y + 0.3, this.ironG.position.z, 10, { color: '#ffffff', speed: 0.5, up: 1.5, life: 1, size: 0.05, extra: { gravity: -0.5 } });
        setTimeout(() => {
          this.ironWaffle.visible = false; this.plateWaffle.visible = true; this.plateWaffle.userData.setDoneness(d);
          const to = this.plateWaffle.position.clone(); this.plateWaffle.position.copy(this.ironG.position).add(new THREE.Vector3(0, 0.2, 0));
          this.tween(this.plateWaffle, 'position', to, 0.5, () => { this.state = 'topping'; this.setHint('Add <b>toppings</b> from the tray to match the ticket (click again to remove), then click the <b>delivery box</b>'); FW.Audio.sfx.pop(); });
        }, 350);
      });
    });
  }
  toggleTopping(k) {
    const T = this.cur.toppings;
    if (T.has(k)) { T.delete(k); this.plateWaffle.remove(this.toppingMeshes[k]); delete this.toppingMeshes[k]; FW.Audio.sfx.pop(); }
    else {
      if (T.size >= 4) { FW.HUD.popup('That is plenty of toppings!', 'bad small'); return; }
      T.add(k); const m = FW.Voxel.toppingMesh(k, 0.028); m.position.y = this.plateWaffle.userData.top; this.plateWaffle.add(this.toppingMeshes[k] = m); FW.Audio.sfx.add();
      this.fx.burst(this.plateWaffle.position.x, this.plateWaffle.position.y + 0.15, this.plateWaffle.position.z, 4, { color: FW.Voxel.TOPPINGS[k].color, speed: 0.4, up: 0.8, life: 0.4, size: 0.03 });
    }
    this.progress();
  }
  pack() {
    if (this.state !== 'topping') return;
    this.state = 'packing';
    const recipe = this.order.waffles[this.index].recipe;
    const res = FW.Orders.scoreWaffle(recipe, this.cur); this.made.push(res);
    const to = this.box.position.clone().add(new THREE.Vector3(0, 0.08 + this.index * 0.05, 0));
    this.tween(this.plateWaffle, 'position', to, 0.5, () => {
      this.plateWaffle.visible = false;
      const w = FW.Voxel.waffle(0.02); w.userData.setDoneness(this.cur.doneness); w.position.set(0, -0.2 + this.index * 0.05, 0); this.boxCount.add(w);
      this.tween(this.boxLid, 'rotation', { x: 0 }, 0.3, () => {
        FW.Audio.sfx.stamp(); this.fx.burst(this.box.position.x, this.box.position.y + 0.3, this.box.position.z, 8, { color: ['#f3c34a', '#ffffff'], speed: 0.8, up: 1.5, life: 0.6, size: 0.04 });
        const stars = Math.round(res.quality * 5);
        FW.HUD.popup(`${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}  ${res.notes[0]}`, res.quality > 0.75 ? 'gold' : res.quality > 0.45 ? '' : 'bad');
        if (res.quality > 0.75) FW.Audio.sfx.happy();
        this.index++; this.progress();
        this.waitTimer = 1.3; this.state = 'wait';
      });
    });
  }
  // ---------------- per-frame ----------------
  update(dt, inp) {
    const U = FW.U; this.t += dt;
    this.updateTweens(dt); this.fx.update(dt);
    // hover
    const m = inp.mouse;
    this.ray.setFromCamera({ x: m.nx, y: m.ny }, this.camera);
    const hits = this.ray.intersectObjects(this.interactives, true);
    let hov = null;
    if (hits.length) { let o = hits[0].object; while (o && !o.userData.root) o = o.parent; hov = o; }
    if (hov !== this.hover) {
      if (this.hover) this.hover.traverse((o) => { if (o.material && o.material.emissive) o.material.emissive.set('#000000'); });
      this.hover = hov;
      if (hov) { hov.traverse((o) => { if (o.material && o.material.emissive) { o.material.emissive.set('#ffb060'); o.material.emissiveIntensity = 0.25; } }); document.getElementById('game').style.cursor = 'pointer'; }
      else document.getElementById('game').style.cursor = 'crosshair';
    }
    FW.HUD.tooltip(hov ? hov.userData.label : '', m.x, m.y);
    if (hov) this.duckLookX = hov.position.x; else this.duckLookX = U.damp(this.duckLookX || 0.15, 0.15, 2, dt);
    // clicks
    const act = hov && m.clicked ? hov.userData.action : null;
    if (act) {
      if (['flour', 'sugar', 'egg', 'milk'].includes(act)) this.addIngredient(act, hov);
      else if (act === 'iron') { if (this.state === 'mixing' || this.state === 'mixed') this.pour(); else if (this.state === 'cooking1') this.flip(); else if (this.state === 'cooking2') this.open(); }
      else if (act.startsWith('top:')) { if (this.state === 'topping') this.toggleTopping(act.slice(4)); else FW.HUD.popup('Cook a waffle first!', 'small'); }
      else if (act === 'box') { if (this.state === 'topping') this.pack(); else if (this.state === 'mixing' || this.state === 'mixed') FW.HUD.popup('Nothing to pack yet!', 'small'); }
    }
    if (inp.pressed('flip')) { if (this.state === 'cooking1') this.flip(); else if (this.state === 'cooking2') this.open(); }
    // whisking (hold on the bowl or hold Space while mixing)
    const total = this.cur ? Object.values(this.cur.counts).reduce((a, b) => a + b, 0) : 0;
    const whiskHeld = this.state === 'mixing' && total > 0 && ((hov && hov.userData.action === 'bowl' && m.down) || inp.held('flip'));
    if (whiskHeld || this.state === 'whisking') {
      if (whiskHeld) {
        this.state = 'whisking'; this.whiskMeter += 42 * dt;
        this.whisk.rotation.y += dt * 25; this.whisk.position.x = 0.05 + Math.sin(this.t * 25) * 0.05; this.whisk.position.z = Math.cos(this.t * 25) * 0.05;
        if (Math.random() < dt * 20) this.fx.spawn({ x: this.bowl.position.x + (Math.random() - 0.5) * 0.2, y: this.bowl.position.y + 0.14, z: this.bowl.position.z + (Math.random() - 0.5) * 0.2, vy: 0.8, vx: (Math.random() - 0.5) * 0.4, vz: (Math.random() - 0.5) * 0.4, life: 0.4, size: 0.025, color: '#f7e6b8', gravity: 4 });
        FW.HUD.meter(true, 'WHISK — release in the green zone', this.whiskMeter, [70, 100], this.whiskMeter > 100 ? 'careful!' : '');
        if (this.whiskMeter >= 120) this.finishWhisk();
      } else this.finishWhisk();
    } else if (this.state === 'mixing' && this.cur) {
      if (total > 0) FW.HUD.meter(true, 'WHISK — hold the bowl / Space', 0, [70, 100], 'add ingredients, then whisk'); else FW.HUD.meter(false);
    }
    // cooking meters
    if (this.state === 'cooking1' || this.state === 'cooking2') {
      const rate = this.state === 'cooking1' ? 18 : 22;
      this.cook += rate * dt;
      const zone = this.state === 'cooking1' ? [55, 80] : [50, 80];
      const inZone = this.cook >= zone[0] && this.cook <= zone[1];
      this.ironLight.material.color.set(inZone ? '#7ed37a' : this.cook > zone[1] ? '#2b1a10' : '#e0574f');
      FW.HUD.meter(true, this.state === 'cooking1' ? 'FLIP (click iron / Space)' : 'OPEN (click iron / Space)', this.cook, zone, inZone ? 'NOW!' : this.cook > zone[1] ? 'it is burning!' : 'wait for it...');
      if (Math.random() < dt * 12) this.fx.spawn({ x: this.ironG.position.x + (Math.random() - 0.5) * 0.3, y: this.ironG.position.y + 0.25, z: this.ironG.position.z + (Math.random() - 0.5) * 0.3, vy: 0.6 + Math.random() * 0.4, vx: (Math.random() - 0.5) * 0.2, vz: (Math.random() - 0.5) * 0.2, life: 1.2, size: 0.05, color: '#ffffff', gravity: -0.4, shrink: false });
      FW.Audio.setSizzle(inZone ? 1.3 : 1);
      if (this.cook > 125) { if (this.state === 'cooking1') this.flip(); else this.open(); }
      if (this.cook > 90 && Math.random() < dt * 6) this.fx.spawn({ x: this.ironG.position.x, y: this.ironG.position.y + 0.3, z: this.ironG.position.z, vy: 0.8, life: 1.4, size: 0.07, color: '#5a5a5a', gravity: -0.5, shrink: false });
    }
    if (this.state === 'wait') { this.waitTimer -= dt; if (this.waitTimer <= 0) { if (this.index < this.order.waffles.length) this.beginWaffle(); else { this.state = 'done'; FW.HUD.meter(false); this.setHint(''); if (this.onDone) this.onDone(this.made); } } }
    // duck animation
    const d = this.duck; d.position.y = 0.22 + Math.sin(this.t * 2.2) * 0.015;
    this.duckHop = Math.max(0, (this.duckHop || 0) - dt); if (this.duckHop > 0) d.position.y += Math.sin((this.duckHop / 0.4) * Math.PI) * 0.15;
    const lookX = this.duckLookX ?? 0.15; d.userData.head.rotation.y = U.damp(d.userData.head.rotation.y, U.clamp((lookX + 0.42) * 0.5, -0.7, 0.7), 8, dt);
    d.userData.head.rotation.x = U.damp(d.userData.head.rotation.x, hov ? 0.25 : 0.1, 6, dt);
    const w = d.userData.wings;
    if (this.state === 'whisking') { w[0].rotation.z = 0.9 + Math.sin(this.t * 22) * 0.4; w[1].rotation.z = -0.9 - Math.sin(this.t * 22 + 1) * 0.4; }
    else if (this.state === 'cooking1' || this.state === 'cooking2') { w[0].rotation.z = 0.4 + Math.sin(this.t * 3) * 0.1; w[1].rotation.z = -0.4 - Math.sin(this.t * 3) * 0.1; }
    else { w[0].rotation.z = U.damp(w[0].rotation.z, Math.sin(this.t * 1.5) * 0.08, 6, dt); w[1].rotation.z = -w[0].rotation.z; }
    d.userData.scarf.rotation.x = Math.sin(this.t * 1.7) * 0.08;
    this.lights.forEach((l, i) => { l.material.color.offsetHSL(0, 0, 0); l.scale.setScalar(0.85 + 0.15 * Math.sin(this.t * 3 + i)); });
    this.clockHand.rotation.z = -this.t * 0.2;
  }
  render(renderer) { renderer.render(this.scene, this.camera); }
};
