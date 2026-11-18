import * as THREE from 'three';

const STAND_H = 1.62;
const CROUCH_H = 1.08;
const HIDE_H = 1.28;
const WALK_SPEED = 3.35;
const SPRINT_SPEED = 5.85;
const SPRINT_MIN_STAMINA = 1;
const CROUCH_SPEED = 1.5;
const RADIUS = 0.34;
const GRAVITY = 12;
const JUMP_SPEED = 4.7;
const HEAD_CLEARANCE = 0.18;
const STEP_HEIGHT = 0.14;
const EPS = 1e-5;

function overlaps(pos, radius, c) {
  const cx = c.cx ?? (c.minX + c.maxX) / 2, cz = c.cz ?? (c.minZ + c.maxZ) / 2;
  const cos = c.cos ?? 1, sin = c.sin ?? 0;
  const hw = c.halfW ?? (c.maxX - c.minX) / 2, hd = c.halfD ?? (c.maxZ - c.minZ) / 2;
  const x = (pos.x - cx) * cos - (pos.z - cz) * sin;
  const z = (pos.x - cx) * sin + (pos.z - cz) * cos;
  return Math.hypot(Math.max(0, Math.abs(x) - hw), Math.max(0, Math.abs(z) - hd)) < radius - EPS;
}

function resolveCollision(pos, radius, colliders, height) {
  // 相邻墙面可能互相推挤，重复投影直到不再重叠。
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const c of colliders) {
      if (pos.y >= (c.maxY ?? c.h ?? Infinity) - EPS || pos.y + height <= (c.minY ?? 0) + EPS) continue;
      if (pos.x < c.minX - radius || pos.x > c.maxX + radius || pos.z < c.minZ - radius || pos.z > c.maxZ + radius) continue;
      const cx = c.cx ?? (c.minX + c.maxX) / 2, cz = c.cz ?? (c.minZ + c.maxZ) / 2;
      const cos = c.cos ?? 1, sin = c.sin ?? 0;
      const hw = c.halfW ?? (c.maxX - c.minX) / 2, hd = c.halfD ?? (c.maxZ - c.minZ) / 2;
      let x = (pos.x - cx) * cos - (pos.z - cz) * sin;
      let z = (pos.x - cx) * sin + (pos.z - cz) * cos;
      const dx = x - Math.max(-hw, Math.min(x, hw));
      const dz = z - Math.max(-hd, Math.min(z, hd));
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = radius - d;
          x += (dx / d) * push;
          z += (dz / d) * push;
        } else {
          const left = x + hw;
          const right = hw - x;
          const up = z + hd;
          const down = hd - z;
          const m = Math.min(left, right, up, down);
          if (m === left) x = -hw - radius;
          else if (m === right) x = hw + radius;
          else if (m === up) z = -hd - radius;
          else z = hd + radius;
        }
        pos.x = cx + x * cos + z * sin;
        pos.z = cz - x * sin + z * cos;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

export class Player {
  constructor(camera, world, audio, input) {
    this.camera = camera;
    this.world = world;
    this.audio = audio;
    this.input = input;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.grounded = true;
    this.landingNoise = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.height = STAND_H;
    this.crouching = false;
    this.sprintEnabled = false;
    this.sprinting = false;
    this.stamina = 100;
    this.bob = 0;
    this.bobAmount = 0;
    this.walkTime = 0;
    this.stepTimer = 0;
    this.noise = 0;
    this.flashlightOn = true;
    this.hiding = null;
    this.nearSpot = null;
    this.hint = '';
    this.moveSpeed = 0;
    this.shake = 0;
    this.dead = false;

    this.setupFlashlight();
  }

  setupFlashlight() {
    const spot = new THREE.SpotLight(0xd8e6ff, 46, 30, 0.46, 0.55, 2);
    spot.position.set(0.16, -0.14, 0.02);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.camera.near = 0.4;
    spot.shadow.camera.far = 32;
    spot.shadow.bias = -0.0016;
    spot.shadow.normalBias = 0.02;
    const target = new THREE.Object3D();
    target.position.set(0.02, -0.04, -6);
    this.camera.add(spot);
    this.camera.add(target);
    spot.target = target;
    this.spot = spot;

    // 手电不额外叠加体积光锥（硬边会破坏画面），仅保留灯光本身
    this.beam = new THREE.Object3D();
    this.camera.add(this.beam);

    // 走廊里补一点极弱的跟随光，避免全黑
    const fill = new THREE.PointLight(0x4b6472, 1.6, 4.5, 2);
    fill.position.set(0, 0.2, 0);
    this.camera.add(fill);
    this.fill = fill;
  }

  dispose() {
    this.camera.remove(this.spot, this.beam, this.spot.target, this.fill);
    this.spot.shadow?.map?.dispose?.();
    this.spot.dispose?.();
    this.fill.dispose?.();
  }

  teleport(x, z, yaw = 0) {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.landingNoise = 0;
    this.crouching = false;
    this.sprintEnabled = false;
    this.sprinting = false;
    this.yaw = yaw;
    this.pitch = 0;
    this.hiding = null;
    this.height = STAND_H;
    this.stamina = 100;
    this.updateCamera(0);
  }

  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  toggleFlashlight() {
    this.flashlightOn = !this.flashlightOn;
    this.spot.visible = this.flashlightOn && !this.hiding;
    this.beam.visible = this.flashlightOn && !this.hiding;
    this.audio.uiClick();
  }

  enterHide(spot) {
    if (this.hiding || !this.grounded || this.position.y > STEP_HEIGHT) return;
    this.hideExit = this.position.clone();
    this.hiding = spot;
    this.sprinting = false;
    const outwardX = Math.sin(spot.yaw);
    const outwardZ = Math.cos(spot.yaw);
    this.position.set(spot.x - outwardX * 0.05, 0, spot.z - outwardZ * 0.05);
    this.yaw = spot.yaw + Math.PI;
    this.height = HIDE_H;
    this.velocity.set(0, 0, 0);
    this.spot.visible = false;
    this.beam.visible = false;
    this.audio.setHidden(true);
  }

  exitHide() {
    if (!this.hiding) return;
    this.hiding = null;
    if (this.hideExit) this.position.copy(this.hideExit);
    this.height = this.crouching ? CROUCH_H : STAND_H;
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.spot.visible = this.flashlightOn;
    this.beam.visible = this.flashlightOn;
    this.audio.setHidden(false);
  }

  candidates(pos = this.position) {
    return this.world.nearbyColliders?.(pos.x, pos.z, RADIUS) ?? this.world.motionColliders ?? this.world.colliders;
  }

  canOccupy(pos, height) {
    if (pos.y + height > (this.world.ceilingHeight ?? 3.4) + EPS) return false;
    return !this.candidates(pos).some(c => pos.y < (c.maxY ?? c.h ?? Infinity) - EPS &&
      pos.y + height > (c.minY ?? 0) + EPS && overlaps(pos, RADIUS, c));
  }

  move(dt) {
    const height = this.height + HEAD_CLEARANCE;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)), Math.ceil(this.velocity.length() * dt / (RADIUS / 2)));
    const stepDt = dt / steps;
    const b = this.world.bounds;
    for (let i = 0; i < steps; i++) {
      for (const axis of ['x', 'z']) {
        this.position[axis] += this.velocity[axis] * stepDt;
        const candidates = this.candidates();
        // Small bases and thresholds can be stepped over; furniture requires a jump.
        if (this.grounded) {
          const oldY = this.position.y;
          let stepY = oldY;
          for (const c of candidates) {
            const top = c.maxY ?? c.h ?? Infinity;
            if (top > oldY && top <= oldY + STEP_HEIGHT + EPS && overlaps(this.position, RADIUS, c)) stepY = Math.max(stepY, top);
          }
          this.position.y = stepY;
          if (!this.canOccupy(this.position, height)) this.position.y = oldY;
        }
        resolveCollision(this.position, RADIUS, candidates, height);
      }
      this.position.x = Math.max(b.minX + RADIUS, Math.min(b.maxX - RADIUS, this.position.x));
      this.position.z = Math.max(b.minZ + RADIUS, Math.min(b.maxZ - RADIUS, this.position.z));

      const oldY = this.position.y;
      this.velocity.y -= GRAVITY * stepDt;
      let nextY = oldY + this.velocity.y * stepDt;
      let floor = 0;
      let ceiling = this.world.ceilingHeight ?? 3.4;
      for (const c of this.candidates()) {
        if (!overlaps(this.position, RADIUS, c)) continue;
        const top = c.maxY ?? c.h ?? Infinity, bottom = c.minY ?? 0;
        if (top <= oldY + EPS) floor = Math.max(floor, top);
        if (bottom >= oldY + height - EPS) ceiling = Math.min(ceiling, bottom);
      }
      const wasGrounded = this.grounded;
      this.grounded = false;
      if (this.velocity.y > 0 && nextY + height >= ceiling) {
        nextY = Math.max(oldY, ceiling - height);
        this.velocity.y = 0;
      } else if (this.velocity.y <= 0 && nextY <= floor) {
        if (!wasGrounded && this.velocity.y < -1.5) {
          this.audio.footstep(true);
          this.landingNoise = 0.3;
        }
        nextY = floor;
        this.velocity.y = 0;
        this.grounded = true;
      }
      this.position.y = nextY;
    }
  }

  update(dt) {
    const input = this.input;

    // 视角
    const look = input.consumeLook();
    if (this.shake <= 0) {
      this.yaw -= look.dx * 0.0022;
      this.pitch -= look.dy * 0.0022;
      this.pitch = Math.max(-1.42, Math.min(1.42, this.pitch));
    }

    if (input.pressed('KeyF')) this.toggleFlashlight();

    if (this.hiding) {
      if (input.pressed('KeyE')) this.exitHide();
      this.noise = 0.03;
      this.updateCamera(dt);
      return;
    }

    if (input.pressed('Tab')) this.sprintEnabled = !this.sprintEnabled && this.stamina > SPRINT_MIN_STAMINA;
    if (input.pressed('ShiftLeft') || input.pressed('ShiftRight')) {
      if (!this.crouching || this.canOccupy(this.position, STAND_H + HEAD_CLEARANCE)) this.crouching = !this.crouching;
      this.height = this.crouching ? CROUCH_H : STAND_H;
    }
    if (input.pressed('KeyE') && this.nearSpot && !this.suppressHide) {
      this.enterHide(this.nearSpot);
      this.updateCamera(dt);
      return;
    }

    // 移动
    let ix = 0;
    let iz = 0;
    if (input.down('KeyW') || input.down('ArrowUp')) iz -= 1;
    if (input.down('KeyS') || input.down('ArrowDown')) iz += 1;
    if (input.down('KeyA') || input.down('ArrowLeft')) ix -= 1;
    if (input.down('KeyD') || input.down('ArrowRight')) ix += 1;
    const moving = ix !== 0 || iz !== 0;
    const len = Math.hypot(ix, iz) || 1;
    ix /= len;
    iz /= len;

    this.sprinting = this.sprintEnabled && !this.crouching && moving && this.stamina > SPRINT_MIN_STAMINA;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - dt * 19);
      if (this.stamina <= SPRINT_MIN_STAMINA) {
        this.sprinting = false;
        this.sprintEnabled = false;
      }
    } else {
      this.stamina = Math.min(100, this.stamina + dt * (moving ? 9 : 14));
    }

    const speed = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;

    if (input.pressed('Space') && this.grounded) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
    }

    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    const dirX = ix * cos + iz * sin;
    const dirZ = -ix * sin + iz * cos;
    const targetX = dirX * speed;
    const targetZ = dirZ * speed;

    const accel = 1 - Math.exp(-14 * dt);
    if (this.grounded || moving) {
      this.velocity.x += (targetX - this.velocity.x) * accel;
      this.velocity.z += (targetZ - this.velocity.z) * accel;
    }
    this.move(dt);

    this.moveSpeed = Math.hypot(this.velocity.x, this.velocity.z);

    // 噪声（供鬼听声）
    let noise = 0;
    if (this.grounded && this.moveSpeed > 0.4) {
      noise = this.crouching ? 0.12 : this.sprinting ? 1.0 : 0.4;
    }
    this.landingNoise = Math.max(0, this.landingNoise - dt);
    this.noise = this.landingNoise > 0 ? 0.8 : noise;

    // 脚步
    if (this.grounded && this.moveSpeed > 0.6) {
      this.walkTime += dt * (this.sprinting ? 9.5 : 6.2);
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = this.sprinting ? 0.31 : 0.47;
        this.audio.footstep(this.sprinting, this.crouching);
      }
    } else {
      this.stepTimer = 0.2;
    }

    // 头部起伏
    const targetBob = this.grounded && this.moveSpeed > 0.4 ? (this.sprinting ? 1 : 0.55) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 6);
    this.bob += dt * (this.sprinting ? 11 : 7.2);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 1.8);

    // 交互检测
    this.nearSpot = null;
    let bestDot = 0.1;
    for (const s of this.world.hideSpots) {
      if (!this.grounded || this.position.y > STEP_HEIGHT) continue;
      const dx = s.x - this.position.x;
      const dz = s.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.1) continue;
      const f = this.forward();
      const dot = (dx / (d || 1)) * f.x + (dz / (d || 1)) * f.z;
      if (dot > bestDot || d < 0.9) {
        bestDot = dot;
        this.nearSpot = s;
      }
    }
    this.hint = this.nearSpot ? '按 E 躲进这里' : '';

    this.updateCamera(dt);
  }

  updateCamera(dt) {
    const bobY = Math.sin(this.bob * 2) * 0.022 * this.bobAmount;
    const bobX = Math.cos(this.bob) * 0.014 * this.bobAmount;
    const breathe = Math.sin(performance.now() * 0.0016) * 0.006;
    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * 0.05 * this.shake : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * 0.05 * this.shake : 0;

    this.camera.position.set(
      this.position.x + bobX + shakeX,
      this.position.y + this.height + bobY + breathe + shakeY,
      this.position.z,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    const targetFov = this.sprinting ? 78 : 72;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, (dt || 0.016) * 6);
      this.camera.updateProjectionMatrix();
    }
  }
}
