import * as THREE from 'three';
import { ghostSkin } from './textures.js';

// 破布长袍：下摆撕裂、褶皱、半透明
const ROBE_VERT = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vPos;
  void main() {
    vUv = uv;
    vPos = position;
    vec3 p = position;
    p.x += sin(uTime * 1.3 + position.y * 3.0) * 0.02;
    p.z += cos(uTime * 1.1 + position.y * 2.4) * 0.02;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const ROBE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vPos;

  float hash(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p.yx + 19.19);
    return fract((p.x + p.y) * p.x);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
  }

  void main() {
    float n = noise(vUv * vec2(16.0, 7.0) + vec2(0.0, -uTime * 0.18));
    float n2 = noise(vUv * vec2(46.0, 18.0) + vec2(uTime * 0.05, 0.0));

    // 撕裂下摆
    float hem = 0.22 + n * 0.26;
    if (vUv.y < hem) discard;

    // 竖向褶皱
    float fold = 0.55 + 0.45 * (sin(vUv.x * 46.0 + n * 4.0) * 0.5 + 0.5);
    vec3 col = mix(vec3(0.012, 0.014, 0.016), vec3(0.115, 0.13, 0.132), smoothstep(hem, 0.62, vUv.y));
    col *= fold * (0.75 + n2 * 0.35);

    float a = uOpacity * (0.5 + 0.4 * smoothstep(0.08, 0.55, vUv.y));
    a *= 0.85 + n * 0.2;
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }
`;

function limb(parent, ax, ay, az, bx, by, bz, radius, mat) {
  const a = new THREE.Vector3(ax, ay, az);
  const b = new THREE.Vector3(bx, by, bz);
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CapsuleGeometry(radius, Math.max(0.01, len - radius * 2), 4, 8);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(mesh);
  return mesh;
}

export class Ghost {
  constructor(world, player, audio, hooks = {}) {
    this.world = world;
    this.player = player;
    this.audio = audio;
    this.hooks = hooks;

    this.group = new THREE.Group();
    this.group.visible = false;

    const skinSet = ghostSkin(1337);
    this.skinMat = new THREE.MeshPhysicalMaterial({
      map: skinSet.map,
      normalMap: skinSet.normalMap,
      roughnessMap: skinSet.roughnessMap,
      roughness: 1,
      metalness: 0.02,
      clearcoat: 0.4,
      clearcoatRoughness: 0.45,
      color: 0x6f7a6b,
      normalScale: new THREE.Vector2(1.35, 1.35),
      transparent: true,
      opacity: 1,
      side: THREE.FrontSide,
    });
    this.boneMat = new THREE.MeshStandardMaterial({
      color: 0x6a6355,
      roughness: 0.92,
      metalness: 0,
      transparent: true,
      opacity: 1,
    });
    this.bloodMat = new THREE.MeshStandardMaterial({
      color: 0x3a0d0a,
      roughness: 0.25,
      metalness: 0.05,
      transparent: true,
      opacity: 1,
    });
    this.darkMat = new THREE.MeshStandardMaterial({
      color: 0x050506,
      roughness: 0.92,
      transparent: true,
      opacity: 1,
    });
    this.hairMat = new THREE.MeshStandardMaterial({
      color: 0x060605,
      roughness: 1,
      transparent: true,
      opacity: 1,
    });
    this.eyeMat = new THREE.MeshBasicMaterial({
      color: 0xff5a3c,
      transparent: true,
      opacity: 1,
      fog: false,
    });

    // 躯干（前倾、消瘦）
    this.torsoGroup = new THREE.Group();
    this.group.add(this.torsoGroup);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.66, 8, 18), this.skinMat);
    torso.position.set(0, 1.36, 0.02);
    torso.scale.set(1, 1.12, 0.74);
    this.torsoGroup.add(torso);

    // 外露的肋骨
    for (let i = 0; i < 7; i++) {
      const rib = new THREE.Mesh(
        new THREE.TorusGeometry(0.175 - i * 0.01, 0.008, 5, 16, Math.PI * 1.32),
        this.boneMat,
      );
      rib.position.set(0, 1.13 + i * 0.082, 0.06);
      rib.rotation.x = Math.PI / 2;
      rib.rotation.z = Math.PI * 0.84;
      this.torsoGroup.add(rib);
    }

    // 脊椎
    for (let i = 0; i < 10; i++) {
      const v = new THREE.Mesh(new THREE.SphereGeometry(0.023, 6, 6), this.boneMat);
      v.position.set(0, 0.9 + i * 0.082, -0.155 + i * 0.003);
      this.torsoGroup.add(v);
    }

    // 头（过长脖颈 + 大开的下颌）
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 1.98, 0.04);
    this.torsoGroup.add(this.headGroup);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.36, 10), this.skinMat);
    neck.position.set(0, 0.1, -0.01);
    this.headGroup.add(neck);

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.195, 20, 16), this.skinMat);
    skull.position.set(0, 0.38, 0.02);
    skull.scale.set(0.88, 1.14, 0.98);
    this.headGroup.add(skull);

    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.045, 0.09), this.skinMat);
    brow.position.set(0, 0.44, 0.145);
    this.headGroup.add(brow);

    this.jaw = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.07, 0.17), this.skinMat);
    this.jaw.position.set(0, 0.275, 0.12);
    this.jaw.rotation.x = 0.5;
    this.headGroup.add(this.jaw);

    // 牙齿
    for (let i = 0; i < 6; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.035, 4), this.boneMat);
      tooth.position.set(-0.05 + i * 0.02, 0.315, 0.195);
      tooth.rotation.x = Math.PI;
      this.headGroup.add(tooth);
    }

    // 嘴里的血
    const blood = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.22, 6), this.bloodMat);
    blood.position.set(0, 0.16, 0.17);
    blood.rotation.x = 0.12;
    this.headGroup.add(blood);
    const bloodDrop = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), this.bloodMat);
    bloodDrop.position.set(0, 0.04, 0.185);
    this.headGroup.add(bloodDrop);

    // 眼窝与眼
    for (const sx of [-0.074, 0.074]) {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), this.darkMat);
      socket.position.set(sx, 0.415, 0.15);
      socket.scale.z = 0.7;
      this.headGroup.add(socket);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 8), this.eyeMat);
      eye.position.set(sx, 0.415, 0.188);
      this.headGroup.add(eye);
    }

    // 湿黏的长发
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const hair = new THREE.Mesh(
        new THREE.BoxGeometry(0.016, 0.45 + Math.random() * 0.4, 0.035),
        this.hairMat,
      );
      hair.position.set(Math.cos(a) * 0.155, 0.24 - Math.random() * 0.08, Math.sin(a) * 0.14);
      hair.rotation.z = Math.cos(a) * 0.32;
      hair.rotation.x = Math.sin(a) * 0.22;
      this.headGroup.add(hair);
    }

    // 过长的手臂与爪
    this.arms = [];
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(side * 0.22, 1.7, 0.02);
      this.torsoGroup.add(g);
      limb(g, 0, 0, 0, side * 0.06, -0.5, 0.05, 0.055, this.skinMat);
      limb(g, side * 0.06, -0.5, 0.05, side * 0.1, -1.04, 0.11, 0.044, this.skinMat);
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), this.skinMat);
      palm.position.set(side * 0.1, -1.075, 0.11);
      palm.scale.set(1, 1.35, 0.62);
      g.add(palm);
      for (let f = 0; f < 5; f++) {
        const finger = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.17 + Math.random() * 0.06, 5), this.skinMat);
        finger.position.set(side * 0.1 + (f - 2) * 0.021, -1.19, 0.11);
        finger.rotation.x = Math.PI * 0.93;
        finger.rotation.z = (f - 2) * 0.09;
        g.add(finger);
      }
      this.arms.push(g);
    }

    // 细长的腿
    for (const side of [-1, 1]) {
      limb(this.torsoGroup, side * 0.1, 0.95, 0, side * 0.14, 0.5, 0.05, 0.058, this.skinMat);
      limb(this.torsoGroup, side * 0.14, 0.5, 0.05, side * 0.12, 0.07, -0.01, 0.042, this.skinMat);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.055, 0.26), this.skinMat);
      foot.position.set(side * 0.12, 0.032, 0.09);
      this.torsoGroup.add(foot);
    }

    // 破布长袍
    const robeGeo = new THREE.CylinderGeometry(0.27, 0.5, 0.98, 28, 8, true);
    robeGeo.translate(0, 0.72, 0);
    this.robeMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
      vertexShader: ROBE_VERT,
      fragmentShader: ROBE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.torsoGroup.add(new THREE.Mesh(robeGeo, this.robeMat));

    // 幽光
    this.light = new THREE.PointLight(0x5f9aa8, 0, 5, 2);
    this.light.position.set(0, 1.75, 0.45);
    this.group.add(this.light);

    this.position = new THREE.Vector3();
    this.state = 'DORMANT';
    this.activity = 0;
    this.cooldown = 12;
    this.huntEnabled = false;
    this.time = 0;
    this.opacity = 0;
    this.apparition = 0;
    this.ambientTimer = 7 + Math.random() * 6;
    this.path = null;
    this.pathIdx = 0;
    this.repathTimer = 0;
    this.lastKnown = new THREE.Vector3();
    this.huntTime = 0;
    this.lostSight = 0;
    this.retreatTime = 0;
    this.dead = false;
  }

  reset(awayFrom) {
    this.state = 'DORMANT';
    this.activity = 0;
    this.cooldown = 12;
    this.apparition = 0;
    this.opacity = 0;
    this.group.visible = false;
    this.path = null;
    this.dead = false;
    this.roundStart = performance.now();
    this.placeRandomlyNear(awayFrom, 14, 24);
  }

  pressure() {
    return Math.min(1, (performance.now() - (this.roundStart || performance.now())) / 120000);
  }

  placeRandomlyNear(p, minR, maxR) {
    const spot = this.world.nav.randomWalkableNear(p.x, p.z, minR, maxR, 40);
    if (spot) this.position.copy(spot);
    else this.position.set(this.world.spawns[1].x, 0, this.world.spawns[1].z);
    this.syncMesh(0);
  }

  setHuntEnabled(v) {
    this.huntEnabled = v;
    if (!v && this.state === 'HUNT') this.endHunt(true);
  }

  getDistance() {
    // The ghost reaches the player's body even when their feet are above the floor.
    const d = Math.hypot(this.position.x - this.player.position.x, this.position.z - this.player.position.z);
    return Number.isFinite(d) ? d : 99;
  }

  getTension() {
    if (this.state === 'HUNT') return 1;
    let t = Math.max(0, 1 - this.getDistance() / 17);
    if (this.apparition > 0) t = Math.max(t, 0.82);
    return t * 0.9;
  }

  startHunt() {
    this.state = 'HUNT';
    this.huntTime = 24;
    this.lostSight = 0;
    this.activity = 100;
    this.path = null;
    this.repathTimer = 0;
    this.lastKnown.copy(this.player.position);

    const spot = this.world.nav.randomWalkableNear(this.player.position.x, this.player.position.z, 9, 15, 40);
    if (spot) this.position.copy(spot);

    this.group.visible = true;
    this.opacity = 1;
    this.audio.stinger();
    this.hooks.onEvent?.('hunt');
  }

  endHunt(retreat = true) {
    this.state = retreat ? 'RETREAT' : 'DORMANT';
    this.retreatTime = 4.5;
    this.cooldown = (26 + Math.random() * 12) * (1 - this.pressure() * 0.5);
    this.activity = 28;
    this.path = null;
    if (retreat) {
      const spot = this.world.nav.randomWalkableNear(this.player.position.x, this.player.position.z, 16, 26, 30);
      if (spot) {
        const tile = this.world.nav.TILE;
        const p = this.world.nav.findPath(
          Math.floor(this.position.x / tile),
          Math.floor(this.position.z / tile),
          Math.floor(spot.x / tile),
          Math.floor(spot.z / tile),
        );
        if (p) {
          this.path = p;
          this.pathIdx = 0;
        }
      }
    } else {
      this.group.visible = false;
    }
  }

  update(dt) {
    this.time += dt;
    this.robeMat.uniforms.uTime.value = this.time;

    if (this.state === 'HUNT') this.updateHunt(dt);
    else if (this.state === 'RETREAT') this.updateRetreat(dt);
    else this.updateDormant(dt);

    const targetOpacity = this.state === 'HUNT' ? 1 : this.apparition > 0 ? 0.88 : 0;
    this.opacity += (targetOpacity - this.opacity) * Math.min(1, dt * 6);
    this.applyOpacity();

    if (this.opacity < 0.02 && this.apparition <= 0) this.group.visible = false;
    else if (this.state !== 'DORMANT' || this.apparition > 0) this.group.visible = true;

    this.syncMesh(dt);
  }

  applyOpacity() {
    const o = this.opacity;
    this.skinMat.opacity = o;
    this.boneMat.opacity = o;
    this.bloodMat.opacity = o;
    this.darkMat.opacity = o;
    this.hairMat.opacity = o;
    this.eyeMat.opacity = o;
    this.skinMat.depthWrite = o > 0.9;
    this.boneMat.depthWrite = o > 0.9;
    this.bloodMat.depthWrite = o > 0.9;
    this.robeMat.uniforms.uOpacity.value = o;
    this.light.intensity = o * (1.0 + (1 - Math.min(1, this.getDistance() / 14)) * 0.8);
  }

  updateDormant(dt) {
    if (this.apparition > 0) {
      this.apparition -= dt;
      // 显形时面对玩家
      const dx = this.player.position.x - this.position.x;
      const dz = this.player.position.z - this.position.z;
      this.group.rotation.y = Math.atan2(dx, dz);
      if (this.apparition <= 0) this.placeRandomlyNear(this.player.position, 14, 24);
    }

    this.cooldown = Math.max(0, this.cooldown - dt);

    if (this.huntEnabled) {
      const d = this.getDistance();
      let growth = 0.85 + this.player.noise * 2.4;
      growth *= 1 + this.pressure() * 0.9;
      if (d < 9) growth += 0.9;
      if (this.player.flashlightOn && d < 14) growth += 0.5;
      this.activity = Math.min(100, this.activity + growth * dt);

      if (this.activity >= 100 && this.cooldown <= 0 && this.apparition <= 0) {
        this.startHunt();
        return;
      }
    }

    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 9 + Math.random() * 9;
      this.triggerAmbient();
    }
  }

  triggerAmbient() {
    const r = Math.random();
    if (r < 0.34) {
      this.audio.whisper();
      this.hooks.onEvent?.('whisper');
    } else if (r < 0.62) {
      this.audio.doorCreak();
      this.hooks.onEvent?.('creak');
    } else if (r < 0.8) {
      this.hooks.onEvent?.('flicker');
    } else {
      const spot = this.world.nav.randomWalkableNear(this.player.position.x, this.player.position.z, 8, 15, 40);
      if (spot && this.world.nav.lineOfSight(this.player.position.x, this.player.position.z, spot.x, spot.z)) {
        this.position.copy(spot);
        this.apparition = 2.4;
        this.group.visible = true;
        this.audio.whisper();
        this.hooks.onEvent?.('apparition');
      } else {
        this.audio.whisper();
        this.hooks.onEvent?.('whisper');
      }
    }
  }

  updateHunt(dt) {
    this.huntTime -= dt;
    const player = this.player;
    const dist = this.getDistance();
    const los = this.world.nav.lineOfSight(this.position.x, this.position.z, player.position.x, player.position.z);

    let detected = false;
    if (!player.hiding) {
      if (los && dist < 17) detected = true;
      if (player.flashlightOn && dist < 20) detected = true;
      if (player.noise > 0.7 && dist < 19) detected = true;
    }

    if (detected) {
      this.lastKnown.copy(player.position);
      this.lostSight = 0;
    } else {
      this.lostSight += dt * (player.hiding ? 2.2 : 1);
    }

    this.repathTimer -= dt;
    if (this.repathTimer <= 0) {
      this.repathTimer = 0.35;
      const g = this.world.nav.tileOf(this.position.x, this.position.z);
      const t = this.world.nav.tileOf(this.lastKnown.x, this.lastKnown.z);
      const p = this.world.nav.findPath(g.x, g.z, t.x, t.z);
      if (p) {
        this.path = p;
        this.pathIdx = 0;
      }
    }

    const speed = detected && dist < 9 ? 6.05 : 5.5;
    this.followPath(dt, speed);

    if (!player.hiding && dist < 1.35 && this.dead === false) {
      this.dead = true;
      this.hooks.onDeath?.();
    }

    if (this.huntTime <= 0 || this.lostSight > 6.5) this.endHunt(true);
  }

  updateRetreat(dt) {
    this.retreatTime -= dt;
    this.followPath(dt, 3.4);
    if (this.retreatTime <= 0) {
      this.state = 'DORMANT';
      this.group.visible = false;
      this.apparition = 0;
      this.ambientTimer = 8 + Math.random() * 6;
    }
  }

  followPath(dt, speed) {
    if (!this.path || this.pathIdx >= this.path.length) return;
    const target = this.path[this.pathIdx];
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.32) {
      this.pathIdx++;
      return;
    }
    const step = Math.min(d, speed * dt);
    this.position.x += (dx / d) * step;
    this.position.z += (dz / d) * step;
    const desiredYaw = Math.atan2(dx, dz);
    let diff = desiredYaw - this.group.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.group.rotation.y += diff * Math.min(1, dt * 7);
  }

  syncMesh() {
    const t = this.time;
    const hunt = this.state === 'HUNT';
    const twitch = Math.sin(t * 12.7) > 0.975 ? 0.4 : 0;

    this.group.position.set(this.position.x, 0.02 + Math.sin(t * 1.25) * 0.035, this.position.z);

    this.torsoGroup.rotation.z = Math.sin(t * 0.8) * 0.045;
    this.torsoGroup.rotation.x = (hunt ? 0.28 : 0.18) + Math.sin(t * 1.05) * 0.03;

    this.headGroup.rotation.z = Math.sin(t * 1.6) * 0.08 + twitch;
    this.headGroup.rotation.x = Math.sin(t * 1.2 + 1) * 0.06 - (hunt ? 0.18 : 0.05);
    this.headGroup.rotation.y = Math.sin(t * 0.9) * 0.16;

    this.jaw.rotation.x = 0.35 + Math.sin(t * 2.4) * 0.1 + (hunt ? 0.28 : 0.04);

    this.arms[0].rotation.x = Math.sin(t * 1.35) * 0.1 - (hunt ? 0.85 : 0.12);
    this.arms[1].rotation.x = Math.sin(t * 1.35 + 2.1) * 0.1 - (hunt ? 0.85 : 0.12);
    this.arms[0].rotation.z = (hunt ? 0.18 : 0.04) + Math.sin(t * 2) * 0.04;
    this.arms[1].rotation.z = -(hunt ? 0.18 : 0.04) - Math.sin(t * 2) * 0.04;
  }
}
