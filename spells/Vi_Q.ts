import type { AttackableUnit, CastContext, CastSpec, Slow, Vec2 } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const SpellForm = api.enums.SpellForm;
const Airborne = api.buffs.Airborne;
const Dash = api.buffs.Dash;
const Slow = api.buffs.Slow;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const dmgRange = api.text.dmgRange;


export const Q_MAX_CHARGE_MS = 1_200;

export const Q_MIN_DISTANCE = 200;

export const Q_MAX_DISTANCE = 420;

export const Q_MIN_DAMAGE = 15;

export const Q_MAX_DAMAGE = 30;

export const Q_PUSH = 120;

export const Q_KNOCKUP_MS = 400;

export const Q_CHARGE_SLOW = 0.15;

/** How close a body has to be to the gauntlet for the charge to end on it. */
export const Q_HIT_RADIUS = 60;

export const Q_DASH_SPEED = 16;

/** A ceiling, not a duration: the dash ends the frame it arrives. */
export const Q_DASH_MAX_MS = 900;

export const Q_IMPACT_REACH = 96;


const BRASS: [number, number, number] = [225, 177, 44];

const HEXTECH: [number, number, number] = [0, 168, 255];


const clampCharge = (charge: number): number => (charge < 0 ? 0 : charge > 1 ? 1 : charge);


/** How far the release travels. Exported so the telegraph and the test share one truth. */
export function viQDashDistance(charge: number): number {
  return Q_MIN_DISTANCE + (Q_MAX_DISTANCE - Q_MIN_DISTANCE) * clampCharge(charge);
}


export function viQDamage(charge: number): number {
  return Q_MIN_DAMAGE + (Q_MAX_DAMAGE - Q_MIN_DAMAGE) * clampCharge(charge);
}


/**
 * Vi's charged gauntlet dash.
 *
 * The whole ability is one number the enemy has to read off the ground — how
 * far she has wound up — so the telegraph is drawn at `viQDashDistance` of the
 * charge she is holding *right now*, never at the maximum. A fixed-length wedge
 * over a variable-length dash tells the enemy to step back when they did not
 * have to, and to stand still when they did.
 */
export default class Vi_Q extends Spell {
  image = api.asset('spell_vi_q');
  name = 'Cú Đấm Bùng Nổ (Vi_Q)';
  description = `Nạp lực rồi lao tới, dừng lại ở kẻ địch đầu tiên:
    ${dmgRange(Q_MIN_DAMAGE, Q_MAX_DAMAGE, 'PHYSICAL', '', ' đến ')},
    hất tung ${secs(Q_KNOCKUP_MS)} giây và đẩy lùi ${Q_PUSH} đơn vị.
    Nạp càng lâu, cú lao càng xa.`;
  coolDown = 10_000;
  manaCost = 30;
  range = Q_MAX_DISTANCE;

  /** The fraction of the wind-up held right now; the telegraph reads it live. */
  charge = 0;
  private winding = false;
  private chargeSlow: Slow | null = null;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'HOLD_RELEASE',
      targeting: 'DIRECTION',
      charge: { maxDurationMs: Q_MAX_CHARGE_MS, releaseAtMax: true },
      resource: { commitAt: 'release', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
      // She strafes while she winds up, so walking is part of the gesture.
      interrupts: SpellForm.AIMED,
    };
  }

  checkCastCondition(): boolean {
    return Dash.CanDash(this.owner);
  }

  onCastStart(_context: CastContext): void {
    this.charge = 0;
    this.winding = true;
    const heavy = new Slow(Q_MAX_CHARGE_MS + 200, this.owner, this.owner);
    heavy.percent = Q_CHARGE_SLOW;
    heavy.stackId = 'vi_q_windup';
    this.chargeSlow = heavy;
    this.owner.addBuff(heavy);
  }

  onChargeUpdate(_context: CastContext, elapsedMs: number): void {
    this.charge = clampCharge(elapsedMs / Q_MAX_CHARGE_MS);
  }

  onCancel(): void {
    this.dropWindup();
  }

  onSpellCast(context: CastContext): void {
    const held = this.charge;
    this.dropWindup();

    const distance = viQDashDistance(held);
    const damage = viQDamage(held);
    const aim = this.firingDirection(context);
    const span = Math.hypot(aim.x, aim.y) || 1;
    const heading: Vec2 = { x: aim.x / span, y: aim.y / span };

    const dash = new Dash(Q_DASH_MAX_MS, this.owner, this.owner);
    dash.dashSpeed = Q_DASH_SPEED;
    dash.dashDestination = createVector(
      this.owner.position.x + heading.x * distance,
      this.owner.position.y + heading.y * distance
    );
    dash.image = this.image;
    dash.trailSystem.trailColor = 'rgba(0, 168, 255, 0.45)';

    // Not a Set: the charge *ends* on the first body it reaches, so one latch
    // says everything a per-unit ledger would and also stops the dash.
    let spent = false;
    dash.onDashUpdate = () => {
      if (spent) return;
      const victim = this.bodyAgainstTheGauntlet();
      if (!victim) return;
      spent = true;
      this.punch(victim, damage, heading);
      dash.deactivateBuff();
    };
    this.owner.addBuff(dash);
  }

  /**
   * A collision, not an acquisition: whatever body the fist has reached is what
   * the fist has reached, so this takes the first one the quadtree hands back
   * rather than ranking candidates.
   */
  private bodyAgainstTheGauntlet(): AttackableUnit | null {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: effectiveRange(Q_HIT_RADIUS, this.owner),
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const candidate of found) {
      if (candidate !== this.owner) return candidate;
    }
    return null;
  }

  private punch(victim: AttackableUnit, damage: number, heading: Vec2): void {
    victim.takeDamage(damage, this.owner, 'PHYSICAL');
    victim.addBuff(new Airborne(Q_KNOCKUP_MS, this.owner, victim));

    const shove = new Dash(Q_KNOCKUP_MS, this.owner, victim);
    shove.dashSpeed = Q_PUSH / 24;
    shove.dashDestination = createVector(
      victim.position.x + heading.x * Q_PUSH,
      victim.position.y + heading.y * Q_PUSH
    );
    shove.showTrail = false;
    // The knock-up this same punch applies is on the default cancel list, so an
    // unnarrowed shove would cancel itself on the frame it started.
    shove.buffsToCheckCancel = [];
    victim.addBuff(shove);

    this.game.objectManager.addObject(
      new Vi_Q_Impact(this.owner, victim.position.copy(), Math.atan2(heading.y, heading.x))
    );
  }

  private dropWindup(): void {
    this.charge = 0;
    this.winding = false;
    const heavy = this.chargeSlow;
    this.chargeSlow = null;
    if (heavy && !heavy.toRemove) heavy.deactivateBuff();
  }

  /**
   * The wind-up telegraph — an aim guide on the caster, which is the one thing
   * allowed to be drawn from here instead of from a SpellObject.
   */
  drawVfx(): void {
    super.drawVfx();
    if (!this.winding) return;

    const reach = viQDashDistance(this.charge);
    const aimed = this.aimPoint;
    const origin = this.owner.position;
    const heading = Math.atan2(aimed.y - origin.y, aimed.x - origin.x);
    // The gauntlet catches at one radius the whole way down — the same reach
    // `bodyAgainstTheGauntlet` queries — so the corridor is a constant-width
    // band with a rounded nose. Winding up makes it *longer*, never wider; the
    // fan it used to draw promised 13px of width at her feet and 66 at the far
    // end, and was wrong at both ends of the charge.
    const gauntlet = effectiveRange(Q_HIT_RADIUS, this.owner);

    push();
    translate(origin.x, origin.y);
    rotate(heading);
    rectMode(CORNER);
    noStroke();
    fill(HEXTECH[0], HEXTECH[1], HEXTECH[2], 26 + 44 * this.charge);
    rect(0, -gauntlet, reach, gauntlet * 2);
    arc(reach, 0, gauntlet * 2, gauntlet * 2, -HALF_PI, HALF_PI, PIE);
    // The hard rim sits exactly where the dash will stop, at the radius that
    // actually connects.
    noFill();
    stroke(BRASS[0], BRASS[1], BRASS[2], 150 + 90 * this.charge);
    strokeWeight(3);
    arc(reach, 0, gauntlet * 2, gauntlet * 2, -HALF_PI, HALF_PI);
    stroke(HEXTECH[0], HEXTECH[1], HEXTECH[2], 110 + 100 * this.charge);
    strokeWeight(2);
    line(0, -gauntlet, reach, -gauntlet);
    line(0, gauntlet, reach, gauntlet);
    pop();
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * The wedge that lands on the body she hit: a brass cone of force punched along
 * the dash axis, with the ground fracturing away from the strike in straight
 * lines. Painted well past its own centre, so it carries its own box.
 */
export class Vi_Q_Impact extends SpellObject {
  lifeTime = 340;
  age = 0;
  radius = Q_IMPACT_REACH;
  heading: number;
  /** Seeded once: random() inside draw() flickers instead of animating. */
  fractures: { spread: number; length: number; kink: number }[] = [];

  constructor(owner: AttackableUnit, at: p5.Vector, heading: number) {
    super(owner);
    this.position = at;
    this.heading = heading;
  }

  onAdded(): void {
    for (let i = 0; i < 7; i++) {
      this.fractures.push({
        spread: random(-1.1, 1.1),
        length: random(0.55, 1),
        kink: random(-0.3, 0.3),
      });
    }
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const opened = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);

    // The cone of force, thrown forward off the fist.
    noStroke();
    fill(HEXTECH[0], HEXTECH[1], HEXTECH[2], 150 * fade);
    const cone = this.radius * 0.72 * opened;
    quad(-14, 0, cone * 0.5, -30 * opened - 8, cone, 0, cone * 0.5, 30 * opened + 8);

    // Straight fracture lines, never rings — the ground splits, it does not ripple.
    stroke(BRASS[0], BRASS[1], BRASS[2], 230 * fade);
    strokeWeight(3 * fade + 1);
    for (const fracture of this.fractures) {
      const reach = this.radius * fracture.length * opened;
      const bend = fracture.spread + fracture.kink * opened;
      line(
        Math.cos(fracture.spread) * 10,
        Math.sin(fracture.spread) * 10,
        Math.cos(bend) * reach,
        Math.sin(bend) * reach
      );
    }

    // The white-hot vent flash sits on the body that took it.
    noFill();
    stroke(255, 255, 255, 235 * fade * fade);
    strokeWeight(4 * fade + 1);
    circle(0, 0, 22 + 40 * opened);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 40) * 2);
  }
}