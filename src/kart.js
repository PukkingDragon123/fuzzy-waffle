// Flippin' Waffles — scooter physics: kart-style drift, springy suspension, tricks, rails
window.FW = window.FW || {};

FW.Kart = (() => {
  const U = FW.U;
  const MAX = 27, ACC = 10, BRAKE = 20, REV_MAX = 7, GRAV = 24, HOP_V = 7.2, TURN = 2.1;
  // speed multiplier by surface (GRASS, ROAD, DIRT, SHOULDER, LINE, SAND, WATER, ROCK, SNOW, WOOD)
  const SURF_MUL = [0.5, 1, 0.82, 0.85, 1, 0.68, 0.28, 0.6, 0.6, 1.05];
  const _v = new THREE.Vector3(), _n = new THREE.Vector3();

  // critically-ish damped spring, used for every bouncy bit
  class Spring {
    constructor(value = 1, k = 180, d = 14) { this.v = value; this.target = value; this.vel = 0; this.k = k; this.d = d; }
    kick(amount) { this.vel += amount; }
    set(v) { this.v = v; }
    update(dt) {
      const steps = dt > 1 / 50 ? 2 : 1, h = dt / steps;
      for (let i = 0; i < steps; i++) { this.vel += (this.target - this.v) * this.k * h - this.vel * this.d * h; this.v += this.vel * h; }
      return this.v;
    }
  }

  class Kart {
    constructor(scene) {
      this.scene = scene;
      this.pos = new THREE.Vector3(0, 0, 66);
      this.yaw = 0; this.vel = new THREE.Vector3(); this.speed = 0;
      this.vy = 0; this.onGround = true; this.groundY = 0; this.vyGround = 0; this.air = 0;
      this.drift = { active: false, dir: 0, charge: 0, stage: 0 };
      this.boost = 0; this.hopping = false;
      this.trick = null; this.tricksThisAir = 0; this.trickPoints = 0; this.coins = 0;
      this.grind = null; this.grindDir = 1; this.grindT = 0; this.grindSpeed = 0; this.grindTime = 0;
      this.stun = 0; this.spinOut = 0; this.invuln = 0; this.honkCd = 0; this.rescueCd = 0; this.deepTimer = 0;
      this.controllable = true; this.surf = 1; this.events = [];
      this.visual = new THREE.Group(); this.tilt = new THREE.Group(); this.trickG = new THREE.Group(); this.susp = new THREE.Group();
      this.scooter = FW.Models.scooter(); this.duck = FW.Models.duck({ sitting: true });
      this.duck.position.set(0, 0.47, -0.38);
      this.susp.add(this.scooter, this.duck);
      this.trickG.add(this.susp); this.tilt.add(this.trickG); this.visual.add(this.tilt); scene.add(this.visual);
      // springs give everything a little overshoot instead of a linear lerp
      this.sq = new Spring(1, 210, 13);      // squash & stretch
      this.sus = new Spring(0, 150, 12);     // suspension travel
      this.leanZ = new Spring(0, 120, 13);   // roll
      this.leanX = new Spring(0, 110, 13);   // pitch
      this.propSpeed = 0;
      this.cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), yaw: 0, init: false, fov: 62, shake: 0 };
      this.visualYawOffset = 0; this.wheelSpin = 0; this.t = 0; this.headYaw = 0;
    }
    reset(x, z, yaw) {
      this.pos.set(x, FW.World.groundY(x, z), z); this.yaw = yaw; this.vel.set(0, 0, 0); this.speed = 0; this.vy = 0; this.onGround = true;
      this.groundY = this.pos.y; this.vyGround = 0; this.air = 0; this.drift.active = false; this.drift.stage = 0; this.boost = 0; this.trick = null; this.tricksThisAir = 0;
      this.grind = null; this.stun = 0; this.spinOut = 0; this.invuln = 1; this.hopping = false; this.deepTimer = 0; this.cam.init = false; this.cam.yaw = yaw; this.cam.shake = 0;
      this.sq.set(1); this.sus.set(0); this.leanZ.set(0); this.leanX.set(0);
      FW.Audio.setGrind(false);
      this.updateVisual(0, 0, FW.World);
    }
    setBoxVisible(v) { this.scooter.userData.box.visible = v; }

    update(dt, inp, W, fx) {
      this.t += dt;
      const S = W.SURF;
      const ctrl = this.controllable && this.stun <= 0;
      const steer = ctrl ? inp.axis() : 0;
      const thr = ctrl ? inp.throttle() : 0;
      const hopHeld = ctrl && inp.held('hop');
      this.stun = Math.max(0, this.stun - dt); this.invuln = Math.max(0, this.invuln - dt);
      this.honkCd = Math.max(0, this.honkCd - dt); this.rescueCd = Math.max(0, this.rescueCd - dt);
      this.boost = Math.max(0, this.boost - dt);
      this.cam.shake = Math.max(0, this.cam.shake - dt * 2.2);
      if (ctrl && inp.pressed('honk') && this.honkCd <= 0) { this.honkCd = 0.5; this.events.push({ type: 'honk' }); FW.Audio.sfx.quack(); this.sq.kick(3.5); }
      if (this.controllable && inp.pressed('reset') && this.rescueCd <= 0) this.rescue(W, true);
      if (this.grind) { this.updateGrind(dt, inp, W, fx); this.updateVisual(dt, steer, W); this.updateAudio(thr); this.pickups(W, fx); return; }

      const g = W.groundAt(this.pos.x, this.pos.z);
      this.surf = g.surf; const ov = g.ov;
      const inWater = g.surf === S.WATER;
      const sp = Math.abs(this.speed);

      if (this.onGround) {
        let maxS = MAX * (SURF_MUL[g.surf] ?? 0.6);
        if (this.boost > 0) maxS = Math.max(maxS, MAX * 1.34);
        let target = 0;
        if (thr > 0) target = maxS; else if (thr < 0) target = this.speed > 1 ? 0 : -REV_MAX;
        if (this.boost > 0 && ctrl) target = Math.max(target, maxS);
        const acc = target > this.speed ? (this.boost > 0 ? ACC * 2.4 : ACC) : thr < 0 ? BRAKE : inWater ? ACC * 1.6 : ACC * 0.5;
        this.speed += U.clamp(target - this.speed, -acc * dt, acc * dt);
        // gravity pull along the slope (makes the banked chute and hills feel real)
        W.normalAt(this.pos.x, this.pos.z, _n);
        const along = _n.x * Math.sin(this.yaw) + _n.z * Math.cos(this.yaw);
        this.speed -= along * GRAV * 0.42 * dt;
        this.speed -= this.speed * 0.22 * dt;                       // rolling drag
        this.speed = U.clamp(this.speed, -REV_MAX * 1.6, MAX * 1.28); // never runaway downhill
      }
      let yawRate = 0;
      if (this.drift.active) {
        const into = steer * this.drift.dir;
        yawRate = -this.drift.dir * TURN * (0.75 + 0.45 * into) * U.clamp(sp / 10, 0.4, 1);
        this.drift.charge += dt * (1 + 0.6 * Math.max(0, into));
        const st = this.drift.charge > 3.4 ? 3 : this.drift.charge > 2.0 ? 2 : this.drift.charge > 0.9 ? 1 : 0;
        if (st !== this.drift.stage) { this.drift.stage = st; if (st) { FW.Audio.sfx.spark(st); this.sq.kick(1.4); } }
        if (!hopHeld || sp < 6 || this.stun > 0 || (!this.onGround && this.air > 0.5)) this.releaseDrift();
      } else {
        const eff = U.clamp(sp / 7, 0, 1) * (1.15 - 0.4 * U.clamp(sp / MAX, 0, 1));
        yawRate = -steer * TURN * eff * (this.speed < 0 ? -1 : 1);
        if (!this.onGround) yawRate *= 0.35;
      }
      this.yaw += yawRate * dt;

      if (ctrl && inp.pressed('hop') && this.onGround) {
        this.vy = HOP_V; this.onGround = false; this.hopping = true; this.air = 0;
        this.sq.kick(9); this.sus.kick(-7); FW.Audio.sfx.hop();
      }
      if (ctrl && !this.onGround && this.air > 0.12 && inp.pressed('trick') && !this.trick) {
        let type = 'kick'; if (steer > 0) type = 'spinR'; else if (steer < 0) type = 'spinL'; else if (thr > 0) type = 'front'; else if (thr < 0) type = 'back';
        this.trick = { type, t: 0, dur: 0.55 }; FW.Audio.sfx.trick(); this.sq.kick(5);
        fx.burst(this.pos.x, this.pos.y + 0.8, this.pos.z, 10, { color: ['#fff6a8', '#f7c544', '#ffffff'], speed: 2.6, up: 2, life: 0.5, size: 0.12, extra: { gravity: 2 } });
      }
      if (this.trick) { this.trick.t += dt; if (this.trick.t >= this.trick.dur) { this.tricksThisAir++; this.trickPoints += 1; this.trick = null; } }

      const fwdx = Math.sin(this.yaw), fwdz = Math.cos(this.yaw);
      _v.set(fwdx * this.speed, 0, fwdz * this.speed);
      let grip = 9;
      if (this.drift.active) grip = 2.6; else if (g.surf === S.DIRT) grip = 5.5; else if (g.surf === S.GRASS || g.surf === S.SAND) grip = 4.5;
      if (!this.onGround) grip = 1.0;
      this.vel.lerp(_v, Math.min(1, grip * dt));
      this.move(this.pos.x + this.vel.x * dt, this.pos.z + this.vel.z * dt, W, fx);

      const gn = W.groundAt(this.pos.x, this.pos.z);
      if (this.onGround) {
        const vg = (gn.y - this.groundY) / dt;
        if (gn.y < this.pos.y - 0.3 && this.vyGround > 2.5) {
          this.onGround = false; this.vy = this.vyGround * (ov && ov.kick ? ov.kick : 1.0); this.air = 0; this.hopping = false;
          FW.Audio.sfx.whoosh(); this.sq.kick(6);
        } else if (gn.y < this.pos.y - 0.7) {
          this.onGround = false; this.vy = Math.max(0, this.vyGround); this.air = 0;
        } else {
          this.pos.y = gn.y; this.vyGround = U.lerp(this.vyGround, vg, 0.5);
        }
      }
      if (!this.onGround) {
        this.vy -= GRAV * dt; this.pos.y += this.vy * dt; this.air += dt;
        if (this.vy < 0.5 && this.tryMountRail(W)) { this.updateVisual(dt, steer, W); return; }
        if (this.pos.y <= gn.y) this.land(gn, W, fx, hopHeld, steer);
      } else if (sp > 6) this.tryMountRail(W);
      this.groundY = gn.y;

      // boost pads
      if (this.onGround && W.padAt(this.pos.x, this.pos.z)) {
        if (this.boost < 0.6) { FW.Audio.sfx.boost(1); this.events.push({ type: 'pad' }); this.sq.kick(5); this.cam.shake = 0.5; }
        this.boost = Math.max(this.boost, 1.0); this.speed = Math.max(this.speed, MAX * 1.15);
      }
      // bouncy mushrooms
      for (const b of W.bouncers) {
        const d = Math.hypot(this.pos.x - b.x, this.pos.z - b.z);
        if (d < b.r + 0.7 && this.pos.y < b.y + 2.2 * b.scale && this.pos.y > b.y - 1.5) {
          b.squash = 1; this.onGround = false; this.hopping = false; this.air = 0;
          this.vy = 13.5 * Math.sqrt(b.scale); this.pos.y = Math.max(this.pos.y, b.y + 1.0);
          this.speed = Math.max(this.speed, 12); this.sq.kick(14); this.cam.shake = 0.6;
          this.events.push({ type: 'bounce' }); FW.Audio.sfx.boing();
          fx.ring(b.x, b.y + 1.2 * b.scale, b.z, 12, { color: ['#fff3dc', '#e5564a'], speed: 4, up: 3, life: 0.5, size: 0.16 });
        }
      }
      this.pickups(W, fx);

      if (inWater && this.onGround) {
        if (sp > 3 && Math.random() < dt * 30) fx.spawn({ x: this.pos.x + (Math.random() - 0.5), y: this.pos.y + 0.3, z: this.pos.z + (Math.random() - 0.5), vx: -this.vel.x * 0.2 + (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 2, vz: -this.vel.z * 0.2 + (Math.random() - 0.5) * 2, life: 0.6, size: 0.18, color: '#cfeaff' });
        if (gn.y < W.WATER_Y - 1.3) { this.deepTimer += dt; if (this.deepTimer > 0.7) this.rescue(W, false); } else this.deepTimer = 0;
      } else this.deepTimer = 0;
      if (this.onGround && sp > 6 && (g.surf === S.GRASS || g.surf === S.DIRT || g.surf === S.SAND) && Math.random() < dt * 25)
        fx.spawn({ x: this.pos.x - fwdx * 0.7, y: this.pos.y + 0.15, z: this.pos.z - fwdz * 0.7, vx: -this.vel.x * 0.15 + (Math.random() - 0.5), vy: 1.3 + Math.random(), vz: -this.vel.z * 0.15 + (Math.random() - 0.5), life: 0.7, size: 0.2, color: g.surf === S.GRASS ? '#a8d08d' : '#c9a86a', gravity: 2 });
      if (this.drift.active && this.onGround && Math.random() < dt * 60) {
        const c = ['#ffffff', '#7fd1c0', '#f0872a', '#c9a0f0'][this.drift.stage];
        const rx = -fwdz, rz = fwdx, side = (Math.random() < 0.5 ? 1 : -1) * 0.35;
        fx.spawn({ x: this.pos.x - fwdx * 0.6 + rx * side, y: this.pos.y + 0.1, z: this.pos.z - fwdz * 0.6 + rz * side, vx: -this.vel.x * 0.3 + (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: -this.vel.z * 0.3 + (Math.random() - 0.5) * 3, life: 0.35, size: 0.11, color: c, gravity: 6 });
      }
      if (this.boost > 0 && Math.random() < dt * 45)
        fx.spawn({ x: this.pos.x - fwdx * 0.9 + (Math.random() - 0.5) * 0.3, y: this.pos.y + 0.35, z: this.pos.z - fwdz * 0.9 + (Math.random() - 0.5) * 0.3, vx: -this.vel.x * 0.4, vy: 0.6 + Math.random(), vz: -this.vel.z * 0.4, life: 0.35, size: 0.2, color: Math.random() < 0.5 ? '#f0872a' : '#f7c544', gravity: -2, stretch: 1.4 });
      else if (this.onGround && thr > 0 && Math.random() < dt * 6)
        fx.spawn({ x: this.pos.x - fwdx * 0.9, y: this.pos.y + 0.3, z: this.pos.z - fwdz * 0.9, vx: -fwdx * 0.5, vy: 0.8, vz: -fwdz * 0.5, life: 0.8, size: 0.14, color: '#efe9df', gravity: -0.5 });

      this.updateVisual(dt, steer, W);
      this.updateAudio(thr);
    }
    pickups(W, fx) {
      for (const t of W.tokens) {
        if (t.taken) continue;
        if (Math.abs(this.pos.x - t.x) < 1.7 && Math.abs(this.pos.z - t.z) < 1.7 && Math.abs(this.pos.y + 0.6 - t.g.position.y) < 2.2) {
          t.taken = true; t.g.visible = false; this.coins++; this.trickPoints += 1;
          this.events.push({ type: 'token' }); FW.Audio.sfx.coin();
          fx.ring(t.x, t.g.position.y, t.z, 8, { color: ['#f7c544', '#fff6a8'], speed: 2.5, up: 1.6, life: 0.45, size: 0.13 });
        }
      }
      for (const r of W.rings) {
        if (r.taken > 0) continue;
        const dx = this.pos.x - r.x, dz = this.pos.z - r.z, dy = this.pos.y + 0.6 - r.y;
        const along = dx * r.fx + dz * r.fz, lat = dx * r.fz - dz * r.fx;
        if (Math.abs(along) < 1.4 && Math.hypot(lat, dy) < r.r) {
          r.taken = 1; this.boost = Math.max(this.boost, 1.6); this.trickPoints += 3;
          this.events.push({ type: 'ring' }); FW.Audio.sfx.chime(); this.cam.shake = 0.35;
          fx.ring(r.x, r.y, r.z, 16, { color: ['#7fd1c0', '#fff3dc', '#f7c544'], speed: 6, up: 0.5, life: 0.6, size: 0.16, gravity: 0.5 });
        }
      }
    }
    updateAudio(thr) { FW.Audio.setEngine(true, U.clamp(Math.abs(this.speed) / MAX, 0, 1.3), Math.max(0, thr)); }

    move(nx, nz, W, fx) {
      if (!W.bounds(nx, nz)) { this.vel.multiplyScalar(-0.3); this.speed *= 0.3; return; }
      const gNew = W.groundAt(nx, nz);
      if (!gNew.ov && gNew.y > this.pos.y + 0.9 && this.pos.y <= this.groundY + 0.6) { this.vel.multiplyScalar(-0.2); this.speed *= 0.2; this.bonk(fx, 0.25); return; }
      this.pos.x = nx; this.pos.z = nz;
      for (const c of W.nearbyColliders(nx, nz)) {
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z, d = Math.hypot(dx, dz), R = c.r + 0.75;
        if (d < R && d > 1e-4) {
          const px = dx / d, pz = dz / d;
          this.pos.x = c.x + px * R; this.pos.z = c.z + pz * R;
          const vn = this.vel.x * px + this.vel.z * pz;
          if (vn < 0) { this.vel.x -= 1.6 * vn * px; this.vel.z -= 1.6 * vn * pz; this.vel.multiplyScalar(0.45); }
          if (Math.abs(vn) > 4) { this.bonk(fx, 0.35); if (c.kind === 'tree') fx.burst(c.x, this.pos.y + 3, c.z, 9, { color: ['#3f8a57', '#5fae6e'], speed: 2, up: 1, life: 1.2, size: 0.18, extra: { gravity: 3 } }); }
          this.speed *= 0.4;
        }
      }
      // cars are solid, and moving ones will shove you
      for (const c of W.traffic) {
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z, d = Math.hypot(dx, dz), R = c.radius + 0.8;
        if (d < R && d > 1e-4 && this.pos.y < W.groundY(c.x, c.z) + 2.4) {
          const px = dx / d, pz = dz / d;
          this.pos.x = c.x + px * R; this.pos.z = c.z + pz * R;
          const vn = this.vel.x * px + this.vel.z * pz;
          if (vn < 0) { this.vel.x -= 1.7 * vn * px; this.vel.z -= 1.7 * vn * pz; this.vel.multiplyScalar(0.4); }
          if (Math.abs(vn) > 5) { this.bonk(fx, 0.4); FW.Audio.sfx.horn(); }
          this.speed *= 0.35;
        }
      }
      for (const f of W.nearbyFences(nx, nz)) {
        if (this.pos.y > f.y + f.h - 0.15) continue;
        const ex = f.bx - f.ax, ez = f.bz - f.az, L2 = ex * ex + ez * ez;
        let t = U.clamp(((this.pos.x - f.ax) * ex + (this.pos.z - f.az) * ez) / L2, 0, 1);
        const cx = f.ax + ex * t, cz = f.az + ez * t, dx = this.pos.x - cx, dz = this.pos.z - cz, d = Math.hypot(dx, dz);
        if (d < 0.7) {
          let px, pz;
          if (d > 1e-4) { px = dx / d; pz = dz / d; } else { const L = Math.sqrt(L2); px = ez / L; pz = -ex / L; }
          this.pos.x = cx + px * 0.7; this.pos.z = cz + pz * 0.7;
          const vn = this.vel.x * px + this.vel.z * pz;
          if (vn < 0) { this.vel.x -= 1.5 * vn * px; this.vel.z -= 1.5 * vn * pz; this.vel.multiplyScalar(0.4); }
          this.speed *= 0.35; this.bonk(fx, 0.3);
        }
      }
    }
    bonk(fx, stun) {
      if (this.stun <= 0) {
        FW.Audio.sfx.bonk(); this.events.push({ type: 'bonk' }); this.cam.shake = 0.5; this.sq.kick(-9);
        fx.burst(this.pos.x, this.pos.y + 0.9, this.pos.z, 7, { color: ['#ffffff', '#f7c544'], speed: 2, up: 2, life: 0.5, size: 0.13 });
      }
      this.stun = Math.max(this.stun, stun); this.drift.active = false; this.drift.stage = 0;
    }
    land(gn, W, fx, hopHeld, steer) {
      this.onGround = true; this.pos.y = gn.y;
      const hard = Math.min(1, Math.abs(this.vy) / 14);
      const bigAir = this.air > 0.45;
      if (this.trick) {
        if (this.trick.t < this.trick.dur * 0.6) { this.speed *= 0.8; this.events.push({ type: 'wobble' }); this.tricksThisAir = 0; this.sq.kick(-7); }
        else { this.tricksThisAir++; this.trickPoints += 1; }
        this.trick = null;
      }
      if (this.tricksThisAir > 0) {
        this.boost = Math.max(this.boost, Math.min(2.2, 0.5 + 0.45 * this.tricksThisAir));
        this.events.push({ type: 'trickLand', n: this.tricksThisAir }); FW.Audio.sfx.boost(2);
        this.speed = Math.max(this.speed, MAX * 1.05);
      }
      this.tricksThisAir = 0;
      this.sus.kick(-9 * hard - 2); this.sq.kick(-7 * hard);
      if (bigAir) {
        FW.Audio.sfx.land(); this.cam.shake = 0.4 + hard * 0.5;
        fx.ring(this.pos.x, this.pos.y + 0.1, this.pos.z, 10, { color: ['#d9c8a0', '#a8d08d'], speed: 3.5, up: 1.2, life: 0.5, size: 0.16 });
      }
      if (!this.drift.active && this.hopping && hopHeld && Math.abs(steer) > 0.2 && this.speed > 8) { this.drift.active = true; this.drift.dir = Math.sign(steer); this.drift.charge = 0; this.drift.stage = 0; }
      this.hopping = false; this.vy = 0; this.vyGround = 0; this.air = 0;
    }
    releaseDrift() {
      const st = this.drift.stage;
      if (st > 0) {
        this.boost = Math.max(this.boost, [0, 0.8, 1.4, 2.1][st]); FW.Audio.sfx.boost(st);
        this.events.push({ type: 'driftBoost', stage: st }); this.speed = Math.max(this.speed, MAX * (1 + 0.08 * st));
        this.sq.kick(4 + st * 2); this.cam.shake = 0.2 * st;
      }
      this.drift.active = false; this.drift.charge = 0; this.drift.stage = 0;
    }
    wipeout(fx) {
      this.stun = 1.3; this.spinOut = 1.3; this.speed = 0; this.vel.set(0, 0, 0);
      this.drift.active = false; this.drift.stage = 0; this.boost = 0; this.invuln = 2.5; this.trick = null;
      this.sq.kick(-14); this.cam.shake = 1;
      FW.Audio.sfx.bonk(); this.events.push({ type: 'wipeout' });
      fx.burst(this.pos.x, this.pos.y + 1, this.pos.z, 14, { color: ['#ffffff', '#f7c544', '#e5564a'], speed: 3, up: 3, life: 0.8, size: 0.16 });
    }
    rescue(W, manual) {
      const s = W.respawnPoint(this.pos.x, this.pos.z);
      this.pos.set(s.x, s.y, s.z); this.yaw = Math.atan2(s.tx, s.tz);
      this.vel.set(0, 0, 0); this.speed = 0; this.vy = 0; this.onGround = true; this.groundY = s.y;
      this.deepTimer = 0; this.stun = 0.5; this.rescueCd = 2; this.grind = null; this.trick = null; this.drift.active = false;
      FW.Audio.setGrind(false);
      this.events.push({ type: manual ? 'reset' : 'rescued' }); FW.Audio.sfx.splash(); this.cam.init = false;
    }
    tryMountRail(W) {
      for (const r of W.rails) {
        const ex = r.bx - r.ax, ez = r.bz - r.az;
        let t = ((this.pos.x - r.ax) * ex + (this.pos.z - r.az) * ez) / (r.len * r.len);
        if (t < -0.02 || t > 1.02) continue;
        t = U.clamp(t, 0, 1);
        const cx = r.ax + ex * t, cz = r.az + ez * t, cy = r.ay + (r.by - r.ay) * t;
        const dh = Math.hypot(this.pos.x - cx, this.pos.z - cz), dv = this.pos.y - cy;
        if (dh < 1.0 && dv > -0.35 && dv < 0.9) {
          const along = this.vel.x * r.dx + this.vel.z * r.dz;
          this.grind = r; this.grindDir = along >= 0 ? 1 : -1; this.grindT = t;
          this.grindSpeed = Math.max(9, Math.abs(along), Math.abs(this.speed) * 0.9); this.grindTime = 0;
          this.onGround = false; this.vy = 0; this.trick = null; this.drift.active = false; this.drift.stage = 0; this.hopping = false;
          this.sq.kick(5);
          FW.Audio.setGrind(true); FW.Audio.sfx.trick(); this.events.push({ type: 'grindStart' });
          return true;
        }
      }
      return false;
    }
    updateGrind(dt, inp, W, fx) {
      const r = this.grind;
      this.grindSpeed = Math.min(this.grindSpeed + 3 * dt, MAX * 1.1); this.grindTime += dt; this.trickPoints += dt * 1.5;
      this.grindT += this.grindDir * this.grindSpeed * dt / r.len;
      const t = U.clamp(this.grindT, 0, 1);
      this.pos.set(r.ax + (r.bx - r.ax) * t, r.ay + (r.by - r.ay) * t + 0.3, r.az + (r.bz - r.az) * t);
      this.yaw = Math.atan2(r.dx * this.grindDir, r.dz * this.grindDir);
      this.vel.set(r.dx * this.grindDir * this.grindSpeed, 0, r.dz * this.grindDir * this.grindSpeed);
      this.speed = this.grindSpeed;
      if (Math.random() < dt * 55) fx.spawn({ x: this.pos.x + (Math.random() - 0.5) * 0.3, y: this.pos.y - 0.2, z: this.pos.z + (Math.random() - 0.5) * 0.3, vx: -this.vel.x * 0.2 + (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: -this.vel.z * 0.2 + (Math.random() - 0.5) * 3, life: 0.3, size: 0.09, color: Math.random() < 0.5 ? '#fff6a8' : '#ffffff', gravity: 8 });
      if (this.controllable && inp.pressed('hop')) { this.exitGrind(true); return; }
      if (this.grindT < 0 || this.grindT > 1) {
        if (this.grindDir === 1 && r.next) { this.grind = r.next; this.grindT = 0; return; }
        this.exitGrind(false);
      }
    }
    exitGrind(hop) {
      this.events.push({ type: 'grindEnd', pts: Math.round(this.grindTime * 2) + 1 });
      this.boost = Math.max(this.boost, Math.min(2.0, 0.6 + this.grindTime * 0.35)); FW.Audio.sfx.boost(2);
      this.grind = null; this.onGround = false; this.vy = hop ? HOP_V : 2.5; this.air = 0; this.tricksThisAir = 0;
      this.sq.kick(hop ? 8 : 4);
      FW.Audio.setGrind(false);
      if (hop) FW.Audio.sfx.hop();
    }
    updateVisual(dt, steer, W) {
      const spd = U.clamp(Math.abs(this.speed) / MAX, 0, 1.3);
      this.sq.update(dt); this.sus.update(dt); this.leanZ.update(dt); this.leanX.update(dt);
      this.visualYawOffset = U.damp(this.visualYawOffset, this.drift.active ? -this.drift.dir * 0.5 : 0, 8, dt);
      let extraYaw = 0;
      if (this.spinOut > 0) { this.spinOut -= dt; extraYaw = ((1.3 - Math.max(0, this.spinOut)) / 1.3) * Math.PI * 4; }
      this.visual.position.copy(this.pos);
      this.visual.rotation.y = this.yaw + this.visualYawOffset + extraYaw;
      const fwdx = Math.sin(this.yaw), fwdz = Math.cos(this.yaw), rx = -fwdz, rz = fwdx;
      let pitch = 0, roll = 0;
      if (this.onGround) {
        const n = W.normalAt(this.pos.x, this.pos.z, _n);
        pitch = Math.atan2(n.x * fwdx + n.z * fwdz, n.y);
        roll = -Math.atan2(n.x * rx + n.z * rz, n.y);
      } else if (this.grind) pitch = -Math.atan2(this.grind.dy * this.grindDir, 1);
      else pitch = -U.clamp(this.vy * 0.05, -0.45, 0.45);
      const spF = U.clamp(Math.abs(this.speed) / 12, 0, 1);
      this.leanX.target = pitch;
      this.leanZ.target = roll - steer * 0.26 * spF + (this.drift.active ? -this.drift.dir * 0.16 : 0);
      this.tilt.rotation.set(this.leanX.v, 0, this.leanZ.v);
      // squash & stretch: springy, overshooting, never a plain lerp
      const s = U.clamp(this.sq.v, 0.62, 1.4);
      this.tilt.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
      this.susp.position.y = U.clamp(this.sus.v * 0.02, -0.16, 0.12);
      // trick rotation
      this.trickG.rotation.set(0, 0, 0);
      const wings = this.duck.userData.wings;
      if (this.trick) {
        const p = U.easeInOut(U.clamp(this.trick.t / this.trick.dur, 0, 1)), a = p * Math.PI * 2;
        switch (this.trick.type) {
          case 'spinR': this.trickG.rotation.y = -a; break;
          case 'spinL': this.trickG.rotation.y = a; break;
          case 'front': this.trickG.rotation.x = a; break;
          case 'back': this.trickG.rotation.x = -a; break;
          default: this.trickG.rotation.z = a;
        }
        wings[0].rotation.z = -(1.25 + Math.sin(this.t * 30) * 0.4);
        wings[1].rotation.z = 1.25 + Math.sin(this.t * 30) * 0.4;
      } else if (!this.onGround && this.air > 0.25) {
        // airborne: both wings up and beating
        const flap = Math.sin(this.t * 16) * 0.26;
        wings[0].rotation.z = U.damp(wings[0].rotation.z, -(1.0 + flap), 11, dt);
        wings[1].rotation.z = U.damp(wings[1].rotation.z, 1.0 + flap, 11, dt);
        wings[0].rotation.x = U.damp(wings[0].rotation.x, -0.22, 8, dt);
        wings[1].rotation.x = U.damp(wings[1].rotation.x, -0.22, 8, dt);
        wings[0].rotation.y = U.damp(wings[0].rotation.y, 0, 8, dt);
        wings[1].rotation.y = U.damp(wings[1].rotation.y, 0, 8, dt);
      } else {
        // on the road the wings work like ailerons: the outside one lifts,
        // the inside one drops, and both trail back as you pick up speed
        const base = 0.16 + spd * 0.2 + (this.drift.active ? 0.32 : 0);
        const roll = steer * 0.62 + (this.drift.active ? this.drift.dir * 0.3 : 0);
        wings[0].rotation.z = U.damp(wings[0].rotation.z, -U.clamp(base + roll, -0.35, 1.35), 12, dt);
        wings[1].rotation.z = U.damp(wings[1].rotation.z, U.clamp(base - roll, -0.35, 1.35), 12, dt);
        wings[0].rotation.y = U.damp(wings[0].rotation.y, -steer * 0.22 - spd * 0.3, 10, dt);
        wings[1].rotation.y = U.damp(wings[1].rotation.y, -steer * 0.22 + spd * 0.3, 10, dt);
        wings[0].rotation.x = U.damp(wings[0].rotation.x, -0.1, 8, dt);
        wings[1].rotation.x = U.damp(wings[1].rotation.x, -0.1, 8, dt);
      }
      // the propeller: idles slowly, whirls with speed, goes wild in the air
      const propTarget = 4 + spd * 26 + (this.onGround ? 0 : 22) + (this.boost > 0 ? 18 : 0);
      this.propSpeed = U.damp(this.propSpeed, propTarget, 5, dt);
      this.duck.userData.prop.rotation.y += this.propSpeed * dt;
      this.duck.userData.prop.position.y = 0.345 + Math.sin(this.t * 14) * 0.006 * spd;
      if (this.duck.userData.lolli) { this.duck.userData.lolli.rotation.z = -0.42 + Math.sin(this.t * 5) * 0.1; this.duck.userData.lolli.rotation.x = -0.34 - spd * 0.12 + Math.sin(this.t * 3.5) * 0.06; }
      this.wheelSpin += this.speed * dt / 0.3;
      const wh = this.scooter.userData.wheels;
      wh[0].rotation.x = this.wheelSpin; wh[1].rotation.x = this.wheelSpin; wh[1].rotation.y = -steer * 0.4;
      const head = this.duck.userData.head;
      this.headYaw = U.damp(this.headYaw, -steer * 0.55, 8, dt);
      head.rotation.y = this.headYaw; head.rotation.z = -steer * 0.12;
      head.rotation.x = U.damp(head.rotation.x, this.onGround ? 0 : -0.2, 6, dt);
      const honk = this.honkCd > 0.25 ? 1.2 : 1;
      head.scale.set(U.damp(head.scale.x, honk, 22, dt), U.damp(head.scale.y, honk, 22, dt), U.damp(head.scale.z, honk, 22, dt));
      this.duck.position.y = 0.47 + Math.abs(Math.sin(this.t * 9)) * 0.025 * spd;
    }
    updateCamera(dt, camera, W) {
      const spF = U.clamp(Math.abs(this.speed) / MAX, 0, 1.3);
      const back = 6.4 + spF * 1.7, up = 2.8 + spF * 0.45;
      if (!this.cam.init) this.cam.yaw = this.yaw;
      this.cam.yaw = U.angleLerp(this.cam.yaw, this.yaw, this.cam.init ? 1 - Math.exp(-4.5 * dt) : 1);
      const cfx = Math.sin(this.cam.yaw), cfz = Math.cos(this.cam.yaw);
      _v.set(this.pos.x - cfx * back, this.pos.y + up, this.pos.z - cfz * back);
      const gy = W.groundY(_v.x, _v.z) + 1.3;
      if (_v.y < gy) _v.y = gy;
      if (!this.cam.init) { this.cam.pos.copy(_v); this.cam.look.set(this.pos.x, this.pos.y + 1.1, this.pos.z); this.cam.init = true; }
      this.cam.pos.lerp(_v, 1 - Math.exp(-8 * dt));
      _v.set(this.pos.x + cfx * 3, this.pos.y + 1.15, this.pos.z + cfz * 3);
      this.cam.look.lerp(_v, 1 - Math.exp(-10 * dt));
      camera.position.copy(this.cam.pos);
      if (this.cam.shake > 0.001) {
        const k = this.cam.shake * this.cam.shake * 0.42;
        camera.position.x += Math.sin(this.t * 51) * k; camera.position.y += Math.sin(this.t * 63) * k; camera.position.z += Math.cos(this.t * 47) * k;
      }
      camera.lookAt(this.cam.look);
      const fovT = 62 + spF * 9 + (this.boost > 0 ? 9 : 0);
      this.cam.fov = U.damp(this.cam.fov, fovT, 4.5, dt);
      if (Math.abs(camera.fov - this.cam.fov) > 0.05) { camera.fov = this.cam.fov; camera.updateProjectionMatrix(); }
    }
  }
  Kart.MAX = MAX;
  Kart.Spring = Spring;
  return Kart;
})();
