// =====================================================
// hud.js - what's drawn over the game
//
// The bars and words are normal web page elements (see index.html). The lock-on
// circle and the arrows pointing at angels off-screen are drawn every frame
// onto a see-through 2D canvas laid over the 3D view.
// =====================================================
import * as THREE from 'three';

export class HUD {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'), hpFill: $('hp-fill'), hpGhost: $('hp-ghost'), stFill: $('st-fill'),
      resolve: $('resolve'),
      saved: $('saved-num'), slain: $('slain-num'), unmade: $('unmade-num'),
      boss: $('boss'), bossName: $('boss-name'), bossFill: $('boss-fill'),
      banner: $('banner'), bannerBig: document.querySelector('#banner .big'), bannerSmall: document.querySelector('#banner .small'),
      hint: $('hint'), start: $('start-screen'), dead: $('dead-screen'), deadStats: $('dead-stats'), vitals: $('vitals'),
    };
    this.ghost = 1;
    this.bannerT = 0;
    this.hintT = 0;
    this.seen = new Set();
    this._v = new THREE.Vector3();
  }

  show() { this.el.hud.hidden = false; }
  hide() { this.el.hud.hidden = true; }

  banner(big, small, dur = 3.4) {
    this.el.bannerBig.textContent = big;
    this.el.bannerSmall.textContent = small || '';
    this.el.banner.classList.add('show');
    this.bannerT = dur;
  }

  hint(text, dur = 5) {
    this.el.hint.textContent = text;
    this.el.hint.classList.add('show');
    this.hintT = dur;
  }

  /** A tip that only ever shows once per game. */
  firstTime(key, text) {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.hint(text, 6);
  }

  hurt() {
    this.el.vitals.classList.remove('shake');
    void this.el.vitals.offsetWidth;     // restart the CSS animation
    this.el.vitals.classList.add('shake');
  }

  /** Make the resolve diamonds pop (you just got some back). */
  resolveFlash() {
    const el = this.el.resolve;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  /** Show (or hide, with null) the health bar of the angel you're facing. */
  boss(angel) {
    this.bossAngel = angel;
    if (angel) this.el.bossName.textContent = angel.def.title;
    this.el.boss.classList.toggle('show', !!angel);
  }

  showDeath() {
    const h = this.game.humans, a = this.game.angels;
    const s = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    this.el.deadStats.textContent = `You saved ${s(h.saved, 'survivor', 'survivors')}, cut down ${s(h.slain, 'raider', 'raiders')} and unmade ${s(a.kills, 'angel', 'angels')}.`;
    this.el.dead.hidden = false;
  }

  hideScreens() {
    this.el.start.hidden = true;
    this.el.dead.hidden = true;
  }

  update(realDt) {
    const k = this.game.knight, a = this.game.angels;
    const hp = Math.max(0, k.hp / k.maxHp);
    this.ghost = this.ghost > hp ? Math.max(hp, this.ghost - realDt * 0.4) : hp;
    this.el.hpFill.style.transform = `scaleX(${hp})`;
    this.el.hpGhost.style.transform = `scaleX(${this.ghost})`;
    this.el.stFill.style.transform = `scaleX(${Math.max(0, k.stamina / k.maxStamina)})`;
    // one diamond per charge of resolve: gold if you have it, hollow if spent
    if (this.shownResolve !== k.resolve) {
      this.shownResolve = k.resolve;
      this.el.resolve.innerHTML = '';
      for (let i = 0; i < 3; i++) {
        const d = document.createElement('i');
        if (i >= k.resolve) d.className = 'spent';
        this.el.resolve.appendChild(d);
      }
    }
    const h = this.game.humans;
    this.el.saved.textContent = h.saved;
    this.el.slain.textContent = h.slain;
    this.el.unmade.textContent = a.kills;
    if (this.bossAngel) {
      const b = this.bossAngel;
      this.el.bossFill.style.transform = `scaleX(${Math.max(0, b.hp / b.maxHp)})`;
      if (b.removed && !this.game.cinematic.active) this.boss(null);
    }

    if (this.bannerT > 0) {
      this.bannerT -= realDt;
      if (this.bannerT <= 0) this.el.banner.classList.remove('show');
    }
    if (this.hintT > 0) {
      this.hintT -= realDt;
      if (this.hintT <= 0) this.el.hint.classList.remove('show');
    }
  }

  /** Lock-on ring, weak point markers and off-screen arrows. */
  draw2d(g, w, h) {
    const game = this.game;
    if (game.state !== 'playing' || game.cinematic.active) return;
    const cam = game.camera;
    const scale = h / 900;
    const t = performance.now() / 1000;
    const boil = Math.floor(t * 7);

    const toScreen = (p) => {
      const v = this._v.copy(p).project(cam);
      return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, behind: v.z > 1 };
    };

    // ---- a tiny dot in the middle of the view ----
    g.save();
    g.fillStyle = 'rgba(236,230,218,0.75)';
    g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 3 * scale;
    g.beginPath(); g.arc(w / 2, h / 2, 2.2 * scale, 0, Math.PI * 2); g.fill();
    g.restore();

    // ---- the lock-on circle: two thin rings ----
    const lock = game.rig.lock;
    if (lock && lock.alive) {
      const s = toScreen(lock.aimPoint(new THREE.Vector3()));
      if (!s.behind) {
        g.save();
        g.strokeStyle = 'rgba(236,230,218,0.85)';
        g.shadowColor = 'rgba(0,0,0,0.8)'; g.shadowBlur = 4 * scale;
        g.lineWidth = 2 * scale;
        for (let k = 0; k < 2; k++) {
          const j = 0;
          g.beginPath();
          g.ellipse(s.x + j, s.y - j * 0.5, (30 + k * 5) * scale, (30 + k * 5) * scale, 0, 0, Math.PI * 2);
          g.stroke();
        }
        g.restore();
      }
      // show its weak spots in gold
      for (const p of lock.parts) {
        if (p.broken || !p.active()) continue;
        if (p.kind !== 'weak' && p.kind !== 'core' && p.kind !== 'eye' && p.kind !== 'halo') continue;
        const q = toScreen(p.obj.getWorldPosition(new THREE.Vector3()));
        if (q.behind) continue;
        const r = 7 * scale;
        g.save();
        g.translate(q.x, q.y);
        g.rotate(Math.PI / 4);
        g.fillStyle = 'rgba(240,180,60,0.9)';
        g.strokeStyle = 'rgba(0,0,0,0.7)';
        g.lineWidth = 2 * scale;
        g.fillRect(-r / 2, -r / 2, r, r);
        g.strokeRect(-r / 2, -r / 2, r, r);
        g.restore();
      }
    }

    // ---- arrows at the screen edge pointing to an angel you can't see ----
    for (const a of game.angels.list) {
      if (!a.alive) continue;
      const v = this._v.copy(a.center()).project(cam);
      const behind = v.z > 1;
      let x = v.x, y = v.y;
      if (behind) { x = -x; y = -y; }
      if (!behind && Math.abs(x) < 0.95 && Math.abs(y) < 0.95) continue;
      const ang = Math.atan2(-y, x);
      const m = 0.88;
      const k = Math.min(m / Math.abs(Math.cos(ang) || 1e-3), m / Math.abs(Math.sin(ang) || 1e-3));
      const ex = (Math.cos(ang) * k * 0.5 + 0.5) * w;
      const ey = (Math.sin(ang) * k * 0.5 + 0.5) * h;
      const size = 20 * scale;
      g.save();
      g.translate(ex, ey);
      g.rotate(ang);
      g.beginPath();
      g.moveTo(size, 0);
      g.lineTo(-size * 0.7, -size * 0.65);
      g.lineTo(-size * 0.4, 0);
      g.lineTo(-size * 0.7, size * 0.65);
      g.closePath();
      g.fillStyle = a.state === 'windup' || a.state === 'charge' || a.state === 'burstWind' || a.state === 'ramWind' ? '#e0412f' : 'rgba(236,230,218,0.85)';
      g.fill();
      g.restore();
    }
  }
}
