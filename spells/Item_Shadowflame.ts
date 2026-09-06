import type { AttackableUnit, CastSpec, DamageType } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { pct } from '../text';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const AoePulse = api.AoePulse;

/**
 * Ngọn Lửa Hắc Hóa — the mage's execute half, and the counterpart to Súng
 * Hải Tặc one shelf over: that one *finishes* a champion under 5%, this one
 * hits harder against anybody already under a third.
 *
 * ## The simplification, stated plainly
 *
 * The live item **amplifies** the hit — the same damage number, 20% bigger.
 * Core has no seam a pack can reach to do that: `Buff.onDamageDealt` is
 * explicitly *after* the fact and says so in its own doc comment ("it cannot
 * change the hit"), and `modifyIncomingDamage` lives on the other body and is
 * never told which item is asking. So the 20% is delivered as a **follow-up
 * hit** instead. The total is identical; what the player sees is one extra
 * damage number rather than a larger one, and the death recap gains a row
 * naming the item, which is arguably the better half of the trade.
 *
 * The share is taken off what actually **landed**, not off what was swung, so
 * a shield or a resistance that ate most of the hit shrinks the follow-up too
 * — an amplification that ignored mitigation would be a bigger item than the
 * one on the card.
 *
 * ## The threshold is read after the hit, on purpose
 *
 * `onDamageDealt` runs once the damage has resolved, so "below 35%" means
 * below it *now*. That makes the spell that brings a target under the line
 * the first one to pay out, which is how Súng Hải Tặc's own threshold already
 * reads and is the more legible of the two answers: the number appears on the
 * hit the player can see crossing the line.
 *
 * > **Without the latch this item is an infinite loop the first time it
 * > fires.** The follow-up is itself magic damage from the wearer, so it
 * > re-enters this same hook — and unlike `Item_Ludens.ts` there is no clock
 * > here to close it, because the item has no cooldown.
 */

/** Below this share of maximum health, the flame answers. */
export const SHADOWFLAME_THRESHOLD = 0.35;

/** How much more the hit is worth, as a share of what landed. */
export const SHADOWFLAME_BONUS = 0.2;

export const SHADOWFLAME_STACK_ID = 'item_shadowflame';

export const SHADOWFLAME_SOURCE = 'Ngọn Lửa Hắc Hóa';

/** The follow-up's flash: one ring on the victim, item-noise size. */
export const SHADOWFLAME_FLASH_RADIUS = 38;
export const SHADOWFLAME_FLASH_MS = 240;

// Dark flame: a deep magenta rather than magic's usual violet, so the second
// number is obviously the item's and not the spell's.
const DARKFLAME: [number, number, number] = [190, 60, 140];

export class Item_Shadowflame_Cinder extends Buff {
  name = SHADOWFLAME_SOURCE;
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;
  // Permanently-armed bookkeeping: the inventory slot is the icon, so no
  // buff-bar row (the `buffDescriptions` exemption, stated in the class).
  hudVisible = false;

  /** True only while the follow-up is in flight — see the header. */
  private amplifying = false;

  onDamageDealt(_swung: number, landed: number, victim: AttackableUnit, type: DamageType): void {
    if (this.amplifying) return;
    if (type !== 'MAGIC') return;
    if (landed <= 0) return;
    if (victim.isDead || victim.toRemove) return;
    if (victim.teamId === this.targetUnit.teamId) return;

    const max = victim.stats.maxHealth.value;
    if (max <= 0) return;
    if (victim.stats.health.baseValue > max * SHADOWFLAME_THRESHOLD) return;

    this.amplifying = true;
    try {
      victim.takeDamage(landed * SHADOWFLAME_BONUS, this.targetUnit, 'MAGIC', SHADOWFLAME_SOURCE);
    } finally {
      this.amplifying = false;
    }

    const flash = new AoePulse(this.targetUnit);
    flash.position = victim.position.copy();
    flash.radius = SHADOWFLAME_FLASH_RADIUS;
    flash.lifeTime = SHADOWFLAME_FLASH_MS;
    flash.color = [...DARKFLAME];
    flash.fillAlpha = 45;
    this.game.objectManager.addObject(flash);
  }
}

export default class Item_Shadowflame extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_shadowflame');
  name = 'Ngọn Lửa Hắc Hóa (Item_Shadowflame)';
  description =
    `Nội tại: khi mục tiêu còn dưới ${pct(SHADOWFLAME_THRESHOLD)}% máu tối đa, sát thương phép` +
    ` của bạn gây thêm ${pct(SHADOWFLAME_BONUS)}% lượng vừa gây ra`;
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
    const cinder = new Item_Shadowflame_Cinder(0, this.owner, this.owner);
    cinder.stackId = SHADOWFLAME_STACK_ID;
    cinder.image = this.image;
    cinder.sourceSpell = this;
    this.owner.addBuff(cinder);
  }
}
