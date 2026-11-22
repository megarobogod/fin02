// =====================================================
// world.js - the ruined city
//
// The city is a grid: square blocks of buildings with streets between them.
//   BLOCK  = how wide a block is (metres)
//   STREET = how wide a street is
//   NB     = how many blocks out from the middle the city goes
// With NB = 12 that's 25 x 25 blocks: about 1.5 km across.
//
// That's far too much to keep in full detail at once, so the city is
// STREAMED: only the blocks near you are built properly (every brick,
// car and lamp post). Further away, each building is a plain stand-in box
// ("far version"), which is all you can make out through the dust anyway.
// As you walk, blocks ahead of you are built and blocks behind are thrown away.
//
// Every block is built from its own random seed, so it always comes out
// exactly the same when you come back to it.
//
// Districts: tall towers downtown, low houses round the edge, warehouses and
// chimneys in the industrial patches, and craters where angels purged whole
// streets. The cathedral plaza is in the middle.
// =====================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SURF } from './materials.js';

export const BLOCK = 44;
export const STREET = 14;
export const PERIOD = BLOCK + STREET; // 58
export const NB = 12;                 // blocks run from -12 to 12 in each direction
export const CITY_EDGE = NB * PERIOD + BLOCK / 2 + 2;   // where the buildings stop
export const HALF = CITY_EDGE + 110;  // the map (with rubble hills round it) runs from -HALF to +HALF
const CELL = 2.5;                     // ground grid square size
const RES = Math.ceil((HALF * 2) / CELL);
const GRID = 16;                      // collision lookup square size
const FLOOR = 3.3;                    // storey height (matches the window pattern)

// how near a block has to be (from its middle) to be built in full detail
const LOAD_RADIUS = 240;
const UNLOAD_RADIUS = 300;
const DETAIL_RADIUS = 150;            // small things (rubble, lamps, wires) vanish past this
const BUILD_MS = 6;                   // time allowed per frame for building blocks

// Special blocks, by grid position [i, j]
const PLAZA = '0,0';
const HAND_CRATERS = { '-2,1': 30, '3,-2': 26, '1,3': 24, '7,5': 64, '-6,-8': 40 };
const SWORD = '-3,-3';
const HAND_PARKS = ['2,1', '-1,-3'];
const HAND_RAIDERS = ['1,1', '-3,2', '2,-3', '3,3', '-4,-1', '4,0', '-1,4'];
const HAND_CIVILIANS = ['-1,-1', '-1,2', '1,-2', '-2,-1', '3,1', '0,-4', '-4,3'];
const TOWER_BLOCK = '1,-1';           // the skyscraper that fell across the street

// Colours (as hex, like a paint chart) and what kind of surface each is
const BRICK = 0x7a4a3a, CONCRETE = 0x8f8a82, PLASTER = 0xb0a48c, DARKSTONE = 0x6e675d;
const STONE = 0x9d9483, STONE_DARK = 0x7a7264, BARK = 0x3e342c, TIMBER = 0x5a4836;
const RUST = 0x6d4a35, METAL = 0x5f6266, ASH = 0x2e2a27, TARP = 0x5d6650;
const SURF_OF = {
  [BRICK]: SURF.BRICK, [CONCRETE]: SURF.CONCRETE, [PLASTER]: SURF.PLASTER, [DARKSTONE]: SURF.STONE,
  [STONE]: SURF.STONE, [STONE_DARK]: SURF.STONE, [BARK]: SURF.WOOD, [TIMBER]: SURF.WOOD,
  [RUST]: SURF.RUST, [METAL]: SURF.METAL, [ASH]: SURF.ASH,
};

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
    this.mats = game.mats;
    this.grid = new Map();
    this.stamp = 0;
    this.raiderCamps = [];
    this.civilianCamps = [];
    this.fires = [];          // spots where fire particles rise (from loaded blocks)
    this.nodes = [];          // street crossings, for people walking about
    this.blocks = new Map();  // every block's plan, by "i,j"
    this.loaded = new Map();  // blocks built in full detail right now
    this.cur = null;          // the block being built
    this.spawn = new THREE.Vector3(0, 0, -PERIOD / 2);
    this.limit = CITY_EDGE - 2;

    this.makeCraters();
    this.buildHeights();
    this.buildTerrain();
    this.planCity();
    this.buildFarCity();
    this.buildSky();

    for (let i = -NB; i < NB; i++) for (let j = -NB; j < NB; j++) {
      this.nodes.push({ x: i * PERIOD + PERIOD / 2, z: j * PERIOD + PERIOD / 2 });
    }
    // build everything round the start straight away
    this.stream(this.spawn.x, this.spawn.z, Infinity);
  }

  blockCenter(i, j) { return [i * PERIOD, j * PERIOD]; }

  // ================================================================ the plan
  /**
   * Decide what every block is (a tower block, a park, a raider camp...) and
   * lay out its buildings, without building anything yet. This is quick, and
   * it's what the far stand-in boxes and the camp list come from.
   */
  planCity() {
    for (let i = -NB; i <= NB; i++) for (let j = -NB; j <= NB; j++) {
      const key = `${i},${j}`;
      const rng = mulberry32(Math.floor(ihash(i, j, 77) * 4294967296));
      const [cx, cz] = this.blockCenter(i, j);
      const r = Math.hypot(i, j);
      const p = { i, j, key, cx, cz, seed: Math.floor(ihash(i, j, 99) * 4294967296), lots: [], kind: 'normal' };
      this.blocks.set(key, p);

      // which district are we in?
      const industrial = r > 5 && fbm(i * 0.22 + 40, j * 0.22, 2, 5) > 0.58;
      const crater = this.craters.find((c) => Math.hypot(c.x - cx, c.z - cz) < c.r + 8);
      if (key === PLAZA) p.kind = 'plaza';
      else if (key === SWORD) p.kind = 'sword';
      else if (HAND_PARKS.includes(key) || (!crater && r > 3 && ihash(i, j, 5) < 0.06)) p.kind = 'park';
      else if (HAND_RAIDERS.includes(key) || (!crater && r > 5 && ihash(i, j, 6) < 0.09)) p.kind = 'raider';
      else if (HAND_CIVILIANS.includes(key) || (!crater && r > 5 && ihash(i, j, 7) < 0.06)) p.kind = 'civ';
      else if (industrial) p.kind = 'industrial';
      p.crater = crater;
      if (p.kind === 'plaza' || p.kind === 'sword' || p.kind === 'park') continue;

      // split the block into lots
      const inner = BLOCK / 2 - 3;          // pavement is 3m wide
      const lots = [];
      const camp = p.kind === 'raider' || p.kind === 'civ';
      if (p.kind === 'industrial' && rng() < 0.6) lots.push([-inner, -inner, inner, inner]);
      else if (rng() < 0.3 && !camp && r < 4) lots.push([-inner, -inner, inner, inner]);
      else {
        const mx = (rng() - 0.5) * 10, mz = (rng() - 0.5) * 10;
        lots.push([-inner, -inner, mx - 1, mz - 1], [mx + 1, -inner, inner, mz - 1], [-inner, mz + 1, mx - 1, inner], [mx + 1, mz + 1, inner, inner]);
      }
      // camps keep one lot open as a yard
      const yard = camp ? Math.floor(rng() * lots.length) : -1;
      const styles = r < 4 ? [CONCRETE, CONCRETE, DARKSTONE, BRICK] : r < 8 ? [BRICK, PLASTER, CONCRETE, DARKSTONE] : [BRICK, PLASTER, PLASTER, BRICK];
      lots.forEach((l, n) => {
        const lot = { x0: cx + l[0], z0: cz + l[1], x1: cx + l[2], z1: cz + l[3] };
        const mx = (lot.x0 + lot.x1) / 2, mz = (lot.z0 + lot.z1) / 2;
        if (n === yard) {
          lot.yard = true;
          (p.kind === 'raider' ? this.raiderCamps : this.civilianCamps).push({ x: mx, z: mz });
          p.yard = lot;
          p.lots.push(lot);
          return;
        }
        // height: towers downtown, houses at the edge
        let floors;
        if (r < 3.5) floors = 6 + Math.floor(rng() * rng() * 18);
        else if (r < 7.5) floors = 3 + Math.floor(rng() * rng() * 8);
        else floors = 1 + Math.floor(rng() * 4);
        let damage = rng() < 0.55 ? rng() : 0;
        lot.style = styles[Math.floor(rng() * styles.length)];
        if (p.kind === 'industrial') { floors = 2 + Math.floor(rng() * 2); lot.style = rng() < 0.5 ? CONCRETE : METAL; lot.warehouse = true; }
        if (crater) {
          const d = Math.hypot(mx - crater.x, mz - crater.z);
          if (d < crater.r * 0.9) { lot.rubble = true; p.lots.push(lot); return; }
          damage = 1; floors = Math.max(1, Math.floor(floors * 0.5));
        }
        lot.floors = floors;
        lot.damage = damage;
        p.lots.push(lot);
      });
    }
  }

  // ================================================================ ground
  makeCraters() {
    this.craters = [];
    const add = (i, j, r) => this.craters.push({ x: i * PERIOD + 6, z: j * PERIOD - 4, r, depth: Math.min(8, r * 0.16) });
    for (const [key, r] of Object.entries(HAND_CRATERS)) { const [i, j] = key.split(',').map(Number); add(i, j, r); }
    // more craters scattered through the outer city
    for (let i = -NB; i <= NB; i++) for (let j = -NB; j <= NB; j++) {
      if (Math.hypot(i, j) > 5 && ihash(i, j, 3) < 0.045) add(i, j, 18 + ihash(i, j, 4) * 18);
    }
    const [si, sj] = SWORD.split(',').map(Number);
    this.swordSite = [si * PERIOD, sj * PERIOD];
    this.craters.push({ x: this.swordSite[0], z: this.swordSite[1], r: 20, depth: 3.5 });
  }

  rawHeight(x, z) {
    let h = (fbm(x * 0.012, z * 0.012, 3) - 0.5) * 1.2;   // the city is nearly flat
    for (const c of this.craters) {
      const dx = x - c.x, dz = z - c.z;
      if (Math.abs(dx) > c.r * 1.8 || Math.abs(dz) > c.r * 1.8) continue;
      const q = Math.hypot(dx, dz) / c.r;
      if (q < 1) h -= c.depth * (1 - q * q);
      h += c.depth * 0.35 * Math.exp(-(((q - 1) / 0.25) ** 2));
    }
    // rubble mountains where the city was flattened round the edge
    const e = Math.max(Math.abs(x), Math.abs(z));
    h += smoothstep(CITY_EDGE + 20, HALF, e) ** 1.4 * 38 * (0.6 + 0.8 * noise(x * 0.04, z * 0.04, 3));
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

  /** The ground, in squares of 32 x 32 grid cells (80m), so unseen parts aren't drawn. */
  buildTerrain() {
    const W = RES + 1;
    const N = 32;
    const material = this.mats.ground({ period: PERIOD, block: BLOCK, street: STREET, edge: CITY_EDGE });
    this.terrain = [];
    const nrm = new THREE.Vector3();
    for (let cj = 0; cj < RES; cj += N) for (let ci = 0; ci < RES; ci += N) {
      const ni = Math.min(N, RES - ci), nj = Math.min(N, RES - cj);
      const vw = ni + 1, vh = nj + 1;
      const pos = new Float32Array(vw * vh * 3), nor = new Float32Array(vw * vh * 3), col = new Float32Array(vw * vh * 3);
      for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
        const k = j * vw + i;
        const gi = ci + i, gj = cj + j;
        const x = -HALF + gi * CELL, z = -HALF + gj * CELL;
        pos[k * 3] = x; pos[k * 3 + 1] = this.h[gj * W + gi]; pos[k * 3 + 2] = z;
        this.normalAt(x, z, nrm);
        nor[k * 3] = nrm.x; nor[k * 3 + 1] = nrm.y; nor[k * 3 + 2] = nrm.z;
        // scorched black round craters, a little darker or lighter at random
        let sc = 0;
        for (const cr of this.craters) {
          if (Math.abs(x - cr.x) > cr.r * 1.5 || Math.abs(z - cr.z) > cr.r * 1.5) continue;
          sc = Math.max(sc, smoothstep(1.4, 0.4, Math.hypot(x - cr.x, z - cr.z) / cr.r));
        }
        const v = (0.9 + 0.2 * noise(x * 0.3, z * 0.3, 9)) * (1 - sc * 0.65);
        col[k * 3] = v; col[k * 3 + 1] = v * (1 - sc * 0.05); col[k * 3 + 2] = v * (1 - sc * 0.1);
      }
      const idx = [];
      for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
        const a = j * vw + i, b = a + 1, c = a + vw, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.terrain.push(mesh);
    }
  }

  // ================================================================ collision
  addCollider(c) {
    const br = c.type === 'circle' ? c.r : Math.hypot(c.hw, c.hd);
    c.cells = [];
    const x0 = Math.floor((c.x - br) / GRID), x1 = Math.floor((c.x + br) / GRID);
    const z0 = Math.floor((c.z - br) / GRID), z1 = Math.floor((c.z + br) / GRID);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const key = gx + ',' + gz;
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(c);
      c.cells.push(key);
    }
    if (this.cur) this.cur.colliders.push(c);
  }

  removeCollider(c) {
    for (const key of c.cells) {
      const list = this.grid.get(key);
      if (!list) continue;
      const i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) this.grid.delete(key);
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

  // ================================================================ streaming
  /** Build blocks near (x, z) and throw away ones that are far, within a time budget. */
  stream(x, z, budgetMs = BUILD_MS) {
    const start = performance.now();
    // throw away far blocks
    for (const [key, b] of this.loaded) {
      if (Math.hypot(b.plan.cx - x, b.plan.cz - z) > UNLOAD_RADIUS) this.unloadBlock(key);
    }
    // build the nearest missing ones first
    const want = [];
    const bi = Math.round(x / PERIOD), bj = Math.round(z / PERIOD);
    const span = Math.ceil(LOAD_RADIUS / PERIOD) + 1;
    for (let i = bi - span; i <= bi + span; i++) for (let j = bj - span; j <= bj + span; j++) {
      const plan = this.blocks.get(`${i},${j}`);
      if (!plan || this.loaded.has(plan.key)) continue;
      const d = Math.hypot(plan.cx - x, plan.cz - z);
      if (d < LOAD_RADIUS) want.push([d, plan]);
    }
    want.sort((a, b) => a[0] - b[0]);
    for (const [, plan] of want) {
      this.loadBlock(plan);
      if (performance.now() - start > budgetMs) break;
    }
    // small things only near you
    for (const b of this.loaded.values()) {
      if (b.detail) b.detail.visible = Math.hypot(b.plan.cx - x, b.plan.cz - z) < DETAIL_RADIUS;
    }
  }

  loadBlock(plan) {
    this.rng = mulberry32(plan.seed);
    this.pieces = [];
    this.cur = { plan, colliders: [], fires: [] };
    this.buildBlock(plan);
    this.buildStreetsAround(plan);
    if (plan.key === TOWER_BLOCK) this.buildFallenTower();
    const b = this.cur;
    this.cur = null;
    // glue the pieces into two meshes: the big stuff, and small things that can vanish when far
    const big = [], small = [];
    for (const p of this.pieces) {
      p.geo.computeBoundingSphere();
      (p.geo.boundingSphere.radius < 2.2 && !p.keep ? small : big).push(p);
    }
    b.main = this.merge(big);
    b.detail = this.merge(small);
    this.pieces = null;
    this.loaded.set(plan.key, b);
    this.fires.push(...b.fires);
    this.hideFar(plan, true);
  }

  unloadBlock(key) {
    const b = this.loaded.get(key);
    for (const m of [b.main, b.detail]) if (m) { this.scene.remove(m); m.geometry.dispose(); }
    for (const c of b.colliders) this.removeCollider(c);
    this.fires = this.fires.filter((f) => !b.fires.includes(f));
    this.loaded.delete(key);
    this.hideFar(b.plan, false);
  }

  // ================================================================ pieces
  add(geo, color, m, win = 0, surf = SURF_OF[color] ?? SURF.GENERIC) {
    if (m) geo.applyMatrix4(m);
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    if (geo.index === null) {
      // keep everything indexed so it can all be glued together
      const n = geo.attributes.position.count;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    const piece = { geo, color, win, surf };
    this.pieces.push(piece);
    return piece;
  }
  box(w, h, d, m, color, win = 0) { return this.add(new THREE.BoxGeometry(w, h, d), color, m, win); }
  rbox(w, h, d, r, m, color, surf) { return this.add(new RoundedBoxGeometry(w, h, d, 2, r), color, m, 0, surf); }
  cyl(rt, rb, h, seg, m, color) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, m); }

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
  building(x0, z0, x1, z1, floors, color, damage, windows = true) {
    const seed = windows ? 1 + this.rng() * 0.99 : 0;
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
        this.box(bw + 0.02, total, bd + 0.02, mat(cx, g + total / 2, cz), color, seed).keep = true;
        if (h < fullH - 1) {
          // jagged broken edge and exposed floor slabs
          for (let k = 0; k < 2; k++) {
            const ch = 0.5 + this.rng() * 1.8;
            this.box(bw * (0.2 + this.rng() * 0.4), ch, bd * (0.2 + this.rng() * 0.4),
              mat(cx + (this.rng() - 0.5) * bw * 0.6, g + total + ch / 2 - 0.2, cz + (this.rng() - 0.5) * bd * 0.6, 0, 0, (this.rng() - 0.5) * 0.4), color);
          }
          if (this.rng() < 0.5) this.box(bw * 0.9, 0.25, bd * 1.25, mat(cx, g + total - 0.1, cz, (this.rng() - 0.5) * 0.3, 0, (this.rng() - 0.5) * 0.3), CONCRETE).keep = true;
          if (this.rng() < 0.4) this.rubble(cx + (this.rng() - 0.5) * bw * 2, cz + (this.rng() - 0.5) * bd * 2, 3, 4, color);
        }
      }
    }
    // the roofline of intact buildings: a parapet, water tanks, vents
    if (damage < 0.3) {
      const top = g + fullH + (this.heightAt((x0 + x1) / 2, (z0 + z1) / 2) - g);
      for (const piece of [
        this.box(x1 - x0 + 0.4, 0.5, 0.4, mat((x0 + x1) / 2, top + 0.25, z0), DARKSTONE),
        this.box(x1 - x0 + 0.4, 0.5, 0.4, mat((x0 + x1) / 2, top + 0.25, z1), DARKSTONE),
        this.box(0.4, 0.5, z1 - z0 + 0.4, mat(x0, top + 0.25, (z0 + z1) / 2), DARKSTONE),
        this.box(0.4, 0.5, z1 - z0 + 0.4, mat(x1, top + 0.25, (z0 + z1) / 2), DARKSTONE),
      ]) piece.keep = true;
      if (this.rng() < 0.6) {
        const tx = lerp(x0, x1, 0.3 + this.rng() * 0.4), tz = lerp(z0, z1, 0.3 + this.rng() * 0.4);
        this.cyl(1.2, 1.2, 2.4, 16, mat(tx, top + 2.4, tz), TIMBER).keep = true;
        this.add(new THREE.ConeGeometry(1.35, 0.8, 16), TIMBER, mat(tx, top + 4, tz)).keep = true;
        for (const [ox, oz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) this.box(0.12, 1.3, 0.12, mat(tx + ox, top + 0.6, tz + oz), METAL);
      }
      if (this.rng() < 0.5) this.rbox(1.6, 1, 1.2, 0.1, mat(lerp(x0, x1, this.rng()), top + 0.5, lerp(z0, z1, this.rng())), METAL);
    }
    this.addCollider({ type: 'box', x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, rot: 0 });
  }

  /** A big shed: ribbed metal or concrete, a roof of rusty sheets, sometimes a chimney. */
  warehouse(x0, z0, x1, z1, floors, color) {
    this.building(x0, z0, x1, z1, floors, color, this.rng() < 0.3 ? 0.4 : 0, false);
    const g = this.heightAt((x0 + x1) / 2, (z0 + z1) / 2);
    const top = g + floors * FLOOR;
    // sawtooth roof lights
    const n = Math.max(1, Math.floor((x1 - x0) / 6));
    for (let k = 0; k < n; k++) {
      const x = lerp(x0, x1, (k + 0.5) / n);
      this.box((x1 - x0) / n * 0.5, 1.6, z1 - z0 - 1, mat(x, top + 0.6, (z0 + z1) / 2, 0, 0, 0.5), RUST).keep = true;
    }
    if (this.rng() < 0.45) {
      // a tall brick chimney: you can see these from right across the city
      const cx = lerp(x0, x1, 0.2 + this.rng() * 0.6), cz = lerp(z0, z1, 0.2 + this.rng() * 0.6);
      const h = 22 + this.rng() * 18;
      this.cyl(0.9, 1.5, h, 16, mat(cx, top + h / 2 - 1, cz), BRICK).keep = true;
      this.cyl(1.05, 1.05, 0.8, 16, mat(cx, top + h - 1.2, cz), DARKSTONE).keep = true;
    }
  }

  buildBlock(plan) {
    const { cx, cz } = plan;
    const hb = BLOCK / 2;

    // kerb stones round the block
    for (const s of [-1, 1]) {
      this.box(BLOCK, 0.18, 0.3, mat(cx, this.heightAt(cx, cz + s * hb) + 0.05, cz + s * hb), STONE_DARK).keep = true;
      this.box(0.3, 0.18, BLOCK, mat(cx + s * hb, this.heightAt(cx + s * hb, cz) + 0.05, cz), STONE_DARK).keep = true;
    }

    if (plan.kind === 'plaza') return this.buildPlaza(cx, cz);
    if (plan.kind === 'sword') return this.buildSwordSite(cx, cz);
    if (plan.kind === 'park') return this.buildPark(cx, cz);

    for (const lot of plan.lots) {
      const { x0, z0, x1, z1 } = lot;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      if (lot.yard) {
        if (plan.kind === 'raider') this.buildRaiderCamp(mx, mz, (x1 - x0) / 2, (z1 - z0) / 2);
        else this.buildCivilianCamp(mx, mz);
        continue;
      }
      if (lot.rubble) { this.rubble(mx, mz, 14, Math.min(x1 - x0, z1 - z0), ASH, 1.4); continue; }
      if (lot.warehouse) this.warehouse(x0, z0, x1, z1, lot.floors, lot.style);
      else this.building(x0, z0, x1, z1, lot.floors, lot.style, lot.damage);
      if (lot.damage > 0.5) for (let k = 0; k < 3; k++) this.slab(lerp(x0, x1, this.rng()), lerp(z0, z1, this.rng()) + (this.rng() < 0.5 ? -1 : 1) * ((z1 - z0) / 2 + 2), this.rng() * 6);
    }
  }

  buildPlaza(cx, cz) {
    // a paved square with the old cathedral in the middle
    this.box(BLOCK - 1, 0.25, BLOCK - 1, mat(cx, this.heightAt(cx, cz) + 0.05, cz), STONE).keep = true;
    const hw = 8, z0 = cz - 15, z1 = cz + 9;
    this.wall(cx - hw, z0, cx - hw, z1, 12, 1.2, STONE, { broken: true, gaps: 0.15 });
    this.wall(cx + hw, z0, cx + hw, z1, 12, 1.2, STONE, { broken: true, gaps: 0.15 });
    this.wall(cx - hw, z0, cx - 2.6, z0, 15, 1.4, STONE, { broken: true });
    this.wall(cx + 2.6, z0, cx + hw, z0, 15, 1.4, STONE, { broken: true });
    for (const x of [-2.6, 2.6]) {
      this.cyl(0.65, 0.75, 7, 16, mat(cx + x, 3.5, z0), STONE_DARK).keep = true;
      this.addCollider({ type: 'circle', x: cx + x, z: z0, r: 0.8 });
    }
    this.add(new THREE.TorusGeometry(2.6, 0.5, 12, 32, Math.PI), STONE_DARK, mat(cx, 7, z0)).keep = true;
    // rose window ring above the door
    this.add(new THREE.TorusGeometry(2.4, 0.35, 12, 40), STONE_DARK, mat(cx, 11.5, z0 - 0.2)).keep = true;
    for (let k = 0; k < 8; k++) this.box(0.18, 4.6, 0.25, mat(cx, 11.5, z0 - 0.2, 0, 0, (k / 8) * Math.PI), STONE_DARK).keep = true;
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
    this.rbox(3, 2, 3, 0.15, mat(cx, 1, cz - 19), STONE_DARK, SURF.STONE).keep = true;
    this.addCollider({ type: 'box', x: cx, z: cz - 19, hw: 1.5, hd: 1.5, rot: 0 });
  }

  buildSwordSite() {
    const [x, z] = this.swordSite;
    const g = this.heightAt(x, z);
    const M = mat(x, g, z, 0.16, 0.7, 0.12);
    const piece = (geo, color, lx, ly, lz, surf) => { geo.translate(lx, ly, lz); this.add(geo, color, M, 0, surf).keep = true; };
    // the blade has a diamond cross-section, so it catches the light
    const blade = new THREE.CylinderGeometry(1.6, 1.8, 42, 4);
    blade.scale(1, 1, 0.3);
    piece(blade, 0x8c8a86, 0, 13, 0, SURF.METAL);
    piece(new RoundedBoxGeometry(16, 1.8, 1.8, 2, 0.4), 0x9c7f45, 0, 34.6, 0, SURF.METAL);
    piece(new THREE.CylinderGeometry(0.75, 0.75, 6.2, 16), 0x3a2c20, 0, 38.6, 0, SURF.WOOD);
    piece(new THREE.SphereGeometry(1.7, 20, 14), 0x9c7f45, 0, 42.6, 0, SURF.METAL);
    this.addCollider({ type: 'circle', x, z, r: 2.2 });
    this.rubble(x, z, 24, 26, ASH, 1.3);
    for (let k = 0; k < 6; k++) this.slab(x + (this.rng() - 0.5) * 30, z + (this.rng() - 0.5) * 30, this.rng() * 6, ASH);
  }

  buildPark(cx, cz) {
    for (let k = 0; k < 26; k++) this.tree(cx + (this.rng() - 0.5) * 36, cz + (this.rng() - 0.5) * 36);
    // a dry fountain
    const g = this.heightAt(cx, cz);
    this.add(new THREE.TorusGeometry(3.2, 0.35, 10, 36), STONE_DARK, mat(cx, g + 0.4, cz, Math.PI / 2)).keep = true;
    this.cyl(0.4, 0.6, 2.2, 12, mat(cx, g + 1.1, cz), STONE_DARK);
    this.cyl(1.2, 0.2, 0.5, 16, mat(cx, g + 2.3, cz), STONE_DARK);
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
    // a ring of junk barricades: sheet metal, tyres, spikes, a burnt car
    const r = Math.min(hx, hz) - 1.5;
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      if (k === 3 || k === 10) continue;    // ways in
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const g = this.heightAt(px, pz);
      const kind = k % 3;
      if (kind === 0) {
        this.box(0.08, 2.2, 2.8, mat(px, g + 1.0, pz, 0, -a, (this.rng() - 0.5) * 0.2), RUST).keep = true;
        this.addCollider({ type: 'box', x: px, z: pz, hw: 0.2, hd: 1.4, rot: -a });
      } else if (kind === 1) {
        for (let t = 0; t < 3; t++) this.add(new THREE.TorusGeometry(0.42, 0.17, 10, 20), ASH, mat(px, g + 0.18 + t * 0.33, pz, Math.PI / 2, 0, (this.rng() - 0.5) * 0.3));
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
      this.cyl(0.32, 0.3, 0.9, 14, mat(px, this.heightAt(px, pz) + 0.45, pz), RUST);
      this.cur.fires.push({ x: px, y: this.heightAt(px, pz) + 1.0, z: pz, size: 0.6 });
      this.addCollider({ type: 'circle', x: px, z: pz, r: 0.4 });
    }
    // a skull-on-a-pole warning sign
    const sx = x + r + 2, sz = z;
    this.cyl(0.05, 0.06, 2.6, 6, mat(sx, this.heightAt(sx, sz) + 1.3, sz), TIMBER);
    this.add(new THREE.SphereGeometry(0.17, 12, 10), 0xb8ae98, mat(sx, this.heightAt(sx, sz) + 2.7, sz));
  }

  buildCivilianCamp(x, z) {
    const g = this.heightAt(x, z);
    // tarps strung between poles, bedrolls, and a small fire
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const px = x + Math.cos(a) * 5, pz = z + Math.sin(a) * 5;
      const tarp = new THREE.PlaneGeometry(3.2, 2.6, 6, 4);
      const p = tarp.attributes.position;
      for (let v = 0; v < p.count; v++) p.setZ(v, Math.sin((p.getX(v) / 3.2 + 0.5) * Math.PI) * 0.35);
      tarp.computeVertexNormals();
      const colors = [TARP, 0x6e5640, 0x50555e, 0x6c665a];
      this.add(tarp, colors[k], mat(px, g + 1.3, pz, -0.9, -a + Math.PI / 2, 0), 0, SURF.CLOTH);
      this.add(tarp.clone(), colors[k], mat(px, g + 1.3, pz, -0.9 + Math.PI, -a + Math.PI / 2, 0), 0, SURF.CLOTH);
      this.box(0.07, 2.2, 0.07, mat(px + Math.cos(a) * 1.2, g + 1.1, pz + Math.sin(a) * 1.2), TIMBER);
      this.rbox(0.8, 0.18, 1.9, 0.08, mat(px - Math.cos(a) * 0.6, g + 0.09, pz - Math.sin(a) * 0.6, 0, -a), 0x5e4e40, SURF.CLOTH);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      this.add(new THREE.DodecahedronGeometry(0.18, 0), STONE_DARK, mat(x + Math.cos(a) * 0.7, g + 0.1, z + Math.sin(a) * 0.7));
    }
    this.cur.fires.push({ x, y: g + 0.25, z, size: 0.5 });
    this.rbox(0.6, 0.5, 0.6, 0.06, mat(x + 2.5, g + 0.25, z - 1.5, 0, 0.4), TIMBER, SURF.WOOD);
  }

  // ================================================================ street furniture
  car(x, z, ry, burnt = this.rng() < 0.7) {
    const g = this.heightAt(x, z);
    const cols = [0x5a2a22, 0x3d4a58, 0x6e6a5e, 0x34402f, 0x7a6b45, 0x8a8a86];
    const c = burnt ? 0x2b2522 : cols[Math.floor(this.rng() * cols.length)];
    const body = burnt ? SURF.RUST : SURF.PAINT;
    const tilt = burnt ? (this.rng() - 0.5) * 0.12 : 0;
    const M = mat(x, g, z, tilt, ry, tilt);
    const part = (geo, color, lx, ly, lz, surf) => { geo.translate(lx, ly, lz); return this.add(geo, color, M, 0, surf); };
    part(new RoundedBoxGeometry(1.9, 0.75, 4.3, 3, 0.22), c, 0, 0.72, 0, body).keep = true;
    part(new RoundedBoxGeometry(1.7, 0.62, 2.3, 3, 0.24), c, 0, 1.35, -0.2, body).keep = true;
    part(new THREE.BoxGeometry(1.72, 0.42, 0.06), 0x0c0c0d, 0, 1.38, 0.97, SURF.ASH);     // windscreen hole
    part(new THREE.BoxGeometry(1.72, 0.4, 0.06), 0x0c0c0d, 0, 1.36, -1.37, SURF.ASH);     // back window
    for (const [wx, wz] of [[-0.88, 1.35], [0.88, 1.35], [-0.88, -1.35], [0.88, -1.35]]) {
      if (burnt && this.rng() < 0.3) continue;
      const w = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 18);
      w.rotateZ(Math.PI / 2);
      part(w, 0x1a1a1a, wx, 0.36, wz, SURF.ASH);
    }
    this.addCollider({ type: 'box', x, z, hw: 0.95, hd: 2.15, rot: ry });
  }

  lamp(x, z, ry, bent) {
    const g = this.heightAt(x, z);
    const lean = bent ? 0.3 + this.rng() * 0.5 : 0;
    const M = mat(x, g, z, lean, ry, 0);
    const part = (geo, color, lx, ly, lz) => { geo.translate(lx, ly, lz); this.add(geo, color, M); };
    part(new THREE.CylinderGeometry(0.09, 0.13, 6, 10), METAL, 0, 3, 0);
    part(new THREE.TorusGeometry(0.7, 0.05, 6, 12, Math.PI / 2), METAL, 0.7, 6, 0);
    part(new THREE.CylinderGeometry(0.15, 0.3, 0.3, 12), METAL, 1.4, 6.55, 0);
  }

  pole(x, z) {
    const g = this.heightAt(x, z);
    this.cyl(0.13, 0.17, 9, 10, mat(x, g + 4.5, z), TIMBER).keep = true;
    this.box(2.4, 0.16, 0.16, mat(x, g + 8.3, z), TIMBER);
    return new THREE.Vector3(x, g + 8.3, z);
  }

  wire(a, b) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(new THREE.Vector3(lerp(a.x, b.x, t), lerp(a.y, b.y, t) - Math.sin(t * Math.PI) * 1.6, lerp(a.z, b.z, t)));
    }
    this.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.03, 4, false), 0x111111, null, 0, SURF.ASH);
  }

  /**
   * The near half of each of the four streets round a block: parked and
   * crashed cars, lamp posts on the pavement, rubbish, telegraph poles.
   */
  buildStreetsAround(plan) {
    const { cx, cz, i, j } = plan;
    const hb = BLOCK / 2;
    // side: which way is "out" from the block (+x, -x, +z, -z)
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ry = ox ? 0 : Math.PI / 2;                 // cars face along the street
      // P(along, out): along the side, and out from the kerb into the street
      const P = (along, out) => (ox ? [cx + ox * (hb + out), cz + along] : [cx + along, cz + oz * (hb + out)]);
      // parked and crashed cars
      for (let t = -hb; t < hb; t += 7 + this.rng() * 12) {
        if (this.rng() < 0.45) continue;
        const crashed = this.rng() < 0.3;
        const [x, z] = P(t, crashed ? 2 + this.rng() * 4 : 1.4);
        if (this.surface(x, z) !== 'street' || Math.hypot(x - this.spawn.x, z - this.spawn.z) < 8) continue;
        this.car(x, z, ry + (this.rng() < 0.5 ? Math.PI : 0) + (crashed ? (this.rng() - 0.5) * 1.6 : (this.rng() - 0.5) * 0.08));
      }
      // lamp posts on the pavement edge
      for (let t = -hb + 8; t < hb - 4; t += 18) {
        const [x, z] = P(t, -0.6);
        const face = ox ? (ox > 0 ? 0 : Math.PI) : (oz > 0 ? -Math.PI / 2 : Math.PI / 2);
        this.lamp(x, z, face, this.rng() < 0.3);
      }
      // rubbish in the road
      for (let k = 0; k < 4; k++) {
        const [x, z] = P((this.rng() - 0.5) * BLOCK, this.rng() * STREET * 0.5);
        this.rubble(x, z, 3, 2.5, this.rng() < 0.5 ? CONCRETE : BRICK);
      }
      // telegraph poles and sagging wires on the south side of every other row
      if (oz === -1 && j % 2 === 0) {
        let prev = null;
        for (let t = -hb + 4; t < hb; t += 20) {
          const [x, z] = P(t, -1.4);
          const top = this.pole(x, z);
          if (prev && this.rng() < 0.85) this.wire(prev, top);
          prev = top;
        }
      }
    }
    // the odd wreck or barricade in the crossroads at one corner
    if (i < NB && j < NB && this.rng() < 0.3) {
      const x = cx + PERIOD / 2 + (this.rng() - 0.5) * 6, z = cz + PERIOD / 2 + (this.rng() - 0.5) * 6;
      if (Math.hypot(x - this.spawn.x, z - this.spawn.z) > 10) this.car(x, z, this.rng() * 6, true);
    }
  }

  // a skyscraper that fell across the street
  buildFallenTower() {
    const x = 1.5 * PERIOD, z = -1 * PERIOD + 10;
    const ry = 0.55;
    const g = this.heightAt(x, z);
    this.box(12, 12, 64, mat(x, g + 4, z, 0.06, ry, 0.12), CONCRETE, 1.42).keep = true;
    this.rubble(x - 10, z - 20, 30, 18, CONCRETE, 1.3);
    this.rubble(x + 12, z + 24, 30, 16, CONCRETE, 1.3);
    for (const t of [-0.4, -0.2, 0, 0.2, 0.4]) {
      this.addCollider({ type: 'box', x: x + Math.sin(ry) * 64 * t, z: z + Math.cos(ry) * 64 * t, hw: 6, hd: 7, rot: ry });
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
      this.box(thick, total, seg + 0.03, mat(cx, base + total / 2, cz, 0, ry, 0), color).keep = true;
      this.addCollider({ type: 'box', x: cx, z: cz, hw: thick / 2, hd: seg / 2, rot: ry });
    }
  }
  column(x, z, h, r, color = STONE) {
    const g = this.heightAt(x, z) - 0.2;
    this.rbox(r * 2.6, 0.6, r * 2.6, 0.08, mat(x, g + 0.3, z), STONE_DARK, SURF.STONE).keep = true;
    this.cyl(r * 0.92, r, h, 16, mat(x, g + 0.6 + h / 2, z), color).keep = true;
    if (h > 7) this.rbox(r * 2.4, 0.5, r * 2.4, 0.08, mat(x, g + 0.6 + h + 0.25, z), STONE_DARK, SURF.STONE).keep = true;
    this.addCollider({ type: 'circle', x, z, r: r + 0.25 });
  }
  fallenColumn(x, z, len, r, ry, color = STONE) {
    const g = this.heightAt(x, z);
    this.cyl(r, r, len, 16, mat(x, g + r * 0.8, z, Math.PI / 2, ry, 0), color).keep = true;
    for (const t of [-0.35, 0, 0.35]) this.addCollider({ type: 'circle', x: x + Math.sin(ry) * len * t, z: z + Math.cos(ry) * len * t, r: r + 0.2 });
  }
  tree(x, z) {
    // dead trees: a bare trunk and a few crooked branches
    const g = this.heightAt(x, z);
    const h = 4 + this.rng() * 5, r = 0.2 + this.rng() * 0.18;
    this.cyl(r * 0.45, r, h, 9, mat(x, g + h / 2 - 0.3, z, (this.rng() - 0.5) * 0.1, 0, (this.rng() - 0.5) * 0.1), BARK).keep = true;
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

  /** Glue pieces into one mesh: thousands of shapes drawn in a single go. */
  merge(list) {
    if (!list.length) return null;
    let nv = 0, ni = 0;
    for (const p of list) { nv += p.geo.attributes.position.count; ni += p.geo.index.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
    const col = new Float32Array(nv * 3), win = new Float32Array(nv), surf = new Float32Array(nv);
    const idx = new Uint32Array(ni);
    const tint = new THREE.Color();
    let vo = 0, io = 0;
    for (const p of list) {
      const g = p.geo, n = g.attributes.position.count;
      pos.set(g.attributes.position.array, vo * 3);
      nor.set(g.attributes.normal.array, vo * 3);
      tint.set(p.color).multiplyScalar(0.9 + this.rng() * 0.2);
      for (let i = 0; i < n; i++) {
        col[(vo + i) * 3] = tint.r; col[(vo + i) * 3 + 1] = tint.g; col[(vo + i) * 3 + 2] = tint.b;
        win[vo + i] = p.win;
        surf[vo + i] = p.surf;
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
    geo.setAttribute('surf', new THREE.BufferAttribute(surf, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.mats.city());
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  // ================================================================ far away
  /**
   * One plain box per building for the whole city, drawn in a single go
   * (an "instanced" mesh). When a block is built in full detail, its boxes
   * are shrunk to nothing so they don't poke through.
   */
  buildFarCity() {
    const boxes = [];   // [x, y, z, w, h, d, colour, windows, surf, blockKey]
    for (const p of this.blocks.values()) {
      for (const lot of p.lots) {
        if (lot.yard || lot.rubble) continue;
        const h = lot.floors * FLOOR * (lot.damage > 0.5 ? 0.7 : lot.damage > 0 ? 0.9 : 1);
        const g = this.heightAt((lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2) - 0.4;
        boxes.push([(lot.x0 + lot.x1) / 2, g + h / 2, (lot.z0 + lot.z1) / 2, lot.x1 - lot.x0, h, lot.z1 - lot.z0, lot.style, lot.warehouse ? 0 : 1.5, SURF_OF[lot.style], p.key]);
      }
      if (p.kind === 'plaza') boxes.push([p.cx, 6, p.cz - 3, 16, 12, 24, STONE, 0, SURF.STONE, p.key]);
    }
    // landmarks you can see from anywhere: the giant sword, and the fallen tower
    const [sx, sz] = this.swordSite;
    boxes.push([sx, 21, sz, 2.4, 42, 1.2, 0x8c8a86, 0, SURF.METAL, SWORD]);
    boxes.push([sx, 34.6, sz, 16, 1.8, 1.8, 0x9c7f45, 0, SURF.METAL, SWORD]);
    boxes.push([1.5 * PERIOD, 4, -PERIOD + 10, 12, 12, 64, CONCRETE, 1.42, SURF.CONCRETE, TOWER_BLOCK, 0.55]);
    // ruins beyond the edge, so the city seems to go on for ever
    const rng = mulberry32(5);
    for (let k = 0; k < 120; k++) {
      const a = (k / 120) * Math.PI * 2 + rng() * 0.05;
      const d = HALF + 30 + rng() * 140;
      const h = 20 + rng() * 70, w = 10 + rng() * 22;
      boxes.push([Math.cos(a) * d, h / 2 + 20, Math.sin(a) * d, w, h, w, CONCRETE, 1 + rng() * 0.9, SURF.CONCRETE, null, rng() * 3]);
    }

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const winAttr = new THREE.InstancedBufferAttribute(new Float32Array(boxes.length), 1);
    const surfAttr = new THREE.InstancedBufferAttribute(new Float32Array(boxes.length), 1);
    geo.setAttribute('win', winAttr);
    geo.setAttribute('surf', surfAttr);
    const far =new THREE.InstancedMesh(geo, this.mats.farCity(), boxes.length);
    far.frustumCulled = false;
    this.farBoxes = boxes;
    this.farByBlock = new Map();
    const c = new THREE.Color();
    boxes.forEach((b, n) => {
      far.setMatrixAt(n, this.farMatrix(b));
      far.setColorAt(n, c.set(b[6]));
      winAttr.array[n] = b[7] ? 1 + ((n * 0.618) % 0.99) : 0;
      surfAttr.array[n] = b[8];
      if (b[9]) {
        if (!this.farByBlock.has(b[9])) this.farByBlock.set(b[9], []);
        this.farByBlock.get(b[9]).push(n);
      }
    });
    this.far = far;
    this.scene.add(far);
  }

  farMatrix(b) {
    const m = new THREE.Matrix4();
    _e.set(0, b[10] || 0, 0);
    _q.setFromEuler(_e);
    return m.compose(new THREE.Vector3(b[0], b[1], b[2]), _q, new THREE.Vector3(b[3], b[4], b[5]));
  }

  /** Hide (or show again) the stand-in boxes of a block. */
  hideFar(plan, hide) {
    const list = this.farByBlock.get(plan.key);
    if (!list) return;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const n of list) this.far.setMatrixAt(n, hide ? zero : this.farMatrix(this.farBoxes[n]));
    this.far.instanceMatrix.needsUpdate = true;
  }

  buildSky() {
    this.skyMat = this.mats.makeSky(new THREE.Vector3(0.25, 0.5, 1));
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), this.skyMat);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  update(camera) {
    this.sky.position.copy(camera.position);
    this.stream(camera.position.x, camera.position.z);
    // don't bother drawing ground that's lost in the dust
    for (const t of this.terrain) {
      const s = t.geometry.boundingSphere;
      t.visible = Math.hypot(s.center.x - camera.position.x, s.center.z - camera.position.z) < 700;
    }
  }
}
