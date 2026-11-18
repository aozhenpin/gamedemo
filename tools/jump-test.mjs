import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Player } from '../src/player.js';
import { Net } from '../src/net.js';
import { createHider } from '../src/hider.js';
import { Ghost } from '../src/ghost.js';

const source = readFileSync(new URL('../src/hospital.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const makeProps = new Function('THREE', `
  const motionColliders = [], colliders = [], furnitureBoxes = [], WALL_H = 3.4;
  const push = (_, g) => g.dispose();
  ${section('function scaleBoxUV(', 'function makeMaterial(')}
  ${section('  function addBox(', '  // ---------------------------------------------------------------- 墙体')}
  ${section('  function toilet(', '  function stall(')}
  return { motionColliders, addBox, toilet };
`);

function fixture(colliders = [], ceilingHeight = 3.4) {
  const down = new Set(), pressed = new Set();
  let footsteps = 0;
  const input = { down: key => down.has(key), pressed: key => pressed.has(key), consumeLook: () => ({ dx: 0, dy: 0 }) };
  const world = { motionColliders: colliders, colliders, hideSpots: [], ceilingHeight,
    bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 } };
  const player = new Player(new THREE.PerspectiveCamera(), world, { footstep() { footsteps++; }, setHidden() {} }, input);
  const tick = dt => { player.update(dt); pressed.clear(); };
  return { player, pressed, down, tick, footsteps: () => footsteps };
}

const controls = fixture();
controls.pressed.add('Tab');
controls.tick(1 / 60);
assert.equal(controls.player.stamina, 100, 'Toggling sprint while still costs no stamina');
controls.down.add('KeyW');
controls.tick(1 / 60);
assert(controls.player.sprinting, 'Sprint starts on movement after releasing Tab');
assert(controls.player.stamina < 100);
controls.down.clear();
controls.tick(1 / 60);
assert(!controls.player.sprinting, 'Stopping movement pauses sprinting');
controls.down.add('KeyW');
controls.tick(1 / 60);
assert(controls.player.sprinting, 'Moving again resumes sprinting');
controls.pressed.add('ShiftLeft');
controls.tick(1 / 60);
assert(controls.player.crouching && !controls.player.sprinting, 'Crouching takes priority over sprint');
controls.pressed.add('ShiftRight');
controls.tick(1 / 60);
assert(!controls.player.crouching && controls.player.sprinting, 'Standing resumes enabled sprint');
controls.pressed.add('Tab');
controls.tick(1 / 60);
assert(!controls.player.sprinting, 'Second Tab turns sprint off');
controls.player.stamina = 1.2;
controls.pressed.add('Tab');
controls.tick(1 / 60);
assert(controls.player.stamina > 0 && controls.player.stamina <= 1);
assert(!controls.player.sprinting && !controls.player.sprintEnabled, 'Exhaustion turns off sprint and its HUD effect');
controls.pressed.add('Tab');
controls.tick(1 / 60);
assert(!controls.player.sprintEnabled, 'Tab cannot enable sprint while exhausted');
for (let i = 0; i < 10; i++) controls.tick(1 / 60);
assert(controls.player.stamina > 1 && !controls.player.sprinting, 'Recovering stamina does not restart sprint');
controls.pressed.add('Tab');
controls.tick(1 / 60);
assert(controls.player.sprinting, 'Tab can enable sprint again after recovery');
controls.player.dispose();

for (const dt of [1 / 144, 1 / 60, 0.05]) {
  for (const sprint of [false, true]) for (const runUp of [0, 0.2, 1]) {
    const ground = fixture(), jumping = fixture();
    for (const f of [ground, jumping]) {
      f.down.add('KeyW');
      if (sprint) f.pressed.add('Tab');
      for (let t = 0; t < runUp; t += dt) f.tick(dt);
    }
    jumping.pressed.add('Space');
    for (let t = 0; t < 0.5; t += dt) {
      // Include an airborne turn as well as a straight jump.
      if (t > 0.25) ground.player.yaw = jumping.player.yaw = Math.PI / 4;
      ground.tick(dt);
      jumping.tick(dt);
      assert(Math.abs(ground.player.position.x - jumping.player.position.x) < 1e-8 &&
        Math.abs(ground.player.position.z - jumping.player.position.z) < 1e-8,
      `dt ${dt}, sprint ${sprint}, run-up ${runUp}: jumping retains ground horizontal movement`);
    }
    ground.player.dispose();
    jumping.player.dispose();
  }
}

for (const dt of [1 / 144, 1 / 60, 0.05, 0.25]) {
  const f = fixture();
  f.pressed.add('Space');
  let peak = 0;
  let airtime = 0;
  for (let t = 0; t < 1.5; t += dt) {
    // Repeated presses while airborne must not reset upward velocity.
    if (t > 0.2 && t < 0.5) f.pressed.add('Space');
    f.tick(dt);
    if (!f.player.grounded) airtime += dt;
    peak = Math.max(peak, f.player.position.y);
    assert(f.player.position.y >= 0);
    assert(Math.abs(f.player.camera.position.y - f.player.position.y - f.player.height) < 0.02);
  }
  assert(peak > 0.8 && peak < 0.96, `dt ${dt}: jump height ${peak}`);
  assert(airtime >= 0.75 - dt && airtime <= 0.81, `dt ${dt}: controlled airtime ${airtime}`);
  assert.equal(f.player.position.y, 0);
  assert(f.player.grounded);
  assert.equal(f.footsteps(), 1, 'Only landing produces a footstep during an idle jump');
  f.player.dispose();

  for (const yaw of [0, Math.PI / 2, Math.PI / 4]) {
    const props = makeProps(THREE);
    props.toilet(0, 0, yaw);
    assert(props.motionColliders.some(c => Math.abs(c.maxY - 0.52) < 1e-6));
    const p = fixture(props.motionColliders);
    // Approach the front half of the seat diagonally through world coordinates.
    p.player.position.set(-0.65, 0, 0.25).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    p.player.velocity.set(1.05, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    p.pressed.add('Space');
    for (let t = 0; t < 1.3; t += dt) p.tick(dt);
    assert(p.player.grounded, 'Landed on toilet');
    assert(Math.abs(p.player.position.y - 0.52) < 1e-6, `dt ${dt}, yaw ${yaw}: seat height ${p.player.position.y}`);
    // Walk off: gravity must resume rather than leaving the player suspended.
    p.down.add('KeyD');
    for (let t = 0; t < 2; t += dt) p.tick(dt);
    assert.equal(p.player.position.y, 0);
    assert(p.player.grounded);
    p.player.teleport(5, 5);
    assert.equal(p.player.velocity.y, 0);
    assert.equal(p.player.position.y, 0);
    p.player.dispose();
  }
}

const props = makeProps(THREE);
props.toilet(0, 0, 0);
const forwardJump = fixture(props.motionColliders);
forwardJump.player.teleport(0, 1.1);
forwardJump.down.add('KeyW');
forwardJump.pressed.add('Space');
let landedOnToilet = false;
for (let i = 0; i < 90; i++) {
  forwardJump.tick(1 / 60);
  if (forwardJump.player.grounded && forwardJump.player.position.y >= 0.52 - 1e-5) landedOnToilet = true;
}
assert(landedOnToilet, 'W + Space can jump onto the actual toilet');
forwardJump.player.dispose();
props.motionColliders.length = 0;
props.addBox('wood', 3, 0.1, 3, 0, 1.95, 0);
const under = fixture(props.motionColliders);
under.pressed.add('Space');
for (let i = 0; i < 90; i++) {
  under.tick(1 / 60);
  assert(under.player.position.y + under.player.height + 0.18 <= 1.9 + 1e-5, 'Head cannot pass through shelf');
}
assert(under.player.grounded);
under.player.dispose();

const lowProps = makeProps(THREE);
lowProps.addBox('wood', 3, 0.1, 3, 0, 1.45, 0);
const crouch = fixture(lowProps.motionColliders);
crouch.player.crouching = true;
crouch.player.height = 1.08;
crouch.pressed.add('ShiftLeft');
crouch.tick(1 / 60);
assert(crouch.player.crouching, 'Cannot stand through low ceiling');
crouch.player.dispose();

const wallProps = makeProps(THREE);
wallProps.addBox('wood', 0.04, 2.35, 4, 0, 1.175, 0);
const wall = fixture(wallProps.motionColliders);
wall.player.teleport(-1, 0);
wall.down.add('KeyD');
wall.pressed.add('Tab');
wall.pressed.add('Space');
for (let i = 0; i < 10; i++) wall.tick(0.25);
assert(wall.player.position.x <= -0.36 + 1e-5, 'Sprinting jump cannot tunnel through a thin door');
wall.player.dispose();

let message;
const net = new Net();
net.send = m => { message = m; };
net.hide(1, 2, 0, -1, 0.52);
assert.equal(message.y, 0.52);
const hidden = createHider(new THREE.Group(), message, { hideSpots: [{ x: 1, z: 2 }] });
assert.equal(hidden.group.position.y, 0.52);
assert.equal(hidden.position.y, 0.52);
assert(!hidden.insideSpot, 'Standing on a prop near a hiding spot must remain visible');
hidden.dispose();
assert.equal(Ghost.prototype.getDistance.call({ position: new THREE.Vector3(0, 0, 0),
  player: { position: new THREE.Vector3(0, 1.5, 0) } }), 0, 'Standing on furniture does not make the player unreachable to the ghost');

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const handleCode = server.slice(server.indexOf('function handle('), server.indexOf('function dropPlayer('));
let started = false;
const handle = new Function('broadcast', 'startHunt', `${handleCode}\nreturn handle;`)(() => {}, () => { started = true; });
const player = { hidden: null };
const ws = { player, room: { phase: 'HIDE', players: [player, { hidden: { y: 0 } }] } };
for (const y of [-1, 4, 'NaN', 'Infinity']) {
  handle(ws, { ...message, y });
  assert.equal(player.hidden, null, 'Server rejects invalid height');
}
handle(ws, message);
assert.equal(player.hidden.y, 0.52);
assert(started, 'Height survives round start');
player.hidden = null;
const legacy = { ...message };
delete legacy.y;
handle(ws, legacy);
assert.equal(player.hidden.y, 0, 'Legacy client defaults to ground');

console.log('Jump passed: stable height at 4 frame rates, no air jumps, real toilet seat at 3 angles, walk-off gravity, head/crouch clearance, thin doors, height synchronization.');
