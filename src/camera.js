// =====================================================
// camera.js - the first-person camera
//
// You see through the knight's helm. The mouse turns your head (yaw =
// left/right, pitch = up/down) and the knight always faces where you look,
// so W is straight ahead and A / D sidestep. Locking on (Q or middle click)
// steers your gaze to keep the target in view.
//
// During an angel execution, cinematic.js takes the camera over instead.
// =====================================================
import * as THREE from 'three';
import { pickLock } from './combat.js';

const BASE_FOV = 74;
const EYE = 1.8;            // how high your eyes are above the ground (metres)
const MAX_PITCH = 1.35;     // how far you can look up and down

function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class CameraRig {
  constructor(game) {
    this.game = game;
    this.camera = game.camera;
    this.camera.rotation.order = 'YXZ';
    this.yaw = 0;
    this.pitch = 0;          // positive looks down
    this.lock = null;
    this.fovKick = 0;
    this.sensitivity = 0.0022;
    this.eyeDrop = 0;        // how far the eyes have sunk (kneeling, rolling, falling)
    this.tilt = 0;
    this.bobT = 0;
    this._v = new THREE.Vector3();
  }

  snap() {
    const k = this.game.knight;
    this.yaw = k.facing;
    this.pitch = 0;
    this.eyeDrop = 0;
    this.tilt = 0;
    this.lock = null;
  }

  look(dx, dy) {
    if (this.lock) dx *= 0.25;      // the lock does most of the steering
    this.yaw -= dx * this.sensitivity;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + dy * this.sensitivity));
  }

  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  right(out = new THREE.Vector3()) { return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }

  toggleLock() {
    if (this.lock) { this.lock = null; return; }
    this.lock = pickLock(this.game);
  }

  update(realDt) {
    const game = this.game, k = game.knight, cam = this.camera;

    // ---- lock-on: steer your gaze to the target ----
    if (this.lock) {
      const a = this.lock;
      if (!a.alive || a.removed || Math.hypot(a.pos.x - k.pos.x, a.pos.z - k.pos.z) > 40) {
        this.lock = null;
      } else {
        const aim = a.aimPoint(this._v);
        const want = Math.atan2(aim.x - k.pos.x, aim.z - k.pos.z);
        this.yaw = angleLerp(this.yaw, want, 1 - Math.exp(-realDt * 7));
        const flat = Math.hypot(aim.x - k.pos.x, aim.z - k.pos.z) || 1;
        const wantPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.atan2(k.pos.y + EYE - aim.y, flat)));
        this.pitch += (wantPitch - this.pitch) * (1 - Math.exp(-realDt * 5));
      }
    }
    // when you swing at something, your view is drawn onto it (aim assist)
    if (k.state === 'attack' && k.attack && k.attack.target && k.attack.target.alive) {
      this.yaw = angleLerp(this.yaw, k.facing, 1 - Math.exp(-realDt * 16));
    }

    // ---- how low are the eyes? ----
    let drop = 0, tilt = 0;
    if (k.state === 'steel') drop = 0.75;
    else if (k.state === 'roll') { drop = 0.55; tilt = 0.18; }
    else if (k.state === 'dead') { drop = Math.min(1.45, 0.5 + k.deadT * 2.2); tilt = 0.9; }
    else if (k.blocking) drop = 0.06;
    this.eyeDrop += (drop - this.eyeDrop) * (1 - Math.exp(-realDt * 9));
    this.tilt += (tilt - this.tilt) * (1 - Math.exp(-realDt * 6));

    // a little head bob when walking
    this.bobT += realDt * (2.5 + Math.hypot(k.vel.x, k.vel.z) * 1.55);
    const bob = Math.sin(this.bobT * 2) * 0.022 * k.walkAmt;
    const sway = Math.sin(this.bobT) * 0.012 * k.walkAmt;

    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    cam.position.set(
      k.pos.x + fx * 0.1 + rx * sway,
      k.pos.y + EYE - this.eyeDrop + bob,
      k.pos.z + fz * 0.1 + rz * sway,
    );
    cam.rotation.set(-this.pitch, this.yaw + Math.PI, this.tilt);

    // camera shake: "trauma" squared feels better than straight trauma
    const tr = game.fx.trauma, s = tr * tr;
    if (s > 0.0001) {
      const t = performance.now() / 1000;
      cam.position.x += (Math.sin(t * 71) + Math.sin(t * 113)) * 0.05 * s;
      cam.position.y += (Math.sin(t * 89) + Math.sin(t * 131)) * 0.05 * s;
      cam.rotation.z += Math.sin(t * 97) * 0.05 * s;
    }

    this.fovKick *= Math.exp(-realDt * 6);
    const sprint = k.state === 'move' && (game.input.key('ShiftLeft') || game.input.key('ShiftRight')) && k.walkAmt > 0.5 ? 4 : 0;
    this.sprintFov = (this.sprintFov || 0) + (sprint - (this.sprintFov || 0)) * (1 - Math.exp(-realDt * 5));
    const fov = BASE_FOV + this.fovKick + this.sprintFov + (k.state === 'charge' ? -5 * Math.min(1, k.stateT / 0.6) : 0);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
