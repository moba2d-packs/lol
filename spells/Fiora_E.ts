import type { AttackableUnit, OnHitEvent } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const BuffAddType = api.enums.BuffAddType;
const Slow = api.buffs.Slow;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const StatAmp = api.buffs.StatAmp;
const dmg = api.text.dmg;


/** `docs/abilities/fiora/e.json`: the *next two* swings, and they differ. */
export const E_SWINGS = 2;

export const E_WINDOW_MS = 4_000;

export const E_ATTACK_SPEED = 0.6;

export const E_SLOW_PERCENT = 0.3;

export const E_SLOW_MS = 1_000;

/**
 * What the second swing adds.
 *
 * The record calls it a critical strike with modified damage; this pack has a
 * `critChance` stat but no way to *force* one swing to crit, so the second
 * blow carries the difference as flat bonus damage instead. Same shape — the
 * first swing slows, the second hurts — stated in the one currency the engine
 * actually has here.
 */
export const E_SECOND_BONUS = 18;

export const E_MANA = 35;


const STEEL: [number, number, number] = [214, 220, 230];

const ROSE: [number, number, number] = [216, 88, 122];

const DUSK: [number, number, number] = [38, 30, 46];


/**
 * Two swings, and they are not the same swing.
 *
 * A `StatAmp` rather than a bare `Buff` so the attack-speed half is core's
 * (and describes itself); the two-swing bookkeeping rides on top.
 */
export class Fiora_E_Bladework extends StatAmp {
  name = 'Nhất Kiếm Nhị Dụng';
  stackId = 'fiora_e';
  bonuses = { attackSpeed: { percentBaseBonus: E_ATTACK_SPEED } };
  /** How many of the two are left. The HUD badge under the icon reads this. */
  swingsLeft = E_SWINGS;

  onHit(hit: OnHitEvent): void {
    // A phantom swing is the same blow arriving twice: spending one of the two
    // on it would halve the ability.
    if (hit.echo) return;
    if (this.swingsLeft <= 0) return;

    const first = this.swingsLeft === E_SWINGS;
    this.swingsLeft -= 1;

    if (first) {
      // `RENEW_EXISTING`: `Slow`'s default stacks ten deep, and two Fioras or
      // two casts on one body would otherwise root it.
      const slow = new Slow(E_SLOW_MS, this.sourceUnit, hit.victim);
      slow.buffAddType = BuffAddType.RENEW_EXISTING;
      slow.percent = E_SLOW_PERCENT;
      hit.victim.addBuff(slow);
    } else {
      hit.victim.takeDamage(E_SECOND_BONUS, this.sourceUnit, 'PHYSICAL');
    }

    this.targetUnit.game.objectManager.addObject(
      new Fiora_E_Flourish(this.targetUnit, hit.victim.position.x, hit.victim.position.y, !first)
    );

    // Spent: the buff is the two swings, not four seconds of attack speed.
    if (this.swingsLeft <= 0) this.deactivateBuff();
  }
}


export default class Fiora_E extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Buff;

  targetingMode = 'SELF' as const;
  image = api.asset('spell_fiora_e');
  name = 'Nhất Kiếm Nhị Dụng (Fiora_E)';
  description =
    `<span class="buff">+${pct(E_ATTACK_SPEED)}% tốc đánh</span> và tiếp thêm sức cho ` +
    `<span>${E_SWINGS}</span> đòn đánh thường kế tiếp trong ` +
    `<span class="time">${secs(E_WINDOW_MS)} giây</span>: đòn đầu ` +
    `<span class="buff">Làm Chậm ${pct(E_SLOW_PERCENT)}%</span> trong ` +
    `<span class="time">${secs(E_SLOW_MS)} giây</span>, đòn thứ hai gây thêm ` +
    `${dmg(E_SECOND_BONUS, 'PHYSICAL')}.`;
  coolDown = 8_000;
  manaCost = E_MANA;

  get stackCount(): number {
    return this.liveBladework()?.swingsLeft ?? 0;
  }

  private liveBladework(): Fiora_E_Bladework | undefined {
    for (const buff of this.owner?.buffs ?? []) {
      if (buff instanceof Fiora_E_Bladework && !buff.toRemove) return buff;
    }
    return undefined;
  }

  onSpellCast(): void {
    const work = new Fiora_E_Bladework(E_WINDOW_MS, this.owner, this.owner);
    work.image = this.image;
    this.owner.addBuff(work);
  }
}


/** One of the two blows landing: a flat cross-cut, doubled for the second. */
export class Fiora_E_Flourish extends SpellObject {
  lifeTime = 200;
  age = 0;
  readonly heavy: boolean;

  constructor(owner: AttackableUnit, atX: number, atY: number, heavy: boolean) {
    super(owner);
    this.position = createVector(atX, atY);
    this.heavy = heavy;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const cut = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;
    const reach = (this.heavy ? 30 : 18) * (0.4 + 0.6 * cut);
    const [r, g, b] = this.heavy ? ROSE : STEEL;

    push();
    translate(this.position.x, this.position.y);
    stroke(DUSK[0], DUSK[1], DUSK[2], 200 * fade);
    strokeWeight(this.heavy ? 8 : 5);
    line(-reach, -reach, reach, reach);
    if (this.heavy) line(-reach, reach, reach, -reach);
    stroke(r, g, b, 245 * fade);
    strokeWeight(this.heavy ? 4 : 3);
    line(-reach, -reach, reach, reach);
    if (this.heavy) line(-reach, reach, reach, -reach);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(140);
  }
}
