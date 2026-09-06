import type { AttackableUnit, Buff, OnHitEvent } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { secs } from '../text';

const BaseBuff = api.buffs.Buff;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const dmg = api.text.dmg;


export const W_BONUS_DAMAGE = 20;

/** `docs/abilities/jax/w.json`: the next attack "within 10 seconds", halved with the rest. */
export const W_WINDOW_MS = 5_000;

export const W_MANA = 25;


const LAMP: [number, number, number] = [240, 196, 92];

const IRON: [number, number, number] = [66, 74, 88];


/**
 * The charge in the lamp, spent by the next blow.
 *
 * Its `onHit` covers the basic attack; `Jax_Q` calls `spendEmpower` by hand for
 * the leap, because a leap is not a swing and never reaches `onHit`. Both go
 * through the same function, so the two paths cannot disagree about what a
 * charge is worth or whether it was spent.
 */
export class Jax_W_Charge extends BaseBuff {
  name = 'Vận Sức';
  stackId = 'jax_w';
  description = `Đòn kế tiếp gây thêm ${W_BONUS_DAMAGE} sát thương phép.`;

  onHit(hit: OnHitEvent): void {
    // A phantom swing is the same blow arriving twice: spending the charge on
    // it would give the ability away for free.
    if (hit.echo) return;
    spendEmpower(this.targetUnit, hit.victim);
  }
}


/** The live charge on `unit`, if there is one. */
export function empowerOn(unit: AttackableUnit): Jax_W_Charge | undefined {
  for (const buff of unit.buffs as Buff[]) {
    if (buff instanceof Jax_W_Charge && !buff.toRemove) return buff;
  }
  return undefined;
}


/**
 * Spend the charge on `victim`, if there is one. Answers whether it went off,
 * so a caller that wants to know can ask rather than re-deriving it.
 */
export function spendEmpower(jax: AttackableUnit, victim: AttackableUnit): boolean {
  const charge = empowerOn(jax);
  if (!charge || victim.isDead) return false;

  charge.deactivateBuff();
  victim.takeDamage(W_BONUS_DAMAGE, jax, 'MAGIC');
  victim.game.objectManager.addObject(
    new Jax_W_Flare(jax, victim.position.x, victim.position.y)
  );
  return true;
}


export default class Jax_W extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Buff;

  targetingMode = 'SELF' as const;
  image = api.asset('spell_jax_w');
  name = 'Vận Sức (Jax_W)';
  description =
    `Nạp năng lượng vào cây đèn: đòn <span class="buff">đánh thường hoặc Nhảy Và Nện</span> ` +
    `kế tiếp trong <span class="time">${secs(W_WINDOW_MS)} giây</span> gây thêm ` +
    `${dmg(W_BONUS_DAMAGE, 'MAGIC')}.`;
  coolDown = 5_000;
  manaCost = W_MANA;

  onSpellCast(): void {
    const charge = new Jax_W_Charge(W_WINDOW_MS, this.owner, this.owner);
    charge.image = this.image;
    this.owner.addBuff(charge);
    this.game.objectManager.addObject(new Jax_W_Glow(this.owner));
  }
}


/** The lamp lit and waiting: a hard ring on him while the charge stands. */
export class Jax_W_Glow extends SpellObject {
  age = 0;

  constructor(owner: AttackableUnit) {
    super(owner);
    this.position = owner.position.copy();
  }

  update(): void {
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    // The buff is the clock: whatever spends the charge takes the picture with it.
    if (this.age >= W_WINDOW_MS || !empowerOn(this.owner) || this.owner.isDead) {
      this.toRemove = true;
    }
  }

  draw(): void {
    const radius = (this.owner.animatedValues?.displaySize ?? 40) * 0.7;

    push();
    translate(this.position.x, this.position.y);
    // Three plates on a fixed ring, so the charge reads as *held* rather than
    // as an aura. No blur anywhere: it is metal, lit.
    noStroke();
    for (let i = 0; i < 3; i++) {
      const spin = (Math.PI * 2 * i) / 3 + this.age * 0.003;
      push();
      rotate(spin);
      fill(IRON[0], IRON[1], IRON[2], 235);
      rectMode(CENTER);
      rect(radius, 0, 12, 7, 2);
      fill(LAMP[0], LAMP[1], LAMP[2], 245);
      rect(radius, 0, 6, 4, 1);
      pop();
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(140);
  }
}


/** The charge going off on a body: a hard four-pointed flash. */
export class Jax_W_Flare extends SpellObject {
  lifeTime = 220;
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
    const out = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    translate(this.position.x, this.position.y);
    noStroke();
    fill(LAMP[0], LAMP[1], LAMP[2], 235 * fade);
    for (let i = 0; i < 4; i++) {
      push();
      rotate((Math.PI / 2) * i + Math.PI / 4);
      const reach = 34 * out;
      triangle(0, -6, reach, 0, 0, 6);
      pop();
    }
    fill(255, 246, 214, 240 * fade);
    circle(0, 0, 14 * (1 - 0.5 * t));
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(120);
  }
}
