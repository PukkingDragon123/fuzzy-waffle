// Flippin' Waffles — renderer, PBR-ish lighting setup, and the pixel post-process filter.
// The 3D world is modelled and lit smoothly/roundly; the pixel look is a filter applied
// at composite time (low-res render target -> bloom -> quantise -> nearest-neighbour upscale).
window.FW = window.FW || {};

FW.Pixel = (() => {
  let renderer = null, rt = null, brightRT = null, blurA = null, blurB = null;
  let postScene, postCam, postMat, brightMat, blurMat, quad;
  let pmrem = null, envOutdoor = null, envIndoor = null;
  const size = { W: 320, H: 180, aspect: 16 / 9, scale: 3, w: 1280, h: 720 };
  const PIXEL = 3.4;           // on-screen size of one rendered pixel
  const MAXH = 320;            // never render taller than this internally

  // ---------- shaders ----------
  const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const BRIGHT = `
    uniform sampler2D tDiffuse; uniform float threshold; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float k = smoothstep(threshold, threshold + 0.35, l);
      gl_FragColor = vec4(c * k, 1.0);
    }`;
  const BLUR = `
    uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;
    void main(){
      vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
      s += texture2D(tDiffuse, vUv + dir * 1.3846153846).rgb * 0.3162162162;
      s += texture2D(tDiffuse, vUv - dir * 1.3846153846).rgb * 0.3162162162;
      s += texture2D(tDiffuse, vUv + dir * 3.2307692308).rgb * 0.0702702703;
      s += texture2D(tDiffuse, vUv - dir * 3.2307692308).rgb * 0.0702702703;
      gl_FragColor = vec4(s, 1.0);
    }`;
  // Composite: bloom + gentle warm grade + colour quantisation + soft vignette.
  const POST = `
    uniform sampler2D tDiffuse; uniform sampler2D tBloom;
    uniform float bloom; uniform float levels; uniform float vignette; uniform float warm; uniform float sat;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c += texture2D(tBloom, vUv).rgb * bloom;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, sat);
      // warm filmic lift: shadows toward plum, highlights toward butter
      vec3 lift = vec3(0.035, 0.020, 0.045) * warm;
      vec3 gain = vec3(1.020, 1.000, 0.960);
      c = (c + lift * (1.0 - c)) * mix(vec3(1.0), gain, warm);
      c = clamp(c, 0.0, 1.0);
      // quantise (the "pixel art palette" half of the filter), with a touch of ordered dither
      vec2 p = floor(gl_FragCoord.xy);
      float d = mod(p.x + mod(p.y, 2.0) * 2.0, 4.0) / 4.0 - 0.375;
      c = floor(c * levels + 0.5 + d * 0.7) / levels;
      float v = distance(vUv, vec2(0.5)) ;
      c *= 1.0 - vignette * smoothstep(0.42, 0.95, v);
      gl_FragColor = vec4(c, 1.0);
    }`;

  function init(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postScene = new THREE.Scene();
    postMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: POST, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, tBloom: { value: null }, bloom: { value: 0.4 }, levels: { value: 24.0 }, vignette: { value: 0.2 }, warm: { value: 1.0 }, sat: { value: 1.22 } } });
    brightMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BRIGHT, depthTest: false, depthWrite: false, uniforms: { tDiffuse: { value: null }, threshold: { value: 0.82 } } });
    blurMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BLUR, depthTest: false, depthWrite: false, uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } } });
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
    quad.frustumCulled = false;
    postScene.add(quad);

    pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    envOutdoor = buildEnv(['#bfe4ff', '#8ec9f0', '#ffe6c4', '#8fae72'], 0.72);
    envIndoor = buildEnv(['#ffe9cc', '#ffd9a8', '#f2c98d', '#b98d5f'], 0.3);

    resize();
    window.addEventListener('resize', resize);
    return renderer;
  }

  // A tiny painted "studio" turned into an IBL probe: gives round models soft
  // directional falloff and a believable sheen instead of flat toon banding.
  function buildEnv(cols, mul) {
    const s = new THREE.Scene();
    const g = new THREE.SphereGeometry(10, 16, 10);
    const col = new Float32Array(g.attributes.position.count * 3);
    const c = new THREE.Color(), top = new THREE.Color(cols[0]), mid = new THREE.Color(cols[1]), hor = new THREE.Color(cols[2]), gnd = new THREE.Color(cols[3]);
    for (let i = 0; i < g.attributes.position.count; i++) {
      const y = g.attributes.position.getY(i) / 10;
      if (y > 0.35) c.copy(mid).lerp(top, (y - 0.35) / 0.65);
      else if (y > -0.02) c.copy(hor).lerp(mid, y / 0.37);
      else c.copy(gnd);
      c.multiplyScalar(mul);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    s.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const sun = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    sun.position.set(4, 6, 3); sun.scale.setScalar(1.2); s.add(sun);
    const t = pmrem.fromScene(s, 0.04).texture;
    g.dispose();
    return t;
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    size.w = w; size.h = h;
    // one rendered pixel is ~PIXEL screen pixels, targeting a fixed vertical resolution
    size.scale = Math.max(2, Math.min(6, Math.round(h / 240)));
    size.H = Math.min(MAXH, Math.ceil(h / size.scale));
    size.scale = h / size.H;
    size.W = Math.ceil(w / size.scale);
    size.aspect = size.W / size.H;
    renderer.setSize(w, h, false);
    for (const t of [rt, brightRT, blurA, blurB]) if (t) t.dispose();
    const opts = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType, colorSpace: THREE.SRGBColorSpace, depthBuffer: true };
    rt = new THREE.WebGLRenderTarget(size.W, size.H, opts);
    const bw = Math.max(8, Math.floor(size.W / 2)), bh = Math.max(8, Math.floor(size.H / 2));
    const bopts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType, colorSpace: THREE.SRGBColorSpace, depthBuffer: false };
    brightRT = new THREE.WebGLRenderTarget(bw, bh, bopts);
    blurA = new THREE.WebGLRenderTarget(bw, bh, bopts);
    blurB = new THREE.WebGLRenderTarget(bw, bh, bopts);
    postMat.uniforms.tDiffuse.value = rt.texture;
    postMat.uniforms.tBloom.value = blurB.texture;
    FW.events.emit('resize', size);
  }

  function pass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(postScene, postCam);
  }

  function render(scene, camera) {
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);
    brightMat.uniforms.tDiffuse.value = rt.texture;
    pass(brightMat, brightRT);
    blurMat.uniforms.tDiffuse.value = brightRT.texture;
    blurMat.uniforms.dir.value.set(1 / brightRT.width, 0);
    pass(blurMat, blurA);
    blurMat.uniforms.tDiffuse.value = blurA.texture;
    blurMat.uniforms.dir.value.set(0, 1 / brightRT.height);
    pass(blurMat, blurB);
    renderer.setRenderTarget(null);
    pass(postMat, null);
    quad.material = postMat;
  }

  // ---------- shared materials ----------
  const cache = {};
  function fam(name) {
    if (cache[name]) return cache[name];
    const base = { vertexColors: true, envMapIntensity: 0.75 };
    let m;
    switch (name) {
      case 'soft': m = new THREE.MeshStandardMaterial({ ...base, roughness: 0.78, metalness: 0.0 }); break;
      case 'shiny': m = new THREE.MeshStandardMaterial({ ...base, roughness: 0.32, metalness: 0.04, envMapIntensity: 1.05 }); break;
      case 'metal': m = new THREE.MeshStandardMaterial({ ...base, roughness: 0.26, metalness: 0.9, envMapIntensity: 1.2 }); break;
      case 'glow': m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }); break;
      case 'glass': m = new THREE.MeshStandardMaterial({ ...base, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.55, envMapIntensity: 1.4 }); break;
      case 'shell': m = new THREE.MeshStandardMaterial({ ...base, roughness: 0.34, metalness: 0.02, side: THREE.DoubleSide, envMapIntensity: 1.0 }); break;
      case 'shellMatte': m = new THREE.MeshStandardMaterial({ ...base, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide }); break;
      default: m = new THREE.MeshStandardMaterial({ ...base, roughness: 0.95, metalness: 0.0 });
    }
    return (cache[name] = m);
  }
  const mat = (color, opts = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.9, metalness: 0, envMapIntensity: 0.75 }, opts));
  const vmat = (opts = {}) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.7 }, opts));
  const flat = (color, opts = {}) => new THREE.MeshBasicMaterial(Object.assign({ color, toneMapped: false }, opts));

  // ---------- textures ----------
  function textTexture(text, opts = {}) {
    const { w = 256, h = 64, bg = '#f7e7c6', fg = '#6b4423', font = 'bold 40px monospace', border = '#3d2314', radius = 10 } = opts;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = bg;
    if (g.roundRect) { g.beginPath(); g.roundRect(0, 0, w, h, radius); g.fill(); } else g.fillRect(0, 0, w, h);
    if (border) { g.strokeStyle = border; g.lineWidth = 7; if (g.roundRect) { g.beginPath(); g.roundRect(3.5, 3.5, w - 7, h - 7, radius); g.stroke(); } else g.strokeRect(3.5, 3.5, w - 7, h - 7); }
    g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function stripeTexture(colors, w = 8, h = 64) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const n = colors.length, bh = h / n;
    for (let i = 0; i < n; i++) { g.fillStyle = colors[i]; g.fillRect(0, i * bh, w, bh + 1); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function chevronTexture() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#f0872a'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#ffe6a0'; g.lineWidth = 9; g.lineCap = 'round';
    for (let i = -1; i < 3; i++) { const y = i * 24; g.beginPath(); g.moveTo(6, y + 22); g.lineTo(32, y + 2); g.lineTo(58, y + 22); g.stroke(); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function spiralTexture(a = '#ff8fb0', b = '#fffdf6') {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = b; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = a; g.lineWidth = 13; g.lineCap = 'round';
    g.beginPath();
    for (let t = 0; t < Math.PI * 6; t += 0.12) { const r = t * 3.1; const x = 64 + Math.cos(t) * r, y = 64 + Math.sin(t) * r; t === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke();
    const t2 = new THREE.CanvasTexture(c); t2.colorSpace = THREE.SRGBColorSpace; t2.anisotropy = 4;
    return t2;
  }

  return { init, render, size, fam, mat, vmat, flat, textTexture, stripeTexture, chevronTexture, spiralTexture,
    get renderer() { return renderer; }, get envOutdoor() { return envOutdoor; }, get envIndoor() { return envIndoor; } };
})();

// ---------- palette: "Sunday-morning plush" ----------
FW.PAL = {
  duck: '#fffdf6', duckShade: '#f0e6d2', beak: '#f9a23f', beakDark: '#e0862a', eye: '#3b2a2a', blush: '#ffb3b3', white: '#fffdf6',
  apron: '#e5564a', apronTrim: '#fff3dc', hatA: '#fff3dc', hatB: '#e5564a', hatC: '#f7c544', hatD: '#7fd1c0', prop: '#4fb3d9',
  candy: '#ff8fb0', stick: '#fff3dc',
  mint: '#7fd1c0', mintDark: '#5cb6a5', steel: '#c8ccd8', cream: '#fff3dc', red: '#e5564a', gold: '#f7c544', brown: '#8a5a2b', wood: '#b07c4a', wood2: '#96663a',
  bear: '#7a5334', bearLight: '#9b7250', muzzle: '#d8b489', tan: '#c9a177',
  pine: ['#2f6b4a', '#3f8a57', '#256045', '#5fae6e'], trunk: '#7a5334', sequoia: '#9c5636', seqGreen: '#356f4d', aspen: '#b9d35a', aspenGold: '#e8b04b', aspenTrunk: '#efe9dc',
  granite: ['#b3aec2', '#c2bccd', '#a49eb4'], snow: '#f6f7fb',
  grass: ['#6fb74e', '#75bc52', '#7cc257', '#6ab24d'], dirt: ['#c09161', '#b3855a', '#cb9c6b'], road: ['#736f80', '#6b6778', '#7c7889'], shoulder: '#cbbb94', line: '#f7d774', sand: '#e6d8ab', water: '#5cb3e8', riverbed: '#7e9a70',
  tent: ['#f0872a', '#3aa6a6', '#e5564a', '#8f6cd0', '#4f9a5c'],
  syrup: '#8a4b1a', butter: '#ffdf7e',
};

// ---------- round particle system ----------
FW.Particles = class {
  constructor(scene, count = 600) {
    this.count = count;
    const geo = new THREE.SphereGeometry(0.5, 6, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.p = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._v = new THREE.Vector3(); this._e = new THREE.Euler(); this._c = new THREE.Color();
    for (let i = 0; i < count; i++) { this.p.push({ life: 0, idx: i }); this.mesh.setMatrixAt(i, this._m.makeScale(0, 0, 0)); this.mesh.setColorAt(i, this._c.set('#ffffff')); }
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
    this.next = 0;
    scene.add(this.mesh);
  }
  spawn(o) {
    const i = this.next; this.next = (this.next + 1) % this.count;
    const p = this.p[i];
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = p.maxLife = o.life || 0.6;
    p.size = o.size || 0.15; p.shrink = o.shrink !== undefined ? o.shrink : true;
    p.g = o.gravity !== undefined ? o.gravity : 9; p.drag = o.drag !== undefined ? o.drag : 1;
    p.rot = o.rot || 0; p.spin = o.spin || 0; p.stretch = o.stretch || 0;
    p.floor = o.floor;
    this.mesh.setColorAt(i, this._c.set(o.color || '#ffffff'));
    this.mesh.instanceColor.needsUpdate = true;
  }
  burst(x, y, z, n, opts) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (opts.speed || 3) * (0.4 + Math.random() * 0.8);
      this.spawn(Object.assign({ x, y, z, vx: Math.cos(a) * sp, vy: (opts.up || 3) * (0.5 + Math.random()), vz: Math.sin(a) * sp,
        life: (opts.life || 0.7) * (0.6 + Math.random() * 0.6), color: Array.isArray(opts.color) ? opts.color[i % opts.color.length] : opts.color,
        size: (opts.size || 0.15) * (0.6 + Math.random() * 0.8), spin: (Math.random() - 0.5) * 12 }, opts.extra || {}));
    }
  }
  ring(x, y, z, n, opts) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, sp = opts.speed || 3;
      this.spawn(Object.assign({ x, y, z, vx: Math.cos(a) * sp, vy: (opts.up || 0.6), vz: Math.sin(a) * sp, life: opts.life || 0.5,
        color: Array.isArray(opts.color) ? opts.color[i % opts.color.length] : opts.color, size: opts.size || 0.12, gravity: opts.gravity ?? 2 }, opts.extra || {}));
    }
  }
  update(dt) {
    const m = this._m, q = this._q, s = this._s, v = this._v, e = this._e;
    for (let i = 0; i < this.count; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { this.mesh.setMatrixAt(i, m.makeScale(0, 0, 0)); continue; }
      p.vy -= p.g * dt;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.floor !== undefined && p.y < p.floor) { p.y = p.floor; p.vy = Math.abs(p.vy) * 0.35; }
      p.rot += p.spin * dt;
      const t = p.life / p.maxLife;
      const sz = p.shrink ? p.size * (0.25 + 0.75 * t) : p.size;
      e.set(p.rot, p.rot * 0.7, p.rot * 0.4);
      q.setFromEuler(e);
      const st = 1 + p.stretch * Math.min(1, Math.hypot(p.vx, p.vy, p.vz) / 12);
      this.mesh.setMatrixAt(i, m.compose(v.set(p.x, p.y, p.z), q, s.set(sz, sz * st, sz)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
};
