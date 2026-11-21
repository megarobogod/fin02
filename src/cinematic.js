// =====================================================
// cinematic.js - the execution of an angel
//
// When you land the killing blow on an angel, the game stops and plays a
// short film. Everything is timed by T (seconds since the blow):
//
//   0.00  THE BLOW    the world freezes; impact frames flash ink/paper/gold
//   0.45  THE LEAP    cinema bars; low angle; you crouch and leap, sword high
//   1.60  THE STRIKE  close-up; you drive the sword down into its heart
//   2.60  UNMAKING    its wings tear away, the halo shatters, then it bursts
//                     into a pillar of light
//   4.10  AFTERMATH   you kneel in a storm of feathers; UNMADE
//   6.40  back to the game
//
// The camera is moved by hand for each shot ("cut" = jump to a new angle).
// =====================================================
import * as THREE from 'three';
import { ICHOR, WHITE, INK } from './fx.js';

const END = 6.4;
const STRIKE = 1.78;      // the moment the sword goes in
const BURST = 3.55;       // the moment the angel comes apart

const ease = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const span = (T, a, b) => clamp01((T - a) / (b - a));

export class Cinematic {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.card = document.getElementById('title-card');
  }

  play(angel) {
    const g = this.game, k = g.knight;
    this.active = true;
    this.t = 0;
    this.angel = angel;
    this.fired = new Set();
    g.rig.lock = null;
    g.hitstopT = 0;
    g.slowT = 0;
    g.slowScale = 1;

    // directions: from you to the angel, and sideways
    const dir = new THREE.Vector3(angel.pos.x - k.pos.x, 0, angel.pos.z - k.pos.z);
    if (dir.lengthSq() < 0.01) k.forward(dir);
    dir.normalize();
    this.dir = dir;
    this.side = new THREE.Vector3(dir.z, 0, -dir.x);
    if (Math.random() < 0.5) this.side.negate();

    angel.root.updateMatrixWorld(true);
    this.heart = angel.lockPoint.getWorldPosition(new THREE.Vector3());
    this.ground = g.world.heightAt(angel.pos.x, angel.pos.z);
    this.k0 = k.pos.clone();
    // where you'll be when the sword goes in: just in front of the heart, a bit above it
    this.strikeAt = this.heart.clone().addScaledVector(dir, -1.15);
    this.strikeAt.y = this.heart.y - 0.75;
    // where you land: back a few steps, facing it
    this.landAt = new THREE.Vector3(angel.pos.x, 0, angel.pos.z).addScaledVector(dir, -4.2).addScaledVector(this.side, 0.6);
    g.world.resolveCircle(this.landAt, 0.45);
    this.landAt.y = g.world.heightAt(this.landAt.x, this.landAt.z);

    k.state = 'cine';
    k.attack = null;
    k.blocking = false;
    k.invuln = 99;
    k.vel.set(0, 0, 0);
    k.lunge.set(0, 0, 0);
    k.facing = Math.atan2(dir.x, dir.z);

    this.camStart = g.camera.position.clone();
    this.lookStart = this.heart.clone();
    g.hud.hide();
    g.sound.finisherHit();
    g.fx.burst(this.heart, 3, ICHOR);
    g.fx.shards(this.heart, 20, ICHOR, 1.2);
    g.fx.shake(0.8);
  }

  /** Do something once, the first frame T passes "at". */
  once(name, at, fn) {
    if (this.t >= at && !this.fired.has(name)) { this.fired.add(name); fn(); }
  }

  update(realDt) {
    const g = this.game, k = g.knight, a = this.angel, cam = g.camera, post = g.post, fx = g.fx;
    this.t += realDt;
    const T = this.t;

    // ---------------------------------------------------------- the screen
    // impact frames: flick between modes for a few frames at a time
    let impact = 0;
    const flick = (at, seq) => {
      const i = Math.floor((T - at) / 0.06);
      if (T >= at && i < seq.length) impact = seq[i];
    };
    flick(0, [3, 3, 1, 2, 2, 3]);
    flick(STRIKE, [3, 1, 1, 2, 3, 3, 2]);
    flick(BURST, [1, 3, 3, 2]);
    post.impact = impact;
    post.speed = Math.max(0, 1 - T * 2.2) + (T > STRIKE && T < STRIKE + 0.45 ? 1 - (T - STRIKE) / 0.45 : 0) + (T > BURST && T < BURST + 0.5 ? 1 - (T - BURST) / 0.5 : 0);
    post.bars = T < 0.2 ? 0 : T < END - 0.8 ? Math.min(1, (T - 0.2) * 3) : Math.max(0, (END - T) / 0.8);
    post.slow = T < 0.3 ? 0 : T < END - 1.2 ? Math.min(1, (T - 0.3) * 2) : Math.max(0, (END - T) / 1.2);
    post.blur = T > STRIKE && T < STRIKE + 0.3 ? 0.06 * (1 - (T - STRIKE) / 0.3) : T > BURST && T < BURST + 0.4 ? 0.09 * (1 - (T - BURST) / 0.4) : 0;
    post.flash = T > BURST && T < BURST + 0.5 ? 1 - (T - BURST) / 0.5 : 0;

    // ---------------------------------------------------------- slow world time
    // particles and debris keep drifting, very slowly
    let worldSpeed = 0;
    if (T < 0.45) worldSpeed = 0;
    else if (T < STRIKE) worldSpeed = 0.2;
    else if (T < STRIKE + 0.3) worldSpeed = 0.02;
    else if (T < BURST) worldSpeed = 0.18;
    else if (T < BURST + 0.25) worldSpeed = 0.05;
    else worldSpeed = 0.18 + span(T, BURST + 0.25, END) * 0.6;
    fx.update(realDt * worldSpeed, realDt);
    g.world.update(cam);

    // ---------------------------------------------------------- the knight
    const heartY = this.heart.y;
    if (T < 0.45) {
      k.cine('idle', 'S3b', 1, 'stand', 0);
    } else if (T < 0.8) {
      // crouch, gathering for the leap
      const c = ease(span(T, 0.45, 0.8));
      k.pos.copy(this.k0);
      k.cine('S3b', 'crouchArms', c, 'crouch', c * 0.38);
    } else if (T < STRIKE) {
      // up into the air on an arc, sword raised high
      const s = span(T, 0.8, STRIKE);
      const peak = this.strikeAt.y + 1.4;
      k.pos.lerpVectors(this.k0, this.strikeAt, ease(s));
      k.pos.y = THREE.MathUtils.lerp(this.k0.y, this.strikeAt.y, s) + Math.sin(s * Math.PI) * (peak - this.strikeAt.y) * 0.9 + (s > 0.6 ? 0 : 0);
      k.cine('crouchArms', 'raise', ease(Math.min(1, s * 2)), 'tuck', 0);
      k.capeLift = 1.2;
    } else if (T < STRIKE + 0.55) {
      // the plunge: hang there, sword buried
      k.pos.copy(this.strikeAt);
      k.cine('raise', 'plunge', ease(span(T, STRIKE - 0.06, STRIKE + 0.04)), 'tuck', 0);
    } else if (T < 2.75) {
      // rip it out and spring backwards to land
      const s = span(T, STRIKE + 0.55, 2.75);
      k.pos.lerpVectors(this.strikeAt, this.landAt, ease(s));
      k.pos.y = THREE.MathUtils.lerp(this.strikeAt.y, this.landAt.y, easeIn(s)) + Math.sin(s * Math.PI) * 0.8;
      k.cine('plunge', 'kneel', ease(s), s < 0.7 ? 'tuck' : 'kneel', s > 0.7 ? (s - 0.7) / 0.3 * 0.45 : 0);
    } else {
      k.pos.copy(this.landAt);
      k.cine('kneel', 'kneel', 1, 'kneel', 0.45);
      k.capeLift = 0.3 + Math.sin(T * 3) * 0.15;
    }
    k.facing = Math.atan2(this.dir.x, this.dir.z);
    k.updateCineVisuals(realDt);

    // ---------------------------------------------------------- the angel
    if (!a.removed) {
      const rear = T < 0.45 ? 0 : Math.min(1, (T - 0.45) * 3);
      a.body.rotation.x = -0.35 * rear + (T > STRIKE ? Math.sin(T * 50) * 0.03 : 0);
      a.flash.value = T > STRIKE ? 0.4 + 0.4 * Math.sin(T * 40) : T < 0.2 ? 1 : 0;
      if (a.heart) a.heart.scale.setScalar(1 + rear * 0.4 + (T > STRIKE ? (T - STRIKE) * 1.5 : 0));
      if (a.wings) a.animWings(realDt, rear * 0.9);
      if (a.outerSpin) { a.outerSpin.rotation.z += realDt * 0.4; a.innerSpin.rotation.z -= realDt * 0.5; }
      if (a.slit) a.slit.scale.y = 1 + rear * 2;
      // light leaks out of the wound
      if (T > STRIKE && T < BURST) {
        this.leakT = (this.leakT || 0) - realDt;
        if (this.leakT <= 0) {
          this.leakT = 0.07;
          fx.burst(this.heart.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.6)), 0.35 + Math.random() * 0.35, ICHOR);
        }
      }
    }

    // ---------------------------------------------------------- events
    this.once('leap', 0.8, () => { g.sound.whoosh(); fx.dust(this.k0, 5, 1.4); fx.crack(this.k0.x, this.k0.z, 2.2); });
    this.once('strike', STRIKE, () => {
      g.sound.finisherHit();
      fx.ichor(this.heart, this.dir, 40, 1.6);
      fx.shards(this.heart, 30, WHITE, 1.4);
      fx.burst(this.heart, 4, ICHOR);
      fx.word('PIERCED', this.heart.clone().add(new THREE.Vector3(0, 0.8, 0)), '#f0b43c', 1.6);
      fx.shake(1);
    });
    this.once('rip', STRIKE + 0.55, () => { g.sound.swing(true); fx.ichor(this.heart, this.dir.clone().negate(), 24, 1.2); });
    this.once('land', 2.72, () => { g.sound.slam(); fx.dust(this.landAt, 5, 1.2); fx.crack(this.landAt.x, this.landAt.z, 2.6); });
    // the wings tear off one at a time, then the halo shatters
    if (a.debrisParts) {
      a.debrisParts.forEach((o, i) => {
        this.once('tear' + i, 2.75 + i * 0.16, () => {
          if (a.removed) return;
          a.root.updateMatrixWorld(true);
          const out = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).sub(a.root.position).setY(0).normalize();
          fx.addDebris(o, new THREE.Vector3(out.x * 7, 5 + Math.random() * 3, out.z * 7), new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6), 0.15);
          fx.feathers(o.getWorldPosition(new THREE.Vector3()), 10, 0.8);
          fx.ichor(o.getWorldPosition(new THREE.Vector3()), out, 10, 1);
          g.sound.haloSnap();
        });
      });
    }
    this.once('burst', BURST, () => {
      const c = this.heart;
      g.sound.unmakeBig();
      fx.beam(a.pos.x, a.pos.z, 3.2);
      fx.ring(a.pos.x, a.pos.z, { speed: 26, max: 30 });
      fx.ring(a.pos.x, a.pos.z, { speed: 16, max: 20, color: 0x1d1913 });
      fx.feathers(c, 120, 3);
      fx.shards(c, 50, WHITE, 2);
      fx.shards(c, 30, ICHOR, 2);
      fx.ichor(c, this.dir, 40, 2);
      fx.burst(c, 6, ICHOR);
      fx.decal(a.pos.x, a.pos.z, 9, ICHOR);
      fx.crack(a.pos.x, a.pos.z, 7);
      fx.shake(1);
      a.dispose();
      for (const p of g.humans.list) {
        // anyone close is thrown off their feet
        const d = Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z);
        if (d < 12 && p.alive) p.knock.set((p.pos.x - a.pos.x) / d * 8, 0, (p.pos.z - a.pos.z) / d * 8);
      }
    });
    this.once('title', 4.2, () => {
      this.card.querySelector('.big').textContent = 'Unmade';
      this.card.querySelector('.small').textContent = a.def.title;
      this.card.classList.add('show');
    });
    this.once('untitle', END - 0.9, () => this.card.classList.remove('show'));

    // ---------------------------------------------------------- the camera
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    let fov = 50;
    if (T < 0.45) {
      // push in hard on the blow
      const s = ease(span(T, 0, 0.45));
      pos.lerpVectors(this.camStart, this.heart.clone().addScaledVector(this.dir, -3).add(up.clone().multiplyScalar(0.3)), s * 0.35);
      look.copy(this.heart);
      fov = 62 - s * 12;
    } else if (T < 1.6) {
      // SHOT: low behind the knight, looking up at the angel
      const s = span(T, 0.45, 1.6);
      pos.copy(this.k0).addScaledVector(this.dir, -2.4 - s * 0.6).addScaledVector(this.side, 1.5).setY(this.ground + 0.35);
      look.copy(this.heart).add(up.clone().multiplyScalar(0.6 + s * 0.6));
      fov = 48 - s * 4;
    } else if (T < 2.75) {
      // SHOT: side-on close-up of the strike
      const s = span(T, 1.6, 2.75);
      const mid = this.heart.clone().lerp(this.strikeAt, 0.4);
      pos.copy(mid).addScaledVector(this.side, 5.0 - s * 0.6).addScaledVector(this.dir, -0.6).add(up.clone().multiplyScalar(0.45));
      look.copy(mid).add(up.clone().multiplyScalar(0.3));
      fov = 42;
    } else if (T < 4.1) {
      // SHOT: wide, slowly circling both of them
      const s = span(T, 2.75, 4.1);
      const c = new THREE.Vector3().lerpVectors(this.landAt, new THREE.Vector3(a.pos.x, this.ground, a.pos.z), 0.5);
      const ang = Math.atan2(this.side.x, this.side.z) + 0.6 - s * 0.9;
      pos.set(c.x + Math.sin(ang) * 8, this.ground + 1.4 + s * 0.8, c.z + Math.cos(ang) * 8);
      look.copy(c).add(up.clone().multiplyScalar(1.6));
      fov = 55;
    } else {
      // SHOT: low, in front of the kneeling knight, pushing in
      const s = span(T, 4.1, END);
      // (off to the side, so the camera isn't inside the pillar of light)
      pos.copy(this.landAt).addScaledVector(this.dir, 1.1).addScaledVector(this.side, -(2.7 - s * 0.6)).setY(this.landAt.y + 0.55);
      look.copy(this.landAt).add(up.clone().multiplyScalar(0.95)).addScaledVector(this.dir, 0.2);
      fov = 46 - s * 4;
    }
    // shake on the big moments
    const tr = fx.trauma * fx.trauma;
    pos.x += (Math.random() - 0.5) * tr * 0.3;
    pos.y += (Math.random() - 0.5) * tr * 0.3;
    fx.trauma = Math.max(0, fx.trauma - realDt * 1.2);
    cam.position.copy(pos);
    cam.lookAt(look);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }

    if (T >= END) this.finish();
  }

  finish() {
    const g = this.game, k = g.knight;
    this.active = false;
    const post = g.post;
    post.impact = post.speed = post.bars = post.slow = post.blur = post.flash = 0;
    this.card.classList.remove('show');
    k.state = 'move';
    k.stateT = 0;
    k.invuln = 0.5;
    k.capeLift = 0;
    k.hp = k.maxHp;
    k.addResolve(3);
    k.stamina = k.maxStamina;
    k.pos.copy(this.landAt);
    k.poseFrom = { ...k.pose };
    g.angels.onUnmade(this.angel);
    g.hud.show();
    g.rig.yaw = k.facing;
    g.slowmo(0.5, 0.6);
    g.hud.hint('The angel is unmade. Your wounds close.', 4);
  }
}
