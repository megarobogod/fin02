// =====================================================
// angels.js - heaven's exterminators
//
// Angels are RARE. Every few minutes the sky opens and ONE comes down, and
// it is the most dangerous thing in the city: two or three blows from one
// will kill you. Everyone else (raiders included) runs for their lives, and
// the angel will cut down anyone it catches.
//
// Each angel is made of "parts" (see combat.js) and hides its weak point:
//   Herald - spear lunges. Heart on its chest. Folds its wings over the heart
//            if you hit it too much: parry it, or smash the guard (heavy).
//   Choir  - hovers out of reach and fires beams. Heart on its BACK. After a
//            beam it sinks, exhausted, and turns. Snap its halo to silence it.
//            Parry a beam to throw it back.
//   Ophan  - a wheel of eyes. Rings are armour. Break the eyes and its core
//            drops, bare. Roll through its shockwave rings.
//
// Land the killing blow and cinematic.js takes over for the execution.
// =====================================================
import * as THREE from 'three';
import { GOLD_HEX, castShadows } from './materials.js';
import { ICHOR, INK, WHITE } from './fx.js';
import { KIND } from './combat.js';
import { lathe, capsule, ellipsoid, wingGeo, plate } from './shapes.js';

const TYPES = {
  herald: { hp: 650, poise: 120, hover: 0.25, speed: 3.6, radius: 0.7, title: 'Herald of the Seventh Choir' },
  choir: { hp: 500, poise: 90, hover: 3.4, speed: 3.0, radius: 0.7, title: 'Choir of the Burning Hymn' },
  ophan: { hp: 1300, poise: Infinity, hover: 2.2, speed: 2.4, radius: 1.5, title: 'Ophan, the Wheel That Watches' },
};
const HIT = { lunge: 38, beam: 45, burst: 40, ram: 45 };   // damage to the knight (out of 100)

function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ---------- shapes shared by every angel (made once) ----------
let G = null;
function shapes() {
  if (G) return G;
  G = {};
  // a flowing robe with folds: a lathe whose radius ripples round the hem
  const robe = (len, hem) => {
    const g = lathe([[0.2, len], [0.24, len - 0.15], [0.3, len * 0.6], [hem * 0.85, len * 0.25], [hem, 0.0], [hem * 0.96, -0.02]], 40);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
      const a = Math.atan2(z, x);
      const k = (1 - y / len) * 0.06;
      const r = 1 + Math.sin(a * 7) * k + Math.sin(a * 13 + 1) * k * 0.4;
      p.setX(i, x * r); p.setZ(i, z * r);
    }
    g.computeVertexNormals();
    return g;
  };
  G.robe = robe(1.25, 0.55);
  G.robeLong = robe(1.6, 0.5);
  G.torso = lathe([[0.0, 1.18], [0.21, 1.18], [0.25, 1.35], [0.27, 1.55], [0.22, 1.75], [0.12, 1.86], [0.0, 1.87]], 24, 0.8);
  G.neck = capsule(0.06, 0.3, 0.08, 0.0);
  G.head = new THREE.SphereGeometry(0.16, 48, 36);
  G.heart = new THREE.OctahedronGeometry(0.13, 0);
  G.slit = new THREE.BoxGeometry(0.03, 0.2, 0.03);
  G.halo = new THREE.TorusGeometry(0.3, 0.022, 16, 72);
  G.haloBig = new THREE.TorusGeometry(0.4, 0.026, 16, 80);
  G.ray = new THREE.ConeGeometry(0.018, 0.22, 6);
  G.trim = new THREE.TorusGeometry(0.235, 0.022, 14, 56);
  G.arm = capsule(0.045, 0.62, 0.055);
  G.hand = ellipsoid(0.038, 0.062, 0.026, 18);
  G.shaft = new THREE.CylinderGeometry(0.025, 0.025, 2.8, 20); G.shaft.rotateX(Math.PI / 2);
  G.spearTip = lathe([[0, 0], [0.07, 0.08], [0.09, 0.22], [0.05, 0.42], [0, 0.55]], 4); G.spearTip.rotateX(Math.PI / 2); G.spearTip.scale(1, 0.3, 1);
  G.spearBar = new THREE.TorusGeometry(0.14, 0.018, 8, 20, Math.PI);
  G.wingBig = wingGeo(1.25);
  G.wingSmall = wingGeo(0.75, 10);
  G.ring = new THREE.TorusGeometry(1.7, 0.15, 28, 128);
  G.ring2 = new THREE.TorusGeometry(1.25, 0.12, 24, 112);
  G.ringRunes = new THREE.TorusGeometry(1.7, 0.17, 4, 24);
  G.eye = new THREE.SphereGeometry(0.24, 40, 28);
  G.iris = new THREE.CircleGeometry(0.13, 24);
  G.irisRing = new THREE.TorusGeometry(0.13, 0.012, 6, 24);
  G.pupil = new THREE.CircleGeometry(0.055, 16);
  G.core = new THREE.IcosahedronGeometry(0.5, 3);
  G.beam = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
  G.arrow = new THREE.PlaneGeometry(1.5, 16); G.arrow.rotateX(-Math.PI / 2); G.arrow.translate(0, 0, 8);
  return G;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
let nextId = 1;

class Angel {
  constructor(game, owner, type, x, z) {
    this.game = game;
    this.owner = owner;
    this.isAngel = true;
    this.type = type;
    this.def = TYPES[type];
    this.radius = this.def.radius;
    this.id = nextId++;
    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.poise = this.def.poise;
    this.pos = new THREE.Vector3(x, 0, z);
    this.kb = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.flash = { value: 0 };
    this.parts = [];
    this.debrisParts = [];
    this.state = 'arrive';
    this.stateT = 0;
    this.t = Math.random() * 10;
    this.hover = this.def.hover;
    this.hoverCur = this.def.hover + 22;
    this.cd = 1.5;
    this.alive = true;
    this.removed = false;
    this.recentHits = 0;
    this.recentT = 0;
    this.guarding = false;
    this.prey = null;

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    game.scene.add(this.root);

    this.bang = game.fx.sign('!', '#f0b43c', 1.0);
    this.bang.visible = false;
    this.root.add(this.bang);
    this.bangRed = game.fx.sign('!!', '#c9412f', 1.0);
    this.bangRed.visible = false;
    this.root.add(this.bangRed);

    if (type === 'herald') this.buildHerald();
    else if (type === 'choir') this.buildChoir();
    else this.buildOphan();
    castShadows(this.body);
    this.bang.position.y = this.topY + 0.6;
    this.bangRed.position.y = this.topY + 0.6;
  }

  // ================================================================ building
  addPart(name, obj, r, kind, extra = {}) {
    const p = { name, obj, r, kind, wp: new THREE.Vector3(), broken: false, active: () => true, ...extra };
    this.parts.push(p);
    return p;
  }
  marker(x, y, z, parent = this.body) {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  }
  mats() {
    const S = this.game.mats;
    return {
      // marble-white robes and feathers, a glazed porcelain face, gilded trim
      pale: S.fill(0xe8e2d6, { flash: this.flash, side: THREE.DoubleSide, rough: 0.6 }),
      shade: S.fill(0xcfc6b4, { flash: this.flash, side: THREE.DoubleSide, rough: 0.7 }),
      porcelain: S.fill(0xf4f0e8, { flash: this.flash, rough: 0.25, coat: true }),
      gold: S.glow(GOLD_HEX),
      paleGold: S.fill(0xd9b56a, { flash: this.flash, metal: 1, rough: 0.3 }),
    };
  }
  put(geo, mat, parent, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  makeHeart(x, y, z) {
    const heart = this.put(shapes().heart, this.game.mats.glow(GOLD_HEX), this.body, x, y, z);
    heart.add(this.game.fx.glowSprite(1.0));
    this.heart = heart;
    return heart;
  }

  /** The shared body: robe, torso, neck, the smooth faceless head. */
  makeBody(m, long) {
    const g = shapes(), B = this.body;
    this.robe = this.put(long ? g.robeLong : g.robe, m.pale, B, 0, long ? -0.35 : 0, 0);
    this.put(g.torso, m.pale, B);
    this.put(g.trim, m.paleGold, B, 0, 1.2, 0).rotation.x = Math.PI / 2;
    this.put(g.trim, m.paleGold, B, 0, 1.8, 0).scale.setScalar(0.62);
    this.put(g.neck, m.pale, B, 0, 2.0, 0);
    const head = this.put(g.head, m.porcelain, B, 0, 2.3, 0);
    head.scale.set(1, 1.42, 1.08);
    this.slit = this.put(g.slit, m.gold, B, 0, 2.3, 0.165);
    return head;
  }

  /** Wings: pivots on the back, each a whole fan of feathers. */
  makeWings(tiers, m) {
    const wings = [];
    tiers.forEach((tier, ti) => {
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.rotation.order = 'YXZ';
        pivot.position.set(side * 0.13, tier.y, -0.16);
        const geo = tier.small ? shapes().wingSmall : shapes().wingBig;
        const wing = this.put(geo, ti % 2 ? m.shade : m.pale, pivot);
        wing.scale.set(side, tier.down ? -1 : 1, 1);        // mirror for the other side
        wing.rotation.z = tier.down ? side * 0.4 : 0;
        const baseY = tier.wrap ? -side * 1.15 : side * 0.4;
        pivot.rotation.y = baseY;
        // armour point out toward the wing tip
        const mk = this.marker(side * 1.0 * (tier.small ? 0.6 : 1), tier.down ? -0.35 : 0.3, 0, pivot);
        this.body.add(pivot);
        this.addPart('wing', mk, tier.small ? 0.22 : 0.3, 'armor', { soft: true });
        wings.push({ pivot, side, tier: ti, baseY, wrap: !!tier.wrap });
        this.debrisParts.push(pivot);
      }
    });
    return wings;
  }

  makeHalo(geo, y, z, rays, m) {
    const halo = this.put(geo, m.gold, this.body, 0, y, z);
    const R = geo.parameters.radius;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      const ray = this.put(shapes().ray, m.gold, halo, Math.cos(a) * (R + 0.13), Math.sin(a) * (R + 0.13), 0);
      ray.rotation.z = a - Math.PI / 2;
    }
    this.halo = halo;
    return halo;
  }

  buildHerald() {
    const g = shapes(), m = this.mats(), B = this.body;
    const head = this.makeBody(m, false);
    const heart = this.makeHeart(0, 1.5, 0.21);
    this.makeHalo(g.halo, 2.6, -0.12, 12, m);
    this.wings = this.makeWings([{ y: 1.78 }, { y: 1.5, small: true, down: true }], m);

    // the spear arm
    const arm = new THREE.Group(); arm.position.set(-0.3, 1.74, 0.02); B.add(arm);
    this.put(g.arm, m.pale, arm);
    this.put(g.hand, m.porcelain, arm, 0, -0.62, 0);
    const spear = new THREE.Group(); spear.position.y = -0.62; arm.add(spear);
    this.put(g.shaft, m.paleGold, spear, 0, 0, 0.4);
    this.put(g.spearTip, m.gold, spear, 0, 0, 1.8);
    this.put(g.spearBar, m.gold, spear, 0, 0, 1.78).rotation.x = Math.PI / 2;
    this.spearTip = this.marker(0, 0, 2.3, spear);
    arm.rotation.x = -0.9; spear.rotation.x = 0.9;
    this.arm = arm; this.spear = spear;
    const armL = new THREE.Group(); armL.position.set(0.3, 1.74, 0); armL.rotation.z = 0.15; B.add(armL);
    this.put(g.arm, m.pale, armL);
    this.put(g.hand, m.porcelain, armL, 0, -0.62, 0);

    this.heartPart = this.addPart('heart', heart, 0.25, 'weak', { active: () => !this.guarding });
    this.haloPart = this.addPart('halo', this.halo, 0.36, 'halo');
    this.addPart('head', head, 0.25, 'armor');
    this.addPart('torso', this.marker(0, 1.5, 0), 0.3, 'body');
    this.addPart('robe', this.marker(0, 0.7, 0), 0.45, 'body');
    this.addPart('guard', this.marker(0, 1.55, 0.45), 0.45, 'armor', { active: () => this.guarding });
    this.lockPoint = heart;
    this.topY = 2.9;
    this.debrisParts.push(this.halo, spear);
  }

  buildChoir() {
    const g = shapes(), m = this.mats(), B = this.body;
    const head = this.makeBody(m, true);
    const heart = this.makeHeart(0, 1.5, -0.24);
    this.makeHalo(g.haloBig, 2.4, -0.2, 16, m);
    // four wings wrapped round the front like a cocoon
    this.wings = this.makeWings([{ y: 1.78, wrap: true }, { y: 1.4, small: true, wrap: true, down: true }], m);
    for (const s of [-1, 1]) {
      const arm = new THREE.Group(); arm.position.set(s * 0.28, 1.74, 0.05); arm.rotation.x = -2.5; arm.rotation.z = -s * 0.25;
      this.put(g.arm, m.pale, arm);
      this.put(g.hand, m.porcelain, arm, 0, -0.62, 0);
      B.add(arm);
    }
    this.heartPart = this.addPart('heart', heart, 0.25, 'weak');
    this.haloPart = this.addPart('halo', this.halo, 0.45, 'halo');
    this.addPart('head', head, 0.25, 'armor');
    this.addPart('cocoon', this.marker(0, 1.45, 0.42), 0.5, 'armor');
    this.addPart('torso', this.marker(0, 1.5, 0), 0.3, 'body');
    this.addPart('robe', this.marker(0, 0.6, 0), 0.4, 'body');
    this.lockPoint = heart;
    this.topY = 3.0;
    this.debrisParts.push(this.halo);

    const scene = this.game.scene;
    this.tele = new THREE.Mesh(g.beam, new THREE.MeshBasicMaterial({ color: GOLD_HEX, transparent: true, opacity: 0.7, depthWrite: false }));
    this.tele.visible = false;
    this.tele.renderOrder = 7;
    scene.add(this.tele);
    this.beamMesh = new THREE.Mesh(g.beam, new THREE.MeshBasicMaterial({ color: 0xfff3cf, transparent: true, opacity: 0.95, depthWrite: false }));
    this.beamMesh.add(new THREE.Mesh(g.beam, new THREE.MeshBasicMaterial({ color: GOLD_HEX, transparent: true, opacity: 0.45, depthWrite: false })));
    this.beamMesh.children[0].scale.set(2.2, 1, 2.2);
    this.beamMesh.visible = false;
    this.beamMesh.renderOrder = 8;
    scene.add(this.beamMesh);
    this.reflectMesh = this.beamMesh.clone();
    this.reflectMesh.visible = false;
    scene.add(this.reflectMesh);
    this.aim = new THREE.Vector3();
    this.beamT = 0;
  }

  buildOphan() {
    const g = shapes(), m = this.mats(), B = this.body;
    const S = this.game.mats;
    const tarn = S.fill(0xc9a866, { flash: this.flash, metal: 1, rough: 0.38 });
    const white = S.fill(0xf6f2e8, { flash: this.flash, rough: 0.15, coat: true });
    const ink = S.glow(0x1d1913);
    this.core = this.put(g.core, m.gold, B);
    this.core.add(this.game.fx.glowSprite(2.6));

    // the outer ring is edge-on to you, so its eyes sweep right past your sword
    this.outer = new THREE.Group(); this.outer.rotation.y = Math.PI / 2; B.add(this.outer);
    this.outerSpin = new THREE.Group(); this.outer.add(this.outerSpin);
    this.put(g.ring, tarn, this.outerSpin);
    this.put(g.ringRunes, m.paleGold, this.outerSpin).scale.set(1, 1, 0.5);
    this.inner = new THREE.Group(); B.add(this.inner);
    this.innerSpin = new THREE.Group(); this.inner.add(this.innerSpin);
    this.put(g.ring2, tarn, this.innerSpin);

    this.eyes = [];
    const addEye = (spin, R, t) => {
      const dir = new THREE.Vector3(Math.cos(t), Math.sin(t), 0);
      const eye = this.put(g.eye, white, spin);
      eye.position.copy(dir).multiplyScalar(R);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      for (const [geo, mat, d] of [[g.iris, m.gold, 0.236], [g.irisRing, ink, 0.238], [g.pupil, ink, 0.242]]) {
        const o = new THREE.Mesh(geo, mat);
        o.position.copy(dir).multiplyScalar(d);
        o.quaternion.copy(q);
        eye.add(o);
      }
      this.eyes.push(this.addPart('eye', eye, 0.3, 'eye', { hp: 120 }));
    };
    for (let i = 0; i < 4; i++) addEye(this.outerSpin, 1.7, (i / 4) * Math.PI * 2 + Math.PI / 4);
    for (let i = 0; i < 3; i++) addEye(this.innerSpin, 1.25, (i / 3) * Math.PI * 2 + Math.PI / 6);
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2;
      this.addPart('ring', this.marker(Math.cos(t) * 1.7, Math.sin(t) * 1.7, 0, this.outerSpin), 0.22, 'armor', { mult: 0.04 });
    }
    for (let i = 0; i < 6; i++) {
      const t = (i / 6) * Math.PI * 2;
      this.addPart('ring', this.marker(Math.cos(t) * 1.25, Math.sin(t) * 1.25, 0, this.innerSpin), 0.2, 'armor', { mult: 0.04 });
    }
    this.corePart = this.addPart('core', this.core, 0.62, 'core', { active: () => this.exposed });
    this.heart = this.core;
    this.exposed = false;
    this.spinRate = 0.9;
    this.lockPoint = this.core;
    this.topY = 2.0;
    this.debrisParts.push(this.outer, this.inner);

    this.arrow = new THREE.Mesh(g.arrow, new THREE.MeshBasicMaterial({ color: 0x1d1913, transparent: true, opacity: 0.35, depthWrite: false, depthTest: false }));
    this.arrow.visible = false;
    this.arrow.renderOrder = 4;
    this.game.scene.add(this.arrow);
  }

  // ================================================================ helpers
  setState(s) { this.state = s; this.stateT = 0; }
  hittable() { return this.alive && this.state !== 'arrive'; }
  face(target, rate, dt) { this.yaw = angleLerp(this.yaw, target, 1 - Math.exp(-dt * rate)); }
  step(angle, speed, dt) {
    this.pos.x += Math.sin(angle) * speed * dt;
    this.pos.z += Math.cos(angle) * speed * dt;
  }
  updateParts() {
    this.root.updateMatrixWorld(true);
    for (const p of this.parts) p.obj.getWorldPosition(p.wp);
  }
  aimPoint(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    return this.lockPoint.getWorldPosition(out);
  }
  center(out = new THREE.Vector3()) {
    return out.set(this.root.position.x, this.root.position.y + (this.type === 'ophan' ? 0 : 1.5), this.root.position.z);
  }

  /** Who is it going after? You, if you're close. Otherwise any human it can reach. */
  choosePrey() {
    const k = this.game.knight;
    const dk = Math.hypot(k.pos.x - this.pos.x, k.pos.z - this.pos.z);
    let prey = k.alive ? k : null, best = k.alive ? dk - 10 : 1e9;
    for (const p of this.game.humans.list) {
      if (!p.alive) continue;
      const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      if (d < 20 && d < best) { best = d; prey = p; }
    }
    this.prey = prey;
    return prey;
  }

  damage(n, weak = false) {
    if (!this.alive) return;
    this.hp -= n;
    this.flash.value = 1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.byWeak = weak;
      this.setState('finisher');
      this.bang.visible = this.bangRed.visible = false;
      if (this.tele) this.tele.visible = false;
      if (this.arrow) this.arrow.visible = false;
      this.game.cinematic.play(this);       // the execution
    }
  }

  poiseHit(n) {
    if (!isFinite(this.def.poise)) return;
    this.poise -= n;
    if (this.poise <= 0) { this.poise = this.def.poise; this.stagger(1.4); }
  }

  stagger(dur) {
    if (!this.alive) return;
    this.setState('stagger');
    this.staggerDur = dur;
    this.guarding = false;
    this.bang.visible = false;
    this.bangRed.visible = false;
    if (this.tele) this.tele.visible = false;
    if (this.arrow) this.arrow.visible = false;
  }

  react(kind) {
    if (this.type !== 'herald' || kind === 'weak') return;
    this.recentHits++;
    this.recentT = 2;
    if (this.recentHits >= 3 && (this.state === 'stalk' || this.state === 'recover')) {
      this.recentHits = 0;
      this.guarding = true;
      this.setState('guard');
      this.game.hud.firstTime('guard', 'It shields its heart with its wings. Parry, or break the guard with a heavy blow.');
    }
  }

  breakHalo(dir) {
    if (this.haloBroken) return;
    this.haloBroken = true;
    this.haloPart.broken = true;
    this.debrisParts = this.debrisParts.filter((o) => o !== this.halo);
    this.root.updateMatrixWorld(true);
    this.game.fx.addDebris(this.halo, new THREE.Vector3(dir.x * 4, 4, dir.z * 4), new THREE.Vector3(6, 2, 4), 0.05);
    if (this.type === 'choir') {
      this.silenced = true;
      this.game.hud.firstTime('silence', 'Halo snapped. That Choir can no longer sing.');
    }
    this.stagger(2.2);
  }

  breakEye(part) {
    part.broken = true;
    part.obj.visible = false;
    this.damage(120);
    if (this.alive && this.eyes.every((e) => e.broken)) {
      this.exposed = true;
      this.hover = 1.3;
      this.game.fx.word('EXPOSED', part.wp, '#f0b43c', 1.2);
      this.game.sound.haloSnap();
      this.game.hud.firstTime('core', 'Its eyes are gone and its core is bare. Strike it!');
    }
  }

  dispose() {
    this.game.scene.remove(this.root);
    for (const m of [this.tele, this.beamMesh, this.reflectMesh, this.arrow]) if (m) this.game.scene.remove(m);
    this.removed = true;
  }

  // ================================================================ every frame
  update(dt) {
    const game = this.game, w = game.world;
    this.t += dt;
    this.stateT += dt;
    this.flash.value = Math.max(0, this.flash.value - dt * 5);
    this.recentT -= dt;
    if (this.recentT <= 0) this.recentHits = 0;
    if (this.state === 'finisher') return;     // the cinematic is in charge

    const prey = this.choosePrey() || game.knight;
    const dx = prey.pos.x - this.pos.x, dz = prey.pos.z - this.pos.z;
    this.dist = Math.hypot(dx, dz);
    this.toPrey = Math.atan2(dx, dz);

    if (this.type === 'herald') this.thinkHerald(dt, prey);
    else if (this.type === 'choir') this.thinkChoir(dt, prey);
    else this.thinkOphan(dt, prey);

    this.pos.addScaledVector(this.kb, dt);
    this.kb.multiplyScalar(Math.exp(-dt * 4));
    const lim = w.limit;
    this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x));
    this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));
    const g = w.heightAt(this.pos.x, this.pos.z);
    this.hoverCur += (this.hover - this.hoverCur) * (1 - Math.exp(-dt * (this.state === 'arrive' ? 1.6 : 3)));
    const bob = Math.sin(this.t * 1.7) * 0.08;
    this.root.position.set(this.pos.x, g + this.hoverCur + bob, this.pos.z);
    this.root.rotation.y = this.yaw;
    this.pos.y = g;

    if (this.type === 'herald') this.animHerald(dt);
    else if (this.type === 'choir') this.animChoir(dt);
    else this.animOphan(dt);
  }

  /** Hit whoever it's attacking. Humans who aren't you simply die. */
  hitPrey(prey, dmg, opts) {
    if (prey === this.game.knight) return prey.takeHit({ damage: dmg, from: this.pos, ...opts });
    this.game.fx.burst(prey.aimPoint(), 1.4, ICHOR);
    return prey.takeHit({ damage: 999, from: this.pos, by: 'angel' });
  }

  // ---------------------------------------------------------------- Herald
  thinkHerald(dt, prey) {
    const game = this.game;
    switch (this.state) {
      case 'arrive':
        this.face(this.toPrey, 3, dt);
        if (this.stateT > 2.2) this.setState('stalk');
        break;
      case 'stalk': {
        this.face(this.toPrey, 6, dt);
        const want = 2.0;
        if (this.dist > want + 0.3) this.step(this.toPrey, this.def.speed * (this.dist > 8 ? 1.8 : 1), dt);
        else if (this.dist < want - 0.5) this.step(this.toPrey + Math.PI, 1.5, dt);
        this.step(this.toPrey + Math.PI / 2, Math.sin(this.t * 0.7 + this.id) * 1.2, dt);
        this.cd -= dt;
        if (this.cd <= 0 && this.dist < 3.6) {
          this.setState('windup');
          this.bang.visible = true;
          game.sound.telegraph();
          // below half health it strikes three times in a row
          this.lunges = this.hp < this.maxHp * 0.5 ? 3 : 1;
        }
        break;
      }
      case 'windup':
        this.face(this.toPrey, 8, dt);
        if (this.stateT > 0.62) {
          this.setState('strike');
          this.lungeYaw = this.yaw;
          this.struck = false;
          this.bang.visible = false;
          game.sound.thrust();
        }
        break;
      case 'strike': {
        this.step(this.lungeYaw, 10, dt);
        if (!this.struck && prey.alive) {
          this.root.updateMatrixWorld(true);
          const tip = this.spearTip.getWorldPosition(tmpA);
          const chest = prey.chest(tmpB);
          if (Math.hypot(tip.x - chest.x, tip.z - chest.z) < 0.8 && Math.abs(tip.y - chest.y) < 1.1) {
            this.struck = true;
            const r = this.hitPrey(prey, HIT.lunge, { blockable: true, parryable: true });
            if (r === 'parried') { this.lunges = 0; this.stagger(1.9); break; }
            if (r === 'dodged') this.struck = false;
          }
        }
        if (this.stateT > 0.26) {
          this.lunges--;
          if (this.lunges > 0) { this.setState('windup'); this.stateT = 0.3; this.bang.visible = true; }
          else this.setState('recover');
        }
        break;
      }
      case 'recover':
        if (this.stateT > 0.8) { this.setState('stalk'); this.cd = 1.0 + Math.random() * 1.4; }
        break;
      case 'guard':
        this.face(this.toPrey, 6, dt);
        if (this.stateT > 1.5) {
          this.guarding = false;
          this.lunges = 1;
          this.setState('windup');
          this.stateT = 0.3;
          this.bang.visible = true;
          game.sound.telegraph();
        }
        break;
      case 'stagger':
        if (this.stateT > this.staggerDur) { this.setState('stalk'); this.cd = 0.6 + Math.random(); }
        break;
    }
  }

  animHerald(dt) {
    const st = this.state;
    this.heart.scale.setScalar(1 + Math.sin(this.t * 6) * 0.12 + (st === 'stagger' ? 0.3 : 0));
    if (!this.haloBroken) this.halo.rotation.z += dt * 0.6;
    let ax = -0.9;
    if (st === 'windup') ax = -0.2;
    else if (st === 'strike') ax = -1.5;
    else if (st === 'recover') ax = -0.6;
    else if (st === 'stagger') ax = -0.3;
    this.arm.rotation.x += (ax - this.arm.rotation.x) * (1 - Math.exp(-dt * (st === 'strike' ? 30 : 10)));
    this.spear.rotation.x = -this.arm.rotation.x;
    this.slit.scale.y = st === 'windup' ? 1.6 + Math.sin(this.t * 40) * 0.4 : 1;
    this.animWings(dt);
    const tilt = st === 'stagger' ? -0.35 : st === 'strike' ? 0.25 : st === 'windup' ? -0.12 : 0;
    this.body.rotation.x += (tilt - this.body.rotation.x) * (1 - Math.exp(-dt * 8));
  }

  animWings(dt, flare = 0) {
    for (const wg of this.wings) {
      const guard = this.guarding && wg.tier === 0;
      const target = guard ? -wg.side * 1.3 : wg.baseY + wg.side * flare;
      wg.pivot.rotation.y += (target - wg.pivot.rotation.y) * (1 - Math.exp(-dt * 10));
      wg.pivot.rotation.x = Math.sin(this.t * 2.2 + wg.tier) * 0.1;
    }
  }

  // ---------------------------------------------------------------- Choir
  thinkChoir(dt, prey) {
    const game = this.game;
    this.beamT -= dt;
    if (this.beamT <= 0) { this.beamMesh.visible = false; this.reflectMesh.visible = false; }
    switch (this.state) {
      case 'arrive':
        this.face(this.toPrey, 3, dt);
        if (this.stateT > 2.2) this.setState('hover');
        break;
      case 'hover': {
        this.hover = this.silenced ? 0.45 : 3.4;
        this.face(this.toPrey, 4, dt);
        const want = this.silenced ? 2.5 : 12;
        if (this.dist > want + 3) this.step(this.toPrey, this.def.speed, dt);
        else if (this.dist < want - 3) this.step(this.toPrey + Math.PI, this.def.speed, dt);
        this.step(this.toPrey + Math.PI / 2, Math.sin(this.t * 0.5 + this.id) * 2, dt);
        if (!this.silenced) {
          this.cd -= dt;
          if (this.cd <= 0 && this.dist < 30) {
            this.setState('charge');
            this.target = prey;
            this.bang.visible = true;
            game.sound.beamCharge();
            if (prey === game.knight) game.hud.firstTime('choir', 'A Choir is singing a beam. Roll aside, or parry it straight back.');
          }
        }
        break;
      }
      case 'charge': {
        const tgt = this.target && this.target.alive ? this.target : prey;
        this.face(Math.atan2(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z), 5, dt);
        if (this.stateT < 0.8) tgt.chest(this.aim);
        this.root.updateMatrixWorld(true);
        const src = this.halo.getWorldPosition(tmpA);
        tmpB.subVectors(this.aim, src).normalize();
        this.setSegment(this.tele, src, tmpB.multiplyScalar(45).add(src), 0.025 + (this.stateT > 0.8 ? 0.02 : 0));
        this.tele.visible = Math.sin(this.stateT * (this.stateT > 0.8 ? 60 : 25)) > -0.3;
        if (this.stateT > 1.15) this.fire(tgt);
        break;
      }
      case 'spent':
        this.hover = 0.35;
        this.yaw += dt * 1.7;
        if (this.stateT > 2.8) { this.setState('hover'); this.cd = 2.6 + Math.random() * 2; }
        break;
      case 'stagger':
        this.hover = 0.25;
        this.yaw += dt * 1.2;
        if (this.stateT > this.staggerDur) { this.setState('hover'); this.cd = 2 + Math.random() * 2; }
        break;
    }
  }

  setSegment(mesh, a, b, radius) {
    const len = a.distanceTo(b);
    mesh.position.lerpVectors(a, b, 0.5);
    mesh.scale.set(radius, len, radius);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tmpB.subVectors(b, a).normalize());
  }

  fire(tgt) {
    const game = this.game, fx = game.fx;
    this.tele.visible = false;
    this.bang.visible = false;
    this.root.updateMatrixWorld(true);
    const src = this.halo.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3().subVectors(this.aim, src).normalize();
    let end = src.clone().addScaledVector(dir, 45);
    for (let d = 1; d < 45; d += 0.5) {
      const p = tmpA.copy(src).addScaledVector(dir, d);
      if (p.y < game.world.heightAt(p.x, p.z)) { end = p.clone(); break; }
    }
    // everyone standing in the line of the beam gets hit
    const seg = new THREE.Vector3().subVectors(end, src);
    const victims = [game.knight, ...game.humans.list];
    let reflected = false;
    for (const v of victims) {
      if (!v.alive) continue;
      const c = v.chest(new THREE.Vector3());
      const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(c, src).dot(seg) / seg.lengthSq()));
      if (src.clone().addScaledVector(seg, t).distanceTo(c) > 0.9) continue;
      const r = this.hitPrey(v, HIT.beam, { blockable: true, parryable: true });
      if (v === game.knight) {
        if (r === 'parried') reflected = true;
        if (r !== 'dodged') end = c.clone();
      }
    }
    this.setSegment(this.beamMesh, src, end, 0.18);
    this.beamMesh.visible = true;
    this.beamT = 0.18;
    game.sound.beamFire();
    fx.burst(end, 1.8, ICHOR);
    fx.dust(end, 8, 1);
    fx.shake(0.25);
    if (!reflected) fx.crack(end.x, end.z, 1.6);
    if (reflected) {
      const c = game.knight.chest();
      this.setSegment(this.reflectMesh, c, src, 0.22);
      this.reflectMesh.visible = true;
      fx.word('RETURNED!', src, '#f0b43c', 1.3);
      fx.shards(src, 16, ICHOR, 1);
      this.damage(150);
      if (this.alive) this.stagger(2.8);
      return;
    }
    this.setState('spent');
  }

  animChoir(dt) {
    const st = this.state;
    this.heart.scale.setScalar(1 + Math.sin(this.t * 6) * 0.12 + (st === 'stagger' || st === 'spent' ? 0.3 : 0));
    if (!this.haloBroken) {
      this.halo.rotation.z += dt * (st === 'charge' ? 6 : 0.6);
      this.halo.scale.setScalar(st === 'charge' ? 1 + this.stateT * 0.3 + Math.sin(this.t * 30) * 0.05 : 1);
    }
    this.animWings(dt);
    const tilt = st === 'stagger' ? 0.4 : st === 'spent' ? 0.3 : 0;
    this.body.rotation.x += (tilt - this.body.rotation.x) * (1 - Math.exp(-dt * 5));
  }

  // ---------------------------------------------------------------- Ophan
  thinkOphan(dt, prey) {
    const game = this.game;
    switch (this.state) {
      case 'arrive':
        this.face(this.toPrey, 3, dt);
        if (this.stateT > 2.4) this.setState('drift');
        break;
      case 'drift': {
        this.hover = this.exposed ? 1.3 : 2.2;
        this.spinRate = this.exposed ? 0.3 : 0.9;
        this.face(this.toPrey, 2, dt);
        if (this.dist > 4.2) this.step(this.toPrey, this.def.speed * (this.dist > 10 ? 1.8 : 1), dt);
        else if (this.dist < 2.4) this.step(this.toPrey + Math.PI, 1.5, dt);
        this.cd -= dt;
        if (this.cd <= 0) {
          if (this.exposed || (this.dist < 9 && Math.random() < 0.55)) {
            this.setState('burstWind');
            this.bangRed.visible = true;
            game.sound.burstCharge();
            game.hud.firstTime('burst', 'A red !! means you cannot block it. Roll through the ring.');
          } else {
            this.setState('ramWind');
            this.ramYaw = this.toPrey;
            this.bang.visible = true;
          }
        }
        break;
      }
      case 'burstWind':
        this.spinRate = 5;
        if (this.stateT > 1.1) {
          this.bangRed.visible = false;
          this.ring = game.fx.ring(this.pos.x, this.pos.z, { speed: 12, max: 18 });
          this.ringHit = new Set();
          game.sound.burstFire();
          game.fx.shake(0.35);
          this.setState('burst');
        }
        break;
      case 'burst': {
        for (const v of [game.knight, ...game.humans.list]) {
          if (!v.alive || this.ringHit.has(v)) continue;
          const d = Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z);
          if (Math.abs(d - this.ring.r) < 0.7) {
            const r = this.hitPrey(v, HIT.burst, { blockable: false });
            if (r !== 'dodged') this.ringHit.add(v);
          }
        }
        if (this.ring.done) { this.setState('drift'); this.cd = 2.2 + Math.random() * 1.5; }
        break;
      }
      case 'ramWind':
        this.spinRate = 4;
        if (this.stateT < 0.5) this.ramYaw = this.toPrey;
        this.face(this.ramYaw, 6, dt);
        this.arrow.visible = true;
        this.arrow.position.set(this.pos.x, game.world.heightAt(this.pos.x, this.pos.z) + 0.15, this.pos.z);
        this.arrow.rotation.y = this.ramYaw;
        this.arrow.material.opacity = 0.25 + 0.2 * Math.sin(this.stateT * 30);
        if (this.stateT > 0.9) {
          this.arrow.visible = false;
          this.bang.visible = false;
          this.setState('ram');
          this.rammed = new Set();
          game.sound.ram();
        }
        break;
      case 'ram':
        this.step(this.ramYaw, 15, dt);
        for (const v of [game.knight, ...game.humans.list]) {
          if (!v.alive || this.rammed.has(v)) continue;
          if (Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z) < this.def.radius + 0.7) {
            this.rammed.add(v);
            const r = this.hitPrey(v, HIT.ram, { blockable: true, parryable: true });
            if (r === 'parried') { this.stagger(2.4); break; }
            if (r === 'dodged') this.rammed.delete(v);
          }
        }
        if (this.state === 'ram' && this.stateT > 1.0) { this.setState('drift'); this.cd = 2 + Math.random() * 1.5; }
        break;
      case 'stagger':
        this.hover = 1.4;
        this.spinRate = 0.2;
        if (this.stateT > this.staggerDur) this.setState('drift');
        break;
    }
  }

  animOphan(dt) {
    this.outerSpin.rotation.z += dt * this.spinRate;
    this.innerSpin.rotation.z -= dt * this.spinRate * 1.3;
    this.core.scale.setScalar(1 + Math.sin(this.t * 4) * 0.08 + (this.state === 'burstWind' ? this.stateT * 0.4 : 0));
    this.core.rotation.y += dt;
    const sag = this.exposed ? 0.5 : 0;
    this.outer.rotation.x += (sag - this.outer.rotation.x) * (1 - Math.exp(-dt * 2));
  }
}

// =====================================================================
export class Angels {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.peace = location.hash.includes('peace');
    const m = location.hash.match(/angel(=(\w+))?/);
    this.forced = m ? (m[2] || 'herald') : null;
    this.reset();
  }

  reset() {
    for (const a of this.list) if (!a.removed) a.dispose();
    this.list = [];
    this.kills = 0;
    this.omen = null;
    // the first visitation comes after a few minutes of exploring
    this.nextVisit = this.forced ? 6 : 150 + Math.random() * 90;
  }

  get aliveCount() { return this.list.filter((a) => a.alive).length; }
  get current() { return this.list.find((a) => a.alive) || null; }

  spawn(type, x, z) {
    const a = new Angel(this.game, this, type, x, z);
    this.list.push(a);
    return a;
  }

  /** Something descends. First an omen, then the angel itself. */
  beginVisitation() {
    const game = this.game, k = game.knight;
    const r = Math.random();
    const type = this.forced || (r < 0.5 ? 'herald' : r < 0.8 ? 'choir' : 'ophan');
    const a = k.facing + (Math.random() - 0.5) * 1.6;
    const d = 28 + Math.random() * 10;
    const lim = game.world.limit - 10;
    const x = Math.max(-lim, Math.min(lim, k.pos.x + Math.sin(a) * d));
    const z = Math.max(-lim, Math.min(lim, k.pos.z + Math.cos(a) * d));
    this.omen = { t: 0, x, z, type, beamed: false };
    game.sound.horn();
    game.sound.choir(0.75);
    game.hud.banner('The sky opens', 'Something is coming down. Everyone is running.', 4.5);
    game.fx.shake(0.2);
  }

  update(dt) {
    if (dt <= 0) return;
    const game = this.game;
    if (!this.peace && !this.current && !this.omen && game.knight.alive) {
      this.nextVisit -= dt;
      if (this.nextVisit <= 0) this.beginVisitation();
    }
    if (this.omen) {
      const o = this.omen;
      o.t += dt;
      game.mats.shared.uRiftGlow && (game.mats.shared.uRiftGlow.value = Math.min(1, o.t / 3));
      if (o.t > 2.5 && !o.beamed) { o.beamed = true; game.fx.beam(o.x, o.z, 5); game.sound.choir(1); }
      if (o.t > 3.6) {
        const a = this.spawn(o.type, o.x, o.z);
        game.hud.boss(a);
        if (o.type === 'herald') game.hud.firstTime('heart', 'An angel. Aim for its glowing heart. Its wings and mask will turn your blade.');
        this.omen = null;
      }
    }
    for (const a of this.list) a.update(dt);
    this.list = this.list.filter((a) => !a.removed);
    for (const a of this.list) {
      const k = game.knight;
      if (k.alive && a.alive && a.hoverCur < 2.5 && a.state !== 'ram') {
        const dx = a.pos.x - k.pos.x, dz = a.pos.z - k.pos.z;
        const d = Math.hypot(dx, dz), min = a.radius + 0.45;
        if (d < min && d > 1e-4) { a.pos.x = k.pos.x + (dx / d) * min; a.pos.z = k.pos.z + (dz / d) * min; }
      }
    }
  }

  /** The cinematic finished: the angel is gone. Schedule the next one. */
  onUnmade(a) {
    this.kills++;
    this.nextVisit = 240 + Math.random() * 150;
    this.game.hud.boss(null);
    if (this.game.mats.shared.uRiftGlow) this.game.mats.shared.uRiftGlow.value = 0;
  }

  // ================================================================ your sword
  strike(a, part, attack, point, knight) {
    const game = this.game, fx = game.fx, snd = game.sound;
    const dir = new THREE.Vector3(a.pos.x - knight.pos.x, 0, a.pos.z - knight.pos.z).normalize();
    const kind = KIND[part.kind];
    const heavy = !!attack.heavy;
    const bonus = a.state === 'stagger' ? 1.3 : 1;
    const dmg = attack.damage * (part.mult ?? kind.mult) * bonus;
    a.flash.value = 1;

    if (kind.deflect) {
      snd.clang();
      fx.sparks(point, 16, INK);
      fx.burst(point, 0.8, WHITE);
      fx.word('CLANG', point, '#fbf7ec', 0.7);
      fx.shake(0.15);
      game.hitstop(0.05);
      a.damage(dmg);
      a.react('armor');
      if (heavy) {
        if (a.guarding) { a.stagger(1.6); fx.word('GUARD BROKEN', point, '#f0b43c', 1); }
        a.kb.addScaledVector(dir, 5);
        return 'armor';
      }
      game.hud.firstTime('clang', 'CLANG: that was armour. Find the glowing weak spot.');
      return 'deflect';
    }

    if (part.kind === 'halo') {
      a.breakHalo(dir);
      fx.shards(point, 14, ICHOR, 1);
      fx.burst(point, 1.6, ICHOR);
      fx.word('SNAP!', point, '#f0b43c', 1);
      fx.impactFrame(0.05, 0.2);
      fx.shake(0.35);
      snd.haloSnap();
      game.hitstop(0.12);
      a.damage(40);
      return 'break';
    }

    if (part.kind === 'eye') {
      part.hp -= attack.damage * bonus;
      if (part.hp <= 0) {
        fx.ichor(point, dir, 18, 1.2);
        fx.shards(point, 12, WHITE, 1);
        fx.burst(point, 2.2, ICHOR);
        fx.word('POP!', point, '#f0b43c', 1.2);
        fx.impactFrame(0.07, 0.3);
        fx.shake(0.5);
        snd.shatter();
        game.hitstop(0.14);
        a.breakEye(part);
      } else {
        fx.ichor(point, dir, 8, 0.8);
        fx.burst(point, 1.3, ICHOR);
        fx.word('CRACK!', point, '#f0b43c', 0.8);
        fx.shake(0.25);
        snd.hitWeak();
        game.hitstop(0.08);
        a.flash.value = 1;
      }
      return 'weak';
    }

    if (part.kind === 'weak' || part.kind === 'core') {
      fx.ichor(point, dir, heavy ? 26 : 16, heavy ? 1.4 : 1);
      fx.shards(point, 8, WHITE, 1);
      fx.burst(point, heavy ? 2.6 : 1.9, ICHOR);
      fx.word(heavy ? 'SHATTER!' : 'CRACK!', point, '#f0b43c', heavy ? 1.4 : 1.1);
      fx.impactFrame(heavy ? 0.09 : 0.06, heavy ? 0.4 : 0.25);
      fx.shake(heavy ? 0.7 : 0.45);
      game.hitstop(heavy ? 0.17 : 0.11);
      snd.hitWeak();
      a.kb.addScaledVector(dir, heavy ? 6 : 3);
      a.poiseHit(attack.poise * 1.5);
      a.damage(dmg, true);
      return 'weak';
    }

    fx.ichor(point, dir, heavy ? 14 : 7, 0.8);
    fx.burst(point, heavy ? 1.6 : 1.0, WHITE);
    if (heavy) fx.word('THOOM', point, '#fbf7ec', 1);
    fx.shake(heavy ? 0.45 : 0.2);
    game.hitstop(heavy ? 0.1 : 0.055);
    snd.hitBody(heavy);
    a.kb.addScaledVector(dir, heavy ? 5 : 2);
    a.poiseHit(attack.poise);
    a.react('body');
    a.damage(dmg, false);
    return 'body';
  }

  shockwave(p, radius, dmg) {
    for (const a of this.list) {
      if (!a.hittable() || a.hoverCur > 2.6) continue;
      const dx = a.pos.x - p.x, dz = a.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > radius + a.radius) continue;
      const dir = new THREE.Vector3(dx, 0, dz).normalize();
      a.kb.addScaledVector(dir, 7);
      if (a.type === 'ophan') { a.damage(a.exposed ? dmg * 2 : 6); continue; }
      a.poiseHit(70);
      a.damage(dmg);
      this.game.fx.ichor(a.center(), dir, 6, 0.8);
    }
  }

  onKnightAttack() {
    for (const a of this.list) {
      if (a.type === 'herald' && a.state === 'stalk' && a.dist < 3.2 && a.prey === this.game.knight && Math.random() < 0.25) {
        a.guarding = true;
        a.setState('guard');
      }
    }
  }
}
