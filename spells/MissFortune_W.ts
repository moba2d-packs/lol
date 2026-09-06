import type { AttackableUnit, Spell as SpellType } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const BaseBuff = api.buffs.Buff;
const Speedup = api.buffs.Speedup;
const StatAmp = api.buffs.StatAmp;
const Spell = api.Spell;
const SpellObject = api.SpellObject;


export const W_ATTACK_SPEED = 0.6;

export const W_ATTACK_SPEED_MS = 4_000;

/** The out-of-combat half: how long she has to be left alone, and what it pays. */
export const W_CALM_MS = 3_000;

export const W_MOVE_SPEED = 0.25;

/** What one new Love Tap takes off the cooldown. The record says two seconds. */
export const W_TAP_REFUND_MS = 2_000;

export const W_MANA = 40;


const CRIMSON: [number, number, number] = [206, 44, 62];

const GOLD: [number, number, number] = [232, 186, 96];


/**
 * A new Love Tap: take a slice off Strut.
 *
 * The rule lives here rather than in `MissFortune_Q` because it is *this*
 * ability's, and the Q file only reports that a new body was marked. It is a
 * no-op for a Miss Fortune who has not taken this ability at all.
 */
export function shortenStrut(mf: AttackableUnit): void {
  const spells = (mf as { spells?: SpellType[] }).spells;
  for (const spell of spells ?? []) {
    if (!(spell instanceof MissFortune_W)) continue;
    spell.currentCooldown = Math.max(0, spell.currentCooldown - W_TAP_REFUND_MS);
  }
}


/** The four seconds of shooting the active buys. */
export class MissFortune_W_Strut extends StatAmp {
  name = 'Sải Bước';
  stackId = 'missfortune_w';
  bonuses = { attackSpeed: { percentBaseBonus: W_ATTACK_SPEED } };
}


/**
 * The always-on half: she walks faster the longer nobody has touched her.
 *
 * `onDamageTaken` is the clock's reset, which is the honest reading of "without
 * taking damage" — it fires on her for every hit that lands, whatever dealt it,
 * so nothing has to enumerate the ways she can be hurt.
 */
export class MissFortune_W_Saunter extends BaseBuff {
  name = 'Sải Bước';
  stackId = 'missfortune_w_saunter';
  hudVisible = false;
  description = `Không bị đánh trong ${secs(W_CALM_MS)} giây thì Miss Fortune đi nhanh hơn.`;
  /** How long since anything last hurt her. */
  calmMs = 0;
  /** The speed she is currently being paid, so it comes off when she is hit. */
  private strolling: InstanceType<typeof Speedup> | null = null;

  get sauntering(): boolean {
    return this.calmMs >= W_CALM_MS;
  }

  onDamageTaken(): void {
    this.calmMs = 0;
    this.stopStrolling();
  }

  onUpdate(): void {
    if (this.targetUnit.isDead) {
      this.calmMs = 0;
      this.stopStrolling();
      return;
    }
    this.calmMs += deltaTime;
    if (!this.sauntering) return;
    // Re-hung rather than granted once, so a single hit takes it straight off
    // and the walk has to be earned again.
    if (this.strolling && !this.strolling.toRemove) {
      this.strolling.timeElapsed = 0;
      return;
    }
    const stroll = new Speedup(1_000, this.sourceUnit, this.targetUnit);
    stroll.stackId = 'missfortune_w_stroll';
    stroll.image = api.asset('spell_missfortune_w');
    stroll.percent = W_MOVE_SPEED;
    this.targetUnit.addBuff(stroll);
    this.strolling = stroll;
  }

  /** Idempotent: being hit twice in a frame must not double-remove anything. */
  private stopStrolling(): void {
    if (!this.strolling) return;
    if (!this.strolling.toRemove) this.strolling.deactivateBuff();
    this.strolling = null;
  }
}


export default class MissFortune_W extends Spell {
  static aiRoles = api.enums.SpellRole.Buff;

  targetingMode = 'SELF' as const;
  image = api.asset('spell_missfortune_w');
  name = 'Sải Bước (MissFortune_W)';
  description =
    `Nhận <span class="buff">+${pct(W_ATTACK_SPEED)}% tốc đánh</span> trong ` +
    `<span class="time">${secs(W_ATTACK_SPEED_MS)} giây</span>. ` +
    `Nội tại: không trúng đòn nào trong <span class="time">${secs(W_CALM_MS)} giây</span> thì ` +
    `cô nhận <span class="buff">+${pct(W_MOVE_SPEED)}% tốc chạy</span> cho tới khi bị đánh. ` +
    `Mỗi lần đánh dấu <span class="buff">Đánh Yêu</span> lên một mục tiêu mới rút ngắn hồi chiêu ` +
    `<span class="time">${secs(W_TAP_REFUND_MS)} giây</span>.`;
  coolDown = 9_000;
  manaCost = W_MANA;

  onUpdate(): void {
    if (!this.owner || this.owner.isDead) return;
    if (this.owner.hasBuff(MissFortune_W_Saunter)) return;
    this.owner.addBuff(new MissFortune_W_Saunter(Infinity, this.owner, this.owner));
  }

  onSpellCast(): void {
    const strut = new MissFortune_W_Strut(W_ATTACK_SPEED_MS, this.owner, this.owner);
    strut.image = this.image;
    this.owner.addBuff(strut);
    this.game.objectManager.addObject(new MissFortune_W_Flourish(this.owner));
  }
}


/** The moment she sets off: two hard chevrons sweeping back and gone. */
export class MissFortune_W_Flourish extends SpellObject {
  lifeTime = 300;
  age = 0;

  constructor(owner: AttackableUnit) {
    super(owner);
    this.position = owner.position.copy();
  }

  update(): void {
    this.position.set(this.owner.position.x, this.owner.position.y);
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
    for (let i = 0; i < 2; i++) {
      const grown = 26 + 26 * i + 32 * out;
      stroke(i === 0 ? GOLD[0] : CRIMSON[0], i === 0 ? GOLD[1] : CRIMSON[1], i === 0 ? GOLD[2] : CRIMSON[2], 220 * fade);
      strokeWeight(4 - i);
      circle(0, 0, grown * 2);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(320);
  }
}
