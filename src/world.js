// Flippin' Waffles — Yosemitea valley: terrain, roads, props, colliders, traversal toys
window.FW = window.FW || {};

FW.World = (() => {
  const U = FW.U, P = FW.PAL, V = FW.Models;
  const SIZE = 480, HALF = 240, CELL = 2, N = SIZE / CELL, NV = N + 1;
  const heights = new Float32Array(NV * NV);
  const surface = new Uint8Array(N * N);
  const SURF = { GRASS: 0, ROAD: 1, DIRT: 2, SHOULDER: 3, LINE: 4, SAND: 5, WATER: 6, ROCK: 7, SNOW: 8, WOOD: 9 };
  const WATER_Y = -0.6;
  const rand = U.rng(20240);

  const roadSamples = [], roadHash = new Map(), RH = 8;
  const colliders = [], colHash = new Map(), CH = 12;
  const fences = [], fenceHash = new Map();
  const rails = [], overrides = [], boostPads = [], flatZones = [], bridges = [];
  const bouncers = [], rings = [], tokens = [];
  const destinations = {};
  const animated = [];
  let scene, sun, fill, hemi, sky, skyGeo, sunDisc, water, terrainMesh, fx, customer = null, marker = null, chimneys = [];
  let minimap = null;

  const timeStops = [
    { zen: '#78bced', hor: '#ffdcb4', sun: '#fff0d2', sunI: 3.6, hemiSky: '#cfe7ff', hemiGnd: '#9c8f6a', fog: '#ffe3c4', amb: 0.55 },
    { zen: '#4f9fe0', hor: '#d7ecff', sun: '#fffaf0', sunI: 4.2, hemiSky: '#dcefff', hemiGnd: '#a89a72', fog: '#dbeeff', amb: 0.7 },
    { zen: '#5b53a8', hor: '#ffab6e', sun: '#ffb072', sunI: 3.0, hemiSky: '#e6c2ff', hemiGnd: '#8a6a52', fog: '#ffbc90', amb: 0.5 },
  ];

  // ---------------- height field ----------------
  const riverZ = (x) => -30 + 25 * Math.sin(x / 80) + 6 * Math.sin(x / 23);
  function bump(x, z, cx, cz, r, h) { const dx = x - cx, dz = z - cz; const d2 = (dx * dx + dz * dz) / (r * r); if (d2 >= 1) return 0; const t = 1 - d2; return h * t * t; }
  function chanAt(x, z) { return U.smoothstep(15, 5, Math.abs(z - riverZ(x))); }
  function baseHeight(x, z) {
    let h = 2 + U.fbm(x * 0.011 + 3.1, z * 0.011 + 7.7, 3) * 4.5 + U.vnoise(x * 0.045, z * 0.045) * 0.6;
    h += bump(x, z, 0, 215, 110, 34);
    h += bump(x, z, 125, 42, 45, 9);
    h += bump(x, z, 190, -170, 70, 22);
    h += bump(x, z, -120, 135, 70, 5);
    h += bump(x, z, -70, -60, 60, 3);
    h += bump(x, z, 215, -105, 17, -3.2);
    const chan = chanAt(x, z);
    h = h * (1 - chan) + -2.8 * chan;
    const ex = Math.max(Math.abs(x) - 170, 0), ez = Math.max(Math.abs(z) - 170, 0);
    const d = Math.sqrt(ex * ex + ez * ez);
    const rim = U.smoothstep(15, 65, d);
    h += rim * rim * 78 + rim * (U.fbm(x * 0.03, z * 0.03, 2) * 8 + 4);
    return h;
  }
  function terrainHeight(x, z) {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    const ix = U.clamp(Math.floor(fx), 0, N - 1), iz = U.clamp(Math.floor(fz), 0, N - 1);
    const tx = U.clamp(fx - ix, 0, 1), tz = U.clamp(fz - iz, 0, 1);
    const i = iz * NV + ix;
    const h00 = heights[i], h10 = heights[i + 1], h01 = heights[i + NV], h11 = heights[i + NV + 1];
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }
  function surfaceAt(x, z) {
    const ix = Math.floor((x + HALF) / CELL), iz = Math.floor((z + HALF) / CELL);
    if (ix < 0 || iz < 0 || ix >= N || iz >= N) return SURF.ROCK;
    return surface[iz * N + ix];
  }
  const ground = { y: 0, ov: null, surf: 0 };
  function groundAt(x, z) {
    for (const o of overrides) {
      const dx = x - o.cx, dz = z - o.cz;
      const u = dx * o.fx + dz * o.fz, v = dx * o.rx + dz * o.rz;
      if (Math.abs(u) <= o.len / 2 && Math.abs(v) <= o.wid / 2) {
        let y = U.lerp(o.y0, o.y1, (u + o.len / 2) / o.len);
        if (o.bank) { const t = v / (o.wid / 2); y += o.bank * t * t; }
        ground.y = y; ground.ov = o; ground.surf = o.surf ?? SURF.WOOD;
        return ground;
      }
    }
    ground.y = terrainHeight(x, z); ground.ov = null;
    let s = surfaceAt(x, z);
    if (ground.y < WATER_Y - 0.05) s = SURF.WATER;
    ground.surf = s;
    return ground;
  }
  const groundY = (x, z) => groundAt(x, z).y;
  function slopeAt(x, z) { const dx = (terrainHeight(x + 1, z) - terrainHeight(x - 1, z)) / 2, dz = (terrainHeight(x, z + 1) - terrainHeight(x, z - 1)) / 2; return Math.sqrt(dx * dx + dz * dz); }
  // full ground normal (respects ramps, decks and banked chutes)
  function normalAt(x, z, out) {
    const e = 0.7;
    const dx = (groundY(x + e, z) - groundY(x - e, z)) / (2 * e);
    const dz = (groundY(x, z + e) - groundY(x, z - e)) / (2 * e);
    return out.set(-dx, 1, -dz).normalize();
  }

  // ---------------- spatial hashing ----------------
  const hkey = (cx, cz) => cx * 100000 + cz;
  function hashAdd(map, size, x, z, item) { const k = hkey(Math.floor(x / size), Math.floor(z / size)); if (!map.has(k)) map.set(k, []); map.get(k).push(item); }
  function hashQuery(map, size, x, z, out) { const cx = Math.floor(x / size), cz = Math.floor(z / size); out.length = 0; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = map.get(hkey(cx + i, cz + j)); if (l) for (const it of l) out.push(it); } return out; }
  const _q = [], _qf = [];
  function nearestRoad(x, z) {
    hashQuery(roadHash, RH, x, z, _q);
    let best = null, bd = 1e9;
    for (const s of _q) { const dx = s.x - x, dz = s.z - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = s; } }
    return { d: Math.sqrt(bd), s: best };
  }
  const nearbyColliders = (x, z) => hashQuery(colHash, CH, x, z, _q);
  const nearbyFences = (x, z) => hashQuery(fenceHash, CH, x, z, _qf);

  // ---------------- roads ----------------
  const ROADS = [
    { id: 'loop', type: 'road', closed: true, pts: [[0, 72], [60, 82], [125, 62], [178, 0], [182, -70], [150, -125], [90, -150], [20, -142], [-60, -152], [-130, -118], [-165, -55], [-150, 15], [-108, 78], [-45, 92]] },
    { id: 'drive', type: 'road', pts: [[0, 74], [0, 60]] },
    { id: 's1', type: 'dirt', pts: [[-45, 92], [-30, 40], [-15, -10], [-7, -35], [5, -70], [20, -142]] },
    { id: 's2', type: 'dirt', pts: [[125, 62], [128, 35], [126, 16], [124, -14], [128, -60], [150, -125]] },
    { id: 's3', type: 'dirt', pts: [[-45, 92], [-80, 75], [-115, 55], [-140, 30], [-150, 15]] },
    { id: 'glacier', type: 'dirt', pts: [[60, 82], [95, 118], [80, 150], [35, 170], [0, 186]] },
    { id: 'halfdome', type: 'dirt', pts: [[150, -125], [160, -150], [166, -172]] },
    { id: 'mirror', type: 'dirt', pts: [[150, -125], [180, -128], [203, -120]] },
    { id: 'bridalveil', type: 'dirt', pts: [[-150, 15], [-170, -5], [-178, -28]] },
    { id: 'meadow', type: 'dirt', pts: [[20, -142], [30, -105], [35, -68]] },
    { id: 'sequoia', type: 'dirt', pts: [[-108, 78], [-100, 64]] },
  ];
  const roadsById = {};
  function buildRoads() {
    for (const r of ROADS) {
      let pts;
      if (r.pts.length === 2) {
        const [a, b] = r.pts; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(2, Math.ceil(len / 2));
        pts = []; for (let i = 0; i <= n; i++) pts.push(new THREE.Vector3(U.lerp(a[0], b[0], i / n), 0, U.lerp(a[1], b[1], i / n)));
      } else {
        const curve = new THREE.CatmullRomCurve3(r.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), !!r.closed, 'centripetal');
        pts = curve.getSpacedPoints(Math.ceil(curve.getLength() / 2));
      }
      const samples = pts.map((p, i) => ({ x: p.x, z: p.z, y: baseHeight(p.x, p.z), type: r.type, road: r.id, s: i * 2, i }));
      for (let i = 0; i < samples.length; i++) {
        const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)];
        const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; samples[i].tx = dx / l; samples[i].tz = dz / l;
      }
      if (r.type === 'road') {
        for (let i = 1; i < samples.length; i++) {
          const a = samples[i - 1], b = samples[i];
          if ((a.z - riverZ(a.x)) * (b.z - riverZ(b.x)) < 0) {
            const lo = Math.max(0, i - 11), hi = Math.min(samples.length - 1, i + 11);
            const deckY = Math.max(baseHeight(samples[lo].x, samples[lo].z), baseHeight(samples[hi].x, samples[hi].z)) + 0.7;
            for (let k = lo; k <= hi; k++) samples[k].y = deckY;
            bridges.push({ cx: (a.x + b.x) / 2, cz: (a.z + b.z) / 2, yaw: Math.atan2(b.tx, b.tz), y: deckY, len: 40, wid: 11 });
            i += 12;
          }
        }
      }
      const w = 7, sm = samples.map((s, i) => { let acc = 0, n = 0; for (let k = -w; k <= w; k++) { let j = i + k; j = r.closed ? (j + samples.length) % samples.length : U.clamp(j, 0, samples.length - 1); acc += samples[j].y; n++; } return acc / n; });
      samples.forEach((s, i) => { s.y = sm[i]; });
      roadsById[r.id] = { def: r, samples, length: (samples.length - 1) * 2 };
      for (const s of samples) { roadSamples.push(s); hashAdd(roadHash, RH, s.x, s.z, s); }
    }
    for (const s of roadSamples) if (s.type === 'dirt') {
      hashQuery(roadHash, RH, s.x, s.z, _q);
      let best = null, bd = 1e9;
      for (const o of _q) if (o.type === 'road') { const d = Math.hypot(o.x - s.x, o.z - s.z); if (d < bd) { bd = d; best = o; } }
      if (best && bd < 10) s.y = U.lerp(best.y, s.y, U.smoothstep(2, 10, bd));
    }
  }
  function roadPoint(id, sMeters) { const r = roadsById[id]; return r.samples[U.clamp(Math.round(sMeters / 2), 0, r.samples.length - 1)]; }

  function buildHeights() {
    for (let iz = 0; iz < NV; iz++) for (let ix = 0; ix < NV; ix++) {
      const x = -HALF + ix * CELL, z = -HALF + iz * CELL;
      let h = baseHeight(x, z);
      const chan = chanAt(x, z);
      const { d, s } = nearestRoad(x, z);
      if (s && chan < 0.15) {
        const R = s.type === 'road' ? 7.5 : 5.2;
        if (d < R) h = U.lerp(h, s.y, 1 - U.smoothstep(R - 3.5, R, d));
      }
      for (const f of flatZones) { const dd = Math.hypot(x - f.x, z - f.z); if (dd < f.r) h = U.lerp(f.y, h, U.smoothstep(f.r - 5, f.r, dd)); }
      heights[iz * NV + ix] = h;
    }
  }
  function buildSurface() {
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const x = -HALF + (ix + 0.5) * CELL, z = -HALF + (iz + 0.5) * CELL;
      const h = terrainHeight(x, z);
      let t = SURF.GRASS;
      const slope = slopeAt(x, z);
      if (h < WATER_Y + 0.35) t = SURF.SAND;
      if (h < WATER_Y - 0.05) t = SURF.WATER;
      if (slope > 0.75 && t !== SURF.WATER) t = SURF.ROCK;
      if (h > 66 && slope < 1.3) t = SURF.SNOW;
      const { d, s } = nearestRoad(x, z);
      if (s && t !== SURF.WATER) {
        if (s.type === 'road') {
          if (d < 4.2) { t = SURF.ROAD; if (d < 1.0 && s.s % 10 < 5 && s.road === 'loop') t = SURF.LINE; }
          else if (d < 5.4) t = SURF.SHOULDER;
        } else if (d < 2.9) t = SURF.DIRT;
      }
      surface[iz * N + ix] = t;
    }
  }
  const _col = new THREE.Color();
  function cellColor(ix, iz, surf, h, tri) {
    const r = U.hash2(ix * 3 + tri, iz * 7);
    let c;
    switch (surf) {
      case SURF.ROAD: c = P.road[Math.floor(r * 3)]; break;
      case SURF.LINE: c = P.line; break;
      case SURF.DIRT: c = P.dirt[Math.floor(r * 3)]; break;
      case SURF.SHOULDER: c = P.shoulder; break;
      case SURF.SAND: c = P.sand; break;
      case SURF.WATER: c = P.riverbed; break;
      case SURF.ROCK: c = P.granite[Math.floor(r * 3)]; break;
      case SURF.SNOW: c = P.snow; break;
      default: c = P.grass[Math.floor(r * 4)];
    }
    _col.set(c);
    if (surf === SURF.GRASS) { if (h > 20) _col.lerp(new THREE.Color('#9ab85a'), U.clamp((h - 20) / 40, 0, 0.6)); if (h < 0.8) _col.lerp(new THREE.Color('#5fa36a'), 0.4); }
    _col.multiplyScalar(0.985 + r * 0.03);
    return _col;
  }
  // smooth per-vertex normals from the heightfield + flat per-triangle colours
  function vertNormal(ix, iz, out) {
    const i = iz * NV + ix;
    const hl = heights[iz * NV + Math.max(0, ix - 1)], hr = heights[iz * NV + Math.min(N, ix + 1)];
    const hd = heights[Math.max(0, iz - 1) * NV + ix], hu = heights[Math.min(N, iz + 1) * NV + ix];
    return out.set(-(hr - hl) / (2 * CELL), 1, -(hu - hd) / (2 * CELL)).normalize();
  }
  function buildTerrainMesh() {
    const tris = N * N * 2;
    const pos = new Float32Array(tris * 9), nor = new Float32Array(tris * 9), col = new Float32Array(tris * 9);
    let k = 0;
    const n = new THREE.Vector3();
    const put = (x, y, z, ix, iz, color) => {
      vertNormal(ix, iz, n);
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      nor[k] = n.x; nor[k + 1] = n.y; nor[k + 2] = n.z;
      col[k] = color.r; col[k + 1] = color.g; col[k + 2] = color.b;
      k += 3;
    };
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const x0 = -HALF + ix * CELL, z0 = -HALF + iz * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
      const i = iz * NV + ix;
      const h00 = heights[i], h10 = heights[i + 1], h01 = heights[i + NV], h11 = heights[i + NV + 1];
      const surf = surface[iz * N + ix], hm = (h00 + h10 + h01 + h11) / 4;
      const c = cellColor(ix, iz, surf, hm, 0);
      put(x0, h00, z0, ix, iz, c); put(x0, h01, z1, ix, iz + 1, c); put(x1, h10, z0, ix + 1, iz, c);
      put(x1, h10, z0, ix + 1, iz, c); put(x0, h01, z1, ix, iz + 1, c); put(x1, h11, z1, ix + 1, iz + 1, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    terrainMesh = new THREE.Mesh(g, FW.Pixel.vmat({ roughness: 0.97 }));
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);
  }

  // ---------------- placement helpers ----------------
  function canPlace(x, z, r, allowRock = false) {
    if (Math.abs(x) > 234 || Math.abs(z) > 234) return false;
    const s = surfaceAt(x, z);
    if (s === SURF.WATER || s === SURF.SAND) return false;
    if (!allowRock && (s === SURF.ROCK || s === SURF.SNOW)) return false;
    if (s === SURF.ROAD || s === SURF.LINE || s === SURF.SHOULDER || s === SURF.DIRT) return false;
    const { d, s: rs } = nearestRoad(x, z);
    if (rs && d < r + (rs.type === 'road' ? 8 : 4.5)) return false;
    for (const f of flatZones) if (Math.hypot(x - f.x, z - f.z) < f.r + r) return false;
    for (const o of overrides) if (Math.hypot(x - o.cx, z - o.cz) < o.len / 2 + r + 2) return false;
    if (!allowRock && slopeAt(x, z) > 0.9) return false;
    return true;
  }
  function addCollider(x, z, r, kind = 'solid', extra = {}) { const c = Object.assign({ x, z, r, kind }, extra); colliders.push(c); hashAdd(colHash, CH, x, z, c); return c; }
  function place(obj, x, z, yaw = 0, scale = 1, yOff = 0) { obj.position.set(x, groundY(x, z) + yOff, z); obj.rotation.y = yaw; if (scale !== 1) obj.scale.setScalar(scale); scene.add(obj); return obj; }

  // ---------------- vegetation ----------------
  function buildVegetation() {
    const types = {
      pine: { geo: V.pineGeo(), m: [], r: 0.7, tint: 0.22 },
      sequoia: { geo: V.sequoiaGeo(), m: [], r: 1.5, tint: 0.12 },
      aspen: { geo: V.aspenGeo(false), m: [], r: 0.4, tint: 0.18 },
      aspenGold: { geo: V.aspenGeo(true), m: [], r: 0.4, tint: 0.18 },
      bush: { geo: V.bushGeo(), m: [], r: 0.75, tint: 0.18, noCol: true },
      rock: { geo: V.rockGeo(), m: [], r: 0.95, tint: 0.12 },
      flower: { geo: V.flowerGeo(), m: [], r: 0, tint: 0.06, noCol: true },
      stump: { geo: V.stumpGeo(), m: [], r: 0.55, tint: 0.12 },
    };
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Pv = new THREE.Vector3(), AX = new THREE.Vector3(0, 1, 0);
    const add = (t, x, z, scale, yaw) => {
      const y = groundY(x, z) - 0.12;
      const e = types[t];
      const sq = t === 'rock' ? [0.8 + rand() * 0.7, 0.6 + rand() * 0.5, 0.8 + rand() * 0.7] : t === 'bush' ? [0.85 + rand() * 0.4, 0.75 + rand() * 0.45, 0.85 + rand() * 0.4] : [1, 1, 1];
      e.m.push({ x, y, z, yaw, sx: scale * sq[0], sy: scale * sq[1], sz: scale * sq[2] });
      if (!e.noCol) addCollider(x, z, e.r * scale, t === 'rock' ? 'rock' : 'tree');
    };
    let trees = 0;
    for (let i = 0; i < 26000 && trees < 1350; i++) {
      const x = (rand() - 0.5) * 468, z = (rand() - 0.5) * 468;
      const dc = Math.hypot(x, z), grove = Math.hypot(x + 115, z - 120);
      const inMeadow = Math.abs(x) < 95 && z > -105 && z < 60;
      let dens = inMeadow ? 0.08 : dc > 150 ? 0.9 : 0.45;
      if (grove < 65) dens = 0.75;
      if (rand() > dens) continue;
      const h = terrainHeight(x, z);
      const nearRiver = chanAt(x, z) > 0.02 || Math.abs(z - riverZ(x)) < 28;
      let t = 'pine';
      if (grove < 65) t = rand() < 0.6 ? 'sequoia' : 'pine';
      else if (nearRiver && h < 10) t = rand() < 0.6 ? 'aspen' : rand() < 0.5 ? 'aspenGold' : 'pine';
      else if (h < 12 && rand() < 0.25) t = rand() < 0.5 ? 'aspen' : 'aspenGold';
      const scale = t === 'sequoia' ? 1.2 + rand() * 0.7 : t === 'pine' ? 0.85 + rand() * 0.8 : 0.85 + rand() * 0.6;
      if (!canPlace(x, z, types[t].r * scale)) continue;
      add(t, x, z, scale, rand() * Math.PI * 2); trees++;
    }
    for (let i = 0, n = 0; i < 4000 && n < 300; i++) { const x = (rand() - 0.5) * 468, z = (rand() - 0.5) * 468; const s = surfaceAt(x, z); if (!(s === SURF.ROCK || (slopeAt(x, z) > 0.4 && rand() < 0.3) || rand() < 0.08)) continue; if (!canPlace(x, z, 1.2, true) || s === SURF.WATER) continue; add('rock', x, z, 0.6 + rand() * 1.3, rand() * 6.28); n++; }
    for (let i = 0, n = 0; i < 4000 && n < 340; i++) { const x = (rand() - 0.5) * 460, z = (rand() - 0.5) * 460; if (!canPlace(x, z, 0.9)) continue; add('bush', x, z, 0.8 + rand() * 0.7, rand() * 6.28); n++; }
    for (let i = 0, n = 0; i < 6000 && n < 800; i++) { const x = (rand() - 0.5) * 320, z = (rand() - 0.5) * 320; if (!canPlace(x, z, 0.2)) continue; add('flower', x, z, 0.85 + rand() * 0.9, rand() * 6.28); n++; }
    for (let i = 0, n = 0; i < 2000 && n < 55; i++) { const x = (rand() - 0.5) * 420, z = (rand() - 0.5) * 420; if (!canPlace(x, z, 0.7)) continue; add('stump', x, z, 0.85 + rand() * 0.5, rand() * 6.28); n++; }
    const tint = new THREE.Color();
    for (const [name, e] of Object.entries(types)) {
      if (!e.m.length) continue;
      const im = new THREE.InstancedMesh(e.geo, FW.Pixel.vmat({ roughness: 0.95 }), e.m.length);
      im.castShadow = name !== 'flower'; im.receiveShadow = true;
      e.m.forEach((it, i) => {
        Q.setFromAxisAngle(AX, it.yaw); S.set(it.sx, it.sy, it.sz); Pv.set(it.x, it.y, it.z);
        im.setMatrixAt(i, M.compose(Pv, Q, S));
        const v = 1 - e.tint / 2 + rand() * e.tint; tint.setRGB(v * (0.97 + rand() * 0.06), v, v * (0.97 + rand() * 0.06)); im.setColorAt(i, tint);
      });
      im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
      scene.add(im);
    }
  }

  // ---------------- fences ----------------
  const fenceInstances = [];
  function fenceLine(pts) {
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 3));
      for (let k = 0; k < n; k++) {
        const x0 = U.lerp(ax, bx, k / n), z0 = U.lerp(az, bz, k / n), x1 = U.lerp(ax, bx, (k + 1) / n), z1 = U.lerp(az, bz, (k + 1) / n);
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const y = Math.min(groundY(x0, z0), groundY(x1, z1), groundY(cx, cz));
        const seg = { ax: x0, az: z0, bx: x1, bz: z1, h: 1.0, y, cx, cz };
        fences.push(seg); hashAdd(fenceHash, CH, cx, cz, seg);
        fenceInstances.push({ x: cx, y: y - 0.05, z: cz, yaw: Math.atan2(-(z1 - z0), x1 - x0), sx: Math.hypot(x1 - x0, z1 - z0) / 3 });
      }
    }
  }
  function gateAcross(roadId, sMeters, width) {
    const s = roadPoint(roadId, sMeters);
    const px = -s.tz, pz = s.tx;
    fenceLine([[s.x - px * width / 2, s.z - pz * width / 2], [s.x + px * width / 2, s.z + pz * width / 2]]);
  }
  function buildFences() {
    fenceLine([[-9, 46], [-9, 68]]); fenceLine([[9, 46], [9, 68]]); fenceLine([[-9, 46], [9, 46]]);
    fenceLine([[14, 62], [40, 69], [62, 73]]); fenceLine([[78, 70], [100, 61], [112, 54]]);
    fenceLine([[24, -80], [46, -80], [46, -58]]); fenceLine([[24, -80], [24, -64]]);
    fenceLine([[-95, 100], [-70, 108], [-40, 106]]);
    fenceLine([[140, -95], [160, -105], [175, -118]]);
    gateAcross('s3', 12, 9); gateAcross('s3', roadsById.s3.length - 14, 9);
    gateAcross('s1', 12, 9); gateAcross('s1', roadsById.s1.length - 12, 9);
    gateAcross('s2', 10, 9);
    gateAcross('meadow', 20, 9);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Pv = new THREE.Vector3(), AX = new THREE.Vector3(0, 1, 0);
    const im = new THREE.InstancedMesh(V.fenceGeo(3), FW.Pixel.vmat(), fenceInstances.length);
    im.castShadow = true; im.receiveShadow = true;
    fenceInstances.forEach((f, i) => { Q.setFromAxisAngle(AX, f.yaw); S.set(f.sx, 1, 1); Pv.set(f.x, f.y, f.z); im.setMatrixAt(i, M.compose(Pv, Q, S)); });
    im.instanceMatrix.needsUpdate = true; scene.add(im);
  }

  // ---------------- rails ----------------
  function addRail(ax, az, bx, bz, opts = {}) {
    let ya = groundY(ax, az) + (opts.lift || 1.0), yb = groundY(bx, bz) + (opts.lift || 1.0);
    if (opts.ya !== undefined) ya = opts.ya; if (opts.yb !== undefined) yb = opts.yb;
    let raise = 0;
    for (let t = 0; t <= 1; t += 0.05) { const gy = groundY(U.lerp(ax, bx, t), U.lerp(az, bz, t)); raise = Math.max(raise, gy + 0.8 - U.lerp(ya, yb, t)); }
    ya += raise; yb += raise;
    const rail = { ax, ay: ya, az, bx, by: yb, bz, len: Math.hypot(bx - ax, bz - az), log: !!opts.log };
    rail.dx = (bx - ax) / rail.len; rail.dz = (bz - az) / rail.len; rail.dy = (yb - ya) / rail.len;
    rails.push(rail);
    const g = new THREE.Group();
    const L = Math.hypot(bx - ax, yb - ya, bz - az);
    if (opts.log) {
      const m = new THREE.Mesh(V.cyl(0.36, 0.42, L, 10), FW.Pixel.mat(P.trunk)); m.castShadow = true; m.rotation.x = Math.PI / 2; g.add(m);
      for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(V.sphere(0.2, 7, 5), FW.Pixel.mat(P.pine[1])); s.position.set((i % 2 ? 0.32 : -0.32), 0.18, -L / 2 + 2 + i * (L - 4) / 3); s.scale.set(1.4, 0.5, 1.4); g.add(s); }
    } else {
      const bar = new THREE.Mesh(V.capsule(0.08, L), FW.Pixel.mat(P.steel, { roughness: 0.25, metalness: 0.85, envMapIntensity: 1.2 })); bar.rotation.x = Math.PI / 2; bar.castShadow = true; g.add(bar);
      const bar2 = new THREE.Mesh(V.capsule(0.05, L), FW.Pixel.mat(P.steel, { roughness: 0.3, metalness: 0.8 })); bar2.rotation.x = Math.PI / 2; bar2.position.y = -0.45; g.add(bar2);
    }
    g.position.set((ax + bx) / 2, (ya + yb) / 2, (az + bz) / 2);
    g.lookAt(bx, yb, bz);
    scene.add(g);
    if (!opts.log) {
      const n = Math.max(2, Math.round(rail.len / 3));
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = U.lerp(ax, bx, t), z = U.lerp(az, bz, t), ry = U.lerp(ya, yb, t), gy = groundY(x, z);
        const post = new THREE.Mesh(V.capsule(0.09, Math.max(0.1, ry - gy - 0.1)), FW.Pixel.mat(P.wood));
        post.position.set(x, (ry + gy) / 2, z); post.castShadow = true; scene.add(post);
      }
    } else {
      for (const [x, z, y] of [[ax, az, ya], [bx, bz, yb]]) { const gy = groundY(x, z); const r = new THREE.Mesh(V.rockGeo(), FW.Pixel.vmat()); r.position.set(x, gy - 0.2, z); r.scale.setScalar(Math.max(0.6, (y - gy) * 0.85)); r.castShadow = true; scene.add(r); }
    }
    return rail;
  }
  function chainRails(list) { for (let i = 0; i < list.length - 1; i++) list[i].next = list[i + 1]; }

  // ---------------- ramps, decks, chutes ----------------
  function wedgeGeo(len, wid, h) {
    const hl = len / 2, hw = wid / 2;
    const v = [[-hw, 0, -hl], [hw, 0, -hl], [hw, 0, hl], [-hw, 0, hl], [hw, h, hl], [-hw, h, hl]];
    const faces = [[0, 1, 4, 5], [1, 2, 4], [0, 5, 3], [3, 5, 4, 2], [0, 3, 2, 1]];
    const cols = ['#b07c4a', '#96663a', '#96663a', '#8a5a2b', '#7a4c30'];
    const pos = [], col = [], nor = [];
    const c = new THREE.Color();
    faces.forEach((f, fi) => {
      c.set(cols[fi]);
      const tris = f.length === 4 ? [[f[0], f[1], f[2]], [f[0], f[2], f[3]]] : [f];
      for (const t of tris) {
        const a = new THREE.Vector3(...v[t[0]]), b = new THREE.Vector3(...v[t[1]]), d = new THREE.Vector3(...v[t[2]]);
        const n = b.clone().sub(a).cross(d.clone().sub(a)).normalize();
        for (const q of [a, b, d]) { pos.push(q.x, q.y, q.z); nor.push(n.x, n.y, n.z); col.push(c.r, c.g, c.b); }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }
  const chevTex = FW.Pixel.chevronTexture();
  function addRamp(cx, cz, yaw, len, wid, h, kick = 1.35) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const sx = cx - fx * len / 2, sz = cz - fz * len / 2;
    const y0 = terrainHeight(sx, sz) + 0.05;
    const o = { cx, cz, yaw, len, wid, y0, y1: y0 + h, kind: 'ramp', kick, fx, fz, rx: fz, rz: -fx, surf: SURF.WOOD };
    overrides.push(o);
    const m = new THREE.Mesh(wedgeGeo(len, wid, h), FW.Pixel.vmat({ roughness: 0.85 }));
    m.castShadow = true; m.receiveShadow = true; m.position.set(cx, y0, cz); m.rotation.y = yaw; scene.add(m);
    const slopeLen = Math.hypot(len, h);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(wid * 0.45, slopeLen * 0.82), new THREE.MeshBasicMaterial({ map: chevTex.clone(), transparent: true, opacity: 0.95, toneMapped: false }));
    stripe.material.map.repeat.set(1, 3); stripe.material.map.needsUpdate = true;
    stripe.rotation.x = -Math.PI / 2 + Math.atan2(h, len); stripe.position.set(0, h / 2 + 0.04, 0);
    const holder = new THREE.Group(); holder.position.set(cx, y0, cz); holder.rotation.y = yaw; holder.add(stripe); scene.add(holder);
    // rounded side rails
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(V.capsule(0.13, slopeLen * 0.95), FW.Pixel.mat(P.wood2));
      rail.rotation.set(Math.PI / 2 - Math.atan2(h, len), 0, 0);
      rail.position.set(side * (wid / 2 - 0.15), h / 2 + 0.12, 0);
      rail.castShadow = true; holder.add(rail);
    }
    animated.push({ update: (dt) => { stripe.material.map.offset.y -= dt * 0.9; } });
    return o;
  }
  function addDeck(b) {
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    overrides.push({ cx: b.cx, cz: b.cz, yaw: b.yaw, len: b.len, wid: b.wid, y0: b.y, y1: b.y, kind: 'deck', fx, fz, rx: fz, rz: -fx, surf: SURF.ROAD });
    const g = new THREE.Group(); g.position.set(b.cx, b.y, b.cz); g.rotation.y = b.yaw;
    const deck = new THREE.Mesh(V.roundedBox(b.wid, 0.5, b.len, 0.16), FW.Pixel.mat(P.wood)); deck.position.y = -0.25; deck.receiveShadow = true; deck.castShadow = true; g.add(deck);
    for (let i = 0; i < 7; i++) { const plank = new THREE.Mesh(V.roundedBox(b.wid + 0.2, 0.1, 0.42, 0.05), FW.Pixel.mat(P.wood2)); plank.position.set(0, 0.0, -b.len / 2 + 3 + i * (b.len - 6) / 6); g.add(plank); }
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) { const pier = new THREE.Mesh(V.cyl(0.6, 0.75, 6, 10), FW.Pixel.mat(P.granite[0])); pier.position.set(sx * (b.wid / 2 - 1), -3, -b.len / 2 + 5 + i * (b.len - 10) / 3); pier.castShadow = true; g.add(pier); }
    scene.add(g);
    const rx = fz, rz = -fx;
    for (const side of [-1, 1]) {
      const ox = rx * side * (b.wid / 2 - 0.5), oz = rz * side * (b.wid / 2 - 0.5);
      addRail(b.cx + ox - fx * (b.len / 2 - 2), b.cz + oz - fz * (b.len / 2 - 2), b.cx + ox + fx * (b.len / 2 - 2), b.cz + oz + fz * (b.len / 2 - 2), { ya: b.y + 0.95, yb: b.y + 0.95 });
    }
  }
  // long banked wooden chute: gravity pulls you to the middle, carve the walls for speed
  function addChute(ax, az, bx, bz, wid, bank) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const fx = dx / len, fz = dz / len;
    const y0 = terrainHeight(ax, az) + 0.3, y1 = terrainHeight(bx, bz) + 0.3;
    const o = { cx: (ax + bx) / 2, cz: (az + bz) / 2, yaw, len, wid, y0, y1, kind: 'chute', fx, fz, rx: fz, rz: -fx, bank, surf: SURF.WOOD, kick: 1.25 };
    overrides.push(o);
    // build the surface as a strip of rounded slats
    const SEG = 58, CROSS = 7;
    const pos = [], nor = [], col = [];
    const c = new THREE.Color();
    const at = (u, v) => {
      const t = (u + 0.5), tv = v;
      const y = U.lerp(y0, y1, t) + bank * tv * tv;
      const x = o.cx + fx * (u * len) + o.rx * (tv * wid / 2);
      const z = o.cz + fz * (u * len) + o.rz * (tv * wid / 2);
      return [x, y, z];
    };
    for (let i = 0; i < SEG; i++) for (let j = 0; j < CROSS; j++) {
      const u0 = -0.5 + i / SEG, u1 = -0.5 + (i + 1) / SEG, v0 = -1 + 2 * j / CROSS, v1 = -1 + 2 * (j + 1) / CROSS;
      const a = at(u0, v0), b = at(u1, v0), d = at(u1, v1), e = at(u0, v1);
      c.set(i % 2 ? '#cfa068' : '#bb8a53').multiplyScalar(0.97 + 0.05 * U.hash2(i, j));
      for (const tri of [[a, b, d], [a, d, e]]) {
        const A = new THREE.Vector3(...tri[0]), B = new THREE.Vector3(...tri[1]), C = new THREE.Vector3(...tri[2]);
        const n = B.clone().sub(A).cross(C.clone().sub(A)).normalize(); if (n.y < 0) n.negate();
        for (const q of tri) { pos.push(q[0], q[1], q[2]); nor.push(n.x, n.y, n.z); col.push(c.r, c.g, c.b); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(g, FW.Pixel.vmat({ roughness: 0.9 })); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    // a chevron guide stripe down the middle, so the run reads at speed
    {
      const sp = [], su = [];
      for (let i = 0; i <= SEG; i++) {
        const u = -0.5 + i / SEG;
        const a = at(u, -0.16), b = at(u, 0.16);
        sp.push(a[0], a[1] + 0.06, a[2], b[0], b[1] + 0.06, b[2]);
        su.push(0, i * 0.9, 1, i * 0.9);
      }
      const idx = [];
      for (let i = 0; i < SEG; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      sg.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
      sg.setIndex(idx); sg.computeVertexNormals();
      const tex = chevTex.clone(); tex.needsUpdate = true;
      const sm = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, toneMapped: false }));
      scene.add(sm);
      animated.push({ update: (dt) => { tex.offset.y -= dt * 1.1; } });
    }
    // lip rails + support posts
    for (const side of [-1, 1]) {
      for (let i = 0; i <= 18; i++) {
        const t = i / 18;
        const [x, y, z] = at(-0.5 + t, side * 1.0);
        const post = new THREE.Mesh(V.capsule(0.14, Math.max(0.2, y - terrainHeight(x, z))), FW.Pixel.mat(P.wood2));
        post.position.set(x, (y + terrainHeight(x, z)) / 2, z); post.castShadow = true; scene.add(post);
        const lip = new THREE.Mesh(V.sphere(0.3, 9, 7), FW.Pixel.mat('#e5564a'));
        lip.position.set(x, y + 0.16, z); lip.castShadow = true; scene.add(lip);
      }
    }
    return o;
  }
  function addBoostPad(x, z, yaw) {
    const pad = { cx: x, cz: z, yaw, len: 5.5, wid: 4.0, fx: Math.sin(yaw), fz: Math.cos(yaw) }; pad.rx = pad.fz; pad.rz = -pad.fx;
    boostPads.push(pad);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 5.5), new THREE.MeshBasicMaterial({ map: chevTex.clone(), transparent: true, toneMapped: false }));
    m.material.map.repeat.set(1, 2); m.material.map.needsUpdate = true;
    m.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group(); holder.position.set(x, groundY(x, z) + 0.12, z); holder.rotation.y = yaw; holder.add(m); scene.add(holder);
    animated.push({ update: (dt) => { m.material.map.offset.y -= dt * 1.8; } });
  }
  function padAt(x, z) { for (const p of boostPads) { const dx = x - p.cx, dz = z - p.cz; const u = dx * p.fx + dz * p.fz, v = dx * p.rx + dz * p.rz; if (Math.abs(u) <= p.len / 2 && Math.abs(v) <= p.wid / 2) return p; } return null; }

  // bouncy mushrooms
  function addBouncer(x, z, scale = 1) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(V.mushroomGeo(), FW.Pixel.vmat({ roughness: 0.75 }));
    m.castShadow = true; m.receiveShadow = true; g.add(m);
    g.position.set(x, groundY(x, z), z); g.scale.setScalar(scale); scene.add(g);
    const b = { x, z, y: g.position.y, r: 0.72 * scale, g, squash: 0, scale };
    bouncers.push(b);
    return b;
  }
  // floating rings to fly through
  function addRing(x, y, z, yaw, r = 2.8) {
    const g = V.airRing(r);
    g.position.set(x, y, z); g.rotation.y = yaw; scene.add(g);
    const ring = { x, y, z, yaw, r, g, taken: 0, fx: Math.sin(yaw), fz: Math.cos(yaw) };
    rings.push(ring);
    return ring;
  }
  function addToken(x, y, z) {
    const g = V.token(); g.position.set(x, y, z); scene.add(g);
    tokens.push({ x, y, z, g, taken: false });
  }
  function scatterTokens() {
    const put = (ax, az, bx, bz, n, lift = 1.4) => { for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, x = U.lerp(ax, bx, t), z = U.lerp(az, bz, t); addToken(x, groundY(x, z) + lift, z); } };
    const trail = (id, from, to, n, lift) => { const r = roadsById[id]; for (let i = 0; i < n; i++) { const s = r.samples[Math.round(U.lerp(from, to, i / (n - 1)) / 2)]; if (s) addToken(s.x, groundY(s.x, s.z) + (lift || 1.4), s.z); } };
    trail('s1', 20, roadsById.s1.length - 20, 10);
    trail('s2', 20, roadsById.s2.length - 20, 8);
    trail('s3', 15, roadsById.s3.length - 15, 7);
    trail('glacier', 20, roadsById.glacier.length - 20, 8);
    put(-30, 168, 6, 150, 6, 3.0);
    put(120, 20, 132, -4, 5, 2.2);
  }

  // ---------------- sky & lighting ----------------
  function buildSky() {
    skyGeo = new THREE.SphereGeometry(900, 20, 12);
    skyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
    sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
    sky.renderOrder = -10; scene.add(sky);
    sunDisc = new THREE.Mesh(new THREE.CircleGeometry(40, 16), new THREE.MeshBasicMaterial({ color: '#fff6d8', fog: false, toneMapped: false }));
    scene.add(sunDisc);
    sun = new THREE.DirectionalLight(0xffffff, 3.6);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 10; sc.far = 320;
    sun.shadow.bias = -0.0009; sun.shadow.normalBias = 0.05; sun.shadow.radius = 2.4;
    scene.add(sun); scene.add(sun.target);
    fill = new THREE.DirectionalLight('#bcd8ff', 0.55); fill.position.set(-1, 0.6, -0.8); scene.add(fill);
    hemi = new THREE.HemisphereLight(0xcfe7ff, 0xa89a72, 0.7); scene.add(hemi);
    scene.fog = new THREE.Fog(0xffe3c4, 150, 540);
    scene.environment = FW.Pixel.envOutdoor;
    scene.backgroundIntensity = 1;
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(V.sphere(3 + rand() * 4, 9, 6), FW.Pixel.mat('#ffffff', { roughness: 1, envMapIntensity: 0.4 }));
        m.position.set((k - n / 2) * 5 + rand() * 3, rand() * 1.6, (rand() - 0.5) * 4); m.scale.y = 0.62; g.add(m);
      }
      g.position.set((rand() - 0.5) * 800, 95 + rand() * 60, (rand() - 0.5) * 800); g.scale.setScalar(1 + rand() * 1.4);
      scene.add(g);
      const speed = 1 + rand() * 1.5;
      animated.push({ update: (dt) => { g.position.x += speed * dt; if (g.position.x > 420) g.position.x = -420; } });
    }
  }
  const sunDir = new THREE.Vector3(0.5, 0.8, 0.4).normalize();
  function setTimeOfDay(t) {
    t = U.clamp(t, 0, 1);
    const i = t < 0.5 ? 0 : 1, f = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    const A = timeStops[i], B = timeStops[i + 1];
    const mix = (a, b) => new THREE.Color(a).lerp(new THREE.Color(b), f);
    const zen = mix(A.zen, B.zen), hor = mix(A.hor, B.hor);
    const pos = skyGeo.attributes.position, col = skyGeo.attributes.color; const c = new THREE.Color();
    for (let k = 0; k < pos.count; k++) { const ny = pos.getY(k) / 900; c.copy(hor).lerp(zen, U.smoothstep(-0.02, 0.5, ny)); if (ny < -0.02) c.copy(hor).multiplyScalar(0.9); col.setXYZ(k, c.r, c.g, c.b); }
    col.needsUpdate = true;
    sun.color.copy(mix(A.sun, B.sun)); sun.intensity = U.lerp(A.sunI, B.sunI, f);
    hemi.color.copy(mix(A.hemiSky, B.hemiSky)); hemi.groundColor.copy(mix(A.hemiGnd, B.hemiGnd));
    hemi.intensity = U.lerp(A.amb, B.amb, f);
    scene.fog.color.copy(mix(A.fog, B.fog));
    sunDisc.material.color.copy(mix(A.sun, B.sun));
    const ang = U.lerp(0.9, 2.3, t);
    sunDir.set(Math.cos(ang) * 0.8, U.lerp(0.62, 0.42, Math.abs(t - 0.5) * 2) + 0.28, Math.sin(ang) * 0.5 + 0.3).normalize();
  }

  // ---------------- landmarks ----------------
  function buildLandmarks() {
    const granite = FW.Pixel.mat('#b9b4c4', { roughness: 0.95 });
    const hd = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(52, 18, 12, 0, Math.PI), granite); dome.scale.y = 1.5; hd.add(dome);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(52, 18), FW.Pixel.mat('#cdc7d6', { roughness: 0.95 })); cap.scale.y = 1.5; cap.rotation.y = Math.PI; hd.add(cap);
    hd.position.set(212, baseHeight(212, -212) - 12, -212); hd.rotation.y = Math.PI * 0.75; scene.add(hd);
    const el = new THREE.Mesh(V.roundedBox(64, 120, 90, 8, 3), granite); el.position.set(-228, baseHeight(-228, -150) + 40, -150); el.rotation.y = 0.2; scene.add(el);
    const nose = new THREE.Mesh(V.roundedBox(30, 90, 30, 6, 3), FW.Pixel.mat('#c8c2d0', { roughness: 0.95 })); nose.position.set(-200, baseHeight(-200, -150) + 30, -150); nose.rotation.y = 0.6; scene.add(nose);
    for (const [x, z, h, w] of [[-212, 70, 60, 14], [-224, 92, 78, 12], [-206, 110, 52, 10], [222, 90, 66, 14], [206, 60, 44, 12]]) {
      const s = new THREE.Mesh(V.cyl(w * 0.35, w * 0.7, h, 7), granite); s.position.set(x, baseHeight(x, z) + h / 2 - 10, z); s.rotation.y = rand(); scene.add(s);
    }
    waterfall(-238, -196, -40, 10);
    waterfall(238, 200, -70, 6);
  }
  function waterfall(x0, x1, z, width) {
    const n = 10, pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = U.lerp(x0, x1, t); const y = baseHeight(x, z) + 0.5 + (i === n ? -0.3 : 0);
      pos.push(x, y, z - width / 2, x, y, z + width / 2); uv.push(0, t * 6, 1, t * 6);
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const tex = FW.Pixel.stripeTexture(['#ffffff', '#cfeaff', '#ffffff', '#9fd4f5', '#e6f6ff', '#bfe3ff'], 8, 48);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: 0.94, toneMapped: false }));
    scene.add(m);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(width * 1.15, 14), FW.Pixel.mat('#8fd0f0', { transparent: true, opacity: 0.85, roughness: 0.12, envMapIntensity: 1.4 }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(x1 + (x1 > x0 ? 4 : -4), baseHeight(x1, z) + 0.35, z); scene.add(pool);
    animated.push({ update: (dt) => { tex.offset.y -= dt * 1.7; if (Math.random() < 0.35) fx.spawn({ x: pool.position.x + (Math.random() - 0.5) * 6, y: pool.position.y + 0.5, z: z + (Math.random() - 0.5) * 6, vy: 1.6 + Math.random(), vx: (Math.random() - 0.5), vz: (Math.random() - 0.5), life: 1.5, size: 0.45, color: '#ffffff', gravity: -0.3, shrink: false }); } });
  }

  // ---------------- destinations & buildings ----------------
  const DEST_DEFS = [
    { id: 'meadow', name: 'Meadow Camp', x: 35, z: -68 },
    { id: 'glacier', name: 'Glacier Point', x: 0, z: 186 },
    { id: 'halfdome', name: 'Half Dome Base Camp', x: 166, z: -176 },
    { id: 'mirror', name: 'Mirror Lake Cabins', x: 203, z: -120 },
    { id: 'ranger', name: 'Ranger Station', x: -150, z: -100 },
    { id: 'bridalveil', name: 'Bridalveil Picnic', x: -178, z: -28 },
    { id: 'sequoia', name: 'Sequoia Grove Cabin', x: -100, z: 62 },
  ];
  const HOME = { x: 0, z: 58, r: 15 };
  function defineFlatZones() {
    const zoneY = (x, z, r) => { const { d, s } = nearestRoad(x, z); return s && d < r + 6 ? s.y : baseHeight(x, z); };
    flatZones.push({ x: HOME.x, z: HOME.z, r: HOME.r, y: zoneY(0, 66, 6) });
    for (const d of DEST_DEFS) { const y = zoneY(d.x, d.z, 12); flatZones.push({ x: d.x, z: d.z, r: 13, y }); destinations[d.id] = { id: d.id, name: d.name, x: d.x, z: d.z, y, r: 7, dist: Math.hypot(d.x - HOME.x, d.z - HOME.z) }; }
  }
  function critterIdle(g, phase) {
    animated.push({ update: (dt, t) => { g.userData.head.rotation.y = Math.sin(t * 0.7 + phase) * 0.35; g.position.y = g.userData.baseY + Math.abs(Math.sin(t * 2.2 + phase)) * 0.05; } });
  }
  function buildBuildings() {
    const shack = V.shack(); place(shack, 0, 55, 0); chimneys.push(shack.localToWorld(shack.userData.chimney.clone()));
    addCollider(0, 55, 4.0, 'building'); addCollider(-2.6, 55, 3.0, 'building'); addCollider(2.6, 55, 3.0, 'building');
    place(V.picnicTable(), 11, 52, 0.3); addCollider(11, 52, 1.1, 'prop');
    place(V.signpost('HOME SWEET WAFFLE'), -6, 66, 0.4); addCollider(-6, 66, 0.3, 'prop');
    for (const d of DEST_DEFS) {
      const gy = groundY(d.x, d.z);
      place(V.signpost(d.name.toUpperCase()), d.x + 6, d.z + 5, -0.6); addCollider(d.x + 6, d.z + 5, 0.3, 'prop');
      switch (d.id) {
        case 'meadow': case 'halfdome': {
          const cols = [P.tent[0], P.tent[1], P.tent[2]];
          [[-7, -6, 0.8], [6, -7, -0.6], [8, 4, -2.2]].forEach(([ox, oz, yaw], i) => { place(V.tent(cols[i]), d.x + ox, d.z + oz, yaw); addCollider(d.x + ox, d.z + oz, 1.6, 'prop'); });
          const cf = V.campfire(); place(cf, d.x, d.z - 7, 0); addCollider(d.x, d.z - 7, 0.9, 'prop');
          animated.push({ update: (dt, t) => cf.userData.flames.forEach((f, i) => { f.scale.y = 0.8 + 0.35 * Math.sin(t * 9 + i * 2); f.scale.x = 0.9 + 0.15 * Math.sin(t * 7 + i); }) });
          place(V.picnicTable(), d.x - 8, d.z + 5, 1.2); addCollider(d.x - 8, d.z + 5, 1.1, 'prop');
          break; }
        case 'glacier': {
          const deck = new THREE.Mesh(V.roundedBox(12, 0.4, 8, 0.14), FW.Pixel.mat(P.wood)); deck.position.set(d.x, gy + 0.2, d.z - 6); deck.receiveShadow = true; scene.add(deck);
          fenceLine([[d.x - 6, d.z - 10], [d.x + 6, d.z - 10]]); fenceLine([[d.x - 6, d.z - 10], [d.x - 6, d.z - 2]]); fenceLine([[d.x + 6, d.z - 10], [d.x + 6, d.z - 2]]);
          place(V.picnicTable(), d.x - 7, d.z + 4, 0.2); addCollider(d.x - 7, d.z + 4, 1.1, 'prop');
          const scope = V.build([V.p(V.capsule(0.08, 1.2), P.steel, 0, 0.6, 0, { mat: 'metal' }), V.p(V.cyl(0.16, 0.2, 0.7, 10), P.brown, 0, 1.3, 0, { rx: Math.PI / 2.4, mat: 'shiny' }), V.p(V.sphere(0.12, 8, 6), '#3a3340', 0, 1.55, 0.3)]);
          place(scope, d.x + 3, d.z - 8, Math.PI); addCollider(d.x + 3, d.z - 8, 0.4, 'prop');
          break; }
        case 'mirror': {
          place(V.cabin('#4f7d4a'), d.x - 6, d.z - 8, 0.4); addCollider(d.x - 6, d.z - 8, 3.0, 'building');
          place(V.cabin('#8a5a3c'), d.x + 8, d.z - 5, -0.5); addCollider(d.x + 8, d.z - 5, 3.0, 'building');
          const pond = new THREE.Mesh(new THREE.CircleGeometry(15, 20), FW.Pixel.mat('#7cc4ec', { transparent: true, opacity: 0.85, roughness: 0.08, metalness: 0.1, envMapIntensity: 1.6 }));
          pond.rotation.x = -Math.PI / 2; pond.position.set(215, baseHeight(215, -105) + 1.6, -105); scene.add(pond);
          const cf = V.campfire(); place(cf, d.x, d.z - 12, 0); addCollider(d.x, d.z - 12, 0.9, 'prop');
          animated.push({ update: (dt, t) => cf.userData.flames.forEach((f, i) => { f.scale.y = 0.8 + 0.35 * Math.sin(t * 9 + i * 2); }) });
          break; }
        case 'ranger': {
          place(V.rangerStation(), d.x, d.z - 10, 0); addCollider(d.x, d.z - 10, 4.0, 'building'); addCollider(d.x - 3, d.z - 10, 2.8, 'building'); addCollider(d.x + 3, d.z - 10, 2.8, 'building');
          place(V.picnicTable(), d.x - 9, d.z + 2, 0.1); addCollider(d.x - 9, d.z + 2, 1.1, 'prop');
          break; }
        case 'bridalveil': {
          place(V.picnicTable(), d.x - 5, d.z - 6, 0.3); addCollider(d.x - 5, d.z - 6, 1.1, 'prop');
          place(V.picnicTable(), d.x + 4, d.z - 8, -0.4); addCollider(d.x + 4, d.z - 8, 1.1, 'prop');
          break; }
        case 'sequoia': {
          const cb = V.cabin('#8a5a3c'); place(cb, d.x - 4, d.z - 8, 0.15); addCollider(d.x - 4, d.z - 8, 3.0, 'building'); chimneys.push(cb.localToWorld(cb.userData.chimney.clone()));
          const cf = V.campfire(); place(cf, d.x + 7, d.z - 4, 0); addCollider(d.x + 7, d.z - 4, 0.9, 'prop');
          animated.push({ update: (dt, t) => cf.userData.flames.forEach((f, i) => { f.scale.y = 0.8 + 0.35 * Math.sin(t * 9 + i * 2); }) });
          break; }
      }
      if (rand() < 0.7) {
        const kinds = Object.keys(V.CRITTERS);
        const c = V.critter(kinds[Math.floor(rand() * kinds.length)]);
        place(c, d.x - 4 + rand() * 8, d.z + 8 + rand() * 3, Math.PI + (rand() - 0.5));
        c.userData.baseY = c.position.y; critterIdle(c, rand() * 6);
      }
    }
  }

  // hollow log you can drive through
  function logTunnel(x, z, yaw, len = 22, r = 2.6) {
    const g = new THREE.Group(); g.position.set(x, groundY(x, z) + r * 0.62, z); g.rotation.y = yaw;
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, len, 16, 1, true), FW.Pixel.mat(P.sequoia, { side: THREE.DoubleSide, roughness: 0.95 }));
    shell.rotation.z = Math.PI / 2; shell.castShadow = true; shell.receiveShadow = true; g.add(shell);
    for (const sx of [-1, 1]) {
      const ring = new THREE.Mesh(V.torus(r * 1.02, 0.22, 6, 18), FW.Pixel.mat('#c9a177'));
      ring.position.x = sx * len / 2; ring.rotation.y = Math.PI / 2; g.add(ring);
    }
    for (let i = 0; i < 10; i++) {
      const moss = new THREE.Mesh(V.sphere(0.5 + Math.random() * 0.5, 8, 6), FW.Pixel.mat(P.pine[1]));
      moss.position.set((Math.random() - 0.5) * len * 0.9, r * 0.85, (Math.random() - 0.5) * r); moss.scale.y = 0.45; moss.castShadow = true; g.add(moss);
    }
    scene.add(g);
    // side colliders so you have to actually aim for the opening
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (const side of [-1, 1]) for (const end of [-1, 1]) addCollider(x + fz * side * (r + 0.6) + fx * end * len * 0.32, z - fx * side * (r + 0.6) + fz * end * len * 0.32, 0.7, 'prop');
    return g;
  }

  function buildWater() {
    water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE, 1, 1), FW.Pixel.mat(P.water, { transparent: true, opacity: 0.78, roughness: 0.1, metalness: 0.15, envMapIntensity: 1.5 }));
    water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y; water.receiveShadow = true; scene.add(water);
    animated.push({ update: (dt, t) => { water.position.y = WATER_Y + Math.sin(t * 1.3) * 0.06; } });
  }

  // ---------------- minimap ----------------
  function buildMinimap() {
    const S = 168;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const cols = { [SURF.GRASS]: [128, 190, 100], [SURF.ROAD]: [110, 106, 120], [SURF.LINE]: [180, 165, 110], [SURF.DIRT]: [190, 145, 100], [SURF.SHOULDER]: [180, 165, 130], [SURF.SAND]: [225, 210, 165], [SURF.WATER]: [95, 175, 225], [SURF.ROCK]: [170, 165, 185], [SURF.SNOW]: [240, 243, 250], [SURF.WOOD]: [176, 124, 74] };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const ix = Math.floor(x / S * N), iz = Math.floor((S - 1 - y) / S * N);
      const s = surface[iz * N + ix];
      const col = cols[s] || cols[0];
      const wx = -HALF + ix * CELL, wz = -HALF + iz * CELL;
      const shade = 0.82 + U.clamp(terrainHeight(wx, wz) / 90, 0, 1) * 0.4;
      const i = (y * S + x) * 4;
      img.data[i] = Math.min(255, col[0] * shade); img.data[i + 1] = Math.min(255, col[1] * shade); img.data[i + 2] = Math.min(255, col[2] * shade); img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    minimap = { canvas: c, size: S, toMap: (x, z) => [(x + HALF) / SIZE * S, S - (z + HALF) / SIZE * S] };
  }

  // ---------------- build ----------------
  function build(targetScene) {
    scene = targetScene;
    fx = new FW.Particles(scene, 800);
    buildRoads();
    defineFlatZones();
    buildHeights();
    buildSurface();
    buildTerrainMesh();
    buildSky();
    buildWater();
    buildLandmarks();
    for (const b of bridges) addDeck(b);
    // ---- traversal toys ----
    addRamp(126, 12, Math.PI, 10, 7, 3.2, 1.5);
    { const s = roadPoint('s3', 38); addRamp(s.x, s.z, Math.atan2(s.tx, s.tz), 7, 6, 1.8, 1.35); }
    addRamp(-8, 176, Math.PI, 9, 7, 2.6, 1.35);
    addRamp(60, -60, Math.PI / 2, 6, 6, 1.3, 1.3);
    { const s = roadPoint('halfdome', 26); addRamp(s.x, s.z, Math.atan2(s.tx, s.tz), 7, 6, 2, 1.35); }
    addRamp(-30, 44, -Math.PI / 2, 7, 6, 1.6, 1.35);
    { const s = roadPoint('glacier', 60); addRamp(s.x, s.z, Math.atan2(s.tx, s.tz), 6, 6, 1.2, 1.3); }
    // the flume: a long banked chute off the Glacier Point ridge
    addChute(28, 158, 66, 96, 8, 2.6);
    addBoostPad(30, 160, Math.atan2(38, -62));
    addRing(48, groundY(48, 126) + 6.5, 126, Math.atan2(38, -62), 3.4);
    // canyon gap on the s1 shortcut where it crosses the river
    { const s1 = roadsById.s1.samples;
      let ci = s1.findIndex((s, i) => i > 0 && (s1[i - 1].z - riverZ(s1[i - 1].x)) * (s.z - riverZ(s.x)) < 0);
      if (ci < 0) ci = Math.floor(s1.length / 2);
      const a = s1[Math.max(0, ci - 9)], b = s1[Math.min(s1.length - 1, ci + 9)];
      addRamp(a.x, a.z, Math.atan2(a.tx, a.tz), 8, 7, 2.6, 1.55);
      addRamp(b.x, b.z, Math.atan2(-b.tx, -b.tz), 8, 7, 2.6, 1.55);
      const m = s1[ci];
      addRing(m.x, groundY(m.x, m.z) + 7.5, m.z, Math.atan2(m.tx, m.tz), 3.6);
      const pre = s1[Math.max(0, ci - 16)]; addBoostPad(pre.x, pre.z, Math.atan2(pre.tx, pre.tz));
      place(V.arrowSign('BIG JUMP!'), pre.x + 4.5, pre.z, Math.atan2(pre.tz, pre.tx));
    }
    // hollow sequoia tunnel on the grove path
    logTunnel(-104, 70, 0.42, 24, 2.8);
    place(V.arrowSign('SHORTCUT'), -96, 78, 1.2);
    // rails
    { const s1 = roadsById.s1.samples; const cross = s1.find((s, i) => i > 0 && (s1[i - 1].z - riverZ(s1[i - 1].x)) * (s.z - riverZ(s.x)) < 0) || roadPoint('s1', 60);
      addRail(cross.x - 14, cross.z + 24, cross.x - 14, cross.z - 24, { log: true, ya: groundY(cross.x - 14, cross.z + 24) + 1.4, yb: groundY(cross.x - 14, cross.z - 24) + 1.4 }); }
    addRail(22, 50, 52, 56);
    chainRails([addRail(30, 170, 45, 146), addRail(45, 146, 58, 118), addRail(58, 118, 66, 96)]);
    addRail(-88, 72, -110, 60);
    addRail(70, -142, 40, -148);
    // boost pads
    for (const s of [95, 330, 600, 880, 1060]) { const p = roadPoint('loop', s); addBoostPad(p.x, p.z, Math.atan2(p.tx, p.tz)); }
    { const p = roadPoint('s2', 30); addBoostPad(p.x, p.z, Math.atan2(p.tx, p.tz)); }
    { const p = roadPoint('glacier', 20); addBoostPad(p.x, p.z, Math.atan2(p.tx, p.tz)); }
    buildBuildings();
    buildFences();
    // bouncy mushrooms in the meadows and along shortcuts
    const spots = [[52, -46], [58, -52], [-22, 8], [-26, 2], [92, -108], [-64, -66], [18, -100], [140, -60], [-130, 40], [-136, 46], [86, 30], [12, 128], [24, 132]];
    for (const [x, z] of spots) if (canPlace(x, z, 1.2)) addBouncer(x, z, 1.1 + rand() * 0.5);
    for (let i = 0, n = 0; i < 900 && n < 14; i++) { const x = (rand() - 0.5) * 300, z = (rand() - 0.5) * 300; if (!canPlace(x, z, 1.4)) continue; addBouncer(x, z, 1 + rand() * 0.6); n++; }
    // rings over the big ramps
    addRing(126, groundY(126, 4) + 6.2, 4, Math.PI, 3.2);
    addRing(-8, groundY(-8, 168) + 6.0, 168, Math.PI, 3.2);
    scatterTokens();
    buildVegetation();
    buildMinimap();
    marker = V.marker(); marker.visible = false; scene.add(marker);
    setTimeOfDay(0);
    return { scene, fx };
  }

  // ---------------- runtime ----------------
  let time = 0;
  function update(dt, playerPos, camera) {
    time += dt;
    for (const a of animated) a.update(dt, time);
    fx.update(dt);
    if (marker.visible) {
      const w = marker.userData.waffle;
      w.rotation.y += dt * 1.6; w.position.y = 4.5 + Math.sin(time * 2.4) * 0.5;
      const b = 1 + Math.sin(time * 4) * 0.06; w.scale.set(1.1 * b, 1.1 / b, 1.1 * b);
      marker.userData.ring.rotation.z += dt * 0.6;
      marker.userData.ring.scale.setScalar(1 + Math.sin(time * 3) * 0.06);
      marker.userData.beam.material.opacity = 0.18 + Math.sin(time * 3) * 0.06;
    }
    for (const b of bouncers) { b.squash = Math.max(0, b.squash - dt * 3.2); const s = 1 + Math.sin(b.squash * Math.PI) * 0.45; b.g.scale.set(b.scale * s, b.scale * (1 - Math.sin(b.squash * Math.PI) * 0.4), b.scale * s); }
    for (const r of rings) {
      r.g.rotation.z = Math.sin(time * 1.4 + r.x) * 0.12;
      const s = 1 + Math.sin(time * 3 + r.z) * 0.03;
      r.g.scale.setScalar(r.taken > 0 ? 1 + (1 - r.taken) * 0.6 : s);
      if (r.taken > 0) { r.taken = Math.max(0, r.taken - dt * 1.2); r.g.visible = r.taken < 0.02; }
    }
    for (const t of tokens) if (!t.taken) { t.g.rotation.y += dt * 2.4; t.g.position.y = t.y + Math.sin(time * 2.5 + t.x * 0.3) * 0.18; }
    if (customer) {
      const c = customer;
      const want = Math.atan2(playerPos.x - c.position.x, playerPos.z - c.position.z) - c.rotation.y;
      c.userData.head.rotation.y = U.clamp(U.angleDiff(0, want), -0.9, 0.9);
      c.position.y = c.userData.baseY + Math.abs(Math.sin(time * 3)) * 0.06;
    }
    sun.position.copy(playerPos).addScaledVector(sunDir, 110); sun.target.position.copy(playerPos); sun.target.updateMatrixWorld();
    if (camera) { sky.position.copy(camera.position); sunDisc.position.copy(camera.position).addScaledVector(sunDir, 800); sunDisc.lookAt(camera.position); }
    if (Math.random() < dt * 4) for (const c of chimneys) fx.spawn({ x: c.x, y: c.y, z: c.z, vy: 1.3, vx: 0.3, vz: 0.1, life: 2.6, size: 0.42, color: '#efe9df', gravity: -0.4, shrink: false });
  }
  function resetPickups() {
    for (const t of tokens) { t.taken = false; t.g.visible = true; }
    for (const r of rings) { r.taken = 0; r.g.visible = true; }
  }
  function setDelivery(destId) {
    const d = destId ? destinations[destId] : null;
    marker.visible = !!d;
    if (d) marker.position.set(d.x, d.y, d.z);
  }
  function spawnCustomer(order) {
    clearCustomer();
    const d = destinations[order.dest.id];
    customer = V.critter(order.customer.kind, order.customer.acc);
    place(customer, d.x + 3, d.z + 3, Math.PI * 0.8);
    customer.userData.baseY = customer.position.y;
  }
  function clearCustomer() { if (customer) { scene.remove(customer); customer = null; } }
  function respawnPoint(x, z) { let best = null, bd = 1e9; for (const s of roadSamples) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = s; } } return best; }
  const bounds = (x, z) => Math.abs(x) < 236 && Math.abs(z) < 236;

  return { SURF, WATER_Y, HOME, build, update, groundAt, groundY, terrainHeight, surfaceAt, slopeAt, normalAt, nearestRoad,
    nearbyColliders, nearbyFences, rails, overrides, padAt, bouncers, rings, tokens, resetPickups,
    destinations, setDelivery, spawnCustomer, clearCustomer, respawnPoint, bounds, riverZ, chanAt, setTimeOfDay,
    get fx() { return fx; }, get scene() { return scene; }, get time() { return time; }, get minimap() { return minimap; }, roadsById, roadPoint };
})();
