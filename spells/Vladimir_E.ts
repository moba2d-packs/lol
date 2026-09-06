import type { AttackableUnit } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Slow = api.buffs.Slow;
const BuffAddType = api.enums.BuffAddType;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const dmg = api.text.dmg;

export const RADIUS = 220;

export const DAMAGE = 24;

export const SLOW_PERCENT = 0.25;

export const SLOW_MS = 700;

export const COOLDOWN_MS = 8_000;

/** Rescaled from the record's ~4% mid-charge health cost. */
export const HEALTH_COST = 6;

/** The nova's growth, before it hits — the telegraph VFX_STANDARD requires
 * even for an ability with no cast time. */
export const WINDUP_MS = 150;

export const AFTERGLOW_MS = 200;

export const BOLT_COUNT = 14;

const BLOOD: [number, number, number] = [150, 15, 24];

/**
 * Tides of Blood, minus the charge.
 *
 * `docs/abilities/vladimir/e.json`: hold the key for up to 1.5s to grow the
 * damage, release (or auto-release, or get interrupted) to fire a 15-bolt
 * nova, with a slow that only applies past a full second of charge. That is
 * a full second activation pattern (`ChargeSpec`, an `onChargeUpdate`, a
 * recast-or-auto-release branch, an interrupt table three columns wide in
 * the record's own notes) in service of one lever: how hard the burst
 * hits. At this game's damage scale a basic ability's whole range is
 * 15-35 — the difference between "tapped" and "held to the cap" would be a
 * handful of points, not worth the machinery or the extra state a player
 * has to track. So: press it, it goes off. The slow stays, unconditionally,
 * since there is no longer a charge tier for it to gate on.
 *
 * Multi-hit protection needs no bookkeeping here, unlike a dash or a beam
 * that can cross one body twice: `queryObjects` is called exactly once, at
 * the moment of detonation, so each enemy in range is found at most once no
 * matter how many of the fifteen bolts the record imagines them catching.
 */
export default class Vladimir_E extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('spell_vladimir_e');
  name = 'Thủy Triều Máu (Vladimir_E)';
  description =
    `Tạo một đợt sóng máu quanh Vladimir, gây ${dmg(DAMAGE, 'MAGIC')} ` +
    `và <span class="buff">chậm ${pct(SLOW_PERCENT)}%</span> trong <span class="time">${secs(SLOW_MS)} giây</span> ` +
    `cho kẻ địch trong <span>${RADIUS}px</span>`;
  coolDown = COOLDOWN_MS;
  manaCost = 0;
  healthCost = HEALTH_COST;

  onSpellCast(): void {
    this.game.objectManager.addObject(new Vladimir_E_Nova(this.owner));
  }
}

/**
 * The burst itself: fourteen crimson streaks lashing outward, the ring they
 * trace growing to `RADIUS` exactly as fast as the hit does, so the moment
 * the rim reaches a body is the moment that body is (or is not) close enough
 * to have been hit. Warm, saturated blood-red on a magic effect is a
 * deliberate identity exception to VFX_STANDARD's cool-hues-on-magic
 * default — the same call this pack already made for `Brand_W`'s fire, for
 * the same reason: the champion's whole motif *is* the warm colour.
 */
export class Vladimir_E_Nova extends SpellObject {
  radius = RADIUS;
  age = 0;
  detonated = false;

  /** Seeded once: each streak's angle and a little jitter on its length, so
   * the nova reads as jagged tendrils rather than a perfect gear. */
  _bolts: { angle: number; reach: number }[] = [];

  onAdded(): void {
    for (let i = 0; i < BOLT_COUNT; i++) {
      this._bolts.push({
        angle: (TWO_PI * i) / BOLT_COUNT + random(-0.06, 0.06),
        reach: random(0.88, 1),
      });
    }
  }

  update(): void {
    this.age += deltaTime;

    if (!this.detonated && this.age >= WINDUP_MS) {
      this.detonated = true;
      this._detonate();
    }
    if (this.age >= WINDUP_MS + AFTERGLOW_MS) this.toRemove = true;
  }

  private _detonate(): void {
    const victims = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of victims) {
      victim.takeDamage(DAMAGE, this.owner, 'MAGIC');

      const slow = new Slow(SLOW_MS, this.owner, victim);
      slow.percent = SLOW_PERCENT;
      slow.stackId = 'vladimir_e_slow';
      slow.buffAddType = BuffAddType.RENEW_EXISTING;
      slow.image = api.asset('spell_vladimir_e');
      victim.addBuff(slow);
    }
  }

  draw(): void {
    const growIn = constrain(this.age / WINDUP_MS, 0, 1);
    // eased in: the wave gathers slowly, then snaps out at the strike
    const form = growIn * growIn;
    const settle = constrain((this.age - WINDUP_MS) / AFTERGLOW_MS, 0, 1);
    const fade = 1 - settle;
    const currentRadius = this.radius * (this.detonated ? 1 : form);

    push();
    translate(this.position.x, this.position.y);

    noFill();
    for (const bolt of this._bolts) {
      const length = currentRadius * bolt.reach;
      const x = cos(bolt.angle) * length;
      const y = sin(bolt.angle) * length;
      // dark core, so the streak reads over grass and blood alike
      stroke(40, 4, 6, 235 * (this.detonated ? fade : 1));
      strokeWeight(7);
      line(0, 0, x, y);
      stroke(BLOOD[0], BLOOD[1], BLOOD[2], 235 * (this.detonated ? fade : 1));
      strokeWeight(3);
      line(0, 0, x, y);
      // a bright tip at the leading edge — the part of the streak that is
      // actually about to reach (or has just reached) the hit radius
      noStroke();
      fill(255, 90, 100, 220 * (this.detonated ? fade : 1));
      circle(x, y, 6);
    }

    // hard rim on the true hit radius, held through the strike and then gone
    if (!this.detonated) {
      noFill();
      stroke(220, 40, 50, 200 * form);
      strokeWeight(3);
      circle(0, 0, this.radius * 2 * form);
    } else {
      noFill();
      stroke(255, 130, 140, 210 * fade);
      strokeWeight(4 + 5 * settle);
      circle(0, 0, this.radius * 2 * (1 + settle * 0.15));
    }

    pop();
  }

  getDisplayBoundingBox() {
    const r = this.radius + 30;
    return this.squareDisplayBoundingBox(r * 2);
  }
}
