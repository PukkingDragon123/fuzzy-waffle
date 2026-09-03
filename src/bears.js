// Flippin' Waffles — bears (and cubs) roaming the meadows
window.FW = window.FW || {};

FW.Bears = class {
  constructor(scene, world, fx) {
    this.scene = scene; this.W = world; this.fx = fx; this.list = []; this.events = []; this.t = 0;
    const spots = [[50, -40], [-60, -60], [90, -100], [-100, -20], [60, 30], [-50, 20], [140, -90], [-120, 110], [100, -35], [-30, -110], [40, 120], [-160, 60]];
    spots.forEach(([x, z], i) => { const b = this.spawn(x, z, false); if (b && i % 3 === 0) { this.spawn(x + 2, z + 2, true, b); if (i % 6 === 0) this.spawn(x - 2, z + 2, true, b); } });
  }
  spawn(x, z, cub, parent) {
    // nudge to a walkable spot
    let px = x, pz = z, tries = 0;
    while (!this.walkable(px, pz) && tries < 40) { px = x + (Math.random() - 0.5) * 30; pz = z + (Math.random() - 0.5) * 30; tries++; }
    if (tries >= 40) return null;
    const g = FW.Voxel.bear(cub ? 0.55 : 1, cub);
    if (!cub) { const w = FW.Voxel.waffle(0.022); w.position.set(0, 0.05, 0.4); w.rotation.x = 0.6; w.visible = false; g.userData.head.add(w); g.userData.waffle = w; }
    this.scene.add(g);
    const b = { g, x: px, z: pz, yaw: Math.random() * Math.PI * 2, state: 'idle', timer: Math.random() * 3, tx: px, tz: pz, cub, parent, phase: Math.random() * 6, anim: 0, moving: false, curSpeed: 0, hop: 0, home: { x: px, z: pz } };
    this.list.push(b);
    return b;
  }
  walkable(x, z) {
    const W = this.W; if (!W.bounds(x, z) || Math.abs(x) > 200 || Math.abs(z) > 200) return false;
    const g = W.groundAt(x, z);
    if (g.surf === W.SURF.WATER || g.surf === W.SURF.ROCK || g.surf === W.SURF.SNOW || g.ov) return false;
    if (W.slopeAt(x, z) > 0.75) return false;
    for (const c of W.nearbyColliders(x, z)) if (c.kind === 'building' && Math.hypot(c.x - x, c.z - z) < c.r + 1.5) return false;
    return true;
  }
  moveToward(b, tx, tz, speed, dt) {
    const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
    if (d < 0.1) { b.moving = false; return; }
    b.yaw = FW.U.angleLerp(b.yaw, Math.atan2(dx, dz), Math.min(1, 6 * dt));
    const nx = b.x + Math.sin(b.yaw) * speed * dt, nz = b.z + Math.cos(b.yaw) * speed * dt;
    if (this.walkable(nx, nz)) { b.x = nx; b.z = nz; b.moving = true; b.curSpeed = speed; }
    else { b.moving = false; if (!b.cub) { b.state = 'idle'; b.timer = 1; } }
  }
  pickWander(b) {
    for (let i = 0; i < 8; i++) { const tx = b.home.x + (Math.random() - 0.5) * 70, tz = b.home.z + (Math.random() - 0.5) * 70; if (this.walkable(tx, tz)) { b.tx = tx; b.tz = tz; b.state = 'wander'; b.timer = 10; return; } }
    b.state = 'idle'; b.timer = 2;
  }
  honk(kart) {
    let n = 0;
    for (const b of this.list) { if (b.cub) continue; const d = Math.hypot(kart.pos.x - b.x, kart.pos.z - b.z); if (d < 18 && b.state !== 'eat') { b.state = 'flee'; b.timer = 4; n++; } }
    return n;
  }
  update(dt, kart, carrying) {
    this.t += dt;
    const W = this.W, fx = this.fx;
    for (const b of this.list) {
      b.timer -= dt;
      const dx = kart.pos.x - b.x, dz = kart.pos.z - b.z, d = Math.hypot(dx, dz);
      if (b.cub) {
        const p = b.parent;
        const tx = p.x + Math.sin(p.yaw + 2.4 + b.phase) * 2.4, tz = p.z + Math.cos(p.yaw + 2.4 + b.phase) * 2.4;
        if (Math.hypot(tx - b.x, tz - b.z) > 1.2) this.moveToward(b, tx, tz, Math.min(6, 3 + p.curSpeed), dt); else { b.moving = false; if (d < 7) b.yaw = FW.U.angleLerp(b.yaw, Math.atan2(dx, dz), 5 * dt); }
        if (d < 7 && b.timer <= 0) { b.timer = 2.2; b.hop = 0.5; fx.burst(b.x, W.groundAt(b.x, b.z).y + 1, b.z, 3, { color: '#ff8fa3', speed: 0.6, up: 1.5, life: 1.1, size: 0.16, extra: { gravity: -1, shrink: false } }); }
      } else {
        switch (b.state) {
          case 'idle': b.moving = false; if (b.timer <= 0) this.pickWander(b); break;
          case 'wander': this.moveToward(b, b.tx, b.tz, 2.2, dt); if (Math.hypot(b.tx - b.x, b.tz - b.z) < 1.5 || b.timer <= 0) { b.state = 'idle'; b.timer = 1.5 + Math.random() * 3; } break;
          case 'chase': this.moveToward(b, kart.pos.x, kart.pos.z, 7.5, dt); if (b.timer <= 0 || d > 45 || carrying <= 0) { b.state = 'idle'; b.timer = 3; } break;
          case 'flee': this.moveToward(b, b.x - dx * 3, b.z - dz * 3, 9, dt); if (b.timer <= 0) { b.state = 'idle'; b.timer = 2; } break;
          case 'eat': b.moving = false; if (Math.random() < dt * 2) fx.spawn({ x: b.x, y: W.groundAt(b.x, b.z).y + 1.4, z: b.z, vy: 1, vx: (Math.random() - 0.5), vz: (Math.random() - 0.5), life: 1.2, size: 0.15, color: '#ff8fa3', gravity: -1, shrink: false }); if (b.timer <= 0) { b.state = 'idle'; b.timer = 4; b.g.userData.waffle.visible = false; } break;
        }
        if ((b.state === 'idle' || b.state === 'wander') && carrying > 0 && d < 28 && kart.invuln <= 0 && Math.random() < dt * 1.5) { b.state = 'chase'; b.timer = 7; FW.Audio.sfx.growl(); this.events.push({ type: 'growl' }); }
        if (d < 1.8 && kart.invuln <= 0 && kart.stun <= 0 && !kart.grind && kart.controllable) {
          kart.wipeout(fx);
          if (carrying > 0) { this.events.push({ type: 'steal' }); b.state = 'eat'; b.timer = 9; b.g.userData.waffle.visible = true; FW.Audio.sfx.growl(); }
          else { b.state = 'flee'; b.timer = 3; }
        }
      }
      // pose
      const gy = W.groundAt(b.x, b.z).y;
      b.hop = Math.max(0, b.hop - dt);
      b.g.position.set(b.x, gy + (b.hop > 0 ? Math.sin((b.hop / 0.5) * Math.PI) * 0.5 : 0), b.z);
      b.g.rotation.y = b.yaw;
      const sp = b.moving ? b.curSpeed : 0;
      b.anim += dt * (sp * 2.2 + 0.001);
      b.g.userData.legs.forEach((l, i) => { l.rotation.x = b.moving ? Math.sin(b.anim + (i % 2 ? Math.PI : 0) + (i < 2 ? 0 : Math.PI)) * 0.55 : FW.U.damp(l.rotation.x, 0, 8, dt); });
      const head = b.g.userData.head;
      head.rotation.x = b.state === 'eat' ? 0.35 + Math.sin(this.t * 6) * 0.08 : Math.sin(b.anim * 0.5) * 0.08 + (b.state === 'chase' ? -0.15 : 0);
      head.rotation.y = b.state === 'idle' ? Math.sin(this.t * 0.8 + b.phase) * 0.3 : FW.U.damp(head.rotation.y, 0, 6, dt);
    }
  }
};
