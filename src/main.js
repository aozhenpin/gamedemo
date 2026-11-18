import * as THREE from 'three';
import { Renderer3D, createDust } from './render.js';
import { generateHospital, TILE } from './hospital.js';
import { Player } from './player.js';
import { Ghost } from './ghost.js';
import { createHider } from './hider.js';
import { AudioSys } from './audio.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Net } from './net.js';

const params = new URLSearchParams(location.search);
const DEV = params.has('dev');
const NOUI = params.has('noui');
const QUALITIES = ['low', 'mid', 'high'];

class Game {
  constructor() {
    this.app = new Renderer3D(document.getElementById('app'));
    this.app.scene.add(this.app.camera);

    this.input = new Input(this.app.renderer.domElement);
    this.audio = new AudioSys();
    this.ui = new UI();

    this.clock = new THREE.Clock();
    this.mode = 'menu';
    this.slot = 0;
    this.roomCode = '';
    this.playerName = '病人';
    this.world = null;
    this.player = null;
    this.ghost = null;
    this.hider = null;
    this.dust = null;
    this.net = null;

    this.deadline = 0;
    this.emfTimer = 0;
    this.breathTimer = 0;
    this.damage = 0;
    this.timeoutSent = false;
    this.foundSent = false;
    this.dead = false;
    this.swapTimers = [];
    this.lastGhostState = 'DORMANT';
    this.qualityIndex = 1;
    this.dev = false;

    this.bindUI();
    this.bindCanvas();
    window.__game = this;

    if (DEV) this.startDev();
    else this.ui.showLobby();

    this._loop = this.loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // ---------------------------------------------------------------- 绑定

  bindUI() {
    this.ui.onJoin = (code, name) => {
      this.audio.unlock();
      this.playerName = (name || '').trim() || '病人';
      this.ui.showWaiting('····');
      if (this.net) this.net.close();
      this.net = new Net(this.netHandlers());
      this.net.join(code, this.playerName);
    };

    this.ui.onAgain = () => {
      this.ui.hideResult();
      this.ui.showWaiting(this.roomCode || '----');
      this.net?.again();
    };

    this.ui.el.hideConfirm.addEventListener('click', () => {
      if (this.mode === 'hide') this.confirmHide();
    });
  }

  bindCanvas() {
    const canvas = this.app.renderer.domElement;
    canvas.addEventListener('click', () => {
      this.audio.unlock();
      if (this.mode === 'play' || this.mode === 'hide') this.input.requestLock();
    });
  }

  netHandlers() {
    return {
      joined: (m) => {
        this.slot = m.slot;
        this.roomCode = m.code;
        this.ui.showWaiting(m.code);
      },
      peerJoined: () => {
        this.ui.setWaitingStatus('两人到齐，正在分配病房…');
      },
      peerLeft: () => {
        this.cleanup();
        this.mode = 'menu';
        this.ui.showLobby('对方离开了病房，请重新输入房间码');
      },
      hidePhase: (m) => this.beginHide(m),
      start: (m) => this.beginSwap(m),
      result: (m) => this.showResult(m),
      error: (m) => {
        this.ui.showLobby(m.message || '无法进入房间');
      },
      onClose: () => {
        if (this.mode !== 'menu') {
          this.cleanup();
          this.mode = 'menu';
          this.ui.showLobby('与服务器断开连接');
        }
      },
    };
  }

  // ---------------------------------------------------------------- 世界

  buildWorld(seed) {
    this.world = generateHospital(seed);
    this.app.scene.add(this.world.group);

    this.dust = createDust();
    this.app.scene.add(this.dust.points);

    this.player = new Player(this.app.camera, this.world, this.audio, this.input);

    this.ghost = new Ghost(this.world, this.player, this.audio, {
      onDeath: () => this.onCaught(),
      onEvent: (type) => this.onGhostEvent(type),
    });
    this.world.group.add(this.ghost.group);
  }

  cleanup() {
    for (const t of this.swapTimers) clearTimeout(t);
    this.swapTimers = [];
    this.input.exitLock();
    if (this.player) this.player.dispose();
    if (this.hider) this.hider.dispose();
    if (this.ghost) this.ghost.group.removeFromParent();
    if (this.dust) this.dust.dispose();
    if (this.world) this.world.dispose();
    this.world = null;
    this.player = null;
    this.ghost = null;
    this.hider = null;
    this.dust = null;
    this.audio.setHidden(false);
    this.ui.setEmf(0, false);
    this.ui.setDamage(0);
    this.ui.setPrompt('');
    this.ui.setCrosshair(false);
    this.dead = false;
    this.foundSent = false;
    this.timeoutSent = false;
    this.damage = 0;
    this.deadline = 0;
    this.lastGhostState = 'DORMANT';
    this.swapAt = 0;
    this.duration = 240000;
  }

  // ---------------------------------------------------------------- 阶段

  beginHide(m) {
    this.cleanup();
    this.slot = m.slot ?? this.slot;
    this.buildWorld(m.seedSelf);
    const sp = this.world.spawns[0];
    this.player.teleport(sp.x, sp.z, -Math.PI / 2);
    this.ghost.reset(this.player.position);
    this.ghost.setHuntEnabled(false);

    this.mode = 'hide';
    this.ui.showHud();
    this.ui.setObjective(
      '<b>躲藏</b> · 找一处柜子或帘后<br><span style="opacity:.6">按 R 确认位置，双方会交换病房</span>',
    );
    this.ui.setTimer(null);
    this.ui.setHideConfirm(true);
    this.ui.setEmf(0, false);
    this.ui.setNote(`G 画质(${QUALITIES[this.qualityIndex]}) · F 手电 · E 躲藏 · TAB 切换冲刺 · SHIFT 蹲下 / 站起 · SPACE 跳跃 · 右键 探测 · R 就位`);
    this.input.requestLock();
  }

  confirmHide() {
    if (this.mode !== 'hide') return;
    if (!this.player.grounded && !this.player.hiding) {
      this.ui.toast('落地站稳后再按 R 就位');
      return;
    }

    // 不允许贴入口躲藏，否则对方一进来就会撞上
    const sp = this.world.spawns;
    const d0 = Math.hypot(sp[0].x - this.player.position.x, sp[0].z - this.player.position.z);
    const d1 = Math.hypot(sp[1].x - this.player.position.x, sp[1].z - this.player.position.z);
    if (Math.min(d0, d1) < 7) {
      this.ui.toast('离入口太近了，往里走一点再躲');
      this.audio.uiClick();
      return;
    }

    this.net?.hide(
      this.player.position.x,
      this.player.position.z,
      this.player.yaw,
      this.player.hiding ? this.world.hideSpots.indexOf(this.player.hiding) : -1,
      this.player.position.y,
    );
    this.mode = 'hideWait';
    this.ui.setHideConfirm(false);
    this.ui.setObjective(
      '已就位 · 等待对方确认<br><span style="opacity:.6">对方确认后，你们会交换病房</span>',
    );
    this.ui.setPrompt('位置已记录');
    this.ui.toast('位置已记录，等待对方…');
    this.audio.uiClick();
  }

  beginSwap(m) {
    this.mode = 'swap';
    this.ui.setHideConfirm(false);
    this.ui.setPrompt('');
    this.ui.overlayOn('交换病房');
    this.audio.transitionRinging();
    this.input.exitLock();

    this.swapTimers.push(
      setTimeout(() => {
        this.cleanup();
        this.world = generateHospital(m.seeds[m.youAreOn]);
        this.app.scene.add(this.world.group);
        this.dust = createDust();
        this.app.scene.add(this.dust.points);
        this.player = new Player(this.app.camera, this.world, this.audio, this.input);
        this.ghost = new Ghost(this.world, this.player, this.audio, {
          onDeath: () => this.onCaught(),
          onEvent: (type) => this.onGhostEvent(type),
        });
        this.world.group.add(this.ghost.group);

        // 从病房另一端的入口进入，避免与躲藏点重叠
        const sp = this.world.spawns[1];
        this.player.teleport(sp.x, sp.z, Math.PI / 2);
        this.hider = createHider(this.world.group, m.peerHidden, this.world);
        this.ghost.reset(this.player.position);
        this.ghost.setHuntEnabled(true);

        this.ui.setObjective(
          '<b>寻找</b> · 举起 EMF 探测器定位对方<br><span style="opacity:.65">避开鬼 · 别一直奔跑</span>',
        );
        this.ui.setTimer((m.duration || 180000) / 1000);
        this.ui.setEmf(0, false);
        this.ui.setDamage(0);
        this.damage = 0;
        this.foundSent = false;
        this.dead = false;
        this.timeoutSent = false;
        this.lastGhostState = 'DORMANT';
        this.duration = m.duration || 180000;
        // 转场结束后由主循环切换为可操作状态（不依赖后台被节流的定时器）
        this.swapAt = performance.now() + 2000;
      }, 1200),
    );
  }

  finishSwap() {
    if (this.mode !== 'swap' || !this.world) return;
    this.swapAt = 0;
    this.ui.overlayOff();
    this.mode = 'play';
    this.deadline = performance.now() + (this.duration || 240000);
    this.needLock = true;
    this.input.requestLock();
    this.ui.toast('你进入了对方的病房 · 按住右键举起 EMF 探测器');
  }

  onGhostEvent(type) {
    if (type === 'hunt') {
      this.ui.toast('它开始猎杀了', 2000);
      this.ui.setObjective(
        '<b style="color:#c96a5c">猎杀开始</b> · 躲进柜子，或断开视线<br><span style="opacity:.65">不要奔跑</span>',
      );
    }
  }

  onCaught() {
    if (this.dead) return;
    this.dead = true;
    this.damage = 1;
    this.audio.catchSound();
    this.mode = 'done';
    this.input.exitLock();
    this.ui.overlayOn('你被抓住了');
    this.ui.setPrompt('');
    this.net?.died();
    setTimeout(() => this.ui.overlayOff(), 1800);
  }

  onFound() {
    if (this.foundSent) return;
    this.foundSent = true;
    this.audio.foundSound();
    this.hider?.reveal();
    this.mode = 'done';
    this.input.exitLock();
    this.ui.overlayOn('找到了');
    this.ui.setPrompt('');
    this.ui.toast('你找到了对方');
    this.net?.found();
    setTimeout(() => this.ui.overlayOff(), 1200);
  }

  showResult(m) {
    this.mode = 'done';
    this.input.exitLock();
    this.ui.overlayOff();

    const you = m.you ?? this.slot;
    const win = m.winner === you;
    const draw = m.winner === null || m.winner === undefined;
    const youName = m.names?.[you] || this.playerName;
    const peerName = m.names?.[1 - you] || '病人';

    let title = '平局';
    let reason = '时间耗尽，谁也没找到对方';
    if (!draw) {
      if (win) {
        title = '你赢了';
        reason = m.reason === 'ghost' ? '对方被鬼抓住了' : '你先找到了对方';
      } else {
        title = '你输了';
        reason = m.reason === 'ghost' ? '你被鬼抓住了' : '对方先找到了你';
      }
    }

    this.ui.showResult({ win: win || draw, title, reason, youName, peerName });
    this.ui.setTimer(null);
  }

  // ---------------------------------------------------------------- 开发模式

  startDev() {
    this.dev = true;
    this.ui.hideAll();
    const seed = Number(params.get('seed')) || 20261112;
    this.buildWorld(seed);
    const sp = this.world.spawns[0];
    this.player.teleport(sp.x, sp.z, -Math.PI / 2);

    const room = this.world.rooms.find((r) => r.type === 'ward') || this.world.rooms[0];
    const hp = {
      x: ((room.x0 + room.x1) / 2 + 0.5) * TILE,
      z: ((room.z0 + room.z1) / 2 + 0.5) * TILE,
      yaw: 0,
    };
    this.hider = createHider(this.world.group, hp, this.world);
    this.ghost.setHuntEnabled(true);
    this.ghost.reset(this.player.position);

    this.deadline = performance.now() + 240000;
    this.mode = 'play';
    this.ui.showHud();
    this.ui.onAgain = () => location.reload();
    this.ui.setObjective('开发预览 · 寻找对方（按 E 检查藏身处）');
    this.ui.setTimer(240);

    const cam = params.get('cam');
    if (cam) this.applyCamPreset(cam);
    this.ghost.reset(this.player.position);
    if (cam === 'ghost') this.setupGhostShot();

    if (NOUI) this.ui.el.hud.classList.add('hidden');
    this.ui.el.note.style.display = 'none';
    window.__ready = true;
  }

  applyCamPreset(cam) {
    const w = this.world;
    const roomOf = (type) => w.rooms.find((r) => r.type === type) || w.rooms[0];

    if (cam === 'ward' || cam === 'or') {
      const room = roomOf(cam === 'or' ? 'or' : 'ward');
      const door = room.doors[0];
      const cx = ((room.x0 + room.x1) / 2 + 0.5) * TILE;
      const cz = ((room.z0 + room.z1) / 2 + 0.5) * TILE;
      if (!door) {
        this.player.teleport(cx, cz, 0);
      } else {
        const inward = { n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] }[door.side];
        const px = (door.x + 0.5) * TILE + inward[0] * 1.6;
        const pz = (door.z + 0.5) * TILE + inward[1] * 1.6;
        const yaw = Math.atan2(-inward[0], -inward[1]);
        this.player.teleport(px, pz, yaw);
      }
      this.player.pitch = -0.04;
      this.player.updateCamera(0);
    } else if (cam === 'corridor') {
      this.player.teleport(w.spawns[0].x, w.spawns[0].z, -Math.PI / 2);
    } else if (cam === 'ghost') {
      this.player.teleport(w.spawns[0].x, w.spawns[0].z, -Math.PI / 2);
    } else if (cam === 'hub') {
      const hx = ((w.hub.x0 + w.hub.x1) / 2 + 0.5) * TILE;
      const hz = ((w.hub.z0 + w.hub.z1) / 2 + 0.5) * TILE;
      this.player.teleport(hx, hz + 3.2, 0);
      this.player.pitch = -0.05;
      this.player.updateCamera(0);
    }
  }

  setupGhostShot() {
    const g = this.ghost;
    g.state = 'DORMANT';
    g.apparition = 9999;
    g.opacity = 1;
    g.applyOpacity();
    g.group.visible = true;
    g.position.copy(this.player.position).add(this.player.forward().multiplyScalar(4.6));
    g.position.y = 0;
    g.syncMesh(0);
    this.player.pitch = 0.02;
    this.player.updateCamera(0);
  }

  // ---------------------------------------------------------------- 循环

  loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.mode === 'swap' && this.swapAt && performance.now() >= this.swapAt) {
      this.finishSwap();
    }

    if (this.mode !== 'menu' && this.world) {
      this.update(dt);
    }

    const canMove = this.mode === 'hide' || this.mode === 'play';
    this.ui.setSprint(canMove && this.player?.sprintEnabled, canMove && this.player?.sprinting);

    if (this.dust) this.dust.update(dt, this.app.camera);
    this.app.render(dt);
    this.input.endFrame();
  }

  update(dt) {
    const input = this.input;
    const player = this.player;

    if (input.pressed('KeyG')) {
      this.qualityIndex = (this.qualityIndex + 1) % QUALITIES.length;
      this.app.setQuality(QUALITIES[this.qualityIndex]);
      this.ui.setNote(`G 画质(${QUALITIES[this.qualityIndex]}) · F 手电 · E 躲藏 · TAB 切换冲刺 · SHIFT 蹲下 / 站起 · SPACE 跳跃 · 右键 探测 · R 就位`);
      this.ui.toast(`画质：${QUALITIES[this.qualityIndex]}`);
    }

    if (this.mode === 'hide') {
      if (input.pressed('KeyR')) {
        this.confirmHide();
      }
    }

    if (this.mode === 'hide' || this.mode === 'play') {
      // 「检查藏身处」优先于「自己躲进去」，避免按 E 结果把自己关进柜子
      let canCheck = false;
      if (this.mode === 'play' && this.hider?.insideSpot && this.hider.spot) {
        const s = this.hider.spot;
        const d = Math.hypot(s.x - player.position.x, s.z - player.position.z);
        const f = player.forward();
        const dot = d > 0.01 ? ((s.x - player.position.x) / d) * f.x + ((s.z - player.position.z) / d) * f.z : 1;
        canCheck = d < 2.2 && dot > 0.2;
        if (canCheck && input.pressed('KeyE')) {
          this.onFound();
          return;
        }
        // 贴脸注视 1.2 秒也能触发，避免玩家不知道要按 E
        if (d < 1.8 && dot > 0.5) {
          this.revealDwell = (this.revealDwell || 0) + dt;
          if (this.revealDwell > 1.2) {
            this.onFound();
            return;
          }
        } else {
          this.revealDwell = 0;
        }
      } else {
        this.revealDwell = 0;
      }
      player.suppressHide = canCheck;

      player.update(dt);

      if (this.ghost) {
        this.ghost.update(dt);
        if (this.mode === 'play' && this.ghost.state !== this.lastGhostState) {
          if (this.lastGhostState === 'HUNT' && this.ghost.state !== 'HUNT') {
            this.ui.setObjective(
              '<b>寻找</b> · 举起 EMF 探测器定位对方<br><span style="opacity:.65">它暂时退开了</span>',
            );
          }
          this.lastGhostState = this.ghost.state;
        }
      }
      if (this.hider) this.hider.update(dt);
      this.world.update(dt, { hunt: this.ghost?.state === 'HUNT' });

      this.ui.setPrompt(player.hiding ? '按 E 离开' : canCheck ? '按 E 检查藏身处' : player.hint);
      if (!this.input.locked && (this.mode === 'play' || this.mode === 'hide')) {
        this.ui.setPrompt('点击画面以控制视角');
      }
      this.ui.setStamina(player.stamina);

      const tension = this.ghost ? this.ghost.getTension() : 0;
      this.audio.update(dt, tension, this.ghost?.state === 'HUNT');
      this.app.setGrade({
        fear: this.mode === 'play' ? tension : tension * 0.35,
        damage: this.damage,
        ca: tension * 0.6,
      });
      this.damage = Math.max(0, this.damage - dt * 0.8);
      this.ui.setDamage(this.damage);

      if (this.mode === 'play') {
        this.updateTimer();
        this.updateEmf(dt);
        this.checkFound();
        this.updateCrosshair();
      }
    } else if (this.mode === 'hideWait') {
      this.ghost?.update(dt);
      this.world.update(dt, { hunt: false });
      this.ui.setPrompt('等待对方就位…');
      this.audio.update(dt, 0, false);
    }
  }

  updateTimer() {
    const remain = Math.max(0, (this.deadline - performance.now()) / 1000);
    this.ui.setTimer(remain);
    if (remain <= 0 && !this.timeoutSent) {
      this.timeoutSent = true;
      this.net?.timeout();
    }
  }

  updateEmf(dt) {
    const held = this.input.mouse.right && !this.player.hiding && this.mode === 'play';
    if (!held || !this.hider) {
      this.emfTimer = 0;
      this.ui.setEmf(0, false);
      // 不举探测器时，靠得很近也能听到对方的呼吸
      if (this.hider) {
        const d = this.hider.position.distanceTo(this.player.position);
        this.nearBreathTimer = (this.nearBreathTimer || 0) - dt;
        if (d < 7 && this.nearBreathTimer <= 0) {
          this.audio.breath?.();
          this.nearBreathTimer = 3.2;
        }
      }
      return;
    }

    const d = this.hider.position.distanceTo(this.player.position);
    const level = d < 2.5 ? 5 : d < 5 ? 4 : d < 9 ? 3 : d < 15 ? 2 : d < 24 ? 1 : 0;

    this.emfTimer -= dt;
    if (this.emfTimer <= 0 && level > 0) {
      this.audio.beep(level / 5);
      this.emfTimer = 0.16 + Math.min(2.4, d * 0.04);
    }

    this.breathTimer -= dt;
    if (d < 12 && this.breathTimer <= 0) {
      this.audio.breath?.();
      this.breathTimer = 2.6;
    }

    this.ui.setEmf(level, true);
  }

  checkFound() {
    if (!this.hider || this.foundSent || this.hider.insideSpot || this.player.hiding) return;
    const h = this.hider;
    const d = h.position.distanceTo(this.player.position);
    const f = this.player.forward();
    const dx = h.position.x - this.player.position.x;
    const dz = h.position.z - this.player.position.z;
    const dot = d > 0.01 ? (dx / d) * f.x + (dz / d) * f.z : 1;
    if (d < 2.2 && dot > 0.35) {
      this.onFound();
    }
  }

  updateCrosshair() {
    if (!this.hider) return;
    const d = this.hider.position.distanceTo(this.player.position);
    const f = this.player.forward();
    const dx = this.hider.position.x - this.player.position.x;
    const dz = this.hider.position.z - this.player.position.z;
    const dot = d > 0.01 ? (dx / d) * f.x + (dz / d) * f.z : 1;
    const hot = this.hider.insideSpot ? d < 2.2 && dot > 0.2 : d < 2.2 && dot > 0.35;
    this.ui.setCrosshair(hot);
  }
}

new Game();
