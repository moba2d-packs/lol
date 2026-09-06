import type { AttackableUnit } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const VectorUtils = api.utils.VectorUtils;
const Spell = api.Spell;
const MissileSpellObject = api.MissileSpellObject;
const SpellObject = api.SpellObject;
const Slow = api.buffs.Slow;
const BuffAddType = api.enums.BuffAddType;
const TrailSystem = api.helpers.TrailSystem;
const Champion = api.units.Champion;
const Monster = api.units.Monster;

const SOURCE_LABEL = 'Cưa Nhiễm Trùng';

const Q_ICON = api.asset('spell_drmundo_q');
const tint = api.text.tint;
const dmgValue = api.text.dmgValue;

/** Rust-and-toxin palette, shared by the blade, its trail and its impact. */
const RUST: [number, number, number] = [138, 94, 58];
const TOXIN: [number, number, number] = [122, 214, 68];

export const COOLDOWN_MS = 6_000;

/** Paid in health, not mana — Dr. Mundo has no mana bar in the source kit. */
export const HEALTH_COST = 10;

/** Below this fraction of max health the cast is refused, exactly like Soraka_W. */
export const MIN_HEALTH_RATIO = 0.12;

export const RANGE = 520;

export const MISSILE_SPEED = 14;

export const MISSILE_SIZE = 30;

/** `docs/abilities/drmundo/q.json` scales magic damage off the target's *current* health. */
export const DAMAGE_PERCENT_CURRENT_HEALTH = 0.22;

/** Floor so the percentage never whiffs against a target already low. */
export const MIN_DAMAGE = 16;

/**
 * The record caps this ability against monsters rather than letting the
 * percentage read off whatever health a jungle camp happens to have — a boss
 * with a health pool sized for a five-minute fight would otherwise lose a
 * quarter of it to one thrown saw blade.
 */
export const MONSTER_DAMAGE_CAP = 30;

export const SLOW_PERCENT = 0.4;

export const SLOW_MS = 2_000;

/** Health refunded on a hit that only found a minion or a turret. */
export const HEAL_RATIO = 0.5;

/** The record's own bonus: full refund against a champion or a monster. */
export const CHAMPION_HEAL_RATIO = 1.0;

/**
 * Infected Bonesaw.
 *
 * The one departure from `docs/abilities/drmundo/q.json` that matters: the
 * record's "cost" column is health, not mana — Dr. Mundo has no mana bar in
 * the source game at all. Every spell in this kit sets `manaCost = 0` for
 * that reason, and this one bills `healthCost` instead, the same seam
 * `Soraka_W` pays its cast through. `checkCastCondition` adds the floor
 * Soraka's does too: the base class already refuses a cast Mundo cannot
 * afford, but a spell that is *supposed* to be spammed for value needs a
 * second line so "afford" does not mean "down to one point of health".
 *
 * The heal-on-hit is what makes this ability the one the shop's Vết Thương
 * Sâu items are supposed to answer: it is the smallest, most frequent piece
 * of Mundo's sustain, landing on cooldown rather than once every ninety
 * seconds like his ultimate.
 */
export default class DrMundo_Q extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_drmundo_q');
  name = 'Cưa Nhiễm Khuẩn (DrMundo_Q)';
  description =
    `Ném một lưỡi cưa nhiễm trùng, gây ${tint(`${pct(DAMAGE_PERCENT_CURRENT_HEALTH)}% máu hiện tại`, 'MAGIC')} ` +
    `của mục tiêu (tối thiểu ${dmgValue(MIN_DAMAGE, 'MAGIC')}, giới hạn ` +
    `${dmgValue(MONSTER_DAMAGE_CAP, 'MAGIC')} lên quái rừng) làm ${tint('sát thương phép', 'MAGIC')} ` +
    `cho kẻ địch đầu tiên trúng chiêu và <span class="buff">Làm Chậm ${pct(SLOW_PERCENT)}%</span> trong ` +
    `<span class="time">${secs(SLOW_MS)} giây</span>. Trúng đích hồi lại cho Mundo một phần lượng máu đã trả: ` +
    `${pct(HEAL_RATIO)}% máu đã trả (${pct(CHAMPION_HEAL_RATIO)}% nếu trúng tướng địch hoặc quái rừng).`;
  coolDown = COOLDOWN_MS;
  manaCost = 0;
  healthCost = HEALTH_COST;

  range = RANGE;

  checkCastCondition(): boolean {
    return this.hasHealthToSpare;
  }

  onSpellCast(): void {
    const angle = VectorUtils.getAngle(this.owner.position, this.aimPoint);
    const { from, to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);

    const saw = new DrMundo_Q_Bonesaw(this.owner);
    saw.position = from;
    saw.destination = to;
    saw.direction = p5.Vector.fromAngle(angle);
    this.game.objectManager.addObject(saw);
  }

  /** Same shape as Soraka_W's own floor: afford the cast, but never to the bone. */
  private get hasHealthToSpare(): boolean {
    const max = this.owner.stats.maxHealth.value;
    if (max <= 0) return false;
    return this.owner.stats.health.value > max * MIN_HEALTH_RATIO + this.healthCost;
  }
}

/**
 * The blade itself: a rusty circular saw, spinning fast enough that its teeth
 * blur, trailing a toxic green vapour that is the one thing shared with the
 * chemical motif running through the rest of the kit.
 */
export class DrMundo_Q_Bonesaw extends MissileSpellObject {
  speed = MISSILE_SPEED;
  size = MISSILE_SIZE;
  maxHitCount = 1;

  /** Facing, set once at launch — the blade does not re-aim mid-flight. */
  direction: p5.Vector = createVector(1, 0);

  trailSystem = new TrailSystem({
    maxLength: 10,
    trailSize: this.size * 0.6,
    trailColor: '#7AD64466',
  });

  onHit(enemy: AttackableUnit): void {
    const isChampion = enemy instanceof Champion;
    const isMonster = enemy instanceof Monster;

    const uncapped = Math.max(MIN_DAMAGE, enemy.stats.health.value * DAMAGE_PERCENT_CURRENT_HEALTH);
    const damage = isMonster ? Math.min(uncapped, MONSTER_DAMAGE_CAP) : uncapped;
    enemy.takeDamage(damage, this.owner, 'MAGIC', SOURCE_LABEL);

    const slow = new Slow(SLOW_MS, this.owner, enemy);
    slow.percent = SLOW_PERCENT;
    slow.image = Q_ICON;
    // A re-thrown saw must reset the clock, not stack ten deep — the trap
    // every slow in this pack has to guard against.
    slow.buffAddType = BuffAddType.RENEW_EXISTING;
    enemy.addBuff(slow);

    const healRatio = isChampion || isMonster ? CHAMPION_HEAL_RATIO : HEAL_RATIO;
    this.owner.takeHeal(HEALTH_COST * healRatio, this.owner);

    this.game.objectManager.addObject(new DrMundo_Q_Impact(this.owner, enemy.position.copy()));
  }

  draw(): void {
    push();
    translate(this.position.x, this.position.y);
    rotate(this.direction.heading());

    // vapour peeling off the spin, drawn behind the blade
    noStroke();
    for (let i = 0; i < 3; i++) {
      const phase = frameCount / 5 + i * 2;
      fill(TOXIN[0], TOXIN[1], TOXIN[2], 70 - i * 18);
      circle(-this.size * 0.3 - i * 6, sin(phase) * 3, this.size * 0.35 - i * 3);
    }

    // the disc, spun fast enough that individual teeth blur into a rim
    const spin = frameCount * 0.9;
    push();
    rotate(spin);
    stroke(50, 32, 20, 230);
    strokeWeight(4);
    fill(RUST[0], RUST[1], RUST[2], 235);
    circle(0, 0, this.size);
    noFill();
    stroke(230, 225, 210, 200);
    strokeWeight(2);
    const teeth = 10;
    for (let i = 0; i < teeth; i++) {
      const a = (TWO_PI * i) / teeth;
      const r0 = this.size * 0.35;
      const r1 = this.size * 0.52;
      line(cos(a) * r0, sin(a) * r0, cos(a) * r1, sin(a) * r1);
    }
    pop();

    // a short handle trailing behind — what makes this read as a tool, not a coin
    stroke(60, 42, 26, 220);
    strokeWeight(6);
    line(-this.size * 0.5, 0, -this.size * 0.9, 0);

    // toxic drip off the leading tooth
    noStroke();
    fill(TOXIN[0], TOXIN[1], TOXIN[2], 200);
    circle(this.size * 0.4, 0, 5);

    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.size / 2 + 34) * 2);
  }
}

/** Where the saw actually landed — a toxic burst plus the frost-analogue for a slow. */
export class DrMundo_Q_Impact extends SpellObject {
  lifeTime = 340;
  age = 0;
  radius = 46;
  private shards: { angle: number; length: number }[] = [];

  constructor(owner: AttackableUnit, at: p5.Vector) {
    super(owner);
    this.position = at;
  }

  onAdded(): void {
    for (let i = 0; i < 7; i++) {
      this.shards.push({ angle: random(0, TWO_PI), length: random(0.6, 1) });
    }
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const grown = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    translate(this.position.x, this.position.y);

    // the slow, drawn as a ring closing in — motion agrees with a debuff that holds
    noFill();
    stroke(TOXIN[0], TOXIN[1], TOXIN[2], 220 * fade);
    strokeWeight(4 * fade + 1);
    circle(0, 0, this.radius * 2 * (1.3 - 0.3 * grown));

    // torn metal shards, thrown outward once, on the victim
    stroke(RUST[0], RUST[1], RUST[2], 230 * fade);
    strokeWeight(2.5);
    for (const shard of this.shards) {
      const reach = this.radius * shard.length * grown;
      line(0, 0, cos(shard.angle) * reach, sin(shard.angle) * reach);
    }

    // a spatter of infection left where the blade bit in
    noStroke();
    fill(TOXIN[0], TOXIN[1], TOXIN[2], 160 * fade);
    circle(0, 0, this.radius * 0.6 * grown);

    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 30) * 2);
  }
}
