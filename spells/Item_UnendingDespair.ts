import type { CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { enemyChampionsAround } from './Item_FrozenHeart';
import { pct, secs } from '../text';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const AoePulse = api.AoePulse;

/**
 * Áo Choàng Diệt Vong — the aura that pays the tank for *staying*.
 *
 * Thiêu Đốt makes standing beside you cost something; this makes standing
 * beside somebody else earn something. Same clock shape, opposite direction,
 * and together they are the two halves of the argument a front line makes:
 * the fight is worse for you and better for me the longer it goes on.
 *
 * ## Champions only, unlike Thiêu Đốt
 *
 * The burn deliberately reaches minions and monsters, because half of what an
 * immolate item buys is holding a wave and clearing a camp. This one must
 * not: a jungler pulsing a six-body camp would heal to full off it every four
 * seconds, and the item would be a health-bar reset rather than a reason to
 * stand in a teamfight. `enemyChampionsAround` is the tank shelf's own sweep
 * (Tim Băng's), so this ring and Khiên Băng Randuin's agree about who counts.
 *
 * ## The numbers
 *
 * Live is 30 (+3% bonus health) every four seconds, healing 250% of it. Here
 * it is `2 + 1% of the WEARER's maximum health`, which is the shape
 * `Item_Immolate.ts` and `Item_Heartsteel.ts` already use — a floor plus a
 * share of the bar its owner actually buys. On a mid-game tank (~300 máu)
 * that is 5 a champion and 10 back, so five pulses across a twenty-second
 * fight against one opponent is 50 healing: legible beside Giáp Máu Warmog's
 * regeneration without replacing it.
 *
 * The heal is **200% of what the pulse swung**, not of what got through. A
 * tank's sustain must not shrink because the enemy bought magic resist —
 * that would make the item worse exactly against the build it is bought
 * into. It still goes through `takeHeal`, so Vết Thương Sâu answers it.
 */

/** How often the cloak pulses. */
export const DESPAIR_TICK_MS = 4_000;

/** How far it reaches. Thiêu Đốt's radius, so the two tank auras are one size. */
export const DESPAIR_RADIUS = 170;

/** Magic damage per pulse, per champion: a floor plus a share of the WEARER's bar. */
export const DESPAIR_BASE_PER_TICK = 2;
export const DESPAIR_MAX_HEALTH_RATIO_PER_TICK = 0.01;

/** What comes back, as a share of what the pulse swung. */
export const DESPAIR_HEAL_RATIO = 2;

export const DESPAIR_STACK_ID = 'item_unending_despair';

export const DESPAIR_SOURCE = 'Áo Choàng Diệt Vong';

export const DESPAIR_RING_MS = 420;

// Grave violet-grey: a cloak, not a fire, so it never reads as Thiêu Đốt's
// embers at the same radius.
const DESPAIR: [number, number, number] = [170, 150, 205];

export class Item_UnendingDespair_Cloak extends Buff {
  name = DESPAIR_SOURCE;
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;
  // Permanently-armed bookkeeping: the inventory slot is the icon, so no
  // buff-bar row (the `buffDescriptions` exemption, stated in the class).
  hudVisible = false;

  sinceTick = 0;

  onUpdate(): void {
    this.sinceTick += deltaTime;
    if (this.sinceTick < DESPAIR_TICK_MS) return;
    this.sinceTick = 0;

    const wearer = this.targetUnit;
    if (wearer.isDead || wearer.toRemove) return;

    const caught = enemyChampionsAround(wearer, DESPAIR_RADIUS);
    if (caught.length === 0) return;

    const pulse =
      DESPAIR_BASE_PER_TICK + wearer.stats.maxHealth.value * DESPAIR_MAX_HEALTH_RATIO_PER_TICK;
    for (const enemy of caught) {
      enemy.takeDamage(pulse, wearer, 'MAGIC', DESPAIR_SOURCE);
    }
    wearer.takeHeal(pulse * caught.length * DESPAIR_HEAL_RATIO, wearer);

    // One ring at the true radius, only on the frame it actually fired — a
    // permanent ring would say "you own this item", which the inventory
    // already says, while this says "it just went off".
    const ring = new AoePulse(wearer);
    ring.position = wearer.position.copy();
    ring.radius = DESPAIR_RADIUS;
    ring.lifeTime = DESPAIR_RING_MS;
    ring.color = [...DESPAIR];
    ring.fillAlpha = 24;
    this.game.objectManager.addObject(ring);
  }
}

export default class Item_UnendingDespair extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_unending_despair');
  name = 'Áo Choàng Diệt Vong (Item_UnendingDespair)';
  description =
    `Nội tại: mỗi ${secs(DESPAIR_TICK_MS)} giây, gây ${DESPAIR_BASE_PER_TICK} +` +
    ` ${pct(DESPAIR_MAX_HEALTH_RATIO_PER_TICK)}% máu tối đa của bản thân sát thương phép lên các` +
    ` tướng địch xung quanh và hồi ${pct(DESPAIR_HEAL_RATIO)}% lượng đã gây`;
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
    const cloak = new Item_UnendingDespair_Cloak(0, this.owner, this.owner);
    cloak.stackId = DESPAIR_STACK_ID;
    cloak.image = this.image;
    cloak.sourceSpell = this;
    this.owner.addBuff(cloak);
  }
}
