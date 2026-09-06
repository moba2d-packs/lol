import type {
  AttackableUnit,
  CastContext,
  CastSpec,
  TargetingRequest,
} from '@moba2d/core/content/types';
import { spendEmpower } from './Jax_W';
import { api } from '../packApi';

const AttackableUnitClass = api.units.AttackableUnit;
const TargetResolver = api.combat.TargetResolver;
const canSee = api.combat.Vision.canSee;
const effectiveRange = api.combat.Reach.effectiveRange;
const withinRange = api.combat.Reach.withinRange;
const Dash = api.buffs.Dash;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;


export const Q_DAMAGE = 22;

export const Q_RANGE = 300;

export const Q_DASH_SPEED = 24;

/** Close enough to have arrived, however far the body moved on the way. */
export const Q_ARRIVE_RADIUS = 55;

export const Q_MANA = 40;


const LAMP: [number, number, number] = [240, 196, 92];

const IRON: [number, number, number] = [66, 74, 88];

const VIOLET: [number, number, number] = [122, 92, 176];


export const isLeapTarget = (target: unknown): target is AttackableUnit =>
  target instanceof AttackableUnitClass && target.targetable && !target.toRemove && !target.isDead;


/**
 * Leap Strike — he jumps to a body and hits it when he gets there.
 *
 * `targetTeam: 'ENEMY'`, stated. Omitted, targeting defaults to `'ANY'` and the
 * nearest-target fallback resolves *Jax* with the cursor on empty ground — four
 * abilities in this pack shipped that way, each of them leaping onto and
 * damaging its own caster.
 */
export default class Jax_Q extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Dash;

  image = api.asset('spell_jax_q');
  name = 'Nhảy Và Nện (Jax_Q)';
  description =
    `Nhảy tới chỗ một kẻ địch trong <span>${Q_RANGE}px</span>; nếu tới nơi mà nó còn ở đó, ` +
    `gây ${dmg(Q_DAMAGE, 'PHYSICAL')}. Cú đánh này cũng tiêu được ` +
    `<span class="buff">Vận Sức</span> như một đòn đánh thường.`;
  coolDown = 7_000;
  manaCost = Q_MANA;
  range = Q_RANGE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  get targetingRequest(): Readonly<TargetingRequest> {
    return {
      range: this.range,
      targetTeam: 'ENEMY',
      queryCandidates: () => this.game.objectManager.objects,
      isTargetable: candidate => isLeapTarget(candidate),
      getTargetInfo: candidate =>
        isLeapTarget(candidate)
          ? {
              position: candidate.position,
              teamId: candidate.teamId,
              selectionRadius: candidate.animatedValues?.displaySize
                ? candidate.animatedValues.displaySize / 2
                : candidate.collisionRadius,
            }
          : null,
    };
  }

  press(context: CastContext): boolean {
    if (context.target !== undefined) return super.press(context);
    const result = TargetResolver.resolve('UNIT', {
      ...context,
      casterTeamId: this.owner.teamId,
      ...this.targetingRequest,
    });
    return result.ok ? super.press(result.context) : false;
  }

  checkCastCondition(): boolean {
    return this.isValidTarget(this.castContext?.target);
  }

  onUpdate(): void {
    if (this.state === 'CASTING' && !this.isValidTarget(this.castContext?.target)) {
      this.cancel('TARGET_INVALID');
    }
  }

  onSpellCast(context: CastContext): void {
    const target = context.target;
    if (!isLeapTarget(target)) return;

    if (!Dash.CanDash(this.owner)) {
      // Grounded: he cannot make the jump, so he simply does not — clamped to
      // the half of the ability that is still possible rather than refused.
      this.strike(target);
      return;
    }

    let landed = false;
    const leap = new Dash(1_500, this.owner, this.owner);
    leap.dashDestination = createVector(target.position.x, target.position.y);
    leap.dashSpeed = Q_DASH_SPEED;
    leap.showTrail = false;
    // `onDashUpdate`, never `leap.onUpdate = …`: the instance assignment
    // replaces the dash's own movement instead of hooking it, and he plays the
    // whole ability standing still.
    leap.onDashUpdate = () => {
      if (landed) return;
      if (target.isDead) {
        leap.deactivateBuff();
        return;
      }
      // He chases the body rather than the ground it was on: a target that
      // walks two steps is still where he lands.
      leap.dashDestination?.set(target.position.x, target.position.y);
      if (this.gapTo(target) > Q_ARRIVE_RADIUS) return;
      landed = true;
      this.strike(target);
      leap.deactivateBuff();
    };
    this.owner.addBuff(leap);

    this.game.objectManager.addObject(
      new Jax_Q_Arc(this.owner, this.owner.position.x, this.owner.position.y, target)
    );
  }

  gapTo(target: AttackableUnit): number {
    return Math.hypot(
      this.owner.position.x - target.position.x,
      this.owner.position.y - target.position.y
    );
  }

  /** The blow at the end of the jump. Empower rides on it exactly as on a swing. */
  strike(target: AttackableUnit): void {
    if (target.isDead) return;
    target.takeDamage(Q_DAMAGE, this.owner, 'PHYSICAL');
    spendEmpower(this.owner, target);
    this.game.objectManager.addObject(
      new Jax_Q_Landing(this.owner, target.position.x, target.position.y)
    );
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }

  private isValidTarget(target: unknown): target is AttackableUnit {
    return (
      isLeapTarget(target) &&
      canSee(this.owner, target) &&
      target.teamId !== this.owner.teamId &&
      withinRange(this.range, this.owner, target)
    );
  }
}


/** The line of the jump: a flat arc of dashes from where he pushed off. */
export class Jax_Q_Arc extends SpellObject {
  lifeTime = 320;
  age = 0;
  readonly fromX: number;
  readonly fromY: number;
  readonly target: AttackableUnit;

  constructor(owner: AttackableUnit, fromX: number, fromY: number, target: AttackableUnit) {
    super(owner);
    this.position = createVector(fromX, fromY);
    this.fromX = fromX;
    this.fromY = fromY;
    this.target = target;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const fade = 1 - t;
    const span = Math.hypot(this.target.position.x - this.fromX, this.target.position.y - this.fromY);
    const heading = Math.atan2(this.target.position.y - this.fromY, this.target.position.x - this.fromX);
    const steps = Math.max(2, Math.round(span / 30));

    push();
    translate(this.fromX, this.fromY);
    rotate(heading);
    noStroke();
    for (let i = 0; i <= steps; i++) {
      const at = (span * i) / steps;
      // A shallow hop drawn as a bow of plates, widest in the middle — the one
      // thing in a top-down frame that says "he went over" rather than "through".
      const lift = Math.sin((i / steps) * Math.PI) * 16;
      fill(VIOLET[0], VIOLET[1], VIOLET[2], 200 * fade);
      rectMode(CENTER);
      rect(at, -lift, 12, 5, 2);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((Q_RANGE + 60) * 2);
  }
}


/** The landing: a hard ring and the lamp coming down through it. */
export class Jax_Q_Landing extends SpellObject {
  lifeTime = 260;
  age = 0;

  constructor(owner: AttackableUnit, atX: number, atY: number) {
    super(owner);
    this.position = createVector(atX, atY);
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const out = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;

    push();
    translate(this.position.x, this.position.y);
    noFill();
    stroke(IRON[0], IRON[1], IRON[2], 230 * fade);
    strokeWeight(7);
    circle(0, 0, 62 * out);
    stroke(LAMP[0], LAMP[1], LAMP[2], 245 * fade);
    strokeWeight(3);
    circle(0, 0, 62 * out);

    // The lamp itself, planted where he came down.
    noStroke();
    fill(IRON[0], IRON[1], IRON[2], 240 * fade);
    rectMode(CENTER);
    rect(0, 0, 18, 22, 3);
    fill(LAMP[0], LAMP[1], LAMP[2], 245 * fade);
    rect(0, 0, 9, 13, 2);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(160);
  }
}
