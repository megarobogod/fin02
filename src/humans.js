// =====================================================
// humans.js - the people still living in the ruins
//
// CIVILIANS hide in camps or wander the streets looking for food. They run
// from raiders and angels. Save one from a raider and they'll thank you
// (and patch you up a little).
//
// RAIDERS rule the streets in gangs:
//   thug    - machete. Fast, fragile. Hit the head for double damage.
//   archer  - crossbow. Keeps its distance. You can parry a bolt.
//   brute   - huge, slow, sledgehammer, steel helmet (your sword bounces off
//             it). Its weak spot is its unarmoured BACK: roll behind it.
// Raiders hunt civilians. When they see you, they come for you instead,
// and if enough of a gang dies they lose their nerve and run.
//
// People only exist near you: camps fill up as you approach and empty again
// when you leave, so the whole city doesn't have to be simulated at once.
// =====================================================
import * as THREE from 'three';
import { lathe, capsule, rbox, plate } from './shapes.js';
import { INK, WHITE, BLOOD } from './fx.js';
import { KIND } from './combat.js';

const KINDS = {
  civilian: { hp: 30, walk: 1.6, run: 5.0, radius: 0.35 },
  thug: { hp: 40, walk: 2.2, run: 5.4, radius: 0.4, damage: 11, reach: 1.8, windup: 0.5, rest: [1.1, 2.0] },
  archer: { hp: 35, walk: 2.0, run: 5.0, radius: 0.4, damage: 13, range: 20, windup: 0.95, rest: [2.0, 3.2] },
  brute: { hp: 140, walk: 1.8, run: 3.8, radius: 0.55, damage: 26, reach: 2.4, windup: 0.85, rest: [2.0, 3.0], scale: 1.28 },
};

const SPAWN_NEAR = 110;    // camps fill up when you get this close
const DESPAWN_FAR = 150;   // ...and empty when you get this far away

function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------- shared shapes (made once) ----------
let G = null;
function shapes() {
  if (G) return G;
  G = {
    torso: lathe([[0.0, -0.02], [0.17, -0.02], [0.19, 0.12], [0.21, 0.32], [0.19, 0.46], [0.11, 0.54], [0.0, 0.55]], 16, 0.7),
    pelvis: lathe([[0.0, 0.06], [0.17, 0.06], [0.18, -0.08], [0.14, -0.14], [0.0, -0.14]], 14, 0.75),
    coat: lathe([[0.2, 0.36], [0.22, 0.1], [0.25, -0.2], [0.29, -0.5]], 16, 0.75),
    head: new THREE.SphereGeometry(0.12, 16, 12),
    hood: new THREE.SphereGeometry(0.15, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
    hair: new THREE.SphereGeometry(0.128, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.45),
    upper: capsule(0.055, 0.29, 0.065),
    fore: capsule(0.045, 0.27, 0.05),
    hand: new THREE.SphereGeometry(0.045, 10, 8),
    thigh: capsule(0.075, 0.42, 0.085),
    shin: capsule(0.058, 0.42, 0.065),
    foot: rbox(0.1, 0.07, 0.24, 0.03),
    scarf: new THREE.TorusGeometry(0.1, 0.04, 8, 16),
    pack: rbox(0.28, 0.34, 0.14, 0.05),
    mask: rbox(0.17, 0.13, 0.08, 0.035),
    filter: new THREE.CylinderGeometry(0.04, 0.045, 0.06, 12),
    spike: new THREE.ConeGeometry(0.03, 0.14, 8),
    pad: new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    helmet: lathe([[0.0, 0.2], [0.11, 0.19], [0.145, 0.12], [0.15, -0.06], [0.155, -0.12]], 18),
    // weapons
    machete: plate([[-0.025, 0], [0.025, 0], [0.04, -0.4], [0.0, -0.5], [-0.03, -0.42]], 0.006, 0.004),
    handle: new THREE.CylinderGeometry(0.018, 0.02, 0.13, 8),
    shaft: new THREE.CylinderGeometry(0.025, 0.028, 1.1, 8),
    hammer: rbox(0.14, 0.14, 0.3, 0.03),
    stock: rbox(0.06, 0.07, 0.5, 0.02),
    bow: new THREE.TorusGeometry(0.28, 0.014, 6, 16, Math.PI * 0.8),
    bolt: new THREE.CylinderGeometry(0.01, 0.01, 0.45, 5),
    shadow: new THREE.CircleGeometry(0.5, 14),
  };
  G.shaft.translate(0, -0.45, 0);
  G.bolt.rotateX(Math.PI / 2);
  return G;
}

const CIV_CLOTH = [0x6d6658, 0x7a6450, 0x5e6a70, 0x6b5d6e, 0x8a7a5c, 0x5a6250, 0x7e6a64];
const RAIDER_CLOTH = [0x3e3832, 0x4a3f36, 0x35322e, 0x4f4540];
const SKIN = [0xc9a88a, 0xb48a6a, 0x8c654c, 0xd8b89a, 0x6e4c38];

let nextId = 1;

class Person {
  constructor(game, owner, kind, x, z, home) {
    this.game = game;
    this.owner = owner;
    this.kind = kind;
    this.def = KINDS[kind];
    this.id = nextId++;
    this.hostile = kind !== 'civilian';
    this.hp = this.def.hp;
    this.radius = this.def.radius;
    this.pos = new THREE.Vector3(x, game.world.heightAt(x, z), z);
    this.vel = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.home = home || { x, z };
    this.flash = { value: 0 };
    this.parts = [];
    this.alive = true;
    this.removed = false;
    this.state = 'idle';
    this.stateT = 0;
    this.t = Math.random() * 10;
    this.walkPhase = Math.random() * 6;
    this.cd = 0.5 + Math.random();
    this.perceiveT = Math.random() * 0.4;
    this.fear = 0;
    this.target = null;
    this.goal = null;
    this.build();
  }

  // ================================================================ model
  build() {
    const S = this.game.sketch, g = shapes();
    const isRaider = this.hostile;
    const cloth = S.fill(isRaider ? pick(RAIDER_CLOTH) : pick(CIV_CLOTH), { flash: this.flash });
    const cloth2 = S.fill(isRaider ? 0x5a4a3c : pick(CIV_CLOTH), { flash: this.flash });
    const skin = S.fill(pick(SKIN), { flash: this.flash });
    const leather = S.fill(0x4a3a2c, { flash: this.flash });
    const metal = S.fill(0x7d8084, { flash: this.flash });
    const add = (geo, m, parent, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };
    const joint = (parent, x, y, z) => { const j = new THREE.Group(); j.position.set(x, y, z); j.rotation.order = 'YXZ'; parent.add(j); return j; };

    this.root = new THREE.Group();
    this.game.scene.add(this.root);
    this.body = joint(this.root, 0, 0, 0);
    if (this.def.scale) this.body.scale.setScalar(this.def.scale);
    const hips = joint(this.body, 0, 0.92, 0);
    add(g.pelvis, cloth2, hips);
    const torso = joint(hips, 0, 0.05, 0);
    add(g.torso, cloth, torso);
    if (!isRaider || Math.random() < 0.4) add(g.coat, cloth, torso).scale.set(1, 1, 1);
    const head = joint(torso, 0, 0.6, 0);
    add(g.head, skin, head, 0, 0.1, 0).scale.set(0.95, 1.1, 1);
    const style = Math.random();
    if (this.kind === 'brute') {
      add(g.helmet, metal, head, 0, 0.1, 0);
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.04), S.glow(0x15120e));
      slit.position.set(0, 0.13, 0.14);
      head.add(slit);
    } else if (isRaider) {
      if (style < 0.5) {
        add(g.mask, leather, head, 0, 0.06, 0.1);
        for (const s of [-1, 1]) add(g.filter, metal, head, s * 0.06, 0.03, 0.15).rotation.x = Math.PI / 2;
      }
      if (style > 0.3) add(g.hood, cloth, head, 0, 0.09, -0.01);
      else for (let i = 0; i < 5; i++) add(g.spike, leather, head, 0, 0.2 + Math.sin(i / 4 * Math.PI) * 0.02, -0.1 + i * 0.05).rotation.x = -0.3 + i * 0.15;
    } else {
      if (style < 0.5) add(g.hood, cloth2, head, 0, 0.09, -0.01);
      else add(g.hair, S.fill(pick([0x2e241c, 0x5a4532, 0x8a7a68, 0x3d3530])), head, 0, 0.12, -0.01);
      if (Math.random() < 0.5) add(g.scarf, cloth2, head, 0, -0.03, 0).rotation.x = Math.PI / 2;
      if (Math.random() < 0.4) add(g.pack, cloth2, torso, 0, 0.3, -0.18);
    }
    if (isRaider) {
      // a spiked shoulder pad made of scrap
      const pad = add(g.pad, metal, torso, -0.2, 0.47, 0);
      pad.rotation.z = 0.4;
      for (let i = 0; i < 3; i++) add(g.spike, metal, pad, -0.03 + i * 0.03, 0.08, -0.04 + i * 0.04).rotation.z = 0.3;
    }

    const arm = (side) => {
      const sh = joint(torso, side * 0.24, 0.47, 0);
      add(g.upper, cloth, sh);
      const el = joint(sh, 0, -0.29, 0);
      add(g.fore, cloth, el);
      add(g.hand, skin, el, 0, -0.29, 0);
      return { sh, el };
    };
    const R = arm(-1), L = arm(1);
    const legs = [];
    for (const s of [1, -1]) {
      const hip = joint(this.body, s * 0.1, 0.88, 0);
      add(g.thigh, cloth2, hip);
      const knee = joint(hip, 0, -0.42, 0);
      add(g.shin, cloth2, knee);
      add(g.foot, leather, knee, 0, -0.42, 0.05);
      legs.push({ hip, knee });
    }

    // weapon in the right hand
    const hand = joint(R.el, 0, -0.29, 0);
    if (this.kind === 'thug') {
      add(g.handle, leather, hand, 0, 0, 0);
      add(g.machete, metal, hand, 0, -0.06, 0).rotation.y = Math.PI / 2;
    } else if (this.kind === 'brute') {
      add(g.shaft, S.fill(0x5b4a3a), hand, 0, 0.3, 0);
      add(g.hammer, metal, hand, 0, -0.62, 0.0).rotation.x = Math.PI / 2;
    } else if (this.kind === 'archer') {
      const xb = joint(hand, 0, 0, 0);
      add(g.stock, S.fill(0x5b4a3a), xb, 0, 0, 0.15);
      add(g.bow, metal, xb, 0, 0.02, 0.36).rotation.set(Math.PI / 2, 0, Math.PI * 0.6);
      this.xbow = xb;
    }

    // a soft ink shadow
    const sh = new THREE.Mesh(g.shadow, this.owner.shadowMat);
    sh.rotation.x = -Math.PI / 2;
    sh.renderOrder = 2;
    this.game.scene.add(sh);
    this.shadow = sh;

    this.j = { hips, torso, head, armR: R.sh, elbowR: R.el, armL: L.sh, elbowL: L.el, hand };
    this.legs = legs;

    // where the sword can land
    if (this.hostile) {
      const sc = this.def.scale || 1;
      const mk = (parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; };
      if (this.kind === 'brute') {
        this.addPart('helmet', mk(head, 0, 0.1, 0), 0.17 * sc, 'armor');
        this.addPart('back', mk(torso, 0, 0.3, -0.2), 0.2 * sc, 'weak', { mult: 2.2 });
      } else {
        this.addPart('head', mk(head, 0, 0.1, 0), 0.15 * sc, 'weak', { mult: 2 });
      }
      this.addPart('chest', mk(torso, 0, 0.3, 0), 0.24 * sc, 'body', { mult: 1 });
      this.addPart('belly', mk(hips, 0, 0, 0), 0.22 * sc, 'body', { mult: 1 });
      this.addPart('legs', mk(this.body, 0, 0.5, 0), 0.2 * sc, 'body', { mult: 0.8 });
      this.lockPoint = this.parts[1].obj;
    }
  }

  addPart(name, obj, r, kind, extra = {}) {
    const p = { name, obj, r, kind, wp: new THREE.Vector3(), broken: false, active: () => true, ...extra };
    this.parts.push(p);
    return p;
  }
  hittable() { return this.alive; }
  updateParts() {
    this.root.updateMatrixWorld(true);
    for (const p of this.parts) p.obj.getWorldPosition(p.wp);
  }
  aimPoint(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.2 * (this.def.scale || 1), this.pos.z);
  }
  center(out = new THREE.Vector3()) { return this.aimPoint(out); }
  chest(out = new THREE.Vector3()) { return this.aimPoint(out); }
  setState(s) { this.state = s; this.stateT = 0; }

  bark(text) {
    if (Math.random() < 0.6) this.game.fx.word(text, this.aimPoint().add(new THREE.Vector3(0, 0.9, 0)), this.hostile ? '#c9412f' : '#fbf7ec', 0.45);
  }

  // ================================================================ being hurt
  /** Hit by a raider, an angel, or a crossbow bolt. */
  takeHit(h) {
    if (!this.alive) return 'none';
    this.hp -= h.damage;
    this.flash.value = 1;
    const dx = this.pos.x - h.from.x, dz = this.pos.z - h.from.z;
    const d = Math.hypot(dx, dz) || 1;
    this.knock.set((dx / d) * 5, 0, (dz / d) * 5);
    this.game.fx.blood(this.aimPoint(), new THREE.Vector3(dx / d, 0, dz / d), 10);
    if (this.hp <= 0) this.die(h.by || 'other', new THREE.Vector3(dx / d, 0, dz / d), h.damage > 30);
    else if (this.hostile) { this.setState('stagger'); this.staggerDur = 0.4; }
    else if (this.state !== 'flee') this.setState('cower');
    return 'hit';
  }

  die(by, dir, big) {
    this.alive = false;
    this.setState('dead');
    this.deathDir = dir || new THREE.Vector3(0, 0, 1);
    this.deathSpin = (Math.random() - 0.5) * 2;
    this.fall = 0;
    this.knock.addScaledVector(this.deathDir, big ? 9 : 4);
    this.flyUp = big ? 4 : 1.5;
    this.lift = 0;
    this.game.fx.decal(this.pos.x + this.deathDir.x * 1.2, this.pos.z + this.deathDir.z * 1.2, 1.6 + Math.random(), BLOOD);
    this.owner.onDeath(this, by);
  }

  // ================================================================ every frame
  update(dt) {
    const game = this.game;
    this.t += dt;
    this.stateT += dt;
    this.flash.value = Math.max(0, this.flash.value - dt * 5);
    let speed = 0, face = null;

    if (this.state === 'dead') {
      this.updateDead(dt);
    } else {
      this.perceiveT -= dt;
      if (this.perceiveT <= 0) { this.perceiveT = 0.4; this.perceive(); }
      [speed, face] = this.hostile ? this.thinkRaider(dt) : this.thinkCivilian(dt);
    }

    // movement: head for this.goal at "speed"
    if (this.alive) {
      let tx = 0, tz = 0;
      if (this.goal && speed > 0) {
        const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.3) { tx = (dx / d) * speed; tz = (dz / d) * speed; }
        if (face === null && d > 0.3) face = Math.atan2(dx, dz);
      }
      const k = 1 - Math.exp(-dt * 8);
      this.vel.x += (tx - this.vel.x) * k;
      this.vel.z += (tz - this.vel.z) * k;
      if (face !== null) this.yaw = angleLerp(this.yaw, face, 1 - Math.exp(-dt * 9));
    }
    this.pos.x += (this.vel.x + this.knock.x) * dt;
    this.pos.z += (this.vel.z + this.knock.z) * dt;
    this.knock.multiplyScalar(Math.exp(-dt * (this.alive ? 6 : 3)));
    game.world.resolveCircle(this.pos, this.radius);
    const lim = game.world.limit;
    this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x));
    this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));
    this.pos.y = game.world.heightAt(this.pos.x, this.pos.z);

    this.animate(dt, Math.hypot(this.vel.x, this.vel.z));
  }

  /** Look around: who is nearby, and are they a danger? (runs a few times a second) */
  perceive() {
    const game = this.game, k = game.knight;
    const dk = Math.hypot(k.pos.x - this.pos.x, k.pos.z - this.pos.z);
    this.knightDist = dk;
    this.seesKnight = k.alive && dk < 26 && (dk < 7 || game.world.lineClear(this.pos.x, this.pos.z, k.pos.x, k.pos.z));
    // the nearest angel: everyone is terrified of them
    this.angel = null;
    for (const a of game.angels.list) {
      if (!a.alive) continue;
      const d = Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z);
      if (d < 55 && (!this.angel || d < this.angelDist)) { this.angel = a; this.angelDist = d; }
    }
  }

  // ---------------------------------------------------------------- raiders
  thinkRaider(dt) {
    const game = this.game, k = game.knight, def = this.def;
    let speed = 0, face = null;
    const st = this.state;

    if (this.angel && st !== 'flee' && st !== 'stagger' && this.kind !== 'brute') {
      this.flee(this.angel.pos, 'ANGEL!');
    }

    switch (st) {
      case 'idle':
      case 'roam': {
        // wander round the camp, or along the streets if part of a roaming gang
        if (!this.goal || Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z) < 1 || this.stateT > 9) {
          this.goal = this.roaming ? this.owner.nextNode(this.pos, this.goal) : { x: this.home.x + (Math.random() - 0.5) * 14, z: this.home.z + (Math.random() - 0.5) * 14 };
          this.stateT = 0;
        }
        speed = this.roaming ? def.walk : (this.stateT < 3 ? def.walk : 0);
        if (this.seesKnight) {
          this.bark(pick(['THE KNIGHT!', 'GET HIM!', 'THERE!']));
          this.owner.alert(this);
          this.setState('engage');
        } else {
          const civ = this.owner.nearestCivilian(this.pos, 16);
          if (civ) { this.target = civ; civ.threatenedBy = this; this.setState('hunt'); this.bark(pick(['FRESH MEAT', 'GRAB THEM!'])); }
        }
        break;
      }
      case 'hunt': {
        const c = this.target;
        if (!c || !c.alive) { this.target = null; this.setState(this.roaming ? 'roam' : 'idle'); break; }
        if (this.seesKnight && this.knightDist < 14) { this.owner.alert(this); this.setState('engage'); break; }
        this.goal = c.pos;
        const d = Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z);
        speed = d > 1.4 ? def.run * 0.8 : 0;
        face = Math.atan2(c.pos.x - this.pos.x, c.pos.z - this.pos.z);
        this.cd -= dt;
        if (d < 1.8 && this.cd <= 0) { this.attackTarget = c; this.setState('windup'); }
        break;
      }
      case 'engage': {
        if (!k.alive) { this.setState('idle'); break; }
        const d = this.knightDist = Math.hypot(k.pos.x - this.pos.x, k.pos.z - this.pos.z);
        face = Math.atan2(k.pos.x - this.pos.x, k.pos.z - this.pos.z);
        if (this.kind === 'archer') {
          // keep a good shooting distance, sidestepping
          const want = 12;
          const side = Math.sin(this.t * 0.6 + this.id) > 0 ? 1 : -1;
          const away = d < want - 3 ? -1 : d > want + 4 ? 1 : 0;
          this.goal = {
            x: this.pos.x + Math.sin(face) * away * 3 + Math.cos(face) * side * 2,
            z: this.pos.z + Math.cos(face) * away * 3 - Math.sin(face) * side * 2,
          };
          speed = def.walk * 1.4;
          this.cd -= dt;
          if (this.cd <= 0 && d < def.range && this.seesKnight) { this.attackTarget = k; this.setState('windup'); game.sound.telegraph(); }
        } else {
          this.goal = k.pos;
          speed = d > def.reach - 0.2 ? (d > 6 ? def.run : def.walk * 1.5) : 0;
          this.cd -= dt;
          if (this.cd <= 0 && d < def.reach + 0.3) { this.attackTarget = k; this.setState('windup'); }
        }
        if (d > 40) this.setState('idle');
        break;
      }
      case 'windup': {
        const tgt = this.attackTarget;
        if (tgt && (tgt.alive ?? true)) face = Math.atan2(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z);
        if (this.stateT > def.windup) this.strike();
        break;
      }
      case 'strike':
        if (this.stateT > 0.25) this.setState('recover');
        break;
      case 'recover':
        if (this.stateT > 0.45) {
          this.cd = def.rest[0] + Math.random() * (def.rest[1] - def.rest[0]);
          this.setState(this.attackTarget === k ? 'engage' : 'hunt');
        }
        break;
      case 'stagger':
        if (this.stateT > this.staggerDur) this.setState(k.alive && this.knightDist < 30 ? 'engage' : 'idle');
        break;
      case 'flee': {
        const from = this.fleeFrom;
        const dx = this.pos.x - from.x, dz = this.pos.z - from.z;
        const d = Math.hypot(dx, dz) || 1;
        this.goal = { x: this.pos.x + (dx / d) * 6, z: this.pos.z + (dz / d) * 6 };
        speed = def.run;
        if (this.stateT > 7 && !this.angel) { this.fear = 0; this.setState(this.roaming ? 'roam' : 'idle'); }
        break;
      }
    }
    return [speed, face];
  }

  flee(from, shout) {
    this.fleeFrom = from;
    this.setState('flee');
    if (shout) this.bark(shout);
  }

  strike() {
    const game = this.game, tgt = this.attackTarget;
    this.setState('strike');
    if (!tgt) return;
    if (this.kind === 'archer') {
      this.owner.fireBolt(this, tgt);
      return;
    }
    game.sound.swing(this.kind === 'brute');
    const dx = tgt.pos.x - this.pos.x, dz = tgt.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const fwd = (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / (d || 1);
    if (d < this.def.reach + 0.4 && fwd > 0.4) {
      const r = tgt.takeHit({ damage: this.def.damage, from: this.pos, blockable: true, parryable: true, by: 'raider' });
      if (r === 'parried') { this.setState('stagger'); this.staggerDur = this.kind === 'brute' ? 1.6 : 1.1; }
      if (r === 'hit' && tgt === game.knight && this.kind === 'brute') game.knight.vel.addScaledVector(new THREE.Vector3(dx / d, 0, dz / d), 6);
    }
  }

  // ---------------------------------------------------------------- civilians
  thinkCivilian(dt) {
    let speed = 0, face = null;
    const def = this.def;
    // what's the scariest thing nearby?
    let threat = null, td = 1e9;
    if (this.angel) { threat = this.angel; td = this.angelDist; }
    for (const p of this.owner.list) {
      if (!p.hostile || !p.alive) continue;
      const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      if (d < 11 && d < td && (p.target === this || d < 6)) { threat = p; td = d; }
    }

    switch (this.state) {
      case 'idle':
      case 'wander':
        if (threat) { this.flee(threat.pos, pick(['HELP!', 'RUN!', 'NO!'])); break; }
        if (!this.goal || Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z) < 0.8 || this.stateT > 12) {
          this.goal = this.roaming ? this.owner.nextNode(this.pos, this.goal) : { x: this.home.x + (Math.random() - 0.5) * 9, z: this.home.z + (Math.random() - 0.5) * 9 };
          this.stateT = 0;
          this.sitting = !this.roaming && Math.random() < 0.4;
        }
        speed = this.roaming ? def.walk : (this.stateT < 4 && !this.sitting ? def.walk : 0);
        break;
      case 'flee': {
        if (threat) this.fleeFrom = threat.pos;
        const dx = this.pos.x - this.fleeFrom.x, dz = this.pos.z - this.fleeFrom.z;
        const d = Math.hypot(dx, dz) || 1;
        this.goal = { x: this.pos.x + (dx / d) * 6, z: this.pos.z + (dz / d) * 6 };
        speed = def.run;
        if (threat && td < 2.2 && threat.hostile) this.setState('cower');
        if (!threat && this.stateT > 4) this.setState('idle');
        break;
      }
      case 'cower':
        if (threat) face = Math.atan2(threat.pos.x - this.pos.x, threat.pos.z - this.pos.z);
        if (!threat && this.stateT > 1.5) this.setState('idle');
        else if (threat && td > 4 && this.stateT > 1) this.flee(threat.pos);
        break;
      case 'thank':
        face = Math.atan2(this.game.knight.pos.x - this.pos.x, this.game.knight.pos.z - this.pos.z);
        if (this.stateT > 2.5) this.setState('idle');
        break;
    }
    return [speed, face];
  }

  // ================================================================ animation
  animate(dt, speed) {
    const j = this.j, st = this.state;
    const run = Math.min(1, speed / this.def.run);
    this.walkPhase += dt * (3 + speed * 2.2);
    const amt = Math.min(1, speed / 1.2);
    const s = Math.sin(this.walkPhase) * amt;
    const lerp = (o, key, v, rate = 12) => { o[key] += (v - o[key]) * Math.min(1, dt * rate); };

    let tx = 0.05 + run * 0.25, armRx = -s * 0.6, armLx = s * 0.6, elR = -0.3 - run * 0.8, elL = -0.3 - run * 0.8, armRz = 0, armLz = 0, crouch = 0, headX = 0;
    if (this.kind === 'archer' && (st === 'engage' || st === 'windup' || st === 'strike')) { armRx = -1.5; elR = -0.1; armLx = -1.4; elL = -0.4; }
    if (this.kind === 'brute') { tx += 0.12; }
    if (st === 'windup') {
      if (this.kind === 'archer') { armRx = -1.55; armLx = -1.5; }
      else { armRx = -2.7; elR = -0.9; tx = -0.2; armRz = 0.2; }
    } else if (st === 'strike') {
      if (this.kind !== 'archer') { armRx = -0.5; elR = -0.1; tx = 0.45; }
    } else if (st === 'cower') {
      armRx = -2.6; armLx = -2.6; elR = -1.9; elL = -1.9; crouch = 0.35; tx = 0.5; headX = 0.4;
    } else if (st === 'stagger') {
      tx = -0.4; armRx = -0.8; armLx = -1.0;
    } else if (st === 'thank') {
      armRx = -2.8 + Math.sin(this.t * 10) * 0.3; armLx = -2.8 - Math.sin(this.t * 10) * 0.3; elR = -0.3; elL = -0.3;
    } else if (this.sitting && speed < 0.2 && st === 'idle') {
      crouch = 0.45; tx = 0.2;
    }
    const rate = st === 'strike' ? 30 : 12;
    lerp(j.torso.rotation, 'x', tx, rate);
    lerp(j.armR.rotation, 'x', armRx, rate);
    lerp(j.armR.rotation, 'z', armRz, rate);
    lerp(j.armL.rotation, 'x', armLx, rate);
    lerp(j.elbowR.rotation, 'x', elR, rate);
    lerp(j.elbowL.rotation, 'x', elL, rate);
    lerp(j.head.rotation, 'x', headX, 8);
    j.armL.rotation.z = 0.12 + armLz;
    if (st !== 'dead') {
      const [L, R] = this.legs;
      L.hip.rotation.x = -s * 0.75 - crouch * 1.6;
      R.hip.rotation.x = s * 0.75 - crouch * 1.6;
      L.knee.rotation.x = Math.max(0, Math.sin(this.walkPhase + 1.4)) * 1.1 * amt + crouch * 2.6;
      R.knee.rotation.x = Math.max(0, Math.sin(this.walkPhase + 1.4 + Math.PI)) * 1.1 * amt + crouch * 2.6;
      this.body.position.y = -crouch * 0.42 * (this.def.scale || 1) - Math.abs(Math.cos(this.walkPhase)) * 0.04 * amt;
    }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.shadow.position.set(this.pos.x, this.pos.y + 0.03, this.pos.z);
    this.shadow.visible = this.alive;
  }

  updateDead(dt) {
    // fall over backwards, then lie still; vanish after a while
    this.fall = Math.min(1, this.fall + dt * 2.6);
    this.flyUp -= 14 * dt;
    this.lift = Math.max(0, this.lift + this.flyUp * dt);
    this.body.rotation.x = -this.fall * (Math.PI / 2 - 0.08);
    this.body.rotation.z += this.deathSpin * dt * (1 - this.fall);
    this.body.position.y = 0.12 * this.fall + this.lift;
    const [L, R] = this.legs;
    L.knee.rotation.x = 0.3; R.knee.rotation.x = 0.6;
    if (this.stateT > 30) {
      this.body.position.y -= (this.stateT - 30) * 0.3;
      if (this.stateT > 33) this.dispose();
    }
  }

  dispose() {
    this.game.scene.remove(this.root);
    this.game.scene.remove(this.shadow);
    this.removed = true;
  }
}

// =====================================================================
export class Humans {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.bolts = [];
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x1d1913, transparent: true, opacity: 0.28, depthWrite: false, map: game.fx.blotTex });
    this.boltMat = game.sketch.fill(0x5b4a3a);
    this.camps = [
      ...game.world.raiderCamps.map((c) => ({ ...c, type: 'raider' })),
      ...game.world.civilianCamps.map((c) => ({ ...c, type: 'civilian' })),
    ];
    this.reset();
  }

  reset() {
    for (const p of this.list) if (!p.removed) p.dispose();
    for (const b of this.bolts) this.game.scene.remove(b.mesh);
    this.list = [];
    this.bolts = [];
    for (const c of this.camps) { c.spawned = false; c.lost = 0; c.restockAt = 0; c.members = []; }
    this.saved = 0;
    this.lost = 0;
    this.slain = 0;
    this.roamT = 3;
  }

  spawn(kind, x, z, home, roaming = false) {
    const p = new Person(this.game, this, kind, x, z, home);
    p.roaming = roaming;
    if (roaming) p.setState(p.hostile ? 'roam' : 'wander');
    this.list.push(p);
    return p;
  }

  nearestCivilian(pos, range) {
    let best = null, bd = range;
    for (const p of this.list) {
      if (p.hostile || !p.alive) continue;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Street crossing to walk to next (one step along the grid). */
  nextNode(pos, prev) {
    const nodes = this.game.world.nodes;
    let near = nodes[0], nd = 1e9;
    for (const n of nodes) {
      const d = Math.hypot(n.x - pos.x, n.z - pos.z);
      if (d < nd) { nd = d; near = n; }
    }
    if (nd > 6) return near;
    const opts = nodes.filter((n) => Math.abs(Math.hypot(n.x - near.x, n.z - near.z) - 58) < 1 && n !== prev);
    return pick(opts.length ? opts : nodes);
  }

  /** A raider spotted you: everyone in its gang comes running. */
  alert(from) {
    for (const p of this.list) {
      if (!p.hostile || !p.alive || p === from) continue;
      if (p.state === 'flee' || p.state === 'engage') continue;
      if (Math.hypot(p.pos.x - from.pos.x, p.pos.z - from.pos.z) < 20) p.setState('engage');
    }
  }

  // ---------------------------------------------------------------- bolts
  fireBolt(archer, tgt) {
    const game = this.game;
    archer.root.updateMatrixWorld(true);
    const from = archer.j.hand.getWorldPosition(new THREE.Vector3());
    const aim = tgt.chest ? tgt.chest(new THREE.Vector3()) : tgt.aimPoint(new THREE.Vector3());
    // lead the target a little, but not perfectly
    if (tgt.vel) aim.addScaledVector(tgt.vel, 0.25);
    aim.x += (Math.random() - 0.5) * 0.6;
    const vel = aim.sub(from).normalize().multiplyScalar(32);
    const mesh = new THREE.Mesh(shapes().bolt, this.boltMat);
    mesh.position.copy(from);
    game.scene.add(mesh);
    this.bolts.push({ mesh, vel, owner: archer, life: 0, stuck: false });
    game.sound.thrust();
  }

  updateBolts(dt) {
    const game = this.game, k = game.knight;
    const c = new THREE.Vector3();
    this.bolts = this.bolts.filter((b) => {
      b.life += dt;
      if (b.stuck) {
        if (b.life > 6) { game.scene.remove(b.mesh); return false; }
        return true;
      }
      b.vel.y -= 3 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      b.mesh.lookAt(b.mesh.position.clone().add(b.vel));
      const p = b.mesh.position;
      // did it hit the knight?
      if (k.alive && p.distanceTo(k.chest(c)) < 0.55) {
        const r = k.takeHit({ damage: b.owner.def.damage, from: b.owner.pos, blockable: true, parryable: true, by: 'raider' });
        if (r === 'parried') {
          // knocked straight back at the shooter
          b.vel.copy(b.owner.aimPoint(new THREE.Vector3()).sub(p).normalize().multiplyScalar(36));
          b.owner2 = b.owner;
          b.reflected = true;
          return true;
        }
        if (r !== 'dodged') { game.scene.remove(b.mesh); return false; }
      }
      // reflected bolts can hit raiders
      if (b.reflected) {
        for (const h of this.list) {
          if (!h.hostile || !h.alive) continue;
          if (p.distanceTo(h.aimPoint(c)) < 0.6) {
            h.takeHit({ damage: 60, from: k.pos, by: 'knight' });
            game.scene.remove(b.mesh);
            return false;
          }
        }
      }
      // civilians in the way
      for (const h of this.list) {
        if (h.hostile || !h.alive) continue;
        if (p.distanceTo(h.aimPoint(c)) < 0.45) { h.takeHit({ damage: b.owner.def.damage, from: b.owner.pos, by: 'raider' }); game.scene.remove(b.mesh); return false; }
      }
      // walls and the ground
      const ox = p.x, oz = p.z;
      const q = { x: p.x, z: p.z };
      game.world.resolveCircle(q, 0.02);
      if (p.y < game.world.heightAt(p.x, p.z) || Math.abs(q.x - ox) + Math.abs(q.z - oz) > 0.01 || b.life > 3) {
        b.stuck = true;
        b.life = 0;
        game.fx.dust(p, 2, 0.3);
      }
      return true;
    });
  }

  // ---------------------------------------------------------------- your sword
  strike(p, part, attack, point, knight) {
    const game = this.game, fx = game.fx, snd = game.sound;
    const dir = new THREE.Vector3(p.pos.x - knight.pos.x, 0, p.pos.z - knight.pos.z).normalize();
    const kind = KIND[part.kind];
    const heavy = !!attack.heavy;
    const dmg = attack.damage * (part.mult ?? kind.mult) * (p.state === 'stagger' ? 1.3 : 1);
    p.flash.value = 1;
    if (kind.deflect) {
      snd.clang();
      fx.sparks(point, 14, INK);
      fx.burst(point, 0.7, WHITE);
      fx.word('CLANG', point, '#fbf7ec', 0.6);
      game.hitstop(0.05);
      p.hp -= dmg;
      if (heavy) { p.setState('stagger'); p.staggerDur = 1.0; return 'armor'; }
      game.hud.firstTime('brute', 'That helmet is solid steel. Get behind the brute: its back is bare.');
      return 'deflect';
    }
    const weak = part.kind === 'weak';
    p.hp -= dmg;
    p.knock.addScaledVector(dir, heavy ? 8 : weak ? 5 : 3);
    fx.blood(point, dir, weak ? 18 : 10);
    fx.burst(point, weak ? 1.4 : 0.9, weak ? new THREE.Color(0xc9412f) : WHITE);
    fx.shake(weak ? 0.3 : 0.18);
    game.hitstop(weak ? 0.08 : 0.05);
    snd.hitBody(heavy);
    if (weak) fx.word(pick(['CRACK!', 'THWACK!', 'CRUNCH!']), point, '#c9412f', 0.8);
    if (p.hp <= 0) {
      p.die('knight', dir, heavy || weak);
      game.hitstop(0.09);
      fx.impactFrame(0.04, 0.12, 2);
    } else if (p.kind !== 'brute' || heavy || weak) {
      // brutes shrug off ordinary hits; everyone else flinches
      p.setState('stagger');
      p.staggerDur = heavy ? 0.9 : 0.35;
    }
    return weak ? 'weak' : 'body';
  }

  shockwave(c, radius, dmg) {
    for (const p of this.list) {
      if (!p.alive || !p.hostile) continue;
      const dx = p.pos.x - c.x, dz = p.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d > radius + p.radius) continue;
      const dir = new THREE.Vector3(dx, 0, dz).normalize();
      p.knock.addScaledVector(dir, 10);
      p.hp -= dmg;
      if (p.hp <= 0) p.die('knight', dir, true);
      else { p.setState('stagger'); p.staggerDur = 1.1; }
    }
  }

  onDeath(p, by) {
    const game = this.game;
    if (p.hostile) {
      if (by === 'knight') this.slain++;
      // the rest of the gang gets scared
      for (const o of this.list) {
        if (!o.hostile || !o.alive || o.kind === 'brute') continue;
        if (Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z) > 16) continue;
        o.fear += 0.34;
        const allies = this.list.filter((a) => a.hostile && a.alive && a !== o && Math.hypot(a.pos.x - o.pos.x, a.pos.z - o.pos.z) < 16).length;
        if (o.fear > 0.6 && (allies < 2 || o.hp < o.def.hp * 0.5) && o.state !== 'flee') o.flee(game.knight.pos, pick(['RUN!', 'MONSTER!', 'NOT ME!']));
      }
      // anyone it was hunting has been saved
      for (const c of this.list) {
        if (c.hostile || !c.alive || c.threatenedBy !== p || c.saved) continue;
        c.saved = true;
        this.saved++;
        c.setState('thank');
        c.bark(pick(['BLESS YOU!', 'THANK YOU!', 'A KNIGHT!']));
        if (Math.hypot(c.pos.x - game.knight.pos.x, c.pos.z - game.knight.pos.z) < 18) game.knight.heal(8);
        game.hud.firstTime('saved', 'You saved them. Survivors you rescue will patch up your wounds.');
      }
    } else {
      this.lost++;
    }
    if (game.rig.lock === p) game.rig.lock = null;
  }

  // ---------------------------------------------------------------- the crowd near you
  update(dt) {
    if (dt <= 0) return;
    const game = this.game, k = game.knight;
    // fill camps near you, empty those far away
    for (const c of this.camps) {
      const d = Math.hypot(c.x - k.pos.x, c.z - k.pos.z);
      if (!c.spawned && d < SPAWN_NEAR && game.time > c.restockAt) {
        c.spawned = true;
        c.members = [];
        const kinds = c.type === 'raider'
          ? ['thug', 'thug', 'archer', ...(Math.random() < 0.5 ? ['brute'] : ['thug'])]
          : ['civilian', 'civilian', 'civilian', 'civilian', ...(Math.random() < 0.5 ? ['civilian'] : [])];
        for (const kind of kinds) {
          const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 4;
          c.members.push(this.spawn(kind, c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, c));
        }
      } else if (c.spawned && d > DESPAWN_FAR) {
        const engaged = c.members.some((p) => p.alive && p.state === 'engage');
        if (!engaged) {
          const dead = c.members.filter((p) => !p.alive).length;
          for (const p of c.members) if (!p.removed) p.dispose();
          c.spawned = false;
          // a cleared camp stays empty for a few minutes
          if (dead >= c.members.length) c.restockAt = game.time + 240;
        }
      }
    }
    // roaming gangs and lone survivors out on the streets
    this.roamT -= dt;
    if (this.roamT <= 0) {
      this.roamT = 8;
      const roamers = this.list.filter((p) => p.roaming && p.alive);
      const gangs = roamers.filter((p) => p.hostile).length;
      const wanderers = roamers.filter((p) => !p.hostile).length;
      const node = this.farNode(55, 95);
      if (node) {
        if (gangs < 3 && Math.random() < 0.6) {
          const n = 2 + Math.floor(Math.random() * 2);
          for (let i = 0; i < n; i++) this.spawn(i === 0 && Math.random() < 0.3 ? 'archer' : 'thug', node.x + (Math.random() - 0.5) * 4, node.z + (Math.random() - 0.5) * 4, node, true);
        } else if (wanderers < 6) {
          const n = 1 + Math.floor(Math.random() * 2);
          for (let i = 0; i < n; i++) this.spawn('civilian', node.x + (Math.random() - 0.5) * 3, node.z + (Math.random() - 0.5) * 3, node, true);
        }
      }
      // forget roamers that wandered far away
      for (const p of this.list) {
        if (p.roaming && !p.removed && Math.hypot(p.pos.x - k.pos.x, p.pos.z - k.pos.z) > 150) p.dispose();
      }
    }

    for (const p of this.list) if (!p.removed) p.update(dt);
    this.list = this.list.filter((p) => !p.removed);
    this.updateBolts(dt);

    // don't walk through each other or through the knight
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.list.length; j++) {
        const b = this.list[j];
        if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz), min = a.radius + b.radius;
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2;
          a.pos.x -= (dx / d) * push; a.pos.z -= (dz / d) * push;
          b.pos.x += (dx / d) * push; b.pos.z += (dz / d) * push;
        }
      }
      if (k.alive) {
        const dx = a.pos.x - k.pos.x, dz = a.pos.z - k.pos.z;
        const d = Math.hypot(dx, dz), min = a.radius + 0.45;
        if (d < min && d > 1e-4) { a.pos.x = k.pos.x + (dx / d) * min; a.pos.z = k.pos.z + (dz / d) * min; }
      }
    }
  }

  farNode(min, max) {
    const k = this.game.knight;
    const opts = this.game.world.nodes.filter((n) => {
      const d = Math.hypot(n.x - k.pos.x, n.z - k.pos.z);
      return d > min && d < max;
    });
    return opts.length ? pick(opts) : null;
  }
}
