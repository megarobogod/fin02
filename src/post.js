// =====================================================
// post.js - the finishing passes over the whole picture
//
// The 3D scene is drawn into an off-screen image first, then:
//   1. (high quality only) ambient occlusion: darkens creases and corners
//      where light can't reach, like the gap under a car
//   2. bloom: very bright things (holy gold, fire, the sun) glow and bleed
//   3. output: squeezes the bright "HDR" light into screen colours, like a
//      film camera does ("tone mapping")
//   4. grade: our own shader for the cinematic stuff - impact frames, slow
//      motion colour, speed lines, cinema bars, plus lens dirt like a vignette
//      and film grain
// =====================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const BLOOM_STRENGTH = 0.4;
const BLOOM_RADIUS = 0.5;
const BLOOM_THRESHOLD = 1.1;   // only light brighter than white blooms

const GRADE = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uImpact: { value: 0 },   // 0 normal, 1 negative, 2 harsh black and white, 3 white-on-black
    uSpeed: { value: 0 },    // speed lines, 0..1
    uBars: { value: 0 },     // cinema bars, 0..1
    uSlow: { value: 0 },     // slow-motion grade, 0..1
    uBlur: { value: 0 },     // zoom blur towards the middle
    uFlash: { value: 0 },    // white flash
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uTime, uImpact, uSpeed, uBars, uSlow, uBlur, uFlash;
    varying vec2 vUv;
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec2 uv = vUv;
      vec2 dir = uv - 0.5;
      // colour fringes at the edge of the lens, stronger on big hits
      float ca = 0.0012 + uSpeed * 0.004 + (uImpact > 0.5 ? 0.006 : 0.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv - dir * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + dir * ca).b;
      if (uBlur > 0.001) {
        vec3 acc = col;
        for (int i = 1; i < 10; i++) acc += texture2D(tDiffuse, uv - dir * uBlur * float(i) / 10.0).rgb;
        col = acc / 10.0;
      }
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float sat = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));

      // ---- slow motion: drain the colour, crush the shadows, keep the gold ----
      if (uSlow > 0.001) {
        vec3 grey = vec3(lum) * vec3(1.05, 1.0, 0.92);
        vec3 keep = mix(grey, col, smoothstep(0.25, 0.45, sat) * step(col.b, col.r));
        keep = pow(keep, vec3(1.15));
        col = mix(col, keep, uSlow * 0.9);
      }

      // ---- impact frames: a split second of stark, burnt-out contrast ----
      if (uImpact > 0.5 && uImpact < 1.5) {
        col = vec3(1.0) - col;
      } else if (uImpact > 1.5 && uImpact < 2.5) {
        float v = smoothstep(0.26, 0.3, lum);
        col = mix(vec3(0.02), vec3(1.0, 0.97, 0.92), v);
        if (sat > 0.3 && col.r > col.b) col = vec3(1.0, 0.72, 0.25);
      } else if (uImpact > 2.5) {
        float v = 1.0 - smoothstep(0.2, 0.24, lum);
        col = mix(vec3(0.02), vec3(1.0, 0.97, 0.92), v);
        if (sat > 0.3 && lum > 0.4) col = vec3(1.0, 0.72, 0.25);
      }

      // ---- speed lines rushing to the middle ----
      if (uSpeed > 0.001) {
        vec2 d = dir;
        d.x *= uRes.x / uRes.y;
        float a = atan(d.y, d.x);
        float r = length(d);
        float frame = floor(uTime * 24.0);
        float band = floor(a * 90.0);
        float on = step(0.8, hash12(vec2(band, frame)));
        float len = 0.3 + 0.25 * hash12(vec2(band, frame + 9.0));
        float line = on * smoothstep(len, len + 0.12, r) * (1.0 - smoothstep(0.0, 0.6, abs(fract(a * 90.0) - 0.5) * 2.0 - 0.1));
        vec3 lineCol = uImpact > 2.5 ? vec3(0.02) : vec3(1.0, 0.97, 0.9);
        col = mix(col, lineCol, clamp(line * uSpeed * 0.6, 0.0, 1.0));
      }

      col = mix(col, vec3(1.0, 0.98, 0.94), uFlash);

      // ---- lens: darker corners and fine film grain ----
      float vig = smoothstep(0.35, 0.95, length(dir * vec2(uRes.x / uRes.y, 1.0) * 0.85));
      col *= 1.0 - vig * (0.42 + uSlow * 0.35);
      col += (hash12(gl_FragCoord.xy + fract(uTime) * 371.0) - 0.5) * 0.035;

      // ---- cinema bars ----
      if (uBars > 0.001) {
        float h = uBars * 0.12;
        if (uv.y < h || uv.y > 1.0 - h) col = vec3(0.0);
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
};

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
    this.quality = game.quality;

    // the off-screen images hold light brighter than white ("half float").
    // On high quality, edges are smoothed with 4x multisampling. On low, a
    // much cheaper trick (FXAA) blurs just the jagged edges at the end.
    const high = this.quality === 'high';
    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: high ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(game.scene, game.camera));
    if (this.quality === 'high') {
      this.ao = new GTAOPass(game.scene, game.camera, 4, 4);
      this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1.2, samples: 12 });
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.ao.blendIntensity = 0.9;
      this.composer.addPass(this.ao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    if (!high) {
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaa);
    }
    this.grade = new ShaderPass(GRADE);
    this.composer.addPass(this.grade);
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.grade.uniforms.uRes.value.set(w * pr, h * pr);
    if (this.fxaa) this.fxaa.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
  }

  render() {
    const u = this.grade.uniforms;
    u.uTime.value = this.game.realTime;
    u.uImpact.value = this.impact;
    u.uSpeed.value = this.speed;
    u.uBars.value = this.bars;
    u.uSlow.value = this.slow;
    u.uBlur.value = this.blur;
    u.uFlash.value = this.flash;
    this.composer.render();
  }
}
