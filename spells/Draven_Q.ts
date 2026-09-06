import type { AttackableUnit, OnHitEvent, Spell as SpellType } from '@moba2d/core/content/types';
import Draven_W from './Draven_W';
import { api } from '../packApi';
import { secs } from '../text';

const BaseBuff = api.buffs.Buff;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const dmg = api.text.dmg;


export const Q_BONUS_DAMAGE = 14;

/** `docs/abilities/draven/q.json`: "Draven can hold up to two Spinning Axes at once." */
export const Q_MAX_AXES = 2;

/** How long a spun axe stays armed if he never swings. */
export const Q_ARM_MS = 5_800;

/** How long the ricochet takes to come down. The record says roughly 1.4s. */
export const Q_CATCH_DELAY_MS = 1_400;

/** How close he has to be standing when it lands. */
export const Q_CATCH_RADIUS = 60;

/**
 * How far ahead of him it lands, along the way he is walking.
 *
 * The record puts the landing spot where his *current movement* is taking him,
 * which is the whole ability: catching is a decision about where to stand,
 * made a second and a half before the axe gets there.
 */
export const Q_THROW_AHEAD = 120;

export const Q_MANA = 30;


const BLOOD: [number, number, number] = [178, 34, 34];

const GOLD: [number, number, number] = [230, 184, 76];

const DARK: [number, number, number] = [40, 18, 18];


/**
 * The axe in his hand, as a buff, because the thing it changes is what his
 * **basic attack** does — and `Buff.onHit` is the seam that sees a swing land.
 *
 * The count itself lives on the spell rather than here, so the HUD badge under
 * the Q icon is the honest number and one buff row stands for however many
 * axes he is juggling.
 */
export class Draven_Q_Hand extends BaseBuff {
  name = 'Rìu Xoay';
  stackId = 'draven_q_hand';
  description = `Đòn đánh thường tiếp theo gây thêm ${Q_BONUS_DAMAGE} sát thương và rìu văng ra để bắt lại.`;
  /** The ability that is counting the axes. */
  spell: Draven_Q | null = null;

  onHit(hit: OnHitEvent): void {
    // A phantom swing is the same blow arriving twice: spending an axe on it
    // would halve how many real swings one cast is worth.
    if (hit.echo) return;
    this.spell?.spendAxe(hit.victim);
  }
}


export default class Draven_Q extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Buff;

  targetingMode = 'SELF' as const;
  image = api.asset('spell_draven_q');
  name = 'Rìu Xoay (Draven_Q)';
  description =
    `Bắt đầu xoay rìu: đòn đánh thường kế tiếp gây thêm ${dmg(Q_BONUS_DAMAGE, 'PHYSICAL')}, ` +
    `rồi rìu văng ra và rơi xuống sau <span class="time">${secs(Q_CATCH_DELAY_MS)} giây</span> ` +
    `theo hướng Draven đang chạy. <span class="buff">Bắt được</span> rìu thì lấy lại lượt đánh ` +
    `đó và <span class="buff">hoàn lại Xung Huyết</span>. Cầm tối đa ` +
    `<span>${Q_MAX_AXES}</span> rìu cùng lúc.`;
  coolDown = 8_000;
  manaCost = Q_MANA;

  /** Axes in hand right now. The HUD badge under the icon is this number. */
  axes = 0;

  get stackCount(): number {
    return this.axes;
  }

  setStackCount(count: number): boolean {
    this.axes = Math.max(0, Math.min(Q_MAX_AXES, Math.floor(count)));
    this.syncHand();
    return true;
  }

  onSpellCast(): void {
    this.setStackCount(this.axes + 1);
  }

  onUpdate(): void {
    this.syncHand();
  }

  /** One buff row while he is holding anything, and none when his hands are empty. */
  private syncHand(): void {
    if (!this.owner || this.owner.isDead) return;
    const held = this.liveHand();
    if (this.axes > 0 && !held) {
      const hand = new Draven_Q_Hand(Q_ARM_MS, this.owner, this.owner);
      hand.spell = this;
      hand.image = this.image;
      this.owner.addBuff(hand);
      return;
    }
    if (this.axes <= 0 && held) held.deactivateBuff();
  }

  private liveHand(): Draven_Q_Hand | undefined {
    for (const buff of this.owner.buffs) {
      if (buff instanceof Draven_Q_Hand && !buff.toRemove) return buff;
    }
    return undefined;
  }

  /**
   * A swing landed while he was holding one: the bonus, and the ricochet.
   *
   * The bonus is dealt here rather than granted as `onHitDamage` because an axe
   * is spent per swing and `onHitDamage` is a stat that would apply to every
   * swing for as long as the buff stood.
   */
  spendAxe(victim: AttackableUnit): void {
    if (this.axes <= 0) return;
    this.setStackCount(this.axes - 1);
    victim.takeDamage(Q_BONUS_DAMAGE, this.owner, 'PHYSICAL');

    // Where he is *walking*, not where he is looking: the axe lands ahead of
    // his own movement, which is what makes catching a positional decision.
    const heading = this.walkingHeading();
    this.game.objectManager.addObject(
      new Draven_Q_Axe(
        this.owner,
        this.owner.position.x + Math.cos(heading) * Q_THROW_AHEAD,
        this.owner.position.y + Math.sin(heading) * Q_THROW_AHEAD,
        this
      )
    );
  }

  /** Which way he is moving, falling back to the way he last threw. */
  walkingHeading(): number {
    const destination = (this.owner as { destination?: { x: number; y: number } }).destination;
    const dx = (destination?.x ?? this.owner.position.x) - this.owner.position.x;
    const dy = (destination?.y ?? this.owner.position.y) - this.owner.position.y;
    if (dx === 0 && dy === 0) return 0;
    return Math.atan2(dy, dx);
  }

  /**
   * He was standing on it when it came down.
   *
   * Two payouts, and the second is the one that makes the ability a rhythm
   * rather than a resource: the axe comes back, **and** Blood Rush is off
   * cooldown, so a Draven who never drops one never stops moving.
   */
  catchAxe(): void {
    this.setStackCount(this.axes + 1);
    const spells = (this.owner as { spells?: SpellType[] }).spells;
    for (const spell of spells ?? []) {
      if (spell instanceof Draven_W) spell.resetCoolDown();
    }
  }
}


/**
 * The ricochet on its way down, and the circle he has to be standing in.
 *
 * Ground art: the catch circle is a place on the map and the champion trying to
 * reach it belongs drawn over it, not under it.
 */
export class Draven_Q_Axe extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  age = 0;
  /** True once it has landed, caught or not — a landing pays out exactly once. */
  landed = false;
  caught = false;
  readonly atX: number;
  readonly atY: number;
  private readonly spell: Draven_Q;

  constructor(owner: AttackableUnit, atX: number, atY: number, spell: Draven_Q) {
    super(owner);
    this.position = createVector(atX, atY);
    this.atX = atX;
    this.atY = atY;
    this.spell = spell;
  }

  /** Whether Draven is standing where it is about to come down. */
  get inReach(): boolean {
    return (
      Math.hypot(this.owner.position.x - this.atX, this.owner.position.y - this.atY) <=
      Q_CATCH_RADIUS
    );
  }

  update(): void {
    if (this.landed) {
      this.toRemove = true;
      return;
    }
    this.age += deltaTime;
    if (this.age < Q_CATCH_DELAY_MS) return;

    this.landed = true;
    // A corpse catches nothing, and the axe simply lies where it fell.
    if (this.owner.isDead || !this.inReach) return;
    this.caught = true;
    this.spell.catchAxe();
  }

  draw(): void {
    const falling = Math.min(1, this.age / Q_CATCH_DELAY_MS);
    const spin = this.age * 0.012;
    const waiting = this.inReach;

    push();
    // The circle to stand in, on exactly the radius the catch measures.
    noFill();
    stroke(DARK[0], DARK[1], DARK[2], 220);
    strokeWeight(5);
    circle(this.atX, this.atY, Q_CATCH_RADIUS * 2);
    stroke(waiting ? GOLD[0] : BLOOD[0], waiting ? GOLD[1] : BLOOD[1], waiting ? GOLD[2] : BLOOD[2], 240);
    strokeWeight(3);
    // …and the countdown drawn as how far round it has come.
    arc(
      this.atX,
      this.atY,
      Q_CATCH_RADIUS * 2,
      Q_CATCH_RADIUS * 2,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * falling
    );

    // The axe itself, still in the air: a flat double blade, turning.
    push();
    translate(this.atX, this.atY);
    rotate(spin);
    noStroke();
    for (const side of [-1, 1]) {
      fill(DARK[0], DARK[1], DARK[2], 235);
      triangle(0, 0, side * 22, -12, side * 22, 12);
      fill(GOLD[0], GOLD[1], GOLD[2], 235);
      triangle(side * 6, 0, side * 19, -7, side * 19, 7);
    }
    fill(BLOOD[0], BLOOD[1], BLOOD[2], 240);
    circle(0, 0, 9);
    pop();
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((Q_CATCH_RADIUS + 40) * 2);
  }
}
