// =====================================================
// post.js - the finishing pass over the whole picture
//
// The 3D scene is first drawn into an off-screen image (plus a "depth" image
// that says how far away each pixel is). Then one full-screen shader:
//   - draws INK LINES wherever the depth jumps (outlines) or bends (creases)
//   - makes those lines wobble ("boil") like hand-drawn animation
//   - does IMPACT FRAMES: the picture flips to pure ink for a split second
//   - adds speed lines, a slow-motion sepia tint and cinema bars
// =====================================================
import * as THREE from 'three';
import { INK_HEX, PAPER_HEX, GOLD_HEX } from './sketch.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uTime;
uniform float uPx;
uniform float uFogFar;
uniform float uImpact;   // 0 normal, 1 inverted, 2 ink-on-paper, 3 paper-on-ink
uniform float uSpeed;    // speed lines, 0..1
uniform float uBars;     // cinema bars, 0..1
uniform float uSlow;     // slow-motion tint, 0..1
uniform float uBlur;     // zoom blur towards the middle
uniform float uFlash;    // white flash
uniform vec3 uInk;
uniform vec3 uPaper;
uniform vec3 uGold;
varying vec2 vUv;

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
float lin(vec2 uv) {
  float z = texture2D(tDepth, uv).x;
  float ndc = z * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
}

void main() {
  vec2 uv = vUv;
  vec2 px = 1.0 / uRes;
  float boil = floor(uTime * 7.0);

  vec3 col = texture2D(tColor, uv).rgb;
  if (uBlur > 0.001) {
    vec2 dir = uv - 0.5;
    vec3 acc = col;
    for (int i = 1; i < 8; i++) acc += texture2D(tColor, uv - dir * uBlur * float(i) / 8.0).rgb;
    col = acc / 8.0;
  }

  // ---- ink lines from the depth image ----
  vec2 wob = (vec2(vnoise(uv * vec2(70.0, 48.0) + boil * 3.1), vnoise(uv * vec2(48.0, 70.0) - boil * 1.7)) - 0.5) * px * 2.4 * uPx;
  vec2 c = uv + wob;
  vec2 e = px * 1.2 * uPx;
  float d0 = lin(c);
  float dl = lin(c - vec2(e.x, 0.0)), dr = lin(c + vec2(e.x, 0.0));
  float du = lin(c + vec2(0.0, e.y)), dd = lin(c - vec2(0.0, e.y));
  float dmin = min(d0, min(min(dl, dr), min(du, dd)));
  // outlines: a sudden jump in distance
  float sil = max(max(abs(dl - d0), abs(dr - d0)), max(abs(du - d0), abs(dd - d0))) / dmin;
  // creases: where a surface folds (measured on 1/depth, which is flat on flat faces)
  float w0 = 1.0 / d0;
  float lap = abs(1.0 / dl + 1.0 / dr + 1.0 / du + 1.0 / dd - 4.0 * w0) / w0;
  float edge = smoothstep(0.03, 0.065, sil);
  edge = max(edge, smoothstep(0.012, 0.035, lap) * 0.8 * (1.0 - smoothstep(25.0, 70.0, dmin)));
  // lines fade into the distance with everything else
  edge *= 1.0 - smoothstep(uFogFar * 0.4, uFogFar * 0.95, dmin);
  // pen pressure: lines vary a bit in darkness along their length
  edge *= 0.75 + 0.25 * vnoise(uv * 300.0 + boil);
  col = mix(col, uInk, clamp(edge, 0.0, 1.0) * 0.95);

  // ---- slow motion: drain the colour towards sepia ----
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float sat = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
  if (uSlow > 0.001) {
    vec3 sepia = vec3(lum * 1.06, lum * 0.98, lum * 0.86);
    vec3 keep = sat > 0.3 ? col : sepia;     // gold stays gold
    col = mix(col, keep, uSlow * 0.85);
    float vig = smoothstep(0.35, 0.85, length(uv - 0.5));
    col = mix(col, uInk, vig * uSlow * 0.5);
  }

  // ---- impact frames ----
  if (uImpact > 0.5 && uImpact < 1.5) {
    col = vec3(1.0) - col;
  } else if (uImpact > 1.5 && uImpact < 2.5) {
    col = lum > 0.55 && edge < 0.4 ? uPaper : uInk;
    if (sat > 0.32) col = uGold;
  } else if (uImpact > 2.5) {
    col = (edge > 0.35 || lum > 0.72) ? uPaper : uInk;
    if (sat > 0.32) col = uGold;
  }

  // ---- speed lines rushing to the centre ----
  if (uSpeed > 0.001) {
    vec2 d = uv - 0.5;
    d.x *= uRes.x / uRes.y;
    float a = atan(d.y, d.x);
    float r = length(d);
    float band = floor(a * 70.0);
    float on = step(0.78, hash12(vec2(band, boil)));
    float len = 0.32 + 0.25 * hash12(vec2(band, boil + 9.0));
    float line = on * smoothstep(len, len + 0.08, r) * (1.0 - smoothstep(0.0, 0.5, abs(fract(a * 70.0) - 0.5) * 2.0 - 0.2));
    vec3 lineCol = uImpact > 2.5 ? uPaper : uInk;
    col = mix(col, lineCol, clamp(line * uSpeed, 0.0, 1.0));
  }

  col = mix(col, vec3(1.0, 0.98, 0.92), uFlash);

  // ---- cinema bars with a rough brushed edge ----
  if (uBars > 0.001) {
    float h = uBars * 0.13 + (vnoise(vec2(uv.x * 40.0, boil)) - 0.5) * 0.008 * uBars;
    if (uv.y < h || uv.y > 1.0 - h) col = uInk;
  }

  gl_FragColor = vec4(col, 1.0);
}`;

export class Post {
  constructor(game) {
    this.game = game;
    this.renderer = game.renderer;
    // what the impact/cinematic code sets each frame
    this.impact = 0;
    this.speed = 0;
    this.bars = 0;
    this.slow = 0;
    this.blur = 0;
    this.flash = 0;

    const depth = new THREE.DepthTexture(4, 4);
    depth.type = THREE.UnsignedIntType;
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      depthTexture: depth,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: depth },
        uRes: { value: new THREE.Vector2(4, 4) },
        uNear: { value: 0.1 }, uFar: { value: 1000 },
        uTime: game.sketch.shared.uTime,
        uPx: game.sketch.shared.uPx,
        uFogFar: game.sketch.shared.uFogFar,
        uImpact: { value: 0 }, uSpeed: { value: 0 }, uBars: { value: 0 },
        uSlow: { value: 0 }, uBlur: { value: 0 }, uFlash: { value: 0 },
        uInk: { value: new THREE.Color(INK_HEX) },
        uPaper: { value: new THREE.Color(PAPER_HEX) },
        uGold: { value: new THREE.Color(GOLD_HEX) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    this.target.setSize(Math.floor(w * pr), Math.floor(h * pr));
    this.mat.uniforms.uRes.value.set(Math.floor(w * pr), Math.floor(h * pr));
  }

  render(scene, camera) {
    const u = this.mat.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uImpact.value = this.impact;
    u.uSpeed.value = this.speed;
    u.uBars.value = this.bars;
    u.uSlow.value = this.slow;
    u.uBlur.value = this.blur;
    u.uFlash.value = this.flash;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.cam);
  }
}
