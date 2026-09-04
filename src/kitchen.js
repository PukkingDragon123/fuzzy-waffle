// Flippin' Waffles — the cozy kitchen. Everything is dragged by hand:
// drag ingredients into the bowl, stir the whisk in circles, tip the bowl onto
// the iron, flip it on the beat, drag toppings onto the waffle, drag it into the box.
window.FW = window.FW || {};

FW.Kitchen = class {
  constructor() {
    const V = FW.Models;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#e0bf93');
    this.scene.environment = FW.Pixel.envIndoor;
    this.camera = new THREE.PerspectiveCamera(48, FW.Pixel.size.aspect, 0.1, 60);
    this.camera.position.set(0, 3.02, 3.16);
    this.camera.lookAt(0, 0.97, -0.52);
    this.fx = new FW.Particles(this.scene, 400);
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hit = new THREE.Vector3();
    this.draggables = []; this.targets = [];
    this.drag = null; this.hover = null; this.wasDown = false; this.tweens = []; this.springs = [];
    this.state = 'idle'; this.order = null; this.index = 0; this.made = []; this.cur = null;
    this.pops = []; this.addPitch = 0;
    this.cook = 0; this.whiskMeter = 0; this.t = 0; this.waitTimer = 0; this.stirAngle = null; this.stirRate = 0;
    this.onDone = null; this.onProgress = null;
    this.TOP = 0.98; this.LIFT = 1.28;
    this.build();
  }
  // ---------- helpers ----------
  spring(obj, prop, k = 190, d = 15) { const s = { obj, prop, v: obj[prop], target: obj[prop], vel: 0, k, d }; this.springs.push(s); return s; }
  tween(obj, prop, to, dur, cb, ease) {
    const src = obj[prop];
    const from = new THREE.Vector3(src.x, src.y, src.z);
    this.tweens.push({ obj, prop, from, to: new THREE.Vector3(to.x ?? from.x, to.y ?? from.y, to.z ?? from.z), t: 0, dur, cb, ease: ease || FW.U.easeInOut });
  }
  static easeBack(t) { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
  // register an object so it can be given a springy squash kick
  popper(obj, base = 1) { const s = { obj, base, spring: new FW.Kart.Spring(1, 210, 12) }; this.pops.push(s); obj.userData.popper = s; return s; }
  pop(obj, amount = 8) { const s = obj && obj.userData.popper; if (s) s.spring.kick(amount); }
  updatePops(dt) {
    for (const s of this.pops) {
      const v = FW.U.clamp(s.spring.update(dt), 0.68, 1.4);
      s.obj.scale.set(s.base / Math.sqrt(v), s.base * v, s.base / Math.sqrt(v));
    }
  }
  updateTweens(dt) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i]; tw.t += dt;
      const p = tw.ease(Math.min(1, tw.t / tw.dur));
      const v = tw.from.clone().lerp(tw.to, p);
      if (tw.prop === 'rotation') tw.obj.rotation.set(v.x, v.y, v.z); else tw.obj[tw.prop].copy(v);
      if (tw.t >= tw.dur) { this.tweens.splice(i, 1); if (tw.cb) tw.cb(); }
    }
  }
  // ---------- scene ----------
  build() {
    const V = FW.Models, P = FW.PAL, M = FW.Pixel.mat, S = this.scene, TOP = this.TOP;
    // lighting: warm window key + bounce + a hanging lamp
    const key = new THREE.DirectionalLight('#fff0d2', 2.1); key.position.set(-3.2, 4.4, 2.6); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera; sc.left = -3.6; sc.right = 3.6; sc.top = 3; sc.bottom = -2.4; sc.near = 1; sc.far = 14;
    key.shadow.bias = -0.0007; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
    S.add(key, key.target);
    S.add(new THREE.HemisphereLight('#ffeacc', '#a07a52', 0.5));
    const rim = new THREE.DirectionalLight('#bcd8ff', 0.45); rim.position.set(2.6, 2.2, -3); S.add(rim);
    const lamp = new THREE.PointLight('#ffb060', 2.2, 5.0, 2); lamp.position.set(-0.2, 2.6, 0.5); S.add(lamp);
    this.lampLight = lamp;

    const box = (w, h, d, c, x, y, z, r = 0.05, mat) => {
      const m = new THREE.Mesh(V.roundedBox(w, h, d, Math.min(r, w / 2.05, h / 2.05, d / 2.05)), mat || M(c));
      m.position.set(x, y, z); m.receiveShadow = true; m.castShadow = true; S.add(m); return m;
    };
    // room
    box(11, 0.3, 8, '#c08a55', 0, -0.15, -0.6, 0.05);
    box(11, 4.6, 0.4, '#f6dcb4', 0, 2.3, -2.5, 0.1);
    box(11, 1.2, 0.44, '#cf9760', 0, 0.6, -2.48, 0.08);
    box(11, 0.1, 0.5, '#96663a', 0, 1.22, -2.48, 0.04);
    box(0.4, 4.6, 8, '#f0d0a0', -4.6, 2.3, -0.6, 0.1);
    box(0.4, 4.6, 8, '#f0d0a0', 4.6, 2.3, -0.6, 0.1);
    // arched window with a painted valley view
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.7), new THREE.MeshBasicMaterial({ map: this.windowTexture() }));
    win.position.set(-2.1, 2.35, -2.28); S.add(win);
    const frame = new THREE.Mesh(V.torus(1.16, 0.09, 8, 24), M(P.cream)); frame.position.set(-2.1, 2.35, -2.25); frame.scale.set(1.0, 0.75, 1); S.add(frame);
    box(2.4, 0.09, 0.1, P.cream, -2.1, 2.35, -2.24, 0.04);
    box(0.09, 1.35, 0.1, P.cream, -2.1, 2.35, -2.24, 0.04);
    // shelf with jars
    box(3.0, 0.1, 0.44, '#b07c4a', 1.7, 2.15, -2.2, 0.04);
    [['#ffb3b3', 0.55], ['#a8e6cf', 0.95], ['#f7c544', 1.35], ['#c9a0f0', 1.75], ['#8fd3f4', 2.15], ['#e5564a', 2.55], ['#fff3dc', 2.9]].forEach(([c, x], i) => {
      const h = 0.24 + (i % 2) * 0.1;
      const jar = new THREE.Mesh(V.cyl(0.11, 0.12, h, 12), M(c, { roughness: 0.35 }));
      jar.position.set(x, 2.2 + h / 2, -2.2); jar.castShadow = true; S.add(jar);
      const lid = new THREE.Mesh(V.cyl(0.115, 0.115, 0.05, 12), M('#96663a')); lid.position.set(x, 2.22 + h, -2.2); S.add(lid);
    });
    // hanging pans + bunting
    for (let i = 0; i < 3; i++) {
      const pan = new THREE.Mesh(V.cyl(0.24 - i * 0.03, 0.24 - i * 0.03, 0.07, 14), M('#b9bfd0', { roughness: 0.35, metalness: 0.25, envMapIntensity: 1.0 }));
      pan.position.set(2.6 + i * 0.55, 2.95, -2.15); pan.rotation.x = Math.PI / 2; pan.castShadow = true; S.add(pan);
      const h = new THREE.Mesh(V.capsule(0.02, 0.16), M('#b9bfd0', { metalness: 0.25, roughness: 0.35 })); h.position.set(2.6 + i * 0.55, 3.18, -2.15); S.add(h);
    }
    this.lights = [];
    const lc = ['#ff8fb0', '#f7c544', '#a8e6cf', '#8fd3f4', '#c9a0f0'];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(V.sphere(0.07, 8, 6), FW.Pixel.flat(lc[i % 5]));
      m.position.set(-4.0 + i * 0.62, 3.55 - Math.abs(Math.sin(i * 0.5)) * 0.28, -2.2); S.add(m); this.lights.push(m);
    }
    // counter
    box(5.6, 0.95, 1.35, '#fff0d4', 0, 0.475, 0.05, 0.1);
    const top = new THREE.Mesh(V.roundedBox(5.8, 0.14, 1.5, 0.06), M('#d9a066', { roughness: 0.5 }));
    top.position.set(0, 0.94, 0.05); top.receiveShadow = true; top.castShadow = true; S.add(top);
    // props: plant, radio, stool, flour sack
    const pot = new THREE.Mesh(V.cyl(0.22, 0.17, 0.3, 12), M('#c94a4a')); pot.position.set(-3.5, 0.15, -1.4); pot.castShadow = true; S.add(pot);
    for (const [x, y, z, r, c] of [[-3.5, 0.42, -1.4, 0.26, '#3f8a57'], [-3.62, 0.62, -1.3, 0.2, '#4f9a5c'], [-3.36, 0.6, -1.5, 0.17, '#5fae6e']]) {
      const l = new THREE.Mesh(V.sphere(r, 9, 7), M(c)); l.position.set(x, y, z); l.scale.y = 0.8; l.castShadow = true; S.add(l);
    }
    const radio = box(0.5, 0.32, 0.26, '#e5564a', 3.4, 2.36, -2.1, 0.07);
    const dial = new THREE.Mesh(V.cyl(0.08, 0.08, 0.04, 12), M('#3a3340')); dial.position.set(3.28, 2.36, -1.95); dial.rotation.x = Math.PI / 2; S.add(dial);
    this.radio = radio;
    const menu = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.85), new THREE.MeshBasicMaterial({ map: FW.Pixel.textTexture('~ todays waffles ~', { w: 512, h: 288, bg: '#3d2c1e', fg: '#fff3dc', font: 'bold 38px monospace', border: '#b07c4a', radius: 26 }), transparent: true }));
    menu.position.set(1.6, 2.95, -2.26); S.add(menu);

    // duck chef, behind the counter
    this.duck = FW.Models.duck({ lollipop: 'wing' });
    this.duck.position.set(0.78, 0.06, -1.0); this.duck.scale.setScalar(1.62); S.add(this.duck);
    const duckKey = new THREE.PointLight('#fff2dc', 1.15, 2.6, 2); duckKey.position.set(0.78, 2.15, -0.55); S.add(duckKey);
    this.duckSq = new FW.Kart.Spring(1, 200, 12);

    // ---------- interactive props ----------
    // an invisible sphere makes every small prop comfortable to grab
    const proxy = (obj, r, y) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
      m.position.y = y; obj.add(m); obj.userData.proxy = m; return m;
    };
    const reg = (obj, data, r, y) => {
      if (r) proxy(obj, r, y);
      obj.traverse((o) => { o.userData.pick = obj; });
      obj.userData = Object.assign(obj.userData, data);
      S.add(obj); return obj;
    };
    const drag = (obj, data, r = 0.18, y = 0.16) => { reg(obj, data, r, y); obj.userData.home = obj.position.clone(); obj.userData.homeRot = obj.rotation.clone(); this.draggables.push(obj); return obj; };
    const targ = (obj, data, r = 0.36, y = 0.16) => { reg(obj, data, r, y); this.targets.push(obj); return obj; };

    // ingredients
    const flour = V.build([
      V.p(V.roundedBox(0.26, 0.32, 0.2, 0.06), '#f2ecdf', 0, 0.16, 0, { mat: 'soft' }),
      V.p(V.roundedBox(0.2, 0.06, 0.16, 0.03), '#e6ddc9', 0, 0.33, 0, { mat: 'soft' }),
      V.p(V.roundedBox(0.16, 0.12, 0.02, 0.02), '#e5564a', 0, 0.17, 0.105),
      V.p(V.cyl(0.06, 0.05, 0.02, 10), '#fff3dc', 0, 0.18, 0.118, { rx: Math.PI / 2 }),
    ]);
    flour.position.set(-2.02, TOP, -0.34); drag(flour, { kind: 'ing', id: 'flour', label: 'Flour' }, 0.2, 0.18);
    const sugar = V.build([
      V.p(V.cyl(0.13, 0.12, 0.26, 14), '#fbe9f0', 0, 0.13, 0, { mat: 'shiny' }),
      V.p(V.cyl(0.14, 0.14, 0.05, 14), '#b46e3f', 0, 0.28, 0, { mat: 'soft' }),
      V.p(V.sphere(0.045, 8, 6), '#ffb3b3', 0, 0.32, 0),
    ]);
    sugar.position.set(-1.64, TOP, -0.36); drag(sugar, { kind: 'ing', id: 'sugar', label: 'Sugar' }, 0.19, 0.16);
    const egg = V.build([V.p(V.sphere(0.1, 12, 9), '#fff5e0', 0, 0.12, 0, { sy: 1.3, mat: 'soft' })]);
    egg.position.set(-1.3, TOP, -0.34); drag(egg, { kind: 'ing', id: 'egg', label: 'Egg' }, 0.17, 0.12);
    const milk = V.build([
      V.p(V.cyl(0.11, 0.12, 0.3, 12), '#f2f6ff', 0, 0.15, 0, { mat: 'shiny' }),
      V.p(V.cyl(0.05, 0.07, 0.1, 10), '#f2f6ff', 0, 0.34, 0, { mat: 'shiny' }),
      V.p(V.cyl(0.06, 0.06, 0.04, 10), '#4a7fd6', 0, 0.4, 0),
      V.p(V.roundedBox(0.13, 0.1, 0.02, 0.02), '#4a7fd6', 0, 0.17, 0.105),
    ]);
    milk.position.set(-0.96, TOP, -0.36); drag(milk, { kind: 'ing', id: 'milk', label: 'Milk' }, 0.19, 0.2);

    // bowl (drop target + draggable for pouring)
    const bowl = new THREE.Group();
    const bowlMesh = V.build([
      V.p(V.sphere(0.28, 18, 11, { thetaS: Math.PI / 2, thetaL: Math.PI / 2 }), '#f7efe0', 0, 0.27, 0, { sy: 0.9, mat: 'shell' }),
      V.p(V.torus(0.276, 0.03, 6, 22), '#4a7fd6', 0, 0.27, 0, { rx: Math.PI / 2 }),
      V.p(V.cyl(0.13, 0.09, 0.04, 12), '#e6ddc9', 0, 0.02, 0),
    ]);
    bowl.add(bowlMesh);
    this.batter = new THREE.Mesh(V.cyl(0.23, 0.17, 0.06, 18), M('#f7e6b8', { roughness: 0.42 }));
    this.batter.position.y = 0.09; this.batter.visible = false; bowl.add(this.batter);
    bowl.position.set(-1.56, TOP, 0.34);
    targ(bowl, { kind: 'bowl', label: 'Mixing bowl' }, 0.3, 0.16); drag(bowl, { kind: 'bowl', label: 'Mixing bowl' }, 0, 0);
    this.bowl = bowl;

    // whisk
    const whisk = new THREE.Group();
    whisk.add(V.build([
      V.p(V.capsule(0.028, 0.2), '#e5564a', 0, 0.3, 0, { mat: 'soft' }),
      V.p(V.capsule(0.018, 0.14), '#d3d7e2', 0, 0.14, 0, { mat: 'shiny' }),
      ...[0, 1, 2, 3].map((i) => V.p(V.torus(0.055, 0.008, 5, 14, Math.PI), '#d3d7e2', 0, 0.06, 0, { ry: i * Math.PI / 4, rz: 0, mat: 'shiny' })),
    ]));
    whisk.position.set(-0.82, TOP + 0.02, 0.34);
    drag(whisk, { kind: 'whisk', label: 'Whisk — stir in circles!' }, 0.2, 0.24);
    this.whisk = whisk;

    // waffle iron
    const ironG = new THREE.Group(); ironG.position.set(-0.02, TOP, -0.05);
    ironG.add(V.build([
      V.p(V.roundedBox(0.14, 0.13, 0.14, 0.05), FW.PAL.steel, -0.28, 0.065, 0, { mat: 'shiny' }),
      V.p(V.roundedBox(0.14, 0.13, 0.14, 0.05), FW.PAL.steel, 0.28, 0.065, 0, { mat: 'shiny' }),
      V.p(V.roundedBox(0.76, 0.05, 0.46, 0.02), '#8a5a2b', 0, 0.02, 0),
    ]));
    this.ironPivot = new THREE.Group(); this.ironPivot.position.y = 0.14; ironG.add(this.ironPivot);
    this.ironPivot.add(V.build([
      V.p(V.cyl(0.35, 0.37, 0.11, 22), '#e5564a', 0, 0, 0, { mat: 'shiny' }),
      V.p(V.torus(0.35, 0.035, 6, 24), '#fff3dc', 0, 0.02, 0, { rx: Math.PI / 2 }),
      V.p(V.cyl(0.3, 0.3, 0.03, 20), '#8e8a99', 0, 0.06, 0, { mat: 'shiny' }),
      ...[-0.19, -0.065, 0.065, 0.19].flatMap((v) => {
        const half = Math.sqrt(Math.max(0.001, 0.29 * 0.29 - v * v));
        return [V.p(V.roundedBox(0.045, 0.05, half * 2, 0.02), '#6e6a7a', v, 0.075, 0, { mat: 'shiny' }),
                V.p(V.roundedBox(half * 2, 0.05, 0.045, 0.02), '#6e6a7a', 0, 0.075, v, { mat: 'shiny' })];
      }),
    ]));
    this.lid = new THREE.Group(); this.lid.position.set(0, 0.06, -0.35);
    this.lid.add(V.build([
      V.p(V.cyl(0.35, 0.35, 0.12, 22), '#e5564a', 0, 0.05, 0.35, { mat: 'shiny' }),
      V.p(V.torus(0.35, 0.035, 6, 24), '#fff3dc', 0, 0.05, 0.35, { rx: Math.PI / 2 }),
      V.p(V.cyl(0.3, 0.3, 0.03, 20), '#a5a1b0', 0, -0.005, 0.35, { mat: 'shiny' }),
      V.p(V.capsule(0.035, 0.18), '#fff3dc', 0, 0.12, 0.7, { rz: Math.PI / 2, mat: 'soft' }),
      V.p(V.roundedBox(0.09, 0.05, 0.1, 0.02), '#c9463c', 0, 0.1, 0.65),
    ]));
    this.ironLight = new THREE.Mesh(V.sphere(0.036, 8, 6), FW.Pixel.flat('#552222'));
    this.ironLight.position.set(0.18, 0.11, 0.63); this.lid.add(this.ironLight);
    this.lid.rotation.x = -2.0; this.ironPivot.add(this.lid);
    this.ironBatter = new THREE.Mesh(V.cyl(0.28, 0.26, 0.05, 18), M('#f7e6b8', { roughness: 0.45 }));
    this.ironBatter.position.y = 0.11; this.ironBatter.visible = false; this.ironPivot.add(this.ironBatter);
    this.ironWaffle = V.waffle(0.46); this.ironWaffle.position.y = 0.1; this.ironWaffle.visible = false; this.ironPivot.add(this.ironWaffle);
    targ(ironG, { kind: 'iron', label: 'Waffle iron' }, 0.44, 0.2);
    this.ironG = ironG;

    // plate + the waffle being decorated
    const mat0 = new THREE.Mesh(V.roundedBox(1.05, 0.035, 0.72, 0.1), M('#c08a55', { roughness: 0.7 }));
    mat0.position.set(-0.02, TOP + 0.02, -0.05); mat0.receiveShadow = true; S.add(mat0);
    const plate = V.build([
      V.p(V.cyl(0.33, 0.28, 0.045, 22), '#f4ebda', 0, 0.022, 0, { mat: 'soft' }),
      V.p(V.torus(0.315, 0.028, 6, 24), '#4a7fd6', 0, 0.042, 0),
    ]);
    plate.position.set(0.86, TOP, 0.3); S.add(plate); this.plate = plate;
    this.plateWaffle = V.waffle(0.48);
    this.plateWaffle.position.set(0.86, TOP + 0.055, 0.3);
    this.plateWaffle.visible = false; S.add(this.plateWaffle);
    targ(this.plateWaffle, { kind: 'waffle', label: 'Drag me into the box!' }, 0.34, 0.06);
    this.draggables.push(this.plateWaffle);
    this.plateWaffle.userData.home = this.plateWaffle.position.clone();
    this.plateWaffle.userData.homeRot = this.plateWaffle.rotation.clone();
    this.toppingMeshes = {};

    // toppings tray
    const keys = Object.keys(V.TOPPINGS);
    this.tray = [];
    keys.forEach((k, i) => {
      const t = V.TOPPINGS[k], col = i % 4, row = Math.floor(i / 4);
      const g = new THREE.Group();
      g.add(V.build([
        V.p(V.cyl(0.155, 0.12, 0.1, 16), '#fffaf0', 0, 0.05, 0, { mat: 'shiny' }),
        V.p(V.torus(0.152, 0.018, 5, 18), '#7fd1c0', 0, 0.1, 0),
        V.p(V.sphere(0.125, 12, 8), t.color, 0, 0.11, 0, { sy: 0.52, mat: k === 'syrup' || k === 'honey' ? 'shiny' : 'soft' }),
      ]));
      g.position.set(1.3 + col * 0.34, TOP, -0.44 + row * 0.36);
      drag(g, { kind: 'topping', id: k, label: t.name }, 0.19, 0.12);
      this.tray.push(g);
    });

    // delivery box
    const bx = new THREE.Group();
    bx.add(V.build([
      V.p(V.roundedBox(0.5, 0.06, 0.46, 0.03), FW.PAL.cream, 0, 0.03, 0, { mat: 'soft' }),
      V.p(V.roundedBox(0.05, 0.26, 0.46, 0.025), FW.PAL.cream, -0.23, 0.13, 0, { mat: 'soft' }),
      V.p(V.roundedBox(0.05, 0.26, 0.46, 0.025), FW.PAL.cream, 0.23, 0.13, 0, { mat: 'soft' }),
      V.p(V.roundedBox(0.5, 0.26, 0.05, 0.025), FW.PAL.cream, 0, 0.13, -0.21, { mat: 'soft' }),
      V.p(V.roundedBox(0.5, 0.26, 0.05, 0.025), FW.PAL.cream, 0, 0.13, 0.21, { mat: 'soft' }),
      V.p(V.roundedBox(0.52, 0.04, 0.48, 0.02), FW.PAL.red, 0, 0.27, 0),
    ]));
    this.boxLid = new THREE.Group(); this.boxLid.position.set(0, 0.28, -0.23);
    this.boxLid.add(V.build([
      V.p(V.roundedBox(0.52, 0.05, 0.48, 0.025), FW.PAL.cream, 0, 0, 0.23, { mat: 'soft' }),
      V.p(V.cyl(0.12, 0.12, 0.02, 14), FW.PAL.gold, 0, 0.035, 0.23, { rx: Math.PI / 2, mat: 'soft' }),
      V.p(V.roundedBox(0.02, 0.17, 0.02, 0.008), FW.PAL.brown, -0.045, 0.045, 0.23),
      V.p(V.roundedBox(0.02, 0.17, 0.02, 0.008), FW.PAL.brown, 0.045, 0.045, 0.23),
      V.p(V.roundedBox(0.17, 0.02, 0.02, 0.008), FW.PAL.brown, 0, 0.045, 0.185),
      V.p(V.roundedBox(0.17, 0.02, 0.02, 0.008), FW.PAL.brown, 0, 0.045, 0.275),
    ]));
    this.boxLid.rotation.x = -2.2; bx.add(this.boxLid);
    bx.position.set(2.0, TOP, 0.38);
    targ(bx, { kind: 'box', label: 'Delivery box' }, 0.36, 0.2);
    this.box = bx;
    this.boxCount = new THREE.Group(); this.boxCount.position.set(2.0, TOP + 0.06, 0.38); S.add(this.boxCount);

    // springy squash on the props you interact with most
    this.popper(this.bowl); this.popper(this.ironG); this.popper(this.box);
    this.popper(this.plateWaffle, 0.48);

    // highlight ring shown under a live drop target
    this.halo = new THREE.Mesh(V.torus(0.42, 0.035, 6, 26), FW.Pixel.flat('#f7c544'));
    this.halo.rotation.x = -Math.PI / 2; this.halo.visible = false; S.add(this.halo);
  }
  windowTexture() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 96; const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 96); grd.addColorStop(0, '#6fb3e8'); grd.addColorStop(0.65, '#bfe0f5'); grd.addColorStop(1, '#ffdcb4');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#fff6d8'; g.beginPath(); g.arc(98, 18, 9, 0, 7); g.fill();
    g.fillStyle = '#ffffff'; for (const [x, y, r] of [[28, 20, 8], [36, 17, 10], [46, 21, 7], [80, 34, 6], [88, 32, 8]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    g.fillStyle = '#b3aec2'; g.beginPath(); g.moveTo(18, 66); g.quadraticCurveTo(44, 16, 68, 66); g.fill();
    g.fillStyle = '#c9c4d4'; g.beginPath(); g.moveTo(60, 66); g.quadraticCurveTo(86, 30, 112, 66); g.fill();
    g.fillStyle = '#f6f7fb'; g.beginPath(); g.moveTo(36, 34); g.lineTo(44, 24); g.lineTo(52, 36); g.fill();
    g.fillStyle = '#3f8a57'; g.beginPath(); g.moveTo(0, 96); g.lineTo(0, 62); g.quadraticCurveTo(64, 52, 128, 60); g.lineTo(128, 96); g.fill();
    g.fillStyle = '#2f6b4a'; for (let i = 0; i < 11; i++) { const x = 4 + i * 12, h = 12 + (i % 3) * 6; g.beginPath(); g.moveTo(x, 72); g.quadraticCurveTo(x + 5, 72 - h, x + 10, 72); g.fill(); }
    g.fillStyle = '#6fb74e'; g.fillRect(0, 72, 128, 24);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  // ---------- flow ----------
  setHint(h) { FW.HUD.hint(h); }
  progress() { if (this.onProgress) this.onProgress({ index: this.index, made: this.made, counts: this.cur ? this.cur.counts : null, toppings: this.cur ? this.cur.toppings : null }); }
  startOrder(order) {
    this.order = order; this.index = 0; this.made = [];
    this.boxCount.clear(); this.boxLid.rotation.x = -2.2;
    this.beginWaffle();
  }
  beginWaffle() {
    this.cur = { counts: { flour: 0, sugar: 0, egg: 0, milk: 0 }, whisk: 0, whisked: false, flip: 0, cook: 0, toppings: new Set(), doneness: 0.5 };
    this.state = 'mixing'; this.cook = 0; this.whiskMeter = 0; this.stirAngle = null; this.stirRate = 0; this.zoneRang = false; this.addPitch = 0;
    this.batter.visible = false; this.batter.material.color.set('#f7e6b8');
    this.ironBatter.visible = false; this.ironWaffle.visible = false; this.plateWaffle.visible = false;
    for (const k in this.toppingMeshes) this.plateWaffle.remove(this.toppingMeshes[k]);
    this.toppingMeshes = {};
    this.ironPivot.rotation.x = 0; this.lid.rotation.x = -2.0; this.ironLight.material.color.set('#552222');
    this.whisk.visible = true; this.whisk.position.copy(this.whisk.userData.home); this.whisk.rotation.copy(this.whisk.userData.homeRot);
    for (const d of this.draggables) { d.userData.returning = false; if (d.userData.home && d !== this.plateWaffle) { d.position.copy(d.userData.home); d.rotation.copy(d.userData.homeRot); } }
    this.bowl.position.copy(this.bowl.userData.home); this.bowl.rotation.copy(this.bowl.userData.homeRot);
    const r = this.order.waffles[this.index].recipe;
    this.setHint(`Waffle ${this.index + 1}/${this.order.waffles.length}: <b>${FW.HUD.esc(r.name)}</b> — <b>drag</b> ingredients into the bowl`);
    FW.HUD.meter(false); this.progress();
    FW.Audio.sfx.bell();
  }
  addIngredient(k, from) {
    if (this.state !== 'mixing') return;
    const c = this.cur.counts;
    if (c[k] >= 5) { FW.HUD.popup('The bowl is full!', 'bad small'); return; }
    c[k]++;
    FW.Audio.sfx.note(this.addPitch++);
    const col = FW.Orders.ING[k].color;
    const at = from || this.bowl.position;
    this.fx.burst(this.bowl.position.x, this.bowl.position.y + 0.3, this.bowl.position.z, 9, { color: [col, '#ffffff'], speed: 0.7, up: 1.4, life: 0.5, size: 0.035, extra: { gravity: 3.5 } });
    this.updateBatter(true);
    this.pop(this.bowl, 11);
    this.duckSq.kick(5);
    this.progress();
  }
  updateBatter(pop) {
    const c = this.cur.counts, total = c.flour + c.sugar + c.egg + c.milk;
    if (!total) { this.batter.visible = false; return; }
    this.batter.visible = true;
    const h = Math.min(0.16, 0.03 * total);
    this.batter.scale.set(1, h / 0.06, 1);
    this.batter.position.y = 0.07 + h / 2;
    const col = new THREE.Color('#f7e6b8');
    col.lerp(new THREE.Color('#f7d84a'), Math.min(0.5, c.egg * 0.18));
    col.lerp(new THREE.Color('#ffffff'), Math.min(0.4, c.milk * 0.12 + c.flour * 0.05));
    this.batter.material.color.copy(col);
    if (pop) { this.batter.scale.set(1.25, (h / 0.06) * 0.7, 1.25); this.batterPop = 0.28; }
  }
  finishWhisk() {
    const m = this.whiskMeter;
    let s, txt, cls;
    if (m >= 70 && m <= 100) { s = 1; txt = 'SMOOTH BATTER!'; cls = 'gold'; FW.Audio.sfx.ding(); }
    else if (m < 70) { s = 0.5 + 0.5 * (m / 70); txt = 'A bit lumpy...'; cls = 'bad'; }
    else { s = Math.max(0.4, 1 - (m - 100) / 40); txt = 'Overmixed!'; cls = 'bad'; }
    this.cur.whisk = s; this.cur.whisked = true; this.state = 'mixed';
    FW.HUD.popup(txt, cls); FW.HUD.meter(false);
    this.setHint('Batter ready! <b>Drag the bowl</b> onto the waffle iron');
    this.fx.ring(this.bowl.position.x, this.bowl.position.y + 0.35, this.bowl.position.z, 12, { color: ['#fff6a8', '#ffffff'], speed: 1.2, up: 1.1, life: 0.6, size: 0.035, gravity: 3 });
    this.pop(this.bowl, s === 1 ? 18 : 8);
    if (s === 1) { FW.Audio.sfx.sparkle(); this.confetti(this.bowl.position, 18); }
    if (this.whisk.userData.home) { this.tween(this.whisk, 'position', this.whisk.userData.home, 0.35, null, FW.Kitchen.easeBack); }
  }
  pour() {
    if (this.state === 'pouring' || this.state === 'cooking' || this.state === 'flipping') return;
    const total = Object.values(this.cur.counts).reduce((a, b) => a + b, 0);
    if (total === 0) { FW.HUD.popup('The bowl is empty!', 'bad small'); return; }
    if (!this.cur.whisked) { this.cur.whisk = 0.35; FW.HUD.popup('Unmixed batter...', 'bad small'); }
    this.state = 'pouring'; FW.Audio.sfx.pour();
    this.drag = null;
    const dest = new THREE.Vector3(this.ironG.position.x, this.TOP + 0.5, this.ironG.position.z + 0.1);
    this.tween(this.bowl, 'position', dest, 0.4, () => {
      this.tween(this.bowl, 'rotation', { x: -1.15 }, 0.35);
      this.pourTimer = 0.85;
      this.ironBatter.visible = true; this.ironBatter.scale.set(0.2, 0.4, 0.2);
      this.ironBatter.material.color.copy(this.batter.material.color);
    });
  }
  closeLid() {
    this.batter.visible = false;
    this.tween(this.bowl, 'rotation', { x: 0 }, 0.3);
    this.tween(this.bowl, 'position', this.bowl.userData.home, 0.45, () => { this.bowl.userData.returning = false; }, FW.Kitchen.easeBack);
    this.tween(this.lid, 'rotation', { x: 0 }, 0.36, () => {
      this.state = 'cooking'; this.cook = 0;
      this.ironLight.material.color.set('#e5564a');
      FW.Audio.setSizzle(1); FW.Audio.sfx.clack();
      this.pop(this.ironG, 9);
      this.setHint('It is cooking! <b>Tap the iron</b> (or Space) when the meter is in the <b>golden zone</b>');
    });
  }
  // the single satisfying beat: flip the iron right over and the waffle lands on the plate
  flipOut() {
    if (this.state !== 'cooking') return;
    const score = this.zoneScore(this.cook, 52, 82);
    this.cur.flip = score; this.cur.cook = score;
    this.cur.doneness = FW.U.clamp(this.cook / 100 * 0.92, 0, 1);
    this.state = 'flipping';
    FW.Audio.setSizzle(0); FW.Audio.sfx.flip();
    FW.HUD.popup(score > 0.95 ? 'PERFECT FLIP!' : score > 0.72 ? 'Nice one!' : this.cook < 52 ? 'Too early...' : 'Ooh, a bit dark', score > 0.72 ? 'gold' : 'bad');
    if (score > 0.95) { FW.Audio.sfx.sparkle(); this.confetti(this.ironG.position, 22); }
    FW.HUD.meter(false);
    this.ironLight.material.color.set('#552222');
    this.duckSq.kick(12); this.pop(this.ironG, 16);
    for (let i = 0; i < 16; i++) this.fx.spawn({ x: this.ironG.position.x + (Math.random() - 0.5) * 0.6, y: this.TOP + 0.3, z: this.ironG.position.z + (Math.random() - 0.5) * 0.5, vy: 0.9 + Math.random() * 0.6, life: 1.2, size: 0.06, color: '#ffffff', gravity: -0.5, shrink: false });
    const d = this.cur.doneness;
    this.tween(this.ironPivot, 'rotation', { x: Math.PI * 2 }, 0.62, () => {
      this.ironPivot.rotation.x = 0;
      this.ironBatter.visible = false;
      this.plateWaffle.visible = true; this.plateWaffle.userData.setDoneness(d);
      this.plateWaffle.position.set(this.ironG.position.x, this.TOP + 0.62, this.ironG.position.z);
      this.tween(this.plateWaffle, 'position', this.plateWaffle.userData.home, 0.46, () => {
        this.pop(this.plateWaffle, 14); FW.Audio.sfx.plop();
        this.fx.ring(this.plateWaffle.position.x, this.plateWaffle.position.y + 0.05, this.plateWaffle.position.z, 10, { color: ['#f7c544', '#ffffff'], speed: 1.1, up: 0.9, life: 0.5, size: 0.035, gravity: 3 });
        this.state = 'topping'; this.addPitch = 0;
        this.setHint('<b>Drag toppings</b> onto the waffle, then <b>drag the waffle</b> into the box');
      }, FW.Kitchen.easeBack);
      this.tween(this.lid, 'rotation', { x: -2.0 }, 0.4);
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
  addTopping(k, worldPos) {
    const T = this.cur.toppings;
    if (T.has(k)) {
      T.delete(k); this.plateWaffle.remove(this.toppingMeshes[k]); delete this.toppingMeshes[k];
      FW.Audio.sfx.pop(); this.progress(); return;
    }
    if (T.size >= 4) { FW.HUD.popup('That is plenty of toppings!', 'bad small'); return; }
    T.add(k);
    const m = FW.Models.toppingMesh(k, 0.62);
    // land it where it was dropped, so placement feels like yours
    if (worldPos) {
      const local = this.plateWaffle.worldToLocal(worldPos.clone());
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
    this.duckSq.kick(3);
    this.progress();
  }
  pack() {
    if (this.state !== 'topping') return;
    this.state = 'packing';
    const recipe = this.order.waffles[this.index].recipe;
    const res = FW.Orders.scoreWaffle(recipe, this.cur);
    this.made.push(res);
    const to = new THREE.Vector3(this.box.position.x, this.TOP + 0.14 + this.index * 0.06, this.box.position.z);
    this.tween(this.plateWaffle, 'position', to, 0.42, () => {
      this.plateWaffle.visible = false;
      const w = FW.Models.waffle(0.36);
      w.userData.setDoneness(this.cur.doneness);
      w.position.set(0, this.index * 0.06, 0);
      this.boxCount.add(w);
      this.tween(this.boxLid, 'rotation', { x: 0 }, 0.28, () => {
        FW.Audio.sfx.stamp(); this.pop(this.box, 16); this.confetti(this.box.position, 24);
        this.fx.ring(this.box.position.x, this.TOP + 0.42, this.box.position.z, 12, { color: ['#f7c544', '#ffffff'], speed: 1.2, up: 1.5, life: 0.6, size: 0.04, gravity: 2 });
        const stars = Math.round(res.quality * 5);
        FW.HUD.popup(`${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}  ${res.notes[0]}`, res.quality > 0.75 ? 'gold' : res.quality > 0.45 ? '' : 'bad');
        if (res.quality > 0.75) FW.Audio.sfx.happy();
        this.duckSq.kick(10);
        this.index++; this.progress();
        this.waitTimer = 1.25; this.state = 'wait';
      });
    });
  }
  zoneScore(v, a, b) {
    if (v >= a && v <= b) return 1 - 0.3 * Math.abs(v - (a + b) / 2) / ((b - a) / 2);
    const out = v < a ? a - v : v - b;
    return Math.max(0, 0.7 - (out / 25) * 0.7);
  }
  // ---------- dragging ----------
  pickAt(list, m, filter) {
    this.ray.setFromCamera({ x: m.nx, y: m.ny }, this.camera);
    const hits = this.ray.intersectObjects(list, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.pick) o = o.parent;
      if (!o) continue;
      const pick = o.userData.pick;
      if (!o.visible || pick.userData.returning) continue;
      if (filter && !filter(pick)) continue;
      return { obj: pick, point: h.point };
    }
    return null;
  }
  goHome(obj, dur = 0.3) {
    obj.userData.returning = true;
    this.tween(obj, 'position', obj.userData.home, dur, () => { obj.userData.returning = false; obj.rotation.copy(obj.userData.homeRot); }, FW.Kitchen.easeBack);
  }
  planePoint(m, y) {
    this.plane.constant = -y;
    this.ray.setFromCamera({ x: m.nx, y: m.ny }, this.camera);
    return this.ray.ray.intersectPlane(this.plane, this.hit) ? this.hit.clone() : null;
  }
  canDrag(obj) {
    const k = obj.userData.kind;
    if (k === 'ing') return this.state === 'mixing';
    if (k === 'whisk') return this.state === 'mixing' || this.state === 'whisking';
    if (k === 'bowl') return this.state === 'mixed' || (this.state === 'mixing' && this.cur && this.cur.whisked);
    if (k === 'topping') return this.state === 'topping';
    if (k === 'waffle') return this.state === 'topping';
    return false;
  }
  startDrag(obj, point) {
    this.drag = { obj, from: obj.position.clone(), rot: obj.rotation.clone(), lift: 0 };
    obj.userData.dragging = true;
    FW.Audio.sfx.pick();
    if (obj.userData.kind === 'whisk') { this.state = 'whisking'; this.stirAngle = null; }
  }
  endDrag() {
    if (!this.drag) return;
    const obj = this.drag.obj, k = obj.userData.kind;
    const m = FW.Input.mouse;
    const over = this.pickAt(this.targets, m);
    const overKind = over ? over.obj.userData.kind : null;
    obj.userData.dragging = false;
    let handled = false;
    if (k === 'ing') {
      const near = Math.hypot(obj.position.x - this.bowl.position.x, obj.position.z - this.bowl.position.z) < 0.62;
      if (overKind === 'bowl' || near) { this.addIngredient(obj.userData.id, obj.position.clone()); handled = true; }
    } else if (k === 'bowl') {
      const near = Math.hypot(obj.position.x - this.ironG.position.x, obj.position.z - this.ironG.position.z) < 0.8;
      if (overKind === 'iron' || near) { this.pour(); handled = true; }
    } else if (k === 'topping') {
      const w = this.plateWaffle;
      const near = w.visible && Math.hypot(obj.position.x - w.position.x, obj.position.z - w.position.z) < 0.68;
      if ((overKind === 'waffle' || near) && this.state === 'topping') { this.addTopping(obj.userData.id, obj.position.clone()); handled = true; }
    } else if (k === 'waffle') {
      const near = Math.hypot(obj.position.x - this.box.position.x, obj.position.z - this.box.position.z) < 0.78;
      if (overKind === 'box' || near) { this.pack(); handled = true; }
    } else if (k === 'whisk') {
      if (this.state === 'whisking') { if (this.whiskMeter > 4) this.finishWhisk(); else this.state = 'mixing'; }
    }
    if (!handled && obj.userData.home) this.goHome(obj, k === 'waffle' ? 0.28 : 0.32);
    else if (handled && (k === 'ing' || k === 'topping')) this.goHome(obj, 0.3);
    if (k === 'whisk' && this.state !== 'whisking') this.goHome(obj, 0.3);
    this.drag = null;
  }
  // ---------- per frame ----------
  update(dt, inp) {
    const U = FW.U;
    this.t += dt;
    this.updateTweens(dt); this.updatePops(dt); this.fx.update(dt);
    for (const s of this.springs) { s.vel += (s.target - s.v) * s.k * dt - s.vel * s.d * dt; s.v += s.vel * dt; }
    const m = inp.mouse;
    const downEdge = m.down && !this.wasDown;
    const upEdge = !m.down && this.wasDown;
    this.wasDown = m.down;

    // hover + cursor
    const cur = this.drag ? null : this.pickAt(this.draggables, m, (o) => this.canDrag(o));
    const hov = cur ? cur.obj : null;
    if (hov !== this.hover) { this.hover = hov; document.getElementById('game').style.cursor = hov ? 'grab' : 'default'; }
    for (const dgb of this.draggables) {
      if (dgb.userData.popper) continue;
      const want = (dgb === this.hover && !this.drag) || (this.drag && this.drag.obj === dgb) ? 1.14 : 1;
      dgb.scale.setScalar(U.damp(dgb.scale.x, want, 14, dt));
    }
    if (this.drag) document.getElementById('game').style.cursor = 'grabbing';
    FW.HUD.tooltip(this.drag ? '' : hov ? hov.userData.label : '', m.x, m.y);

    // begin drag
    if (downEdge && !this.drag && hov) this.startDrag(hov, cur.point);
    // tap the iron to flip / open it
    if (downEdge && !this.drag && this.state === 'cooking') {
      const t = this.pickAt(this.targets, m);
      if (t && t.obj.userData.kind === 'iron') this.flipOut();
    }
    if (inp.pressed('flip') && this.state === 'cooking') this.flipOut();

    // move the dragged object
    if (this.drag) {
      const obj = this.drag.obj;
      const k = obj.userData.kind;
      const y = k === 'whisk' ? this.TOP + 0.16 : this.LIFT;
      const p = this.planePoint(m, y);
      if (p) {
        p.x = U.clamp(p.x, -2.7, 2.7); p.z = U.clamp(p.z, -0.8, 0.95);
        obj.position.lerp(p, Math.min(1, 22 * dt));
        obj.position.y = U.damp(obj.position.y, y, 16, dt);
      }
      obj.rotation.z = U.damp(obj.rotation.z, Math.sin(this.t * 7) * 0.05, 10, dt);
      if (upEdge || !m.down) this.endDrag();
    }
    // drop-target halo
    let haloTarget = null;
    if (this.drag) {
      const k = this.drag.obj.userData.kind;
      if (k === 'ing') haloTarget = this.bowl;
      else if (k === 'bowl') haloTarget = this.ironG;
      else if (k === 'topping') haloTarget = this.plateWaffle.visible ? this.plateWaffle : null;
      else if (k === 'waffle') haloTarget = this.box;
    } else if (this.state === 'mixed') haloTarget = this.ironG;
    if (haloTarget) {
      this.halo.visible = true;
      this.halo.position.set(haloTarget.position.x, this.TOP + 0.03, haloTarget.position.z);
      const s = 1 + Math.sin(this.t * 7) * 0.07;
      this.halo.scale.setScalar(s * (haloTarget === this.plateWaffle ? 0.95 : 1.15));
      this.halo.material.color.set(this.drag ? '#7fd1c0' : '#f7c544');
    } else this.halo.visible = false;

    // whisking: stir in circles over the bowl
    const total = this.cur ? Object.values(this.cur.counts).reduce((a, b) => a + b, 0) : 0;
    if (this.state === 'whisking') {
      const dx = this.whisk.position.x - this.bowl.position.x, dz = this.whisk.position.z - this.bowl.position.z;
      const r = Math.hypot(dx, dz);
      const inBowl = r < 0.44;
      if (inBowl && total > 0) {
        const a = Math.atan2(dz, dx);
        if (this.stirAngle !== null) {
          const d = Math.abs(U.angleDiff(this.stirAngle, a));
          if (d < 1.4) { this.whiskMeter += (d / (Math.PI * 2)) * 34 * Math.min(1, r / 0.16); this.stirRate = U.lerp(this.stirRate, d / Math.max(dt, 1e-3), 0.25); }
        }
        this.stirAngle = a;
        this.batter.rotation.y += this.stirRate * dt * 0.9;
        if (Math.random() < dt * 22 * Math.min(1, this.stirRate / 3))
          this.fx.spawn({ x: this.bowl.position.x + (Math.random() - 0.5) * 0.3, y: this.bowl.position.y + 0.25, z: this.bowl.position.z + (Math.random() - 0.5) * 0.3, vy: 0.9, vx: (Math.random() - 0.5) * 0.5, vz: (Math.random() - 0.5) * 0.5, life: 0.45, size: 0.022, color: '#f7e6b8', gravity: 4 });
        if (this.stirRate > 1.5 && Math.random() < dt * 6) FW.Audio.sfx.stir();
      } else this.stirRate = U.damp(this.stirRate, 0, 4, dt);
      FW.HUD.meter(true, 'STIR IN CIRCLES — stop in the green', this.whiskMeter, [70, 100], this.whiskMeter > 100 ? 'too much!' : inBowl ? 'keep going!' : 'stir inside the bowl');
      if (this.whiskMeter >= 125) this.finishWhisk();
    } else if (this.state === 'mixing') {
      // keyboard fallback: hold Space to whisk
      if (inp.held('flip') && total > 0) { this.state = 'whisking'; this.stirAngle = null; this.autoWhisk = true; }
      if (total > 0) FW.HUD.meter(true, 'STIR — drag the whisk in circles', 0, [70, 100], 'add what the ticket asks for, then stir');
      else FW.HUD.meter(false);
    }
    if (this.autoWhisk && this.state === 'whisking') {
      if (inp.held('flip')) {
        this.whiskMeter += 42 * dt;
        this.whisk.position.set(this.bowl.position.x + Math.cos(this.t * 9) * 0.16, this.TOP + 0.16, this.bowl.position.z + Math.sin(this.t * 9) * 0.16);
        this.batter.rotation.y += dt * 8; this.stirRate = 4;
        FW.HUD.meter(true, 'STIR — release in the green', this.whiskMeter, [70, 100], this.whiskMeter > 100 ? 'too much!' : 'keep going!');
        if (this.whiskMeter >= 125) { this.autoWhisk = false; this.finishWhisk(); }
      } else { this.autoWhisk = false; this.finishWhisk(); }
    }

    // pouring stream
    if (this.state === 'pouring' && this.pourTimer > 0) {
      this.pourTimer -= dt;
      const bp = this.bowl.position;
      for (let i = 0; i < 2; i++) this.fx.spawn({ x: bp.x + (Math.random() - 0.5) * 0.08, y: bp.y + 0.1, z: bp.z + 0.22, vy: -0.6, vx: (Math.random() - 0.5) * 0.15, vz: (Math.random() - 0.5) * 0.15, life: 0.35, size: 0.05, color: '#f7e6b8', gravity: 6, shrink: false });
      const t = 1 - Math.max(0, this.pourTimer) / 0.85;
      this.ironBatter.scale.set(0.2 + 0.8 * t, 0.4 + 0.6 * t, 0.2 + 0.8 * t);
      if (this.pourTimer <= 0) this.closeLid();
    }
    // the one cooking window
    if (this.state === 'cooking') {
      this.cook += 19 * dt;
      const zone = [52, 82];
      const inZone = this.cook >= zone[0] && this.cook <= zone[1];
      this.ironLight.material.color.set(inZone ? '#7ed37a' : this.cook > zone[1] ? '#3a2018' : '#e5564a');
      FW.HUD.meter(true, 'FLIP IT OUT! — tap the iron / Space', this.cook, zone, inZone ? 'NOW!' : this.cook > zone[1] ? 'it is burning!' : 'wait for it...');
      if (inZone && !this.zoneRang) { this.zoneRang = true; FW.Audio.sfx.ding(); this.pop(this.ironG, 6); }
      if (Math.random() < dt * 14) this.fx.spawn({ x: this.ironG.position.x + (Math.random() - 0.5) * 0.6, y: this.TOP + 0.28, z: this.ironG.position.z + (Math.random() - 0.5) * 0.4, vy: 0.6 + Math.random() * 0.4, vx: (Math.random() - 0.5) * 0.2, vz: (Math.random() - 0.5) * 0.2, life: 1.2, size: 0.05, color: '#ffffff', gravity: -0.45, shrink: false });
      FW.Audio.setSizzle(inZone ? 1.35 : 1);
      this.ironG.rotation.z = Math.sin(this.t * 26) * 0.006 * (inZone ? 3 : 1);
      if (this.cook > 118) this.flipOut();
      if (this.cook > 88 && Math.random() < dt * 7) this.fx.spawn({ x: this.ironG.position.x, y: this.TOP + 0.32, z: this.ironG.position.z, vy: 0.8, life: 1.4, size: 0.07, color: '#6a6a6a', gravity: -0.5, shrink: false });
    }
    if (this.state === 'wait') {
      this.waitTimer -= dt;
      if (this.waitTimer <= 0) {
        if (this.index < this.order.waffles.length) this.beginWaffle();
        else { this.state = 'done'; FW.HUD.meter(false); this.setHint(''); if (this.onDone) this.onDone(this.made); }
      }
    }
    // little bouncy details
    if (this.batterPop > 0) { this.batterPop -= dt; const k = Math.max(0, this.batterPop) / 0.28; const h = Math.min(0.16, 0.03 * total); this.batter.scale.set(1 + k * 0.25, (h / 0.06) * (1 - k * 0.3), 1 + k * 0.25); }
    for (const k in this.toppingMeshes) {
      const t = this.toppingMeshes[k];
      if (t.userData.pop > 0) { t.userData.pop -= dt; const p = Math.max(0, t.userData.pop) / 0.3; const s = 0.62 * (1 + Math.sin(p * Math.PI) * 0.45); t.scale.setScalar(s); }
    }
    if (this.plateWaffle.visible && this.state === 'topping' && !(this.drag && this.drag.obj === this.plateWaffle) && !this.tweens.some((t) => t.obj === this.plateWaffle)) {
      this.plateWaffle.position.y = this.plateWaffle.userData.home.y + Math.sin(this.t * 2.6) * 0.014;
      this.plateWaffle.rotation.y += dt * 0.25;
    }
    // duck: springy idle, watches your cursor, flaps while you stir
    const d = this.duck;
    const sq = this.duckSq.update(dt);
    const s = FW.U.clamp(sq, 0.7, 1.35);
    d.scale.set(1.62 / Math.sqrt(s), 1.62 * s, 1.62 / Math.sqrt(s));
    d.position.y = 0.06 + Math.sin(this.t * 2.4) * 0.025;
    const lookX = this.drag ? this.drag.obj.position.x : hov ? hov.position.x : 0;
    d.userData.head.rotation.y = U.damp(d.userData.head.rotation.y, U.clamp((lookX - 0.78) * 0.42, -0.85, 0.85), 8, dt);
    d.userData.head.rotation.x = U.damp(d.userData.head.rotation.x, 0.16 + (this.drag ? 0.1 : 0), 6, dt);
    const w = d.userData.wings;
    if (this.state === 'whisking') { w[0].rotation.z = -(0.9 + Math.sin(this.t * 20) * 0.4); w[1].rotation.z = 0.9 + Math.sin(this.t * 20 + 1) * 0.4; }
    else if (this.state === 'cooking') { w[0].rotation.z = -(0.45 + Math.sin(this.t * 3.4) * 0.16); w[1].rotation.z = -w[0].rotation.z; }
    else { w[0].rotation.z = U.damp(w[0].rotation.z, -(0.14 + Math.sin(this.t * 1.6) * 0.1), 6, dt); w[1].rotation.z = -w[0].rotation.z; }
    d.userData.prop.rotation.y += dt * (this.state === 'whisking' ? 9 : 2.2);
    if (d.userData.lolli) d.userData.lolli.rotation.z = -0.35 + Math.sin(this.t * 2.2) * 0.12;
    this.lights.forEach((l, i) => l.scale.setScalar(0.85 + 0.18 * Math.sin(this.t * 2.6 + i)));
    this.lampLight.intensity = 2.2 + Math.sin(this.t * 3) * 0.22;
    this.radio.rotation.z = Math.sin(this.t * 6) * 0.012;
  }
  render() { FW.Pixel.render(this.scene, this.camera); }
};
