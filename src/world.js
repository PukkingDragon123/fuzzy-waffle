// Flippin' Waffles — Yosemitea valley: terrain, roads, props, colliders
window.FW = window.FW || {};

FW.World = (() => {
  const U = FW.U, P = FW.PAL, V = FW.Voxel;
  const SIZE = 480, HALF = 240, CELL = 2, N = SIZE / CELL, NV = N + 1;
  const heights = new Float32Array(NV * NV);
  const surface = new Uint8Array(N * N);
  const SURF = { GRASS: 0, ROAD: 1, DIRT: 2, SHOULDER: 3, LINE: 4, SAND: 5, WATER: 6, ROCK: 7, SNOW: 8 };
  const WATER_Y = -0.6;
  const rand = U.rng(20240);

  const roadSamples = [], roadHash = new Map(), RH = 8;
  const colliders = [], colHash = new Map(), CH = 12;
  const fences = [], fenceHash = new Map();
  const rails = [], overrides = [], boostPads = [], flatZones = [], bridges = [];
  const destinations = {};
  const animated = [];
  let scene, sun, hemi, sky, skyGeo, sunDisc, water, terrainMesh, fx, customer = null, marker = null, chimneys = [];
  const timeStops = [
    { zen: '#8fc7ee', hor: '#ffd9b3', sun: '#ffe4c4', sunI: 2.7, hemiSky: '#cfe7ff', hemiGnd: '#a8956a', fog: '#ffe0c0' },
    { zen: '#5fa8e6', hor: '#cfe9ff', sun: '#fff5e0', sunI: 3.0, hemiSky: '#d8ecff', hemiGnd: '#b0a070', fog: '#d6ecff' },
    { zen: '#6b5db3', hor: '#ffb27a', sun: '#ffb070', sunI: 2.4, hemiSky: '#e8c0ff', hemiGnd: '#9a7a5a', fog: '#ffc59a' },
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
    h += bump(x, z, 215, -105, 17, -3.2); // mirror lake pond
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
        ground.y = U.lerp(o.y0, o.y1, (u + o.len / 2) / o.len); ground.ov = o; ground.surf = o.kind === 'deck' ? SURF.ROAD : SURF.DIRT;
        return ground;
      }
    }
    ground.y = terrainHeight(x, z); ground.ov = null;
    let s = surfaceAt(x, z);
    if (ground.y < WATER_Y - 0.05) s = SURF.WATER;
    ground.surf = s;
    return ground;
  }
  function slopeAt(x, z) { const dx = (terrainHeight(x + 1, z) - terrainHeight(x - 1, z)) / 2, dz = (terrainHeight(x, z + 1) - terrainHeight(x, z - 1)) / 2; return Math.sqrt(dx * dx + dz * dz); }
  function normalAt(x, z, out) { const dx = (terrainHeight(x + 1, z) - terrainHeight(x - 1, z)) / 2, dz = (terrainHeight(x, z + 1) - terrainHeight(x, z - 1)) / 2; return out.set(-dx, 1, -dz).normalize(); }

  // ---------------- hashing ----------------
  const hkey = (cx, cz) => cx * 100000 + cz;
  function hashAdd(map, size, x, z, item) { const k = hkey(Math.floor(x / size), Math.floor(z / size)); if (!map.has(k)) map.set(k, []); map.get(k).push(item); }
  function hashQuery(map, size, x, z, out) { const cx = Math.floor(x / size), cz = Math.floor(z / size); out.length = 0; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = map.get(hkey(cx + i, cz + j)); if (l) for (const it of l) out.push(it); } return out; }
  const _q = [];
  function nearestRoad(x, z) {
    hashQuery(roadHash, RH, x, z, _q);
    let best = null, bd = 1e9;
    for (const s of _q) { const dx = s.x - x, dz = s.z - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = s; } }
    return { d: Math.sqrt(bd), s: best };
  }
  function nearbyColliders(x, z) { return hashQuery(colHash, CH, x, z, _q); }
  const _qf = [];
  function nearbyFences(x, z) { return hashQuery(fenceHash, CH, x, z, _qf); }

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
        const len = curve.getLength(); pts = curve.getSpacedPoints(Math.ceil(len / 2));
      }
      const samples = pts.map((p, i) => ({ x: p.x, z: p.z, y: baseHeight(p.x, p.z), type: r.type, road: r.id, s: i * 2, i }));
      // tangents
      for (let i = 0; i < samples.length; i++) {
        const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)];
        const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; samples[i].tx = dx / l; samples[i].tz = dz / l;
      }
      // bridges: paved roads crossing the river
      if (r.type === 'road') {
        for (let i = 1; i < samples.length; i++) {
          const a = samples[i - 1], b = samples[i];
          if ((a.z - riverZ(a.x)) * (b.z - riverZ(b.x)) < 0) {
            const lo = Math.max(0, i - 11), hi = Math.min(samples.length - 1, i + 11);
            const deckY = Math.max(baseHeight(samples[lo].x, samples[lo].z), baseHeight(samples[hi].x, samples[hi].z)) + 0.7;
            for (let k = lo; k <= hi; k++) samples[k].y = deckY;
            const yaw = Math.atan2(b.tx, b.tz);
            bridges.push({ cx: (a.x + b.x) / 2, cz: (a.z + b.z) / 2, yaw, y: deckY, len: 40, wid: 11 });
            i += 12;
          }
        }
      }
      // smooth heights along the road
      const w = 7, sm = samples.map((s, i) => { let acc = 0, n = 0; for (let k = -w; k <= w; k++) { let j = i + k; if (r.closed) j = (j + samples.length) % samples.length; else j = U.clamp(j, 0, samples.length - 1); acc += samples[j].y; n++; } return acc / n; });
      samples.forEach((s, i) => { s.y = sm[i]; });
      // road ends should meet the roads they branch from: handled by nearest-sample blending
      roadsById[r.id] = { def: r, samples, length: (samples.length - 1) * 2 };
      for (const s of samples) { roadSamples.push(s); hashAdd(roadHash, RH, s.x, s.z, s); }
    }
    // second pass: dirt spurs inherit the paved road height near junctions
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
  function cellColor(ix, iz, surf, h, slope, tri) {
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
    _col.multiplyScalar(0.965 + r * 0.07);
    return _col;
  }
  function buildTerrainMesh() {
    const tris = N * N * 2;
    const pos = new Float32Array(tris * 9), nor = new Float32Array(tris * 9), col = new Float32Array(tris * 9);
    let k = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    function tri(ax, ay, az, bx, by, bz, cx, cy, cz, color) {
      a.set(ax, ay, az); b.set(bx, by, bz); c.set(cx, cy, cz);
      n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
      if (n.y < 0) { const t = b.clone(); b.copy(c); c.copy(t); n.negate(); }
      for (const v of [a, b, c]) { pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z; nor[k] = n.x; nor[k + 1] = n.y; nor[k + 2] = n.z; col[k] = color.r; col[k + 1] = color.g; col[k + 2] = color.b; k += 3; }
    }
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const x0 = -HALF + ix * CELL, z0 = -HALF + iz * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
      const i = iz * NV + ix;
      const h00 = heights[i], h10 = heights[i + 1], h01 = heights[i + NV], h11 = heights[i + NV + 1];
      const surf = surface[iz * N + ix];
      const hm = (h00 + h10 + h01 + h11) / 4;
      const slope = Math.hypot((h10 - h00 + h11 - h01) / (2 * CELL), (h01 - h00 + h11 - h10) / (2 * CELL));
      tri(x0, h00, z0, x1, h10, z0, x0, h01, z1, cellColor(ix, iz, surf, hm, slope, 0));
      tri(x1, h10, z0, x1, h11, z1, x0, h01, z1, cellColor(ix, iz, surf, hm, slope, 1));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    terrainMesh = new THREE.Mesh(g, FW.Pixel.vmat());
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
  function place(obj, x, z, yaw = 0, scale = 1, yOff = 0) { obj.position.set(x, groundAt(x, z).y + yOff, z); obj.rotation.y = yaw; if (scale !== 1) obj.scale.setScalar(scale); scene.add(obj); return obj; }

  // ---------------- decor ----------------
  function buildVegetation() {
    const types = { pine: { geo: V.pineGeo(), m: [], r: 0.6, tint: 0.2 }, sequoia: { geo: V.sequoiaGeo(), m: [], r: 1.3, tint: 0.1 }, aspen: { geo: V.aspenGeo(false), m: [], r: 0.35, tint: 0.15 }, aspenGold: { geo: V.aspenGeo(true), m: [], r: 0.35, tint: 0.15 }, bush: { geo: V.bushGeo(), m: [], r: 0.7, tint: 0.15, noCol: true }, rock: { geo: V.rockGeo(), m: [], r: 1.0, tint: 0.1 }, flower: { geo: V.flowerGeo(), m: [], r: 0, tint: 0.05, noCol: true }, stump: { geo: V.stumpGeo(), m: [], r: 0.5, tint: 0.1 } };
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Pv = new THREE.Vector3();
    const add = (t, x, z, scale, yaw) => {
      const y = groundAt(x, z).y - 0.15;
      const e = types[t];
      const sq = t === 'rock' ? [0.7 + rand() * 0.7, 0.55 + rand() * 0.5, 0.7 + rand() * 0.7] : t === 'bush' ? [0.8 + rand() * 0.5, 0.7 + rand() * 0.5, 0.8 + rand() * 0.5] : [1, 1, 1];
      e.m.push({ x, y, z, scale, yaw, sx: scale * sq[0], sy: scale * sq[1], sz: scale * sq[2] });
      if (!e.noCol) addCollider(x, z, e.r * scale, t === 'rock' ? 'rock' : 'tree');
    };
    let trees = 0;
    for (let i = 0; i < 26000 && trees < 1500; i++) {
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
      const scale = t === 'sequoia' ? 1.6 + rand() * 0.9 : t === 'pine' ? 1.1 + rand() * 0.9 : 0.9 + rand() * 0.6;
      if (!canPlace(x, z, types[t].r * scale)) continue;
      add(t, x, z, scale, rand() * Math.PI * 2); trees++;
    }
    for (let i = 0, n = 0; i < 4000 && n < 320; i++) { const x = (rand() - 0.5) * 468, z = (rand() - 0.5) * 468; const s = surfaceAt(x, z); if (!(s === SURF.ROCK || (slopeAt(x, z) > 0.4 && rand() < 0.3) || rand() < 0.08)) continue; if (!canPlace(x, z, 1.2, true) || s === SURF.WATER) continue; add('rock', x, z, 0.5 + rand() * 1.1, rand() * 6.28); n++; }
    for (let i = 0, n = 0; i < 4000 && n < 320; i++) { const x = (rand() - 0.5) * 460, z = (rand() - 0.5) * 460; if (!canPlace(x, z, 0.8)) continue; add('bush', x, z, 0.7 + rand() * 0.8, rand() * 6.28); n++; }
    for (let i = 0, n = 0; i < 6000 && n < 700; i++) { const x = (rand() - 0.5) * 300, z = (rand() - 0.5) * 300; if (!canPlace(x, z, 0.2)) continue; add('flower', x, z, 0.8 + rand() * 0.8, rand() * 6.28); n++; }
    for (let i = 0, n = 0; i < 2000 && n < 60; i++) { const x = (rand() - 0.5) * 420, z = (rand() - 0.5) * 420; if (!canPlace(x, z, 0.6)) continue; add('stump', x, z, 0.8 + rand() * 0.6, rand() * 6.28); n++; }
    const tint = new THREE.Color();
    for (const [name, e] of Object.entries(types)) {
      if (!e.m.length) continue;
      const im = new THREE.InstancedMesh(e.geo, FW.Pixel.vmat(), e.m.length);
      im.castShadow = name !== 'flower'; im.receiveShadow = true;
      e.m.forEach((it, i) => {
        Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.yaw); S.set(it.sx, it.sy, it.sz); Pv.set(it.x, it.y, it.z);
        im.setMatrixAt(i, M.compose(Pv, Q, S));
        const v = 1 - e.tint / 2 + rand() * e.tint; tint.setRGB(v * (0.97 + rand() * 0.06), v, v * (0.97 + rand() * 0.06)); im.setColorAt(i, tint);
      });
      im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
      scene.add(im);
    }
  }

  // fences: polylines in world coords, split into 3 m segments
  const fenceGeo = V.fenceGeo(3);
  const fenceInstances = [];
  function fenceLine(pts) {
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 3));
      for (let k = 0; k < n; k++) {
        const x0 = U.lerp(ax, bx, k / n), z0 = U.lerp(az, bz, k / n), x1 = U.lerp(ax, bx, (k + 1) / n), z1 = U.lerp(az, bz, (k + 1) / n);
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const yaw = Math.atan2(-(z1 - z0), x1 - x0);
        const y = Math.min(groundAt(x0, z0).y, groundAt(x1, z1).y, groundAt(cx, cz).y);
        const seg = { ax: x0, az: z0, bx: x1, bz: z1, h: 0.95, y, cx, cz };
        fences.push(seg); hashAdd(fenceHash, CH, cx, cz, seg);
        fenceInstances.push({ x: cx, y: y - 0.05, z: cz, yaw, sx: Math.hypot(x1 - x0, z1 - z0) / 3 });
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
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Pv = new THREE.Vector3();
    const im = new THREE.InstancedMesh(fenceGeo, FW.Pixel.vmat(), fenceInstances.length);
    im.castShadow = true; im.receiveShadow = true;
    fenceInstances.forEach((f, i) => { Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw); S.set(f.sx, 1, 1); Pv.set(f.x, f.y, f.z); im.setMatrixAt(i, M.compose(Pv, Q, S)); });
    im.instanceMatrix.needsUpdate = true; scene.add(im);
  }

  // rails
  function addRail(ax, az, bx, bz, opts = {}) {
    let ya = groundAt(ax, az).y + (opts.lift || 1.0), yb = groundAt(bx, bz).y + (opts.lift || 1.0);
    if (opts.ya !== undefined) ya = opts.ya; if (opts.yb !== undefined) yb = opts.yb;
    // keep the rail above the ground along its length
    let raise = 0;
    for (let t = 0; t <= 1; t += 0.05) { const gy = groundAt(U.lerp(ax, bx, t), U.lerp(az, bz, t)).y; const ry = U.lerp(ya, yb, t); raise = Math.max(raise, gy + 0.8 - ry); }
    ya += raise; yb += raise;
    const rail = { ax, ay: ya, az, bx, by: yb, bz, len: Math.hypot(bx - ax, bz - az), log: !!opts.log };
    rail.dx = (bx - ax) / rail.len; rail.dz = (bz - az) / rail.len; rail.dy = (yb - ya) / rail.len;
    rails.push(rail);
    // mesh
    const g = new THREE.Group();
    const L = Math.hypot(bx - ax, yb - ya, bz - az);
    if (opts.log) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, L, 7), FW.Pixel.mat(P.trunk)); m.castShadow = true; m.rotation.x = Math.PI / 2; g.add(m);
      for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.9), FW.Pixel.mat(P.trunk)); s.position.set(i % 2 ? 0.4 : -0.4, -0.1, -L / 2 + 3 + i * (L - 6) / 2); s.rotation.y = 0.5; g.add(s); }
    } else {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, L), FW.Pixel.mat(P.steel)); bar.castShadow = true; g.add(bar);
      const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, L), FW.Pixel.mat(P.steel)); bar2.position.y = -0.45; g.add(bar2);
    }
    g.position.set((ax + bx) / 2, (ya + yb) / 2, (az + bz) / 2);
    g.lookAt(bx, yb, bz);
    scene.add(g);
    if (!opts.log) {
      const n = Math.max(2, Math.round(rail.len / 3));
      for (let i = 0; i <= n; i++) { const t = i / n; const x = U.lerp(ax, bx, t), z = U.lerp(az, bz, t), ry = U.lerp(ya, yb, t), gy = groundAt(x, z).y; const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, ry - gy + 0.1, 0.16), FW.Pixel.mat(P.wood)); post.position.set(x, (ry + gy) / 2 - 0.05, z); post.castShadow = true; scene.add(post); }
    } else {
      for (const [x, z, y] of [[ax, az, ya], [bx, bz, yb]]) { const gy = groundAt(x, z).y; const r = new THREE.Mesh(V.rockGeo(), FW.Pixel.vmat()); r.position.set(x, gy - 0.2, z); r.scale.setScalar(Math.max(0.6, (y - gy) * 0.9)); scene.add(r); }
    }
    return rail;
  }
  function chainRails(list) { for (let i = 0; i < list.length - 1; i++) list[i].next = list[i + 1]; }

  // ramps & decks (height overrides)
  function wedgeGeo(len, wid, h) {
    const hl = len / 2, hw = wid / 2;
    // local: u along +z (forward), v along x
    const v = [
      [-hw, 0, -hl], [hw, 0, -hl], [hw, 0, hl], [-hw, 0, hl], // bottom
      [hw, h, hl], [-hw, h, hl], // top back edge
    ];
    const faces = [[0, 1, 4, 5], [1, 2, 4], [0, 5, 3], [3, 5, 4, 2], [0, 3, 2, 1]];
    const cols = ['#a06a3c', '#8a5a33', '#8a5a33', '#6b4423', '#6b4423'];
    const pos = [], col = [], nor = [];
    const c = new THREE.Color();
    faces.forEach((f, fi) => {
      c.set(cols[fi]);
      const tris = f.length === 4 ? [[f[0], f[1], f[2]], [f[0], f[2], f[3]]] : [f];
      for (const t of tris) {
        const a = new THREE.Vector3(...v[t[0]]), b = new THREE.Vector3(...v[t[1]]), d = new THREE.Vector3(...v[t[2]]);
        const n = b.clone().sub(a).cross(d.clone().sub(a)).normalize();
        for (const p of [a, b, d]) { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); col.push(c.r, c.g, c.b); }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }
  const chevTex = FW.Pixel.chevronTexture();
  function addRamp(cx, cz, yaw, len, wid, h, kick = 1.3) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const sx = cx - fx * len / 2, sz = cz - fz * len / 2;
    const y0 = terrainHeight(sx, sz) + 0.05;
    const o = { cx, cz, yaw, len, wid, y0, y1: y0 + h, kind: 'ramp', kick, fx, fz, rx: fz, rz: -fx };
    overrides.push(o);
    const m = new THREE.Mesh(wedgeGeo(len, wid, h), FW.Pixel.vmat());
    m.castShadow = true; m.receiveShadow = true; m.position.set(cx, y0, cz); m.rotation.y = yaw; scene.add(m);
    // chevron stripe on the slope
    const slopeLen = Math.hypot(len, h);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(wid * 0.4, slopeLen * 0.8), new THREE.MeshBasicMaterial({ map: chevTex.clone(), transparent: true, opacity: 0.9 }));
    stripe.material.map.repeat.set(1, 3); stripe.material.map.needsUpdate = true;
    stripe.rotation.x = -Math.PI / 2 + Math.atan2(h, len); stripe.position.set(0, h / 2 + 0.03, 0);
    const holder = new THREE.Group(); holder.position.set(cx, y0, cz); holder.rotation.y = yaw; holder.add(stripe); scene.add(holder);
    animated.push({ update: (dt) => { stripe.material.map.offset.y -= dt * 0.8; } });
    return o;
  }
  function addDeck(b) {
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    const o = { cx: b.cx, cz: b.cz, yaw: b.yaw, len: b.len, wid: b.wid, y0: b.y, y1: b.y, kind: 'deck', fx, fz, rx: fz, rz: -fx };
    overrides.push(o);
    const g = new THREE.Group(); g.position.set(b.cx, b.y, b.cz); g.rotation.y = b.yaw;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(b.wid, 0.5, b.len), FW.Pixel.mat(P.wood)); deck.position.y = -0.25; deck.receiveShadow = true; deck.castShadow = true; g.add(deck);
    for (let i = 0; i < 6; i++) { const plank = new THREE.Mesh(new THREE.BoxGeometry(b.wid + 0.2, 0.08, 0.4), FW.Pixel.mat(P.wood2)); plank.position.set(0, 0.02, -b.len / 2 + 3 + i * (b.len - 6) / 5); g.add(plank); }
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) { const pier = new THREE.Mesh(new THREE.BoxGeometry(1.2, 6, 1.2), FW.Pixel.mat(P.granite[0])); pier.position.set(sx * (b.wid / 2 - 1), -3, -b.len / 2 + 5 + i * (b.len - 10) / 3); g.add(pier); }
    scene.add(g);
    // railings are grindable rails
    const rx = fz, rz = -fx;
    for (const side of [-1, 1]) {
      const ox = rx * side * (b.wid / 2 - 0.5), oz = rz * side * (b.wid / 2 - 0.5);
      addRail(b.cx + ox - fx * (b.len / 2 - 2), b.cz + oz - fz * (b.len / 2 - 2), b.cx + ox + fx * (b.len / 2 - 2), b.cz + oz + fz * (b.len / 2 - 2), { ya: b.y + 0.95, yb: b.y + 0.95 });
    }
  }
  function addBoostPad(x, z, yaw) {
    const pad = { cx: x, cz: z, yaw, len: 5, wid: 3.6, fx: Math.sin(yaw), fz: Math.cos(yaw) }; pad.rx = pad.fz; pad.rz = -pad.fx;
    boostPads.push(pad);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 5), new THREE.MeshBasicMaterial({ map: chevTex.clone() }));
    m.material.map.repeat.set(1, 2); m.material.map.needsUpdate = true;
    m.rotation.x = -Math.PI / 2; const holder = new THREE.Group(); holder.position.set(x, groundAt(x, z).y + 0.1, z); holder.rotation.y = yaw; holder.add(m); scene.add(holder);
    animated.push({ update: (dt) => { m.material.map.offset.y -= dt * 1.5; } });
  }
  function padAt(x, z) { for (const p of boostPads) { const dx = x - p.cx, dz = z - p.cz; const u = dx * p.fx + dz * p.fz, v = dx * p.rx + dz * p.rz; if (Math.abs(u) <= p.len / 2 && Math.abs(v) <= p.wid / 2) return p; } return null; }

  // ---------------- landmarks & sky ----------------
  function buildSky() {
    skyGeo = new THREE.SphereGeometry(900, 20, 10);
    const colors = new Float32Array(skyGeo.attributes.position.count * 3);
    skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10; scene.add(sky);
    sunDisc = new THREE.Mesh(new THREE.CircleGeometry(38, 10), new THREE.MeshBasicMaterial({ color: '#fff3c0', fog: false }));
    scene.add(sunDisc);
    sun = new THREE.DirectionalLight(0xffffff, 2.8);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 400;
    sun.shadow.bias = -0.0015; sun.shadow.normalBias = 0.06;
    scene.add(sun); scene.add(sun.target);
    hemi = new THREE.HemisphereLight(0xcfe7ff, 0xa8956a, 1.3); scene.add(hemi);
    scene.fog = new THREE.Fog(0xffe0c0, 140, 520);
    // clouds
    for (let i = 0; i < 18; i++) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) { const w = 6 + rand() * 10, h = 2.5 + rand() * 2.5, d = 5 + rand() * 6; const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), FW.Pixel.mat('#ffffff')); m.position.set((k - n / 2) * 5 + rand() * 3, rand() * 1.5, (rand() - 0.5) * 4); g.add(m); }
      g.position.set((rand() - 0.5) * 800, 95 + rand() * 60, (rand() - 0.5) * 800); g.scale.setScalar(1 + rand() * 1.5);
      scene.add(g);
      const speed = 1 + rand() * 1.5;
      animated.push({ update: (dt) => { g.position.x += speed * dt; if (g.position.x > 420) g.position.x = -420; } });
    }
  }
  function setTimeOfDay(t) {
    t = U.clamp(t, 0, 1);
    const i = t < 0.5 ? 0 : 1, f = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    const A = timeStops[i], Bst = timeStops[i + 1];
    const mix = (a, b) => new THREE.Color(a).lerp(new THREE.Color(b), f);
    const zen = mix(A.zen, Bst.zen), hor = mix(A.hor, Bst.hor);
    const pos = skyGeo.attributes.position, col = skyGeo.attributes.color; const c = new THREE.Color();
    for (let k = 0; k < pos.count; k++) { const ny = pos.getY(k) / 900; c.copy(hor).lerp(zen, U.smoothstep(-0.02, 0.45, ny)); if (ny < -0.02) c.copy(hor).multiplyScalar(0.92); col.setXYZ(k, c.r, c.g, c.b); }
    col.needsUpdate = true;
    sun.color.copy(mix(A.sun, Bst.sun)); sun.intensity = U.lerp(A.sunI, Bst.sunI, f);
    hemi.color.copy(mix(A.hemiSky, Bst.hemiSky)); hemi.groundColor.copy(mix(A.hemiGnd, Bst.hemiGnd));
    scene.fog.color.copy(mix(A.fog, Bst.fog));
    const ang = U.lerp(0.9, 2.3, t); // sun arc east→west
    sunDir.set(Math.cos(ang) * 0.8, U.lerp(0.55, 0.35, Math.abs(t - 0.5) * 2) + 0.3, Math.sin(ang) * 0.5 + 0.3).normalize();
  }
  const sunDir = new THREE.Vector3(0.5, 0.8, 0.4).normalize();

  function buildLandmarks() {
    const granite = FW.Pixel.mat('#b9b2a8');
    const facet = (g) => { const n = g.toNonIndexed(); n.computeVertexNormals(); return n; };
    // Half Dome
    const hd = new THREE.Group();
    const dome = new THREE.Mesh(facet(new THREE.SphereGeometry(52, 14, 10, 0, Math.PI)), granite); dome.scale.y = 1.5; hd.add(dome);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(52, 14), FW.Pixel.mat('#cfc8bd')); cap.scale.y = 1.5; cap.rotation.y = Math.PI; hd.add(cap);
    hd.position.set(212, baseHeight(212, -212) - 12, -212); hd.rotation.y = Math.PI * 0.75; scene.add(hd);
    // El Capitan
    const el = new THREE.Mesh(new THREE.BoxGeometry(64, 120, 90), granite); el.position.set(-228, baseHeight(-228, -150) + 40, -150); el.rotation.y = 0.2; scene.add(el);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(30, 90, 30), FW.Pixel.mat('#c4bdb3')); nose.position.set(-200, baseHeight(-200, -150) + 30, -150); nose.rotation.y = 0.6; scene.add(nose);
    // Cathedral spires
    for (const [x, z, h, w] of [[-212, 70, 60, 14], [-224, 92, 78, 12], [-206, 110, 52, 10], [222, 90, 66, 14], [206, 60, 44, 12]]) { const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), granite); s.position.set(x, baseHeight(x, z) + h / 2 - 10, z); s.rotation.y = rand(); scene.add(s); }
    // waterfalls
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
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }));
    scene.add(m);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(width * 1.1, 10), new THREE.MeshToonMaterial({ color: '#8fd0f0', gradientMap: FW.Pixel.gradientMap, transparent: true, opacity: 0.8 }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(x1 + (x1 > x0 ? 4 : -4), baseHeight(x1, z) + 0.35, z); scene.add(pool);
    animated.push({ update: (dt, t) => { tex.offset.y -= dt * 1.6; if (Math.random() < 0.3) fx.spawn({ x: pool.position.x + (Math.random() - 0.5) * 6, y: pool.position.y + 0.5, z: z + (Math.random() - 0.5) * 6, vy: 1.5 + Math.random(), vx: (Math.random() - 0.5), vz: (Math.random() - 0.5), life: 1.4, size: 0.5, color: '#ffffff', gravity: -0.3, shrink: false }); } });
  }

  // ---------------- destinations, buildings ----------------
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
    flatZones.push({ x: 215, z: -105, r: 1, y: baseHeight(215, -105) }); // pond keeps natural depth
  }
  function critterIdle(g, phase) { animated.push({ update: (dt, t) => { g.userData.head.rotation.y = Math.sin(t * 0.7 + phase) * 0.35; g.position.y = g.userData.baseY + Math.abs(Math.sin(t * 2.2 + phase)) * 0.04; } }); }
  function buildBuildings() {
    // home
    const shack = V.shack(); place(shack, 0, 55, 0); chimneys.push(shack.localToWorld(shack.userData.chimney.clone()));
    addCollider(0, 55, 4.2, 'building'); addCollider(-2.6, 55, 3.2, 'building'); addCollider(2.6, 55, 3.2, 'building');
    place(V.picnicTable(), 11, 52, 0.3); addCollider(11, 52, 1.2, 'prop');
    place(V.signpost('HOME SWEET WAFFLE'), -6, 66, 0.4); addCollider(-6, 66, 0.3, 'prop');
    for (const d of DEST_DEFS) {
      const g = groundAt(d.x, d.z).y;
      const sign = V.signpost(d.name.toUpperCase()); place(sign, d.x + 6, d.z + 5, -0.6); addCollider(d.x + 6, d.z + 5, 0.3, 'prop');
      switch (d.id) {
        case 'meadow': case 'halfdome': {
          const cols = [P.tent[0], P.tent[1], P.tent[2]];
          [[-7, -6, 0.8], [6, -7, -0.6], [8, 4, -2.2]].forEach(([ox, oz, yaw], i) => { place(V.tent(cols[i]), d.x + ox, d.z + oz, yaw); addCollider(d.x + ox, d.z + oz, 1.7, 'prop'); });
          const cf = V.campfire(); place(cf, d.x, d.z - 7, 0); addCollider(d.x, d.z - 7, 0.8, 'prop'); animated.push({ update: (dt, t) => cf.userData.flames.forEach((f, i) => { f.scale.y = 0.8 + 0.3 * Math.sin(t * 9 + i * 2); f.scale.x = 0.9 + 0.15 * Math.sin(t * 7 + i); }) });
          place(V.picnicTable(), d.x - 8, d.z + 5, 1.2); addCollider(d.x - 8, d.z + 5, 1.2, 'prop');
          break; }
        case 'glacier': {
          const deck = new THREE.Mesh(new THREE.BoxGeometry(12, 0.4, 8), FW.Pixel.mat(P.wood)); deck.position.set(d.x, g + 0.2, d.z - 6); deck.receiveShadow = true; scene.add(deck);
          fenceLine([[d.x - 6, d.z - 10], [d.x + 6, d.z - 10]]); fenceLine([[d.x - 6, d.z - 10], [d.x - 6, d.z - 2]]); fenceLine([[d.x + 6, d.z - 10], [d.x + 6, d.z - 2]]);
          place(V.picnicTable(), d.x - 7, d.z + 4, 0.2); addCollider(d.x - 7, d.z + 4, 1.2, 'prop');
          const scope = V.mesh([V.B(P.steel, 0, 0, 0, 1, 12, 1), V.B(P.brown, 0, 12, 0, 2, 2, 6), V.B(P.black, 0, 12.5, 3.2, 1.2, 1.2, 0.6)], 0.1); place(scope, d.x + 3, d.z - 8, Math.PI); addCollider(d.x + 3, d.z - 8, 0.4, 'prop');
          break; }
        case 'mirror': {
          place(V.cabin('#4f7d4a'), d.x - 6, d.z - 8, 0.4); addCollider(d.x - 6, d.z - 8, 3.2, 'building');
          place(V.cabin('#8a5a3c'), d.x + 8, d.z - 5, -0.5); addCollider(d.x + 8, d.z - 5, 3.2, 'building');
          const pond = new THREE.Mesh(new THREE.CircleGeometry(15, 14), new THREE.MeshToonMaterial({ color: '#7cc4ec', gradientMap: FW.Pixel.gradientMap, transparent: true, opacity: 0.82 })); pond.rotation.x = -Math.PI / 2; pond.position.set(215, baseHeight(215, -105) + 1.6, -105); scene.add(pond);
          const cf = V.campfire(); place(cf, d.x, d.z - 12, 0); addCollider(d.x, d.z - 12, 0.8, 'prop'); animated.push({ update: (dt, t) => cf.userData.flames.forEach((f, i) => { f.scale.y = 0.8 + 0.3 * Math.sin(t * 9 + i * 2); }) });
          break; }
        case 'ranger': {
          const rs = V.rangerStation(); place(rs, d.x, d.z - 10, 0); addCollider(d.x, d.z - 10, 4.2, 'building'); addCollider(d.x - 3, d.z - 10, 3, 'building'); addCollider(d.x + 3, d.z - 10, 3, 'building');
          place(V.picnicTable(), d.x - 9, d.z + 2, 0.1); addCollider(d.x - 9, d.z + 2, 1.2, 'prop');
          break; }
        case 'bridalveil': {
          place(V.picnicTable(), d.x - 5, d.z - 6, 0.3); addCollider(d.x - 5, d.z - 6, 1.2, 'prop');
          place(V.picnicTable(), d.x + 4, d.z - 8, -0.4); addCollider(d.x + 4, d.z - 8, 1.2, 'prop');
          break; }
        case 'sequoia': {
          const cb = V.cabin('#8a5a3c'); place(cb, d.x - 4, d.z - 8, 0.15); addCollider(d.x - 4, d.z - 8, 3.2, 'building'); chimneys.push(cb.localToWorld(cb.userData.chimney.clone()));
          const cf = V.campfire(); place(cf, d.x + 7, d.z - 4, 0); addCollider(d.x + 7, d.z - 4, 0.8, 'prop'); animated.push({ update: (dt, t) => cf.userData.flames.forEach((f, i) => { f.scale.y = 0.8 + 0.3 * Math.sin(t * 9 + i * 2); }) });
          break; }
      }
      // ambient critters hanging out
      if (rand() < 0.7) { const kinds = Object.keys(V.CRITTERS); const c = V.critter(kinds[Math.floor(rand() * kinds.length)]); place(c, d.x - 4 + rand() * 8, d.z + 8 + rand() * 3, Math.PI + (rand() - 0.5)); c.userData.baseY = c.position.y; critterIdle(c, rand() * 6); }
    }
  }

  // ---------------- water ----------------
  function buildWater() {
    water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshToonMaterial({ color: P.water, gradientMap: FW.Pixel.gradientMap, transparent: true, opacity: 0.74 }));
    water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y; water.receiveShadow = true; scene.add(water);
    animated.push({ update: (dt, t) => { water.position.y = WATER_Y + Math.sin(t * 1.3) * 0.05; } });
  }

  // ---------------- build ----------------
  function build(targetScene) {
    scene = targetScene;
    fx = new FW.Particles(scene, 700);
    buildRoads();
    defineFlatZones();
    buildHeights();
    buildSurface();
    buildTerrainMesh();
    buildSky();
    buildWater();
    buildLandmarks();
    for (const b of bridges) addDeck(b);
    // ramps
    addRamp(126, 12, Math.PI, 10, 7, 3.2, 1.45);
    { const s = roadPoint('s3', 38); addRamp(s.x, s.z, Math.atan2(s.tx, s.tz), 7, 6, 1.8, 1.3); }
    addRamp(-8, 176, Math.PI, 9, 7, 2.6, 1.3);
    addRamp(60, -60, Math.PI / 2, 6, 6, 1.3, 1.3);
    { const s = roadPoint('halfdome', 26); addRamp(s.x, s.z, Math.atan2(s.tx, s.tz), 7, 6, 2, 1.3); }
    addRamp(-30, 44, -Math.PI / 2, 7, 6, 1.6, 1.3);
    { const s = roadPoint('glacier', 60); addRamp(s.x, s.z, Math.atan2(s.tx, s.tz), 6, 6, 1.2, 1.3); }
    // rails
    { const s1 = roadsById.s1.samples; let cross = s1.find((s, i) => i > 0 && (s1[i - 1].z - riverZ(s1[i - 1].x)) * (s.z - riverZ(s.x)) < 0) || roadPoint('s1', 60); addRail(cross.x - 3, cross.z + 19, cross.x + 3, cross.z - 19, { log: true, ya: 1.3, yb: 1.3 }); }
    addRail(22, 50, 52, 56);
    chainRails([addRail(30, 170, 45, 146), addRail(45, 146, 58, 118), addRail(58, 118, 66, 96)]);
    addRail(-88, 72, -110, 60);
    addRail(70, -142, 40, -148);
    // boost pads on the loop
    for (const s of [95, 330, 600, 880, 1060]) { const p = roadPoint('loop', s); addBoostPad(p.x, p.z, Math.atan2(p.tx, p.tz)); }
    { const p = roadPoint('s2', 30); addBoostPad(p.x, p.z, Math.atan2(p.tx, p.tz)); }
    { const p = roadPoint('glacier', 20); addBoostPad(p.x, p.z, Math.atan2(p.tx, p.tz)); }
    buildBuildings();
    buildFences();
    buildVegetation();
    marker = V.marker(); marker.visible = false; scene.add(marker);
    setTimeOfDay(0);
    return { scene, fx };
  }

  // ---------------- runtime ----------------
  let time = 0;
  const _tmp = new THREE.Vector3();
  function update(dt, playerPos, camera) {
    time += dt;
    for (const a of animated) a.update(dt, time);
    fx.update(dt);
    if (marker.visible) { marker.userData.waffle.rotation.y += dt * 1.5; marker.userData.waffle.position.y = 5 + Math.sin(time * 2) * 0.4; marker.userData.ring.rotation.z += dt * 0.5; marker.userData.beam.material.opacity = 0.22 + Math.sin(time * 3) * 0.06; }
    if (customer) { customer.userData.head.rotation.y = Math.atan2(playerPos.x - customer.position.x, playerPos.z - customer.position.z) - customer.rotation.y; customer.userData.head.rotation.y = U.clamp(U.angleDiff(0, customer.userData.head.rotation.y), -0.8, 0.8); customer.position.y = customer.userData.baseY + Math.abs(Math.sin(time * 3)) * 0.05; }
    // sun follows player for crisp shadows
    sun.position.copy(playerPos).addScaledVector(sunDir, 120); sun.target.position.copy(playerPos); sun.target.updateMatrixWorld();
    if (camera) { sky.position.copy(camera.position); sunDisc.position.copy(camera.position).addScaledVector(sunDir, 800); sunDisc.lookAt(camera.position); }
    // chimney smoke
    if (Math.random() < dt * 4) for (const c of chimneys) fx.spawn({ x: c.x, y: c.y, z: c.z, vy: 1.2, vx: 0.3, vz: 0.1, life: 2.5, size: 0.5, color: '#e8e2d8', gravity: -0.4, shrink: false });
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
  function bounds(x, z) { return Math.abs(x) < 236 && Math.abs(z) < 236; }

  return { SURF, WATER_Y, HOME, build, update, groundAt, terrainHeight, surfaceAt, slopeAt, normalAt, nearestRoad, nearbyColliders, nearbyFences, rails, overrides, padAt, destinations, setDelivery, spawnCustomer, clearCustomer, respawnPoint, bounds, riverZ, chanAt, setTimeOfDay, get fx() { return fx; }, get scene() { return scene; }, get time() { return time; }, roadsById, roadPoint };
})();
