import type { AttackableUnit, Buff, OnHitEvent } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const BuffAddType = api.enums.BuffAddType;
const BaseBuff = api.buffs.Buff;
const Slow = api.buffs.Slow;
const Stun = api.buffs.Stun;
const Spell = api.Spell;
const SpellObject = api.SpellObject;
const MissileSpellObject = api.MissileSpellObject;
const dmg = api.text.dmg;


export const Q_DAMAGE = 16;

export const Q_SLOW_PERCENT = 0.6;

export const Q_SLOW_MS = 1_500;

export const Q_RANGE = 340;

export const Q_SPEED = 17;

export const Q_MANA = 40;


/* --------------------------------------------------------- Concussive Blows

   The passive lives here rather than in a slot of its own, because everything
   that *applies* it is this ability: the ice, and Braum's own swing. Four
   stacks and the target is stunned.
   -------------------------------------------------------------------------- */

export const CONCUSSION_STACK_ID = 'braum_concussion';

/** `docs/abilities/braum/i.json`: four stacks, and the fourth consumes them all. */
export const CONCUSSION_TO_STUN = 4;

export const CONCUSSION_WINDOW_MS = 4_000;

export const CONCUSSION_DAMAGE = 18;

export const CONCUSSION_STUN_MS = 1_000;

/**
 * How long the target is immune to a second stunning, so a four-stack combo
 * cannot simply be run again into the same body.
 */
export const CONCUSSION_IMMUNE_MS = 4_000;


const ICE: [number, number, number] = [126, 206, 235];

const DEEP: [number, number, number] = [24, 62, 96];

const STEEL: [number, number, number] = [188, 196, 205];


/**
 * The bruise Braum leaves. A bare `Buff` because it grants no stat and sets no
 * status flag — it is a *counter*, and the count is the whole tooltip.
 */
export class Braum_Q_Concussion extends BaseBuff {
  /**
   * The count rides on the name as `xN` rather than as `(N)`.
   *
   * `scripts/wiki/sync-spell-names.mjs` rewrites the first
   * `name = '<something> (<tag>)';` line it finds in a spell file, expecting the
   * parenthetical to be the debug slug — so a buff whose name ends in `(1)`
   * gets the *champion ability's* Vietnamese name written into it, and the real
   * spell below is left alone because the regex only takes the first match.
   * That happened once, on this exact class.
   */
  name = 'Đánh Ngất Ngư x1';
  stackId = CONCUSSION_STACK_ID;
  buffAddType = BuffAddType.RENEW_EXISTING;
  description = `Bị Braum đánh dấu. Đủ ${CONCUSSION_TO_STUN} dấu sẽ nổ ra và gây choáng.`;
  /** How many blows have landed. The fourth is what pays out. */
  count = 1;
}


/** True while this body has just been stunned and may not be again yet. */
export class Braum_Q_Immune extends BaseBuff {
  name = 'Vừa Bị Choáng';
  stackId = 'braum_concussion_immune';
  buffAddType = BuffAddType.RENEW_EXISTING;
  hudVisible = false;
  description = 'Vừa trúng Đánh Ngất Ngư — tạm thời không thể bị choáng lần nữa.';
}


const liveBuff = <T>(unit: AttackableUnit, Kind: new (...args: never[]) => T): T | undefined => {
  for (const buff of unit.buffs as Buff[]) {
    if (!buff.toRemove && buff instanceof (Kind as never)) return buff as T;
  }
  return undefined;
};


/** How many blows `unit` is carrying. Exported so a test reads the count, not a buff. */
export function concussionStacks(unit: AttackableUnit): number {
  return liveBuff(unit, Braum_Q_Concussion)?.count ?? 0;
}


/**
 * One more blow on `victim`, and the stun if that was the fourth.
 *
 * The count lives on one buff rather than on four overlapping ones, so the
 * victim wears a single row that says how close they are — which is the entire
 * information this passive exists to broadcast.
 */
export function applyConcussion(source: AttackableUnit, victim: AttackableUnit): void {
  if (victim.isDead) return;

  const existing = liveBuff(victim, Braum_Q_Concussion);
  if (!existing) {
    victim.addBuff(new Braum_Q_Concussion(CONCUSSION_WINDOW_MS, source, victim));
    return;
  }

  existing.count += 1;
  existing.name = `Đánh Ngất Ngư x${existing.count}`;
  existing.renewBuff();
  if (existing.count < CONCUSSION_TO_STUN) return;

  // The payout consumes the stacks whether or not the stun lands, so a body
  // inside its immunity window still has to be built up again from nothing.
  existing.deactivateBuff();
  if (liveBuff(victim, Braum_Q_Immune)) return;

  victim.takeDamage(CONCUSSION_DAMAGE, source, 'MAGIC');
  victim.addBuff(new Stun(CONCUSSION_STUN_MS, source, victim));
  victim.addBuff(new Braum_Q_Immune(CONCUSSION_IMMUNE_MS, source, victim));
  victim.game.objectManager.addObject(new Braum_Q_Shatter(source, victim.position.x, victim.position.y));
}


/** Braum's own swing counts, which is what makes Winter's Bite a setup rather than a poke. */
export class Braum_Q_Passive extends BaseBuff {
  name = 'Đánh Ngất Ngư';
  stackId = 'braum_q_passive';
  hudVisible = false;
  description = 'Đòn đánh thường của Braum cộng một dấu Đánh Ngất Ngư.';

  onHit(hit: OnHitEvent): void {
    // A phantom swing is the same blow arriving twice: counting it would halve
    // the number of real hits the stun needs.
    if (hit.echo) return;
    applyConcussion(this.targetUnit, hit.victim);
  }
}


export default class Braum_Q extends Spell {
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Cc;

  targetingMode = 'DIRECTION' as const;
  image = api.asset('spell_braum_q');
  name = 'Tuyết Tê Tái (Braum_Q)';
  description =
    `Đẩy một khối băng thẳng về phía trước, gây ${dmg(Q_DAMAGE, 'MAGIC')} cho kẻ địch đầu tiên ` +
    `và <span class="buff">Làm Chậm ${pct(Q_SLOW_PERCENT)}%</span> trong ` +
    `<span class="time">${secs(Q_SLOW_MS)} giây</span>. ` +
    `Nội tại: băng và đòn đánh thường của Braum đều cộng một dấu ` +
    `<span class="buff">Đánh Ngất Ngư</span>; ` +
    `dấu thứ ${CONCUSSION_TO_STUN} gây ${dmg(CONCUSSION_DAMAGE, 'MAGIC')} và ` +
    `<span class="buff">Choáng</span> <span class="time">${secs(CONCUSSION_STUN_MS)} giây</span>.`;
  coolDown = 7_000;
  manaCost = Q_MANA;
  range = Q_RANGE;

  onUpdate(): void {
    if (!this.owner || this.owner.isDead) return;
    if (this.owner.hasBuff(Braum_Q_Passive)) return;
    this.owner.addBuff(new Braum_Q_Passive(Infinity, this.owner, this.owner));
  }

  onSpellCast(): void {
    const { to } = api.utils.VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      api.combat.Reach.effectiveRange(Q_RANGE, this.owner)
    );

    const ice = new Braum_Q_Ice(this.owner);
    ice.destination = to;
    this.game.objectManager.addObject(ice);
  }

  drawPreview(): void {
    super.drawPreview(api.combat.Reach.effectiveRange(this.range, this.owner));
  }
}


/** The shard off his shield: one body, then it is spent. */
export class Braum_Q_Ice extends MissileSpellObject {
  speed = Q_SPEED;
  size = 26;
  maxHitCount = 1;

  onHit(victim: AttackableUnit): void {
    victim.takeDamage(Q_DAMAGE, this.owner, 'MAGIC');

    // `RENEW_EXISTING`: `Slow`'s default stacks ten deep, and a 60% slow
    // stacked twice is a standstill.
    const slow = new Slow(Q_SLOW_MS, this.owner, victim);
    slow.buffAddType = BuffAddType.RENEW_EXISTING;
    slow.percent = Q_SLOW_PERCENT;
    victim.addBuff(slow);

    applyConcussion(this.owner, victim);
  }

  draw(): void {
    const heading = Math.atan2(
      this.destination.y - this.position.y,
      this.destination.x - this.position.x
    );
    push();
    translate(this.position.x, this.position.y);
    rotate(heading);
    noStroke();
    // A shard, not a ball: three flat plates of ice with hard edges.
    fill(DEEP[0], DEEP[1], DEEP[2], 235);
    quad(-16, 0, 0, -13, 18, 0, 0, 13);
    fill(ICE[0], ICE[1], ICE[2], 235);
    quad(-8, 0, 2, -7, 14, 0, 2, 7);
    fill(255, 255, 255, 220);
    triangle(4, 0, 14, -2, 14, 2);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.size + 20) * 2);
  }
}


/** The fourth blow going off: a hard star of cracks, and a ring on the body. */
export class Braum_Q_Shatter extends SpellObject {
  lifeTime = 340;
  age = 0;
  /** Seeded once — `random()` inside `draw` flickers instead of animating. */
  cracks: number[] = [];

  constructor(owner: AttackableUnit, atX: number, atY: number) {
    super(owner);
    this.position = createVector(atX, atY);
  }

  onAdded(): void {
    for (let i = 0; i < 7; i++) this.cracks.push(random(0.6, 1));
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = Math.min(1, this.age / this.lifeTime);
    const out = 1 - (1 - t) * (1 - t);
    const fade = 1 - t * t;

    push();
    translate(this.position.x, this.position.y);
    noFill();
    stroke(DEEP[0], DEEP[1], DEEP[2], 235 * fade);
    strokeWeight(6);
    circle(0, 0, 54 * out);
    stroke(ICE[0], ICE[1], ICE[2], 240 * fade);
    strokeWeight(3);
    circle(0, 0, 54 * out);

    strokeWeight(4);
    for (let i = 0; i < this.cracks.length; i++) {
      const heading = (Math.PI * 2 * i) / this.cracks.length;
      const reach = 44 * this.cracks[i] * out;
      stroke(STEEL[0], STEEL[1], STEEL[2], 235 * fade);
      line(0, 0, Math.cos(heading) * reach, Math.sin(heading) * reach);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(160);
  }
}
