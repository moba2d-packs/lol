import type { AttackableUnit, CastSpec, DamageType } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct, secs } from '../text';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const Slow = api.buffs.Slow;

/**
 * Thương Phục Hận Serylda — Trượng Pha Lê Rylai's mirror on the attack-damage
 * side, with the one difference that makes it a different item: it only
 * answers once the target is already **losing**.
 *
 * Rylai's slows from full health, which is what a mage wants — the poke is
 * the whole plan. This is bought by somebody who has to close, and closing on
 * a healthy target is not the problem; the escape at half a bar is. So the
 * threshold *is* the item, and it is why the two can sit on one shelf without
 * being the same purchase twice.
 *
 * The type test is `Item_GrievousStrike.ts`'s, not its negation: **`TRUE`
 * counts as physical here**, for that file's stated reason — it is what an
 * armour-shredding build deals, and a lethality build is exactly who is
 * holding this spear.
 *
 * > Same `RENEW_EXISTING` trap as Rylai's, and for the same reason: this
 * > re-applies on every physical hit, and `Slow` stacks ten deep by default.
 */

/** The line: at or under this share of maximum health, the spear bites. */
export const SERYLDA_THRESHOLD = 0.5;

export const SERYLDA_SLOW_PERCENT = 0.3;

export const SERYLDA_SLOW_MS = 1_000;

export const SERYLDA_STACK_ID = 'item_serylda';

/** The victim's slot: one grudge per wearer, renewed rather than stacked. */
export const SERYLDA_SLOW_STACK_ID = 'item_serylda_grudge';

export class Item_Serylda_Grudge extends Buff {
  name = 'Thương Phục Hận Serylda';
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;
  // Permanently-armed bookkeeping: the inventory slot is the icon, so no
  // buff-bar row (the `buffDescriptions` exemption, stated in the class).
  hudVisible = false;

  onDamageDealt(_swung: number, _landed: number, victim: AttackableUnit, type: DamageType): void {
    // Magic is Rylai's half of the shelf. See the header for why TRUE is not.
    if (type === 'MAGIC') return;
    if (victim.isDead || victim.toRemove) return;
    if (victim.teamId === this.targetUnit.teamId) return;

    const max = victim.stats.maxHealth.value;
    if (max <= 0) return;
    if (victim.stats.health.baseValue > max * SERYLDA_THRESHOLD) return;

    const grudge = new Slow(SERYLDA_SLOW_MS, this.targetUnit, victim);
    grudge.name = 'Thương Phục Hận Serylda';
    grudge.percent = SERYLDA_SLOW_PERCENT;
    grudge.buffAddType = api.enums.BuffAddType.RENEW_EXISTING;
    grudge.stackId = SERYLDA_SLOW_STACK_ID;
    victim.addBuff(grudge);
  }
}

export default class Item_Serylda extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_seryldas_grudge');
  name = 'Thương Phục Hận Serylda (Item_Serylda)';
  description =
    `Nội tại: sát thương vật lý gây ra làm chậm ${pct(SERYLDA_SLOW_PERCENT)}% trong` +
    ` ${secs(SERYLDA_SLOW_MS)} giây các mục tiêu còn dưới ${pct(SERYLDA_THRESHOLD)}% máu tối đa`;
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
    const grudge = new Item_Serylda_Grudge(0, this.owner, this.owner);
    grudge.stackId = SERYLDA_STACK_ID;
    grudge.image = this.image;
    grudge.sourceSpell = this;
    this.owner.addBuff(grudge);
  }
}
