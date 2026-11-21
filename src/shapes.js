// =====================================================
// shapes.js - smooth shapes for characters
//
// Instead of boxes, characters are built from:
//   lathe()   - a profile spun round in a circle (helmets, robes, bottles)
//   capsule() - a tube with rounded ends (arms, legs)
//   plate()   - a flat outline pushed out into a thick shape (blades, shields)
// =====================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { mergeGeometries };

/** Spin a profile [[radius, height], ...] round the up axis. */
export function lathe(profile, segments = 18, scaleZ = 1) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  if (scaleZ !== 1) g.scale(1, 1, scaleZ);
  g.computeVertexNormals();
  return g;
}

/** A rounded tube from y=0 down to y=-len (so it hangs from a joint). */
export function capsule(r, len, top = r) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 2), 4, 10);
  g.translate(0, -len / 2, 0);
  if (top !== r) {
    // taper: make the top end fatter or thinner than the bottom
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = -p.getY(i) / len;                 // 0 at top, 1 at bottom
      const k = (top + (r - top) * t) / r;
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    g.computeVertexNormals();
  }
  return g;
}

export function rbox(w, h, d, r = 0.02) {
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
}

/** Push a 2D outline out into a thick plate, with bevelled edges. */
export function plate(points, depth, bevel = 0.01, holes = []) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10,
  });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

/** A sword blade: long, tapering to a point, diamond-shaped across. */
export function bladeGeo(len, width) {
  const w = width / 2;
  const g = plate([[-w, 0], [w, 0], [w * 0.85, -len * 0.82], [0, -len], [-w * 0.85, -len * 0.82]], 0.004, 0.009);
  return g;
}

/** A heater shield outline (flat top, curving to a point). */
export function heaterPoints(w, h) {
  const pts = [];
  const hw = w / 2;
  pts.push([-hw, h * 0.42], [hw, h * 0.42]);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const a = t * Math.PI / 2;
    pts.push([hw * Math.cos(a) * (1 - t * 0.0), h * 0.42 - h * 0.92 * Math.sin(a) * (0.35 + 0.65 * t)]);
  }
  for (let i = 9; i >= 1; i--) {
    const [x, y] = pts[2 + i];
    pts.push([-x, y]);
  }
  return pts;
}

/** A single feather: a curved leaf shape, thin. */
export function featherGeo(len, width) {
  const pts = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([Math.sin(t * Math.PI) * width * (1 - t * 0.35), t * len]);
  }
  for (let i = n - 1; i >= 1; i--) {
    const t = i / n;
    pts.push([-Math.sin(t * Math.PI) * width * 0.45 * (1 - t * 0.35), t * len]);
  }
  const g = plate(pts, 0.006, 0.004);
  // curve it backwards a little along its length
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / len;
    p.setZ(i, p.getZ(i) - t * t * len * 0.18);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A wing, built like a real one: a leading edge (the "arm") that arcs up
 * and out, with rows of feathers hanging from it. The long flight feathers
 * at the tip point outwards; the ones near the body point down.
 */
export function wingGeo(scale = 1, count = 13) {
  const parts = [];
  const arm = new THREE.QuadraticBezierCurve(new THREE.Vector2(0, 0), new THREE.Vector2(0.75, 0.75), new THREE.Vector2(1.75, 0.85));
  // [how many, length, width, how far down the arm they start]
  const rows = [[count, 1.0, 0.15, 0], [count - 2, 0.6, 0.14, 0.02], [count - 4, 0.34, 0.12, 0.04]];
  rows.forEach(([n, lenMul, width, drop], r) => {
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const p = arm.getPoint(0.05 + t * 0.95);
      const len = (0.5 + 1.05 * t * t + 0.25 * t) * lenMul * scale;
      const f = featherGeo(len, width * scale * (0.8 + 0.4 * t));
      const theta = THREE.MathUtils.lerp(Math.PI - 0.12, 1.45, t);   // straight down at the body, out at the tip
      f.rotateZ(-theta);
      f.translate(p.x * scale, (p.y - drop) * scale, -r * 0.025 * scale - t * 0.04);
      parts.push(f);
    }
  });
  // the leading edge itself: a thin curved bone
  const bone = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([0, 0.25, 0.5, 0.75, 1].map((t) => {
    const p = arm.getPoint(t);
    return new THREE.Vector3(p.x * scale, p.y * scale, 0.01);
  })), 16, 0.04 * scale, 6, false);
  parts.push(bone);
  const g = mergeGeometries(parts.map((p) => {
    const q = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal') q.deleteAttribute(k);
    return q;
  }));
  g.computeVertexNormals();
  return g;
}
