import type { AttackableUnit, CastContext, CastSpec } from '@moba2d/core/content/types';
import { primeLightslinger } from './Lucian_Q';
import { api } from '../packApi';
import { secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const SpellForm = api.enums.SpellForm;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;


export const R_DURATION_MS = 2_500;

export const R_SHOT_INTERVAL_MS = 250;

export const R_SHOT_DAMAGE = 5;

export const R_RANGE = 420;

export const R_HALF_WIDTH = 28;

/** How many shots the whole channel is worth, and what it adds up to. */
export const R_SHOTS = Math.floor(R_DURATION_MS / R_SHOT_INTERVAL_MS);

export const R_TOTAL_DAMAGE = R_SHOTS * R_SHOT_DAMAGE;

/** The record's 0.75s before he may end it early. */
export const R_RECAST_GAP_MS = 750;

export const R_MANA = 100;


const LIGHT: [number, number, number] = [255, 232, 170];

const GOLD: [number, number, number] = [226, 168, 60];

const DARK: [number, number, number] = [40, 34, 44];


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


/**
 * The Culling — a stream of shots down one line, and he keeps walking.
 *
 * **Not `SpellForm.CHANNELED`**, deliberately: that is the one form that breaks
 * on the caster's *own movement*, and the record is explicit that "while
 * channeling, Lucian is ghosted and may still move". `AIMED` survives walking
 * and Flash and ends on death, stun or silence, which is the ability.
 *
 * Each shot hits only the **first** body on the line, so a creep wave between
 * him and a champion is real cover — which is what makes where he stands the
 * decision the ultimate is about.
 */
export default class Lucian_R extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Burst;

  /** Only near the end: a Culling cut short is a Culling half spent. */
  static aiRecastAfterMs = R_DURATION_MS - 300;

  image = api.asset('spell_lucian_r');
  name = 'Thanh Trừng (Lucian_R)';
  description =
    `Nã liên tục <span>${R_SHOTS}</span> phát về một hướng trong ` +
    `<span class="time">${secs(R_DURATION_MS)} giây</span>, mỗi phát gây ` +
    `${dmg(R_SHOT_DAMAGE, 'PHYSICAL')} cho <span class="buff">kẻ địch đầu tiên</span> trên ` +
    `đường bay — tổng cộng ${dmg(R_TOTAL_DAMAGE, 'PHYSICAL')} nếu trúng hết vào một mục tiêu. ` +
    `Lucian <span class="buff">vẫn đi lại được</span> trong lúc bắn, và có thể ` +
    `<b>bấm lại</b> sau <span class="time">${secs(R_RECAST_GAP_MS)} giây</span> để dừng sớm.`;
  coolDown = 10_000;
  manaCost = R_MANA;
  range = R_RANGE;

  /** Which way he is firing, frozen at the press. */
  private heading = 0;
  private firing = false;
  private elapsedMs = 0;
  private sinceShotMs = 0;
  /** How many have actually gone out — the picture and a test both read this. */
  shotsFired = 0;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'RECAST',
      targeting: 'DIRECTION',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      active: { maxDurationMs: R_DURATION_MS, recastDelayMs: R_RECAST_GAP_MS },
      interrupts: SpellForm.AIMED,
    };
  }

  onActivate(context: CastContext): void {
    primeLightslinger(this.owner);
    const aim = this.firingDirection(context);
    this.heading = Math.atan2(aim.y, aim.x);
    this.firing = true;
    this.elapsedMs = 0;
    // Zero, not one interval: the first round leaves after the first tick
    // rather than two arriving on the same frame.
    this.sinceShotMs = 0;
    this.shotsFired = 0;
  }

  onUpdate(): void {
    if (!this.firing) return;
    if (this.owner.isDead) {
      this.firing = false;
      return;
    }

    this.elapsedMs += deltaTime;
    this.sinceShotMs += deltaTime;
    while (this.sinceShotMs >= R_SHOT_INTERVAL_MS && this.shotsFired < R_SHOTS) {
      this.sinceShotMs -= R_SHOT_INTERVAL_MS;
      this.fire();
    }
    if (this.elapsedMs >= R_DURATION_MS || this.shotsFired >= R_SHOTS) this.firing = false;
  }

  onRecast(): void {
    this.firing = false;
  }

  onComplete(): void {
    this.firing = false;
  }

  /** One shot, at the first body on the line. */
  private fire(): void {
    this.shotsFired += 1;
    const reach = effectiveRange(R_RANGE, this.owner);
    const fromX = this.owner.position.x;
    const fromY = this.owner.position.y;
    const toX = fromX + Math.cos(this.heading) * reach;
    const toY = fromY + Math.sin(this.heading) * reach;

    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: (fromX + toX) / 2, y: (fromY + toY) / 2, r: reach / 2 + R_HALF_WIDTH }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    let first: AttackableUnit | undefined;
    let closest = Infinity;
    for (const candidate of candidates) {
      const body = candidate.collisionRadius || 0;
      if (distanceToSegment(candidate.position.x, candidate.position.y, fromX, fromY, toX, toY) > R_HALF_WIDTH + body) {
        continue;
      }
      // Along the line, not as the crow flies: the nearest body *down the
      // barrel* is what stops the shot.
      const along =
        (candidate.position.x - fromX) * Math.cos(this.heading) +
        (candidate.position.y - fromY) * Math.sin(this.heading);
      if (along < 0 || along >= closest) continue;
      closest = along;
      first = candidate;
    }

    const stoppedAt = first ? closest : reach;
    if (first) first.takeDamage(R_SHOT_DAMAGE, this.owner, 'PHYSICAL');

    this.game.objectManager.addObject(
      new Lucian_R_Round(this.owner, fromX, fromY, this.heading, stoppedAt, Boolean(first))
    );
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/** One round: a short hard bar down the line, and a flash where it stopped. */
export class Lucian_R_Round extends SpellObject {
  lifeTime = 160;
  age = 0;
  readonly heading: number;
  readonly reach: number;
  readonly struck: boolean;

  constructor(
    owner: AttackableUnit,
    fromX: number,
    fromY: number,
    heading: number,
    reach: number,
    struck: boolean
  ) {
    super(owner);
    this.position = createVector(fromX, fromY);
    this.heading = heading;
    this.reach = reach;
    this.struck = struck;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const fade = 1 - t;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);
    rectMode(CORNER);
    noStroke();
    fill(GOLD[0], GOLD[1], GOLD[2], 190 * fade);
    rect(0, -3, this.reach, 6);
    fill(LIGHT[0], LIGHT[1], LIGHT[2], 235 * fade);
    rect(0, -1.5, this.reach, 3);

    if (this.struck) {
      // Where it stopped: a hard chevron rather than a bloom.
      fill(DARK[0], DARK[1], DARK[2], 230 * fade);
      triangle(this.reach - 12, -10, this.reach + 8, 0, this.reach - 12, 10);
      fill(LIGHT[0], LIGHT[1], LIGHT[2], 245 * fade);
      triangle(this.reach - 6, -5, this.reach + 4, 0, this.reach - 6, 5);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.reach + 40) * 2);
  }
}
