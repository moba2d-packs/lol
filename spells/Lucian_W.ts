import type { AttackableUnit, Buff, CastContext } from '@moba2d/core/content/types';
import { primeLightslinger } from './Lucian_Q';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Circle = api.utils.Quadtree.Circle;
const effectiveRange = api.combat.Reach.effectiveRange;
const PredefinedFilters = api.combat.PredefinedFilters;
const BaseBuff = api.buffs.Buff;
const Speedup = api.buffs.Speedup;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const MissileSpellObject = api.MissileSpellObject;
const dmg = api.text.dmg;


export const W_DAMAGE = 18;

export const W_RANGE = 330;

export const W_SPEED = 18;

/** Half the length of each arm of the cross the missile leaves. */
export const W_CROSS_ARM = 120;

export const W_CROSS_HALF_WIDTH = 30;

export const W_MARK_MS = 5_000;

export const W_SPEED_PERCENT = 0.35;

export const W_SPEED_MS = 1_000;

export const W_MANA = 50;


const LIGHT: [number, number, number] = [255, 232, 170];

const GOLD: [number, number, number] = [226, 168, 60];

const DARK: [number, number, number] = [40, 34, 44];


/**
 * The mark, and the reason the ability is worth pressing at all.
 *
 * `onDamageTaken` is the seam: it fires on the *victim* with whoever dealt the
 * blow, which is exactly the question the record asks — "did Lucian damage a
 * marked target". Nothing on Lucian's side could answer it without a listener
 * that watched every hit in the match.
 */
export class Lucian_W_Mark extends BaseBuff {
  name = 'Dấu Lửa';
  stackId = 'lucian_w_mark';
  description = 'Bị đánh dấu — Lucian gây sát thương lên mục tiêu này sẽ được tăng tốc.';

  onDamageTaken(_swung: number, _landed: number, attacker?: AttackableUnit): void {
    if (!attacker || attacker !== this.sourceUnit || attacker.isDead) return;
    const rush = new Speedup(W_SPEED_MS, attacker, attacker);
    rush.stackId = 'lucian_w_rush';
    rush.image = api.asset('spell_lucian_w');
    rush.percent = W_SPEED_PERCENT;
    attacker.addBuff(rush);
  }
}


/** Whether `unit` is carrying the mark right now. */
export function markOn(unit: AttackableUnit): Lucian_W_Mark | undefined {
  for (const buff of unit.buffs as Buff[]) {
    if (buff instanceof Lucian_W_Mark && !buff.toRemove) return buff;
  }
  return undefined;
}


export default class Lucian_W extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Zone;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_lucian_w');
  name = 'Tia Sáng Rực Cháy (Lucian_W)';
  description =
    `Bắn một quả cầu lửa; khi trúng địch hoặc bay hết <span>${W_RANGE}px</span> nó nổ thành ` +
    `<span class="buff">hình chữ thập</span> dài <span>${W_CROSS_ARM * 2}px</span>, gây ` +
    `${dmg(W_DAMAGE, 'MAGIC')} và <span class="buff">đánh dấu</span> mọi kẻ trúng đòn trong ` +
    `<span class="time">${secs(W_MARK_MS)} giây</span>. Lucian gây sát thương lên mục tiêu ` +
    `đã đánh dấu sẽ nhận <span class="buff">+${pct(W_SPEED_PERCENT)}% tốc chạy</span> trong ` +
    `<span class="time">${secs(W_SPEED_MS)} giây</span>.`;
  coolDown = 10_000;
  manaCost = W_MANA;
  range = W_RANGE;

  onSpellCast(context: CastContext): void {
    primeLightslinger(this.owner);

    const aim = this.firingDirection(context);
    const span = Math.hypot(aim.x, aim.y) || 1;
    const reach = effectiveRange(W_RANGE, this.owner);

    const blaze = new Lucian_W_Blaze(this.owner);
    blaze.heading = Math.atan2(aim.y, aim.x);
    blaze.destination = createVector(
      this.owner.position.x + (aim.x / span) * reach,
      this.owner.position.y + (aim.y / span) * reach
    );
    this.game.objectManager.addObject(blaze);
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
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


/**
 * The missile. It does no damage of its own — everything it is worth is in the
 * cross it leaves, which is what the record describes and what makes the
 * ability an area mark rather than a bolt.
 */
export class Lucian_W_Blaze extends MissileSpellObject {
  speed = W_SPEED;
  size = 24;
  maxHitCount = 1;
  /** The way it was fired, so the cross lands square to the shot. */
  heading = 0;

  onHit(): void {
    this.detonate();
  }

  onArrive(): void {
    this.detonate();
  }

  /** Idempotent: arriving on the frame it hits something must not pay twice. */
  private detonated = false;

  private detonate(): void {
    if (this.detonated) return;
    this.detonated = true;
    this.game.objectManager.addObject(
      new Lucian_W_Cross(this.owner, this.position.x, this.position.y, this.heading)
    );
  }

  draw(): void {
    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);
    noStroke();
    // A four-armed spark, already the shape of what it is about to become.
    fill(DARK[0], DARK[1], DARK[2], 235);
    circle(0, 0, this.size);
    fill(GOLD[0], GOLD[1], GOLD[2], 240);
    for (let i = 0; i < 4; i++) {
      push();
      rotate((Math.PI / 2) * i);
      triangle(0, -4, 15, 0, 0, 4);
      pop();
    }
    fill(LIGHT[0], LIGHT[1], LIGHT[2], 245);
    circle(0, 0, 8);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.size + 20) * 2);
  }
}


/**
 * The cross: two bars square to the shot, and everything standing on either.
 *
 * It resolves on the frame it appears — the picture then plays out over its own
 * lifetime — so nothing can walk out of a detonation that has already happened.
 */
export class Lucian_W_Cross extends SpellObject {
  lifeTime = 320;
  age = 0;
  readonly heading: number;
  readonly atX: number;
  readonly atY: number;
  readonly struck: { x: number; y: number }[] = [];

  constructor(owner: AttackableUnit, atX: number, atY: number, heading: number) {
    super(owner);
    this.position = createVector(atX, atY);
    this.atX = atX;
    this.atY = atY;
    this.heading = heading;
  }

  onAdded(): void {
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.atX, y: this.atY, r: W_CROSS_ARM + W_CROSS_HALF_WIDTH }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const hit = new Set<AttackableUnit>();
    for (const victim of candidates) {
      if (hit.has(victim)) continue;
      const body = victim.collisionRadius || 0;
      if (!this.onEitherArm(victim.position.x, victim.position.y, body)) continue;

      hit.add(victim);
      victim.takeDamage(W_DAMAGE, this.owner, 'MAGIC');
      const mark = new Lucian_W_Mark(W_MARK_MS, this.owner, victim);
      mark.image = api.asset('spell_lucian_w');
      victim.addBuff(mark);
      this.struck.push({ x: victim.position.x, y: victim.position.y });
    }
  }

  /** Either bar of the cross, each a corridor through the detonation point. */
  onEitherArm(px: number, py: number, body: number): boolean {
    for (const spin of [this.heading, this.heading + Math.PI / 2]) {
      const aX = this.atX - Math.cos(spin) * W_CROSS_ARM;
      const aY = this.atY - Math.sin(spin) * W_CROSS_ARM;
      const bX = this.atX + Math.cos(spin) * W_CROSS_ARM;
      const bY = this.atY + Math.sin(spin) * W_CROSS_ARM;
      if (distanceToSegment(px, py, aX, aY, bX, bY) <= W_CROSS_HALF_WIDTH + body) return true;
    }
    return false;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const out = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;
    const arm = W_CROSS_ARM * out;

    push();
    translate(this.atX, this.atY);
    rotate(this.heading);
    rectMode(CENTER);
    noStroke();
    for (let i = 0; i < 2; i++) {
      push();
      rotate((Math.PI / 2) * i);
      fill(DARK[0], DARK[1], DARK[2], 150 * fade);
      rect(0, 0, arm * 2, W_CROSS_HALF_WIDTH * 2);
      fill(GOLD[0], GOLD[1], GOLD[2], 200 * fade);
      rect(0, 0, arm * 2, W_CROSS_HALF_WIDTH);
      fill(LIGHT[0], LIGHT[1], LIGHT[2], 235 * fade);
      rect(0, 0, arm * 2, 6);
      pop();
    }
    pop();

    push();
    for (const mark of this.struck) {
      noFill();
      stroke(GOLD[0], GOLD[1], GOLD[2], 235 * fade);
      strokeWeight(3);
      // A square, not a circle: a *mark* on a body, so it cannot be mistaken
      // for one of the many rings this game already draws.
      rectMode(CENTER);
      rect(mark.x, mark.y, 26, 26);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((W_CROSS_ARM + W_CROSS_HALF_WIDTH + 40) * 2);
  }
}
