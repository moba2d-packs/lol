import type { AttackableUnit, Buff, CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const BaseBuff = api.buffs.Buff;
const Shield = api.buffs.Shield;
const SpellForm = api.enums.SpellForm;
const Spell = api.Spell;
const SpellObject = api.SpellObject;


/** Of the damage he deals, this much is banked. */
export const W_DEALT_SHARE = 0.35;

/** …and of what he takes, this much. Both halves, as the record has it. */
export const W_TAKEN_SHARE = 0.15;

/** The bank's ceiling, as a share of his own maximum health. */
export const W_CAP_SHARE = 0.3;

export const W_SHIELD_MS = 4_000;

/** What the recast turns the remaining shield into. */
export const W_HEAL_SHARE = 0.4;

/** The record's half-second before he may cash the shield in. */
export const W_RECAST_GAP_MS = 500;

export const W_MANA = 0;


const IRON: [number, number, number] = [72, 78, 88];

const VOID: [number, number, number] = [122, 60, 168];

const EMBER: [number, number, number] = [226, 92, 60];


/**
 * The bank. Always on, invisible, and the whole reason the active is worth
 * anything: what he presses W for is what he has already been through.
 *
 * `onDamageDealt` and `onDamageTaken` are core's own hooks on the two sides of
 * every hit, so nothing here has to enumerate the ways he can hurt or be hurt.
 */
export class Mordekaiser_W_Reservoir extends BaseBuff {
  name = 'Giáp Bất Diệt';
  stackId = 'mordekaiser_w_reservoir';
  hudVisible = false;
  description = `Tích ${pct(W_DEALT_SHARE)}% sát thương gây ra và ${pct(W_TAKEN_SHARE)}% sát thương phải chịu thành khiên tiềm tàng.`;
  /** Points waiting to become a shield. */
  banked = 0;

  get cap(): number {
    return this.targetUnit.stats.maxHealth.value * W_CAP_SHARE;
  }

  private bank(points: number): void {
    if (points <= 0) return;
    this.banked = Math.min(this.cap, this.banked + points);
  }

  onDamageDealt(_swung: number, landed: number): void {
    this.bank(landed * W_DEALT_SHARE);
  }

  onDamageTaken(swung: number): void {
    // The *pre*-mitigation number, which is the record's: what he weathered,
    // not what got through.
    this.bank(swung * W_TAKEN_SHARE);
  }

  /** Empty it, and answer what was in it. */
  drain(): number {
    const held = this.banked;
    this.banked = 0;
    return held;
  }
}


export function reservoirOn(morde: AttackableUnit): Mordekaiser_W_Reservoir | undefined {
  for (const buff of morde.buffs as Buff[]) {
    if (buff instanceof Mordekaiser_W_Reservoir && !buff.toRemove) return buff;
  }
  return undefined;
}


/** The shield he actually wears. Its own class so the recast can find it. */
export class Mordekaiser_W_Shield extends Shield {
  name = 'Giáp Bất Diệt';
  stackId = 'mordekaiser_w_shield';
  color: [number, number, number] = VOID;
}


export default class Mordekaiser_W extends Spell {
  static aiRoles = api.enums.SpellRole.Shield | api.enums.SpellRole.Heal;

  static aiRecastAfterMs = W_SHIELD_MS - 400;

  image = api.asset('spell_mordekaiser_w');
  name = 'Giáp Bất Diệt (Mordekaiser_W)';
  description =
    `Nội tại: <span class="buff">${pct(W_DEALT_SHARE)}% sát thương gây ra</span> và ` +
    `<span class="buff">${pct(W_TAKEN_SHARE)}% sát thương phải chịu</span> được tích thành ` +
    `khiên tiềm tàng, tối đa <span class="buff">${pct(W_CAP_SHARE)}% máu tối đa</span>. ` +
    `Kích hoạt để biến toàn bộ chỗ tích ấy thành khiên trong ` +
    `<span class="time">${secs(W_SHIELD_MS)} giây</span>. ` +
    `<b>Bấm lại</b> sau <span class="time">${secs(W_RECAST_GAP_MS)} giây</span> để nuốt chỗ khiên ` +
    `còn lại, <span class="buff">hồi ${pct(W_HEAL_SHARE)}% chỗ đó thành máu</span>.`;
  coolDown = 9_000;
  manaCost = W_MANA;

  /** The shield this activation put up, so the recast cashes in the right one. */
  private standing: InstanceType<typeof Mordekaiser_W_Shield> | null = null;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'RECAST',
      targeting: 'SELF',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      active: { maxDurationMs: W_SHIELD_MS, recastDelayMs: W_RECAST_GAP_MS },
      // He fights behind it; only real crowd control takes the cash-in away.
      interrupts: SpellForm.AIMED,
    };
  }

  onUpdate(): void {
    if (!this.owner || this.owner.isDead) return;
    if (this.owner.hasBuff(Mordekaiser_W_Reservoir)) return;
    this.owner.addBuff(new Mordekaiser_W_Reservoir(Infinity, this.owner, this.owner));
  }

  /** What the press would be worth right now — the HUD badge reads this. */
  get stackCount(): number {
    return Math.round(reservoirOn(this.owner)?.banked ?? 0);
  }

  onActivate(): void {
    const held = reservoirOn(this.owner)?.drain() ?? 0;
    if (held <= 0) return;

    const shield = new Mordekaiser_W_Shield(W_SHIELD_MS, this.owner, this.owner);
    shield.image = this.image;
    shield.amount = Math.round(held);
    this.owner.addBuff(shield);
    this.standing = shield;
    this.game.objectManager.addObject(new Mordekaiser_W_Plates(this.owner, shield));
  }

  onRecast(): void {
    const shield = this.standing;
    this.standing = null;
    if (!shield || shield.toRemove || shield.amount <= 0) return;

    const mended = Math.round(shield.amount * W_HEAL_SHARE);
    shield.deactivateBuff();
    // Through `takeHeal`, so every wound in the shop reaches it. Arithmetic on
    // `stats.health` would look identical on the bar and be invisible to all
    // of it.
    if (mended > 0) this.owner.takeHeal(mended, this.owner);
  }

  onComplete(): void {
    this.standing = null;
  }
}


/**
 * The plates: one hard ring per quarter of the shield still standing, so how
 * much is left is countable rather than guessed from an alpha.
 */
export class Mordekaiser_W_Plates extends SpellObject {
  age = 0;
  private readonly shield: InstanceType<typeof Mordekaiser_W_Shield>;
  private readonly opening: number;

  constructor(owner: AttackableUnit, shield: InstanceType<typeof Mordekaiser_W_Shield>) {
    super(owner);
    this.position = owner.position.copy();
    this.shield = shield;
    this.opening = Math.max(1, shield.amount);
  }

  update(): void {
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    if (this.age >= W_SHIELD_MS || this.shield.toRemove || this.owner.isDead) this.toRemove = true;
  }

  draw(): void {
    const left = Math.max(0, Math.min(1, this.shield.amount / this.opening));
    const radius = (this.owner.animatedValues?.displaySize ?? 40) * 0.85;
    // Four plates, and one goes dark for every quarter that has been spent.
    const standing = Math.ceil(left * 4);

    push();
    translate(this.position.x, this.position.y);
    noStroke();
    for (let i = 0; i < 4; i++) {
      const spin = (Math.PI * 2 * i) / 4 + Math.PI / 4;
      const lit = i < standing;
      push();
      rotate(spin);
      rectMode(CENTER);
      fill(IRON[0], IRON[1], IRON[2], lit ? 240 : 110);
      rect(radius, 0, 14, 22, 3);
      fill(lit ? VOID[0] : IRON[0], lit ? VOID[1] : IRON[1], lit ? VOID[2] : IRON[2], lit ? 240 : 90);
      rect(radius, 0, 7, 14, 2);
      pop();
    }
    // A hot rim while anything is left, so a spent shield reads as spent.
    if (standing > 0) {
      noFill();
      stroke(EMBER[0], EMBER[1], EMBER[2], 180);
      strokeWeight(2);
      circle(0, 0, radius * 2.35);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(180);
  }
}
