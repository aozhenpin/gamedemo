import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../src/textures.js';

const source = readFileSync(new URL('../src/hospital.js', import.meta.url), 'utf8');
const texture = () => new THREE.Texture();
const surface = () => ({ map: texture(), normalMap: texture(), roughnessMap: texture() });
const textures = Object.fromEntries(['floorTiles', 'wallPlaster', 'ceilingTiles', 'metalSurface', 'fabricSurface', 'woodSurface', 'bloodDecal', 'curtainSurface'].map(k => [k, surface]));
Object.assign(textures, { signTexture: texture, exitSignTexture: texture, screenTexture: texture, mulberry32 });
const code = source.replace(/^import[\s\S]*?;\r?\n/gm, '').replaceAll('export ', '')
  .replace('    hideSpots,', '    hideSpots, passages,')
  .replace('    build(...args);', '    const firstPiece = pieces.length;\n    build(...args);\n    for (const piece of pieces.slice(firstPiece)) piece.prop = true;')
  .replace('    // Keep the model', '    pieces.length = firstPiece;\n    // Keep the model')
  .replace('  const push = (mat, geo) => {', "  const push = (mat, geo) => { pieces.push({ geo, mat, owner: new Error().stack.split('\\n').slice(2, 4).map(s => s.trim().split(' ')[1]).join('/') });");
const generate = new Function('THREE', 'mergeGeometries', 'pieces', ...Object.keys(textures), `${code}\nreturn generateHospital;`);
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function hull(points) {
  const sorted = [...new Map(points.map(p => [p.map(v => v.toFixed(6)).join(','), p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = list => { const out = []; for (const p of list) { while (out.length > 1 && cross(out.at(-2), out.at(-1), p) <= 1e-10) out.pop(); out.push(p); } return out.slice(0, -1); };
  return [...half(sorted), ...half([...sorted].reverse())];
}
function intersection(a, b) {
  let out = a;
  for (let i = 0; i < b.length && out.length; i++) {
    const start = b[i], end = b[(i + 1) % b.length], input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const dp = cross(start, end, p), dq = cross(start, end, q);
      if (dp >= 0) out.push(p);
      if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
    }
  }
  return out;
}
function area(poly) { return Math.abs(poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length][1] - p[1] * poly[(i + 1) % poly.length][0], 0)) / 2; }
assert.equal(area(intersection([[0,0],[2,0],[2,2],[0,2]], [[1,1],[3,1],[3,3],[1,3]])), 1);

function faces(piece) {
  const { geo } = piece;
  if (!['BoxGeometry', 'PlaneGeometry', 'CylinderGeometry'].includes(geo.type)) return [];
  const pos = geo.attributes.position, normals = geo.attributes.normal;
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.index.count }];
  const result = [];
  for (const group of groups) {
    const ids = [...new Set(Array.from({ length: group.count }, (_, i) => geo.index.getX(group.start + i)))];
    const normal = new THREE.Vector3().fromBufferAttribute(normals, ids[0]);
    if (!ids.every(i => normal.dot(new THREE.Vector3().fromBufferAttribute(normals, i)) > 0.99999)) continue;
    const points = ids.map(i => new THREE.Vector3().fromBufferAttribute(pos, i));
    const plane = normal.dot(points[0]);
    if (!points.every(p => Math.abs(normal.dot(p) - plane) < 2e-5)) continue;
    const axis = normal.toArray().map(Math.abs).indexOf(Math.max(...normal.toArray().map(Math.abs)));
    const axes = [0,1,2].filter(a => a !== axis);
    const poly = hull(points.map(p => axes.map(a => p.getComponent(a))));
    if (poly.length < 3) continue;
    result.push({ ...piece, normal, plane, axis, axes, poly, key: normal.toArray().map(n => Math.round(n * 10000)).join(','),
      min: [0,1].map(a => Math.min(...poly.map(p => p[a]))), max: [0,1].map(a => Math.max(...poly.map(p => p[a]))) });
  }
  return result;
}

const report = new Map();
const unsupported = new Map();
const seeds = process.argv.includes('--scan') ? [0, 42, 1234] : [...Array.from({ length: 20 }, (_, i) => i), 42, 1234];
for (const seed of seeds) {
  const pieces = [];
  const world = generate(THREE, mergeGeometries, pieces, ...Object.values(textures))(seed);
  const { TILE } = world.nav;
  const doorways = world.passages.filter(d => world.grid[d.z * world.width + d.x]);
  for (const { geo, owner } of pieces.filter(p => p.prop)) {
    const { min, max } = geo.boundingBox;
    if (min.y >= 1.8 || max.y <= 0.025) continue;
    const margin = 0.34 - 1e-5;
    assert(!doorways.some(d => min.x < (d.x + 1) * TILE + margin && max.x > d.x * TILE - margin &&
      min.z < (d.z + 1) * TILE + margin && max.z > d.z * TILE - margin),
    `seed ${seed}: ${owner} crosses a doorway clearance`);
  }
  world.group.updateMatrixWorld(true);
  world.group.traverse(o => {
    if (!o.isMesh || o.geometry.type === 'BufferGeometry') return;
    const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    pieces.push({ geo, mat: o.material.type, material: o.material, renderOrder: o.renderOrder, owner: o.name || o.geometry.type });
  });
  const solidAt = p => {
    const tx = Math.floor(p.x / world.nav.TILE), tz = Math.floor(p.z / world.nav.TILE);
    if (tx >= 0 && tx < world.width && tz >= 0 && tz < world.depth && !world.grid[tz * world.width + tx]) return true;
    return world.nearbyColliders(p.x, p.z, 0).some(c => {
      const x = (p.x - c.cx) * c.cos - (p.z - c.cz) * c.sin;
      const z = (p.x - c.cx) * c.sin + (p.z - c.cz) * c.cos;
      return p.y >= c.minY && p.y <= c.maxY && Math.abs(x) <= c.halfW && Math.abs(z) <= c.halfD;
    });
  };
  for (const piece of pieces) {
    if (piece.geo.type !== 'PlaneGeometry' || piece.mat === 'curtain') continue;
    const normal = new THREE.Vector3().fromBufferAttribute(piece.geo.attributes.normal, 0);
    if (Math.abs(normal.y) > 0.01) continue;
    piece.geo.computeBoundingBox();
    const center = piece.geo.boundingBox.getCenter(new THREE.Vector3());
    const supported = [0.01, 0.03, 0.06, 0.1, 0.2, 0.25].some(d => solidAt(center.clone().addScaledVector(normal, -d)));
    const front = center.clone().addScaledVector(normal, 0.02);
    const buried = !world.grid[Math.floor(front.z / world.nav.TILE) * world.width + Math.floor(front.x / world.nav.TILE)];
    if (!supported || buried) {
      const key = `${piece.owner}:${piece.mat}:${buried ? 'buried' : 'unsupported'}`;
      const entry = unsupported.get(key) ?? { count: 0, seed, point: center.toArray().map(v => +v.toFixed(3)) };
      entry.count++;
      unsupported.set(key, entry);
    }
  }
  const byNormal = new Map();
  for (const face of pieces.flatMap(faces)) { if (!byNormal.has(face.key)) byNormal.set(face.key, []); byNormal.get(face.key).push(face); }
  for (const list of byNormal.values()) {
    list.sort((a, b) => a.plane - b.plane);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j].plane - list[i].plane < 2e-5; j++) {
      const a = list[i], b = list[j];
      if (a.geo === b.geo || a.min.some((v, k) => v >= b.max[k] - 1e-5 || a.max[k] <= b.min[k] + 1e-5)) continue;
      if (a.material?.depthWrite === false && b.material?.depthWrite === false && a.renderOrder !== b.renderOrder) continue;
      const poly = intersection(a.poly, b.poly);
      if (area(poly) < 1e-6) continue;
      const p = new THREE.Vector3();
      a.axes.forEach((axis, k) => p.setComponent(axis, poly.reduce((sum, q) => sum + q[k], 0) / poly.length));
      p.setComponent(a.axis, (a.plane - a.axes.reduce((s, axis) => s + a.normal.getComponent(axis) * p.getComponent(axis), 0)) / a.normal.getComponent(a.axis));
      p.addScaledVector(a.normal, 0.001);
      if (p.y < 0 || p.y > 3.4) continue;
      if (!world.grid[Math.floor(p.z / world.nav.TILE) * world.width + Math.floor(p.x / world.nav.TILE)]) continue;
      // Hidden intersections inside another solid cannot flicker into the room.
      if (world.nearbyColliders(p.x, p.z, 0).some(c => {
        const x = (p.x - c.cx) * c.cos - (p.z - c.cz) * c.sin;
        const z = (p.x - c.cx) * c.sin + (p.z - c.cz) * c.cos;
        return p.y > c.minY + 1e-5 && p.y < c.maxY - 1e-5 && Math.abs(x) < c.halfW - 1e-5 && Math.abs(z) < c.halfD - 1e-5;
      })) continue;
      const key = [a.owner + ':' + a.mat, b.owner + ':' + b.mat].sort().join(' vs ');
      const entry = report.get(key) ?? { count: 0, seed, point: p.toArray().map(v => +v.toFixed(3)), area: +area(poly).toFixed(6) };
      entry.count++;
      report.set(key, entry);
    }
  }
  world.dispose();
}
if (report.size) console.log(JSON.stringify(Object.fromEntries(report), null, 2));
if (unsupported.size) console.log('Unattached or buried planes:', JSON.stringify(Object.fromEntries(unsupported), null, 2));
if (!process.argv.includes('--scan')) assert.equal(report.size, 0, 'Exposed coplanar surfaces overlap');
if (!process.argv.includes('--scan')) assert.equal(unsupported.size, 0, 'Vertical decorations need a solid backing');
console.log(`Surface scan: ${seeds.length} layouts, ${report.size} overlapping surface categories.`);
