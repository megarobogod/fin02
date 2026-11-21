// =====================================================
// world.js - the ruined city
//
// The city is a grid: square blocks of buildings with streets between them.
//   BLOCK  = how wide a block is (metres)
//   STREET = how wide a street is
// Some blocks are special: the cathedral plaza in the middle, craters where
// angels purged whole streets, a dead park, raider camps behind barricades,
// and hidden courtyards where survivors live.
//
// Everything that doesn't move is glued into a few big meshes, so the
// graphics card can draw the whole city in a handful of goes. The windows
// aren't real holes: sketch.js paints them on.
// =====================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const HALF = 270;              // the map runs from -270 to +270
const RES = 216;                      // ground grid squares per side (2.5m each)
const CELL = (HALF * 2) / RES;
const GRID = 16;                      // collision lookup square size

export const BLOCK = 44;
export const STREET = 14;
export const PERIOD = BLOCK + STREET; // 58
const NB = 4;                         // blocks run from -4 to 4 in each direction
const FLOOR = 3.3;                    // storey height (matches the window pattern)

// Special blocks, by grid position [i, j]
const PLAZA = '0,0';
const CRATERS = { '-2,1': 30, '3,-2': 26, '1,3': 24 };
const SWORD = '-3,-3';
const PARKS = ['2,1', '-1,-3'];
const RAIDER_CAMPS = ['1,1', '-3,2', '2,-3', '3,3', '-4,-1', '4,0', '-1,4'];
const CIVILIAN_CAMPS = ['-1,-1', '-1,2', '1,-2', '-2,-1', '3,1', '0,-4', '-4,3'];

// Colours
const BRICK = 0x8c6352, CONCRETE = 0xaba59b, PLASTER = 0xc8bca4, DARKSTONE = 0x847d72;
const STONE = 0xb9b09e, STONE_DARK = 0x958c7c, BARK = 0x5b5046, TIMBER = 0x65564a;
const RUST = 0x7d5f4c, METAL = 0x707377, ASH = 0x4d4842;

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
const lerp = (a, b, t) => a + (b - a) * t;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function ihash(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(ihash(ix, iy, seed), ihash(ix + 1, iy, seed), ux), lerp(ihash(ix, iy + 1, seed), ihash(ix + 1, iy + 1, seed), ux), uy);
}
function fbm(x, y, oct = 4, seed = 0) {
  let v = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { v += a * noise(x * f, y * f, seed + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return v / n;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
export function mat(x, y, z, rx = 0, ry = 0, rz = 0, s = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(s, s, s));
}

export class World {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.sketch = game.sketch;
    this.rng = mulberry32(20261121);
    this.colliders = [];
    this.grid = new Map();
    this.stamp = 0;
    this.pieces = [];
    this.raiderCamps = [];
    this.civilianCamps = [];
    this.fires = [];          // spots where fire particles rise
    this.nodes = [];          // street crossings, for people walking about

    this.makeCraters();
    this.buildHeights();
    this.buildTerrain();
    for (let i = -NB; i <= NB; i++) for (let j = -NB; j <= NB; j++) this.buildBlock(i, j);
    this.buildStreets();
    this.buildFallenTower();
    this.buildSkyline();
    this.mergePieces();
    this.buildSky();

    for (let i = -NB; i < NB; i++) for (let j = -NB; j < NB; j++) {
      this.nodes.push({ x: i * PERIOD + PERIOD / 2, z: j * PERIOD + PERIOD / 2 });
    }
    this.spawn = new THREE.Vector3(0, 0, -PERIOD / 2);
    this.limit = NB * PERIOD + BLOCK / 2 - 2;
  }

  blockCenter(i, j) { return [i * PERIOD, j * PERIOD]; }

  // ================================================================ ground
  makeCraters() {
    this.craters = [];
    for (const [key, r] of Object.entries(CRATERS)) {
      const [i, j] = key.split(',').map(Number);
      this.craters.push({ x: i * PERIOD + 6, z: j * PERIOD - 4, r, depth: r * 0.16 });
    }
    const [si, sj] = SWORD.split(',').map(Number);
    this.swordSite = [si * PERIOD, sj * PERIOD];
    this.craters.push({ x: this.swordSite[0], z: this.swordSite[1], r: 20, depth: 3.5 });
  }

  rawHeight(x, z) {
    let h = (fbm(x * 0.012, z * 0.012, 3) - 0.5) * 1.2;   // the city is nearly flat
    for (const c of this.craters) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d > c.r * 1.8) continue;
      const q = d / c.r;
      if (q < 1) h -= c.depth * (1 - q * q);
      h += c.depth * 0.35 * Math.exp(-(((q - 1) / 0.25) ** 2));
    }
    // rubble mountains where the city was flattened round the edge
    const e = Math.max(Math.abs(x), Math.abs(z));
    h += smoothstep(NB * PERIOD + 24, HALF, e) ** 1.4 * 30 * (0.6 + 0.8 * noise(x * 0.05, z * 0.05, 3));
    return h;
  }

  buildHeights() {
    const W = RES + 1;
    this.h = new Float32Array(W * W);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) this.h[j * W + i] = this.rawHeight(-HALF + i * CELL, -HALF + j * CELL);
  }

  heightAt(x, z) {
    let fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    fx = Math.min(RES - 1e-4, Math.max(0, fx));
    fz = Math.min(RES - 1e-4, Math.max(0, fz));
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const W = RES + 1;
    const ha = this.h[j * W + i], hb = this.h[j * W + i + 1];
    const hc = this.h[(j + 1) * W + i], hd = this.h[(j + 1) * W + i + 1];
    if (u + v <= 1) return ha + (hb - ha) * u + (hc - ha) * v;
    return hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.6;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  /** What kind of ground is here? street, pavement or inside a block */
  surface(x, z) {
    const lx = ((x % PERIOD) + PERIOD * 1.5) % PERIOD - PERIOD / 2;
    const lz = ((z % PERIOD) + PERIOD * 1.5) % PERIOD - PERIOD / 2;
    const m = Math.max(Math.abs(lx), Math.abs(lz));
    if (Math.abs(lx) > BLOCK / 2 || Math.abs(lz) > BLOCK / 2) return 'street';
    if (m > BLOCK / 2 - 3) return 'pavement';
    return 'lot';
  }

  buildTerrain() {
    const W = RES + 1;
    const pos = new Float32Array(W * W * 3);
    const col = new Float32Array(W * W * 3);
    const asphalt = [0.47, 0.46, 0.45], pave = [0.66, 0.64, 0.6], lot = [0.6, 0.57, 0.5], scorch = [0.3, 0.28, 0.27], rubble = [0.58, 0.54, 0.48];
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        const x = -HALF + i * CELL, z = -HALF + j * CELL;
        pos[k * 3] = x; pos[k * 3 + 1] = this.h[k]; pos[k * 3 + 2] = z;
        const s = this.surface(x, z);
        let c = s === 'street' ? asphalt : s === 'pavement' ? pave : lot;
        if (Math.max(Math.abs(x), Math.abs(z)) > NB * PERIOD + 24) c = rubble;
        let sc = 0;
        for (const cr of this.craters) sc = Math.max(sc, smoothstep(1.4, 0.5, Math.hypot(x - cr.x, z - cr.z) / cr.r));
        const v = 0.9 + 0.16 * noise(x * 0.35, z * 0.35, 9) - 0.12 * smoothstep(0.55, 0.75, fbm(x * 0.05, z * 0.05, 2, 4));
        for (let ch = 0; ch < 3; ch++) col[k * 3 + ch] = lerp(c[ch], scorch[ch], sc * 0.9) * v;
      }
    }
    const idx = [];
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.terrain = new THREE.Mesh(geo, this.sketch.fill(0xffffff, { vertexColors: true, scribble: 0.4 }));
    this.scene.add(this.terrain);
  }

  // ================================================================ collision
  addCollider(c) {
    const br = c.type === 'circle' ? c.r : Math.hypot(c.hw, c.hd);
    this.colliders.push(c);
    const x0 = Math.floor((c.x - br) / GRID), x1 = Math.floor((c.x + br) / GRID);
    const z0 = Math.floor((c.z - br) / GRID), z1 = Math.floor((c.z + br) / GRID);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const key = gx + ',' + gz;
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(c);
    }
  }

  /** Push a circle (someone's feet) out of anything solid. */
  resolveCircle(p, r) {
    this.stamp++;
    const cx = Math.floor(p.x / GRID), cz = Math.floor(p.z / GRID);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
      const list = this.grid.get(gx + ',' + gz);
      if (!list) continue;
      for (const c of list) {
        if (c.stamp === this.stamp) continue;
        c.stamp = this.stamp;
        if (c.type === 'circle') {
          const dx = p.x - c.x, dz = p.z - c.z;
          const d = Math.hypot(dx, dz), min = r + c.r;
          if (d < min && d > 1e-6) { p.x = c.x + (dx / d) * min; p.z = c.z + (dz / d) * min; }
        } else {
          const cos = Math.cos(c.rot), sin = Math.sin(c.rot);
          const wx = p.x - c.x, wz = p.z - c.z;
          const lx = wx * cos - wz * sin, lz = wx * sin + wz * cos;
          const qx = Math.max(-c.hw, Math.min(c.hw, lx)), qz = Math.max(-c.hd, Math.min(c.hd, lz));
          const ddx = lx - qx, ddz = lz - qz;
          const d = Math.hypot(ddx, ddz);
          let nx, nz;
          if (d > 1e-6) {
            if (d >= r) continue;
            nx = lx + (ddx / d) * (r - d);
            nz = lz + (ddz / d) * (r - d);
          } else {
            const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz);
            if (px < pz) { nx = Math.sign(lx || 1) * (c.hw + r); nz = lz; } else { nz = Math.sign(lz || 1) * (c.hd + r); nx = lx; }
          }
          p.x = c.x + nx * cos + nz * sin;
          p.z = c.z - nx * sin + nz * cos;
        }
      }
    }
  }

  /** Is there a clear line between two points? (used by people deciding if they can see you) */
  lineClear(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / 2);
    const p = { x: 0, z: 0 };
    for (let i = 1; i < n; i++) {
      p.x = ax + ((bx - ax) * i) / n;
      p.z = az + ((bz - az) * i) / n;
      const ox = p.x, oz = p.z;
      this.resolveCircle(p, 0.05);
      if (Math.abs(p.x - ox) + Math.abs(p.z - oz) > 0.01) return false;
    }
    return true;
  }

  // ================================================================ pieces
  add(geo, color, m, win = 0) {
    if (m) geo.applyMatrix4(m);
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    if (geo.index === null) {
      // keep everything indexed so it can all be glued together
      const n = geo.attributes.position.count;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    this.pieces.push({ geo, color, win });
  }
  box(w, h, d, m, color, win = 0) { this.add(new THREE.BoxGeometry(w, h, d), color, m, win); }
  rbox(w, h, d, r, m, color) { this.add(new RoundedBoxGeometry(w, h, d, 2, r), color, m); }
  cyl(rt, rb, h, seg, m, color) { this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, m); }

  rubble(x, z, count, spread, color = STONE, big = 1) {
    for (let i = 0; i < count; i++) {
      const s = (0.3 + this.rng() * 1.1) * big;
      const px = x + (this.rng() - 0.5) * spread, pz = z + (this.rng() - 0.5) * spread;
      const geo = this.rng() < 0.5 ? new THREE.DodecahedronGeometry(s * 0.6, 0) : new THREE.BoxGeometry(s, s * (0.4 + this.rng() * 0.5), s * (0.6 + this.rng() * 0.6));
      this.add(geo, color, mat(px, this.heightAt(px, pz) + s * 0.12, pz, this.rng() * 3, this.rng() * 6, this.rng() * 3));
    }
  }

  /** A slab of concrete leaning at an angle, with a few rebar rods poking out. */
  slab(x, z, ry, color = CONCRETE) {
    const w = 3 + this.rng() * 4, d = 2 + this.rng() * 3;
    const g = this.heightAt(x, z);
    const tilt = 0.25 + this.rng() * 0.6;
    this.box(w, 0.35, d, mat(x, g + Math.sin(tilt) * d * 0.4, z, tilt, ry, (this.rng() - 0.5) * 0.3), color);
    for (let i = 0; i < 3; i++) {
      const L = 0.8 + this.rng() * 1.2;
      const geo = new THREE.CylinderGeometry(0.025, 0.025, L, 4);
      geo.translate(0, L / 2, 0);
      this.add(geo, RUST, mat(x + (this.rng() - 0.5) * w * 0.8, g + 0.4, z + (this.rng() - 0.5) * 0.5, this.rng() - 0.5, ry, this.rng() - 0.5));
    }
  }

  // ================================================================ buildings
  /**
   * A building filling a rectangle. It's split into "bays" about 5m across,
   * each with its own height, which is how the broken, jagged tops happen.
   */
  building(x0, z0, x1, z1, floors, color, damage) {
    const seed = 1 + this.rng() * 0.99;
    const nx = Math.max(1, Math.round((x1 - x0) / 5)), nz = Math.max(1, Math.round((z1 - z0) / 5));
    const bw = (x1 - x0) / nx, bd = (z1 - z0) / nz;
    const fullH = floors * FLOOR;
    const g = Math.min(this.heightAt(x0, z0), this.heightAt(x1, z1), this.heightAt(x0, z1), this.heightAt(x1, z0)) - 0.4;
    // a broken building loses a "bite" out of one corner
    const biteX = this.rng() < 0.5 ? 0 : nx - 1, biteZ = this.rng() < 0.5 ? 0 : nz - 1;
    for (let a = 0; a < nx; a++) {
      for (let b = 0; b < nz; b++) {
        let h = fullH;
        if (damage > 0) {
          const bite = Math.max(0, 1 - Math.hypot(a - biteX, b - biteZ) / (1.2 + damage * 2.5));
          h = fullH * (1 - bite * (0.55 + this.rng() * 0.4)) - (this.rng() < damage * 0.6 ? this.rng() * FLOOR * 2 : 0);
          h = Math.max(FLOOR * 0.6, h);
        }
        const cx = x0 + (a + 0.5) * bw, cz = z0 + (b + 0.5) * bd;
        const total = h + (this.heightAt(cx, cz) - g);
        this.box(bw + 0.02, total, bd + 0.02, mat(cx, g + total / 2, cz), color, seed);
        if (h < fullH - 1) {
          // jagged broken edge and exposed floor slabs
          for (let k = 0; k < 2; k++) {
            const ch = 0.5 + this.rng() * 1.8;
            this.box(bw * (0.2 + this.rng() * 0.4), ch, bd * (0.2 + this.rng() * 0.4),
              mat(cx + (this.rng() - 0.5) * bw * 0.6, g + total + ch / 2 - 0.2, cz + (this.rng() - 0.5) * bd * 0.6, 0, 0, (this.rng() - 0.5) * 0.4), color);
          }
          if (this.rng() < 0.5) this.box(bw * 0.9, 0.25, bd * 1.25, mat(cx, g + total - 0.1, cz, (this.rng() - 0.5) * 0.3, 0, (this.rng() - 0.5) * 0.3), CONCRETE);
          if (this.rng() < 0.4) this.rubble(cx + (this.rng() - 0.5) * bw * 2, cz + (this.rng() - 0.5) * bd * 2, 3, 4, color);
        }
      }
    }
    // the roofline of intact buildings: a parapet, water tanks, vents
    if (damage < 0.3) {
      const top = g + fullH + (this.heightAt((x0 + x1) / 2, (z0 + z1) / 2) - g);
      this.box(x1 - x0 + 0.4, 0.5, 0.4, mat((x0 + x1) / 2, top + 0.25, z0 - 0.0), DARKSTONE);
      this.box(x1 - x0 + 0.4, 0.5, 0.4, mat((x0 + x1) / 2, top + 0.25, z1), DARKSTONE);
      this.box(0.4, 0.5, z1 - z0 + 0.4, mat(x0, top + 0.25, (z0 + z1) / 2), DARKSTONE);
      this.box(0.4, 0.5, z1 - z0 + 0.4, mat(x1, top + 0.25, (z0 + z1) / 2), DARKSTONE);
      if (this.rng() < 0.6) {
        const tx = lerp(x0, x1, 0.3 + this.rng() * 0.4), tz = lerp(z0, z1, 0.3 + this.rng() * 0.4);
        this.cyl(1.2, 1.2, 2.4, 14, mat(tx, top + 2.4, tz), TIMBER);
        this.add(new THREE.ConeGeometry(1.35, 0.8, 14), TIMBER, mat(tx, top + 4, tz));
        for (const [ox, oz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) this.box(0.12, 1.3, 0.12, mat(tx + ox, top + 0.6, tz + oz), METAL);
      }
      if (this.rng() < 0.5) this.rbox(1.6, 1, 1.2, 0.1, mat(lerp(x0, x1, this.rng()), top + 0.5, lerp(z0, z1, this.rng())), METAL);
    }
    this.addCollider({ type: 'box', x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, rot: 0 });
  }

  buildBlock(i, j) {
    const key = `${i},${j}`;
    const [cx, cz] = this.blockCenter(i, j);
    const hb = BLOCK / 2;
    const inner = hb - 3;          // pavement is 3m wide

    // kerb stones round the block
    for (const s of [-1, 1]) {
      this.box(BLOCK, 0.18, 0.3, mat(cx, this.heightAt(cx, cz + s * hb) + 0.05, cz + s * hb), STONE_DARK);
      this.box(0.3, 0.18, BLOCK, mat(cx + s * hb, this.heightAt(cx + s * hb, cz) + 0.05, cz), STONE_DARK);
    }

    if (key === PLAZA) return this.buildPlaza(cx, cz);
    if (key === SWORD) return this.buildSwordSite(cx, cz);
    if (PARKS.includes(key)) return this.buildPark(cx, cz);

    const crater = this.craters.find((c) => Math.hypot(c.x - cx, c.z - cz) < c.r + 8);
    const raider = RAIDER_CAMPS.includes(key);
    const civ = CIVILIAN_CAMPS.includes(key);

    // split the block into lots
    const lots = [];
    if (this.rng() < 0.35 && !raider && !civ) lots.push([-inner, -inner, inner, inner]);
    else {
      const mx = (this.rng() - 0.5) * 10, mz = (this.rng() - 0.5) * 10;
      lots.push([-inner, -inner, mx - 1, mz - 1], [mx + 1, -inner, inner, mz - 1], [-inner, mz + 1, mx - 1, inner], [mx + 1, mz + 1, inner, inner]);
    }
    // camps keep one lot open as a yard
    const yard = raider || civ ? Math.floor(this.rng() * 4) : -1;
    const styles = [BRICK, CONCRETE, PLASTER, DARKSTONE];
    lots.forEach((l, n) => {
      if (n === yard) {
        const yx = cx + (l[0] + l[2]) / 2, yz = cz + (l[1] + l[3]) / 2;
        if (raider) this.buildRaiderCamp(yx, yz, (l[2] - l[0]) / 2, (l[3] - l[1]) / 2);
        else this.buildCivilianCamp(yx, yz, (l[2] - l[0]) / 2, (l[3] - l[1]) / 2);
        return;
      }
      const x0 = cx + l[0], z0 = cz + l[1], x1 = cx + l[2], z1 = cz + l[3];
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      let damage = this.rng() < 0.55 ? this.rng() : 0;
      let floors = 2 + Math.floor(this.rng() * this.rng() * 9);
      if (crater) {
        const d = Math.hypot(mx - crater.x, mz - crater.z);
        if (d < crater.r * 0.9) { this.rubble(mx, mz, 14, Math.min(x1 - x0, z1 - z0), ASH, 1.4); return; }
        damage = 1; floors = Math.max(1, Math.floor(floors * 0.5));
      }
      this.building(x0, z0, x1, z1, floors, styles[Math.floor(this.rng() * styles.length)], damage);
      if (damage > 0.5) for (let k = 0; k < 3; k++) this.slab(lerp(x0, x1, this.rng()), lerp(z0, z1, this.rng()) + (this.rng() < 0.5 ? -1 : 1) * ((z1 - z0) / 2 + 2), this.rng() * 6);
    });
  }

  buildPlaza(cx, cz) {
    // a paved square with the old cathedral in the middle
    this.box(BLOCK - 1, 0.25, BLOCK - 1, mat(cx, this.heightAt(cx, cz) + 0.05, cz), 0xa9a291);
    const hw = 8, z0 = cz - 15, z1 = cz + 9;
    this.wall(cx - hw, z0, cx - hw, z1, 12, 1.2, STONE, { broken: true, gaps: 0.15 });
    this.wall(cx + hw, z0, cx + hw, z1, 12, 1.2, STONE, { broken: true, gaps: 0.15 });
    this.wall(cx - hw, z0, cx - 2.6, z0, 15, 1.4, STONE, { broken: true });
    this.wall(cx + 2.6, z0, cx + hw, z0, 15, 1.4, STONE, { broken: true });
    for (const x of [-2.6, 2.6]) {
      this.cyl(0.65, 0.75, 7, 12, mat(cx + x, 3.5, z0), STONE_DARK);
      this.addCollider({ type: 'circle', x: cx + x, z: z0, r: 0.8 });
    }
    this.add(new THREE.TorusGeometry(2.6, 0.5, 10, 24, Math.PI), STONE_DARK, mat(cx, 7, z0));
    // rose window ring above the door
    this.add(new THREE.TorusGeometry(2.4, 0.35, 10, 32), STONE_DARK, mat(cx, 11.5, z0 - 0.2));
    for (let k = 0; k < 8; k++) this.box(0.18, 4.6, 0.25, mat(cx, 11.5, z0 - 0.2, 0, 0, (k / 8) * Math.PI), STONE_DARK);
    // apse
    let prev = [cx - hw, z1];
    for (let k = 1; k <= 6; k++) {
      const a = (Math.PI * k) / 6;
      const p = [cx - Math.cos(a) * hw, z1 + Math.sin(a) * hw];
      this.wall(prev[0], prev[1], p[0], p[1], 11, 1.2, STONE, { broken: true, gaps: 0.1 });
      prev = p;
    }
    for (let z = z0 + 5; z < z1; z += 5) {
      for (const x of [-4, 4]) {
        if (this.rng() < 0.2) this.fallenColumn(cx + x + (this.rng() - 0.5) * 2, z + 1, 8, 0.55, this.rng() * 6);
        else this.column(cx + x, z, this.rng() < 0.5 ? 2 + this.rng() * 4 : 9, 0.55);
      }
    }
    this.rubble(cx, cz, 22, 14);
    // statue plinth in front: the statue is gone
    this.rbox(3, 2, 3, 0.15, mat(cx, 1, cz - 19), STONE_DARK);
    this.addCollider({ type: 'box', x: cx, z: cz - 19, hw: 1.5, hd: 1.5, rot: 0 });
  }

  buildSwordSite(cx, cz) {
    const [x, z] = this.swordSite;
    const g = this.heightAt(x, z);
    const M = mat(x, g, z, 0.16, 0.7, 0.12);
    const piece = (geo, color, lx, ly, lz) => { geo.translate(lx, ly, lz); this.add(geo, color, M); };
    // the blade has a diamond cross-section, so it catches the light
    const blade = new THREE.CylinderGeometry(1.6, 1.8, 42, 4);
    blade.scale(1, 1, 0.3);
    piece(blade, 0x9c9a94, 0, 13, 0);
    piece(new RoundedBoxGeometry(16, 1.8, 1.8, 2, 0.4), 0xb39a5c, 0, 34.6, 0);
    piece(new THREE.CylinderGeometry(0.75, 0.75, 6.2, 12), 0x4d3b2c, 0, 38.6, 0);
    piece(new THREE.SphereGeometry(1.7, 14, 10), 0xb39a5c, 0, 42.6, 0);
    this.addCollider({ type: 'circle', x, z, r: 2.2 });
    this.rubble(x, z, 24, 26, ASH, 1.3);
    for (let k = 0; k < 6; k++) this.slab(x + (this.rng() - 0.5) * 30, z + (this.rng() - 0.5) * 30, this.rng() * 6, ASH);
  }

  buildPark(cx, cz) {
    for (let k = 0; k < 26; k++) this.tree(cx + (this.rng() - 0.5) * 36, cz + (this.rng() - 0.5) * 36);
    // a dry fountain
    const g = this.heightAt(cx, cz);
    this.add(new THREE.TorusGeometry(3.2, 0.35, 8, 28), STONE_DARK, mat(cx, g + 0.4, cz, Math.PI / 2));
    this.cyl(0.4, 0.6, 2.2, 10, mat(cx, g + 1.1, cz), STONE_DARK);
    this.cyl(1.2, 0.2, 0.5, 14, mat(cx, g + 2.3, cz), STONE_DARK);
    this.addCollider({ type: 'circle', x: cx, z: cz, r: 3.5 });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      this.bench(cx + Math.cos(a) * 9, cz + Math.sin(a) * 9, -a);
    }
  }

  bench(x, z, ry) {
    const g = this.heightAt(x, z);
    this.box(1.8, 0.08, 0.5, mat(x, g + 0.45, z, 0, ry), TIMBER);
    this.box(1.8, 0.4, 0.06, mat(x - Math.sin(ry) * 0.25, g + 0.7, z - Math.cos(ry) * 0.25, 0.15, ry), TIMBER);
    for (const s of [-0.75, 0.75]) this.box(0.08, 0.45, 0.5, mat(x + Math.cos(ry) * s, g + 0.22, z - Math.sin(ry) * s, 0, ry), METAL);
  }

  buildRaiderCamp(x, z, hx, hz) {
    this.raiderCamps.push({ x, z });
    // a ring of junk barricades: sheet metal, tyres, spikes, a burnt car
    const r = Math.min(hx, hz) - 1.5;
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      if (k === 3 || k === 10) continue;    // ways in
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const g = this.heightAt(px, pz);
      const kind = k % 3;
      if (kind === 0) {
        this.box(0.08, 2.2, 2.8, mat(px, g + 1.0, pz, 0, -a, (this.rng() - 0.5) * 0.2), RUST);
        this.addCollider({ type: 'box', x: px, z: pz, hw: 0.2, hd: 1.4, rot: -a });
      } else if (kind === 1) {
        for (let t = 0; t < 3; t++) this.add(new THREE.TorusGeometry(0.42, 0.17, 8, 16), ASH, mat(px, g + 0.18 + t * 0.33, pz, Math.PI / 2, 0, (this.rng() - 0.5) * 0.3));
        this.addCollider({ type: 'circle', x: px, z: pz, r: 0.65 });
      } else {
        for (let t = 0; t < 4; t++) {
          const geo = new THREE.ConeGeometry(0.08, 2.2, 6);
          geo.translate(0, 1.0, 0);
          this.add(geo, TIMBER, mat(px + Math.sin(a) * (t - 1.5) * 0.6, g - 0.1, pz - Math.cos(a) * (t - 1.5) * 0.6, 0.6, -a + Math.PI / 2, 0));
        }
      }
    }
    this.car(x + r * 0.4, z - r * 0.3, this.rng() * 6, true);
    // fire barrels
    for (let k = 0; k < 2; k++) {
      const px = x + (k ? 3 : -3), pz = z + (this.rng() - 0.5) * 4;
      this.cyl(0.32, 0.3, 0.9, 12, mat(px, this.heightAt(px, pz) + 0.45, pz), RUST);
      this.fires.push({ x: px, y: this.heightAt(px, pz) + 1.0, z: pz, size: 0.6 });
      this.addCollider({ type: 'circle', x: px, z: pz, r: 0.4 });
    }
    // a skull-on-a-pole warning sign
    const sx = x + r + 2, sz = z;
    this.cyl(0.05, 0.06, 2.6, 6, mat(sx, this.heightAt(sx, sz) + 1.3, sz), TIMBER);
    this.add(new THREE.SphereGeometry(0.17, 10, 8), 0xd8d0bc, mat(sx, this.heightAt(sx, sz) + 2.7, sz));
  }

  buildCivilianCamp(x, z, hx, hz) {
    this.civilianCamps.push({ x, z });
    const g = this.heightAt(x, z);
    // tarps strung between poles, bedrolls, and a small fire
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const px = x + Math.cos(a) * 5, pz = z + Math.sin(a) * 5;
      const tarp = new THREE.PlaneGeometry(3.2, 2.6, 6, 4);
      const p = tarp.attributes.position;
      for (let v = 0; v < p.count; v++) p.setZ(v, Math.sin((p.getX(v) / 3.2 + 0.5) * Math.PI) * 0.35);
      tarp.computeVertexNormals();
      const colors = [0x6f7a62, 0x8a6e52, 0x6a6f7a, 0x8c8473];
      this.add(tarp, colors[k], mat(px, g + 1.3, pz, -0.9, -a + Math.PI / 2, 0));
      const back = tarp.clone();
      this.add(back, colors[k], mat(px, g + 1.3, pz, -0.9 + Math.PI, -a + Math.PI / 2, 0));
      this.box(0.07, 2.2, 0.07, mat(px + Math.cos(a) * 1.2, g + 1.1, pz + Math.sin(a) * 1.2), TIMBER);
      this.rbox(0.8, 0.18, 1.9, 0.08, mat(px - Math.cos(a) * 0.6, g + 0.09, pz - Math.sin(a) * 0.6, 0, -a), 0x7d6b5a);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      this.add(new THREE.DodecahedronGeometry(0.18, 0), STONE_DARK, mat(x + Math.cos(a) * 0.7, g + 0.1, z + Math.sin(a) * 0.7));
    }
    this.fires.push({ x, y: g + 0.25, z, size: 0.5 });
    this.rbox(0.6, 0.5, 0.6, 0.06, mat(x + 2.5, g + 0.25, z - 1.5, 0, 0.4), TIMBER);
  }

  // ================================================================ street furniture
  car(x, z, ry, burnt = this.rng() < 0.7) {
    const g = this.heightAt(x, z);
    const cols = [0x6e4f45, 0x5d6670, 0x7a7466, 0x4f5b4c, 0x8a7d5e];
    const c = burnt ? 0x5a4c44 : cols[Math.floor(this.rng() * cols.length)];
    const tilt = burnt ? (this.rng() - 0.5) * 0.12 : 0;
    const M = mat(x, g, z, tilt, ry, tilt);
    const part = (geo, color, lx, ly, lz) => { geo.translate(lx, ly, lz); this.add(geo, color, M); };
    part(new RoundedBoxGeometry(1.9, 0.75, 4.3, 2, 0.22), c, 0, 0.72, 0);
    part(new RoundedBoxGeometry(1.7, 0.62, 2.3, 2, 0.24), c, 0, 1.35, -0.2);
    part(new THREE.BoxGeometry(1.72, 0.42, 0.06), 0x2a2622, 0, 1.38, 0.97);     // windscreen hole
    for (const [wx, wz] of [[-0.88, 1.35], [0.88, 1.35], [-0.88, -1.35], [0.88, -1.35]]) {
      if (burnt && this.rng() < 0.3) continue;
      const w = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 14);
      w.rotateZ(Math.PI / 2);
      part(w, ASH, wx, 0.36, wz);
    }
    this.addCollider({ type: 'box', x, z, hw: 0.95, hd: 2.15, rot: ry });
  }

  lamp(x, z, ry, bent) {
    const g = this.heightAt(x, z);
    const lean = bent ? 0.3 + this.rng() * 0.5 : 0;
    const M = mat(x, g, z, lean, ry, 0);
    const part = (geo, color, lx, ly, lz) => { geo.translate(lx, ly, lz); this.add(geo, color, M); };
    part(new THREE.CylinderGeometry(0.09, 0.13, 6, 8), METAL, 0, 3, 0);
    const arm = new THREE.TorusGeometry(0.7, 0.05, 6, 10, Math.PI / 2);
    part(arm, METAL, 0.7, 6, 0);
    part(new THREE.CylinderGeometry(0.15, 0.3, 0.3, 10), METAL, 1.4, 6.55, 0);
  }

  pole(x, z) {
    const g = this.heightAt(x, z);
    this.cyl(0.13, 0.17, 9, 8, mat(x, g + 4.5, z), TIMBER);
    this.box(2.4, 0.16, 0.16, mat(x, g + 8.3, z), TIMBER);
    return new THREE.Vector3(x, g + 8.3, z);
  }

  wire(a, b) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(new THREE.Vector3(lerp(a.x, b.x, t), lerp(a.y, b.y, t) - Math.sin(t * Math.PI) * 1.6, lerp(a.z, b.z, t)));
    }
    this.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.03, 4, false), 0x2a2622);
  }

  buildStreets() {
    const lim = NB * PERIOD + BLOCK / 2;
    for (let s = -NB; s < NB; s++) {
      const c = s * PERIOD + PERIOD / 2;          // the street's centre line
      for (const dir of [0, 1]) {
        const P = (along, across) => (dir === 0 ? [along, c + across] : [c + across, along]);
        const ry = dir === 0 ? Math.PI / 2 : 0;
        // dashed centre line
        for (let t = -lim; t < lim; t += 6) {
          if (this.rng() < 0.2) continue;
          const [x, z] = P(t, 0);
          if (this.surface(x, z) !== 'street') continue;
          this.box(0.18, 0.03, 2.4, mat(x, this.heightAt(x, z) + 0.02, z, 0, ry), 0xcfc6b0);
        }
        // lamp posts on alternate sides
        for (let t = -lim + 9; t < lim; t += 19) {
          const side = Math.floor(t / 19) % 2 ? 1 : -1;
          const [x, z] = P(t, side * (STREET / 2 + 0.6));
          if (this.surface(x, z) === 'street') continue;
          this.lamp(x, z, dir === 0 ? (side > 0 ? 0 : Math.PI) : (side > 0 ? -Math.PI / 2 : Math.PI / 2), this.rng() < 0.3);
        }
        // parked and crashed cars
        for (let t = -lim; t < lim; t += 8 + this.rng() * 14) {
          if (this.rng() < 0.45) continue;
          const crashed = this.rng() < 0.3;
          const across = crashed ? (this.rng() - 0.5) * 6 : (this.rng() < 0.5 ? -1 : 1) * (STREET / 2 - 1.5);
          const [x, z] = P(t, across);
          if (this.surface(x, z) !== 'street') continue;
          if (Math.hypot(x - this.spawn?.x || 0, z + PERIOD / 2) < 6) continue;
          this.car(x, z, ry + (crashed ? (this.rng() - 0.5) * 1.6 : (this.rng() - 0.5) * 0.1));
        }
        // debris in the road
        for (let k = 0; k < 10; k++) {
          const [x, z] = P((this.rng() * 2 - 1) * lim, (this.rng() - 0.5) * STREET);
          this.rubble(x, z, 3, 2.5, this.rng() < 0.5 ? CONCRETE : BRICK);
        }
      }
      // telegraph poles and sagging wires down every other street
      if (s % 2 === 0) {
        let prev = null;
        for (let t = -lim; t < lim; t += 24) {
          const x = t, z = c + STREET / 2 + 1.6;
          if (this.surface(x, z) === 'street') { prev = null; continue; }
          const top = this.pole(x, z);
          if (prev && this.rng() < 0.8) this.wire(prev, top);
          prev = top;
        }
      }
    }
  }

  // a skyscraper that fell across the street
  buildFallenTower() {
    const x = 1.5 * PERIOD, z = -1 * PERIOD + 10;
    const ry = 0.55;
    const g = this.heightAt(x, z);
    this.box(12, 12, 64, mat(x, g + 4, z, 0.06, ry, 0.12), CONCRETE, 1.42);
    this.rubble(x - 10, z - 20, 30, 18, CONCRETE, 1.3);
    this.rubble(x + 12, z + 24, 30, 16, CONCRETE, 1.3);
    for (const t of [-0.4, -0.2, 0, 0.2, 0.4]) {
      this.addCollider({ type: 'box', x: x + Math.sin(ry) * 64 * t, z: z + Math.cos(ry) * 64 * t, hw: 6, hd: 7, rot: ry });
    }
  }

  // far-off ruins beyond the edge, so the city seems to go on for ever
  buildSkyline() {
    for (let k = 0; k < 70; k++) {
      const a = (k / 70) * Math.PI * 2 + this.rng() * 0.05;
      const d = HALF + 40 + this.rng() * 120;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const h = 20 + this.rng() * 70;
      const w = 10 + this.rng() * 20;
      this.box(w, h, w, mat(x, h / 2 + 10, z, 0, this.rng() * 3, (this.rng() - 0.5) * 0.1), CONCRETE, 1 + this.rng() * 0.9);
    }
  }

  // ---- old helpers still used by the cathedral and park ----
  wall(x1, z1, x2, z2, height, thick, color, opts = {}) {
    const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz);
    const ry = Math.atan2(dx, dz);
    const n = Math.max(1, Math.round(L / 2.6));
    const seg = L / n;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const cx = x1 + dx * t, cz = z1 + dz * t;
      if (opts.gaps && this.rng() < opts.gaps) { this.rubble(cx, cz, 2, 3, color); continue; }
      const hh = height * (opts.broken ? 0.3 + this.rng() * 0.7 : 1);
      const base = this.heightAt(cx, cz) - 0.6;
      const total = hh + 0.6;
      this.box(thick, total, seg + 0.03, mat(cx, base + total / 2, cz, 0, ry, 0), color);
      this.addCollider({ type: 'box', x: cx, z: cz, hw: thick / 2, hd: seg / 2, rot: ry });
    }
  }
  column(x, z, h, r, color = STONE) {
    const g = this.heightAt(x, z) - 0.2;
    this.rbox(r * 2.6, 0.6, r * 2.6, 0.08, mat(x, g + 0.3, z), STONE_DARK);
    this.cyl(r * 0.92, r, h, 14, mat(x, g + 0.6 + h / 2, z), color);
    if (h > 7) this.rbox(r * 2.4, 0.5, r * 2.4, 0.08, mat(x, g + 0.6 + h + 0.25, z), STONE_DARK);
    this.addCollider({ type: 'circle', x, z, r: r + 0.25 });
  }
  fallenColumn(x, z, len, r, ry, color = STONE) {
    const g = this.heightAt(x, z);
    this.cyl(r, r, len, 14, mat(x, g + r * 0.8, z, Math.PI / 2, ry, 0), color);
    for (const t of [-0.35, 0, 0.35]) this.addCollider({ type: 'circle', x: x + Math.sin(ry) * len * t, z: z + Math.cos(ry) * len * t, r: r + 0.2 });
  }
  tree(x, z) {
    const g = this.heightAt(x, z);
    const h = 4 + this.rng() * 5, r = 0.2 + this.rng() * 0.18;
    this.cyl(r * 0.45, r, h, 8, mat(x, g + h / 2 - 0.3, z, (this.rng() - 0.5) * 0.1, 0, (this.rng() - 0.5) * 0.1), BARK);
    const nb = 3 + Math.floor(this.rng() * 3);
    for (let b = 0; b < nb; b++) {
      const L = 1.2 + this.rng() * 1.8;
      const geo = new THREE.CylinderGeometry(r * 0.12, r * 0.4, L, 6);
      geo.translate(0, L / 2, 0);
      const side = this.rng() < 0.5 ? -1 : 1;
      this.add(geo, BARK, mat(x, g + h * (0.45 + this.rng() * 0.45), z, 0, this.rng() * 6.28, side * (0.5 + this.rng() * 0.6)));
    }
    this.addCollider({ type: 'circle', x, z, r: r + 0.15 });
  }

  /** Glue every piece into big meshes, one per 80m square. */
  mergePieces() {
    const CH = 80;
    const groups = new Map();
    for (const p of this.pieces) {
      p.geo.computeBoundingSphere();
      const c = p.geo.boundingSphere.center;
      const key = Math.floor((c.x + HALF + 400) / CH) + ',' + Math.floor((c.z + HALF + 400) / CH);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const fillMat = this.sketch.fill(0xffffff, { vertexColors: true, scribble: 0.2 });
    const tint = new THREE.Color();
    for (const list of groups.values()) {
      let nv = 0, ni = 0;
      for (const p of list) { nv += p.geo.attributes.position.count; ni += p.geo.index.count; }
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
      const col = new Float32Array(nv * 3), win = new Float32Array(nv);
      const idx = new Uint32Array(ni);
      let vo = 0, io = 0;
      for (const p of list) {
        const g = p.geo, n = g.attributes.position.count;
        pos.set(g.attributes.position.array, vo * 3);
        nor.set(g.attributes.normal.array, vo * 3);
        tint.set(p.color).multiplyScalar(0.93 + this.rng() * 0.12);
        for (let i = 0; i < n; i++) {
          col[(vo + i) * 3] = tint.r; col[(vo + i) * 3 + 1] = tint.g; col[(vo + i) * 3 + 2] = tint.b;
          win[vo + i] = p.win;
        }
        const src = g.index.array;
        for (let i = 0; i < src.length; i++) idx[io + i] = src[i] + vo;
        io += src.length;
        vo += n;
        g.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('win', new THREE.BufferAttribute(win, 1));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      this.scene.add(new THREE.Mesh(geo, fillMat));
    }
    this.pieces = null;
  }

  buildSky() {
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), this.sketch.makeSky(new THREE.Vector3(0.25, 0.5, 1)));
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  update(camera) {
    this.sky.position.copy(camera.position);
  }
}
