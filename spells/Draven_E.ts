import type { AttackableUnit, CastContext } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const BuffAddType = api.enums.BuffAddType;
const Dash = api.buffs.Dash;
const Slow = api.buffs.Slow;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;


export const E_DAMAGE = 24;

export const E_LENGTH = 300;

export const E_HALF_WIDTH = 65;

export const E_SLOW_PERCENT = 0.35;

export const E_SLOW_MS = 2_000;

/** How far the fan shoves a body sideways off the line. */
export const E_KNOCK_ASIDE = 90;

export const E_KNOCK_SPEED = 16;

export const E_MANA = 55;


const BLOOD: [number, number, number] = [178, 34, 34];

const GOLD: [number, number, number] = [230, 184, 76];

const DARK: [number, number, number] = [40, 18, 18];


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


export default class Draven_E extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Cc;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_draven_e');
  name = 'Dạt Ra (Draven_E)';
  description =
    `Quăng một dải rìu dài <span>${E_LENGTH}px</span> về phía trước, gây ` +
    `${dmg(E_DAMAGE, 'PHYSICAL')}, <span class="buff">hất mọi kẻ địch sang bên</span> ` +
    `<span>${E_KNOCK_ASIDE}px</span> và <span class="buff">Làm Chậm ${pct(E_SLOW_PERCENT)}%</span> ` +
    `trong <span class="time">${secs(E_SLOW_MS)} giây</span>.`;
  coolDown = 10_000;
  manaCost = E_MANA;
  range = E_LENGTH;

  onSpellCast(context: CastContext): void {
    const aim = this.firingDirection(context);
    const span = Math.hypot(aim.x, aim.y) || 1;
    const reach = effectiveRange(E_LENGTH, this.owner);
    const heading = Math.atan2(aim.y, aim.x);
    const fromX = this.owner.position.x;
    const fromY = this.owner.position.y;
    const toX = fromX + (aim.x / span) * reach;
    const toY = fromY + (aim.y / span) * reach;
    const shoved: { x: number; y: number; side: number }[] = [];

    // No vision filter: a wall of thrown axes still hits the champion in a bush.
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({
        x: (fromX + toX) / 2,
        y: (fromY + toY) / 2,
        r: reach / 2 + E_HALF_WIDTH + 40,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const struck = new Set<AttackableUnit>();
    for (const victim of candidates) {
      if (struck.has(victim)) continue;
      const body = victim.collisionRadius || 0;
      if (distanceToSegment(victim.position.x, victim.position.y, fromX, fromY, toX, toY) > E_HALF_WIDTH + body) {
        continue;
      }
      struck.add(victim);
      victim.takeDamage(E_DAMAGE, this.owner, 'PHYSICAL');

      // `RENEW_EXISTING`: `Slow`'s default stacks ten deep, and two fans landing
      // on the same body would otherwise root it.
      const slow = new Slow(E_SLOW_MS, this.owner, victim);
      slow.buffAddType = BuffAddType.RENEW_EXISTING;
      slow.percent = E_SLOW_PERCENT;
      victim.addBuff(slow);

      // *Aside*, not back: the axes shove a body off the line rather than away
      // from Draven, which is what makes this a peel rather than a knockback.
      // Which side depends on which side it was already standing.
      const across = -(victim.position.x - fromX) * Math.sin(heading) + (victim.position.y - fromY) * Math.cos(heading);
      const side = across >= 0 ? 1 : -1;
      const shove = new Dash(600, this.owner, victim);
      shove.dashDestination = createVector(
        victim.position.x - Math.sin(heading) * side * E_KNOCK_ASIDE,
        victim.position.y + Math.cos(heading) * side * E_KNOCK_ASIDE
      );
      shove.dashSpeed = E_KNOCK_SPEED;
      shove.showTrail = false;
      victim.addBuff(shove);

      shoved.push({ x: victim.position.x, y: victim.position.y, side });
    }

    this.game.objectManager.addObject(
      new Draven_E_Fan(this.owner, fromX, fromY, heading, reach, shoved)
    );
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/**
 * The wall of axes going out: a hard-edged lane on exactly the corridor the hit
 * test walks, with blades tumbling down it and an arrow on each body saying
 * which way it was shoved.
 */
export class Draven_E_Fan extends SpellObject {
  lifeTime = 320;
  age = 0;
  readonly heading: number;
  readonly reach: number;
  readonly shoved: { x: number; y: number; side: number }[];

  constructor(
    owner: AttackableUnit,
    fromX: number,
    fromY: number,
    heading: number,
    reach: number,
    shoved: { x: number; y: number; side: number }[]
  ) {
    super(owner);
    this.position = createVector(fromX, fromY);
    this.heading = heading;
    this.reach = reach;
    this.shoved = shoved;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const flown = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;
    const run = this.reach * flown;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);
    rectMode(CORNER);
    noStroke();
    fill(DARK[0], DARK[1], DARK[2], 150 * fade);
    rect(0, -E_HALF_WIDTH, run, E_HALF_WIDTH * 2);
    noFill();
    stroke(BLOOD[0], BLOOD[1], BLOOD[2], 225 * fade);
    strokeWeight(3);
    rect(0, -E_HALF_WIDTH, run, E_HALF_WIDTH * 2);

    // Five blades across the width of the lane, at the leading edge.
    noStroke();
    for (let i = 0; i < 5; i++) {
      const across = -E_HALF_WIDTH + (E_HALF_WIDTH * 2 * i) / 4;
      push();
      translate(run, across);
      rotate(this.age * 0.015 + i);
      fill(DARK[0], DARK[1], DARK[2], 235 * fade);
      triangle(-14, 0, 14, -9, 14, 9);
      fill(GOLD[0], GOLD[1], GOLD[2], 235 * fade);
      triangle(-4, 0, 11, -5, 11, 5);
      pop();
    }
    pop();

    // Which way each body went — an arrow across the lane, on the side it was
    // actually shoved towards.
    push();
    for (const mark of this.shoved) {
      const away = 26 * (0.4 + 0.6 * flown);
      const tipX = mark.x - Math.sin(this.heading) * mark.side * away;
      const tipY = mark.y + Math.cos(this.heading) * mark.side * away;
      stroke(GOLD[0], GOLD[1], GOLD[2], 240 * fade);
      strokeWeight(4);
      line(mark.x, mark.y, tipX, tipY);
      noStroke();
      fill(GOLD[0], GOLD[1], GOLD[2], 240 * fade);
      const spread = 6;
      circle(tipX, tipY, spread * 2);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.reach + E_HALF_WIDTH + 40) * 2);
  }
}
