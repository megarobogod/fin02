// =====================================================
// fx.js - everything that makes a hit feel like a HIT
//
//  - particles: ink blots, gold ichor, feathers, shards and sparks
//  - decals: stains left on the ground (they stay, up to a limit)
//  - bursts: a spiky ink star where the blade lands
//  - words: comic-book sound words like CRACK! and CLANG
//  - trail: the brush stroke the sword leaves behind
//  - debris: wings and halos that fall off and tumble
//  - screen: camera shake ("trauma"), impact frames, speed lines
// =====================================================
import * as THREE from 'three';
import { INK_HEX, PAPER_HEX, GOLD_HEX } from './sketch.js';

const MAX_PARTICLES = 1200;
const MAX_DECALS = 320;
const MAX_TRAIL = 16;

export const ICHOR = new THREE.Color(GOLD_HEX);
export const INK = new THREE.Color(INK_HEX);
export const BLOOD = new THREE.Color(0x7a1d14);
export const WHITE = new THREE.Color(0xfbf7ec);
export const DUST = new THREE.Color(0xb3a993);

// ---------- textures drawn with the 2D canvas ----------
function blotPath(g, cx, cy, r, seed) {
  g.beginPath();
  const n = 20;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.72 + 0.22 * Math.sin(a * 3 + seed) + 0.12 * Math.sin(a * 7 + seed * 2));
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.fill();
  for (let i = 0; i < 7; i++) {
    const a = seed * 3 + i * 0.9, d = r * (1.05 + ((i * 37) % 10) / 22);
    g.beginPath();
    g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.06 + ((i * 13) % 7) / 60), 0, Math.PI * 2);
    g.fill();
  }
}

function makeAtlas() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  // 0: ink blot
  blotPath(g, 64, 64, 34, 1.3);
  // 1: feather
  g.save(); g.translate(192, 64); g.rotate(0.5);
  g.lineWidth = 3; g.beginPath(); g.moveTo(0, -52); g.lineTo(0, 52); g.stroke();
  g.beginPath(); g.moveTo(0, -50);
  g.quadraticCurveTo(26, -10, 4, 46); g.lineTo(0, 46); g.quadraticCurveTo(-24, -6, 0, -50); g.fill();
  g.restore();
  // 2: shard
  g.beginPath(); g.moveTo(64, 140); g.lineTo(98, 200); g.lineTo(70, 190); g.lineTo(58, 244); g.lineTo(34, 182); g.closePath(); g.fill();
  // 3: spark star
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, r = i % 2 ? 9 : 58;
    g.lineTo(192 + Math.cos(a) * r, 192 + Math.sin(a) * r);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  return t;
}

function makeBlotTexture(seed) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  blotPath(g, 64, 64, 36, seed);
  return new THREE.CanvasTexture(c);
}

function makeCrackTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  for (let i = 0; i < 11; i++) {
    let a = (i / 11) * Math.PI * 2 + Math.random() * 0.3;
    let x = 128, y = 128;
    g.lineWidth = 7;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      a += (Math.random() - 0.5) * 0.7;
      x += Math.cos(a) * 18; y += Math.sin(a) * 18;
      g.lineWidth = Math.max(1.5, 7 - s);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

function makeBurstTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.beginPath();
  const n = 14;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 ? 40 + Math.random() * 14 : 92 + Math.random() * 30;
    g.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = '#fff';
  g.fill();
  g.lineWidth = 9;
  g.lineJoin = 'round';
  g.strokeStyle = '#1d1913';
  g.stroke();
  return new THREE.CanvasTexture(c);
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,236,170,1)');
  grad.addColorStop(0.35, 'rgba(240,180,60,0.55)');
  grad.addColorStop(1, 'rgba(240,180,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function makeBeamTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,230,150,0.55)';
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = i % 3 ? 'rgba(240,180,60,0.9)' : 'rgba(29,25,19,0.5)';
    g.lineWidth = 1 + Math.random() * 3;
    const x = Math.random() * 128;
    g.beginPath(); g.moveTo(x, Math.random() * 60); g.lineTo(x + (Math.random() - 0.5) * 6, 256 - Math.random() * 60); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------- particle shader ----------
const PART_VERT = /* glsl */`
attribute float size;
attribute float frame;
attribute float rot;
attribute float alpha;
attribute vec3 pcolor;
uniform float uScale;
varying vec3 vColor;
varying float vFrame;
varying float vRot;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uScale / max(0.1, -mv.z);
  vColor = pcolor; vFrame = frame; vRot = rot; vAlpha = alpha;
}`;
const PART_FRAG = /* glsl */`
uniform sampler2D uAtlas;
varying vec3 vColor;
varying float vFrame;
varying float vRot;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) discard;
  p.y = 1.0 - p.y;
  float col = mod(vFrame, 2.0), row = floor(vFrame / 2.0);
  vec2 uv = (p + vec2(col, 1.0 - row)) * 0.5;
  float a = texture2D(uAtlas, uv).a * vAlpha;
  if (a < 0.06) discard;
  gl_FragColor = vec4(vColor, a);
}`;

export class FX {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.trauma = 0;
    this.invertTime = 0;
    this.speedLines = 0;
    this.hurtFlash = 0;
    this.words = new Map();

    this.atlas = makeAtlas();
    this.glowTex = makeGlowTexture();
    this.beamTex = makeBeamTexture();
    this.burstTex = makeBurstTexture();
    this.blotTex = makeBlotTexture(2.1);
    this.crackTex = makeCrackTexture();

    this.buildParticles();
    this.buildDecals();
    this.buildBursts();
    this.buildTrail();
    this.debris = [];
    this.rings = [];
    this.beams = [];

    this.canvas = document.getElementById('fx2d');
    this.ctx = this.canvas.getContext('2d');
  }

  // ======================================================= particles
  buildParticles() {
    const N = MAX_PARTICLES;
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(N * 3);
    this.pCol = new Float32Array(N * 3);
    this.pSize = new Float32Array(N);
    this.pFrame = new Float32Array(N);
    this.pRot = new Float32Array(N);
    this.pAlpha = new Float32Array(N);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('frame', new THREE.BufferAttribute(this.pFrame, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('rot', new THREE.BufferAttribute(this.pRot, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.pMat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: this.atlas }, uScale: { value: 400 } },
      vertexShader: PART_VERT, fragmentShader: PART_FRAG,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.pMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.scene.add(this.points);
    this.parts = [];          // live particles (objects with their own state)
  }

  /**
   * One particle. frame: 0 blot, 1 feather, 2 shard, 3 star.
   * decal: if set, it leaves a stain of that colour where it lands.
   */
  particle(o) {
    if (this.parts.length >= MAX_PARTICLES) this.parts.shift();
    this.parts.push({
      x: o.x, y: o.y, z: o.z,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      size: o.size || 0.2, frame: o.frame || 0, color: o.color || INK,
      rot: Math.random() * 6.28, spin: o.spin ?? (Math.random() - 0.5) * 8,
      life: 0, max: o.life || 1, grav: o.grav ?? 14, drag: o.drag ?? 0.5,
      flutter: o.flutter || 0, decal: o.decal || null, decalSize: o.decalSize || 0.6,
      grow: o.grow || 0,
    });
  }

  updateParticles(dt) {
    const world = this.game.world;
    let n = 0;
    const alive = [];
    for (const p of this.parts) {
      p.life += dt;
      if (p.life >= p.max) continue;
      p.vy -= p.grav * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d; p.vz *= d;
      if (p.flutter) { p.vx += Math.sin(p.life * 7 + p.rot) * p.flutter * dt; p.vz += Math.cos(p.life * 5 + p.rot) * p.flutter * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;
      p.size += p.grow * dt;
      const g = world.heightAt(p.x, p.z);
      if (p.y < g + 0.05) {
        if (p.decal) { this.decal(p.x, p.z, p.decalSize * (0.6 + Math.random() * 0.8), p.decal); p.decal = null; }
        if (p.grav > 2) { p.y = g + 0.05; p.vy *= -0.2; p.vx *= 0.4; p.vz *= 0.4; p.spin *= 0.5; }
      }
      alive.push(p);
      const fade = Math.min(1, (p.max - p.life) / Math.min(0.35, p.max * 0.5));
      this.pPos[n * 3] = p.x; this.pPos[n * 3 + 1] = p.y; this.pPos[n * 3 + 2] = p.z;
      this.pCol[n * 3] = p.color.r; this.pCol[n * 3 + 1] = p.color.g; this.pCol[n * 3 + 2] = p.color.b;
      this.pSize[n] = p.size; this.pFrame[n] = p.frame; this.pRot[n] = p.rot; this.pAlpha[n] = fade;
      n++;
    }
    this.parts = alive;
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    for (const k of ['position', 'pcolor', 'size', 'frame', 'rot', 'alpha']) geo.attributes[k].needsUpdate = true;
  }

  // ---------- particle recipes ----------
  /** Gold blood of the angels, spraying along dir. */
  ichor(point, dir, count = 12, power = 1) {
    for (let i = 0; i < count; i++) {
      const s = (3 + Math.random() * 6) * power;
      this.particle({
        x: point.x, y: point.y, z: point.z,
        vx: dir.x * s + (Math.random() - 0.5) * 4, vy: 1.5 + Math.random() * 5 * power, vz: dir.z * s + (Math.random() - 0.5) * 4,
        size: 0.12 + Math.random() * 0.22, frame: 0, color: Math.random() < 0.75 ? ICHOR : INK,
        life: 1.2 + Math.random(), decal: Math.random() < 0.5 ? ICHOR : null, decalSize: 0.5,
      });
    }
  }

  /** Dark red ink: the knight bleeds. */
  blood(point, dir, count = 10) {
    for (let i = 0; i < count; i++) {
      const s = 2 + Math.random() * 4;
      this.particle({
        x: point.x, y: point.y, z: point.z,
        vx: dir.x * s + (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 4, vz: dir.z * s + (Math.random() - 0.5) * 3,
        size: 0.1 + Math.random() * 0.18, frame: 0, color: Math.random() < 0.7 ? BLOOD : INK,
        life: 1 + Math.random(), decal: Math.random() < 0.6 ? BLOOD : null, decalSize: 0.45,
      });
    }
  }

  shards(point, count = 10, color = WHITE, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = (3 + Math.random() * 7) * power;
      this.particle({
        x: point.x, y: point.y, z: point.z,
        vx: Math.cos(a) * s, vy: 2 + Math.random() * 6 * power, vz: Math.sin(a) * s,
        size: 0.14 + Math.random() * 0.2, frame: 2, color, life: 1 + Math.random() * 0.8, spin: (Math.random() - 0.5) * 20,
      });
    }
  }

  feathers(point, count = 8, spread = 1) {
    for (let i = 0; i < count; i++) {
      this.particle({
        x: point.x + (Math.random() - 0.5) * spread, y: point.y + (Math.random() - 0.5) * spread, z: point.z + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 3,
        size: 0.25 + Math.random() * 0.25, frame: 1, color: WHITE, life: 3 + Math.random() * 2,
        grav: 1.2, drag: 1.6, flutter: 6, spin: (Math.random() - 0.5) * 3,
      });
    }
  }

  sparks(point, count = 10, color = INK) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * 1.5, s = 5 + Math.random() * 9;
      this.particle({
        x: point.x, y: point.y, z: point.z,
        vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s + 2, vz: Math.sin(a) * Math.cos(e) * s,
        size: 0.08 + Math.random() * 0.1, frame: 3, color, life: 0.25 + Math.random() * 0.25, grav: 10, drag: 3,
      });
    }
  }

  dust(point, count = 8, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = (1.5 + Math.random() * 3) * power;
      this.particle({
        x: point.x, y: point.y + 0.2, z: point.z,
        vx: Math.cos(a) * s, vy: 0.5 + Math.random() * 1.5, vz: Math.sin(a) * s,
        size: 0.5 + Math.random() * 0.5, frame: 0, color: DUST, life: 0.6 + Math.random() * 0.6,
        grav: -0.5, drag: 2.5, grow: 1.2, spin: (Math.random() - 0.5),
      });
    }
  }

  // ======================================================= decals
  buildDecals() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: this.blotTex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.decals = new THREE.InstancedMesh(geo, mat, MAX_DECALS);
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 1;
    this.decals.setColorAt(0, INK);
    this.scene.add(this.decals);
    this.decalNext = 0;

    const cmat = mat.clone();
    cmat.map = this.crackTex;
    cmat.color = INK.clone();
    this.cracks = new THREE.InstancedMesh(geo, cmat, 24);
    this.cracks.count = 0;
    this.cracks.frustumCulled = false;
    this.cracks.renderOrder = 1;
    this.scene.add(this.cracks);
    this.crackNext = 0;
  }

  _decalMatrix(x, z, size) {
    const w = this.game.world;
    const n = w.normalAt(x, z, new THREE.Vector3());
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28));
    return new THREE.Matrix4().compose(new THREE.Vector3(x, w.heightAt(x, z) + 0.04, z), q, new THREE.Vector3(size, 1, size));
  }

  decal(x, z, size, color) {
    const i = this.decalNext;
    this.decals.setMatrixAt(i, this._decalMatrix(x, z, size));
    this.decals.setColorAt(i, color);
    this.decalNext = (i + 1) % MAX_DECALS;
    this.decals.count = Math.max(this.decals.count, i + 1);
    this.decals.instanceMatrix.needsUpdate = true;
    this.decals.instanceColor.needsUpdate = true;
  }

  crack(x, z, size) {
    const i = this.crackNext;
    this.cracks.setMatrixAt(i, this._decalMatrix(x, z, size));
    this.crackNext = (i + 1) % 24;
    this.cracks.count = Math.max(this.cracks.count, i + 1);
    this.cracks.instanceMatrix.needsUpdate = true;
  }

  // ======================================================= bursts & words
  buildBursts() {
    this.bursts = [];
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.burstTex, transparent: true, depthTest: false, depthWrite: false }));
      s.visible = false;
      s.renderOrder = 20;
      this.scene.add(s);
      this.bursts.push({ s, t: 1, dur: 0.2, size: 1 });
    }
    this.burstNext = 0;
    this.wordPool = [];
  }

  /** The spiky ink star you see where a blow lands. */
  burst(point, size = 1, color = WHITE) {
    const b = this.bursts[this.burstNext];
    this.burstNext = (this.burstNext + 1) % this.bursts.length;
    b.s.position.copy(point);
    b.s.material.color.copy(color);
    b.s.material.rotation = Math.random() * 6.28;
    b.s.visible = true;
    b.t = 0; b.size = size; b.dur = 0.16 + size * 0.04;
  }

  wordTexture(text, fill) {
    const key = text + fill;
    if (this.words.has(key)) return this.words.get(key);
    const c = document.createElement('canvas');
    c.width = 512; c.height = 192;
    const g = c.getContext('2d');
    g.font = '400 118px "Permanent Marker", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 20;
    g.strokeStyle = '#1d1913';
    g.strokeText(text, 256, 100);
    g.fillStyle = fill;
    g.fillText(text, 256, 100);
    const t = new THREE.CanvasTexture(c);
    this.words.set(key, t);
    return t;
  }

  /** A comic sound word that pops out of the hit. */
  word(text, point, fill = '#fbf7ec', size = 1) {
    let w = this.wordPool.find((x) => x.t >= x.dur);
    if (!w) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
      s.renderOrder = 21;
      this.scene.add(s);
      w = { s, t: 1, dur: 1 };
      this.wordPool.push(w);
    }
    w.s.material.map = this.wordTexture(text, fill);
    w.s.material.needsUpdate = true;
    w.s.material.rotation = (Math.random() - 0.5) * 0.4;
    w.s.position.copy(point);
    w.s.position.y += 0.4;
    w.s.visible = true;
    w.t = 0; w.dur = 0.75; w.size = size;
    w.vx = (Math.random() - 0.5) * 0.8;
  }

  /** A sprite you can stick on something (e.g. a warning "!" over an angel). */
  sign(text, fill, size = 0.9) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.wordTexture(text, fill), transparent: true, depthTest: false, depthWrite: false }));
    s.scale.set(size * 2.67, size, 1);
    s.renderOrder = 19;
    return s;
  }

  glowSprite(size = 0.8) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, transparent: true, depthWrite: false }));
    s.scale.set(size, size, 1);
    return s;
  }

  updateSprites(realDt) {
    for (const b of this.bursts) {
      if (!b.s.visible) continue;
      b.t += realDt;
      const k = b.t / b.dur;
      if (k >= 1) { b.s.visible = false; continue; }
      const sc = b.size * (k < 0.25 ? 0.4 + (k / 0.25) * 0.8 : 1.2 - (k - 0.25) * 0.5);
      b.s.scale.set(sc, sc, 1);
      b.s.material.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    }
    for (const w of this.wordPool) {
      if (!w.s.visible) continue;
      w.t += realDt;
      const k = w.t / w.dur;
      if (k >= 1) { w.s.visible = false; continue; }
      const pop = k < 0.12 ? 0.5 + (k / 0.12) * 0.75 : 1.25 - Math.min(0.25, (k - 0.12) * 1.5);
      const sc = w.size * pop;
      w.s.scale.set(sc * 2.67, sc, 1);
      w.s.position.y += realDt * 0.9;
      w.s.position.x += w.vx * realDt;
      w.s.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    }
  }

  // ======================================================= sword trail
  buildTrail() {
    const geo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(MAX_TRAIL * 2 * 3);
    this.trailCol = new Float32Array(MAX_TRAIL * 2 * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < MAX_TRAIL - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.trail = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 6;
    this.scene.add(this.trail);
    this.trailPts = [];
    this.trailColor = INK;
  }

  /** Called every frame the sword is swinging. */
  trailPush(base, tip, color = INK) {
    this.trailColor = color;
    this.trailPts.unshift({ b: base.clone(), t: tip.clone(), age: 0 });
    if (this.trailPts.length > MAX_TRAIL) this.trailPts.pop();
  }

  updateTrail(dt) {
    for (const p of this.trailPts) p.age += dt;
    this.trailPts = this.trailPts.filter((p) => p.age < 0.14);
    const n = this.trailPts.length;
    const c = this.trailColor;
    for (let i = 0; i < MAX_TRAIL; i++) {
      const p = this.trailPts[Math.min(i, n - 1)];
      if (!p) break;
      const k = n > 1 ? 1 - i / (n - 1) : 0;
      const a = i < n ? Math.max(0, 1 - p.age / 0.14) * k : 0;
      // the brush stroke covers the outer 70% of the blade
      const bx = p.b.x + (p.t.x - p.b.x) * 0.3, by = p.b.y + (p.t.y - p.b.y) * 0.3, bz = p.b.z + (p.t.z - p.b.z) * 0.3;
      this.trailPos.set([bx, by, bz, p.t.x, p.t.y, p.t.z], i * 6);
      this.trailCol.set([c.r, c.g, c.b, a * 0.25, c.r, c.g, c.b, a * 0.95], i * 8);
    }
    const geo = this.trail.geometry;
    geo.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  // ======================================================= debris
  /** Make a piece of something fall off and tumble around. */
  addDebris(obj, vel, spin, r = 0.3) {
    this.scene.attach(obj);
    this.debris.push({ obj, vel: vel.clone(), spin: spin.clone(), r, life: 0 });
  }

  updateDebris(dt) {
    const w = this.game.world;
    this.debris = this.debris.filter((d) => {
      d.life += dt;
      const o = d.obj;
      if (d.life > 9) {
        o.position.y -= dt * 0.4;
        if (d.life > 12) { this.scene.remove(o); return false; }
        return true;
      }
      d.vel.y -= 14 * dt;
      o.position.addScaledVector(d.vel, dt);
      o.rotation.x += d.spin.x * dt; o.rotation.y += d.spin.y * dt; o.rotation.z += d.spin.z * dt;
      const g = w.heightAt(o.position.x, o.position.z) + d.r;
      if (o.position.y < g) {
        o.position.y = g;
        if (d.vel.y < -2) this.dust(o.position, 2, 0.5);
        d.vel.y = Math.abs(d.vel.y) * 0.3;
        d.vel.x *= 0.6; d.vel.z *= 0.6;
        d.spin.multiplyScalar(0.6);
      }
      return true;
    });
  }

  // ======================================================= rings & beams
  /** An expanding ring on the ground (shockwaves). */
  ring(x, z, opts = {}) {
    const geo = new THREE.RingGeometry(0.86, 1, 56);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: opts.color ?? GOLD_HEX, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide,
    }));
    mesh.renderOrder = 4;
    mesh.position.set(x, this.game.world.heightAt(x, z) + (opts.lift ?? 0.25), z);
    this.scene.add(mesh);
    const r = { mesh, r: opts.start ?? 0.5, speed: opts.speed ?? 14, max: opts.max ?? 16, done: false };
    mesh.scale.setScalar(r.r);
    this.rings.push(r);
    return r;
  }

  updateRings(dt) {
    this.rings = this.rings.filter((r) => {
      r.r += r.speed * dt;
      r.mesh.scale.setScalar(r.r);
      r.mesh.material.opacity = 0.9 * (1 - r.r / r.max);
      if (r.r >= r.max) { this.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); r.done = true; return false; }
      return true;
    });
  }

  /** The pillar of light a host comes down in. */
  beam(x, z, dur = 3.6) {
    const g = this.game.world.heightAt(x, z);
    const mat = new THREE.MeshBasicMaterial({ map: this.beamTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 160, 18, 1, true), mat);
    mesh.position.set(x, g + 80, z);
    mesh.renderOrder = 3;
    this.scene.add(mesh);
    this.beams.push({ mesh, t: 0, dur });
    this.decal(x, z, 7, ICHOR);
  }

  updateBeams(dt) {
    this.beams = this.beams.filter((b) => {
      b.t += dt;
      const k = b.t / b.dur;
      b.mesh.material.opacity = Math.min(1, b.t * 3) * (k > 0.7 ? (1 - k) / 0.3 : 1) * 0.85;
      b.mesh.material.map.offset.y -= dt * 0.8;
      const s = 1 + Math.sin(b.t * 20) * 0.04;
      b.mesh.scale.set(s, 1, s);
      if (k >= 1) { this.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); return false; }
      return true;
    });
  }

  // ======================================================= screen effects
  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  /** A two-frame flash where the colours flip: the classic manga impact frame. */
  impactFrame(time = 0.06, lines = 0.3, mode = 2) {
    this.invertTime = Math.max(this.invertTime, time);
    this.impactMode = mode;
    this.speedLines = Math.max(this.speedLines, lines);
  }

  hurt() { this.hurtFlash = 1; }

  resize(w, h, camera) {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.pMat.uniforms.uScale.value = (h * this.game.renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }

  draw2d(realDt) {
    const c = this.canvas, g = this.ctx;
    const w = c.width, h = c.height;
    g.clearRect(0, 0, w, h);
    this.game.hud.draw2d(g, w, h);

    // speed lines and impact frames are drawn by post.js
    const post = this.game.post;
    if (this.speedLines > 0) this.speedLines -= realDt;
    if (this.invertTime > 0) this.invertTime -= realDt;
    if (!this.game.cinematic?.active) {
      post.speed = this.speedLines > 0 ? Math.min(1, this.speedLines * 5) : 0;
      post.impact = this.invertTime > 0 ? this.impactMode : 0;
    }

    // ink creeping in from the edges when badly hurt
    const k = this.game.knight;
    const low = k ? 1 - k.hp / k.maxHp : 0;
    const edge = Math.max(this.hurtFlash, low > 0.6 ? (low - 0.6) * 2 * (0.75 + 0.25 * Math.sin(performance.now() / 180)) : 0);
    if (edge > 0.01) {
      const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.55);
      grad.addColorStop(0, 'rgba(122,29,20,0)');
      grad.addColorStop(1, `rgba(90,20,14,${0.75 * edge})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - realDt * 2.5);
  }

  update(dt, realDt) {
    this.updateParticles(dt);
    this.updateDebris(dt);
    this.updateRings(dt);
    this.updateBeams(dt);
    this.updateTrail(realDt);
    this.updateSprites(realDt);
    this.trauma = Math.max(0, this.trauma - realDt * 1.6);
  }

  reset() {
    this.parts = [];
    for (const d of this.debris) this.scene.remove(d.obj);
    this.debris = [];
    this.decals.count = 0;
    this.decalNext = 0;
    this.cracks.count = 0;
    this.trailPts = [];
  }
}
