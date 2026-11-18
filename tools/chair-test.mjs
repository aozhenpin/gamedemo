import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/hospital.js', import.meta.url), 'utf8');
const chairCode = source.slice(source.indexOf('  function chair('), source.indexOf('  function operatingTable('));
const localCode = source.slice(source.indexOf('  const local ='), source.indexOf('});', source.indexOf('  const local =')) + 3);
assert(chairCode && localCode);
const boxes = [];
const chair = new Function('addBox', 'addCyl', 'addCollider', `${localCode}\n${chairCode}\nreturn chair;`)(
  (...args) => boxes.push(args), () => {}, () => {});

for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4]) {
  boxes.length = 0;
  chair(41.8, 33, yaw);
  assert.equal(boxes.length, 2, 'Seat and backrest retained');
  const bounds = boxes.map(([, w, h, d, x, y, z]) => {
    const lx = (x - 41.8) * Math.cos(yaw) - (z - 33) * Math.sin(yaw);
    const lz = (x - 41.8) * Math.sin(yaw) + (z - 33) * Math.cos(yaw);
    return { center: [lx, y, lz], half: [w / 2, h / 2, d / 2] };
  });
  const [seat, back] = bounds;
  const overlaps = seat.center.map((_, axis) => Math.min(seat.center[axis] + seat.half[axis], back.center[axis] + back.half[axis]) -
    Math.max(seat.center[axis] - seat.half[axis], back.center[axis] - back.half[axis]));
  for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
    const samePlane = Math.abs(seat.center[axis] + sign * seat.half[axis] - back.center[axis] - sign * back.half[axis]) < 1e-8;
    assert(!samePlane || overlaps.some((v, k) => k !== axis && v <= 1e-8), 'No overlapping coplanar seat/back faces');
  }
  assert(Math.abs(back.center[1] - back.half[1] - (seat.center[1] + seat.half[1])) < 1e-8, 'Backrest touches seat without a gap');
  assert(Math.abs(back.center[1] + back.half[1] - 0.95) < 1e-8, 'Original chair height retained');
  assert.deepEqual(boxes.map(b => b[0]), ['metal', 'dark'], 'Original materials retained');
}
console.log('Chair passed: five orientations, no coplanar seat/back overlaps, connected seam, original height and materials.');
