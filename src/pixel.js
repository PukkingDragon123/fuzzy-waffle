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
  const MAXH = 1440;           // cap the internal buffer on very tall displays
  // ?lowres=N caps the internal buffer height (headless/software-render testing).
  const LOWRES = (() => { const m = /[?&]lowres=(\d+)/.exec(location.search); return m ? +m[1] : 0; })();

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
      // fine film grain instead of colour quantisation
      vec2 p = gl_FragCoord.xy;
      float g = fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      c += (g - 0.5) * 0.016;
      float v = distance(vUv, vec2(0.5)) ;
      c *= 1.0 - vignette * smoothstep(0.42, 0.95, v);
      gl_FragColor = vec4(c, 1.0);
    }`;

  function init(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(LOWRES ? 1 : Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postScene = new THREE.Scene();
    postMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: POST, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, tBloom: { value: null }, bloom: { value: 0.15 }, levels: { value: 52.0 }, vignette: { value: 0.26 }, warm: { value: 1.0 }, sat: { value: 1.04 } } });
    brightMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BRIGHT, depthTest: false, depthWrite: false, uniforms: { tDiffuse: { value: null }, threshold: { value: 0.94 } } });
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
    // full resolution: no pixel filter any more, just a filmic composite
    size.scale = 1;
    size.H = Math.min(LOWRES || MAXH, h);
    size.scale = h / size.H;
    size.W = Math.ceil(w / size.scale);
    size.aspect = size.W / size.H;
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    for (const t of [rt, brightRT, blurA, blurB]) if (t) t.dispose();
    const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType, colorSpace: THREE.SRGBColorSpace, depthBuffer: true, samples: 2 };
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
      case 'soft': m = new THREE.MeshStandardMaterial({ ...base, map: surfaceTexture(), roughness: 0.78, metalness: 0.0 }); break;
      case 'shiny': m = new THREE.MeshStandardMaterial({ ...base, map: surfaceTexture(), roughness: 0.32, metalness: 0.04, envMapIntensity: 1.05 }); break;
      case 'metal': m = new THREE.MeshStandardMaterial({ ...base, map: surfaceTexture(), roughness: 0.26, metalness: 0.9, envMapIntensity: 1.2 }); break;
      case 'glow': m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }); break;
      case 'glass': m = new THREE.MeshStandardMaterial({ ...base, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.55, envMapIntensity: 1.4 }); break;
      case 'shell': m = new THREE.MeshStandardMaterial({ ...base, map: surfaceTexture(), roughness: 0.34, metalness: 0.02, side: THREE.DoubleSide, envMapIntensity: 1.0 }); break;
      case 'shellMatte': m = new THREE.MeshStandardMaterial({ ...base, map: surfaceTexture(), roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide }); break;
      // cut-out foliage: every leaf card and every trunk shares one atlas, so a
      // whole forest chunk is a single draw call
      case 'leafy': m = new THREE.MeshStandardMaterial({ ...base, map: foliageTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.94, metalness: 0, envMapIntensity: 0.5 }); break;
      default: m = new THREE.MeshStandardMaterial({ ...base, map: surfaceTexture(), roughness: 0.95, metalness: 0.0 });
    }
    return (cache[name] = m);
  }
  const mat = (color, opts = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.9, metalness: 0, envMapIntensity: 0.75 }, opts));
  const vmat = (opts = {}) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.7 }, opts));
  const flat = (color, opts = {}) => new THREE.MeshBasicMaterial(Object.assign({ color, toneMapped: false }, opts));

  // ---------- textures ----------
  // One greyscale atlas drives all foliage. Cell (0,1) is solid, so trunks and
  // twigs can share the material with the cut-out leaf cards.
  let _foliage = null;
  function foliageTexture() {
    if (_foliage) return _foliage;
    const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    const H = S / 2;
    // --- cell (0,0) top-left in UV terms is v 0.5-1: SOLID ---
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, H, H);
    // --- cell (1,0) = conifer needle spray (u .5-1, v .5-1) ---
    g.save(); g.translate(H, 0);
    g.strokeStyle = '#ffffff'; g.lineCap = 'round';
    for (let b = 0; b < 3; b++) {
      const bx = 40 + b * 70, by = H - 8;
      g.lineWidth = 7; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + (b - 1) * 12, 26); g.stroke();
      for (let i = 0; i < 22; i++) {
        const t = i / 21, y = by - t * (by - 30), x = bx + (b - 1) * 12 * t;
        const len = 30 * (1 - t * 0.75) + 6;
        g.lineWidth = 4.6 - t * 2;
        for (const dir of [-1, 1]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + dir * len, y - len * 0.5); g.stroke(); }
      }
    }
    g.restore();
    // --- cell (0,1) = broadleaf cluster (u 0-.5, v 0-.5) ---
    g.save(); g.translate(0, H);
    g.fillStyle = '#ffffff';
    const leaf = (x, y, r, a) => { g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.ellipse(0, 0, r, r * 0.62, 0, 0, 7); g.fill(); g.restore(); };
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + (i % 3) * 0.4;
      const rr = 34 + (i % 4) * 22;
      leaf(H / 2 + Math.cos(a) * rr, H / 2 + Math.sin(a) * rr * 0.85, 26 - (i % 3) * 5, a);
    }
    leaf(H / 2, H / 2, 44, 0.3); leaf(H / 2 - 24, H / 2 + 16, 34, 1.1);
    g.restore();
    // --- cell (1,1) = grass tuft / fern frond (u .5-1, v 0-.5) ---
    g.save(); g.translate(H, H);
    g.strokeStyle = '#ffffff'; g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const x = 22 + i * 13, lean = (i % 5 - 2) * 16, h = 96 + (i % 4) * 46;
      g.lineWidth = 8 - (i % 3) * 1.6;
      g.beginPath(); g.moveTo(x, H - 6); g.quadraticCurveTo(x + lean * 0.5, H - h * 0.6, x + lean, H - h); g.stroke();
    }
    g.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
    _foliage = t; return t;
  }
  // UV rects into the atlas, inset so neighbouring cells never bleed in
  const E = 0.014;
  const UVCELL = { solid: [0.12, 0.62, 0.38, 0.88], needle: [0.5 + E, 0.5 + E, 1 - E, 1 - E], leaf: [E, E, 0.5 - E, 0.5 - E], grass: [0.5 + E, E, 1 - E, 0.5 - E] };

  // ---------- surface library ----------
  // Every material's fine detail is drawn once to canvas, greyscale, and
  // multiplied over the part's flat colour. Each surface is painted by one
  // function so it can be issued two ways:
  //   * as a standalone tiling texture (surfTex) for its own mesh, and
  //   * as one band of a single stacked atlas (surfaceTexture) for parts that
  //     get merged into a shared draw call.
  // Bands are drawn to tile in both axes and carry no single-pixel noise —
  // unfiltered 1px speckle turns into moire stripes the moment a surface is
  // minified, which is exactly what a cabinet door does at any distance.
  const BW = 512, BH = 128;
  const R = (a, b) => a + Math.random() * (b - a);
  const PAINTERS = {
    blank: (g) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, BW, BH); },
    // long grain, a few knots, a plank seam top and bottom
    wood: (g) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, BW, BH);
      for (let i = 0; i < 200; i++) {
        const y = R(0, BH), h = R(1.2, 3.4), d = R(0.04, 0.15);
        g.fillStyle = `rgba(90,60,35,${d.toFixed(3)})`;
        g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= BW; x += 32) g.lineTo(x, y + Math.sin((x / BW) * Math.PI * 2 + i) * 2.6);
        for (let x = BW; x >= 0; x -= 32) g.lineTo(x, y + h + Math.sin((x / BW) * Math.PI * 2 + i) * 2.6);
        g.closePath(); g.fill();
      }
      for (let i = 0; i < 3; i++) {
        const cx = R(60, BW - 60), cy = R(24, BH - 24);
        for (let r = 13; r > 1.5; r -= 2.2) {
          g.strokeStyle = `rgba(70,45,25,${(0.05 + r * 0.007).toFixed(3)})`; g.lineWidth = 1.6;
          g.beginPath(); g.ellipse(cx, cy, r, r * 0.55, 0.4, 0, 7); g.stroke();
        }
      }
      g.fillStyle = 'rgba(60,40,22,0.28)'; g.fillRect(0, 0, BW, 2); g.fillRect(0, BH - 2, BW, 2);
    },
    // roller mottle — soft, directionless, low frequency
    paint: (g) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, BW, BH);
      for (let i = 0; i < 240; i++) {
        const x = R(0, BW), y = R(0, BH), r = R(10, 34), dk = Math.random() < 0.5;
        for (const ox of [-BW, 0, BW]) {
          const gr = g.createRadialGradient(x + ox, y, 0, x + ox, y, r);
          gr.addColorStop(0, dk ? 'rgba(0,0,0,0.022)' : 'rgba(255,255,255,0.03)');
          gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y, r, 0, 7); g.fill();
        }
      }
    },
    // glaze: a soft sheen across the middle plus a scatter of kiln specks
    ceramic: (g) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, BW, BH);
      const gr = g.createLinearGradient(0, 0, 0, BH);
      gr.addColorStop(0, 'rgba(255,255,255,0.42)'); gr.addColorStop(0.45, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)');
      g.fillStyle = gr; g.fillRect(0, 0, BW, BH);
      for (let i = 0; i < 420; i++) {
        g.fillStyle = `rgba(60,50,40,${R(0.04, 0.14).toFixed(3)})`;
        g.beginPath(); g.arc(R(0, BW), R(0, BH), R(1.4, 3.0), 0, 7); g.fill();
      }
    },
    // machined metal: long soft streaks, nothing sharper than a couple of pixels
    brushed: (g) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, BW, BH);
      for (let i = 0; i < 420; i++) {
        const y = R(0, BH), h = R(1.2, 2.6);
        g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${R(0.02, 0.08).toFixed(3)})` : `rgba(255,255,255,${R(0.03, 0.10).toFixed(3)})`;
        g.fillRect(-40, y, BW + 80, h);
      }
      const gr = g.createLinearGradient(0, 0, 0, BH);
      gr.addColorStop(0, 'rgba(255,255,255,0.16)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.06)'); gr.addColorStop(1, 'rgba(255,255,255,0.12)');
      g.fillStyle = gr; g.fillRect(0, 0, BW, BH);
    },
    // corrugated flutes plus a coarse paper fibre
    card: (g) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, BW, BH);
      const FL = 32;
      for (let x = 0; x < BW; x += FL) {
        const gr = g.createLinearGradient(x, 0, x + FL, 0);
        gr.addColorStop(0, 'rgba(0,0,0,0.13)'); gr.addColorStop(0.42, 'rgba(255,255,255,0.14)'); gr.addColorStop(1, 'rgba(0,0,0,0.13)');
        g.fillStyle = gr; g.fillRect(x, 0, FL, BH);
      }
      for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(90,65,40,${R(0.03, 0.10).toFixed(3)})`; g.fillRect(R(0, BW), R(0, BH), R(4, 14), 2); }
    },
    // a plain over-under weave, big enough not to shimmer
    cloth: (g) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, BW, BH);
      const S2 = 16;
      for (let y = 0; y < BH; y += S2) for (let x = 0; x < BW; x += S2) {
        const up = ((x / S2 + y / S2) & 1) === 0;
        const gr = g.createLinearGradient(x, y, up ? x + S2 : x, up ? y : y + S2);
        gr.addColorStop(0, 'rgba(0,0,0,0.13)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.14)'); gr.addColorStop(1, 'rgba(0,0,0,0.13)');
        g.fillStyle = gr; g.fillRect(x, y, S2, S2);
      }
    },
    // overlapping strands, dark at the root and pale at the tip
    fur: (g) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, BW, BH);
      for (let i = 0; i < 1500; i++) {
        const x = R(0, BW), y = R(-10, BH), len = R(9, 22), lean = R(-6, 6);
        g.strokeStyle = Math.random() < 0.55
          ? `rgba(45,32,20,${R(0.05, 0.17).toFixed(3)})`
          : `rgba(255,240,215,${R(0.05, 0.16).toFixed(3)})`;
        g.lineWidth = R(1.4, 3.0); g.lineCap = 'round';
        for (const oy of [-BH, 0, BH]) {
          g.beginPath(); g.moveTo(x, y + oy); g.quadraticCurveTo(x + lean * 0.5, y + oy + len * 0.6, x + lean, y + oy + len); g.stroke();
        }
      }
    },
  };
  const SURFORDER = Object.keys(PAINTERS);
  const SURFN = SURFORDER.length;
  const GUT = 16;                       // mirrored gutter so mip levels stay in-band
  const CELL = BH + GUT * 2;
  const SURF = {};
  SURFORDER.forEach((k, i) => {
    const top = i * CELL + GUT, H = CELL * SURFN;
    SURF[k] = [(top + 0.5) / H, (top + BH - 0.5) / H];
  });

  // one standalone tiling texture per surface — its own mesh, its own map
  const _bandTex = new Map();
  function surfTex(name) {
    if (_bandTex.has(name)) return _bandTex.get(name);
    const c = document.createElement('canvas'); c.width = BW; c.height = BH;
    (PAINTERS[name] || PAINTERS.blank)(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    _bandTex.set(name, t); return t;
  }
  // the stacked atlas, for parts that share one merged geometry
  let _surf = null;
  function surfaceTexture() {
    if (_surf) return _surf;
    const c = document.createElement('canvas');
    c.width = BW; c.height = CELL * SURFN;
    const g = c.getContext('2d');
    SURFORDER.forEach((k, i) => {
      const src = surfTex(k).image, top = i * CELL + GUT;
      g.drawImage(src, 0, top);
      // mirror a strip above and below so mipmaps blur the band into itself
      g.save(); g.translate(0, top); g.scale(1, -1); g.drawImage(src, 0, 0, BW, GUT, 0, 0, BW, -GUT); g.restore();
      g.save(); g.translate(0, top + BH); g.scale(1, -1); g.drawImage(src, 0, BH - GUT, BW, GUT, 0, 0, BW, GUT); g.restore();
    });
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return (_surf = t);
  }
  function surfMat(color, name, repU = 1, repV = 1, opts = {}) {
    const t = surfTex(name).clone(); t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repU, repV);
    return new THREE.MeshStandardMaterial(Object.assign(
      { color, map: t, roughness: 0.9, metalness: 0, envMapIntensity: 0.75 }, opts));
  }

  function noiseCanvas(S, base, spots, alpha) {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    for (let i = 0; i < spots; i++) {
      g.fillStyle = `rgba(0,0,0,${(Math.random() * alpha).toFixed(3)})`;
      g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 3, 1 + Math.random() * 3);
      g.fillStyle = `rgba(255,255,255,${(Math.random() * alpha * 0.8).toFixed(3)})`;
      g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    return { c, g };
  }
  const _tex = {};
  function repeatTex(key, build, rx = 1, ry = 1) {
    if (_tex[key]) return _tex[key];
    const t = new THREE.CanvasTexture(build());
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    _tex[key] = t; return t;
  }
  // sawn floorboards
  const woodTexture = (cols = ['#c08a55', '#b57f4c', '#c9945e', '#ab7645']) => repeatTex('wood' + cols[0], () => {
    const S = 256, { c, g } = noiseCanvas(S, cols[0], 2600, 0.1);
    for (let i = 0; i < 4; i++) {
      const y = i * (S / 4);
      g.fillStyle = cols[i % cols.length]; g.fillRect(0, y, S, S / 4 - 2);
      g.fillStyle = 'rgba(70,40,20,.55)'; g.fillRect(0, y + S / 4 - 3, S, 3);
      g.strokeStyle = 'rgba(90,55,28,.3)'; g.lineWidth = 1.4;
      for (let k = 0; k < 7; k++) {
        const yy = y + 6 + k * 7;
        g.beginPath(); g.moveTo(0, yy);
        for (let x = 0; x <= S; x += 16) g.lineTo(x, yy + Math.sin((x + i * 40 + k * 9) * 0.05) * 2.2);
        g.stroke();
      }
      const off = (i % 2) * (S / 2);
      g.fillStyle = 'rgba(60,34,16,.5)'; g.fillRect(off, y, 3, S / 4);
    }
    return c;
  }, 4, 4);
  // glazed backsplash tiles
  const tileTexture = (a = '#f3ece0', b = '#dfd3c0', grout = '#b9ab97') => repeatTex('tile' + a, () => {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = grout; g.fillRect(0, 0, S, S);
    const n = 4, k = S / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      g.fillStyle = (x + y) % 3 === 0 ? b : a;
      g.fillRect(x * k + 3, y * k + 3, k - 6, k - 6);
      const grd = g.createLinearGradient(x * k, y * k, x * k, y * k + k);
      grd.addColorStop(0, 'rgba(255,255,255,.45)'); grd.addColorStop(0.4, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(x * k + 3, y * k + 3, k - 6, k - 6);
    }
    return c;
  }, 6, 3);
  // striped wallpaper with a small motif
  const wallpaperTexture = () => repeatTex('wall', () => {
    const S = 256, { c, g } = noiseCanvas(S, '#f6e6c8', 1400, 0.05);
    g.fillStyle = 'rgba(214,178,126,.55)';
    for (let x = 0; x < S; x += 32) g.fillRect(x, 0, 13, S);
    g.fillStyle = 'rgba(191,136,86,.5)';
    for (let y = 16; y < S; y += 64) for (let x = 16; x < S; x += 64) {
      g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill();
      g.beginPath(); g.arc(x + 32, y + 32, 3, 0, 7); g.fill();
    }
    return c;
  }, 5, 3);
  // poured concrete with aggregate
  const concreteTexture = () => repeatTex('concrete', () => {
    const S = 256, { c, g } = noiseCanvas(S, '#bdbab3', 6000, 0.16);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(120,118,112,${0.1 + Math.random() * 0.25})`; g.beginPath(); g.arc(Math.random() * S, Math.random() * S, 1 + Math.random() * 2.6, 0, 7); g.fill(); }
    return c;
  }, 1, 1);
  // Detail that multiplies the terrain's vertex colours. Built at three scales
  // — broad damp/dry blotches, scattered pebbles, then a light grain — because
  // a single layer of per-pixel noise just reads as television static once the
  // camera is more than a couple of metres away.
  const groundDetail = () => repeatTex('grain', () => {
    const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const R = (a, b) => a + Math.random() * (b - a);
    const wrap = (fn) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy); };
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
    // metre-scale patches: where the ground is damper, worn or shaded
    for (let i = 0; i < 46; i++) {
      const x = R(0, S), y = R(0, S), r = R(40, 150), dk = Math.random() < 0.62;
      wrap((ox, oy) => {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, dk ? 'rgba(70,66,58,0.09)' : 'rgba(255,252,240,0.09)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, r, 0, 7); g.fill();
      });
    }
    // pebbles and grit, each with a lit top and a shaded underside
    for (let i = 0; i < 900; i++) {
      const x = R(0, S), y = R(0, S), r = R(1.6, 6), a = R(0, 3);
      const sh = 40 + Math.random() * 60 | 0;
      wrap((ox, oy) => {
        g.fillStyle = `rgba(${sh},${sh - 4},${sh - 10},${R(0.06, 0.2).toFixed(3)})`;
        g.beginPath(); g.ellipse(x + ox, y + oy + r * 0.35, r, r * 0.72, a, 0, 7); g.fill();
        g.fillStyle = `rgba(255,250,238,${R(0.06, 0.18).toFixed(3)})`;
        g.beginPath(); g.ellipse(x + ox, y + oy - r * 0.2, r * 0.8, r * 0.55, a, 0, 7); g.fill();
      });
    }
    // dry cracks and old tyre scuffs
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = `rgba(86,82,76,${R(0.04, 0.11).toFixed(3)})`; g.lineWidth = R(1, 2.6);
      let x = R(0, S), y = R(0, S); g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += R(-90, 90); y += R(-90, 90); g.lineTo(x, y); }
      g.stroke();
    }
    // a whisper of grain on top, far quieter than it used to be
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${R(0.01, 0.05).toFixed(3)})` : `rgba(255,255,255,${R(0.01, 0.05).toFixed(3)})`;
      g.fillRect(R(0, S), R(0, S), 1.6, 1.6);
    }
    return c;
  });
  // worn asphalt with baked lane markings; tiles along the length of a road
  function roadTexture(kind) {
    return repeatTex('road' + kind, () => {
      const W = 512, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d');
      g.fillStyle = kind === 'dirt' ? '#7c6a52' : '#43423f'; g.fillRect(0, 0, W, H);
      // aggregate
      for (let i = 0; i < 42000; i++) {
        const v = Math.random();
        g.fillStyle = kind === 'dirt'
          ? `rgba(${120 + v * 70 | 0},${100 + v * 60 | 0},${74 + v * 50 | 0},${0.12 + Math.random() * 0.4})`
          : `rgba(${90 + v * 90 | 0},${90 + v * 88 | 0},${88 + v * 84 | 0},${0.05 + Math.random() * 0.32})`;
        g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2.4, 1 + Math.random() * 2.4);
      }
      // patches and cracks
      for (let i = 0; i < 26; i++) {
        g.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.09})`;
        g.beginPath(); g.ellipse(Math.random() * W, Math.random() * H, 20 + Math.random() * 90, 14 + Math.random() * 60, Math.random() * 3, 0, 7); g.fill();
      }
      if (kind !== 'dirt') {
        g.strokeStyle = 'rgba(20,20,20,.5)'; g.lineCap = 'round';
        for (let i = 0; i < 16; i++) {
          g.lineWidth = 1 + Math.random() * 2.2;
          let x = Math.random() * W, y = Math.random() * H; g.beginPath(); g.moveTo(x, y);
          for (let k = 0; k < 7; k++) { x += (Math.random() - 0.5) * 70; y += (Math.random() - 0.5) * 120; g.lineTo(x, y); }
          g.stroke();
        }
        // tyre polish in the wheel tracks
        for (const cx of [W * 0.29, W * 0.71]) {
          const grd = g.createLinearGradient(cx - 46, 0, cx + 46, 0);
          grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.5, 'rgba(0,0,0,.16)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grd; g.fillRect(cx - 46, 0, 92, H);
        }
        // edge lines and centre dashes, baked so they tile
        g.fillStyle = 'rgba(226,226,218,.82)';
        g.fillRect(W * 0.055, 0, 7, H); g.fillRect(W * 0.94, 0, 7, H);
        if (kind === 'centre') {
          g.fillStyle = 'rgba(224,186,66,.85)';
          for (let y = 0; y < H; y += 128) g.fillRect(W / 2 - 4, y + 18, 8, 78);
        }
        // grime at the shoulders
        const gr = g.createLinearGradient(0, 0, W, 0);
        gr.addColorStop(0, 'rgba(60,54,42,.5)'); gr.addColorStop(0.12, 'rgba(60,54,42,0)');
        gr.addColorStop(0.88, 'rgba(60,54,42,0)'); gr.addColorStop(1, 'rgba(60,54,42,.5)');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      }
      return c;
    });
  }
  // the character's face: 2D eyes and mouth that swap for expressions
  const _faces = {};
  function faceTexture(expr) {
    if (_faces[expr]) return _faces[expr];
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    const ink = '#221b18';
    const EY = 96, EX = 62, R = 21;
    // wombats have pale patches around the eyes, and they double as the
    // contrast that makes dark ink dots readable against dark fur
    const patch = (x, y, r) => {
      const gr = g.createRadialGradient(x, y - 2, r * 0.2, x, y, r * 1.5);
      gr.addColorStop(0, 'rgba(247,240,226,0.95)'); gr.addColorStop(0.6, 'rgba(240,230,212,0.7)'); gr.addColorStop(1, 'rgba(240,230,212,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r * 1.5, r * 1.35, 0, 0, 7); g.fill();
    };
    const dot = (x, y, r, sq = 1) => {
      patch(x, y, r * 1.35);
      g.fillStyle = ink; g.beginPath(); g.ellipse(x, y, r, r * sq, 0, 0, 7); g.fill();
      // catchlight
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.ellipse(x + r * 0.34, y - r * sq * 0.36, r * 0.28, r * 0.28, 0, 0, 7); g.fill();
    };
    const arc = (x, y, r, up) => { patch(x, y, r * 1.5); g.strokeStyle = ink; g.lineWidth = 13; g.lineCap = 'round'; g.beginPath(); g.arc(x, y + (up ? r * 0.6 : -r * 0.6), r, up ? Math.PI : 0, up ? 0 : Math.PI); g.stroke(); };
    const brow = (x, y, a) => { g.strokeStyle = ink; g.lineWidth = 10; g.lineCap = 'round'; g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.moveTo(-22, 0); g.lineTo(22, 0); g.stroke(); g.restore(); };
    const mouth = (kind) => {
      g.strokeStyle = ink; g.lineWidth = 11; g.lineCap = 'round'; g.fillStyle = ink;
      const my = 176;
      if (kind === 'smile') { g.beginPath(); g.arc(S / 2, my - 14, 26, 0.25, Math.PI - 0.25); g.stroke(); }
      else if (kind === 'open') { g.beginPath(); g.ellipse(S / 2, my, 20, 24, 0, 0, 7); g.fill(); }
      else if (kind === 'grin') { g.beginPath(); g.arc(S / 2, my - 20, 34, 0.3, Math.PI - 0.3); g.stroke(); }
      else if (kind === 'flat') { g.beginPath(); g.moveTo(S / 2 - 22, my); g.lineTo(S / 2 + 22, my); g.stroke(); }
      else if (kind === 'frown') { g.beginPath(); g.arc(S / 2, my + 22, 24, Math.PI + 0.3, -0.3); g.stroke(); }
    };
    switch (expr) {
      case 'happy': arc(S / 2 - EX, EY, 20, true); arc(S / 2 + EX, EY, 20, true); mouth('smile'); break;
      case 'joy': arc(S / 2 - EX, EY, 22, true); arc(S / 2 + EX, EY, 22, true); mouth('grin'); break;
      case 'focus': dot(S / 2 - EX, EY, R, 0.62); dot(S / 2 + EX, EY, R, 0.62); brow(S / 2 - EX, EY - 34, 0.26); brow(S / 2 + EX, EY - 34, -0.26); mouth('flat'); break;
      case 'worry': dot(S / 2 - EX, EY + 4, R * 0.92); dot(S / 2 + EX, EY + 4, R * 0.92); brow(S / 2 - EX, EY - 32, -0.34); brow(S / 2 + EX, EY - 32, 0.34); mouth('frown'); break;
      case 'surprise': dot(S / 2 - EX, EY - 2, R * 1.2); dot(S / 2 + EX, EY - 2, R * 1.2); brow(S / 2 - EX, EY - 44, -0.1); brow(S / 2 + EX, EY - 44, 0.1); mouth('open'); break;
      case 'blink': arc(S / 2 - EX, EY, 19, false); arc(S / 2 + EX, EY, 19, false); mouth('smile'); break;
      case 'sad': dot(S / 2 - EX, EY + 6, R * 0.9); dot(S / 2 + EX, EY + 6, R * 0.9); brow(S / 2 - EX, EY - 30, -0.4); brow(S / 2 + EX, EY - 30, 0.4); mouth('frown'); break;
      default: dot(S / 2 - EX, EY, R); dot(S / 2 + EX, EY, R); mouth('smile');
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    _faces[expr] = t; return t;
  }
  function signTexture(kind, text) {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const weather = () => { for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${90 + Math.random() * 60|0},${80 + Math.random() * 50|0},${70 + Math.random() * 40|0},${Math.random() * 0.2})`; g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 5, 1 + Math.random() * 5); } };
    g.clearRect(0, 0, S, S);
    if (kind === 'warn') {
      g.save(); g.translate(S / 2, S / 2); g.rotate(Math.PI / 4);
      g.fillStyle = '#e8b53a'; g.fillRect(-84, -84, 168, 168);
      g.strokeStyle = '#2b2b2b'; g.lineWidth = 8; g.strokeRect(-76, -76, 152, 152); g.restore();
      g.fillStyle = '#1e1e1e'; g.font = 'bold 92px "Roboto Condensed", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text || '!', S / 2, S / 2 + 4);
    } else if (kind === 'speed') {
      g.fillStyle = '#f0eee8'; g.fillRect(52, 26, 152, 204);
      g.strokeStyle = '#22221f'; g.lineWidth = 7; g.strokeRect(60, 34, 136, 188);
      g.fillStyle = '#22221f'; g.textAlign = 'center';
      g.font = 'bold 34px "Roboto Condensed", Arial'; g.fillText('SPEED', S / 2, 84);
      g.fillText('LIMIT', S / 2, 118);
      g.font = 'bold 96px "Roboto Condensed", Arial'; g.fillText(text || '25', S / 2, 190);
    } else if (kind === 'chevron') {
      g.fillStyle = '#e8b53a'; g.fillRect(40, 20, 176, 216);
      g.strokeStyle = '#2b2b2b'; g.lineWidth = 6; g.strokeRect(48, 28, 160, 200);
      g.fillStyle = '#1e1e1e'; g.beginPath(); g.moveTo(96, 60); g.lineTo(176, 128); g.lineTo(96, 196); g.lineTo(96, 152); g.lineTo(126, 128); g.lineTo(96, 104); g.closePath(); g.fill();
    } else { // guide
      g.fillStyle = '#2c5c3a'; g.fillRect(14, 62, 228, 132);
      g.strokeStyle = '#f0eee8'; g.lineWidth = 6; g.strokeRect(24, 72, 208, 112);
      g.fillStyle = '#f0eee8'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const t = (text || 'VALLEY').split('|');
      g.font = 'bold 40px "Roboto Condensed", Arial';
      t.forEach((line, i) => g.fillText(line, S / 2, 128 + (i - (t.length - 1) / 2) * 44));
    }
    weather();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    return tex;
  }

  function textTexture(text, opts = {}) {
    const { w = 256, h = 64, bg = '#f7e7c6', fg = '#6b4423', font = 'bold 40px monospace', border = '#3d2314', radius = 10 } = opts;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = bg;
    if (g.roundRect) { g.beginPath(); g.roundRect(0, 0, w, h, radius); g.fill(); } else g.fillRect(0, 0, w, h);
    if (border) { g.strokeStyle = border; g.lineWidth = 7; if (g.roundRect) { g.beginPath(); g.roundRect(3.5, 3.5, w - 7, h - 7, radius); g.stroke(); } else g.strokeRect(3.5, 3.5, w - 7, h - 7); }
    g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    // shrink to fit rather than running off the edge of the sign
    const pad = 18, room = w - pad * 2;
    let size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] || '40');
    while (size > 8 && g.measureText(text).width > room) {
      size -= 2; g.font = font.replace(/(\d+(?:\.\d+)?)px/, size + 'px');
    }
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
    foliageTexture, UVCELL, surfaceTexture, surfTex, surfMat, SURF, woodTexture, tileTexture, wallpaperTexture, concreteTexture, signTexture, noiseCanvas, groundDetail, roadTexture, faceTexture,
    get renderer() { return renderer; }, get envOutdoor() { return envOutdoor; }, get envIndoor() { return envIndoor; } };
})();

// ---------- palette: "Sunday-morning plush" ----------
FW.PAL = {
  duck: '#fffdf6', duckShade: '#f0e6d2', beak: '#f9a23f', beakDark: '#e0862a', eye: '#2a2320', blush: '#e8a08f', white: '#fffdf6',
  fur: '#b39a7c', furDark: '#8f7a60', furLight: '#cdb99c', nose: '#4a3f36', claw: '#ece5d9',
  apron: '#e5564a', apronTrim: '#fff3dc', hatA: '#fff3dc', hatB: '#e5564a', hatC: '#f7c544', hatD: '#7fd1c0', prop: '#4fb3d9',
  candy: '#ff8fb0', stick: '#fff3dc',
  mint: '#7fd1c0', mintDark: '#5cb6a5', steel: '#c8ccd8', cream: '#fff3dc', red: '#e5564a', gold: '#f7c544', brown: '#8a5a2b', wood: '#b07c4a', wood2: '#96663a',
  bear: '#7a5334', bearLight: '#9b7250', muzzle: '#d8b489', tan: '#c9a177',
  pine: ['#2f6b4a', '#3f8a57', '#256045', '#5fae6e'], trunk: '#7a5334', sequoia: '#9c5636', seqGreen: '#356f4d', aspen: '#b9d35a', aspenGold: '#e8b04b', aspenTrunk: '#efe9dc',
  granite: ['#9a958f', '#a5a09a', '#8d8882'], snow: '#eef1f4',
  grass: ['#5c7f3e', '#638745', '#6a8f4a', '#587a3b'], dirt: ['#c09161', '#b3855a', '#cb9c6b'], road: ['#9d9a94', '#a4a19b', '#96938d'], joint: '#7c7a75', shoulder: '#8d8981', line: '#d9d6cd', lineY: '#d8b23f', sand: '#e6d8ab', water: '#5cb3e8', riverbed: '#7e9a70',
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
