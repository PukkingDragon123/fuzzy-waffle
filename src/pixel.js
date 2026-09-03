// Flippin' Waffles — low-res pixel renderer, toon materials, palette, particles
window.FW = window.FW || {};

FW.Pixel = (() => {
  let renderer = null, gradientMap = null;
  const TARGET_H = 230;           // internal vertical resolution (pixels)
  const size = { W: 320, H: 180, aspect: 16 / 9, scale: 1 };

  function init(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // 4-step gradient for cel shading
    const data = new Uint8Array([70, 70, 70, 255, 140, 140, 140, 255, 205, 205, 205, 255, 255, 255, 255, 255]);
    gradientMap = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.generateMipmaps = false;
    gradientMap.needsUpdate = true;
    resize();
    window.addEventListener('resize', resize);
    return renderer;
  }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    size.scale = Math.max(2, Math.round(h / TARGET_H));
    size.W = Math.max(64, Math.ceil(w / size.scale));
    size.H = Math.max(64, Math.ceil(h / size.scale));
    size.aspect = size.W / size.H;
    renderer.setSize(size.W, size.H, false);
    renderer.domElement.style.width = w + 'px';
    renderer.domElement.style.height = h + 'px';
    FW.events.emit('resize', size);
  }
  const mat = (color, opts = {}) => new THREE.MeshToonMaterial(Object.assign({ color, gradientMap }, opts));
  const vmat = (opts = {}) => new THREE.MeshToonMaterial(Object.assign({ vertexColors: true, gradientMap }, opts));
  const flat = (color, opts = {}) => new THREE.MeshBasicMaterial(Object.assign({ color }, opts));

  // Pixel-text texture (canvas) for signs
  function textTexture(text, opts = {}) {
    const { w = 256, h = 64, bg = '#f7e7c6', fg = '#6b4423', font = 'bold 40px monospace', border = '#3d2314' } = opts;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (border) { g.fillStyle = border; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6); g.fillRect(0, 0, 6, h); g.fillRect(w - 6, 0, 6, h); }
    g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  // Striped scrolling texture (waterfall / boost pad chevrons)
  function stripeTexture(colors, w = 8, h = 64) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const n = colors.length, bh = h / n;
    for (let i = 0; i < n; i++) { g.fillStyle = colors[i]; g.fillRect(0, i * bh, w, bh); }
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function chevronTexture() {
    const c = document.createElement('canvas'); c.width = 32; c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#f28c28'; g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#ffd166';
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const v = (Math.abs(x - 16) + y) % 16; if (v < 5) g.fillRect(x, y, 1, 1); }
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  return { init, size, mat, vmat, flat, textTexture, stripeTexture, chevronTexture, get renderer() { return renderer; }, get gradientMap() { return gradientMap; } };
})();

// Cozy palette
FW.PAL = {
  duck: '#f9d94a', duckDark: '#e3bd2e', beak: '#f28c28', black: '#2b1a10', blush: '#f6a5a5', scarf: '#e0574f', white: '#fffaf0',
  mint: '#9ee0c4', steel: '#c9c9d0', cream: '#f2dfb5', red: '#d94a45', gold: '#f3c34a', brown: '#6b4423', wood: '#a06a3c', wood2: '#8a5a33',
  bear: '#6b4a2e', bearLight: '#8c6543', tan: '#c9a177',
  pine: ['#3f7d4e', '#4f9a5c', '#2f6b43', '#58a866'], trunk: '#6b4a2e', sequoia: '#8b4a2b', seqGreen: '#3e7a4a', aspen: '#b9d35a', aspenGold: '#e3b04b', aspenTrunk: '#e8e2d2',
  granite: ['#a9a49c', '#b8b3ab', '#9a958e'], snow: '#f4f6f8',
  grass: ['#7ec850', '#73bd48', '#8ad25a', '#6fb944'], dirt: ['#b48a5a', '#a67c52', '#c0955f'], road: ['#6d6a72', '#66636b', '#726f78'], shoulder: '#c9b98f', line: '#f0c95c', sand: '#e0d2a4', water: '#5fb3e6', riverbed: '#7a9a6a',
  tent: ['#f28c28', '#3aa6a6', '#d94a45', '#7c5cbf', '#4f9a5c'],
};

// Instanced cube particle system
FW.Particles = class {
  constructor(scene, count = 500) {
    this.count = count;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.p = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._v = new THREE.Vector3(); this._c = new THREE.Color();
    for (let i = 0; i < count; i++) { this.p.push({ life: 0 }); this.mesh.setMatrixAt(i, this._m.makeScale(0, 0, 0)); this.mesh.setColorAt(i, this._c.set('#ffffff')); }
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
    this.next = 0;
    scene.add(this.mesh);
  }
  spawn(o) {
    const p = this.p[this.next]; this.next = (this.next + 1) % this.count;
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = p.maxLife = o.life || 0.6;
    p.size = o.size || 0.15; p.shrink = o.shrink !== undefined ? o.shrink : true;
    p.g = o.gravity !== undefined ? o.gravity : 9; p.drag = o.drag !== undefined ? o.drag : 1;
    p.rot = o.rot || 0; p.spin = o.spin || 0;
    p.floor = o.floor; // optional ground y
    this.mesh.setColorAt(this.p.indexOf(p), this._c.set(o.color || '#ffffff'));
    this.mesh.instanceColor.needsUpdate = true;
  }
  burst(x, y, z, n, opts) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (opts.speed || 3) * (0.4 + Math.random() * 0.8);
      this.spawn(Object.assign({ x, y, z, vx: Math.cos(a) * sp, vy: (opts.up || 3) * (0.5 + Math.random()), vz: Math.sin(a) * sp, life: (opts.life || 0.7) * (0.6 + Math.random() * 0.6), color: Array.isArray(opts.color) ? opts.color[i % opts.color.length] : opts.color, size: (opts.size || 0.15) * (0.6 + Math.random() * 0.8) }, opts.extra || {}));
    }
  }
  update(dt) {
    const m = this._m, q = this._q, s = this._s, v = this._v;
    for (let i = 0; i < this.count; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { this.mesh.setMatrixAt(i, m.makeScale(0, 0, 0)); continue; }
      p.vy -= p.g * dt;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.floor !== undefined && p.y < p.floor) { p.y = p.floor; p.vy = Math.abs(p.vy) * 0.3; }
      p.rot += p.spin * dt;
      const t = p.life / p.maxLife;
      const sz = p.shrink ? p.size * (0.3 + 0.7 * t) : p.size;
      q.setFromEuler(new THREE.Euler(p.rot, p.rot * 0.7, 0));
      this.mesh.setMatrixAt(i, m.compose(v.set(p.x, p.y, p.z), q, s.set(sz, sz, sz)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
};
