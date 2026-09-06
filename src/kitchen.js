// Flippin' Waffles — the kitchen.
// Everything is a tap: open the fridge, tap ingredients into the bowl, tap to
// whisk, tap the iron to pour and to lift the waffle out when it *looks* right.
// No timing bars. Spills and splatter pile up as real mess you can wipe later.
window.FW = window.FW || {};

FW.Kitchen = class {
  constructor() {
    const V = FW.Models;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#d8b98d');
    this.scene.environment = FW.Pixel.envIndoor;
    this.camera = new THREE.PerspectiveCamera(FW.Pixel.fitFov(46), FW.Pixel.size.aspect, 0.1, 60);
    // tap a station and the camera slides over to it
    this.stations = {
      wide:  { pos: new THREE.Vector3(0.4, 3.25, 3.75), look: new THREE.Vector3(0.4, 1.05, -0.55), fov: 52 },
      prep:  { pos: new THREE.Vector3(-1.0, 2.35, 1.95), look: new THREE.Vector3(-1.15, 1.05, -0.15), fov: 44 },
      cook:  { pos: new THREE.Vector3(0.35, 2.4, 1.85), look: new THREE.Vector3(0.2, 1.06, -0.25), fov: 42 },
      plate: { pos: new THREE.Vector3(2.1, 2.4, 2.0), look: new THREE.Vector3(2.15, 1.04, -0.2), fov: 44 },
    };
    this.station = 'wide';
    this.camPos = this.stations.wide.pos.clone();
    this.camLook = this.stations.wide.look.clone();
    this.camFov = this.stations.wide.fov;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.fx = new FW.Particles(this.scene, 460);
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hit = new THREE.Vector3();

    this.taps = [];          // everything you can tap
    this.messes = [];        // spills waiting to be wiped
    this.pops = [];
    this.tweens = [];
    this.hover = null; this.wasDown = false;
    this.held = null;        // 'sponge' or a topping id
    this.fridgeOpen = false;
    this.state = 'idle'; this.order = null; this.index = 0; this.made = []; this.cur = null;
    this.t = 0; this.cook = 0; this.waitTimer = 0; this.addPitch = 0; this.lumps = [];
    this.TOP = 0.98;
    this.onDone = null; this.onProgress = null;
    this.build();
  }

  // ---------- small helpers ----------
  popper(obj, base = 1) { const s = { obj, base, spring: new FW.Kart.Spring(1, 210, 12) }; this.pops.push(s); obj.userData.popper = s; return s; }
  pop(obj, amount = 8) { const s = obj && obj.userData.popper; if (s) s.spring.kick(amount); }
  updatePops(dt) {
    for (const s of this.pops) {
      const v = FW.U.clamp(s.spring.update(dt), 0.66, 1.42);
      s.obj.scale.set(s.base / Math.sqrt(v), s.base * v, s.base / Math.sqrt(v));
    }
  }
  tween(obj, prop, to, dur, cb, ease) {
    const src = obj[prop];
    this.tweens.push({ obj, prop, from: new THREE.Vector3(src.x, src.y, src.z), to: new THREE.Vector3(to.x ?? src.x, to.y ?? src.y, to.z ?? src.z), t: 0, dur, cb, ease: ease || FW.U.easeInOut });
  }
  static easeBack(t) { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
  updateTweens(dt) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i]; tw.t += dt;
      const q = tw.ease(Math.min(1, tw.t / tw.dur));
      const v = tw.from.clone().lerp(tw.to, q);
      if (tw.prop === 'rotation') tw.obj.rotation.set(v.x, v.y, v.z); else tw.obj[tw.prop].copy(v);
      if (tw.t >= tw.dur) { this.tweens.splice(i, 1); if (tw.cb) tw.cb(); }
    }
  }
  hint(h) { FW.HUD.hint(h); }
  progress() { if (this.onProgress) this.onProgress({ index: this.index, made: this.made, counts: this.cur ? this.cur.counts : null, toppings: this.cur ? this.cur.toppings : null }); }

  // ---------- the room ----------
  build() {
    const V = FW.Models, P = FW.PAL, M = FW.Pixel.mat, S = this.scene, TOP = this.TOP;
    // --- light: window key, warm bounce, a lamp over the counter ---
    // Cozy kitchen: one warm window key, a cool sliver of rim, and the hanging
    // lamp doing most of the work. Dim ambient so the room has real corners.
    const key = new THREE.DirectionalLight('#ffdba6', 1.5); key.position.set(-3.4, 4.6, 2.8); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera; sc.left = -4.2; sc.right = 4.2; sc.top = 3.2; sc.bottom = -2.6; sc.near = 1; sc.far = 15;
    key.shadow.bias = -0.0007; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
    S.add(key, key.target);
    S.add(new THREE.HemisphereLight('#b9c9dc', '#6b5741', 0.22));
    const rim = new THREE.DirectionalLight('#9dbde0', 0.26); rim.position.set(2.8, 2.4, -3); S.add(rim);
    this.lampLight = new THREE.PointLight('#ffb268', 3.4, 6.2, 2); this.lampLight.position.set(0.1, 2.6, 0.6); S.add(this.lampLight);

    const texMat = (tex, opts = {}) => new THREE.MeshStandardMaterial(Object.assign({ map: tex, roughness: 0.85, metalness: 0 }, opts));
    // painted, glazed, brushed and woven surfaces all come off the one atlas
    const SM = FW.Pixel.surfMat;
    const slab = (w, h, d, mat, x, y, z, r = 0.05) => {
      const m = new THREE.Mesh(V.roundedBox(w, h, d, Math.min(r, w / 2.05, h / 2.05, d / 2.05)), mat);
      m.position.set(x, y, z); m.receiveShadow = true; m.castShadow = true; S.add(m); return m;
    };
    // --- floor, walls, skirting ---
    const floorTex = FW.Pixel.woodTexture(); floorTex.repeat.set(5, 4);
    slab(12, 0.3, 8.5, texMat(floorTex, { roughness: 0.7 }), 0, -0.15, -0.6, 0.04);
    const wallTex = FW.Pixel.wallpaperTexture(); wallTex.repeat.set(6, 3);
    slab(12, 4.8, 0.4, texMat(wallTex, { roughness: 0.95 }), 0, 2.4, -2.55, 0.06);
    const tileTex = FW.Pixel.tileTexture(); tileTex.repeat.set(2.6, 0.75);
    slab(12, 1.35, 0.44, texMat(tileTex, { roughness: 0.35, metalness: 0.05, envMapIntensity: 1.2 }), 0, 1.32, -2.5, 0.03);
    slab(12, 0.12, 0.5, SM('#8a5a2b', 'wood', 14, 1), 0, 2.02, -2.5, 0.04);
    slab(12, 0.16, 0.5, SM('#8a5a2b', 'wood', 14, 1), 0, 0.08, -2.5, 0.04);
    slab(0.4, 4.8, 8.5, texMat(wallTex, { roughness: 0.95 }), -5.0, 2.4, -0.6, 0.06);
    slab(0.4, 4.8, 8.5, texMat(wallTex, { roughness: 0.95 }), 5.0, 2.4, -0.6, 0.06);
    // rug
    const rugTex = this.rugTexture();
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.4), texMat(rugTex, { roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(0.2, 0.02, 1.5); rug.receiveShadow = true; S.add(rug);

    // --- window with the valley outside ---
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.7), new THREE.MeshBasicMaterial({ map: this.windowTexture() }));
    win.position.set(-1.5, 2.5, -2.32); S.add(win);
    const frame = new THREE.Mesh(V.torus(1.22, 0.09, 8, 26), SM(P.cream, 'paint', 8, 1)); frame.position.set(-1.5, 2.5, -2.28); frame.scale.set(1.0, 0.74, 1); S.add(frame);
    slab(2.5, 0.09, 0.12, SM(P.cream, 'paint', 6, 1), -1.5, 2.5, -2.27, 0.04);
    slab(0.09, 1.35, 0.12, SM(P.cream, 'paint', 1, 1), -1.5, 2.5, -2.27, 0.04);
    slab(2.7, 0.14, 0.34, SM('#b07c4a', 'wood', 5, 1), -1.5, 1.66, -2.34, 0.05);
    for (let i = 0; i < 3; i++) { const pot = new THREE.Mesh(V.cyl(0.11, 0.09, 0.18, 10), SM(['#c94a4a', '#4f9a5c', '#8f6cd0'][i], 'ceramic', 2, 1)); pot.position.set(-2.1 + i * 0.6, 1.82, -2.3); pot.castShadow = true; S.add(pot);
      const leaf = new THREE.Mesh(V.sphere(0.14, 8, 6), M('#4f9a5c')); leaf.position.set(-2.1 + i * 0.6, 1.98, -2.3); leaf.scale.y = 0.7; S.add(leaf); }

    // --- shelf, jars, pans, bunting ---
    slab(3.2, 0.1, 0.44, SM('#b07c4a', 'wood', 7, 1), 2.0, 2.3, -2.24, 0.03);
    [['#ffb3b3', 0.75], ['#a8e6cf', 1.15], ['#f7c544', 1.55], ['#c9a0f0', 1.95], ['#8fd3f4', 2.35], ['#e5564a', 2.75], ['#fff3dc', 3.1]].forEach(([c, x], i) => {
      const h = 0.24 + (i % 2) * 0.1;
      const jar = new THREE.Mesh(V.cyl(0.11, 0.12, h, 12), SM(c, 'ceramic', 2, 1, { roughness: 0.3, envMapIntensity: 1.2 }));
      jar.position.set(x, 2.35 + h / 2, -2.24); jar.castShadow = true; S.add(jar);
      const lid = new THREE.Mesh(V.cyl(0.115, 0.115, 0.05, 12), SM('#96663a', 'brushed', 3, 1, { roughness: 0.45, metalness: 0.35 })); lid.position.set(x, 2.37 + h, -2.24); S.add(lid);
    });
    for (let i = 0; i < 3; i++) {
      const pan = new THREE.Mesh(V.cyl(0.24 - i * 0.03, 0.24 - i * 0.03, 0.07, 14), SM('#b9bfd0', 'brushed', 4, 1, { roughness: 0.32, metalness: 0.3, envMapIntensity: 1.1 }));
      pan.position.set(3.0 + i * 0.55, 3.05, -2.2); pan.rotation.x = Math.PI / 2; pan.castShadow = true; S.add(pan);
    }
    this.lights = [];
    const lc = ['#ff8fb0', '#f7c544', '#a8e6cf', '#8fd3f4', '#c9a0f0'];
    for (let i = 0; i < 15; i++) {
      const m = new THREE.Mesh(V.sphere(0.07, 8, 6), FW.Pixel.flat(lc[i % 5]));
      m.position.set(-4.3 + i * 0.62, 3.62 - Math.abs(Math.sin(i * 0.5)) * 0.28, -2.24); S.add(m); this.lights.push(m);
    }

    // --- counter run ---
    const counterTex = FW.Pixel.woodTexture(['#d09a63', '#c48f59', '#d8a56c', '#bb8551']); counterTex.repeat.set(3, 1);
    slab(6.2, 0.95, 1.4, SM('#fff0d4', 'paint', 4, 1), 0.35, 0.475, 0.05, 0.08);
    const ctop = new THREE.Mesh(V.roundedBox(6.4, 0.14, 1.54, 0.06), texMat(counterTex, { roughness: 0.55 }));
    ctop.position.set(0.35, 0.94, 0.05); ctop.receiveShadow = true; ctop.castShadow = true; S.add(ctop);
    // cabinet doors + handles
    for (let i = 0; i < 4; i++) {
      const x = -2.2 + i * 1.5;
      slab(1.34, 0.72, 0.06, SM('#f6e2c2', 'paint', 1, 1), x, 0.5, 0.73, 0.04);
      const h = new THREE.Mesh(V.capsule(0.022, 0.16), SM('#b9bfd0', 'brushed', 3, 1, { metalness: 0.6, roughness: 0.3 }));
      h.position.set(x + 0.5, 0.5, 0.79); S.add(h);
    }
    // sink
    slab(0.9, 0.16, 0.62, SM('#c9ced8', 'brushed', 5, 1, { metalness: 0.5, roughness: 0.25, envMapIntensity: 1.3 }), -2.15, 0.95, 0.08, 0.05);
    const tap = new THREE.Mesh(V.capsule(0.035, 0.3), SM('#c9ced8', 'brushed', 2, 1, { metalness: 0.7, roughness: 0.2 }));
    tap.position.set(-2.15, 1.22, -0.22); S.add(tap);
    const spout = new THREE.Mesh(V.capsule(0.032, 0.2), SM('#c9ced8', 'brushed', 2, 1, { metalness: 0.7, roughness: 0.2 }));
    spout.rotation.x = Math.PI / 2; spout.position.set(-2.15, 1.36, -0.12); S.add(spout);

    const reg = (obj, data, r, y) => {
      if (r) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })); m.position.y = y || 0; obj.add(m); obj.userData.proxy = m; }
      obj.traverse((o) => { o.userData.pick = obj; });
      obj.userData = Object.assign(obj.userData, data);
      S.add(obj); this.taps.push(obj); return obj;
    };
    const stationOf = (x) => (x < -0.4 ? 'prep' : x < 1.0 ? 'cook' : 'plate');

    // --- the fridge ---
    const fridge = new THREE.Group(); fridge.position.set(3.5, 0, -1.5); fridge.rotation.y = -0.34;
    // an open shell, so the shelves and food inside are actually visible
    fridge.add(V.build([
      V.p(V.roundedBox(1.5, 2.5, 0.1, 0.04), '#e9ece9', 0, 1.25, -0.45, { tex: 'paint', rep: 4, mat: 'shiny' }),   // back
      V.p(V.roundedBox(0.12, 2.5, 0.95, 0.04), '#e9ece9', -0.69, 1.25, 0, { tex: 'paint', rep: 4, mat: 'shiny' }), // sides
      V.p(V.roundedBox(0.12, 2.5, 0.95, 0.04), '#e9ece9', 0.69, 1.25, 0, { tex: 'paint', rep: 4, mat: 'shiny' }),
      V.p(V.roundedBox(1.5, 0.12, 0.95, 0.04), '#e9ece9', 0, 2.44, 0, { tex: 'paint', rep: 4, mat: 'shiny' }),      // top
      V.p(V.roundedBox(1.5, 0.12, 0.95, 0.04), '#e9ece9', 0, 0.06, 0, { tex: 'paint', rep: 4, mat: 'shiny' }),      // base
      V.p(V.roundedBox(1.34, 2.3, 0.03, 0.01), '#f6f8f7', 0, 1.25, -0.39, { tex: 'paint', rep: 4 }),                    // liner
      V.p(V.roundedBox(1.42, 0.06, 0.9, 0.02), '#c4c9c6', 0, 1.52, -0.02),
    ]));
    this.fridgeDoor = new THREE.Group(); this.fridgeDoor.position.set(0.74, 0, 0.47);
    this.fridgeDoor.add(V.build([
      V.p(V.roundedBox(1.5, 2.5, 0.1, 0.06), '#f2f4f2', -0.75, 1.25, 0, { tex: 'paint', rep: 4, mat: 'shiny' }),
      V.p(V.roundedBox(0.07, 0.9, 0.09, 0.03), '#9aa2ab', -0.16, 1.55, 0.09, { mat: 'metal' }),
      V.p(V.roundedBox(1.5, 0.05, 0.11, 0.02), '#d6dad7', -0.75, 1.52, 0),
      V.p(V.roundedBox(0.18, 0.18, 0.02, 0.01), '#f7c544', -1.1, 2.0, 0.06),
      V.p(V.roundedBox(0.14, 0.14, 0.02, 0.01), '#e5564a', -0.42, 1.86, 0.06),
      V.p(V.roundedBox(0.12, 0.16, 0.02, 0.01), '#7fd1c0', -0.86, 0.72, 0.06),
    ]));
    fridge.add(this.fridgeDoor);
    // shelves and the ingredient crates inside
    const inner = new THREE.Group(); inner.position.set(0, 0, 0); fridge.add(inner);
    inner.add(V.build([
      V.p(V.roundedBox(1.28, 0.04, 0.78, 0.015), '#e8edeb', 0, 1.74, 0.0, { tex: 'paint', rep: 4, mat: 'shiny' }),
      V.p(V.roundedBox(1.28, 0.04, 0.78, 0.015), '#e8edeb', 0, 1.18, 0.0, { tex: 'paint', rep: 4, mat: 'shiny' }),
      V.p(V.roundedBox(1.28, 0.04, 0.78, 0.015), '#e8edeb', 0, 0.62, 0.0, { tex: 'paint', rep: 4, mat: 'shiny' }),
      V.p(V.roundedBox(1.2, 0.3, 0.06, 0.02), '#dfe6e3', 0, 0.32, 0.34),
    ]));
    this.fridgeLight = new THREE.PointLight('#fff6e0', 0, 2.0, 2); this.fridgeLight.position.set(3.35, 1.6, -1.08); S.add(this.fridgeLight);
    this.fridgeItems = [];
    const ING_MODELS = {
      flour: () => V.build([V.p(V.roundedBox(0.24, 0.3, 0.18, 0.05), '#f2ecdf', 0, 0.15, 0, { mat: 'soft', tex: 'card', rep: 2 }), V.p(V.roundedBox(0.16, 0.1, 0.02, 0.02), '#e5564a', 0, 0.17, 0.1)]),
      sugar: () => V.build([V.p(V.cyl(0.12, 0.11, 0.24, 12), '#fbe9f0', 0, 0.12, 0, { mat: 'shiny', tex: 'ceramic', rep: 2 }), V.p(V.cyl(0.13, 0.13, 0.05, 12), '#b46e3f', 0, 0.26, 0)]),
      egg: () => V.build([V.p(V.roundedBox(0.3, 0.1, 0.2, 0.04), '#c9a177', 0, 0.05, 0, { mat: 'soft', tex: 'card', rep: 2 }),
        ...[-1, 0, 1].map((i) => V.p(V.sphere(0.062, 10, 8), '#fff5e0', i * 0.09, 0.13, 0, { sy: 1.3, mat: 'soft' }))]),
      milk: () => V.build([V.p(V.cyl(0.1, 0.11, 0.28, 12), '#f2f6ff', 0, 0.14, 0, { mat: 'shiny' }), V.p(V.cyl(0.05, 0.06, 0.09, 10), '#f2f6ff', 0, 0.32, 0, { mat: 'shiny' }), V.p(V.cyl(0.06, 0.06, 0.04, 10), '#4a7fd6', 0, 0.38, 0)]),
    };
    const ingPos = [['flour', -0.4, 1.79], ['sugar', 0.0, 1.79], ['egg', 0.4, 1.79], ['milk', -0.4, 1.23]];
    for (const [id, x, y] of ingPos) {
      const g = ING_MODELS[id]();
      // sit them on the fridge shelves, in the fridge's own frame
      g.position.set(3.5 + Math.cos(-0.34) * x - Math.sin(-0.34) * 0.12, y, -1.5 + Math.sin(-0.34) * x + Math.cos(-0.34) * 0.12);
      g.rotation.y = -0.34;
      reg(g, { kind: 'ing', id, label: FW.Orders.ING[id].name, inFridge: true, station: 'plate' }, 0.19, 0.14);
      this.fridgeItems.push(g);
    }
    // toppings live in the fridge door racks + a counter tray
    reg(fridge, { kind: 'fridge', label: 'Fridge', station: 'plate' }, 0.9, 1.3);
    this.fridge = fridge;

    // --- bowl ---
    const bowl = new THREE.Group();
    bowl.add(V.build([
      V.p(V.sphere(0.3, 18, 11, { thetaS: Math.PI / 2, thetaL: Math.PI / 2 }), '#f7efe0', 0, 0.29, 0, { sy: 0.9, mat: 'shell', tex: 'ceramic', rep: 3 }),
      V.p(V.torus(0.296, 0.03, 6, 22), '#4a7fd6', 0, 0.29, 0, { rx: Math.PI / 2 }),
      V.p(V.cyl(0.13, 0.09, 0.04, 12), '#e6ddc9', 0, 0.02, 0, { tex: 'ceramic', rep: 2 }),
    ]));
    this.batter = new THREE.Mesh(V.cyl(0.25, 0.19, 0.06, 18), M('#f7e6b8', { roughness: 0.42 }));
    this.batter.position.y = 0.09; this.batter.visible = false; bowl.add(this.batter);
    this.lumpG = new THREE.Group(); bowl.add(this.lumpG);
    bowl.position.set(-1.25, TOP, 0.3);
    reg(bowl, { kind: 'bowl', label: 'Mixing bowl', station: 'prep' }, 0.32, 0.18);
    this.bowl = bowl;
    // whisk resting in the bowl
    this.whisk = V.build([
      V.p(V.capsule(0.028, 0.2), '#e5564a', 0, 0.3, 0, { mat: 'soft' }),
      V.p(V.capsule(0.018, 0.14), '#d3d7e2', 0, 0.14, 0, { mat: 'shiny' }),
      ...[0, 1, 2, 3].map((i) => V.p(V.torus(0.055, 0.008, 5, 14, Math.PI), '#d3d7e2', 0, 0.06, 0, { ry: i * Math.PI / 4, mat: 'shiny' })),
    ]);
    this.whisk.position.set(-1.25, TOP + 0.06, 0.3); this.whisk.rotation.z = 0.3; S.add(this.whisk);

    // --- waffle iron ---
    const ironG = new THREE.Group(); ironG.position.set(0.15, TOP, -0.08);
    ironG.add(V.build([
      V.p(V.roundedBox(0.14, 0.13, 0.14, 0.05), '#c8ccd8', -0.28, 0.065, 0, { mat: 'shiny', tex: 'brushed', rep: 3 }),
      V.p(V.roundedBox(0.14, 0.13, 0.14, 0.05), '#c8ccd8', 0.28, 0.065, 0, { mat: 'shiny', tex: 'brushed', rep: 3 }),
      V.p(V.roundedBox(0.78, 0.05, 0.48, 0.02), '#8a5a2b', 0, 0.02, 0, { tex: 'wood', rep: 4 }),
    ]));
    this.ironPivot = new THREE.Group(); this.ironPivot.position.y = 0.14; ironG.add(this.ironPivot);
    this.ironPivot.add(V.build([
      V.p(V.cyl(0.35, 0.37, 0.11, 22), '#e5564a', 0, 0, 0, { mat: 'shiny', tex: 'paint', rep: 4 }),
      V.p(V.torus(0.35, 0.035, 6, 24), '#fff3dc', 0, 0.02, 0, { rx: Math.PI / 2 }),
      V.p(V.cyl(0.3, 0.3, 0.03, 20), '#8e8a99', 0, 0.06, 0, { mat: 'shiny', tex: 'brushed', rep: 4 }),
      ...[-0.19, -0.065, 0.065, 0.19].flatMap((v) => {
        const half = Math.sqrt(Math.max(0.001, 0.29 * 0.29 - v * v));
        return [V.p(V.roundedBox(0.045, 0.05, half * 2, 0.02), '#6e6a7a', v, 0.075, 0, { mat: 'shiny' }),
                V.p(V.roundedBox(half * 2, 0.05, 0.045, 0.02), '#6e6a7a', 0, 0.075, v, { mat: 'shiny' })];
      }),
    ]));
    this.lid = new THREE.Group(); this.lid.position.set(0, 0.06, -0.35);
    this.lid.add(V.build([
      V.p(V.cyl(0.35, 0.35, 0.12, 22), '#e5564a', 0, 0.05, 0.35, { mat: 'shiny', tex: 'paint', rep: 4 }),
      V.p(V.torus(0.35, 0.035, 6, 24), '#fff3dc', 0, 0.05, 0.35, { rx: Math.PI / 2 }),
      V.p(V.cyl(0.3, 0.3, 0.03, 20), '#a5a1b0', 0, -0.005, 0.35, { mat: 'shiny', tex: 'brushed', rep: 4 }),
      V.p(V.capsule(0.035, 0.18), '#fff3dc', 0, 0.12, 0.7, { rz: Math.PI / 2, mat: 'soft' }),
    ]));
    this.ironLight = new THREE.Mesh(V.sphere(0.036, 8, 6), FW.Pixel.flat('#552222'));
    this.ironLight.position.set(0.18, 0.11, 0.63); this.lid.add(this.ironLight);
    this.lid.rotation.x = -2.45; this.ironPivot.add(this.lid);
    this.ironBatter = new THREE.Mesh(V.cyl(0.28, 0.26, 0.05, 18), M('#f7e6b8', { roughness: 0.45 }));
    this.ironBatter.position.y = 0.11; this.ironBatter.visible = false; this.ironPivot.add(this.ironBatter);
    this.ironWaffle = V.waffle(0.46); this.ironWaffle.position.y = 0.1; this.ironWaffle.visible = false; this.ironPivot.add(this.ironWaffle);
    reg(ironG, { kind: 'iron', label: 'Waffle iron', station: 'cook' }, 0.44, 0.2);
    this.ironG = ironG;

    // --- plate + waffle ---
    const plate = V.build([
      V.p(V.cyl(0.33, 0.28, 0.045, 22), '#f4ebda', 0, 0.022, 0, { mat: 'soft', tex: 'ceramic', rep: 3 }),
      V.p(V.torus(0.315, 0.028, 6, 24), '#4a7fd6', 0, 0.042, 0),
    ]);
    plate.position.set(1.15, TOP, 0.3); S.add(plate);
    this.plateWaffle = V.waffle(0.48);
    this.plateWaffle.position.set(1.15, TOP + 0.055, 0.3);
    this.plateWaffle.visible = false; S.add(this.plateWaffle);
    reg(this.plateWaffle, { kind: 'waffle', label: 'Your waffle', station: 'plate' }, 0.34, 0.06);
    this.toppingMeshes = {};

    // --- toppings tray ---
    this.tray = [];
    Object.keys(V.TOPPINGS).forEach((k, i) => {
      const t = V.TOPPINGS[k], col = i % 4, row = Math.floor(i / 4);
      const g = new THREE.Group();
      g.add(V.build([
        V.p(V.cyl(0.155, 0.12, 0.1, 16), '#fffaf0', 0, 0.05, 0, { mat: 'shiny', tex: 'ceramic', rep: 2 }),
        V.p(V.torus(0.152, 0.018, 5, 18), '#7fd1c0', 0, 0.1, 0),
        V.p(V.sphere(0.125, 12, 8), t.color, 0, 0.11, 0, { sy: 0.52, mat: k === 'syrup' || k === 'honey' ? 'shiny' : 'soft' }),
      ]));
      g.position.set(1.5 + col * 0.3, TOP, -0.5 + row * 0.34);
      reg(g, { kind: 'topping', id: k, label: t.name, station: 'plate' }, 0.16, 0.12);
      this.tray.push(g);
    });

    // --- delivery box ---
    const bx = new THREE.Group();
    bx.add(V.build([
      V.p(V.roundedBox(0.5, 0.06, 0.46, 0.03), P.cream, 0, 0.03, 0, { mat: 'soft', tex: 'card', rep: 3 }),
      V.p(V.roundedBox(0.05, 0.26, 0.46, 0.025), P.cream, -0.23, 0.13, 0, { mat: 'soft', tex: 'card', rep: 3 }),
      V.p(V.roundedBox(0.05, 0.26, 0.46, 0.025), P.cream, 0.23, 0.13, 0, { mat: 'soft', tex: 'card', rep: 3 }),
      V.p(V.roundedBox(0.5, 0.26, 0.05, 0.025), P.cream, 0, 0.13, -0.21, { mat: 'soft', tex: 'card', rep: 3 }),
      V.p(V.roundedBox(0.5, 0.26, 0.05, 0.025), P.cream, 0, 0.13, 0.21, { mat: 'soft', tex: 'card', rep: 3 }),
      V.p(V.roundedBox(0.52, 0.04, 0.48, 0.02), P.red, 0, 0.27, 0),
    ]));
    this.boxLid = new THREE.Group(); this.boxLid.position.set(0, 0.28, -0.23);
    this.boxLid.add(V.build([
      V.p(V.roundedBox(0.52, 0.05, 0.48, 0.025), P.cream, 0, 0, 0.23, { mat: 'soft', tex: 'card', rep: 3 }),
      V.p(V.cyl(0.12, 0.12, 0.02, 14), P.gold, 0, 0.035, 0.23, { rx: Math.PI / 2, mat: 'soft' }),
      V.p(V.roundedBox(0.02, 0.17, 0.02, 0.008), P.brown, -0.045, 0.045, 0.23),
      V.p(V.roundedBox(0.02, 0.17, 0.02, 0.008), P.brown, 0.045, 0.045, 0.23),
    ]));
    this.boxLid.rotation.x = -2.2; bx.add(this.boxLid);
    bx.position.set(2.95, TOP, 0.42);
    reg(bx, { kind: 'box', label: 'Delivery box', station: 'plate' }, 0.28, 0.18);
    this.box = bx;
    this.boxCount = new THREE.Group(); this.boxCount.position.set(2.95, TOP + 0.06, 0.42); S.add(this.boxCount);

    // --- sponge by the sink ---
    const sponge = V.build([
      V.p(V.roundedBox(0.26, 0.1, 0.18, 0.04), '#f7d84a', 0, 0.05, 0, { mat: 'soft', tex: 'cloth', rep: 3 }),
      V.p(V.roundedBox(0.26, 0.05, 0.18, 0.03), '#3aa6a6', 0, 0.12, 0, { mat: 'soft', tex: 'cloth', rep: 4 }),
    ]);
    sponge.position.set(-2.15, TOP + 0.08, 0.42);
    reg(sponge, { kind: 'sponge', label: 'Sponge — tap it, then tap a mess', station: 'prep' }, 0.2, 0.08);
    this.sponge = sponge;
    this.spongeHome = sponge.position.clone();

    // --- the wombat chef ---
    // a wombat is a low animal — it needs a step to reach the counter
    const step = V.build([
      V.p(V.roundedBox(1.15, 0.42, 0.7, 0.06), '#b07c4a', 0, 0.21, 0, { mat: 'soft', tex: 'wood', rep: 3 }),
      V.p(V.roundedBox(1.2, 0.07, 0.75, 0.03), '#c9945e', 0, 0.44, 0, { tex: 'wood', rep: 3 }),
      V.p(V.roundedBox(1.0, 0.06, 0.6, 0.02), '#96663a', 0, 0.06, 0, { tex: 'wood', rep: 3 }),
    ]);
    step.position.set(0.9, 0, -1.12); S.add(step);
    this.chef = V.hero({});
    this.chef.position.set(0.9, 0.48, -1.12); this.chef.scale.setScalar(1.5); S.add(this.chef);
    this.chefSq = new FW.Kart.Spring(1, 200, 12);
    const chefKey = new THREE.PointLight('#ffe2b8', 1.5, 3.2, 2); chefKey.position.set(0.85, 2.2, 0.15); S.add(chefKey);

    // the order tablet: this is where the ticket lives now
    const stand = V.build([
      V.p(V.roundedBox(0.34, 0.03, 0.2, 0.012), '#3a3d44', 0, 0.015, 0, { mat: 'shiny' }),
      V.p(V.roundedBox(0.3, 0.16, 0.03, 0.012), '#3a3d44', 0, 0.09, -0.07, { rx: -0.5, mat: 'shiny' }),
    ]);
    stand.position.set(-2.3, TOP, -0.3); stand.rotation.y = 0.42; S.add(stand);
    this.phone = new FW.Phone({ scale: 3.0, glow: 0.35 });
    this.phone.mode = 'order';
    this.phone.object.position.set(-2.3, TOP + 0.28, -0.29);
    this.phone.object.rotation.set(-0.52, 0.42, 0);
    S.add(this.phone.object);

    // halo under whatever you should tap next
    this.halo = new THREE.Mesh(V.torus(0.42, 0.035, 6, 26), FW.Pixel.flat('#f7c544'));
    this.halo.rotation.x = -Math.PI / 2; this.halo.visible = false; S.add(this.halo);
    this.popper(this.bowl); this.popper(this.ironG); this.popper(this.box); this.popper(this.plateWaffle, 0.48); this.popper(this.fridge);
  }
  rugTexture() {
    const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#b4553f'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#e3b06a'; g.fillRect(8, 8, S - 16, S - 16);
    g.fillStyle = '#b4553f'; g.fillRect(18, 18, S - 36, S - 36);
    g.fillStyle = '#3f7d6a'; g.fillRect(28, 28, S - 56, S - 56);
    g.fillStyle = '#e3b06a';
    for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(S / 2, S / 2, 8 + i * 5, 0, 7); g.stroke(); }
    g.strokeStyle = '#f2dfc0'; g.lineWidth = 2;
    for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(S / 2, S / 2, 10 + i * 6, 0, 7); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  windowTexture() {
    // The view out of the window used to be a flat cartoon. Paint it like a
    // photograph instead: a graded sky, layered ridges fading into haze, a
    // granite wall catching the sun, and a treeline drawn strand by strand.
    const W = 768, H = 560, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const R = (a, b) => a + Math.random() * (b - a);
    // sky
    const sky = g.createLinearGradient(0, 0, 0, H * 0.72);
    sky.addColorStop(0, '#4b83bd'); sky.addColorStop(0.42, '#8fb9dc');
    sky.addColorStop(0.78, '#cfdfe6'); sky.addColorStop(1, '#e8e2d4');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // sun haze
    const sun = g.createRadialGradient(W * 0.78, H * 0.16, 4, W * 0.78, H * 0.16, W * 0.42);
    sun.addColorStop(0, 'rgba(255,247,222,0.95)'); sun.addColorStop(0.25, 'rgba(255,240,205,0.28)'); sun.addColorStop(1, 'rgba(255,240,205,0)');
    g.fillStyle = sun; g.fillRect(0, 0, W, H);
    // soft cloud banks
    for (let i = 0; i < 30; i++) {
      const x = R(0, W), y = R(H * 0.06, H * 0.34), r = R(24, 92);
      const cg = g.createRadialGradient(x, y, 0, x, y, r);
      cg.addColorStop(0, `rgba(255,255,255,${R(0.14, 0.4).toFixed(2)})`); cg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = cg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    // ridge layers, each hazier than the one behind it
    const ridge = (baseY, amp, col, haze) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
      g.lineTo(0, baseY);
      for (let x = 0; x <= W; x += 8) {
        const n = Math.sin(x * 0.006 + baseY) * amp + Math.sin(x * 0.021 + baseY * 0.5) * amp * 0.4 + Math.sin(x * 0.05) * amp * 0.12;
        g.lineTo(x, baseY - n);
      }
      g.lineTo(W, H); g.closePath(); g.fill();
      if (haze) { g.fillStyle = haze; g.fillRect(0, baseY - amp * 1.6, W, H - baseY + amp * 1.6); }
    };
    ridge(H * 0.52, 54, '#8fa3b0', 'rgba(207,223,230,0.55)');
    ridge(H * 0.60, 44, '#6f8493', 'rgba(207,223,230,0.34)');
    // the granite wall: a lit face and a shaded one, with fracture lines
    g.save(); g.beginPath();
    g.moveTo(W * 0.06, H); g.lineTo(W * 0.10, H * 0.60); g.lineTo(W * 0.24, H * 0.30);
    g.lineTo(W * 0.40, H * 0.52); g.lineTo(W * 0.46, H); g.closePath(); g.clip();
    const gr = g.createLinearGradient(W * 0.06, 0, W * 0.46, 0);
    gr.addColorStop(0, '#7c7a78'); gr.addColorStop(0.5, '#b3ada4'); gr.addColorStop(1, '#8e8a84');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = `rgba(60,58,56,${R(0.05, 0.22).toFixed(2)})`; g.lineWidth = R(0.7, 2.4);
      const x = R(W * 0.06, W * 0.46), y = R(H * 0.3, H);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + R(-30, 30), y + R(30, 130)); g.stroke();
    }
    g.restore();
    // conifer treeline, drawn as individual silhouettes so it reads as forest
    const treeline = (baseY, hMin, hMax, col, n) => {
      g.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const x = (i / n) * W + R(-6, 6), h = R(hMin, hMax), w = h * R(0.2, 0.32);
        g.beginPath(); g.moveTo(x, baseY);
        for (let k = 0; k <= 7; k++) {
          const t = k / 7, y = baseY - h * t, ww = w * (1 - t) * (0.6 + 0.4 * Math.abs(Math.sin(k * 2.1)));
          g.lineTo(x - ww, y);
        }
        g.lineTo(x, baseY - h);
        for (let k = 7; k >= 0; k--) {
          const t = k / 7, y = baseY - h * t, ww = w * (1 - t) * (0.6 + 0.4 * Math.abs(Math.sin(k * 2.1)));
          g.lineTo(x + ww, y);
        }
        g.closePath(); g.fill();
      }
    };
    treeline(H * 0.78, 60, 130, 'rgba(52,72,62,0.85)', 90);
    treeline(H * 0.88, 90, 190, '#20362c', 70);
    // meadow floor
    const mg = g.createLinearGradient(0, H * 0.84, 0, H);
    mg.addColorStop(0, '#4d6b3c'); mg.addColorStop(1, '#6d8a48');
    g.fillStyle = mg; g.fillRect(0, H * 0.84, W, H * 0.16);
    for (let i = 0; i < 1200; i++) {
      g.strokeStyle = `rgba(${30 + Math.random() * 60 | 0},${70 + Math.random() * 60 | 0},${40 + Math.random() * 40 | 0},${R(0.15, 0.5).toFixed(2)})`;
      g.lineWidth = R(0.8, 1.8);
      const x = R(0, W), y = R(H * 0.84, H);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + R(-3, 3), y - R(4, 12)); g.stroke();
    }
    // glass: a faint sheen and a little grime in the corners
    const sheen = g.createLinearGradient(0, 0, W, H);
    sheen.addColorStop(0, 'rgba(255,255,255,0.16)'); sheen.addColorStop(0.35, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.75, 'rgba(255,255,255,0)'); sheen.addColorStop(1, 'rgba(255,255,255,0.10)');
    g.fillStyle = sheen; g.fillRect(0, 0, W, H);
    const vig = g.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.8);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(40,45,50,0.22)');
    g.fillStyle = vig; g.fillRect(0, 0, W, H);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }

  // ---------- mess ----------
  addMess(x, z, color, floor) {
    if (this.messes.length > 22) return;
    const g = new THREE.Group();
    const mat = FW.Pixel.mat(color, { roughness: 0.35, envMapIntensity: 1.1 });
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const r = 0.05 + Math.random() * 0.075;
      const b = new THREE.Mesh(FW.Models.sphere(r, 10, 6), mat);
      b.position.set((Math.random() - 0.5) * 0.22, 0, (Math.random() - 0.5) * 0.2);
      b.scale.y = 0.14; g.add(b);
    }
    g.position.set(x, (floor ? 0.02 : this.TOP + 0.075), z);
    g.scale.setScalar(0.01);
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    proxy.position.y = 0.05; g.add(proxy);
    this.scene.add(g);
    const mess = { g, x, z, floor, wiped: false };
    this.messes.push(mess);
    g.traverse((o) => { o.userData.pick = g; });
    g.userData = { kind: 'mess', label: 'Wipe it up', mess, proxy };
    this.taps.push(g);
    this.tween(g, 'scale', { x: 1, y: 1, z: 1 }, 0.3, null, FW.Kitchen.easeBack);
    FW.Audio.sfx.splat();
    FW.HUD.mess(this.messes.length);
    return mess;
  }
  wipe(mess) {
    if (mess.wiped) return;
    mess.wiped = true;
    const i = this.messes.indexOf(mess); if (i >= 0) this.messes.splice(i, 1);
    const j = this.taps.indexOf(mess.g); if (j >= 0) this.taps.splice(j, 1);
    this.tween(mess.g, 'scale', { x: 0.01, y: 0.01, z: 0.01 }, 0.22, () => this.scene.remove(mess.g));
    FW.Audio.sfx.squeak();
    this.fx.ring(mess.g.position.x, mess.g.position.y + 0.08, mess.g.position.z, 8, { color: ['#ffffff', '#bfe3ff'], speed: 0.7, up: 0.7, life: 0.45, size: 0.03, gravity: 2 });
    FW.HUD.mess(this.messes.length);
    FW.HUD.popup('Clean!', 'mint small');
  }
  spillNear(obj, color, floor) {
    const a = Math.random() * Math.PI * 2, r = 0.28 + Math.random() * 0.3;
    this.addMess(obj.position.x + Math.cos(a) * r, obj.position.z + Math.sin(a) * r * 0.6, color, floor);
  }

  // ---------- flow ----------
  startOrder(order) {
    this.order = order; this.index = 0; this.made = [];
    this.boxCount.clear(); this.boxLid.rotation.x = -2.2;
    this.beginWaffle();
  }
  beginWaffle() {
    this.cur = { counts: { flour: 0, sugar: 0, egg: 0, milk: 0 }, whisk: 0, stirs: 0, smooth: 0, flip: 0, cook: 0, toppings: new Set(), doneness: 0.5 };
    this.state = 'mixing'; this.cook = 0; this.addPitch = 0; this.held = null;
    this.batter.visible = false; this.batter.material.color.set('#f7e6b8');
    this.ironBatter.visible = false; this.ironWaffle.visible = false; this.plateWaffle.visible = false;
    for (const k in this.toppingMeshes) this.plateWaffle.remove(this.toppingMeshes[k]);
    this.toppingMeshes = {};
    this.lumpG.clear(); this.lumps = [];
    this.ironPivot.rotation.x = 0; this.lid.rotation.x = -2.45; this.ironLight.material.color.set('#552222');
    this.whisk.visible = true; this.whisk.position.set(this.bowl.position.x, this.TOP + 0.06, this.bowl.position.z);
    const r = this.order.waffles[this.index].recipe;
    this.hint(`Waffle ${this.index + 1}/${this.order.waffles.length}: <b>${FW.HUD.esc(r.name)}</b> — tap the <b>fridge</b> for ingredients`);
    this.progress();
    FW.Audio.sfx.bell();
  }
  toggleFridge(open) {
    const want = open === undefined ? !this.fridgeOpen : !!open;
    if (want === this.fridgeOpen) return;
    this.fridgeOpen = want;
    this.tween(this.fridgeDoor, 'rotation', { y: this.fridgeOpen ? -2.1 : 0 }, 0.45, null, FW.Kitchen.easeBack);
    FW.Audio.sfx.clack();
    this.pop(this.fridge, 5);
    if (this.fridgeOpen) this.hint('Tap an ingredient to add a scoop — the ticket says how many');
  }
  addIngredient(k, from) {
    if (this.state !== 'mixing') { FW.HUD.popup('The batter is already mixed!', 'small'); return; }
    const c = this.cur.counts, need = this.order.waffles[this.index].recipe.batter[k] || 0;
    if (c[k] >= 6) return;
    c[k]++;
    const over = c[k] > need + 1;
    FW.Audio.sfx.note(this.addPitch++);
    const col = FW.Orders.ING[k].color;
    const src = from ? from.position.clone() : this.bowl.position.clone();
    // a scoop arcs across the kitchen into the bowl
    const m = new THREE.Mesh(FW.Models.sphere(0.07, 8, 6), FW.Pixel.mat(col));
    m.position.copy(src); this.scene.add(m);
    const to = this.bowl.position.clone().add(new THREE.Vector3(0, 0.22, 0));
    const t0 = { v: 0 };
    const dur = 0.42;
    this.tweens.push({ obj: { position: m.position }, prop: 'position', from: src.clone(), to, t: 0, dur, ease: FW.U.easeInOut,
      cb: () => {
        this.scene.remove(m);
        this.updateBatter(true); this.pop(this.bowl, 11); this.chefSq.kick(5);
        this.fx.burst(this.bowl.position.x, this.bowl.position.y + 0.3, this.bowl.position.z, 9, { color: [col, '#ffffff'], speed: 0.7, up: 1.4, life: 0.5, size: 0.035, extra: { gravity: 3.5 } });
        if (over) { this.spillNear(this.bowl, col, false); FW.HUD.popup('Too much! It slopped over', 'bad small'); }
        this.progress();
      } });
    // arc it
    const arc = { m, t: 0, dur };
    this.arcs = this.arcs || []; this.arcs.push(arc);
  }
  updateBatter(pop) {
    const c = this.cur.counts, total = c.flour + c.sugar + c.egg + c.milk;
    if (!total) { this.batter.visible = false; return; }
    this.batter.visible = true;
    const h = Math.min(0.17, 0.032 * total);
    this.batter.scale.set(1, h / 0.06, 1);
    this.batter.position.y = 0.07 + h / 2;
    const col = new THREE.Color('#f7e6b8');
    col.lerp(new THREE.Color('#f7d84a'), Math.min(0.5, c.egg * 0.18));
    col.lerp(new THREE.Color('#ffffff'), Math.min(0.4, c.milk * 0.12 + c.flour * 0.05));
    this.batter.material.color.copy(col);
    // lumps you can actually see disappear as you whisk
    while (this.lumps.length < Math.min(9, total * 2)) {
      const l = new THREE.Mesh(FW.Models.sphere(0.028 + Math.random() * 0.016, 7, 5), FW.Pixel.mat('#fffaf0', { roughness: 0.9 }));
      const a = Math.random() * 6.28, r = Math.random() * 0.16;
      l.position.set(Math.cos(a) * r, this.batter.position.y + h / 2, Math.sin(a) * r);
      l.scale.y = 0.6; this.lumpG.add(l); this.lumps.push(l);
    }
    for (const l of this.lumps) l.position.y = this.batter.position.y + h / 2 - 0.005;
    if (pop) { this.batter.scale.set(1.25, (h / 0.06) * 0.7, 1.25); this.batterPop = 0.28; }
  }
  stir() {
    const total = Object.values(this.cur.counts).reduce((a, b) => a + b, 0);
    if (!total) { FW.HUD.popup('Nothing in the bowl yet', 'small'); return; }
    this.cur.stirs++;
    this.stirSpin = (this.stirSpin || 0) + 2.4;
    this.pop(this.bowl, 7);
    this.chefSq.kick(4);
    FW.Audio.sfx.stir();
    this.fx.burst(this.bowl.position.x, this.bowl.position.y + 0.26, this.bowl.position.z, 4, { color: ['#f7e6b8', '#ffffff'], speed: 0.5, up: 0.9, life: 0.35, size: 0.024, extra: { gravity: 4 } });
    // each stir smooths out a lump
    if (this.lumps.length) {
      const l = this.lumps.pop();
      this.lumpG.remove(l);
    }
    const target = Math.min(9, total * 2);
    this.cur.smooth = target ? FW.U.clamp(this.cur.stirs / target, 0, 2) : 1;
    if (this.lumps.length === 0 && !this.smoothAnnounced) {
      this.smoothAnnounced = true;
      FW.HUD.popup('Silky smooth!', 'gold');
      FW.Audio.sfx.sparkle();
      this.fx.ring(this.bowl.position.x, this.bowl.position.y + 0.32, this.bowl.position.z, 12, { color: ['#fff6a8', '#ffffff'], speed: 1.1, up: 1.0, life: 0.6, size: 0.032, gravity: 3 });
      this.hint('Batter is ready — tap the <b>waffle iron</b> to pour it in');
    }
    // keep beating past smooth and it splatters
    if (this.lumps.length === 0 && this.cur.stirs > target + 3 && Math.random() < 0.5) {
      this.spillNear(this.bowl, '#f2e2b4', Math.random() < 0.4);
      FW.HUD.popup('Batter everywhere!', 'bad small');
    }
  }
  pour() {
    const total = Object.values(this.cur.counts).reduce((a, b) => a + b, 0);
    if (!total) { FW.HUD.popup('The bowl is empty!', 'bad small'); return; }
    const target = Math.min(9, total * 2);
    this.cur.whisk = FW.U.clamp(0.35 + 0.65 * Math.min(1, this.cur.stirs / Math.max(1, target)) - Math.max(0, this.cur.stirs - target - 4) * 0.06, 0.2, 1);
    this.state = 'pouring';
    FW.Audio.sfx.pour();
    this.pourTimer = 0.8;
    this.ironBatter.visible = true; this.ironBatter.scale.set(0.2, 0.4, 0.2);
    this.ironBatter.material.color.copy(this.batter.material.color);
    this.tween(this.bowl, 'position', { x: this.ironG.position.x, y: this.TOP + 0.5, z: this.ironG.position.z + 0.1 }, 0.4, () => this.tween(this.bowl, 'rotation', { x: -1.15 }, 0.3));
    this.tween(this.whisk, 'position', { x: -2.15, y: this.TOP + 0.12, z: 0.1 }, 0.4);
    if (Math.random() < 0.35) setTimeout(() => this.spillNear(this.ironG, '#f2e2b4', false), 500);
  }
  closeLid() {
    this.batter.visible = false; this.lumpG.clear(); this.lumps = [];
    this.tween(this.bowl, 'rotation', { x: 0 }, 0.3);
    this.tween(this.bowl, 'position', { x: -1.25, y: this.TOP, z: 0.3 }, 0.45, null, FW.Kitchen.easeBack);
    this.tween(this.lid, 'rotation', { x: 0 }, 0.36, () => {
      this.state = 'cooking'; this.cook = 0;
      this.ironLight.material.color.set('#e5564a');
      FW.Audio.setSizzle(1); FW.Audio.sfx.clack();
      this.pop(this.ironG, 9);
      this.hint('Watch the steam and the colour — tap the iron to <b>lift it out</b> when it looks golden');
    });
  }
  // no meter, no zone: you judge it by how it looks and smells
  lift() {
    if (this.state !== 'cooking') return;
    const d = FW.U.clamp(this.cook / 100, 0, 1.3);
    // golden is around 0.58; score falls off either side
    const score = FW.U.clamp(1 - Math.abs(d - 0.58) / 0.42, 0, 1);
    this.cur.flip = score; this.cur.cook = score; this.cur.doneness = FW.U.clamp(d * 0.92, 0, 1);
    this.state = 'lifting';
    FW.Audio.setSizzle(0); FW.Audio.sfx.flip();
    FW.HUD.popup(score > 0.93 ? 'PERFECTLY GOLDEN!' : score > 0.7 ? 'That looks great' : d < 0.58 ? 'A bit pale...' : 'Ooh, overdone', score > 0.7 ? 'gold' : 'bad');
    if (score > 0.93) { FW.Audio.sfx.sparkle(); this.confetti(this.ironG.position, 20); }
    this.ironLight.material.color.set('#552222');
    this.chefSq.kick(12); this.pop(this.ironG, 14);
    for (let i = 0; i < 16; i++) this.fx.spawn({ x: this.ironG.position.x + (Math.random() - 0.5) * 0.6, y: this.TOP + 0.3, z: this.ironG.position.z + (Math.random() - 0.5) * 0.5, vy: 0.9 + Math.random() * 0.6, life: 1.2, size: 0.06, color: '#ffffff', gravity: -0.5, shrink: false });
    const dn = this.cur.doneness;
    this.tween(this.lid, 'rotation', { x: -2.45 }, 0.34, () => {
      this.ironBatter.visible = false;
      this.plateWaffle.visible = true; this.plateWaffle.userData.setDoneness(dn);
      this.plateWaffle.position.set(this.ironG.position.x, this.TOP + 0.55, this.ironG.position.z);
      this.tween(this.plateWaffle, 'position', { x: 1.15, y: this.TOP + 0.055, z: 0.3 }, 0.46, () => {
        this.pop(this.plateWaffle, 14); FW.Audio.sfx.plop();
        this.state = 'topping'; this.addPitch = 0;
        this.hint('Tap a <b>topping</b>, then tap the <b>waffle</b> to place it. Then tap the <b>box</b>');
      }, FW.Kitchen.easeBack);
    });
  }
  pickTopping(k) {
    if (this.state !== 'topping') { FW.HUD.popup('Cook a waffle first', 'small'); return; }
    this.held = this.held === k ? null : k;
    FW.Audio.sfx.pick();
    FW.HUD.popup(this.held ? `${FW.Models.TOPPINGS[k].name} — tap the waffle` : 'Put it back', this.held ? 'mint small' : 'small');
  }
  placeTopping(point) {
    const k = this.held; if (!k) return;
    const T = this.cur.toppings;
    if (T.has(k)) { T.delete(k); this.plateWaffle.remove(this.toppingMeshes[k]); delete this.toppingMeshes[k]; FW.Audio.sfx.pop(); this.progress(); return; }
    if (T.size >= 4) { FW.HUD.popup('That is plenty of toppings!', 'bad small'); return; }
    T.add(k);
    const m = FW.Models.toppingMesh(k, 0.62);
    if (point) {
      const local = this.plateWaffle.worldToLocal(point.clone());
      const r = Math.hypot(local.x, local.z), lim = 0.42;
      if (r > lim) { local.x *= lim / r; local.z *= lim / r; }
      m.position.set(local.x, this.plateWaffle.userData.top, local.z);
    } else m.position.y = this.plateWaffle.userData.top;
    m.rotation.y = Math.random() * Math.PI * 2;
    this.plateWaffle.add(m); this.toppingMeshes[k] = m;
    m.userData.pop = 0.3;
    FW.Audio.sfx.note(3 + this.addPitch++);
    this.pop(this.plateWaffle, 9);
    const wp = this.plateWaffle.localToWorld(m.position.clone());
    this.fx.ring(wp.x, wp.y + 0.05, wp.z, 7, { color: [FW.Models.TOPPINGS[k].color, '#ffffff'], speed: 0.8, up: 0.8, life: 0.4, size: 0.03, gravity: 3 });
    this.chefSq.kick(3);
    this.held = null;
    this.progress();
  }
  missTopping(x, z) {
    if (!this.held) return;
    this.addMess(x, z, FW.Models.TOPPINGS[this.held].color, false);
    FW.HUD.popup('Dropped it!', 'bad small');
    this.held = null;
  }
  pack() {
    if (this.state !== 'topping') return;
    this.state = 'packing';
    const recipe = this.order.waffles[this.index].recipe;
    const res = FW.Orders.scoreWaffle(recipe, this.cur);
    this.made.push(res);
    this.tween(this.plateWaffle, 'position', { x: this.box.position.x, y: this.TOP + 0.14 + this.index * 0.06, z: this.box.position.z }, 0.42, () => {
      this.plateWaffle.visible = false;
      const w = FW.Models.waffle(0.36);
      w.userData.setDoneness(this.cur.doneness);
      w.position.set(0, this.index * 0.06, 0);
      this.boxCount.add(w);
      this.tween(this.boxLid, 'rotation', { x: 0 }, 0.28, () => {
        FW.Audio.sfx.stamp(); this.pop(this.box, 16); this.confetti(this.box.position, 24);
        const stars = Math.round(res.quality * 5);
        FW.HUD.popup(`${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}  ${res.notes[0]}`, res.quality > 0.75 ? 'gold' : res.quality > 0.45 ? '' : 'bad');
        if (res.quality > 0.75) FW.Audio.sfx.happy();
        this.chefSq.kick(10);
        this.index++; this.progress();
        this.smoothAnnounced = false;
        this.waitTimer = 1.25; this.state = 'wait';
      });
    });
  }
  confetti(at, n = 18) {
    const cols = ['#f7c544', '#e5564a', '#7fd1c0', '#ffffff', '#c9a0f0'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.4;
      this.fx.spawn({ x: at.x, y: this.TOP + 0.35, z: at.z, vx: Math.cos(a) * sp, vy: 1.6 + Math.random() * 1.4, vz: Math.sin(a) * sp,
        life: 1.1 + Math.random() * 0.5, size: 0.035 + Math.random() * 0.02, color: cols[i % cols.length], gravity: 3.2, spin: 14 });
    }
  }

  // ---------- input ----------
  pickAt(m) {
    this.ray.setFromCamera({ x: m.nx, y: m.ny }, this.camera);
    const hits = this.ray.intersectObjects(this.taps, true);
    let fallback = null;
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.pick) o = o.parent;
      if (!o || !o.visible) continue;
      const pick = o.userData.pick;
      if (this.held === 'sponge' && pick === this.sponge) continue;
      // the fridge shell must never swallow a tap meant for the food inside it
      if (pick.userData.kind === 'fridge') { if (!fallback) fallback = { obj: pick, point: h.point }; continue; }
      return { obj: pick, point: h.point };
    }
    return fallback;
  }
  planePoint(m, y) {
    this.plane.constant = -y;
    this.ray.setFromCamera({ x: m.nx, y: m.ny }, this.camera);
    return this.ray.ray.intersectPlane(this.plane, this.hit) ? this.hit.clone() : null;
  }
  goTo(station) {
    if (!this.stations[station] || this.station === station) return;
    this.station = station;
    // walking away from the fridge shuts it, the way you would
    if (station !== 'plate') this.toggleFridge(false);
    FW.Audio.sfx.pick();
  }
  tap(hitObj, point, m) {
    const d = hitObj ? hitObj.userData : null;
    const kind = d ? d.kind : null;
    if (d && d.station) this.goTo(d.station);
    else if (!kind) this.goTo('wide');
    // holding the sponge: taps wipe
    if (this.held === 'sponge') {
      if (kind === 'mess') { this.wipe(d.mess); return; }
      // tapping anything else sets the sponge back down
      this.held = null;
      this.tween(this.sponge, 'position', this.spongeHome, 0.25, null, FW.Kitchen.easeBack);
      FW.Audio.sfx.pop();
      if (this.messes.length) FW.HUD.popup('Sponge down', 'small');
      return;
    }
    switch (kind) {
      case 'fridge': this.toggleFridge(); return;
      case 'ing':
        if (d.inFridge && !this.fridgeOpen) { this.toggleFridge(); return; }
        this.addIngredient(d.id, hitObj); this.pop(this.fridge, 3); return;
      case 'bowl':
        if (this.state === 'mixing') { if (this.lumps.length === 0 && this.cur.stirs > 0) this.pour(); else this.stir(); }
        return;
      case 'iron':
        if (this.state === 'mixing') { if (this.cur.stirs > 0) this.pour(); else FW.HUD.popup('Stir the batter first — tap the bowl', 'small'); }
        else if (this.state === 'cooking') this.lift();
        return;
      case 'topping': this.pickTopping(d.id); return;
      case 'waffle': if (this.held) this.placeTopping(point); return;
      case 'box': if (this.state === 'topping') this.pack(); else FW.HUD.popup('Nothing to pack yet', 'small'); return;
      case 'sponge':
        this.held = 'sponge'; FW.Audio.sfx.pick();
        FW.HUD.popup(this.messes.length ? 'Tap a mess to wipe it' : 'Nothing to clean!', 'mint small');
        return;
      case 'mess':
        FW.HUD.popup('Grab the sponge by the sink first', 'small'); return;
      default:
        if (this.held && this.held !== 'sponge') {
          const p = this.planePoint(m, this.TOP + 0.08);
          if (!p) return;
          const w = this.plateWaffle;
          // near enough counts — you should not have to hit a 30 cm waffle exactly
          if (w.visible && Math.hypot(p.x - w.position.x, p.z - w.position.z) < 0.55) {
            p.y = w.position.y + w.userData.top;
            this.placeTopping(p);
          } else this.missTopping(FW.U.clamp(p.x, -2.8, 3.0), FW.U.clamp(p.z, -0.7, 0.8));
        }
    }
  }

  // ---------- per frame ----------
  update(dt, inp) {
    const U = FW.U;
    this.t += dt;
    this.updateTweens(dt); this.updatePops(dt); this.fx.update(dt);
    // arc the flying scoops
    if (this.arcs) for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i]; a.t += dt;
      const q = Math.min(1, a.t / a.dur);
      a.m.position.y += Math.sin(q * Math.PI) * 0.9 * dt * 2;
      a.m.rotation.x += dt * 9;
      if (q >= 1) this.arcs.splice(i, 1);
    }
    const m = inp.mouse;
    // a tap is the click latch (set on press, cleared once a frame consumes it)
    // so a quick press-release can never fall between two frames
    const tapNow = m.clicked || (m.down && !this.wasDown);
    this.wasDown = m.down;

    const cur = this.pickAt(m);
    const hov = cur ? cur.obj : null;
    if (hov !== this.hover) {
      this.hover = hov;
      document.getElementById('game').style.cursor = hov ? 'pointer' : 'default';
    }
    FW.HUD.tooltip(hov ? (this.held === 'sponge' && hov.userData.kind === 'mess' ? 'Wipe' : hov.userData.label) : '', m.x, m.y);
    if (tapNow) this.tap(hov, cur && cur.point, m);
    if (inp.pressed('flip')) { if (this.state === 'cooking') this.lift(); else if (this.state === 'mixing') this.tap(this.bowl, null, m); }

    // slide toward the tapped station, with a little pointer parallax
    {
      const st = this.stations[this.station];
      const k = 1 - Math.exp(-3.4 * dt);
      this.camPos.lerp(st.pos, k);
      this.camLook.lerp(st.look, k);
      this.camFov = U.damp(this.camFov, st.fov, 3.4, dt);
      const px = U.clamp(m.nx, -1, 1) * 0.16, py = U.clamp(m.ny, -1, 1) * 0.09;
      this.camera.position.set(this.camPos.x + px, this.camPos.y + py, this.camPos.z);
      this.camera.lookAt(this.camLook);
      FW.Pixel.setFov(this.camera, this.camFov);
    }
    if (this.phone) { this.phone.update(dt); }
    // the sponge follows the cursor while held
    if (this.held === 'sponge') {
      const p = this.planePoint(m, this.TOP + 0.22);
      if (p) { p.x = U.clamp(p.x, -3.0, 3.2); p.z = U.clamp(p.z, -0.9, 1.0); this.sponge.position.lerp(p, Math.min(1, 18 * dt)); }
      this.sponge.rotation.z = Math.sin(this.t * 14) * 0.25;
    } else if (this.held) {
      this.sponge.rotation.z = U.damp(this.sponge.rotation.z, 0, 8, dt);
    }
    // halo hints the next tap without ever becoming a timing bar
    let target = null;
    if (this.held === 'sponge' && this.messes.length) target = this.messes[0].g;
    else if (this.state === 'mixing') {
      const need = this.order.waffles[this.index].recipe.batter;
      const missing = ['flour', 'sugar', 'egg', 'milk'].some((k) => (this.cur.counts[k] || 0) < (need[k] || 0));
      target = missing ? (this.fridgeOpen ? this.fridgeItems[0] : this.fridge) : this.bowl;
    } else if (this.state === 'cooking') target = this.ironG;
    else if (this.state === 'topping') target = this.held ? this.plateWaffle : this.tray[0];
    if (target && target.visible) {
      this.halo.visible = true;
      const wp = new THREE.Vector3(); target.getWorldPosition(wp);
      this.halo.position.set(wp.x, target === this.fridge || target.userData.inFridge ? wp.y - 0.1 : this.TOP + 0.03, wp.z + (target === this.fridge ? 0.5 : 0));
      const s = 1 + Math.sin(this.t * 6) * 0.07;
      this.halo.scale.setScalar(s * (target === this.plateWaffle ? 0.95 : target === this.fridge ? 1.9 : 0.9));
      this.halo.material.color.set(this.held === 'sponge' ? '#7fd1c0' : '#f7c544');
    } else this.halo.visible = false;

    // pouring
    if (this.state === 'pouring' && this.pourTimer > 0) {
      this.pourTimer -= dt;
      const bp = this.bowl.position;
      for (let i = 0; i < 2; i++) this.fx.spawn({ x: bp.x + (Math.random() - 0.5) * 0.08, y: bp.y + 0.1, z: bp.z + 0.22, vy: -0.6, vx: (Math.random() - 0.5) * 0.15, vz: (Math.random() - 0.5) * 0.15, life: 0.35, size: 0.05, color: '#f7e6b8', gravity: 6, shrink: false });
      const q = 1 - Math.max(0, this.pourTimer) / 0.8;
      this.ironBatter.scale.set(0.2 + 0.8 * q, 0.4 + 0.6 * q, 0.2 + 0.8 * q);
      if (this.pourTimer <= 0) this.closeLid();
    }
    // cooking: everything you need to judge it is on the iron itself
    if (this.state === 'cooking') {
      this.cook += 16 * dt;
      const d = this.cook / 100;
      const golden = Math.abs(d - 0.58) < 0.13;
      // the iron's own lamp is the doneness readout: amber while it warms,
      // a steady pulsing green in the golden window, an urgent red flash once
      // it starts to catch. No meter, no numbers — you read the appliance.
      const burning = d > 0.8;
      const pulse = 0.55 + 0.45 * Math.sin(this.t * (burning ? 16 : golden ? 6 : 2.5));
      const lamp = this.ironLight.material.color;
      if (golden) lamp.set('#7ed37a').multiplyScalar(0.55 + pulse * 0.65);
      else if (burning) lamp.set('#ff4a2a').multiplyScalar(0.35 + pulse * 0.9);
      else lamp.set('#f0a02a').multiplyScalar(0.3 + pulse * 0.35);
      // and it smokes once it is past saving
      if (burning && Math.random() < dt * 14) this.fx.spawn({ x: this.ironG.position.x + (Math.random() - 0.5) * 0.3, y: this.TOP + 0.3, z: this.ironG.position.z + 0.1, vy: 0.75, vx: (Math.random() - 0.5) * 0.25, life: 1.6, size: 0.06, color: '#4a4038', gravity: -0.5, shrink: false });
      const steam = d < 0.25 ? 4 : d < 0.75 ? 18 : 8;
      if (Math.random() < dt * steam) this.fx.spawn({ x: this.ironG.position.x + (Math.random() - 0.5) * 0.6, y: this.TOP + 0.28, z: this.ironG.position.z + (Math.random() - 0.5) * 0.4, vy: 0.6 + Math.random() * 0.4, vx: (Math.random() - 0.5) * 0.2, vz: (Math.random() - 0.5) * 0.2, life: 1.2, size: 0.05, color: d > 0.85 ? '#6a6a6a' : '#ffffff', gravity: -0.45, shrink: false });
      // a golden smell wisp — the tell that it is ready
      if (golden && Math.random() < dt * 9) this.fx.spawn({ x: this.ironG.position.x, y: this.TOP + 0.34, z: this.ironG.position.z + 0.1, vy: 0.5, vx: (Math.random() - 0.5) * 0.3, life: 1.3, size: 0.045, color: '#f7c544', gravity: -0.4, shrink: false });
      FW.Audio.setSizzle(golden ? 1.35 : burning ? 1.7 : 1);
      this.ironG.rotation.z = Math.sin(this.t * 26) * (golden ? 0.012 : 0.004);
      if (this.cook > 130) this.lift();
      if (d > 0.95 && Math.random() < dt * 0.5) this.spillNear(this.ironG, '#5a4a3a', false);
    }
    if (this.state === 'wait') {
      this.waitTimer -= dt;
      if (this.waitTimer <= 0) {
        if (this.index < this.order.waffles.length) this.beginWaffle();
        else {
          this.state = 'done'; this.hint('');
          if (this.onDone) this.onDone(this.made, this.messes.length);
        }
      }
    }
    // little details
    this.stirSpin = (this.stirSpin || 0) * Math.max(0, 1 - 3 * dt);
    this.batter.rotation.y += this.stirSpin * dt;
    this.lumpG.rotation.y = this.batter.rotation.y;
    if (this.state === 'mixing' || this.state === 'idle') {
      this.whisk.position.set(this.bowl.position.x + Math.sin(this.t * 2) * 0.01, this.TOP + 0.06, this.bowl.position.z);
      this.whisk.rotation.z = 0.3 + this.stirSpin * 0.08;
      this.whisk.rotation.y += this.stirSpin * dt;
    }
    if (this.batterPop > 0) {
      this.batterPop -= dt;
      const k = Math.max(0, this.batterPop) / 0.28, total = Object.values(this.cur.counts).reduce((a, b) => a + b, 0);
      const h = Math.min(0.17, 0.032 * total);
      this.batter.scale.set(1 + k * 0.25, (h / 0.06) * (1 - k * 0.3), 1 + k * 0.25);
    }
    for (const k in this.toppingMeshes) {
      const t = this.toppingMeshes[k];
      if (t.userData.pop > 0) { t.userData.pop -= dt; const q = Math.max(0, t.userData.pop) / 0.3; t.scale.setScalar(0.62 * (1 + Math.sin(q * Math.PI) * 0.45)); }
    }
    if (this.plateWaffle.visible && this.state === 'topping' && !this.tweens.some((t) => t.obj === this.plateWaffle)) {
      this.plateWaffle.position.y = this.TOP + 0.055 + Math.sin(this.t * 2.6) * 0.014;
      this.plateWaffle.rotation.y += dt * 0.25;
    }
    this.fridgeLight.intensity = U.damp(this.fridgeLight.intensity, this.fridgeOpen ? 1.15 : 0, 8, dt);
    // the wombat: heavy, springy, watches your cursor
    const c = this.chef;
    const sq = U.clamp(this.chefSq.update(dt), 0.7, 1.35);
    c.scale.set(1.5 / Math.sqrt(sq), 1.5 * sq, 1.5 / Math.sqrt(sq));
    c.position.y = 0.48 + Math.sin(this.t * 2.2) * 0.022;
    const lookX = hov ? hov.position.x : 0.9;
    c.userData.head.rotation.y = U.damp(c.userData.head.rotation.y, U.clamp((lookX - 0.9) * 0.4, -0.85, 0.85), 8, dt);
    c.userData.head.rotation.x = U.damp(c.userData.head.rotation.x, 0.14, 6, dt);
    const arms = c.userData.arms;
    if (this.state === 'cooking') { arms[0].rotation.z = -(0.5 + Math.sin(this.t * 3.4) * 0.16); arms[1].rotation.z = -arms[0].rotation.z; }
    else { const w = 0.2 + Math.sin(this.t * 1.8) * 0.12 + this.stirSpin * 0.05; arms[0].rotation.z = U.damp(arms[0].rotation.z, -w, 6, dt); arms[1].rotation.z = -arms[0].rotation.z; }
    c.userData.prop.rotation.y += dt * (2.2 + this.stirSpin * 0.6);
    if (c.userData.setExpr) {
      const f = c.userData;
      f.busy = true;
      if (this.state === 'cooking') f.setExpr(Math.abs(this.cook / 100 - 0.58) < 0.13 ? 'joy' : 'focus');
      else if (this.state === 'packing' || this.state === 'wait') f.setExpr('joy');
      else if (this.messes.length > 4) f.setExpr('worry');
      else if (this.stirSpin > 1) f.setExpr('focus');
      else if (this.held) f.setExpr('happy');
      else { f.busy = false; f.setExpr(f.expr === 'blink' ? 'blink' : 'neutral'); }
      f.tickFace(dt);
    }
    if (c.userData.body) { const j = sq - 1; c.userData.body.scale.set(1 - j * 0.5, 1 + j * 0.8, 1 - j * 0.5); }
    this.lights.forEach((l, i) => l.scale.setScalar(0.85 + 0.18 * Math.sin(this.t * 2.6 + i)));
    this.lampLight.intensity = 2.4 + Math.sin(this.t * 3) * 0.22;
  }
  render() { FW.Pixel.render(this.scene, this.camera); }
};
