import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Player } from '../src/player.js';

// Run the actual prop builders without browser-only material generation.
const source = readFileSync(new URL('../src/hospital.js', import.meta.url), 'utf8');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a);
  return source.slice(a, b);
};
const colliderCode = section('  function addCollider(', '  // ---------------------------------------------------------------- 墙体');
const pipesCode = section('  function addPipe(', '  // ---------------------------------------------------------------- 窗户');
const rackCode = section('  function coatRack(', '  function bulletinBoard(');
const doorCode = section('  function doorLeaf(', '  for (const door of doors)');
const geometries = [];
const build = new Function('THREE', 'push', 'addBox', 'addCyl', `
  const TILE = 2.2, WALL_H = 3.4, colliders = [], furnitureBoxes = [];
  function addSolidBox() {}
  const placeProp = (build, ...args) => build(...args);
  ${colliderCode}
  ${pipesCode}
  ${rackCode}
  ${doorCode}
  return { colliders, coatRack, addCollider, doubleDoors };
`);
const props = build(THREE, (_, g) => geometries.push(g), () => {}, () => {});
assert.equal(geometries.length, 10);
assert.equal(props.colliders.length, 6, 'Six upright pipes collide; four overhead pipes do not');
for (const g of geometries.slice(4)) {
  g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  assert(props.colliders.some(c => Math.abs(c.minX - min.x) < 1e-5 && Math.abs(c.maxX - max.x) < 1e-5 && Math.abs(c.minZ - min.z) < 1e-5 && Math.abs(c.maxZ - max.z) < 1e-5), 'Collision bounds match the visible pipe');
}
props.coatRack(0, 0);
assert.equal(props.colliders.length, 7, 'Effective coat rack builder adds collision');

function walk(c, axis, sign, mode, dt, offset = 0, colliders = [c]) {
  const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
  const key = axis === 'x' ? (sign > 0 ? 'KeyD' : 'KeyA') : (sign > 0 ? 'KeyS' : 'KeyW');
  let firstFrame = true;
  const input = { consumeLook: () => ({ dx: 0, dy: 0 }), pressed: k => firstFrame && mode === 'sprint' && k === 'Tab', down: k => k === key };
  const world = { colliders, hideSpots: [], bounds: { minX: -100, maxX: 200, minZ: -100, maxZ: 200 } };
  const player = new Player(new THREE.PerspectiveCamera(), world, { footstep() {} }, input);
  player.teleport(cx, cz);
  player.position[axis] -= sign;
  player.position[axis === 'x' ? 'z' : 'x'] += offset;
  player.crouching = mode === 'crouch';
  for (let t = 0; t < 2; t += dt) {
    player.update(dt);
    firstFrame = false;
  }
  const result = player.position[axis] - (axis === 'x' ? cx : cz);
  player.dispose();
  return result * sign;
}

for (const c of props.colliders) {
  for (const axis of ['x', 'z']) for (const sign of [-1, 1]) {
    for (const mode of ['walk', 'sprint', 'crouch']) for (const dt of [1 / 60, 0.05]) {
      const half = axis === 'x' ? (c.maxX - c.minX) / 2 : (c.maxZ - c.minZ) / 2;
      const result = walk(c, axis, sign, mode, dt);
      assert(result > -1 && result <= -half - 0.34 + 1e-8, `${mode}: player stops on approach side`);
    }
    assert(walk(c, axis, sign, 'walk', 0.05, 0.8) > 1, 'Player can walk around the prop');
    assert(walk(c, axis, sign, 'walk', 0.05, 0, []) > 1, 'Open passage remains traversable');
  }
}
for (const side of ['n', 's', 'e', 'w']) {
  const start = props.colliders.length;
  props.doubleDoors(0, 0, side);
  const leaves = props.colliders.slice(start);
  assert.equal(leaves.length, 2);
  const axis = ['n', 's'].includes(side) ? 'z' : 'x';
  for (const sign of [-1, 1]) assert(walk({minX: 0, maxX: 0, minZ: 0, maxZ: 0}, axis, sign, 'walk', 0.05, 0, leaves) > 1, 'Open door permits passage in both directions');
}
for (const yaw of [0, Math.PI / 6, Math.PI / 4, Math.PI / 2, -Math.PI * 0.38]) {
  props.addCollider(0, 0, 8, 0.03, yaw);
  const c = props.colliders.at(-1);
  for (const dt of [1 / 60, 0.05, 0.25]) for (const sign of [-1, 1]) {
    let firstFrame = true;
    const input = { consumeLook: () => ({dx: 0, dy: 0}), pressed: k => firstFrame && k === 'Tab', down: k => k === (sign > 0 ? 'KeyS' : 'KeyW') };
    const world = { colliders: [c], hideSpots: [], bounds: {minX: -20, maxX: 20, minZ: -20, maxZ: 20} };
    const p = new Player(new THREE.PerspectiveCamera(), world, {footstep() {}}, input);
    p.teleport(-sign * Math.sin(yaw), -sign * Math.cos(yaw), yaw);
    for (let t = 0; t < 0.6; t += dt) {
      p.update(dt);
      firstFrame = false;
    }
    const normal = (p.position.x * Math.sin(yaw) + p.position.z * Math.cos(yaw)) * sign;
    assert(normal <= -0.355 + 1e-7, 'Rotated thin partition blocks sprint, even across a long frame');
    p.dispose();
  }
}
for (const g of geometries) g.dispose();
console.log('Rotated partitions and open doors passed, including 250 ms frames.');
console.log('Collision passed: six pipes and coat rack; four directions; walk/sprint/crouch at 20/60 FPS; bypass and open passages.');
