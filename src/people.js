// =====================================================
// people.js - real human models for raiders and survivors
//
// The two characters in assets/ are rigged, textured human models (free
// Mixamo characters from the three.js examples). Raiders wear the armoured
// "Soldier"; survivors are "Michelle".
//
// humans.js still runs every person with its own simple invisible skeleton
// (joints that swing to walk, wind up and strike). Each frame this file copies
// that motion onto the model's bones ("retargeting"), so the real body moves
// exactly like the simple one underneath, and the fight code doesn't change.
//
// How the copying works, in one paragraph: the model stands in a T-pose, our
// skeleton stands with its arms down. For every bone we find the turn that
// swings it from the T-pose to hanging down (an "offset"). After that, the
// bone's world rotation each frame = our joint's rotation * that offset.
// =====================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const MODELS = {
  soldier: { url: './assets/Soldier.glb', flip: true },     // this one is modelled facing backwards
  michelle: { url: './assets/Michelle.glb', flip: false },
};

const loaded = {};
export let peopleReady = false;

/** Download the models. Call once, before the game starts. */
export async function loadPeople() {
  const loader = new GLTFLoader();
  try {
    await Promise.all(Object.entries(MODELS).map(async ([key, def]) => {
      loaded[key] = await loader.loadAsync(def.url);
    }));
    peopleReady = true;
  } catch (e) {
    console.warn('Could not load the human models; using the built-in ones instead.', e);
    peopleReady = false;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

// [bone, the bone it points at, which of our joints drives it, rest direction, how much of the joint's turn]
const MAP = [
  ['Hips', 'Spine', 'hips', UP, 1],
  ['Spine', 'Spine1', 'torso', UP, 1 / 3],
  ['Spine1', 'Spine2', 'torso', UP, 2 / 3],
  ['Spine2', 'Neck', 'torso', UP, 1],
  ['Head', null, 'head', UP, 1],
  ['LeftArm', 'LeftForeArm', 'armL', DOWN, 1],
  ['LeftForeArm', 'LeftHand', 'elbowL', DOWN, 1],
  ['RightArm', 'RightForeArm', 'armR', DOWN, 1],
  ['RightForeArm', 'RightHand', 'elbowR', DOWN, 1],
  ['LeftUpLeg', 'LeftLeg', 'hipL', DOWN, 1],
  ['LeftLeg', 'LeftFoot', 'kneeL', DOWN, 1],
  ['RightUpLeg', 'RightLeg', 'hipR', DOWN, 1],
  ['RightLeg', 'RightFoot', 'kneeR', DOWN, 1],
];

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Skin {
  /**
   * kind: 'soldier' or 'michelle'. rig: our joints { body, hips, torso, head, armR, elbowR, armL, elbowL, legs: [left, right] }.
   * height: how tall in metres. tint: a colour the whole model is multiplied by (dirt and wear).
   */
  constructor(kind, rig, height, tint = new THREE.Color(1, 1, 1), noise = null) {
    const def = MODELS[kind];
    this.rig = rig;
    const src = loaded[kind];
    const model = clone(src.scene);
    this.root = new THREE.Group();
    this.root.add(model);
    if (def.flip) this.root.rotation.y = Math.PI;

    // ---- find the bones and measure the model standing in its T-pose ----
    this.bones = {};
    this.order = [];
    model.traverse((o) => {
      if (o.isBone) { this.bones[o.name.replace('mixamorig', '')] = o; this.order.push(o); }
    });
    // size it: the top of the head is about 19 cm above the head bone
    this.root.updateMatrixWorld(true);
    const headTop = this.bones.Head.getWorldPosition(_v).y + 0.19;
    this.root.scale.setScalar(height / headTop);
    this.root.updateMatrixWorld(true);
    this.scale = this.root.scale.x;

    const world = (o) => o.getWorldQuaternion(new THREE.Quaternion());
    const pos = (o) => o.getWorldPosition(new THREE.Vector3());
    this.offset = {};      // bone name -> the rest turn
    this.drive = [];       // [bone, joint key, weight, offset]
    for (const [name, child, joint, dir, weight] of MAP) {
      const b = this.bones[name];
      if (!b) continue;
      let toChild = null;
      if (child && this.bones[child]) toChild = pos(this.bones[child]).sub(pos(b)).normalize();
      const rest = world(b);
      const align = toChild ? new THREE.Quaternion().setFromUnitVectors(toChild, dir) : new THREE.Quaternion();
      this.offset[name] = align.multiply(rest);
      this.drive.push({ bone: b, joint, weight, offset: this.offset[name] });
    }
    // feet stay flat on the ground whatever the legs do
    this.feet = ['LeftFoot', 'RightFoot'].filter((n) => this.bones[n]).map((n) => ({ bone: this.bones[n], rest: world(this.bones[n]) }));
    // remember each bone's parent (bones are listed parents-first)
    this.parentIndex = this.order.map((b) => this.order.indexOf(b.parent));
    this.parentRest = this.order.map((b) => (this.order.includes(b.parent) ? null : world(b.parent)));
    this.cur = this.order.map(() => new THREE.Quaternion());
    this.target = new Map();

    // ---- a spot in the right hand for weapons, turned like our forearm joint ----
    const hand = this.bones.RightHand;
    const fore = this.offset.RightForeArm;
    const handRest = hand.quaternion.clone();
    this.anchor = new THREE.Object3D();
    this.anchor.quaternion.copy(fore.clone().multiply(handRest).invert());
    const finger = this.bones.RightHandMiddle1;
    if (finger) this.anchor.position.copy(finger.position).multiplyScalar(0.7);
    this.anchor.scale.setScalar(1 / hand.getWorldScale(new THREE.Vector3()).x);     // so a weapon's size is in metres again
    hand.add(this.anchor);

    // ---- look: own materials (so each person can flash and be tinted) ----
    this.mats = [];
    this.meshes = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      this.meshes.push(o);
      o.frustumCulled = false;
      o.castShadow = o.receiveShadow = true;
      const m = o.material.clone();
      m.color.multiply(tint);
      m.emissive = new THREE.Color(1, 1, 1);
      m.emissiveIntensity = 0;
      m.envMapIntensity = 0.8;
      if (m.roughness !== undefined) m.roughness = Math.max(0.55, m.roughness);
      if (m.metalness !== undefined) m.metalness = Math.min(0.5, m.metalness);
      // wash out bright colours and rub in dirt, so everyone looks like they live in the ruins
      if (noise) {
        m.onBeforeCompile = (shader) => {
          shader.uniforms.tNoise = { value: noise };
          shader.fragmentShader = 'uniform sampler2D tNoise;\n' + shader.fragmentShader.replace('#include <map_fragment>',
            `#include <map_fragment>
            float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
            diffuseColor.rgb = mix(vec3(lum), diffuseColor.rgb, 0.45);
            vec4 grime = texture2D(tNoise, vMapUv * 5.0);
            diffuseColor.rgb *= 0.6 + 0.55 * grime.g;`);
        };
        m.customProgramCacheKey = () => 'grime';
      }
      o.material = m;
      this.mats.push(m);
    });
  }

  /** Copy our joints' pose onto the model's bones. flash: 0..1 white flash when struck. */
  update(flash = 0) {
    const rig = this.rig;
    rig.body.updateWorldMatrix(true, true);
    const bodyQ = rig.body.getWorldQuaternion(_q2).invert();
    const jointQ = (key) => {
      let j;
      if (key === 'hipL') j = rig.legs[0].hip; else if (key === 'hipR') j = rig.legs[1].hip;
      else if (key === 'kneeL') j = rig.legs[0].knee; else if (key === 'kneeR') j = rig.legs[1].knee;
      else j = rig[key];
      return j.getWorldQuaternion(new THREE.Quaternion()).premultiply(bodyQ);
    };
    const want = this.target;
    want.clear();
    const identity = new THREE.Quaternion();
    for (const d of this.drive) {
      const q = jointQ(d.joint);
      if (d.weight !== 1) q.copy(identity).slerp(q, d.weight);
      want.set(d.bone, q.multiply(d.offset));
    }
    for (const f of this.feet) want.set(f.bone, f.rest);

    for (let i = 0; i < this.order.length; i++) {
      const b = this.order[i];
      const pq = this.parentIndex[i] >= 0 ? this.cur[this.parentIndex[i]] : this.parentRest[i];
      const w = want.get(b);
      if (w) b.quaternion.copy(_q.copy(pq).invert().multiply(w));
      this.cur[i].copy(pq).multiply(b.quaternion);
    }

    const f = Math.min(1, flash) * 0.9;
    for (const m of this.mats) m.emissiveIntensity = f;
  }

  /** Far-away people don't cast shadows (nobody can tell, and shadows are expensive). */
  setShadows(on) {
    if (on === this.shadowsOn) return;
    this.shadowsOn = on;
    for (const m of this.meshes) m.castShadow = on;
  }

  dispose() {
    for (const m of this.mats) m.dispose();
  }
}
