import type { AttackableUnit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Circle = api.utils.Quadtree.Circle;
const VectorUtils = api.utils.VectorUtils;
const PredefinedFilters = api.combat.PredefinedFilters;
const Spell = api.Spell;
const Dash = api.buffs.Dash;
const Champion = api.units.Champion;
const Rectangle = api.utils.Quadtree.Rectangle;
const SpellObject = api.SpellObject;
const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
const dmg = api.text.dmg;


export const TRYNDAMERE_E_RANGE = 300;

export const TRYNDAMERE_E_DAMAGE = 28;

/** How wide the whirling blade reaches off his body while he travels. */
export const TRYNDAMERE_E_HIT_RADIUS = 85;

/**
 * Radians per ms the blades turn.
 *
 * ~0.27rad (15°) a frame at 60fps, a little under one full turn across the
 * dash. Higher than this and the four blades cross more than a quarter-turn
 * between frames, which stops reading as rotation and starts reading as a
 * strobe: 0.038 was tried and was "xoay nhanh quá".
 *
 * The *body* deliberately does not turn with them. Rotating the portrait was
 * tried and rejected on sight — a round avatar spinning in place reads as a
 * joke, and at any speed fast enough to say "whirlwind" it reads as nothing at
 * all. The blades and their motion fans carry the spin.
 */
export const TRYNDAMERE_E_SPIN_RATE = 0.016;

export const TRYNDAMERE_E_DASH_SPEED = 15;

/** Cutting a champion on the way through shortens the next spin. */
export const TRYNDAMERE_E_COOLDOWN_REFUND_MS = 1_000;


/**
 * The radius the whirl actually covers: the blade's own reach off a body plus
 * half that body. Both the hit query and the drawing call it, because they used
 * to disagree — the query added the size term and the picture did not, so the
 * blades were drawn a champion-radius shorter than they cut.
 */
export function whirlReach(unit: AttackableUnit): number {
  return TRYNDAMERE_E_HIT_RADIUS + (unit.stats.size.value ?? 0) / 2;
}


export default class Tryndamere_E extends Spell {
  targetingMode = 'POINT' as const;
  image = api.asset('spell_tryndamere_e');
  name = 'Chém Xoáy (Tryndamere_E)';
  description =
    `Xoay kiếm lướt tới vị trí chỉ định, gây ${dmg(28, 'PHYSICAL')} cho mọi kẻ địch trên đường đi ` +
    '(<span class="buff">mỗi mục tiêu chỉ trúng một lần</span>). Mỗi tướng chém trúng giảm <span class="time">1 giây</span> hồi chiêu.';
  coolDown = 9_000;
  manaCost = 0;
  range = TRYNDAMERE_E_RANGE;

  checkCastCondition(): boolean {
    return Dash.CanDash(this.owner);
  }

  onSpellCast(): void {
    const { to: destination } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      TRYNDAMERE_E_RANGE
    );

    const spin = new Dash(1_500, this.owner, this.owner);
    spin.image = this.image;
    spin.dashSpeed = TRYNDAMERE_E_DASH_SPEED;
    spin.dashDestination = destination;

    const blades = new Tryndamere_E_Object(this.owner);
    this.game.objectManager.addObject(blades);

    // One pass, one hit each: without the set a slow-moving target takes the
    // full slash on every frame the blade overlaps it.
    const hitTargets = new Set<AttackableUnit>();
    // Never `spin.onUpdate = …`: that replaces the dash's own frame and he
    // spins on the spot. See docs/ADDING_SPELLS.md.
    spin.onDashUpdate = () => {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: whirlReach(this.owner),
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const enemy of enemies) {
        if (hitTargets.has(enemy)) continue;
        hitTargets.add(enemy);
        enemy.takeDamage(TRYNDAMERE_E_DAMAGE, this.owner, 'PHYSICAL');
        blades.cutAt(enemy.position.x, enemy.position.y);
        if (enemy instanceof Champion) {
          this.currentCooldown = Math.max(
            0,
            this.currentCooldown - TRYNDAMERE_E_COOLDOWN_REFUND_MS
          );
        }
      }
    };

    this.owner.addBuff(spin);
    // AFTER `addBuff`, never before. `attachTo` resolves the instance the unit
    // actually ticks (`SpellObject.liveBuffOn`), and before the buff is on him
    // there is nothing to resolve: `_anchorBuff` came back null, `attachmentLost`
    // latched true on the first frame, and the whirl stopped following him — it
    // played out at the point of the cast while he dashed away from it.
    blades.attachTo(this.owner, spin);
  }
}


interface BladeCut {
  x: number;
  y: number;
  age: number;
}


const BLADES = 4;

const FAN_STEPS = 3;

/**
 * Three of these is how far the motion fan trails behind each blade — kept
 * under half the 90° gap between blades, so the four stay countable instead of
 * smearing into one disc.
 */
const FAN_STEP_RAD = 0.24;

const RIM_DASHES = 10;

const RIM_DASH_RAD = 0.38;


/**
 * The whirl itself: four blades turning around him for the length of the dash,
 * the wedge each has just swept still solid behind it, and a spark of steel at
 * every body they open.
 *
 * A `SpellObject` rather than caster VFX because the blades reach past his body
 * and the cuts are left behind him — `Champion.draw` is skipped the moment he
 * is culled, which would take the whole spin with it.
 */
export class Tryndamere_E_Object extends SpellObject {
  age = 0;
  spinning = true;
  fade = 1;
  cuts: BladeCut[] = [];

  particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#ffd8d8', 0.5);

  onAdded(): void {
    this.useParticles(this.particleSystem);
  }

  cutAt(x: number, y: number): void {
    this.cuts.push({ x, y, age: 0 });
    for (let i = 0; i < 6; i++) {
      this.particleSystem.addParticle({
        x: x + random(-12, 12),
        y: y + random(-12, 12),
        r: random(3, 8),
      });
    }
  }

  update(): void {
    if (this.attachmentLost) this.spinning = false;
    if (this.spinning) {
      this.position.set(this.owner.position.x, this.owner.position.y);
      this.age += deltaTime;
    } else {
      this.fade -= deltaTime / 260;
    }

    let write = 0;
    for (let i = 0; i < this.cuts.length; i++) {
      this.cuts[i].age += deltaTime;
      if (this.cuts[i].age < 300) this.cuts[write++] = this.cuts[i];
    }
    this.cuts.length = write;

    if (!this.spinning && this.fade <= 0 && this.cuts.length === 0) this.toRemove = true;
  }

  draw(): void {
    if (this.spinning || this.fade > 0) {
      const alpha = this.spinning ? 1 : Math.max(0, this.fade);
      const spin = this.age * TRYNDAMERE_E_SPIN_RATE;
      const reach = whirlReach(this.owner);

      push();
      translate(this.position.x, this.position.y);

      // The disc he sweeps. A filled ring rather than a line, because one
      // stroke at this radius is what made the reach unreadable — the eye had
      // nothing to measure. Flat fill, no glow (docs/VFX_STANDARD.md).
      noStroke();
      fill(228, 236, 255, 34 * alpha);
      circle(0, 0, reach * 2);

      // Four motion fans: the wedge each blade has just swept, solid and
      // fading behind it. This is the part that reads as rotation.
      for (let i = 0; i < BLADES; i++) {
        const angle = spin + (Math.PI * 2 * i) / BLADES;
        for (let step = 0; step < FAN_STEPS; step++) {
          const behind = (step + 1) * FAN_STEP_RAD;
          fill(235, 242, 255, (78 - step * 22) * alpha);
          beginShape();
          vertex(0, 0);
          vertex(cos(angle - behind) * reach, sin(angle - behind) * reach);
          vertex(cos(angle - behind + FAN_STEP_RAD) * reach, sin(angle - behind + FAN_STEP_RAD) * reach);
          endShape(CLOSE);
        }
      }

      // The blades themselves, on the real hit radius so the reach is the
      // thing the picture is about.
      noFill();
      for (let i = 0; i < BLADES; i++) {
        const angle = spin + (Math.PI * 2 * i) / BLADES;
        stroke(30, 39, 46, 235 * alpha);
        strokeWeight(9);
        line(cos(angle) * reach * 0.3, sin(angle) * reach * 0.3, cos(angle) * reach, sin(angle) * reach);
        stroke(232, 240, 255, 250 * alpha);
        strokeWeight(5);
        line(cos(angle) * reach * 0.3, sin(angle) * reach * 0.3, cos(angle) * reach, sin(angle) * reach);
        // the tip, so the outer edge of the disc has a hard mark on it
        stroke(255, 120, 110, 250 * alpha);
        strokeWeight(6);
        point(cos(angle) * reach, sin(angle) * reach);
      }

      // The rim: dashes that turn with him, so the circle itself is moving.
      stroke(255, 235, 235, 200 * alpha);
      strokeWeight(3);
      for (let i = 0; i < RIM_DASHES; i++) {
        const from = spin * 0.5 + (Math.PI * 2 * i) / RIM_DASHES;
        arc(0, 0, reach * 2, reach * 2, from, from + RIM_DASH_RAD);
      }
      pop();
    }

    for (const cut of this.cuts) {
      const t = constrain(cut.age / 300, 0, 1);
      push();
      translate(cut.x, cut.y);
      rotate(t * 1.2);
      stroke(255, 235, 235, 235 * (1 - t));
      strokeWeight(4 * (1 - t) + 1);
      noFill();
      // a slash mark, not a ring: this is a sword cut
      arc(0, 0, 40 + 40 * t, 40 + 40 * t, -0.9, 0.9);
      arc(0, 0, 40 + 40 * t, 40 + 40 * t, Math.PI - 0.9, Math.PI + 0.9);
      pop();
    }
  }

  getDisplayBoundingBox(): Rectangle {
    let minX = this.position.x;
    let minY = this.position.y;
    let maxX = this.position.x;
    let maxY = this.position.y;
    for (const cut of this.cuts) {
      minX = Math.min(minX, cut.x);
      minY = Math.min(minY, cut.y);
      maxX = Math.max(maxX, cut.x);
      maxY = Math.max(maxY, cut.y);
    }
    const pad = whirlReach(this.owner) + 60;
    return new Rectangle({
      x: minX - pad,
      y: minY - pad,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2,
      data: this,
    });
  }
}