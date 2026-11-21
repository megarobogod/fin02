// =====================================================
// camera.js - the over-the-shoulder camera
//
// The mouse turns the camera (yaw = left/right, pitch = up/down). The knight
// walks relative to where the camera points. Locking on (Q or middle click)
// swings the camera round to keep your target in view.
// =====================================================
import * as THREE from 'three';
import { pickLock } from './combat.js';

const BASE_FOV = 62;

function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class CameraRig {
  constructor(game) {
    this.game = game;
    this.camera = game.camera;
    this.yaw = 0;
    this.pitch = 0.3;
    this.dist = 5.4;
    this.focus = new THREE.Vector3();
    this.lock = null;
    this.fovKick = 0;
    this.sensitivity = 0.0024;
    this._v = new THREE.Vector3();
    this._look = new THREE.Vector3();
  }

  snap() {
    const k = this.game.knight;
    this.yaw = k.facing;
    this.focus.set(k.pos.x, k.pos.y + 1.55, k.pos.z);
    this.lock = null;
  }

  look(dx, dy) {
    if (this.lock) dx *= 0.25;      // the lock does most of the steering
    this.yaw -= dx * this.sensitivity;
    this.pitch = Math.max(-0.25, Math.min(1.05, this.pitch + dy * this.sensitivity * 0.9));
  }

  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  right(out = new THREE.Vector3()) { return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }

  toggleLock() {
    if (this.lock) { this.lock = null; return; }
    this.lock = pickLock(this.game);
  }

  update(realDt) {
    const game = this.game, k = game.knight, cam = this.camera;
    const target = this._v.set(k.pos.x, k.pos.y + 1.55, k.pos.z);
    this.focus.lerp(target, 1 - Math.exp(-realDt * 14));

    if (this.lock) {
      const a = this.lock;
      if (!a.alive || a.removed || Math.hypot(a.pos.x - k.pos.x, a.pos.z - k.pos.z) > 40) {
        this.lock = null;
      } else {
        const want = Math.atan2(a.pos.x - k.pos.x, a.pos.z - k.pos.z);
        this.yaw = angleLerp(this.yaw, want, 1 - Math.exp(-realDt * 6));
      }
    }

    const dist = this.lock ? 6.3 : 5.4;
    this.dist += (dist - this.dist) * (1 - Math.exp(-realDt * 4));
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    const sh = 0.55;   // look over the right shoulder
    cam.position.set(
      this.focus.x - fx * this.dist * cp + rx * sh,
      this.focus.y + this.dist * sp,
      this.focus.z - fz * this.dist * cp + rz * sh,
    );
    const ground = game.world.heightAt(cam.position.x, cam.position.z) + 0.5;
    if (cam.position.y < ground) cam.position.y = ground;

    this._look.set(this.focus.x + rx * sh, this.focus.y, this.focus.z + rz * sh);
    cam.lookAt(this._look);

    // camera shake: "trauma" squared feels better than straight trauma
    const tr = game.fx.trauma, s = tr * tr;
    if (s > 0.0001) {
      const t = performance.now() / 1000;
      cam.position.x += (Math.sin(t * 71) + Math.sin(t * 113)) * 0.12 * s;
      cam.position.y += (Math.sin(t * 89) + Math.sin(t * 131)) * 0.12 * s;
      cam.rotation.z += Math.sin(t * 97) * 0.05 * s;
    }

    this.fovKick *= Math.exp(-realDt * 6);
    const fov = BASE_FOV + this.fovKick + (k.state === 'charge' ? -4 * Math.min(1, k.stateT / 0.6) : 0);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
