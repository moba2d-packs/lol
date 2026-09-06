import type { AttackableUnit, Buff, CastContext, OnHitEvent } from '@moba2d/core/content/types';
import { shortenPursuit } from './Lucian_E';
import { api } from '../packApi';
import { secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const BaseBuff = api.buffs.Buff;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;


/* ------------------------------------------------------------ Lightslinger

   The passive lives here because Q is the ability a Lucian presses most, and
   because every other file in the kit only needs one exported function to take
   part: `primeLightslinger`. Nothing subscribes to "an ability was cast" — the
   three other spells say so themselves, which is one call each and cannot go
   out of step with what actually counts as a cast.
   -------------------------------------------------------------------------- */

export const LIGHTSLINGER_DAMAGE = 10;

/** The record's 3.5 seconds to spend the second shot. */
export const LIGHTSLINGER_WINDOW_MS = 3_000;


export const Q_DAMAGE = 24;

export const Q_LENGTH = 380;

export const Q_HALF_WIDTH = 30;

export const Q_MANA = 40;


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


/** The second shot, waiting on the next swing. */
export class Lucian_Lightslinger extends BaseBuff {
  name = 'Xạ Thủ Ánh Sáng';
  stackId = 'lucian_lightslinger';
  description = `Đòn đánh thường kế tiếp bắn thêm một phát ${LIGHTSLINGER_DAMAGE} sát thương.`;

  onHit(hit: OnHitEvent): void {
    // A phantom swing is the same blow arriving twice, and the second shot is
    // already the ability's own echo — counting it would fire four.
    if (hit.echo) return;
    this.deactivateBuff();
    hit.victim.takeDamage(LIGHTSLINGER_DAMAGE, this.targetUnit, 'PHYSICAL');
    // Every shot that lands buys back a slice of the dash; a champion is worth
    // twice a creep. `Lucian_E` owns the rule, this only reports the hit.
    shortenPursuit(this.targetUnit, hit.victim.killCredit === 'champion');
    this.targetUnit.game.objectManager.addObject(
      new Lucian_Q_Shot(this.targetUnit, hit.victim.position.x, hit.victim.position.y)
    );
  }
}


/** Whether the second shot is loaded right now. */
export function lightslingerOn(unit: AttackableUnit): Lucian_Lightslinger | undefined {
  for (const buff of unit.buffs as Buff[]) {
    if (buff instanceof Lucian_Lightslinger && !buff.toRemove) return buff;
  }
  return undefined;
}


/**
 * Load the second shot. Called by all four abilities, by hand.
 *
 * Not an `ON_POST_CAST_SPELL` listener: that event fires for the basic attack
 * and for Hồi Thành as readily as for an ability (both ride the spell
 * machinery), so a listener would re-load the shot with the swing that was
 * meant to spend it and Lightslinger would never come off.
 */
export function primeLightslinger(lucian: AttackableUnit): void {
  if (lucian.isDead) return;
  const loaded = lightslingerOn(lucian);
  if (loaded) {
    loaded.renewBuff();
    return;
  }
  const shot = new Lucian_Lightslinger(LIGHTSLINGER_WINDOW_MS, lucian, lucian);
  shot.image = api.asset('spell_lucian_i');
  lucian.addBuff(shot);
}


/**
 * Piercing Light.
 *
 * **Aimed, not target-locked.** The record fires the laser "in the direction of
 * the target enemy" — a unit target that resolves into a line — and the line is
 * the half that matters: it pierces, so where it is pointed decides what it
 * catches. Aiming it directly says the same thing with one fewer moving part,
 * and it keeps the ability castable at a spot rather than only at a body.
 */
export default class Lucian_Q extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Poke;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_lucian_q');
  name = 'Tia Sáng Xuyên Thấu (Lucian_Q)';
  description =
    `Bắn một tia sáng dài <span>${Q_LENGTH}px</span> <span class="buff">xuyên qua mọi kẻ địch</span> ` +
    `trên đường, gây ${dmg(Q_DAMAGE, 'PHYSICAL')}. ` +
    `Nội tại <span class="buff">Xạ Thủ Ánh Sáng</span>: sau mỗi lần dùng chiêu, đòn đánh thường ` +
    `kế tiếp trong <span class="time">${secs(LIGHTSLINGER_WINDOW_MS)} giây</span> bắn thêm ` +
    `một phát ${dmg(LIGHTSLINGER_DAMAGE, 'PHYSICAL')}.`;
  coolDown = 7_000;
  manaCost = Q_MANA;
  range = Q_LENGTH;

  onSpellCast(context: CastContext): void {
    primeLightslinger(this.owner);

    const aim = this.firingDirection(context);
    const span = Math.hypot(aim.x, aim.y) || 1;
    const reach = effectiveRange(Q_LENGTH, this.owner);
    const fromX = this.owner.position.x;
    const fromY = this.owner.position.y;
    const toX = fromX + (aim.x / span) * reach;
    const toY = fromY + (aim.y / span) * reach;
    const struck: { x: number; y: number }[] = [];

    // No vision filter: a beam through a bush still burns whoever is in it.
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({
        x: (fromX + toX) / 2,
        y: (fromY + toY) / 2,
        r: reach / 2 + Q_HALF_WIDTH + 20,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const hit = new Set<AttackableUnit>();
    for (const victim of candidates) {
      if (hit.has(victim)) continue;
      const body = victim.collisionRadius || 0;
      if (distanceToSegment(victim.position.x, victim.position.y, fromX, fromY, toX, toY) > Q_HALF_WIDTH + body) {
        continue;
      }
      hit.add(victim);
      victim.takeDamage(Q_DAMAGE, this.owner, 'PHYSICAL');
      struck.push({ x: victim.position.x, y: victim.position.y });
    }

    this.game.objectManager.addObject(
      new Lucian_Q_Beam(this.owner, fromX, fromY, Math.atan2(aim.y, aim.x), reach, struck)
    );
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/** The laser: a flat bar with a hard rim, and a mark on every body it pierced. */
export class Lucian_Q_Beam extends SpellObject {
  lifeTime = 260;
  age = 0;
  readonly heading: number;
  readonly reach: number;
  readonly struck: { x: number; y: number }[];

  constructor(
    owner: AttackableUnit,
    fromX: number,
    fromY: number,
    heading: number,
    reach: number,
    struck: { x: number; y: number }[]
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
    const drawn = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;
    const run = this.reach * drawn;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);
    rectMode(CORNER);
    noStroke();
    fill(DARK[0], DARK[1], DARK[2], 130 * fade);
    rect(0, -Q_HALF_WIDTH, run, Q_HALF_WIDTH * 2);
    fill(GOLD[0], GOLD[1], GOLD[2], 200 * fade);
    rect(0, -Q_HALF_WIDTH * 0.5, run, Q_HALF_WIDTH);
    fill(LIGHT[0], LIGHT[1], LIGHT[2], 245 * fade);
    rect(0, -4, run, 8);
    noFill();
    stroke(LIGHT[0], LIGHT[1], LIGHT[2], 220 * fade);
    strokeWeight(2);
    rect(0, -Q_HALF_WIDTH, run, Q_HALF_WIDTH * 2);
    pop();

    push();
    for (const mark of this.struck) {
      noFill();
      stroke(LIGHT[0], LIGHT[1], LIGHT[2], 235 * fade);
      strokeWeight(3);
      circle(mark.x, mark.y, 26 * (0.5 + 0.5 * drawn));
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.reach + Q_HALF_WIDTH + 40) * 2);
  }
}


/** The second shot landing: a small hard chevron, so it reads as *another* bullet. */
export class Lucian_Q_Shot extends SpellObject {
  lifeTime = 180;
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
    const fade = 1 - t;
    const grown = 1 + 0.6 * t;

    push();
    translate(this.position.x, this.position.y);
    noStroke();
    fill(GOLD[0], GOLD[1], GOLD[2], 230 * fade);
    triangle(-11 * grown, -8 * grown, 12 * grown, 0, -11 * grown, 8 * grown);
    fill(LIGHT[0], LIGHT[1], LIGHT[2], 245 * fade);
    triangle(-5 * grown, -4 * grown, 8 * grown, 0, -5 * grown, 4 * grown);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(90);
  }
}
