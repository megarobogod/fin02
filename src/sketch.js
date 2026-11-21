// =====================================================
// sketch.js - the hand-drawn look
//
// Nothing in this game uses normal 3D lighting. Instead every object is
// drawn with two tricks:
//   1. "Fill" material: paper-coloured, with pencil hatching lines drawn in
//      the shadows. The darker a surface is, the more layers of lines it gets.
//   2. "Outline": a second, slightly fatter copy of each shape drawn inside
//      out in ink. You only see the edge of it, which looks like a pen line.
// Both of them "boil" (wobble a few times a second) like a hand-drawn cartoon.
// =====================================================
import * as THREE from 'three';

export const PAPER_HEX = 0xece4d2;   // the colour of the page
export const INK_HEX = 0x1d1913;     // the colour of the pen
export const GOLD_HEX = 0xf0b43c;    // holy light: the only bright colour

// Little noise functions shared by the shaders
const COMMON = /* glsl */`
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

// ---------- fill (paper + hatching) ----------
const FILL_VERT = /* glsl */`
uniform vec3 uTint;
varying vec3 vN;
varying vec3 vWP;
varying vec3 vCol;
varying float vDist;
attribute float win;      // 1.xx on building walls: draw windows (the .xx picks the pattern)
varying float vWin;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  vWin = win;
  vN = normalize(mat3(modelMatrix) * normal);
  vCol = uTint;
  #ifdef USE_COLOR
    vCol *= color;
  #endif
  vec4 mv = viewMatrix * wp;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FILL_FRAG = /* glsl */`
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uPx;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFlash;
uniform float uScribble;
uniform float uHatch;
varying vec3 vN;
varying vec3 vWP;
varying vec3 vCol;
varying float vDist;
varying float vWin;
${COMMON}

// 1.0 on a pencil line, 0.0 between lines. Lines are slightly wavy.
float stripe(vec2 p, float ang, float spacing, float width) {
  vec2 d = vec2(cos(ang), sin(ang));
  float v = dot(p, d) + sin(dot(p, vec2(-d.y, d.x)) * 0.07) * 1.6;
  float f = abs(fract(v / spacing) - 0.5) * spacing;
  return 1.0 - smoothstep(width * 0.5, width * 0.5 + 0.9, f);
}

void main() {
  vec3 n = normalize(vN);
  float diff = max(dot(n, uSunDir), 0.0);
  float sky = 0.5 + 0.5 * n.y;
  float light = 0.32 + 0.5 * diff + 0.18 * sky;

  // how dark this spot should look: lighting times how dark the colour is
  float tone = dot(vCol, vec3(0.299, 0.587, 0.114));
  float value = light * (0.5 + 0.7 * tone);

  // smudgy pencil texture fixed to the world, so it doesn't swim
  float g = vnoise(vWP.xz * 0.35 + vWP.y * 0.2) * 0.6 + vnoise(vWP.xz * 1.7 + vWP.y) * 0.4;
  value -= (g - 0.5) * uScribble;

  vec3 col = mix(uPaper, vCol, 0.78) * (0.8 + 0.26 * light);
  float ink = 0.0;

  // ---- building walls: rows of windows, shopfronts, ledges, soot ----
  // Painted on by the shader, so thousands of windows cost nothing.
  if (vWin > 0.5 && abs(n.y) < 0.4) {
    vec2 t = normalize(vec2(-n.z, n.x));
    float u = dot(vWP.xz, t) + 0.37;
    float v = vWP.y + 0.6;
    float seed = fract(vWin) * 97.0;
    vec2 cell = vec2(floor(u / 3.0), floor(v / 3.3));
    vec2 f = vec2(fract(u / 3.0), fract(v / 3.3));
    float rnd = hash12(cell + seed);
    float isWin;
    if (cell.y < 1.0) {
      // ground floor: wide shop openings, some bricked up
      isWin = step(0.06, f.x) * step(f.x, 0.94) * step(0.06, f.y) * step(f.y, 0.78) * step(0.4, rnd);
    } else {
      isWin = step(0.24, f.x) * step(f.x, 0.76) * step(0.3, f.y) * step(f.y, 0.84);
    }
    if (isWin > 0.5) {
      if (rnd > 0.88) {
        // boarded up: pale planks with ink gaps
        col = mix(col, vec3(0.62, 0.53, 0.42), 0.8);
        ink = max(ink, 1.0 - smoothstep(0.0, 0.05, abs(fract(f.y * 7.0) - 0.5) - 0.38));
      } else {
        // a dark, burned-out opening
        value *= 0.32;
        col = mix(col, uInk, 0.45 + 0.2 * rnd);
      }
      // frame
      float fx = min(abs(f.x - 0.24), abs(f.x - 0.76));
      float fy = min(abs(f.y - 0.3), abs(f.y - 0.84));
      if (cell.y >= 1.0) ink = max(ink, (1.0 - smoothstep(0.0, 0.025, min(fx, fy))) * 0.8);
    } else if (cell.y >= 1.0 && rnd < 0.35 && f.y > 0.84 && f.x > 0.2 && f.x < 0.8) {
      // soot streaks above windows that burned
      value -= 0.45 * (1.0 - (f.y - 0.84) / 0.16);
    }
    // a ledge between each floor
    ink = max(ink, (1.0 - smoothstep(0.0, 0.018, abs(f.y - 0.02))) * 0.7);
  }

  // hatching, drawn in screen space like real pencil strokes
  vec2 p = gl_FragCoord.xy / uPx;
  float boil = floor(uTime * 6.0);
  p += vec2(hash12(vec2(boil, 1.0)), hash12(vec2(boil, 7.0))) * 3.0;
  ink = max(ink, stripe(p, 0.785, 9.0, 1.0) * smoothstep(0.56, 0.46, value) * 0.75);
  ink = max(ink, stripe(p, -0.785, 9.0, 1.0) * smoothstep(0.36, 0.28, value) * 0.85);
  ink = max(ink, stripe(p, 0.2, 5.0, 1.0) * smoothstep(0.2, 0.12, value));
  col = mix(col, uInk, ink * 0.62 * uHatch);

  // paper fibres
  col *= 0.96 + 0.06 * hash12(floor(gl_FragCoord.xy / uPx));

  // flash white when struck
  col = mix(col, vec3(1.0), uFlash);

  // far away things fade into the page
  float fog = smoothstep(uFogNear, uFogFar, vDist);
  col = mix(col, uPaper, fog);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------- outline (the pen line) ----------
const OUTLINE_VERT = /* glsl */`
attribute vec3 onormal;
uniform float uThick;
uniform float uTime;
varying float vDist;
float h3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 vn = normalize(normalMatrix * onormal);
  float boil = floor(uTime * 7.0);
  float j = h3(floor(position * 4.0) + boil);
  float dist = -mv.z;
  // thicker further away (so far lines don't vanish), and wobbly
  float t = uThick * clamp(dist * 0.08, 1.0, 5.0) * (0.6 + 0.8 * j);
  mv.xyz += vn * t;
  vDist = dist;
  gl_Position = projectionMatrix * mv;
}`;

const OUTLINE_FRAG = /* glsl */`
uniform vec3 uInk;
uniform vec3 uPaper;
uniform float uFogNear;
uniform float uFogFar;
varying float vDist;
void main() {
  float fog = smoothstep(uFogNear, uFogFar, vDist);
  gl_FragColor = vec4(mix(uInk, uPaper, fog), 1.0);
}`;

// ---------- sky ----------
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uRift;
uniform float uTime;
uniform float uRiftGlow;
varying vec3 vDir;
${COMMON}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float az = atan(d.z, d.x);
  vec3 col = uPaper * (1.0 - 0.07 * smoothstep(0.05, 0.9, h));

  // clouds made of long sideways pencil strokes
  float cloud = vnoise(vec2(az * 2.5, h * 9.0)) * 0.65 + vnoise(vec2(az * 7.0, h * 25.0)) * 0.35;
  float strokes = vnoise(vec2(az * 60.0, h * 400.0 + floor(uTime * 4.0) * 3.1));
  float shade = smoothstep(0.55, 0.75, cloud) * smoothstep(0.0, 0.15, h);
  col = mix(col, uInk, shade * smoothstep(0.45, 0.7, strokes) * 0.35);
  col = mix(col, uInk, (1.0 - smoothstep(0.0, 0.03, abs(h))) * 0.08);

  // the Rift: the tear in the sky the angels pour out of
  float raz = atan(uRift.z, uRift.x);
  float du = mod(az - raz + 3.14159, 6.28318) - 3.14159;
  float dv = h - uRift.y;
  float len = 0.34;
  float shapeV = clamp(1.0 - (dv * dv) / (len * len), 0.0, 1.0);
  float jag = (vnoise(vec2(dv * 40.0, 3.0)) - 0.5) * 0.035;
  // when an angel is coming, the tear widens and blazes
  float w = 0.055 * shapeV * (1.0 + uRiftGlow * 1.5);
  float x = abs(du + jag);
  float core = 1.0 - smoothstep(w * 0.5, w, x);
  float glow = exp(-x * (8.0 - uRiftGlow * 5.0)) * shapeV * (1.0 + uRiftGlow);
  col = mix(col, vec3(0.94, 0.72, 0.28), glow * 0.55);
  col = mix(col, vec3(1.0, 0.97, 0.88), core);
  float edge = smoothstep(w, w * 1.15, x) * (1.0 - smoothstep(w * 1.15, w * 1.6 + 0.004, x)) * step(0.02, shapeV);
  col = mix(col, uInk, edge * 0.8);
  gl_FragColor = vec4(col, 1.0);
}`;

// Works out "outline normals": at sharp corners the outline is pushed out
// diagonally (the average of the faces that meet there), so the pen line
// stays joined up instead of splitting apart at each corner.
export function addOutlineNormals(geo) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const sums = new Map();
  const keys = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round(pos.getX(i) * 1000) + ',' + Math.round(pos.getY(i) * 1000) + ',' + Math.round(pos.getZ(i) * 1000);
    keys[i] = k;
    let s = sums.get(k);
    if (!s) { s = [0, 0, 0]; sums.set(k, s); }
    s[0] += nor.getX(i); s[1] += nor.getY(i); s[2] += nor.getZ(i);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(keys[i]);
    const l = Math.hypot(s[0], s[1], s[2]) || 1;
    out[i * 3] = s[0] / l;
    out[i * 3 + 1] = s[1] / l;
    out[i * 3 + 2] = s[2] / l;
  }
  geo.setAttribute('onormal', new THREE.BufferAttribute(out, 3));
  return geo;
}

export class Sketch {
  constructor(renderer) {
    this.renderer = renderer;
    // Uniforms every sketch material shares (change one, they all change)
    this.shared = {
      uPaper: { value: new THREE.Color(PAPER_HEX) },
      uInk: { value: new THREE.Color(INK_HEX) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.85, -0.45).normalize() },
      uTime: { value: 0 },
      uPx: { value: renderer.getPixelRatio() },
      uFogNear: { value: 50 },
      uFogFar: { value: 240 },
      uRiftGlow: { value: 0 },
    };
    this.outline = this.makeOutline(0.022);
    this.cache = new Map();
    this.glows = new Map();
  }

  update(dt) {
    this.shared.uTime.value += dt;
    this.shared.uPx.value = this.renderer.getPixelRatio();
  }

  /** A paper-and-pencil material in the given tint. */
  fill(tint, opts = {}) {
    const key = opts.flash ? null :
      `${tint}|${opts.scribble}|${!!opts.vertexColors}|${opts.hatch}|${opts.side}`;
    if (key && this.cache.has(key)) return this.cache.get(key);
    const s = this.shared;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uPaper: s.uPaper, uInk: s.uInk, uSunDir: s.uSunDir, uTime: s.uTime, uPx: s.uPx,
        uFogNear: s.uFogNear, uFogFar: s.uFogFar,
        uTint: { value: new THREE.Color(tint) },
        uFlash: opts.flash || { value: 0 },
        uScribble: { value: opts.scribble ?? 0.15 },
        uHatch: { value: opts.hatch ?? 1 },
      },
      vertexShader: FILL_VERT,
      fragmentShader: FILL_FRAG,
      vertexColors: !!opts.vertexColors,
      side: opts.side ?? THREE.FrontSide,
    });
    if (key) this.cache.set(key, mat);
    return mat;
  }

  makeOutline(thick) {
    const s = this.shared;
    return new THREE.ShaderMaterial({
      uniforms: {
        uInk: s.uInk, uPaper: s.uPaper, uTime: s.uTime,
        uFogNear: s.uFogNear, uFogFar: s.uFogFar,
        uThick: { value: thick },
      },
      vertexShader: OUTLINE_VERT,
      fragmentShader: OUTLINE_FRAG,
      side: THREE.BackSide,
    });
  }

  /** Flat, unshaded colour (used for holy gold light, which glows). */
  glow(hex) {
    if (!this.glows.has(hex)) this.glows.set(hex, new THREE.MeshBasicMaterial({ color: hex }));
    return this.glows.get(hex);
  }

  /**
   * A mesh drawn in the sketch style. (The ink outlines are drawn afterwards
   * for the whole screen at once, by post.js, so they no longer need a
   * second copy of every shape.)
   */
  part(geo, tint, opts = {}) {
    return new THREE.Mesh(geo, opts.material || this.fill(tint, opts));
  }

  makeSky(riftDir) {
    const s = this.shared;
    return new THREE.ShaderMaterial({
      uniforms: { uPaper: s.uPaper, uInk: s.uInk, uTime: s.uTime, uRift: { value: riftDir }, uRiftGlow: s.uRiftGlow },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    });
  }
}
