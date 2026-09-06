import type { AttackableUnit, CastContext, CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const SpellForm = api.enums.SpellForm;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;


export const R_DAMAGE = 30;

/** Two axes, and the record is loud about it: they fly and return as a pair. */
export const R_AXES = 2;

/** How far apart the pair flies, measured across the line. */
export const R_SPREAD = 46;

export const R_LENGTH = 520;

export const R_SPEED = 22;

/** How wide a body has to be missed by to be missed. */
export const R_HALF_WIDTH = 34;

/** The record's "can be recast after 1 second while the axes are travelling". */
export const R_RECAST_GAP_MS = 1_000;

export const R_WINDOW_MS = 6_000;

export const R_MANA = 100;


const BLOOD: [number, number, number] = [178, 34, 34];

const GOLD: [number, number, number] = [230, 184, 76];

const DARK: [number, number, number] = [40, 18, 18];


/**
 * Whirling Death — two axes out, and the recast turns them round.
 *
 * The pair is one object rather than two, because they are one throw: they
 * share a hit set, so a body standing between them takes the ultimate once on
 * the way out and once on the way back, and never twice from one pass.
 */
export default class Draven_R extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Burst;

  /** Late enough to have travelled, early enough that they can still turn round. */
  static aiRecastAfterMs = R_RECAST_GAP_MS + 300;

  image = api.asset('spell_draven_r');
  name = 'Lốc Xoáy Tử Vong (Draven_R)';
  description =
    `Ném <span>${R_AXES}</span> lưỡi rìu khổng lồ bay thẳng xa <span>${R_LENGTH}px</span>, ` +
    `gây ${dmg(R_DAMAGE, 'PHYSICAL')} cho mọi kẻ địch trên đường. ` +
    `Sau <span class="time">${secs(R_RECAST_GAP_MS)} giây</span> có thể <b>bấm lại</b> để ` +
    `<span class="buff">gọi rìu quay về</span>, gây lại chừng ấy sát thương trên đường về. ` +
    `Rìu tự quay về khi bay hết tầm.`;
  coolDown = 10_000;
  manaCost = R_MANA;
  range = R_LENGTH;

  /** The pair in the air, so a recast can turn the same axes rather than throw new ones. */
  flight: Draven_R_Pair | null = null;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'RECAST',
      targeting: 'DIRECTION',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      active: { maxDurationMs: R_WINDOW_MS, recastDelayMs: R_RECAST_GAP_MS },
      // He fights while they are out; only real crowd control takes the recall
      // away from him.
      interrupts: SpellForm.AIMED,
    };
  }

  onActivate(context: CastContext): void {
    const aim = this.firingDirection(context);
    const heading = Math.atan2(aim.y, aim.x);
    const pair = new Draven_R_Pair(this.owner, heading);
    this.flight = pair;
    this.game.objectManager.addObject(pair);
  }

  onRecast(): void {
    this.flight?.recall();
  }

  onComplete(): void {
    this.flight = null;
  }
}


/**
 * The pair in the air. Out until it is recalled or runs out of line, then home,
 * and gone once it reaches him.
 */
export class Draven_R_Pair extends SpellObject {
  readonly heading: number;
  /** How far down the line the pair has flown. */
  travelled = 0;
  /** True once they have turned round — outward and homeward are different passes. */
  returning = false;
  private readonly hitOutbound = new Set<AttackableUnit>();
  private readonly hitHomeward = new Set<AttackableUnit>();
  private readonly fromX: number;
  private readonly fromY: number;

  constructor(owner: AttackableUnit, heading: number) {
    super(owner);
    this.position = owner.position.copy();
    this.fromX = owner.position.x;
    this.fromY = owner.position.y;
    this.heading = heading;
  }

  /** Turn them round. Idempotent: running out of line and a recast can share a frame. */
  recall(): void {
    this.returning = true;
  }

  /** Where the middle of the pair is, this frame. */
  get atX(): number {
    return this.fromX + Math.cos(this.heading) * this.travelled;
  }

  get atY(): number {
    return this.fromY + Math.sin(this.heading) * this.travelled;
  }

  update(): void {
    const before = this.travelled;
    if (!this.returning) {
      this.travelled += R_SPEED;
      // Running out of line turns them round on its own — the record does the
      // same, and a pair that simply stopped at maximum range would strand the
      // half of the ability that comes home.
      if (this.travelled >= effectiveRange(R_LENGTH, this.owner)) this.recall();
    } else {
      this.travelled -= R_SPEED;
    }
    this.position.set(this.atX, this.atY);

    this.cut(before, this.travelled);

    // Home. They are his again, and the activation's own clock will close the
    // recast window on the next tick.
    if (this.returning && this.travelled <= 0) this.toRemove = true;
  }

  /** Everything the two blades swept between `from` and `to` along the line. */
  private cut(from: number, to: number): void {
    const near = Math.min(from, to);
    const far = Math.max(from, to);
    const aX = this.fromX + Math.cos(this.heading) * near;
    const aY = this.fromY + Math.sin(this.heading) * near;
    const bX = this.fromX + Math.cos(this.heading) * far;
    const bY = this.fromY + Math.sin(this.heading) * far;
    const struck = this.returning ? this.hitHomeward : this.hitOutbound;

    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({
        x: (aX + bX) / 2,
        y: (aY + bY) / 2,
        r: (far - near) / 2 + R_SPREAD + R_HALF_WIDTH + 20,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of candidates) {
      if (struck.has(victim)) continue;
      const body = victim.collisionRadius || 0;
      // Each blade has its own corridor, offset either side of the line, so the
      // gap between them is a real gap a body can stand in.
      let caught = false;
      for (const side of [-1, 1]) {
        const offX = -Math.sin(this.heading) * side * (R_SPREAD / 2);
        const offY = Math.cos(this.heading) * side * (R_SPREAD / 2);
        if (
          distanceToSegment(
            victim.position.x,
            victim.position.y,
            aX + offX,
            aY + offY,
            bX + offX,
            bY + offY
          ) <=
          R_HALF_WIDTH + body
        ) {
          caught = true;
          break;
        }
      }
      if (!caught) continue;

      struck.add(victim);
      victim.takeDamage(R_DAMAGE, this.owner, 'PHYSICAL');
    }
  }

  draw(): void {
    const spin = this.travelled * 0.05 * (this.returning ? -1 : 1);

    push();
    for (const side of [-1, 1]) {
      const x = this.atX - Math.sin(this.heading) * side * (R_SPREAD / 2);
      const y = this.atY + Math.cos(this.heading) * side * (R_SPREAD / 2);
      push();
      translate(x, y);
      rotate(spin);
      noStroke();
      // A double-headed axe: two flat wedges off one haft, hard edges only.
      for (const blade of [-1, 1]) {
        fill(DARK[0], DARK[1], DARK[2], 240);
        triangle(0, 0, blade * 30, -17, blade * 30, 17);
        fill(GOLD[0], GOLD[1], GOLD[2], 240);
        triangle(blade * 9, 0, blade * 26, -10, blade * 26, 10);
      }
      fill(BLOOD[0], BLOOD[1], BLOOD[2], 245);
      circle(0, 0, 13);
      pop();
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((R_SPREAD + R_HALF_WIDTH + 60) * 2);
  }
}


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
