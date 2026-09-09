import type { Airborne, AttackableUnit, CastContext, CastSpec, TargetingRequest, Untargetable } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const effectiveRange = api.combat.Reach.effectiveRange;
const withinRange = api.combat.Reach.withinRange;
const TargetResolver = api.combat.TargetResolver;
const AttackableUnit = api.units.AttackableUnit;
const Airborne = api.buffs.Airborne;
const Dash = api.buffs.Dash;
const Untargetable = api.buffs.Untargetable;
const Spell = api.Spell;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const Slow = api.buffs.Slow;
const SpellObject = api.SpellObject;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const dmg = api.text.dmg;
// `api.text.pct`, renamed at the seam: this file already has a `pct` of its
// own (`../text`), which formats a fraction as a number and writes no markup.
const share = api.text.pct;


export const SETT_R_RANGE = 250;

export const SETT_R_CARRY = 340;

export const SETT_R_CARRY_MS = 550;

export const SETT_R_SLAM = 45;

export const SETT_R_BLAST = 30;

export const SETT_R_BLAST_RADIUS = 220;

export const SETT_R_SLOW = 0.5;

export const SETT_R_SLOW_MS = 1_500;

export const SETT_R_CRATER_MS = 2_000;

/**
 * **The share of the carried champion's health that the landing is worth**, on
 * top of both flat figures above.
 *
 * The ability was a pair of flat numbers, and that is not what The Show Stopper
 * is: in the source game the slam is scaled by *whoever he picked up*, which is
 * the entire reason the play is to grab the biggest body in the fight rather
 * than the nearest one. Without it the ultimate reads as a 45 with a long
 * animation — reported exactly that way, as "yếu so với LMHT".
 *
 * **Maximum health, not bonus health, and that is a deliberate divergence.**
 * The source scales on the target's *bonus* health, which works there because
 * everyone buys some. Here a champion's pool is ~100 and bonus health is
 * frequently zero, so a bonus-health scaling would be an ultimate that behaves
 * identically until somebody happens to buy one specific item. Maximum health
 * is felt from the first fight and still rewards grabbing the tank.
 *
 * 15% of a stock pool is 15 — a third again on the slam and half again on the
 * blast — and against a champion who has bought health it is double that. It
 * is added to the blast as well as to the slam because in the source game
 * *everyone at the landing point* pays for the body he threw.
 */
export const SETT_R_CARRIED_HEALTH_SHARE = 0.15;

/**
 * What the body he is carrying adds to every number this ultimate deals.
 *
 * Exported so the test does not restate the arithmetic, and read from the
 * *carried* unit rather than from each victim — one figure, decided by who he
 * grabbed, exactly as the card says.
 */
export const carriedBonus = (carried: AttackableUnit): number =>
  Math.round(carried.stats.maxHealth.value * SETT_R_CARRIED_HEALTH_SHARE);

/** How high the carried body is held while it flies. */
export const SETT_R_LIFT = 70;

/** How far in front of him the body is planted on landing. */
export const SETT_R_DROP = 58;


const HOT: [number, number, number] = [255, 140, 0];

const GOLD: [number, number, number] = [255, 215, 0];

const BLOOD: [number, number, number] = [183, 21, 64];


/**
 * He picks one champion up and throws himself with them in a parabolic suplex.
 */
export default class Sett_R extends Spell {
  image = api.asset('spell_sett_r');
  name = 'Hủy Diệt Đấu Trường (Sett_R)';
  description =
    `Sett bốc một tướng địch lên không trung (không thể bị chọn làm mục tiêu), bay vút lên ` +
    `và nện xuống đất: mục tiêu bị ném nhận ${dmg(SETT_R_SLAM, 'PHYSICAL')}, ` +
    `mọi kẻ địch khác trong bán kính ${SETT_R_BLAST_RADIUS} nhận ${dmg(SETT_R_BLAST, 'PHYSICAL')} ` +
    `và bị làm chậm ${pct(SETT_R_SLOW)}% trong ${secs(SETT_R_SLOW_MS)} giây. ` +
    `Cả hai đều cộng thêm ${share(SETT_R_CARRIED_HEALTH_SHARE * 100, 'PHYSICAL', ' máu tối đa của mục tiêu bị bế')} ` +
    `— bế càng to thì nện càng đau.`;
  coolDown = 10_000;
  manaCost = 100;
  range = SETT_R_RANGE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  /** Caster-centred, and both bodies are wide, so Reach owns the number. */
  get targetingRequest(): Readonly<TargetingRequest> {
    return {
      ...super.targetingRequest,
      range: effectiveRange(this.range, this.owner),
      targetTeam: 'ENEMY',
      queryCandidates: () => this.game.objectManager.objects,
      isTargetable: candidate => this.isValidTarget(candidate),
      getTargetInfo: candidate =>
        this.isValidTarget(candidate)
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

  private isValidTarget(target?: unknown): target is AttackableUnit {
    return (
      target instanceof AttackableUnit &&
      !target.isDead &&
      !target.toRemove &&
      target !== this.owner &&
      target.teamId !== this.owner.teamId &&
      withinRange(SETT_R_RANGE, this.owner, target)
    );
  }

  checkCastCondition(): boolean {
    return Dash.CanDash(this.owner) && this.isValidTarget(this.castContext?.target);
  }

  press(context: CastContext): boolean {
    if (context.target !== undefined) {
      if (!this.isValidTarget(context.target as AttackableUnit)) return false;
      return super.press(context);
    }

    const result = TargetResolver.resolve('UNIT', {
      ...context,
      casterTeamId: this.owner.teamId,
      ...this.targetingRequest,
    });
    return result.ok ? super.press(result.context) : false;
  }

  onSpellCast(context: CastContext): void {
    const victim = context?.target as AttackableUnit | undefined;
    if (!this.isValidTarget(victim)) return;

    const aim = this.firingDirection(context);
    const heading = Math.atan2(aim.y, aim.x);

    victim.stopMovement();
    victim.markDisplaced();
    const lifted = new Airborne(SETT_R_CARRY_MS, this.owner, victim);
    lifted.height = SETT_R_LIFT;
    victim.addBuff(lifted);

    const victimHidden = new Untargetable(SETT_R_CARRY_MS, this.owner, victim);
    victim.addBuff(victimHidden);

    const settHidden = new Untargetable(SETT_R_CARRY_MS, this.owner, this.owner);
    this.owner.addBuff(settHidden);

    const dash = new Dash(SETT_R_CARRY_MS, this.owner, this.owner);
    dash.dashDestination = createVector(
      this.owner.position.x + Math.cos(heading) * SETT_R_CARRY,
      this.owner.position.y + Math.sin(heading) * SETT_R_CARRY
    );
    dash.dashSpeed = 15;
    dash.buffsToCheckCancel = [];
    this.owner.addBuff(dash);

    const carry = new Sett_R_Carry(this.owner, victim, heading, lifted, victimHidden, settHidden);
    this.game.objectManager.addObject(carry);
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * The parabolic flight. Sett and victim leap in an arc through the air,
 * untargetable until the crater slam.
 */
export class Sett_R_Carry extends SpellObject {
  age = 0;
  landed = false;
  sparks: { angle: number; reach: number }[] = [];

  private heading: number;
  private carried: AttackableUnit;
  private lifted: Airborne | null;
  private victimHidden: Untargetable | null;
  private settHidden: Untargetable | null;

  constructor(
    owner: AttackableUnit,
    carried: AttackableUnit,
    heading: number,
    lifted: Airborne | null,
    victimHidden: Untargetable | null,
    settHidden: Untargetable | null
  ) {
    super(owner);
    this.carried = carried;
    this.heading = heading;
    this.lifted = lifted;
    this.victimHidden = victimHidden;
    this.settHidden = settHidden;
  }

  onAdded(): void {
    for (let i = 0; i < 9; i++) {
      this.sparks.push({ angle: random(TWO_PI), reach: random(20, 50) });
    }
  }

  update(): void {
    if (this.landed) {
      this.toRemove = true;
      return;
    }
    this.age += deltaTime;
    this.position.set(this.owner.position.x, this.owner.position.y);

    const t = constrain(this.age / SETT_R_CARRY_MS, 0, 1);
    const leapZ = Math.sin(t * Math.PI) * 90;

    const lost = this.carried.isDead || this.carried.toRemove;
    if (!lost) {
      this.carried.teleportTo(this.owner.position.x, this.owner.position.y - leapZ);
    }
    if (this.age >= SETT_R_CARRY_MS || lost || this.owner.isDead) this.slam();
  }

  draw(): void {
    const t = constrain(this.age / SETT_R_CARRY_MS, 0, 1);
    const leapZ = Math.sin(t * Math.PI) * 90;
    const body = this.owner.animatedValues.displaySize * 0.5 || 27;
    const shadowScale = Math.max(0.4, 1 - leapZ / 150);

    push();
    translate(this.position.x, this.position.y);

    // 1. Ground drop shadow beneath leaping Sett and victim
    noStroke();
    fill(0, 0, 0, 100 * shadowScale);
    ellipse(0, 0, body * 3.2 * shadowScale, body * 1.6 * shadowScale);

    // 2. Fiery overhead grip & speed lines
    translate(0, -leapZ);
    rotate(this.heading);

    // Fiery overhead clamp arms
    for (let side = -1; side <= 1; side += 2) {
      fill(BLOOD[0], BLOOD[1], BLOOD[2], 235);
      rect(side * body * 0.6 - 7, -SETT_R_LIFT * 0.55, 14, SETT_R_LIFT * 0.6, 4);
    }
    fill(HOT[0], HOT[1], HOT[2], 220);
    rect(-body * 0.9, -SETT_R_LIFT * 0.65, body * 1.8, 14, 4);

    // Trailing fiery leap sparks
    stroke(GOLD[0], GOLD[1], GOLD[2], 220);
    strokeWeight(3.5);
    for (const spark of this.sparks) {
      const sx = cos(spark.angle) * body;
      const sy = sin(spark.angle) * body * 0.6;
      line(sx, sy, sx - spark.reach * (1 - t * 0.5), sy);
    }

    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((SETT_R_LIFT + 140) * 2);
  }

  private slam(): void {
    this.landed = true;
    this.toRemove = true;
    if (this.lifted && !this.lifted.toRemove) this.lifted.deactivateBuff();
    if (this.victimHidden && !this.victimHidden.toRemove) this.victimHidden.deactivateBuff();
    if (this.settHidden && !this.settHidden.toRemove) this.settHidden.deactivateBuff();

    const atX = this.owner.position.x;
    const atY = this.owner.position.y;
    const dropX = atX + Math.cos(this.heading) * SETT_R_DROP;
    const dropY = atY + Math.sin(this.heading) * SETT_R_DROP;
    const thrown = this.carried;
    // Read once, off the body he actually threw, and paid by everyone at the
    // landing point — see `SETT_R_CARRIED_HEALTH_SHARE`. Read *before* the slam
    // lands, so a pool that a death or a shield changes mid-impact cannot make
    // the two halves of one ultimate disagree.
    const carriedShare = carriedBonus(thrown);
    const alive = !thrown.isDead && !thrown.toRemove;
    if (alive) {
      thrown.teleportTo(dropX, dropY);
      thrown.takeDamage(SETT_R_SLAM + carriedShare, this.owner, 'PHYSICAL');
    }

    // The rim the crater paints is the radius the damage really used.
    const blast = effectiveRange(SETT_R_BLAST_RADIUS, this.owner);
    const shaken = this.game.objectManager.queryObjects({
      area: new Circle({ x: atX, y: atY, r: blast }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    // A plain loop: Array.prototype.filter cannot narrow here. The thrown body
    // pays the slam and nothing else — never both halves of one ultimate.
    const struck = new Set<AttackableUnit>();
    for (const unit of shaken) {
      if (unit === thrown || struck.has(unit)) continue;
      struck.add(unit);
      unit.takeDamage(SETT_R_BLAST + carriedShare, this.owner, 'PHYSICAL');
      const slow = new Slow(SETT_R_SLOW_MS, this.owner, unit);
      slow.percent = SETT_R_SLOW;
      slow.stackId = 'sett_r_arena_slow';
      unit.addBuff(slow);
    }

    const crater = new Sett_R_Crater(this.owner, atX, atY, blast, dropX, dropY);
    this.game.objectManager.addObject(crater);
  }
}


/**
 * Ground art, so zIndex = GROUND_Z_INDEX: an un-overridden SpellObject subclass
 * resolves to SPELL_EFFECT_Z_INDEX instead, over everyone's feet.
 */
export class Sett_R_Crater extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  lifeTime = SETT_R_CRATER_MS;
  age = 0;
  radius: number;
  /** Seeded once in onAdded — random() inside draw() flickers instead of animating. */
  slabs: { angle: number; at: number; span: number; tilt: number }[] = [];

  private impactX: number;
  private impactY: number;

  constructor(
    owner: AttackableUnit,
    x: number,
    y: number,
    radius: number,
    impactX: number,
    impactY: number
  ) {
    super(owner);
    this.position = createVector(x, y);
    this.radius = radius;
    this.impactX = impactX;
    this.impactY = impactY;
  }

  onAdded(): void {
    for (let i = 0; i < 12; i++) {
      this.slabs.push({
        angle: random(TWO_PI),
        at: random(0.25, 1),
        span: random(22, 54),
        tilt: random(-0.5, 0.5),
      });
    }
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const shock = constrain(this.age / 340, 0, 1);
    const opened = 1 - (1 - shock) * (1 - shock);
    const fade = 1 - t;
    push();
    rectMode(CORNER);
    translate(this.position.x, this.position.y);

    // cracked ground: heavy slabs, no thin arcs
    noStroke();
    fill(38, 24, 20, 150 * fade);
    circle(0, 0, this.radius * 1.5 * opened);
    fill(BLOOD[0], BLOOD[1], BLOOD[2], 120 * fade);
    for (const slab of this.slabs) {
      const rx = cos(slab.angle) * this.radius * slab.at * opened;
      const ry = sin(slab.angle) * this.radius * slab.at * opened;
      push();
      translate(rx, ry);
      rotate(slab.angle + slab.tilt);
      rect(-slab.span / 2, -5, slab.span, 10, 2);
      pop();
    }

    // the hard rim, on the real blast radius
    noFill();
    stroke(HOT[0], HOT[1], HOT[2], 240 * fade);
    strokeWeight(7 * fade + 2);
    circle(0, 0, this.radius * 2 * opened);

    // the impact itself, centred on the body he threw
    stroke(255, 244, 226, 245 * fade);
    strokeWeight(6 * fade + 2);
    const mark = 34 * opened;
    const cx = this.impactX - this.position.x;
    const cy = this.impactY - this.position.y;
    line(cx - mark, cy - mark, cx + mark, cy + mark);
    line(cx - mark, cy + mark, cx + mark, cy - mark);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 60) * 2);
  }
}