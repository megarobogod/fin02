// =====================================================
// knight.js - you
//
// The knight is built from boxes on a skeleton of "joints" (empty groups you
// can rotate). Animation is done by blending between poses: a pose is just a
// list of joint angles, e.g. "sword raised over the head".
//
// Controls (set in main.js):
//   left click       slash (click again during a swing to chain 3 slashes)
//   hold left click  charge a heavy overhead slam, release to strike
//   right click      raise the shield. Raise it just as a blow lands = PARRY
//   space            roll (you can't be hurt mid-roll)
// =====================================================
import * as THREE from 'three';
import { INK, WHITE, ICHOR } from './fx.js';
import { lathe, smoothLathe, capsule, plate, bladeGeo, bend, scaled, finish } from './shapes.js';
import { sweep, settleSoft, targets } from './combat.js';

// ---------- tuning numbers ----------
const WALK = 4.6;
const SPRINT = 7.6;
const GUARD_WALK = 2.2;
const ROLL_SPEED = 10;
const ROLL_TIME = 0.5;
const ROLL_COST = 22;
const PARRY_WINDOW = 0.22;       // seconds after raising the shield that a parry counts
const HOLD_FOR_HEAVY = 0.26;     // hold the button this long to start charging
const RADIUS = 0.45;
const MAX_RESOLVE = 3;           // charges of "steel your will"
const STEEL_TIME = 1.6;          // how long you kneel to heal
const STEEL_HEAL = 45;           // willpower it gives back
const STAGGER_TIME = 0.38;      // how long a proper hit knocks you off balance
const LIGHT_BLOW = 20;           // hits weaker than this don't interrupt your swing
const CLICK_MEMORY = 0.4;        // a click this long before you can act still counts
const AIM_RANGE = 5;             // swings turn toward an enemy this close
const STEP_IN_MAX = 2.2;         // ...and step up to this far toward it

// The three slashes of the combo, plus the heavy slam.
// windup/active/recover are in seconds. "from"/"to" name the poses below.
const ATTACKS = {
  1: { windup: 0.13, active: 0.13, recover: 0.32, damage: 22, poise: 22, stamina: 12, lunge: 3.0, from: 'S1a', to: 'S1b' },
  2: { windup: 0.12, active: 0.13, recover: 0.32, damage: 22, poise: 22, stamina: 12, lunge: 3.0, from: 'S2a', to: 'S2b' },
  3: { windup: 0.2, active: 0.12, recover: 0.42, damage: 36, poise: 45, stamina: 18, lunge: 4.2, from: 'S3a', to: 'S3b' },
  heavy: { windup: 0, active: 0.13, recover: 0.6, damage: 58, poise: 120, stamina: 28, lunge: 7.0, from: 'Ha', to: 'Hb', heavy: true },
};

// Joint angles in radians. Everything not listed copies BASE.
const BASE = {
  torsoX: 0, torsoY: 0, torsoZ: 0,
  armRx: -0.35, armRy: 0.05, armRz: 0.1, elbowR: -0.75, wristR: -0.9, wristRy: 0,
  armLx: -0.3, armLy: -0.9, armLz: 0, elbowL: -1.05, headY: 0,
};
const P = (o) => ({ ...BASE, ...o });
const POSES = {
  idle: P({}),
  block: P({ torsoY: -0.3, armLx: -1.0, armLy: -1.3, elbowL: -0.65, armRx: -0.2, wristR: -1.2 }),
  // slash 1 cuts diagonally from high on the right to low on the left;
  // slash 2 comes back up from low left to high right. Both are level
  // through the middle, at about head-and-shoulders height.
  // (Blade angle = armRx + elbowR + wristR: about -1.57 means level.)
  S1a: P({ torsoY: -0.8, armRx: -1.75, armRy: -1.5, armRz: 0, elbowR: -0.2, wristR: -0.1 }),
  S1b: P({ torsoY: 0.75, armRx: -1.12, armRy: 1.35, armRz: 0, elbowR: -0.05, wristR: 0.2 }),
  S2a: P({ torsoY: 0.7, armRx: -1.15, armRy: 1.3, armRz: 0, elbowR: -0.1, wristR: 0.2 }),
  S2b: P({ torsoY: -0.75, armRx: -1.75, armRy: -1.45, armRz: 0, elbowR: -0.15, wristR: -0.15 }),
  // the overhead and the slam come down the middle, right onto the heart
  S3a: P({ torsoX: -0.25, torsoY: 0.1, armRx: -3.0, armRy: 0.3, armRz: 0, elbowR: -0.5, wristR: -0.4 }),
  S3b: P({ torsoX: 0.35, torsoY: 0.2, armRx: -0.65, armRy: 0.3, armRz: 0, elbowR: -0.05, wristR: -0.15 }),
  Ha: P({ torsoX: -0.4, torsoY: -0.1, armRx: -3.3, armRy: 0.25, armRz: 0, elbowR: -1.0, wristR: -0.7 }),
  Hb: P({ torsoX: 0.55, torsoY: 0.2, armRx: -0.45, armRy: 0.3, armRz: 0, elbowR: 0, wristR: -0.05 }),
  // poses for the angel execution (cinematic.js)
  crouchArms: P({ torsoX: 0.45, armRx: -0.3, armRy: -0.4, elbowR: -0.6, wristR: -0.4, armLx: -0.5, armLy: -0.6, elbowL: -0.9 }),
  raise: P({ torsoX: -0.35, armRx: -3.2, armRy: 0.2, elbowR: -0.2, wristR: -0.2, armLx: -2.4, armLy: -0.3, elbowL: -0.6 }),
  plunge: P({ torsoX: 0.5, armRx: -1.3, armRy: 0.25, elbowR: 0, wristR: 0.5, armLx: -1.2, armLy: -0.5, elbowL: -0.4 }),
  kneel: P({ torsoX: 0.3, headY: 0, armRx: -0.75, armRy: 0.15, elbowR: -0.35, wristR: 1.1, armLx: -0.55, armLy: -0.25, elbowL: -1.3 }),
  recoil: P({ torsoX: -0.35, torsoY: -0.4, armRx: -2.2, armRy: -0.9, elbowR: -1.2, wristR: -0.9 }),
  stagger: P({ torsoX: -0.45, armRx: -0.9, armRy: -0.6, armLx: -0.9, armLy: 0.2, elbowL: -0.4 }),
};

const ease = (t) => 1 - (1 - t) * (1 - t);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
function blend(out, a, b, t) {
  for (const k in BASE) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}
function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Knight {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.build();
    // First-person resting poses: sword low on the right, shield low on the left, both in view.
    this.fpPoses = {
      idle: P({ armRx: -0.95, armRy: -0.05, armRz: 0, elbowR: -0.95, wristR: -0.85, armLx: -0.65, armLy: -0.05, armLz: 0, elbowL: -1.9 }),
      block: P({ armRx: -0.85, armRy: -0.15, armRz: 0, elbowR: -1.0, wristR: -0.9, armLx: -1.15, armLy: -0.35, armLz: 0, elbowL: -1.7 }),
    };
    this.reset();
    this._b0 = new THREE.Vector3(); this._t0 = new THREE.Vector3();
    this._b1 = new THREE.Vector3(); this._t1 = new THREE.Vector3();
    this._pb = new THREE.Vector3(); this._pt = new THREE.Vector3();
    this._sb = new THREE.Vector3(); this._st = new THREE.Vector3();
    this._rootNow = new THREE.Vector3();
    this.prevRoot = new THREE.Vector3();
    this.prevActiveT = 0;
  }

  reset() {
    this.pos.copy(this.game.world.spawn);
    this.pos.y = this.game.world.heightAt(this.pos.x, this.pos.z);
    this.vel.set(0, 0, 0);
    this.facing = 0;
    this.maxHp = 100; this.hp = 100;         // hp is your WILLPOWER
    this.resolve = MAX_RESOLVE;              // charges for steeling your will (F)
    this.maxStamina = 100; this.stamina = 100; this.staminaDelay = 0;
    this.state = 'move';        // move | attack | charge | roll | recoil | stagger | dead
    this.stateT = 0;
    this.attack = null;
    this.combo = 0;
    this.buffered = false;
    this.blocking = false;
    this.blockPressedAt = -10;
    this.invuln = 0;
    this.lmbHeld = -1;
    this.walkPhase = 0; this.walkAmt = 0;
    this.lastStep = 0;
    this.pose = { ...BASE };
    this.poseFrom = { ...BASE };
    this.lunge = new THREE.Vector3();
    this.rollDir = new THREE.Vector3();
    this.deadT = 0;
    this.rollPivot.rotation.set(0, 0, 0);
    this.root.visible = true;
  }

  // ================================================================ model
  build() {
    const S = this.game.mats;
    const STEEL = 0x9a9da2, DARK = 0x4a4d52, CLOTH = 0x6a1c16, LEATHER = 0x3b2a1c, MAIL = 0x7b7d80, PALE = 0xcfc4ac;
    const BRASS = 0xb39a5c, BLADE = 0xd4d7da, SHIELD = 0x6b2a20, GLOVE = 0x2e231a;
    // how each colour behaves under light: metal or not, and how polished
    const LOOK = {
      [STEEL]: { metal: 1, rough: 0.3 }, [DARK]: { metal: 1, rough: 0.42 }, [MAIL]: { metal: 1, rough: 0.55 },
      [BRASS]: { metal: 1, rough: 0.33 }, [BLADE]: { metal: 1, rough: 0.16 },
      [CLOTH]: { rough: 0.95 }, [PALE]: { rough: 0.9 }, [LEATHER]: { rough: 0.62 }, [SHIELD]: { rough: 0.55 }, [GLOVE]: { rough: 0.7 },
    };
    this.fpHide = [];       // parts of the body that vanish in first person (everything but arms, sword and shield)
    this.fpArms = [];       // the arms, sword and shield
    let into = this.fpHide;
    // put a shape on a joint at (x, y, z), optionally turned
    const put = (geo, tint, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, extra = {}) => {
      const m = S.part(geo, tint, { ...(LOOK[tint] || {}), ...extra });
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      parent.add(m);
      (into || this.fpArms).push(m);
      return m;
    };
    const joint = (parent, x, y, z) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.order = 'YXZ';
      parent.add(g);
      return g;
    };
    const both = { side: THREE.DoubleSide };
    const dark = S.glow(0x050403, 1);

    this.root = new THREE.Group();
    this.game.scene.add(this.root);
    this.rollPivot = joint(this.root, 0, 0.95, 0);
    const inner = joint(this.rollPivot, 0, -0.95, 0);

    // ---- body ----
    const hips = joint(inner, 0, 1.0, 0);
    this.hips = hips;
    // mail skirt, flaring out over the thighs
    put(smoothLathe([[0.2, 0.08], [0.225, -0.04], [0.265, -0.2], [0.295, -0.34]], 48, 0.8), MAIL, hips, 0, 0, 0, 0, 0, 0, both);
    put(new THREE.TorusGeometry(0.28, 0.012, 8, 48), DARK, hips, 0, -0.33, 0, Math.PI / 2).scale.set(1, 0.8, 1);
    const torso = joint(hips, 0, 0.12, 0);
    // breastplate: barrel chest tapering to the waist, with a ridge down the middle
    const chest = smoothLathe([[0.0, -0.07], [0.19, -0.06], [0.215, 0.06], [0.255, 0.26], [0.265, 0.4], [0.235, 0.52], [0.15, 0.6], [0.0, 0.63]], 56, 0.76);
    {
      const p = chest.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (z > 0) p.setZ(i, z + 0.022 * Math.exp(-((x / 0.05) ** 2)) * Math.min(1, Math.max(0, (y + 0.05) / 0.2)) * (1 - Math.max(0, (y - 0.4) / 0.25)));
      }
    }
    put(finish(chest), STEEL, torso);
    // overlapping plates round the waist
    for (let i = 0; i < 3; i++) {
      put(smoothLathe([[0.215 + i * 0.012, 0.0 - i * 0.045], [0.228 + i * 0.014, -0.025 - i * 0.045], [0.222 + i * 0.014, -0.05 - i * 0.045]], 48, 0.78), STEEL, torso, 0, 0.02, 0);
    }
    // the red tabard, front and back, hanging past the belt and swaying slightly
    for (const s of [1, -1]) {
      const cloth = new THREE.PlaneGeometry(0.34, 0.9, 8, 14);
      const cp = cloth.attributes.position;
      for (let i = 0; i < cp.count; i++) {
        const x = cp.getX(i), y = cp.getY(i);
        cp.setZ(i, 0.015 * Math.sin(y * 9 + x * 6) + Math.max(0, -y - 0.1) * 0.06 + 0.05 * x * x);
      }
      cloth.computeVertexNormals();
      put(cloth, CLOTH, torso, 0, -0.02, s * 0.215, 0, s > 0 ? 0 : Math.PI, 0, both);
    }
    put(new THREE.PlaneGeometry(0.05, 0.4), PALE, torso, 0, 0.2, 0.232, 0, 0, 0, both);          // the pale cross
    put(new THREE.PlaneGeometry(0.22, 0.05), PALE, torso, 0, 0.3, 0.232, 0, 0, 0, both);
    // belt with a buckle
    put(new THREE.TorusGeometry(0.235, 0.03, 12, 48), LEATHER, torso, 0, 0.0, 0, Math.PI / 2, 0, 0).scale.set(1, 0.76, 1);
    put(scaled(new THREE.SphereGeometry(0.032, 16, 12), 1.2, 0.9, 0.5), BRASS, torso, 0, 0.0, 0.185);
    // gorget (neck guard)
    put(smoothLathe([[0.14, 0.0], [0.13, 0.045], [0.105, 0.1]], 40), DARK, torso, 0, 0.58, 0);
    // layered pauldrons: three overlapping domed plates on each shoulder
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const lame = scaled(new THREE.SphereGeometry(0.15 - i * 0.012, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2 - i * 0.12), 1.2, 0.85, 1.1);
        const pa = put(lame, STEEL, torso, s * (0.31 + i * 0.012), 0.52 - i * 0.045, 0);
        pa.rotation.z = -s * (0.32 + i * 0.1);
      }
    }

    // ---- the great helm ----
    const head = joint(torso, 0, 0.66, 0);
    this.headJ = head;
    put(smoothLathe([[0.0, -0.02], [0.145, -0.02], [0.165, 0.06], [0.17, 0.2], [0.157, 0.29], [0.12, 0.345], [0.06, 0.37], [0.0, 0.375]], 56), STEEL, head);
    put(new THREE.TorusGeometry(0.162, 0.008, 8, 48), DARK, head, 0, 0.13, 0, Math.PI / 2);      // reinforcing band
    put(scaled(new THREE.SphereGeometry(0.1, 20, 12), 1.3, 0.14, 0.6), STEEL, head, 0, 0.2, 0.147, 0, 0, 0, { material: dark });   // the dark eye slit
    for (let i = 0; i < 6; i++) {                                                  // breathing holes
      put(new THREE.CircleGeometry(0.009, 10), STEEL, head, 0.035 + (i % 2) * 0.03, 0.1 - Math.floor(i / 2) * 0.03, 0.169, 0, 0, 0, { material: dark });
    }
    put(scaled(new THREE.SphereGeometry(0.03, 12, 10), 0.35, 4.2, 0.8), DARK, head, 0, 0.17, 0.168);      // nose ridge
    // a red plume flowing back off the crown
    const plumeCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.37, 0.02), new THREE.Vector3(0, 0.47, -0.08), new THREE.Vector3(0, 0.43, -0.25), new THREE.Vector3(0, 0.26, -0.38),
    ]);
    put(new THREE.TubeGeometry(plumeCurve, 28, 0.045, 14), CLOTH, head);

    // ---- arms (both built the same): the parts you still see in first person ----
    into = null;
    const arm = (side) => {
      const sh = joint(torso, side * 0.33, 0.52, 0);
      put(capsule(0.06, 0.32, 0.07), MAIL, sh);                                    // mail sleeve
      put(capsule(0.052, 0.17, 0.062, 0.02), STEEL, sh, 0, -0.03, 0);              // rerebrace (upper arm plate)
      const el = joint(sh, 0, -0.32, 0);
      put(scaled(new THREE.SphereGeometry(0.068, 20, 14), 1.0, 0.9, 1.05), STEEL, el);          // elbow cop
      put(scaled(new THREE.SphereGeometry(0.04, 12, 10), 0.5, 1.2, 1.4), STEEL, el, side * 0.06, 0, -0.01);   // its wing
      put(smoothLathe([[0.06, 0.02], [0.07, -0.05], [0.066, -0.17], [0.052, -0.29]], 28), STEEL, el);   // vambrace
      return { sh, el };
    };
    const R = arm(-1), L = arm(1);
    const armR = R.sh, elbowR = R.el, armL = L.sh, elbowL = L.el;
    // a gauntlet: flared cuff, back-of-hand plate, fingers
    const gauntlet = (parent, fist) => {
      put(smoothLathe([[0.052, -0.28], [0.066, -0.31], [0.07, -0.35], [0.06, -0.37]], 28), DARK, parent);
      put(scaled(new THREE.SphereGeometry(0.06, 20, 14), 0.95, 0.75, 1.05), DARK, parent, 0, -0.41, 0.0);
      for (let i = 0; i < 4; i++) {
        const f = put(capsule(0.0125, 0.075, 0.0135, 0.0), GLOVE, parent, (i - 1.5) * 0.026, -0.43, 0.04);
        f.rotation.x = fist ? -1.7 : -0.5;
      }
      put(scaled(new THREE.SphereGeometry(0.02, 10, 8), 0.8, 1.6, 0.8), GLOVE, parent, -0.055, -0.4, 0.025).rotation.z = 0.5;    // thumb
    };
    gauntlet(elbowR, true);
    gauntlet(elbowL, true);

    // ---- the sword ----
    const wristR = joint(elbowR, 0, -0.34, 0);
    // grip: wrapped leather, with a ridge for each turn of the wrap
    const gripPts = [[0.0005, 0.14]];
    for (let i = 0; i <= 22; i++) { const t = i / 22; gripPts.push([0.0215 + 0.0035 * Math.sin(t * Math.PI * 9) + 0.002 * Math.sin(t * Math.PI), 0.14 - t * 0.22]); }
    gripPts.push([0.0005, -0.08]);
    put(lathe(gripPts, 20, 1, Math.PI / 1.5), LEATHER, wristR, 0, 0.0, 0);
    put(scaled(new THREE.SphereGeometry(0.045, 24, 16), 1, 0.7, 1), BRASS, wristR, 0, 0.165, 0);          // pommel
    // crossguard: a bar that droops slightly toward the blade, with ball ends
    for (const s of [-1, 1]) {
      put(capsule(0.014, 0.19, 0.019, 0.0), DARK, wristR, s * 0.01, -0.09, 0, 0, 0, s * (Math.PI / 2 - 0.1));
      put(new THREE.SphereGeometry(0.026, 16, 12), BRASS, wristR, s * 0.2, -0.115, 0);
    }
    put(scaled(new THREE.SphereGeometry(0.03, 16, 12), 1.1, 0.8, 1.6), BRASS, wristR, 0, -0.095, 0);
    put(bladeGeo(1.04, 0.07), BLADE, wristR, 0, -0.12, 0);
    this.bladeBase = new THREE.Object3D(); this.bladeBase.position.y = -0.14; wristR.add(this.bladeBase);
    this.bladeTip = new THREE.Object3D(); this.bladeTip.position.y = -1.17; wristR.add(this.bladeTip);

    // ---- the shield: a curved heater with a rolled rim, a boss and a cross ----
    const shield = new THREE.Group();
    shield.position.set(0.1, -0.17, 0);
    shield.rotation.x = Math.PI;          // pointy end toward the elbow
    elbowL.add(shield);
    const outline = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      outline.push([0.33 * Math.cos(t * Math.PI / 2) ** 0.6, 0.38 - 0.88 * Math.sin(t * Math.PI / 2) ** 1.4]);
    }
    // down the right side to the point, then back up the left side
    const full = [...outline, ...outline.slice(0, -1).reverse().map(([x, y]) => [-x, y])];
    // Every piece is built facing +z, bent so it curves round your arm, then turned to face along x.
    const curved = (g) => { const b = bend(g, 0.55, 0); b.rotateY(Math.PI / 2); return b; };
    put(curved(plate(full, 0.035, 0.012)), SHIELD, shield);
    const rimPts = full.map(([x, y]) => [x * 1.06, y * 1.06 + 0.005]);
    put(curved(plate(rimPts, 0.022, 0.01, [full.map(([x, y]) => [x * 0.98, y * 0.98]).reverse()])), DARK, shield);
    for (const f of [1, -1]) {        // the same emblem on both faces, so it shows from any side
      put(curved(plate([[-0.025, 0.36], [0.025, 0.36], [0.025, -0.4], [-0.025, -0.4]], 0.012, 0.005)), PALE, shield, 0.03 * f, 0.0, 0);
      put(curved(plate([[-0.28, 0.17], [0.28, 0.17], [0.28, 0.13], [-0.28, 0.13]], 0.012, 0.005)), PALE, shield, 0.03 * f, 0.0, 0);
      put(scaled(new THREE.SphereGeometry(0.065, 24, 16), 0.55, 1, 1), BRASS, shield, 0.04 * f, 0.15, 0);
    }
    this.shield = shield;

    // ---- legs ----
    into = this.fpHide;
    this.legs = [];
    for (const s of [1, -1]) {
      const hip = joint(inner, s * 0.12, 0.92, 0);
      put(capsule(0.082, 0.44, 0.098), MAIL, hip);                                 // thigh
      put(smoothLathe([[0.06, 0.05], [0.105, 0.0], [0.108, -0.1], [0.095, -0.24]], 28, 0.9), STEEL, hip, 0, -0.0, 0.01);   // cuisse plate
      const knee = joint(hip, 0, -0.44, 0);
      put(scaled(new THREE.SphereGeometry(0.078, 20, 14), 1, 0.95, 1.1), STEEL, knee, 0, 0, 0.03);       // knee cop
      put(capsule(0.056, 0.43, 0.078), STEEL, knee);                              // greave
      // sabaton: a pointed shoe, narrow at the toe
      const shoe = new THREE.SphereGeometry(1, 20, 14);
      const sp = shoe.attributes.position;
      for (let i = 0; i < sp.count; i++) {
        const z = sp.getZ(i);
        const taper = z > 0 ? 1 - 0.55 * z * z : 1;
        sp.setX(i, sp.getX(i) * 0.065 * taper); sp.setY(i, sp.getY(i) * 0.05 * (z > 0 ? 1 - 0.3 * z : 1)); sp.setZ(i, z * 0.15);
      }
      put(finish(shoe), DARK, knee, 0, -0.45, 0.07);
      this.legs.push({ hip, knee });
    }

    // ---- a cape that sways as you move ----
    const capeGeo = new THREE.PlaneGeometry(0.46, 0.95, 10, 16);
    capeGeo.translate(0, -0.475, 0);
    // narrower at the shoulders, with a ragged hem
    {
      const p = capeGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = -p.getY(i) / 0.95;
        p.setX(i, p.getX(i) * (0.7 + 0.45 * k));
        if (k > 0.97) p.setY(i, p.getY(i) + Math.sin(p.getX(i) * 40) * 0.05);
      }
    }
    this.capeGeo = capeGeo;
    this.capeRest = Float32Array.from(capeGeo.attributes.position.array);
    const cape = new THREE.Mesh(capeGeo, S.fill(0x3f1410, { side: THREE.DoubleSide, rough: 0.95 }));
    cape.castShadow = true;
    cape.position.set(0, 0.56, -0.2);
    torso.add(cape);
    this.cape = cape;
    this.fpHide.push(cape);
    this.capeSwing = 0;

    this.j = { torso, armR, elbowR, wristR, armL, elbowL, head };

    // a soft contact shadow under your feet
    const shadowTex = this.game.fx.softTex;
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, map: shadowTex }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;
    this.game.scene.add(this.shadow);
  }

  /** Every frame: hide the body in first person, show it for cutscenes; hide the arms while you tumble or fall. */
  updateFPVisibility() {
    const fp = !this.game.cinematic.active;
    this.setFirstPerson(fp);
    const armsOn = !fp || (this.state !== 'roll' && this.state !== 'dead');
    if (armsOn !== this.armsOn) {
      this.armsOn = armsOn;
      for (const m of this.fpArms) m.visible = armsOn;
    }
  }

  /** First person hides your body (the camera is inside the helm) but keeps your arms, sword and shield. */
  setFirstPerson(on) {
    if (this.fp === on) return;
    this.fp = on;
    for (const m of this.fpHide) m.visible = !on;
    // in first person the shield is turned to face forward, and a little smaller so it doesn't fill your view
    this.shield.rotation.set(Math.PI, on ? -Math.PI / 2 : 0, 0);
    this.shield.scale.setScalar(on ? 0.75 : 1);
  }

  // ================================================================ cinematic control
  /**
   * Used by cinematic.js instead of update(): blend between two named poses
   * and put the legs in a named position. crouch lowers the hips.
   */
  cine(a, b, t, legs, crouch) {
    blend(this.pose, POSES[a], POSES[b], t);
    this.applyPose(this.pose);
    const [L, R] = this.legs;
    const LEGS = {
      stand: [0, 0.08, 0, 0.08],
      crouch: [-1.1, 1.7, -0.9, 1.5],
      tuck: [-1.3, 1.8, -0.4, 1.2],
      kneel: [-1.45, 1.55, 0.4, 2.05],
    }[legs];
    L.hip.rotation.x = LEGS[0]; L.knee.rotation.x = LEGS[1];
    R.hip.rotation.x = LEGS[2]; R.knee.rotation.x = LEGS[3];
    // lower the whole body (legs included) for a crouch or kneel
    this.hips.position.y = 1.0;
    this.rollPivot.rotation.x = 0;
    this.rollPivot.position.y = 0.95 - crouch;
  }

  updateCineVisuals(realDt) {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.facing;
    const g = this.game.world.heightAt(this.pos.x, this.pos.z);
    this.shadow.position.set(this.pos.x, g + 0.03, this.pos.z);
    this.shadow.scale.setScalar(Math.max(0.3, 1 - (this.pos.y - g) * 0.25));
    this.updateCape(realDt);
  }

  /** The cape streams out behind you when you move, and ripples. */
  updateCape(dt) {
    const fwd = Math.sin(this.facing) * this.vel.x + Math.cos(this.facing) * this.vel.z;
    const target = Math.min(1.4, Math.max(0, fwd / 6)) + (this.state === 'roll' ? 0.8 : 0) + (this.capeLift || 0);
    this.capeSwing += (target - this.capeSwing) * Math.min(1, dt * 6 + (dt === 0 ? 0 : 0.02));
    const t0 = this.game.realTime;
    const p = this.capeGeo.attributes.position;
    const rest = this.capeRest;
    for (let i = 0; i < p.count; i++) {
      const y = rest[i * 3 + 1];
      const x = rest[i * 3];
      const k = -y / 0.95;                          // 0 at the shoulders, 1 at the hem
      const lift = k * k * (0.12 + this.capeSwing * 0.55);
      const ripple = Math.sin(t0 * (3 + this.capeSwing * 5) + k * 5 + x * 4) * 0.035 * k * (0.5 + this.capeSwing);
      p.setZ(i, -lift - ripple);
      p.setY(i, y + lift * 0.45 * this.capeSwing);
    }
    p.needsUpdate = true;
    this.capeGeo.computeVertexNormals();
  }

  applyPose(p) {
    const j = this.j;
    j.torso.rotation.set(p.torsoX, p.torsoY, p.torsoZ);
    j.armR.rotation.set(p.armRx, p.armRy, p.armRz);
    j.elbowR.rotation.x = p.elbowR;
    j.wristR.rotation.set(p.wristR, p.wristRy, 0);
    j.armL.rotation.set(p.armLx, p.armLy, p.armLz);
    j.elbowL.rotation.x = p.elbowL;
    j.head.rotation.y = p.headY;
  }

  // ================================================================ helpers
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.facing), 0, Math.cos(this.facing)); }
  chest(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + 1.3, this.pos.z); }
  get alive() { return this.state !== 'dead'; }

  spend(n) {
    this.stamina -= n;
    this.staminaDelay = 0.7;
  }

  /** Who should an attack turn towards? The locked target, or an enemy just in front. */
  aimTarget(moveDir) {
    const lock = this.game.rig.lock;
    if (lock && lock.alive) return lock;
    const fwd = moveDir.lengthSq() > 0.01 ? moveDir : this.forward(new THREE.Vector3());
    let best = null, bestScore = Infinity;
    for (const a of targets(this.game)) {
      const dx = a.pos.x - this.pos.x, dz = a.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > AIM_RANGE) continue;
      const dot = (dx * fwd.x + dz * fwd.z) / (d || 1);
      if (dot < -0.2 && d > 2) continue;          // ignore enemies well behind you
      const score = d * (2.2 - dot);              // prefer close, and in front
      if (score < bestScore) { bestScore = score; best = a; }
    }
    return best;
  }

  /** How far from an enemy's centre you want to be for the blade to land. */
  sweetSpot(t) { return 1.3 + t.radius * 0.4; }

  // ================================================================ actions
  startAttack(n, moveDir) {
    const a = ATTACKS[n];
    this.state = 'attack';
    this.stateT = 0;
    this.combo = n === 'heavy' ? 0 : n;
    this.buffered = false;
    this.attack = { ...a, n, phase: a.windup > 0 ? 'windup' : 'active', t: 0, hit: new Set(), slammed: false };
    this.poseFrom = { ...this.pose };
    this.spend(a.stamina);
    const t = this.aimTarget(moveDir);
    this.attack.target = t;
    if (t) {
      this.facing = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
      // Step in during the wind-up: if the enemy is a little too far away,
      // slide toward it so the blade reaches. (A slide of speed v carries
      // you about v/10 metres, because it fades away at a rate of 10.)
      const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
      const step = Math.min(STEP_IN_MAX, Math.max(0, d - this.sweetSpot(t)));
      this.forward(this.lunge).multiplyScalar(step * 10);
    } else this.facing = this.game.rig.yaw;      // no target: swing where you're looking
    this.game.angels.onKnightAttack(this);
    if (a.windup === 0) this.beginActive();
  }

  beginActive() {
    const a = this.attack;
    a.phase = 'active';
    a.t = 0;
    // The swing itself carries you forward a little too, unless you're
    // already right on top of your target (or still sliding toward it).
    let lunge = a.lunge;
    const t = a.target;
    if (t && t.alive) {
      this.facing = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
      const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
      const gap = d - this.sweetSpot(t);
      lunge = Math.min(lunge, Math.max(0, (gap + 0.3) * 10));
      if (a.heavy && gap > 0) lunge = Math.max(lunge, Math.min(STEP_IN_MAX, gap) * 14);
    }
    const slide = this.lunge.length();
    this.forward(this.lunge).multiplyScalar(Math.max(slide, lunge));
    this.prevActiveT = 0;
    this.game.sound.swing(a.heavy);
  }

  startRoll(moveDir) {
    this.state = 'roll';
    this.stateT = 0;
    this.attack = null;
    this.spend(ROLL_COST);
    if (moveDir.lengthSq() > 0.01) this.rollDir.copy(moveDir).normalize();
    else this.forward(this.rollDir).multiplyScalar(-1);
    this.invuln = 0.38;
    this.game.sound.roll();
  }

  /** The sword bounced off armour: you're thrown back for a moment. */
  deflected() {
    if (this.state !== 'attack') return;
    this.state = 'recoil';
    this.stateT = 0;
    this.attack = null;
    this.poseFrom = { ...this.pose };
    this.lunge.set(0, 0, 0);
    this.forward(this.vel).multiplyScalar(-2.5);
    this.spend(6);
  }

  /**
   * Something hit you. Returns what happened:
   * 'dodged' | 'parried' | 'blocked' | 'guardbreak' | 'hit'
   */
  takeHit(h) {
    if (this.state === 'dead') return 'none';
    if (this.invuln > 0) return 'dodged';
    const fx = this.game.fx, sound = this.game.sound;
    const dx = h.from.x - this.pos.x, dz = h.from.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const fwd = this.forward(new THREE.Vector3());
    const inFront = (dx * fwd.x + dz * fwd.z) / d > 0.2;
    const shieldPos = this.shield.getWorldPosition(new THREE.Vector3());

    if (this.blocking && inFront && h.blockable !== false) {
      if (h.parryable && this.game.realTime - this.blockPressedAt < PARRY_WINDOW) {
        sound.parry();
        fx.sparks(shieldPos, 18, INK);
        fx.sparks(shieldPos, 8, ICHOR);
        fx.burst(shieldPos, 2.0, WHITE);
        fx.word('PARRY!', shieldPos, '#f0b43c', 1.3);
        fx.impactFrame(0.07, 0.35);
        fx.shake(0.35);
        this.game.hitstop(0.16);
        this.game.slowmo(0.35, 0.45);
        this.game.hud.firstTime('parried', 'Parried! Strike while it reels.');
        return 'parried';
      }
      this.spend(h.damage * 1.6);
      this.staminaDelay = 0.9;
      this.vel.x -= (dx / d) * 4; this.vel.z -= (dz / d) * 4;
      if (this.stamina < 0) {
        this.stamina = 0;
        this.hp -= h.damage * 0.4;
        this.state = 'stagger';
        this.stateT = -0.5;          // a long stagger
        this.blocking = false;
        this.poseFrom = { ...this.pose };
        sound.guardBreak();
        fx.sparks(shieldPos, 20, INK);
        fx.word('BROKEN', shieldPos, '#c9412f', 1);
        fx.shake(0.5);
        this.game.hitstop(0.1);
        if (this.hp <= 0) this.die();
        return 'guardbreak';
      }
      this.hp -= h.damage * 0.08;
      sound.block();
      fx.sparks(shieldPos, 12, INK);
      fx.burst(shieldPos, 1.0, WHITE);
      fx.shake(0.2);
      this.game.hitstop(0.05);
      if (this.hp <= 0) this.die();
      return 'blocked';
    }

    this.hp -= h.damage;
    const chest = this.chest();
    fx.blood(chest, new THREE.Vector3(-dx / d, 0, -dz / d), h.damage < LIGHT_BLOW ? 8 : 14);
    fx.burst(chest, h.damage < LIGHT_BLOW ? 0.8 : 1.2, new THREE.Color(0xc9412f));
    fx.hurt();
    sound.hurt();
    this.game.hud.hurt();
    if (this.hp <= 0) { this.die(); return 'hit'; }

    // Light blows (a raider's machete) don't stop a knight in full armour:
    // mid-swing you shrug them off, otherwise you barely flinch.
    if (h.damage < LIGHT_BLOW) {
      fx.shake(0.25);
      this.game.hitstop(0.04);
      if (this.state === 'attack' || this.state === 'roll') return 'hit';
      this.vel.x -= (dx / d) * 2.5; this.vel.z -= (dz / d) * 2.5;
      this.state = 'stagger';
      this.stateT = STAGGER_TIME - 0.15;    // a short flinch
    } else {
      fx.shake(0.5);
      this.game.hitstop(0.08);
      this.vel.x -= (dx / d) * 6; this.vel.z -= (dz / d) * 6;
      this.state = 'stagger';
      this.stateT = 0;
    }
    this.attack = null;
    this.blocking = false;
    this.poseFrom = { ...this.pose };
    return 'hit';
  }

  die() {
    this.hp = 0;
    this.state = 'dead';
    this.stateT = 0;
    this.attack = null;
    this.blocking = false;
    this.game.sound.death();
    this.game.slowmo(0.3, 1.2);
    this.game.onKnightDeath();
  }

  heal(n) {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  /** Get back charges of resolve (saving survivors, resting at their fires). */
  addResolve(n) {
    const before = this.resolve;
    this.resolve = Math.min(MAX_RESOLVE, this.resolve + n);
    if (this.resolve > before) this.game.hud.resolveFlash();
  }

  /**
   * STEEL YOUR WILL: kneel, plant your sword and gather yourself. Takes a
   * moment, and any blow that lands breaks your focus (the charge isn't
   * used up if that happens). Finish it and your willpower comes back.
   */
  startSteel() {
    this.state = 'steel';
    this.stateT = 0;
    this.attack = null;
    this.blocking = false;
    this.poseFrom = { ...this.pose };
    this.game.sound.choir(1.25);
    this.game.hud.firstTime('steel', 'Hold still... a blow now would break your focus.');
  }

  finishSteel() {
    const fx = this.game.fx;
    this.resolve--;
    this.heal(STEEL_HEAL);
    this.state = 'move';
    this.stateT = 0;
    this.poseFrom = { ...this.pose };
    const c = this.chest();
    fx.burst(c, 1.6, ICHOR);
    fx.word('RESOLVE', c, '#f0b43c', 1);
    fx.ring(this.pos.x, this.pos.z, { speed: 9, max: 4, lift: 0.1 });
    this.game.sound.haloSnap();
  }

  // ================================================================ update
  update(dt, input) {
    if (dt <= 0) { this.updateVisuals(0); return; }
    const game = this.game;
    this.stateT += dt;
    this.invuln -= dt;

    // stamina comes back after a short pause
    this.staminaDelay -= dt;
    if (this.staminaDelay <= 0) this.stamina = Math.min(this.maxStamina, this.stamina + (this.blocking ? 14 : 34) * dt);

    // which way is "forward" for the keys? the way the camera faces
    const rig = game.rig;
    const f = rig.forward(new THREE.Vector3()), r = rig.right(new THREE.Vector3());
    const ix = (input.key('KeyD') ? 1 : 0) - (input.key('KeyA') ? 1 : 0);
    const iz = (input.key('KeyW') ? 1 : 0) - (input.key('KeyS') ? 1 : 0);
    const move = new THREE.Vector3().addScaledVector(f, iz).addScaledVector(r, ix);
    if (move.lengthSq() > 1) move.normalize();

    if (this.state !== 'dead') this.handleInput(dt, input, move);

    // ---------------- state machine ----------------
    let speed = 0;
    let turnTo = null;
    const lock = rig.lock;
    switch (this.state) {
      case 'move': {
        const sprint = input.key('ShiftLeft') || input.key('ShiftRight');
        speed = this.blocking ? GUARD_WALK : sprint ? SPRINT : WALK;
        turnTo = rig.yaw;       // first person: you face where you look
        break;
      }
      case 'charge':
        speed = 1.0;
        turnTo = rig.yaw;
        break;
      case 'attack':
        this.updateAttack(dt, move);
        break;
      case 'roll': {
        const k = this.stateT / ROLL_TIME;
        this.vel.copy(this.rollDir).multiplyScalar(ROLL_SPEED * (1 - k * 0.7));
        if (k >= 1) { this.state = 'move'; this.stateT = 0; }
        break;
      }
      case 'steel': {
        // gold motes rise around you as you gather yourself
        this.moteT = (this.moteT || 0) - dt;
        if (this.moteT <= 0) {
          this.moteT = 0.05;
          const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 0.6;
          game.fx.particle({ x: this.pos.x + Math.cos(a) * r, y: this.pos.y + 0.1, z: this.pos.z + Math.sin(a) * r,
            vy: 1.2 + Math.random(), size: 0.1 + Math.random() * 0.08, frame: 3, color: ICHOR, life: 1, grav: -0.5, drag: 1 });
        }
        if (this.stateT >= STEEL_TIME) this.finishSteel();
        break;
      }
      case 'recoil':
        if (this.stateT > 0.32) { this.state = 'move'; this.stateT = 0; this.poseFrom = { ...this.pose }; }
        break;
      case 'stagger':
        if (this.stateT > STAGGER_TIME) { this.state = 'move'; this.stateT = 0; this.poseFrom = { ...this.pose }; }
        break;
      case 'dead':
        this.deadT += dt;
        break;
    }

    if (turnTo !== null) this.facing = turnTo;
    else if (this.state === 'steel' || this.state === 'recoil' || this.state === 'stagger' || this.state === 'roll') this.facing = rig.yaw;

    // ---------------- movement ----------------
    if (this.state === 'move' || this.state === 'charge') {
      const tx = move.x * speed, tz = move.z * speed;
      const accel = move.lengthSq() > 0.01 ? 12 : 14;
      const k = 1 - Math.exp(-dt * accel);
      this.vel.x += (tx - this.vel.x) * k;
      this.vel.z += (tz - this.vel.z) * k;
    } else if (this.state !== 'roll') {
      const k = Math.exp(-dt * 8);
      this.vel.x *= k; this.vel.z *= k;
    }
    // the lunge forward during a swing
    // (worked out exactly, so it carries you the same distance at any frame rate)
    const fade = Math.exp(-dt * 10);
    this.pos.addScaledVector(this.lunge, (1 - fade) / 10);
    this.lunge.multiplyScalar(fade);

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    game.world.resolveCircle(this.pos, RADIUS);
    const lim = game.world.limit;
    this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x));
    this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));
    this.pos.y = game.world.heightAt(this.pos.x, this.pos.z);

    // footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.walkAmt += ((this.state === 'move' || this.state === 'charge' ? Math.min(1, hs / WALK) : 0) - this.walkAmt) * Math.min(1, dt * 10);
    this.walkPhase += dt * (2.5 + hs * 1.55);
    const step = Math.floor(this.walkPhase / Math.PI);
    if (step !== this.lastStep) {
      this.lastStep = step;
      if (this.walkAmt > 0.3 && this.state === 'move') {
        game.sound.step();
        if (hs > 6) game.fx.dust(this.pos, 2, 0.4);
      }
    }

    this.updateVisuals(dt);
  }

  handleInput(dt, input, move) {
    const can = this.state === 'move';
    // a click that came while you were flinching or rolling: swing now
    if (can && this.clickedAt !== undefined && this.game.realTime - this.clickedAt < CLICK_MEMORY) {
      this.clickedAt = undefined;
      this.requestLight(move);
      return;
    }
    // ---- shield ----
    if (input.mouse.right && !this.blocking && can) {
      this.blocking = true;
      this.blockPressedAt = this.game.realTime;
    }
    if (!input.mouse.right || !can) this.blocking = false;

    // ---- steel your will (heal) ----
    if (input.pressed('KeyF') && can) {
      if (this.resolve <= 0) this.game.hud.hint('No resolve left. Save survivors, or rest by their fires.', 3);
      else if (this.hp >= this.maxHp) this.game.hud.hint('Your will is already unbroken.', 2);
      else { this.startSteel(); return; }
    }

    // ---- roll ----
    if (input.pressed('Space') && this.stamina > 5) {
      const lateRecover = this.state === 'attack' && this.attack.phase === 'recover' && this.attack.t > 0.08;
      if (can || lateRecover || this.state === 'charge') {
        this.lmbHeld = -1;
        this.startRoll(move);
        return;
      }
    }

    // ---- sword: click = slash, hold = heavy ----
    if (input.mouse.leftPressed) this.lmbHeld = 0;
    if (this.lmbHeld >= 0 && input.mouse.left) {
      this.lmbHeld += dt;
      if (this.lmbHeld >= HOLD_FOR_HEAVY && can && this.stamina > 5) {
        this.state = 'charge';
        this.stateT = 0;
        this.blocking = false;
        this.poseFrom = { ...this.pose };
        this.lmbHeld = -2;      // now charging
        this.game.sound.telegraph();
      }
    }
    if (input.mouse.leftReleased) {
      if (this.state === 'charge') {
        const power = Math.min(1, this.stateT / 0.6);
        this.startAttack('heavy', move);
        this.attack.damage *= 0.7 + power * 0.5;
        this.attack.power = power;
      } else if (this.lmbHeld >= 0 && this.lmbHeld < HOLD_FOR_HEAVY) {
        this.requestLight(move);
      }
      this.lmbHeld = -1;
    }
  }

  requestLight(move) {
    if (this.stamina <= 5) return;
    if (this.state === 'move') this.startAttack(1, move);
    else if (this.state === 'attack' && this.attack.n !== 'heavy') this.buffered = true;
    else this.clickedAt = this.game.realTime;   // remember it: swing as soon as you can
  }

  updateAttack(dt, move) {
    const a = this.attack;
    a.t += dt;
    if (a.phase === 'windup' && a.t >= a.windup) this.beginActive();
    else if (a.phase === 'active' && a.t >= a.active) {
      if (a.heavy && !a.slammed) this.heavyImpact();
      a.phase = 'recover';
      a.t = 0;
      a.justEnded = true;     // the blade's last bit of movement still gets checked this frame
    } else if (a.phase === 'recover') {
      if (this.buffered && a.t > 0.05 && this.combo < 3 && this.stamina > 5) {
        this.startAttack(this.combo + 1, move);
        return;
      }
      if (a.t >= a.recover) {
        this.state = 'move';
        this.stateT = 0;
        this.attack = null;
        this.poseFrom = { ...this.pose };
      }
    }
  }

  /** The heavy slam hitting the ground: a shockwave knocks everything back. */
  heavyImpact() {
    const a = this.attack;
    a.slammed = true;
    const game = this.game, fx = game.fx;
    const tip = this.bladeTip.getWorldPosition(new THREE.Vector3());
    const p = new THREE.Vector3(tip.x, game.world.heightAt(tip.x, tip.z), tip.z);
    fx.crack(p.x, p.z, 3.2 + (a.power || 0) * 1.5);
    fx.dust(p, 16, 1.6);
    fx.shards(p, 10, new THREE.Color(0x9b9282), 0.8);
    fx.ring(p.x, p.z, { color: 0x1d1913, speed: 22, max: 5, lift: 0.1 });
    fx.shake(0.55 + (a.power || 0) * 0.2);
    fx.speedLines = Math.max(fx.speedLines, 0.12);
    game.sound.slam();
    game.hitstop(0.07);
    game.angels.shockwave(p, 3.6, 12 + (a.power || 0) * 14, this);
    game.humans.shockwave(p, 3.6, 20 + (a.power || 0) * 20);
  }

  // ================================================================ animation
  /** The pose the arms settle into when nothing is happening. */
  restPose() { return this.fp ? this.fpPoses.idle : POSES.idle; }

  updateVisuals(dt) {
    const target = {};
    const st = this.state;
    if (st === 'attack') {
      const a = this.attack;
      const from = POSES[a.from], to = POSES[a.to];
      if (a.phase === 'windup') blend(target, this.poseFrom, from, ease(Math.min(1, a.t / a.windup)));
      else if (a.phase === 'active') blend(target, from, to, easeInOut(Math.min(1, a.t / a.active)));
      else blend(target, to, this.restPose(), ease(Math.min(1, a.t / a.recover)));
      Object.assign(this.pose, target);
    } else if (st === 'charge') {
      blend(target, this.poseFrom, POSES.Ha, ease(Math.min(1, this.stateT / 0.25)));
      const tremble = Math.min(1, this.stateT / 0.6) * 0.04;
      target.armRx += (Math.random() - 0.5) * tremble;
      target.torsoY += (Math.random() - 0.5) * tremble;
      Object.assign(this.pose, target);
    } else if (st === 'recoil') {
      blend(target, POSES.recoil, this.restPose(), ease(Math.min(1, this.stateT / 0.32)));
      Object.assign(this.pose, target);
    } else if (st === 'steel') {
      blend(target, this.poseFrom, POSES.kneel, ease(Math.min(1, this.stateT / 0.35)));
      target.headY = 0;
      target.torsoX += Math.sin(this.stateT * 2) * 0.03;      // slow breathing
      Object.assign(this.pose, target);
    } else if (st === 'stagger' || st === 'dead') {
      blend(target, POSES.stagger, this.restPose(), st === 'dead' ? 0 : ease(Math.max(0, Math.min(1, this.stateT / 0.38))));
      Object.assign(this.pose, target);
    } else {
      const goal = this.blocking ? (this.fp ? this.fpPoses.block : POSES.block) : this.restPose();
      const k = dt > 0 ? 1 - Math.exp(-dt * (this.blocking ? 22 : 10)) : 0;
      blend(this.pose, this.pose, goal, k);
      // arms swing a little when walking
      const sw = Math.sin(this.walkPhase) * this.walkAmt;
      this.pose.armRx = this.pose.armRx + sw * 0.05;
      this.pose.torsoY = this.pose.torsoY + sw * 0.06;
    }
    this.applyPose(this.pose);

    // legs: walking cycle, attack stance or a tuck while rolling
    const [L, R] = this.legs;
    const s = Math.sin(this.walkPhase) * this.walkAmt;
    let stance = 0;
    if (st === 'attack' || st === 'charge') stance = 1;
    L.hip.rotation.x = -s * 0.7 - stance * 0.35;
    R.hip.rotation.x = s * 0.7 + stance * 0.3;
    L.knee.rotation.x = Math.max(0, Math.sin(this.walkPhase + 1.4)) * 0.9 * this.walkAmt + 0.08 + stance * 0.25;
    R.knee.rotation.x = Math.max(0, Math.sin(this.walkPhase + 1.4 + Math.PI)) * 0.9 * this.walkAmt + 0.08 + stance * 0.35;
    this.hips.position.y = 1.0 - Math.abs(Math.cos(this.walkPhase)) * 0.05 * this.walkAmt - stance * 0.06 - (this.blocking ? 0.05 : 0);

    // roll: a full forward tumble; dead: fall over backwards
    if (st === 'roll') {
      const k = Math.min(1, this.stateT / ROLL_TIME);
      this.rollPivot.rotation.x = easeInOut(k) * Math.PI * 2;
      this.rollPivot.position.y = 0.95 - Math.sin(k * Math.PI) * 0.45;
      L.knee.rotation.x = R.knee.rotation.x = 1.8;
      L.hip.rotation.x = R.hip.rotation.x = -1.4;
    } else if (st === 'steel') {
      // down on one knee
      const k = ease(Math.min(1, this.stateT / 0.35));
      this.rollPivot.rotation.x = 0;
      this.rollPivot.position.y = 0.95 - 0.45 * k;
      L.hip.rotation.x = -1.45 * k; L.knee.rotation.x = 1.55 * k;
      R.hip.rotation.x = 0.4 * k; R.knee.rotation.x = 2.05 * k;
    } else if (st === 'dead') {
      const k = Math.min(1, this.deadT / 0.7);
      this.rollPivot.rotation.x = -easeInOut(k) * Math.PI / 2;
      this.rollPivot.position.y = 0.95 - k * 0.72;
    } else {
      this.rollPivot.rotation.x = 0;
      this.rollPivot.position.y = 0.95;
    }

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.facing;
    this.shadow.position.set(this.pos.x, this.pos.y + 0.03, this.pos.z);
    this.updateCape(dt);

    // ---------------- the blade: trail and hits ----------------
    this.root.updateMatrixWorld(true);
    this.bladeBase.getWorldPosition(this._b1);
    this.bladeTip.getWorldPosition(this._t1);
    if (st === 'attack' && (this.attack.phase === 'active' || this.attack.justEnded) && dt > 0) {
      const a = this.attack;
      if (this.prevBladeValid) this.sweepSwing(a);
      if (a.justEnded && this.state === 'attack') {
        a.justEnded = false;
        settleSoft(this.game, a, this);
      }
      this.game.fx.trailPush(this._b1, this._t1, a.heavy ? ICHOR : INK);
    } else if (st === 'attack' && this.attack.phase === 'recover' && this.attack.t < 0.05 && dt > 0) {
      this.game.fx.trailPush(this._b1, this._t1, this.attack.heavy ? ICHOR : INK);
    }
    this.prevBladeValid = true;
    this._b0.copy(this._b1);
    this._t0.copy(this._t1);
    this.prevRoot.copy(this.root.position);
  }

  /**
   * Check what the sword passed through since last frame. Rather than just
   * joining last frame's blade to this frame's with a straight line (which
   * cuts the corner of the swing's curve when the frame rate is low), we
   * re-pose the arm at many tiny moments in between - 120 a second - and
   * check each little piece of the real curved path.
   */
  sweepSwing(a) {
    const tNow = a.justEnded ? a.active : Math.min(a.t, a.active);
    const t0 = this.prevActiveT;
    const steps = Math.max(1, Math.ceil((tNow - t0) * 120));
    const from = POSES[a.from], to = POSES[a.to];
    const pose = {};
    const rootNow = this._rootNow.copy(this.root.position);
    const pb = this._pb.copy(this._b0), pt = this._pt.copy(this._t0);
    const b = this._sb, t = this._st;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      blend(pose, from, to, easeInOut(Math.min(1, (t0 + (tNow - t0) * k) / a.active)));
      this.applyPose(pose);
      this.root.position.lerpVectors(this.prevRoot, rootNow, k);
      this.root.updateMatrixWorld(true);
      this.bladeBase.getWorldPosition(b);
      this.bladeTip.getWorldPosition(t);
      sweep(this.game, pb, pt, b, t, a, this);
      if (this.state !== 'attack') break;      // bounced off armour
      pb.copy(b);
      pt.copy(t);
    }
    this.prevActiveT = tNow;
    // put the knight back exactly as it should look this frame
    this.applyPose(this.pose);
    this.root.position.copy(rootNow);
    this.root.updateMatrixWorld(true);
    this.bladeBase.getWorldPosition(this._b1);
    this.bladeTip.getWorldPosition(this._t1);
  }
}
