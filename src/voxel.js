// Flippin' Waffles — voxel model builder + shared models
window.FW = window.FW || {};

FW.Voxel = (() => {
  const P = FW.PAL;
  const _c = new THREE.Color();
  const _box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const BP = _box.attributes.position.array, BN = _box.attributes.normal.array;

  // part: color, x, yBottom, z, w, h, d  (voxel units; y is the bottom of the box)
  function B(c, x, y, z, w, h, d) { return { c, x, y: y + h / 2, z, w, h, d }; }

  function geo(parts, unit = 0.1) {
    const n = parts.length * 36;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let k = 0;
    for (const p of parts) {
      _c.set(p.c);
      for (let i = 0; i < BP.length; i += 3) {
        pos[k] = (p.x + BP[i] * p.w) * unit; pos[k + 1] = (p.y + BP[i + 1] * p.h) * unit; pos[k + 2] = (p.z + BP[i + 2] * p.d) * unit;
        nor[k] = BN[i]; nor[k + 1] = BN[i + 1]; nor[k + 2] = BN[i + 2];
        col[k] = _c.r; col[k + 1] = _c.g; col[k + 2] = _c.b;
        k += 3;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }
  function mesh(parts, unit = 0.1, opts = {}) {
    const m = new THREE.Mesh(geo(parts, unit), FW.Pixel.vmat(opts));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function lerp3(a, b, c, t) { // 3-stop color lerp, returns hex-int
    const ca = new THREE.Color(a), cb = new THREE.Color(b), cc = new THREE.Color(c);
    return t < 0.5 ? ca.lerp(cb, t * 2) : cb.lerp(cc, (t - 0.5) * 2);
  }

  // ---------- Duck ----------
  function duck(opts = {}) {
    const g = new THREE.Group();
    const Y = P.duck, YD = P.duckDark, O = P.beak, K = P.black;
    const sit = !!opts.sitting;
    const bodyParts = [
      B(Y, 0, 3, 0, 6, 5, 8),
      B(Y, 0, 6.6, -4.4, 3, 2.2, 1.6),
      sit ? B(O, -1.5, -2.6, 1.2, 1.2, 5.8, 1.2) : B(O, -1.5, 1, 0.5, 1.2, 2.2, 1.2),
      sit ? B(O, 1.5, -2.6, 1.2, 1.2, 5.8, 1.2) : B(O, 1.5, 1, 0.5, 1.2, 2.2, 1.2),
      sit ? B(O, -1.6, -2.8, 2.4, 2.4, 1, 3.6) : B(O, -1.6, 0, 1, 2.4, 1, 3.6),
      sit ? B(O, 1.6, -2.8, 2.4, 2.4, 1, 3.6) : B(O, 1.6, 0, 1, 2.4, 1, 3.6),
      B(P.scarf, 0, 7.4, 0.8, 6.6, 1.5, 6.4),
    ];
    const body = mesh(bodyParts); g.add(body);
    const head = new THREE.Group(); head.position.set(0, 0.82, 0.12);
    head.add(mesh([
      B(Y, 0, 0, 0, 5, 5, 5),
      B(O, 0, 1, 2.5, 3.2, 1.4, 2.6),
      B(K, -1.6, 2.7, 2.3, 1, 1.2, 0.6), B(K, 1.6, 2.7, 2.3, 1, 1.2, 0.6),
      B(P.white, -1.35, 3.3, 2.35, 0.4, 0.4, 0.5), B(P.white, 1.85, 3.3, 2.35, 0.4, 0.4, 0.5),
      B(P.blush, -2.55, 1.6, 1.6, 0.3, 0.9, 1.2), B(P.blush, 2.55, 1.6, 1.6, 0.3, 0.9, 1.2),
    ]));
    if (opts.hat === 'chef') head.add(mesh([B(P.white, 0, 4.9, 0, 4.6, 2.2, 4.6), B(P.white, 0, 7, -0.4, 5.8, 2.6, 5.8), B(P.white, 0, 9.4, 0.4, 3.6, 1.4, 3.6), B(P.red, 0, 4.9, 0, 4.7, 0.6, 4.7)]));
    if (opts.hat === 'helmet') head.add(mesh([B(P.mint, 0, 4.4, -0.2, 5.6, 2, 5.6), B(P.mint, 0, 6.4, -0.2, 4.4, 1.2, 4.4), B(P.white, 0, 4.4, -0.2, 5.7, 0.5, 5.7), B(P.gold, 0, 5.2, 2.6, 2, 1, 0.6)]));
    g.add(head);
    const wingParts = [B(YD, 0, -3.6, 0, 1.1, 3.8, 4.4)];
    const wl = new THREE.Group(); wl.position.set(-0.35, 0.72, -0.05); wl.add(mesh(wingParts));
    const wr = new THREE.Group(); wr.position.set(0.35, 0.72, -0.05); wr.add(mesh(wingParts));
    g.add(wl, wr);
    const tail = new THREE.Group(); tail.position.set(0.18, 0.74, -0.36);
    tail.add(mesh([B(P.scarf, 0, -3.2, 0, 1.6, 3.4, 0.9), B(P.scarf, 0.9, -4.6, -0.1, 1.4, 2.4, 0.9)]));
    g.add(tail);
    g.userData = { head, wings: [wl, wr], scarf: tail, body };
    return g;
  }

  // ---------- Scooter ----------
  function scooter() {
    const g = new THREE.Group();
    const M = P.mint, S = P.steel, K = P.black;
    g.add(mesh([
      B(M, 0, 2.6, -1, 5, 1.4, 9.5),
      B(M, 0, 3.8, -5, 5.2, 4.6, 5.5),
      B(P.brown, 0, 8.4, -4.5, 4.6, 1.4, 5.5),
      B(S, 0, 2.4, 5.6, 1.4, 9.6, 1.4),
      B(M, 0, 5, 5.6, 4.4, 5.4, 2.6),
      B(P.gold, 0, 7.6, 7, 2.2, 2, 0.6),
      B(S, 0, 12, 5.4, 9, 1, 1),
      B(K, -4.6, 11.9, 5.4, 1.6, 1.3, 1.3), B(K, 4.6, 11.9, 5.4, 1.6, 1.3, 1.3),
      B(S, 0, 1.2, -6, 1, 3, 1), B(S, 0, 1.2, 6, 1, 3, 1),
      B(S, 0, 5.4, -9.2, 5, 0.6, 5),
      B(P.red, 0, 4.2, 6.8, 1.6, 0.5, 0.6),
      B(P.white, 0, 3.9, -7.9, 2.2, 1.2, 0.4),
    ]));
    const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.16, 8); wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.18, 8); hubGeo.rotateZ(Math.PI / 2);
    const wheelMat = FW.Pixel.mat('#2b2b30'), hubMat = FW.Pixel.mat(P.steel);
    const wheels = [];
    for (const z of [-0.6, 0.6]) {
      const w = new THREE.Group(); w.position.set(0, 0.3, z);
      const t = new THREE.Mesh(wheelGeo, wheelMat); t.castShadow = true; w.add(t);
      w.add(new THREE.Mesh(hubGeo, hubMat));
      g.add(w); wheels.push(w);
    }
    const box = mesh([
      B(P.cream, 0, 6, -9.2, 6.4, 5, 5.2), B(P.red, 0, 8.4, -9.2, 6.6, 0.8, 5.4), B(P.red, 0, 11, -9.2, 6.6, 0.6, 5.4),
      B(P.gold, 0, 6.6, -6.5, 3, 3, 0.5), B(P.brown, 0, 7.4, -6.2, 2.2, 0.5, 0.2), B(P.brown, 0, 8.4, -6.2, 2.2, 0.5, 0.2), B(P.brown, -0.6, 6.9, -6.2, 0.5, 2.4, 0.2), B(P.brown, 0.6, 6.9, -6.2, 0.5, 2.4, 0.2),
    ]);
    g.add(box);
    g.userData = { wheels, box };
    return g;
  }

  // ---------- Bear ----------
  function bear(scale = 1, light = false) {
    const g = new THREE.Group();
    const C = light ? P.bearLight : P.bear;
    g.add(mesh([B(C, 0, 3.6, 0, 8, 6.6, 12), B(C, 0, 8.6, -6.2, 2.2, 2.2, 1.4)]));
    const head = new THREE.Group(); head.position.set(0, 0.8, 0.55);
    head.add(mesh([
      B(C, 0, 0, 0, 6, 5.5, 5.5), B(C, -2.5, 5, -0.5, 2, 2, 1.6), B(C, 2.5, 5, -0.5, 2, 2, 1.6),
      B(P.tan, 0, 0.6, 2.9, 3.4, 2.6, 2), B(P.black, 0, 2.4, 3.9, 1.4, 1, 0.5),
      B(P.black, -1.7, 3.1, 2.8, 0.9, 0.9, 0.4), B(P.black, 1.7, 3.1, 2.8, 0.9, 0.9, 0.4),
      B(P.tan, -2.5, 5.4, -0.4, 1.2, 1.1, 0.5), B(P.tan, 2.5, 5.4, -0.4, 1.2, 1.1, 0.5),
    ]));
    g.add(head);
    const legs = [];
    for (const [x, z] of [[-2.8, 3.8], [2.8, 3.8], [-2.8, -3.8], [2.8, -3.8]]) {
      const l = new THREE.Group(); l.position.set(x * 0.1, 0.4, z * 0.1);
      l.add(mesh([B(C, 0, -4, 0, 2.6, 4.4, 2.8), B(P.black, 0, -4, 0.2, 2.7, 0.8, 2.9)]));
      g.add(l); legs.push(l);
    }
    g.scale.setScalar(scale);
    g.userData = { head, legs };
    return g;
  }

  // ---------- Critter customers ----------
  const CRITTERS = {
    raccoon: { body: '#8a8a94', belly: '#d8d8dc', mask: '#2b1a10', ear: 'small', tail: '#6e6e78' },
    rabbit: { body: '#f4f0e8', belly: '#ffffff', ear: 'long', innerEar: '#f6a5a5', tail: '#ffffff' },
    fox: { body: '#e07b39', belly: '#fff1dc', ear: 'small', tail: '#e07b39', tailTip: '#ffffff' },
    deer: { body: '#c9995e', belly: '#efd9b3', ear: 'small', spots: true, tail: '#efd9b3' },
    squirrel: { body: '#b4562f', belly: '#f5d9b8', ear: 'small', tail: '#b4562f', bigTail: true },
    otter: { body: '#7a5a3e', belly: '#c9a177', ear: 'small', tail: '#7a5a3e' },
  };
  function critter(kind, acc) {
    const c = CRITTERS[kind] || CRITTERS.raccoon;
    const g = new THREE.Group();
    const body = [B(c.body, 0, 2, 0, 5, 4.5, 5.5), B(c.belly, 0, 2.2, 2.6, 3, 3.2, 0.4), B(c.body, -1.4, 0, 0.3, 1.5, 2, 1.6), B(c.body, 1.4, 0, 0.3, 1.5, 2, 1.6)];
    if (c.bigTail) body.push(B(c.tail, 0, 3, -3.6, 2.4, 5.5, 1.8), B(c.belly, 0, 4, -3.6, 1.2, 3.4, 0.4));
    else body.push(B(c.tail, 0, 3.2, -3.4, 1.6, 1.6, 2.4));
    if (c.tailTip) body.push(B(c.tailTip, 0, 3.2, -4.8, 1.6, 1.6, 0.8));
    g.add(mesh(body));
    const head = new THREE.Group(); head.position.set(0, 0.65, 0.1);
    const hp = [B(c.body, 0, 0, 0, 4.6, 4.2, 4.4), B(P.black, -1.4, 2.2, 2.05, 0.8, 0.9, 0.5), B(P.black, 1.4, 2.2, 2.05, 0.8, 0.9, 0.5), B(P.black, 0, 1.1, 2.2, 1, 0.7, 0.4)];
    if (c.mask) hp.push(B(c.mask, -1.4, 1.9, 2.15, 1.6, 1.5, 0.3), B(c.mask, 1.4, 1.9, 2.15, 1.6, 1.5, 0.3), B(P.white, -1.2, 2.5, 2.35, 0.4, 0.4, 0.3), B(P.white, 1.6, 2.5, 2.35, 0.4, 0.4, 0.3));
    if (c.ear === 'long') hp.push(B(c.body, -1.3, 4.2, 0, 1.3, 4.2, 1), B(c.body, 1.3, 4.2, 0, 1.3, 4.2, 1), B(c.innerEar, -1.3, 4.6, 0.55, 0.6, 3, 0.2), B(c.innerEar, 1.3, 4.6, 0.55, 0.6, 3, 0.2));
    else hp.push(B(c.body, -1.7, 4.1, -0.3, 1.6, 1.6, 1), B(c.body, 1.7, 4.1, -0.3, 1.6, 1.6, 1));
    if (c.spots) hp.push(B(c.belly, 0, 0.4, 2.25, 2, 1.4, 0.3));
    head.add(mesh(hp));
    if (acc === 'ranger') head.add(mesh([B('#8a6a3c', 0, 4.1, 0, 6.4, 0.8, 6.4), B('#8a6a3c', 0, 4.9, 0, 3.4, 2, 3.4), B('#3d2314', 0, 4.9, 0, 3.6, 0.6, 3.6)]));
    if (acc === 'beanie') head.add(mesh([B(P.scarf, 0, 4.1, 0, 4.8, 1.6, 4.6), B(P.scarf, 0, 5.7, 0, 3.4, 1.2, 3.4), B(P.white, 0, 6.9, 0, 1.4, 1.4, 1.4)]));
    if (acc === 'cap') head.add(mesh([B('#3aa6a6', 0, 4.1, 0, 4.8, 1.4, 4.6), B('#3aa6a6', 0, 4.1, 3, 4.8, 0.6, 2.4)]));
    if (acc === 'flower') head.add(mesh([B('#f6a5a5', 1.8, 4.2, 0.8, 1.4, 1.4, 1.4), B('#fff6a8', 1.8, 4.5, 0.8, 0.6, 0.9, 1.6)]));
    if (acc === 'camera') g.add(mesh([B('#2b2b30', 0, 3.2, 3, 2.4, 1.6, 1.2), B('#c9c9d0', 0, 3.6, 3.7, 1, 1, 0.8)]));
    if (acc === 'backpack') g.add(mesh([B('#4f9a5c', 0, 2.6, -3.2, 3.6, 3.4, 1.8), B('#3d2314', 0, 3.6, -4.2, 1.2, 0.6, 0.4)]));
    g.add(head);
    g.userData = { head };
    return g;
  }

  // ---------- Vegetation / props (geometries for instancing, unit 0.5 m) ----------
  const pineGeo = () => geo([B(P.trunk, 0, 0, 0, 1.2, 4, 1.2), B(P.pine[0], 0, 3, 0, 7, 2.2, 7), B(P.pine[1], 0, 5, 0, 5.5, 2.2, 5.5), B(P.pine[0], 0, 7, 0, 4, 2.2, 4), B(P.pine[1], 0, 9, 0, 2.6, 2.2, 2.6), B(P.pine[0], 0, 11, 0, 1.3, 2, 1.3)], 0.5);
  const sequoiaGeo = () => geo([B(P.sequoia, 0, 0, 0, 4.2, 3, 4.2), B(P.sequoia, 0, 0, 0, 3, 24, 3), B(P.seqGreen, 0, 13, 0, 7, 3, 7), B(P.seqGreen, 0, 16, 0, 8, 3, 8), B(P.seqGreen, 0, 19, 0, 6.5, 3, 6.5), B(P.seqGreen, 0, 22, 0, 4.5, 3, 4.5), B(P.seqGreen, 0, 25, 0, 2.4, 2.5, 2.4)], 0.5);
  const aspenGeo = (gold) => { const A = gold ? P.aspenGold : P.aspen; return geo([B(P.aspenTrunk, 0, 0, 0, 0.8, 5, 0.8), B(A, 0, 4, 0, 4, 3, 4), B(A, 0, 6.6, 0, 3, 2.2, 3), B(A, 0, 8.4, 0, 1.6, 1.6, 1.6)], 0.5); };
  const bushGeo = () => geo([B(P.pine[1], 0, 0, 0, 3, 2, 3), B(P.pine[3], 1, 0.8, 0.6, 2, 1.6, 2), B(P.pine[1], -1, 1, -0.6, 1.8, 1.5, 1.8), B('#f6a5a5', 0.6, 2, 0.4, 0.5, 0.5, 0.5), B('#fff6a8', -0.8, 2.4, -0.4, 0.5, 0.5, 0.5)], 0.5);
  const rockGeo = () => geo([B(P.granite[0], 0, 0, 0, 3, 2, 2.6), B(P.granite[1], 0.8, 1.2, 0.3, 2, 1.6, 1.8), B(P.granite[2], -1, 0.6, -0.6, 1.6, 1.4, 1.6)], 0.5);
  const flowerGeo = () => {
    const parts = [];
    const cols = ['#f6a5a5', '#fff6a8', '#c89ff0', '#ffffff', '#ff8fa3'];
    for (let i = 0; i < 5; i++) { const a = i * 1.26, r = 0.35 + (i % 2) * 0.3; const x = Math.cos(a) * r * 10, z = Math.sin(a) * r * 10; parts.push(B('#4f9a5c', x, 0, z, 0.8, 2.6, 0.8), B(cols[i], x, 2.4, z, 2, 1.4, 2), B('#f3c34a', x, 3.2, z, 0.9, 0.7, 0.9)); }
    return geo(parts, 0.1);
  };
  const fenceGeo = (len = 3) => geo([B(P.wood, -(len * 5 - 1), 0, 0, 2, 10, 2), B(P.wood, len * 5 - 1, 0, 0, 2, 10, 2), B(P.wood2, 0, 3.4, 0, len * 10, 1.2, 1), B(P.wood2, 0, 7.2, 0, len * 10, 1.2, 1)], 0.1);
  const stumpGeo = () => geo([B(P.trunk, 0, 0, 0, 2.2, 1.4, 2.2), B('#c9a177', 0, 1.4, 0, 1.9, 0.3, 1.9)], 0.5);

  // ---------- Waffle & toppings (unit 0.02 m → 24 cm waffle) ----------
  function waffle(unit = 0.02) {
    const g = new THREE.Group();
    const baseMat = FW.Pixel.mat('#e8a94a'), ridgeMat = FW.Pixel.mat('#c98a2e');
    const base = new THREE.Mesh(geo([B('#fff', 0, 0, 0, 12, 1.4, 12)], unit), baseMat); base.castShadow = true;
    const rp = [];
    for (const v of [-5.5, -2.75, 0, 2.75, 5.5]) { rp.push(B('#fff', v, 1.4, 0, 1, 0.9, 12), B('#fff', 0, 1.4, v, 12, 0.9, 1)); }
    const ridges = new THREE.Mesh(geo(rp, unit), ridgeMat);
    g.add(base, ridges);
    g.userData.top = 2.3 * unit;
    g.userData.setDoneness = (t) => {
      baseMat.color.copy(lerp3('#f7e6b8', '#e8a94a', '#4a2b16', t));
      ridgeMat.color.copy(lerp3('#e8d3a0', '#c98a2e', '#2e1a0c', t));
    };
    g.userData.setDoneness(0.5);
    return g;
  }
  const TOPPINGS = {
    butter: { name: 'Butter', color: '#f7e39a', parts: () => [B('#f7e39a', 3.5, 0, 3.5, 3, 1.6, 3)] },
    syrup: { name: 'Maple Syrup', color: '#8a4b1a', parts: () => [B('#8a4b1a', -3, 0, 0, 1, 0.5, 10), B('#8a4b1a', 0.5, 0, 0, 1, 0.5, 11), B('#8a4b1a', 3.5, 0, -1, 1, 0.5, 8), B('#8a4b1a', 0, 0, -2, 9, 0.5, 1)] },
    strawberry: { name: 'Strawberries', color: '#e8434d', parts: () => [B('#e8434d', -3.6, 0, -3.6, 2.4, 2.4, 2.4), B('#4caf50', -3.6, 2.4, -3.6, 1.2, 0.6, 1.2), B('#e8434d', -3.8, 0, 0.8, 2.4, 2.4, 2.4), B('#4caf50', -3.8, 2.4, 0.8, 1.2, 0.6, 1.2), B('#e8434d', 0.2, 0, -4, 2.2, 2.2, 2.2), B('#4caf50', 0.2, 2.2, -4, 1.1, 0.6, 1.1)] },
    blueberry: { name: 'Blueberries', color: '#4e5fbf', parts: () => [B('#4e5fbf', 3.6, 0, -3.8, 1.5, 1.5, 1.5), B('#4e5fbf', 4.6, 0, -1.2, 1.5, 1.5, 1.5), B('#4e5fbf', 2.2, 0, -1.6, 1.5, 1.5, 1.5), B('#4e5fbf', 4.2, 0, 1.2, 1.5, 1.5, 1.5), B('#4e5fbf', -0.4, 0, 4.4, 1.5, 1.5, 1.5)] },
    banana: { name: 'Banana', color: '#f7e27a', parts: () => [B('#f7e27a', -3.5, 0, 4, 2.6, 0.9, 2.6), B('#f7e27a', -0.5, 0, 4.4, 2.6, 0.9, 2.6), B('#f7e27a', 2.5, 0, 4.2, 2.6, 0.9, 2.6), B('#3d2314', -3.5, 0.9, 4, 0.5, 0.2, 0.5), B('#3d2314', -0.5, 0.9, 4.4, 0.5, 0.2, 0.5), B('#3d2314', 2.5, 0.9, 4.2, 0.5, 0.2, 0.5)] },
    choco: { name: 'Choco Chips', color: '#4a2c1a', parts: () => [B('#4a2c1a', -4.5, 0, -1, 1, 1, 1), B('#4a2c1a', -2, 0, 2.6, 1, 1, 1), B('#4a2c1a', 1.5, 0, -2.8, 1, 1, 1), B('#4a2c1a', 2.6, 0, 3.2, 1, 1, 1), B('#4a2c1a', -1, 0, -4.6, 1, 1, 1), B('#4a2c1a', 4.4, 0, -4.6, 1, 1, 1), B('#4a2c1a', -4.6, 0, 4.6, 1, 1, 1)] },
    cream: { name: 'Whipped Cream', color: '#fffaf0', parts: () => [B('#fffaf0', 0, 0, 0, 4.2, 1.6, 4.2), B('#fffaf0', 0, 1.6, 0, 3, 1.4, 3), B('#fffaf0', 0, 3, 0, 1.6, 1.2, 1.6)] },
    honey: { name: 'Honey', color: '#e9a81e', parts: () => [B('#e9a81e', -1.5, 0, 0.5, 1, 0.5, 10), B('#e9a81e', 2, 0, 0.5, 1, 0.5, 10), B('#e9a81e', 0, 0, 2.5, 9, 0.5, 1), B('#e9a81e', 0, 0, -2.5, 8, 0.5, 1)] },
  };
  function toppingMesh(key, unit = 0.02) {
    const m = mesh(TOPPINGS[key].parts(), unit);
    m.name = 'top_' + key;
    return m;
  }

  // ---------- Buildings (unit 0.25 m) ----------
  function gableRoof(color1, color2, widths, depth, y0, dx = 0, dz = 0) {
    const parts = [];
    widths.forEach((w, i) => parts.push(B(i % 2 ? color2 : color1, dx, y0 + i * 2, dz, w, 2, depth)));
    return parts;
  }
  function shack() {
    const g = new THREE.Group();
    const C = '#f7e7c6', BR = P.brown;
    const parts = [
      B(C, 0, 0, 0, 28, 14, 22),
      B(BR, -14, 0, -11, 1.4, 14, 1.4), B(BR, 14, 0, -11, 1.4, 14, 1.4), B(BR, -14, 0, 11, 1.4, 14, 1.4), B(BR, 14, 0, 11, 1.4, 14, 1.4),
      B(BR, 0, 0, 11.2, 5, 9, 0.8), B(P.gold, 1.6, 4.5, 11.8, 0.6, 0.6, 0.5),
      B(P.sky, -8.5, 5, 11.2, 6, 5, 0.6), B(P.sky, 8.5, 5, 11.2, 6, 5, 0.6),
      B(P.white, -8.5, 5, 11.6, 0.6, 5, 0.3), B(P.white, 8.5, 5, 11.6, 0.6, 5, 0.3), B(P.white, -8.5, 7.3, 11.6, 6, 0.6, 0.3), B(P.white, 8.5, 7.3, 11.6, 6, 0.6, 0.3),
      B(BR, -8.5, 3.6, 11.8, 6.6, 1.3, 1.4), B(BR, 8.5, 3.6, 11.8, 6.6, 1.3, 1.4),
      B('#f6a5a5', -10, 4.9, 11.8, 1, 0.9, 1), B('#fff6a8', -8.5, 4.9, 11.8, 1, 0.9, 1), B('#c89ff0', -7, 4.9, 11.8, 1, 0.9, 1),
      B('#fff6a8', 10, 4.9, 11.8, 1, 0.9, 1), B('#f6a5a5', 8.5, 4.9, 11.8, 1, 0.9, 1), B('#c89ff0', 7, 4.9, 11.8, 1, 0.9, 1),
      B(P.granite[0], 9, 14, -5, 3, 10, 3), B(P.granite[2], 9, 24, -5, 3.6, 1, 3.6),
      B(BR, -12, 0, 15, 1, 10, 1), B(BR, 12, 0, 15, 1, 10, 1),
    ];
    for (let i = 0; i < 6; i++) parts.push(B(i % 2 ? P.red : C, -11 + i * 4.4, 10, 13.6, 4.4, 0.9, 5.2));
    parts.push(...gableRoof('#8a5a3c', '#7a4c30', [32, 27, 22, 17, 12, 7], 26, 14));
    g.add(mesh(parts, 0.25));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.9), new THREE.MeshBasicMaterial({ map: FW.Pixel.textTexture("FLIPPIN' WAFFLES", { w: 512, h: 96, font: 'bold 62px monospace', fg: '#6b4423', bg: '#fff4dc' }) }));
    sign.position.set(0, 3.0, 2.85); g.add(sign);
    const w = waffle(0.13); w.position.set(-1.6, 4.3, 0.6); w.rotation.set(-0.5, 0.3, 0.2); w.userData.setDoneness(0.5); g.add(w);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.55), new THREE.MeshBasicMaterial({ map: FW.Pixel.textTexture('DELIVERY BY DUCK', { w: 384, h: 64, font: 'bold 38px monospace', fg: '#fff4dc', bg: '#e0574f' }) }));
    s2.position.set(1.8, 4.05, 0.7); s2.rotation.x = -0.35; g.add(s2);
    g.userData.chimney = new THREE.Vector3(2.25, 6.3, -1.25);
    return g;
  }
  function cabin(roof = '#4f7d4a') {
    const parts = [B(P.wood, 0, 0, 0, 20, 10, 16)];
    for (let i = 0; i < 5; i++) parts.push(B(P.wood2, 0, 2 * i + 1, 0, 20.3, 0.8, 16.3));
    parts.push(B(P.brown, 0, 0, 8.2, 4, 7, 0.6), B(P.sky, -6, 4, 8.2, 4, 3.5, 0.6), B(P.sky, 6, 4, 8.2, 4, 3.5, 0.6), B(P.white, -6, 5.6, 8.5, 4.2, 0.5, 0.3), B(P.white, 6, 5.6, 8.5, 4.2, 0.5, 0.3));
    parts.push(...gableRoof(roof, roof === '#4f7d4a' ? '#3e6a3a' : '#7a4c30', [24, 19, 14, 9, 4], 20, 10));
    parts.push(B(P.granite[0], 6, 10, -3, 2.6, 9, 2.6));
    const g = new THREE.Group(); g.add(mesh(parts, 0.25));
    g.userData.chimney = new THREE.Vector3(1.5, 4.8, -0.75);
    return g;
  }
  function rangerStation() {
    const G = '#4f7d4a', W = P.white;
    const parts = [B(G, 0, 0, 0, 24, 11, 18), B(W, 0, 0, 9.2, 5, 8, 0.6), B(P.sky, -7, 4, 9.2, 5, 4, 0.6), B(P.sky, 7, 4, 9.2, 5, 4, 0.6), B(W, -7, 4, 9.5, 5.4, 0.5, 0.3), B(W, 7, 4, 9.5, 5.4, 0.5, 0.3), B(W, -7, 8, 9.5, 5.4, 0.5, 0.3), B(W, 7, 8, 9.5, 5.4, 0.5, 0.3),
      B(W, -12, 0, -9, 1, 11, 1), B(W, 12, 0, -9, 1, 11, 1), B(W, -12, 0, 9, 1, 11, 1), B(W, 12, 0, 9, 1, 11, 1),
      B(P.wood, 0, 0, 11, 26, 1, 4), B(P.wood, -12, 1, 12, 1, 9, 1), B(P.wood, 12, 1, 12, 1, 9, 1),
      B(P.steel, 17, 0, 6, 0.7, 22, 0.7), B(P.red, 18.9, 18.5, 6, 3.2, 2.4, 0.3), B(P.gold, 18.9, 19.2, 6.2, 1.2, 1, 0.3)];
    parts.push(...gableRoof('#8a5a3c', '#7a4c30', [28, 23, 18, 13, 8, 3], 22, 11));
    const g = new THREE.Group(); g.add(mesh(parts, 0.25));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.7), new THREE.MeshBasicMaterial({ map: FW.Pixel.textTexture('RANGER STATION', { w: 512, h: 96, font: 'bold 56px monospace', fg: '#fff4dc', bg: '#6b4423' }) }));
    sign.position.set(0, 2.55, 2.35); g.add(sign);
    return g;
  }
  function tent(color) {
    const parts = [];
    [12, 10, 8, 6, 4, 2].forEach((w, i) => parts.push(B(i % 2 ? color : shade(color, 0.85), 0, i * 1.6, 0, w, 1.6, 12)));
    parts.push(B('#3d2314', 0, 0, 6.1, 3.6, 3.6, 0.5), B('#3d2314', 0, 3.6, 6.1, 1.6, 2.2, 0.5), B(P.wood, 0, 9.6, 0, 0.8, 1.6, 13));
    return mesh(parts, 0.25);
  }
  function shade(hex, f) { const c = new THREE.Color(hex); c.multiplyScalar(f); return '#' + c.getHexString(); }
  function campfire() {
    const g = new THREE.Group();
    const stones = [];
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; stones.push(B(P.granite[i % 3], Math.cos(a) * 5.5, 0, Math.sin(a) * 5.5, 2.2, 1.6, 2.2)); }
    g.add(mesh(stones, 0.1));
    const l1 = mesh([B(P.trunk, 0, 0.6, 0, 8, 1.6, 1.6)], 0.1); l1.rotation.y = 0.6; g.add(l1);
    const l2 = mesh([B(P.trunk, 0, 0.6, 0, 8, 1.6, 1.6)], 0.1); l2.rotation.y = -0.7; l2.position.y = 0.1; g.add(l2);
    const flames = [];
    [['#f28c28', 2.6, 3.2], ['#f3c34a', 1.8, 2.4], ['#e0574f', 1.2, 4.2]].forEach(([c, w, h], i) => {
      const f = new THREE.Mesh(geo([B(c, 0, 0, 0, w, h, w)], 0.1), new THREE.MeshBasicMaterial({ color: c }));
      f.position.set((i - 1) * 0.08, 0.2, (i % 2) * 0.06); g.add(f); flames.push(f);
    });
    const light = new THREE.PointLight(0xffa040, 1.2, 8, 2); light.position.y = 0.8; g.add(light);
    g.userData = { flames, light };
    return g;
  }
  function picnicTable() {
    return mesh([B(P.wood, 0, 7, 0, 18, 1.2, 7), B(P.wood, 0, 4.4, 7, 18, 1, 3), B(P.wood, 0, 4.4, -7, 18, 1, 3), B(P.wood2, -6, 0, 0, 1.4, 7, 1.4), B(P.wood2, 6, 0, 0, 1.4, 7, 1.4), B(P.wood2, -6, 0, 7, 1.2, 4.4, 1.2), B(P.wood2, 6, 0, 7, 1.2, 4.4, 1.2), B(P.wood2, -6, 0, -7, 1.2, 4.4, 1.2), B(P.wood2, 6, 0, -7, 1.2, 4.4, 1.2)], 0.1);
  }
  function signpost(text) {
    const g = new THREE.Group();
    g.add(mesh([B(P.wood, 0, 0, 0, 1.4, 22, 1.4), B(P.wood2, 0, 15, 0, 20, 6, 1.8)], 0.1));
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.5), new THREE.MeshBasicMaterial({ map: FW.Pixel.textTexture(text, { w: 384, h: 96, font: 'bold 44px monospace', fg: '#fff4dc', bg: '#8a5a33', border: '#5a3a1e' }) }));
    s.position.set(0, 1.8, 0.1); g.add(s);
    return g;
  }
  function marker() {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 14, 8, 1, true), new THREE.MeshBasicMaterial({ color: '#f3c34a', transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = 7; g.add(beam);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.6, 12), new THREE.MeshBasicMaterial({ color: '#f3c34a', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; g.add(ring);
    const w = waffle(0.1); w.position.y = 5; g.add(w);
    g.userData = { beam, ring, waffle: w };
    return g;
  }

  return { B, geo, mesh, lerp3, shade, duck, scooter, bear, critter, CRITTERS, pineGeo, sequoiaGeo, aspenGeo, bushGeo, rockGeo, flowerGeo, fenceGeo, stumpGeo, waffle, TOPPINGS, toppingMesh, shack, cabin, rangerStation, tent, campfire, picnicTable, signpost, marker };
})();
