// Flippin' Waffles — scooter physics (kart-style), tricks, rails, camera
window.FW = window.FW || {};

FW.Kart = (() => {
  const U = FW.U;
  const MAX = 27, ACC = 10, BRAKE = 20, REV_MAX = 7, GRAV = 24, HOP_V = 7.2, TURN = 2.1;
  // speed multipliers by surface id (GRASS, ROAD, DIRT, SHOULDER, LINE, SAND, WATER, ROCK, SNOW)
  const SURF_MUL = [0.5, 1, 0.82, 0.85, 1, 0.68, 0.28, 0.6, 0.6];
  const _v = new THREE.Vector3(), _n = new THREE.Vector3();

  class Kart {
    constructor(scene) {
      this.scene = scene;
      this.pos = new THREE.Vector3(0, 0, 66);
      this.yaw = 0; this.vel = new THREE.Vector3(); this.speed = 0;
      this.vy = 0; this.onGround = true; this.groundY = 0; this.vyGround = 0; this.air = 0;
      this.drift = { active: false, dir: 0, charge: 0, stage: 0 };
      this.boost = 0; this.hopping = false;
      this.trick = null; this.tricksThisAir = 0; this.trickPoints = 0;
      this.grind = null; this.grindDir = 1; this.grindT = 0; this.grindSpeed = 0; this.grindTime = 0;
      this.stun = 0; this.spinOut = 0; this.invuln = 0; this.honkCd = 0; this.rescueCd = 0; this.deepTimer = 0;
      this.controllable = true; this.surf = 1; this.events = [];
      this.visual = new THREE.Group(); this.tilt = new THREE.Group(); this.trickG = new THREE.Group();
      this.scooter = FW.Voxel.scooter(); this.duck = FW.Voxel.duck({ hat: 'helmet', sitting: true });
      this.duck.position.set(0, 0.7, -0.45);
      this.trickG.add(this.scooter, this.duck); this.tilt.add(this.trickG); this.visual.add(this.tilt); scene.add(this.visual);
      this.scooter.userData.wheels[1].rotation.order = 'YXZ';
      this.cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), yaw: 0, init: false, fov: 62 };
      this.visualYawOffset = 0; this.roll = 0; this.pitch = 0; this.squash = 1; this.wheelSpin = 0; this.t = 0; this.headYaw = 0;
    }
    reset(x, z, yaw) {
      this.pos.set(x, FW.World.groundAt(x, z).y, z); this.yaw = yaw; this.vel.set(0, 0, 0); this.speed = 0; this.vy = 0; this.onGround = true;
      this.groundY = this.pos.y; this.vyGround = 0; this.air = 0; this.drift.active = false; this.drift.stage = 0; this.boost = 0; this.trick = null; this.tricksThisAir = 0;
      this.grind = null; this.stun = 0; this.spinOut = 0; this.invuln = 1; this.hopping = false; this.deepTimer = 0; this.cam.init = false; this.cam.yaw = yaw;
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
      this.stun = Math.max(0, this.stun - dt); this.invuln = Math.max(0, this.invuln - dt); this.honkCd = Math.max(0, this.honkCd - dt); this.rescueCd = Math.max(0, this.rescueCd - dt);
      this.boost = Math.max(0, this.boost - dt);
      if (ctrl && inp.pressed('honk') && this.honkCd <= 0) { this.honkCd = 0.5; this.events.push({ type: 'honk' }); FW.Audio.sfx.quack(); }
      if (this.controllable && inp.pressed('reset') && this.rescueCd <= 0) { this.rescue(W, true); }
      if (this.grind) { this.updateGrind(dt, inp, W, fx); this.updateVisual(dt, steer, W); this.updateAudio(thr); return; }

      const g = W.groundAt(this.pos.x, this.pos.z);
      this.surf = g.surf; const ov = g.ov;
      const inWater = g.surf === S.WATER;

      // speed
      const sp = Math.abs(this.speed);
      if (this.onGround) {
        let maxS = MAX * (SURF_MUL[g.surf] ?? 0.6);
        if (this.boost > 0) maxS = Math.max(maxS, MAX * 1.32);
        let target = 0;
        if (thr > 0) target = maxS; else if (thr < 0) target = this.speed > 1 ? 0 : -REV_MAX;
        if (this.boost > 0 && ctrl) target = Math.max(target, maxS);
        const acc = target > this.speed ? (this.boost > 0 ? ACC * 2.4 : ACC) : thr < 0 ? BRAKE : inWater ? ACC * 1.6 : ACC * 0.5;
        this.speed += U.clamp(target - this.speed, -acc * dt, acc * dt);
      }
      // steering (positive steer = right = negative yaw)
      let yawRate = 0;
      if (this.drift.active) {
        const into = steer * this.drift.dir;
        yawRate = -this.drift.dir * TURN * (0.75 + 0.45 * into) * U.clamp(sp / 10, 0.4, 1);
        this.drift.charge += dt * (1 + 0.6 * Math.max(0, into));
        const st = this.drift.charge > 3.4 ? 3 : this.drift.charge > 2.0 ? 2 : this.drift.charge > 0.9 ? 1 : 0;
        if (st !== this.drift.stage) { this.drift.stage = st; if (st) FW.Audio.sfx.spark(st); }
        if (!hopHeld || sp < 6 || this.stun > 0 || (!this.onGround && this.air > 0.5)) this.releaseDrift();
      } else {
        const eff = U.clamp(sp / 7, 0, 1) * (1.15 - 0.4 * U.clamp(sp / MAX, 0, 1));
        yawRate = -steer * TURN * eff * (this.speed < 0 ? -1 : 1);
        if (!this.onGround) yawRate *= 0.35;
      }
      this.yaw += yawRate * dt;

      // hop
      if (ctrl && inp.pressed('hop') && this.onGround) { this.vy = HOP_V; this.onGround = false; this.hopping = true; this.air = 0; this.squash = 1.25; FW.Audio.sfx.hop(); }
      // tricks
      if (ctrl && !this.onGround && this.air > 0.12 && inp.pressed('trick') && !this.trick) {
        let type = 'kick'; if (steer > 0) type = 'spinR'; else if (steer < 0) type = 'spinL'; else if (thr > 0) type = 'front'; else if (thr < 0) type = 'back';
        this.trick = { type, t: 0, dur: 0.55 }; FW.Audio.sfx.trick();
        fx.burst(this.pos.x, this.pos.y + 0.8, this.pos.z, 8, { color: ['#fff6a8', '#f3c34a'], speed: 2.5, up: 2, life: 0.5, size: 0.14, extra: { gravity: 2 } });
      }
      if (this.trick) { this.trick.t += dt; if (this.trick.t >= this.trick.dur) { this.tricksThisAir++; this.trickPoints += 1; this.trick = null; } }

      // integrate
      const fx_ = Math.sin(this.yaw), fz_ = Math.cos(this.yaw);
      _v.set(fx_ * this.speed, 0, fz_ * this.speed);
      let grip = 9; if (this.drift.active) grip = 2.6; else if (g.surf === S.DIRT) grip = 5.5; else if (g.surf === S.GRASS || g.surf === S.SAND) grip = 4.5;
      if (!this.onGround) grip = 1.0;
      this.vel.lerp(_v, Math.min(1, grip * dt));
      this.move(this.pos.x + this.vel.x * dt, this.pos.z + this.vel.z * dt, W, fx);

      // vertical
      const gn = W.groundAt(this.pos.x, this.pos.z);
      if (this.onGround) {
        const vg = (gn.y - this.groundY) / dt;
        if (gn.y < this.pos.y - 0.3 && this.vyGround > 2.5) {
          this.onGround = false; this.vy = this.vyGround * (ov && ov.kind === 'ramp' ? ov.kick : 1.0); this.air = 0; this.hopping = false; FW.Audio.sfx.whoosh();
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

      // pads, water, particles
      if (this.onGround && W.padAt(this.pos.x, this.pos.z)) { if (this.boost < 0.6) { FW.Audio.sfx.boost(1); this.events.push({ type: 'pad' }); } this.boost = Math.max(this.boost, 1.0); this.speed = Math.max(this.speed, MAX * 1.15); }
      if (inWater && this.onGround) {
        if (sp > 3 && Math.random() < dt * 30) fx.spawn({ x: this.pos.x + (Math.random() - 0.5), y: this.pos.y + 0.3, z: this.pos.z + (Math.random() - 0.5), vx: -this.vel.x * 0.2 + (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 2, vz: -this.vel.z * 0.2 + (Math.random() - 0.5) * 2, life: 0.6, size: 0.2, color: '#cfeaff' });
        if (gn.y < W.WATER_Y - 1.3) { this.deepTimer += dt; if (this.deepTimer > 0.7) this.rescue(W, false); } else this.deepTimer = 0;
      } else this.deepTimer = 0;
      if (this.onGround && sp > 6 && (g.surf === S.GRASS || g.surf === S.DIRT || g.surf === S.SAND) && Math.random() < dt * 25) fx.spawn({ x: this.pos.x - fx_ * 0.7, y: this.pos.y + 0.15, z: this.pos.z - fz_ * 0.7, vx: -this.vel.x * 0.15 + (Math.random() - 0.5), vy: 1.2 + Math.random(), vz: -this.vel.z * 0.15 + (Math.random() - 0.5), life: 0.7, size: 0.22, color: g.surf === S.GRASS ? '#a8d08d' : '#c9a86a', gravity: 2 });
      if (this.drift.active && this.onGround && Math.random() < dt * 60) { const c = ['#ffffff', '#7ad3ff', '#ff9f43', '#d580ff'][this.drift.stage]; const rx = -fz_, rz = fx_; const side = (Math.random() < 0.5 ? 1 : -1) * 0.35; fx.spawn({ x: this.pos.x - fx_ * 0.6 + rx * side, y: this.pos.y + 0.1, z: this.pos.z - fz_ * 0.6 + rz * side, vx: -this.vel.x * 0.3 + (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: -this.vel.z * 0.3 + (Math.random() - 0.5) * 3, life: 0.35, size: 0.12, color: c, gravity: 6 }); }
      if (this.boost > 0 && Math.random() < dt * 40) fx.spawn({ x: this.pos.x - fx_ * 0.9 + (Math.random() - 0.5) * 0.3, y: this.pos.y + 0.35, z: this.pos.z - fz_ * 0.9 + (Math.random() - 0.5) * 0.3, vx: -this.vel.x * 0.4, vy: 0.5 + Math.random(), vz: -this.vel.z * 0.4, life: 0.35, size: 0.22, color: Math.random() < 0.5 ? '#f28c28' : '#f3c34a', gravity: -2 });
      else if (this.onGround && thr > 0 && Math.random() < dt * 6) fx.spawn({ x: this.pos.x - fx_ * 0.9, y: this.pos.y + 0.3, z: this.pos.z - fz_ * 0.9, vx: -fx_ * 0.5, vy: 0.8, vz: -fz_ * 0.5, life: 0.8, size: 0.16, color: '#e8e2d8', gravity: -0.5 });

      this.updateVisual(dt, steer, W);
      this.updateAudio(thr);
    }
    updateAudio(thr) { FW.Audio.setEngine(true, U.clamp(Math.abs(this.speed) / MAX, 0, 1.3), Math.max(0, thr)); }

    move(nx, nz, W, fx) {
      if (!W.bounds(nx, nz)) { this.vel.multiplyScalar(-0.3); this.speed *= 0.3; return; }
      const gNew = W.groundAt(nx, nz);
      if (gNew.y > this.pos.y + 0.9 && this.pos.y <= this.groundY + 0.6) { this.vel.multiplyScalar(-0.2); this.speed *= 0.2; this.bonk(fx, 0.25); return; }
      this.pos.x = nx; this.pos.z = nz;
      for (const c of W.nearbyColliders(nx, nz)) {
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z; const d = Math.hypot(dx, dz); const R = c.r + 0.75;
        if (d < R && d > 1e-4) {
          const px = dx / d, pz = dz / d;
          this.pos.x = c.x + px * R; this.pos.z = c.z + pz * R;
          const vn = this.vel.x * px + this.vel.z * pz;
          if (vn < 0) { this.vel.x -= 1.6 * vn * px; this.vel.z -= 1.6 * vn * pz; this.vel.multiplyScalar(0.45); }
          if (Math.abs(vn) > 4) { this.bonk(fx, 0.35); if (c.kind === 'tree') fx.burst(c.x, this.pos.y + 3, c.z, 8, { color: ['#4f9a5c', '#8ad25a'], speed: 2, up: 1, life: 1.2, size: 0.2, extra: { gravity: 3 } }); }
          this.speed *= 0.4;
        }
      }
      for (const f of W.nearbyFences(nx, nz)) {
        if (this.pos.y > f.y + f.h - 0.15) continue;
        const ex = f.bx - f.ax, ez = f.bz - f.az, L2 = ex * ex + ez * ez;
        let t = ((this.pos.x - f.ax) * ex + (this.pos.z - f.az) * ez) / L2; t = U.clamp(t, 0, 1);
        const cx = f.ax + ex * t, cz = f.az + ez * t; const dx = this.pos.x - cx, dz = this.pos.z - cz; const d = Math.hypot(dx, dz);
        if (d < 0.7) {
          let px, pz; if (d > 1e-4) { px = dx / d; pz = dz / d; } else { const L = Math.sqrt(L2); px = ez / L; pz = -ex / L; }
          this.pos.x = cx + px * 0.7; this.pos.z = cz + pz * 0.7;
          const vn = this.vel.x * px + this.vel.z * pz; if (vn < 0) { this.vel.x -= 1.5 * vn * px; this.vel.z -= 1.5 * vn * pz; this.vel.multiplyScalar(0.4); }
          this.speed *= 0.35; this.bonk(fx, 0.3);
        }
      }
    }
    bonk(fx, stun) {
      if (this.stun <= 0) { FW.Audio.sfx.bonk(); fx.burst(this.pos.x, this.pos.y + 0.9, this.pos.z, 6, { color: ['#ffffff', '#f3c34a'], speed: 2, up: 2, life: 0.5, size: 0.14 }); this.events.push({ type: 'bonk' }); }
      this.stun = Math.max(this.stun, stun); this.squash = 0.8; this.drift.active = false; this.drift.stage = 0;
    }
    land(gn, W, fx, hopHeld, steer) {
      this.onGround = true; this.pos.y = gn.y;
      const bigAir = this.air > 0.45;
      if (this.trick) {
        if (this.trick.t < this.trick.dur * 0.6) { this.speed *= 0.8; this.events.push({ type: 'wobble' }); this.tricksThisAir = 0; }
        else { this.tricksThisAir++; this.trickPoints += 1; }
        this.trick = null;
      }
      if (this.tricksThisAir > 0) {
        this.boost = Math.max(this.boost, Math.min(2.2, 0.5 + 0.45 * this.tricksThisAir));
        this.events.push({ type: 'trickLand', n: this.tricksThisAir }); FW.Audio.sfx.boost(2);
        this.speed = Math.max(this.speed, MAX * 1.05);
      }
      this.tricksThisAir = 0;
      if (bigAir) { FW.Audio.sfx.land(); fx.burst(this.pos.x, this.pos.y + 0.1, this.pos.z, 10, { color: ['#d9c8a0', '#a8d08d'], speed: 3, up: 1.5, life: 0.6, size: 0.2 }); this.squash = 0.7; }
      if (this.hopping && hopHeld && Math.abs(steer) > 0.2 && this.speed > 8) { this.drift.active = true; this.drift.dir = Math.sign(steer); this.drift.charge = 0; this.drift.stage = 0; }
      this.hopping = false; this.vy = 0; this.vyGround = 0; this.air = 0;
    }
    releaseDrift() {
      const st = this.drift.stage;
      if (st > 0) { this.boost = Math.max(this.boost, [0, 0.8, 1.4, 2.1][st]); FW.Audio.sfx.boost(st); this.events.push({ type: 'driftBoost', stage: st }); this.speed = Math.max(this.speed, MAX * (1 + 0.08 * st)); }
      this.drift.active = false; this.drift.charge = 0; this.drift.stage = 0;
    }
    wipeout(fx) {
      this.stun = 1.3; this.spinOut = 1.3; this.speed = 0; this.vel.set(0, 0, 0); this.drift.active = false; this.drift.stage = 0; this.boost = 0; this.invuln = 2.5; this.trick = null;
      FW.Audio.sfx.bonk(); this.events.push({ type: 'wipeout' });
      fx.burst(this.pos.x, this.pos.y + 1, this.pos.z, 12, { color: ['#ffffff', '#f3c34a', '#e0574f'], speed: 3, up: 3, life: 0.8, size: 0.18 });
    }
    rescue(W, manual) {
      const s = W.respawnPoint(this.pos.x, this.pos.z);
      this.pos.set(s.x, s.y, s.z); this.yaw = Math.atan2(s.tx, s.tz); this.vel.set(0, 0, 0); this.speed = 0; this.vy = 0; this.onGround = true; this.groundY = s.y;
      this.deepTimer = 0; this.stun = 0.5; this.rescueCd = 2; this.grind = null; this.trick = null; this.drift.active = false; FW.Audio.setGrind(false);
      this.events.push({ type: manual ? 'reset' : 'rescued' }); FW.Audio.sfx.splash(); this.cam.init = false;
    }
    // ---- rails ----
    tryMountRail(W) {
      for (const r of W.rails) {
        const ex = r.bx - r.ax, ez = r.bz - r.az;
        let t = ((this.pos.x - r.ax) * ex + (this.pos.z - r.az) * ez) / (r.len * r.len);
        if (t < -0.02 || t > 1.02) continue; t = U.clamp(t, 0, 1);
        const cx = r.ax + ex * t, cz = r.az + ez * t, cy = r.ay + (r.by - r.ay) * t;
        const dh = Math.hypot(this.pos.x - cx, this.pos.z - cz), dv = this.pos.y - cy;
        if (dh < 1.0 && dv > -0.35 && dv < 0.9) {
          const along = this.vel.x * r.dx + this.vel.z * r.dz;
          this.grind = r; this.grindDir = along >= 0 ? 1 : -1; this.grindT = t; this.grindSpeed = Math.max(9, Math.abs(along), Math.abs(this.speed) * 0.9); this.grindTime = 0;
          this.onGround = false; this.vy = 0; this.trick = null; this.drift.active = false; this.drift.stage = 0; this.hopping = false;
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
      this.vel.set(r.dx * this.grindDir * this.grindSpeed, 0, r.dz * this.grindDir * this.grindSpeed); this.speed = this.grindSpeed;
      if (Math.random() < dt * 50) fx.spawn({ x: this.pos.x + (Math.random() - 0.5) * 0.3, y: this.pos.y - 0.2, z: this.pos.z + (Math.random() - 0.5) * 0.3, vx: -this.vel.x * 0.2 + (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: -this.vel.z * 0.2 + (Math.random() - 0.5) * 3, life: 0.3, size: 0.1, color: Math.random() < 0.5 ? '#fff6a8' : '#ffffff', gravity: 8 });
      if (this.controllable && inp.pressed('hop')) { this.exitGrind(true); return; }
      if (this.grindT < 0 || this.grindT > 1) {
        if (this.grindDir === 1 && r.next) { this.grind = r.next; this.grindT = 0; return; }
        this.exitGrind(false);
      }
    }
    exitGrind(hop) {
      const pts = Math.round(this.grindTime * 2) + 1;
      this.events.push({ type: 'grindEnd', pts });
      this.boost = Math.max(this.boost, Math.min(2.0, 0.6 + this.grindTime * 0.35)); FW.Audio.sfx.boost(2);
      this.grind = null; this.onGround = false; this.vy = hop ? HOP_V : 2.5; this.air = 0; this.tricksThisAir = 0; FW.Audio.setGrind(false);
      if (hop) FW.Audio.sfx.hop();
    }
    // ---- visuals & camera ----
    updateVisual(dt, steer, W) {
      this.squash = U.damp(this.squash, 1, 10, dt);
      this.visualYawOffset = U.damp(this.visualYawOffset, this.drift.active ? -this.drift.dir * 0.5 : 0, 8, dt);
      let extraYaw = 0;
      if (this.spinOut > 0) { this.spinOut -= dt; extraYaw = ((1.3 - Math.max(0, this.spinOut)) / 1.3) * Math.PI * 4; }
      this.visual.position.copy(this.pos); this.visual.rotation.y = this.yaw + this.visualYawOffset + extraYaw;
      const fx_ = Math.sin(this.yaw), fz_ = Math.cos(this.yaw), rx = -fz_, rz = fx_;
      let pitch = 0, roll = 0;
      if (this.onGround) {
        const n = W.normalAt(this.pos.x, this.pos.z, _n);
        pitch = Math.atan2(n.x * fx_ + n.z * fz_, n.y);
        roll = -Math.atan2(n.x * rx + n.z * rz, n.y);
      } else if (this.grind) { pitch = -Math.atan2(this.grind.dy * this.grindDir, 1); }
      else pitch = -U.clamp(this.vy * 0.05, -0.45, 0.45);
      const spF = U.clamp(Math.abs(this.speed) / 12, 0, 1);
      this.pitch = U.damp(this.pitch, pitch, 8, dt);
      this.roll = U.damp(this.roll, roll - steer * 0.22 * spF + (this.drift.active ? -this.drift.dir * 0.12 : 0), 8, dt);
      this.tilt.rotation.set(this.pitch, 0, this.roll);
      const s = this.squash; this.tilt.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
      const wings = this.duck.userData.wings;
      this.trickG.rotation.set(0, 0, 0);
      if (this.trick) {
        const p = U.easeInOut(U.clamp(this.trick.t / this.trick.dur, 0, 1)), a = p * Math.PI * 2;
        switch (this.trick.type) { case 'spinR': this.trickG.rotation.y = -a; break; case 'spinL': this.trickG.rotation.y = a; break; case 'front': this.trickG.rotation.x = a; break; case 'back': this.trickG.rotation.x = -a; break; default: this.trickG.rotation.z = a; }
        wings[0].rotation.z = 0.9 + Math.sin(this.t * 30) * 0.5; wings[1].rotation.z = -0.9 - Math.sin(this.t * 30) * 0.5;
      } else if (!this.onGround && this.air > 0.3) { wings[0].rotation.z = U.damp(wings[0].rotation.z, 0.6, 8, dt); wings[1].rotation.z = -wings[0].rotation.z; }
      else { wings[0].rotation.z = U.damp(wings[0].rotation.z, 0, 10, dt); wings[1].rotation.z = -wings[0].rotation.z; }
      this.wheelSpin += this.speed * dt / 0.3;
      const wh = this.scooter.userData.wheels; wh[0].rotation.x = this.wheelSpin; wh[1].rotation.x = this.wheelSpin; wh[1].rotation.y = -steer * 0.35;
      const head = this.duck.userData.head;
      this.headYaw = U.damp(this.headYaw, -steer * 0.5, 8, dt);
      head.rotation.y = this.headYaw; head.rotation.z = -steer * 0.1;
      const honk = this.honkCd > 0.25 ? 1.18 : 1; head.scale.set(U.damp(head.scale.x, honk, 20, dt), U.damp(head.scale.y, honk, 20, dt), U.damp(head.scale.z, honk, 20, dt));
      const spd = U.clamp(Math.abs(this.speed) / MAX, 0, 1);
      this.duck.userData.scarf.rotation.x = -spd * 1.1 + Math.sin(this.t * 14) * 0.15 * spd;
      this.duck.position.y = 0.7 + Math.abs(Math.sin(this.t * 9)) * 0.02 * spd;
    }
    updateCamera(dt, camera, W) {
      const spF = U.clamp(Math.abs(this.speed) / MAX, 0, 1.3);
      const back = 6.4 + spF * 1.6, up = 2.7 + spF * 0.4;
      if (!this.cam.init) { this.cam.yaw = this.yaw; }
      this.cam.yaw = U.angleLerp(this.cam.yaw, this.yaw, this.cam.init ? 1 - Math.exp(-4.5 * dt) : 1);
      const cfx = Math.sin(this.cam.yaw), cfz = Math.cos(this.cam.yaw);
      _v.set(this.pos.x - cfx * back, this.pos.y + up, this.pos.z - cfz * back);
      const gy = W.groundAt(_v.x, _v.z).y + 1.3; if (_v.y < gy) _v.y = gy;
      if (!this.cam.init) { this.cam.pos.copy(_v); this.cam.look.set(this.pos.x, this.pos.y + 1.1, this.pos.z); this.cam.init = true; }
      this.cam.pos.lerp(_v, 1 - Math.exp(-8 * dt));
      _v.set(this.pos.x + cfx * 3, this.pos.y + 1.1, this.pos.z + cfz * 3);
      this.cam.look.lerp(_v, 1 - Math.exp(-10 * dt));
      camera.position.copy(this.cam.pos); camera.lookAt(this.cam.look);
      const fovT = 62 + spF * 9 + (this.boost > 0 ? 8 : 0);
      this.cam.fov = U.damp(this.cam.fov, fovT, 4, dt);
      if (Math.abs(camera.fov - this.cam.fov) > 0.05) { camera.fov = this.cam.fov; camera.updateProjectionMatrix(); }
    }
  }
  Kart.MAX = MAX;
  return Kart;
})();
