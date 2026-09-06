import type { AttackableUnit, CastContext, CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const Dash = api.buffs.Dash;
const SpellForm = api.enums.SpellForm;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;
const dmgValue = api.text.dmgValue;


export const R_DASH = 260;

export const R_DAMAGE = 26;

export const R_RECAST_DASH = 280;

/** The recast against a body at full health… */
export const R_RECAST_MIN = 18;

/** …and against one at nothing. `docs/abilities/akali/r.json` scales it on missing health. */
export const R_RECAST_MAX = 40;

export const R_DASH_SPEED = 24;

/** Half-width of the corridor either dash cuts. */
export const R_SWEEP = 55;

/** The record's "2.5-second static cooldown" before the second half is available. */
export const R_RECAST_GAP_MS = 2_000;

export const R_WINDOW_MS = 6_000;

export const R_MANA = 100;


const SHADOW: [number, number, number] = [18, 26, 30];

const JADE: [number, number, number] = [46, 214, 160];

const NEON: [number, number, number] = [236, 64, 122];


/** Shortest distance from a point to the segment `a -> b`, ends included. */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}


/** `R_RECAST_MIN` at full health, `R_RECAST_MAX` at none. */
export function executionDamage(healthRatio: number): number {
  const held = Math.max(0, Math.min(1, healthRatio));
  return R_RECAST_MIN + (R_RECAST_MAX - R_RECAST_MIN) * (1 - held);
}


/**
 * Perfect Execution — two dashes, and the second one finishes what the first
 * started.
 *
 * **Both halves are aimed, not target-locked.** The record makes the opening
 * dash unit-targeted and the recast a direction, which one `castSpec` cannot
 * say — a spec has exactly one `targeting`, and the runtime freezes it on the
 * opening press. Aiming both is the honest version of the same ability: she
 * still has to run the line through the body she wants, and the recast still
 * has to be pointed at whoever survived it.
 */
export default class Akali_R extends Spell {
  static aiRoles =
    api.enums.SpellRole.Damage | api.enums.SpellRole.Burst | api.enums.SpellRole.Dash;

  /** Late enough that the static gap has passed, early enough to still catch them. */
  static aiRecastAfterMs = R_RECAST_GAP_MS + 400;

  image = api.asset('spell_akali_r');
  name = 'Sát Chiêu Hoàn Hảo (Akali_R)';
  description =
    `Lao <span>${R_DASH}px</span> theo hướng chỉ định, gây ${dmg(R_DAMAGE, 'MAGIC')} cho ` +
    `mọi kẻ địch trên đường. Sau <span class="time">${secs(R_RECAST_GAP_MS)} giây</span> có thể ` +
    `<b>bấm lại</b> trong <span class="time">${secs(R_WINDOW_MS)} giây</span> để lao ` +
    `<span>${R_RECAST_DASH}px</span> lần nữa, gây từ ${dmgValue(R_RECAST_MIN, 'MAGIC')} lên tới ` +
    `${dmg(R_RECAST_MAX, 'MAGIC')} tuỳ theo <span class="buff">lượng máu đã mất</span> của mục tiêu.`;
  coolDown = 10_000;
  manaCost = R_MANA;
  range = Math.max(R_DASH, R_RECAST_DASH);

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'RECAST',
      targeting: 'DIRECTION',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      active: { maxDurationMs: R_WINDOW_MS, recastDelayMs: R_RECAST_GAP_MS },
      // She fights between the two halves; only real crowd control takes the
      // second one away.
      interrupts: SpellForm.AIMED,
    };
  }

  onActivate(context: CastContext): void {
    this.leap(context, R_DASH, () => R_DAMAGE);
  }

  onRecast(context: CastContext): void {
    // The execution: what it is worth is read off each body as it is passed, so
    // one dash can be worth its minimum against a healthy target and its
    // maximum against the one beside them.
    this.leap(context, R_RECAST_DASH, victim =>
      Math.round(
        executionDamage(victim.stats.health.value / Math.max(1, victim.stats.maxHealth.value))
      )
    );
  }

  /**
   * One dash, and everything the corridor it walks passes through.
   *
   * Resolved at the press, from where she is and where she is about to be,
   * rather than frame by frame along the flight: the dash is a fifth of a
   * second and a player who aimed the line through a body should be paid for it
   * whether or not that body took a step during it.
   */
  private leap(
    context: CastContext,
    distance: number,
    worth: (victim: AttackableUnit) => number
  ): void {
    const aim = this.firingDirection(context);
    const span = Math.hypot(aim.x, aim.y) || 1;
    const fromX = this.owner.position.x;
    const fromY = this.owner.position.y;
    const toX = fromX + (aim.x / span) * distance;
    const toY = fromY + (aim.y / span) * distance;

    if (Dash.CanDash(this.owner)) {
      const dash = new Dash(1_500, this.owner, this.owner);
      dash.dashDestination = createVector(toX, toY);
      dash.dashSpeed = R_DASH_SPEED;
      dash.showTrail = false;
      this.owner.addBuff(dash);
    }

    const sweep = effectiveRange(R_SWEEP, this.owner);
    const midX = (fromX + toX) / 2;
    const midY = (fromY + toY) / 2;
    const cuts: { x: number; y: number; worth: number }[] = [];

    // No vision filter: a body she runs straight through is hit whether or not
    // her team can see it.
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: midX, y: midY, r: distance / 2 + sweep }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const struck = new Set<AttackableUnit>();
    for (const victim of candidates) {
      if (struck.has(victim)) continue;
      const body = victim.collisionRadius || 0;
      if (distanceToSegment(victim.position.x, victim.position.y, fromX, fromY, toX, toY) > sweep + body) {
        continue;
      }
      struck.add(victim);
      const amount = worth(victim);
      victim.takeDamage(amount, this.owner, 'MAGIC');
      cuts.push({ x: victim.position.x, y: victim.position.y, worth: amount });
    }

    this.game.objectManager.addObject(
      new Akali_R_Line(this.owner, fromX, fromY, toX, toY, sweep, cuts)
    );
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * The line she ran, on exactly the corridor the hit test walked: a flat capsule
 * with a hard rim, and a slash on each body it passed through — longer where the
 * execution was worth more, so the ramp is visible in the frame it happened.
 */
export class Akali_R_Line extends SpellObject {
  lifeTime = 300;
  age = 0;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly sweep: number;
  readonly cuts: { x: number; y: number; worth: number }[];

  constructor(
    owner: AttackableUnit,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    sweep: number,
    cuts: { x: number; y: number; worth: number }[]
  ) {
    super(owner);
    this.position = createVector((fromX + toX) / 2, (fromY + toY) / 2);
    this.fromX = fromX;
    this.fromY = fromY;
    this.toX = toX;
    this.toY = toY;
    this.sweep = sweep;
    this.cuts = cuts;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  get span(): number {
    return Math.hypot(this.toX - this.fromX, this.toY - this.fromY);
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const drawn = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;
    const heading = Math.atan2(this.toY - this.fromY, this.toX - this.fromX);
    const run = this.span * drawn;

    push();
    translate(this.fromX, this.fromY);
    rotate(heading);
    rectMode(CORNER);
    noStroke();
    fill(SHADOW[0], SHADOW[1], SHADOW[2], 165 * fade);
    rect(0, -this.sweep, run, this.sweep * 2, this.sweep);
    noFill();
    stroke(JADE[0], JADE[1], JADE[2], 220 * fade);
    strokeWeight(3);
    rect(0, -this.sweep, run, this.sweep * 2, this.sweep);
    stroke(NEON[0], NEON[1], NEON[2], 240 * fade);
    strokeWeight(4);
    line(0, 0, run, 0);
    pop();

    push();
    for (const cut of this.cuts) {
      // Sized by what it was worth: a full-health body takes a nick, a nearly
      // dead one takes the whole blade.
      const scale = cut.worth / R_RECAST_MAX;
      const reach = (12 + 20 * Math.max(0, Math.min(1, scale))) * (0.5 + 0.5 * drawn);
      stroke(NEON[0], NEON[1], NEON[2], 240 * fade);
      strokeWeight(3);
      const acrossX = Math.cos(heading + Math.PI / 2) * reach;
      const acrossY = Math.sin(heading + Math.PI / 2) * reach;
      line(cut.x - acrossX, cut.y - acrossY, cut.x + acrossX, cut.y + acrossY);
    }
    pop();
  }

  getDisplayBoundingBox() {
    // Centred on the middle of the run, so the box has to cover both ends.
    return this.squareDisplayBoundingBox((this.span + this.sweep + 40) * 2);
  }
}
