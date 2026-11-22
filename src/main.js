// =====================================================
// main.js - starts everything and runs the game loop
//
// Two kinds of time:
//   realDt - real seconds since the last frame
//   dt     - game seconds. During "hitstop" this is 0, which freezes the
//            whole world for a split second when a big hit lands. During
//            slow motion it's smaller than realDt.
// =====================================================
import * as THREE from 'three';
import { Materials, SUN_DIR, FOG_DENSITY, castShadows } from './materials.js';
import { World } from './world.js';
import { FX } from './fx.js';
import { Sound } from './audio.js';
import { Knight } from './knight.js';
import { Angels } from './angels.js';
import { HUD } from './hud.js';
import { CameraRig } from './camera.js';
import { Post } from './post.js';
import { Humans } from './humans.js';
import { Cinematic } from './cinematic.js';

const FIRE = new THREE.Color(0xff7a24).multiplyScalar(3);
const FIRE2 = new THREE.Color(0xffc060).multiplyScalar(3);
const FIRE_LIGHTS = 3;          // real lights for the nearest camp fires

/**
 * Graphics quality. "high" adds ambient occlusion (soft shadows in corners)
 * and sharper sun shadows. Built-in laptop graphics start on "low".
 * Press G on the title screen to switch (the page reloads).
 */
function pickQuality() {
  const saved = localStorage.getItem('lastOath.quality');
  if (saved === 'high' || saved === 'low') return saved;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    if (/intel|mali|adreno|powervr|apple gpu|swiftshader/i.test(gpu)) return 'low';
  } catch (e) { /* no info: assume a proper graphics card */ }
  return 'high';
}

class Input {
  constructor() {
    this.keys = new Set();
    this.down = new Set();
    this.mouse = { left: false, right: false, leftPressed: false, leftReleased: false };
    this.dx = 0;
    this.dy = 0;
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.down.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('mousemove', (e) => { this.dx += e.movementX || 0; this.dy += e.movementY || 0; });
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 1) { this.down.add('Mouse1'); e.preventDefault(); }
      if (e.button === 2) this.mouse.right = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.mouse.left) { this.mouse.left = false; this.mouse.leftReleased = true; }
      if (e.button === 2) this.mouse.right = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  key(code) { return this.keys.has(code); }
  pressed(code) { return this.down.has(code); }
  clear() {
    this.keys.clear();
    this.mouse.left = this.mouse.right = false;
  }
  endFrame() {
    this.down.clear();
    this.mouse.leftPressed = false;
    this.mouse.leftReleased = false;
    this.dx = this.dy = 0;
  }
}

class Game {
  constructor() {
    this.state = 'menu';         // menu | playing | paused | dead
    this.time = 0;               // game time
    this.realTime = 0;           // real time
    this.hitstopT = 0;
    this.slowT = 0;
    this.slowScale = 1;

    this.quality = pickQuality();
    // antialias is off here because post.js smooths edges itself
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    // a film-like curve that squeezes bright light into screen colours
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    // render scale: drops by itself if the computer can't keep up (see adaptResolution)
    this.maxScale = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 1.25 : 1);
    this.scale = this.maxScale;
    this.renderer.setPixelRatio(this.scale);
    document.getElementById('view').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1100);
    this.scene.add(this.camera);

    this.mats = new Materials(this.renderer);
    this.scene.fog = new THREE.FogExp2(this.mats.fogColor(), FOG_DENSITY);
    this.post = new Post(this);
    this.fx = new FX(this);
    this.world = new World(this);
    this.scene.environment = this.mats.makeEnvironment(this.world.skyMat);
    this.makeLights();
    this.sound = new Sound();
    this.knight = new Knight(this);
    this.angels = new Angels(this);
    this.humans = new Humans(this);
    this.cinematic = new Cinematic(this);
    castShadows(this.knight.root);
    this.hud = new HUD(this);
    this.rig = new CameraRig(this);
    this.rig.snap();

    this.input = new Input();
    this.bindMenus();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.showQuality();

    window.GAME = this;     // handy for poking at things from the browser console
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  bindMenus() {
    const canvas = this.renderer.domElement;
    const lockMouse = () => {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {});
    };
    document.addEventListener('click', () => {
      this.sound.start();
      if (this.state === 'menu' || this.state === 'paused') {
        this.state = 'playing';
        document.body.classList.add('playing');
        this.hud.hideScreens();
        this.hud.show();
        this.input.clear();
        this.input.endFrame();
      } else if (this.state === 'dead' && this.deadT > 1.2) {
        this.restart();
      }
      lockMouse();
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && this.state === 'playing') this.pause();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.sound.toggleMute();
      if (e.code === 'Escape' && this.state === 'playing') this.pause();
      if (e.code === 'KeyG' && this.state !== 'playing') {
        localStorage.setItem('lastOath.quality', this.quality === 'high' ? 'low' : 'high');
        location.reload();
      }
    });
  }

  /**
   * Dynamic resolution: every couple of seconds, look at how fast frames are
   * coming. Too slow, and draw the 3D picture with fewer pixels (the HUD stays
   * sharp). Plenty fast, and creep back up.
   */
  adaptResolution(rawDt) {
    if (this.state !== 'playing' || document.hidden) { this.fpsT = 0; this.fpsN = 0; return; }
    this.fpsT = (this.fpsT || 0) + rawDt;
    this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsT < 2) return;
    const avg = this.fpsT / this.fpsN;
    this.fpsT = 0; this.fpsN = 0;
    let s = this.scale;
    if (avg > 1 / 40) s = Math.max(0.6, s - 0.1);
    else if (avg < 1 / 57) s = Math.min(this.maxScale, s + 0.05);
    if (Math.abs(s - this.scale) > 0.01) { this.scale = s; this.renderer.setPixelRatio(s); this.resize(); }
  }

  showQuality() {
    const el = document.getElementById('quality');
    if (el) el.textContent = this.quality === 'high' ? 'High' : 'Low';
  }

  // ================================================================ light
  makeLights() {
    // the sun, whose shadow follows you around
    this.sun = this.mats.makeSun(this.quality);
    this.scene.add(this.sun, this.sun.target);
    // a few real lights that hop to the nearest fires
    this.fireLights = [];
    for (let i = 0; i < FIRE_LIGHTS; i++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 16, 2);
      this.scene.add(l);
      this.fireLights.push(l);
    }
  }

  updateLights() {
    const k = this.knight.pos;
    const c = this.camera.position;
    // centre the sun's shadow a little ahead of the camera, snapped to its
    // pixel grid so the shadow edges don't crawl as you move
    const cx = k.x * 0.6 + c.x * 0.4, cz = k.z * 0.6 + c.z * 0.4;
    const step = (2 * this.sun.shadow.camera.right) / this.sun.shadow.mapSize.x;
    const sx = Math.round(cx / step) * step, sz = Math.round(cz / step) * step;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + SUN_DIR.x * 200, SUN_DIR.y * 200, sz + SUN_DIR.z * 200);
    // fire lights flicker
    this.fireLightT = (this.fireLightT || 0) - 1;
    if (this.fireLightT <= 0) {
      this.fireLightT = 15;
      const near = this.world.fires
        .map((f) => [Math.hypot(f.x - k.x, f.z - k.z), f])
        .filter((a) => a[0] < 60).sort((a, b) => a[0] - b[0]);
      this.fireLights.forEach((l, i) => { l.fire = near[i] ? near[i][1] : null; });
    }
    const t = this.realTime;
    this.fireLights.forEach((l, i) => {
      if (!l.fire) { l.intensity = 0; return; }
      l.position.set(l.fire.x, l.fire.y + 0.6, l.fire.z);
      l.intensity = (l.fire.size > 0.55 ? 9 : 7) * (0.8 + 0.12 * Math.sin(t * 13 + i) + 0.08 * Math.sin(t * 29 + i * 2));
    });
  }

  pause() {
    this.state = 'paused';
    document.body.classList.remove('playing');
    this.input.clear();
    this.hud.el.start.hidden = false;
    this.hud.el.start.querySelector('.prompt').textContent = 'Click to return to the fight';
  }

  restart() {
    this.fx.reset();
    this.angels.reset();
    this.humans.reset();
    this.hud.boss(null);
    this.mats.shared.uRiftGlow.value = 0;
    this.knight.reset();
    this.rig.snap();
    this.hud.seen.clear();
    this.hud.hideScreens();
    this.hud.show();
    this.state = 'playing';
    document.body.classList.add('playing');
  }

  onKnightDeath() {
    this.deadT = 0;
    this.state = 'dead';
    setTimeout(() => {
      this.hud.showDeath(this.angels.host, this.angels.kills);
      document.body.classList.remove('playing');
      if (document.pointerLockElement) document.exitPointerLock();
    }, 1600);
  }

  /** Flames rising from the camp fires and burning barrels near you. */
  updateFires(dt) {
    this.fireT = (this.fireT || 0) - dt;
    if (this.fireT > 0) return;
    this.fireT = 0.06;
    const k = this.knight.pos;
    for (const f of this.world.fires) {
      if (Math.abs(f.x - k.x) > 60 || Math.abs(f.z - k.z) > 60) continue;
      this.fx.particle({
        x: f.x + (Math.random() - 0.5) * f.size * 0.6, y: f.y, z: f.z + (Math.random() - 0.5) * f.size * 0.6,
        vx: (Math.random() - 0.5) * 0.4, vy: 1.6 + Math.random(), vz: (Math.random() - 0.5) * 0.4,
        size: f.size * (0.5 + Math.random() * 0.5), frame: 0, color: Math.random() < 0.6 ? FIRE : FIRE2,
        life: 0.5 + Math.random() * 0.4, grav: -1, drag: 1.5, grow: -0.25,
      });
    }
  }

  /** Freeze the world for a moment so a hit lands HARD. */
  hitstop(seconds) { this.hitstopT = Math.max(this.hitstopT, seconds); }

  /** Slow time down: scale 0.3 means a third speed. */
  slowmo(scale, seconds) { this.slowScale = Math.min(this.slowScale, scale); this.slowT = Math.max(this.slowT, seconds); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fx.resize(w, h, this.camera);
  }

  frame() {
    const rawDt = this.clock.getDelta();
    const realDt = Math.min(0.05, rawDt);
    this.adaptResolution(rawDt);
    this.realTime += realDt;
    this.mats.update(realDt);

    // work out game time: frozen in hitstop, slowed in slow-mo
    let dt = 0;
    if (this.state === 'playing' || this.state === 'dead') {
      if (this.hitstopT > 0) {
        this.hitstopT -= realDt;
      } else {
        if (this.slowT > 0) { this.slowT -= realDt; if (this.slowT <= 0) this.slowScale = 1; }
        dt = realDt * this.slowScale;
      }
      this.time += dt;
    }
    if (this.state === 'dead') this.deadT += realDt;

    if (this.cinematic.active && this.state === 'playing') {
      // an execution is playing: it moves the camera and everything else waits
      this.cinematic.update(realDt);
      this.hud.update(realDt);
      this.fx.draw2d(realDt);
      this.input.endFrame();
      this.updateLights();
      this.post.render();
      return;
    }
    if (this.state === 'playing' || this.state === 'dead') {
      if (this.state === 'playing') {
        this.rig.look(this.input.dx, this.input.dy);
        if (this.input.pressed('KeyQ') || this.input.pressed('Mouse1') || this.input.pressed('Tab')) this.rig.toggleLock();
      }
      this.knight.update(dt, this.input);
      this.angels.update(dt);
      this.humans.update(dt);
      this.updateFires(dt);
      this.fx.update(dt, realDt);
      this.hud.update(realDt);
    } else {
      // on the menu: slowly circle the cathedral
      this.rig.yaw += realDt * 0.05;
      this.fx.update(0, realDt);
    }
    this.rig.update(realDt);
    this.world.update(this.camera);
    this.fx.draw2d(realDt);
    this.input.endFrame();
    this.updateLights();
    this.post.render();
  }
}

new Game();
