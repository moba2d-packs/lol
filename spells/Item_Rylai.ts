import type { AttackableUnit, CastSpec, DamageType } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const Slow = api.buffs.Slow;

/**
 * Trượng Pha Lê Rylai — the mage's answer to "I hit them and they walked
 * away".
 *
 * Every other slow in this shop is bought with a button (Khiên Băng Randuin,
 * Tụ Bão Zeke, Chùy Phản Kích) or with a swing (Giáp Người Chết, Găng Tay
 * Băng Giá). This one rides the damage a mage was already dealing, which is
 * why it is the item that changes how a caster *plays* rather than what a
 * caster's rotation adds up to: every poke is now a decision the target has
 * to answer.
 *
 * The seam is `Buff.onDamageDealt`'s `type === 'MAGIC'`, exactly as the
 * wound shelf's magic half reads it (`Item_GrievousMagic.ts`). Nothing here
 * is rescaled off the live item: 30% and one second are a share and a
 * sub-second duration, both already scale-free, and both sit inside the band
 * this shop's slows live in — Chùy Phản Kích is 30% for 2.5s, Găng Tay Băng
 * Giá 25% for 1.5s.
 *
 * > **The trap this row is the most exposed to in the whole shop.** `Slow`'s
 * > default `buffAddType` is `STACKS_AND_CONTINUE` with `maxStacks = 10`, and
 * > this passive re-applies on *every* magic hit — a burn ticking four times
 * > a second would stack to ten inside three seconds and turn a 30% slow into
 * > a standstill. `RENEW_EXISTING` on a fixed `stackId` is what makes it one
 * > slow with its clock rewound (Ekko Q, Anivia R, Singed W are the models).
 */

/** The share of movement speed taken, on every magic hit. */
export const RYLAI_SLOW_PERCENT = 0.3;

/** How long one application lasts if nothing refreshes it. */
export const RYLAI_SLOW_MS = 1_000;

export const RYLAI_STACK_ID = 'item_rylai';

/** The victim's slot: one chill per wearer, renewed rather than stacked. */
export const RYLAI_SLOW_STACK_ID = 'item_rylai_chill';

export class Item_Rylai_Chill extends Buff {
  name = 'Trượng Pha Lê Rylai';
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;
  // Permanently-armed bookkeeping: the inventory slot is the icon, so no
  // buff-bar row (the `buffDescriptions` exemption, stated in the class).
  hudVisible = false;

  onDamageDealt(_swung: number, _landed: number, victim: AttackableUnit, type: DamageType): void {
    if (type !== 'MAGIC') return;
    if (victim.isDead || victim.toRemove) return;
    // A magic tick that lands on a friendly body (a shared burn zone, a
    // mis-aimed area effect) must not slow them: the item is a debuff the
    // wearer aims at somebody.
    if (victim.teamId === this.targetUnit.teamId) return;

    const chill = new Slow(RYLAI_SLOW_MS, this.targetUnit, victim);
    chill.name = 'Trượng Pha Lê Rylai';
    chill.percent = RYLAI_SLOW_PERCENT;
    // See the header. Without this line the item is a root.
    chill.buffAddType = api.enums.BuffAddType.RENEW_EXISTING;
    chill.stackId = RYLAI_SLOW_STACK_ID;
    victim.addBuff(chill);
  }
}

export default class Item_Rylai extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_rylais_crystal_scepter');
  name = 'Trượng Pha Lê Rylai (Item_Rylai)';
  description =
    `Nội tại: sát thương phép gây ra làm chậm mục tiêu ${pct(RYLAI_SLOW_PERCENT)}% trong` +
    ` ${secs(RYLAI_SLOW_MS)} giây`;
  coolDown = 0;
  manaCost = 0;

  get castSpec(): CastSpec {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: 0 },
    };
  }

  onSpellCast() {
    const chill = new Item_Rylai_Chill(0, this.owner, this.owner);
    chill.stackId = RYLAI_STACK_ID;
    chill.image = this.image;
    // Tied to the item rather than to the life: selling the sceptre takes the
    // chill with it.
    chill.sourceSpell = this;
    this.owner.addBuff(chill);
  }
}
