// =====================================================
// fx.js - everything that makes a hit feel like a HIT
//
//  - particles: blood, glowing angel ichor, feathers, stone chips, sparks, dust
//    (glowing ones are drawn "additively": they add light, like real sparks)
//  - decals: stains left on the ground (they stay, up to a limit)
//  - bursts: a bright flash of light where the blade lands
//  - words: short call-outs like PARRY! and GUARD BROKEN (no comic sound words)
//  - trail: the faint streak the sword leaves behind
//  - debris: wings and halos that fall off and tumble
//  - screen: camera shake ("trauma"), impact frames, speed lines
// =====================================================
import * as THREE from 'three';
import { GOLD_HEX, INK_HEX } from './materials.js';

const MAX_PARTICLES = 1400;
const MAX_DECALS = 320;
const MAX_TRAIL = 16;

// Colours are in linear light. Anything brighter than 1 glows (and blooms).
export const ICHOR = new THREE.Color(GOLD_HEX).multiplyScalar(3);
export const INK = new THREE.Color(INK_HEX);
export const BLOOD = new THREE.Color(0x4a0806);
export const WHITE = new THREE.Color(0xc9c3b6);
export const DUST = new THREE.Color(0x6e6556);
const SPARK = new THREE.Color(0xffb060).multiplyScalar(5);

// Sound-effect words from the old comic look. We don't show these any more;
// the sounds and the hit effects do that job now.
const SOUND_WORDS = new Set(['CLANG', 'SNAP!', 'POP!', 'CRACK!', 'SHATTER!', 'THOOM', 'THWACK!', 'CRUNCH!']);

// ---------- textures drawn with the 2D canvas ----------
/** A splat: a lumpy blob with droplets round it, soft at the edges. */
function splatPath(g, cx, cy, r, seed) {
  g.beginPath();
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.72 + 0.2 * Math.sin(a * 3 + seed) + 0.1 * Math.sin(a * 7 + seed * 2) + 0.05 * Math.sin(a * 13 + seed));
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.fill();
  for (let i = 0; i < 9; i++) {
    const a = seed * 3 + i * 0.7, d = r * (1.05 + ((i * 37) % 10) / 18);
    g.beginPath();
    g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.04 + ((i * 13) % 7) / 70), 0, Math.PI * 2);
    g.fill();
  }
}

function softDisc(g, cx, cy, r, inner = 0) {
  const grad = g.createRadialGradient(cx, cy, r * inner, cx, cy, r);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
}

function makeAtlas() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  // 0: soft round puff (droplets, dust, smoke, embers)
  softDisc(g, 64, 64, 60, 0.15);
  // 1: feather
  g.save(); g.translate(192, 64); g.rotate(0.5);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath(); g.moveTo(0, -54);
  g.quadraticCurveTo(24, -12, 5, 50); g.lineTo(-1, 50); g.quadraticCurveTo(-22, -6, 0, -54); g.fill();
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -50); g.lineTo(2, 56); g.stroke();
  g.restore();
  // 2: a sharp chip of stone or porcelain
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(64, 140); g.lineTo(98, 196); g.lineTo(72, 190); g.lineTo(58, 240); g.lineTo(36, 184); g.closePath(); g.fill();
  // 3: a spark: a bright streak with a hot centre
  g.save(); g.translate(192, 192);
  const grad = g.createLinearGradient(-60, 0, 60, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath(); g.ellipse(0, 0, 60, 7, 0, 0, Math.PI * 2); g.fill();
  softDisc(g, 0, 0, 16, 0.2);
  g.restore();
  return new THREE.CanvasTexture(c);
}

function makeSplatTexture(seed) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.filter = 'blur(1.2px)';
  g.fillStyle = '#fff';
  splatPath(g, 64, 64, 34, seed);
  return new THREE.CanvasTexture(c);
}

function makeSoftTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  softDisc(c.getContext('2d'), 64, 64, 64, 0.1);
  return new THREE.CanvasTexture(c);
}

function makeCrackTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  // a dark scorched patch with cracks running out of it
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 80);
  grad.addColorStop(0, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  for (let i = 0; i < 13; i++) {
    let a = (i / 13) * Math.PI * 2 + Math.random() * 0.3;
    let x = 128, y = 128;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 7; s++) {
      a += (Math.random() - 0.5) * 0.8;
      x += Math.cos(a) * 16; y += Math.sin(a) * 16;
      g.lineWidth = Math.max(1, 5 - s * 0.7);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

function makeBurstTexture() {
  // a flash of light: a bright core and thin rays
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  softDisc(g, 128, 128, 90, 0.05);
  g.translate(128, 128);
  for (let i = 0; i < 10; i++) {
    g.rotate(Math.PI / 5 + Math.random() * 0.2);
    const grad = g.createLinearGradient(0, 0, 124, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(0, -3); g.lineTo(124, 0); g.lineTo(0, 3); g.fill();
  }
  return new THREE.CanvasTexture(c);
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,236,190,1)');
  grad.addColorStop(0.3, 'rgba(255,190,90,0.45)');
  grad.addColorStop(1, 'rgba(255,170,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function makeBeamTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, 'rgba(255,220,150,0)');
  grad.addColorStop(0.5, 'rgba(255,235,190,0.8)');
  grad.addColorStop(1, 'rgba(255,220,150,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 30; i++) {
    g.strokeStyle = `rgba(255,${200 + Math.random() * 55},${120 + Math.random() * 80},${0.2 + Math.random() * 0.5})`;
    g.lineWidth = 1 + Math.random() * 3;
    const x = Math.random() * 128;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (Math.random() - 0.5) * 4, 256); g.stroke();
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
varying float vFog;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uScale / max(0.1, -mv.z);
  vColor = pcolor; vFrame = frame; vRot = rot; vAlpha = alpha;
  vFog = exp(-pow(-mv.z * 0.0042, 2.0));
}`;
const PART_FRAG = /* glsl */`
uniform sampler2D uAtlas;
uniform float uGlow;
varying vec3 vColor;
varying float vFrame;
varying float vRot;
varying float vAlpha;
varying float vFog;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) discard;
  p.y = 1.0 - p.y;
  float col = mod(vFrame, 2.0), row = floor(vFrame / 2.0);
  vec2 uv = (p + vec2(col, 1.0 - row)) * 0.5;
  float a = texture2D(uAtlas, uv).a * vAlpha * vFog;
  if (a < 0.02) discard;
  // glowing particles add light; the rest are just coloured
  gl_FragColor = uGlow > 0.5 ? vec4(vColor * a, 1.0) : vec4(vColor, a);
}`;

/** One batch of particles drawn in a single go. */
class ParticleSet {
  constructor(scene, atlas, glow) {
    const N = MAX_PARTICLES;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.size = new Float32Array(N);
    this.frame = new Float32Array(N);
    this.rot = new Float32Array(N);
    this.alpha = new Float32Array(N);
    const dyn = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', dyn(this.pos, 3));
    geo.setAttribute('pcolor', dyn(this.col, 3));
    geo.setAttribute('size', dyn(this.size, 1));
    geo.setAttribute('frame', dyn(this.frame, 1));
    geo.setAttribute('rot', dyn(this.rot, 1));
    geo.setAttribute('alpha', dyn(this.alpha, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: atlas }, uScale: { value: 400 }, uGlow: { value: glow ? 1 : 0 } },
      vertexShader: PART_VERT, fragmentShader: PART_FRAG,
      transparent: true, depthWrite: false,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = glow ? 6 : 5;
    scene.add(this.points);
    this.n = 0;
  }
  begin() { this.n = 0; }
  push(p, fade) {
    const n = this.n++;
    this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y; this.pos[n * 3 + 2] = p.z;
    this.col[n * 3] = p.color.r; this.col[n * 3 + 1] = p.color.g; this.col[n * 3 + 2] = p.color.b;
    this.size[n] = p.size; this.frame[n] = p.frame; this.rot[n] = p.rot; this.alpha[n] = fade;
  }
  end() {
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.n);
    for (const k of ['position', 'pcolor', 'size', 'frame', 'rot', 'alpha']) geo.attributes[k].needsUpdate = true;
  }
}

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
    this.blotTex = makeSplatTexture(2.1);
    this.softTex = makeSoftTexture();
    this.crackTex = makeCrackTexture();

    this.soft = new ParticleSet(this.scene, this.atlas, false);
    this.bright = new ParticleSet(this.scene, this.atlas, true);
    this.parts = [];
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
  /**
   * One particle. frame: 0 puff, 1 feather, 2 chip, 3 spark.
   * decal: if set, it leaves a stain of that colour where it lands.
   * Sparks and anything brighter than white glow.
   */
  particle(o) {
    if (this.parts.length >= MAX_PARTICLES) this.parts.shift();
    const color = o.color || INK;
    this.parts.push({
      x: o.x, y: o.y, z: o.z,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      size: o.size || 0.2, frame: o.frame || 0, color,
      glow: o.glow ?? (o.frame === 3 || Math.max(color.r, color.g, color.b) > 1.01),
      rot: Math.random() * 6.28, spin: o.spin ?? (Math.random() - 0.5) * 8,
      life: 0, max: o.life || 1, grav: o.grav ?? 14, drag: o.drag ?? 0.5,
      flutter: o.flutter || 0, decal: o.decal || null, decalSize: o.decalSize || 0.6,
      grow: o.grow || 0,
    });
  }

  updateParticles(dt) {
    const world = this.game.world;
    const alive = [];
    this.soft.begin(); this.bright.begin();
    for (const p of this.parts) {
      p.life += dt;
      if (p.life >= p.max) continue;
      p.vy -= p.grav * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d; p.vz *= d;
      if (p.flutter) { p.vx += Math.sin(p.life * 7 + p.rot) * p.flutter * dt; p.vz += Math.cos(p.life * 5 + p.rot) * p.flutter * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      // sparks point the way they fly
      p.rot = p.frame === 3 ? Math.atan2(p.vy, Math.hypot(p.vx, p.vz)) : p.rot + p.spin * dt;
      p.size += p.grow * dt;
      const g = world.heightAt(p.x, p.z);
      if (p.y < g + 0.05) {
        if (p.decal) { this.decal(p.x, p.z, p.decalSize * (0.6 + Math.random() * 0.8), p.decal); p.decal = null; }
        if (p.grav > 2) { p.y = g + 0.05; p.vy *= -0.2; p.vx *= 0.4; p.vz *= 0.4; p.spin *= 0.5; }
      }
      alive.push(p);
      const fade = Math.min(1, (p.max - p.life) / Math.min(0.35, p.max * 0.5));
      (p.glow ? this.bright : this.soft).push(p, fade);
    }
    this.parts = alive;
    this.soft.end(); this.bright.end();
  }

  // ---------- particle recipes ----------
  /** Gold blood of the angels, spraying along dir. It glows. */
  ichor(point, dir, count = 12, power = 1) {
    for (let i = 0; i < count; i++) {
      const s = (3 + Math.random() * 6) * power;
      this.particle({
        x: point.x, y: point.y, z: point.z,
        vx: dir.x * s + (Math.random() - 0.5) * 4, vy: 1.5 + Math.random() * 5 * power, vz: dir.z * s + (Math.random() - 0.5) * 4,
        size: 0.06 + Math.random() * 0.12, frame: 0, color: ICHOR,
        life: 1.2 + Math.random(), decal: Math.random() < 0.5 ? ICHOR : null, decalSize: 0.5,
      });
    }
  }

  /** Raiders and the knight bleed. */
  blood(point, dir, count = 10) {
    for (let i = 0; i < count; i++) {
      const s = 2 + Math.random() * 4;
      this.particle({
        x: point.x, y: point.y, z: point.z,
        vx: dir.x * s + (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 4, vz: dir.z * s + (Math.random() - 0.5) * 3,
        size: 0.04 + Math.random() * 0.09, frame: 0, color: BLOOD,
        life: 1 + Math.random(), decal: Math.random() < 0.6 ? BLOOD : null, decalSize: 0.45,
      });
    }
    // a fine mist that hangs for a moment
    for (let i = 0; i < 3; i++) {
      this.particle({
        x: point.x, y: point.y, z: point.z, vx: dir.x * 1.5, vy: 0.3, vz: dir.z * 1.5,
        size: 0.25 + Math.random() * 0.2, frame: 0, color: BLOOD, life: 0.35, grav: 0, drag: 4, grow: 0.8,
      });
    }
  }

  shards(point, count = 10, color = WHITE, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = (3 + Math.random() * 7) * power;
      this.particle({
        x: point.x, y: point.y, z: point.z,
        vx: Math.cos(a) * s, vy: 2 + Math.random() * 6 * power, vz: Math.sin(a) * s,
        size: 0.08 + Math.random() * 0.14, frame: 2, color, life: 1 + Math.random() * 0.8, spin: (Math.random() - 0.5) * 20,
      });
    }
  }

  feathers(point, count = 8, spread = 1) {
    for (let i = 0; i < count; i++) {
      this.particle({
        x: point.x + (Math.random() - 0.5) * spread, y: point.y + (Math.random() - 0.5) * spread, z: point.z + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 3,
        size: 0.22 + Math.random() * 0.22, frame: 1, color: WHITE, life: 3 + Math.random() * 2,
        grav: 1.2, drag: 1.6, flutter: 6, spin: (Math.random() - 0.5) * 3,
      });
    }
  }

  /** Steel on steel: hot orange sparks (the colour passed in only tints gold ones). */
  sparks(point, count = 10, color) {
    const c = color === ICHOR ? ICHOR : SPARK;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * 1.5, s = 6 + Math.random() * 10;
      this.particle({
        x: point.x, y: point.y, z: point.z,
        vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s + 2, vz: Math.sin(a) * Math.cos(e) * s,
        size: 0.1 + Math.random() * 0.12, frame: 3, color: c, life: 0.2 + Math.random() * 0.35, grav: 12, drag: 2.5,
      });
    }
  }

  dust(point, count = 8, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = (1.5 + Math.random() * 3) * power;
      this.particle({
        x: point.x, y: point.y + 0.2, z: point.z,
        vx: Math.cos(a) * s, vy: 0.5 + Math.random() * 1.5, vz: Math.sin(a) * s,
        size: 0.7 + Math.random() * 0.7, frame: 0, color: DUST, life: 0.8 + Math.random() * 0.8,
        grav: -0.4, drag: 2.5, grow: 1.4, spin: (Math.random() - 0.5),
      });
    }
  }

  // ======================================================= decals
  buildDecals() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    // stains are lit like the ground, and wet, so they shine a little
    const mat = new THREE.MeshStandardMaterial({
      map: this.blotTex, transparent: true, depthWrite: false, roughness: 0.25, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.decals = new THREE.InstancedMesh(geo, mat, MAX_DECALS);
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 1;
    this.decals.receiveShadow = true;
    this.decals.setColorAt(0, INK);
    this.scene.add(this.decals);
    this.decalNext = 0;

    const cmat = new THREE.MeshStandardMaterial({
      map: this.crackTex, color: 0x0a0908, transparent: true, depthWrite: false, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
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
    // glowing colours are too bright for a stain: bring them back to normal
    const c = color.clone();
    const m = Math.max(c.r, c.g, c.b);
    if (m > 1) c.multiplyScalar(0.7 / m);
    this.decals.setMatrixAt(i, this._decalMatrix(x, z, size));
    this.decals.setColorAt(i, c);
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
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.burstTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      s.visible = false;
      s.renderOrder = 20;
      this.scene.add(s);
      this.bursts.push({ s, t: 1, dur: 0.2, size: 1, color: new THREE.Color() });
    }
    this.burstNext = 0;
    this.wordPool = [];
  }

  /** The flash of light where a blow lands. */
  burst(point, size = 1, color = WHITE) {
    const b = this.bursts[this.burstNext];
    this.burstNext = (this.burstNext + 1) % this.bursts.length;
    b.s.position.copy(point);
    // a bright flash, tinted by the colour (gold for angels, red for blood)
    const m = Math.max(color.r, color.g, color.b) || 1;
    b.color.copy(color).multiplyScalar(2.5 / m).lerp(new THREE.Color(2.5, 2.4, 2.2), 0.35);
    b.s.material.color.copy(b.color);
    b.s.material.rotation = Math.random() * 6.28;
    b.s.visible = true;
    b.t = 0; b.size = size * 0.8; b.dur = 0.1 + size * 0.03;
  }

  wordTexture(text, fill) {
    const key = text + fill;
    if (this.words.has(key)) return this.words.get(key);
    const c = document.createElement('canvas');
    c.width = 512; c.height = 192;
    const g = c.getContext('2d');
    g.font = '700 84px "Cinzel", Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.85)';
    g.shadowBlur = 14;
    g.fillStyle = fill;
    g.fillText(text, 256, 100);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.words.set(key, t);
    return t;
  }

  /** A short call-out that floats up from a hit (sound words are skipped). */
  word(text, point, fill = '#ece6da', size = 1) {
    if (SOUND_WORDS.has(text)) return;
    let w = this.wordPool.find((x) => x.t >= x.dur);
    if (!w) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
      s.renderOrder = 21;
      this.scene.add(s);
      w = { s, t: 1, dur: 1 };
      this.wordPool.push(w);
    }
    w.s.material.map = this.wordTexture(text, fill);
    w.s.material.needsUpdate = true;
    w.s.material.rotation = 0;
    w.s.position.copy(point);
    w.s.position.y += 0.4;
    w.s.visible = true;
    w.t = 0; w.dur = 0.9; w.size = size * 0.75;
    w.vx = 0;
  }

  /** A sprite you can stick on something (e.g. a warning "!" over an angel). */
  sign(text, fill, size = 0.9) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.wordTexture(text, fill), transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
    s.scale.set(size * 2.67, size, 1);
    s.renderOrder = 19;
    return s;
  }

  glowSprite(size = 0.8) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(0.9, 0.7, 0.45) }));
    s.scale.set(size, size, 1);
    return s;
  }

  updateSprites(realDt) {
    for (const b of this.bursts) {
      if (!b.s.visible) continue;
      b.t += realDt;
      const k = b.t / b.dur;
      if (k >= 1) { b.s.visible = false; continue; }
      const sc = b.size * (0.6 + k * 0.8);
      b.s.scale.set(sc, sc, 1);
      b.s.material.color.copy(b.color).multiplyScalar(1 - k);
    }
    for (const w of this.wordPool) {
      if (!w.s.visible) continue;
      w.t += realDt;
      const k = w.t / w.dur;
      if (k >= 1) { w.s.visible = false; continue; }
      const sc = w.size * (k < 0.1 ? 0.85 + k * 1.5 : 1);
      w.s.scale.set(sc * 2.67, sc, 1);
      w.s.position.y += realDt * 0.6;
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
    // a faint streak of light, the way a fast blade blurs on camera
    this.trail = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 6;
    this.scene.add(this.trail);
    this.trailPts = [];
    this.trailColor = WHITE;
  }

  /** Called every frame the sword is swinging. Gold for a charged blow. */
  trailPush(base, tip, color = WHITE) {
    this.trailColor = color === ICHOR ? ICHOR : WHITE;
    this.trailPts.unshift({ b: base.clone(), t: tip.clone(), age: 0 });
    if (this.trailPts.length > MAX_TRAIL) this.trailPts.pop();
  }

  updateTrail(dt) {
    for (const p of this.trailPts) p.age += dt;
    this.trailPts = this.trailPts.filter((p) => p.age < 0.12);
    const n = this.trailPts.length;
    const c = this.trailColor;
    const gain = c === ICHOR ? 0.35 : 0.5;
    for (let i = 0; i < MAX_TRAIL; i++) {
      const p = this.trailPts[Math.min(i, n - 1)];
      if (!p) break;
      const k = n > 1 ? 1 - i / (n - 1) : 0;
      const a = i < n ? Math.max(0, 1 - p.age / 0.12) * k * gain : 0;
      const bx = p.b.x + (p.t.x - p.b.x) * 0.3, by = p.b.y + (p.t.y - p.b.y) * 0.3, bz = p.b.z + (p.t.z - p.b.z) * 0.3;
      this.trailPos.set([bx, by, bz, p.t.x, p.t.y, p.t.z], i * 6);
      this.trailCol.set([c.r * a * 0.2, c.g * a * 0.2, c.b * a * 0.2, 1, c.r * a, c.g * a, c.b * a, 1], i * 8);
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
  /** An expanding ring on the ground: glowing gold for holy blasts, a dust wave for dark ones. */
  ring(x, z, opts = {}) {
    const geo = new THREE.RingGeometry(0.8, 1, 64);
    geo.rotateX(-Math.PI / 2);
    const gold = (opts.color ?? GOLD_HEX) !== 0x1d1913;
    const color = gold ? new THREE.Color(opts.color ?? GOLD_HEX).multiplyScalar(2.5) : DUST.clone();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide,
      blending: gold ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    mesh.renderOrder = 4;
    mesh.position.set(x, this.game.world.heightAt(x, z) + (opts.lift ?? 0.25), z);
    this.scene.add(mesh);
    const r = { mesh, r: opts.start ?? 0.5, speed: opts.speed ?? 14, max: opts.max ?? 16, done: false };
    mesh.scale.setScalar(r.r);
    this.rings.push(r);
    if (!gold) this.dust({ x, y: mesh.position.y, z }, 10, 1.3);
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
    const mat = new THREE.MeshBasicMaterial({
      map: this.beamTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false,
      blending: THREE.AdditiveBlending, color: new THREE.Color(3, 2.4, 1.4),
    });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 260, 24, 1, true), mat);
    mesh.position.set(x, g + 130, z);
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

  /** A split-second flash of stark contrast: the impact frame. */
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
    const s = (h * this.game.renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.soft.mat.uniforms.uScale.value = s;
    this.bright.mat.uniforms.uScale.value = s;
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

    // the edges of your sight darken and redden when badly hurt
    const k = this.game.knight;
    const low = k ? 1 - k.hp / k.maxHp : 0;
    const edge = Math.max(this.hurtFlash, low > 0.6 ? (low - 0.6) * 2 * (0.75 + 0.25 * Math.sin(performance.now() / 180)) : 0);
    if (edge > 0.01) {
      const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.55);
      grad.addColorStop(0, 'rgba(90,10,6,0)');
      grad.addColorStop(1, `rgba(60,4,2,${0.7 * edge})`);
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
