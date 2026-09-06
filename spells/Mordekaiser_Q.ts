import type { AttackableUnit, Buff, CastContext, OnHitEvent } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const BaseBuff = api.buffs.Buff;
const Speedup = api.buffs.Speedup;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const dmg = api.text.dmg;


/* --------------------------------------------------------- Darkness Rise

   Three hits on champions and the iron starts burning. The passive lives in
   the Q file because Q is the ability that feeds it fastest, and the other
   three only need `feedDarkness` to take part.
   ------------------------------------------------------------------------ */

/** `docs/abilities/mordekaiser/i.json`: three, then the aura. */
export const DARKNESS_TO_RISE = 3;

export const DARKNESS_WINDOW_MS = 4_000;

/** How long the aura burns once it is up, before it has to be fed again. */
export const DARKNESS_AURA_MS = 5_000;

export const DARKNESS_RADIUS = 200;

export const DARKNESS_TICK_MS = 500;

export const DARKNESS_TICK_DAMAGE = 3;

export const DARKNESS_SPEED = 0.08;


export const Q_DAMAGE = 22;

/** "…increased if only one enemy is hit." The record's whole hook for this ability. */
export const Q_ISOLATED_BONUS = 0.4;

export const Q_ISOLATED_DAMAGE = Math.round(Q_DAMAGE * (1 + Q_ISOLATED_BONUS));

export const Q_LENGTH = 300;

export const Q_HALF_WIDTH = 45;

export const Q_MANA = 30;


const IRON: [number, number, number] = [72, 78, 88];

const VOID: [number, number, number] = [122, 60, 168];

const EMBER: [number, number, number] = [226, 92, 60];


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


/** The count. A bare `Buff` because it is a counter and the count is the tooltip. */
export class Mordekaiser_Darkness extends BaseBuff {
  name = 'Hắc Ám Lan Tràn x1';
  stackId = 'mordekaiser_darkness';
  buffAddType = api.enums.BuffAddType.RENEW_EXISTING;
  description = `Đủ ${DARKNESS_TO_RISE} dấu thì hào quang bóng tối bùng lên.`;
  count = 1;
}


/**
 * The aura itself. Its own class rather than a configured `DamageOverTime`
 * because what it burns is everything *around* him, not the body it sits on.
 */
export class Mordekaiser_DarknessRise extends BaseBuff {
  name = 'Hắc Ám Lan Tràn';
  stackId = 'mordekaiser_darkness_rise';
  buffAddType = api.enums.BuffAddType.RENEW_EXISTING;
  description = `Thiêu ${DARKNESS_TICK_DAMAGE} sát thương phép mỗi ${secs(DARKNESS_TICK_MS)} giây lên mọi kẻ địch quanh Mordekaiser.`;
  private tickMs = 0;

  onUpdate(): void {
    if (this.targetUnit.isDead) return;
    this.tickMs += deltaTime;
    while (this.tickMs >= DARKNESS_TICK_MS) {
      this.tickMs -= DARKNESS_TICK_MS;
      this.burn();
    }
  }

  private burn(): void {
    const radius = effectiveRange(DARKNESS_RADIUS, this.targetUnit);
    const candidates = this.targetUnit.game.objectManager.queryObjects({
      area: new Circle({
        x: this.targetUnit.position.x,
        y: this.targetUnit.position.y,
        r: radius,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.targetUnit.teamId)],
    }) as AttackableUnit[];

    for (const victim of candidates) {
      victim.takeDamage(DARKNESS_TICK_DAMAGE, this.targetUnit, 'MAGIC');
    }
    this.targetUnit.game.objectManager.addObject(
      new Mordekaiser_Q_Aura(this.targetUnit, radius)
    );
  }
}


const liveBuff = <T>(unit: AttackableUnit, Kind: new (...args: never[]) => T): T | undefined => {
  for (const buff of unit.buffs as Buff[]) {
    if (!buff.toRemove && buff instanceof (Kind as never)) return buff as T;
  }
  return undefined;
};


/** How many marks he is carrying. Exported so a test reads a count, not a buff. */
export function darknessStacks(morde: AttackableUnit): number {
  return liveBuff(morde, Mordekaiser_Darkness)?.count ?? 0;
}


/**
 * One more hit on something worth counting. At `DARKNESS_TO_RISE` the aura
 * lights, and every hit after that keeps it lit.
 *
 * Only champions count, exactly as the record has it: an aura that a creep wave
 * could switch on would be permanently on.
 */
export function feedDarkness(morde: AttackableUnit, victim: AttackableUnit): void {
  if (morde.isDead || victim.killCredit !== 'champion') return;

  const burning = liveBuff(morde, Mordekaiser_DarknessRise);
  if (burning) {
    burning.renewBuff();
    return;
  }

  const marks = liveBuff(morde, Mordekaiser_Darkness);
  if (!marks) {
    morde.addBuff(new Mordekaiser_Darkness(DARKNESS_WINDOW_MS, morde, morde));
    return;
  }

  marks.count += 1;
  marks.name = `Hắc Ám Lan Tràn x${marks.count}`;
  marks.renewBuff();
  if (marks.count < DARKNESS_TO_RISE) return;

  marks.deactivateBuff();
  const rise = new Mordekaiser_DarknessRise(DARKNESS_AURA_MS, morde, morde);
  rise.image = api.asset('spell_mordekaiser_i');
  morde.addBuff(rise);

  const haste = new Speedup(DARKNESS_AURA_MS, morde, morde);
  haste.stackId = 'mordekaiser_darkness_haste';
  haste.image = api.asset('spell_mordekaiser_i');
  haste.percent = DARKNESS_SPEED;
  morde.addBuff(haste);
}


/** Always on: his swings feed the count as readily as his abilities do. */
export class Mordekaiser_Q_Passive extends BaseBuff {
  name = 'Hắc Ám Lan Tràn';
  stackId = 'mordekaiser_darkness_passive';
  hudVisible = false;
  description = 'Đòn đánh thường của Mordekaiser cộng một dấu Hắc Ám Lan Tràn.';

  onHit(hit: OnHitEvent): void {
    // A phantom swing is the same blow arriving twice; the count is per blow.
    if (hit.echo) return;
    feedDarkness(this.targetUnit, hit.victim);
  }
}


export default class Mordekaiser_Q extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Poke;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_mordekaiser_q');
  name = 'Chùy Hủy Diệt (Mordekaiser_Q)';
  description =
    `Nện chuỳ thành một vệt dài <span>${Q_LENGTH}px</span>, gây ${dmg(Q_DAMAGE, 'MAGIC')} — ` +
    `hoặc ${dmg(Q_ISOLATED_DAMAGE, 'MAGIC')} nếu <span class="buff">chỉ trúng đúng một kẻ địch</span>. ` +
    `Nội tại <span class="buff">Hắc Ám Lan Tràn</span>: đủ <span>${DARKNESS_TO_RISE}</span> lần ` +
    `chạm tướng địch thì hào quang bùng lên trong ` +
    `<span class="time">${secs(DARKNESS_AURA_MS)} giây</span>, thiêu ` +
    `${dmg(DARKNESS_TICK_DAMAGE, 'MAGIC')} mỗi <span class="time">${secs(DARKNESS_TICK_MS)} giây</span> ` +
    `quanh hắn và cho <span class="buff">+${pct(DARKNESS_SPEED)}% tốc chạy</span>.`;
  coolDown = 6_000;
  manaCost = Q_MANA;
  range = Q_LENGTH;

  onUpdate(): void {
    if (!this.owner || this.owner.isDead) return;
    if (this.owner.hasBuff(Mordekaiser_Q_Passive)) return;
    this.owner.addBuff(new Mordekaiser_Q_Passive(Infinity, this.owner, this.owner));
  }

  onSpellCast(context: CastContext): void {
    const aim = this.firingDirection(context);
    const span = Math.hypot(aim.x, aim.y) || 1;
    const reach = effectiveRange(Q_LENGTH, this.owner);
    const fromX = this.owner.position.x;
    const fromY = this.owner.position.y;
    const toX = fromX + (aim.x / span) * reach;
    const toY = fromY + (aim.y / span) * reach;

    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({
        x: (fromX + toX) / 2,
        y: (fromY + toY) / 2,
        r: reach / 2 + Q_HALF_WIDTH + 20,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    // Gathered first, paid second: what the swing is worth depends on how many
    // it caught, so nothing can be dealt until the whole line is known.
    const caught: AttackableUnit[] = [];
    for (const victim of candidates) {
      if (caught.includes(victim)) continue;
      const body = victim.collisionRadius || 0;
      if (distanceToSegment(victim.position.x, victim.position.y, fromX, fromY, toX, toY) > Q_HALF_WIDTH + body) {
        continue;
      }
      caught.push(victim);
    }

    const isolated = caught.length === 1;
    const damage = isolated ? Q_ISOLATED_DAMAGE : Q_DAMAGE;
    for (const victim of caught) {
      victim.takeDamage(damage, this.owner, 'MAGIC');
      feedDarkness(this.owner, victim);
    }

    this.game.objectManager.addObject(
      new Mordekaiser_Q_Slam(
        this.owner,
        fromX,
        fromY,
        Math.atan2(aim.y, aim.x),
        reach,
        isolated,
        caught.map(victim => ({ x: victim.position.x, y: victim.position.y }))
      )
    );
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}


/** The mace coming down: a heavy slab on the corridor the hit test walks. */
export class Mordekaiser_Q_Slam extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  lifeTime = 300;
  age = 0;
  readonly heading: number;
  readonly reach: number;
  readonly isolated: boolean;
  readonly struck: { x: number; y: number }[];

  constructor(
    owner: AttackableUnit,
    fromX: number,
    fromY: number,
    heading: number,
    reach: number,
    isolated: boolean,
    struck: { x: number; y: number }[]
  ) {
    super(owner);
    this.position = createVector(fromX, fromY);
    this.heading = heading;
    this.reach = reach;
    this.isolated = isolated;
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
    // Isolated is worth more, so it is drawn hotter — the one number a player
    // has to learn about this ability, said in the picture.
    const [r, g, b] = this.isolated ? EMBER : VOID;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);
    rectMode(CORNER);
    noStroke();
    fill(IRON[0], IRON[1], IRON[2], 170 * fade);
    rect(0, -Q_HALF_WIDTH, run, Q_HALF_WIDTH * 2);
    fill(r, g, b, 160 * fade);
    rect(0, -Q_HALF_WIDTH * 0.45, run, Q_HALF_WIDTH * 0.9);
    noFill();
    stroke(r, g, b, 240 * fade);
    strokeWeight(3);
    rect(0, -Q_HALF_WIDTH, run, Q_HALF_WIDTH * 2);
    pop();

    push();
    for (const mark of this.struck) {
      stroke(r, g, b, 240 * fade);
      strokeWeight(4);
      const reach = 16 * (0.5 + 0.5 * drawn);
      line(mark.x - reach, mark.y - reach, mark.x + reach, mark.y + reach);
      line(mark.x - reach, mark.y + reach, mark.x + reach, mark.y - reach);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.reach + Q_HALF_WIDTH + 40) * 2);
  }
}


/** One beat of the aura: a hard ring on the radius it actually burned. */
export class Mordekaiser_Q_Aura extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  lifeTime = DARKNESS_TICK_MS;
  age = 0;
  readonly radius: number;

  constructor(owner: AttackableUnit, radius: number) {
    super(owner);
    this.position = owner.position.copy();
    this.radius = radius;
  }

  update(): void {
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    if (this.age >= this.lifeTime || this.owner.isDead) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const fade = 1 - t;

    push();
    translate(this.position.x, this.position.y);
    noFill();
    stroke(IRON[0], IRON[1], IRON[2], 200 * fade);
    strokeWeight(6);
    circle(0, 0, this.radius * 2);
    stroke(VOID[0], VOID[1], VOID[2], 235 * fade);
    strokeWeight(3);
    circle(0, 0, this.radius * 2);
    // Eight hard spokes rather than a haze, so the burn reads as iron and not
    // as light.
    strokeWeight(4);
    stroke(EMBER[0], EMBER[1], EMBER[2], 200 * fade);
    for (let i = 0; i < 8; i++) {
      const spin = (Math.PI * 2 * i) / 8 + t * 0.6;
      line(
        Math.cos(spin) * this.radius * 0.78,
        Math.sin(spin) * this.radius * 0.78,
        Math.cos(spin) * this.radius,
        Math.sin(spin) * this.radius
      );
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 40) * 2);
  }
}
