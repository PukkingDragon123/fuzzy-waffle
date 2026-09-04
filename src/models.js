// Flippin' Waffles — rounded model library.
// Everything is built from spheres, capsules, tori and rounded boxes, then merged
// per material family so a whole character is 1-3 draw calls.
window.FW = window.FW || {};

FW.Models = (() => {
  const P = FW.PAL, U = FW.U;
  const geoCache = new Map();
  const key = (...a) => a.join('_');

  // ---------- primitives ----------
  function roundedBox(w, h, d, r, seg = 3) {
    r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
    const k = key('rb', w, h, d, r, seg); if (geoCache.has(k)) return geoCache.get(k);
    const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
    const pos = g.attributes.position, nor = g.attributes.normal;
    const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
    const v = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      c.set(U.clamp(v.x, -hw, hw), U.clamp(v.y, -hh, hh), U.clamp(v.z, -hd, hd));
      n.subVectors(v, c);
      if (n.lengthSq() < 1e-10) n.set(0, 1, 0); else n.normalize();
      pos.setXYZ(i, c.x + n.x * r, c.y + n.y * r, c.z + n.z * r);
      nor.setXYZ(i, n.x, n.y, n.z);
    }
    geoCache.set(k, g); return g;
  }
  function sphere(r, wseg = 12, hseg = 8, opts) {
    const k = key('s', r, wseg, hseg, opts && opts.phiS, opts && opts.phiL, opts && opts.thetaS, opts && opts.thetaL); if (geoCache.has(k)) return geoCache.get(k);
    const g = new THREE.SphereGeometry(r, wseg, hseg, opts && opts.phiS || 0, opts && opts.phiL || Math.PI * 2, opts && opts.thetaS || 0, opts && opts.thetaL || Math.PI);
    geoCache.set(k, g); return g;
  }
  function capsule(r, len, seg = 4, rad = 8) {
    const k = key('c', r, len, seg, rad); if (geoCache.has(k)) return geoCache.get(k);
    const g = new THREE.CapsuleGeometry(r, len, seg, rad); geoCache.set(k, g); return g;
  }
  function cyl(rt, rb, h, seg = 12, open = false) {
    const k = key('cy', rt, rb, h, seg, open); if (geoCache.has(k)) return geoCache.get(k);
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open); geoCache.set(k, g); return g;
  }
  function cone(r, h, seg = 10) { return cyl(0.001, r, h, seg); }
  function torus(r, tube, rad = 8, tub = 12, arc) {
    const k = key('t', r, tube, rad, tub, arc); if (geoCache.has(k)) return geoCache.get(k);
    const g = new THREE.TorusGeometry(r, tube, rad, tub, arc || Math.PI * 2); geoCache.set(k, g); return g;
  }
  function blob(r, detail = 1) { const k = key('b', r, detail); if (geoCache.has(k)) return geoCache.get(k); const g = new THREE.IcosahedronGeometry(r, detail); geoCache.set(k, g); return g; }

  // part descriptor
  function p(geo, color, x = 0, y = 0, z = 0, o = {}) { return { geo, color, x, y, z, rx: o.rx || 0, ry: o.ry || 0, rz: o.rz || 0, sx: o.sx ?? o.s ?? 1, sy: o.sy ?? o.s ?? 1, sz: o.sz ?? o.s ?? 1, mat: o.mat || 'matte' }; }

  const nonIndexed = new Map();
  function ni(g) { if (g.index === null) return g; if (nonIndexed.has(g)) return nonIndexed.get(g); const n = g.toNonIndexed(); nonIndexed.set(g, n); return n; }

  function mergeParts(parts) {
    const groups = {};
    for (const q of parts) (groups[q.mat] || (groups[q.mat] = [])).push(q);
    const out = [];
    const M = new THREE.Matrix4(), NM = new THREE.Matrix3(), E = new THREE.Euler(), Q = new THREE.Quaternion(), Pv = new THREE.Vector3(), S = new THREE.Vector3(), v = new THREE.Vector3(), n = new THREE.Vector3(), col = new THREE.Color();
    for (const [m, list] of Object.entries(groups)) {
      let total = 0;
      for (const q of list) total += ni(q.geo).attributes.position.count;
      const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), cls = new Float32Array(total * 3);
      let k = 0;
      for (const q of list) {
        const g = ni(q.geo), gp = g.attributes.position, gn = g.attributes.normal;
        E.set(q.rx, q.ry, q.rz); Q.setFromEuler(E); Pv.set(q.x, q.y, q.z); S.set(q.sx, q.sy, q.sz);
        M.compose(Pv, Q, S); NM.getNormalMatrix(M);
        col.set(q.color);
        for (let i = 0; i < gp.count; i++) {
          v.fromBufferAttribute(gp, i).applyMatrix4(M);
          n.fromBufferAttribute(gn, i).applyMatrix3(NM).normalize();
          pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z;
          nor[k] = n.x; nor[k + 1] = n.y; nor[k + 2] = n.z;
          cls[k] = col.r; cls[k + 1] = col.g; cls[k + 2] = col.b;
          k += 3;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(cls, 3));
      out.push({ geo, mat: m });
    }
    return out;
  }
  function build(parts, opts = {}) {
    const g = new THREE.Group();
    for (const { geo, mat } of mergeParts(parts)) {
      const mesh = new THREE.Mesh(geo, FW.Pixel.fam(mat));
      mesh.castShadow = opts.cast !== false; mesh.receiveShadow = opts.receive !== false;
      g.add(mesh);
    }
    return g;
  }
  // single merged geometry (for instancing) — all parts forced to one material family
  function geoOf(parts) {
    const merged = mergeParts(parts.map((q) => Object.assign({}, q, { mat: 'matte' })));
    return merged[0].geo;
  }

  // ---------- the duck ----------
  // White duck, berry apron with a waffle badge, helicopter beanie, and a lollipop.
  function duck(opts = {}) {
    const g = new THREE.Group();
    const D = P.duck, DS = P.duckShade, O = P.beak, OD = P.beakDark;
    const sit = !!opts.sitting;
    const parts = [];
    // body: soft egg
    parts.push(p(sphere(0.3, 14, 10), D, 0, 0.34, 0, { sy: 1.18, sz: 1.12, mat: 'soft' }));
    parts.push(p(sphere(0.22, 12, 8), DS, 0, 0.3, -0.24, { sy: 0.85, sz: 0.7, mat: 'soft' }));
    // tail
    parts.push(p(sphere(0.11, 8, 6), D, 0, 0.44, -0.33, { sx: 1.5, sy: 0.7, sz: 1.5, rx: 0.5, mat: 'soft' }));
    // apron: bib + skirt + strap + trim
    if (opts.apron !== false) {
      // the bib and skirt sit proud of the body so no white pokes through
      parts.push(p(sphere(0.132, 14, 10), P.apron, 0, 0.47, 0.255, { sx: 1.05, sy: 1.24, sz: 0.66, mat: 'soft' }));
      parts.push(p(cyl(0.315, 0.4, 0.19, 18, true), P.apron, 0, 0.175, 0.03, { sz: 0.95, mat: 'shell' }));
      parts.push(p(torus(0.313, 0.022, 6, 20), P.apronTrim, 0, 0.085, 0.03, { rx: Math.PI / 2, sz: 0.95 }));
      parts.push(p(capsule(0.022, 0.17), P.apron, -0.115, 0.595, 0.205, { rx: -0.22, rz: -0.4 }));
      parts.push(p(capsule(0.022, 0.17), P.apron, 0.115, 0.595, 0.205, { rx: -0.22, rz: 0.4 }));
      parts.push(p(torus(0.058, 0.021, 6, 12), P.apronTrim, 0, 0.42, -0.335, { rz: 0.5 }));
      parts.push(p(torus(0.058, 0.021, 6, 12), P.apronTrim, 0, 0.42, -0.335, { rz: -0.5 }));
      parts.push(p(sphere(0.03, 8, 6), P.apronTrim, 0, 0.42, -0.335));
      // waffle medallion on the bib
      parts.push(p(cyl(0.05, 0.05, 0.02, 14), P.gold, 0, 0.47, 0.33, { rx: Math.PI / 2, mat: 'soft' }));
      parts.push(p(torus(0.05, 0.012, 6, 16), '#d99a2e', 0, 0.47, 0.335));
      parts.push(p(sphere(0.016, 8, 6), '#e8434d', 0, 0.47, 0.346));
    }
    // feet
    const fy = sit ? 0.02 : 0.0, fz = sit ? 0.34 : 0.14;
    for (const sx of [-1, 1]) {
      parts.push(p(capsule(0.035, sit ? 0.2 : 0.1), O, sx * 0.12, fy + (sit ? 0.16 : 0.09), fz - (sit ? 0.12 : 0), { rx: sit ? 1.15 : 0 }));
      parts.push(p(roundedBox(0.15, 0.045, 0.2, 0.022), O, sx * 0.12, fy + 0.022, fz + (sit ? 0.02 : 0.03)));
      parts.push(p(roundedBox(0.03, 0.03, 0.06, 0.014), OD, sx * 0.12, fy + 0.022, fz + (sit ? 0.11 : 0.12)));
    }
    const body = build(parts);
    g.add(body);

    // head
    const head = new THREE.Group(); head.position.set(0, 0.72, 0.02);
    const hp = [];
    hp.push(p(sphere(0.21, 14, 10), D, 0, 0, 0, { sy: 0.98, mat: 'soft' }));
    hp.push(p(sphere(0.13, 10, 8), D, 0, -0.12, -0.03, { sy: 0.9, mat: 'soft' })); // cheeks/jowl
    // beak
    hp.push(p(roundedBox(0.17, 0.07, 0.19, 0.033), O, 0, -0.015, 0.19, { rx: 0.06 }));
    hp.push(p(roundedBox(0.14, 0.04, 0.15, 0.019), OD, 0, -0.055, 0.185, { rx: 0.06 }));
    hp.push(p(sphere(0.012, 6, 4), OD, -0.035, 0.015, 0.26));
    hp.push(p(sphere(0.012, 6, 4), OD, 0.035, 0.015, 0.26));
    // simple dot eyes
    for (const sx of [-1, 1]) {
      hp.push(p(sphere(0.042, 10, 8), P.eye, sx * 0.088, 0.055, 0.178, { sz: 0.55, mat: 'matte' }));
      hp.push(p(sphere(0.04, 8, 6), P.blush, sx * 0.158, -0.005, 0.132, { sz: 0.32, sy: 0.68 }));
    }
    head.add(build(hp));
    // helicopter beanie: four felt panels, a rim, a stalk and a propeller
    const hat = new THREE.Group(); hat.position.set(0, 0.168, -0.02);
    const cols = [P.hatA, P.hatB, P.hatC, P.hatD];
    const hpr = [];
    for (let i = 0; i < 4; i++) hpr.push(p(sphere(0.183, 8, 6, { phiS: i * Math.PI / 2, phiL: Math.PI / 2, thetaL: Math.PI / 2 }), cols[i], 0, 0, 0, { sy: 0.82, mat: 'soft' }));
    hpr.push(p(torus(0.182, 0.024, 6, 20), P.hatB, 0, 0.006, 0, { rx: Math.PI / 2 }));
    hpr.push(p(cyl(0.018, 0.024, 0.08, 8), '#c8ccd8', 0, 0.185, 0, { mat: 'shiny' }));
    hat.add(build(hpr));
    head.add(hat);
    const prop = new THREE.Group(); prop.position.set(0, 0.372, -0.018);
    const pp = [p(sphere(0.032, 8, 6), P.hatB, 0, 0, 0, { mat: 'shiny' })];
    for (const sx of [-1, 1]) pp.push(p(roundedBox(0.19, 0.014, 0.05, 0.007), P.prop, sx * 0.112, 0.004, 0, { rz: sx * 0.2, ry: sx * 0.14, mat: 'shiny' }));
    prop.add(build(pp));
    head.add(prop);
    g.add(head);

    // big wings — flat blades that work as the duck's steering surfaces
    const wings = [];
    const bigW = opts.bigWings !== false;
    for (const sx of [-1, 1]) {
      const w = new THREE.Group(); w.position.set(sx * 0.2, 0.46, -0.02);
      const wp = [];
      if (bigW) {
        // the blade reaches outward from the shoulder: long, thin, tapered
        wp.push(p(sphere(0.2, 12, 8), D, sx * 0.2, -0.01, -0.01, { sx: 1.15, sy: 0.19, sz: 0.72, mat: 'soft' }));
        wp.push(p(sphere(0.14, 10, 7), D, sx * 0.42, -0.03, -0.05, { sx: 1.0, sy: 0.2, sz: 0.62, mat: 'soft' }));
        wp.push(p(sphere(0.1, 8, 6), DS, sx * 0.08, 0.01, 0.04, { sx: 1.0, sy: 0.5, sz: 0.9, mat: 'soft' }));
        // primaries fanning back off the tip
        for (let i = 0; i < 4; i++) {
          const a = 0.12 + i * 0.2;
          wp.push(p(cone(0.036, 0.26, 5), i % 2 ? DS : D, sx * (0.52 + i * 0.01), -0.045, -0.06 - i * 0.02,
            { rz: sx * (Math.PI / 2 - a * 0.4), rx: -a, sy: 1, sz: 1.5, mat: 'soft' }));
        }
      } else {
        wp.push(p(sphere(0.13, 10, 8), D, 0, -0.06, 0, { sx: 0.4, sy: 1.0, sz: 1.25, mat: 'soft' }));
        wp.push(p(sphere(0.09, 8, 6), DS, 0, -0.17, -0.03, { sx: 0.36, sy: 0.8, sz: 1.0, mat: 'soft' }));
      }
      w.add(build(wp));
      g.add(w); wings.push(w);
    }
    // lollipop — carried in the beak, so it reads from every angle
    let lolli = null;
    if (opts.lollipop !== false) {
      lolli = new THREE.Group();
      lolli.add(build([p(capsule(0.012, 0.2), P.stick, 0, 0.1, 0, { mat: 'soft' })]));
      const candyMat = new THREE.MeshStandardMaterial({ map: FW.Pixel.spiralTexture(), roughness: 0.22, metalness: 0.0, envMapIntensity: 1.3 });
      const candy = new THREE.Mesh(cyl(0.085, 0.085, 0.03, 20), candyMat);
      candy.rotation.x = Math.PI / 2; candy.position.y = 0.235; candy.castShadow = true;
      const rim = new THREE.Mesh(torus(0.085, 0.016, 6, 20), FW.Pixel.mat(P.candy, { roughness: 0.22 }));
      rim.position.y = 0.235;
      lolli.add(candy, rim);
      if (opts.lollipop === 'wing') { lolli.position.set(0.02, -0.24, 0.06); lolli.rotation.set(0.3, 0, -0.35); wings[1].add(lolli); }
      else { lolli.position.set(0.115, -0.125, 0.19); lolli.rotation.set(-0.5, 0, -0.95); head.add(lolli); }
    }
    g.userData = { head, wings, prop, lolli, body, tail: head };
    return g;
  }

  // ---------- scooter ----------
  function scooter() {
    const g = new THREE.Group();
    const M = P.mint, MD = P.mintDark, S = P.steel;
    const parts = [
      p(roundedBox(0.42, 0.2, 1.0, 0.09), M, 0, 0.34, -0.08, { mat: 'shiny' }),
      p(roundedBox(0.46, 0.34, 0.5, 0.14), M, 0, 0.46, -0.46, { mat: 'shiny' }),
      p(roundedBox(0.4, 0.12, 0.42, 0.055), P.brown, 0, 0.68, -0.44, { mat: 'soft' }),
      p(roundedBox(0.34, 0.06, 0.36, 0.028), '#a06a3c', 0, 0.735, -0.44, { mat: 'soft' }),
      p(roundedBox(0.34, 0.1, 0.62, 0.045), MD, 0, 0.26, -0.06),
      p(capsule(0.035, 0.62), S, 0, 0.62, 0.5, { rx: 0.28, mat: 'metal' }),
      p(roundedBox(0.36, 0.4, 0.2, 0.09), M, 0, 0.54, 0.52, { rx: 0.1, mat: 'shiny' }),
      p(sphere(0.1, 12, 8), P.gold, 0, 0.72, 0.6, { sz: 0.7, mat: 'glow' }),
      p(torus(0.1, 0.02, 6, 12), P.steel, 0, 0.72, 0.615, { mat: 'metal' }),
      p(capsule(0.028, 0.5), S, 0, 0.98, 0.44, { rz: Math.PI / 2, mat: 'metal' }),
      p(capsule(0.045, 0.1), '#3b3340', -0.29, 0.98, 0.44, { rz: Math.PI / 2 }),
      p(capsule(0.045, 0.1), '#3b3340', 0.29, 0.98, 0.44, { rz: Math.PI / 2 }),
      p(sphere(0.035, 8, 6), P.red, -0.36, 0.98, 0.44, { mat: 'glow' }),
      p(sphere(0.035, 8, 6), P.red, 0.36, 0.98, 0.44, { mat: 'glow' }),
      p(roundedBox(0.3, 0.1, 0.06, 0.03), P.red, 0, 0.42, -0.72, { mat: 'glow' }),
      p(capsule(0.022, 0.24), S, -0.16, 0.28, 0.52, { rx: 0.28, mat: 'metal' }),
      p(capsule(0.022, 0.24), S, 0.16, 0.28, 0.52, { rx: 0.28, mat: 'metal' }),
    ];
    g.add(build(parts));
    // wheels
    const wheels = [];
    for (const z of [-0.62, 0.62]) {
      const w = new THREE.Group(); w.position.set(0, 0.3, z);
      w.add(build([
        p(torus(0.24, 0.085, 8, 16), '#33303a', 0, 0, 0, { ry: Math.PI / 2, mat: 'soft' }),
        p(cyl(0.16, 0.16, 0.1, 14), P.steel, 0, 0, 0, { rz: Math.PI / 2, mat: 'metal' }),
        p(cyl(0.05, 0.05, 0.13, 8), '#8f95a6', 0, 0, 0, { rz: Math.PI / 2, mat: 'metal' }),
        p(roundedBox(0.03, 0.26, 0.03, 0.012), '#e8ecf5', 0, 0, 0, { rz: Math.PI / 2, rx: 0.0, mat: 'metal' }),
        p(roundedBox(0.03, 0.26, 0.03, 0.012), '#e8ecf5', 0, 0, 0, { rz: Math.PI / 2, rx: Math.PI / 3, mat: 'metal' }),
        p(roundedBox(0.03, 0.26, 0.03, 0.012), '#e8ecf5', 0, 0, 0, { rz: Math.PI / 2, rx: -Math.PI / 3, mat: 'metal' }),
      ]));
      g.add(w); wheels.push(w);
    }
    // delivery box
    const box = new THREE.Group(); box.position.set(0, 0.72, -0.62);
    box.add(build([
      p(roundedBox(0.52, 0.42, 0.44, 0.08), P.cream, 0, 0, 0, { mat: 'soft' }),
      p(roundedBox(0.54, 0.07, 0.46, 0.03), P.red, 0, 0.16, 0),
      p(roundedBox(0.54, 0.07, 0.46, 0.03), P.red, 0, -0.02, 0),
      p(cyl(0.13, 0.13, 0.03, 14), P.gold, 0, 0.02, 0.225, { rx: Math.PI / 2, mat: 'soft' }),
      p(roundedBox(0.02, 0.2, 0.02, 0.008), P.brown, -0.05, 0.02, 0.24),
      p(roundedBox(0.02, 0.2, 0.02, 0.008), P.brown, 0.05, 0.02, 0.24),
      p(roundedBox(0.2, 0.02, 0.02, 0.008), P.brown, 0, 0.07, 0.24),
      p(roundedBox(0.2, 0.02, 0.02, 0.008), P.brown, 0, -0.03, 0.24),
      p(capsule(0.016, 0.16), P.brown, 0, 0.23, 0, { rz: Math.PI / 2 }),
    ]));
    g.add(box);
    g.userData = { wheels, box };
    return g;
  }

  // ---------- bear ----------
  function bear(scale = 1, light = false) {
    const g = new THREE.Group();
    const C = light ? P.bearLight : P.bear;
    g.add(build([
      p(sphere(0.52, 12, 9), C, 0, 0.62, 0, { sz: 1.35, sy: 0.92, mat: 'soft' }),
      p(sphere(0.3, 10, 8), C, 0, 0.62, -0.62, { sz: 0.7, mat: 'soft' }),
      p(sphere(0.1, 8, 6), C, 0, 0.78, -0.78, { mat: 'soft' }),
    ]));
    const head = new THREE.Group(); head.position.set(0, 0.95, 0.55);
    head.add(build([
      p(sphere(0.34, 12, 9), C, 0, 0, 0, { sy: 0.94, mat: 'soft' }),
      p(sphere(0.19, 10, 8), P.muzzle, 0, -0.09, 0.24, { sz: 0.85, sy: 0.75, mat: 'soft' }),
      p(sphere(0.07, 8, 6), '#241d1b', 0, -0.04, 0.38, { sy: 0.7, mat: 'matte' }),
      p(sphere(0.052, 8, 6), '#241d1b', -0.14, 0.09, 0.285, { sz: 0.6, mat: 'matte' }),
      p(sphere(0.052, 8, 6), '#241d1b', 0.14, 0.09, 0.285, { sz: 0.6, mat: 'matte' }),
      p(sphere(0.13, 8, 6), C, -0.26, 0.26, -0.05, { sz: 0.5, mat: 'soft' }),
      p(sphere(0.13, 8, 6), C, 0.26, 0.26, -0.05, { sz: 0.5, mat: 'soft' }),
      p(sphere(0.08, 8, 6), P.muzzle, -0.27, 0.27, 0.0, { sz: 0.35, mat: 'soft' }),
      p(sphere(0.08, 8, 6), P.muzzle, 0.27, 0.27, 0.0, { sz: 0.35, mat: 'soft' }),
    ]));
    g.add(head);
    const legs = [];
    for (const [x, z] of [[-0.3, 0.42], [0.3, 0.42], [-0.32, -0.42], [0.32, -0.42]]) {
      const l = new THREE.Group(); l.position.set(x, 0.5, z);
      l.add(build([
        p(capsule(0.16, 0.16), C, 0, -0.2, 0, { mat: 'soft' }),
        p(sphere(0.16, 8, 6), P.muzzle, 0, -0.36, 0.03, { sy: 0.55, sz: 1.1, mat: 'soft' }),
      ]));
      g.add(l); legs.push(l);
    }
    g.scale.setScalar(scale);
    g.userData = { head, legs };
    return g;
  }

  // ---------- critter customers ----------
  const CRITTERS = {
    raccoon: { body: '#9096a6', belly: '#dfe3ec', mask: '#3a3340', ear: 'small', tail: '#767c8c' },
    rabbit: { body: '#f6f2ea', belly: '#ffffff', ear: 'long', innerEar: '#ffb3b3', tail: '#ffffff' },
    fox: { body: '#e5843f', belly: '#fff1dc', ear: 'small', tail: '#e5843f', tailTip: '#ffffff' },
    deer: { body: '#c9995e', belly: '#efd9b3', ear: 'small', tail: '#efd9b3' },
    squirrel: { body: '#b4562f', belly: '#f5d9b8', ear: 'small', tail: '#b4562f', bigTail: true },
    otter: { body: '#8a6244', belly: '#c9a177', ear: 'small', tail: '#8a6244' },
  };
  function critter(kind, acc) {
    const c = CRITTERS[kind] || CRITTERS.raccoon;
    const g = new THREE.Group();
    const parts = [
      p(sphere(0.26, 12, 9), c.body, 0, 0.3, 0, { sy: 1.1, mat: 'soft' }),
      p(sphere(0.17, 10, 8), c.belly, 0, 0.28, 0.14, { sz: 0.6, sy: 1.05, mat: 'soft' }),
      p(capsule(0.06, 0.04), c.body, -0.19, 0.14, 0.04, { rz: 0.3 }),
      p(capsule(0.06, 0.04), c.body, 0.19, 0.14, 0.04, { rz: -0.3 }),
      p(sphere(0.09, 8, 6), c.body, -0.12, 0.06, 0.1, { sz: 1.4, sy: 0.6 }),
      p(sphere(0.09, 8, 6), c.body, 0.12, 0.06, 0.1, { sz: 1.4, sy: 0.6 }),
    ];
    if (c.bigTail) { parts.push(p(sphere(0.16, 10, 8), c.tail, 0, 0.46, -0.26, { sx: 0.55, sy: 1.5, sz: 0.8, rx: -0.3, mat: 'soft' })); parts.push(p(sphere(0.1, 8, 6), c.belly, 0, 0.6, -0.24, { sx: 0.4, sy: 0.9, sz: 0.5, mat: 'soft' })); }
    else { parts.push(p(capsule(0.075, 0.14), c.tail, 0, 0.26, -0.28, { rx: 0.9, mat: 'soft' })); }
    if (c.tailTip) parts.push(p(sphere(0.08, 8, 6), c.tailTip, 0, 0.34, -0.4, { mat: 'soft' }));
    g.add(build(parts));
    const head = new THREE.Group(); head.position.set(0, 0.58, 0.03);
    const hp = [
      p(sphere(0.2, 12, 9), c.body, 0, 0, 0, { mat: 'soft' }),
      p(sphere(0.1, 8, 6), c.belly, 0, -0.05, 0.15, { sz: 0.7, sy: 0.7, mat: 'soft' }),
      p(sphere(0.028, 6, 5), '#241d1b', 0, -0.02, 0.21, { mat: 'matte' }),
      p(sphere(0.036, 8, 6), '#241d1b', -0.086, 0.05, 0.17, { sz: 0.6, mat: 'matte' }),
      p(sphere(0.036, 8, 6), '#241d1b', 0.086, 0.05, 0.17, { sz: 0.6, mat: 'matte' }),
    ];
    if (c.mask) { hp.push(p(sphere(0.075, 8, 6), c.mask, -0.085, 0.045, 0.155, { sz: 0.4, sy: 0.8 })); hp.push(p(sphere(0.075, 8, 6), c.mask, 0.085, 0.045, 0.155, { sz: 0.4, sy: 0.8 })); }
    if (c.ear === 'long') {
      for (const sx of [-1, 1]) { hp.push(p(capsule(0.045, 0.18), c.body, sx * 0.075, 0.28, -0.01, { rz: sx * 0.14, sx: 0.7, mat: 'soft' })); hp.push(p(capsule(0.024, 0.13), c.innerEar, sx * 0.078, 0.28, 0.025, { rz: sx * 0.14, sx: 0.7 })); }
    } else {
      for (const sx of [-1, 1]) { hp.push(p(sphere(0.075, 8, 6), c.body, sx * 0.13, 0.18, -0.02, { sz: 0.55, mat: 'soft' })); hp.push(p(sphere(0.045, 6, 5), c.belly, sx * 0.135, 0.18, 0.005, { sz: 0.4 })); }
    }
    head.add(build(hp));
    if (acc === 'ranger') head.add(build([p(cyl(0.13, 0.15, 0.13, 12), '#8a6a3c', 0, 0.21, 0, { mat: 'soft' }), p(cyl(0.27, 0.29, 0.03, 14), '#8a6a3c', 0, 0.16, 0, { mat: 'soft' }), p(torus(0.14, 0.018, 6, 12), '#5a4326', 0, 0.17, 0, { rx: Math.PI / 2 })]));
    if (acc === 'beanie') head.add(build([p(sphere(0.19, 10, 7, { thetaL: Math.PI / 2 }), P.red, 0, 0.06, 0, { sy: 0.85, mat: 'soft' }), p(torus(0.185, 0.028, 6, 14), P.cream, 0, 0.07, 0, { rx: Math.PI / 2 }), p(sphere(0.05, 8, 6), P.cream, 0, 0.24, 0, { mat: 'soft' })]));
    if (acc === 'cap') head.add(build([p(sphere(0.19, 10, 7, { thetaL: Math.PI / 2 }), '#3aa6a6', 0, 0.05, 0, { sy: 0.7, mat: 'soft' }), p(roundedBox(0.24, 0.03, 0.16, 0.014), '#2e8a8a', 0, 0.06, 0.19, { rx: -0.1 })]));
    if (acc === 'flower') head.add(build([p(sphere(0.035, 6, 5), P.gold, 0.13, 0.17, 0.06), ...[0, 1, 2, 3, 4].map((i) => p(sphere(0.032, 6, 5), '#ffb3b3', 0.13 + Math.cos(i * 1.26) * 0.05, 0.17 + Math.sin(i * 1.26) * 0.05, 0.06, { sz: 0.6 }))]));
    if (acc === 'camera') g.add(build([p(roundedBox(0.16, 0.11, 0.07, 0.025), '#3a3340', 0, 0.3, 0.2, { mat: 'shiny' }), p(cyl(0.045, 0.045, 0.05, 10), '#8f95a6', 0, 0.3, 0.26, { rx: Math.PI / 2, mat: 'metal' })]));
    if (acc === 'backpack') g.add(build([p(roundedBox(0.24, 0.26, 0.13, 0.06), '#4f9a5c', 0, 0.34, -0.22, { mat: 'soft' }), p(roundedBox(0.16, 0.05, 0.04, 0.02), P.brown, 0, 0.3, -0.29)]));
    g.userData = { head };
    return g;
  }

  // ---------- vegetation: a tall, dark North American conifer forest ----------
  // Geometries are metres at scale 1 and get instanced in chunks by the world.
  const FOL = { firA: '#2b5c41', firB: '#33694a', firC: '#3d7757', pineA: '#376d4a', pineB: '#427c58', cedar: '#265239', oak: '#4c7f44', seq: '#306849' };
  const BARK = { fir: '#5a4636', pine: '#95693f', cedar: '#5c4633', oak: '#6a5643', seq: '#9c5433', snag: '#a89e93' };

  // Douglas fir: a tall narrow spire, the backbone of the forest
  const firGeo = () => {
    const parts = [p(cyl(0.2, 0.46, 17, 6), BARK.fir, 0, 8.5, 0)];
    const layers = [[2.6, 3.4, 3.6], [5.4, 3.2, 3.0], [8.1, 3.0, 2.4], [10.7, 2.8, 1.8], [13.1, 2.6, 1.25], [15.3, 2.4, 0.7]];
    layers.forEach(([y, h, r], i) => parts.push(p(cone(r, h, 6), i % 3 === 0 ? FOL.firA : i % 3 === 1 ? FOL.firB : FOL.firC, 0, y + h / 2, 0)));
    return geoOf(parts);
  };
  // Ponderosa pine: long clean trunk, canopy only up top
  const pineGeo = () => geoOf([
    p(cyl(0.26, 0.5, 15, 6), BARK.pine, 0, 7.5, 0),
    p(sphere(2.5, 7, 4), FOL.pineA, 0, 14.2, 0, { sy: 0.62 }),
    p(sphere(2.0, 6, 4), FOL.pineB, 1.4, 15.6, 0.5, { sy: 0.62 }),
    p(sphere(1.8, 6, 4), FOL.pineA, -1.5, 15.3, -0.4, { sy: 0.62 }),
    p(cone(1.3, 2.6, 6), FOL.pineB, 0, 17.6, 0),
  ]);
  // Incense cedar: dense dark column
  const cedarGeo = () => {
    const parts = [p(cyl(0.24, 0.55, 12, 6), BARK.cedar, 0, 6, 0)];
    for (let i = 0; i < 5; i++) { const y = 1.8 + i * 2.3, r = 2.5 - i * 0.4; parts.push(p(cone(r, 3.2, 6), i % 2 ? FOL.cedar : FOL.firA, 0, y + 1.6, 0)); }
    return geoOf(parts);
  };
  const sequoiaGeo = () => geoOf([
    p(cyl(0.9, 2.1, 22, 8), BARK.seq, 0, 11, 0),
    p(cyl(2.1, 3.1, 3, 8), BARK.seq, 0, 1.5, 0),
    p(sphere(3.6, 8, 5), FOL.seq, 0, 23.5, 0, { sy: 0.66 }),
    p(sphere(2.9, 7, 4), FOL.firB, 2.2, 25.6, 0.8, { sy: 0.66 }),
    p(sphere(2.7, 6, 4), FOL.seq, -2.3, 25.2, -0.7, { sy: 0.66 }),
    p(cone(2.0, 4.4, 7), FOL.firC, 0, 28.6, 0),
  ]);
  // California black oak: broad round canopy on the valley floor
  const oakGeo = (gold) => geoOf([
    p(cyl(0.3, 0.55, 4.6, 6), BARK.oak, 0, 2.3, 0),
    p(cyl(0.1, 0.16, 1.6, 5), BARK.oak, 0.9, 4.6, 0.2, { rz: -0.75 }),
    p(cyl(0.1, 0.16, 1.6, 5), BARK.oak, -0.9, 4.7, -0.3, { rz: 0.8 }),
    p(sphere(2.5, 8, 5), gold ? '#c1953f' : FOL.oak, 0, 6.4, 0, { sy: 0.82 }),
    p(sphere(1.9, 7, 4), gold ? '#d2ab52' : '#55884c', 1.7, 7.1, 0.7, { sy: 0.8 }),
    p(sphere(1.8, 6, 4), gold ? '#b08838' : '#406b42', -1.8, 6.9, -0.6, { sy: 0.8 }),
  ]);
  // dead standing snag — reads as old-growth forest
  const snagGeo = () => geoOf([
    p(cyl(0.18, 0.44, 11, 5), BARK.snag, 0, 5.5, 0),
    p(cyl(0.07, 0.11, 1.5, 4), BARK.snag, 0.75, 7.4, 0.1, { rz: -0.9 }),
    p(cyl(0.06, 0.09, 1.1, 4), BARK.snag, -0.6, 8.6, -0.2, { rz: 1.0 }),
    p(cone(0.3, 0.9, 5), BARK.snag, 0, 11.4, 0),
  ]);
  // fallen log with a root plate
  const deadfallGeo = () => geoOf([
    p(cyl(0.42, 0.5, 7.5, 7), BARK.fir, 0, 0.46, 0, { rz: Math.PI / 2 }),
    p(sphere(0.85, 6, 4), '#3d3026', -3.9, 0.6, 0, { sx: 0.4 }),
    p(sphere(0.5, 6, 4), '#4c8a60', 0.6, 0.85, 0.1, { sy: 0.42 }),
    p(sphere(0.42, 6, 4), FOL.firB, -1.4, 0.82, -0.15, { sy: 0.42 }),
  ]);
  // sword ferns on the forest floor
  const fernGeo = () => {
    const parts = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      parts.push(p(cone(0.16, 0.8, 4), i % 2 ? '#3c7a58' : '#488a63', Math.cos(a) * 0.2, 0.36, Math.sin(a) * 0.2,
        { rx: Math.sin(a) * 0.7, rz: -Math.cos(a) * 0.7, sx: 0.5, sz: 0.85 }));
    }
    return geoOf(parts);
  };
  const bushGeo = () => geoOf([
    p(sphere(0.66, 7, 5), '#3a6f4e', 0, 0.44, 0, { sy: 0.78 }),
    p(sphere(0.48, 6, 4), '#437c58', 0.44, 0.38, 0.22, { sy: 0.78 }),
    p(sphere(0.42, 6, 4), '#2f6244', -0.42, 0.36, -0.22, { sy: 0.78 }),
  ]);
  const rockGeo = () => geoOf([
    p(blob(0.85, 0), P.granite[0], 0, 0.45, 0, { sy: 0.75, sz: 0.9 }),
    p(blob(0.5, 0), P.granite[1], 0.55, 0.3, 0.25, { sy: 0.8 }),
    p(blob(0.35, 0), P.granite[2], -0.5, 0.22, -0.3),
  ]);
  const flowerGeo = () => {
    const parts = [];
    const cols = ['#ffb3b3', '#fff6a8', '#c9a0f0', '#ffffff', '#ff8fa3'];
    for (let i = 0; i < 3; i++) {
      const a = i * 2.09, r = 0.12 + (i % 2) * 0.1, x = Math.cos(a) * r, z = Math.sin(a) * r;
      parts.push(p(cyl(0.012, 0.016, 0.22, 4), '#4f9a5c', x, 0.11, z));
      parts.push(p(sphere(0.075, 6, 4), cols[i], x, 0.25, z, { sy: 0.55 }));
    }
    return geoOf(parts);
  };
  const mushroomGeo = () => geoOf([
    p(cyl(0.16, 0.22, 0.5, 9), '#fff3dc', 0, 0.25, 0),
    p(sphere(0.62, 12, 8, { thetaL: Math.PI / 2 }), P.red, 0, 0.46, 0, { sy: 0.85 }),
    p(cyl(0.6, 0.62, 0.06, 12), '#c9463c', 0, 0.46, 0),
    ...[[0.3, 0, 0.2], [-0.28, 0.12, 0.22], [0.1, 0.3, 0.25], [-0.1, -0.3, 0.24], [0.35, -0.2, 0.15]].map(([x, z, y]) => p(sphere(0.1, 7, 5), '#fff3dc', x, 0.46 + y + 0.28, z, { sy: 0.5 })),
  ]);
  const stumpGeo = () => geoOf([p(cyl(0.5, 0.62, 0.8, 7), BARK.fir, 0, 0.4, 0), p(cyl(0.46, 0.46, 0.07, 7), '#b99a72', 0, 0.82, 0)]);
  const fenceGeo = (len = 3) => geoOf([
    p(capsule(0.075, 0.75), P.wood, -len / 2 + 0.1, 0.5, 0),
    p(capsule(0.075, 0.75), P.wood, len / 2 - 0.1, 0.5, 0),
    p(capsule(0.055, len - 0.5), P.wood2, 0, 0.42, 0, { rz: Math.PI / 2 }),
    p(capsule(0.055, len - 0.5), P.wood2, 0, 0.78, 0, { rz: Math.PI / 2 }),
  ]);
  // steel W-beam highway guardrail — grindable, and very Yosemite roadside
  const guardrailGeo = (len = 4) => geoOf([
    p(roundedBox(len, 0.3, 0.07, 0.03), '#b8bec9', 0, 0.72, 0, { mat: 'metal' }),
    p(roundedBox(len, 0.09, 0.11, 0.035), '#98a0ac', 0, 0.72, 0.02, { mat: 'metal' }),
    p(roundedBox(0.11, 0.78, 0.11, 0.03), '#8d949f', -len / 2 + 0.2, 0.39, -0.03, { mat: 'metal' }),
    p(roundedBox(0.11, 0.78, 0.11, 0.03), '#8d949f', len / 2 - 0.2, 0.39, -0.03, { mat: 'metal' }),
  ]);

  // ---------- cars ----------
  const CAR_KINDS = {
    sedan: { body: '#c8493f', roof: '#a83a32', w: 1.72, l: 4.3, h: 0.62, cab: 0.5, cabL: 2.0, cabZ: -0.1 },
    wagon: { body: '#3f6fa8', roof: '#33578a', w: 1.78, l: 4.6, h: 0.66, cab: 0.58, cabL: 2.7, cabZ: -0.3 },
    hatch: { body: '#e8e4da', roof: '#d4cfc2', w: 1.66, l: 3.9, h: 0.6, cab: 0.52, cabL: 1.9, cabZ: -0.15 },
    ranger: { body: '#2f5d3a', roof: '#264c30', w: 1.9, l: 5.0, h: 0.78, cab: 0.62, cabL: 1.7, cabZ: 0.5, bed: true, bar: true },
    rv: { body: '#efe9db', roof: '#d8d1c0', w: 2.1, l: 6.6, h: 1.5, cab: 0.5, cabL: 1.6, cabZ: 2.1, tall: true },
    shuttle: { body: '#3c7d55', roof: '#f0ede4', w: 2.2, l: 7.4, h: 1.6, cab: 0.4, cabL: 1.5, cabZ: 2.6, tall: true, bus: true },
  };
  function car(kind = 'sedan') {
    const c = CAR_KINDS[kind] || CAR_KINDS.sedan;
    const g = new THREE.Group();
    const parts = [];
    const bodyY = 0.42 + c.h / 2;
    parts.push(p(roundedBox(c.w, c.h, c.l, 0.2), c.body, 0, bodyY, 0, { mat: 'shiny' }));
    if (c.tall) {
      parts.push(p(roundedBox(c.w - 0.06, c.h * 0.5, c.l - 0.5, 0.14), c.roof, 0, bodyY + c.h * 0.62, -0.1, { mat: 'shiny' }));
      parts.push(p(roundedBox(c.w - 0.14, 0.5, c.l * 0.62, 0.1), '#2b3138', 0, bodyY + c.h * 0.2, -0.4, { mat: 'shiny' }));
      if (c.bus) for (let i = 0; i < 3; i++) parts.push(p(roundedBox(c.w + 0.02, 0.44, 1.5, 0.08), '#39414a', 0, bodyY + c.h * 0.22, -2.1 + i * 1.7, { mat: 'shiny' }));
    } else {
      parts.push(p(roundedBox(c.w - 0.22, c.cab, c.cabL, 0.22), c.roof, 0, bodyY + c.h / 2 + c.cab / 2 - 0.06, c.cabZ, { mat: 'shiny' }));
      parts.push(p(roundedBox(c.w - 0.14, c.cab * 0.72, c.cabL * 0.92, 0.16), '#39414a', 0, bodyY + c.h / 2 + c.cab / 2 - 0.08, c.cabZ, { mat: 'shiny' }));
    }
    if (c.bed) parts.push(p(roundedBox(c.w - 0.14, 0.34, 2.0, 0.08), '#243d29', 0, bodyY + c.h / 2 + 0.1, -1.4));
    if (c.bar) { parts.push(p(roundedBox(0.7, 0.12, 0.18, 0.05), '#f7c544', 0, bodyY + c.h / 2 + c.cab, c.cabZ, { mat: 'glow' })); }
    // lights + plates
    parts.push(p(roundedBox(0.34, 0.16, 0.06, 0.05), '#fff6d8', -c.w / 2 + 0.34, bodyY + 0.02, c.l / 2 - 0.02, { mat: 'glow' }));
    parts.push(p(roundedBox(0.34, 0.16, 0.06, 0.05), '#fff6d8', c.w / 2 - 0.34, bodyY + 0.02, c.l / 2 - 0.02, { mat: 'glow' }));
    parts.push(p(roundedBox(0.3, 0.14, 0.06, 0.05), '#d94a45', -c.w / 2 + 0.32, bodyY + 0.04, -c.l / 2 + 0.02, { mat: 'glow' }));
    parts.push(p(roundedBox(0.3, 0.14, 0.06, 0.05), '#d94a45', c.w / 2 - 0.32, bodyY + 0.04, -c.l / 2 + 0.02, { mat: 'glow' }));
    parts.push(p(roundedBox(c.w - 0.1, 0.12, 0.1, 0.04), '#8d949f', 0, bodyY - c.h / 2 + 0.02, c.l / 2, { mat: 'metal' }));
    parts.push(p(roundedBox(c.w - 0.1, 0.12, 0.1, 0.04), '#8d949f', 0, bodyY - c.h / 2 + 0.02, -c.l / 2, { mat: 'metal' }));
    // wheels
    const wz = c.l / 2 - 0.9;
    for (const sx of [-1, 1]) for (const z of [wz, -wz]) {
      parts.push(p(torus(0.3, 0.12, 7, 12), '#2b2b30', sx * (c.w / 2 - 0.06), 0.42, z, { ry: Math.PI / 2, mat: 'soft' }));
      parts.push(p(cyl(0.17, 0.17, 0.1, 10), '#c8ccd8', sx * (c.w / 2 - 0.04), 0.42, z, { rz: Math.PI / 2, mat: 'metal' }));
    }
    g.add(build(parts));
    g.userData = { kind, len: c.l, wid: c.w, radius: Math.max(c.w, c.l * 0.42) * 0.5 + 0.35 };
    return g;
  }

  // ---------- waffle & toppings ----------
  function waffle(scale = 1) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: '#e8a94a', roughness: 0.72, metalness: 0, envMapIntensity: 0.6 });
    const parts = [];
    const R = 0.62;
    parts.push(p(cyl(R, R * 0.94, 0.15, 20), '#ffffff', 0, 0, 0));
    parts.push(p(torus(R - 0.03, 0.06, 6, 20), '#ffffff', 0, 0.01, 0));
    for (const v of [-0.42, -0.14, 0.14, 0.42]) {
      const half = Math.sqrt(Math.max(0.01, R * R - v * v)) * 0.94;
      parts.push(p(roundedBox(0.075, 0.1, half * 2, 0.035), '#ffffff', v, 0.09, 0));
      parts.push(p(roundedBox(half * 2, 0.1, 0.075, 0.035), '#ffffff', 0, 0.09, v));
    }
    const merged = mergeParts(parts.map((q) => Object.assign({}, q, { mat: 'soft' })));
    const mesh = new THREE.Mesh(merged[0].geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
    g.scale.setScalar(scale);
    g.userData.top = 0.15;
    g.userData.mat = mat;
    g.userData.setDoneness = (t) => {
      const a = new THREE.Color('#f7e4b4'), b = new THREE.Color('#e09a3c'), c = new THREE.Color('#5c3418');
      mat.color.copy(t < 0.5 ? a.lerp(b, t * 2) : b.lerp(c, (t - 0.5) * 2));
    };
    g.userData.setDoneness(0.5);
    return g;
  }
  const TOPPINGS = {
    butter: { name: 'Butter', color: '#ffdf7e', parts: () => [p(roundedBox(0.2, 0.11, 0.2, 0.03), '#ffdf7e', 0, 0.05, 0, { mat: 'soft' })] },
    syrup: { name: 'Maple Syrup', color: '#8a4b1a', parts: () => [p(sphere(0.4, 14, 8), '#8a4b1a', 0, 0.015, 0, { sy: 0.09, mat: 'shiny' }), p(sphere(0.22, 10, 7), '#7a3f14', 0.16, 0.02, -0.12, { sy: 0.12, mat: 'shiny' }), p(sphere(0.16, 8, 6), '#9c5a22', -0.2, 0.02, 0.14, { sy: 0.12, mat: 'shiny' })] },
    strawberry: { name: 'Strawberries', color: '#e8434d', parts: () => [-1, 0, 1].map((i) => p(sphere(0.11, 9, 7), '#e8434d', i * 0.2, 0.09, i === 0 ? 0.16 : -0.08, { sy: 1.25 })).concat([-1, 0, 1].map((i) => p(sphere(0.05, 6, 4), '#4caf50', i * 0.2, 0.2, i === 0 ? 0.16 : -0.08, { sy: 0.5 }))) },
    blueberry: { name: 'Blueberries', color: '#4e5fbf', parts: () => [[0.16, 0.1], [-0.1, 0.2], [0.02, -0.16], [0.24, -0.1], [-0.22, -0.05]].map(([x, z]) => p(sphere(0.078, 8, 6), '#4e5fbf', x, 0.07, z, { mat: 'soft' })) },
    banana: { name: 'Banana', color: '#f7e27a', parts: () => [[-0.2, 0.05], [0.02, 0.14], [0.22, 0.02]].map(([x, z]) => p(cyl(0.1, 0.1, 0.05, 10), '#f7e27a', x, 0.05, z, { mat: 'soft' })).concat([[-0.2, 0.05], [0.02, 0.14], [0.22, 0.02]].map(([x, z]) => p(sphere(0.018, 5, 4), '#8a6a3c', x, 0.08, z))) },
    choco: { name: 'Choco Chips', color: '#4a2c1a', parts: () => [[0.2, 0.16], [-0.16, 0.2], [0.05, -0.05], [0.28, -0.14], [-0.26, -0.1], [-0.02, 0.3], [0.14, -0.28]].map(([x, z]) => p(cone(0.055, 0.09, 7), '#4a2c1a', x, 0.06, z, { mat: 'shiny' })) },
    cream: { name: 'Whipped Cream', color: '#fffdf6', parts: () => [p(sphere(0.19, 10, 8), '#fffdf6', 0, 0.08, 0, { mat: 'soft' }), p(sphere(0.14, 9, 7), '#fffdf6', 0.02, 0.19, 0, { mat: 'soft' }), p(sphere(0.09, 8, 6), '#fffdf6', -0.01, 0.28, 0.01, { mat: 'soft' }), p(cone(0.05, 0.09, 7), '#fffdf6', 0, 0.36, 0, { mat: 'soft' })] },
    honey: { name: 'Honey', color: '#e9a81e', parts: () => [p(sphere(0.33, 12, 8), '#e9a81e', 0, 0.015, 0, { sy: 0.1, mat: 'shiny' }), p(sphere(0.2, 9, 6), '#f0b83a', -0.16, 0.02, 0.16, { sy: 0.12, mat: 'shiny' }), p(sphere(0.14, 8, 6), '#d99a14', 0.2, 0.02, -0.14, { sy: 0.12, mat: 'shiny' })] },
  };
  function toppingMesh(k, scale = 1) {
    const g = build(TOPPINGS[k].parts());
    g.scale.setScalar(scale);
    g.name = 'top_' + k;
    return g;
  }

  // ---------- buildings ----------
  function barrelRoof(w, d, h, c1, c2, y) {
    const parts = [];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), a = t * Math.PI;
      const x = -Math.cos(a) * w / 2, hy = Math.sin(a) * h;
      parts.push(p(capsule(0.22, d - 0.44), i % 2 ? c2 : c1, x, y + hy, 0, { rx: Math.PI / 2, mat: 'soft' }));
    }
    return parts;
  }
  function shack() {
    const g = new THREE.Group();
    const C = '#fff3dc';
    const parts = [
      p(roundedBox(7.2, 3.6, 5.6, 0.55), C, 0, 1.8, 0, { mat: 'soft' }),
      p(roundedBox(7.4, 0.4, 5.8, 0.18), P.brown, 0, 0.18, 0),
      p(cyl(0.22, 0.26, 3.6, 8), P.wood, -3.5, 1.8, 2.7),
      p(cyl(0.22, 0.26, 3.6, 8), P.wood, 3.5, 1.8, 2.7),
      // service window
      p(roundedBox(4.4, 2.0, 0.4, 0.24), '#3d2c1e', 0, 2.0, 2.75),
      p(roundedBox(4.8, 0.36, 0.7, 0.16), P.wood, 0, 1.05, 2.95),
      p(roundedBox(4.9, 0.22, 0.55, 0.1), P.gold, 0, 3.15, 2.95),
      // round windows
      p(cyl(0.62, 0.62, 0.3, 14), '#a5d8f3', -2.6, 2.1, 2.82, { rx: Math.PI / 2, mat: 'shiny' }),
      p(torus(0.66, 0.11, 6, 16), C, -2.6, 2.1, 2.86),
      p(cyl(0.62, 0.62, 0.3, 14), '#a5d8f3', 2.6, 2.1, 2.82, { rx: Math.PI / 2, mat: 'shiny' }),
      p(torus(0.66, 0.11, 6, 16), C, 2.6, 2.1, 2.86),
      // chimney
      p(cyl(0.36, 0.42, 2.4, 10), P.granite[0], 2.2, 4.6, -1.2),
      p(cyl(0.5, 0.46, 0.3, 10), P.granite[2], 2.2, 5.9, -1.2),
      // flower boxes
      p(roundedBox(1.5, 0.34, 0.4, 0.12), P.wood2, -2.6, 1.35, 3.05),
      p(roundedBox(1.5, 0.34, 0.4, 0.12), P.wood2, 2.6, 1.35, 3.05),
    ];
    for (const bx of [-2.6, 2.6]) for (let i = 0; i < 3; i++) { const cs = ['#ffb3b3', '#fff6a8', '#c9a0f0']; parts.push(p(sphere(0.16, 8, 6), cs[i], bx - 0.45 + i * 0.45, 1.62, 3.05, { sy: 0.7, mat: 'soft' })); }
    parts.push(...barrelRoof(8.2, 6.6, 1.7, P.red, '#c9463c', 3.6));
    g.add(build(parts));
    // giant waffle sign on the roof
    const w = waffle(1.5); w.position.set(-1.5, 5.6, 0.4); w.rotation.set(-0.42, 0.35, 0.16); g.add(w);
    const berry = new THREE.Mesh(sphere(0.2, 10, 8), FW.Pixel.mat('#e8434d', { roughness: 0.5 })); berry.position.set(-1.4, 5.95, 0.6); berry.castShadow = true; g.add(berry);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.0), new THREE.MeshBasicMaterial({ map: FW.Pixel.textTexture("FLIPPIN' WAFFLES", { w: 512, h: 112, font: 'bold 58px monospace', fg: '#8a4b1a', bg: '#fff3dc', border: '#e5564a', radius: 24 }), transparent: true }));
    sign.position.set(0, 3.35, 2.98); g.add(sign);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.55), new THREE.MeshBasicMaterial({ map: FW.Pixel.textTexture('DELIVERY BY DUCK', { w: 384, h: 80, font: 'bold 36px monospace', fg: '#fff3dc', bg: '#e5564a', border: '#8a4b1a', radius: 18 }), transparent: true }));
    s2.position.set(2.0, 4.6, 1.4); s2.rotation.set(-0.3, -0.4, 0.1); g.add(s2);
    g.userData.chimney = new THREE.Vector3(2.2, 6.1, -1.2);
    return g;
  }
  function cabin(roof = '#4f7d4a') {
    const parts = [];
    for (let i = 0; i < 6; i++) parts.push(p(capsule(0.28, 4.4), P.wood, 0, 0.35 + i * 0.55, 0, { rz: Math.PI / 2, sz: 1, mat: 'soft' }));
    for (let i = 0; i < 6; i++) { parts.push(p(capsule(0.28, 3.2), P.wood2, -2.5, 0.35 + i * 0.55, 0, { rx: Math.PI / 2, mat: 'soft' })); parts.push(p(capsule(0.28, 3.2), P.wood2, 2.5, 0.35 + i * 0.55, 0, { rx: Math.PI / 2, mat: 'soft' })); }
    parts.push(p(roundedBox(1.2, 2.0, 0.3, 0.16), P.brown, 0, 1.0, 2.0));
    parts.push(p(sphere(0.09, 8, 6), P.gold, 0.4, 1.0, 2.16, { mat: 'metal' }));
    parts.push(p(cyl(0.45, 0.45, 0.25, 12), '#a5d8f3', -1.6, 1.6, 2.0, { rx: Math.PI / 2, mat: 'shiny' }));
    parts.push(p(torus(0.48, 0.09, 6, 14), P.cream, -1.6, 1.6, 2.04));
    parts.push(p(cyl(0.45, 0.45, 0.25, 12), '#a5d8f3', 1.6, 1.6, 2.0, { rx: Math.PI / 2, mat: 'shiny' }));
    parts.push(p(torus(0.48, 0.09, 6, 14), P.cream, 1.6, 1.6, 2.04));
    parts.push(p(cyl(0.3, 0.34, 1.8, 8), P.granite[0], 1.6, 4.0, -1.0));
    parts.push(...barrelRoof(6.0, 5.0, 1.4, roof, roof === '#4f7d4a' ? '#3e6a3a' : '#7a4c30', 3.3));
    const g = new THREE.Group(); g.add(build(parts));
    g.userData.chimney = new THREE.Vector3(1.6, 5.0, -1.0);
    return g;
  }
  function rangerStation() {
    const G = '#4f7d4a', W = P.cream;
    const parts = [
      p(roundedBox(6.4, 3.0, 4.8, 0.45), G, 0, 1.5, 0, { mat: 'soft' }),
      p(roundedBox(7.2, 0.35, 5.8, 0.16), P.wood, 0, 0.2, 0.4),
      p(roundedBox(1.3, 2.2, 0.3, 0.16), W, 0, 1.1, 2.45),
      p(cyl(0.55, 0.55, 0.28, 14), '#a5d8f3', -2.0, 1.8, 2.45, { rx: Math.PI / 2, mat: 'shiny' }),
      p(torus(0.58, 0.1, 6, 14), W, -2.0, 1.8, 2.5),
      p(cyl(0.55, 0.55, 0.28, 14), '#a5d8f3', 2.0, 1.8, 2.45, { rx: Math.PI / 2, mat: 'shiny' }),
      p(torus(0.58, 0.1, 6, 14), W, 2.0, 1.8, 2.5),
      p(capsule(0.11, 2.6), W, -3.3, 1.6, 2.9), p(capsule(0.11, 2.6), W, 3.3, 1.6, 2.9),
      p(capsule(0.07, 5.0), P.steel, 4.6, 2.8, 1.6, { mat: 'metal' }),
      p(roundedBox(1.1, 0.7, 0.06, 0.05), P.red, 5.2, 5.0, 1.6),
      p(sphere(0.12, 8, 6), P.gold, 4.6, 5.5, 1.6, { mat: 'metal' }),
    ];
    parts.push(...barrelRoof(7.4, 5.6, 1.5, '#8a5a3c', '#7a4c30', 3.0));
    const g = new THREE.Group(); g.add(build(parts));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.72), new THREE.MeshBasicMaterial({ map: FW.Pixel.textTexture('RANGER STATION', { w: 512, h: 108, font: 'bold 52px monospace', fg: '#fff3dc', bg: '#4f7d4a', border: '#2f5a34', radius: 22 }), transparent: true }));
    sign.position.set(0, 2.75, 2.48); g.add(sign);
    return g;
  }
  function tent(color) {
    const parts = [];
    const n = 8;
    for (let i = 0; i < n; i++) { const t = i / (n - 1), y = t * 2.0, r = (1 - t * t) * 1.5 + 0.12; parts.push(p(cyl(r * 0.92, r, 0.3, 10), i % 2 ? shade(color, 0.86) : color, 0, y + 0.12, 0, { sz: 1.5, mat: 'soft' })); }
    parts.push(p(sphere(0.5, 10, 8), '#3d2c1e', 0, 0.5, 1.75, { sz: 0.4, sy: 1.1 }));
    parts.push(p(capsule(0.06, 2.2), P.wood, 0, 2.15, 0, { rx: Math.PI / 2 }));
    parts.push(p(sphere(0.12, 8, 6), P.gold, 0, 2.3, 1.3, { mat: 'glow' }));
    return build(parts);
  }
  function shade(hex, f) { const c = new THREE.Color(hex); c.multiplyScalar(f); return '#' + c.getHexString(); }
  function campfire() {
    const g = new THREE.Group();
    const parts = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; parts.push(p(blob(0.24, 0), P.granite[i % 3], Math.cos(a) * 0.85, 0.1, Math.sin(a) * 0.85, { sy: 0.7 })); }
    parts.push(p(capsule(0.11, 0.8), P.trunk, 0, 0.14, 0, { rz: Math.PI / 2, ry: 0.6 }));
    parts.push(p(capsule(0.11, 0.8), P.trunk, 0, 0.22, 0, { rz: Math.PI / 2, ry: -0.7 }));
    g.add(build(parts));
    const flames = [];
    [['#f0872a', 0.3, 0.55], ['#f7c544', 0.2, 0.4], ['#e5564a', 0.14, 0.7]].forEach(([c, r, h], i) => {
      const f = new THREE.Mesh(cone(r, h, 8), FW.Pixel.flat(c));
      f.position.set((i - 1) * 0.1, 0.35 + h / 2, (i % 2) * 0.08); g.add(f); flames.push(f);
    });
    const light = new THREE.PointLight(0xffa040, 8, 9, 2); light.position.y = 0.9; g.add(light);
    g.userData = { flames, light };
    return g;
  }
  function picnicTable() {
    return build([
      p(roundedBox(1.9, 0.13, 0.85, 0.06), P.wood, 0, 0.75, 0, { mat: 'soft' }),
      p(roundedBox(1.9, 0.1, 0.32, 0.05), P.wood, 0, 0.45, 0.72, { mat: 'soft' }),
      p(roundedBox(1.9, 0.1, 0.32, 0.05), P.wood, 0, 0.45, -0.72, { mat: 'soft' }),
      p(capsule(0.07, 0.6), P.wood2, -0.7, 0.38, 0, { rx: 0.4 }), p(capsule(0.07, 0.6), P.wood2, 0.7, 0.38, 0, { rx: -0.4 }),
      p(capsule(0.06, 0.5), P.wood2, -0.7, 0.3, 0.72), p(capsule(0.06, 0.5), P.wood2, 0.7, 0.3, 0.72),
      p(capsule(0.06, 0.5), P.wood2, -0.7, 0.3, -0.72), p(capsule(0.06, 0.5), P.wood2, 0.7, 0.3, -0.72),
    ]);
  }
  function signpost(text) {
    const g = new THREE.Group();
    g.add(build([p(capsule(0.09, 2.0), P.wood, 0, 1.1, 0), p(roundedBox(2.0, 0.62, 0.14, 0.07), P.wood2, 0, 1.85, 0.02, { mat: 'soft' }), p(sphere(0.12, 8, 6), P.gold, 0, 2.2, 0)]));
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.86, 0.5), new THREE.MeshBasicMaterial({ map: FW.Pixel.textTexture(text, { w: 384, h: 100, font: 'bold 40px monospace', fg: '#fff3dc', bg: '#96663a', border: '#5a3a1e', radius: 16 }), transparent: true }));
    s.position.set(0, 1.85, 0.1); g.add(s);
    const b = s.clone(); b.position.z = -0.06; b.rotation.y = Math.PI; g.add(b);
    return g;
  }
  function marker() {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.6, 14, 14, 1, true), new THREE.MeshBasicMaterial({ color: '#f7c544', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    beam.position.y = 7; g.add(beam);
    const ring = new THREE.Mesh(torus(3.6, 0.28, 6, 22), FW.Pixel.flat('#f7c544'));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.25; g.add(ring);
    const w = waffle(1.1); w.position.y = 4.5; g.add(w);
    g.userData = { beam, ring, waffle: w };
    return g;
  }
  // collectible syrup token
  function token() {
    const g = new THREE.Group();
    const c = new THREE.Mesh(cyl(0.42, 0.42, 0.1, 16), FW.Pixel.mat(P.gold, { roughness: 0.25, metalness: 0.7, envMapIntensity: 1.3 }));
    c.rotation.x = Math.PI / 2; c.castShadow = true;
    const r = new THREE.Mesh(torus(0.42, 0.07, 6, 18), FW.Pixel.mat('#ffe9a8', { roughness: 0.3, metalness: 0.5 }));
    const inner = new THREE.Mesh(torus(0.2, 0.05, 5, 12), FW.Pixel.flat(P.syrup));
    g.add(c, r, inner);
    return g;
  }
  // air ring you fly through
  function airRing(r = 2.6) {
    const g = new THREE.Group();
    const t = new THREE.Mesh(torus(r, 0.24, 8, 26), FW.Pixel.flat('#7fd1c0'));
    const t2 = new THREE.Mesh(torus(r + 0.16, 0.08, 6, 26), FW.Pixel.flat('#fff3dc'));
    g.add(t, t2);
    g.userData = { ring: t, glow: t2, r };
    return g;
  }
  function arrowSign(text) {
    const g = new THREE.Group();
    g.add(build([p(capsule(0.08, 1.4), P.wood, 0, 0.8, 0)]));
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42), new THREE.MeshBasicMaterial({ map: FW.Pixel.textTexture(text, { w: 320, h: 90, font: 'bold 40px monospace', fg: '#3d2c1e', bg: '#f7c544', border: '#8a4b1a', radius: 14 }), transparent: true, side: THREE.DoubleSide }));
    s.position.y = 1.5; g.add(s);
    return g;
  }

  return { p, build, geoOf, mergeParts, roundedBox, sphere, capsule, cyl, cone, torus, blob, shade,
    duck, scooter, bear, critter, CRITTERS, waffle, TOPPINGS, toppingMesh,
    firGeo, pineGeo, cedarGeo, sequoiaGeo, oakGeo, snagGeo, deadfallGeo, fernGeo, bushGeo, rockGeo, flowerGeo, mushroomGeo, stumpGeo, fenceGeo, guardrailGeo, car, CAR_KINDS,
    shack, cabin, rangerStation, tent, campfire, picnicTable, signpost, marker, token, airRing, arrowSign };
})();
