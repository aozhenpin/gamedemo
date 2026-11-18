import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../src/textures.js';

// Only canvas textures are stubbed; layout, geometry and colliders are real.
const source = readFileSync(new URL('../src/hospital.js', import.meta.url), 'utf8');
const texture = () => new THREE.Texture();
const surface = () => ({ map: texture(), normalMap: texture(), roughnessMap: texture() });
const textures = Object.fromEntries(['floorTiles', 'wallPlaster', 'ceilingTiles', 'metalSurface', 'fabricSurface', 'woodSurface', 'bloodDecal', 'curtainSurface'].map(k => [k, surface]));
Object.assign(textures, { signTexture: texture, exitSignTexture: texture, screenTexture: texture, mulberry32 });
const code = source.replace(/^import[\s\S]*?;\r?\n/gm, '').replaceAll('export ', '')
  .replace('    build(...args);', '    const firstSolid = solids.length;\n    build(...args);')
  .replace('    // Keep the model', '    solids.length = firstSolid;\n    // Keep the model')
  .replace("    const g = scaleBoxUV(new THREE.BoxGeometry", "    solids.push({ mat, w, h, d, x, y, z, yaw, caller: new Error().stack.split('\\n')[2] });\n    const g = scaleBoxUV(new THREE.BoxGeometry")
  .replace('    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);', "    solids.push({ mat, w: 2 * Math.max(rTop, rBot), h, d: 2 * Math.max(rTop, rBot), x, y, z, yaw, caller: new Error().stack.split('\\n')[2] });\n    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);");
const generate = new Function('THREE', 'mergeGeometries', 'solids', ...Object.keys(textures), `${code}\nreturn generateHospital;`);

function contains(c, x, z, margin = 0) {
  const cx = c.cx ?? (c.minX + c.maxX) / 2, cz = c.cz ?? (c.minZ + c.maxZ) / 2;
  const cos = c.cos ?? 1, sin = c.sin ?? 0;
  const lx = (x - cx) * cos - (z - cz) * sin, lz = (x - cx) * sin + (z - cz) * cos;
  const hw = c.halfW ?? (c.maxX - c.minX) / 2, hd = c.halfD ?? (c.maxZ - c.minZ) / 2;
  return Math.hypot(Math.max(0, Math.abs(lx) - hw), Math.max(0, Math.abs(lz) - hd)) <= margin + 1e-7;
}

for (const seed of [0, 1, 2, 3, 7, 42, 1234]) {
  const solids = [];
  const hospital = generate(THREE, mergeGeometries, solids, ...Object.values(textures))(seed);
  const board = hospital.group.getObjectByName('nurse-station-board');
  const sign = hospital.group.getObjectByName('nurse-station-sign');
  assert(board && sign, `seed ${seed}: nurse station decorations retained`);
  assert.equal(board.geometry.parameters.depth, 0.04);
  assert.equal(board.rotation.y, sign.rotation.y);
  assert(sign.position.y - 0.3 > board.position.y + 0.6, 'Sign must not overlap board');
  const normal = new THREE.Vector3(0, 0, 1).applyEuler(board.rotation);
  for (const offset of [-1.09, 0, 1.09]) {
    const behind = new THREE.Vector3(offset, 0, -0.08).applyEuler(board.rotation).add(board.position);
    const x = Math.floor(behind.x / hospital.nav.TILE), z = Math.floor(behind.z / hospital.nav.TILE);
    assert.equal(hospital.grid[z * hospital.nav.width + x], 0, `seed ${seed}: entire board backed by wall`);
  }
  board.updateMatrixWorld(true);
  for (const direction of [-1, 1]) {
    const origin = board.position.clone().addScaledVector(normal, direction);
    const ray = new THREE.Raycaster(origin, normal.clone().multiplyScalar(-direction));
    assert(ray.intersectObject(board).length > 0, 'Solid board visible from both sides');
  }
  assert(hospital.colliders.some(c => contains(c, board.position.x, board.position.z)), 'Board has collision');
  const missing = new Map();
  for (const b of solids) {
    if (b.y + b.h / 2 < 0.15 || b.y - b.h / 2 > 1.8 || b.mat === 'curtain') continue;
    if (!hospital.colliders.some(c => contains(c, b.x, b.z))) {
      const name = b.caller.trim().split(' ')[1];
      missing.set(name, (missing.get(name) ?? 0) + 1);
    }
  }
  assert.equal(missing.size, 0, `seed ${seed}: uncovered solid centers ${JSON.stringify(Object.fromEntries(missing))}`);
  const { width: W, depth: D, TILE } = hospital.nav;
  const bins = Array.from({ length: W * D }, () => []);
  for (const c of hospital.motionColliders) {
    assert(Number.isFinite(c.minY) && Number.isFinite(c.maxY) && c.maxY >= c.minY);
    if (c.maxY <= 0.14 || c.minY >= 1.8) continue;
    for (let z = Math.max(0, Math.floor((c.minZ - 0.34) / TILE)); z <= Math.min(D - 1, Math.floor((c.maxZ + 0.34) / TILE)); z++) {
      for (let x = Math.max(0, Math.floor((c.minX - 0.34) / TILE)); x <= Math.min(W - 1, Math.floor((c.maxX + 0.34) / TILE)); x++) bins[z * W + x].push(c);
    }
  }
  const step = 0.2, cols = Math.ceil(W * TILE / step), rows = Math.ceil(D * TILE / step);
  const clear = new Uint8Array(cols * rows), reached = new Uint8Array(cols * rows);
  for (let z = 0; z < rows; z++) for (let x = 0; x < cols; x++) {
    const px = (x + 0.5) * step, pz = (z + 0.5) * step;
    const tile = Math.floor(pz / TILE) * W + Math.floor(px / TILE);
    if (hospital.grid[tile] && !bins[tile].some(c => contains(c, px, pz, 0.34))) clear[z * cols + x] = 1;
  }
  const start = Math.floor(hospital.spawns[0].z / step) * cols + Math.floor(hospital.spawns[0].x / step);
  assert(clear[start], 'Spawn is clear');
  const queue = [start]; reached[start] = 1;
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i], x = k % cols, z = Math.floor(k / cols);
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, nz = z + dz, next = nz * cols + nx;
      if (nx >= 0 && nx < cols && nz >= 0 && nz < rows && clear[next] && !reached[next]) { reached[next] = 1; queue.push(next); }
    }
  }
  const blocked = hospital.doors.filter(d => !reached[Math.floor((d.z + 0.5) * TILE / step) * cols + Math.floor((d.x + 0.5) * TILE / step)]);
  assert.equal(blocked.length, 0, `seed ${seed}: every door must remain reachable`);
  for (const room of hospital.rooms) {
    let accessible = false;
    for (let z = Math.ceil(room.z0 * TILE / step); z < (room.z1 + 1) * TILE / step && !accessible; z++) {
      for (let x = Math.ceil(room.x0 * TILE / step); x < (room.x1 + 1) * TILE / step; x++) {
        if (reached[z * cols + x]) { accessible = true; break; }
      }
    }
    assert(accessible, `seed ${seed}: ${room.type} room must remain accessible`);
  }
  for (const spawn of hospital.spawns) assert(reached[Math.floor(spawn.z / step) * cols + Math.floor(spawn.x / step)], 'Both spawns connected');
  hospital.dispose();
}
console.log('Scene collision passed: seven complete layouts, all six room types, solid centers covered, all doors/rooms/spawns reachable at player clearance.');
