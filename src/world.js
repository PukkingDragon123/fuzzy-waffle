// Flippin' Waffles — Yosemite Valley, laid out to follow the real place:
// a long east-west trough with the Merced meandering down it, Northside and
// Southside Drive along the floor, granite walls north and south, and the
// landmarks roughly where a map puts them.
window.FW = window.FW || {};

FW.World = (() => {
  const U = FW.U, P = FW.PAL, V = FW.Models;
  const SIZE = 480, HALF = 240, CELL = 2, N = SIZE / CELL, NV = N + 1;
  const heights = new Float32Array(NV * NV);
  const surface = new Uint8Array(N * N);
  const SURF = { GRASS: 0, ROAD: 1, DIRT: 2, SHOULDER: 3, LINE: 4, SAND: 5, WATER: 6, ROCK: 7, SNOW: 8, WOOD: 9, FOREST: 10, EDGE: 11, JOINT: 12 };
  const WATER_Y = -0.9;
  const rand = U.rng(70141);

  const roadSamples = [], roadHash = new Map(), RH = 8;
  const colliders = [], colHash = new Map(), CH = 12;
  const fences = [], fenceHash = new Map();
  const rails = [], overrides = [], boostPads = [], flatZones = [], bridges = [];
  const bouncers = [], rings = [], tokens = [], traffic = [];
  const destinations = {};
  const animated = [];
  let scene, sun, fill, hemi, sky, skyGeo, sunDisc, water, terrainMesh, fx;
  let customer = null, marker = null, chimneys = [], minimap = null;

  const timeStops = [
    { zen: '#6ba0cf', hor: '#f0dcbe', sun: '#ffe6bf', sunI: 2.8, hemiSky: '#c6dcef', hemiGnd: '#7d7358', fog: '#d5dad6', amb: 0.95 },
    { zen: '#5490c9', hor: '#d6e4ec', sun: '#fff3dd', sunI: 3.0, hemiSky: '#cfe1f0', hemiGnd: '#877f62', fog: '#ccd8dc', amb: 1.08 },
    { zen: '#4a4573', hor: '#e8a475', sun: '#ffbd85', sunI: 2.2, hemiSky: '#c4b3d0', hemiGnd: '#5c5645', fog: '#d0ac93', amb: 0.82 },
  ];

  // ---------------- terrain ----------------
  // Merced River: meanders down the middle of the floor, flowing west
  const riverZ = (x) => -6 + 16 * Math.sin(x / 62) + 5 * Math.sin(x / 21);
  function bump(x, z, cx, cz, r, h) { const dx = x - cx, dz = z - cz; const d2 = (dx * dx + dz * dz) / (r * r); if (d2 >= 1) return 0; const t = 1 - d2; return h * t * t; }
  const chanAt = (x, z) => U.smoothstep(16, 6, Math.abs(z - riverZ(x)));
  // meadows: open grass, kept clear of forest
  const MEADOWS = [[-120, 12, 46], [-58, -18, 34], [12, -12, 44], [96, 20, 34], [150, -20, 28], [0, 62, 30], [-24, 70, 20], [54, 84, 22]];
  function meadowAt(x, z) { let m = 0; for (const [mx, mz, r] of MEADOWS) m = Math.max(m, U.smoothstep(r, r * 0.45, Math.hypot(x - mx, z - mz))); return m; }

  function baseHeight(x, z) {
    // valley floor, tilting down toward the west where the river leaves
    let h = 5.4 + (x / 220) * 2.6 + U.fbm(x * 0.012 + 4.1, z * 0.022 + 2.3, 3) * 1.7;
    // north and south granite walls
    const wz = Math.max(0, Math.abs(z) - 76);
    h += Math.pow(U.smoothstep(0, 98, wz), 1.45) * 210;
    h += U.smoothstep(0, 30, wz) * 10;                       // talus apron
    h += U.smoothstep(10, 70, wz) * U.fbm(x * 0.03, z * 0.03, 2) * 16;
    // the ends: Merced canyon west, Tenaya / Little Yosemite east
    h += U.smoothstep(178, 240, x) * 100;
    h += U.smoothstep(-186, -240, x) * 66 * (0.3 + 0.7 * U.smoothstep(24, 90, Math.abs(z)));
    // named shoulders on the walls
    h += bump(x, z, -140, 152, 74, 66);   // El Capitan
    h += bump(x, z, -62, 146, 52, 44);    // Three Brothers
    h += bump(x, z, 12, 150, 58, 56);     // Yosemite Point
    h += bump(x, z, 116, 146, 56, 46);    // North Dome / Royal Arches
    h += bump(x, z, 188, 132, 58, 74);    // Half Dome shoulder
    h += bump(x, z, -150, -142, 52, 52);  // Cathedral Rocks
    h += bump(x, z, -36, -136, 46, 48);   // Sentinel Rock
    h += bump(x, z, 88, -150, 64, 62);    // Glacier Point
    h += bump(x, z, 56, -196, 42, 40);    // Sentinel Dome
    h += bump(x, z, 186, 84, 18, -5);     // Mirror Lake basin
    // river channel
    const chan = chanAt(x, z);
    h = h * (1 - chan) + (-3.2 + (x / 220) * 1.9) * chan;
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

  // ---------------- the road network ----------------
  const ROADS = [
    { id: 'northside', name: 'Northside Dr', type: 'road', pts: [[172, 26], [150, 42], [112, 54], [70, 60], [30, 57], [-10, 51], [-52, 47], [-96, 41], [-140, 35], [-180, 27], [-209, 11]] },
    { id: 'southside', name: 'Southside Dr', type: 'road', pts: [[-209, -7], [-176, -25], [-136, -35], [-96, -41], [-56, -45], [-16, -47], [26, -45], [66, -41], [106, -45], [141, -47], [169, -31]] },
    { id: 'sentinel', name: 'Sentinel Bridge', type: 'road', pts: [[28, 57], [25, 22], [23, -12], [26, -45]] },
    { id: 'elcapbridge', name: 'El Capitan Bridge', type: 'road', pts: [[-124, 35], [-126, 6], [-128, -22], [-130, -35]] },
    { id: 'pohono', name: 'Pohono Bridge', type: 'road', pts: [[-209, 11], [-216, 2], [-209, -7]] },
    { id: 'happy', name: 'Happy Isles', type: 'road', pts: [[172, 26], [180, 4], [176, -14], [169, -31]] },
    { id: 'village', name: 'Village Dr', type: 'road', pts: [[70, 60], [64, 78], [52, 88]] },
    { id: 'curry', name: 'Curry Village', type: 'road', pts: [[141, -47], [146, -63], [134, -73]] },
    { id: 'camp4', name: 'Camp 4', type: 'road', pts: [[-10, 51], [-16, 65], [-26, 73]] },
    { id: 'home', name: 'Waffle Shack', type: 'road', pts: [[0, 54], [0, 66]] },
    { id: 'elcapmeadow', name: 'El Cap Meadow', type: 'dirt', pts: [[-140, 35], [-141, 20], [-138, 7]] },
    { id: 'mirror', name: 'Mirror Lake Rd', type: 'road', pts: [[180, 4], [192, 26], [193, 54], [187, 78]] },
    { id: 'glacierpt', name: 'Glacier Point Rd', type: 'road', pts: [[-96, -41], [-108, -70], [-82, -96], [-32, -113], [20, -129], [60, -141], [88, -149]] },
    { id: 'bridalveil', name: 'Bridalveil Fall', type: 'dirt', pts: [[-176, -25], [-187, -46], [-191, -62]] },
    // trails: dirt shortcuts
    { id: 'loopN', name: 'Valley Loop Trail', type: 'dirt', pts: [[-96, 41], [-62, 66], [-20, 70], [22, 67], [64, 68]] },
    { id: 'riverX', name: 'River Crossing', type: 'dirt', pts: [[-46, -45], [-42, -12], [-46, 18], [-52, 47]] },
    { id: 'fourmile', name: 'Four Mile Trail', type: 'dirt', pts: [[-30, -47], [-18, -72], [4, -92], [34, -112]] },
    { id: 'mist', name: 'Mist Trail', type: 'dirt', pts: [[169, -31], [186, -46], [197, -62]] },
    { id: 'ahwahnee', name: 'Ahwahnee Row', type: 'dirt', pts: [[112, 54], [116, 74], [104, 86]] },
  ];
  const roadsById = {};
  function buildRoads() {
    for (const r of ROADS) {
      let pts;
      if (r.pts.length === 2) {
        const [a, b] = r.pts, len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.ceil(len / 2));
        pts = []; for (let i = 0; i <= n; i++) pts.push(new THREE.Vector3(U.lerp(a[0], b[0], i / n), 0, U.lerp(a[1], b[1], i / n)));
      } else {
        const curve = new THREE.CatmullRomCurve3(r.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
        pts = curve.getSpacedPoints(Math.ceil(curve.getLength() / 2));
      }
      const samples = pts.map((q, i) => ({ x: q.x, z: q.z, y: baseHeight(q.x, q.z), type: r.type, road: r.id, s: i * 2, i }));
      for (let i = 0; i < samples.length; i++) {
        const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)];
        const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
        samples[i].tx = dx / l; samples[i].tz = dz / l;
      }
      // bridges where a paved road crosses the Merced
      if (r.type === 'road') {
        for (let i = 1; i < samples.length; i++) {
          const a = samples[i - 1], b = samples[i];
          if ((a.z - riverZ(a.x)) * (b.z - riverZ(b.x)) < 0) {
            const lo = Math.max(0, i - 10), hi = Math.min(samples.length - 1, i + 10);
            const deckY = Math.max(baseHeight(samples[lo].x, samples[lo].z), baseHeight(samples[hi].x, samples[hi].z)) + 1.1;
            for (let k = lo; k <= hi; k++) samples[k].y = deckY;
            bridges.push({ cx: (a.x + b.x) / 2, cz: (a.z + b.z) / 2, yaw: Math.atan2(b.tx, b.tz), y: deckY, len: 38, wid: 10, name: r.name });
            i += 11;
          }
        }
      }
      const w = 7, sm = samples.map((q, i) => { let acc = 0, n = 0; for (let k = -w; k <= w; k++) { const j = U.clamp(i + k, 0, samples.length - 1); acc += samples[j].y; n++; } return acc / n; });
      samples.forEach((q, i) => { q.y = sm[i]; });
      roadsById[r.id] = { def: r, samples, length: (samples.length - 1) * 2 };
      for (const q of samples) { roadSamples.push(q); hashAdd(roadHash, RH, q.x, q.z, q); }
    }
    // junctions: let spurs meet the road they branch from
    for (const q of roadSamples) if (q.type === 'dirt' || ['village', 'curry', 'camp4', 'home', 'mirror', 'glacierpt'].includes(q.road)) {
      hashQuery(roadHash, RH, q.x, q.z, _q);
      let best = null, bd = 1e9;
      for (const o of _q) if (o.road !== q.road && o.type === 'road') { const d = Math.hypot(o.x - q.x, o.z - q.z); if (d < bd) { bd = d; best = o; } }
      if (best && bd < 11) q.y = U.lerp(best.y, q.y, U.smoothstep(2, 11, bd));
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
        const R = s.type === 'road' ? 8 : 5;
        if (d < R) h = U.lerp(h, s.y, 1 - U.smoothstep(R - 4, R, d));
      }
      for (const f of flatZones) { const dd = Math.hypot(x - f.x, z - f.z); if (dd < f.r) h = U.lerp(f.y, h, U.smoothstep(f.r - 6, f.r, dd)); }
      heights[iz * NV + ix] = h;
    }
  }
  function buildSurface() {
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const x = -HALF + (ix + 0.5) * CELL, z = -HALF + (iz + 0.5) * CELL;
      const h = terrainHeight(x, z), slope = slopeAt(x, z);
      let t = SURF.GRASS;
      if (meadowAt(x, z) < 0.5 && Math.abs(z) > 24) t = SURF.FOREST;
      if (Math.abs(z) > 70) t = SURF.FOREST;
      if (h < WATER_Y + 0.5) t = SURF.SAND;
      if (h < WATER_Y - 0.05) t = SURF.WATER;
      if (slope > 0.8 && t !== SURF.WATER) t = SURF.ROCK;
      if (h > 150 && slope < 1.4) t = SURF.SNOW;
      const { d, s } = nearestRoad(x, z);
      if (s && t !== SURF.WATER) {
        if (s.type === 'road') {
          if (d < 4.5) {
            t = SURF.ROAD;
            if (s.s % 9 < 1.1) t = SURF.JOINT;                    // slab expansion joints
            if (d > 3.7) t = SURF.EDGE;                            // painted edge line
            if (d < 0.75 && s.s % 13 < 6.5) t = SURF.LINE;         // centre dashes
          } else if (d < 6.0) t = SURF.SHOULDER;
        } else if (d < 2.6) t = SURF.DIRT;
      }
      surface[iz * N + ix] = t;
    }
  }
  const _col = new THREE.Color();
  const FLOORC = { grass: ['#6aa84a', '#71ad50', '#7ab359', '#659f47'], forest: ['#3f6a48', '#46734f', '#3a6343', '#4c7a54'] };
  function cellColor(ix, iz, surf, h) {
    const r = U.hash2(ix * 3, iz * 7);
    let c;
    switch (surf) {
      case SURF.ROAD: c = P.road[Math.floor(r * 3)]; break;
      case SURF.JOINT: case SURF.EDGE: case SURF.LINE: c = P.road[Math.floor(r * 3)]; break;
      case SURF.DIRT: c = P.dirt[Math.floor(r * 3)]; break;
      case SURF.SHOULDER: c = P.shoulder; break;
      case SURF.SAND: c = P.sand; break;
      case SURF.WATER: c = P.riverbed; break;
      case SURF.ROCK: c = P.granite[Math.floor(r * 3)]; break;
      case SURF.SNOW: c = P.snow; break;
      case SURF.FOREST: c = FLOORC.forest[Math.floor(r * 4)]; break;
      default: c = FLOORC.grass[Math.floor(r * 4)];
    }
    _col.set(c);
    if (surf === SURF.FOREST || surf === SURF.GRASS) {
      if (h > 60) _col.lerp(new THREE.Color('#7d8a5c'), U.clamp((h - 60) / 90, 0, 0.65));
      if (h < 0.9) _col.lerp(new THREE.Color('#4f8a5c'), 0.35);
    }
    _col.multiplyScalar(0.985 + r * 0.03);
    return _col;
  }
  function vertNormal(ix, iz, out) {
    const hl = heights[iz * NV + Math.max(0, ix - 1)], hr = heights[iz * NV + Math.min(N, ix + 1)];
    const hd = heights[Math.max(0, iz - 1) * NV + ix], hu = heights[Math.min(N, iz + 1) * NV + ix];
    return out.set(-(hr - hl) / (2 * CELL), 1, -(hu - hd) / (2 * CELL)).normalize();
  }
  function buildTerrainMesh() {
    const tris = N * N * 2;
    const pos = new Float32Array(tris * 9), nor = new Float32Array(tris * 9), col = new Float32Array(tris * 9), uv = new Float32Array(tris * 6);
    let k = 0, k2 = 0;
    const n = new THREE.Vector3();
    const put = (x, y, z, ix, iz, c) => {
      vertNormal(ix, iz, n);
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      nor[k] = n.x; nor[k + 1] = n.y; nor[k + 2] = n.z;
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      uv[k2] = x / 7; uv[k2 + 1] = z / 7;
      k += 3; k2 += 2;
    };
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const x0 = -HALF + ix * CELL, z0 = -HALF + iz * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
      const i = iz * NV + ix;
      const h00 = heights[i], h10 = heights[i + 1], h01 = heights[i + NV], h11 = heights[i + NV + 1];
      const c = cellColor(ix, iz, surface[iz * N + ix], (h00 + h10 + h01 + h11) / 4);
      put(x0, h00, z0, ix, iz, c); put(x0, h01, z1, ix, iz + 1, c); put(x1, h10, z0, ix + 1, iz, c);
      put(x1, h10, z0, ix + 1, iz, c); put(x0, h01, z1, ix, iz + 1, c); put(x1, h11, z1, ix + 1, iz + 1, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    terrainMesh = new THREE.Mesh(g, FW.Pixel.vmat({ roughness: 0.98, map: FW.Pixel.groundDetail(), envMapIntensity: 0.35 }));
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);
  }

  // ---------------- placement ----------------
  function canPlace(x, z, r, allowRock = false) {
    if (Math.abs(x) > 234 || Math.abs(z) > 234) return false;
    const s = surfaceAt(x, z);
    if (s === SURF.WATER || s === SURF.SAND) return false;
    if (!allowRock && (s === SURF.ROCK || s === SURF.SNOW)) return false;
    if (s === SURF.ROAD || s === SURF.LINE || s === SURF.SHOULDER || s === SURF.DIRT) return false;
    const { d, s: rs } = nearestRoad(x, z);
    if (rs && d < r + (rs.type === 'road' ? 8.5 : 4)) return false;
    for (const f of flatZones) if (Math.hypot(x - f.x, z - f.z) < f.r + r) return false;
    for (const o of overrides) if (Math.hypot(x - o.cx, z - o.cz) < o.len / 2 + r + 2) return false;
    if (!allowRock && slopeAt(x, z) > 1.05) return false;
    return true;
  }
  function addCollider(x, z, r, kind = 'solid', extra = {}) { const c = Object.assign({ x, z, r, kind }, extra); colliders.push(c); hashAdd(colHash, CH, x, z, c); return c; }
  function place(obj, x, z, yaw = 0, scale = 1, yOff = 0) { obj.position.set(x, groundY(x, z) + yOff, z); obj.rotation.y = yaw; if (scale !== 1) obj.scale.setScalar(scale); scene.add(obj); return obj; }

  // ---------------- forest ----------------
  // Instances are bucketed into a 4x4 grid so the camera and the shadow pass
  // can cull most of the forest instead of drawing every tree every frame.
  const GRID = 6;
  function buildForest() {
    const LEAF = 'leafy';
    const types = {
      fir: { geo: V.firGeo(), r: 1.0, sc: [0.72, 1.5], tint: 0.24, m: LEAF },
      pine: { geo: V.pineGeo(), r: 1.0, sc: [0.75, 1.4], tint: 0.2, m: LEAF },
      cedar: { geo: V.cedarGeo(), r: 0.95, sc: [0.7, 1.3], tint: 0.24, m: LEAF },
      sequoia: { geo: V.sequoiaGeo(), r: 1.9, sc: [0.85, 1.35], tint: 0.14, m: LEAF },
      oak: { geo: V.oakGeo(false), r: 1.5, sc: [0.8, 1.35], tint: 0.2, m: LEAF },
      oakGold: { geo: V.oakGeo(true), r: 1.5, sc: [0.8, 1.3], tint: 0.2, m: LEAF },
      snag: { geo: V.snagGeo(), r: 0.7, sc: [0.8, 1.3], tint: 0.16, m: LEAF },
      deadfall: { geo: V.deadfallGeo(), r: 1.1, sc: [0.8, 1.4], tint: 0.16, flat: true, m: LEAF },
      stump: { geo: V.stumpGeo(), r: 0.55, sc: [0.8, 1.3], tint: 0.14 },
      fern: { geo: V.fernGeo(), r: 0, sc: [0.8, 1.6], tint: 0.3, noCol: true, noShadow: true, m: LEAF },
      grass: { geo: V.grassGeo(), r: 0, sc: [0.7, 1.8], tint: 0.34, noCol: true, noShadow: true, m: LEAF },
      bush: { geo: V.bushGeo(), r: 0.7, sc: [0.8, 1.5], tint: 0.26, noCol: true, m: LEAF },
      rock: { geo: V.rockGeo(), r: 0.95, sc: [0.6, 1.9], tint: 0.12 },
      flower: { geo: V.flowerGeo(), r: 0, sc: [0.8, 1.7], tint: 0.14, noCol: true, noShadow: true, m: LEAF },
    };
    for (const t of Object.values(types)) t.buckets = Array.from({ length: GRID * GRID }, () => []);
    const bucketOf = (x, z) => U.clamp(Math.floor((z + HALF) / SIZE * GRID), 0, GRID - 1) * GRID + U.clamp(Math.floor((x + HALF) / SIZE * GRID), 0, GRID - 1);
    const add = (t, x, z, scale, yaw) => {
      const e = types[t];
      const y = groundY(x, z) - (e.flat ? 0.05 : 0.15);
      const sq = t === 'rock' ? [0.8 + rand() * 0.7, 0.6 + rand() * 0.5, 0.8 + rand() * 0.7] : [1, 1, 1];
      e.buckets[bucketOf(x, z)].push({ x, y, z, yaw, sx: scale * sq[0], sy: scale * sq[1], sz: scale * sq[2] });
      if (!e.noCol) addCollider(x, z, e.r * scale * (t === 'deadfall' ? 1.6 : 1), t === 'rock' ? 'rock' : 'tree');
    };
    const pick = (t) => U.lerp(types[t].sc[0], types[t].sc[1], rand());
    // Placement walks a jittered grid instead of rejection-sampling the map,
    // which is what a quarter of a million random probes used to cost.
    const gridPass = (step, jitter, fn) => {
      for (let z = -232; z <= 232; z += step) for (let x = -232; x <= 232; x += step) fn(x + (rand() - 0.5) * jitter, z + (rand() - 0.5) * jitter);
    };
    const roadClear = (x, z, pave, trail) => { const { d, s: rs } = nearestRoad(x, z); return !rs || d > (rs.type === 'road' ? pave : trail); };
    const openGround = (x, z) => {
      const sf = surfaceAt(x, z);
      return sf !== SURF.WATER && sf !== SURF.SAND && sf !== SURF.SNOW && sf !== SURF.ROCK &&
        sf !== SURF.ROAD && sf !== SURF.LINE && sf !== SURF.EDGE && sf !== SURF.JOINT && sf !== SURF.SHOULDER && sf !== SURF.DIRT;
    };
    // --- canopy ---
    let trees = 0;
    gridPass(5.4, 4.6, (x, z) => {
      const az = Math.abs(z), h = terrainHeight(x, z), meadow = meadowAt(x, z);
      let dens = 0.92;
      if (meadow > 0.4) dens = 0.05;
      else if (az < 26) dens = 0.45;
      if (h > 150) dens *= 0.12; else if (h > 110) dens *= 0.5;
      if (rand() > dens) return;
      let t;
      const r0 = rand();
      if (h > 40 && az > 70) t = r0 < 0.62 ? 'fir' : r0 < 0.86 ? 'cedar' : 'pine';
      else if (az < 34 && h < 20) t = r0 < 0.4 ? 'oak' : r0 < 0.55 ? 'oakGold' : r0 < 0.8 ? 'pine' : 'fir';
      else t = r0 < 0.5 ? 'fir' : r0 < 0.72 ? 'pine' : r0 < 0.9 ? 'cedar' : 'oak';
      const scale = pick(t);
      if (!canPlace(x, z, types[t].r * scale * 0.5)) return;
      add(t, x, z, scale, rand() * Math.PI * 2); trees++;
    });
    // giant sequoia grove on the south-west bench
    for (let i = 0, n = 0; i < 900 && n < 40; i++) {
      const x = -168 + (rand() - 0.5) * 60, z = -96 + (rand() - 0.5) * 54, sc = pick('sequoia');
      if (!canPlace(x, z, 2.4 * sc)) continue;
      add('sequoia', x, z, sc, rand() * 6.28); n++;
    }
    // --- understory and detail ---
    gridPass(11, 9, (x, z) => {
      const az = Math.abs(z), r0 = rand();
      if (r0 < 0.2 && az > 30) { const sc = pick('snag'); if (canPlace(x, z, 0.4 * sc)) add('snag', x, z, sc, rand() * 6.28); }
      else if (r0 < 0.42 && az > 26) { const sc = pick('deadfall'); if (canPlace(x, z, 0.7 * sc)) add('deadfall', x, z, sc, rand() * 6.28); }
      else if (r0 < 0.52) { const sc = pick('stump'); if (canPlace(x, z, 0.35 * sc)) add('stump', x, z, sc, rand() * 6.28); }
      else if (r0 < 0.78) { const sc = pick('bush'); if (canPlace(x, z, 0.45 * sc)) add('bush', x, z, sc, rand() * 6.28); }
      else { const sc = pick('rock'); if (canPlace(x, z, 0.6 * sc, true) && (surfaceAt(x, z) === SURF.ROCK || rand() < 0.3)) add('rock', x, z, sc, rand() * 6.28); }
    });
    // scree and talus conifers on the walls
    gridPass(9, 8, (x, z) => {
      const az = Math.abs(z);
      if (az < 72 || az > 152) return;
      if (rand() < 0.5) { const sc = 0.5 + rand() * 1.6; if (canPlace(x, z, 0.7 * sc, true)) add('rock', x, z, sc, rand() * 6.28); }
      else if (az < 110 && slopeAt(x, z) < 1.5) { const t = rand() < 0.62 ? 'fir' : 'cedar', sc = pick(t) * 0.85; if (canPlace(x, z, types[t].r * sc * 0.45, true)) add(t, x, z, sc, rand() * 6.28); }
    });
    // --- ground cover: ferns in the forest, grass and flowers everywhere else ---
    gridPass(3.3, 2.9, (x, z) => {
      if (!openGround(x, z)) return;
      const { d, s: rs } = nearestRoad(x, z);
      const near = rs ? d : 999;
      if (near < (rs && rs.type === 'road' ? 6.4 : 3.2)) return;
      const sf = surfaceAt(x, z), meadow = meadowAt(x, z);
      const want = near < 26 ? 0.9 : meadow > 0.3 ? 0.72 : sf === SURF.FOREST ? 0.5 : 0.34;
      if (rand() > want) return;
      if (sf === SURF.FOREST && rand() < 0.34) add('fern', x, z, pick('fern'), rand() * 6.28);
      else if (meadow > 0.35 && rand() < 0.1) add('flower', x, z, pick('flower'), rand() * 6.28);
      else add('grass', x, z, pick('grass'), rand() * 6.28);
    });
    // build the instanced meshes
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Pv = new THREE.Vector3(), AX = new THREE.Vector3(0, 1, 0), tint = new THREE.Color();
    let count = 0;
    for (const [name, e] of Object.entries(types)) {
      for (const list of e.buckets) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(e.geo, e.m ? FW.Pixel.fam(e.m) : FW.Pixel.vmat({ roughness: 0.96 }), list.length);
        im.castShadow = !e.noShadow; im.receiveShadow = true;
        list.forEach((it, i) => {
          Q.setFromAxisAngle(AX, it.yaw); S.set(it.sx, it.sy, it.sz); Pv.set(it.x, it.y, it.z);
          im.setMatrixAt(i, M.compose(Pv, Q, S));
          const v = 1 - e.tint / 2 + rand() * e.tint;
          tint.setRGB(v * (0.96 + rand() * 0.08), v, v * (0.95 + rand() * 0.07));
          im.setColorAt(i, tint);
        });
        im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        scene.add(im); count += list.length;
      }
    }
    return count;
  }

  // ---------------- fences & steel guardrails ----------------
  const fenceInstances = [], railInstances = [];
  function barrier(pts, steel) {
    const seg = steel ? 4 : 3;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / seg));
      for (let k = 0; k < n; k++) {
        const x0 = U.lerp(ax, bx, k / n), z0 = U.lerp(az, bz, k / n), x1 = U.lerp(ax, bx, (k + 1) / n), z1 = U.lerp(az, bz, (k + 1) / n);
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const y = Math.min(groundY(x0, z0), groundY(x1, z1), groundY(cx, cz));
        const s = { ax: x0, az: z0, bx: x1, bz: z1, h: steel ? 0.95 : 1.0, y, cx, cz };
        fences.push(s); hashAdd(fenceHash, CH, cx, cz, s);
        const inst = { x: cx, y: y - 0.04, z: cz, yaw: Math.atan2(-(z1 - z0), x1 - x0), sx: Math.hypot(x1 - x0, z1 - z0) / seg };
        (steel ? railInstances : fenceInstances).push(inst);
      }
      // steel guardrails are grindable
      if (steel && len > 9) rails.push(makeRail(ax, az, bx, bz, groundY(ax, az) + 0.78, groundY(bx, bz) + 0.78, true));
    }
  }
  // guardrail along one side of a road stretch
  function guardrail(roadId, from, to, side) {
    const r = roadsById[roadId], pts = [];
    for (let s = from; s <= to; s += 6) {
      const q = r.samples[U.clamp(Math.round(s / 2), 0, r.samples.length - 1)];
      pts.push([q.x - q.tz * side * 6.4, q.z + q.tx * side * 6.4]);
    }
    if (pts.length > 1) barrier(pts, true);
  }
  function gateAcross(roadId, sMeters, width) {
    const q = roadPoint(roadId, sMeters);
    barrier([[q.x + q.tz * width / 2, q.z - q.tx * width / 2], [q.x - q.tz * width / 2, q.z + q.tx * width / 2]], false);
  }
  function buildBarriers() {
    // guardrails on the river side of both valley drives, and on the mountain road
    guardrail('northside', 40, 150, -1);
    guardrail('northside', 260, 380, -1);
    guardrail('southside', 60, 180, 1);
    guardrail('southside', 300, 420, 1);
    guardrail('glacierpt', 30, 120, -1);
    guardrail('glacierpt', 190, 300, -1);
    guardrail('mirror', 20, 90, 1);
    // camp fences
    barrier([[-9, 52], [-9, 68]], false); barrier([[9, 52], [9, 68]], false); barrier([[-9, 52], [9, 52]], false);
    barrier([[40, 74], [60, 82]], false); barrier([[126, -64], [146, -70]], false);
    gateAcross('loopN', 20, 9); gateAcross('loopN', roadsById.loopN.length - 22, 9);
    gateAcross('riverX', 18, 9); gateAcross('fourmile', 24, 9);
    gateAcross('ahwahnee', 16, 9);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Pv = new THREE.Vector3(), AX = new THREE.Vector3(0, 1, 0);
    const mk = (list, geo) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, FW.Pixel.vmat(), list.length);
      im.castShadow = true; im.receiveShadow = true;
      list.forEach((f, i) => { Q.setFromAxisAngle(AX, f.yaw); S.set(f.sx, 1, 1); Pv.set(f.x, f.y, f.z); im.setMatrixAt(i, M.compose(Pv, Q, S)); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); scene.add(im);
    };
    mk(fenceInstances, V.fenceGeo(3));
    mk(railInstances, V.guardrailGeo(4));
  }

  // ---------------- rails ----------------
  function makeRail(ax, az, bx, bz, ya, yb, quiet) {
    const rail = { ax, ay: ya, az, bx, by: yb, bz, len: Math.hypot(bx - ax, bz - az) };
    rail.dx = (bx - ax) / rail.len; rail.dz = (bz - az) / rail.len; rail.dy = (yb - ya) / rail.len;
    return rail;
  }
  function addRail(ax, az, bx, bz, opts = {}) {
    let ya = groundY(ax, az) + (opts.lift || 1.0), yb = groundY(bx, bz) + (opts.lift || 1.0);
    if (opts.ya !== undefined) ya = opts.ya; if (opts.yb !== undefined) yb = opts.yb;
    let raise = 0;
    for (let t = 0; t <= 1; t += 0.05) { const gy = groundY(U.lerp(ax, bx, t), U.lerp(az, bz, t)); raise = Math.max(raise, gy + 0.8 - U.lerp(ya, yb, t)); }
    ya += raise; yb += raise;
    const rail = makeRail(ax, az, bx, bz, ya, yb);
    rail.log = !!opts.log;
    rails.push(rail);
    const g = new THREE.Group();
    const L = Math.hypot(bx - ax, yb - ya, bz - az);
    if (opts.log) {
      const m = new THREE.Mesh(V.cyl(0.36, 0.42, L, 10), FW.Pixel.mat('#4a3a2e')); m.castShadow = true; m.rotation.x = Math.PI / 2; g.add(m);
      for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(V.sphere(0.2, 7, 5), FW.Pixel.mat('#2f6246')); s.position.set(i % 2 ? 0.32 : -0.32, 0.18, -L / 2 + 2 + i * (L - 4) / 3); s.scale.set(1.4, 0.5, 1.4); g.add(s); }
    } else {
      const bar = new THREE.Mesh(V.capsule(0.08, L), FW.Pixel.mat('#b8bec9', { roughness: 0.26, metalness: 0.9, envMapIntensity: 1.2 })); bar.rotation.x = Math.PI / 2; bar.castShadow = true; g.add(bar);
      const bar2 = new THREE.Mesh(V.capsule(0.05, L), FW.Pixel.mat('#98a0ac', { roughness: 0.3, metalness: 0.8 })); bar2.rotation.x = Math.PI / 2; bar2.position.y = -0.45; g.add(bar2);
    }
    g.position.set((ax + bx) / 2, (ya + yb) / 2, (az + bz) / 2);
    g.lookAt(bx, yb, bz);
    scene.add(g);
    if (!opts.log) {
      const n = Math.max(2, Math.round(rail.len / 3));
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = U.lerp(ax, bx, t), z = U.lerp(az, bz, t), ry = U.lerp(ya, yb, t), gy = groundY(x, z);
        const post = new THREE.Mesh(V.capsule(0.08, Math.max(0.1, ry - gy - 0.1)), FW.Pixel.mat('#8d949f', { metalness: 0.7, roughness: 0.35 }));
        post.position.set(x, (ry + gy) / 2, z); post.castShadow = true; scene.add(post);
      }
    } else {
      for (const [x, z, y] of [[ax, az, ya], [bx, bz, yb]]) { const gy = groundY(x, z); const r = new THREE.Mesh(V.rockGeo(), FW.Pixel.vmat()); r.position.set(x, gy - 0.2, z); r.scale.setScalar(Math.max(0.6, (y - gy) * 0.85)); r.castShadow = true; scene.add(r); }
    }
    return rail;
  }
  function chainRails(list) { for (let i = 0; i < list.length - 1; i++) list[i].next = list[i + 1]; }

  // ---------------- ramps, decks, chute, pads ----------------
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
    const y0 = terrainHeight(cx - fx * len / 2, cz - fz * len / 2) + 0.05;
    const o = { cx, cz, yaw, len, wid, y0, y1: y0 + h, kind: 'ramp', kick, fx, fz, rx: fz, rz: -fx, surf: SURF.WOOD };
    overrides.push(o);
    const m = new THREE.Mesh(wedgeGeo(len, wid, h), FW.Pixel.vmat({ roughness: 0.85 }));
    m.castShadow = true; m.receiveShadow = true; m.position.set(cx, y0, cz); m.rotation.y = yaw; scene.add(m);
    const slopeLen = Math.hypot(len, h);
    const holder = new THREE.Group(); holder.position.set(cx, y0, cz); holder.rotation.y = yaw; scene.add(holder);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(wid * 0.45, slopeLen * 0.82), new THREE.MeshBasicMaterial({ map: chevTex.clone(), transparent: true, opacity: 0.95, toneMapped: false }));
    stripe.material.map.repeat.set(1, 3); stripe.material.map.needsUpdate = true;
    stripe.rotation.x = -Math.PI / 2 + Math.atan2(h, len); stripe.position.set(0, h / 2 + 0.04, 0); holder.add(stripe);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(V.capsule(0.13, slopeLen * 0.95), FW.Pixel.mat('#96663a'));
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
    const deck = new THREE.Mesh(V.roundedBox(b.wid, 0.5, b.len, 0.16), FW.Pixel.mat('#9a9186')); deck.position.y = -0.25; deck.receiveShadow = true; deck.castShadow = true; g.add(deck);
    // stone arch parapets, the way the valley bridges are built
    for (const sx of [-1, 1]) {
      const par = new THREE.Mesh(V.roundedBox(0.5, 0.62, b.len, 0.16), FW.Pixel.mat(P.granite[0]));
      par.position.set(sx * (b.wid / 2 - 0.2), 0.3, 0); par.castShadow = true; g.add(par);
    }
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      const pier = new THREE.Mesh(V.cyl(0.7, 0.9, 7, 10), FW.Pixel.mat(P.granite[1]));
      pier.position.set(sx * (b.wid / 2 - 1), -3.6, -b.len / 2 + 7 + i * (b.len - 14) / 2); pier.castShadow = true; g.add(pier);
    }
    scene.add(g);
    const rx = fz, rz = -fx;
    for (const side of [-1, 1]) {
      const ox = rx * side * (b.wid / 2 - 0.2), oz = rz * side * (b.wid / 2 - 0.2);
      addRail(b.cx + ox - fx * (b.len / 2 - 2), b.cz + oz - fz * (b.len / 2 - 2), b.cx + ox + fx * (b.len / 2 - 2), b.cz + oz + fz * (b.len / 2 - 2), { ya: b.y + 0.72, yb: b.y + 0.72 });
    }
  }
  function addChute(ax, az, bx, bz, wid, bank) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz), fx = dx / len, fz = dz / len;
    const y0 = terrainHeight(ax, az) + 0.3, y1 = terrainHeight(bx, bz) + 0.3;
    const o = { cx: (ax + bx) / 2, cz: (az + bz) / 2, yaw, len, wid, y0, y1, kind: 'chute', fx, fz, rx: fz, rz: -fx, bank, surf: SURF.WOOD, kick: 1.25 };
    overrides.push(o);
    const SEG = 58, CROSS = 7;
    const at = (u, v) => {
      const y = U.lerp(y0, y1, u + 0.5) + bank * v * v;
      return [o.cx + fx * (u * len) + o.rx * (v * wid / 2), y, o.cz + fz * (u * len) + o.rz * (v * wid / 2)];
    };
    const pos = [], nor = [], col = [], c = new THREE.Color();
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
    { // chevron guide stripe down the middle
      const sp = [], su = [], idx = [];
      for (let i = 0; i <= SEG; i++) { const u = -0.5 + i / SEG, a = at(u, -0.15), b = at(u, 0.15); sp.push(a[0], a[1] + 0.06, a[2], b[0], b[1] + 0.06, b[2]); su.push(0, i * 0.9, 1, i * 0.9); }
      for (let i = 0; i < SEG; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2)); sg.setIndex(idx); sg.computeVertexNormals();
      const tex = chevTex.clone(); tex.needsUpdate = true;
      const sm = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.8, side: THREE.DoubleSide, toneMapped: false }));
      scene.add(sm);
      animated.push({ update: (dt) => { tex.offset.y -= dt * 1.1; } });
    }
    for (const side of [-1, 1]) for (let i = 0; i <= 18; i++) {
      const [x, y, z] = at(-0.5 + i / 18, side * 1.0);
      const gy = terrainHeight(x, z);
      const post = new THREE.Mesh(V.capsule(0.14, Math.max(0.2, y - gy)), FW.Pixel.mat('#96663a'));
      post.position.set(x, (y + gy) / 2, z); post.castShadow = true; scene.add(post);
      const lip = new THREE.Mesh(V.sphere(0.3, 9, 7), FW.Pixel.mat('#e5564a'));
      lip.position.set(x, y + 0.16, z); lip.castShadow = true; scene.add(lip);
    }
    return o;
  }
  function addBoostPad(x, z, yaw) {
    const pad = { cx: x, cz: z, yaw, len: 5.5, wid: 4.0, fx: Math.sin(yaw), fz: Math.cos(yaw) }; pad.rx = pad.fz; pad.rz = -pad.fx;
    boostPads.push(pad);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 5.5), new THREE.MeshBasicMaterial({ map: chevTex.clone(), transparent: true, toneMapped: false }));
    m.material.map.repeat.set(1, 2); m.material.map.needsUpdate = true; m.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group(); holder.position.set(x, groundY(x, z) + 0.12, z); holder.rotation.y = yaw; holder.add(m); scene.add(holder);
    animated.push({ update: (dt) => { m.material.map.offset.y -= dt * 1.8; } });
  }
  function padAt(x, z) { for (const p of boostPads) { const dx = x - p.cx, dz = z - p.cz; const u = dx * p.fx + dz * p.fz, v = dx * p.rx + dz * p.rz; if (Math.abs(u) <= p.len / 2 && Math.abs(v) <= p.wid / 2) return p; } return null; }
  function addBouncer(x, z, scale = 1) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(V.mushroomGeo(), FW.Pixel.vmat({ roughness: 0.75 }));
    m.castShadow = true; m.receiveShadow = true; g.add(m);
    g.position.set(x, groundY(x, z), z); g.scale.setScalar(scale); scene.add(g);
    const b = { x, z, y: g.position.y, r: 0.72 * scale, g, squash: 0, scale };
    bouncers.push(b); return b;
  }
  function addRing(x, y, z, yaw, r = 2.8) {
    const g = V.airRing(r); g.position.set(x, y, z); g.rotation.y = yaw; scene.add(g);
    const ring = { x, y, z, yaw, r, g, taken: 0, fx: Math.sin(yaw), fz: Math.cos(yaw) };
    rings.push(ring); return ring;
  }
  function addToken(x, y, z) { const g = V.token(); g.position.set(x, y, z); scene.add(g); tokens.push({ x, y, z, g, taken: false }); }
  function scatterTokens() {
    const trail = (id, from, to, n, lift = 1.5) => { const r = roadsById[id]; for (let i = 0; i < n; i++) { const q = r.samples[U.clamp(Math.round(U.lerp(from, to, i / (n - 1)) / 2), 0, r.samples.length - 1)]; addToken(q.x, groundY(q.x, q.z) + lift, q.z); } };
    trail('loopN', 14, roadsById.loopN.length - 14, 10);
    trail('riverX', 12, roadsById.riverX.length - 12, 8);
    trail('fourmile', 14, roadsById.fourmile.length - 14, 8);
    trail('mist', 8, roadsById.mist.length - 8, 5);
    trail('ahwahnee', 8, roadsById.ahwahnee.length - 8, 5);
    trail('glacierpt', 40, roadsById.glacierpt.length - 40, 12, 1.8);
    trail('elcapmeadow', 6, roadsById.elcapmeadow.length - 6, 5);
  }

  // ---------------- road surfaces ----------------
  // A textured ribbon follows every road: worn asphalt with baked lane markings
  // for the drives, packed dirt for the trails.
  function buildRoadSurfaces() {
    const MAIN = new Set(['northside', 'southside']);
    for (const [id, r] of Object.entries(roadsById)) {
      const dirt = r.def.type === 'dirt';
      const half = dirt ? 2.6 : 4.9;
      const sm = r.samples;
      if (sm.length < 2) continue;
      const pos = [], uvs = [], nor = [], idx = [];
      let run = 0;
      for (let i = 0; i < sm.length; i++) {
        const q = sm[i];
        if (i) run += Math.hypot(q.x - sm[i - 1].x, q.z - sm[i - 1].z);
        const px = -q.tz, pz = q.tx;
        // Sit each edge on the terrain it actually crosses. Using the sample's
        // own y put the ribbon under the ground wherever the two disagreed,
        // which is why the roads were showing as bare grey terrain.
        const lx = q.x + px * half, lz = q.z + pz * half;
        const rx = q.x - px * half, rz = q.z - pz * half;
        const LIFT = 0.05;
        pos.push(lx, terrainHeight(lx, lz) + LIFT, lz, rx, terrainHeight(rx, rz) + LIFT, rz);
        const v = run / (dirt ? 6 : 9);
        uvs.push(0, v, 1, v);
        nor.push(0, 1, 0, 0, 1, 0);
        if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setIndex(idx);
      const tex = FW.Pixel.roadTexture(dirt ? 'dirt' : MAIN.has(id) ? 'centre' : 'plain');
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: dirt ? 0.99 : 0.9, metalness: 0, envMapIntensity: 0.3, polygonOffset: true, polygonOffsetFactor: -3 }));
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }

  // ---------------- roadside signage ----------------
  function signAt(roadId, sMeters, side, kind, text, opts) {
    const r = roadsById[roadId];
    const q = r && r.samples[U.clamp(Math.round(sMeters / 2), 0, r.samples.length - 1)];
    if (!q) return;
    const x = q.x - q.tz * side * 7.4, z = q.z + q.tx * side * 7.4;
    const g = V.roadSign(kind, text, opts);
    place(g, x, z, Math.atan2(q.tx, q.tz) + (side > 0 ? Math.PI : 0) + Math.PI);
    addCollider(x, z, 0.35, 'prop');
  }
  function buildSigns() {
    signAt('northside', 90, -1, 'speed', '25');
    signAt('northside', 210, -1, 'warn', '!');
    signAt('northside', 350, -1, 'chevron');
    signAt('northside', 470, -1, 'guide', 'EL CAPITAN|2 MI');
    signAt('northside', 610, -1, 'speed', '25');
    signAt('northside', 720, -1, 'warn', '!');
    signAt('southside', 70, 1, 'guide', 'THE VILLAGE|CURRY VILLAGE');
    signAt('southside', 190, 1, 'chevron');
    signAt('southside', 330, 1, 'speed', '25');
    signAt('southside', 470, 1, 'warn', '!');
    signAt('southside', 620, 1, 'guide', 'HAPPY ISLES|MIRROR LAKE');
    signAt('glacierpt', 60, -1, 'warn', '!');
    signAt('glacierpt', 150, -1, 'chevron');
    signAt('glacierpt', 250, -1, 'speed', '15');
    signAt('glacierpt', 330, -1, 'guide', 'GLACIER PT|1 MI');
    signAt('mirror', 40, 1, 'guide', 'MIRROR LAKE');
    signAt('sentinel', 20, 1, 'warn', '!');
    signAt('happy', 30, -1, 'chevron');
    for (let i = 1; i <= 6; i++) {
      const q = roadPoint('northside', i * 120);
      place(V.mileMarker(String(i)), q.x + q.tz * 6.6, q.z - q.tx * 6.6, Math.atan2(q.tx, q.tz) + Math.PI / 2);
    }
  }

  // ---------------- atmosphere ----------------
  const mist = [];
  let motes = null;
  function buildAtmosphere() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, 'rgba(255,255,255,.55)'); grd.addColorStop(0.55, 'rgba(255,255,255,.22)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.3, toneMapped: false });
    for (let i = 0; i < 16; i++) {
      const x = (rand() - 0.5) * 380, z = riverZ(x) + (rand() - 0.5) * 90;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      m.rotation.x = -Math.PI / 2;
      m.scale.setScalar(28 + rand() * 46);
      m.position.set(x, groundY(x, z) + 0.9 + rand() * 1.4, z);
      m.renderOrder = 3;
      scene.add(m);
      mist.push({ m, x, z, phase: rand() * 6.28, drift: 0.4 + rand() * 0.7 });
    }
    const g2 = new THREE.BufferGeometry();
    const N2 = 260, pos = new Float32Array(N2 * 3);
    for (let i = 0; i < N2; i++) { pos[i * 3] = (rand() - 0.5) * 60; pos[i * 3 + 1] = rand() * 14; pos[i * 3 + 2] = (rand() - 0.5) * 60; }
    g2.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    motes = new THREE.Points(g2, new THREE.PointsMaterial({ color: '#fff3d8', size: 0.1, sizeAttenuation: true, transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false }));
    motes.frustumCulled = false;
    scene.add(motes);
  }

  // ---------------- traffic ----------------
  function addCar(kind, roadId, s, speed, lane) {
    const g = V.car(kind);
    scene.add(g);
    const c = { g, kind, roadId, s, speed, lane, radius: g.userData.radius, x: 0, z: 0, yaw: 0, wob: rand() * 6 };
    traffic.push(c); updateCar(c, 0); return c;
  }
  function addParked(kind, x, z, yaw) {
    const g = V.car(kind);
    place(g, x, z, yaw);
    addCollider(x, z, g.userData.radius, 'car');
    return g;
  }
  function updateCar(c, dt) {
    const r = roadsById[c.roadId], n = r.samples.length;
    c.s += c.speed * dt;
    const total = (n - 1) * 2;
    if (c.s > total) c.s -= total; if (c.s < 0) c.s += total;
    const q = r.samples[U.clamp(Math.round(c.s / 2), 0, n - 1)];
    const px = -q.tz, pz = q.tx;
    c.x = q.x + px * c.lane; c.z = q.z + pz * c.lane;
    c.yaw = Math.atan2(q.tx * Math.sign(c.speed || 1), q.tz * Math.sign(c.speed || 1));
    const gy = groundY(c.x, c.z);
    c.g.position.set(c.x, gy, c.z);
    c.g.rotation.y = c.yaw;
    c.g.rotation.z = Math.sin(FW.World.time * 2 + c.wob) * 0.012;
  }
  function buildTraffic() {
    addCar('sedan', 'northside', 60, -7.5, -2.6);
    addCar('wagon', 'northside', 260, -6.2, -2.6);
    addCar('shuttle', 'northside', 430, -5.4, -2.6);
    addCar('hatch', 'northside', 620, -8.0, -2.6);
    addCar('sedan', 'southside', 120, 7.8, 2.6);
    addCar('rv', 'southside', 300, 4.8, 2.6);
    addCar('ranger', 'southside', 520, 8.6, 2.6);
    addCar('hatch', 'southside', 680, 7.2, 2.6);
    addCar('shuttle', 'mirror', 30, 5.0, 2.4);
    addCar('sedan', 'glacierpt', 90, 6.0, -2.4);
    addCar('wagon', 'glacierpt', 240, -5.2, 2.4);
    addCar('ranger', 'sentinel', 30, 5.5, 2.4);
    // parking lots
    const lot = (cx, cz, yaw, n, kinds) => {
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * 2.9;
        const x = cx + Math.cos(yaw) * off, z = cz - Math.sin(yaw) * off;
        addParked(kinds[i % kinds.length], x, z, yaw + Math.PI / 2 + (rand() - 0.5) * 0.06);
      }
    };
    lot(58, 82, 0.35, 5, ['sedan', 'hatch', 'wagon', 'rv', 'sedan']);
    lot(138, -68, -0.3, 4, ['wagon', 'sedan', 'hatch', 'shuttle']);
    lot(-26, 70, 0.2, 3, ['hatch', 'sedan', 'wagon']);
    lot(86, -146, 0.1, 4, ['sedan', 'wagon', 'rv', 'hatch']);
    lot(-138, 10, 0.0, 3, ['sedan', 'hatch', 'ranger']);
  }

  // ---------------- sky & light ----------------
  function buildSky() {
    skyGeo = new THREE.SphereGeometry(900, 20, 12);
    skyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
    sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
    sky.renderOrder = -10; scene.add(sky);
    sunDisc = new THREE.Mesh(new THREE.CircleGeometry(40, 16), new THREE.MeshBasicMaterial({ color: '#fff6d8', fog: false, toneMapped: false }));
    scene.add(sunDisc);
    // A low, warm sun with real shadow contrast — late-afternoon light in a
    // steep valley, not a flat overcast studio.
    sun = new THREE.DirectionalLight(0xffe6c4, 2.6);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 10; sc.far = 300;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3.2;
    scene.add(sun, sun.target);
    // Shade is cool and dim but never black — enough sky bounce to read the
    // road, not so much that it flattens the trees into a single green wash.
    fill = new THREE.DirectionalLight('#8ea6c2', 0.34); fill.position.set(-1, 0.6, -0.8); scene.add(fill);
    hemi = new THREE.HemisphereLight(0xa9c2da, 0x5f5648, 0.62); scene.add(hemi);
    // denser, warmer haze so distance falls away instead of staying crisp
    scene.fog = new THREE.FogExp2(0xc4cbc4, 0.0038);
    scene.environment = FW.Pixel.envOutdoor;
    for (let i = 0; i < 14; i++) {
      const g = new THREE.Group(), n = 3 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(V.sphere(3 + rand() * 4, 8, 5), FW.Pixel.mat('#ffffff', { roughness: 1, envMapIntensity: 0.4 }));
        m.position.set((k - n / 2) * 5 + rand() * 3, rand() * 1.6, (rand() - 0.5) * 4); m.scale.y = 0.6; g.add(m);
      }
      g.position.set((rand() - 0.5) * 800, 175 + rand() * 70, (rand() - 0.5) * 800); g.scale.setScalar(1 + rand() * 1.4);
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
    const pos = skyGeo.attributes.position, col = skyGeo.attributes.color, c = new THREE.Color();
    for (let k = 0; k < pos.count; k++) { const ny = pos.getY(k) / 900; c.copy(hor).lerp(zen, U.smoothstep(-0.02, 0.5, ny)); if (ny < -0.02) c.copy(hor).multiplyScalar(0.9); col.setXYZ(k, c.r, c.g, c.b); }
    col.needsUpdate = true;
    sun.color.copy(mix(A.sun, B.sun)); sun.intensity = U.lerp(A.sunI, B.sunI, f);
    hemi.color.copy(mix(A.hemiSky, B.hemiSky)); hemi.groundColor.copy(mix(A.hemiGnd, B.hemiGnd)); hemi.intensity = U.lerp(A.amb, B.amb, f);
    scene.fog.color.copy(mix(A.fog, B.fog));
    sunDisc.material.color.copy(mix(A.sun, B.sun));
    // the sun tracks along the valley, so the walls throw long shadows
    const ang = U.lerp(0.75, 2.4, t);
    sunDir.set(Math.cos(ang), U.lerp(0.6, 0.42, Math.abs(t - 0.5) * 2) + 0.3, Math.sin(ang) * 0.35 + 0.25).normalize();
  }

  // ---------------- landmarks ----------------
  function buildLandmarks() {
    const gran = FW.Pixel.mat('#b5b0c0', { roughness: 0.95 });
    const granL = FW.Pixel.mat('#c7c2d0', { roughness: 0.95 });
    // El Capitan — the big vertical face on the north wall
    const el = new THREE.Mesh(V.roundedBox(92, 168, 74, 7, 3), gran);
    el.position.set(-142, baseHeight(-142, 176) + 46, 178); el.rotation.y = 0.12; scene.add(el);
    const nose = new THREE.Mesh(V.roundedBox(34, 130, 34, 6, 3), granL);
    nose.position.set(-116, baseHeight(-116, 158) + 40, 160); scene.add(nose);
    // Three Brothers — stepped blocks
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(V.roundedBox(30 - i * 4, 70 + i * 26, 26, 5, 2), i % 2 ? granL : gran);
      b.position.set(-84 + i * 20, baseHeight(-84 + i * 20, 162) + 22 + i * 13, 166 - i * 4); b.rotation.y = 0.2 + i * 0.1; scene.add(b);
    }
    // Half Dome — sheared dome at the head of the valley
    const hd = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(52, 18, 12, 0, Math.PI), gran); dome.scale.y = 1.55; hd.add(dome);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(52, 18), granL); cap.scale.y = 1.55; cap.rotation.y = Math.PI; hd.add(cap);
    hd.position.set(196, baseHeight(196, 150) - 6, 150); hd.rotation.y = -Math.PI * 0.34; scene.add(hd);
    // Cathedral Rocks + Sentinel Rock on the south wall
    for (const [x, z, h, w] of [[-160, -152, 96, 26], [-142, -166, 118, 22], [-126, -150, 82, 18]]) {
      const s = new THREE.Mesh(V.roundedBox(w, h, w * 0.9, 4, 2), gran);
      s.position.set(x, baseHeight(x, z) + h / 2 - 16, z); s.rotation.y = rand(); scene.add(s);
    }
    const sent = new THREE.Mesh(V.roundedBox(24, 126, 20, 4, 2), granL);
    sent.position.set(-36, baseHeight(-36, -150) + 40, -152); sent.rotation.y = 0.3; scene.add(sent);
    // Royal Arches / North Dome
    const nd = new THREE.Mesh(new THREE.SphereGeometry(30, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2), granL);
    nd.position.set(122, baseHeight(122, 158) + 6, 158); nd.scale.y = 0.8; scene.add(nd);
    // Glacier Point overlook, high on the south rim
    const gp = new THREE.Mesh(V.roundedBox(30, 26, 24, 4, 2), gran);
    gp.position.set(92, baseHeight(92, -156) - 4, -156); scene.add(gp);
    // waterfalls: Yosemite Falls (north), Bridalveil (south)
    wallFall(14, 138, 96, 9, 1);
    wallFall(-190, -128, -92, 7, -1);
    wallFall(178, 128, 104, 5, 1);
  }
  // a fall dropping down a valley wall toward the floor
  function wallFall(x, zTop, zBot, width, dir) {
    const n = 12, pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, z = U.lerp(zTop, zBot, t);
      const y = U.lerp(baseHeight(x, zTop) + 6, baseHeight(x, zBot) + 0.4, Math.pow(t, 0.55));
      pos.push(x - width / 2, y, z, x + width / 2, y, z); uv.push(0, t * 7, 1, t * 7);
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const tex = FW.Pixel.stripeTexture(['#ffffff', '#cfeaff', '#ffffff', '#9fd4f5', '#e6f6ff', '#bfe3ff'], 8, 48);
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: 0.95, toneMapped: false })));
    const pool = new THREE.Mesh(new THREE.CircleGeometry(width * 1.3, 14), FW.Pixel.mat('#8fd0f0', { transparent: true, opacity: 0.85, roughness: 0.12, envMapIntensity: 1.4 }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(x, baseHeight(x, zBot) + 0.5, zBot + dir * -3); scene.add(pool);
    animated.push({ update: (dt) => {
      tex.offset.y -= dt * 1.8;
      if (Math.random() < 0.4) fx.spawn({ x: x + (Math.random() - 0.5) * width, y: pool.position.y + 0.6, z: pool.position.z + (Math.random() - 0.5) * 5, vy: 1.8 + Math.random(), vx: (Math.random() - 0.5), vz: (Math.random() - 0.5), life: 1.6, size: 0.5, color: '#ffffff', gravity: -0.3, shrink: false });
    } });
  }

  // ---------------- destinations & buildings ----------------
  const DEST_DEFS = [
    { id: 'elcap', name: 'El Capitan Meadow', short: 'El Cap Meadow', x: -138, z: 7 },
    { id: 'camp4', name: 'Camp 4', short: 'Camp 4', x: -26, z: 73 },
    { id: 'village', name: 'Yosemite Village', short: 'The Village', x: 52, z: 88 },
    { id: 'curry', name: 'Curry Village', short: 'Curry Village', x: 134, z: -73 },
    { id: 'mirror', name: 'Mirror Lake', short: 'Mirror Lake', x: 187, z: 78 },
    { id: 'glacier', name: 'Glacier Point', short: 'Glacier Point', x: 88, z: -149 },
    { id: 'bridalveil', name: 'Bridalveil Fall', short: 'Bridalveil', x: -191, z: -62 },
  ];
  const HOME = { x: 0, z: 68, r: 14 };
  function defineFlatZones() {
    const zoneY = (x, z, r) => { const { d, s } = nearestRoad(x, z); return s && d < r + 8 ? s.y : baseHeight(x, z); };
    flatZones.push({ x: HOME.x, z: HOME.z, r: 19, y: zoneY(0, 62, 6) });
    for (const d of DEST_DEFS) {
      const y = zoneY(d.x, d.z, 12);
      flatZones.push({ x: d.x, z: d.z, r: 14, y });
      destinations[d.id] = { id: d.id, name: d.name, short: d.short, x: d.x, z: d.z, y, r: 7, dist: Math.hypot(d.x - HOME.x, d.z - HOME.z) };
    }
    flatZones.push({ x: 58, z: 82, r: 10, y: zoneY(58, 82, 10) });
    flatZones.push({ x: 138, z: -68, r: 9, y: zoneY(138, -68, 9) });
    flatZones.push({ x: 86, z: -146, r: 9, y: zoneY(86, -146, 9) });
  }
  function critterIdle(g, phase) {
    animated.push({ update: (dt, t) => { g.userData.head.rotation.y = Math.sin(t * 0.7 + phase) * 0.35; g.position.y = g.userData.baseY + Math.abs(Math.sin(t * 2.2 + phase)) * 0.05; } });
  }
  function buildBuildings() {
    const shack = V.shack(); place(shack, 0, 66, Math.PI); chimneys.push(shack.localToWorld(shack.userData.chimney.clone()));
    addCollider(0, 66, 4.0, 'building'); addCollider(-2.6, 66, 3.0, 'building'); addCollider(2.6, 66, 3.0, 'building');
    place(V.picnicTable(), 9, 62, 0.3); addCollider(9, 62, 1.1, 'prop');
    place(V.signpost('WAFFLE SHACK'), -6, 60, 2.6); addCollider(-6, 60, 0.3, 'prop');
    for (const d of DEST_DEFS) {
      const gy = groundY(d.x, d.z);
      place(V.signpost(d.short.toUpperCase()), d.x + 6, d.z + 5, -0.6); addCollider(d.x + 6, d.z + 5, 0.3, 'prop');
      const camp = (cols) => {
        cols.forEach(([ox, oz, yaw], i) => { place(V.tent(P.tent[i % P.tent.length]), d.x + ox, d.z + oz, yaw); addCollider(d.x + ox, d.z + oz, 1.6, 'prop'); });
        const cf = V.campfire(); place(cf, d.x, d.z - 7, 0); addCollider(d.x, d.z - 7, 0.9, 'prop');
        animated.push({ update: (dt, t) => cf.userData.flames.forEach((f, i) => { f.scale.y = 0.8 + 0.35 * Math.sin(t * 9 + i * 2); f.scale.x = 0.9 + 0.15 * Math.sin(t * 7 + i); }) });
        place(V.picnicTable(), d.x - 8, d.z + 5, 1.2); addCollider(d.x - 8, d.z + 5, 1.1, 'prop');
      };
      switch (d.id) {
        case 'camp4': camp([[-7, -6, 0.8], [6, -7, -0.6], [8, 4, -2.2], [-9, 5, 1.4]]); break;
        case 'curry': {
          camp([[-8, -5, 0.6], [7, -6, -0.5], [9, 5, -2.0]]);
          place(V.cabin('#4f7d4a'), d.x - 4, d.z - 12, 0.2); addCollider(d.x - 4, d.z - 12, 3.0, 'building');
          break; }
        case 'village': {
          place(V.rangerStation(), d.x, d.z - 9, Math.PI); addCollider(d.x, d.z - 9, 4.0, 'building');
          addCollider(d.x - 3, d.z - 9, 2.8, 'building'); addCollider(d.x + 3, d.z - 9, 2.8, 'building');
          place(V.cabin('#8a5a3c'), d.x + 12, d.z - 4, -0.4); addCollider(d.x + 12, d.z - 4, 3.0, 'building');
          place(V.picnicTable(), d.x - 9, d.z + 2, 0.1); addCollider(d.x - 9, d.z + 2, 1.1, 'prop');
          break; }
        case 'glacier': {
          const deck = new THREE.Mesh(V.roundedBox(13, 0.4, 8, 0.14), FW.Pixel.mat('#9a9186'));
          deck.position.set(d.x, gy + 0.2, d.z - 6); deck.receiveShadow = true; scene.add(deck);
          barrier([[d.x - 6.5, d.z - 10], [d.x + 6.5, d.z - 10]], true);
          barrier([[d.x - 6.5, d.z - 10], [d.x - 6.5, d.z - 2]], true);
          barrier([[d.x + 6.5, d.z - 10], [d.x + 6.5, d.z - 2]], true);
          place(V.picnicTable(), d.x - 8, d.z + 4, 0.2); addCollider(d.x - 8, d.z + 4, 1.1, 'prop');
          const scope = V.build([V.p(V.capsule(0.08, 1.2), '#c8ccd8', 0, 0.6, 0, { mat: 'metal' }), V.p(V.cyl(0.16, 0.2, 0.7, 10), '#8a5a2b', 0, 1.3, 0, { rx: Math.PI / 2.4, mat: 'shiny' })]);
          place(scope, d.x + 3, d.z - 8, Math.PI); addCollider(d.x + 3, d.z - 8, 0.4, 'prop');
          break; }
        case 'mirror': {
          place(V.cabin('#4f7d4a'), d.x - 7, d.z - 8, 0.4); addCollider(d.x - 7, d.z - 8, 3.0, 'building');
          place(V.cabin('#8a5a3c'), d.x + 8, d.z - 5, -0.5); addCollider(d.x + 8, d.z - 5, 3.0, 'building');
          const lake = new THREE.Mesh(new THREE.CircleGeometry(16, 22), FW.Pixel.mat('#7cc4ec', { transparent: true, opacity: 0.86, roughness: 0.06, metalness: 0.15, envMapIntensity: 1.7 }));
          lake.rotation.x = -Math.PI / 2; lake.position.set(186, baseHeight(186, 84) + 1.4, 84); scene.add(lake);
          break; }
        case 'elcap': {
          place(V.picnicTable(), d.x - 5, d.z - 6, 0.3); addCollider(d.x - 5, d.z - 6, 1.1, 'prop');
          place(V.picnicTable(), d.x + 5, d.z - 8, -0.4); addCollider(d.x + 5, d.z - 8, 1.1, 'prop');
          place(V.arrowSign('EL CAP'), d.x + 9, d.z + 1, 1.2);
          break; }
        case 'bridalveil': {
          place(V.picnicTable(), d.x - 5, d.z - 5, 0.3); addCollider(d.x - 5, d.z - 5, 1.1, 'prop');
          const cf = V.campfire(); place(cf, d.x + 6, d.z - 4, 0); addCollider(d.x + 6, d.z - 4, 0.9, 'prop');
          animated.push({ update: (dt, t) => cf.userData.flames.forEach((f, i) => { f.scale.y = 0.8 + 0.35 * Math.sin(t * 9 + i * 2); }) });
          break; }
      }
      if (rand() < 0.75) {
        const kinds = Object.keys(V.CRITTERS);
        const c = V.critter(kinds[Math.floor(rand() * kinds.length)]);
        place(c, d.x - 4 + rand() * 8, d.z + 8 + rand() * 3, Math.PI + (rand() - 0.5));
        c.userData.baseY = c.position.y; critterIdle(c, rand() * 6);
      }
    }
  }
  function logTunnel(x, z, yaw, len = 22, r = 2.6) {
    const g = new THREE.Group(); g.position.set(x, groundY(x, z) + r * 0.62, z); g.rotation.y = yaw;
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, len, 16, 1, true), FW.Pixel.mat('#8c4a2c', { side: THREE.DoubleSide, roughness: 0.95 }));
    shell.rotation.z = Math.PI / 2; shell.castShadow = true; shell.receiveShadow = true; g.add(shell);
    for (const sx of [-1, 1]) { const ring = new THREE.Mesh(V.torus(r * 1.02, 0.22, 6, 18), FW.Pixel.mat('#b99a72')); ring.position.x = sx * len / 2; ring.rotation.y = Math.PI / 2; g.add(ring); }
    for (let i = 0; i < 12; i++) {
      const moss = new THREE.Mesh(V.sphere(0.5 + Math.random() * 0.5, 8, 6), FW.Pixel.mat('#2f6246'));
      moss.position.set((Math.random() - 0.5) * len * 0.9, r * 0.85, (Math.random() - 0.5) * r); moss.scale.y = 0.45; moss.castShadow = true; g.add(moss);
    }
    scene.add(g);
    const fx2 = Math.sin(yaw), fz2 = Math.cos(yaw);
    for (const side of [-1, 1]) for (const end of [-1, 1]) addCollider(x + fz2 * side * (r + 0.6) + fx2 * end * len * 0.32, z - fx2 * side * (r + 0.6) + fz2 * end * len * 0.32, 0.7, 'prop');
    return g;
  }
  function buildWater() {
    water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE, 1, 1), FW.Pixel.mat(P.water, { transparent: true, opacity: 0.86, roughness: 0.06, metalness: 0.35, envMapIntensity: 1.9 }));
    water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y; water.receiveShadow = true; scene.add(water);
    animated.push({ update: (dt, t) => { water.position.y = WATER_Y + Math.sin(t * 1.3) * 0.06; } });
  }

  // ---------------- route graph (map-app routing along the roads) ----------------
  let graph = null;
  function buildGraph() {
    const nodes = roadSamples;
    nodes.forEach((n, i) => { n.gi = i; n.adj = []; });
    for (const r of Object.values(roadsById)) {
      const s = r.samples;
      for (let i = 1; i < s.length; i++) {
        const w = Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z) * (s[i].type === 'dirt' ? 1.25 : 1);
        s[i].adj.push([s[i - 1].gi, w]); s[i - 1].adj.push([s[i].gi, w]);
      }
    }
    // stitch roads that touch
    for (const n of nodes) {
      hashQuery(roadHash, RH, n.x, n.z, _q);
      for (const o of _q) if (o.road !== n.road) { const d = Math.hypot(o.x - n.x, o.z - n.z); if (d < 7) n.adj.push([o.gi, d + 2]); }
    }
    graph = nodes;
  }
  function nearestNode(x, z) { let best = null, bd = 1e9; for (const n of graph) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } } return best; }
  const routeCache = new Map();
  function route(fromX, fromZ, destId) {
    const d = destinations[destId]; if (!d || !graph) return null;
    const start = nearestNode(fromX, fromZ), goal = nearestNode(d.x, d.z);
    if (!start || !goal) return null;
    const key = start.gi + ':' + goal.gi;
    if (routeCache.has(key)) return routeCache.get(key);
    const dist = new Float64Array(graph.length).fill(Infinity), prev = new Int32Array(graph.length).fill(-1);
    const seen = new Uint8Array(graph.length);
    dist[start.gi] = 0;
    const heap = [[0, start.gi]];
    while (heap.length) {
      heap.sort((a, b) => a[0] - b[0]);
      const [dd, gi] = heap.shift();
      if (seen[gi]) continue; seen[gi] = 1;
      if (gi === goal.gi) break;
      for (const [nj, w] of graph[gi].adj) {
        const nd = dd + w;
        if (nd < dist[nj]) { dist[nj] = nd; prev[nj] = gi; heap.push([nd, nj]); }
      }
    }
    const path = [];
    for (let gi = goal.gi; gi >= 0; gi = prev[gi]) { path.push([graph[gi].x, graph[gi].z]); if (gi === start.gi) break; }
    path.reverse();
    const out = path.length > 1 ? path : null;
    routeCache.set(key, out);
    return out;
  }

  // ---------------- minimap: drawn like a real map ----------------
  function buildMinimap() {
    const S = 260;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const toMap = (x, z) => [(x + HALF) / SIZE * S, S - (z + HALF) / SIZE * S];
    // landcover
    const img = g.createImageData(S, S);
    const COL = {
      [SURF.GRASS]: [214, 233, 196], [SURF.FOREST]: [169, 207, 162], [SURF.ROAD]: [255, 255, 255], [SURF.LINE]: [255, 255, 255],
      [SURF.DIRT]: [226, 214, 190], [SURF.SHOULDER]: [240, 235, 222], [SURF.SAND]: [237, 228, 205], [SURF.WATER]: [168, 211, 238],
      [SURF.ROCK]: [225, 222, 216], [SURF.SNOW]: [250, 251, 253], [SURF.WOOD]: [222, 205, 180],
    };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const ix = Math.min(N - 1, Math.floor(x / S * N)), iz = Math.min(N - 1, Math.floor((S - 1 - y) / S * N));
      const s = surface[iz * N + ix];
      const col = COL[s] || COL[SURF.GRASS];
      const wx = -HALF + ix * CELL, wz = -HALF + iz * CELL;
      const shade = s === SURF.ROCK || s === SURF.SNOW ? 1 : 1 - U.clamp(terrainHeight(wx, wz) / 260, 0, 1) * 0.22;
      const i = (y * S + x) * 4;
      img.data[i] = Math.min(255, col[0] * shade); img.data[i + 1] = Math.min(255, col[1] * shade); img.data[i + 2] = Math.min(255, col[2] * shade); img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // river, drawn as a proper map watercourse
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = '#8ec5e6'; g.lineWidth = 4.5;
    g.beginPath();
    for (let x = -HALF; x <= HALF; x += 4) { const [mx, my] = toMap(x, riverZ(x)); x === -HALF ? g.moveTo(mx, my) : g.lineTo(mx, my); }
    g.stroke();
    // roads: casing then fill, dirt trails dashed
    const stroke = (list, w, col, dash) => {
      g.setLineDash(dash || []); g.strokeStyle = col; g.lineWidth = w;
      for (const r of list) {
        g.beginPath();
        r.samples.forEach((q, i) => { const [mx, my] = toMap(q.x, q.z); i ? g.lineTo(mx, my) : g.moveTo(mx, my); });
        g.stroke();
      }
    };
    const paved = Object.values(roadsById).filter((r) => r.def.type === 'road');
    const dirt = Object.values(roadsById).filter((r) => r.def.type === 'dirt');
    stroke(paved, 5.6, '#c9c2b6');
    stroke(paved, 3.4, '#ffffff');
    stroke(dirt, 2.2, '#b9a98c', [4, 4]);
    g.setLineDash([]);
    minimap = { canvas: c, size: S, toMap, labels: DEST_DEFS.map((d) => ({ text: d.short, at: toMap(d.x, d.z) })).concat([{ text: 'Waffle Shack', at: toMap(HOME.x, HOME.z), home: true }]) };
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
    // traversal toys, placed along the real routes
    { const q = roadPoint('loopN', 60); addRamp(q.x, q.z, Math.atan2(q.tx, q.tz), 8, 6.5, 2.2, 1.4); }
    { const q = roadPoint('fourmile', 40); addRamp(q.x, q.z, Math.atan2(q.tx, q.tz), 7, 6, 1.9, 1.35); }
    { const q = roadPoint('mist', 20); addRamp(q.x, q.z, Math.atan2(q.tx, q.tz), 7, 6, 2.0, 1.35); }
    { const q = roadPoint('ahwahnee', 24); addRamp(q.x, q.z, Math.atan2(q.tx, q.tz), 6, 6, 1.4, 1.3); }
    addRamp(-64, 30, -Math.PI / 2, 7, 6, 1.6, 1.35);
    // the flume: a timber chute down the talus below Glacier Point
    addChute(52, -118, 30, -60, 8, 2.6);
    { const q = roadPoint('glacierpt', 240); addBoostPad(q.x, q.z, Math.atan2(q.tx, q.tz)); }
    addRing(40, groundY(40, -88) + 6.5, -88, Math.atan2(-22, 58), 3.4);
    // canyon gap where the river crossing trail meets the Merced
    { const s = roadsById.riverX.samples;
      let ci = s.findIndex((q, i) => i > 0 && (s[i - 1].z - riverZ(s[i - 1].x)) * (q.z - riverZ(q.x)) < 0);
      if (ci < 0) ci = Math.floor(s.length / 2);
      const a = s[Math.max(0, ci - 9)], b = s[Math.min(s.length - 1, ci + 9)];
      addRamp(a.x, a.z, Math.atan2(a.tx, a.tz), 8, 7, 2.6, 1.55);
      addRamp(b.x, b.z, Math.atan2(-b.tx, -b.tz), 8, 7, 2.6, 1.55);
      const m = s[ci];
      addRing(m.x, groundY(m.x, m.z) + 7.5, m.z, Math.atan2(m.tx, m.tz), 3.6);
      const pre = s[Math.max(0, ci - 16)];
      addBoostPad(pre.x, pre.z, Math.atan2(pre.tx, pre.tz));
      place(V.arrowSign('BIG JUMP!'), pre.x + 4.5, pre.z, Math.atan2(pre.tz, pre.tx));
      addRail(m.x - 13, m.z + 22, m.x - 13, m.z - 22, { log: true, ya: groundY(m.x - 13, m.z + 22) + 1.4, yb: groundY(m.x - 13, m.z - 22) + 1.4 });
    }
    logTunnel(-70, 66, 0.5, 24, 2.8);
    place(V.arrowSign('SHORTCUT'), -62, 74, 1.2);
    chainRails([addRail(22, 67, 46, 68), addRail(46, 68, 64, 68)]);
    addRail(-100, 44, -122, 38);
    addRail(150, -60, 128, -66);
    for (const s of [120, 300, 520, 700]) { const q = roadPoint('northside', s); addBoostPad(q.x, q.z, Math.atan2(q.tx, q.tz)); }
    for (const s of [180, 420, 640]) { const q = roadPoint('southside', s); addBoostPad(q.x, q.z, Math.atan2(q.tx, q.tz)); }
    buildBuildings();
    buildBarriers();
    buildTraffic();
    buildRoadSurfaces();
    buildSigns();
    buildAtmosphere();
    const spots = [[-46, 22], [-40, 16], [30, -22], [24, -28], [104, 30], [110, 24], [-96, 60], [166, -40], [70, -96], [-158, -70], [-152, -76], [122, 96]];
    for (const [x, z] of spots) if (canPlace(x, z, 1.2)) addBouncer(x, z, 1.1 + rand() * 0.5);
    for (let i = 0, n = 0; i < 1200 && n < 12; i++) { const x = (rand() - 0.5) * 320, z = (rand() - 0.5) * 200; if (!canPlace(x, z, 1.4)) continue; addBouncer(x, z, 1 + rand() * 0.6); n++; }
    { const q = roadPoint('loopN', 60); addRing(q.x, groundY(q.x, q.z) + 6.0, q.z, Math.atan2(q.tx, q.tz), 3.2); }
    scatterTokens();
    const treeCount = buildForest();
    buildGraph();
    buildMinimap();
    marker = V.marker(); marker.visible = false; scene.add(marker);
    setTimeOfDay(0);
    return { scene, fx, treeCount };
  }

  // ---------------- runtime ----------------
  let time = 0;
  function update(dt, playerPos, camera) {
    time += dt;
    for (const a of animated) a.update(dt, time);
    for (const c of traffic) updateCar(c, dt);
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
    for (const mi of mist) {
      mi.m.position.x = mi.x + Math.sin(time * 0.11 + mi.phase) * 9 * mi.drift;
      mi.m.material.opacity = 0.34 + Math.sin(time * 0.5 + mi.phase) * 0.12;
    }
    if (motes) { motes.position.set(Math.round(playerPos.x / 30) * 30, 0, Math.round(playerPos.z / 30) * 30); motes.rotation.y = time * 0.02; }
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
    nearbyColliders, nearbyFences, rails, overrides, padAt, bouncers, rings, tokens, traffic, resetPickups, route,
    destinations, setDelivery, spawnCustomer, clearCustomer, respawnPoint, bounds, riverZ, chanAt, setTimeOfDay,
    get fx() { return fx; }, get scene() { return scene; }, get time() { return time; }, get minimap() { return minimap; }, roadsById, roadPoint };
})();
