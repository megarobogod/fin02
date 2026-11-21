// =====================================================
// combat.js - what happens when your sword moves
//
// Anything you can hit (raiders, angels) is a "target" with a list of
// "parts": invisible balls on its body. Each part has a KIND:
//   weak  - a heart, a raider's head, a brute's unguarded back: big damage
//   core  - an Ophan's core, once exposed
//   eye   - an Ophan's eye: breaks after a few hits
//   halo  - snaps off and stuns an angel
//   body  - ordinary damage
//   armor - wings, masks, helmets, rings: the sword bounces off (CLANG)
// =====================================================
import * as THREE from 'three';

export const KIND = {
  weak: { mult: 3.0, priority: true },
  core: { mult: 3.0, priority: true },
  eye: { mult: 1.0, priority: true },
  halo: { mult: 1.0, priority: true },
  body: { mult: 0.7 },
  armor: { mult: 0.12, deflect: true },
};

/** Everything the sword could hit right now. */
export function targets(game) {
  const list = [];
  for (const a of game.angels.list) if (a.hittable()) list.push(a);
  for (const p of game.humans.list) if (p.hostile && p.hittable()) list.push(p);
  return list;
}

/**
 * The blade moved from (b0..t0) to (b1..t1) this frame. Sweep along that
 * path and find which part of which target it passed through. If it went
 * through a weak spot anywhere this frame, the weak spot counts.
 */
export function sweep(game, b0, t0, b1, t1, attack, knight) {
  const cands = targets(game).filter((a) => !attack.hit.has(a) &&
    Math.hypot(a.pos.x - knight.pos.x, a.pos.z - knight.pos.z) < 4 + a.radius * 1.5);
  if (!cands.length) return;
  for (const a of cands) a.updateParts();
  const SUB = 5, PTS = 7;
  const base = new THREE.Vector3(), tip = new THREE.Vector3(), pt = new THREE.Vector3();
  for (const a of cands) {
    let first = null, bestPri = null;
    for (let s = 1; s <= SUB; s++) {
      const k = s / SUB;
      base.lerpVectors(b0, b1, k);
      tip.lerpVectors(t0, t1, k);
      for (let i = 0; i < PTS; i++) {
        pt.lerpVectors(base, tip, 0.1 + (0.9 * i) / (PTS - 1));
        for (const p of a.parts) {
          if (p.broken || !p.active()) continue;
          const d = pt.distanceTo(p.wp);
          if (d > p.r + 0.06) continue;
          const ratio = d / p.r;
          if (KIND[p.kind].priority) {
            if (!bestPri || ratio < bestPri.ratio) bestPri = { p, ratio, point: pt.clone() };
          } else if (!first || (first.s === s && ratio < first.ratio)) {
            first = { p, ratio, point: pt.clone(), s };
          }
        }
      }
    }
    const hit = bestPri || first;
    if (!hit) continue;
    attack.hit.add(a);
    const result = a.owner.strike(a, hit.p, attack, hit.point, knight);
    if (result === 'deflect') { knight.deflected(); return; }
  }
}

/** The target nearest the middle of the screen, for lock-on. */
export function pickLock(game) {
  const camera = game.camera;
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  const to = new THREE.Vector3(), p = new THREE.Vector3();
  let best = null, bestScore = Infinity;
  for (const a of targets(game)) {
    a.aimPoint(p);
    to.subVectors(p, camera.position);
    const d = to.length();
    if (d > 40) continue;
    const dot = to.dot(fwd) / d;
    if (dot < 0.5) continue;
    const score = (1 - dot) * 30 + d * 0.3 - (a.isAngel ? 6 : 0);
    if (score < bestScore) { bestScore = score; best = a; }
  }
  return best;
}
