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
import { Sketch, PAPER_HEX } from './sketch.js';
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

// We pick our own colours exactly, so turn off three.js colour conversion
THREE.ColorManagement.enabled = false;
const FIRE = new THREE.Color(0xe07a2c);
const FIRE2 = new THREE.Color(0xf0b43c);

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

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(PAPER_HEX);
    document.getElementById('view').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);
    this.scene.add(this.camera);

    this.sketch = new Sketch(this.renderer);
    this.post = new Post(this);
    this.fx = new FX(this);
    this.world = new World(this);
    this.sound = new Sound();
    this.knight = new Knight(this);
    this.angels = new Angels(this);
    this.humans = new Humans(this);
    this.cinematic = new Cinematic(this);
    this.hud = new HUD(this);
    this.rig = new CameraRig(this);
    this.rig.snap();

    this.input = new Input();
    this.bindMenus();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    makePaperGrain();

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
    this.sketch.shared.uRiftGlow.value = 0;
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
    const realDt = Math.min(0.05, this.clock.getDelta());
    this.realTime += realDt;
    this.sketch.update(realDt);

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
      this.post.render(this.scene, this.camera);
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
    this.post.render(this.scene, this.camera);
  }
}

/** Paper texture: speckles and fibres, laid over the whole screen. */
function makePaperGrain() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random();
    const dark = v < 0.5 ? 60 + v * 100 : 255;
    img.data[i] = dark; img.data[i + 1] = dark * 0.95; img.data[i + 2] = dark * 0.85;
    img.data[i + 3] = v < 0.5 ? Math.random() * 40 : Math.random() * 25;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(120,100,70,0.12)';
  for (let i = 0; i < 70; i++) {
    g.lineWidth = Math.random() * 1.2;
    const x = Math.random() * 256, y = Math.random() * 256, a = Math.random() * 6.28, l = 6 + Math.random() * 22;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.5) * l * 0.5, y + Math.sin(a + 0.5) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  const url = c.toDataURL();
  for (const id of ['paper', 'start-screen', 'dead-screen']) {
    const el = document.getElementById(id);
    if (el) el.style.backgroundImage = `url(${url})`;
  }
}

new Game();
