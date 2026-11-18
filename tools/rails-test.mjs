import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mulberry32 } from '../src/textures.js';

// Exercise the actual layout and rail code without creating browser textures.
const source = readFileSync(new URL('../src/hospital.js', import.meta.url), 'utf8');
const constants = source.slice(source.indexOf('export const TILE'), source.indexOf('// ------------------------------------------------------------------ 几何工具')).replaceAll('export ', '');
const layout = source.slice(source.indexOf('  const rng = mulberry32(seed);'), source.indexOf('  // ---------------------------------------------------------------- 材质'));
const rails = source.slice(source.indexOf('  const isFloor ='), source.indexOf('  // ---------------------------------------------------------------- 地面 / 天花板'));
assert(constants && layout && rails);
const generate = new Function('seed', 'mulberry32', 'addBox', 'fixture', 'addCollider', `${constants}\n${layout}\nif (fixture) fixture(grid, roomMask, W);\n${rails}\nreturn { grid, roomMask, W, D, TILE };`);

function check(seed, fixture) {
  const boxes = [];
  const { grid, roomMask, W, D, TILE } = generate(seed, mulberry32, (...box) => boxes.push(box), fixture, () => {});
  const metal = boxes.filter(b => b[0] === 'metal');
  const railFaces = boxes.filter(b => b[0] === 'metal' || b[0] === 'rubber');
  for (let i = 0; i < railFaces.length; i++) for (let j = i + 1; j < railFaces.length; j++) {
    const a = railFaces[i], b = railFaces[j];
    const overlaps = [0, 1, 2].map(axis => Math.min(a[4 + axis] + a[1 + axis] / 2, b[4 + axis] + b[1 + axis] / 2) - Math.max(a[4 + axis] - a[1 + axis] / 2, b[4 + axis] - b[1 + axis] / 2));
    if (overlaps.some(v => v < -1e-8)) continue;
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const samePlane = Math.abs(a[4 + axis] + sign * a[1 + axis] / 2 - b[4 + axis] - sign * b[1 + axis] / 2) < 1e-8;
      assert(!samePlane || overlaps.some((v, k) => k !== axis && v < 1e-8),
        `seed ${seed}: ${a[0]}/${b[0]} must not share overlapping faces on axis ${axis}`);
    }
  }
  const strips = metal.filter(b => b[1] > 0.06 || b[3] > 0.06);
  const caps = metal.filter(b => b[1] === 0.06 && b[3] === 0.06);
  const floor = (x, z) => x >= 0 && z >= 0 && x < W && z < D && grid[z * W + x] === 1;
  const key = (x, z) => `${x.toFixed(5)},${z.toFixed(5)}`;
  const actual = new Set(strips.map(b => key(b[4], b[6])));
  assert.equal(actual.size, strips.length, 'No duplicate wall strips');
  const expected = new Set();
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    if (!floor(x, z) || roomMask[z * W + x]) continue;
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (!floor(x + dx, z + dz)) expected.add(key((x + 0.5) * TILE + dx * (TILE / 2 - 0.03), (z + 0.5) * TILE + dz * (TILE / 2 - 0.03)));
    }
  }
  assert.equal(strips.length, expected.size, 'One strip per corridor wall edge');
  for (const point of expected) {
    const [x, z] = point.split(',').map(Number);
    assert(strips.some(b => Math.abs(b[4] - x) <= b[1] / 2 + 1e-6 && Math.abs(b[6] - z) <= b[3] / 2 + 1e-6),
      `seed ${seed}: every corridor wall covered, all open edges clear`);
  }
  for (let i = 0; i < metal.length; i++) for (let j = i + 1; j < metal.length; j++) {
    const a = metal[i], b = metal[j];
    const overlapX = Math.min(a[4] + a[1] / 2, b[4] + b[1] / 2) - Math.max(a[4] - a[1] / 2, b[4] - b[1] / 2);
    const overlapZ = Math.min(a[6] + a[3] / 2, b[6] + b[3] / 2) - Math.max(a[6] - a[3] / 2, b[6] - b[3] / 2);
    assert(overlapX < 1e-8 || overlapZ < 1e-8, `seed ${seed}: no overlapping coplanar rail tops`);
  }
  for (const b of metal) {
    assert.equal(b[2], 0.1);
    assert.equal(b[5], 1.02);
    assert.equal(b[7], 0);
    assert.equal(b[8], 1);
  }
  for (const cap of caps) {
    const touches = strips.filter(b => Math.abs(b[4] - cap[4]) <= (b[1] + cap[1]) / 2 + 1e-8 && Math.abs(b[6] - cap[6]) <= (b[3] + cap[3]) / 2 + 1e-8);
    assert.equal(touches.length, 2, 'Each corner cap must connect two strips');
    assert(touches.some(b => b[1] > 0.06) && touches.some(b => b[3] > 0.06), 'Corner joins perpendicular strips');
  }
  return { strips, caps };
}

const corner = check(1234, (grid, rooms, W) => {
  grid.fill(0); rooms.fill(0);
  for (let z = 9; z <= 11; z++) for (let x = 9; x <= 11; x++) grid[z * W + x] = 1;
  grid[10 * W + 10] = 0;
});
assert.equal(corner.strips.length, 16, 'Inner and outer wall faces retained');
assert.equal(corner.caps.length, 4, 'All four convex corner orientations connected');
const inner = check(1234, (grid, rooms, W) => {
  grid.fill(0); rooms.fill(0); grid[10 * W + 10] = 1;
});
assert.equal(inner.strips.length, 4);
assert.equal(inner.caps.length, 0);
assert(Math.abs(inner.strips.reduce((sum, b) => sum + b[1] * b[3], 0) - (4 * 2.2 * 0.06 - 4 * 0.06 ** 2)) < 1e-8,
  'Inner corners retain the full original footprint without overlaps or gaps');
check(1234, (grid, rooms, W) => {
  grid.fill(0); rooms.fill(0);
  for (let z = 8; z <= 12; z++) for (let x = 8; x <= 12; x++) grid[z * W + x] = +(x !== 10 || z === 10);
});
check(1234);
for (let seed = 0; seed < 100; seed++) check(seed);
console.log('Rails passed: 101 layouts, no coplanar overlaps, intact inner/outer corners, doorway gaps and wall coverage.');
