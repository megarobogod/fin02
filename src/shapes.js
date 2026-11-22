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
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export { mergeGeometries };

/**
 * Give a shape smooth shading: faces that meet at a gentle angle blend into
 * one smooth surface (no seams, no facets), while real corners stay sharp.
 * Run this after bending or squashing a shape.
 */
export function finish(g, crease = Math.PI / 3) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  return toCreasedNormals(m, crease);
}

/** Squash or stretch a shape along each axis, with smooth shading kept. */
export function scaled(g, sx, sy = sx, sz = sx) {
  g.scale(sx, sy, sz);
  return finish(g);
}

/** Spin a profile [[radius, height], ...] round the up axis. High detail and seamless. */
export function lathe(profile, segments = 40, scaleZ = 1, crease = Math.PI / 3) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  if (scaleZ !== 1) g.scale(1, 1, scaleZ);
  return finish(g, crease);
}

/** Same, but the profile is a smooth curve through your points, not straight segments. */
export function smoothLathe(profile, segments = 40, scaleZ = 1, samples = 40) {
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getPoints(samples).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  const g = new THREE.LatheGeometry(pts, segments);
  if (scaleZ !== 1) g.scale(1, 1, scaleZ);
  return finish(g, Math.PI / 2.2);
}

/** An egg: a sphere stretched to rx, ry, rz. */
export function ellipsoid(rx, ry = rx, rz = rx, seg = 28) {
  return finish(new THREE.SphereGeometry(1, seg, Math.max(8, Math.round(seg * 0.7))).scale(rx, ry, rz));
}

/** A limb: hangs from y=0 down to y=-len, fat at the top and thin at the bottom, with a muscle bulge and rounded ends. */
export function capsule(r, len, top = r, bulge = 0.09) {
  const pts = [];
  const cap = 7;
  for (let i = 0; i <= cap; i++) {                       // rounded top
    const a = (i / cap) * Math.PI / 2;
    pts.push([Math.sin(a) * top * 0.999, top * Math.cos(a) * 0.9]);
  }
  const n = 14;
  for (let i = 1; i < n; i++) {                          // the length, bulging a little above the middle
    const t = i / n;
    const rr = (top + (r - top) * t) * (1 + bulge * Math.sin(Math.PI * Math.min(1, t * 1.25)));
    pts.push([rr, -len * t]);
  }
  for (let i = 0; i <= cap; i++) {                       // rounded bottom
    const a = (i / cap) * Math.PI / 2;
    pts.push([Math.cos(a) * r, -len - Math.sin(a) * r * 0.9]);
  }
  pts.reverse();                                         // lathe wants the profile bottom to top
  return lathe(pts.map(([x, y]) => [Math.max(0.0005, x), y]), 28);
}

/** Bend a flat shape into a shallow dome: z gets pushed out by cx*x^2 + cy*y^2. */
export function bend(g, cx, cy = 0) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, p.getZ(i) + cx * x * x + cy * y * y);
  }
  return finish(g, Math.PI / 3);
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
  return finish(g, Math.PI / 4);
}

/**
 * A sword blade, built section by section: a lens-shaped cross-section with a
 * groove (the fuller) down the middle, tapering to a sharp point. Hangs from
 * y=0 down to y=-len.
 */
export function bladeGeo(len, width) {
  const w = width / 2, N = 28, ring = 10;
  const pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = -len * t;
    // the blade narrows slowly then tapers to the tip
    const wid = w * (1 - 0.28 * t) * (t > 0.82 ? Math.max(0, 1 - (t - 0.82) / 0.18) ** 0.7 : 1);
    const th = 0.0055 * (1 - 0.4 * t) * (t > 0.9 ? Math.max(0, 1 - (t - 0.9) / 0.1) : 1);
    const fw = wid * 0.28, groove = (t < 0.72 ? 0.35 : 0.35 * Math.max(0, 1 - (t - 0.72) / 0.12)) * th;
    const pts = [[-wid, 0], [-wid * 0.4, th], [-fw, th - groove], [fw, th - groove], [wid * 0.4, th], [wid, 0], [wid * 0.4, -th], [fw, -th + groove], [-fw, -th + groove], [-wid * 0.4, -th]];
    for (const [x, z] of pts) pos.push(x, y, z);
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < ring; j++) {
    const a = i * ring + j, b = i * ring + (j + 1) % ring, c = a + ring, d = b + ring;
    idx.push(a, c, b, b, c, d);
  }
  // seal the top (under the guard)
  const base = (N + 1) * ring;
  pos.push(0, 0, 0);
  for (let j = 0; j < ring; j++) idx.push(base, j, (j + 1) % ring);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return toCreasedNormals(g, Math.PI / 4);
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
